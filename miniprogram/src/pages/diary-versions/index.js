const api = require('../../api/index')
const { diarySyncOperation } = require('../../utils/diary-sync.mjs')
const { DIARY_DRAFT_KEY } = require('../../features/diary/model.mjs')
const { flushActiveDiaryDraft } = require('../../features/diary/save-coordinator')
Page({
  data: { date: '', versions: [], cursor: null, loading: false, error: '', selected: null, bodyPage: '', bodyIndex: 0, bodyPages: 0 },
  onLoad(options) { this.setData({ date: options.date || '' }); this.ready = this.load() },
  onUnload() { this._disposed = true },
  async load(e) {
    if (this.data.loading) return
    const more = Boolean(e && e.currentTarget.dataset.more)
    this.setData({ loading: true, error: '' })
    try {
      const page = await api.getDiaryVersions(this.data.date, more ? this.data.cursor : null)
      if (this._disposed) return
      this._versions = this._versions || new Map()
      page.versions.forEach(version => this._versions.set(version.id, version))
      const versions = page.versions.map(version => ({ ...version, content: version.content.slice(0, 1000), shortened: version.content.length > 1000,
        time: new Date(version.createdAt).toLocaleString(),
        label: { apple: 'Apple 客户端', web: '网页', miniprogram: '微信小程序', server: '云端' }[version.source] || '云端' }))
      this.setData({ versions, cursor: page.nextCursor })
    } catch { if (!this._disposed) this.setData({ error: '版本历史暂时无法读取，请稍后重试。' }) }
    finally { if (!this._disposed) this.setData({ loading: false }) }
  },
  openBody(e) {
    const version = this._versions.get(e.currentTarget.dataset.id)
    if (!version) return
    this.setData({ selected: version.id, bodyPages: Math.max(1, Math.ceil(version.content.length / 10000)), bodyIndex: 0, bodyPage: version.content.slice(0, 10000) })
  },
  bodyStep(e) {
    const version = this._versions.get(this.data.selected)
    const index = this.data.bodyIndex + Number(e.currentTarget.dataset.step)
    if (!version || index < 0 || index >= this.data.bodyPages) return
    this.setData({ bodyIndex: index, bodyPage: version.content.slice(index * 10000, (index + 1) * 10000) })
  },
  closeBody() { this.setData({ selected: null, bodyPage: '' }) },
  async restore(e) {
    if (this.data.loading) return
    const version = this._versions.get(e.currentTarget.dataset.id)
    if (!version || version.date !== this.data.date) return
    this.setData({ loading: true, error: '' })
    try {
      await flushActiveDiaryDraft()
      await api.waitForDiarySaves()
      if (this._disposed) return
      const draft = wx.getStorageSync(DIARY_DRAFT_KEY)
      const retryingOwnRestore = this._restoreOperation && draft?.owner === this._restoreOperation.operationId
        && draft.operation?.operationId === this._restoreOperation.operationId
      // All dates share the legacy draft slot. Never replace an unresolved draft
      // from another date, another editor or a previous process.
      if (draft && !retryingOwnRestore) throw new Error('当前草稿尚未保存成功，恢复未执行；草稿已保留，请稍后重试。')
      // Persist the exact restoration as a recoverable operation before sending.
      const operation = diarySyncOperation({ date: version.date, content: version.content, baseContent: null }, this._restoreOperation, 'miniprogram')
      this._restoreOperation = operation
      const owner = operation.operationId
      wx.setStorageSync(DIARY_DRAFT_KEY, { today: { date: version.date, content: version.content }, archive: [],
        owner, syncVersion: 1, baseContent: null, baseUpdatedAt: '', operation })
      await api.syncDiaryEntry(operation)
      if (wx.getStorageSync(DIARY_DRAFT_KEY)?.owner === owner) wx.removeStorageSync(DIARY_DRAFT_KEY)
      if (!this._disposed) wx.navigateBack()
    } catch (error) { if (!this._disposed) this.setData({ error: error.message || '恢复失败，草稿已保留，请重试。' }) }
    finally { if (!this._disposed) this.setData({ loading: false }) }
  }
})
