import DASHBOARD_HTML from '../dashboard.html';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const PERSONAL_ROUTE_PREFIX = "/tasks";
const CLOUD_ROUTE_PREFIX = "/tasks-cloud";
const CLOUD_WEREAD_MESSAGE = "云端版暂不支持直接抓取微信读书 Cookie，请先在本地版同步后再把数据上传到云端。";
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

function normalizeAppData(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  return {
    tasks: normalizeArrayItems(data.tasks),
    books: normalizeArrayItems(data.books),
    notes: normalizeArrayItems(data.notes),
    updates: normalizeArrayItems(data.updates),
  };
}

function normalizeDiaryData(payload) {
  const diary = payload && typeof payload === "object" ? payload : {};
  const today = diary.today && typeof diary.today === "object" ? diary.today : {};
  const archive = Array.isArray(diary.archive)
    ? diary.archive.filter((entry) => entry && typeof entry === "object" && entry.date)
    : [];
  return {
    today: {
      date: String(today.date || ""),
      content: String(today.content || ""),
    },
    archive: archive.map((entry) => ({
      date: String(entry.date || ""),
      content: String(entry.content || ""),
    })),
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

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyReset(env));
  },

  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const route = resolveRoute(url.pathname);
      if (!route) return json({ error: "not found" }, 404);
      const { mode, path } = route;
      const cloudEnabled = Boolean(env.AUTH_DB);

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
              if (entry?.date) archiveMap[entry.date] = entry;
            }
            for (const entry of body.archive || []) {
              if (!entry?.date) continue;
              if (!archiveMap[entry.date] || entry.content.length > String(archiveMap[entry.date].content || "").length) {
                archiveMap[entry.date] = entry;
              }
            }
            body.archive = Object.values(archiveMap).sort((a, b) => (a.date < b.date ? -1 : 1));
            await saveDiary(env.TASKS_KV, auth.userId, body);
            return json({ ok: true });
          }

          if (path === "/api/weread/status" && request.method === "GET") {
            return json({ syncAvailable: false, cloudMode: true, message: CLOUD_WEREAD_MESSAGE });
          }

          if (
            (path === "/api/weread/sync" || path === "/api/weread/extension-sync" || path === "/api/weread/import-cookie")
            && request.method === "POST"
          ) {
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
          if (entry?.date) archiveMap[entry.date] = entry;
        }
        for (const entry of body.archive || []) {
          if (!entry?.date) continue;
          if (!archiveMap[entry.date] || entry.content.length > String(archiveMap[entry.date].content || "").length) {
            archiveMap[entry.date] = entry;
          }
        }
        body.archive = Object.values(archiveMap).sort((a, b) => (a.date < b.date ? -1 : 1));
        await saveSharedDiary(env.TASKS_KV, body);
        return json({ ok: true });
      }

      if (path === "/api/weread/status" && request.method === "GET") {
        return json({ syncAvailable: false, cloudMode: true, message: CLOUD_WEREAD_MESSAGE });
      }

      if (
        (path === "/api/weread/sync" || path === "/api/weread/extension-sync" || path === "/api/weread/import-cookie")
        && request.method === "POST"
      ) {
        return json({ error: CLOUD_WEREAD_MESSAGE, cloudMode: true }, 501);
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "服务器内部错误" }, 500);
    }
  },
};
