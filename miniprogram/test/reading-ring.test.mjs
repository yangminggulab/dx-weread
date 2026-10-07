import test from 'node:test'
import assert from 'node:assert/strict'
import { runtime, event } from './helpers/native-runtime.mjs'

function canvasFixture(env) {
  const callbacks = [], operations = []
  const context = new Proxy({}, {
    get: (_, name) => (...args) => operations.push([name, ...args]),
    set: (_, name, value) => { operations.push([name, value]); return true }
  })
  const canvas = { getContext: () => context }
  env.wx.getWindowInfo = () => ({ pixelRatio: 3 })
  env.wx.createSelectorQuery = () => ({
    in() { return this }, select() { return this }, fields() { return this },
    exec(callback) { callbacks.push(callback) }
  })
  return { callbacks, operations, canvas, result: { node: canvas, width: 117, height: 117 } }
}

test('queued ring paint cannot draw after leaving reading, hiding or unloading', () => {
  for (const leave of [page => page.selectTab(event({ key: 'want' })), page => page.onHide(), page => page.onUnload()]) {
    const env = runtime(), page = env.mount('books'), fixture = canvasFixture(env)
    page.paintRing()
    leave(page)
    fixture.callbacks[0]([fixture.result])
    assert.equal(fixture.operations.length, 0)
  }
})

test('only the newest ring query paints; high DPI and returning to reading redraw correctly', () => {
  const env = runtime(), page = env.mount('books'), fixture = canvasFixture(env)
  page.paintRing(); page.paintRing()
  fixture.callbacks[0]([fixture.result])
  assert.equal(fixture.operations.length, 0)
  fixture.callbacks[1]([fixture.result])
  assert.equal(fixture.canvas.width, 351)
  assert.equal(fixture.canvas.height, 351)
  assert.deepEqual(fixture.operations.find(op => op[0] === 'scale'), ['scale', 3, 3])
  page.selectTab(event({ key: 'want' }))
  const count = fixture.callbacks.length
  page.selectTab(event({ key: 'reading' }))
  assert.equal(fixture.callbacks.length, count + 1)
  fixture.callbacks.at(-1)([fixture.result])
  page.onHide(); page.onShow()
  fixture.callbacks.at(-1)([fixture.result])
  assert.equal(fixture.operations.filter(op => op[0] === 'clearRect').length, 3)
  page.onUnload()
})

test('unmeasured canvas waits for a real size instead of painting a guessed diameter', () => {
  const env = runtime(), page = env.mount('books'), fixture = canvasFixture(env)
  page.paintRing(); fixture.callbacks[0]([{ ...fixture.result, width: 0 }])
  assert.equal(fixture.operations.length, 0)
  page.onResize(); fixture.callbacks[1]([fixture.result])
  assert.ok(fixture.operations.length > 0)
})

test('over-goal reading retains actual minutes and original streak rules', async () => {
  const env = runtime(), now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000
  env.setData({ books: [], weekReadDaily: { [midnight]: 61 }, wereadStats: { dailyReadTimes: [{ date, minutes: 61 }] } })
  const page = env.mount('books'); await page.loadData()
  assert.equal(page.data.todayText, '1时1分')
  assert.equal(page._todayMinutes, 61)
  assert.equal(page.data.goalMinutes, 30)
  assert.equal(page.data.streakDays, 1)
  assert.equal(page.data.streakWeeks, 1)
  assert.equal(env.writes.length, 0)
})

test('renderer accepts zero, exact multiples, overflow and malformed input without invalid geometry or state leaks', () => {
  const env = runtime(), { drawRing2d } = env.load('features/reading/ring.js')
  const fixture = canvasFixture(env)
  for (const minutes of [0, 1, 29, 30, 30.01, 31, 45, 59.99, 60, 61, 300, -1, NaN, Infinity]) {
    fixture.operations.length = 0
    drawRing2d(fixture.canvas.getContext('2d'), 117, 117, minutes, 30)
    assert.equal(fixture.operations.filter(op => op[0] === 'save').length, fixture.operations.filter(op => op[0] === 'restore').length)
    for (const op of fixture.operations.filter(op => op[0] === 'arc')) assert.ok(op.slice(1, 6).every(Number.isFinite))
    for (const op of fixture.operations.filter(op => op[0] === 'arc')) assert.ok(op[3] > 0)
  }
})

test('activity animation reaches the real total and cancels queued frames when the page hides', () => {
  const env = runtime(), page = env.mount('books'), fixture = canvasFixture(env)
  const frames = new Map(), canceled = [], rendered = []
  let id = 0
  fixture.canvas.requestAnimationFrame = callback => { frames.set(++id, callback); return id }
  fixture.canvas.cancelAnimationFrame = frame => { canceled.push(frame); frames.delete(frame) }
  const tick = timestamp => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(timestamp)); rendered.push(page._ringDisplayedMinutes) }
  page._todayMinutes = 45; page.paintRing(); fixture.callbacks.at(-1)([fixture.result])
  tick(0); tick(325); tick(650)
  assert.equal(rendered[0], 0)
  assert.ok(rendered[1] > 0 && rendered[1] < 45)
  assert.equal(rendered[2], 45)
  assert.equal(frames.size, 0)
  page._todayMinutes = 61; page.paintRing(); fixture.callbacks.at(-1)([fixture.result])
  const stale = [...frames.values()][0], displayed = page._ringDisplayedMinutes
  page.onHide()
  assert.equal(frames.size, 0)
  assert.ok(canceled.length > 0)
  stale(1000)
  assert.equal(page._ringDisplayedMinutes, displayed)
  page.onUnload()
})

test('a large total does not replay dozens of turns, and unchanged polling does not restart animation', () => {
  const env = runtime(), page = env.mount('books'), fixture = canvasFixture(env)
  const frames = new Map(); let id = 0
  fixture.canvas.requestAnimationFrame = callback => { frames.set(++id, callback); return id }
  fixture.canvas.cancelAnimationFrame = frame => frames.delete(frame)
  page._todayMinutes = 600; page.paintRing(); fixture.callbacks.at(-1)([fixture.result])
  assert.equal(page._ringDisplayedMinutes, 555)
  const tick = timestamp => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(timestamp)) }
  tick(0); tick(650)
  assert.equal(page._ringDisplayedMinutes, 600)
  page.paintRing(); fixture.callbacks.at(-1)([fixture.result])
  assert.equal(frames.size, 0)
  page.onUnload()
})
