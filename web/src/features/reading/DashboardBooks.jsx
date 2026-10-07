import { React, useState } from '../../core/react.mjs';
import { SectionHead } from '../../shared/components.jsx';

export function DashboardBooks({ books, ready, onEdit, onDelete, onAdd }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? books : books.slice(0, 3);
  return <section className="dashboard-learning" aria-label="看板学习书架">
    <SectionHead title="学习书架" sub={ready ? `${books.length} 本书 · 记录学习进度` : '正在读取书架'} right={<div className="section-actions">{books.length > 3 && <button className="section-action" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : `全部 ${books.length} 本`}</button>}<button className="section-action" disabled={!ready} onClick={onAdd}>添加</button></div>} />
    <div className="dashboard-book-list">{!ready ? <p className="dashboard-empty">书架数据尚未读取。</p> : !visible.length ? <p className="dashboard-empty">书架空空，添加一本正在学习的书。</p> : visible.map(book => {
      const percent = book.totalPage > 0 ? Math.max(0, Math.min(100, Math.round((Number(book.currentPage) || 0) / Number(book.totalPage) * 100))) : 0;
      return <div key={book.id} className="dashboard-learning-book"><span className="dashboard-book-spine" aria-hidden="true" /><button className="dashboard-book" aria-label={`编辑书籍：${book.title}`} onClick={() => onEdit(book)}><div><strong className="serif">{book.title}</strong><span>{book.currentPage || 0} / {book.totalPage || 0} 页</span></div><div className="dashboard-book-progress"><div className="dashboard-progress"><span style={{width: `${percent}%`}} /></div><small>{percent}%</small></div></button><button className="book-delete-button" aria-label={`删除书籍：${book.title}`} onClick={() => onDelete(book.id)}><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="1.6" strokeLinecap="round" d="M4 7h16M10 3h4l1 4H9l1-4M6 7l1 14h10l1-14M10 11v6m4-6v6" /></svg></button></div>;
    })}</div>
  </section>;
}
