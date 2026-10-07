import { themeColor } from '../../shared/theme.mjs';
import { React, useState, useMemo, useRef, useEffect, useCallback } from '../../core/react.mjs';
import { SectionHead } from '../../shared/components.jsx';
import { cloneWereadStats, getWereadNoteDate, toIsoDateKey, formatLocalDateKey, getHeatmapLevel, HEATMAP_COLORS, formatReadDuration, formatCalendarDate, extractNotePreview } from './model.mjs';
function WeReadHeatmap({ stats, notes, syncedAt, selectedDate, onSelectDate, embedded = false }) {
  const wereadStats = React.useMemo(() => cloneWereadStats(stats), [stats]);
  const noteMap = React.useMemo(() => {
    const grouped = new Map();
    notes.forEach(note => {
      const dateKey = getWereadNoteDate(note);
      if (!dateKey) return;
      if (!grouped.has(dateKey)) grouped.set(dateKey, []);
      grouped.get(dateKey).push(note);
    });
    grouped.forEach(dayNotes => {
      dayNotes.sort((a, b) => (b.sourceUpdatedTimestamp || 0) - (a.sourceUpdatedTimestamp || 0));
    });
    return grouped;
  }, [notes]);

  const heatmap = React.useMemo(() => {
    const readMap = new Map();
    wereadStats.dailyReadTimes.forEach(item => {
      const dateKey = toIsoDateKey(item?.date || item?.timestamp);
      const seconds = Math.max(0, Number(item?.seconds) || 0);
      if (!dateKey) return;
      readMap.set(dateKey, seconds);
    });

    const today = new Date(`${formatLocalDateKey(new Date())}T12:00:00Z`);

    // 最近 18 周，结束于本周日（周一起始）
    const end = new Date(today);
    end.setUTCDate(today.getUTCDate() + (6 - ((today.getUTCDay() + 6) % 7)));
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - (18 * 7 - 1));

    const days = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const dateKey = formatLocalDateKey(cursor);
      const seconds = readMap.get(dateKey) || 0;
      const dayNotes = noteMap.get(dateKey) || [];
      days.push({
        date: dateKey,
        seconds,
        noteCount: dayNotes.length,
        notes: dayNotes,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const weeks = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    const maxSeconds = days.reduce((max, item) => Math.max(max, item.seconds), 0);
    const latestActive = [...days].reverse().find(item => item.seconds > 0 || item.noteCount > 0);
    return { weeks, maxSeconds, latestActiveDate: latestActive?.date || '' };
  }, [noteMap, wereadStats]);

  const activeDate = selectedDate || heatmap.latestActiveDate;
  const selectedDay = React.useMemo(() => {
    for (const week of heatmap.weeks) {
      const found = week.find(day => day.date === activeDate);
      if (found) return found;
    }
    return null;
  }, [activeDate, heatmap.weeks]);

  return (
    <section className={embedded ? 'reading-heatmap' : ''} aria-label="按日期查看阅读情况">
      {embedded ? <p className="reading-heatmap-caption">最近 18 周 · 点击日期查看时长与笔记</p> : <SectionHead
        title="阅读热力"
        sub="最近 18 周 · 点击日期查看时长与笔记"
      />}
      <div className="space-y-4">
        <div className="heatmap-surface">
          <div className="overflow-x-auto pb-2">
            <div className="heatmap-matrix">
              <div className="heatmap-months">
                {heatmap.weeks.map((week, idx) => {
                  const first = week[0];
                  const prev = idx > 0 ? heatmap.weeks[idx - 1][0] : null;
                  const showLabel = !prev || first.date.slice(5, 7) !== prev.date.slice(5, 7);
                  return (
                    <div key={`month-${first.date}`} className="heatmap-month">
                      {showLabel ? `${Number(first.date.slice(5, 7))}月` : ''}
                    </div>
                  );
                })}
              </div>
              <div className="heatmap-calendar">
                <div className="heatmap-weekdays">
                  {['一', '二', '三', '四', '五', '六', '日'].map(label => (
                    <div key={label} className="heatmap-weekday">{label}</div>
                  ))}
                </div>
                <div className="heatmap-weeks">
                  {heatmap.weeks.map((week, weekIdx) => (
                    <div key={`week-${weekIdx}`} className="heatmap-week">
                      {week.map(day => {
                        const level = getHeatmapLevel(day.seconds, heatmap.maxSeconds, day.noteCount);
                        const isSelected = selectedDate ? day.date === selectedDate : false;
                        return (
                          <button
                            key={day.date}
                            onClick={() => onSelectDate(day.date === selectedDate ? '' : day.date)}
                            title={`${day.date} · ${formatReadDuration(day.seconds)} · ${day.noteCount} 条笔记`}
                            aria-label={`${day.date} · ${formatReadDuration(day.seconds)} · ${day.noteCount} 条笔记`}
                            aria-pressed={day.date === activeDate}
                            className="heatmap-day"
                            style={{
                              backgroundColor: HEATMAP_COLORS[level],
                              border: isSelected ? `1.5px solid ${themeColor('heat-4')}` : `1px solid ${themeColor('ink', 0.12)}`,
                            }}
                          >
                            {day.noteCount > 0 && (
                              <span className="heatmap-note-marker"></span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-track">
            {selectedDay ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-ink">{formatCalendarDate(selectedDay.date)}</div>
                    <div className="text-xs text-muted mt-1">
                      阅读 {formatReadDuration(selectedDay.seconds)} · 笔记 {selectedDay.noteCount} 条
                    </div>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {selectedDay.notes.length > 0 ? selectedDay.notes.slice(0, 3).map(note => (
                    <div key={note.id || note.sourceItemId} className="rounded-lg bg-surface border border-track px-3 py-2">
                      <div className="text-xs text-muted mb-1">{note.bookTitle || '微信读书'}</div>
                      <div className="text-[13px] text-body leading-6 line-clamp-2">{extractNotePreview(note.summary || note.title || '')}</div>
                    </div>
                  )) : (
                    <div className="text-sm text-muted">这一天还没有同步到微信读书笔记。</div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted">同步后会在这里显示每日阅读时长和对应笔记。</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export { WeReadHeatmap };
