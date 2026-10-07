import { themeColor } from '../../shared/theme.mjs';
const BOOK_ACCENTS = ['#2d6a4f', '#4a4a6a', '#6a4a2a', '#3a6a5a', '#5a3a6a'];
const pickBookAccent = (seed='') => {
  const score = Array.from(seed).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return BOOK_ACCENTS[score % BOOK_ACCENTS.length];
};
const extractNotePreview = (summary='') =>
  summary
    .split('\n')
    .map(line => line.replace(/^[📌💭]\s*/, '').trim())
    .find(Boolean) || '已同步到笔记与文档';
const isWereadBook = book => Boolean(book && (book.source === 'weread' || book._bookId));
const isWereadNote = note => Boolean(note && (note.source === 'weread' || note.tags?.includes('微信读书')));
const nextLocalId = (ref, usedIds) => {
  while (usedIds.has(ref.current)) ref.current += 1;
  const id = ref.current;
  usedIds.add(id);
  ref.current += 1;
  return id;
};
const pickDisplayTime = (item, primaryKey, fallbackKey='syncedAt') => {
  if (item?.[primaryKey]) {
    const value = String(item[primaryKey]);
    return /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.replace('T', ' ').slice(0, 16) : value;
  }
  if (item?.[fallbackKey]) return `同步于 ${String(item[fallbackKey]).replace('T', ' ').slice(0,16)}`;
  return '时间未知';
};
const getWereadProgressPercent = (book) => {
  const pct = Number(book?.progressPercent);
  if (book?.progressPercent != null && Number.isFinite(pct)) return Math.max(0, Math.min(100, Math.round(pct)));
  const current = Number(book?.chapterIndex || book?.currentPage || 0);
  const total = Number(book?.chapterCount || book?.totalPage || 0);
  if (total > 0) return Math.max(0, Math.min(100, Math.round(current / total * 100)));
  return 0;
};
const getWereadPageText = (book) => {
  const current = Number(book?.estimatedCurrentPage || 0);
  const total = Number(book?.estimatedTotalPage || 0);
  if (current > 0 && total > 0) return `约 ${current} / ${total} 页`;
  if (total > 0) return `约 ${total} 页`;
  const chapter = Number(book?.chapterIndex || book?.currentPage || 0);
  if (chapter > 0) return `阅读位置 ${chapter}`;
  return '';
};
const getWereadProgressText = (book) => {
  const pct = getWereadProgressPercent(book);
  return pct > 0 ? `阅读进度 ${pct}%` : '';
};
const getWereadShelfMetaText = (book) => {
  const pageText = getWereadPageText(book);
  const progressText = getWereadProgressText(book);
  if (pageText && progressText) return `${pageText} · ${progressText}`;
  return pageText || progressText || '已同步阅读进度';
};
const getFullNoteText = (summary='') =>
  String(summary || '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .join('\n\n') || '暂无同步内容';
const EMPTY_WEREAD_STATS = {
  monthly: { baseTime: 0, readDays: 0, totalReadTime: 0, dayAverageReadTime: 0, compare: 0 },
  annual: { baseTime: 0, readDays: 0, totalReadTime: 0, dayAverageReadTime: 0, compare: 0 },
  dailyReadTimes: [],
};
const cloneWereadStats = (stats) => ({
  monthly: { ...EMPTY_WEREAD_STATS.monthly, ...(stats?.monthly || {}) },
  annual: { ...EMPTY_WEREAD_STATS.annual, ...(stats?.annual || {}) },
  dailyReadTimes: Array.isArray(stats?.dailyReadTimes) ? stats.dailyReadTimes : [],
});
const hasWereadBriefStats = (section) =>
  Boolean(section && ['baseTime', 'readDays', 'totalReadTime', 'dayAverageReadTime'].some(key => Number(section[key]) > 0));
const mergeWereadStats = (primary, fallback) => {
  const p = cloneWereadStats(primary);
  const f = cloneWereadStats(fallback);
  return {
    monthly: hasWereadBriefStats(p.monthly) ? p.monthly : f.monthly,
    annual: hasWereadBriefStats(p.annual) ? p.annual : f.annual,
    dailyReadTimes: p.dailyReadTimes.length > 0 ? p.dailyReadTimes : f.dailyReadTimes,
  };
};
const getWereadMetaFromPayload = (payload={}) => {
  const timeWeread = payload?.time?.weread && typeof payload.time.weread === 'object' ? payload.time.weread : null;
  return {
    stats: mergeWereadStats(payload?.wereadStats, timeWeread),
    syncedAt: payload?.wereadSyncedAt || timeWeread?.syncedAt || '',
  };
};
const formatLocalDateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};
const toIsoDateKey = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    // Source timestamps without an offset are already Shanghai wall-clock dates.
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return formatLocalDateKey(parsed);
    return '';
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ts = value < 1e11 ? value * 1000 : value;
    const parsed = new Date(ts);
    if (!Number.isNaN(parsed.getTime())) return formatLocalDateKey(parsed);
  }
  return '';
};
const formatReadDuration = (seconds=0) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const totalMinutes = Math.round(safe / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}小时 ${minutes}分钟`;
  if (hours > 0) return `${hours}小时`;
  return `${minutes}分钟`;
};
const formatCalendarDate = (dateKey='') => {
  if (!dateKey) return '暂无日期';
  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return parsed.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
};
const getWereadNoteDate = (note) =>
  toIsoDateKey(note?.sourceUpdatedAt) || toIsoDateKey(note?.updatedAt) || '';
const HEATMAP_COLORS = [0, 1, 2, 3, 4].map(level => themeColor(`heat-${level}`));
const getHeatmapLevel = (seconds=0, maxSeconds=0, noteCount=0) => {
  if (!seconds || !maxSeconds) return noteCount > 0 ? 1 : 0;
  const ratio = seconds / maxSeconds;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
};
const formatCompareText = (compare=0) => {
  const ratio = Number(compare);
  if (!Number.isFinite(ratio) || ratio === 0) return '和上个周期基本持平';
  const percent = Math.abs(Math.round(ratio * 100));
  return ratio > 0 ? `比上个周期多 ${percent}%` : `比上个周期少 ${percent}%`;
};

export { pickBookAccent, extractNotePreview, isWereadBook, isWereadNote, nextLocalId, pickDisplayTime, getWereadProgressPercent, getWereadShelfMetaText, getFullNoteText, cloneWereadStats, getWereadMetaFromPayload, formatLocalDateKey, toIsoDateKey, formatReadDuration, formatCalendarDate, getWereadNoteDate, HEATMAP_COLORS, getHeatmapLevel, formatCompareText };
