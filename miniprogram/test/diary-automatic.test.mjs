import test from 'node:test'
import assert from 'node:assert/strict'
import { runtime, settle, event } from './helpers/native-runtime.mjs'
const initial = () => ({ syncVersion: 1, today: { date: '2026-10-07', content: 'first\nsecond', updatedAt: '2026-10-07T00:00:00Z' }, archive: [] })
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }

test('native diary recovers network and local storage failures using timers without a save button', async () => {
  const env = runtime(initial()), page = env.mount('diary'); await page._controller.refresh()
  page.edit(event({}, 'Automatic offline retry'))
  env.fail('diary/sync'); await env.timerTick(); await settle()
  assert.equal(page.data.saveStatus, 'error'); assert.ok(env.timers.size)
  env.fail(undefined); await env.timerTick(); await settle()
  assert.equal(env.cloud().today.content, 'Automatic offline retry'); assert.equal(page._controller.dirty, false)
  const writeStorage = env.wx.setStorageSync
  env.wx.setStorageSync = () => { throw new Error('Storage temporarily unavailable') }
  page.edit(event({}, 'Automatic storage retry')); await env.timerTick(); await settle()
  assert.equal(page.data.saveStatus, 'storage-error'); assert.ok(env.timers.size)
  assert.equal(env.cloud().today.content, 'Automatic offline retry')
  env.wx.setStorageSync = writeStorage; await env.timerTick(); await settle()
  assert.equal(env.cloud().today.content, 'Automatic storage retry'); assert.equal(page._controller.dirty, false)
})

test('native automatic sync merges independent edits and keeps raw conflicting versions without a prompt', async () => {
  const env = runtime(initial()), page = env.mount('diary'); await page._controller.refresh()
  page.edit(event({}, 'local first\nsecond'))
  env.setCloud({ ...initial(), today: { ...initial().today, content: 'first\nremote second' } })
  await page._controller.save()
  assert.equal(page.data.today.content, 'local first\nremote second'); assert.equal(page.data.conflict, null)
  assert.equal(env.writes[0].source, 'miniprogram')
  page.edit(event({}, 'conflicting local'))
  env.setCloud({ ...initial(), today: { ...initial().today, content: 'conflicting remote' } })
  await page._controller.save()
  const versions = env.mount('diary-versions', { date: '2026-10-07' }); await versions.ready
  assert.equal(page.data.conflict, null)
  assert.ok(versions.data.versions.some(v => v.content === 'conflicting remote'))
  assert.ok(versions.data.versions.some(v => v.content === 'conflicting local'))
})

test('native typing while a merged save settles preserves both the new input and remote additions', async () => {
  const env = runtime(initial()), page = env.mount('diary'); await page._controller.refresh()
  page.edit(event({}, 'local first\nsecond'))
  env.setCloud({ ...initial(), today: { ...initial().today, content: 'first\nremote second' } })
  const started = defer(), release = defer()
  env.setWrite(async (_, receipt) => { started.resolve(); await release.promise; return receipt })
  const saving = page._controller.save(); await started.promise
  page.edit(event({}, 'local first updated\nsecond')); release.resolve(); await saving
  assert.equal(page.data.today.content, 'local first updated\nsecond')
  env.setWrite(null); await page._controller.save()
  assert.equal(env.cloud().today.content, 'local first updated\nremote second')
})

test('native lost receipt persists the same operation across reopening and never reverts a later writer', async () => {
  const env = runtime(initial()), first = env.mount('diary'); await first._controller.refresh()
  first.edit(event({}, 'Saved before lost response'))
  env.setWrite(() => { throw new Error('lost receipt') }); await first._controller.save()
  const id = env.writes[0].operationId
  first.onUnload(); await settle(); env.setWrite(null)
  env.setCloud({ ...initial(), today: { ...initial().today, content: 'Later web write', updatedAt: '2099-01-01T00:00:00Z' } })
  const reopened = env.mount('diary'); await reopened._controller.refresh(); await reopened._controller.save()
  assert.equal(env.writes.at(-1).operationId, id)
  assert.equal(env.cloud().today.content, 'Later web write'); assert.equal(reopened.data.today.content, 'Later web write')
  assert.equal(reopened.data.conflict, null)
})

