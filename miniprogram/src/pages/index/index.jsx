import { useState, useEffect, useCallback, useRef } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { View, Text, ScrollView, Input, Textarea } from '@tarojs/components'
import { getData, addTask, updateTask, deleteTask, getDiary, getDiaryToday, saveDiary } from '../../api/index'
import './index.scss'

const TYPE_TABS = [
  { key: 'daily',    label: '日常' },
  { key: 'weekly',   label: '本周' },
  { key: 'longterm', label: '长期' },
  { key: 'diary',    label: '日记' }
]

const PRIORITY_MAP = {
  high:   { label: '高', cls: 'priority-high' },
  medium: { label: '中', cls: 'priority-medium' },
  low:    { label: '低', cls: 'priority-low' }
}

const CATEGORY_MAP = {
  study: '学习', research: '研究', life: '生活', note: '笔记'
}

const TYPE_LABEL     = { daily: '日常', weekly: '本周', longterm: '长期' }
const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' }

const EMPTY_FORM  = { title: '', taskType: 'weekly', priority: 'medium', category: 'study' }
const EMPTY_DIARY = { today: { date: '', content: '' }, archive: [] }

const TASKS_CACHE_KEY = 'tasks_cache_v1'
const DIARY_CACHE_KEY = 'diary_cache_v2'
const LEGACY_DIARY_CACHE_KEYS = ['diary_cache_v1']

function getTodayStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
}

function normalizeStatus(status) {
  return status === 'todo' ? 'in_progress' : (status || 'in_progress')
}

function normalizeDiaryText(text = '') {
  return String(text || '').replace(/\r\n?/g, '\n').trim()
}

function stripLegacyVideoFallback(text = '') {
  const withoutHtmlVideo = String(text || '').replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, '')
  const lines = withoutHtmlVideo.split('\n')
  const cleaned = []

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (trimmed === 'Your browser does not support the video tag.') {
      const next = (lines[i + 1] || '').trim()
      if (/^\d{1,2}:\d{2}$/.test(next)) i += 1
      continue
    }
    cleaned.push(lines[i])
  }

  return cleaned.join('\n')
}

function cleanDiaryContent(text = '') {
  const stripped = stripLegacyVideoFallback(text)
  const parts = stripped
    .split(/\n\s*---\s*\n/g)
    .map(normalizeDiaryText)
    .filter(Boolean)

  if (parts.length >= 2 && parts.every(part => part === parts[0])) {
    return parts[0]
  }

  const normalized = normalizeDiaryText(stripped).replace(/\n{3,}/g, '\n\n')
  return /^-+$/.test(normalized) ? '' : normalized
}

function normalizeDiaryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const date = String(entry.date || '').trim()
  if (!date) return null
  return {
    ...entry,
    date,
    content: cleanDiaryContent(entry.content || '')
  }
}

function normalizeDiaryPayload(payload) {
  const diary = payload && typeof payload === 'object' ? payload : {}
  const today = diary.today && typeof diary.today === 'object' ? diary.today : {}

  return {
    today: {
      ...today,
      date: String(today.date || '').trim(),
      content: cleanDiaryContent(today.content || '')
    },
    archive: Array.isArray(diary.archive)
      ? diary.archive.map(normalizeDiaryEntry).filter(Boolean)
      : []
  }
}

function readCachedDiary() {
  for (const key of [DIARY_CACHE_KEY, ...LEGACY_DIARY_CACHE_KEYS]) {
    try {
      const cached = Taro.getStorageSync(key)
      if (cached) return normalizeDiaryPayload(cached)
    } catch {}
  }
  return null
}

function persistDiaryCache(diary) {
  try {
    Taro.setStorageSync(DIARY_CACHE_KEY, diary)
    for (const key of LEGACY_DIARY_CACHE_KEYS) {
      Taro.removeStorageSync(key)
    }
  } catch {}
}

