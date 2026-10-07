import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceController } from '../src/core/workspace-controller.mjs';
import { createAPIClient, getAuthToken, setAuthToken, clearAuthToken } from '../src/core/api.mjs';
import { deferred } from './helpers.mjs';

const original = () => ({ tasks: [{ id: 1, title: 'Original', taskType: 'daily', status: 'todo' }], books: [], notes: [{ id: 'wr_note', title: 'Source note' }], updates: [] });
function workspace(request) { return new WorkspaceController({ request, schedule: () => 1, cancel: () => {} }); }
test('failed initial load does not invent example tasks or enable writes', async () => {
  const c = workspace(async () => { throw new Error('offline'); }); await c.refresh();
  assert.equal(c.data, null); assert.equal(c.base, null); assert.match(c.state.error, /刷新失败/);
});
test('task snapshot writes exclude books and notes, preserving reading module ownership', async () => {
  let submitted;
  const c = workspace(async (path, options) => {
    if (!options) return original();
    submitted = JSON.parse(options.body); return { ok: true, data: { ...original(), tasks: submitted.tasks } };
  });
  await c.refresh(); c.toggleTask(1); await c.flushTasks();
  assert.equal('books' in submitted, false); assert.equal('notes' in submitted, false); assert.equal(c.data.notes[0].id, 'wr_note');
});
test('late GET cannot undo reading write acknowledged after refresh began', async () => {
  let next;
  const c = workspace(() => next ? next.promise : Promise.resolve(original())); await c.refresh(); next = deferred();
  const refresh = c.refresh(); c.acceptReading({ book: { id: 5, title: 'Saved book' } }); next.resolve(original()); await refresh;
  assert.equal(c.data.books[0].id, 5);
});
test('task input during save preserves newer edits and remote inserted tasks', async () => {
  let gate, submitted;
  const c = workspace(async (path, options) => { if (!options) return original(); submitted = JSON.parse(options.body); if (gate) return gate.promise; return { ok: true, data: { ...original(), tasks: submitted.tasks } }; });
  await c.refresh(); c.saveTask({ title: 'First' }, c.data.tasks[0]); gate = deferred(); const saving = c.flushTasks();
  await Promise.resolve(); c.saveTask({ title: 'Second' }, c.data.tasks[0]);
  const response = { ok: true, data: { ...original(), tasks: [{ ...original().tasks[0], title: 'First' }, { id: 2, title: 'From Mac' }] } };
  const activeGate = gate; gate = null; activeGate.resolve(response); await saving;
  assert.equal(c.data.tasks.find(task => task.id === 1).title, 'Second'); assert.equal(c.data.tasks.some(task => task.id === 2), true);
});
test('API queue orders reads after writes and an error does not poison following requests', async () => {
  const gate = deferred(), order = [];
  const client = createAPIClient({ fetch: async (url, options) => {
    order.push(options.method || 'GET'); if (options.method === 'POST') await gate.promise;
    return { ok: true, json: async () => ({ ok: true }) };
  } });
  const write = client.request('/api/diary/entry', { method: 'POST' }), read = client.request('/api/diary');
  await Promise.resolve(); await Promise.resolve(); assert.deepEqual(order, ['POST']); gate.resolve(); await Promise.all([write, read]); assert.deepEqual(order, ['POST', 'GET']);
  let fail = true;
  const retryClient = createAPIClient({ fetch: async () => { if (fail) { fail = false; throw new Error('offline'); } return { ok: true, json: async () => ({ ok: true }) }; } });
  await assert.rejects(retryClient.request('/api/data')); assert.equal((await retryClient.request('/api/data')).ok, true);
});

test('unsaved tasks do not block reading refresh and cache stores only confirmed task fields', async () => {
  let remote = original(), cached;
  const c = new WorkspaceController({ request: async () => remote, cache: { read: () => null, write: data => { cached = structuredClone(data); } }, schedule: () => 1, cancel: () => {} });
  await c.refresh(); c.saveTask({ title: 'Unsaved' }, c.data.tasks[0]);
  remote = { ...original(), books: [{ id: 9, title: 'From Mac' }], notes: [{ id: 'wr_note', summary: 'Updated' }] }; await c.refresh();
  assert.equal(c.data.tasks[0].title, 'Unsaved'); assert.equal(c.data.books[0].id, 9); assert.equal(c.data.notes[0].summary, 'Updated');
  assert.equal(cached.tasks[0].title, 'Original'); assert.equal(cached.books[0].id, 9);
});
test('native timer callbacks are invoked without binding them to a controller', async () => {
  const c = new WorkspaceController({ request: async () => original(), schedule: function () { assert.equal(this, undefined); return 1; }, cancel: function () { assert.equal(this, undefined); } });
  await c.refresh(); c.toggleTask(1);
});
test('existing web login token remains compatible after module extraction', () => {
  const previous = globalThis.localStorage;
  const values = new Map([['dx_auth_token', 'existing-token']]);
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  try { assert.equal(getAuthToken(), 'existing-token'); setAuthToken('new-token'); assert.equal(values.get('dx_auth_token'), 'new-token'); clearAuthToken(); assert.equal(values.has('dx_auth_token'), false); }
  finally { globalThis.localStorage = previous; }
});
