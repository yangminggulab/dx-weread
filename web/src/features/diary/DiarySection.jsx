import { React, useState } from '../../core/react.mjs';
import { SectionHead } from '../../shared/components.jsx';

export function DiarySection({ controller, state, fullPage = false, dashboard = false, onExpand }) {
  const [showHistory, setShowHistory] = useState(false);
  const status = state.storageError || state.error || (state.conflict ? '有其他端更新，草稿已保留' : '');
  const dates = [...new Set([...state.history.map(entry => entry.date), ...state.drafts])].filter(date => date !== controller.diary.today.date).sort().reverse();
  return (
    <section id={dashboard ? 'diary' : undefined} className={dashboard ? 'dashboard-diary' : fullPage ? "diary-editor" : "flex flex-col h-full"} aria-label="日记书写区">
      {dashboard ? <div className="workspace-section-heading"><div><h2 className="serif">{state.selectedDate ? '过往日记' : '今日日记'}</h2><p>{state.entry?.date || '等待同步'}</p></div><div className="section-actions"><button aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>历史</button><button onClick={onExpand}>展开</button></div></div> : !fullPage && <SectionHead title={state.selectedDate ? '过往日记' : '今日日记'} right={<button className="text-xs text-accent" onClick={() => setShowHistory(!showHistory)}>历史</button>} />}
      {!fullPage && showHistory && <div className="mb-3 space-y-2">
        <select aria-label="选择日记日期" className="w-full border border-line rounded-lg p-2 text-sm" value={state.selectedDate || ''} onChange={event => controller.select(event.target.value || null)}>
          <option value="">今天</option>{dates.map(date => <option key={date} value={date}>{date}{state.drafts.includes(date) ? ' · 草稿' : ''}</option>)}
        </select>
      </div>}
      <div className={dashboard ? 'dashboard-diary-paper' : fullPage ? "diary-writing-paper" : "flex-1 bg-paper rounded-2xl border border-line p-4 flex flex-col"}>
        {state.entry && !dashboard && (fullPage ? <div className="diary-writing-heading"><span>{state.selectedDate ? "过往 · 日记" : "今天 · 书写"}</span><h2>{state.entry.date}</h2></div> : <div className="text-xs text-muted mb-3">{state.entry.date}</div>)}
        <textarea className="diary-textarea flex-1 resize-none text-sm text-ink leading-relaxed placeholder-placeholder bg-transparent border-none outline-none min-h-[150px]"
          aria-label="日记正文" placeholder={state.entry ? '今天发生了什么，记录下来…' : '同步后即可开始记录'}
          disabled={!state.entry || state.loading && !state.dirty} value={state.entry?.content || ''}
          onChange={event => controller.edit(event.target.value)} onBlur={() => controller.save()} />
        <div className="border-t border-line-soft pt-3 mt-3 flex flex-wrap items-center gap-2 text-[11px]" role="status" aria-live="polite">
          <span className="text-muted">{state.entry?.content.length || 0} 字</span>
          {status && <span className="ml-auto text-warning">{status}</span>}
        </div>
        {state.conflict && <div className="mt-3 rounded-lg bg-warning-soft p-3 text-xs text-warning space-y-3">
          <p>{state.conflict.unavailable ? '这一天暂时没有云端记录，草稿已保留。' : '云端版本已有更新，请核对后选择：'}</p>
          {!state.conflict.unavailable && <><p className="max-h-32 overflow-auto whitespace-pre-wrap select-text">{state.conflict.content || '（云端正文为空）'}</p>
            <div className="flex flex-wrap gap-3"><button disabled={state.saving} className="underline" onClick={() => controller.useCloud()}>使用云端内容</button>
              <button disabled={state.saving} className="underline" onClick={() => controller.keepDraft()}>核对后保存我的草稿</button></div></>}
        </div>}

      </div>
    </section>
  );
}