// 优先显示"历史上的今天"，否则降级到同月，再降级到纯随机
function pickTodayInHistoryIdx(archive) {
  if (!archive?.length) return null
  const today  = new Date()
  const yyyy   = String(today.getFullYear())
  const mm     = String(today.getMonth() + 1).padStart(2, '0')
  const dd     = String(today.getDate()).padStart(2, '0')
  const mmdd   = `${mm}-${dd}`

  // 精确同月同日（不含今年）
  const sameDay = archive.reduce((acc, e, i) => {
    if (e.date?.slice(5) === mmdd && e.date?.slice(0, 4) !== yyyy) acc.push(i)
    return acc
  }, [])
  if (sameDay.length) return sameDay[Math.floor(Math.random() * sameDay.length)]

  // 降级：同月不同年
  const sameMonth = archive.reduce((acc, e, i) => {
    if (e.date?.slice(5, 7) === mm && e.date?.slice(0, 4) !== yyyy) acc.push(i)
    return acc
  }, [])
  if (sameMonth.length) return sameMonth[Math.floor(Math.random() * sameMonth.length)]

  // 完全随机
  return Math.floor(Math.random() * archive.length)
}

// 骨架屏卡片
function SkeletonCards() {
  return (
    <>
      {[1, 2, 3].map(n => (
        <View key={n} className='skeleton-card'>
          <View className='skeleton-row'>
            <View className='skeleton-circle' />
            <View className='skeleton-line skeleton-title' />
          </View>
          <View className='skeleton-line skeleton-tag' style={{ marginLeft: '54px' }} />
        </View>
      ))}
    </>
  )
}

