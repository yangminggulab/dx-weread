import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runtime, settle, event, ORIGINAL } from './helpers/native-runtime.mjs'

const app = JSON.parse(fs.readFileSync(new URL('../dist/app.json', import.meta.url)))
test('native project keeps original AppID, routes and tab bar without Taro runtime', () => {
  const project = JSON.parse(fs.readFileSync(new URL('../dist/project.config.json', import.meta.url)))
  assert.equal(project.appid, 'wx3d9fea31502b4488')
  assert.deepEqual(app.pages, ['pages/index/index', 'pages/books/index', 'pages/notes/index', 'pages/diary/index', 'pages/diary-history/index', 'pages/diary-reader/index'])
  assert.deepEqual(app.tabBar.list.map(tab => tab.text), ['任务', '日记', '书单', '笔记'])
  assert.equal(fs.existsSync(new URL('../dist/taro.js', import.meta.url)), false)
  assert.equal(fs.existsSync(new URL('../dist/vendors.js', import.meta.url)), false)
})
test('native task categories remain in-page filters and stop polling when hidden', async () => {
  const env = runtime()
  env.setData({ tasks: [{ id: 1, title: 'Task', taskType: 'daily', status: 'todo', priority: 'high' }], books: [], notes: [] })
  const page = env.mount('index'); page.onShow(); await settle()
  assert.equal(page.data.active.length, 1)
  assert.equal(page.data.active[0].priorityLabel, '高')
  assert.equal(env.intervals.size, 1)
  page.selectTab(event({ key: 'diary' }))
  assert.equal(env.navigations.length, 0)
  assert.deepEqual(page.data.tabs.map(tab => tab.key), ['daily', 'weekly', 'longterm'])
  assert.equal(page.data.tab, 'daily')
  await page.toggleStatus(event({ id: 1 }))
  assert.equal(page.data.active.length, 0); assert.equal(page.data.completed.length, 1)
  page.onHide(); assert.equal(env.intervals.size, 0); page.onUnload()
})
test('native task form survives request failure and retry adds one task', async () => {
  const env = runtime(), page = env.mount('index')
  page.openAdd(); page.inputTitle(event({}, 'New task'))
  env.fail('tasks/add'); await page.saveForm()
  assert.equal(page.data.showForm, true); assert.equal(page._form.title, 'New task')
  env.fail(undefined); await page.saveForm()
  assert.equal(page.data.showForm, false); assert.equal(page.data.active[0].title, 'New task')
})

test('native revision 404 falls back to data reads while authentication errors remain visible and recover automatically', async () => {
  const env = runtime(), send = env.wx.request; let status = 404
  env.setData({ tasks: [{ id: 1, title: 'Task', taskType: 'daily', status: 'todo' }], books: [], notes: [] })
  env.wx.request = options => {
    if (options.url.endsWith('/api/sync-state')) options.success({ statusCode: status, data: {} })
    else send(options)
  }
  const page = env.mount('index'); await page._refresh.start()
  assert.equal(page.data.active[0].title, 'Task'); assert.equal(page.data.syncError, '')
  env.setData({ tasks: [{ id: 1, title: 'Changed remotely', taskType: 'daily', status: 'todo' }], books: [], notes: [] })
  await page._refresh.check(false); assert.equal(page.data.active[0].title, 'Changed remotely')
  status = 401; await page._refresh.check(false); assert.match(page.data.syncError, /认证失败/)
  assert.equal(page.data.active[0].title, 'Changed remotely')
  status = 404; await page._refresh.check(false); assert.equal(page.data.syncError, '')
  page.onHide(); page.onUnload()
})

test('an old task GET cannot undo a confirmed toggle and still accepts unrelated remote changes', async () => {
  const env = runtime(), task = { id: 1, title: 'Task', taskType: 'daily', status: 'in_progress' }
  env.setData({ tasks: [task], books: [], notes: [] })
  const page = env.mount('index'); await page.loadData()
  const send = env.wx.request; let read
  env.wx.request = options => { if (options.url.endsWith('/api/data')) read = options; else send(options) }
  const loading = page.loadData(); await settle(); await page.toggleStatus(event({ id: 1 }))
  const remoteTask = { id: 2, title: 'Added remotely', taskType: 'daily', status: 'in_progress' }
  read.success({ statusCode: 200, data: { tasks: [task, remoteTask], books: [], notes: [] } }); await loading
  assert.equal(page.data.completed[0].id, 1)
  assert.equal(page.data.active[0].id, 2)
  assert.equal(env.storage.get('tasks_cache_v1').tasks.find(t => t.id === 1).status, 'completed')
  env.wx.request = send; await page.loadData()
  assert.equal(page.data.completed[0].id, 1)
})

