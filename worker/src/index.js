import DASHBOARD_HTML from '../../web/dashboard.html';
import { syncDiary, diaryVersions, recordDiaryVersion } from './diary-sync.mjs';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const PERSONAL_ROUTE_PREFIX = "/tasks";
// Capability changes must invalidate the same revision polled by existing
// clients, even when no business document changed during a deployment.
const SYNC_CAPABILITIES = { readingWriteVersion: 1, diaryEntryWriteVersion: 1, diarySyncVersion: 1 };
const EMPTY_APP_DATA = { tasks: [], books: [], notes: [], updates: [] };
const EMPTY_DIARY_DATA = { today: { date: "", content: "" }, archive: [] };
const DIARY_TAGS = [
  "学习卡壳",
  "复习考试",
  "焦虑内耗",
  "灾难化",
  "失眠亢奋",
  "安静恢复",
  "计划执行",
  "决策止损",
  "求职面试",
  "人际边界",
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}

function nowInShanghai() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
}

function todayInShanghai() {
  return nowInShanghai().toISOString().slice(0, 10);
}

function effectiveDiaryDateInShanghai() {
  const now = nowInShanghai();
  if (now.getHours() < 5) now.setDate(now.getDate() - 1);
  return now.toISOString().slice(0, 10);
}

function normalizeArrayItems(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function normalizeWereadStats(stats) {
  if (!stats || typeof stats !== "object") return { monthly: {}, annual: {}, overall: {}, dailyReadTimes: [] };
  const daily = Array.isArray(stats.dailyReadTimes)
    ? stats.dailyReadTimes
        .filter(item => item && item.date && Number.isFinite(Number(item.seconds)))
        .map(item => ({ ...item, seconds: Math.max(0, Number(item.seconds) || 0) }))
    : [];
  return { monthly: stats.monthly || {}, annual: stats.annual || {}, overall: stats.overall || {}, dailyReadTimes: daily };
}

function hasWereadBriefStats(section) {
  if (!section || typeof section !== "object") return false;
  return ["baseTime", "readDays", "totalReadTime", "dayAverageReadTime"].some((key) => Number(section[key]) > 0);
}

function hasWereadStatsData(stats) {
  const normalized = normalizeWereadStats(stats);
  return Boolean(
    normalized.dailyReadTimes.length
    || hasWereadBriefStats(normalized.monthly)
    || hasWereadBriefStats(normalized.annual)
    || hasWereadBriefStats(normalized.overall)
  );
}

function mergeWereadStats(primary, fallback) {
  const p = normalizeWereadStats(primary);
  const f = normalizeWereadStats(fallback);
  return {
    monthly: hasWereadBriefStats(p.monthly) ? p.monthly : f.monthly,
    annual: hasWereadBriefStats(p.annual) ? p.annual : f.annual,
    overall: hasWereadBriefStats(p.overall) ? p.overall : f.overall,
    dailyReadTimes: p.dailyReadTimes.length ? p.dailyReadTimes : f.dailyReadTimes,
  };
}

function timestampSecondsForDate(dateKey) {
  const value = Date.parse(`${dateKey}T00:00:00+08:00`);
  return Number.isFinite(value) ? Math.floor(value / 1000) : 0;
}

function deriveWereadTimeFields(stats) {
  const normalized = normalizeWereadStats(stats);
  const monthKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const weekReadDaily = {};
  const dailyReadTimes = normalized.dailyReadTimes.map((item) => {
    const date = String(item.date || "").trim();
    let timestamp = Number(item.timestamp || 0);
    if (timestamp > 1e11) timestamp = Math.floor(timestamp / 1000);
    if (!timestamp && date) timestamp = timestampSecondsForDate(date);
    const seconds = Math.max(0, Number(item.seconds) || 0);
    const minutes = Math.round(seconds / 60);
    if (date.startsWith(monthKey) && minutes > 0 && timestamp) {
      weekReadDaily[String(timestamp)] = minutes;
    }
    return { ...item, timestamp, seconds, minutes };
  });
  const weekReadMinutes = Object.values(weekReadDaily).reduce((sum, value) => sum + value, 0);
  const totalReadDays = Number(
    normalized.overall?.readDays || normalized.annual?.readDays || normalized.monthly?.readDays || 0,
  );
  return { dailyReadTimes, weekReadDaily, weekReadMinutes, totalReadDays };
}

function buildWereadTimeData(stats, syncedAt = "") {
  const normalized = normalizeWereadStats(stats);
  const derived = deriveWereadTimeFields(normalized);
  return {
    source: "weread",
    syncedAt: String(syncedAt || ""),
    monthly: normalized.monthly || {},
    annual: normalized.annual || {},
    overall: normalized.overall || {},
    dailyReadTimes: derived.dailyReadTimes,
    weekReadDaily: derived.weekReadDaily,
    weekReadMinutes: derived.weekReadMinutes,
    totalReadDays: derived.totalReadDays,
  };
}

function normalizeAppData(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const timeWeread = data.time && typeof data.time === "object" && data.time.weread && typeof data.time.weread === "object"
    ? data.time.weread
    : null;
  const wereadStats = mergeWereadStats(data.wereadStats, timeWeread);
  const hasWereadStats = hasWereadStatsData(wereadStats);
  const wereadSyncedAt = data.wereadSyncedAt || timeWeread?.syncedAt || "";
  const wereadTime = hasWereadStats ? buildWereadTimeData(wereadStats, wereadSyncedAt) : null;
  const result = {
    _revision: Number(data._revision) || 0,
    tasks:   normalizeArrayItems(data.tasks),
    books:   normalizeArrayItems(data.books),
    notes:   normalizeArrayItems(data.notes),
    updates: normalizeArrayItems(data.updates),
  };
  if (hasWereadStats)               result.wereadStats      = wereadStats;
  if (data.weekReadDaily || wereadTime) result.weekReadDaily = data.weekReadDaily || wereadTime.weekReadDaily;
  if (data.weekReadMinutes != null || wereadTime) result.weekReadMinutes = data.weekReadMinutes ?? wereadTime.weekReadMinutes;
  if (data.totalReadDays   != null || wereadTime) result.totalReadDays   = data.totalReadDays ?? wereadTime.totalReadDays;
  if (wereadSyncedAt)               result.wereadSyncedAt   = wereadSyncedAt;
  if (data.time || wereadTime)      result.time             = { ...(data.time || {}), ...(wereadTime ? { weread: wereadTime } : {}) };
  return result;
}

// Three-way snapshot writes preserve changes made by another client since GET.
// Conflicting edits to the same field are rejected rather than silently overwritten.
function mergeSnapshot(existing, incoming) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const base = incoming._base;
  if (!base) {
    if (incoming._revision == null || Number(incoming._revision) !== existing._revision) {
      throw Object.assign(new Error("数据已更新，请刷新后重试"), { status: 409 });
    }
    return { ...existing, ...incoming };
  }
  const result = { ...existing };
  for (const key of ["tasks", "notes", "updates", "books"]) {
    if (!Array.isArray(incoming[key])) continue;
    if (!Array.isArray(base[key])) throw Object.assign(new Error("缺少保存基线"), { status: 400 });
    const identity = item => `${typeof item.id}:${item.id}`;
    const before = new Map(base[key].map(item => [identity(item), item]));
    const after = new Map(incoming[key].map(item => [identity(item), item]));
    const current = new Map((existing[key] || []).map(item => [identity(item), item]));
    if (after.size !== incoming[key].length) throw Object.assign(new Error("重复 ID"), { status: 400 });
    for (const [id, old] of before) {
      const next = after.get(id), remote = current.get(id);
      if (same(old, next)) continue;
      if (!next) {
        if (remote && !same(old, remote)) throw Object.assign(new Error("删除项已被其他端修改"), { status: 409 });
        current.delete(id);
      } else {
        if (!remote) throw Object.assign(new Error("修改项已被其他端删除"), { status: 409 });
        const merged = { ...remote };
        for (const field of new Set([...Object.keys(old), ...Object.keys(next)])) {
          if (same(old[field], next[field])) continue;
          if (!same(remote[field], old[field]) && !same(remote[field], next[field])) {
            throw Object.assign(new Error("同一字段已被其他端修改，请核对后重试"), { status: 409 });
          }
          if (field in next) merged[field] = next[field]; else delete merged[field];
        }
        current.set(id, merged);
      }
    }
    for (const [id, next] of after) {
      if (before.has(id)) continue;
      if (current.has(id) && !same(current.get(id), next)) {
        throw Object.assign(new Error("新增项 ID 冲突，请刷新后重试"), { status: 409 });
      }
      current.set(id, next);
    }
    result[key] = [...current.values()];
  }
  return result;
}

