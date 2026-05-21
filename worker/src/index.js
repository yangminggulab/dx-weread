import DASHBOARD_HTML from '../../web/dashboard.html';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const PERSONAL_ROUTE_PREFIX = "/tasks";
const CLOUD_ROUTE_PREFIX = "/tasks-cloud";
// 多用户云端版暂不使用：保留相关代码，入口强制关闭，避免误把小程序/网页切到登录态数据。
const MULTIUSER_CLOUD_ENABLED = false;
const CLOUD_WEREAD_MESSAGE = "云端版暂不支持直接调用本机微信读书 API Key，请先在本地版同步后再把数据上传到云端。";
const EMPTY_APP_DATA = { tasks: [], books: [], notes: [], updates: [] };
const EMPTY_DIARY_DATA = { today: { date: "", content: "" }, archive: [] };
const TEXT_ENCODER = new TextEncoder();
const PASSWORD_ITERATIONS = 120000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const CLOUD_DISABLED_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>云端版暂未启用</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; background: #f7f5f0; color: #1f1c17; }
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { max-width: 560px; background: white; border: 1px solid #e8e4dc; border-radius: 24px; padding: 32px; box-shadow: 0 20px 60px rgba(60, 43, 16, 0.08); }
    .tag { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #f0f4f1; color: #2d6a4f; font-size: 12px; }
    h1 { font-size: 28px; margin: 16px 0 10px; }
    p { color: #6c6358; line-height: 1.8; margin: 0 0 12px; }
    a { color: #2d6a4f; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <span class="tag">云端版</span>
      <h1>云端多用户版暂未启用</h1>
      <p>个人版仍然可以继续使用，新的多用户云端入口代码已经准备好，但当前这台 Worker 还没有接入 D1 账号数据库。</p>
      <p>等你准备启用时，再把 D1 绑定加回 Wrangler 并执行迁移即可。</p>
      <p><a href="/tasks">返回个人版</a></p>
    </div>
  </div>
</body>
</html>`;

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

function dataKeyForUser(userId) {
  return `user:${userId}:app_data`;
}

function diaryKeyForUser(userId) {
  return `user:${userId}:diary_data`;
}

function resetKeyForUser(userId) {
  return `user:${userId}:daily_reset_date`;
}

function normalizeArrayItems(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function normalizeWereadStats(stats) {
  if (!stats || typeof stats !== "object") return { monthly: {}, annual: {}, dailyReadTimes: [] };
  const daily = Array.isArray(stats.dailyReadTimes)
    ? stats.dailyReadTimes.filter(item => item && item.date && typeof item.seconds === "number")
    : [];
  return { monthly: stats.monthly || {}, annual: stats.annual || {}, dailyReadTimes: daily };
}

function normalizeAppData(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const result = {
    tasks:   normalizeArrayItems(data.tasks),
    books:   normalizeArrayItems(data.books),
    notes:   normalizeArrayItems(data.notes),
    updates: normalizeArrayItems(data.updates),
  };
  if (data.wereadStats)             result.wereadStats      = normalizeWereadStats(data.wereadStats);
  if (data.weekReadDaily)           result.weekReadDaily    = data.weekReadDaily;
  if (data.weekReadMinutes != null) result.weekReadMinutes  = data.weekReadMinutes;
  if (data.totalReadDays   != null) result.totalReadDays    = data.totalReadDays;
  if (data.wereadSyncedAt)          result.wereadSyncedAt   = data.wereadSyncedAt;
  return result;
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
    },
    archive,
  };
}

async function getLegacySeededRaw(kv, userId, legacyKey, nextKey) {
  const ownRaw = await kv.get(nextKey);
  if (ownRaw) return ownRaw;
  if (Number(userId) !== 1) return null;
  const legacyRaw = await kv.get(legacyKey);
  if (!legacyRaw) return null;
  await kv.put(nextKey, legacyRaw);
  return legacyRaw;
}

async function loadData(kv, userId) {
  const raw = await getLegacySeededRaw(kv, userId, "app_data", dataKeyForUser(userId));
  if (!raw) return { ...EMPTY_APP_DATA };
  try {
    return normalizeAppData(JSON.parse(raw));
  } catch {
    return { ...EMPTY_APP_DATA };
  }
}

async function saveData(kv, userId, data) {
  await kv.put(dataKeyForUser(userId), JSON.stringify(normalizeAppData(data)));
}

async function loadDiary(kv, userId) {
  const raw = await getLegacySeededRaw(kv, userId, "diary_data", diaryKeyForUser(userId));
  if (!raw) return { ...EMPTY_DIARY_DATA };
  try {
    return normalizeDiaryData(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DIARY_DATA };
  }
}

async function saveDiary(kv, userId, diary) {
  await kv.put(diaryKeyForUser(userId), JSON.stringify(normalizeDiaryData(diary)));
}

async function loadSharedData(kv) {
  const raw = await kv.get("app_data");
  if (!raw) return { ...EMPTY_APP_DATA };
  try {
    return normalizeAppData(JSON.parse(raw));
  } catch {
    return { ...EMPTY_APP_DATA };
  }
}

async function saveSharedData(kv, data) {
  await kv.put("app_data", JSON.stringify(normalizeAppData(data)));
}

async function loadSharedDiary(kv) {
  const raw = await kv.get("diary_data");
  if (!raw) return { ...EMPTY_DIARY_DATA };
  try {
    return normalizeDiaryData(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DIARY_DATA };
  }
}

async function saveSharedDiary(kv, diary) {
  await kv.put("diary_data", JSON.stringify(normalizeDiaryData(diary)));
}

function isPersonalAuthorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return Boolean(token) && token === env.API_TOKEN;
}

function resolveRoute(pathname) {
  if (pathname === PERSONAL_ROUTE_PREFIX || pathname.startsWith(`${PERSONAL_ROUTE_PREFIX}/`)) {
    return {
      mode: "personal",
      path: pathname.replace(/^\/tasks(?=\/|$)/, "") || "/",
    };
  }
  if (pathname === CLOUD_ROUTE_PREFIX || pathname.startsWith(`${CLOUD_ROUTE_PREFIX}/`)) {
    return {
      mode: "cloud",
      path: pathname.replace(/^\/tasks-cloud(?=\/|$)/, "") || "/",
    };
  }
  return null;
}

function constantTimeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(bytes = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(String(value || "")));
  return bytesToHex(new Uint8Array(digest));
}

async function hashPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: TEXT_ENCODER.encode(salt),
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function getAuthDb(env) {
  if (!env.AUTH_DB) {
    throw new Error("缺少 AUTH_DB 绑定，请先在 Wrangler 里配置 D1 数据库。");
  }
  return env.AUTH_DB;
}

function presentUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id || row.user_id || row.userId || 0),
    username: String(row.username || ""),
    email: String(row.email || ""),
    createdAt: String(row.created_at || row.createdAt || ""),
  };
}

async function findUserByIdentifier(env, identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return null;
  const db = getAuthDb(env);
  return db
    .prepare(
      `SELECT id, username, email, password_hash, salt, created_at
       FROM users
       WHERE username_normalized = ? OR email_normalized = ?
       LIMIT 1`,
    )
    .bind(normalized, normalized)
    .first();
}

async function createSession(env, userId) {
  const db = getAuthDb(env);
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO sessions (user_id, token_hash, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(userId, tokenHash, now, expiresAt, now)
    .run();
  return { token, expiresAt };
}

async function getAuthContext(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const db = getAuthDb(env);
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT
         sessions.id AS session_id,
         sessions.user_id AS user_id,
         sessions.expires_at AS expires_at,
         users.id AS id,
         users.username AS username,
         users.email AS email,
         users.created_at AS created_at
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first();

  if (!row) return null;

  if (Date.parse(String(row.expires_at || "")) <= Date.now()) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(row.session_id).run();
    return null;
  }

  return {
    token,
    sessionId: Number(row.session_id || 0),
    userId: Number(row.user_id || 0),
    user: presentUser(row),
  };
}

async function requireAuth(request, env) {
  const auth = await getAuthContext(request, env);
  if (!auth) {
    return { error: json({ error: "请先登录" }, 401) };
  }
  return { auth };
}

async function cleanupExpiredSessions(env) {
  if (!env.AUTH_DB) return;
  const db = getAuthDb(env);
  await db
    .prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();
}

async function dailyResetShared(kv) {
  const today = todayInShanghai();
  const lastRun = await kv.get("daily_reset_date");
  if (lastRun === today) return { skipped: true };

  const diary = await loadSharedDiary(kv);
  const todayEntry = diary.today || {};
  if (todayEntry.content && (!todayEntry.date || todayEntry.date !== today)) {
    const yesterday = new Date(nowInShanghai());
    yesterday.setDate(yesterday.getDate() - 1);
    const archiveDate = todayEntry.date || yesterday.toISOString().slice(0, 10);
    diary.archive = [{ ...todayEntry, date: archiveDate }, ...(diary.archive || [])];
    diary.today = { date: today, content: "" };
    await saveSharedDiary(kv, diary);
  }

  const data = await loadSharedData(kv);
  data.tasks = (data.tasks || []).filter((task) => task.status !== "completed");
  await saveSharedData(kv, data);
  await kv.put("daily_reset_date", today);
  return { ok: true };
}

async function dailyResetForUser(kv, userId) {
  const today = todayInShanghai();
  const lastRun = await kv.get(resetKeyForUser(userId));
  if (lastRun === today) return { skipped: true };

  const diary = await loadDiary(kv, userId);
  const todayEntry = diary.today || {};
  if (todayEntry.content && (!todayEntry.date || todayEntry.date !== today)) {
    const yesterday = new Date(nowInShanghai());
    yesterday.setDate(yesterday.getDate() - 1);
    const archiveDate = todayEntry.date || yesterday.toISOString().slice(0, 10);
    diary.archive = [{ ...todayEntry, date: archiveDate }, ...(diary.archive || [])];
    diary.today = { date: today, content: "" };
    await saveDiary(kv, userId, diary);
  }

  const data = await loadData(kv, userId);
  data.tasks = (data.tasks || []).filter((task) => task.status !== "completed");
  await saveData(kv, userId, data);
  await kv.put(resetKeyForUser(userId), today);
  return { ok: true };
}

async function runDailyReset(env) {
  await dailyResetShared(env.TASKS_KV);
  if (!env.AUTH_DB) return;
  const db = getAuthDb(env);
  const rows = await db.prepare("SELECT id FROM users").all();
  const users = Array.isArray(rows.results) ? rows.results : [];
  await Promise.all(users.map((row) => dailyResetForUser(env.TASKS_KV, row.id)));
  await cleanupExpiredSessions(env);
}

function validateRegisterPayload(body) {
  const username = String(body?.username || "").trim();
  const email = String(body?.email || "").trim();
  const password = String(body?.password || "");

  if (username.length < 2 || username.length > 30) {
    return { error: "用户名长度需要在 2 到 30 个字符之间" };
  }
  if (!/^[\w\u4e00-\u9fa5-]+$/i.test(username)) {
    return { error: "用户名只能包含中文、字母、数字、下划线和短横线" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "请输入有效邮箱" };
  }
  if (password.length < 8) {
    return { error: "密码至少需要 8 位" };
  }

  return { username, email, password };
}

function validateLoginPayload(body) {
  const identifier = String(body?.identifier || body?.email || body?.username || "").trim();
  const password = String(body?.password || "");
  if (!identifier) return { error: "请输入用户名或邮箱" };
  if (!password) return { error: "请输入密码" };
  return { identifier, password };
}

async function handleRegister(request, env) {
  const body = await request.json().catch(() => ({}));
  const parsed = validateRegisterPayload(body);
  if (parsed.error) return json({ error: parsed.error }, 400);

  const db = getAuthDb(env);
  const existing = await findUserByIdentifier(env, parsed.username)
    || await findUserByIdentifier(env, parsed.email);
  if (existing) {
    return json({ error: "用户名或邮箱已存在" }, 409);
  }

  const now = new Date().toISOString();
  const salt = randomToken(16);
  const passwordHash = await hashPassword(parsed.password, salt);
  const insert = await db
    .prepare(
      `INSERT INTO users (
         username,
         username_normalized,
         email,
         email_normalized,
         password_hash,
         salt,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      parsed.username,
      normalizeIdentifier(parsed.username),
      parsed.email,
      normalizeIdentifier(parsed.email),
      passwordHash,
      salt,
      now,
    )
    .run();

  const userId = Number(insert.meta.last_row_id);
  const session = await createSession(env, userId);
  return json({
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    user: {
      id: userId,
      username: parsed.username,
      email: parsed.email,
      createdAt: now,
    },
  }, 201);
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const parsed = validateLoginPayload(body);
  if (parsed.error) return json({ error: parsed.error }, 400);

  const user = await findUserByIdentifier(env, parsed.identifier);
  if (!user) return json({ error: "用户名、邮箱或密码不正确" }, 401);

  const passwordHash = await hashPassword(parsed.password, user.salt);
  if (!constantTimeEqual(passwordHash, user.password_hash)) {
    return json({ error: "用户名、邮箱或密码不正确" }, 401);
  }

  const session = await createSession(env, user.id);
  return json({
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    user: presentUser(user),
  });
}

async function handleLogout(request, env) {
  const auth = await getAuthContext(request, env);
  if (!auth) return json({ ok: true });
  await getAuthDb(env).prepare("DELETE FROM sessions WHERE id = ?").bind(auth.sessionId).run();
  return json({ ok: true });
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
      dailyReadTimes,
    },
    weekReadDaily,
    weekReadMinutes,
    totalReadDays,
    wereadSyncedAt: new Date().toISOString(),
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

async function syncWeRead(env) {
  const apiKey = String(env.WEREAD_API_KEY || "").trim();
  if (!apiKey) { console.log("[weread-cron] 跳过：未配置 WEREAD_API_KEY"); return; }

  const activityCheck = await wrActivityChanged(apiKey, env.TASKS_KV).catch(() => ({ changed: true }));
  if (!activityCheck.changed) {
    console.log("[weread-cron] 跳过：本月阅读数据无变化");
    return;
  }

  console.log("[weread-cron] 检测到新活动，开始同步...");
  const [shelf, allNotebookBooks] = await Promise.all([
    wrCall(apiKey, "/shelf/sync"),
    wrPageNotebooks(apiKey),
  ]);
  // 每本笔记 2 个 subrequest（bookmarklist + review），Free 计划上限 50，最多取 20 本
  const notebookBooks = allNotebookBooks.slice(0, 20);

  const rawBooks = (shelf.books || []).filter((b) => b && typeof b === "object");
  console.log(`[weread-cron] 书架 ${rawBooks.length} 本，笔记本 ${notebookBooks.length} 本`);

  // 跳过单本 progress API（每本 1 个 subrequest，Free 计划上限 50 不够用）
  const books = rawBooks
    .map((b) => wrNormalizeBook(b, {}))
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

  const existing = await loadSharedData(env.TASKS_KV);
  await saveSharedData(env.TASKS_KV, {
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
      const route = resolveRoute(url.pathname);
      if (!route) return json({ error: "not found" }, 404);
      const { mode, path } = route;
      const cloudEnabled = MULTIUSER_CLOUD_ENABLED && Boolean(env.AUTH_DB);

      if (request.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
      }

      if (path === "/" || path === "/index.html" || path === "/dashboard.html") {
        if (mode === "cloud" && !cloudEnabled) {
          return new Response(CLOUD_DISABLED_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        return new Response(DASHBOARD_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (mode === "cloud") {
        if (!cloudEnabled) {
          return json({ error: "云端多用户版暂未启用" }, 503);
        }

        if (path === "/api/register" && request.method === "POST") {
          return handleRegister(request, env);
        }

        if (path === "/api/login" && request.method === "POST") {
          return handleLogin(request, env);
        }

        if (path === "/api/logout" && request.method === "POST") {
          return handleLogout(request, env);
        }

        if (path === "/api/me" && request.method === "GET") {
          const { auth, error } = await requireAuth(request, env);
          if (error) return error;
          return json({ ok: true, user: auth.user });
        }

        if (path.startsWith("/api/")) {
          const { auth, error } = await requireAuth(request, env);
          if (error) return error;

          if (path === "/api/data" && request.method === "GET") {
            return json(await loadData(env.TASKS_KV, auth.userId));
          }

          if (path === "/api/data" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            await saveData(env.TASKS_KV, auth.userId, body);
            return json({ ok: true });
          }

          if (path === "/api/tasks/add" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const data = await loadData(env.TASKS_KV, auth.userId);
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
            await saveData(env.TASKS_KV, auth.userId, data);
            return json({ ok: true, task });
          }

          if (path === "/api/tasks/update" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const data = await loadData(env.TASKS_KV, auth.userId);
            const idx = data.tasks.findIndex((task) => task.id === body.id);
            if (idx === -1) return json({ ok: false, error: "not found" }, 404);
            data.tasks[idx] = { ...data.tasks[idx], ...body };
            await saveData(env.TASKS_KV, auth.userId, data);
            return json({ ok: true, task: data.tasks[idx] });
          }

          if (path === "/api/tasks/delete" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const data = await loadData(env.TASKS_KV, auth.userId);
            data.tasks = data.tasks.filter((task) => task.id !== body.id);
            await saveData(env.TASKS_KV, auth.userId, data);
            return json({ ok: true });
          }

          if (path === "/api/notes/add" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const data = await loadData(env.TASKS_KV, auth.userId);
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
            await saveData(env.TASKS_KV, auth.userId, data);
            return json({ ok: true, note });
          }

          if (path === "/api/notes/delete" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const data = await loadData(env.TASKS_KV, auth.userId);
            data.notes = data.notes.filter((note) => note.id !== body.id);
            await saveData(env.TASKS_KV, auth.userId, data);
            return json({ ok: true });
          }

          if (path === "/api/notes/update" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const data = await loadData(env.TASKS_KV, auth.userId);
            const idx = data.notes.findIndex((note) => note.id === body.id);
            if (idx === -1) return json({ ok: false, error: "not found" }, 404);
            data.notes[idx] = {
              ...data.notes[idx],
              title: body.title ?? data.notes[idx].title,
              summary: body.summary ?? data.notes[idx].summary,
              tags: body.tags ?? data.notes[idx].tags,
              updatedAt: todayInShanghai(),
            };
            await saveData(env.TASKS_KV, auth.userId, data);
            return json({ ok: true, note: data.notes[idx] });
          }

          if (path === "/api/diary" && request.method === "GET") {
            const diary = await loadDiary(env.TASKS_KV, auth.userId);
            if (url.searchParams.get("today") === "1") {
              return json({ today: diary.today || { date: "", content: "" }, archive: [] });
            }
            return json(diary);
          }

          if (path === "/api/diary" && request.method === "POST") {
            const body = normalizeDiaryData(await request.json().catch(() => ({})));
            const incoming = body.today || {};
            const stored = await loadDiary(env.TASKS_KV, auth.userId);
            const storedToday = stored.today || {};
            if (
              storedToday.date === incoming.date
              && storedToday.content?.trim()
              && !incoming.content?.trim()
            ) {
              return json({ ok: true, skipped: true });
            }

            const archiveMap = {};
            for (const entry of stored.archive || []) {
              const normalized = normalizeDiaryArchiveEntry(entry);
              if (normalized?.date) archiveMap[normalized.date] = normalized;
            }
            for (const entry of body.archive || []) {
              const normalized = normalizeDiaryArchiveEntry(entry);
              if (!normalized?.date) continue;
              archiveMap[normalized.date] = mergeDiaryArchiveEntries(
                archiveMap[normalized.date],
                normalized,
              );
            }
            body.archive = Object.values(archiveMap).sort((a, b) => (a.date < b.date ? -1 : 1));
            await saveDiary(env.TASKS_KV, auth.userId, body);
            return json({ ok: true });
          }

          if (path === "/api/weread/status" && request.method === "GET") {
            return json({ syncAvailable: false, cloudMode: true, message: CLOUD_WEREAD_MESSAGE });
          }

          if (path === "/api/weread/sync" && request.method === "POST") {
            return json({ error: CLOUD_WEREAD_MESSAGE, cloudMode: true }, 501);
          }
        }

        return json({ error: "not found" }, 404);
      }

      const isWriteApi = path.startsWith("/api/") && request.method !== "GET" && request.method !== "OPTIONS";
      if (isWriteApi && !isPersonalAuthorized(request, env)) {
        return json({ error: "Unauthorized" }, 401);
      }

      if (path === "/api/data" && request.method === "GET") {
        return json(await loadSharedData(env.TASKS_KV));
      }

      if (path === "/api/data" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        await saveSharedData(env.TASKS_KV, body);
        return json({ ok: true });
      }

      if (path === "/api/tasks/add" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadSharedData(env.TASKS_KV);
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
        await saveSharedData(env.TASKS_KV, data);
        return json({ ok: true, task });
      }

      if (path === "/api/tasks/update" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadSharedData(env.TASKS_KV);
        const idx = data.tasks.findIndex((task) => task.id === body.id);
        if (idx === -1) return json({ ok: false, error: "not found" }, 404);
        data.tasks[idx] = { ...data.tasks[idx], ...body };
        await saveSharedData(env.TASKS_KV, data);
        return json({ ok: true, task: data.tasks[idx] });
      }

      if (path === "/api/tasks/delete" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadSharedData(env.TASKS_KV);
        data.tasks = data.tasks.filter((task) => task.id !== body.id);
        await saveSharedData(env.TASKS_KV, data);
        return json({ ok: true });
      }

      if (path === "/api/notes/add" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadSharedData(env.TASKS_KV);
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
        await saveSharedData(env.TASKS_KV, data);
        return json({ ok: true, note });
      }

      if (path === "/api/notes/delete" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadSharedData(env.TASKS_KV);
        data.notes = data.notes.filter((note) => note.id !== body.id);
        await saveSharedData(env.TASKS_KV, data);
        return json({ ok: true });
      }

      if (path === "/api/notes/update" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const data = await loadSharedData(env.TASKS_KV);
        const idx = data.notes.findIndex((note) => note.id === body.id);
        if (idx === -1) return json({ ok: false, error: "not found" }, 404);
        data.notes[idx] = {
          ...data.notes[idx],
          title: body.title ?? data.notes[idx].title,
          summary: body.summary ?? data.notes[idx].summary,
          tags: body.tags ?? data.notes[idx].tags,
          updatedAt: todayInShanghai(),
        };
        await saveSharedData(env.TASKS_KV, data);
        return json({ ok: true, note: data.notes[idx] });
      }

      if (path === "/api/diary" && request.method === "GET") {
        const diary = await loadSharedDiary(env.TASKS_KV);
        if (url.searchParams.get("today") === "1") {
          return json({ today: diary.today || { date: "", content: "" }, archive: [] });
        }
        return json(diary);
      }

      if (path === "/api/diary" && request.method === "POST") {
        const body = normalizeDiaryData(await request.json().catch(() => ({})));
        const incoming = body.today || {};
        const stored = await loadSharedDiary(env.TASKS_KV);
        const storedToday = stored.today || {};
        if (
          storedToday.date === incoming.date
          && storedToday.content?.trim()
          && !incoming.content?.trim()
        ) {
          return json({ ok: true, skipped: true });
        }

        const archiveMap = {};
        for (const entry of stored.archive || []) {
          const normalized = normalizeDiaryArchiveEntry(entry);
          if (normalized?.date) archiveMap[normalized.date] = normalized;
        }
        for (const entry of body.archive || []) {
          const normalized = normalizeDiaryArchiveEntry(entry);
          if (!normalized?.date) continue;
          archiveMap[normalized.date] = mergeDiaryArchiveEntries(
            archiveMap[normalized.date],
            normalized,
          );
        }
        body.archive = Object.values(archiveMap).sort((a, b) => (a.date < b.date ? -1 : 1));
        await saveSharedDiary(env.TASKS_KV, body);
        return json({ ok: true });
      }

      if (path === "/api/weread/status" && request.method === "GET") {
        return json({ syncAvailable: false, cloudMode: true, message: CLOUD_WEREAD_MESSAGE });
      }

      if (path === "/api/weread/sync" && request.method === "POST") {
        if (!isPersonalAuthorized(request, env))
          return json({ error: "unauthorized" }, 401);
        try {
          await syncWeRead(env);
          const data = await loadSharedData(env.TASKS_KV);
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
