import DASHBOARD_HTML from '../dashboard.html';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const CLOUD_WEREAD_MESSAGE = "云端版暂不支持直接抓取微信读书 Cookie，请先在本地版同步后再把数据上传到云端。";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function loadData(kv) {
  const raw = await kv.get("app_data");
  if (!raw) return { tasks: [], books: [], notes: [], updates: [] };
  try { return JSON.parse(raw); }
  catch { return { tasks: [], books: [], notes: [], updates: [] }; }
}

async function saveData(kv, data) {
  await kv.put("app_data", JSON.stringify(data));
}

function isAuthorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "").trim();
  return token === env.API_TOKEN;
}

async function dailyReset(kv) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const today = now.toISOString().slice(0, 10);

  // 检查今天是否已执行过
  const lastRun = await kv.get("daily_reset_date");
  if (lastRun === today) return { skipped: true, reason: "already ran today" };

  // 1. 归档日记
  const diaryRaw = await kv.get("diary_data");
  const diary = diaryRaw ? JSON.parse(diaryRaw) : { today: { date: "", content: "" }, archive: [] };
  const todayEntry = diary.today || {};
  if (todayEntry.content && (!todayEntry.date || todayEntry.date !== today)) {
    // Use the stored date if available, otherwise use yesterday's date
    const archiveDate = todayEntry.date || (() => {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday.toISOString().slice(0, 10);
    })();
    diary.archive = [{ ...todayEntry, date: archiveDate }, ...(diary.archive || [])];
    diary.today = { date: today, content: "" };
    await kv.put("diary_data", JSON.stringify(diary));
  }

  // 2. 清除已完成任务
  const data = await loadData(kv);
  const before = data.tasks.length;
  data.tasks = data.tasks.filter(t => t.status !== "completed");
  await saveData(kv, data);

  // 记录执行日期
  await kv.put("daily_reset_date", today);

  return { ok: true, date: today, archivedDiary: !!todayEntry.content, removedTasks: before - data.tasks.length };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dailyReset(env.TASKS_KV));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/tasks(?=\/|$)/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Serve dashboard
    if (path === "/" || path === "/index.html" || path === "/dashboard.html") {
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Write API routes require authorization; GET /api/data is public (read-only)
    const isWriteApi = path.startsWith("/api/") && request.method !== "GET" && request.method !== "OPTIONS";
    if (isWriteApi && !isAuthorized(request, env)) {
      return json({ error: "Unauthorized" }, 401);
    }

    // GET /api/data — public read
    if (path === "/api/data" && request.method === "GET") {
      const data = await loadData(env.TASKS_KV);
      return json(data);
    }

    // POST /api/data — requires auth (checked above)
    if (path === "/api/data" && request.method === "POST") {
      const body = await request.json();
      await saveData(env.TASKS_KV, body);
      return json({ ok: true });
    }

    // POST /api/tasks/add
    if (path === "/api/tasks/add" && request.method === "POST") {
      const body = await request.json();
      const data = await loadData(env.TASKS_KV);
      const maxId = data.tasks.reduce((m, t) => Math.max(m, t.id || 0), 0);
      const task = {
        id: maxId + 1,
        title: body.title || "",
        category: body.category || "life",
        status: body.status || "todo",
        priority: body.priority || "medium",
        taskType: body.taskType || "weekly",
        deadline: body.deadline || "",
        tags: body.tags || [],
        notes: body.notes || "",
        projectId: body.projectId || null,
        currentPage: null,
        totalPage: null,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      data.tasks.push(task);
      await saveData(env.TASKS_KV, data);
      return json({ ok: true, task });
    }

    // POST /api/tasks/update
    if (path === "/api/tasks/update" && request.method === "POST") {
      const body = await request.json();
      const data = await loadData(env.TASKS_KV);
      const idx = data.tasks.findIndex((t) => t.id === body.id);
      if (idx === -1) return json({ ok: false, error: "not found" }, 404);
      data.tasks[idx] = { ...data.tasks[idx], ...body };
      await saveData(env.TASKS_KV, data);
      return json({ ok: true, task: data.tasks[idx] });
    }

    // POST /api/tasks/delete
    if (path === "/api/tasks/delete" && request.method === "POST") {
      const body = await request.json();
      const data = await loadData(env.TASKS_KV);
      data.tasks = data.tasks.filter((t) => t.id !== body.id);
      await saveData(env.TASKS_KV, data);
      return json({ ok: true });
    }

    // POST /api/notes/add
    if (path === "/api/notes/add" && request.method === "POST") {
      const body = await request.json();
      const data = await loadData(env.TASKS_KV);
      const maxId = (data.notes || []).reduce((m, n) => Math.max(m, n.id || 0), 0);
      const note = {
        id: maxId + 1,
        title: body.title || "",
        summary: body.summary || "",
        tags: body.tags || [],
        updatedAt: new Date().toISOString().slice(0, 10),
        projectId: body.projectId || null,
      };
      data.notes = [note, ...(data.notes || [])];
      await saveData(env.TASKS_KV, data);
      return json({ ok: true, note });
    }

    // POST /api/notes/delete
    if (path === "/api/notes/delete" && request.method === "POST") {
      const body = await request.json();
      const data = await loadData(env.TASKS_KV);
      data.notes = (data.notes || []).filter((n) => n.id !== body.id);
      await saveData(env.TASKS_KV, data);
      return json({ ok: true });
    }

    // GET /api/diary — public read，独立 KV key
    if (path === "/api/diary" && request.method === "GET") {
      const raw = await env.TASKS_KV.get("diary_data");
      if (!raw) return json({ today: { date: "", content: "" }, archive: [] });
      try {
        const parsed = JSON.parse(raw);
        // ?today=1 只返回今日，不含归档（减少流量）
        if (url.searchParams.get("today") === "1") {
          return json({ today: parsed.today || { date: "", content: "" }, archive: [] });
        }
        return json(parsed);
      }
      catch { return json({ today: { date: "", content: "" }, archive: [] }); }
    }

    // POST /api/diary — requires auth，独立 KV key
    if (path === "/api/diary" && request.method === "POST") {
      const body = await request.json();
      const incoming = body?.today ?? {};
      // 同一天有内容时，不允许空内容覆盖
      const raw = await env.TASKS_KV.get("diary_data");
      if (raw) {
        try {
          const stored = JSON.parse(raw);
          const storedToday = stored?.today ?? {};
          if (
            storedToday.date === incoming.date &&
            storedToday.content?.trim() &&
            !incoming.content?.trim()
          ) {
            return json({ ok: true, skipped: true });
          }
        } catch {}
      }
      await env.TASKS_KV.put("diary_data", JSON.stringify(body));
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
  },
};
