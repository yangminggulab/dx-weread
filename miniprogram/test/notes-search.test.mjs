import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDiaryEntries,
  filterDiary,
  filterEssays,
  filterNotes,
  getDiarySearchTags,
  normalizeSearchValue
} from '../src/utils/notes-search.mjs'
import { createRequestQueue } from '../src/utils/request-queue.mjs'

test('normalizes whitespace, case, and hash markers', () => {
  assert.equal(normalizeSearchValue('  # To Do  '), 'todo')
  assert.equal(normalizeSearchValue('＃学习 卡壳'), '学习卡壳')
})

test('builds a searchable diary index from today and archive', () => {
  const entries = buildDiaryEntries({
    today: { date: '2026-09-17', content: '今天完成复习', tagScores: { 复习考试: 4 } },
    archive: [
      { date: '2026-09-16', content: '昨晚睡不着', tags: ['失眠亢奋'] },
      { date: '', content: '缺少日期' },
      { date: '2026-09-15', content: '   ' }
    ]
  })

  assert.equal(entries.length, 2)
  assert.equal(filterDiary(entries, '完成 复习')[0].date, '2026-09-17')
  assert.equal(filterDiary(entries, '睡不着')[0].date, '2026-09-16')
})

test('ranks a matched diary problem tag above plain content matches', () => {
  const entries = buildDiaryEntries({
    archive: [
      { date: '2026-09-15', content: '最近有一点焦虑' },
      { date: '2026-09-16', content: '普通记录', tagScores: { 焦虑内耗: 5 } }
    ]
  })

  assert.equal(filterDiary(entries, '担心')[0].date, '2026-09-16')
  assert.deepEqual(getDiarySearchTags('睡不着'), ['失眠亢奋'])
})

test('does not turn unrelated Chinese words into problem tags', () => {
  const entries = buildDiaryEntries({
    archive: [
      { date: '2026-09-16', content: '普通记录', tagScores: { 求职面试: 5 } },
      { date: '2026-09-15', content: '买了一瓶新面霜' }
    ]
  })

  assert.deepEqual(getDiarySearchTags('面霜'), [])
  assert.deepEqual(getDiarySearchTags('面试'), ['求职面试'])
  assert.deepEqual(getDiarySearchTags('复习'), ['复习考试'])
  assert.deepEqual(filterDiary(entries, '面霜').map(entry => entry.date), ['2026-09-15'])
})

test('filters notes and essays independently', () => {
  const notes = [
    { id: 1, title: '模型实验', summary: '', tags: ['AI'], updatedAt: '2026-09-16' },
    { id: 2, title: '普通笔记', summary: '复习计划', tags: [], updatedAt: '2026-09-17' }
  ]
  const essays = [
    { id: 1, title: '年度复盘', content: '长期记录', category: '年度总结', date: '2025-12-31' }
  ]

  assert.equal(filterNotes(notes, 'ai').map(item => item.id).join(','), '1')
  assert.equal(filterNotes(notes, '', notes.slice(0, 1)).length, 1)
  assert.equal(filterEssays(essays, '年度总结')[0].id, 1)
  assert.equal(filterNotes([{ id: 3, title: '普通记录', tags: ['面试'] }], '面霜').length, 0)
})

test('keeps today notes as the default view until a search starts', () => {
  const notes = [
    { id: 1, title: '今天的读书笔记', updatedAt: '2026-09-18' },
    { id: 2, title: '以前的读书笔记', updatedAt: '2026-09-17' }
  ]
  const todayNotes = notes.filter(note => note.updatedAt === '2026-09-18')

  assert.deepEqual(filterNotes(notes, '', todayNotes).map(note => note.id), [1])
  assert.deepEqual(filterNotes(notes, '以前').map(note => note.id), [2])
})

test('serializes diary writes and lets readers wait for the latest save', async () => {
  const queue = createRequestQueue()
  const events = []
  let releaseFirst
  let markFirstStarted
  const firstGate = new Promise(resolve => { releaseFirst = resolve })
  const firstStarted = new Promise(resolve => { markFirstStarted = resolve })

  const first = queue.enqueue(async () => {
    events.push('first:start')
    markFirstStarted()
    await firstGate
    events.push('first:end')
  })
  const second = queue.enqueue(async () => {
    events.push('second:start')
    events.push('second:end')
  })
  const reader = queue.wait().then(() => events.push('read'))

  await firstStarted
  assert.deepEqual(events, ['first:start'])
  releaseFirst()
  await Promise.all([first, second, reader])
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end', 'read'])
})
