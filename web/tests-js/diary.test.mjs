import test from 'node:test';
import assert from 'node:assert/strict';
import { DiaryController } from '../src/features/diary/controller.mjs';
import { diaryDayKey } from '../src/features/diary/model.mjs';
import { diaryFixture, deferred, original, clone } from './helpers.mjs';

test('reading or leaving a clean diary sends no body write', async () => {
  const f = diaryFixture(); await f.controller.refresh(); await f.controller.flush();
  assert.deepEqual(f.requests.map(item => item.path), ['/api/diary']);
});
test('input persists raw text immediately; save carries body/version and only the original date', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.edit('  line one\n\n第二行  ');
  assert.equal(f.repository.read()['2026-10-07'].entry.content, '  line one\n\n第二行  ');
  assert.equal(await f.controller.save(), true);
  const body = JSON.parse(f.requests.at(-1).options.body);
  assert.deepEqual(body, { date: '2026-10-07', content: '  line one\n\n第二行  ', expectedContent: 'Original', expectedUpdatedAt: 'v1' });
  assert.equal(f.remote().today.tagScores.焦虑内耗, 4); assert.equal(f.repository.read()['2026-10-07'], undefined);
});
test('cross-client stale saves reject and preserve draft until an explicit resolution', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.edit('My web draft');
  f.cloud({ ...original(), today: { ...original().today, content: 'New Mac body', updatedAt: 'vMac' } });
  assert.equal(await f.controller.save(), false);
  assert.equal(f.remote().today.content, 'New Mac body'); assert.equal(f.controller.state.entry.content, 'My web draft');
  assert.equal(f.controller.state.conflict.content, 'New Mac body');
  assert.equal(await f.controller.keepDraft(), true); assert.equal(f.remote().today.content, 'My web draft');
  const body = JSON.parse(f.requests.at(-1).options.body);
  assert.equal(body.expectedContent, 'New Mac body'); assert.equal(body.expectedUpdatedAt, 'vMac'); assert.equal('overwriteConflict' in body, false);
});
test('choosing cloud drops only the conflicted draft and sends no extra save', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.edit('Web');
  f.cloud({ ...original(), today: { ...original().today, content: 'Mac', updatedAt: 'vMac' } });
  await f.controller.save(); const count = f.requests.length; f.controller.useCloud(); await f.controller.flush();
  assert.equal(f.controller.state.entry.content, 'Mac'); assert.equal(f.requests.length, count);
});
test('network failure retains draft, baseline and a working retry', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.edit('Draft');
  f.handler(() => { throw new Error('offline'); }); assert.equal(await f.controller.save(), false);
  assert.equal(f.repository.read()['2026-10-07'].baseUpdatedAt, 'v1'); assert.match(f.controller.state.error, /保存失败/);
  f.handler(null); assert.equal(await f.controller.save(), true); assert.equal(f.remote().today.content, 'Draft');
});
test('typing during save retains newer text and advances only through this writer receipt', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.edit('First');
  const gate = deferred(), started = deferred();
  f.handler(async () => { started.resolve(); await gate.promise; return { ok: true, entry: { ...original().today, content: 'First', updatedAt: 'v2' } }; });
  const saving = f.controller.save(); await started.promise; f.controller.edit('Second'); gate.resolve(); await saving;
  assert.equal(f.controller.state.entry.content, 'Second');
  const draft = f.repository.read()['2026-10-07']; assert.equal(draft.baseContent, 'First'); assert.equal(draft.baseUpdatedAt, 'v2');
});
test('queued edits advance their own baselines and duplicate leave/blur flushes coalesce', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.edit('First');
  const first = f.controller.save(); f.controller.edit('Second'); const second = f.controller.save();
  await Promise.all([first, second, f.controller.flush(), f.controller.flush()]);
  const writes = f.requests.filter(item => item.options?.method === 'POST'); assert.equal(writes.length, 2);
  assert.equal(JSON.parse(writes[1].options.body).expectedContent, 'First'); assert.equal(f.remote().today.content, 'Second');
});
test('recovering a draft validates its original baseline before automatic upload', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.edit('Recovered');
  const restored = new DiaryController(f.options); assert.equal(await restored.save(), false);
  f.cloud({ ...original(), today: { ...original().today, content: 'Mac while closed', updatedAt: 'vMac' } });
  await restored.refresh(); assert.equal(restored.state.entry.content, 'Recovered'); assert.equal(restored.state.conflict.content, 'Mac while closed');
});
test('late receipt from unloaded editor never deletes the reopened newer draft', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.edit('First');
  const gate = deferred(), started = deferred(); f.handler(async () => { started.resolve(); return gate.promise; });
  const saving = f.controller.save(); await started.promise; f.controller.dispose();
  const reopened = new DiaryController(f.options); reopened.edit('New in reopened editor');
  gate.resolve({ ok: true, entry: { ...original().today, content: 'First', updatedAt: 'v2' } }); await saving;
  const persisted = f.repository.read()['2026-10-07']; assert.equal(persisted.entry.content, 'New in reopened editor'); assert.equal(persisted.baseContent, 'First');
});
test('a slow refresh preserves input entered after the request began', async () => {
  const f = diaryFixture(); await f.controller.refresh(); const gate = deferred(), started = deferred();
  f.handler(() => { started.resolve(); return gate.promise; }); const refresh = f.controller.refresh(); await started.promise;
  f.controller.edit('Typed during GET'); gate.resolve(clone(original())); await refresh;
  assert.equal(f.controller.state.entry.content, 'Typed during GET'); assert.equal(f.controller.state.conflict, null);
});
test('05:00 rollover retains and saves yesterday draft under yesterday date', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.edit('Yesterday draft');
  const next = { today: { date: '2026-10-08', content: '', updatedAt: '' }, archive: [original().today] };
  f.cloud(next); await f.controller.refresh(); assert.equal(f.controller.state.entry.date, '2026-10-08');
  await f.controller.flush(); assert.equal(f.remote().today.content, ''); assert.equal(f.remote().archive[0].content, 'Yesterday draft');
  assert.equal(diaryDayKey(new Date('2026-10-08T04:59:59+08:00')), '2026-10-07');
  assert.equal(diaryDayKey(new Date('2026-10-08T05:00:00+08:00')), '2026-10-08');
});
test('history editing and deliberate empty saves preserve date and other entries', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.select('2026-10-06'); f.controller.edit('');
  await f.controller.save(); assert.equal(f.remote().archive[0].content, ''); assert.equal(f.remote().today.content, 'Original');
});
test('storage failure is distinct from network failure and does not silently discard input', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.storage.setItem = () => { throw new Error('quota'); };
  f.controller.edit('Long draft'); assert.match(f.controller.state.storageError, /未能保存/); assert.equal(f.controller.state.entry.content, 'Long draft');
});
test('large leave-save does not exceed keepalive body quota; local draft remains available', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.edit('长'.repeat(30000)); await f.controller.flush();
  assert.equal(f.requests.at(-1).options.keepalive, undefined); assert.equal(f.remote().today.content.length, 30000);
});
test('missing dated write endpoint stops safely without legacy downgrade', async () => {
  const f = diaryFixture(); await f.controller.refresh(); f.controller.edit('Draft');
  f.handler(() => { throw Object.assign(new Error('missing'), { status: 404 }); }); await f.controller.save();
  assert.equal(f.repository.read()['2026-10-07'].entry.content, 'Draft'); assert.match(f.controller.state.error, /按日期保存/);
  assert.equal(f.requests.some(item => item.path === '/api/diary' && item.options?.method === 'POST'), false);
});

test('diary timer callbacks use their native receiver instead of the controller', async () => {
  const f = diaryFixture();
  const c = new DiaryController({ ...f.options, schedule: function () { assert.equal(this, undefined); return 1; }, cancel: function () { assert.equal(this, undefined); } });
  await c.refresh(); c.edit('Timer regression'); assert.equal(await c.save(), true);
});
