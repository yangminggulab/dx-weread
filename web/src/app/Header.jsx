import { React } from '../core/react.mjs';
import { formatLocalDateKey } from '../features/reading/model.mjs';

export function Header({ onAdd, onAddBook, personalMode, onLogout, disabled = false }) {
  return <header className="workspace-header"><div className="workspace-toolbar">
    <div className="workspace-header-brand"><span className="workspace-header-logo"><svg width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v15M12 6C9 3 5 3 2 5v14c3-2 7-2 10 2M12 6c3-3 7-3 10-1v14c-3-2-7-2-10 2" /></svg></span><span><strong>My Project Library</strong><small>{formatLocalDateKey(new Date())} · {personalMode ? '个人版' : '本地版'}</small></span></div>
    <div className="workspace-header-actions"><a href="https://yangminggu.com/" className="workspace-math-link">数学笔记 ↗</a><button disabled={disabled} onClick={onAddBook} className="workspace-button secondary">＋ 添加书籍</button><button disabled={disabled} onClick={onAdd} className="workspace-button primary">＋ 新增任务</button>{personalMode && <button onClick={onLogout} className="workspace-logout" aria-label="退出登录">退出</button>}</div>
  </div></header>;
}
