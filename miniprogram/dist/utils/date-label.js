"use strict";

// Present the server's diary date without applying the device timezone again.
function diaryDateLabel(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!match) return {
    title: key || '今天',
    subtitle: ''
  };
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return {
    title: key,
    subtitle: ''
  };
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return {
    title: `${month} 月 ${day} 日`,
    subtitle: `${year} 年 · ${weekdays[date.getUTCDay()]}`
  };
}
module.exports = {
  diaryDateLabel
};
