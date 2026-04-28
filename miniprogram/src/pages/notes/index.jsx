import { useState, useEffect, useCallback } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, ScrollView, Input, Textarea } from '@tarojs/components'
import { getData, addNote, deleteNote, getDiary } from '../../api/index'
import './index.scss'

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

export default function NotesPage() {
  const [notes, setNotes]         = useState([])
  const [diaryEntries, setDiaryEntries] = useState([])  // today + archive 展平
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [showAdd, setShowAdd]     = useState(false)
  const [form, setForm]           = useState({ title: '', summary: '', tags: '' })
  const [fallbackNotes, setFallbackNotes] = useState([])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [data, diary] = await Promise.all([getData(), getDiary()])
      setNotes(data.notes || [])
      const entries = []
      if (diary.today?.date && diary.today?.content?.trim())
        entries.push({ date: diary.today.date, content: diary.today.content })
      for (const e of (diary.archive || []))
        if (e.date && e.content?.trim()) entries.push({ date: e.date, content: e.content })
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

  // 搜索时同时检索笔记和日记
  const filteredNotes = search
    ? notes.filter(n =>
        n.title.includes(search) ||
        (n.summary || '').includes(search) ||
        (n.tags || []).some(t => t.includes(search))
      )
    : displayed

  const filteredDiary = search
    ? diaryEntries.filter(e => e.content.includes(search) || e.date.includes(search))
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
      setNotes(prev => [res.note, ...prev])
      setShowAdd(false)
      setForm({ title: '', summary: '', tags: '' })
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'error' })
    }
  }

  async function handleDelete(id) {
    Taro.showModal({
      title: '确认删除',
      content: '删除后不可恢复',
      success: async ({ confirm }) => {
        if (!confirm) return
        try {
          await deleteNote(id)
          setNotes(prev => prev.filter(n => n.id !== id))
        } catch {
          Taro.showToast({ title: '删除失败', icon: 'error' })
        }
      }
    })
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

        {/* 笔记卡片 */}
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

        {/* 日记搜索结果 */}
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
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <View className='fab' onClick={() => setShowAdd(true)}>
        <Text className='fab-icon'>+</Text>
      </View>

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
