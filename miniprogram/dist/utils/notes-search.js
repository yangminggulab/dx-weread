"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DIARY_TAGS = void 0;
exports.buildDiaryEntries = buildDiaryEntries;
exports.filterDiary = filterDiary;
exports.filterEssays = filterEssays;
exports.filterNotes = filterNotes;
exports.getDiarySearchTags = getDiarySearchTags;
exports.normalizeDiaryTagScores = normalizeDiaryTagScores;
exports.normalizeSearchValue = normalizeSearchValue;
const DIARY_TAGS = exports.DIARY_TAGS = ['学习卡壳', '复习考试', '焦虑内耗', '灾难化', '失眠亢奋', '安静恢复', '计划执行', '决策止损', '求职面试', '人际边界'];
const DIARY_TAG_ALIASES = {
  学习卡壳: ['学不进去', '不会做题', '卡住', '卡壳', '畏难', '学不会'],
  复习考试: ['考试', '复习', '备考', '刷题', '错题', '托福', '期末'],
  焦虑内耗: ['焦虑', '内耗', '乱想', '担心', '害怕', '烦恼', '压力', '不安'],
  灾难化: ['灾难', '灾难化', '想坏了', '最坏', '崩了', '完蛋'],
  失眠亢奋: ['失眠', '睡', '睡不着', '睡不好', '睡觉', '睡眠', '入睡', '睡前', '熬夜', '醒了', '亢奋'],
  安静恢复: ['休息', '恢复', '放松', '安静', '冥想', '调整呼吸', '修复', '缓一缓'],
  计划执行: ['计划', '执行', '目标', '安排', '推进', '完成', 'todo'],
  决策止损: ['决策', '止损', '沉没成本', '放弃', '选择', '取舍', '别冲动'],
  求职面试: ['求职', '面试', '实习', '工作', '简历', 'boss', 'hr'],
  人际边界: ['人际', '边界', '父母', '争吵', '朋友', '关系', '沟通']
};
function normalizeDiaryTagScores(scores = {}, tags = []) {
  const normalized = {};
  if (scores && typeof scores === 'object' && !Array.isArray(scores)) {
    DIARY_TAGS.forEach(tag => {
      const score = Number.parseInt(scores[tag], 10);
      if (Number.isFinite(score) && score > 0) normalized[tag] = Math.min(5, Math.max(1, score));
    });
  }
  if (Array.isArray(tags)) {
    tags.forEach(tag => {
      if (DIARY_TAGS.includes(tag) && !normalized[tag]) normalized[tag] = 1;
    });
  }
  return normalized;
}
function normalizeSearchValue(value) {
  return String(value || '').trim().toLowerCase().replace(/[＃#]/g, '').replace(/\s+/g, '');
}
function includesSearchText(text, query) {
  const source = normalizeSearchValue(text);
  const target = normalizeSearchValue(query);
  return Boolean(source && target && source.includes(target));
}
function tagMatchesQuery(tag, query) {
  const target = normalizeSearchValue(query);
  if (target.length < 2) {
    return includesSearchText(tag, query) || (DIARY_TAG_ALIASES[tag] || []).some(alias => normalizeSearchValue(alias) === target);
  }
  if (includesSearchText(tag, query) || includesSearchText(query, tag)) return true;
  return (DIARY_TAG_ALIASES[tag] || []).some(alias => includesSearchText(alias, query) || includesSearchText(query, alias));
}
function getDiarySearchTags(query) {
  return DIARY_TAGS.filter(tag => tagMatchesQuery(tag, query));
}
function getLatestTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}
function scoreNoteSearch(note, query) {
  let score = 0;
  if (includesSearchText(note.title, query)) score += 80;
  if (includesSearchText(note.summary, query)) score += 50;
  if ((note.tags || []).some(tag => includesSearchText(tag, query))) score += 70;
  return score;
}
function scoreDiarySearch(entry, query, matchedTags) {
  const tagScores = entry._tagScores || normalizeDiaryTagScores(entry.tagScores, entry.tags);
  const matchedTagScore = matchedTags.reduce((best, tag) => Math.max(best, tagScores[tag] || 0), 0);
  let score = matchedTagScore > 0 ? 1000 + matchedTagScore * 100 : 0;
  if (includesSearchText(entry.date, query)) score += 40;
  if ((entry._searchText || normalizeSearchValue(entry.content)).includes(normalizeSearchValue(query))) score += 60;
  if (Object.keys(tagScores).some(tag => matchedTags.includes(tag))) score += 40;
  return score;
}
function scoreEssaySearch(essay, query) {
  let score = 0;
  if (includesSearchText(essay.title, query)) score += 90;
  if (includesSearchText(essay.content, query)) score += 55;
  if (includesSearchText(essay.category, query)) score += 40;
  if (includesSearchText(essay.date, query)) score += 30;
  return score;
}
function buildDiaryEntries(diary = {}) {
  const entries = [];
  const append = entry => {
    if (!entry || !entry.date || !String(entry.content || '').trim()) return;
    const tagScores = normalizeDiaryTagScores(entry.tagScores, entry.tags);
    entries.push({
      date: entry.date,
      content: entry.content,
      tags: entry.tags || [],
      tagScores: entry.tagScores || {},
      _tagScores: tagScores,
      _searchText: normalizeSearchValue([entry.date, entry.content, ...Object.keys(tagScores), ...Object.entries(tagScores).map(([tag, score]) => `${tag}${score}`)].join(' '))
    });
  };
  append(diary.today);
  (Array.isArray(diary.archive) ? diary.archive : []).forEach(append);
  return entries;
}
function filterNotes(notes, query, fallback = []) {
  const target = normalizeSearchValue(query);
  if (!target) return fallback;
  return notes.map((note, index) => ({
    note,
    index,
    score: scoreNoteSearch(note, target)
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || getLatestTime(b.note.updatedAt) - getLatestTime(a.note.updatedAt) || a.index - b.index).map(item => item.note);
}
function filterDiary(entries, query) {
  const target = normalizeSearchValue(query);
  if (!target) return [];
  const matchedTags = getDiarySearchTags(target);
  return entries.map((entry, index) => ({
    entry,
    index,
    score: scoreDiarySearch(entry, target, matchedTags)
  })).filter(item => item.score > 0 || item.entry._searchText && item.entry._searchText.includes(target)).sort((a, b) => b.score - a.score || getLatestTime(b.entry.date) - getLatestTime(a.entry.date) || a.index - b.index).map(item => item.entry);
}
function filterEssays(essays, query) {
  const target = normalizeSearchValue(query);
  if (!target) return [];
  return essays.map((essay, index) => ({
    essay,
    index,
    score: scoreEssaySearch(essay, target)
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || getLatestTime(b.essay.updatedAt) - getLatestTime(a.essay.updatedAt) || a.index - b.index).map(item => item.essay);
}
