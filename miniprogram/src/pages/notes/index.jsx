import { useState, useEffect, useCallback } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, ScrollView, Input, Textarea } from '@tarojs/components'
import { getData, addNote, getDiary } from '../../api/index'
import './index.scss'

const NOTES_CACHE_KEY = 'notes_cache_v1'
const DIARY_TAGS = ['学习卡壳','复习考试','焦虑内耗','灾难化','失眠亢奋','安静恢复','计划执行','决策止损','求职面试','人际边界']

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

  const filteredNotes = search
    ? notes.filter(n =>
        n.title.includes(search) ||
        (n.summary || '').includes(search) ||
        (n.tags || []).some(t => t.includes(search))
      )
    : displayed

  const filteredDiary = search
    ? diaryEntries.filter(e => diaryEntrySearchText(e).includes(search))
    : []

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

  return (
    <View className='notes-page'>
      <View className='page-header'>
        <Text className='page-title'>笔记</Text>
        <Text className='page-subtitle'>
          {search
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
          <View className='empty'><Text>{search ? '无匹配结果' : '暂无笔记 📝'}</Text></View>
        )}

        {filteredNotes.map(note => (
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
        ))}

        {filteredDiary.length > 0 && (
          <>
            {search && filteredNotes.length > 0 && (
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
        )}
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
