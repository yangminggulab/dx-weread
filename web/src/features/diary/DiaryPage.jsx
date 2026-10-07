import { React, useState } from '../../core/react.mjs';
import { DiarySection } from './DiarySection.jsx';

function DiaryHistory({ controller, state, query, onQuery, onSelect }) {
  const dates = [...new Set([...state.history.map(entry => entry.date), ...state.drafts])]
    .filter(date => date !== controller.diary.today.date).sort().reverse();
  const entries = dates.map(date => state.history.find(entry => entry.date === date) || { date, content: '有未同步的草稿' });
  const filtered = entries.filter(entry => !query.trim() || `${entry.date} ${entry.content}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="diary-history-inner">
    <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">日记本</h2><span className="text-xs text-muted">{entries.length} 篇历史</span></div>
    <input aria-label="搜索日记" value={query} onChange={event => onQuery(event.target.value)} placeholder="搜索日期或正文" className="workspace-search" />
    <button className={`diary-history-today ${!state.selectedDate ? 'is-active' : ''}`} aria-pressed={!state.selectedDate} onClick={() => onSelect(null)}>
      <strong>今天</strong><small>{state.drafts.includes(controller.diary.today.date) ? '有未同步的草稿' : '记录此刻的想法'}</small>
    </button>
    <div className="text-xs text-muted">{query ? `搜索结果 · ${filtered.length}` : '过往记录'}</div>
    <div className="diary-history-list">
      {filtered.map(entry => <button key={entry.date} className={`diary-history-entry ${state.selectedDate === entry.date ? 'is-active' : ''}`} aria-pressed={state.selectedDate === entry.date} onClick={() => onSelect(entry.date)}>
        <span className="flex items-center gap-2"><strong>{entry.date}</strong>{state.drafts.includes(entry.date) && <span className="text-[11px] text-accent">草稿</span>}</span>
        <small className="line-clamp-2">{entry.content.trim() || '空白记录'}</small>
      </button>)}
      {!filtered.length && <p className="py-6 text-xs text-muted text-center">{query ? '没有匹配的日记' : '过往记录会显示在这里'}</p>}
    </div>
  </div>;
}

export function DiaryPage({ controller, state }) {
  const [query, setQuery] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = <DiaryHistory controller={controller} state={state} query={query} onQuery={setQuery} onSelect={date => { controller.select(date); setHistoryOpen(false); }} />;
  return <div className="diary-workspace">
    <aside aria-label="日记历史" className="diary-history-desktop">{history}</aside>
    <details className="diary-history-mobile" open={historyOpen} onToggle={event => setHistoryOpen(event.currentTarget.open)}><summary>历史记录 <span className="text-xs text-muted ml-2">搜索与选择日期</span></summary>{history}</details>
    <DiarySection controller={controller} state={state} fullPage />
  </div>;
}
