import { createRequestQueue } from './request-queue.mjs';

export const APP_BASE_PATH = /^\/tasks(\/|$)/.test(globalThis.location?.pathname || '') ? '/tasks' : '';
export const PERSONAL_MODE = APP_BASE_PATH === '/tasks';
const AUTH_TOKEN_KEY = 'dx_auth_token';
export const getAuthToken = () => { try { return localStorage.getItem(AUTH_TOKEN_KEY) || ''; } catch { return ''; } };
export const setAuthToken = token => { try { localStorage.setItem(AUTH_TOKEN_KEY, token); } catch {} };
export const clearAuthToken = () => { try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch {} };
export const apiUrl = path => `${APP_BASE_PATH}${path}`;

export function createAPIClient({ fetch: send = globalThis.fetch, basePath = '', token = () => '', unauthorized = () => {} } = {}) {
  const queue = createRequestQueue();
  return {
    request(path, options = {}) {
      return queue.enqueue(async () => {
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        const credential = token();
        if (credential) headers.Authorization = `Bearer ${credential}`;
        const response = await send(`${basePath}${path}`, { cache: 'no-store', ...options, headers });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401) unauthorized();
          throw Object.assign(new Error(data.error || `请求失败（${response.status}）`), { status: response.status, data });
        }
        return data;
      });
    },
    wait: queue.wait,
  };
}

const client = createAPIClient({ basePath: APP_BASE_PATH, token: PERSONAL_MODE ? getAuthToken : () => '',
  unauthorized: () => { if (PERSONAL_MODE) { clearAuthToken(); location.reload(); } },
});
export const apiRequest = client.request;

// Partition cache/drafts by connection without storing the credential in a key.
export function workspaceIdentity() {
  let hash = 2166136261;
  for (const char of getAuthToken()) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${APP_BASE_PATH || 'local'}:${(hash >>> 0).toString(16)}`;
}
