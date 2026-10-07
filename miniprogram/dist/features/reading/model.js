"use strict";

function getTodayMinutes(weekDaily) {
  const now = new Date();
  const todayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
  const todayEnd = todayStart + 86400;
  return Object.entries(weekDaily || {}).reduce((sum, [k, v]) => {
    const kt = parseInt(k);
    return sum + (kt >= todayStart && kt < todayEnd ? v : 0);
  }, 0);
}
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function getWeekMonday(d) {
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function getStreakDays(dailyReadTimes, weekReadDaily, goalMinutes) {
  const completed = new Set((dailyReadTimes || []).filter(d => {
    var _d$minutes;
    return ((_d$minutes = d.minutes) !== null && _d$minutes !== void 0 ? _d$minutes : Math.round((d.seconds || 0) / 60)) >= goalMinutes;
  }).map(d => d.date));
  if (getTodayMinutes(weekReadDaily) >= goalMinutes) completed.add(toDateStr(new Date()));
  if (!completed.size) return 0;
  let streak = 0;
  const d = new Date();
  if (!completed.has(toDateStr(d))) {
    d.setDate(d.getDate() - 1);
  }
  while (completed.has(toDateStr(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
function getStreakWeeks(dailyReadTimes, weekReadDaily, goalMinutes) {
  const completed = new Set((dailyReadTimes || []).filter(d => {
    var _d$minutes2;
    return ((_d$minutes2 = d.minutes) !== null && _d$minutes2 !== void 0 ? _d$minutes2 : Math.round((d.seconds || 0) / 60)) >= goalMinutes;
  }).map(d => d.date));
  if (getTodayMinutes(weekReadDaily) >= goalMinutes) completed.add(toDateStr(new Date()));
  if (!completed.size) return 0;
  function weekHasCompleted(monday) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      if (completed.has(toDateStr(d))) return true;
    }
    return false;
  }
  let monday = getWeekMonday(new Date());
  if (!weekHasCompleted(monday)) {
    monday.setDate(monday.getDate() - 7);
  }
  let streak = 0;
  while (weekHasCompleted(monday)) {
    streak++;
    monday.setDate(monday.getDate() - 7);
  }
  return streak;
}
const {
  drawRing2d
} = require('./ring');
module.exports = {
  getTodayMinutes,
  getStreakDays,
  getStreakWeeks,
  drawRing2d
};