test('task reads started during a pending write cannot overwrite it even when the write completes before the read', async () => {
  const env = runtime(), task = { id: 1, title: 'Task', taskType: 'daily', status: 'in_progress' }
  env.setData({ tasks: [task], books: [], notes: [] })
  const page = env.mount('index'); await page.loadData()
  let write, read; const send = env.wx.request
  env.wx.request = options => {
    if (options.url.endsWith('/api/tasks/update')) write = options
    else if (options.url.endsWith('/api/data')) read = options
    else send(options)
  }
  const saving = page.toggleStatus(event({ id: 1 })); await settle()
  const loading = page.loadData(); await settle()
  write.success({ statusCode: 200, data: { ok: true, task: { ...task, status: 'completed', updatedAt: '2026-10-07T02:00:00Z' } } }); await saving
  read.success({ statusCode: 200, data: { tasks: [task], books: [], notes: [] } }); await loading
  assert.equal(page.data.completed[0].id, 1)
  assert.equal(page._pending.size, 0)
})

test('a stale task read keeps a newly created task and later fresh reads can accept remote deletions', async () => {
  const env = runtime(), page = env.mount('index'); await page.loadData()
  const send = env.wx.request; let read
  env.wx.request = options => { if (options.url.endsWith('/api/data')) read = options; else send(options) }
  const loading = page.loadData(); await settle()
  page.openAdd(); page.inputTitle(event({}, 'New task')); await page.saveForm()
  const id = page._tasks[0].id
  read.success({ statusCode: 200, data: { tasks: [], books: [], notes: [] } }); await loading
  assert.equal(page._tasks[0].id, id)
  env.wx.request = send; env.setData({ tasks: [], books: [], notes: [] }); await page.loadData()
  assert.equal(page._tasks.length, 0)
})

test('a truly newer remote task remains visible even if its read overlaps a local write', async () => {
  const env = runtime(), task = { id: 1, title: 'Task', taskType: 'daily', status: 'in_progress' }
  env.setData({ tasks: [task], books: [], notes: [] })
  const page = env.mount('index'); await page.loadData()
  const send = env.wx.request; let read
  env.wx.request = options => { if (options.url.endsWith('/api/data')) read = options; else send(options) }
  const loading = page.loadData(); await settle(); await page.toggleStatus(event({ id: 1 }))
  read.success({ statusCode: 200, data: { tasks: [{ ...task, title: 'Later remote edit', updatedAt: '2099-01-01T00:00:00Z' }], books: [], notes: [] } }); await loading
  assert.equal(page._tasks[0].title, 'Later remote edit'); assert.equal(page._tasks[0].status, 'in_progress')
})

test('a task mutation completing after unload cannot replace a newer page cache', async () => {
  const env = runtime(), task = { id: 1, title: 'Task', taskType: 'daily', status: 'in_progress' }
  env.setData({ tasks: [task], books: [], notes: [] })
  const page = env.mount('index'); await page.loadData(); let write
  env.wx.request = options => { write = options }
  const saving = page.toggleStatus(event({ id: 1 })); await settle(); page.onUnload()
  const cache = { tasks: [{ ...task, title: 'New page data' }] }; env.storage.set('tasks_cache_v1', structuredClone(cache))
  write.success({ statusCode: 200, data: { ok: true, task: { ...task, status: 'completed' } } }); await saving
  assert.deepEqual(env.storage.get('tasks_cache_v1'), cache)
})

