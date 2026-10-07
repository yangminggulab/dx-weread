"use strict";

const api = require('../../api/index');
const {
  createPageRefresh
} = require('../../utils/page-refresh');
const {
  readCache,
  writeCache
} = require('../../utils/cache');
const {
  TYPE_TABS,
  PRIORITY_MAP,
  CATEGORY_MAP,
  EMPTY_FORM,
  TYPE_LABEL,
  PRIORITY_LABEL,
  normalizeStatus
} = require("../../features/tasks/model.js");
const {
  createKeyboardSheet
} = require('../../utils/keyboard-sheet');
const KEY = 'tasks_cache_v1';
Page({
  data: {
    tab: 'daily',
    tabs: TYPE_TABS,
    loading: true,
    active: [],
    completed: [],
    inProgressCount: 0,
    dailyCount: 0,
    completedCount: 0,
    showForm: false,
    editID: null,
    form: {
      ...EMPTY_FORM
    },
    formSaving: false,
    typeOptions: Object.keys(TYPE_LABEL).map(key => ({
      key,
      label: TYPE_LABEL[key]
    })),
    priorityOptions: Object.keys(PRIORITY_LABEL).map(key => ({
      key,
      label: PRIORITY_LABEL[key]
    }))
  },
  onLoad() {
    this._sheet = createKeyboardSheet(this);
    this._tasks = readCache(KEY, {}).tasks || [];
    this._pending = new Set();
    this._mutationVersion = 0;
    this._taskWrites = new Map();
    this.updateTasks(this._tasks);
    this._refresh = createPageRefresh(() => this.loadData(), this);
  },
  onShow() {
    if (this.data.showForm && this._form) this.setData({
      form: {
        ...this._form
      }
    }, () => this._sheet.open());
    this._refresh.start();
  },
  onHide() {
    this._refresh.stop();
    this._sheet.close();
  },
  onUnload() {
    this._refresh.stop();
    this._sheet.dispose();
    this._disposed = true;
  },
  async loadData() {
    if (this._loading) return false;
    this._loading = true;
    const version = this._mutationVersion;
    try {
      const data = await api.getData();
      if (this._disposed) return false;
      const local = new Map(this._tasks.map(task => [task.id, task]));
      const protectedIDs = new Set([...this._taskWrites].filter(([id, written]) => written > version || this._pending.has(id)).map(([id]) => id));
      const tasks = (data.tasks || []).map(task => {
        const known = local.get(task.id);
        // A genuinely newer remote revision still wins after our write settles.
        const newer = known && Date.parse(task.updatedAt) > Date.parse(known.updatedAt);
        return known && protectedIDs.has(task.id) && (this._pending.has(task.id) || !newer) ? known : task;
      });
      const incomingIDs = new Set(tasks.map(task => task.id));
      this._tasks.forEach(task => {
        if (protectedIDs.has(task.id) && !incomingIDs.has(task.id)) tasks.push(task);
      });
      this.updateTasks(tasks);
      writeCache(KEY, {
        ...data,
        tasks
      });
      for (const [id, written] of this._taskWrites) {
        if (written <= version && !this._pending.has(id)) this._taskWrites.delete(id);
      }
      return true;
    } catch {
      return false;
    } finally {
      this._loading = false;
      if (!this._disposed) this.setData({
        loading: false
      });
    }
  },
  updateTasks(tasks) {
    if (this._disposed) return;
    this._tasks = tasks;
    const mapped = tasks.map(task => ({
      ...task,
      normalizedStatus: normalizeStatus(task.status),
      priorityLabel: (PRIORITY_MAP[task.priority] || {}).label || '',
      priorityClass: (PRIORITY_MAP[task.priority] || {}).cls || '',
      categoryLabel: CATEGORY_MAP[task.category] || task.category || '',
      progress: task.totalPage > 0 ? Math.round(task.currentPage / task.totalPage * 100) : 0
    }));
    this.setData({
      active: mapped.filter(task => task.taskType === this.data.tab && task.normalizedStatus !== 'completed'),
      completed: mapped.filter(task => task.taskType === this.data.tab && task.normalizedStatus === 'completed'),
      inProgressCount: tasks.filter(task => normalizeStatus(task.status) !== 'completed').length,
      dailyCount: tasks.filter(task => task.taskType === 'daily' && normalizeStatus(task.status) !== 'completed').length,
      completedCount: tasks.filter(task => normalizeStatus(task.status) === 'completed').length
    });
  },
  cacheTasks() {
    writeCache(KEY, {
      ...readCache(KEY, {}),
      tasks: this._tasks
    });
  },
  recordTaskWrite(id) {
    this._taskWrites.set(id, ++this._mutationVersion);
  },
  selectTab(e) {
    const tab = e.currentTarget.dataset.key;
    if (!TYPE_TABS.some(item => item.key === tab)) return;
    this.setData({
      tab
    });
    this.updateTasks(this._tasks);
  },
  openAdd() {
    this._form = {
      ...EMPTY_FORM,
      taskType: this.data.tab
    };
    this.setData({
      showForm: true,
      editID: null,
      form: {
        ...this._form
      }
    }, () => this._sheet.open());
  },
  openEdit(e) {
    const task = this._tasks.find(item => String(item.id) === String(e.currentTarget.dataset.id));
    if (task) {
      this._form = {
        title: task.title || '',
        taskType: task.taskType || 'weekly',
        priority: task.priority || 'medium',
        category: task.category || 'study'
      };
      this.setData({
        showForm: true,
        editID: task.id,
        form: {
          ...this._form
        }
      }, () => this._sheet.open());
    }
  },
  // Native typing stays in the textarea; only the form model changes on each key.
  inputTitle(e) {
    if (this._form) this._form.title = e.detail.value;
  },
  sheetFocus(e) {
    this._sheet.focus(e);
  },
  selectType(e) {
    this._form.taskType = e.currentTarget.dataset.key;
    this.setData({
      'form.taskType': this._form.taskType
    });
  },
  selectPriority(e) {
    this._form.priority = e.currentTarget.dataset.key;
    this.setData({
      'form.priority': this._form.priority
    });
  },
  dismissForm() {
    if (!this.data.formSaving) {
      this._sheet.close();
      wx.hideKeyboard();
      this.setData({
        showForm: false
      });
    }
  },
  noop() {},
  async saveForm() {
    if (this.data.formSaving) return;
    if (!this._form || !this._form.title.trim()) {
      this.dismissForm();
      return;
    }
    this.setData({
      formSaving: true
    });
    const form = {
        ...this._form
      },
      id = this.data.editID;
    try {
      if (id != null) {
        this.recordTaskWrite(id);
        const receipt = await api.updateTask({
          id,
          ...form
        });
        if (this._disposed) return;
        this.recordTaskWrite(id);
        this.updateTasks(this._tasks.map(task => task.id === id ? receipt.task : task));
      } else {
        const receipt = await api.addTask({
          ...form,
          status: 'in_progress'
        });
        if (this._disposed) return;
        this.recordTaskWrite(receipt.task.id);
        this.updateTasks([...this._tasks, receipt.task]);
      }
      this.cacheTasks();
      if (!this._disposed) {
        this._sheet.close();
        wx.hideKeyboard();
        this.setData({
          showForm: false
        });
      }
    } catch {
      wx.showToast({
        title: '保存失败，请重试',
        icon: 'none'
      });
    } finally {
      if (!this._disposed) this.setData({
        formSaving: false
      });
    }
  },
  async toggleStatus(e) {
    const task = this._tasks.find(item => String(item.id) === String(e.currentTarget.dataset.id));
    if (!task || this._pending.has(task.id)) return;
    this._pending.add(task.id);
    this.recordTaskWrite(task.id);
    const status = normalizeStatus(task.status) === 'completed' ? 'in_progress' : 'completed';
    this.updateTasks(this._tasks.map(item => item.id === task.id ? {
      ...item,
      status
    } : item));
    try {
      const receipt = await api.updateTask({
        id: task.id,
        status
      });
      if (this._disposed) return;
      this.recordTaskWrite(task.id);
      this.updateTasks(this._tasks.map(item => item.id === task.id ? receipt.task : item));
      this.cacheTasks();
    } catch {
      if (this._disposed) return;
      this.recordTaskWrite(task.id);
      this.updateTasks(this._tasks.map(item => item.id === task.id ? {
        ...item,
        status: task.status
      } : item));
      wx.showToast({
        title: '更新失败',
        icon: 'none'
      });
    } finally {
      this._pending.delete(task.id);
    }
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
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const index = TYPE_TABS.findIndex(tab => tab.key === this.data.tab) + (dx < 0 ? 1 : -1);
    if (TYPE_TABS[index]) {
      this.setData({
        tab: TYPE_TABS[index].key
      });
      this.updateTasks(this._tasks);
    }
  }
});
