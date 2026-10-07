import { React, useState } from '../../core/react.mjs';
import { SectionHead } from '../../shared/components.jsx';
import { getFullNoteText, pickDisplayTime } from './model.mjs';

export function WereadRecent({ notes, updates }) {
  const [index, setIndex] = useState(0);
  const ordered = [...notes].sort((a, b) => (b.sourceUpdatedTimestamp || 0) - (a.sourceUpdatedTimestamp || 0));
  const note = ordered.length ? ordered[index % ordered.length] : null;
  return <section className="reading-revisit" aria-label={note ? '笔记回顾' : '最近动态'}>
    <SectionHead title={note ? '再读一段' : '最近动态'} right={ordered.length > 1 && <button onClick={() => setIndex(value => value + 1)}>换一条</button>} />
    {note ? <div className="reading-revisit-paper"><h3>{note.title}</h3><p>{getFullNoteText(note.summary)}</p><div><span>{note.bookTitle || '微信读书'}</span><time>{pickDisplayTime(note, 'sourceUpdatedAt', 'updatedAt')}</time></div></div> : <div className="reading-revisit-paper">{updates.length ? updates.slice(0, 3).map(update => <p key={update.id}>{update.text}</p>) : <p>还没有新的动态。</p>}</div>}
  </section>;
}
