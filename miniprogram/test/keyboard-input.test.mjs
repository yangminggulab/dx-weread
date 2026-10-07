import test from 'node:test'
import assert from 'node:assert/strict'
import { runtime, event, settle } from './helpers/native-runtime.mjs'

test('iPhone keyboard avoidance subtracts the native tab bar instead of lifting the sheet twice', () => {
  const env = runtime(), page = env.mount('index'); page.openAdd()
  env.keyboard(312)
  assert.equal(page.data.sheetBottom, 228)
  assert.equal(page.data.sheetHeight, 371)
  const patches = page.patches.length
  for (let i = 0; i < 20; i++) env.keyboard(312)
  assert.equal(page.patches.length, patches)
  env.keyboard(356)
  assert.equal(page.data.sheetBottom, 272)
  env.keyboard(0)
  assert.equal(page.data.sheetBottom, 0)
  assert.equal(page.data.sheetHeight, 576)
  page.onUnload()
})

test('a keyboard that already resizes the window does not also add its height as a sheet offset', () => {
  const env = runtime(); env.resize({ windowHeight: 700, screenHeight: 800, screenTop: 100 })
  const page = env.mount('notes'); page.openAdd()
  env.resize({ windowHeight: 400 }); env.keyboard(300)
  assert.equal(page.data.sheetBottom, 0)
  assert.equal(page.data.sheetHeight, 360)
  env.keyboard(0); env.resize({ windowHeight: 700 })
  assert.equal(page.data.sheetHeight, 630)
  page.onUnload()
})

test('only the open sheet owns keyboard listeners and late callbacks cannot mutate an unloaded page', () => {
  const env = runtime(), page = env.mount('index'); page.openAdd()
  const callback = [...env.keyboardListeners][0]
  assert.equal(env.keyboardListeners.size, 1); assert.equal(env.resizeListeners.size, 1)
  page.dismissForm()
  assert.equal(env.keyboardListeners.size, 0); assert.equal(env.resizeListeners.size, 0)
  page.openAdd()
  callback({ height: 312 }); assert.equal(page.data.sheetBottom, 0)
  page.inputTitle(event({}, '后台前的完整正文\n第二行\n第三行')); page.onHide()
  assert.equal(env.keyboardListeners.size, 0)
  page.onShow(); assert.equal(env.keyboardListeners.size, 1)
  assert.equal(page.data.form.title, '后台前的完整正文\n第二行\n第三行')
  page.onUnload(); const patches = page.patches.length
  callback({ height: 312 })
  assert.equal(page.patches.length, patches)
  assert.equal(env.keyboardListeners.size, 0); assert.equal(env.resizeListeners.size, 0)
})

test('keyboard avoidance recomputes physical viewport coordinates after rotation', () => {
  const env = runtime(), page = env.mount('index'); page.openAdd(); env.keyboard(200)
  env.resize({ windowHeight: 280, screenHeight: 375, screenTop: 44, windowWidth: 812 })
  assert.equal(page.data.sheetBottom, 149)
  assert.equal(page.data.sheetHeight, 118)
  env.keyboard(0)
  assert.equal(page.data.sheetBottom, 0); assert.equal(page.data.sheetHeight, 252)
  page.onUnload()
})

test('older base libraries use system window measurements and still avoid double keyboard subtraction', () => {
  const env = runtime(); let availableHeight = 600
  env.wx.getWindowInfo = undefined
  env.wx.getSystemInfoSync = () => ({ windowHeight: availableHeight })
  const page = env.mount('index'); page.openAdd()
  availableHeight = 300; env.keyboard(300)
  assert.equal(page.data.sheetBottom, 0); assert.equal(page.data.sheetHeight, 270)
  availableHeight = 600; env.keyboard(0)
  assert.equal(page.data.sheetBottom, 0); assert.equal(page.data.sheetHeight, 540)
  page.onUnload()
})

test('late content measurement from a dismissed sheet cannot resize its replacement', () => {
  const env = runtime(), callbacks = []
  env.wx.createSelectorQuery = () => ({ select() { return this }, boundingClientRect(callback) { callbacks.push(callback); return this }, exec() {} })
  const page = env.mount('index'); page.openAdd(); page.dismissForm(); page.openAdd()
  callbacks[0]({ height: 100 }); assert.equal(page.data.sheetHeight, 576)
  callbacks[1]({ height: 450 }); assert.equal(page.data.sheetHeight, 450)
  env.keyboard(312); assert.equal(page.data.sheetHeight, 371)
  env.keyboard(0); assert.equal(page.data.sheetHeight, 450)
  page.onUnload()
})

test('multiline task typing does not echo native text through setData and a failed save retains the exact retry body', async () => {
  const env = runtime(), page = env.mount('index'); page.openAdd(); page.patches.length = 0
  const title = '第一行\n第二行\n第三行\n第四行  '
  for (let i = 1; i <= title.length; i++) page.inputTitle(event({}, title.slice(0, i)))
  assert.equal(page.patches.length, 0)
  page.selectType(event({ key: 'weekly' })); page.selectPriority(event({ key: 'high' }))
  env.fail('tasks/add'); await page.saveForm()
  assert.equal(page.data.showForm, true); assert.equal(page._form.title, title)
  env.fail(undefined); await page.saveForm()
  assert.equal(page._tasks[0].title, title); assert.equal(page._tasks[0].taskType, 'weekly'); assert.equal(page._tasks[0].priority, 'high')
  assert.equal(env.keyboardListeners.size, 0)
  page.onUnload()
})

test('note title, multiline summary and tags share keyboard handling without text echo or failed-save loss', async () => {
  const env = runtime(), page = env.mount('notes'); page.openAdd(); page.patches.length = 0
  const summary = '  第一行\n第二行\n第三行\n第四行\n第五行  '
  page.inputForm(event({ field: 'title' }, '完整笔记')); page.inputForm(event({ field: 'summary' }, summary)); page.inputForm(event({ field: 'tags' }, '学习，工作'))
  assert.equal(page.patches.length, 0)
  page.sheetFocus({ currentTarget: { dataset: { field: 'summary' } }, detail: { height: 312 } })
  assert.equal(page.data.sheetField, 'sheet-summary'); assert.equal(page.data.sheetBottom, 228)
  page.sheetFocus({ currentTarget: { dataset: { field: 'tags' } }, detail: { height: 312 } })
  assert.equal(page.data.sheetField, 'sheet-tags')
  env.fail('notes/add'); await page.saveNote()
  assert.equal(page.data.showAdd, true); assert.equal(page._form.summary, summary)
  env.fail(undefined); await page.saveNote(); await settle()
  assert.equal(page._notes[0].summary, summary); assert.equal(page._notes[0].title, '完整笔记')
  assert.deepEqual([...page._notes[0].tags], ['学习', '工作'])
  assert.equal(env.keyboardListeners.size, 0)
  page.onUnload()
})
