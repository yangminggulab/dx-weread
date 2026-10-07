"use strict";

const {
  getData
} = require('../../api/index');
const {
  createPageRefresh
} = require('../../utils/page-refresh');
const {
  readCache,
  writeCache
} = require('../../utils/cache');
const {
  getTodayMinutes,
  getStreakDays,
  getStreakWeeks
} = require('../../features/reading/model');
const {
  animateRing
} = require('../../features/reading/ring');
const KEY = 'books_cache_v2',
  GOAL = 30;
const TABS = [{
  key: 'reading',
  label: '在读'
}, {
  key: 'want',
  label: '想读'
}, {
  key: 'finished',
  label: '读完'
}];
Page({
  data: {
    tabs: TABS,
    tab: 'reading',
    books: [],
    counts: {
      reading: 0,
      want: 0,
      finished: 0
    },
    total: 0,
    loading: true,
    todayText: '0分钟',
    streakDays: 0,
    streakWeeks: 0,
    goalMinutes: GOAL
  },
  onLoad() {
    this._books = readCache(KEY, {}).books || [];
    this._daily = {};
    this._dailyTimes = [];
    this.updateBooks();
    this._refresh = createPageRefresh(() => this.loadData(), this);
  },
  onShow() {
    this._visible = true;
    this._refresh.start();
    this.paintRing();
  },
  onReady() {
    this.paintRing();
  },
  onHide() {
    this._visible = false;
    this._ringPaintVersion++;
    this.stopRingAnimation();
    this._refresh.stop();
  },
  onUnload() {
    this._disposed = true;
    this._ringPaintVersion++;
    this.stopRingAnimation();
    this._refresh.stop();
  },
  onResize() {
    this.paintRing();
  },
  async loadData() {
    try {
      const data = await getData();
      if (this._disposed) return false;
      this._books = (data.books || []).filter(book => book.source === 'weread');
      this._daily = data.weekReadDaily || {};
      this._dailyTimes = (data.wereadStats || {}).dailyReadTimes || [];
      writeCache(KEY, {
        books: this._books
      });
      this.updateBooks();
      return true;
    } catch {
      return false;
    } finally {
      if (!this._disposed) this.setData({
        loading: false
      }, () => this.paintRing());
    }
  },
  updateBooks() {
    const key = book => book._bookId || book.id;
    const finished = this._books.filter(book => book.status === 'finished' || (book.progressPercent || 0) >= 90);
    const ids = new Set(finished.map(key));
    const reading = this._books.filter(book => !ids.has(key(book)) && book.status === 'reading').sort((a, b) => (b.readTimestamp || b.sourceUpdatedTimestamp || 0) - (a.readTimestamp || a.sourceUpdatedTimestamp || 0));
    const lists = {
      finished,
      reading: reading.slice(0, 3),
      want: [...this._books.filter(book => !ids.has(key(book)) && book.status === 'want'), ...reading.slice(3)]
    };
    this._todayMinutes = getTodayMinutes(this._daily);
    const hours = Math.floor(this._todayMinutes / 60),
      minutes = this._todayMinutes % 60;
    this.setData({
      books: lists[this.data.tab].map(book => ({
        ...book,
        key: key(book),
        coverTitle: (book.title || '').slice(0, 4),
        accent: book.accent || '#4263a8',
        pct: book.progressPercent || 0,
        barPct: Math.min(100, book.progressPercent || 0)
      })),
      total: this._books.length,
      counts: {
        reading: lists.reading.length,
        want: lists.want.length,
        finished: lists.finished.length
      },
      todayText: hours > 0 ? `${hours}时${minutes}分` : `${minutes}分钟`,
      streakDays: getStreakDays(this._dailyTimes, this._daily, GOAL),
      streakWeeks: getStreakWeeks(this._dailyTimes, this._daily, GOAL)
    }, () => this.paintRing());
  },
  selectTab(e) {
    this.setData({
      tab: e.currentTarget.dataset.key
    });
    this.updateBooks();
  },
  stopRingAnimation() {
    if (this._stopRingAnimation) this._stopRingAnimation();
    this._stopRingAnimation = null;
  },
  paintRing() {
    this.stopRingAnimation();
    const version = this._ringPaintVersion = (this._ringPaintVersion || 0) + 1;
    const current = () => version === this._ringPaintVersion && !this._disposed && this._visible !== false && this.data.tab === 'reading';
    if (!current()) return;
    wx.nextTick(() => {
      if (!current()) return;
      wx.createSelectorQuery().in(this).select('#wr-ring').fields({
        node: true,
        size: true
      }).exec(results => {
        const res = results && results[0];
        if (!current() || !res || !res.node || !(res.width > 0) || !(res.height > 0)) return;
        const canvas = res.node,
          context = canvas.getContext('2d');
        if (!context) return;
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const ratio = Number.isFinite(info.pixelRatio) && info.pixelRatio > 0 ? info.pixelRatio : 1;
        const width = res.width,
          height = res.height;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        context.scale(ratio, ratio);
        this._stopRingAnimation = animateRing({
          canvas,
          context,
          width,
          height,
          fromMinutes: this._ringDisplayedMinutes,
          minutes: this._todayMinutes || 0,
          goal: GOAL,
          isCurrent: current,
          onFrame: value => {
            this._ringDisplayedMinutes = value;
          }
        });
      });
    });
  },
  touchStart(e) {
    const t = e.touches[0];
    this._touch = {
      x: t.clientX,
      y: t.clientY
    };
  },
  touchEnd(e) {
    if (!this._touch) return;
    const t = e.changedTouches[0],
      dx = t.clientX - this._touch.x,
      dy = t.clientY - this._touch.y;
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
    const index = TABS.findIndex(tab => tab.key === this.data.tab) + (dx < 0 ? 1 : -1);
    if (TABS[index]) {
      this.setData({
        tab: TABS[index].key
      });
      this.updateBooks();
    }
  }
});
