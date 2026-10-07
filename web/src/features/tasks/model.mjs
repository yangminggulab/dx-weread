import { themeColor } from '../../shared/theme.mjs';
import { formatLocalDateKey } from '../reading/model.mjs';
const STATUS = {
  todo:         { label:'待开始', pill:'bg-surface text-muted border border-line',     dot:themeColor('muted')    },
  in_progress:  { label:'进行中', pill:'bg-warning-soft text-warning border border-warning-border',  dot:themeColor('warning') },
  completed:    { label:'已完成', pill:'bg-success-soft text-success',                          dot:themeColor('success') },
};
const PRIORITY = {
  high:   { label:'高', cls:'bg-danger-soft text-danger' },
  medium: { label:'中', cls:'bg-warning-soft text-warning' },
  low:    { label:'低', cls:'bg-surface text-muted'    },
};
const CATEGORY = {
  study:    { label:'学习', cls:'bg-accent-soft text-accent' },
  research: { label:'研究', cls:'bg-accent-soft text-accent' },
  note:     { label:'笔记', cls:'bg-accent-soft text-accent' },
  work:     { label:'工作', cls:'bg-accent-soft text-accent' },
  life:     { label:'生活', cls:'bg-accent-soft text-accent' },
};

const isNear = d => { if (!d) return false; const n = (new Date(d.slice(0, 10))-new Date(formatLocalDateKey(new Date())))/(864e5); return n>=0&&n<=3; };
const isOver = (d,s) => s!=='completed' && d && d.slice(0, 10)<formatLocalDateKey(new Date());
const EMPTY = { title:'', taskType:'daily', status:'in_progress', priority:'medium', category:'study', deadline:'', tags:[], notes:'', projectId:null, currentPage:null, totalPage:null };

export { STATUS, PRIORITY, CATEGORY, isNear, isOver, EMPTY };

export const categoryInfo = key => CATEGORY[key] || { label: key || '未分类', cls: 'bg-surface text-muted' };
export const priorityInfo = key => PRIORITY[key] || PRIORITY.medium;
export const statusInfo = key => STATUS[key] || STATUS.todo;
export const getFocusedTasks = tasks => tasks.filter(task => task.taskType === 'daily' && task.status !== 'completed').slice(0, 3);
