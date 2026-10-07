import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAPIClient } from '../src/core/api.mjs';
import { DiaryController } from '../src/features/diary/controller.mjs';
import { ReadingController, bookBaseline } from '../src/features/reading/writes.mjs';
import { createJSONStorage } from '../src/core/storage.mjs';
import { createDiaryDrafts } from '../src/features/diary/drafts.mjs';
import { memoryStorage, deferred } from './helpers.mjs';

const directory = mkdtempSync(join(tmpdir(), 'web-worker-contract-'));
// Preserve the Worker's relative module imports in the isolated fixture.
cpSync(new URL('../../worker/src/', import.meta.url), directory, { recursive: true });
writeFileSync(join(directory, 'worker.mjs'), readFileSync(new URL('../../worker/src/index.js', import.meta.url), 'utf8').replace(/^import DASHBOARD_HTML.*$/m, 'const DASHBOARD_HTML = "test";'));
const { default: worker, TaskState } = await import(pathToFileURL(join(directory, 'worker.mjs')));
rmSync(directory, { recursive: true });
class Storage {
  values = new Map();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  async transaction(fn) { return fn(this); }
}
function fixture() {
  const env = { API_TOKEN: 'fixture-token', TASKS_KV: { get: async () => null } };
  const state = new TaskState({ storage: new Storage() }, env);
  env.TASKS_STATE = { idFromName: () => 'personal', get: () => state };
  const client = createAPIClient({ token: () => 'fixture-token', basePath: 'https://example.test/tasks', fetch: (url, options) => worker.fetch(new Request(url, options), env) });
  const request = client.request;
  return { request, diary: (options = {}) => new DiaryController({ request, drafts: createDiaryDrafts(createJSONStorage(memoryStorage(), 'diary')), schedule: () => 1, cancel: () => {}, ...options }) };
}
test('web automatic diary sync preserves competing bodies and explicit empty text in the real Worker', async () => {
  const f = fixture(), first = f.diary(), second = f.diary(); await first.refresh(); await second.refresh();
  assert.equal(first.state.automatic, true);
  first.edit('New Mac equivalent'); assert.equal(await first.save(), true);
  second.edit('Stale web'); assert.equal(await second.save(), true);
  assert.equal((await f.request('/api/diary')).today.content, 'Stale web');
  const versions = async () => (await f.request(`/api/diary/versions?date=${second.state.entry.date}`)).versions.map(entry => entry.content);
  assert.ok((await versions()).includes('New Mac equivalent'));
  assert.ok((await versions()).includes('Stale web'));
  second.edit(''); assert.equal(await second.save(), true);
  assert.equal((await f.request('/api/diary')).today.content, '');
  assert.ok((await versions()).includes('New Mac equivalent'));
  assert.ok((await versions()).includes('Stale web'));
  assert.ok((await versions()).includes(''));
});
test('real Worker accepts stale web rename without reverting Mac pages, and rejects stale same-field edit', async () => {
  const f = fixture();
  const original = (await f.request('/api/books/add', { method: 'POST', body: JSON.stringify({ title: 'Book', currentPage: 10, totalPage: 100 }) })).book;
  const workspace = { data: { books: [original] }, acceptReading(receipt) { this.data.books = [receipt.book]; }, async refresh() { this.data = await f.request('/api/data'); } };
  const reading = new ReadingController({ workspace, request: f.request, drafts: createJSONStorage(memoryStorage(), 'reading') });
  reading.open(original); reading.edit('title', 'Web rename');
  await f.request('/api/books/update', { method: 'POST', body: JSON.stringify({ id: original.id, currentPage: 50, _base: bookBaseline(original), _readingWriteVersion: 1 }) });
  assert.equal(await reading.save(), true); assert.equal(workspace.data.books[0].currentPage, 50);
  reading.open(workspace.data.books[0]); reading.edit('currentPage', '60');
  await f.request('/api/books/update', { method: 'POST', body: JSON.stringify({ id: original.id, currentPage: 70, _base: bookBaseline(workspace.data.books[0]), _readingWriteVersion: 1 }) });
  assert.equal(await reading.save(), false); assert.equal(reading.state.conflict, true); assert.equal(workspace.data.books[0].currentPage, 70);
});

test('continued web typing after a merged receipt keeps the other writer additions', async () => {
  const f = fixture(), seed = f.diary(); await seed.refresh(); seed.edit('first\nsecond'); await seed.save();
  const other = f.diary(); await other.refresh();
  const started = deferred(), release = deferred();
  const controller = f.diary({ request: async (path, options) => {
    const result = await f.request(path, options);
    if (path === '/api/diary/sync') { started.resolve(); await release.promise; }
    return result;
  } });
  await controller.refresh(); other.edit('first\nremote second'); await other.save();
  controller.edit('local first\nsecond'); const saving = controller.save(); await started.promise;
  controller.edit('local first updated\nsecond'); release.resolve(); await saving;
  assert.equal(controller.state.entry.content, 'local first updated\nsecond');
  assert.equal(controller.drafts[controller.date()].baseContent, 'local first\nsecond');
  assert.equal(await controller.save(), true);
  assert.equal((await f.request('/api/diary')).today.content, 'local first updated\nremote second');
  assert.equal(controller.state.conflict, null);
});

test('a lost web response is retried with the persisted immutable operation without reverting a later writer', async () => {
  const f = fixture(); let drop = true;
  const controller = f.diary({ request: async (path, options) => {
    const result = await f.request(path, options);
    if (path === '/api/diary/sync' && drop) { drop = false; throw new Error('lost receipt'); }
    return result;
  } });
  await controller.refresh(); controller.edit('first save'); assert.equal(await controller.save(), false);
  const id = controller.drafts[controller.date()].operation.operationId;
  const later = f.diary(); await later.refresh(); later.edit('later writer'); await later.save();
  assert.equal(await controller.save(), true);
  assert.equal(controller.state.entry.content, 'later writer');
  assert.equal((await f.request('/api/diary')).today.content, 'later writer');
  const versions = (await f.request(`/api/diary/versions?date=${controller.date()}`)).versions;
  assert.ok(versions.some(entry => entry.content === 'first save'));
  assert.equal(controller.hasUnsaved(), false); assert.ok(id);
});

test('web restores raw version bodies after preserving both cloud and unsaved input', async () => {
  const f = fixture(), controller = f.diary(); await controller.refresh();
  controller.edit('  original\n\n'); await controller.save(); controller.edit('Current'); await controller.save();
  await controller.loadVersions(); const original = controller.state.versions.find(v => v.content === '  original\n\n');
  controller.edit('Unsaved'); assert.equal(await controller.restoreVersion(original), true);
  assert.equal((await f.request('/api/diary')).today.content, '  original\n\n');
  await controller.loadVersions(); assert.ok(controller.state.versions.some(v => v.content === 'Unsaved'));
});
