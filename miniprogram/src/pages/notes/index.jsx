import { useState, useEffect, useCallback, useMemo } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, ScrollView, Input, Textarea } from '@tarojs/components'
import { getData, addNote, getDiary } from '../../api/index'
import './index.scss'

const NOTES_CACHE_KEY = 'notes_cache_v1'
const DIARY_TAGS = ['学习卡壳','复习考试','焦虑内耗','灾难化','失眠亢奋','安静恢复','计划执行','决策止损','求职面试','人际边界']
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
}

function getTodayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function pickRandomNotes(notes, count = 3) {
  const pool = [...notes]
  const picked = []
  while (picked.length < count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length)
    picked.push(pool.splice(idx, 1)[0])
  }
  return picked
}

function normalizeDiaryTagScores(scores = {}, tags = []) {
  const normalized = {}
  if (scores && typeof scores === 'object' && !Array.isArray(scores)) {
    DIARY_TAGS.forEach(tag => {
      const score = Number.parseInt(scores[tag], 10)
      if (Number.isFinite(score) && score > 0) normalized[tag] = Math.min(5, Math.max(1, score))
    })
  }
  if (Array.isArray(tags)) {
    tags.forEach(tag => {
      if (DIARY_TAGS.includes(tag) && !normalized[tag]) normalized[tag] = 1
    })
  }
  return normalized
}

function normalizeSearchValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[＃#]/g, '')
    .replace(/\s+/g, '')
}

function includesSearchText(text, query) {
  const source = normalizeSearchValue(text)
  const target = normalizeSearchValue(query)
  return Boolean(source && target && source.includes(target))
}

function levenshteinDistance(a, b) {
  const left = [...normalizeSearchValue(a)]
  const right = [...normalizeSearchValue(b)]
  if (left.length === 0) return right.length
  if (right.length === 0) return left.length

  let prev = Array.from({ length: right.length + 1 }, (_, i) => i)
  for (let i = 1; i <= left.length; i += 1) {
    const curr = [i]
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      )
    }
    prev = curr
  }
  return prev[right.length]
}

function fuzzyContains(text, query) {
  const source = normalizeSearchValue(text)
  const target = normalizeSearchValue(query)
  if (!source || !target) return false
  if (source.includes(target) || target.includes(source)) return true
  if (target.length < 2 || source.length < 2) return false

  const distance = levenshteinDistance(source, target)
  const maxLength = Math.max(source.length, target.length)
  const threshold = maxLength <= 3 ? 1 : Math.max(1, Math.floor(maxLength * 0.28))
  return distance <= threshold
}

function tagMatchesQuery(tag, query) {
  const target = normalizeSearchValue(query)
  if (target.length < 2) {
    return includesSearchText(tag, query) || (DIARY_TAG_ALIASES[tag] || []).some(alias => normalizeSearchValue(alias) === target)
  }
  if (includesSearchText(tag, query) || includesSearchText(query, tag)) return true
  return (DIARY_TAG_ALIASES[tag] || []).some(alias =>
    includesSearchText(alias, query) ||
    includesSearchText(query, alias) ||
    fuzzyContains(alias, query)
  )
}

function getDiarySearchTags(query) {
  return DIARY_TAGS.filter(tag => tagMatchesQuery(tag, query))
}

function getTagSearchScore(tagScores, query) {
  return getDiarySearchTags(query).reduce((best, tag) => Math.max(best, tagScores[tag] || 0), 0)
}

function getLatestTime(value) {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? time : 0
}

function scoreNoteSearch(note, query) {
  if (!query) return 0
  let score = 0
  if (includesSearchText(note.title, query)) score += 80
  if (includesSearchText(note.summary, query)) score += 50
  if ((note.tags || []).some(tag => includesSearchText(tag, query))) score += 70
  if (!score && (note.tags || []).some(tag => fuzzyContains(tag, query))) score += 35
  return score
}

function scoreDiarySearch(entry, query) {
  if (!query) return 0
  const tagScores = normalizeDiaryTagScores(entry.tagScores, entry.tags)
  const matchedTagScore = getTagSearchScore(tagScores, query)
  let score = matchedTagScore > 0 ? 1000 + matchedTagScore * 100 : 0
  if (includesSearchText(entry.date, query)) score += 40
  if (includesSearchText(entry.content, query)) score += 60
  if (Object.keys(tagScores).some(tag => tagMatchesQuery(tag, query))) score += 40
  return score
}

