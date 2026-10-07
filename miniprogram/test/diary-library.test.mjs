import test from 'node:test'
import assert from 'node:assert/strict'
import { diaryExcerpt, diaryEntries, filterDiaryEntries, diaryListRows } from '../src/features/diary/presentation.mjs'
import { runtime, settle, event, ORIGINAL } from './helpers/native-runtime.mjs'

const archive = Array.from({ length: 63 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 6 - i)).toISOString().slice(0, 10), content: `记录 ${i}\n\n完整正文 `.repeat(30), tags: i === 30 ? ['安静恢复'] : [] }))

test('diary previews compact display only, while filtering searches the full body and tags', () => {
  const text = '  【今天的标题】\r\n\r\n正文   不变\n'
  const diary = { ...ORIGINAL, archive: [{ date: '2025-04-26', content: text, tags: ['安静恢复'] }] }
  assert.equal(diaryExcerpt(text), '今天的标题 正文 不变')
  assert.equal(diary.archive[0].content, text)
  const entries = diaryEntries(diary)
  assert.equal(entries[0].date, ORIGINAL.today.date)
  assert.equal(filterDiaryEntries(entries, '2025 恢复')[0].content, text)
  assert.equal(filterDiaryEntries(entries, '', '2025-04-26').length, 1)
  assert.equal(filterDiaryEntries(entries, '不存在').length, 0)
  const rows = diaryListRows(entries, 1)
  assert.equal(rows.length, 1); assert.equal('content' in rows[0], false)
})

test('all diary browsing paginates bounded excerpts, filters dates, and restores the complete list', async () => {
  const env = runtime({ ...ORIGINAL, archive }), page = env.mount('diary-history')
  page.onShow(); await settle()
  assert.equal(page.data.total, 64); assert.equal(page.data.rows.length, 24)
  assert.ok(page.data.rows.every(row => !('content' in row) && row.excerpt.length <= 121))
  page.loadMore(); assert.equal(page.data.rows.length, 48)
  page.onReachBottom(); assert.equal(page.data.rows.length, 64); assert.equal(page.data.hasMore, false)
  page.inputSearch(event({}, '安静恢复')); env.timerTick()
  assert.equal(page.data.count, 1); assert.equal(page.data.rows[0].date, archive[30].date)
  page.clearSearch(); page.selectDate(event({}, archive[50].date))
  assert.equal(page.data.count, 1); assert.equal(page.data.rows[0].date, archive[50].date)
  page.inputSearch(event({}, '不存在')); env.timerTick(); assert.equal(page.data.count, 0)
  page.resetFilters(); assert.equal(page.data.rows.length, 24); assert.equal(page.data.count, 64)
  page.onHide(); page.onUnload(); assert.equal(env.writes.length, 0)
})

test('opening history and its reader never takes draft ownership or sends a cached body', async () => {
  const env = runtime({ ...ORIGINAL, archive }), editor = env.mount('diary')
  await editor._controller.refresh(); editor.edit(event({}, 'Phone draft'))
  const owner = env.storage.get('diary_draft_v1').owner
  editor.openHistory(); assert.equal(env.navigations[0], '/pages/diary-history/index')
  await settle()
  const history = env.mount('diary-history'); history.onShow(); await settle()
  history.openEntry(event({ date: archive[20].date }))
  assert.ok(env.navigations[1].includes('source=history'))
  const reader = env.mount('diary-reader', { date: archive[20].date, source: 'history' })
  reader.onShow(); await settle()
  assert.equal(reader.data.entry.content, archive[20].content)
  reader.onHide(); reader.onUnload(); history.onHide(); history.onUnload()
  // The only body submitted is the editor's own explicit change.
  assert.equal(env.writes.filter(write => write.today).length, 1)
  assert.ok(env.writes.filter(write => write.archive).every(write => write.archive.every(entry => !('content' in entry))))
  editor.edit(event({}, 'Still owned by editor'))
  assert.equal(env.storage.get('diary_draft_v1').owner, owner)
  editor.onHide(); editor.onUnload(); await settle()
})

test('focus and done preserve the editor and flush one automatic save', async () => {
  const env = runtime(), page = env.mount('diary'); await page._controller.refresh()
  const { componentDefinition } = env.load('components/diary-editor/index.js')
  const component = { data: {}, setData(patch) { Object.assign(this.data, patch) }, triggerEvent(name, detail) { if (name === 'writing') page.writingChanged({ detail }); if (name === 'finish') page.finish() } }
  componentDefinition.methods.focus.call(component)
  assert.equal(page.data.writing, true)
  page.edit(event({}, 'Typing safely'))
  componentDefinition.methods.finish.call(component); await settle()
  assert.equal(page.data.writing, false); assert.equal(page.data.today.content, 'Typing safely')
  assert.equal(env.writes.filter(write => write.today).length, 1)
  page.openReader(); assert.equal(env.navigations.length, 0)
  page.onHide(); page.onUnload()
})

test('reader keeps exact whitespace, refreshes Mac history updates, and survives read failures', async () => {
  const text = '  【原文】\r\n\r\n\n---\r\n尾部  '
  const item = { date: '2026-10-06', content: text }
  const env = runtime({ ...ORIGINAL, archive: [item, archive[1]] })
  const reader = env.mount('diary-reader', { date: item.date }); reader.onShow(); await settle()
  assert.equal(reader.data.entry.content, text); assert.equal(env.writes.length, 0)
  env.setCloud({ ...ORIGINAL, archive: [{ ...item, content: 'Mac revised history' }, archive[1]] })
  await reader._library.refresh(); assert.equal(reader.data.entry.content, 'Mac revised history')
  env.fail('diary'); await reader._library.refresh()
  assert.equal(reader.data.failed, true); assert.equal(reader.data.entry.content, 'Mac revised history')
  env.fail(undefined); reader.next(); await settle(); assert.equal(reader.data.canGoBack, true)
  reader.back(); await settle(); assert.equal(reader.data.entry.date, item.date)
  assert.ok(env.writes.every(write => !write.today && write.archive.every(entry => !('content' in entry))))
  reader.onHide(); reader.onUnload()
})

test('a history request finishing after unload cannot update the old page or a draft', async () => {
  const env = runtime({ ...ORIGINAL, archive }), page = env.mount('diary-history')
  let resolve
  env.setGet(() => new Promise(done => { resolve = done }))
  page.onShow(); await settle(); page.onHide(); page.onUnload()
  const patches = page.patches.length
  resolve({ ...ORIGINAL, archive }); await settle()
  assert.equal(page.patches.length, patches); assert.equal(env.writes.length, 0)
})
