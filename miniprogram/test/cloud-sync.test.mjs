import test from 'node:test'
import assert from 'node:assert/strict'
import { createDiaryWriter, diaryArchiveMetadata, reconcileDiaryToday } from '../src/utils/diary-sync.mjs'
import { createCloudRefresh } from '../src/utils/cloud-refresh.mjs'

test('queued diary edits follow their own receipts and reject an intervening Mac write', async () => {
  let remote = { date: '2026-10-06', content: 'Original', updatedAt: 'v1' }
  let version = 1
  const writer = createDiaryWriter(async payload => {
    assert.equal(payload.expectedUpdatedAt, remote.updatedAt, 'stale save must be rejected')
    remote = { ...payload.today, updatedAt: `v${++version}` }
    return { today: remote }
  })
  const baseline = { ...remote }
  const first = writer.save({ today: { ...baseline, content: 'First edit' } })
  const second = writer.save({ today: { ...baseline, content: 'Second edit' } })
  await Promise.all([first, second])
  assert.equal(remote.content, 'Second edit')
  remote = { ...remote, content: 'Mac update', updatedAt: 'mac-version' }
  await assert.rejects(writer.save({ today: { ...baseline, content: 'Stale draft' } }), /stale save/)
  assert.equal(remote.content, 'Mac update')
  await writer.save({ today: { ...remote, content: 'Edit after refresh' } })
  assert.equal(remote.content, 'Edit after refresh')
})

test('browsing submits only history metadata, with no cached today or archive body', async () => {
  let submitted
  const writer = createDiaryWriter(async payload => { submitted = payload; return {} })
  const archive = [{ date: '2025-10-06', content: 'Old body', updatedAt: 'old', viewCount: 3, lastViewedAt: 'now', tags: ['安静恢复'], tagScores: { 安静恢复: 2 } }]
  await writer.save({ archive: diaryArchiveMetadata(archive) })
  assert.equal(Object.hasOwn(submitted, 'today'), false)
  assert.equal(Object.hasOwn(submitted, 'expectedUpdatedAt'), false)
  assert.equal(Object.hasOwn(submitted.archive[0], 'content'), false)
  assert.equal(submitted.archive[0].viewCount, 3)
})

test('failed diary saves keep their baseline and do not poison the save queue', async () => {
  const versions = []
  let fail = true
  const writer = createDiaryWriter(async payload => {
    versions.push(payload.expectedUpdatedAt)
    if (fail) { fail = false; throw new Error('offline') }
    return { today: { ...payload.today, updatedAt: 'v2' } }
  })
  const payload = { today: { date: '2026-10-06', content: '', updatedAt: 'v1' } }
  await assert.rejects(writer.save(payload), /offline/)
  await writer.wait()
  await writer.save(payload)
  assert.deepEqual(versions, ['v1', 'v1'])
})

test('foreground revision checks refresh changed data and pause while hidden', async () => {
  let revision = 1
  let reads = 0
  let refreshes = 0
  const monitor = createCloudRefresh({
    getVersion: async () => { reads += 1; return { revision } },
    refresh: async () => { refreshes += 1 }
  })
  await monitor.start()
  assert.equal(refreshes, 1)
  await monitor.check()
  assert.equal(refreshes, 1)
  revision = 2
  await monitor.check()
  assert.equal(refreshes, 2)
  monitor.stop()
  const before = reads
  revision = 3
  await monitor.check()
  assert.equal(reads, before)
  await monitor.start()
  assert.equal(refreshes, 3)
})

test('a failed page refresh retries the same revision', async () => {
  let refreshes = 0
  const monitor = createCloudRefresh({
    getVersion: async () => ({ revision: 1 }),
    refresh: async () => ++refreshes > 1
  })
  await monitor.start()
  await monitor.check()
  await monitor.check()
  assert.equal(refreshes, 2)
})

