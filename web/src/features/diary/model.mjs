export function diaryDayKey(now = new Date()) {
  // Shanghai midnight minus five hours: same 05:00 boundary as the Worker.
  return new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
}
export const entryVersion = entry => String(entry?.updatedAt || '');
export const normalizeEntry = entry => ({ ...entry, date: String(entry?.date || ''), content: String(entry?.content ?? '') });
export function findDiaryEntry(diary, date) {
  return diary?.today?.date === date ? diary.today : diary?.archive?.find(entry => entry.date === date);
}
export function acceptDiaryEntry(diary, entry) {
  if (diary.today.date === entry.date) return { ...diary, today: entry };
  return { ...diary, archive: [...diary.archive.filter(item => item.date !== entry.date), entry] };
}
