const { DiaryLibrary } = require('../../features/diary/library')
const { createPageRefresh } = require('../../utils/page-refresh')
const { diaryDateLabel } = require('../../utils/date-label')
const { updateView } = require('../../utils/view')
Page({
  data: { entry: null, dateTitle: '', dateSubtitle: '', count: 0, canGoBack: false, canShuffle: false, loading: true, failed: false },
  onLoad(options = {}) {
    this._date = String(options.date || '')
    this._history = []
    this._markInitial = options.source === 'history'
    this._library = new DiaryLibrary(() => this.publish())
    this._refresh = createPageRefresh(() => this._library.refresh(), this)
    this.publish()
  },
  onShow() {
    this._refresh.start().finally(() => {
      if (this._disposed) return
      this.setData({ loading: false }); this.publish()
      if (this._markInitial && this.data.entry) { this._markInitial = false; this._library.viewed(this._date) }
    })
  },
  onHide() { this._refresh.stop() },
  onUnload() { this._refresh.stop(); this._library.dispose(); this._disposed = true },
  publish() {
    const entries = this._library.entries
    const entry = entries.find(item => item.date === this._date) || null
    const label = diaryDateLabel(this._date)
    this._history = this._history.filter(date => entries.some(item => item.date === date))
    updateView(this, { entry, dateTitle: label.title, dateSubtitle: label.subtitle, count: (entry && entry.content || '').length, canGoBack: this._history.length > 0, canShuffle: this._library.diary.archive.some(item => item.date !== this._date), failed: this._library.failed })
  },
  next() {
    const entries = this._library.diary.archive.filter(entry => entry.date !== this._date)
    if (!entries.length) return
    this._history.push(this._date)
    this._date = entries[Math.floor(Math.random() * entries.length)].date
    this.publish(); this._library.viewed(this._date); this.scrollTop()
  },
  back() { if (!this._history.length) return; this._date = this._history.pop(); this.publish(); this._library.viewed(this._date); this.scrollTop() },
  scrollTop() { if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 }) },
  async retry() { this.setData({ loading: true }); await this._library.refresh(); if (!this._disposed) this.setData({ loading: false }) }
})
