import { formatLocalDateKey, toIsoDateKey, getWereadProgressPercent, formatReadDuration } from '../src/features/reading/model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { bookWrite, bookFields, ReadingController } from '../src/features/reading/writes.mjs';
import { createJSONStorage } from '../src/core/storage.mjs';
import { memoryStorage } from './helpers.mjs';

const book = () => ({ id: 1, source: 'study', title: 'Original', currentPage: 10, totalPage: 100, status: 'reading', notes: 'Notes' });
function fixture(request) {
  const workspace = { data: { books: [book()] }, acceptReading(receipt, id) { this.data.books = receipt.book ? [receipt.book] : this.data.books.filter(item => item.id !== id); }, async refresh() { this.refreshed = true; } };
  const drafts = createJSONStorage(memoryStorage(), 'reading');
  return { controller: new ReadingController({ workspace, request, drafts }), workspace, drafts };
}
test('renaming a stale book transmits only title and baseline, never old reading pages', () => {
  const original = book(), fields = { ...bookFields(original), title: 'New name' }, payload = bookWrite({ original, fields });
  assert.equal(payload.title, 'New name'); assert.equal('currentPage' in payload, false); assert.equal(payload._base.currentPage, 10); assert.equal(payload._readingWriteVersion, 1);
});
test('book pages reject negatives, decimals, unsafe numbers and current greater than total', () => {
  for (const pages of [['-1','100'], ['1.5','100'], ['101','100'], ['9007199254740992','0']]) assert.throws(() => bookWrite({ original: book(), fields: { ...bookFields(book()), currentPage: pages[0], totalPage: pages[1] } }));
});
test('create publishes only confirmed numeric server ID even with mixed source book IDs', async () => {
  const f = fixture(async path => path === '/api/sync-state' ? { readingWriteVersion: 1 } : { ok: true, book: { ...book(), id: 9 } });
  f.workspace.data.books.push({ id: 'wr_abc', source: 'weread' }); f.controller.open(); f.controller.edit('title', 'New');
  assert.equal(await f.controller.save(), true); assert.equal(f.workspace.data.books[0].id, 9); assert.equal(f.controller.state.editor, null);
});
test('failed book save keeps editor, baseline and persistent draft', async () => {
  const f = fixture(async () => { throw new Error('offline'); }); f.controller.open(book()); f.controller.edit('currentPage', '20');
  assert.equal(await f.controller.save(), false); assert.equal(f.controller.state.editor.fields.currentPage, '20'); assert.equal(f.drafts.read()['number:1'].original.currentPage, 10);
});
test('reading conflict preserves intentional changes when accepting latest cloud baseline', async () => {
  const f = fixture(async path => { if (path === '/api/sync-state') return { readingWriteVersion: 1 }; throw Object.assign(new Error('conflict'), { status: 409 }); });
  f.controller.open(book()); f.controller.edit('title', 'My new title'); f.workspace.data.books[0].currentPage = 50;
  await f.controller.save(); assert.equal(f.controller.state.conflict, true); f.controller.resolve();
  const editor = f.controller.state.editor; assert.equal(editor.fields.title, 'My new title'); assert.equal(editor.fields.currentPage, '50'); assert.equal(editor.original.currentPage, 50);
});
test('deletes carry captured full baseline and a conflict does not remove the book', async () => {
  let sent;
  const f = fixture(async (path, options) => { if (path === '/api/sync-state') return { readingWriteVersion: 1 }; sent = JSON.parse(options.body); throw Object.assign(new Error('conflict'), { status: 409 }); });
  f.controller.requestDelete(book()); assert.equal(await f.controller.deleteBook(), false);
  assert.equal(f.workspace.data.books.length, 1); assert.equal(sent._base.currentPage, 10); assert.equal(sent._readingWriteVersion, 1);
});
test('unsupported reading protection never falls back to an unprotected write', async () => {
  const paths = [], f = fixture(async path => { paths.push(path); return {}; }); f.controller.open(book()); f.controller.edit('title', 'New');
  await f.controller.save(); assert.deepEqual(paths, ['/api/sync-state']); assert.match(f.controller.state.error, /编辑保护/);
});
test('closing edited book requires choosing keep draft or discard, and reopening restores baseline', () => {
  const f = fixture(async () => {}); f.controller.open(book()); f.controller.edit('notes', 'My notes'); f.controller.close();
  assert.equal(f.controller.state.closing, true); f.controller.keepAndClose(); f.controller.open(book());
  assert.equal(f.controller.state.editor.fields.notes, 'My notes'); f.controller.discardAndClose(); assert.equal(f.drafts.read()['number:1'], undefined);
});

test('reading dates use Shanghai calendar days and progress falls back when source percentage is null', () => {
  assert.equal(formatLocalDateKey(new Date('2026-10-06T18:00:00Z')), '2026-10-07');
  assert.equal(toIsoDateKey('2026-10-06T18:00:00Z'), '2026-10-07');
  assert.equal(toIsoDateKey('2026-10-07 00:30:00'), '2026-10-07');
  assert.equal(getWereadProgressPercent({ progressPercent: null, currentPage: 50, totalPage: 100 }), 50);
  assert.equal(formatReadDuration(7199), '2小时');
});
