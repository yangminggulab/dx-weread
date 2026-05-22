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
  for (const key of ["wereadStats", "weekReadDaily", "weekReadMinutes", "totalReadDays", "wereadSyncedAt", "time"]) {
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

// ── WeRead 定时同步（Cloudflare cron，key 存 Worker secret 不经 GitHub） ──────

const WEREAD_GATEWAY = "https://i.weread.qq.com/api/agent/gateway";
const WEREAD_SKILL_VER = "1.0.3";
const WR_BOOK_ACCENTS = ["#2d6a4f", "#4a4a6a", "#6a4a2a", "#3a6a5a", "#5a3a6a"];

async function wrCall(apiKey, apiName, params = {}) {
  const resp = await fetch(WEREAD_GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ api_name: apiName, skill_version: WEREAD_SKILL_VER, ...params }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || (data.errcode !== undefined && data.errcode !== 0))
    throw new Error(data.errmsg || `HTTP ${resp.status}`);
  if (data.upgrade_info?.message)
    throw new Error(`WeRead skill 需升级：${data.upgrade_info.message}`);
  return data;
}

function wrFormatTs(ms, withTime = true) {
  if (!ms) return "";
  const d = new Date(ms > 1e11 ? ms : ms * 1000);
  if (isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t)?.value || "";
  return withTime
    ? `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`
    : `${g("year")}-${g("month")}-${g("day")}`;
}

function wrAccent(seed = "") {
  let s = 0;
  for (const c of seed) s += c.charCodeAt(0);
  return WR_BOOK_ACCENTS[s % WR_BOOK_ACCENTS.length];
}

function wrEpochMs(v) {
  const n = Number(v) || 0;
  return n <= 0 ? 0 : n < 1e11 ? n * 1000 : n;
}

async function wrSha1(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function wrItemId(bookId, type, ...parts) {
  const norm = parts.map((p) => String(p || "").trim()).filter(Boolean).join("||");
  const h = await wrSha1(`${bookId}|${type}|${norm}`);
  return `${bookId}:${type}:${h.slice(0, 16)}`;
}

function wrShorten(text, limit = 18) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length <= limit ? s : s.slice(0, limit).trimEnd() + "...";
}

function wrNoteTitle(bookTitle, label, content) {
  const p = wrShorten(content, 18);
  return p ? `《${bookTitle}》${label} · ${p}` : `《${bookTitle}》${label}`;
}

function wrNormalizeBook(item, progressPayload) {
  const b = (item && typeof item === "object") ? item : {};
  const prog = progressPayload?.book && typeof progressPayload.book === "object" ? progressPayload.book : {};
  const bookId = String(b.bookId || "").trim();
  const pct = Math.max(0, Math.min(100, Number(prog.progress) || 0));
  const readTs = wrEpochMs(prog.updateTime || b.readUpdateTime || b.updateTime);
  return {
    source: "weread",
    _bookId: bookId,
    id: bookId,
    title: b.title || "",
    author: b.author || "",
    cover: b.cover || "",
    category: b.category || "",
    status: pct >= 100 || Number(b.finishReading) === 1 ? "finished" : "reading",
    progressPercent: pct,
    readTimestamp: readTs,
    readAt: wrFormatTs(readTs),
    todayReadMinutes: 0,
    accent: wrAccent(b.title || ""),
    sourceUpdatedTimestamp: readTs,
    recordReadingTime: Number(prog.recordReadingTime || prog.readingTime) || 0,
    chapterUid: Number(prog.chapterUid) || 0,
    chapterOffset: Number(prog.chapterOffset) || 0,
    isStartReading: Boolean(Number(prog.isStartReading)),
    secret: Number(b.secret) || 0,
    isTop: Number(b.isTop) || 0,
  };
}

