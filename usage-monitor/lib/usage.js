import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TOKEN_KEYS = [
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens"
];

export function defaultConfig() {
  const home = os.homedir();
  return {
    days: Number(process.env.USAGE_MONITOR_DAYS || 30),
    codexRoots: [
      path.join(home, ".codex", "sessions"),
      path.join(home, ".codex", "archived_sessions")
    ],
    claudeRoots: [path.join(home, ".claude", "projects")],
    pricingPath: path.resolve("data", "pricing.json")
  };
}

export async function buildUsageReport(options = {}) {
  const config = { ...defaultConfig(), ...options };
  const since = new Date(Date.now() - config.days * 24 * 60 * 60 * 1000);
  const pricing = readPricing(config.pricingPath);
  const local = await scanLocalUsage({ ...config, since, pricing });
  const openaiApi = await fetchOpenAIOrganizationUsage(config.days);
  return {
    generatedAt: new Date().toISOString(),
    windowDays: config.days,
    sources: [
      ...local.sources,
      openaiApi.source
    ].filter(Boolean),
    summary: summarizeRecords([...local.records, ...openaiApi.records]),
    records: [...local.records, ...openaiApi.records]
  };
}

export async function scanLocalUsage({ codexRoots, claudeRoots, since, pricing }) {
  const records = [];
  const sources = [];

  const codexFiles = listJsonlFiles(codexRoots);
  for (const file of codexFiles) {
    const stat = safeStat(file);
    if (stat && stat.mtime < since) continue;
    const record = parseCodexSession(file, pricing);
    if (record && new Date(record.lastSeenAt) >= since) records.push(record);
  }
  sources.push(sourceStatus("codex-local", "Codex local JSONL", codexRoots, codexFiles.length));

  const claudeFiles = listJsonlFiles(claudeRoots);
  for (const file of claudeFiles) {
    const stat = safeStat(file);
    if (stat && stat.mtime < since) continue;
    const record = parseClaudeSession(file, pricing);
    if (record && new Date(record.lastSeenAt) >= since) records.push(record);
  }
  sources.push(sourceStatus("claude-local", "Claude local JSONL", claudeRoots, claudeFiles.length));

  return { records, sources };
}

function parseCodexSession(file, pricing) {
  const lines = readJsonl(file);
  let sessionId = path.basename(file, ".jsonl");
  let cwd = "";
  let model = "unknown";
  let firstSeenAt = null;
  let lastSeenAt = null;
  let planType = "";
  let rateLimits = null;
  let sum = zeroUsage();
  let prevTotal = null;

  for (const entry of lines) {
    const timestamp = normalizeTimestamp(entry.timestamp);
    if (timestamp) {
      firstSeenAt = earlier(firstSeenAt, timestamp);
      lastSeenAt = later(lastSeenAt, timestamp);
    }

    if (entry.type === "session_meta") {
      sessionId = entry.payload?.id || sessionId;
      cwd = entry.payload?.cwd || cwd;
      model = entry.payload?.model || model;
    }

    if (entry.type === "turn_context") {
      cwd = entry.payload?.cwd || cwd;
      model = entry.payload?.model || model;
    }

    if (entry.type === "event_msg" && entry.payload?.type === "token_count") {
      planType = entry.payload?.rate_limits?.plan_type || planType;
      rateLimits = entry.payload?.rate_limits || rateLimits;
      const info = entry.payload?.info || {};
      if (info.model || info.model_name || entry.payload?.model) {
        model = normalizeModelName(info.model || info.model_name || entry.payload.model);
      }

      if (info.total_token_usage) {
        const current = codexUsage(info.total_token_usage);
        addUsage(sum, clampCache(deltaUsage(prevTotal, current)));
        prevTotal = current;
      } else if (info.last_token_usage) {
        addUsage(sum, clampCache(codexUsage(info.last_token_usage)));
      }
    }
  }

  const usage = sum;
  if (!hasUsage(usage)) return null;

  return finishRecord({
    provider: "openai",
    product: "Codex",
    source: "local-jsonl",
    sessionId,
    cwd,
    model,
    firstSeenAt,
    lastSeenAt,
    usage,
    costUSD: estimateOpenAICost(model, usage, pricing),
    meta: { planType, rateLimits }
  });
}

