/**
 * WeRead Sync Helper – Background Service Worker
 *
 * 自动能力：
 * 1. 捕获 weread 请求头里的完整 Cookie
 * 2. 打开微信读书页面后自动同步到本地应用
 * 3. 在真实 reader 页面里捕获阅读请求模板，供本地自动阅读脚本对齐
 * 4. 后台每 30 分钟重试一次，减少手动点 popup 的频率
 */

const WEREAD_PATTERN = "*://*.weread.qq.com/*";
const READER_PAGE_RE = /^https:\/\/([^/]+\.)?weread\.qq\.com\/(web\/reader|web\/appreader|book\/reader|web\/mp\/reader)\//;

const STORAGE_KEY = "wereadCookie";
const SYNC_STATE_KEY = "wereadSyncState";
const READ_CAPTURE_STATE_KEY = "wereadReadCaptureState";

const AUTO_SYNC_ALARM = "wereadAutoSync";
const AUTO_SYNC_INTERVAL_MINUTES = 30;
const MIN_SUCCESS_INTERVAL_MS = 10 * 60 * 1000;
const REQUEST_DEBOUNCE_MS = 3000;

const SYNC_ENDPOINTS = [
  "http://127.0.0.1:8080/api/weread/extension-sync",
  "http://localhost:8080/api/weread/extension-sync",
];

const READ_TEMPLATE_ENDPOINTS = [
  "http://127.0.0.1:8080/api/weread/read-template",
  "http://localhost:8080/api/weread/read-template",
];

const readerTabUrls = new Map();
const pendingReaderRequests = new Map();

let pendingTimer = null;
let syncInFlight = false;
let lastReadCaptureFingerprint = "";
let lastReadCaptureAt = 0;

function isComplete(cookieStr) {
  if (!cookieStr) return false;
  const required = ["wr_skey", "wr_vid", "wr_rt"];
  return required.every((key) => cookieStr.includes(key + "="));
}