async function wrNormalizeHighlight(bookTitle, bookId, mark, chapterTitles) {
  const text = String(mark.markText || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const ts = wrEpochMs(mark.createTime);
  const chUid = Number(mark.chapterUid) || 0;
  const id = await wrItemId(bookId, "highlight", mark.bookmarkId, mark.range, chUid, text, ts);
  return {
    source: "weread",
    title: wrNoteTitle(bookTitle, "划线", text),
    tags: ["微信读书", "划线"],
    summary: text,
    noteType: "highlight",
    bookTitle,
    _bookId: bookId,
    sourceItemId: id,
    sourceUpdatedAt: wrFormatTs(ts),
    sourceUpdatedTimestamp: ts,
    updatedAt: wrFormatTs(ts, false),
    chapterTitle: chapterTitles[chUid] || "",
    chapterUid: chUid,
    range: String(mark.range || "").trim(),
    colorStyle: Number(mark.colorStyle) || 0,
  };
}

async function wrNormalizeReview(bookTitle, bookId, reviewItem) {
  const r = reviewItem?.review && typeof reviewItem.review === "object" ? reviewItem.review : {};
  const content = String(r.content || "").replace(/\s+/g, " ").trim();
  if (!content) return null;
  const ts = wrEpochMs(r.createTime);
  const id = await wrItemId(bookId, "review", r.reviewId, r.range, ts, content);
  return {
    source: "weread",
    title: wrNoteTitle(bookTitle, "评论", content),
    tags: ["微信读书", "评论"],
    summary: content,
    noteType: "review",
    bookTitle,
    _bookId: bookId,
    sourceItemId: id,
    sourceUpdatedAt: wrFormatTs(ts),
    sourceUpdatedTimestamp: ts,
    updatedAt: wrFormatTs(ts, false),
    chapterTitle: String(r.chapterTitle || r.chapterName || "").trim(),
    chapterUid: Number(r.chapterUid) || 0,
    range: String(r.range || "").trim(),
  };
}

async function wrPageNotebooks(apiKey) {
  const books = [];
  let lastSort = null;
  for (let i = 0; i < 50; i++) {
    const params = { count: 100, ...(lastSort ? { lastSort } : {}) };
    const payload = await wrCall(apiKey, "/user/notebooks", params);
    const page = (payload.books || []).filter((b) => b && typeof b === "object");
    books.push(...page);
    if (!payload.hasMore || !page.length) break;
    const next = Number(page[page.length - 1]?.sort) || 0;
    if (!next) break;
    lastSort = next;
  }
  return books;
}

async function wrPageReviews(apiKey, bookId) {
  const reviews = [];
  let synckey = 0;
  for (let i = 0; i < 50; i++) {
    const payload = await wrCall(apiKey, "/review/list/mine", { bookid: bookId, count: 100, synckey });
    const page = (payload.reviews || []).filter((r) => r && typeof r === "object");
    reviews.push(...page);
    if (!payload.hasMore || !page.length) break;
    const next = Number(payload.synckey) || 0;
    if (next === synckey) break;
    synckey = next;
  }
  return reviews;
}

async function wrFetchProgress(apiKey, book) {
  const bookId = String(book.bookId || "").trim();
  if (!bookId) return {};
  try { return await wrCall(apiKey, "/book/getprogress", { bookId }); } catch { return {}; }
}

async function wrFetchNotes(apiKey, notebookBook) {
  const bookId = String(notebookBook.bookId || "").trim();
  const meta = notebookBook.book && typeof notebookBook.book === "object" ? notebookBook.book : {};
  const bookTitle = meta.title || notebookBook.title || bookId;
  if (!bookId) return [];
  try {
    const [bmPayload, reviewItems] = await Promise.all([
      wrCall(apiKey, "/book/bookmarklist", { bookId }),
      wrPageReviews(apiKey, bookId),
    ]);
    const chapterTitles = {};
    for (const ch of bmPayload.chapters || []) {
      if (ch && typeof ch === "object")
        chapterTitles[Number(ch.chapterUid) || 0] = String(ch.title || "").trim();
    }
    const notes = [];
    const seen = new Set();
    for (const item of bmPayload.updated || []) {
      if (!item || typeof item !== "object") continue;
      const n = await wrNormalizeHighlight(bookTitle, bookId, item, chapterTitles);
      if (!n || seen.has(n.sourceItemId)) continue;
      seen.add(n.sourceItemId);
      notes.push(n);
    }
    for (const item of reviewItems) {
      if (!item || typeof item !== "object") continue;
      const n = await wrNormalizeReview(bookTitle, bookId, item);
      if (!n || seen.has(n.sourceItemId)) continue;
      seen.add(n.sourceItemId);
      notes.push(n);
    }
    return notes.sort((a, b) => (b.sourceUpdatedTimestamp || 0) - (a.sourceUpdatedTimestamp || 0));
  } catch (e) {
    console.error(`[weread-cron] 笔记获取失败 ${bookId}：${e}`);
    return [];
  }
}

async function runBatched(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = await Promise.all(items.slice(i, i + batchSize).map(fn));
    results.push(...batch);
  }
  return results;
}

