import { createJSONStorage } from '../src/core/storage.mjs';
import { createDiaryDrafts } from '../src/features/diary/drafts.mjs';
import { DiaryController } from '../src/features/diary/controller.mjs';

export function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}
export function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export const clone = value => structuredClone(value);
export const original = () => ({ today: { date: '2026-10-07', content: 'Original', updatedAt: 'v1', tags: ['焦虑内耗'], tagScores: { 焦虑内耗: 4 } }, archive: [{ date: '2026-10-06', content: 'Past', updatedAt: 'a1' }] });
export function diaryFixture({ storage = memoryStorage(), initial = original() } = {}) {
  let remote = clone(initial), revision = 1, handler;
  const requests = [], timers = new Map(); let timerID = 0;
  const repository = createDiaryDrafts(createJSONStorage(storage, 'drafts'));
  const request = async (path, options) => {
    requests.push({ path, options });
    if (handler) return handler(path, options);
    if (path === '/api/diary') return clone(remote);
    const body = JSON.parse(options.body), entry = remote.today.date === body.date ? remote.today : remote.archive.find(item => item.date === body.date);
    if (!entry) throw Object.assign(new Error('missing'), { status: 404 });
    if (body.expectedContent !== entry.content || body.expectedUpdatedAt !== (entry.updatedAt || '')) throw Object.assign(new Error('conflict'), { status: 409, data: { entry: clone(entry) } });
    const saved = { ...entry, content: body.content, updatedAt: `v${++revision}` };
    if (remote.today.date === body.date) remote.today = saved; else remote.archive = remote.archive.map(item => item.date === body.date ? saved : item);
    return { ok: true, entry: clone(saved) };
  };
  const options = { request, drafts: repository, cache: createJSONStorage(storage, 'cache'),
    now: () => new Date('2026-10-07T06:00:00+08:00'), schedule: fn => { const id = ++timerID; timers.set(id, fn); return id; }, cancel: id => timers.delete(id) };
  return { controller: new DiaryController(options), options, storage, repository, requests, timers,
    remote: () => clone(remote), cloud: value => { remote = clone(value); }, handler: value => { handler = value; } };
}