function parseClaudeSession(file, pricing) {
  const lines = readJsonl(file);
  const messages = new Map();
  let sessionId = path.basename(file, ".jsonl");
  let cwd = "";
  let model = "unknown";
  let entrypoint = "";
  let firstSeenAt = null;
  let lastSeenAt = null;

  for (const entry of lines) {
    const timestamp = normalizeTimestamp(entry.timestamp);
    if (timestamp) {
      firstSeenAt = earlier(firstSeenAt, timestamp);
      lastSeenAt = later(lastSeenAt, timestamp);
    }

    sessionId = entry.sessionId || sessionId;
    cwd = entry.cwd || cwd;
    entrypoint = entry.entrypoint || entrypoint;
    const message = entry.message || {};
    model = message.model || model;
    const rawUsage = message.usage;
    if (entry.type !== "assistant" || !message.id || !rawUsage) continue;

    const parsed = {
      model: message.model || "unknown",
      stopReason: message.stop_reason || null,
      usage: claudeUsage(rawUsage),
      timestamp
    };
    const existing = messages.get(message.id);
    if (!existing || shouldReplaceClaudeUsage(existing, parsed)) {
      messages.set(message.id, parsed);
    }
  }

  const usage = zeroUsage();
  for (const message of messages.values()) {
    if (!message.stopReason || message.usage.outputTokens === 0) continue;
    addUsage(usage, message.usage);
  }

  if (!hasUsage(usage)) return null;
  return finishRecord({
    provider: "anthropic",
    product: "Claude Code",
    source: "local-jsonl",
    sessionId,
    cwd,
    model,
    firstSeenAt,
    lastSeenAt,
    usage,
    costUSD: estimateAnthropicCost(model, usage, pricing),
    meta: { entrypoint }
  });
}

function normalizeModelName(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/^[^/]+\//, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-\d{8}$/, "");
}

function shouldReplaceClaudeUsage(existing, next) {
  if (next.stopReason && !existing.stopReason) return true;
  if (Boolean(next.stopReason) === Boolean(existing.stopReason)) {
    return next.usage.outputTokens > existing.usage.outputTokens;
  }
  return false;
}

function deltaUsage(prev, current) {
  if (!prev) return current;
  const next = zeroUsage();
  for (const key of TOKEN_KEYS) {
    next[key] = Math.max(0, number(current[key]) - number(prev[key]));
  }
  return next;
}

function clampCache(usage) {
  return {
    ...usage,
    cachedInputTokens: Math.min(number(usage.cachedInputTokens), number(usage.inputTokens))
  };
}

async function fetchOpenAIOrganizationUsage(days) {
  const key = process.env.OPENAI_ADMIN_KEY || process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      records: [],
      source: {
        id: "openai-usage-api",
        label: "OpenAI Usage API",
        status: "disabled",
        detail: "Set OPENAI_ADMIN_KEY to enable organization usage/costs."
      }
    };
  }

  const start = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  try {
    const url = new URL("https://api.openai.com/v1/organization/usage/completions");
    url.searchParams.set("start_time", String(start));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("group_by", "model");
    url.searchParams.set("limit", String(Math.min(days, 31)));
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const records = [];
    for (const bucket of data.data || []) {
      for (const result of bucket.results || []) {
        const usage = {
          inputTokens: number(result.input_tokens),
          cachedInputTokens: number(result.input_cached_tokens),
          outputTokens: number(result.output_tokens) + number(result.output_audio_tokens),
          reasoningOutputTokens: 0,
          totalTokens: number(result.input_tokens) + number(result.output_tokens)
        };
        if (!hasUsage(usage)) continue;
        records.push(finishRecord({
          provider: "openai",
          product: "OpenAI API",
          source: "usage-api",
          sessionId: `openai-api-${bucket.start_time}-${result.model || "all"}`,
          cwd: "",
          model: result.model || "all models",
          firstSeenAt: new Date(bucket.start_time * 1000).toISOString(),
          lastSeenAt: new Date((bucket.end_time || bucket.start_time) * 1000).toISOString(),
          usage,
          costUSD: null,
          meta: { projectId: result.project_id, apiKeyId: result.api_key_id }
        }));
      }
    }
    return {
      records,
      source: {
        id: "openai-usage-api",
        label: "OpenAI Usage API",
        status: "ok",
        detail: `${records.length} daily buckets loaded.`
      }
    };
  } catch (error) {
    return {
      records: [],
      source: {
        id: "openai-usage-api",
        label: "OpenAI Usage API",
        status: "error",
        detail: error.message
      }
    };
  }
}