// Local reading edits use the same field-baseline rule as snapshot saves,
// inside TaskState's existing transaction. Legacy callers remain compatible.
function readingPatch(record, body, fields, deleting = false) {
  if (record.source === "weread") throw Object.assign(new Error("微信读书记录由来源同步维护"), { status: 403 });
  const protectedWrite = body._readingWriteVersion != null || body._base != null;
  const patch = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "id" && !key.startsWith("_")));
  if (!protectedWrite) return patch;
  if (body._readingWriteVersion !== 1 || !body._base || typeof body._base !== "object" || Array.isArray(body._base)) {
    throw Object.assign(new Error("缺少读书编辑基线"), { status: 400 });
  }
  const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  for (const field of deleting ? fields : Object.keys(patch)) {
    if (!fields.includes(field) || !Object.hasOwn(body._base, field)) {
      throw Object.assign(new Error("缺少字段保存基线"), { status: 400 });
    }
    if (!same(record[field], body._base[field]) && (deleting || !same(record[field], patch[field]))) {
      throw Object.assign(new Error("同一字段已被其他端修改，请核对后重试"), { status: 409 });
    }
  }
  return patch;
}

const BOOK_EDIT_FIELDS = ["title", "currentPage", "totalPage", "status", "notes"];
const NOTE_EDIT_FIELDS = ["title", "summary", "tags", "bookId"];

function noteBookLink(data, body) {
  if (!Object.hasOwn(body, "bookId")) return {};
  if (body.bookId == null) return { bookId: null, bookTitle: "" };
  const book = data.books.find(item => item.id === body.bookId);
  if (!book) throw Object.assign(new Error("关联书籍已被删除，请重新选择"), { status: 409 });
  return { bookId: book.id, bookTitle: book.title };
}