function isReaderPageUrl(url) {
  return READER_PAGE_RE.test(String(url || ""));
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

function shortenUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`.slice(0, 120);
  } catch (_) {
    return String(url || "").slice(0, 120);
  }
}

function hashString(input) {
  let hash = 0;
  const text = String(input || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return `wr_${Math.abs(hash).toString(36)}`;
}

function mergeHeaderObject(headers = []) {
  const merged = {};
  for (const header of headers) {
    const name = String(header?.name || "").trim().toLowerCase();
    const value = String(header?.value || "").trim();
    if (!name || !value) continue;
    if (["cookie", "content-length", "host"].includes(name)) continue;
    merged[name] = merged[name] ? `${merged[name]}, ${value}` : value;
  }
  return merged;
}

function normalizeFormData(formData = {}) {
  const normalized = {};
  for (const [key, values] of Object.entries(formData)) {
    if (!Array.isArray(values) || values.length === 0) continue;
    normalized[key] = values.length === 1 ? values[0] : values;
  }
  return normalized;
}

function decodeRawRequestBody(rawParts = []) {
  const chunks = [];
  for (const part of rawParts) {
    if (part?.bytes) {
      chunks.push(new Uint8Array(part.bytes));
    }
  }
  if (!chunks.length) return "";

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function parseRequestBodyText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return { bodyFormat: "empty", bodyData: null, bodyKeys: [], bodyText: "" };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return {
      bodyFormat: "json",
      bodyData: parsed,
      bodyKeys: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : [],
      bodyText: trimmed.slice(0, 50000),
    };
  } catch (_) {
    // fall through
  }

  if (trimmed.includes("=")) {
    const params = new URLSearchParams(trimmed);
    const data = {};
    for (const [key, value] of params.entries()) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const existing = data[key];
        data[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        data[key] = value;
      }
    }
    return {
      bodyFormat: "urlencoded",
      bodyData: data,
      bodyKeys: Object.keys(data),
      bodyText: trimmed.slice(0, 50000),
    };
  }

  return {
    bodyFormat: "raw",
    bodyData: null,
    bodyKeys: [],
    bodyText: trimmed.slice(0, 50000),
  };
}

function buildBodySnapshot(requestBody) {
  if (!requestBody) {
    return { bodyFormat: "empty", bodyData: null, bodyKeys: [], bodyText: "" };
  }

  if (requestBody.formData) {
    const normalized = normalizeFormData(requestBody.formData);
    return {
      bodyFormat: "formData",
      bodyData: normalized,
      bodyKeys: Object.keys(normalized),
      bodyText: new URLSearchParams(
        Object.entries(normalized).flatMap(([key, value]) => (
          Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]]
        )),
      ).toString().slice(0, 50000),
    };
  }

  if (Array.isArray(requestBody.raw) && requestBody.raw.length) {
    return parseRequestBodyText(decodeRawRequestBody(requestBody.raw));
  }

  return { bodyFormat: "empty", bodyData: null, bodyKeys: [], bodyText: "" };
}

function getRequestContextUrl(details) {
  return (
    details.documentUrl
    || details.initiator
    || readerTabUrls.get(details.tabId)
    || ""
  );
}

function shouldTrackReaderRequest(details) {
  if (!["POST", "PUT", "PATCH"].includes(String(details.method || "").toUpperCase())) {
    return false;
  }
  if ((details.tabId ?? -1) < 0) return false;
  return isReaderPageUrl(getRequestContextUrl(details));
}

function rememberReaderRequest(details, patch = {}) {
  const requestId = String(details.requestId || `${details.tabId}:${details.url}`);
  const existing = pendingReaderRequests.get(requestId) || {
    requestId,
    capturedAt: nowIso(),
    method: String(details.method || "POST").toUpperCase(),
    url: details.url || "",
    tabId: details.tabId ?? -1,
    type: details.type || "",
    documentUrl: details.documentUrl || "",
    initiator: details.initiator || "",
    tabUrl: readerTabUrls.get(details.tabId) || "",
  };
  const next = { ...existing, ...patch };
  pendingReaderRequests.set(requestId, next);
  return next;
}

function collectReadHints(record) {
  const combined = [
    record.url || "",
    record.bodyText || "",
    JSON.stringify(record.bodyData || {}),
    JSON.stringify(record.requestHeaders || {}),
  ].join("\n").toLowerCase();

  return [
    "bookid",
    "chapteruid",
    "chapteroffset",
    "readingtime",
    "readtime",
    "synckey",
    "appid",
    "deviceid",
    "progress",
    "offset",
    "reader",
  ].filter((token) => combined.includes(token));
}

function looksLikeReadTemplate(record) {
  if (!record?.url) return false;
  if ((record.statusCode || 0) >= 400) return false;

  const urlLower = String(record.url || "").toLowerCase();
  const combined = [
    urlLower,
    String(record.bodyText || "").toLowerCase(),
    JSON.stringify(record.bodyData || {}).toLowerCase(),
  ].join("\n");

  const hasBookId = combined.includes("bookid");
  const hints = collectReadHints(record);
  const directReadPath = /\/(web\/)?book\/read\b/.test(urlLower);
  return hasBookId && (directReadPath || hints.length >= 3);
}

function buildReadCapture(record) {
  const path = (() => {
    try {
      return new URL(record.url).pathname;
    } catch (_) {
      return record.url || "";
    }
  })();

  const fingerprint = hashString([
    record.method,
    path,
    record.bodyFormat,
    record.bodyText || JSON.stringify(record.bodyData || {}),
  ].join("\n"));

  return {
    fingerprint,
    capturedAt: record.capturedAt || nowIso(),
    completedAt: record.completedAt || nowIso(),
    method: record.method || "POST",
    url: record.url || "",
    path,
    tabUrl: record.tabUrl || "",
    documentUrl: record.documentUrl || record.initiator || "",
    statusCode: record.statusCode || 0,
    bodyFormat: record.bodyFormat || "raw",
    bodyText: record.bodyText || "",
    bodyKeys: Array.isArray(record.bodyKeys) ? record.bodyKeys : [],
    hints: collectReadHints(record),
    requestHeaders: record.requestHeaders || {},
    bodyData: record.bodyData || null,
  };
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

async function getReadCaptureState() {
  const result = await chrome.storage.local.get(READ_CAPTURE_STATE_KEY);
  return result[READ_CAPTURE_STATE_KEY] || {};
}

async function saveReadCaptureState(patch) {
  const current = await getReadCaptureState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [READ_CAPTURE_STATE_KEY]: next });
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

async function postReadTemplate(capture) {
  let lastError = "本地服务不可用，请先运行 python3 server.py";

  for (const endpoint of READ_TEMPLATE_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capture }),
      });
      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!response.ok) {
        throw new Error(data.error || "保存阅读模板失败");
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

async function persistReadCapture(capture) {
  const now = Date.now();
  if (
    capture.fingerprint === lastReadCaptureFingerprint
    && (now - lastReadCaptureAt) < 120000
  ) {
    return { ok: true, skipped: "duplicate" };
  }

  lastReadCaptureFingerprint = capture.fingerprint;
  lastReadCaptureAt = now;

  await saveReadCaptureState({
    status: "capturing",
    message: `正在保存阅读请求模板：${shortenUrl(capture.url)}`,
    lastCapturedAt: capture.capturedAt,
    lastUrl: capture.url,
    lastPath: capture.path,
    hints: capture.hints || [],
  });

  try {
    const data = await postReadTemplate(capture);
    await saveReadCaptureState({
      status: "ok",
      message: `已捕获阅读模板：${shortenUrl(capture.url)}`,
      lastCapturedAt: data.capturedAt || capture.capturedAt,
      lastUrl: data.url || capture.url,
      lastPath: capture.path,
      hints: capture.hints || [],
      captureCount: data.captures || 1,
    });
    return { ok: true, data };
  } catch (error) {
    await saveReadCaptureState({
      status: "err",
      message: formatError(error),
      lastCapturedAt: capture.capturedAt,
      lastUrl: capture.url,
      lastPath: capture.path,
      hints: capture.hints || [],
    });
    return { ok: false, message: formatError(error) };
  }
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

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!shouldTrackReaderRequest(details)) return;
    rememberReaderRequest(details, buildBodySnapshot(details.requestBody));
  },
  { urls: [WEREAD_PATTERN] },
  ["requestBody"],
);

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    const cookieHeader = details.requestHeaders?.find(
      (header) => header.name.toLowerCase() === "cookie"
    );
    if (cookieHeader?.value) {
      const cookie = cookieHeader.value.trim();
      if (isComplete(cookie)) {
        storeCookie(cookie, details.url, "request-header").catch(() => {});
        scheduleAutoSync("request-header", cookie);
      }
    }

    if (!shouldTrackReaderRequest(details)) return;
    rememberReaderRequest(details, {
      requestHeaders: mergeHeaderObject(details.requestHeaders || []),
      documentUrl: getRequestContextUrl(details),
      tabUrl: readerTabUrls.get(details.tabId) || "",
    });
  },
  { urls: [WEREAD_PATTERN] },
  ["requestHeaders", "extraHeaders"],
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const requestId = String(details.requestId || `${details.tabId}:${details.url}`);
    const record = pendingReaderRequests.get(requestId);
    if (!record) return;

    pendingReaderRequests.delete(requestId);
    const completedRecord = {
      ...record,
      statusCode: details.statusCode || 0,
      completedAt: nowIso(),
    };

    if (!looksLikeReadTemplate(completedRecord)) return;
    persistReadCapture(buildReadCapture(completedRecord)).catch(() => {});
  },
  { urls: [WEREAD_PATTERN] },
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const requestId = String(details.requestId || `${details.tabId}:${details.url}`);
    pendingReaderRequests.delete(requestId);
  },
  { urls: [WEREAD_PATTERN] },
);

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || "";
  if (!url) return;

  if (isReaderPageUrl(url)) {
    readerTabUrls.set(tab.id, url);
    saveReadCaptureState({
      status: "idle",
      message: "已进入微信读书 reader 页面。停留几秒或翻页后，会自动捕获阅读请求模板。",
      lastReaderUrl: url,
    }).catch(() => {});
  } else if (tab?.id && readerTabUrls.has(tab.id)) {
    readerTabUrls.delete(tab.id);
  }

  if (changeInfo.status !== "complete") return;
  if (!/^https:\/\/([^/]+\.)?weread\.qq\.com\//.test(url)) return;
  scheduleAutoSync("tab-complete");
});

chrome.tabs.onRemoved.addListener((tabId) => {
  readerTabUrls.delete(tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAutoSyncAlarm();
  saveReadCaptureState({
    status: "idle",
    message: "打开任意微信读书 reader 页面后，扩展会自动捕获阅读请求模板。",
  }).catch(() => {});
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

  if (msg.type === "GET_READ_CAPTURE_STATUS") {
    getReadCaptureState().then((state) => sendResponse(state || {}));
    return true;
  }

  if (msg.type === "TRIGGER_AUTO_SYNC") {
    runAutoSync(msg.reason || "popup-manual", { force: true }).then(sendResponse);
    return true;
  }
});
