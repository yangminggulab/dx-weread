const { DiaryController } = require('../../features/diary/controller')
const { createPageRefresh } = require('../../utils/page-refresh')
const { updateView } = require('../../utils/view')
const { diaryDateLabel } = require('../../utils/date-label')
const { diaryExcerpt } = require('../../features/diary/presentation.mjs')
const { rememberDiary } = require('../../features/diary/library')
Page({
  data: {
    today: { date: '', content: '', tags: [] }, saveStatus: 'loading', saving: false,
    conflict: null, refreshFailed: false, preview: null,
    archiveCount: 0, isHistoryToday: false,
    previewDateTitle: '', previewYear: '', previewExcerpt: '', writing: false, entryCount: 0
  },
  onLoad() {
    this._controller = new DiaryController(view => {
      updateView(this, { ...view, previewDateTitle: diaryDateLabel(view.preview && view.preview.date).title, previewYear: view.preview ? view.preview.date.slice(0, 4) : '', previewExcerpt: diaryExcerpt(view.preview && view.preview.content), entryCount: view.archiveCount + (view.today.content.trim() ? 1 : 0) })
    })
    this._refresh = createPageRefresh(() => this._controller.refresh(), this)
  },
  onShow() { this.setData({ writing: false }); if (!this._controller.randomDate) this._controller.recall(); this._refresh.start() },
  onHide() { this._refresh.stop(); this._controller.flush() },
  onUnload() { this._refresh.stop(); this._controller.dispose(); this._disposed = true },
  edit(e) { this._controller.edit(e.detail.value) },
  flush() { this._controller.flush() },
  finish() { this.setData({ writing: false }); this.flush(); wx.hideKeyboard() },
  writingChanged(e) { this.setData({ writing: Boolean(e.detail.active) }) },
  retryLoad() { this._controller.refresh() },
  retrySave() { this._controller.save() },
  useCloud() { this._controller.useCloud() },
  overwrite() { this._controller.save(true) },
  openReader() { if (!this.data.preview) return; this.finish(); rememberDiary(this._controller.diary); wx.navigateTo({ url: `/pages/diary-reader/index?date=${encodeURIComponent(this.data.preview.date)}` }) },
  openHistory() { this.finish(); rememberDiary(this._controller.diary); wx.navigateTo({ url: '/pages/diary-history/index' }) },
  recallPreview() { this._controller.recall(); this._controller.syncViews() }
})
