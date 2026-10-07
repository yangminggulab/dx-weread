"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TYPE_TABS = exports.TYPE_LABEL = exports.TASKS_CACHE_KEY = exports.PRIORITY_MAP = exports.PRIORITY_LABEL = exports.EMPTY_FORM = exports.CATEGORY_MAP = void 0;
exports.normalizeStatus = normalizeStatus;
const TYPE_TABS = exports.TYPE_TABS = [{
  key: 'daily',
  label: '日常'
}, {
  key: 'weekly',
  label: '本周'
}, {
  key: 'longterm',
  label: '长期'
}];
const PRIORITY_MAP = exports.PRIORITY_MAP = {
  high: {
    label: '高',
    cls: 'priority-high'
  },
  medium: {
    label: '中',
    cls: 'priority-medium'
  },
  low: {
    label: '低',
    cls: 'priority-low'
  }
};
const CATEGORY_MAP = exports.CATEGORY_MAP = {
  study: '学习',
  research: '研究',
  life: '生活',
  note: '笔记'
};
const TYPE_LABEL = exports.TYPE_LABEL = {
  daily: '日常',
  weekly: '本周',
  longterm: '长期'
};
const PRIORITY_LABEL = exports.PRIORITY_LABEL = {
  high: '高',
  medium: '中',
  low: '低'
};
const EMPTY_FORM = exports.EMPTY_FORM = {
  title: '',
  taskType: 'weekly',
  priority: 'medium',
  category: 'study'
};
const TASKS_CACHE_KEY = exports.TASKS_CACHE_KEY = 'tasks_cache_v1';
function normalizeStatus(status) {
  return status === 'todo' ? 'in_progress' : status || 'in_progress';
}