test('a malformed successful task response does not confirm a toggle or publish an undefined task', async () => {
  const env = runtime(), task = { id: 1, title: 'Task', taskType: 'daily', status: 'in_progress' }
  env.setData({ tasks: [task], books: [], notes: [] })
  const page = env.mount('index'); await page.loadData()
  env.wx.request = options => options.success({ statusCode: 200, data: {} })
  await page.toggleStatus(event({ id: 1 })); assert.equal(page._tasks[0].status, 'in_progress')
  assert.equal(page._pending.size, 0)
})
test('switching bottom tabs preserves the diary recall until an explicit shuffle', async () => {
  const env = runtime({ ...ORIGINAL, archive: [{ date: '2026-10-06', content: 'First' }, { date: '2026-10-05', content: 'Second' }] })
  const page = env.mount('diary')
  let recalls = 0
  const recall = page._controller.recall.bind(page._controller)
  page._controller.recall = () => { recalls++; return recall() }
  page.onShow(); await settle()
  const date = page.data.preview.date, initialRecalls = recalls
  page.onHide(); await settle(); page.onShow(); await settle()
  assert.equal(recalls, initialRecalls)
  assert.equal(page.data.preview.date, date)
  page.recallPreview(); await settle()
  assert.equal(recalls, initialRecalls + 1)
  assert.ok(env.writes.every(write => !write.today))
  page.onHide(); page.onUnload()
})
test('native books retain reading ring data and existing grouping behavior', async () => {
  const env = runtime()
  env.setData({ books: Array.from({ length: 6 }, (_, index) => ({ id: index, title: `Book ${index}`, source: 'weread', status: 'reading', progressPercent: index === 0 ? 90 : 10 })), tasks: [], notes: [] })
  const page = env.mount('books'); await page.loadData()
  assert.deepEqual(page.data.counts, { reading: 3, want: 2, finished: 1 })
  assert.equal(page.data.books.length, 3)
  page.selectTab(event({ key: 'finished' })); assert.equal(page.data.books[0].pct, 90)
})
test('native notes search ranks diary tags and searches all three sources', async () => {
  const env = runtime()
  env.setData({ notes: [{ id: 1, title: '焦虑笔记', summary: 'Test', tags: [] }], tasks: [], books: [] })
  env.setCloud({ ...ORIGINAL, archive: [{ date: '2026-10-06', content: 'Past diary', tagScores: { 焦虑内耗: 4 } }] })
  env.setEssays({ items: [{ id: 2, title: 'Thought', content: '焦虑', date: '2026-10-05' }] })
  const page = env.mount('notes'); await page.refreshAll()
  page.inputSearch(event({}, '焦虑')); env.timerTick()
  assert.deepEqual(page.data.sections.map(section => section.kind), ['diary', 'note', 'essay'])
  assert.equal(page.data.sections[0].items[0].displayTags[0].score, 4)
  assert.equal(page.data.subtitle, '3 个结果')
})
test('a diary API failure does not hide native notes and essays', async () => {
  const env = runtime()
  env.setData({ notes: [{ id: 1, title: 'Test note', tags: [] }], tasks: [], books: [] })
  env.setEssays({ items: [{ id: 2, title: 'Test essay', content: 'Text' }] }); env.fail('diary')
  const page = env.mount('notes'); assert.equal(await page.refreshAll(), false)
  page.inputSearch(event({}, 'Test')); env.timerTick()
  assert.deepEqual(page.data.sections.map(section => section.kind), ['note', 'essay'])
  assert.ok(page.data.warning.includes('日记'))
})
test('native editor events persist input and send only visible diary fields through setData', async () => {
  const env = runtime()
  env.setCloud({ ...ORIGINAL, archive: Array.from({ length: 468 }, (_, index) => ({ date: `history-${index}`, content: 'Long history body '.repeat(100) })) })
  const page = env.mount('diary'); await page._controller.refresh()
  assert.equal(page.data.archiveCount, 468)
  assert.equal('archive' in page.data, false)
  const { componentDefinition } = env.load('components/diary-editor/index.js')
  const component = { setData() {}, triggerEvent(name, detail) { if (name === 'edit') page.edit({ detail }); if (name === 'finish') page.finish(); if (name === 'writing') page.writingChanged({ detail }) } }
  page.patches.length = 0
  componentDefinition.methods.input.call(component, event({}, 'Native input'))
  assert.equal(page.data.today.content, 'Native input')
  assert.ok(JSON.stringify(page.patches).length < 1000)
  componentDefinition.methods.finish.call(component); await settle()
  assert.equal(page.data.saveStatus, 'saved')
  assert.equal(env.writes.filter(write => write.today).length, 1)
  page.onHide(); page.onUnload()
})
test('all native WXML event bindings resolve to actual page or component handlers', () => {
  const env = runtime()
  for (const route of [...app.pages, 'components/diary-editor/index']) {
    const module = env.load(`${route}.js`)
    const handlers = module.pageDefinition || module.componentDefinition.methods
    const text = fs.readFileSync(new URL(`../dist/${route}.wxml`, import.meta.url), 'utf8')
    for (const match of text.matchAll(/(?:bind|catch)(?::[a-z]+|[a-z]+)="([A-Za-z]+)"/g)) {
      assert.equal(typeof handlers[match[1]], 'function', `${route}: ${match[1]}`)
    }
  }
})

test('large native search results paginate without dropping full text', async () => {
  const env = runtime()
  env.setData({ tasks: [], books: [], notes: Array.from({ length: 25 }, (_, id) => ({ id, title: `Match ${id}`, summary: 'Full text '.repeat(100), tags: [] })) })
  const page = env.mount('notes'); await page.refreshAll()
  page.inputSearch(event({}, 'Match')); env.timerTick()
  assert.equal(page.data.subtitle, '25 个结果')
  assert.equal(page.data.resultPages, 3)
  assert.equal(page.data.sections[0].items.length, 10)
  page.nextResults(); page.nextResults()
  assert.equal(page.data.sections[0].items.length, 5)
  assert.equal(page.data.sections[0].items[0].summary, 'Full text '.repeat(100))
  page.previousResults(); assert.equal(page.data.resultPage, 1)
})
