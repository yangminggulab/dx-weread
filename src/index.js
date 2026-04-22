const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/tasks/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // GET /tasks/api/data
    if (path === "/api/data" && request.method === "GET") {
      const data = await loadData(env.TASKS_KV);
      return json(data);
    }

    // POST /tasks/api/data
    if (path === "/api/data" && request.method === "POST") {
      const body = await request.json();
      await saveData(env.TASKS_KV, body);
      return json({ ok: true });
    }

    // POST /tasks/api/tasks/add
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

    // POST /tasks/api/tasks/update
    if (path === "/api/tasks/update" && request.method === "POST") {
      const body = await request.json();
      const data = await loadData(env.TASKS_KV);
      const idx = data.tasks.findIndex((t) => t.id === body.id);
      if (idx === -1) return json({ ok: false, error: "not found" }, 404);
      data.tasks[idx] = { ...data.tasks[idx], ...body };
      await saveData(env.TASKS_KV, data);
      return json({ ok: true, task: data.tasks[idx] });
    }

    // POST /tasks/api/tasks/delete
    if (path === "/api/tasks/delete" && request.method === "POST") {
      const body = await request.json();
      const data = await loadData(env.TASKS_KV);
      data.tasks = data.tasks.filter((t) => t.id !== body.id);
      await saveData(env.TASKS_KV, data);
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  },
};
