"use strict";

const {
  DiaryLibrary
} = require('../../features/diary/library');
const {
  filterDiaryEntries,
  diaryListRows
} = require("../../features/diary/presentation.js");
const {
  createPageRefresh
} = require('../../utils/page-refresh');
const {
  getTodayStr
} = require("../../features/diary/model.js");
const {
  diaryDateLabel
} = require('../../utils/date-label');
const {
  updateView
} = require('../../utils/view');
const PAGE_SIZE = 24;
Page({
  data: {
    query: '',
    selectedDate: '',
    dateTitle: '',
    endDate: '',
    rows: [],
    total: 0,
    count: 0,
    hasMore: false,
    loading: true,
    failed: false
  },
  onLoad() {
    this._limit = PAGE_SIZE;
    this._library = new DiaryLibrary(() => this.publish());
    this._refresh = createPageRefresh(() => this._library.refresh(), this);
    this.setData({
      endDate: getTodayStr()
    });
    this.publish();
  },
  onShow() {
    this._refresh.start().finally(() => {
      if (!this._disposed) {
        this.setData({
          loading: false
        });
        this.publish();
      }
    });
  },
  onHide() {
    this._refresh.stop();
  },
  onUnload() {
    clearTimeout(this._searchTimer);
    this._refresh.stop();
    this._library.dispose();
    this._disposed = true;
  },
  publish() {
    const all = this._library.entries;
    const filtered = filterDiaryEntries(all, this.data.query, this.data.selectedDate);
    updateView(this, {
      rows: diaryListRows(filtered, this._limit),
      total: all.length,
      count: filtered.length,
      hasMore: filtered.length > this._limit,
      failed: this._library.failed
    });
  },
  inputSearch(e) {
    this.setData({
      query: e.detail.value
    });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.search(), 180);
  },
  search() {
    clearTimeout(this._searchTimer);
    this._limit = PAGE_SIZE;
    this.publish();
  },
  clearSearch() {
    this.setData({
      query: ''
    });
    this.search();
  },
  selectDate(e) {
    const date = e.detail.value;
    this.setData({
      selectedDate: date,
      dateTitle: `${date.slice(0, 4)} 年 ${diaryDateLabel(date).title}`
    });
    this.search();
  },
  clearDate() {
    this.setData({
      selectedDate: '',
      dateTitle: ''
    });
    this.search();
  },
  resetFilters() {
    this.setData({
      query: '',
      selectedDate: '',
      dateTitle: ''
    });
    this.search();
  },
  loadMore() {
    if (!this.data.hasMore) return;
    this._limit += PAGE_SIZE;
    this.publish();
  },
  onReachBottom() {
    this.loadMore();
  },
  openEntry(e) {
    wx.navigateTo({
      url: `/pages/diary-reader/index?date=${encodeURIComponent(e.currentTarget.dataset.date)}&source=history`
    });
  },
  async retry() {
    this.setData({
      loading: true
    });
    await this._library.refresh();
    if (!this._disposed) this.setData({
      loading: false
    });
  }
});
