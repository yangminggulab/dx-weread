import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { syncDiary, diaryVersions } from '../../../worker/src/diary-sync.mjs'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url))
export const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
export const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
export const event = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } })
export const ORIGINAL = { today: { date: '2026-10-07', content: 'From Mac', updatedAt: 'v1' }, archive: [] }

export function runtime(initial = ORIGINAL) {
  const modules = new Map(), storage = new Map(), timers = new Map(), intervals = new Map(), writes = [], navigations = []
  let cloud = clone(initial), data = { tasks: [], books: [], notes: [] }, essays = { items: [] }, version = 1, revision = 1, timerID = 0
  const syncValues = new Map()
  const kv = { get: async key => syncValues.get(key), put: async (key, value) => syncValues.set(key, value) }
  let writeOverride, readOverride, failPath
  const wx = {
    getStorageSync: key => clone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, clone(value)),
    removeStorageSync: key => storage.delete(key),
    hideKeyboard() {}, showToast() {},
    navigateBack: () => navigations.push('back'),
    navigateTo: options => navigations.push(options.url),
    nextTick: callback => callback(),
    createSelectorQuery() { return { in() { return this }, select() { return this }, fields() { return this }, exec(callback) { callback([null]) } } },
    request(options) {
      const endpoint = new URL(options.url).pathname.replace('/tasks/api/', '')
      const operation = async () => {
        if (endpoint === failPath) throw new Error('offline')
        if (endpoint === 'sync-state') return { revision }
        if (endpoint === 'diary' && options.method === 'GET') return readOverride ? readOverride() : clone(cloud)
        if (endpoint === 'diary/sync') {
          const payload = clone(options.data); writes.push(payload)
          const result = await syncDiary(kv, cloud, payload, async value => { cloud = clone(value); revision++ }, '2026-10-07')
          if (writeOverride) return writeOverride(payload, result.value)
          return clone(result.value)
        }
        if (endpoint === 'diary/versions') {
          const params = new URL(options.url).searchParams
          return diaryVersions(kv, params.get('date'), Number(params.get('cursor') || 0))
        }
        if (endpoint === 'diary') {
          const payload = clone(options.data); writes.push(payload)
          if (writeOverride) return writeOverride(payload)
          if (payload.today) {
            if (payload.expectedUpdatedAt !== cloud.today.updatedAt && !payload.overwriteConflict) throw Object.assign(new Error('conflict'), { statusCode: 409, today: clone(cloud.today) })
            cloud.today = { ...payload.today, updatedAt: `v${++version}` }
          }
          revision++; return { today: clone(cloud.today) }
        }
        if (endpoint === 'data') return clone(data)
        if (endpoint === 'essays') return clone(essays)
        if (endpoint === 'tasks/update') { data.tasks = data.tasks.map(task => task.id === options.data.id ? { ...task, ...options.data, updatedAt: new Date().toISOString() } : task); revision++; return { ok: true, task: clone(data.tasks.find(task => task.id === options.data.id)) } }
        if (endpoint === 'tasks/add') { const task = { ...options.data, id: data.tasks.length + 100 }; data.tasks.push(task); revision++; return { ok: true, task } }
        if (endpoint === 'notes/add') { const note = { ...options.data, id: data.notes.length + 100, updatedAt: '2026-10-07' }; data.notes.push(note); return { note } }
        throw new Error(`Unmocked endpoint ${endpoint}`)
      }
      operation().then(value => options.success({ statusCode: 200, data: value }), error => error.statusCode ? options.success({ statusCode: error.statusCode, data: { today: error.today } }) : options.fail(error))
    }
  }
  function load(relative) {
    const filename = path.resolve(DIST, relative)
    if (filename === path.join(DIST, 'config.js')) return { BASE_URL: 'https://example.test/tasks', API_TOKEN: 'test-token' }
    if (modules.has(filename)) return modules.get(filename).exports
    let pageDefinition, componentDefinition
    const module = { exports: {} }; modules.set(filename, module)
    const context = {
      module, exports: module.exports, wx, console, Date, Math, Set, Map,
      Page: definition => { pageDefinition = definition }, Component: definition => { componentDefinition = definition }, App() {},
      setTimeout: callback => { const id = ++timerID; timers.set(id, callback); return id }, clearTimeout: id => timers.delete(id),
      setInterval: callback => { const id = ++timerID; intervals.set(id, callback); return id }, clearInterval: id => intervals.delete(id),
      require(name) { if (!name.startsWith('.')) throw new Error(`Unexpected runtime package ${name}`); const file = path.resolve(path.dirname(filename), name); return load(file.endsWith('.js') ? file : file + '.js') }
    }
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename })
    if (pageDefinition) module.exports = { pageDefinition }
    if (componentDefinition) module.exports = { componentDefinition }
    return module.exports
  }
  function mount(pageName, options = {}) {
    const { pageDefinition } = load(`pages/${pageName}/index.js`)
    const page = { ...pageDefinition, data: clone(pageDefinition.data), patches: [] }
    page.setData = (patch, callback) => {
      page.patches.push(clone(patch))
      for (const [key, value] of Object.entries(patch)) {
        const fields = key.split('.'); let target = page.data
        fields.slice(0, -1).forEach(field => { target = target[field] ||= {} })
        target[fields.at(-1)] = clone(value)
      }
      if (callback) callback()
    }
    page.onLoad(options); return page
  }
  return {
    load, mount, storage, timers, intervals, writes, navigations, wx,
    cloud: () => clone(cloud),
    setCloud(value) { cloud = clone(value) }, setData(value) { data = clone(value) }, setEssays(value) { essays = clone(value) },
    setWrite(fn) { writeOverride = fn }, setGet(fn) { readOverride = fn }, fail(path) { failPath = path },
    timerTick() { const callbacks = [...timers.values()]; timers.clear(); return Promise.all(callbacks.map(callback => callback())) }
  }
}
