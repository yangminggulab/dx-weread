import { React } from '../../core/react.mjs';
import { isNear, isOver, categoryInfo, priorityInfo } from './model.mjs';

export function TaskRow({ task, onTask, onToggle }) {
  const overdue = isOver(task.deadline, task.status);
  return <div className="workbench-task-row">
    <button className="dashboard-complete" aria-label={`完成任务：${task.title}`} onClick={() => onToggle(task.id)}><span /></button>
    <button className="workbench-task-detail" aria-label={`查看任务：${task.title}`} onClick={() => onTask(task)}>
      <strong>{task.title}</strong>
      <span className="workbench-task-meta"><span className={`task-priority priority-${task.priority || 'medium'}`}>{priorityInfo(task.priority).label}优先级</span><span>{categoryInfo(task.category).label}</span>{task.deadline && <span className={overdue ? 'text-danger' : isNear(task.deadline) ? 'text-warning' : ''}>{overdue ? '逾期 ' : ''}{task.deadline.slice(5, 10)}</span>}{task.currentPage != null && task.totalPage > 0 && <span>{task.currentPage} / {task.totalPage} 页</span>}</span>
    </button>
  </div>;
}