function mergeReadingUpdate(existing, body) {
  const result = { ...existing };
  for (const [key, isReading] of [["books", item => item.source === "weread"], ["notes", item => item.source === "weread"], ["updates", item => item.type === "weread"]]) {
    if (Array.isArray(body[key])) result[key] = [...(existing[key] || []).filter(item => !isReading(item)), ...body[key].filter(isReading)];
  }
  // Only reading fields are accepted; tasks and manual content can never be overwritten.
  for (const key of ["wereadStats", "weekReadDaily", "weekReadMinutes", "totalReadDays", "wereadSyncedAt", "time"]) {
    if (body[key] != null) result[key] = body[key];
  }
  if (body.wereadStats) {
    const daily = new Map((existing.wereadStats?.dailyReadTimes || []).map(item => [item.date, item]));
    for (const item of body.wereadStats.dailyReadTimes || []) {
      if (!daily.has(item.date) || Number(item.seconds) >= Number(daily.get(item.date).seconds)) daily.set(item.date, item);
    }
    result.wereadStats = { ...body.wereadStats, dailyReadTimes: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  }
  return result;
}

function buildWidgetSummary(data) {
  const normalized = normalizeAppData(data);
  const tasks = normalized.tasks.map((task) => ({
    id: task.id,
    title: String(task.title || ""),
    category: task.category || "",
    status: task.status || "todo",
    priority: task.priority || "medium",
    taskType: task.taskType || "weekly",
    deadline: task.deadline || "",
  }));
  const wereadStats = normalizeWereadStats(normalized.wereadStats);

  return {
    tasks,
    weekReadDaily: normalized.weekReadDaily || {},
    weekReadMinutes: normalized.weekReadMinutes || 0,
    totalReadDays: normalized.totalReadDays || wereadStats.overall?.readDays || 0,
    wereadStats: {
      overall: wereadStats.overall || {},
      dailyReadTimes: wereadStats.dailyReadTimes || [],
    },
    wereadSyncedAt: normalized.wereadSyncedAt || "",
  };
}

function coerceDiaryViewCount(value) {
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function coerceTagScore(value) {
  const score = Number.parseInt(value, 10);
  if (!Number.isFinite(score)) return 0;
  return Math.min(5, Math.max(0, score));
}

function normalizeDiaryTags(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const tags = [];
  for (const item of value) {
    const tag = String(item || "").trim();
    if (DIARY_TAGS.includes(tag) && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function normalizeDiaryTagScores(scores, tags = []) {
  const normalized = {};
  if (scores && typeof scores === "object" && !Array.isArray(scores)) {
    for (const [key, value] of Object.entries(scores)) {
      const tag = String(key || "").trim();
      if (!DIARY_TAGS.includes(tag)) continue;
      const score = coerceTagScore(value);
      if (score > 0) normalized[tag] = score;
    }
  }
  for (const tag of normalizeDiaryTags(tags)) {
    if (!normalized[tag]) normalized[tag] = 1;
  }
  return Object.fromEntries(DIARY_TAGS.filter((tag) => normalized[tag] > 0).map((tag) => [tag, normalized[tag]]));
}

function normalizeDiaryEntryTags(entry) {
  const tagScores = normalizeDiaryTagScores(entry?.tagScores, entry?.tags);
  return {
    ...entry,
    tags: DIARY_TAGS.filter((tag) => tagScores[tag] > 0),
    tagScores,
  };
}

function mergeDiaryTagScores(left, right) {
  const leftScores = normalizeDiaryTagScores(left?.tagScores, left?.tags);
  const rightScores = normalizeDiaryTagScores(right?.tagScores, right?.tags);
  const merged = {};
  for (const tag of DIARY_TAGS) {
    const score = Math.max(leftScores[tag] || 0, rightScores[tag] || 0);
    if (score > 0) merged[tag] = score;
  }
  return merged;
}

function normalizeDiaryArchiveEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const date = String(entry.date || "").trim();
  if (!date) return null;
  return normalizeDiaryEntryTags({
    ...entry,
    date,
    content: String(entry.content || ""),
    viewCount: coerceDiaryViewCount(entry.viewCount),
    lastViewedAt: String(entry.lastViewedAt || "").trim(),
  });
}

function mergeDiaryArchiveEntries(left, right) {
  const normalizedLeft = normalizeDiaryArchiveEntry(left);
  const normalizedRight = normalizeDiaryArchiveEntry(right);
  if (!normalizedLeft || !normalizedRight) return normalizedLeft || normalizedRight;

  const leftContent = String(normalizedLeft.content || "");
  const rightContent = String(normalizedRight.content || "");
  const leftVersion = String(normalizedLeft.updatedAt || "");
  const rightVersion = String(normalizedRight.updatedAt || "");
  const primary = leftVersion || rightVersion
    ? (rightVersion > leftVersion ? normalizedRight : normalizedLeft)
    : (rightContent.length > leftContent.length ? normalizedRight : normalizedLeft);
  const tagScores = mergeDiaryTagScores(normalizedLeft, normalizedRight);
  return {
    ...primary,
    date: primary.date || normalizedLeft.date || normalizedRight.date,
    content: primary.content,
    viewCount: Math.max(normalizedLeft.viewCount || 0, normalizedRight.viewCount || 0),
    lastViewedAt: [normalizedLeft.lastViewedAt || "", normalizedRight.lastViewedAt || ""].sort().slice(-1)[0] || "",
    tags: DIARY_TAGS.filter((tag) => tagScores[tag] > 0),
    tagScores,
  };
}

function normalizeDiaryData(payload) {
  const diary = payload && typeof payload === "object" ? payload : {};
  const today = diary.today && typeof diary.today === "object" ? diary.today : {};
  const archive = Array.isArray(diary.archive)
    ? diary.archive.map(normalizeDiaryArchiveEntry).filter(Boolean)
    : [];
  return {
    today: normalizeDiaryEntryTags({
      date: String(today.date || ""),
      content: String(today.content || ""),
      updatedAt: String(today.updatedAt || ""),
      tags: today.tags,
      tagScores: today.tagScores,
    }),
    archive,
  };
}

function mergeDiaryArchiveList(entries = []) {
  const archiveMap = {};
  for (const entry of entries || []) {
    const normalized = normalizeDiaryArchiveEntry(entry);
    if (!normalized?.date) continue;
    archiveMap[normalized.date] = mergeDiaryArchiveEntries(archiveMap[normalized.date], normalized);
  }
  return Object.values(archiveMap)
    .filter((entry) => String(entry.content || "").trim() || entry.updatedAt)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function archiveDiaryIfNeeded(diary) {
  const normalized = normalizeDiaryData(diary);
  const date = effectiveDiaryDateInShanghai();
  const today = normalized.today || {};
  let archive = mergeDiaryArchiveList(normalized.archive || []);
  if (today.date && today.date !== date) {
    if (String(today.content || "").trim()) {
      archive = mergeDiaryArchiveList([{ ...today }, ...archive]);
    }
    return { today: { date, content: "", updatedAt: "" }, archive };
  }
  if (!today.date) return { today: { ...today, date }, archive };
  return normalized;
}

function shouldAcceptIncomingToday(incoming, stored) {
  const incomingUpdatedAt = String(incoming?.updatedAt || "").trim();
  const storedUpdatedAt = String(stored?.updatedAt || "").trim();
  if (incomingUpdatedAt && storedUpdatedAt) return incomingUpdatedAt >= storedUpdatedAt;
  if (incomingUpdatedAt) return true;
  return Boolean(String(incoming?.content || "").trim() || !String(stored?.content || "").trim());
}

function mergeDiaryUpdate(storedDiary, incomingDiary, incomingHadToday = true) {
  const stored = archiveDiaryIfNeeded(storedDiary);
  const incoming = archiveDiaryIfNeeded(incomingDiary);
  const incomingRawToday = incomingDiary?.today && typeof incomingDiary.today === "object" ? incomingDiary.today : null;
  const incomingTodayHasTags = Boolean(incomingRawToday && ("tags" in incomingRawToday || "tagScores" in incomingRawToday));

  let today = incomingHadToday && shouldAcceptIncomingToday(incoming.today, stored.today)
    ? { ...stored.today, ...incoming.today }
    : stored.today;
  if (incomingHadToday && !incomingTodayHasTags) {
    today = { ...today, tags: stored.today.tags || [], tagScores: stored.today.tagScores || {} };
  } else if (incomingHadToday && incomingTodayHasTags) {
    const tagScores = mergeDiaryTagScores(stored.today, incoming.today);
    today = { ...today, tags: DIARY_TAGS.filter((tag) => tagScores[tag] > 0), tagScores };
  }
  return {
    today,
    // archiveDiaryIfNeeded filters body-less entries. Preserve incoming metadata
    // until it is merged with stored bodies, then discard any still-empty entries.
    archive: mergeDiaryArchiveList([...(stored.archive || []), ...(incoming.archive || []), ...normalizeDiaryData(incomingDiary).archive]),
  };
}

async function loadData(kv) {
  const raw = await kv.get("app_data");
  if (!raw) return normalizeAppData(EMPTY_APP_DATA);
  try {
    return normalizeAppData(JSON.parse(raw));
  } catch {
    return normalizeAppData(EMPTY_APP_DATA);
  }
}

async function saveData(kv, data) {
  const current = await loadData(kv);
  const saved = normalizeAppData({ ...data, _revision: current._revision + 1 });
  await kv.put("app_data", JSON.stringify(saved));
  return saved;
}

async function loadDiary(kv) {
  const raw = await kv.get("diary_data");
  if (!raw) return { ...EMPTY_DIARY_DATA };
  try {
    return normalizeDiaryData(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DIARY_DATA };
  }
}

async function saveDiary(kv, diary) {
  await kv.put("diary_data", JSON.stringify(normalizeDiaryData(diary)));
}

async function loadCurrentDiary(kv) {
  const stored = await loadDiary(kv);
  const current = archiveDiaryIfNeeded(stored);
  if (JSON.stringify(current) !== JSON.stringify(stored)) await saveDiary(kv, current);
  return current;
}

// ── 年度总结与长篇思想（独立 KV key: essays_data，与任务/日记/笔记完全隔离）──
const ESSAY_CATEGORIES = ["长篇思想", "年度总结"];

function normalizeEssayEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = Number(entry.id);
  const category = ESSAY_CATEGORIES.includes(entry.category) ? entry.category : "长篇思想";
  return {
    id: Number.isFinite(id) && id > 0 ? id : 0,
    title: String(entry.title || ""),
    content: String(entry.content || ""),
    category,
    date: String(entry.date || ""),
    createdAt: String(entry.createdAt || ""),
    updatedAt: String(entry.updatedAt || ""),
  };
}

function normalizeEssaysData(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const items = Array.isArray(data.items) ? data.items.map(normalizeEssayEntry).filter(Boolean) : [];
  return { items };
}

async function loadEssays(kv) {
  const raw = await kv.get("essays_data");
  if (!raw) return { items: [] };
  try {
    return normalizeEssaysData(JSON.parse(raw));
  } catch {
    return { items: [] };
  }
}

async function saveEssays(kv, data) {
  await kv.put("essays_data", JSON.stringify(normalizeEssaysData(data)));
}

function isPersonalAuthorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return Boolean(token) && token === env.API_TOKEN;
}

function resolveRoute(pathname) {
  if (pathname === PERSONAL_ROUTE_PREFIX || pathname.startsWith(`${PERSONAL_ROUTE_PREFIX}/`)) {
    return pathname.replace(/^\/tasks(?=\/|$)/, "") || "/";
  }
  return null;
}

async function runDailyReset(env) {
  const kv = env.TASKS_KV;
  const today = effectiveDiaryDateInShanghai();
  const lastRun = await kv.get("daily_reset_date");
  if (lastRun === today) return { skipped: true };

  await loadCurrentDiary(kv);

  const data = await loadData(kv);
  data.tasks = (data.tasks || []).filter((task) => task.status !== "completed");
  await saveData(kv, data);
  await kv.put("daily_reset_date", today);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────

async function dispatchWereadSync(env, event) {
  const body = JSON.stringify({
    event_type: "weread-sync",
    client_payload: { source: "cloudflare-cron", cron: event.cron },
  });
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "dx-weread-cloudflare-cron",
  };
  const url = "https://api.github.com/repos/yangminggulab/dx-weread/dispatches";

  let resp = await fetch(url, { method: "POST", headers, body });
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`dispatchWereadSync failed: ${resp.status} ${text}, retrying in 30s`);
    await new Promise((r) => setTimeout(r, 30_000));
    resp = await fetch(url, { method: "POST", headers, body });
    if (!resp.ok) {
      const text2 = await resp.text();
      console.error(`dispatchWereadSync retry failed: ${resp.status} ${text2}`);
    }
  }
}

const worker = {
  async scheduled(event, env, ctx) {
    if (event.cron.startsWith("13 ")) {
      ctx.waitUntil(dispatchWereadSync(env, event));
      return;
    }
    if (!env.TASKS_STATE) throw new Error("TaskState binding is required; legacy KV is migration-only");
    ctx.waitUntil(env.TASKS_STATE.get(env.TASKS_STATE.idFromName("personal")).fetch(new Request("https://state.internal/tasks/__internal/reset", {
          method: "POST", headers: { Authorization: `Bearer ${env.API_TOKEN}` },
        })));
  },

  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = resolveRoute(url.pathname);
      if (!path) return json({ error: "not found" }, 404);

      if (request.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
      }

      if (path === "/" || path === "/index.html" || path === "/dashboard.html") {
        return new Response(DASHBOARD_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (path === "/api/login" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!body.password || body.password !== env.LOGIN_PASSWORD) {
          return json({ error: "Unauthorized" }, 401);
        }
        return json({ token: env.API_TOKEN });
      }

      if (path.startsWith("/api/") && !isPersonalAuthorized(request, env)) {
        return json({ error: "Unauthorized" }, 401);
      }

      // All clients and Cron share one strongly consistent state coordinator.
      if (path.startsWith("/api/") && env.TASKS_STATE) {
        return await env.TASKS_STATE.get(env.TASKS_STATE.idFromName("personal")).fetch(request);
      }
      // Missing deployment bindings must never expose or modify an obsolete KV
      // snapshot. Only the transactional TaskState adapter may serve data APIs.
      if (path.startsWith("/api/") && !env.DIARY_SYNC_ATOMIC) {
        return json({ error: "云端暂时不可用，客户端会保留内容并自动重试" }, 503);
      }

      if (path === "/api/sync-state" && request.method === "GET") {
        return json({ revision: Number(await env.TASKS_KV.get("sync_version")) || 0, ...SYNC_CAPABILITIES,
          diarySyncVersion: env.DIARY_SYNC_ATOMIC ? SYNC_CAPABILITIES.diarySyncVersion : 0 });
      }

      if (path === "/api/data" && request.method === "GET") {
        return json(await loadData(env.TASKS_KV));
      }

      if (path === "/api/widget-summary" && request.method === "GET") {
        return json(buildWidgetSummary(await loadData(env.TASKS_KV)));
      }

      if (path === "/api/data" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const existing = await loadData(env.TASKS_KV);
        const data = await saveData(env.TASKS_KV, mergeSnapshot(existing, body));
        return json({ ok: true, data });
      }

      if (path === "/api/weread" && request.method === "POST") {
        const body = await request.json();
        const existing = await loadData(env.TASKS_KV);
        await saveData(env.TASKS_KV, mergeReadingUpdate(existing, body));
        return json({ ok: true });
      }

      if (path === "/api/tasks/add" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        const maxId = data.tasks.reduce((max, task) => Math.max(max, task.id || 0), 0);
        const task = {
          id: maxId + 1,
          title: body.title || "",
          category: body.category || "life",
          status: body.status || "todo",
          priority: body.priority || "medium",
          taskType: body.taskType || "weekly",
          deadline: body.deadline || "",
          tags: Array.isArray(body.tags) ? body.tags : [],
          notes: body.notes || "",
          projectId: body.projectId || null,
          currentPage: null,
          totalPage: null,
          createdAt: todayInShanghai(),
          updatedAt: new Date().toISOString(),
        };
        data.tasks.push(task);
        await saveData(env.TASKS_KV, data);
        return json({ ok: true, task });
      }

      if (path === "/api/tasks/update" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        const idx = data.tasks.findIndex((task) => task.id === body.id);
        if (idx === -1) return json({ ok: false, error: "not found" }, 404);
        data.tasks[idx] = { ...data.tasks[idx], ...body, updatedAt: new Date().toISOString() };
        await saveData(env.TASKS_KV, data);
        return json({ ok: true, task: data.tasks[idx] });
      }

      if (path === "/api/tasks/delete" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        data.tasks = data.tasks.filter((task) => task.id !== body.id);
        await saveData(env.TASKS_KV, data);
        return json({ ok: true });
      }

      if (path === "/api/notes/add" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        const maxId = data.notes.reduce((max, note) => Math.max(max, typeof note.id === "number" ? note.id : 0), 0);
        const note = {
          id: maxId + 1,
          title: body.title || "",
          summary: body.summary || "",
          tags: Array.isArray(body.tags) ? body.tags : [],
          updatedAt: todayInShanghai(),
          projectId: body.projectId || null,
          ...noteBookLink(data, body),
        };
        data.notes = [note, ...data.notes];
        await saveData(env.TASKS_KV, data);
        return json({ ok: true, note });
      }

      if (path === "/api/notes/delete" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        const note = data.notes.find(item => item.id === body.id);
        if (note) readingPatch(note, body, NOTE_EDIT_FIELDS, true);
        else if (body._readingWriteVersion) return json({ error: "记录已被删除" }, 409);
        data.notes = data.notes.filter((note) => note.id !== body.id);
        await saveData(env.TASKS_KV, data);
        return json({ ok: true });
      }

      if (path === "/api/notes/update" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        const idx = data.notes.findIndex((note) => note.id === body.id);
        if (idx === -1) return json({ ok: false, error: "not found" }, 404);
        const patch = readingPatch(data.notes[idx], body, NOTE_EDIT_FIELDS);
        data.notes[idx] = {
          ...data.notes[idx],
          title: patch.title ?? data.notes[idx].title,
          summary: patch.summary ?? data.notes[idx].summary,
          tags: patch.tags ?? data.notes[idx].tags,
          ...noteBookLink(data, patch),
          updatedAt: todayInShanghai(),
        };
        await saveData(env.TASKS_KV, data);
        return json({ ok: true, note: data.notes[idx] });
      }

      if (path === "/api/books/add" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        const maxId = data.books.reduce((max, b) => Math.max(max, typeof b.id === "number" ? b.id : 0), 0);
        const book = {
          id: maxId + 1,
          source: "study",
          title: String(body.title || ""),
          currentPage: Number(body.currentPage) || 0,
          totalPage: Number(body.totalPage) || 0,
          status: body.status || "reading",
          notes: String(body.notes || ""),
        };
        data.books = [book, ...data.books];
        await saveData(env.TASKS_KV, data);
        return json({ ok: true, book });
      }

      if (path === "/api/books/update" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        const idx = data.books.findIndex((b) => b.id === body.id);
        if (idx === -1) return json({ ok: false, error: "not found" }, 404);
        const patch = readingPatch(data.books[idx], body, BOOK_EDIT_FIELDS);
        data.books[idx] = { ...data.books[idx], ...patch, updatedAt: new Date().toISOString() };
        if (Object.hasOwn(patch, "title")) {
          data.notes = data.notes.map(note => note.bookId === body.id ? { ...note, bookTitle: data.books[idx].title } : note);
        }
        await saveData(env.TASKS_KV, data);
        return json({ ok: true, book: data.books[idx] });
      }

      if (path === "/api/books/delete" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        const book = data.books.find(item => item.id === body.id);
        if (book) readingPatch(book, body, BOOK_EDIT_FIELDS, true);
        else if (body._readingWriteVersion) return json({ error: "记录已被删除" }, 409);
        data.books = data.books.filter((b) => b.id !== body.id);
        await saveData(env.TASKS_KV, data);
        return json({ ok: true });
      }

      if (path === "/api/diary" && request.method === "GET") {
        const diary = await loadCurrentDiary(env.TASKS_KV);
        if (url.searchParams.get("today") === "1") {
          return json({ today: diary.today || { date: "", content: "" }, archive: [], syncVersion: env.DIARY_SYNC_ATOMIC ? 1 : undefined });
        }
        return json({ ...diary, syncVersion: env.DIARY_SYNC_ATOMIC ? 1 : undefined });
      }

      if (path === "/api/diary/sync" && request.method === "POST") {
        if (!env.DIARY_SYNC_ATOMIC) return json({ error: "自动同步需要事务存储" }, 503);
        const body = await request.json().catch(() => ({}));
        const diary = await loadCurrentDiary(env.TASKS_KV);
        const result = await syncDiary(env.TASKS_KV, diary, body, value => saveDiary(env.TASKS_KV, value), effectiveDiaryDateInShanghai());
        return json(result.value, result.status);
      }

      if (path === "/api/diary/versions" && request.method === "GET") {
        if (!env.DIARY_SYNC_ATOMIC) return json({ error: "此服务尚未提供版本历史" }, 503);
        const result = await diaryVersions(env.TASKS_KV, url.searchParams.get("date"), Number(url.searchParams.get("cursor") || 0));
        return result ? json(result) : json({ error: "版本查询参数无效" }, 400);
      }

      if (path === "/api/diary/entry" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const date = body.date;
        const validDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
          && !Number.isNaN(Date.parse(date + "T00:00:00Z"))
          && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
        if (!validDate || date > effectiveDiaryDateInShanghai() || typeof body.content !== "string"
            || typeof body.expectedContent !== "string" || typeof body.expectedUpdatedAt !== "string") {
          return json({ error: "日期或保存基线无效" }, 400);
        }
        const diary = await loadCurrentDiary(env.TASKS_KV);
        const current = diary.today.date === date ? diary.today : diary.archive.find(entry => entry.date === date);
        if (!current) return json({ error: "这一天的日记已不存在" }, 404);
        if (current.content !== body.expectedContent || String(current.updatedAt || "") !== body.expectedUpdatedAt) {
          return json({ error: "这一天的日记已被其他端修改", entry: current }, 409);
        }
        if (env.DIARY_SYNC_ATOMIC) await recordDiaryVersion(env.TASKS_KV, date, current.content, { reason: "previous" });
        const entry = { ...current, content: body.content,
          updatedAt: new Date(Math.max(Date.now(), (Date.parse(current.updatedAt) || 0) + 1)).toISOString() };
        if (diary.today.date === date) diary.today = entry;
        else diary.archive = diary.archive.map(item => item.date === date ? entry : item);
        if (env.DIARY_SYNC_ATOMIC) await recordDiaryVersion(env.TASKS_KV, date, entry.content, { source: "legacy", reason: "saved" });
        await saveDiary(env.TASKS_KV, diary);
        return json({ ok: true, entry });
      }

      if (path === "/api/diary" && request.method === "POST") {
        const rawBody = await request.json().catch(() => ({}));
        const body = normalizeDiaryData(rawBody);
        const stored = await loadCurrentDiary(env.TASKS_KV);
        if (Object.hasOwn(rawBody, "expectedUpdatedAt") && !rawBody.overwriteConflict
            && (body.today.date !== stored.today.date || String(rawBody.expectedUpdatedAt || "") !== String(stored.today.updatedAt || ""))) {
          return json({ error: "日记已被其他端修改", today: stored.today }, 409);
        }
        const confirmationTime = new Date(Math.max(Date.now(), (Date.parse(stored.today.updatedAt) || 0) + 1)).toISOString();
        // Older clients retain the last GET timestamp while editing. Give their
        // explicit content updates a server timestamp instead of silently dropping
        // a second save. New clients additionally carry an enforced version baseline.
        if (Object.hasOwn(rawBody, "expectedUpdatedAt") || String(body.today.content || "").trim() || rawBody.today?.updatedAt) {
          body.today.updatedAt = confirmationTime;
        }
        const incomingHadToday = Boolean(rawBody?.today && typeof rawBody.today === "object");
        const merged = mergeDiaryUpdate(stored, body, incomingHadToday);
        if (JSON.stringify({ ...merged.today, updatedAt: "" }) !== JSON.stringify({ ...stored.today, updatedAt: "" })) {
          merged.today.updatedAt = confirmationTime;
        } else {
          merged.today.updatedAt = stored.today.updatedAt || "";
        }
        if (env.DIARY_SYNC_ATOMIC) {
          for (const entry of [merged.today, ...merged.archive]) {
            const old = entry.date === stored.today.date ? stored.today : stored.archive.find(item => item.date === entry.date);
            if (!old || old.content !== entry.content) {
              if (old) await recordDiaryVersion(env.TASKS_KV, entry.date, old.content, { reason: "previous" });
              await recordDiaryVersion(env.TASKS_KV, entry.date, entry.content, { source: "legacy", reason: "saved" });
            }
          }
        }
        await saveDiary(env.TASKS_KV, merged);
        return json({ ok: true, today: merged.today });
      }

      if (path === "/api/essays" && request.method === "GET") {
        return json(await loadEssays(env.TASKS_KV));
      }

      if (path === "/api/essays/add" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadEssays(env.TASKS_KV);
        const maxId = data.items.reduce((max, e) => Math.max(max, e.id || 0), 0);
        const now = todayInShanghai();
        const essay = normalizeEssayEntry({
          id: maxId + 1,
          title: body.title || "",
          content: body.content || "",
          category: body.category || "长篇思想",
          date: body.date || now,
          createdAt: now,
          updatedAt: now,
        });
        data.items = [essay, ...data.items];
        await saveEssays(env.TASKS_KV, data);
        return json({ ok: true, essay });
      }

      if (path === "/api/essays/update" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadEssays(env.TASKS_KV);
        const idx = data.items.findIndex((e) => e.id === body.id);
        if (idx === -1) return json({ ok: false, error: "not found" }, 404);
        data.items[idx] = normalizeEssayEntry({
          ...data.items[idx],
          title: body.title ?? data.items[idx].title,
          content: body.content ?? data.items[idx].content,
          category: body.category ?? data.items[idx].category,
          date: body.date ?? data.items[idx].date,
          updatedAt: todayInShanghai(),
        });
        await saveEssays(env.TASKS_KV, data);
        return json({ ok: true, essay: data.items[idx] });
      }

      if (path === "/api/essays/delete" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadEssays(env.TASKS_KV);
        data.items = data.items.filter((e) => e.id !== body.id);
        await saveEssays(env.TASKS_KV, data);
        return json({ ok: true });
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "服务器内部错误" }, error.status || 500);
    }
  },
};


