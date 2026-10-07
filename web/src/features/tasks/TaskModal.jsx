import { React, useState, useMemo, useRef, useEffect, useCallback } from '../../core/react.mjs';
import { PRIORITY, CATEGORY, EMPTY } from './model.mjs';
function TaskModal({ task, books, onSave, onClose }) {
  const [f, setF] = useState(task ? { ...task } : EMPTY);
  const set = (k,v) => setF(p=>({...p,[k]:v}));

  const inp  = "w-full px-3 py-2 bg-paper border border-line rounded-lg text-sm text-ink";
  const lbl  = "block text-xs font-medium text-muted mb-1.5";
  const btnSel = (a) => `px-2 py-1 rounded-md text-xs border transition-colors cursor-pointer ${a ? 'bg-accent text-white border-accent' : 'bg-paper text-muted border-line hover:border-muted'}`;

  return (
    <div className="anim-fade fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="anim-up bg-paper rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h3 className="serif font-semibold text-base">{task ? '编辑任务' : '新增任务'}</h3>
          <button onClick={onClose} className="text-muted hover:text-muted text-2xl leading-none font-light">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className={lbl}>任务名称 *</label>
            <input className={inp} placeholder="这件事叫什么..." value={f.title} onChange={e=>set('title',e.target.value)} />
          </div>

          <div>
            <label className={lbl}>类型</label>
            <div className="flex gap-1.5">
              {[['daily','☀️ 每日任务'],['weekly','📅 本周任务'],['longterm','🎯 长期计划']].map(([v,l])=>(
                <button key={v} className={btnSel(f.taskType===v)} onClick={()=>set('taskType',v)}>{l}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lbl}>优先级</label>
              <div className="flex gap-1.5">
                {Object.entries(PRIORITY).map(([k,v]) => (
                  <button key={k} className={btnSel(f.priority===k)} onClick={()=>set('priority',k)}>{v.label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className={lbl}>分类</label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(CATEGORY).map(([k,v]) => (
                  <button key={k} className={btnSel(f.category===k)} onClick={()=>set('category',k)}>{v.label}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-line">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-body rounded-lg hover:bg-canvas transition-colors">取消</button>
          <button onClick={()=>{ if (!f.title.trim()) return; onSave(f); }}
            className="px-5 py-2 text-sm bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors font-medium">
            {task ? '保存修改' : '创建任务'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { TaskModal };