function diaryEntrySearchText(entry) {
  const tagScores = normalizeDiaryTagScores(entry.tagScores, entry.tags)
  return [
    entry.date,
    entry.content,
    ...Object.keys(tagScores),
    ...Object.entries(tagScores).map(([tag, score]) => `${tag}${score}`)
  ].join(' ')
}

const EMPTY_FORM = { title: '', summary: '', tags: '' }

export default function NotesPage() {
  const [notes, setNotes] = useState(() => {
    try {
      const c = Taro.getStorageSync(NOTES_CACHE_KEY)
      return c?.notes || []
    } catch { return [] }
  })
  const [diaryEntries, setDiaryEntries] = useState([])
  const [loading, setLoading] = useState(() => {
    try { return !Taro.getStorageSync(NOTES_CACHE_KEY)?.notes } catch { return true }
  })
  const [search, setSearch]       = useState('')
  const [showAdd, setShowAdd]     = useState(false)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [fallbackNotes, setFallbackNotes] = useState([])

  const loadData = useCallback(async () => {
    try {
      const [data, diary] = await Promise.all([getData(), getDiary()])
      const fetchedNotes = data.notes || []
      setNotes(fetchedNotes)
      try { Taro.setStorageSync(NOTES_CACHE_KEY, { notes: fetchedNotes }) } catch {}
      const entries = []
      if (diary.today?.date && diary.today?.content?.trim())
        entries.push({ date: diary.today.date, content: diary.today.content, tags: diary.today.tags || [], tagScores: diary.today.tagScores || {} })
      for (const e of (diary.archive || []))
        if (e.date && e.content?.trim()) entries.push({ date: e.date, content: e.content, tags: e.tags || [], tagScores: e.tagScores || {} })
      setDiaryEntries(entries)
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'error' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const todayStr = getTodayStr()
  const todayNotes = notes.filter(n => n.updatedAt === todayStr)
  useEffect(() => {
    if (todayNotes.length > 0) {
      setFallbackNotes([])
      return
    }
    setFallbackNotes(pickRandomNotes(notes))
  }, [notes, todayStr, todayNotes.length])

  const displayed = todayNotes.length > 0 ? todayNotes : fallbackNotes
  const hasSearch = normalizeSearchValue(search).length > 0

  const filteredNotes = useMemo(() => {
    if (!hasSearch) return displayed
    return notes
      .map((note, index) => ({ note, index, score: scoreNoteSearch(note, search) }))
      .filter(item => item.score > 0)
      .sort((a, b) =>
        b.score - a.score ||
        getLatestTime(b.note.updatedAt) - getLatestTime(a.note.updatedAt) ||
        a.index - b.index
      )
      .map(item => item.note)
  }, [displayed, hasSearch, notes, search])

  const filteredDiary = useMemo(() => {
    if (!hasSearch) return []
    return diaryEntries
      .map((entry, index) => ({ entry, index, score: scoreDiarySearch(entry, search) }))
      .filter(item => item.score > 0 || diaryEntrySearchText(item.entry).includes(search))
      .sort((a, b) =>
        b.score - a.score ||
        getLatestTime(b.entry.date) - getLatestTime(a.entry.date) ||
        a.index - b.index
      )
      .map(item => item.entry)
  }, [diaryEntries, hasSearch, search])

  const showDiaryFirst = hasSearch && getDiarySearchTags(search).length > 0

  async function handleAdd() {
    if (!form.title.trim()) {
      Taro.showToast({ title: '请输入笔记标题', icon: 'none' })
      return
    }
    const newNoteData = {
      title: form.title,
      summary: form.summary,
      tags: form.tags ? form.tags.split(/[,，\s]+/).filter(Boolean) : [],
      projectId: null
    }
    try {
      const res = await addNote(newNoteData)
      const updated = [res.note, ...notes]
      setNotes(updated)
      try { Taro.setStorageSync(NOTES_CACHE_KEY, { notes: updated }) } catch {}
      setShowAdd(false)
      setForm(EMPTY_FORM)
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'error' })
    }
  }

  function stopProp(e) { e.stopPropagation() }

  const hasResults = filteredNotes.length > 0 || filteredDiary.length > 0

  function renderNoteCards() {
    return filteredNotes.map(note => (
      <View key={`note-${note.id}`} className='note-card card'>
        <View className='note-header'>
          <Text className='note-title'>{note.title}</Text>
          <Text className='note-date'>{note.updatedAt}</Text>
        </View>
        {note.summary ? <Text className='note-summary'>{note.summary}</Text> : null}
        <View className='note-footer'>
          <View className='note-tags'>
            {(note.tags || []).map((tag, i) => (
              <Text key={i} className='note-tag'>#{tag}</Text>
            ))}
          </View>
        </View>
      </View>
    ))
  }

  function renderDiaryCards(showDivider) {
    if (filteredDiary.length === 0) return null
    return (
      <>
        {showDivider && (
          <View className='section-divider'><Text className='section-divider-text'>日记</Text></View>
        )}
        {filteredDiary.map((entry, i) => (
          <View key={`diary-${i}`} className='note-card card'>
            <View className='note-header'>
              <Text className='note-title'>{entry.date}</Text>
              <Text className='note-tag diary-tag'>日记</Text>
            </View>
            <Text className='note-summary'>{entry.content}</Text>
            <View className='note-footer'>
              <View className='note-tags'>
                {Object.entries(normalizeDiaryTagScores(entry.tagScores, entry.tags)).slice(0, 4).map(([tag, score]) => (
                  <Text key={tag} className='note-tag diary-tag'>{tag} {score}</Text>
                ))}
              </View>
            </View>
          </View>
        ))}
      </>
    )
  }

  return (
    <View className='notes-page'>
      <View className='page-header'>
        <Text className='page-title'>笔记</Text>
        <Text className='page-subtitle'>
          {hasSearch
            ? `${filteredNotes.length + filteredDiary.length} 个结果`
            : todayNotes.length > 0 ? `今天 ${todayNotes.length} 条` : '随机回顾'}
        </Text>
      </View>

      <View className='search-bar'>
        <Text className='search-icon'>🔍</Text>
        <Input
          className='search-input'
          placeholder='搜索笔记和日记'
          value={search}
          onInput={e => setSearch(e.detail.value)}
        />
        {search ? <Text className='search-clear' onClick={() => setSearch('')}>✕</Text> : null}
      </View>

      <ScrollView scrollY showScrollbar={false} className='notes-list'>
        {loading && <View className='empty'><Text>加载中...</Text></View>}
        {!loading && !hasResults && (
          <View className='empty'><Text>{hasSearch ? '无匹配结果' : '暂无笔记 📝'}</Text></View>
        )}

        {showDiaryFirst ? renderDiaryCards(false) : null}
        {renderNoteCards()}
        {!showDiaryFirst ? renderDiaryCards(hasSearch && filteredNotes.length > 0) : null}
      </ScrollView>

      <View className='fab' onClick={() => setShowAdd(true)}>
        <Text className='fab-icon'>+</Text>
      </View>

      {/* 新建弹窗 */}
      {showAdd && (
        <View className='modal-mask' onClick={() => setShowAdd(false)}>
          <View className='modal-box' onClick={stopProp}>
            <Text className='modal-title'>新建笔记</Text>

            <View className='form-item'>
              <Text className='form-label'>标题</Text>
              <Input className='form-input' placeholder='笔记标题' value={form.title}
                onInput={e => setForm(f => ({ ...f, title: e.detail.value }))} />
            </View>

            <View className='form-item'>
              <Text className='form-label'>内容摘要</Text>
              <Textarea className='form-textarea' placeholder='简要记录内容...' value={form.summary}
                onInput={e => setForm(f => ({ ...f, summary: e.detail.value }))} />
            </View>

            <View className='form-item'>
              <Text className='form-label'>标签（逗号分隔）</Text>
              <Input className='form-input' placeholder='如：学习, LLM, 技术' value={form.tags}
                onInput={e => setForm(f => ({ ...f, tags: e.detail.value }))} />
            </View>

            <View className='modal-actions'>
              <View className='btn-cancel' onClick={() => setShowAdd(false)}><Text>取消</Text></View>
              <View className='btn-confirm' onClick={handleAdd}><Text>保存</Text></View>
            </View>
          </View>
        </View>
      )}

    </View>
  )
}