export default worker;

// SQLite-backed Durable Object. Its queue covers each complete read/modify/write,
// not just an individual storage operation. No data API reads the old edge KV.
export class TaskState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.tail = Promise.resolve();
  }

  enqueue(operation) {
    const work = this.tail.then(operation);
    this.tail = work.catch(() => {});
    return work;
  }

  async initialize() {
    if (await this.ctx.storage.get("migration_complete")) return;
    const keys = ["app_data", "diary_data", "essays_data", "daily_reset_date"];
    const original = {};
    for (const key of keys) {
      const raw = await this.env.TASKS_KV.get(key);
      if (raw != null) {
        if (key !== "daily_reset_date") {
          const document = JSON.parse(raw);
          if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("Invalid migration document: " + key);
        } // Fail safely on corrupt data.
        original[key] = raw;
      }
    }
    await this.ctx.storage.transaction(async storage => {
      for (const [key, raw] of Object.entries(original)) {
        await this.writeStored(storage, key, raw);
        await this.writeStored(storage, "migration_original:" + key, raw);
      }
      await storage.put("migration_backup", { importedAt: new Date().toISOString(), keys: Object.keys(original) });
      await storage.put("migration_complete", true);
    });
  }

  // SQLite KV values have a 2 MB limit. Keep growing diaries/notes in
  // bounded UTF-8 chunks, within the same transaction as their manifest.
  async readStored(storage, key) {
    const manifest = await storage.get(key + ":chunks");
    if (manifest == null) return storage.get(key);
    const decoder = new TextDecoder();
    const parts = [];
    for (let index = 0; index < manifest; index++) {
      const chunk = await storage.get(`${key}:chunk:${index}`);
      if (!chunk) throw new Error("Incomplete stored document");
      parts.push(decoder.decode(chunk, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  }

  async writeStored(storage, key, value) {
    const bytes = new TextEncoder().encode(value);
    const previous = await storage.get(key + ":chunks") || 0;
    const count = Math.ceil(bytes.length / (512 * 1024));
    if (count <= 1) {
      await storage.put(key, value);
      await storage.delete(key + ":chunks");
    } else {
      for (let index = 0; index < count; index++) {
        await storage.put(`${key}:chunk:${index}`, bytes.slice(index * 512 * 1024, (index + 1) * 512 * 1024));
      }
      await storage.put(key + ":chunks", count);
      await storage.delete(key);
    }
    for (let index = count <= 1 ? 0 : count; index < previous; index++) await storage.delete(`${key}:chunk:${index}`);
  }

  storageEnvironment(storage) {
    return { ...this.env, TASKS_STATE: null, DIARY_SYNC_ATOMIC: true, TASKS_KV: {
      get: key => this.readStored(storage, key),
      put: async (key, value) => {
        await this.writeStored(storage, key, value);
        if (["app_data", "diary_data", "essays_data"].includes(key)) {
          await storage.put("sync_version", (await storage.get("sync_version") || 0) + 1);
        }
      },
    } };
  }

  fetch(request) {
    return this.enqueue(async () => {
      // Defense in depth: binding access must never bypass API authentication.
      if (!isPersonalAuthorized(request, this.env)) return json({ error: "Unauthorized" }, 401);
      await this.initialize();
      try {
        return await this.ctx.storage.transaction(async storage => {
          const capabilities = JSON.stringify(SYNC_CAPABILITIES);
          if (await storage.get("sync_capabilities") !== capabilities) {
            await storage.put("sync_capabilities", capabilities);
            await storage.put("sync_version", (await storage.get("sync_version") || 0) + 1);
          }
          if (new URL(request.url).pathname === "/tasks/__internal/reset" && request.method === "POST") {
            return json(await runDailyReset(this.storageEnvironment(storage)));
          }
          const response = await worker.fetch(request, this.storageEnvironment(storage));
          if (!response.ok) throw Object.assign(new Error("Request rejected"), { response });
          return response;
        });
      } catch (error) {
        if (error.response) return error.response;
        throw error;
      }
    });
  }


}
