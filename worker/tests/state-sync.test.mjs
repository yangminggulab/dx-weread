import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeDiaryText } from '../src/diary-sync.mjs';
const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8').replace(/^import DASHBOARD_HTML.*$/m, 'const DASHBOARD_HTML = "test";')
  .replace("'./diary-sync.mjs'", JSON.stringify(new URL('../src/diary-sync.mjs', import.meta.url).href));
const directory = mkdtempSync(join(tmpdir(), 'worker-sync-test-'));
const modulePath = join(directory, 'worker.mjs');
writeFileSync(modulePath, source);
const { default: worker, TaskState } = await import(pathToFileURL(modulePath));
rmSync(directory, { recursive: true });
class Storage {
  values = new Map();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) {
    const size = value instanceof Uint8Array ? value.byteLength : Buffer.byteLength(JSON.stringify(value));
    if (size > 2 * 1024 * 1024) throw new Error('SQLite value exceeds 2 MB');
    this.values.set(key, structuredClone(value));
  }
  async delete(key) { return this.values.delete(key); }
  async transaction(fn) {
    const original = new Map(this.values);
    try { return await fn(this); }
    catch (error) { this.values = original; throw error; }
  }
}
function fixture(initial = { tasks: [], books: [], notes: [], updates: [] }) {
  const originals = new Map([['app_data', JSON.stringify(initial)]]);
  const storage = new Storage();
  const env = { API_TOKEN: 'test', TASKS_KV: {
    get: async key => { await new Promise(resolve => setTimeout(resolve, 1)); return originals.get(key); },
    put: async () => { throw new Error('Do not write to migration KV'); },
  } };
  const state = new TaskState({ storage }, env);
  env.TASKS_STATE = { idFromName: () => 'personal', get: () => state };
  const request = async (path, body) => worker.fetch(new Request('https://example.test/tasks/api/' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { request, env, state, storage, originals };
}

test('concurrent creates keep every task with unique IDs; reads ignore stale KV', async () => {
  const f = fixture();
  const writes = await Promise.all(Array.from({ length: 12 }, (_, i) => f.request('tasks/add', { title: 'Task ' + i })));
  assert.ok(writes.every(response => response.ok));
  const response = await f.request('data');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const data = await response.json();
  assert.equal(data.tasks.length, 12);
  assert.equal(new Set(data.tasks.map(item => item.id)).size, 12);
  assert.equal(data._revision, 12);
  assert.equal(JSON.parse(f.originals.get('app_data')).tasks.length, 0);
  const restarted = new TaskState({ storage: f.storage }, f.env);
  f.env.TASKS_STATE.get = () => restarted;
  assert.equal((await (await f.request('data')).json()).tasks.length, 12);
  assert.ok(await f.storage.get('migration_backup'));
});

test('dated diary edits replace shorter bodies, preserve metadata and other dates', async () => {
  const f = fixture();
  const today = (await (await f.request('diary')).json()).today;
  const entry = { date: '2020-01-02', content: 'a long archived original', viewCount: 4, tags: ['学习卡壳'], tagScores: { '学习卡壳': 2 } };
  f.originals.set('diary_data', JSON.stringify({ today, archive: [entry, { date: '2020-01-01', content: 'keep this' }] }));
  // Recreate to load the test's legacy snapshot, not the initialized empty state.
  const state = new TaskState({ storage: new Storage() }, f.env);
  f.env.TASKS_STATE.get = () => state;
  const response = await f.request('diary/entry', { date: entry.date, content: 'short', expectedContent: entry.content, expectedUpdatedAt: '' });
  assert.equal(response.status, 200);
  const receipt = (await response.json()).entry;
  assert.equal(receipt.date, entry.date);
  assert.ok(receipt.updatedAt);
  const saved = await (await f.request('diary')).json();
  assert.deepEqual(saved.today, today);
  assert.equal(saved.archive.find(e => e.date === entry.date).content, 'short');
  assert.equal(saved.archive.find(e => e.date === entry.date).viewCount, 4);
  assert.equal(saved.archive.find(e => e.date === '2020-01-01').content, 'keep this');
  // A legacy metadata/snapshot upload must not resurrect a longer, older body.
  await f.request('diary', { archive: [{ ...entry, viewCount: 5 }] });
  const after = (await (await f.request('diary')).json()).archive.find(e => e.date === entry.date);
  assert.equal(after.content, 'short');
  assert.equal(after.viewCount, 5);
  const clear = await f.request('diary/entry', { date: entry.date, content: '', expectedContent: 'short', expectedUpdatedAt: receipt.updatedAt });
  assert.equal(clear.status, 200);
  const cleared = (await (await f.request('diary')).json()).archive.find(e => e.date === entry.date);
  assert.equal(cleared.content, '');
});

test('dated diary saves enforce body/version baselines and retain original dates', async () => {
  const f = fixture();
  const day = (await (await f.request('diary')).json()).today.date;
  const first = await f.request('diary/entry', { date: day, content: 'today', expectedContent: '', expectedUpdatedAt: '' });
  assert.equal(first.status, 200);
  assert.equal((await f.request('diary/entry', { date: day, content: 'stale', expectedContent: '', expectedUpdatedAt: '' })).status, 409);
  assert.equal((await f.request('diary/entry', { date: '2020-02-30', content: 'wrong date', expectedContent: '', expectedUpdatedAt: '' })).status, 400);
  assert.equal((await f.request('diary/entry', { date: '2099-01-01', content: 'future', expectedContent: '', expectedUpdatedAt: '' })).status, 400);
  assert.equal((await f.request('diary/entry', { date: '2020-01-01', content: 'missing', expectedContent: '', expectedUpdatedAt: '' })).status, 404);
  const receipt = (await first.json()).entry;
  const responses = await Promise.all(['one', 'two'].map(content => f.request('diary/entry', { date: day, content, expectedContent: 'today', expectedUpdatedAt: receipt.updatedAt })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
});

test('stale snapshot preserves other clients additions and edits to different fields', async () => {
  const f = fixture({ tasks: [{ id: 1, title: 'Old', status: 'todo' }], books: [], notes: [], updates: [] });
  const base = await (await f.request('data')).json();
  await f.request('tasks/update', { id: 1, status: 'completed' });
  await f.request('tasks/add', { title: 'New from Mac' });
  const next = { ...base, tasks: [{ ...base.tasks[0], title: 'From web' }], _base: base };
  const save = await f.request('data', next);
  assert.equal(save.status, 200);
  const data = (await save.json()).data;
  assert.equal(data.tasks.length, 2);
  assert.equal(data.tasks[0].title, 'From web');
  assert.equal(data.tasks[0].status, 'completed');
});

test('same-field snapshot conflict returns 409; no partial write or stale overwrite', async () => {
  const f = fixture({ tasks: [{ id: 1, title: 'Old' }], books: [], notes: [], updates: [] });
  const base = await (await f.request('data')).json();
  await f.request('tasks/update', { id: 1, title: 'Mac' });
  const response = await f.request('data', { tasks: [{ id: 1, title: 'Web' }], _base: base });
  assert.equal(response.status, 409);
  assert.equal((await (await f.request('data')).json()).tasks[0].title, 'Mac');
  assert.equal((await f.request('data', base)).status, 409);
  assert.equal((await f.request('data', { tasks: [] })).status, 409);
});

test('reading writes preserve tasks and manual records even with stale input', async () => {
  const f = fixture({ tasks: [{ id: 1, title: 'Keep task' }], books: [{ id: 2, source: 'study' }], notes: [{ id: 3, title: 'Keep note' }], updates: [] });
  await f.request('tasks/add', { title: 'Added during sync' });
  const response = await f.request('weread', { tasks: [], books: [{ id: 'wr1', source: 'weread' }], notes: [{ id: 'wr2', source: 'weread' }], wereadStats: { dailyReadTimes: [{ date: '2026-10-05', seconds: 120 }] } });
  assert.equal(response.status, 200);
  await f.request('weread', { wereadStats: { dailyReadTimes: [{ date: '2026-10-05', seconds: 30 }] } });
  const data = await (await f.request('data')).json();
  assert.equal(data.tasks.length, 2);
  assert.equal(data.books.length, 2);
  assert.equal(data.notes.length, 2);
  assert.equal(data.wereadStats.dailyReadTimes[0].seconds, 120);
});

test('diary version check closes the race between preflight GET and POST', async () => {
  const f = fixture();
  const initial = await (await f.request('diary')).json();
  const first = await f.request('diary', { today: { ...initial.today, content: 'Mac' }, expectedUpdatedAt: initial.today.updatedAt });
  assert.equal(first.status, 200);
  const acknowledged = (await first.json()).today;
  assert.ok(acknowledged.updatedAt);
  const conflict = await f.request('diary', { today: { ...initial.today, content: 'Old draft' }, expectedUpdatedAt: initial.today.updatedAt });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).today.content, 'Mac');
  assert.equal((await (await f.request('diary')).json()).today.content, 'Mac');
  assert.equal((await f.request('diary', { today: { ...acknowledged, content: 'Chosen override' }, expectedUpdatedAt: '', overwriteConflict: true })).status, 200);
});

test('Cron shares the state coordinator; completed tasks cannot reappear from KV', async () => {
  const f = fixture({ tasks: [{ id: 1, title: 'Done', status: 'completed' }, { id: 2, title: 'Open', status: 'todo' }], books: [], notes: [], updates: [] });
  const scheduled = [];
  await worker.scheduled({ cron: "0 * * * *" }, f.env, { waitUntil: work => scheduled.push(work) });
  await Promise.all(scheduled);
  assert.deepEqual((await (await f.request('data')).json()).tasks.map(item => item.id), [2]);
  const restarted = new TaskState({ storage: f.storage }, f.env);
  f.env.TASKS_STATE.get = () => restarted;
  assert.deepEqual((await (await f.request('data')).json()).tasks.map(item => item.id), [2]);
});

test('unauthorized requests never initialize or read personal data', async () => {
  const f = fixture();
  const response = await worker.fetch(new Request('https://example.test/tasks/api/data'), f.env);
  assert.equal(response.status, 401);
  assert.equal(f.storage.values.size, 0);
});

test('failed migration leaves original KV and migration marker intact', async () => {
  const f = fixture();
  f.originals.set('diary_data', 'corrupt');
  const response = await f.request('data');
  assert.equal(response.status, 500);
  assert.equal(await f.storage.get('migration_complete'), undefined);
  assert.equal(f.storage.values.size, 0);
  assert.equal(f.originals.get('diary_data'), 'corrupt');
});


test('large multilingual documents migrate losslessly and shrink without stale chunks', async () => {
  const content = '长日记🙂'.repeat(240000);
  const f = fixture({ tasks: [], books: [], notes: [{ id: 1, summary: content }], updates: [] });
  const initial = (await (await f.request('data')).json());
  assert.equal(initial.notes[0].summary, content);
  assert.ok(await f.storage.get('app_data:chunks'));
  const original = await f.state.readStored(f.storage, 'migration_original:app_data');
  assert.equal(JSON.parse(original).notes[0].summary, content);
  const response = await f.request('notes/delete', { id: 1 });
  assert.equal(response.status, 200);
  assert.equal(await f.storage.get('app_data:chunks'), undefined);
  assert.equal(await f.storage.get('app_data:chunk:0'), undefined);
  assert.equal((await (await f.request('data')).json()).notes.length, 0);
});


test('lightweight sync revision stays stable on reads and changes after app or diary saves', async () => {
  const f = fixture();
  const initial = (await (await f.request('sync-state')).json()).revision;
  await f.request('data');
  assert.equal((await (await f.request('sync-state')).json()).revision, initial);
  await f.request('tasks/add', { title: 'New' });
  const changed = (await (await f.request('sync-state')).json()).revision;
  assert.ok(changed > initial);
  const diary = await (await f.request('diary')).json();
  const beforeDiary = (await (await f.request('sync-state')).json()).revision;
  await f.request('diary', { today: { ...diary.today, content: 'New diary' }, expectedUpdatedAt: diary.today.updatedAt });
  assert.ok((await (await f.request('sync-state')).json()).revision > beforeDiary);
});

test('capability rollout wakes existing revision-only clients without modifying business documents', async () => {
  const f = fixture();
  const before = await (await f.request('data')).json();
  const diaryBefore = await (await f.request('diary')).json();
  const previous = (await (await f.request('sync-state')).json()).revision;
  await f.storage.put('sync_capabilities', JSON.stringify({ readingWriteVersion: 1, diaryEntryWriteVersion: 1, diarySyncVersion: 0 }));
  const updated = await (await f.request('sync-state')).json();
  assert.equal(updated.revision, previous + 1);
  assert.equal(updated.diarySyncVersion, 1);
  assert.deepEqual(await (await f.request('data')).json(), before);
  assert.deepEqual(await (await f.request('diary')).json(), diaryBefore);
  const restarted = new TaskState({ storage: f.storage }, f.env);
  f.env.TASKS_STATE.get = () => restarted;
  assert.equal((await (await f.request('sync-state')).json()).revision, updated.revision);
  await f.storage.delete('sync_capabilities'); // Existing deployed objects have no marker.
  assert.equal((await (await f.request('sync-state')).json()).revision, updated.revision + 1);
  assert.equal((await (await f.request('sync-state')).json()).revision, updated.revision + 1);
});

test('failed requests cannot acknowledge or repeatedly advance a capability rollout', async () => {
  const f = fixture();
  await f.request('data');
  const previous = await f.storage.get('sync_version');
  await f.storage.delete('sync_capabilities');
  assert.equal((await f.request('tasks/update', { id: 999, title: 'Missing' })).status, 404);
  assert.equal(await f.storage.get('sync_capabilities'), undefined);
  assert.equal(await f.storage.get('sync_version'), previous);
  assert.equal((await (await f.request('sync-state')).json()).revision, previous + 1);
});


test('legacy diary clients can save repeatedly with the original GET timestamp', async () => {
  const f = fixture();
  const initial = await (await f.request('diary')).json();
  await f.request('diary', { today: { ...initial.today, content: 'First' } });
  await f.request('diary', { today: { ...initial.today, content: 'Second', updatedAt: '2000-01-01T00:00:00.000Z' } });
  assert.equal((await (await f.request('diary')).json()).today.content, 'Second');
});


test('two simultaneous diary saves from one baseline allow exactly one writer', async () => {
  const f = fixture();
  const initial = await (await f.request('diary')).json();
  const results = await Promise.all(['One', 'Two'].map(content => f.request('diary', {
    today: { ...initial.today, content }, expectedUpdatedAt: initial.today.updatedAt,
  })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
});

test('mini-program browsing metadata never replaces a newer Mac diary body', async () => {
  const f = fixture();
  const initial = await (await f.request('diary')).json();
  const saved = await f.request('diary', {
    today: { ...initial.today, content: 'Mac update' },
    expectedUpdatedAt: initial.today.updatedAt,
    archive: [{ date: '2025-10-06', content: 'Cloud history' }],
  });
  const acknowledged = (await saved.json()).today;
  await f.request('diary', { archive: [{ date: '2025-10-06', viewCount: 2, lastViewedAt: '2026-10-06T10:00:00Z' }] });
  const remote = await (await f.request('diary')).json();
  assert.equal(remote.today.content, 'Mac update');
  assert.equal(remote.today.updatedAt, acknowledged.updatedAt);
  assert.equal(remote.archive[0].content, 'Cloud history');
  assert.equal(remote.archive[0].viewCount, 2);
});

test('protected reading edits merge different fields and reject concurrent changes to the same field', async () => {
  const original = { id: 1, title: 'Book', source: 'study', currentPage: 10, totalPage: 100, status: 'reading', notes: 'Old', projectId: 99 };
  const f = fixture({ tasks: [{ id: 9, title: 'Keep' }], books: [original], notes: [], updates: [] });
  const base = { title: 'Book', currentPage: 10, totalPage: 100, status: 'reading', notes: 'Old' };
  assert.equal((await (await f.request('sync-state')).json()).readingWriteVersion, 1);
  await f.request('books/update', { id: 1, notes: 'From another client' });
  const progress = await f.request('books/update', { id: 1, currentPage: 20, _base: base, _readingWriteVersion: 1 });
  assert.equal(progress.status, 200);
  const book = (await progress.json()).book;
  assert.equal(book.notes, 'From another client');
  assert.equal(book.projectId, 99);
  assert.equal(book.currentPage, 20);
  assert.equal(book._base, undefined);
  assert.equal(book._readingWriteVersion, undefined);
  const before = (await (await f.request('sync-state')).json()).revision;
  const attempts = await Promise.all([30, 40].map(currentPage => f.request('books/update', {
    id: 1, currentPage, _base: { ...base, currentPage: 20 }, _readingWriteVersion: 1,
  })));
  assert.deepEqual(attempts.map(response => response.status).sort(), [200, 409]);
  assert.equal((await (await f.request('sync-state')).json()).revision, before + 1);
  assert.equal((await (await f.request('data')).json()).tasks[0].title, 'Keep');
});

test('protected note update and delete retain newer cloud content on conflict', async () => {
  const original = { id: 1, title: 'Note', summary: 'Original', tags: [], projectId: 99 };
  const base = { title: 'Note', summary: 'Original', tags: [], bookId: null };
  const f = fixture({ tasks: [], books: [], notes: [original], updates: [] });
  await f.request('notes/update', { id: 1, summary: 'New cloud text' });
  assert.equal((await f.request('notes/update', { id: 1, summary: 'Old draft', _base: base, _readingWriteVersion: 1 })).status, 409);
  assert.equal((await f.request('notes/delete', { id: 1, _base: base, _readingWriteVersion: 1 })).status, 409);
  assert.equal((await f.request('notes/update', { id: 1, title: 'My title', _base: base, _readingWriteVersion: 1 })).status, 200);
  const note = (await (await f.request('data')).json()).notes[0];
  assert.equal(note.summary, 'New cloud text');
  assert.equal(note.projectId, 99);
  assert.equal((await f.request('notes/delete', { id: 1, _base: { ...base, title: 'My title', summary: 'New cloud text' }, _readingWriteVersion: 1 })).status, 200);
  assert.equal((await f.request('notes/update', { id: 1, summary: 'Resurrection', _base: base, _readingWriteVersion: 1 })).status, 404);
});

test('manual notes link by typed book ID; mixed source IDs cannot corrupt new local IDs', async () => {
  const f = fixture({ tasks: [], books: [{ id: 1, title: 'Local' }, { id: '1', title: 'WeRead', source: 'weread' }],
    notes: [{ id: 'wr1', source: 'weread', title: 'Highlight' }], updates: [] });
  const created = (await (await f.request('notes/add', { title: 'Mine', bookId: 1 })).json()).note;
  assert.equal(created.id, 1);
  assert.equal(created.bookTitle, 'Local');
  await f.request('books/update', { id: 1, title: 'Renamed local' });
  assert.equal((await (await f.request('data')).json()).notes.find(note => note.id === 1).bookTitle, 'Renamed local');
  const linked = await f.request('notes/update', { id: 1, bookId: '1', _readingWriteVersion: 1,
    _base: { title: 'Mine', summary: '', tags: [], bookId: 1 } });
  assert.equal((await linked.json()).note.bookTitle, 'WeRead');
  const unlinked = await f.request('notes/update', { id: 1, bookId: null, _readingWriteVersion: 1,
    _base: { title: 'Mine', summary: '', tags: [], bookId: '1' } });
  assert.equal((await unlinked.json()).note.bookId, null);
  assert.equal((await f.request('notes/add', { title: 'Missing', bookId: 404 })).status, 409);
  assert.equal((await f.request('books/update', { id: '1', currentPage: 10 })).status, 403);
  assert.equal((await f.request('notes/delete', { id: 'wr1' })).status, 403);
});

test('missing baseline fields never bypass protected edits and stale deletes', async () => {
  const f = fixture({ tasks: [], books: [{ id: 1, title: 'Keep' }], notes: [], updates: [] });
  assert.equal((await f.request('books/update', { id: 1, title: 'Unsafe', _base: {}, _readingWriteVersion: 1 })).status, 400);
  assert.equal((await f.request('books/delete', { id: 1, _base: { title: 'Keep' }, _readingWriteVersion: 1 })).status, 400);
  assert.equal((await (await f.request('data')).json()).books.length, 1);
});

test('three-way text merge preserves independent Unicode edits, raw whitespace and deliberate clears', () => {
  assert.deepEqual(mergeDiaryText('第一句\n第二句', '第一句改了\n第二句', '第一句\n第二句改了'), { content: '第一句改了\n第二句改了', conflict: false });
  assert.deepEqual(mergeDiaryText('abc def ghi', 'ABC def ghi', 'abc def GHI'), { content: 'ABC def GHI', conflict: false });
  assert.deepEqual(mergeDiaryText('😀\r\n正文  ', '😺\r\n正文  ', '😀\r\n新增正文  '), { content: '😺\r\n新增正文  ', conflict: false });
  assert.equal(mergeDiaryText('old', '', 'old').content, '');
  assert.equal(mergeDiaryText('old', 'ours', 'theirs').conflict, true);
  assert.equal(mergeDiaryText(null, 'legacy', 'cloud').conflict, true);
  assert.equal(mergeDiaryText('x'.repeat(2000), 'a'.repeat(2000), 'b'.repeat(2000)).conflict, true);
});

async function diarySyncFixture(content = 'First line\nSecond line') {
  const f = fixture();
  const today = (await (await f.request('diary')).json()).today;
  const first = { operationId: 'initial-op-123', date: today.date, content, baseContent: '', baseUpdatedAt: '', source: 'web' };
  assert.equal((await f.request('diary/sync', first)).status, 200);
  const entry = (await (await f.request('diary')).json()).today;
  return { ...f, entry };
}

test('all three clients merge independent edits and preserve overlapping versions without a 409', async () => {
  const f = await diarySyncFixture();
  const save = (source, operationId, content) => f.request('diary/sync', { source, operationId, content, date: f.entry.date, baseContent: f.entry.content, baseUpdatedAt: f.entry.updatedAt });
  assert.equal((await save('apple', 'apple-op-123', 'Mac line\nSecond line')).status, 200);
  const merged = await (await save('web', 'web-op-123', 'First line\nWeb line')).json();
  assert.equal(merged.entry.content, 'Mac line\nWeb line'); assert.equal(merged.outcome, 'merged');
  const conflicting = await (await save('miniprogram', 'mini-op-123', 'Phone line\nSecond line')).json();
  assert.equal(conflicting.entry.content, 'Phone line\nSecond line'); assert.equal(conflicting.outcome, 'preserved');
  const versions = await (await f.request(`diary/versions?date=${f.entry.date}`)).json();
  assert.ok(versions.versions.some(v => v.content === 'Mac line\nWeb line'));
  assert.ok(versions.versions.some(v => v.content === 'Phone line\nSecond line'));
});

test('lost sync responses replay the same receipt and never revert a later client write', async () => {
  const f = await diarySyncFixture('Original');
  const operation = { source: 'apple', operationId: 'lost-receipt-123', date: f.entry.date, content: 'Mac', baseContent: 'Original', baseUpdatedAt: f.entry.updatedAt };
  const first = await (await f.request('diary/sync', operation)).json();
  await f.request('diary/sync', { ...operation, operationId: 'next-write-123', source: 'web', content: 'Later web', baseContent: 'Mac', baseUpdatedAt: first.entry.updatedAt });
  const replay = await (await f.request('diary/sync', operation)).json();
  assert.deepEqual(replay, first);
  assert.equal((await (await f.request('diary')).json()).today.content, 'Later web');
  assert.equal((await f.request('diary/sync', { ...operation, content: 'Changed under reused ID' })).status, 400);
});

test('version backup failure rolls back the body and replay receipt', async () => {
  const f = await diarySyncFixture('Before');
  const originalPut = f.storage.put.bind(f.storage);
  f.storage.put = async (key, value) => { if (key.startsWith('diary_version:')) throw new Error('Disk failure'); return originalPut(key, value); };
  const response = await f.request('diary/sync', { source: 'web', operationId: 'failure-op-123', date: f.entry.date, content: 'After', baseContent: 'Before', baseUpdatedAt: f.entry.updatedAt });
  assert.equal(response.status, 500);
  assert.equal((await (await f.request('diary')).json()).today.content, 'Before');
  assert.equal(await f.storage.get('diary_operation:failure-op-123'), undefined);
});

test('unuploaded pre-05:00 drafts create their original date and unknown baselines retain both bodies', async () => {
  const f = await diarySyncFixture('Cloud');
  const legacy = await (await f.request('diary/sync', { source: 'apple', operationId: 'legacy-op-123', date: f.entry.date, content: 'Legacy', baseContent: null, baseUpdatedAt: '' })).json();
  assert.equal(legacy.outcome, 'preserved');
  const older = await f.request('diary/sync', { source: 'miniprogram', operationId: 'rollover-op-123', date: '2020-01-03', content: 'Before rollover', baseContent: '', baseUpdatedAt: '' });
  assert.equal(older.status, 200);
  assert.equal((await (await f.request('diary')).json()).today.content, 'Legacy');
  assert.equal((await (await f.request('diary')).json()).archive.find(e => e.date === '2020-01-03').content, 'Before rollover');
});

test('concurrent automatic writers retain every submitted raw body and survive restart', async () => {
  const f = await diarySyncFixture('Base');
  const operations = Array.from({ length: 12 }, (_, i) => ({ source: ['apple', 'web', 'miniprogram'][i % 3],
    operationId: `concurrent-op-${i}`, date: f.entry.date, content: ` Writer ${i}\n\n `, baseContent: 'Base', baseUpdatedAt: f.entry.updatedAt }));
  const responses = await Promise.all(operations.map(op => f.request('diary/sync', op)));
  assert.ok(responses.every(response => response.status === 200));
  f.env.TASKS_STATE.get = () => new TaskState({ storage: f.storage }, f.env);
  const page = await (await f.request(`diary/versions?date=${f.entry.date}`)).json();
  for (const operation of operations) assert.ok(page.versions.some(version => version.content === operation.content));
  const head = (await (await f.request('diary')).json()).today.content;
  await Promise.all(operations.map(op => f.request('diary/sync', op)));
  assert.equal((await (await f.request('diary')).json()).today.content, head);
});

test('version pages remain stable when newer versions arrive and restoration backs up the current head', async () => {
  const f = await diarySyncFixture('Initial');
  const put = async i => f.request('diary/sync', { source: 'web', operationId: `pagination-operation-${i}`, date: f.entry.date,
    content: `Version ${i}`, baseContent: null, baseUpdatedAt: '' });
  for (let i = 0; i < 25; i++) await put(i);
  const first = await (await f.request(`diary/versions?date=${f.entry.date}`)).json();
  assert.equal(first.versions.length, 20); assert.ok(first.nextCursor > 0);
  await put(26);
  const next = await (await f.request(`diary/versions?date=${f.entry.date}&cursor=${first.nextCursor}`)).json();
  const all = first.versions.concat(next.versions);
  assert.equal(new Set(all.map(v => v.id)).size, all.length);
  assert.ok(all.some(v => v.content === 'Initial')); assert.ok(all.some(v => v.content === 'Version 0'));
  assert.equal((await f.request(`diary/versions?date=${f.entry.date}&cursor=999999`)).status, 400);
  await f.request('diary/sync', { source: 'apple', operationId: 'restore-operation-123', date: f.entry.date,
    content: 'Initial', baseContent: null, baseUpdatedAt: '' });
  assert.equal((await (await f.request('diary')).json()).today.content, 'Initial');
  const restored = await (await f.request(`diary/versions?date=${f.entry.date}`)).json();
  assert.ok(restored.versions.some(v => v.content === 'Version 26'));
});

test('receipt storage failure rolls back all version snapshots and the canonical write', async () => {
  const f = await diarySyncFixture('Original'); const snapshot = new Map(f.storage.values);
  const put = f.storage.put.bind(f.storage);
  f.storage.put = async (key, value) => { if (key === 'diary_operation:journal-failure-123') throw new Error('Full storage'); return put(key, value); };
  const result = await f.request('diary/sync', { source: 'web', operationId: 'journal-failure-123', date: f.entry.date,
    content: 'Must not appear', baseContent: 'Original', baseUpdatedAt: f.entry.updatedAt });
  assert.equal(result.status, 500); assert.deepEqual(f.storage.values, snapshot);
});

test('missing TaskState binding fails closed for every data API and Cron, never exposing obsolete KV', async () => {
  const f = fixture(); const noAtomic = { ...f.env, TASKS_STATE: null };
  const get = path => worker.fetch(new Request(`https://example.test/tasks/api/${path}`, { headers: { Authorization: 'Bearer test' } }), noAtomic);
  for (const route of ['diary', 'data', 'essays', 'sync-state']) assert.equal((await get(route)).status, 503);
  const write = await worker.fetch(new Request('https://example.test/tasks/api/diary/sync', { method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: '{}' }), noAtomic);
  assert.equal(write.status, 503);
  await assert.rejects(worker.scheduled({ cron: '0 * * * *' }, noAtomic, { waitUntil() { throw new Error('Must not run reset'); } }), /TaskState binding is required/);
  const unauthorized = await worker.fetch(new Request('https://example.test/tasks/api/diary/versions?date=2026-10-07'), f.env);
  assert.equal(unauthorized.status, 401);
});
