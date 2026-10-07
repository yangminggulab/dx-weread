import { themeColor } from '../../shared/theme.mjs';
import { React, useState, useMemo, useRef, useEffect, useCallback } from '../../core/react.mjs';
import { SectionHead } from '../../shared/components.jsx';
import { getWereadProgressPercent, getWereadShelfMetaText } from './model.mjs';
function Books({ books, onAdd, onEdit, onDelete, fullPage = false }) {
  return (
    <section>
      <SectionHead title="学习书架" sub={fullPage ? `${books.length} 本学习书籍` : undefined} right={fullPage && <button onClick={onAdd} className="text-xs text-accent">添加书籍</button>} />
      {books.length === 0
        ? <div className="bg-paper rounded-xl border border-line p-10 text-center text-muted text-sm">书架空空，点击右上角添加</div>
        : <div className={fullPage ? "learning-book-grid" : "rounded-xl overflow-y-auto border border-line bg-paper"} style={fullPage ? undefined : {maxHeight:220, boxShadow:`inset 0 -3px 0 ${themeColor('line')}`}}>
            {books.map((b, i) => {
              const pct = b.totalPage > 0 ? Math.round(b.currentPage / b.totalPage * 100) : 0;
              return (
                <div key={b.id} onClick={()=>onEdit(b)} className={`flex gap-3 items-stretch group hover:bg-surface transition-colors cursor-pointer ${fullPage ? 'learning-book-card' : ''} ${!fullPage && i < books.length - 1 ? 'border-b border-line-soft' : ''}`}>
                  <div className="w-1 shrink-0 rounded-sm my-2 ml-3" style={{background: themeColor('accent')}} />
                  <div className="flex-1 min-w-0 py-3 pr-3">
                    <div className="flex items-center gap-2 mb-1">
                      <button aria-label={`编辑书籍：${b.title}`} onClick={event => { event.stopPropagation(); onEdit(b); }} className="serif text-sm font-medium text-ink flex-1 min-w-0 truncate text-left py-2">{b.title}</button>
                      <div className="flex gap-1 shrink-0">
                        <button aria-label={`删除书籍：${b.title}`} onClick={e=>{e.stopPropagation();onDelete(b.id);}} className="book-delete-button text-muted hover:text-danger rounded">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                      </div>
                    </div>
                    {fullPage && <div className="text-xs text-muted mb-3">{b.status === 'finished' ? '已读完' : b.status === 'want' ? '想读' : '在读'} · {b.currentPage || 0} / {b.totalPage || 0} 页</div>}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-track rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{width:`${pct}%`, background: themeColor('accent')}} />
                      </div>
                      <span className="text-xs text-muted shrink-0 w-8 text-right">{pct}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
      }
    </section>
  );
}

function BookCover({ book }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [book.cover]);
  return <div className="book-cover" aria-hidden="true">{book.cover && !failed ? <img src={book.cover} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span>{Array.from(book.title || '书')[0]}</span>}</div>;
}

function WeReadShelf({ books, fullPage = false, compact = false }) {
  const [expanded, setExpanded] = useState(fullPage);
  const orderedBooks = [...books]
    .sort((a, b) => (b.readTimestamp || 0) - (a.readTimestamp || 0))
;
  const recentBooks = expanded ? orderedBooks : orderedBooks.slice(0, 3);
  return (
    <section className={compact ? 'weread-compact' : ''}>
      <SectionHead
        title="微信读书书架"
        sub={fullPage ? `${books.length} 本同步书籍` : undefined}
        right={books.length > 3 && <button className="text-xs text-accent" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '最近三本' : `全部 ${books.length} 本`}</button>}
      />
      {recentBooks.length === 0
        ? <div className="bg-paper rounded-xl border border-line p-10 text-center text-muted text-sm">还没有同步到微信读书书架</div>
        : <div className="weread-shelf-grid">
            {recentBooks.map((b, idx) => {
              const pct = getWereadProgressPercent(b);
              return (
                <div key={`wr-book-${b.id}-${idx}`} className="weread-shelf-book">
                  {compact && <BookCover book={b} />}
                  <div className="weread-shelf-body"><div className="weread-shelf-title"><h3 className="serif">{b.title}</h3><small>{b.status === 'finished' ? '已读完' : b.status === 'want' ? '想读' : '在读'}</small></div>
                  <div className="weread-shelf-meta"><span>{b.author || '作者信息暂未同步'}</span><span>{getWereadShelfMetaText(b)}</span></div>
                  <div className="dashboard-progress"><span style={{width:`${pct}%`}} /></div></div>
                </div>
              );
            })}
          </div>
      }
    </section>
  );
}

export { Books, WeReadShelf };
