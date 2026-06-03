import DASHBOARD_HTML from '../../web/dashboard.html';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const PERSONAL_ROUTE_PREFIX = "/tasks";
const EMPTY_APP_DATA = { tasks: [], books: [], notes: [], updates: [] };
const EMPTY_DIARY_DATA = { today: { date: "", content: "" }, archive: [] };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
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

function mergeDataForFullSave(existing, incoming) {
  const data = incoming && typeof incoming === "object" ? { ...incoming } : {};
  for (const key of ["books", "wereadStats", "weekReadDaily", "weekReadMinutes", "totalReadDays", "wereadSyncedAt", "time"]) {
    if (data[key] == null && existing?.[key] != null) data[key] = existing[key];
  }
  return data;
}

function coerceDiaryViewCount(value) {
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function normalizeDiaryArchiveEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const date = String(entry.date || "").trim();
  if (!date) return null;
  return {
    ...entry,
    date,
    content: String(entry.content || ""),
    viewCount: coerceDiaryViewCount(entry.viewCount),
    lastViewedAt: String(entry.lastViewedAt || "").trim(),
  };
}

function mergeDiaryArchiveEntries(left, right) {
  const normalizedLeft = normalizeDiaryArchiveEntry(left);
  const normalizedRight = normalizeDiaryArchiveEntry(right);
  if (!normalizedLeft || !normalizedRight) return normalizedLeft || normalizedRight;

  const leftContent = String(normalizedLeft.content || "");
  const rightContent = String(normalizedRight.content || "");
  const primary = rightContent.length > leftContent.length ? normalizedRight : normalizedLeft;
  return {
    ...primary,
    date: primary.date || normalizedLeft.date || normalizedRight.date,
    content: rightContent.length > leftContent.length ? rightContent : leftContent,
    viewCount: Math.max(normalizedLeft.viewCount || 0, normalizedRight.viewCount || 0),
    lastViewedAt: [normalizedLeft.lastViewedAt || "", normalizedRight.lastViewedAt || ""].sort().slice(-1)[0] || "",
  };
}

function normalizeDiaryData(payload) {
  const diary = payload && typeof payload === "object" ? payload : {};
  const today = diary.today && typeof diary.today === "object" ? diary.today : {};
  const archive = Array.isArray(diary.archive)
    ? diary.archive.map(normalizeDiaryArchiveEntry).filter(Boolean)
    : [];
  return {
    today: {
      date: String(today.date || ""),
      content: String(today.content || ""),
      updatedAt: String(today.updatedAt || ""),
    },
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
    .filter((entry) => String(entry.content || "").trim())
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

  const today = incomingHadToday && shouldAcceptIncomingToday(incoming.today, stored.today)
    ? { ...stored.today, ...incoming.today }
    : stored.today;
  return {
    today,
    archive: mergeDiaryArchiveList([...(stored.archive || []), ...(incoming.archive || [])]),
  };
}

async function loadData(kv) {
  const raw = await kv.get("app_data");
  if (!raw) return { ...EMPTY_APP_DATA };
  try {
    return normalizeAppData(JSON.parse(raw));
  } catch {
    return { ...EMPTY_APP_DATA };
  }
}

async function saveData(kv, data) {
  await kv.put("app_data", JSON.stringify(normalizeAppData(data)));
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

export default {
  async scheduled(event, env, ctx) {
    if (event.cron.startsWith("13 ")) {
      ctx.waitUntil(dispatchWereadSync(env, event));
      return;
    }
    ctx.waitUntil(runDailyReset(env));
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

      const isWriteApi = path.startsWith("/api/") && request.method !== "GET" && request.method !== "OPTIONS";
      if (isWriteApi && !isPersonalAuthorized(request, env)) {
        return json({ error: "Unauthorized" }, 401);
      }

      if (path === "/api/data" && request.method === "GET") {
        return json(await loadData(env.TASKS_KV));
      }

      if (path === "/api/data" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const existing = await loadData(env.TASKS_KV);
        await saveData(env.TASKS_KV, mergeDataForFullSave(existing, body));
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
        data.tasks[idx] = { ...data.tasks[idx], ...body };
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
        const maxId = data.notes.reduce((max, note) => Math.max(max, note.id || 0), 0);
        const note = {
          id: maxId + 1,
          title: body.title || "",
          summary: body.summary || "",
          tags: Array.isArray(body.tags) ? body.tags : [],
          updatedAt: todayInShanghai(),
          projectId: body.projectId || null,
        };
        data.notes = [note, ...data.notes];
        await saveData(env.TASKS_KV, data);
        return json({ ok: true, note });
      }

      if (path === "/api/notes/delete" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        data.notes = data.notes.filter((note) => note.id !== body.id);
        await saveData(env.TASKS_KV, data);
        return json({ ok: true });
      }

      if (path === "/api/notes/update" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        const idx = data.notes.findIndex((note) => note.id === body.id);
        if (idx === -1) return json({ ok: false, error: "not found" }, 404);
        data.notes[idx] = {
          ...data.notes[idx],
          title: body.title ?? data.notes[idx].title,
          summary: body.summary ?? data.notes[idx].summary,
          tags: body.tags ?? data.notes[idx].tags,
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
        data.books[idx] = { ...data.books[idx], ...body };
        await saveData(env.TASKS_KV, data);
        return json({ ok: true, book: data.books[idx] });
      }

      if (path === "/api/books/delete" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadData(env.TASKS_KV);
        data.books = data.books.filter((b) => b.id !== body.id);
        await saveData(env.TASKS_KV, data);
        return json({ ok: true });
      }

      if (path === "/api/diary" && request.method === "GET") {
        const diary = await loadCurrentDiary(env.TASKS_KV);
        if (url.searchParams.get("today") === "1") {
          return json({ today: diary.today || { date: "", content: "" }, archive: [] });
        }
        return json(diary);
      }

      if (path === "/api/diary" && request.method === "POST") {
        const rawBody = await request.json().catch(() => ({}));
        const body = normalizeDiaryData(rawBody);
        const stored = await loadCurrentDiary(env.TASKS_KV);
        const incomingHadToday = Boolean(rawBody?.today && typeof rawBody.today === "object");
        await saveDiary(env.TASKS_KV, mergeDiaryUpdate(stored, body, incomingHadToday));
        return json({ ok: true });
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "服务器内部错误" }, 500);
    }
  },
};
