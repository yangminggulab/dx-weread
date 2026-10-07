import { React, useState, useMemo, useRef, useEffect, useCallback } from '../../core/react.mjs';
import { STATUS, PRIORITY, CATEGORY, isNear, isOver, categoryInfo, priorityInfo, statusInfo } from './model.mjs';
import { Pill } from '../../shared/components.jsx';
function TaskDetail({ task, books, onEdit, onComplete, onClose }) {
  const proj = books.find(b=>b.id===task.projectId);
  const near = isNear(task.deadline);
  const over = isOver(task.deadline, task.status);
  return (
    <div className="anim-fade fixed inset-0 bg-black/25 z-50 flex justify-end" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="anim-right bg-paper h-full w-80 shadow-2xl flex flex-col border-l border-line">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <Pill text={statusInfo(task.status).label} cls={statusInfo(task.status).pill} />
          <div className="flex items-center gap-3">
            <button onClick={onEdit}   className="text-xs text-accent hover:underline">编辑</button>
            <button onClick={onComplete} className="text-xs text-accent hover:underline">完成</button>
            <button onClick={onClose}  className="text-muted hover:text-muted text-2xl font-light leading-none ml-1">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <h3 className="serif text-base font-semibold text-ink leading-snug mb-5">{task.title}</h3>
          <div className="space-y-3 text-sm">
            <DR label="优先级"><Pill text={priorityInfo(task.priority).label} cls={priorityInfo(task.priority).cls} /></DR>
            <DR label="分类"><Pill text={categoryInfo(task.category).label} cls={categoryInfo(task.category).cls} /></DR>
            {task.deadline && (
              <DR label="截止日期">
                <span className={`text-sm ${over?'text-danger font-medium':near?'text-warning font-medium':'text-body'}`}>
                  {task.deadline}{over?' · 已逾期':near?' · 即将到期':''}
                </span>
              </DR>
            )}
            {proj && <DR label="关联书目"><span className="text-sm text-accent">{proj.title}</span></DR>}
            {(task.tags || []).length>0 && (
              <DR label="标签">
                <div className="flex flex-wrap gap-1">
                  {task.tags.map(t=><span key={t} className="text-xs bg-surface text-muted px-2 py-0.5 rounded-full">{t}</span>)}
                </div>
              </DR>
            )}
          </div>
          {task.notes && (
            <div className="mt-5 pt-5 border-t border-track">
              <div className="text-xs text-muted uppercase tracking-wider mb-2">备注</div>
              <p className="text-sm text-body leading-relaxed">{task.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DR({ label, children }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-muted w-14 shrink-0 pt-0.5">{label}</span>
      <div>{children}</div>
    </div>
  );
}

export { TaskDetail };
