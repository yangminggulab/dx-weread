import { React, useState, useMemo } from '../../core/react.mjs';
import { Pill, SectionHead } from '../../shared/components.jsx';
import { getFullNoteText, pickDisplayTime } from './model.mjs';

export function WeReadNotes({ notes, fullPage = false }) {
  const orderedNotes = useMemo(() => [...notes].sort((a, b) => (b.sourceUpdatedTimestamp || 0) - (a.sourceUpdatedTimestamp || 0)), [notes]);
  const [expanded, setExpanded] = useState(fullPage), [query, setQuery] = useState(''), [selectedID, setSelectedID] = useState(null);
  const filtered = useMemo(() => orderedNotes.filter(note => !query.trim() ||
    [note.title, note.summary, note.bookTitle, note.chapterTitle].join(' ').toLowerCase().includes(query.trim().toLowerCase())), [orderedNotes, query]);
  const visibleNotes = fullPage || expanded || query ? filtered : filtered.slice(0, 3);
  const identity = note => `${typeof note.id}:${note.id ?? note.sourceItemId ?? note.title}`;
  // Always derive the selected body from the latest source payload.
  const selected = visibleNotes.find(note => identity(note) === selectedID) || visibleNotes[0] || null;
  return <section aria-label="微信读书笔记">
    <div className={fullPage ? 'notes-toolbar' : ''}><SectionHead title="微信读书笔记" sub={fullPage ? `${notes.length} 条同步笔记` : undefined}
      right={!fullPage && notes.length > 3 && <button className="text-xs text-accent" onClick={() => { setExpanded(!expanded); setQuery(''); }}>{expanded ? '最近三条' : `全部 ${notes.length} 条`}</button>} />
    {(fullPage || expanded) && <input aria-label="搜索微信读书笔记" className={`workspace-search ${fullPage ? '' : 'mb-4'}`} placeholder="搜索笔记、书名或章节" value={query} onChange={event => setQuery(event.target.value)} />}</div>
    <div className={`notes-workspace ${fullPage ? 'is-full-page' : ''}`}>
      <aside aria-label="笔记列表" className="notes-list">
        {visibleNotes.length ? visibleNotes.map(note => <button key={identity(note)} aria-pressed={identity(selected) === identity(note)} onClick={() => setSelectedID(identity(note))}
          className={`note-list-entry ${identity(selected) === identity(note) ? 'is-active' : ''}`}>
          <strong>{note.title}</strong>{note.bookTitle && <small>{note.bookTitle}</small>}
          <div className="flex gap-1 flex-wrap">{(note.tags || []).map(tag => <span key={tag} className="text-[11px] bg-surface text-muted px-1.5 py-0.5 rounded-full">{tag}</span>)}</div>
          <small>{pickDisplayTime(note, 'sourceUpdatedAt')}</small>
        </button>) : <p className="p-5 text-xs text-muted">{query ? '没有匹配的笔记' : '还没有同步笔记'}</p>}
      </aside>
      <article className="note-reading-pane">
        {selected ? <>
          <div className="flex items-start justify-between gap-3 mb-3"><h3 className="serif font-semibold text-lg text-ink leading-snug">{selected.title}</h3><span className="shrink-0 text-[11px] bg-accent-soft text-accent px-2 py-1 rounded-full">微信读书</span></div>
          {selected.bookTitle && <div className="text-sm text-muted mb-4">{selected.bookTitle}</div>}
          {!!selected.tags?.length && <div className="flex gap-1 mb-5 flex-wrap">{selected.tags.map(tag => <Pill key={tag} text={tag} cls="bg-surface text-muted" />)}</div>}
          <p className="text-[15px] text-body leading-[1.9] whitespace-pre-wrap break-words">{getFullNoteText(selected.summary)}</p>
          <div className="text-xs text-muted mt-8">记录时间：{pickDisplayTime(selected, 'sourceUpdatedAt')}</div>
        </> : <p className="text-sm text-muted py-8">{query ? '试试其他关键词。' : '选择一条笔记查看内容。'}</p>}
      </article>
    </div>
  </section>;
}
