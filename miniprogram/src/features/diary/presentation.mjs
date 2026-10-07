import { diaryDateLabel } from '../../utils/date-label.js'

// Only presentation text is compacted; the stored body and reader remain exact.
function diaryExcerpt(content, limit = 180) {
  const lines = String(content || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length) {
    const wrapped = /^(?:【([^]*)】|\[([^]*)\])$/.exec(lines[0])
    if (wrapped) lines[0] = wrapped[1] || wrapped[2] || ''
  }
  const text = lines.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > limit ? text.slice(0, limit) + '…' : text
}
function diaryEntries(diary) {
  const byDate = new Map((diary.archive || []).map(entry => [entry.date, entry]))
  if (diary.today && String(diary.today.content || '').trim()) byDate.set(diary.today.date, diary.today)
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
}
function filterDiaryEntries(entries, query = '', date = '') {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter(entry => {
    if (date && entry.date !== date) return false
    const label = diaryDateLabel(entry.date)
    const haystack = [entry.date, label.title.replace(/\s/g, ''), label.subtitle, entry.content, ...(entry.tags || [])].join(' ').toLocaleLowerCase()
    return words.every(word => haystack.includes(word))
  })
}
function diaryListRows(entries, limit) {
  return entries.slice(0, limit).map((entry, index) => {
    const label = diaryDateLabel(entry.date), month = entry.date.slice(0, 7)
    const parts = /^(\d{4})-(\d{2})/.exec(month)
    return { date: entry.date, dateTitle: label.title, weekday: label.subtitle.split(' · ')[1] || '',
      monthTitle: index === 0 || entries[index - 1].date.slice(0, 7) !== month ? (parts ? `${parts[1]} 年 ${Number(parts[2])} 月` : month) : '',
      excerpt: diaryExcerpt(entry.content, 120) || '空白记录' }
  })
}
export { diaryExcerpt, diaryEntries, filterDiaryEntries, diaryListRows }