function summarizeRecords(records) {
  const summary = {
    sessions: records.length,
    costUSD: 0,
    usage: zeroUsage(),
    byProvider: {},
    byModel: {},
    byDay: {}
  };

  for (const record of records) {
    addUsage(summary.usage, record.usage);
    if (typeof record.costUSD === "number") summary.costUSD += record.costUSD;
    const provider = summary.byProvider[record.product] || blankGroup(record.product);
    addGroup(provider, record);
    summary.byProvider[record.product] = provider;

    const model = summary.byModel[record.model] || blankGroup(record.model);
    addGroup(model, record);
    summary.byModel[record.model] = model;

    const day = record.day || "unknown";
    const dayGroup = summary.byDay[day] || blankGroup(day);
    addGroup(dayGroup, record);
    summary.byDay[day] = dayGroup;
  }

  summary.byProvider = Object.values(summary.byProvider).sort((a, b) => b.usage.totalTokens - a.usage.totalTokens);
  summary.byModel = Object.values(summary.byModel).sort((a, b) => b.usage.totalTokens - a.usage.totalTokens);
  summary.byDay = Object.values(summary.byDay).sort((a, b) => a.key.localeCompare(b.key));
  summary.costUSD = roundMoney(summary.costUSD);
  return summary;
}

function addGroup(group, record) {
  group.sessions += 1;
  addUsage(group.usage, record.usage);
  if (typeof record.costUSD === "number") group.costUSD += record.costUSD;
  group.costUSD = roundMoney(group.costUSD);
}

function blankGroup(key) {
  return { key, sessions: 0, costUSD: 0, usage: zeroUsage() };
}

function finishRecord(record) {
  const lastSeenAt = record.lastSeenAt || record.firstSeenAt || new Date().toISOString();
  return {
    ...record,
    firstSeenAt: record.firstSeenAt || lastSeenAt,
    lastSeenAt,
    day: lastSeenAt.slice(0, 10),
    cwdLabel: labelPath(record.cwd),
    costUSD: typeof record.costUSD === "number" ? roundMoney(record.costUSD) : record.costUSD
  };
}

function listJsonlFiles(roots) {
  const files = [];
  for (const root of roots) walk(root, files);
  return files;
}

function walk(target, files) {
  const stat = safeStat(target);
  if (!stat) return;
  if (stat.isFile() && target.endsWith(".jsonl")) {
    files.push(target);
    return;
  }
  if (!stat.isDirectory()) return;
  let entries = [];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    walk(path.join(target, entry.name), files);
  }
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readPricing(pricingPath) {
  try {
    return JSON.parse(fs.readFileSync(pricingPath, "utf8"));
  } catch {
    return { openai: {}, anthropic: {} };
  }
}

function sourceStatus(id, label, roots, fileCount) {
  const existing = roots.filter((root) => safeStat(root));
  return {
    id,
    label,
    status: existing.length ? "ok" : "missing",
    detail: existing.length ? `${fileCount} JSONL files found.` : `No readable roots: ${roots.join(", ")}`
  };
}

function codexUsage(raw) {
  return {
    inputTokens: number(raw.input_tokens),
    cachedInputTokens: number(raw.cached_input_tokens),
    outputTokens: number(raw.output_tokens),
    reasoningOutputTokens: number(raw.reasoning_output_tokens),
    totalTokens: number(raw.total_tokens)
  };
}

function claudeUsage(raw) {
  const input = number(raw.input_tokens);
  const cached = number(raw.cache_read_input_tokens) + number(raw.cache_creation_input_tokens);
  const output = number(raw.output_tokens);
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    reasoningOutputTokens: 0,
    totalTokens: input + cached + output
  };
}

function estimateOpenAICost(model, usage, pricing) {
  const exact = pricing.openai?.[model];
  if (!exact) return null;
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    (uncachedInput / 1_000_000) * exact.input +
    (usage.cachedInputTokens / 1_000_000) * exact.cachedInput +
    ((usage.outputTokens + usage.reasoningOutputTokens) / 1_000_000) * exact.output
  );
}

function estimateAnthropicCost(model, usage, pricing) {
  const exact = pricing.anthropic?.[model];
  if (!exact) return null;
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    (uncachedInput / 1_000_000) * exact.input +
    (usage.cachedInputTokens / 1_000_000) * exact.cachedInput +
    (usage.outputTokens / 1_000_000) * exact.output
  );
}

function zeroUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0
  };
}

function addUsage(target, source) {
  for (const key of TOKEN_KEYS) target[key] += number(source[key]);
  if (!source.totalTokens) {
    target.totalTokens += number(source.inputTokens) + number(source.outputTokens) + number(source.reasoningOutputTokens);
  }
}

function hasUsage(usage) {
  return TOKEN_KEYS.some((key) => number(usage[key]) > 0);
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function earlier(a, b) {
  if (!a) return b;
  return new Date(a) < new Date(b) ? a : b;
}

function later(a, b) {
  if (!a) return b;
  return new Date(a) > new Date(b) ? a : b;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round(value * 10000) / 10000;
}

function safeStat(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function labelPath(value) {
  if (!value) return "";
  const home = os.homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}
