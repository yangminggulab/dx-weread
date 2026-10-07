import test from 'node:test'
import assert from 'node:assert/strict'
import * as model from '../src/features/diary/model.mjs'
import { runtime, settle, ORIGINAL } from './helpers/native-runtime.mjs'

function diary(env) {
  let view
  const { DiaryController } = env.load('features/diary/controller.js')
  const controller = new DiaryController(value => { view = value })
  return { controller, get view() { return view } }
}

test('raw diary text and Shanghai 05:00 boundary are preserved', () => {
  const text = '  same\r\n\r\n\r\n---\r\nsame  '
  const value = model.normalizeDiaryPayload({ today: { date: '2026-10-07', content: text }, archive: [{ date: '2026-10-06', content: text }] })
  assert.equal(value.today.content, text); assert.equal(value.archive[0].content, text)
  assert.equal(model.getTodayStr(new Date('2026-10-06T20:59:59Z')), '2026-10-06')
  assert.equal(model.getTodayStr(new Date('2026-10-06T21:00:00Z')), '2026-10-07')
})
test('opening and leaving clean native diary never writes the body', async () => {
  const env = runtime(), page = diary(env)
  await page.controller.refresh()
  assert.equal(page.view.today.content, 'From Mac'); assert.equal(page.view.saveStatus, 'saved')
  page.controller.dispose(); await settle()
  assert.equal(env.writes.length, 0)
})
test('input persists immediately and hide plus unload flush only one save', async () => {
  const env = runtime(), page = diary(env)
  await page.controller.refresh()
  page.controller.edit('  Fresh text\n\n\n')
  assert.equal(env.storage.get(model.DIARY_DRAFT_KEY).today.content, '  Fresh text\n\n\n')
  page.controller.flush(); page.controller.dispose(); await settle()
  assert.equal(env.writes.length, 1)
  assert.equal(env.writes[0].today.content, '  Fresh text\n\n\n')
  assert.equal(env.storage.has(model.DIARY_DRAFT_KEY), false); assert.equal(env.timers.size, 0)
})
test('offline native save retains draft and exposes successful retry', async () => {
  const env = runtime(), page = diary(env)
  await page.controller.refresh(); page.controller.edit('Offline draft')
  env.setWrite(async () => { throw new Error('offline') }); await page.controller.save()
  assert.equal(page.view.saveStatus, 'error')
  assert.equal(env.storage.get(model.DIARY_DRAFT_KEY).today.content, 'Offline draft')
  env.setWrite(undefined); await page.controller.save()
  assert.equal(page.view.saveStatus, 'saved'); assert.equal(env.storage.has(model.DIARY_DRAFT_KEY), false)
})
test('Mac update preserves native draft until explicit conflict resolution', async () => {
  const env = runtime(), page = diary(env)
  await page.controller.refresh(); page.controller.edit('Phone draft')
  env.setCloud({ ...ORIGINAL, today: { ...ORIGINAL.today, content: 'New Mac text', updatedAt: 'mac-v2' } })
  await page.controller.refresh()
  assert.equal(page.view.today.content, 'Phone draft'); assert.equal(page.view.saveStatus, 'conflict')
  await page.controller.save(); assert.equal(env.writes.length, 0)
  page.controller.useCloud()
  assert.equal(page.view.today.content, 'New Mac text'); assert.equal(env.storage.has(model.DIARY_DRAFT_KEY), false)
})
test('disposed receipt cannot remove reopened draft or report a false conflict', async () => {
  const env = runtime(), first = diary(env)
  await first.controller.refresh(); first.controller.edit('First edit')
  let resolve
  env.setWrite(payload => new Promise(done => { resolve = () => done({ today: { ...payload.today, updatedAt: 'v2' } }) }))
  first.controller.dispose(); await settle()
  const second = diary(env); second.controller.edit('Second edit')
  resolve(); await settle()
  assert.equal(env.storage.get(model.DIARY_DRAFT_KEY).today.content, 'Second edit')
  env.setCloud({ ...ORIGINAL, today: { ...ORIGINAL.today, content: 'First edit', updatedAt: 'v2' } })
  await second.controller.refresh()
  assert.equal(second.view.today.content, 'Second edit'); assert.equal(second.view.conflict, null)
  assert.equal(env.storage.get(model.DIARY_DRAFT_KEY).today.updatedAt, 'v2')
})
test('refresh failure retains native text', async () => {
  const env = runtime(), page = diary(env)
  await page.controller.refresh(); env.setGet(async () => { throw new Error('offline') })
  assert.equal(await page.controller.refresh(), false)
  assert.equal(page.view.today.content, 'From Mac'); assert.equal(page.view.refreshFailed, true)
})
test('reopening pending save recognizes its confirmed content', async () => {
  const env = runtime(), first = diary(env)
  await first.controller.refresh(); first.controller.edit('First edit')
  let resolve
  env.setWrite(payload => new Promise(done => { resolve = () => done({ today: { ...payload.today, updatedAt: 'v2' } }) }))
  first.controller.dispose(); await settle()
  const second = diary(env); resolve(); await settle()
  env.setCloud({ ...ORIGINAL, today: { ...ORIGINAL.today, content: 'First edit', updatedAt: 'v2' } })
  await second.controller.refresh()
  assert.equal(second.view.saveStatus, 'saved'); assert.equal(second.view.conflict, null)
  assert.equal(env.storage.has(model.DIARY_DRAFT_KEY), false)
})
test('typing during save retains newer text while advancing its baseline', async () => {
  const env = runtime(), page = diary(env)
  await page.controller.refresh(); page.controller.edit('First edit')
  let resolve
  env.setWrite(payload => new Promise(done => { resolve = () => done({ today: { ...payload.today, updatedAt: 'v2' } }) }))
  const saving = page.controller.save(); await settle(); page.controller.edit('Still typing')
  resolve(); await saving
  assert.equal(page.view.today.content, 'Still typing'); assert.equal(page.view.today.updatedAt, 'v2')
  assert.equal(env.storage.get(model.DIARY_DRAFT_KEY).today.content, 'Still typing'); assert.equal(page.view.saveStatus, 'draft')
})
test('recovered draft resumes only after validating cloud baseline', async () => {
  const env = runtime()
  env.storage.set(model.DIARY_DRAFT_KEY, { today: { ...ORIGINAL.today, content: 'Recovered' }, archive: [] })
  const page = diary(env)
  assert.equal(env.writes.length, 0); await page.controller.refresh()
  env.timerTick(); await settle()
  assert.equal(env.writes[0].today.content, 'Recovered'); assert.equal(page.view.saveStatus, 'saved')
})
