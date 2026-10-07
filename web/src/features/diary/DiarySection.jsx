import { React, useState } from '../../core/react.mjs';
import { SectionHead } from '../../shared/components.jsx';

export function DiarySection({ controller, state, fullPage = false, dashboard = false, onExpand }) {
  const [showHistory, setShowHistory] = useState(false);
  const status = state.storageError || (state.saving ? '保存中…' : state.conflict ? '有其他端更新，草稿已保留'
    : state.error || (state.restored ? '已恢复草稿，等待核对云端' : state.dirty ? '本机已保存 · 等待同步' : state.loading ? '正在读取云端' : '已同步'));
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
          {state.automatic && <button className="text-muted underline" onClick={() => controller.loadVersions()}>版本历史</button>}
          <span className={`ml-auto ${state.error || state.conflict || state.storageError ? 'text-warning' : 'text-muted'}`}>{status}</span>
          {state.dirty && !state.conflict && <button className="text-accent underline" disabled={state.saving || state.restored} onClick={() => controller.save()}>保存</button>}
          {state.error && !state.conflict && <button className="text-accent underline" onClick={() => controller.refresh()}>重新同步</button>}
        </div>
        {state.conflict && <div className="mt-3 rounded-lg bg-warning-soft p-3 text-xs text-warning space-y-3">
          <p>{state.conflict.unavailable ? '这一天暂时没有云端记录，草稿已保留。' : '云端版本已有更新，请核对后选择：'}</p>
          {!state.conflict.unavailable && <><p className="max-h-32 overflow-auto whitespace-pre-wrap select-text">{state.conflict.content || '（云端正文为空）'}</p>
            <div className="flex flex-wrap gap-3"><button disabled={state.saving} className="underline" onClick={() => controller.useCloud()}>使用云端内容</button>
              <button disabled={state.saving} className="underline" onClick={() => controller.keepDraft()}>核对后保存我的草稿</button></div></>}
        </div>}
        {state.versionsOpen && <div className="mt-3 rounded-lg border border-line p-3 space-y-3" aria-label="日记版本历史">
          <div className="flex justify-between"><strong className="text-xs">版本历史</strong><button className="text-xs underline" onClick={() => controller.closeVersions()}>关闭</button></div>
          {state.versionsLoading && <p className="text-xs text-muted">正在读取…</p>}
          {!state.versions.length && !state.versionsLoading && <p className="text-xs text-muted">暂无保存的版本</p>}
          {state.versions.map(version => <div key={version.id} className="border-t border-line-soft pt-3 text-xs space-y-2">
            <p className="text-muted">{new Date(version.createdAt).toLocaleString('zh-CN')} · {{ apple: 'Apple 客户端', web: '网页', miniprogram: '微信小程序', server: '云端' }[version.source] || '云端'}</p>
            <p className="whitespace-pre-wrap max-h-32 overflow-auto select-text">{version.content || '（空白正文）'}</p>
            <button className="text-accent underline" disabled={state.saving || state.loading} onClick={() => controller.restoreVersion(version)}>恢复此版本</button>
          </div>)}
          {state.versionsCursor && <button className="text-xs underline" disabled={state.versionsLoading} onClick={() => controller.loadVersions(true)}>更多版本</button>}
        </div>}
      </div>
    </section>
  );
}
