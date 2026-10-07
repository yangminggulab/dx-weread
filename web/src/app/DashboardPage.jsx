import { React, useState } from '../core/react.mjs';
import { DashboardTasks } from '../features/tasks/DashboardTasks.jsx';
import { DiarySection } from '../features/diary/DiarySection.jsx';
import { DashboardBooks } from '../features/reading/DashboardBooks.jsx';
import { WeReadShelf } from '../features/reading/BookSections.jsx';
import { WeReadNotes } from '../features/reading/WeReadNotes.jsx';
import { WeReadHeatmap } from '../features/reading/WeReadHeatmap.jsx';
import { WereadRecent } from '../features/reading/WereadRecent.jsx';
import { isWereadBook, isWereadNote, formatReadDuration } from '../features/reading/model.mjs';
import { SectionHead } from '../shared/components.jsx';

export function DashboardPage({ data, diary, diaryController, stats, syncedAt, onExpandDiary, onTask, onToggleTask, onEditBook, onDeleteBook, onAddBook, selectedDate, onSelectDate }) {
  const [focusType, setFocusType] = useState('daily');
  const ready = Boolean(data);
  const tasks = data?.tasks || [], books = data?.books || [], notes = data?.notes?.filter(isWereadNote) || [];
  const learningBooks = books.filter(book => !isWereadBook(book)), wereadBooks = books.filter(isWereadBook);
  return <div className="workbench">
    <div className="workbench-main">
      <div className="workbench-columns">
        <div id="tasks" className="workbench-task-column">
          <DashboardTasks taskType={focusType} onSelectTaskType={setFocusType} tasks={tasks} ready={ready} onTask={onTask} onToggle={onToggleTask} />
        </div>
        <div id="reading" className="workbench-book-column">
          <DashboardBooks books={learningBooks} ready={ready} onEdit={onEditBook} onDelete={onDeleteBook} onAdd={onAddBook} />
          {ready ? <WeReadShelf books={wereadBooks} compact /> : <p className="workbench-empty">正在读取微信读书书架。</p>}
        </div>
      </div>
      <div id="notes" className="workbench-notes">{ready ? <WeReadNotes notes={notes} fullPage /> : <><SectionHead title="微信读书笔记" /><p className="workbench-empty">笔记数据尚未读取。</p></>}</div>
    </div>
    <div className="workbench-side">
      <DiarySection controller={diaryController} state={diary} dashboard onExpand={onExpandDiary} />
      <section className="workbench-reading-activity" aria-label="阅读统计">
        <SectionHead title="阅读足迹" />
        <div className="workbench-reading-totals"><div><span>本月</span><strong>{ready ? formatReadDuration(stats.monthly.totalReadTime) : '—'}</strong><small>{ready ? `${stats.monthly.readDays} 个阅读日` : '等待数据'}</small></div><div><span>本年</span><strong>{ready ? formatReadDuration(stats.annual.totalReadTime) : '—'}</strong><small>{ready ? `${stats.annual.readDays} 个阅读日` : '等待数据'}</small></div></div>
        {ready ? <WeReadHeatmap embedded stats={stats} notes={notes} syncedAt={syncedAt} selectedDate={selectedDate} onSelectDate={onSelectDate} /> : <p className="workbench-empty">阅读数据尚未读取。</p>}
        {syncedAt && <p className="reading-sync-time">同步于 {String(syncedAt).replace('T', ' ').slice(0, 16)}</p>}
      </section>
      {ready && <WereadRecent notes={notes} updates={data.updates || []} />}
    </div>
  </div>;
}
