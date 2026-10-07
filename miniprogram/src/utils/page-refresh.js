const { createCloudRefresh } = require('./cloud-refresh.mjs')
const { getSyncState } = require('../api/index')
const { getTodayStr } = require('../features/diary/model.mjs')

function createPageRefresh(refresh, page) {
  const monitor = createCloudRefresh({ getVersion: getSyncState, refresh,
    day: () => `${getTodayStr()}|${new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)}`,
    onError(error) {
      if (!page || page._disposed) return
      const message = !error ? '' : error.statusCode === 401 ? '认证失败，暂时无法读取云端数据。'
        : error.statusCode === 403 ? '云端拒绝了请求，当前内容已保留。'
        : '暂时无法读取云端数据，当前内容已保留，会自动重试。'
      if (page.data.syncError !== message) page.setData({ syncError: message })
    }
  })
  let timer = null
  return {
    start() {
      this.stop()
      timer = setInterval(() => monitor.check(), 15000)
      return monitor.start()
    },
    check(force = true) { return monitor.check(force) },
    stop() { clearInterval(timer); timer = null; monitor.stop() }
  }
}
module.exports = { createPageRefresh }
