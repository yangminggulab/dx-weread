const APP_URLS = [
  "http://127.0.0.1:8080/",
  "http://localhost:8080/",
];

const syncBtn = document.getElementById("syncBtn");
const openBtn = document.getElementById("openBtn");
const statusBox = document.getElementById("status");
const versionBox = document.getElementById("version");

if (versionBox) {
  versionBox.textContent = `扩展版本 v${chrome.runtime.getManifest().version}`;
}

function setStatus(type, text) {
  statusBox.className = `status ${type}`;
  statusBox.textContent = text;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, message: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || {});
    });
  });
}

async function openApp() {
  const tabs = await chrome.tabs.query({
    url: ["http://127.0.0.1:8080/*", "http://localhost:8080/*"],
  });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    return;
  }
  await chrome.tabs.create({ url: APP_URLS[0] });
}

async function refreshStatusFromBackground() {
  const state = await sendMessage({ type: "GET_SYNC_STATUS" });
  if (!state || !state.message) {
    setStatus("idle", "自动同步已启用。打开微信读书页面后，后台会自动抓 Cookie 并同步。");
    return;
  }

  const type =
    state.status === "ok"
      ? "ok"
      : state.status === "err"
        ? "err"
        : "idle";

  const suffix = state.lastSuccessAt
    ? `\n上次成功：${state.lastSuccessAt.replace("T", " ").slice(0, 16)}`
    : "";
  setStatus(type, `${state.message}${suffix}`);
}

syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  setStatus("idle", "正在触发一次即时同步…");

  try {
    const result = await sendMessage({
      type: "TRIGGER_AUTO_SYNC",
      reason: "popup-manual",
    });
    if (!result?.ok) {
      throw new Error(result?.message || "同步失败");
    }
    setStatus("ok", result.message || "同步成功");
  } catch (error) {
    setStatus("err", error.message || String(error));
  } finally {
    syncBtn.disabled = false;
  }
});

openBtn.addEventListener("click", async () => {
  await openApp();
  window.close();
});

refreshStatusFromBackground().catch(() => {
  setStatus("idle", "自动同步已启用。打开微信读书页面后，后台会自动尝试同步。");
});