export default function TaskPage() {
  // 缓存在 useState 初始值里同步读取，第一帧即可渲染数据
  const [tasks, setTasks] = useState(() => {
    try {
      const c = Taro.getStorageSync(TASKS_CACHE_KEY)
      return c?.tasks || []
    } catch { return [] }
  })
  const [tab, setTab]           = useState('daily')
  const [loading, setLoading]   = useState(() => {
    try { return !Taro.getStorageSync(TASKS_CACHE_KEY)?.tasks } catch { return true }
  })
  const [hasCache, setHasCache] = useState(() => {
    try { return !!Taro.getStorageSync(TASKS_CACHE_KEY)?.tasks } catch { return false }
  })
  const [showAdd, setShowAdd]   = useState(false)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [editTask, setEditTask] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)

  // 日记
  const [diary, setDiary] = useState(() => readCachedDiary() || EMPTY_DIARY)
  const [diaryLoading, setDiaryLoading] = useState(() => !readCachedDiary())
  const [diarySaving, setDiarySaving]   = useState(false)
  const diaryTimerRef = useRef(null)

  // 历史上的今天
  const [randomArchiveIdx, setRandomArchiveIdx] = useState(null)
  const archiveLoadedRef = useRef(false)

  // 全屏日记阅读器（随机导航，历史栈支持返回）
  const [diaryFullscreen, setDiaryFullscreen] = useState(false)
  const [fullscreenIdx, setFullscreenIdx]     = useState(0)
  const [fsHistory, setFsHistory]             = useState([])
  const fullscreenTouchRef = useRef({ x: 0, y: 0, time: 0 })

  // ── 数据加载（缓存已在 useState 初始值读取，这里只做后台刷新）──────────────────
  const loadData = useCallback(async () => {
    try {
      const data = await getData()
      setTasks(data.tasks || [])
      try { Taro.setStorageSync(TASKS_CACHE_KEY, data) } catch {}
    } catch {
      if (!hasCache) Taro.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [])

  // 只加载今日日记（轻量，启动/切回时用）
  const loadDiaryToday = useCallback(async () => {
    try {
      const d = await getDiaryToday()
      const todayStr = getTodayStr()
      const td = (d && d.today) ? d.today : { date: '', content: '' }
      setDiary(prev => {
        const updated = { ...prev, today: { date: td.date || todayStr, content: td.content || '' } }
        persistDiaryCache(updated)
        return updated
      })
    } catch {} finally {
      setDiaryLoading(false)
    }
  }, [])

  // 加载完整日记（含归档，进入日记 tab 时懒加载）
  const loadDiary = useCallback(async () => {
    if (archiveLoadedRef.current) return
    try {
      const d = await getDiary()
      const data = normalizeDiaryPayload(d || EMPTY_DIARY)
      const todayStr = getTodayStr()
      const td = data.today || {}

      if (td.content && td.date !== todayStr) {
        const archiveDate = td.date || (() => {
          const y = new Date(); y.setDate(y.getDate() - 1)
          return `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`
        })()
        data.archive = [{ date: archiveDate, content: td.content }, ...(data.archive || [])]
        data.today = { date: todayStr, content: '' }
        saveDiary(data).catch(() => {})
      } else if (!td.date) {
        data.today = { date: todayStr, content: td.content || '' }
      }

      archiveLoadedRef.current = true
      setDiary(data)
      persistDiaryCache(data)
    } catch {} finally {
      setDiaryLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadDiaryToday() }, [loadDiaryToday])

  // 进入日记 tab 时懒加载归档
  useEffect(() => {
    if (tab === 'diary') loadDiary()
  }, [tab, loadDiary])

  // 历史上的今天：archive 变化后重新随机，避免沿用旧索引
  useEffect(() => {
    if (diary.archive?.length > 0) {
      setRandomArchiveIdx(pickTodayInHistoryIdx(diary.archive))
    } else {
      setRandomArchiveIdx(null)
    }
  }, [diary.archive])

  useDidShow(() => {
    archiveLoadedRef.current = false
    loadDiaryToday()
    loadData()
  })

  // 小程序切后台/关闭时立即保存日记
  const diaryRef = useRef(diary)
  useEffect(() => { diaryRef.current = diary }, [diary])
  useDidHide(() => {
    if (diaryTimerRef.current) {
      clearTimeout(diaryTimerRef.current)
      diaryTimerRef.current = null
    }
    const normalized = normalizeDiaryPayload(diaryRef.current)
    persistDiaryCache(normalized)
    // 只有今日内容非空才推送，避免加载未完成时用空内容覆盖云端
    if (normalized.today?.content?.trim()) {
      saveDiary(normalized).catch(() => {})
    }
  })

  // 离开日记 tab 时立即保存
  const prevTabRef = useRef(tab)
  useEffect(() => {
    if (prevTabRef.current === 'diary' && tab !== 'diary') {
      if (diaryTimerRef.current) {
        clearTimeout(diaryTimerRef.current)
        diaryTimerRef.current = null
        const normalized = normalizeDiaryPayload(diary)
        persistDiaryCache(normalized)
        if (normalized.today?.content?.trim()) {
          saveDiary(normalized).catch(() => {})
        }
      }
    }
    prevTabRef.current = tab
  }, [tab, diary])

  const active    = tasks.filter(t => t.taskType === tab && normalizeStatus(t.status) !== 'completed')
  const completed = tasks.filter(t => t.taskType === tab && normalizeStatus(t.status) === 'completed')

  async function handleStatusChange(task) {
    const next = normalizeStatus(task.status) === 'completed' ? 'in_progress' : 'completed'
    // 乐观更新：先改 UI，再发请求
    const updatedTasks = tasks.map(t => t.id === task.id ? { ...t, status: next } : t)
    setTasks(updatedTasks)
    try {
      await updateTask({ id: task.id, status: next })
      // 写入 cache，防止 app 重启后状态回退
      try {
        const cached = Taro.getStorageSync(TASKS_CACHE_KEY) || {}
        Taro.setStorageSync(TASKS_CACHE_KEY, { ...cached, tasks: updatedTasks })
      } catch {}
    } catch {
      // 回滚
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t))
      Taro.showToast({ title: '更新失败', icon: 'error' })
    }
  }

  async function handleDelete(id) {
    Taro.showModal({
      title: '确认删除',
      content: '删除后不可恢复',
      success: async ({ confirm }) => {
        if (!confirm) return
        // 乐观删除
        setTasks(prev => prev.filter(t => t.id !== id))
        setEditTask(null)
        try {
          await deleteTask(id)
        } catch {
          Taro.showToast({ title: '删除失败', icon: 'error' })
          loadData()
        }
      }
    })
  }

  async function handleAdd() {
    if (!form.title.trim()) {
      Taro.showToast({ title: '请输入任务名称', icon: 'none' })
      return
    }
    try {
      const res = await addTask({ ...form, status: 'in_progress' })
      setTasks(prev => [...prev, res.task])
      setShowAdd(false)
      setForm(EMPTY_FORM)
    } catch {
      Taro.showToast({ title: '添加失败', icon: 'error' })
    }
  }

  function openEdit(task) {
    setEditForm({
      title:    task.title    || '',
      taskType: task.taskType || 'weekly',
      priority: task.priority || 'medium',
      category: task.category || 'study',
    })
    setEditTask(task)
  }

  async function handleEditSave() {
    if (!editForm.title.trim()) {
      Taro.showToast({ title: '请输入任务名称', icon: 'none' })
      return
    }
    // 乐观更新
    setTasks(prev => prev.map(t => t.id === editTask.id ? { ...t, ...editForm } : t))
    setEditTask(null)
    try {
      await updateTask({ id: editTask.id, ...editForm })
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'error' })
      loadData()
    }
  }

  function handleDiaryChange(content) {
    const updated = { ...diary, today: { date: getTodayStr(), content } }
    setDiary(updated)
    persistDiaryCache(updated)
    if (diaryTimerRef.current) clearTimeout(diaryTimerRef.current)
    diaryTimerRef.current = setTimeout(async () => {
      try {
        setDiarySaving(true)
        const normalized = normalizeDiaryPayload(updated)
        persistDiaryCache(normalized)
        await saveDiary(normalized)
      } catch {
        Taro.showToast({ title: '保存失败', icon: 'error' })
      } finally {
        setDiarySaving(false)
      }
    }, 1500)
  }

  function openFullscreen(idx) {
    setFullscreenIdx(idx)
    setFsHistory([])
    setDiaryFullscreen(true)
  }

  function fsPickRandom(currentIdx, archive) {
    const len = archive?.length ?? 0
    if (len <= 1) return currentIdx
    let next
    do { next = Math.floor(Math.random() * len) } while (next === currentIdx)
    return next
  }

  function fsGoNext() {
    const next = fsPickRandom(fullscreenIdx, diary.archive)
    setFsHistory(h => [...h, fullscreenIdx])
    setFullscreenIdx(next)
  }

  function fsGoBack() {
    if (fsHistory.length === 0) return
    setFullscreenIdx(fsHistory[fsHistory.length - 1])
    setFsHistory(h => h.slice(0, -1))
  }

  function handleFsTouchStart(e) {
    const t = e.touches[0]
    fullscreenTouchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() }
  }

  function handleFsTouchEnd(e) {
    const t = e.changedTouches[0]
    const dx = t.clientX - fullscreenTouchRef.current.x
    const dy = t.clientY - fullscreenTouchRef.current.y
    const dt = Date.now() - fullscreenTouchRef.current.time
    if (dt < 80) return
    if (Math.abs(dy) > Math.abs(dx)) return
    if (Math.abs(dx) > 50) {
      if (dx < 0) fsGoNext()
      else fsGoBack()
    }
  }

  function stopProp(e) { e.stopPropagation() }

  // ── Tab 滑动切换 ──────────────────────────────────
  const TAB_KEYS = TYPE_TABS.map(t => t.key)
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 })

  function handleTouchStart(e) {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() }
  }

  function handleTouchEnd(e) {
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStartRef.current.x
    const dy = t.clientY - touchStartRef.current.y
    const dt = Date.now() - touchStartRef.current.time
    if (dt < 100) return
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const idx = TAB_KEYS.indexOf(tab)
      if (dx < 0 && idx < TAB_KEYS.length - 1) setTab(TAB_KEYS[idx + 1])
      if (dx > 0 && idx > 0)                    setTab(TAB_KEYS[idx - 1])
    }
  }

  const inProgressCount = tasks.filter(t => normalizeStatus(t.status) !== 'completed').length
  const completedCount  = tasks.filter(t => normalizeStatus(t.status) === 'completed').length
  const dailyCount      = tasks.filter(t => t.taskType === 'daily' && normalizeStatus(t.status) !== 'completed').length

  const archiveLen  = diary.archive?.length ?? 0
  const randomEntry = (randomArchiveIdx !== null && archiveLen > 0) ? diary.archive[randomArchiveIdx] : null

  // 历史上的今天标签
  const today = new Date()
  const todayMmdd = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const isHistoryToday = randomEntry && randomEntry.date?.slice(5) === todayMmdd
  const historyLabel = isHistoryToday
    ? `历史上的今天 · ${randomEntry.date?.slice(0,4)}`
    : randomEntry
      ? `往期日记 · ${randomEntry.date}`
      : '往期日记'

  return (
    <View className='task-page'>
      {/* 顶部统计 */}
      <View className='header-stats'>
        <View className='stat-item'>
          <Text className='stat-num'>{inProgressCount}</Text>
          <Text className='stat-label'>进行中</Text>
        </View>
        <View className='stat-divider' />
        <View className='stat-item'>
          <Text className='stat-num'>{dailyCount}</Text>
          <Text className='stat-label'>日常</Text>
        </View>
        <View className='stat-divider' />
        <View className='stat-item'>
          <Text className='stat-num'>{completedCount}</Text>
          <Text className='stat-label'>已完成</Text>
        </View>
      </View>

      {/* 标签栏 */}
      <View className='tabs'>
        {TYPE_TABS.map(t => (
          <View key={t.key}
            className={`tab-item ${tab === t.key ? 'tab-active' : ''}`}
            onClick={() => setTab(t.key)}>
            <Text>{t.label}</Text>
          </View>
        ))}
      </View>

      {/* ── 日记 Tab ── */}
      {tab === 'diary' && (
        <View className='diary-page'
          onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {diaryLoading && !diary.today?.date ? (
            <View className='empty'><Text>加载中...</Text></View>
          ) : (
            // key={tab} 让内容在切换回来时重播淡入动画
            <View key='diary-content' className='diary-content-anim'>
              {/* 上半：今日日记 */}
              <View className='diary-section-top card'>
                <View className='diary-header'>
                  <Text className='diary-date'>{diary.today?.date || '今天'}</Text>
                  <Text className='diary-status'>{diarySaving ? '保存中...' : '自动保存'}</Text>
                </View>
                <ScrollView scrollY className='diary-textarea-scroll'>
                  <Textarea
                    className='diary-textarea'
                    placeholder='今天发生了什么...'
                    value={diary.today?.content || ''}
                    onInput={e => handleDiaryChange(e.detail.value)}
                    autoHeight
                    maxlength={5000}
                  />
                </ScrollView>
              </View>

              {/* 下半：历史上的今天 / 往期日记 */}
              {randomEntry && (
                <View className='diary-section-bottom card'
                  onClick={() => openFullscreen(randomArchiveIdx)}>
                  <View className='diary-random-header'>
                    <Text className={`history-label ${isHistoryToday ? 'history-label-accent' : ''}`}>
                      {historyLabel}
                    </Text>
                    <Text className='diary-tap-hint'>全屏 ›</Text>
                  </View>
                  <Text className='archive-content-preview'>{randomEntry.content}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* ── 任务列表 ── */}
      {tab !== 'diary' && (
        // key={tab} 使切换 tab 时 ScrollView 重新挂载，触发 CSS 进场动画
        <ScrollView key={tab} scrollY className='task-list'
          onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>

          {/* 骨架屏：仅在无缓存时展示 */}
          {loading && !hasCache && <SkeletonCards />}

          {!loading && active.length === 0 && (
            <View className='empty'><Text>暂无任务 ✨</Text></View>
          )}

          {active.map((task) => (
            <View key={task.id}
              className='task-card card'
              onClick={() => openEdit(task)}>
              <View className='task-header'>
                <View className='status-dot-wrap'
                  onClick={e => { e.stopPropagation(); handleStatusChange(task) }}>
                  <View className={`status-dot ${normalizeStatus(task.status)}`} />
                </View>
                <Text className='task-title'>{task.title}</Text>
              </View>
              <View className='task-meta'>
                <Text className={`tag ${PRIORITY_MAP[task.priority]?.cls}`}>
                  {PRIORITY_MAP[task.priority]?.label}优先
                </Text>
                {task.category && (
                  <Text className='tag tag-category'>{CATEGORY_MAP[task.category] || task.category}</Text>
                )}
              </View>
              {task.totalPage > 0 && (
                <View className='progress-row'>
                  <View className='progress-bar'>
                    <View className='progress-fill' style={{ width: `${Math.round((task.currentPage / task.totalPage) * 100)}%` }} />
                  </View>
                  <Text className='progress-text'>{task.currentPage}/{task.totalPage}</Text>
                </View>
              )}
              {task.deadline ? <Text className='task-deadline'>截止：{task.deadline}</Text> : null}
            </View>
          ))}

          {completed.length > 0 && (
            <View className='section-title'><Text>已完成 ({completed.length})</Text></View>
          )}
          {completed.map((task) => (
            <View key={task.id}
              className='task-card card task-done'
              onClick={() => openEdit(task)}>
              <View className='task-header'>
                <View className='status-dot-wrap'
                  onClick={e => { e.stopPropagation(); handleStatusChange(task) }}>
                  <View className='status-dot completed' />
                </View>
                <Text className='task-title done-title'>{task.title}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* 悬浮添加按钮 */}
      {tab !== 'diary' && (
        <View className='fab'
          onClick={() => { setForm({ ...EMPTY_FORM, taskType: tab }); setShowAdd(true) }}>
          <Text className='fab-icon'>+</Text>
        </View>
      )}

      {/* ── 全屏日记阅读器 ── */}
      {diaryFullscreen && archiveLen > 0 && (
        <View className='diary-fullscreen'
          onTouchStart={handleFsTouchStart}
          onTouchEnd={handleFsTouchEnd}>
          <View className='diary-fs-header'>
            <Text className='diary-fs-date'>{diary.archive[fullscreenIdx]?.date}</Text>
            <View className='diary-fs-close' onClick={() => setDiaryFullscreen(false)}>
              <Text className='diary-fs-close-icon'>✕</Text>
            </View>
          </View>
          <ScrollView scrollY className='diary-fs-body'>
            <Text className='diary-fs-text'>{diary.archive[fullscreenIdx]?.content}</Text>
          </ScrollView>
          <View className='diary-fs-footer'>
            <Text className='diary-fs-nav-left' onClick={fsGoBack}>{fsHistory.length > 0 ? '← 返回' : ''}</Text>
            <Text className='diary-fs-count'>{archiveLen} 篇</Text>
            <Text className='diary-fs-nav-right' onClick={fsGoNext}>随机 →</Text>
          </View>
        </View>
      )}

      {/* ── 添加弹窗 ── */}
      {showAdd && (
        <View className='modal-mask' onClick={() => setShowAdd(false)}>
          <View className='modal-box' onClick={stopProp}>
            <Text className='modal-title'>新增任务</Text>
            <View className='form-item'>
              <Text className='form-label'>任务名称</Text>
              <Input className='form-input form-input-tall'
                placeholder='请输入任务名称'
                value={form.title}
                onInput={e => setForm(f => ({ ...f, title: e.detail.value }))} />
            </View>
            <View className='form-item'>
              <Text className='form-label'>类型</Text>
              <View className='form-options'>
                {['daily','weekly','longterm'].map(k => (
                  <View key={k}
                    className={`option-btn ${form.taskType === k ? 'option-active' : ''}`}
                    onClick={() => setForm(f => ({ ...f, taskType: k }))}>
                    <Text>{TYPE_LABEL[k]}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View className='form-item'>
              <Text className='form-label'>优先级</Text>
              <View className='form-options'>
                {['high','medium','low'].map(k => (
                  <View key={k}
                    className={`option-btn ${form.priority === k ? 'option-active' : ''}`}
                    onClick={() => setForm(f => ({ ...f, priority: k }))}>
                    <Text>{PRIORITY_LABEL[k]}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View className='modal-actions'>
              <View className='btn-cancel' onClick={() => setShowAdd(false)}><Text>取消</Text></View>
              <View className='btn-confirm' onClick={handleAdd}><Text>添加</Text></View>
            </View>
          </View>
        </View>
      )}

      {/* ── 编辑弹窗 ── */}
      {editTask && (
        <View className='modal-mask' onClick={() => setEditTask(null)}>
          <View className='modal-box' onClick={stopProp}>
            <Text className='modal-title'>编辑任务</Text>
            <View className='form-item'>
              <Text className='form-label'>任务名称</Text>
              <Input className='form-input form-input-tall'
                placeholder='请输入任务名称'
                value={editForm.title}
                onInput={e => setEditForm(f => ({ ...f, title: e.detail.value }))} />
            </View>
            <View className='form-item'>
              <Text className='form-label'>类型</Text>
              <View className='form-options'>
                {['daily','weekly','longterm'].map(k => (
                  <View key={k}
                    className={`option-btn ${editForm.taskType === k ? 'option-active' : ''}`}
                    onClick={() => setEditForm(f => ({ ...f, taskType: k }))}>
                    <Text>{TYPE_LABEL[k]}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View className='form-item'>
              <Text className='form-label'>优先级</Text>
              <View className='form-options'>
                {['high','medium','low'].map(k => (
                  <View key={k}
                    className={`option-btn ${editForm.priority === k ? 'option-active' : ''}`}
                    onClick={() => setEditForm(f => ({ ...f, priority: k }))}>
                    <Text>{PRIORITY_LABEL[k]}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View className='modal-actions'>
              <View className='btn-cancel btn-delete' onClick={() => handleDelete(editTask.id)}><Text>删除</Text></View>
              <View className='btn-confirm' onClick={handleEditSave}><Text>保存</Text></View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