async function wrFetchStats(apiKey, cachedMonthly = null) {
  const now = Math.floor(Date.now() / 1000);

  // 当月数据 activity check 已拿过直接复用；overall 拿累计天数
  const monthly = cachedMonthly || await wrCall(apiKey, "/readdata/detail", { mode: "monthly" }).catch(() => ({}));
  const overall  = await wrCall(apiKey, "/readdata/detail", { mode: "overall" }).catch(() => ({}));

  // 热力图：当月 + 前 4 个月，共 5 个月的每日数据（mode=annually 只返回月粒度，不能用）
  // 每次 monthly 调用 1 个 subrequest，当前月复用，共 4 次额外请求
  const prevMonthlyList = [];
  for (let i = 1; i <= 4; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    d.setDate(15); // 取月中避免边界问题
    const baseTime = Math.floor(d.getTime() / 1000);
    const data = await wrCall(apiKey, "/readdata/detail", { mode: "monthly", baseTime }).catch(() => null);
    if (data) prevMonthlyList.push(data);
  }

  const dailyMap = {};
  for (const m of [monthly, ...prevMonthlyList]) {
    for (const [ts, secs] of Object.entries(m?.readTimes || {})) {
      const t = Number(ts);
      if (!t) continue;
      const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" })
        .format(new Date(t > 1e11 ? t : t * 1000));
      dailyMap[dateKey] = (dailyMap[dateKey] || 0) + Math.max(0, Number(secs) || 0);
    }
  }
  const dailyReadTimes = Object.entries(dailyMap)
    .map(([date, seconds]) => ({
      date,
      timestamp: Math.floor(new Date(`${date}T00:00:00+08:00`).getTime() / 1000),
      seconds,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 小程序阅读环：当月每日分钟数
  const weekReadDaily = {};
  for (const [ts, secs] of Object.entries(monthly.readTimes || {})) {
    const mins = Math.round(Number(secs) / 60);
    if (mins > 0) weekReadDaily[ts] = mins;
  }
  const weekReadMinutes = Object.values(weekReadDaily).reduce((a, b) => a + b, 0);
  const totalReadDays   = Number(overall.readDays || monthly.readDays || 0);
  const syncedAt = new Date().toISOString();

  return {
    wereadStats: {
      monthly: {
        readDays:           Number(monthly.readDays           || 0),
        totalReadTime:      Number(monthly.totalReadTime      || 0),
        dayAverageReadTime: Number(monthly.dayAverageReadTime || 0),
        baseTime: now,
      },
      annual: {
        readDays:           Number(overall.readDays           || 0),
        totalReadTime:      Number(overall.totalReadTime      || 0),
        dayAverageReadTime: Number(overall.dayAverageReadTime || 0),
        baseTime: now,
      },
      overall: {
        readDays:           Number(overall.readDays           || 0),
        totalReadTime:      Number(overall.totalReadTime      || 0),
        dayAverageReadTime: Number(overall.dayAverageReadTime || 0),
        baseTime: 0,
      },
      dailyReadTimes,
    },
    weekReadDaily,
    weekReadMinutes,
    totalReadDays,
    wereadSyncedAt: syncedAt,
    time: {
      weread: buildWereadTimeData({
        monthly,
        annual: overall,
        overall,
        dailyReadTimes,
      }, syncedAt),
    },
  };
}

async function wrActivityChanged(apiKey, kv) {
  const snapshotRaw = await kv.get("weread_activity_snapshot");
  let snapshot = null;
  try { snapshot = snapshotRaw ? JSON.parse(snapshotRaw) : null; } catch { /* ignore */ }

  const monthly = await wrCall(apiKey, "/readdata/detail", { mode: "monthly" }).catch(() => null);
  if (!monthly) return true; // 拉不到就保守地认为有变化

  const curTime = Number(monthly.totalReadTime || 0);
  const curDays = Number(monthly.readDays || 0);
  if (!snapshot || curTime !== snapshot.monthlyReadTime || curDays !== snapshot.monthlyReadDays) {
    return { changed: true, monthly };
  }
  return { changed: false };
}

function mergeDailyReadTimes(existing = [], incoming = []) {
  const map = new Map();
  for (const item of existing) if (item?.date) map.set(item.date, item);
  for (const item of incoming) if (item?.date) map.set(item.date, item);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function syncWeRead(env, options = {}) {
  const apiKey = String(env.WEREAD_API_KEY || "").trim();
  if (!apiKey) { console.log("[weread-cron] 跳过：未配置 WEREAD_API_KEY"); return; }

  const force = Boolean(options.force);
  const activityCheck = force
    ? { changed: true, monthly: await wrCall(apiKey, "/readdata/detail", { mode: "monthly" }).catch(() => null) }
    : await wrActivityChanged(apiKey, env.TASKS_KV).catch(() => ({ changed: true }));
  if (!activityCheck.changed) {
    console.log("[weread-cron] 跳过：本月阅读数据无变化");
    return;
  }

  console.log(force ? "[weread-cron] 手动强制同步..." : "[weread-cron] 检测到新活动，开始同步...");
  const [shelf, allNotebookBooks] = await Promise.all([
    wrCall(apiKey, "/shelf/sync"),
    wrPageNotebooks(apiKey),
  ]);
  // 每本笔记 2 个 subrequest（bookmarklist + review），Free 计划上限 50，最多取 20 本
  const notebookBooks = allNotebookBooks.slice(0, 20);

  const rawBooks = (shelf.books || []).filter((b) => b && typeof b === "object");
  console.log(`[weread-cron] 书架 ${rawBooks.length} 本，笔记本 ${notebookBooks.length} 本`);

  // 现有数据：保留已有阅读进度（不再单独调 progress API，节省 subrequest 给热力图）
  const existing = await loadData(env.TASKS_KV);
  const existingProgressMap = Object.fromEntries(
    (existing.books || []).filter(b => b?.source === "weread")
      .map(b => [String(b._bookId || b.id || ""), b.progressPercent || 0])
  );

  const books = rawBooks
    .map((b) => {
      const bookId = String(b.bookId || "").trim();
      const book = wrNormalizeBook(b, {});
      // 保留历史进度，不用 progress API
      const kept = existingProgressMap[bookId] || 0;
      return kept > 0 ? { ...book, progressPercent: kept } : book;
    })
    .sort((a, b) => (b.readTimestamp || 0) - (a.readTimestamp || 0));

  const noteLists = await runBatched(notebookBooks, 4, (b) => wrFetchNotes(apiKey, b));
  const allNotes = noteLists
    .flat()
    .sort((a, b) => (b.sourceUpdatedTimestamp || 0) - (a.sourceUpdatedTimestamp || 0));

  console.log(`[weread-cron] 同步完成：books=${books.length} notes=${allNotes.length}`);

  const stats = await wrFetchStats(apiKey, activityCheck.monthly).catch((e) => {
    console.error(`[weread-cron] 阅读统计获取失败：${e}`);
    return null;
  });
  if (stats) {
    stats.wereadStats.dailyReadTimes = mergeDailyReadTimes(
      existing.wereadStats?.dailyReadTimes,
      stats.wereadStats.dailyReadTimes,
    );
  }
  await saveData(env.TASKS_KV, {
    tasks:   (existing.tasks  || []).filter((t) => t && typeof t === "object"),
    books:   [...(existing.books  || []).filter((b) => b?.source !== "weread"), ...books],
    notes:   [...(existing.notes  || []).filter((n) => n?.source !== "weread"), ...allNotes],
    updates: (existing.updates || []).filter((u) => u?.type !== "weread"),
    ...(stats ?? {
      wereadStats:     existing.wereadStats,
      weekReadMinutes: existing.weekReadMinutes,
      weekReadDaily:   existing.weekReadDaily,
      totalReadDays:   existing.totalReadDays,
      wereadSyncedAt:  existing.wereadSyncedAt,
    }),
  });

  if (stats) {
    await env.TASKS_KV.put("weread_activity_snapshot", JSON.stringify({
      monthlyReadTime: stats.wereadStats.monthly.totalReadTime,
      monthlyReadDays: stats.wereadStats.monthly.readDays,
    }));
  }
  console.log(`[weread-cron] ✅ 已写入 KV${stats ? `（热力图 ${stats.wereadStats.dailyReadTimes.length} 天，本月 ${stats.weekReadMinutes} 分钟）` : "（统计跳过）"}`);
}

// ─────────────────────────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([runDailyReset(env), syncWeRead(env)]));
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

      if (path === "/api/weread/status" && request.method === "GET") {
        return json({ syncAvailable: false, message: "线上版暂不支持直接调用本机微信读书 API Key，请先在本地版同步后再把数据上传到云端。" });
      }

      if (path === "/api/weread/sync" && request.method === "POST") {
        if (!isPersonalAuthorized(request, env))
          return json({ error: "unauthorized" }, 401);
        try {
          await syncWeRead(env, { force: true });
          const data = await loadData(env.TASKS_KV);
          return json({ ok: true, dailyReadTimesCount: data.wereadStats?.dailyReadTimes?.length ?? 0, totalReadDays: data.totalReadDays ?? 0 });
        } catch (e) {
          return json({ error: String(e) }, 500);
        }
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "服务器内部错误" }, 500);
    }
  },
};
