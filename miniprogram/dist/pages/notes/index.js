"use strict";

const api = require('../../api/index');
const search = require("../../utils/notes-search.js");
const {
  createPageRefresh
} = require('../../utils/page-refresh');
const {
  readCache,
  writeCache
} = require('../../utils/cache');
const build = require('../../build-info');
const KEY = 'notes_cache_v1';
const EMPTY_FORM = {
  title: '',
  summary: '',
  tags: ''
};
Page({
  data: {
    search: '',
    sections: [],
    subtitle: '随机回顾',
    warning: '',
    loading: true,
    emptyText: '暂无笔记',
    resultPage: 0,
    resultPages: 1,
    showAdd: false,
    form: {
      ...EMPTY_FORM
    },
    saving: false,
    version: `v${build.version} · ${build.revision}`
  },
  onLoad() {
    this._notes = readCache(KEY, {}).notes || [];
    this._diaries = [];
    this._essays = [];
    this._fallback = [];
    this._status = {
      notes: this._notes.length ? 'ready' : 'loading',
      diary: 'loading',
      essays: 'loading'
    };
    this._seq = 0;
    this._query = '';
    this._resultPage = 0;
    this.pickFallback();
    this.updateResults();
    this._refresh = createPageRefresh(() => this.refreshAll(), this);
  },
  onShow() {
    this._refresh.start();
  },
  onHide() {
    this._refresh.stop();
  },
  onUnload() {
    this._refresh.stop();
    clearTimeout(this._searchTimer);
    this._seq++;
    this._disposed = true;
  },
  pickFallback() {
    const pool = this._notes.slice(),
      picked = [];
    while (picked.length < 3 && pool.length) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    this._fallback = picked;
  },
  async refreshAll() {
    const seq = ++this._seq;
    this._status = {
      notes: 'loading',
      diary: 'loading',
      essays: 'loading'
    };
    this.updateResults();
    const run = async (name, request, accept) => {
      try {
        const value = await request();
        if (seq !== this._seq || this._disposed) return false;
        accept(value);
        this._status[name] = 'ready';
        this.updateResults();
        return true;
      } catch {
        if (seq === this._seq && !this._disposed) {
          this._status[name] = 'error';
          this.updateResults();
        }
        ;
        return false;
      }
    };
    const results = await Promise.all([run('notes', api.getData, data => {
      this._notes = data.notes || [];
      writeCache(KEY, {
        notes: this._notes
      });
      this.pickFallback();
    }), run('diary', async () => {
      await api.waitForDiarySaves();
      return api.getDiary();
    }, data => {
      this._diaries = search.buildDiaryEntries(data);
    }), run('essays', api.getEssays, data => {
      this._essays = data.items || [];
    })]);
    return results.every(Boolean);
  },
  updateResults() {
    if (this._disposed) return;
    const now = new Date(),
      today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayNotes = this._notes.filter(note => note.updatedAt === today);
    const fallback = todayNotes.length ? todayNotes : this._fallback;
    const notes = search.filterNotes(this._notes, this._query, fallback);
    const diaries = search.filterDiary(this._diaries, this._query);
    const essays = search.filterEssays(this._essays, this._query);
    const hasSearch = Boolean(search.normalizeSearchValue(this._query));
    const diaryFirst = hasSearch && search.getDiarySearchTags(this._query).length > 0;
    const noteSection = {
      kind: 'note',
      title: '',
      items: notes.map(note => ({
        id: note.id,
        title: note.title,
        summary: note.summary || '',
        updatedAt: note.updatedAt || '',
        tags: note.tags || [],
        key: `note-${note.id}`
      }))
    };
    const diarySection = {
      kind: 'diary',
      title: diaryFirst ? '' : notes.length ? '日记' : '',
      items: diaries.map(entry => ({
        date: entry.date,
        content: entry.content,
        key: `diary-${entry.date}`,
        displayTags: Object.entries(search.normalizeDiaryTagScores(entry.tagScores, entry.tags)).slice(0, 3).map(([tag, score]) => ({
          tag,
          score
        }))
      }))
    };
    const essaySection = {
      kind: 'essay',
      title: notes.length || diaries.length ? '长篇思想' : '',
      items: essays.map(essay => ({
        id: essay.id,
        title: essay.title,
        content: essay.content,
        date: essay.date || '',
        key: `essay-${essay.id}`
      }))
    };
    const count = notes.length + diaries.length + essays.length;
    const names = {
      notes: '笔记',
      diary: '日记',
      essays: '长篇思想'
    };
    const failures = Object.keys(this._status).filter(name => this._status[name] === 'error').map(name => names[name]);
    const ordered = diaryFirst ? [diarySection, noteSection, essaySection] : [noteSection, diarySection, essaySection];
    const pages = [[]];
    let bytes = 0;
    ordered.forEach(section => section.items.forEach(item => {
      // Conservative UTF-8 estimate; keep a page well below setData's payload limit.
      const size = JSON.stringify(item).length * 3;
      if (pages[pages.length - 1].length && (pages[pages.length - 1].length >= 10 || bytes + size > 600000)) {
        pages.push([]);
        bytes = 0;
      }
      pages[pages.length - 1].push({
        section,
        item
      });
      bytes += size;
    }));
    this._resultPage = Math.min(this._resultPage, pages.length - 1);
    const visible = pages[this._resultPage];
    const sections = ordered.map(section => ({
      kind: section.kind,
      title: section.title,
      items: visible.filter(row => row.section === section).map(row => row.item)
    })).filter(section => section.items.length);
    this.setData({
      sections,
      resultPage: this._resultPage,
      resultPages: pages.length,
      subtitle: search.normalizeSearchValue(this.data.search) !== search.normalizeSearchValue(this._query) ? '搜索中…' : hasSearch ? `${count} 个结果` : todayNotes.length ? `今天 ${todayNotes.length} 条` : '随机回顾',
      warning: failures.length ? `${failures.join('、')}加载失败，点此重试` : '',
      loading: !this._notes.length && !this._diaries.length && !this._essays.length && Object.values(this._status).some(status => status === 'loading'),
      emptyText: hasSearch ? '无匹配结果' : '暂无笔记'
    });
  },
  inputSearch(e) {
    this._resultPage = 0;
    this.setData({
      search: e.detail.value
    });
    clearTimeout(this._searchTimer);
    this.updateResults();
    this._searchTimer = setTimeout(() => {
      this._query = this.data.search;
      this.updateResults();
    }, 200);
  },
  previousResults() {
    if (this._resultPage > 0) {
      this._resultPage--;
      this.updateResults();
    }
  },
  nextResults() {
    if (this._resultPage + 1 < this.data.resultPages) {
      this._resultPage++;
      this.updateResults();
    }
  },
  clearSearch() {
    this._resultPage = 0;
    clearTimeout(this._searchTimer);
    this._query = '';
    this.setData({
      search: ''
    });
    this.updateResults();
  },
  openAdd() {
    this.setData({
      showAdd: true,
      form: {
        ...EMPTY_FORM
      }
    });
  },
  dismissAdd() {
    if (!this.data.saving) this.setData({
      showAdd: false
    });
  },
  noop() {},
  inputForm(e) {
    this.setData({
      [`form.${e.currentTarget.dataset.field}`]: e.detail.value
    });
  },
  async saveNote() {
    if (this.data.saving) return;
    if (!this.data.form.title.trim()) {
      wx.showToast({
        title: '请输入笔记标题',
        icon: 'none'
      });
      return;
    }
    const form = {
      ...this.data.form
    };
    this.setData({
      saving: true
    });
    try {
      const result = await api.addNote({
        title: form.title,
        summary: form.summary,
        tags: form.tags.split(/[,，\s]+/).filter(Boolean),
        projectId: null
      });
      if (this._disposed) return;
      this._notes = [result.note, ...this._notes];
      writeCache(KEY, {
        notes: this._notes
      });
      this.pickFallback();
      this.setData({
        resultPage: 0,
        resultPages: 1,
        showAdd: false,
        form: {
          ...EMPTY_FORM
        }
      });
      this.updateResults();
      wx.showToast({
        title: '已保存',
        icon: 'success'
      });
    } catch {
      wx.showToast({
        title: '保存失败，请重试',
        icon: 'none'
      });
    } finally {
      if (!this._disposed) this.setData({
        saving: false
      });
    }
  }
});
