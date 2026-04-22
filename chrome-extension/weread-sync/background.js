/**
 * WeRead Sync Helper – Background Service Worker
 *
 * 自动能力：
 * 1. 捕获 weread 请求头里的完整 Cookie
 * 2. 打开微信读书页面后自动同步到本地应用
 * 3. 后台每 30 分钟重试一次，减少手动点 popup 的频率
 */

const WEREAD_PATTERN = "*://*.weread.qq.com/*";
const STORAGE_KEY = "wereadCookie";
const SYNC_STATE_KEY = "wereadSyncState";
const AUTO_SYNC_ALARM = "wereadAutoSync";
const AUTO_SYNC_INTERVAL_MINUTES = 30;
const MIN_SUCCESS_INTERVAL_MS = 10 * 60 * 1000;
const REQUEST_DEBOUNCE_MS = 3000;

const SYNC_ENDPOINTS = [
  "http://127.0.0.1:8080/api/weread/extension-sync",
  "http://localhost:8080/api/weread/extension-sync",
];

let pendingTimer = null;
let syncInFlight = false;

function isComplete(cookieStr) {
  if (!cookieStr) return false;
  const required = ["wr_skey", "wr_vid", "wr_rt"];
  return required.every((key) => cookieStr.includes(key + "="));
}

function extractCookieSignature(cookieStr) {
  const values = {};
  for (const part of String(cookieStr || "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed.includes("=")) continue;
    const [key, value] = trimmed.split("=", 2);
    if (["wr_skey", "wr_vid", "wr_rt"].includes(key)) {
      values[key] = value;
    }
  }
  return ["wr_skey", "wr_vid", "wr_rt"].map((key) => values[key] || "").join("|");
}

function nowIso() {
  return new Date().toISOString();
}

function formatError(err) {
  return err?.message || String(err || "未知错误");
}

async function getStoredCookieRecord() {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return result[STORAGE_KEY] || null;
}

async function storeCookie(cookie, url, source = "request-header") {
  if (!isComplete(cookie)) return null;
  const payload = {
    cookie,
    capturedAt: nowIso(),
    url: url || "",
    source,
  };
  await chrome.storage.session.set({ [STORAGE_KEY]: payload });
  return payload;
}

async function clearStoredCookie() {
  await chrome.storage.session.remove(STORAGE_KEY);
}

async function getSyncState() {
  const result = await chrome.storage.local.get(SYNC_STATE_KEY);
  return result[SYNC_STATE_KEY] || {};
}

async function saveSyncState(patch) {
  const current = await getSyncState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SYNC_STATE_KEY]: next });
  return next;
}

async function getCookieFromAPI() {
  try {
    const [byUrl, byDomain] = await Promise.all([
      chrome.cookies.getAll({ url: "https://weread.qq.com/" }),
      chrome.cookies.getAll({ domain: "qq.com" }).catch(() => []),
    ]);
    const merged = new Map();
    for (const cookie of [...byDomain, ...byUrl]) {
      if (cookie?.value) merged.set(cookie.name, cookie);
    }
    const pairs = [...merged.values()]
      .filter((cookie) => cookie.value)
      .map((cookie) => `${cookie.name}=${cookie.value}`);

    const header = pairs.join("; ");
    return isComplete(header) ? header : null;
  } catch (_) {
    return null;
  }
}

async function buildCookieHeader() {
  const stored = await getStoredCookieRecord();
  if (stored?.cookie && isComplete(stored.cookie)) {
    return stored.cookie;
  }

  const fromApi = await getCookieFromAPI();
  if (fromApi) {
    await storeCookie(fromApi, "https://weread.qq.com/", "cookies-api");
    return fromApi;
  }

  return null;
}

async function postSync(cookieHeader) {
  let lastError = "本地服务不可用，请先运行 python3 server.py";

  for (const endpoint of SYNC_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: cookieHeader }),
      });
      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!response.ok) {
        throw new Error(data.error || "同步失败");
      }
      return data;
    } catch (error) {
      lastError = formatError(error);
    }
  }

  throw new Error(lastError);
}

