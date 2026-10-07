import { React, useState, useEffect } from '../core/react.mjs';
import { PERSONAL_MODE } from '../core/api.mjs';
import { useWorkspace } from './useWorkspace.jsx';
import { useDiary } from '../features/diary/useDiary.jsx';
import { useReading } from '../features/reading/useReading.jsx';
import { Header } from './Header.jsx';
import { DashboardPage } from './DashboardPage.jsx';
import { useCloudRefresh } from './useCloudRefresh.jsx';
import { TaskModal } from '../features/tasks/TaskModal.jsx';
import { TaskDetail } from '../features/tasks/TaskDetail.jsx';
import { DiaryDialog } from '../features/diary/DiaryDialog.jsx';
import { BookModal, BookDeleteDialog } from '../features/reading/BookModal.jsx';
import { isWereadBook, getWereadMetaFromPayload } from '../features/reading/model.mjs';

export function App({ onLogout }) {
  const { controller: workspace, state } = useWorkspace();
  const diary = useDiary(), reading = useReading(workspace);
  useCloudRefresh(workspace, diary.controller);
  const [selectedDate, setSelectedDate] = useState(''), [diaryExpanded, setDiaryExpanded] = useState(false);
  const [taskEditor, setTaskEditor] = useState(null), [detailID, setDetailID] = useState(null);
  const data = state.data || { tasks: [], books: [], notes: [], updates: [] };
  const learningBooks = data.books.filter(book => !isWereadBook(book));
  const meta = getWereadMetaFromPayload(data), detail = data.tasks.find(task => task.id === detailID);
  useEffect(() => { document.title = 'My Project Library · 个人工作台'; }, []);
  const logout = () => { diary.controller.flush(); workspace.flushTasks(); onLogout(); };
  const editBook = book => reading.controller.open(book);
  const deleteBook = id => reading.controller.requestDelete(learningBooks.find(book => book.id === id));
  return <div className="workspace-shell is-dashboard">
    <a href="#workspace-main" className="workspace-skip-link" onClick={event => { event.preventDefault(); const main = document.getElementById('workspace-main'); main?.focus({ preventScroll: true }); main?.scrollIntoView(); }}>跳到主要内容</a>
    <Header onAdd={() => setTaskEditor('add')} onAddBook={() => reading.controller.open()} personalMode={PERSONAL_MODE} onLogout={logout} disabled={!state.data} />
    <main id="workspace-main" className="workspace-main" tabIndex={-1}>
      <h1 id="workspace-title" className="sr-only">个人工作台</h1>
      <div className="workspace-notices">
        {state.error && <div role="alert" className="workspace-notice">{state.error}<button className="ml-3 underline" onClick={() => workspace.refresh()}>重试</button></div>}
        {state.syncError && <div role="alert" className="workspace-notice">{state.syncError}{state.taskConflict && <button className="ml-3 underline" onClick={() => { if (window.confirm('核对后采用当前页面修改的任务字段，保留云端其他修改，是否继续？')) workspace.retryTasks(); }}>核对后保留当前修改并重试</button>}</div>}
        {reading.state.error && !reading.state.editor && <div role="alert" className="workspace-notice">{reading.state.error}</div>}
        {state.loading && <p className="text-sm text-muted" role="status">正在读取任务与读书数据…</p>}
      </div>
      <DashboardPage data={state.data} diary={diary.state} diaryController={diary.controller} stats={meta.stats} syncedAt={meta.syncedAt} onExpandDiary={() => setDiaryExpanded(true)} onTask={task => setDetailID(task.id)} onToggleTask={id => workspace.toggleTask(id)} onEditBook={editBook} onDeleteBook={deleteBook} onAddBook={() => reading.controller.open()} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
    </main>
    {diaryExpanded && <DiaryDialog controller={diary.controller} state={diary.state} onClose={() => setDiaryExpanded(false)} />}
    {taskEditor && <TaskModal task={taskEditor === 'add' ? null : taskEditor} books={learningBooks} onSave={form => { workspace.saveTask(form, taskEditor === 'add' ? null : taskEditor); setTaskEditor(null); }} onClose={() => setTaskEditor(null)} />}
    {detail && <TaskDetail task={detail} books={learningBooks} onEdit={() => { setTaskEditor(detail); setDetailID(null); }} onComplete={() => { workspace.toggleTask(detail.id); setDetailID(null); }} onClose={() => setDetailID(null)} />}
    <BookModal controller={reading.controller} state={reading.state} /><BookDeleteDialog controller={reading.controller} state={reading.state} />
  </div>;
}