test('native versions restore exact whitespace and refuse to discard an unsaved current draft', async () => {
  const env = runtime(initial()), editor = env.mount('diary'); await editor._controller.refresh()
  editor.edit(event({}, '  preserved\n\n')); await editor._controller.save()
  editor.edit(event({}, 'current')); await editor._controller.save()
  const page = env.mount('diary-versions', { date: '2026-10-07' }); await page.ready
  const original = page.data.versions.find(v => v.content === '  preserved\n\n'); assert.ok(original)
  editor.edit(event({}, 'unsaved')); env.fail('diary/sync'); await page.restore(event({ id: original.id }))
  assert.match(page.data.error, /草稿/); assert.equal(env.cloud().today.content, 'current')
  env.fail(undefined); await page.restore(event({ id: original.id }))
  assert.equal(env.cloud().today.content, '  preserved\n\n'); assert.ok(env.navigations.includes('back'))
  await page.load(); assert.ok(page.data.versions.some(version => version.content === 'unsaved'))
})

test('failed native restoration can retry its own immutable operation and can be adopted on editor return', async () => {
  const env = runtime(initial()), editor = env.mount('diary'); await editor._controller.refresh()
  editor.edit(event({}, 'old version')); await editor._controller.save()
  editor.edit(event({}, 'current')); await editor._controller.save()
  const page = env.mount('diary-versions', { date: '2026-10-07' }); await page.ready
  const version = page.data.versions.find(v => v.content === 'old version')
  env.fail('diary/sync'); await page.restore(event({ id: version.id }))
  assert.ok(page.data.error); const id = page._restoreOperation.operationId
  env.fail(undefined); await page.restore(event({ id: version.id }))
  assert.equal(env.writes.at(-1).operationId, id); assert.equal(env.cloud().today.content, 'old version')
  editor.edit(event({}, 'updated')); await editor._controller.save()
  const next = env.mount('diary-versions', { date: '2026-10-07' }); await next.ready
  env.fail('diary/sync'); await next.restore(event({ id: version.id }))
  env.fail(undefined); await editor._controller.refresh()
  assert.equal(editor.data.today.content, 'old version'); assert.equal(editor._controller.dirty, true)
  await editor._controller.save(); assert.equal(env.cloud().today.content, 'old version')
})

test('native long version previews bound setData payload and restore the full original body', async () => {
  const env = runtime(initial()), editor = env.mount('diary'); await editor._controller.refresh()
  const text = '长'.repeat(40000) + '末尾'
  editor.edit(event({}, text)); await editor._controller.save()
  editor.edit(event({}, 'current')); await editor._controller.save()
  const page = env.mount('diary-versions', { date: '2026-10-07' }); await page.ready
  const preview = page.data.versions.find(v => v.shortened); assert.equal(preview.content.length, 1000)
  page.openBody(event({ id: preview.id })); assert.equal(page.data.bodyPages, 5); assert.equal(page.data.bodyPage.length, 10000)
  await page.restore(event({ id: preview.id })); assert.equal(env.cloud().today.content, text)
})

test('a delayed post-save read cannot regress the baseline confirmed by a newer native save', async () => {
  const env = runtime(initial()), page = env.mount('diary'); await page._controller.refresh()
  let reads = 0; const started = defer(), release = defer()
  env.setGet(async () => {
    const snapshot = env.cloud()
    if (++reads === 1) { started.resolve(); await release.promise }
    return snapshot
  })
  page.edit(event({}, 'First submitted')); const first = page._controller.save(); await started.promise
  page.edit(event({}, 'Second submitted')); const second = page._controller.save()
  release.resolve(); await Promise.all([first, second])
  assert.equal(page._controller.baseContent, 'Second submitted')
  assert.equal(page.data.today.content, 'Second submitted'); assert.equal(page._controller.dirty, false)
})