async function refreshAppTabs() {
  const tabs = await chrome.tabs.query({
    url: ["http://127.0.0.1:8080/*", "http://localhost:8080/*"],
  });
  if (!tabs.length) return false;
  await Promise.all(tabs.map((tab) => chrome.tabs.reload(tab.id)));
  return true;
}

async function runAutoSync(reason, options = {}) {
  if (syncInFlight) {
    return { ok: false, skipped: "running", message: "已有同步任务在运行" };
  }

  syncInFlight = true;
  const attemptAt = nowIso();

  try {
    const cookie = options.cookie || await buildCookieHeader();
    if (!cookie) {
      const state = await saveSyncState({
        status: "idle",
        message: "未读取到完整 Cookie，请先打开微信读书页面。",
        lastAttemptAt: attemptAt,
        lastSource: reason,
      });
      return { ok: false, message: state.message };
    }

    const signature = extractCookieSignature(cookie);
    const state = await getSyncState();
    if (!options.force && state.lastCookieSignature === signature && state.lastSuccessAt) {
      const elapsed = Date.now() - Date.parse(state.lastSuccessAt);
      if (elapsed < MIN_SUCCESS_INTERVAL_MS) {
        const skippedState = await saveSyncState({
          status: "idle",
          message: "最近已经自动同步过，先跳过本次重复触发。",
          lastAttemptAt: attemptAt,
          lastSource: reason,
        });
        return { ok: true, skipped: "recent", message: skippedState.message };
      }
    }

    await saveSyncState({
      status: "syncing",
      message: `正在同步微信读书（${reason}）…`,
      lastAttemptAt: attemptAt,
      lastSource: reason,
    });

    const data = await postSync(cookie);
    const reloaded = await refreshAppTabs();
    const message =
      `${data.message || `同步成功：${data.books || 0} 本书，${data.notes || 0} 份笔记`}` +
      (reloaded ? " 已刷新本地页面。" : "");

    await saveSyncState({
      status: "ok",
      message,
      lastAttemptAt: attemptAt,
      lastSuccessAt: nowIso(),
      lastSource: reason,
      lastCookieSignature: signature,
      books: data.books || 0,
      notes: data.notes || 0,
    });

    return { ok: true, data, message };
  } catch (error) {
    const message = formatError(error);
    await saveSyncState({
      status: "err",
      message,
      lastAttemptAt: attemptAt,
      lastSource: reason,
    });
    return { ok: false, message };
  } finally {
    syncInFlight = false;
  }
}

function scheduleAutoSync(reason, cookie) {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    runAutoSync(reason, { cookie }).catch(() => {});
  }, REQUEST_DEBOUNCE_MS);
}

function ensureAutoSyncAlarm() {
  chrome.alarms.create(AUTO_SYNC_ALARM, {
    periodInMinutes: AUTO_SYNC_INTERVAL_MINUTES,
  });
}

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    const cookieHeader = details.requestHeaders?.find(
      (header) => header.name.toLowerCase() === "cookie"
    );
    if (!cookieHeader?.value) return;

    const cookie = cookieHeader.value.trim();
    if (!isComplete(cookie)) return;

    storeCookie(cookie, details.url, "request-header").catch(() => {});
    scheduleAutoSync("request-header", cookie);
  },
  { urls: [WEREAD_PATTERN] },
  ["requestHeaders", "extraHeaders"]
);

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || "";
  if (changeInfo.status !== "complete") return;
  if (!/^https:\/\/([^/]+\.)?weread\.qq\.com\//.test(url)) return;
  scheduleAutoSync("tab-complete");
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAutoSyncAlarm();
  runAutoSync("installed").catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureAutoSyncAlarm();
  runAutoSync("startup").catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_SYNC_ALARM) return;
  runAutoSync("alarm").catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_WEREAD_COOKIE") {
    getStoredCookieRecord().then((record) => sendResponse(record || null));
    return true;
  }

  if (msg.type === "CLEAR_WEREAD_COOKIE") {
    clearStoredCookie().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "GET_SYNC_STATUS") {
    getSyncState().then((state) => sendResponse(state || {}));
    return true;
  }

  if (msg.type === "TRIGGER_AUTO_SYNC") {
    runAutoSync(msg.reason || "popup-manual", { force: true }).then(sendResponse);
    return true;
  }
});