test('hide invalidates an old version request and concurrent polls are coalesced', async () => {
  let resolveVersion
  let refreshes = 0
  const monitor = createCloudRefresh({
    getVersion: () => new Promise(resolve => { resolveVersion = resolve }),
    refresh: async () => { refreshes += 1 }
  })
  const start = monitor.start()
  const duplicate = monitor.check()
  monitor.stop()
  resolveVersion({ revision: 1 })
  await Promise.all([start, duplicate])
  assert.equal(refreshes, 0)
})

test('a delayed GET cannot report a false conflict after our own save receipt', () => {
  const local = { date: '2026-10-06', content: 'Still typing after save', updatedAt: 'v2' }
  const staleRemote = { date: local.date, content: 'Before save', updatedAt: 'v1' }
  const result = reconcileDiaryToday(local, staleRemote, { dirty: true, changedDuringRequest: true })
  assert.equal(result.today, local)
  assert.equal(result.conflict, null)
})

test('fresh Mac changes conflict with a dirty draft, including the 05:00 date rollover', () => {
  const local = { date: '2026-10-06', content: 'Local draft', updatedAt: 'v1' }
  for (const remote of [
    { date: local.date, content: 'Mac update', updatedAt: 'v2' },
    { date: '2026-10-07', content: '', updatedAt: '' }
  ]) {
    const result = reconcileDiaryToday(local, remote, { dirty: true })
    assert.equal(result.today, local)
    assert.equal(result.conflict, remote)
  }
})

test('a clean diary accepts Mac updates while a new local edit protects the snapshot', () => {
  const local = { date: '2026-10-06', content: 'Old', updatedAt: 'v1' }
  const remote = { ...local, content: 'From Mac', updatedAt: 'v2' }
  assert.equal(reconcileDiaryToday(local, remote).today, remote)
  assert.equal(reconcileDiaryToday(local, remote, { changedDuringRequest: true }).today, local)
})

test('missing or unavailable revision checks use full reads on every poll without pretending to acknowledge a revision', async () => {
  for (const version of [async () => { throw Object.assign(new Error('missing'), { statusCode: 404 }) }, async () => { throw new Error('network') }, async () => ({})]) {
    let reads = 0
    const monitor = createCloudRefresh({ getVersion: version, refresh: async () => { reads++; return true } })
    await monitor.start(); await monitor.check(); await monitor.check()
    assert.equal(reads, 3)
  }
})

test('authentication failure is presented and does not trigger fallback reads; recovery refreshes the same revision', async () => {
  let status = 0, reads = 0; const errors = []
  const monitor = createCloudRefresh({ getVersion: async () => {
    if (status) throw Object.assign(new Error('denied'), { statusCode: status })
    return { revision: 1 }
  }, refresh: async () => { reads++; return true }, onError: error => errors.push(error?.statusCode || null) })
  await monitor.start(); status = 401; await monitor.check(); status = 403; await monitor.check()
  assert.equal(reads, 1); assert.deepEqual(errors.slice(-2), [401, 403])
  status = 0; await monitor.check(); assert.equal(reads, 2); assert.equal(errors.at(-1), null)
})

test('the diary/calendar day boundary triggers full reads even if the revision stays unchanged', async () => {
  let date = 'before-05:00', reads = 0
  const monitor = createCloudRefresh({ getVersion: async () => ({ revision: 1 }), day: () => date, refresh: async () => { reads++ } })
  await monitor.start(); await monitor.check(); assert.equal(reads, 1)
  date = 'after-05:00'; await monitor.check(); assert.equal(reads, 2)
})

test('a stopped revision failure cannot publish an error or launch fallback reads', async () => {
  let reject; let reads = 0; const errors = []
  const monitor = createCloudRefresh({ getVersion: () => new Promise((_, fail) => { reject = fail }),
    refresh: async () => { reads++ }, onError: error => errors.push(error) })
  const pending = monitor.start(); monitor.stop(); reject(new Error('late network failure'))
  await pending; assert.equal(reads, 0); assert.equal(errors.length, 0)
})