test('overlapping native saves generate the second operation only after acknowledging the first submitted body', async () => {
  const env = runtime(initial()), page = env.mount('diary'); await page._controller.refresh()
  env.setCloud({ ...initial(), today: { ...initial().today, content: 'first\nremote second' } })
  const started = defer(), release = defer(); let writes = 0
  env.setWrite(async (_, receipt) => { if (++writes === 1) { started.resolve(); await release.promise }; return receipt })
  page.edit(event({}, 'alpha\nsecond')); const first = page._controller.save(); await started.promise
  page.edit(event({}, 'beta\nsecond')); const second = page._controller.save()
  // A newer keystroke must be durable while the original operation remains replayable.
  const durable = env.storage.get('diary_draft_v1')
  assert.equal(durable.today.content, 'beta\nsecond')
  assert.equal(durable.operation.content, 'alpha\nsecond')
  release.resolve(); await Promise.all([first, second])
  assert.equal(env.writes[1].baseContent, 'alpha\nsecond')
  assert.equal(env.cloud().today.content, 'beta\nremote second')
  assert.equal(page._controller.dirty, false)
})

test('a lost native receipt is replayed unchanged before later typing is submitted', async () => {
  const env = runtime(initial()), page = env.mount('diary'); await page._controller.refresh()
  env.setCloud({ ...initial(), today: { ...initial().today, content: 'first\nremote second' } })
  page.edit(event({}, 'alpha\nsecond'))
  env.setWrite(() => { throw new Error('receipt lost after commit') }); await page._controller.save()
  const original = structuredClone(env.writes[0])
  page.edit(event({}, 'beta\nsecond')); env.setWrite(null)
  await page._controller.save()
  assert.deepEqual(env.writes[1], original)
  assert.equal(env.writes[2].baseContent, 'alpha\nsecond')
  assert.equal(env.cloud().today.content, 'beta\nremote second')
  assert.equal(page._controller.dirty, false)
})

test('restoring another date saves the active draft first and preserves it unchanged if saving fails', async () => {
  const seed = initial(); seed.archive = [{ date: '2026-10-06', content: 'old history', updatedAt: '2026-10-06T00:00:00Z' }]
  const env = runtime(seed)
  await env.load('api/index.js').syncDiaryEntry({ operationId: 'seed-history-version', source: 'web', date: '2026-10-06', content: 'new history', baseContent: 'old history', baseUpdatedAt: '2026-10-06T00:00:00Z' })
  const editor = env.mount('diary'); await editor._controller.refresh()
  editor.edit(event({}, 'TODAY UNSAVED'))
  const page = env.mount('diary-versions', { date: '2026-10-06' }); await page.ready
  const old = page.data.versions.find(v => v.content === 'old history'); assert.ok(old)
  env.fail('diary/sync'); await page.restore(event({ id: old.id }))
  assert.match(page.data.error, /草稿/)
  assert.equal(env.storage.get('diary_draft_v1').today.content, 'TODAY UNSAVED')
  assert.equal(env.cloud().archive[0].content, 'new history')
  env.fail(undefined); await page.restore(event({ id: old.id }))
  assert.equal(page.data.error, '')
  assert.equal(env.cloud().today.content, 'TODAY UNSAVED')
  assert.equal(env.cloud().archive[0].content, 'old history')
  assert.equal(env.mount('diary').data.today.content, 'TODAY UNSAVED')
})

test('an orphan draft from another date blocks restoration without being replaced', async () => {
  const env = runtime(initial()), editor = env.mount('diary'); await editor._controller.refresh()
  editor.edit(event({}, 'old version')); await editor._controller.save()
  const page = env.mount('diary-versions', { date: '2026-10-07' }); await page.ready
  const version = page.data.versions.find(v => v.content === 'old version')
  const draft = { owner: 'previous-process', today: { date: '2026-10-06', content: 'OFFLINE PAST DRAFT' }, syncVersion: 1, baseContent: null }
  env.storage.set('diary_draft_v1', structuredClone(draft))
  const writes = env.writes.length
  await page.restore(event({ id: version.id }))
  assert.match(page.data.error, /草稿/)
  assert.deepEqual(env.storage.get('diary_draft_v1'), draft)
  assert.equal(env.writes.length, writes)
})
