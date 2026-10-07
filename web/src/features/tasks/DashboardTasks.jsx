import { React, useState, useRef, useEffect } from '../../core/react.mjs';
import { TaskRow } from './TaskRow.jsx';

const TASK_TYPES = [
  { value: 'daily', label: '每日任务', title: '今日聚焦' },
  { value: 'weekly', label: '每周任务', title: '本周聚焦' },
  { value: 'longterm', label: '长期任务', title: '长期聚焦' },
];

function FocusTypePicker({ taskType, onChange }) {
  const [open, setOpen] = useState(false);
  const picker = useRef(null), trigger = useRef(null);
  const current = TASK_TYPES.find(item => item.value === taskType) || TASK_TYPES[0];
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const dismiss = event => { if (!picker.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    picker.current?.querySelector(`[data-task-type="${taskType}"]`)?.focus();
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, taskType]);
  const navigate = event => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    const choices = [...picker.current.querySelectorAll('[data-task-type]')];
    const index = choices.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % choices.length : event.key === 'ArrowUp' ? (index + choices.length - 1) % choices.length : event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : null;
    if (next !== null) { event.preventDefault(); choices[next].focus(); }
  };
  return <div className="focus-type-picker" ref={picker} onKeyDown={navigate} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <h2 className="serif"><button ref={trigger} className="focus-type-trigger" aria-label={`切换聚焦任务类型，当前${current.label}`} aria-haspopup="menu" aria-expanded={open} aria-controls="focus-type-menu" onClick={() => setOpen(value => !value)}>{current.title}<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button></h2>
    {open && <div id="focus-type-menu" className="focus-type-menu" role="menu" aria-label="聚焦任务类型">{TASK_TYPES.map(item => <button key={item.value} data-task-type={item.value} role="menuitemradio" aria-checked={taskType === item.value} tabIndex={-1} onClick={() => { onChange(item.value); close(); }}><span>{item.label}</span><span aria-hidden="true">{taskType === item.value ? '✓' : ''}</span></button>)}</div>}
  </div>;
}

export function DashboardTasks({ tasks, ready, onTask, onToggle, taskType = 'daily', onSelectTaskType }) {
  const selected = TASK_TYPES.find(item => item.value === taskType) || TASK_TYPES[0];
  const scoped = tasks.filter(task => task.taskType === taskType);
  const pending = scoped.filter(task => task.status !== 'completed');
  const done = scoped.length - pending.length;
  return <section className="dashboard-tasks" aria-label="看板待办任务">
    <div className="workspace-section-heading"><div><FocusTypePicker taskType={taskType} onChange={onSelectTaskType} /><p>{!ready ? '正在读取任务' : `${selected.label} · 已完成 ${done} / ${scoped.length}`}</p></div></div>
    <div className="workbench-today-list">{!ready ? <p className="workbench-empty">任务数据尚未读取。</p> : !pending.length ? <p className="workbench-empty">{scoped.length ? `${selected.label}已全部完成。` : `还没有${selected.label}，从右上角添加。`}</p> : pending.map(task => <TaskRow key={task.id} task={task} onTask={onTask} onToggle={onToggle} />)}</div>
  </section>;
}
