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
const DIARY_VIEW_WINDOW_DAYS = 30

const TASKS_CACHE_KEY = 'tasks_cache_v1'
const DIARY_CACHE_KEY = 'diary_cache_v2'
const LEGACY_DIARY_CACHE_KEYS = ['diary_cache_v1']
const DIARY_VIEW_META_KEY = 'diary_view_meta_v1'  // 轻量 view meta，单独持久化，不随 archive 一起被清空
const DIARY_TAGS = ['学习卡壳','复习考试','焦虑内耗','灾难化','失眠亢奋','安静恢复','计划执行','决策止损','求职面试','人际边界']

function getTodayStr() {
  const now = new Date()
  if (now.getHours() < 5) now.setDate(now.getDate() - 1)
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

function coerceDiaryViewCount(value) {
  const count = Number.parseInt(value, 10)
  return Number.isFinite(count) && count > 0 ? count : 0
}

function coerceDiaryTagScore(value) {
  const score = Number.parseInt(value, 10)
  if (!Number.isFinite(score)) return 0
  return Math.min(5, Math.max(0, score))
}

function normalizeDiaryTags(tags) {
  if (!Array.isArray(tags)) return []
  const seen = new Set()
  const normalized = []
  tags.forEach(item => {
    const tag = String(item || '').trim()
    if (DIARY_TAGS.includes(tag) && !seen.has(tag)) {
      seen.add(tag)
      normalized.push(tag)
    }
  })
  return normalized
}

function normalizeDiaryTagScores(scores, tags = []) {
  const normalized = {}
  if (scores && typeof scores === 'object' && !Array.isArray(scores)) {
    DIARY_TAGS.forEach(tag => {
      const score = coerceDiaryTagScore(scores[tag])
      if (score > 0) normalized[tag] = score
    })
  }
  normalizeDiaryTags(tags).forEach(tag => {
    if (!normalized[tag]) normalized[tag] = 1
  })
  return DIARY_TAGS.reduce((acc, tag) => {
    if (normalized[tag] > 0) acc[tag] = normalized[tag]
    return acc
  }, {})
}

function withNormalizedDiaryTags(entry) {
  const tagScores = normalizeDiaryTagScores(entry?.tagScores, entry?.tags)
  return {
    ...entry,
    tags: DIARY_TAGS.filter(tag => tagScores[tag] > 0),
    tagScores
  }
}

function updateDiaryEntryTagScore(entry, tag, score) {
  const tagScores = normalizeDiaryTagScores(entry?.tagScores, entry?.tags)
  const value = coerceDiaryTagScore(score)
  if (value > 0) tagScores[tag] = value
  else delete tagScores[tag]
  return withNormalizedDiaryTags({ ...entry, tagScores })
}

function mergeDiaryTagScores(baseEntry, overlayEntry) {
  const baseScores = normalizeDiaryTagScores(baseEntry?.tagScores, baseEntry?.tags)
  const overlayScores = normalizeDiaryTagScores(overlayEntry?.tagScores, overlayEntry?.tags)
  const merged = {}
  DIARY_TAGS.forEach(tag => {
    const score = Math.max(baseScores[tag] || 0, overlayScores[tag] || 0)
    if (score > 0) merged[tag] = score
  })
  return merged
}

function normalizeDiaryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const date = String(entry.date || '').trim()
  if (!date) return null
  return withNormalizedDiaryTags({
    ...entry,
    date,
    content: cleanDiaryContent(entry.content || ''),
    viewCount: coerceDiaryViewCount(entry.viewCount),
    lastViewedAt: String(entry.lastViewedAt || '').trim()
  })
}

function mergeDiaryEntryViewMeta(baseEntry, overlayEntry) {
  const normalizedBase = normalizeDiaryEntry(baseEntry)
  const normalizedOverlay = normalizeDiaryEntry(overlayEntry)
  if (!normalizedBase || !normalizedOverlay) return normalizedBase || normalizedOverlay
  const tagScores = mergeDiaryTagScores(normalizedBase, normalizedOverlay)
  return {
    ...normalizedBase,
    viewCount: Math.max(normalizedBase.viewCount || 0, normalizedOverlay.viewCount || 0),
    lastViewedAt: [normalizedBase.lastViewedAt || '', normalizedOverlay.lastViewedAt || ''].sort().slice(-1)[0] || '',
    tags: DIARY_TAGS.filter(tag => tagScores[tag] > 0),
    tagScores
  }
}

function mergeDiaryArchiveViewMeta(baseArchive = [], overlayArchive = []) {
  const overlayMap = new Map(
    overlayArchive
      .map(normalizeDiaryEntry)
      .filter(Boolean)
      .map(entry => [entry.date, entry])
  )

  return baseArchive
    .map(normalizeDiaryEntry)
    .filter(Boolean)
    .map(entry => mergeDiaryEntryViewMeta(entry, overlayMap.get(entry.date)))
}

function normalizeDiaryPayload(payload) {
  const diary = payload && typeof payload === 'object' ? payload : {}
  const today = diary.today && typeof diary.today === 'object' ? diary.today : {}

  return {
    today: withNormalizedDiaryTags({
      ...today,
      date: String(today.date || '').trim(),
      content: cleanDiaryContent(today.content || '')
    }),
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
    // 只缓存当天日记，归档从服务端拉取，避免 storage 超限闪退
    const safe = diary && typeof diary === 'object' ? diary : {}
    Taro.setStorageSync(DIARY_CACHE_KEY, { today: safe.today || {}, archive: [] })
    for (const key of LEGACY_DIARY_CACHE_KEYS) {
      Taro.removeStorageSync(key)
    }
  } catch {}
}

// view meta 单独存一份 { date: lastViewedAt }，避免 persistDiaryCache 把 archive 存成 [] 导致时间戳丢失
// _viewMetaCache 是内存镜像，避免每次 pickPreferredArchiveIdx 都走同步 storage 读（官方明确禁止高频 getStorageSync）
let _viewMetaCache = null
function readViewMeta() {
  if (_viewMetaCache !== null) return _viewMetaCache
  try {
    _viewMetaCache = Taro.getStorageSync(DIARY_VIEW_META_KEY) || {}
  } catch {
    _viewMetaCache = {}
  }
  return _viewMetaCache
}
function persistViewMeta(archive) {
  try {
    const existing = readViewMeta()
    const updated = { ...existing }
    ;(archive || []).forEach(e => {
      if (e?.date && e?.lastViewedAt && (!updated[e.date] || e.lastViewedAt > updated[e.date])) {
        updated[e.date] = e.lastViewedAt
      }
    })
    _viewMetaCache = updated  // 先更新内存镜像
    Taro.setStorageSync(DIARY_VIEW_META_KEY, updated)
  } catch {}
}

function wasViewedRecently(entry, days = DIARY_VIEW_WINDOW_DAYS) {
  const lastViewedAt = String(entry?.lastViewedAt || '').trim()
  if (!lastViewedAt) return false
  const viewedAt = new Date(lastViewedAt).getTime()
  if (Number.isNaN(viewedAt)) return false
  return (Date.now() - viewedAt) < days * 24 * 60 * 60 * 1000
}

function isTodayInHistoryEntry(entry, mmdd, yyyy) {
  return entry?.date?.slice(5) === mmdd && entry?.date?.slice(0, 4) !== yyyy
}

// 从最近一个月没看过的条目里随机选；全都看过时从全部里选
// 不再强制"历史上的今天"永远赢（会导致每天都刷出同一条）
function pickPreferredArchiveIdx(archive) {
  if (!archive?.length) return null
  // 用本地持久化的 view meta 补充服务端可能丢失的 lastViewedAt
  const viewMeta = readViewMeta()
  const enriched = archive.map(e => {
    const stored = viewMeta[e?.date]
    if (!stored) return e
    const best = [e.lastViewedAt || '', stored].sort().slice(-1)[0]
    return best !== e.lastViewedAt ? { ...e, lastViewedAt: best } : e
  })
  const unviewed = enriched.reduce((acc, entry, idx) => {
    if (!wasViewedRecently(entry)) acc.push(idx)
    return acc
  }, [])
  const pool = unviewed.length ? unviewed : enriched.map((_, idx) => idx)
  return pool[Math.floor(Math.random() * pool.length)]
}

function stampArchiveEntryViewed(diary, idx, viewedAt = new Date().toISOString()) {
  const normalized = normalizeDiaryPayload(diary)
  const current = normalized.archive[idx]
  if (!current) return normalized

  const nextArchive = normalized.archive.slice()
  nextArchive[idx] = {
    ...current,
    viewCount: coerceDiaryViewCount(current.viewCount) + 1,
    lastViewedAt: viewedAt
  }

  return {
    ...normalized,
    archive: nextArchive
  }
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

function DiaryTagScoreEditor({ entry, onScore }) {
  const tagScores = normalizeDiaryTagScores(entry?.tagScores, entry?.tags)
  return (
    <View className='diary-tag-editor' onClick={e => e.stopPropagation?.()}>
      <View className='diary-tag-editor-head'>
        <Text className='diary-tag-editor-title'>问题标签</Text>
        <Text className='diary-tag-editor-scale'>0-5</Text>
      </View>
      {DIARY_TAGS.map(tag => {
        const active = tagScores[tag] || 0
        return (
          <View className='diary-tag-score-row' key={tag}>
            <Text className='diary-tag-score-name'>{tag}</Text>
            <View className='diary-tag-score-options'>
              {[0, 1, 2, 3, 4, 5].map(score => (
                <Text
                  key={score}
                  className={`diary-tag-score-option ${active === score ? 'diary-tag-score-active' : ''}`}
                  onClick={e => {
                    e.stopPropagation?.()
                    onScore(tag, score)
                  }}
                >
                  {score}
                </Text>
              ))}
            </View>
          </View>
        )
      })}
    </View>
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
  const tagTimerRef   = useRef(null)

  // 历史上的今天
  const [randomArchiveIdx, setRandomArchiveIdx] = useState(null)
  const archiveLoadedRef     = useRef(false)
  const archiveInitializedRef = useRef(false)  // 首次 archive 加载后置 true，防止 reload 覆盖 useDidShow 设的随机值
  const loadingRef           = useRef(false)   // 防止 loadData 并发

  // 全屏日记阅读器（随机导航，历史栈支持返回）
  const [diaryFullscreen, setDiaryFullscreen] = useState(false)
  const [fullscreenIdx, setFullscreenIdx]     = useState(0)
  const [fsHistory, setFsHistory]             = useState([])
  const fullscreenTouchRef = useRef({ x: 0, y: 0, time: 0 })
  const diaryRef = useRef(diary)
  const archiveViewDirtyRef = useRef(false)
  const diaryTodayDirtyRef = useRef(false)
  const diaryLocalEditAtRef = useRef(0)
  const diaryFullLoadingRef = useRef(false)
  const tabRef = useRef(tab)
  const diaryKeyboardHeightRef = useRef(0)
  const diaryInputTouchRef = useRef(false)

  useEffect(() => { diaryRef.current = diary }, [diary])
  useEffect(() => { tabRef.current = tab }, [tab])

  useEffect(() => {
    const handleKeyboardHeightChange = (res = {}) => {
      if (tabRef.current !== 'diary') return
      const height = Number(res.height)
      console.info('[diary-keyboard]', { height: res.height })
      if (!Number.isFinite(height)) return
      diaryKeyboardHeightRef.current = height
    }
    Taro.onKeyboardHeightChange?.(handleKeyboardHeightChange)
    return () => Taro.offKeyboardHeightChange?.(handleKeyboardHeightChange)
  }, [])

  const applyDiarySnapshot = useCallback((nextDiary) => {
    const normalized = normalizeDiaryPayload(nextDiary)
    diaryRef.current = normalized
    setDiary(normalized)
    persistDiaryCache(normalized)
    return normalized
  }, [])

  const syncViewedArchiveIfNeeded = useCallback(async (nextDiary) => {
    if (!archiveLoadedRef.current || !archiveViewDirtyRef.current) return
    archiveViewDirtyRef.current = false
    try {
      await saveDiary(normalizeDiaryPayload(nextDiary))
    } catch {
      archiveViewDirtyRef.current = true
    }
  }, [])

  const recordArchiveView = useCallback((sourceDiary, idx, { syncIfReady = false } = {}) => {
    const normalized = normalizeDiaryPayload(sourceDiary)
    if (idx === null || idx === undefined || !normalized.archive[idx]) return normalized
    archiveViewDirtyRef.current = true
    const stamped = stampArchiveEntryViewed(normalized, idx)
    persistViewMeta(stamped.archive)  // 立即写本地，不依赖服务端是否保存成功
    const updated = applyDiarySnapshot(stamped)
    if (syncIfReady) syncViewedArchiveIfNeeded(updated)
    return updated
  }, [applyDiarySnapshot, syncViewedArchiveIfNeeded])

  // ── 数据加载（缓存已在 useState 初始值读取，这里只做后台刷新）──────────────────
  const loadData = useCallback(async () => {
    if (loadingRef.current) return   // 已有请求在途，跳过
    loadingRef.current = true
    try {
      const data = await getData()
      setTasks(data.tasks || [])
      try { Taro.setStorageSync(TASKS_CACHE_KEY, data) } catch {}
    } catch {
      if (!hasCache) Taro.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [])

  // 只加载今日日记（轻量，启动/切回时用）
  const loadDiaryToday = useCallback(async () => {
    const requestStartedAt = Date.now()
    try {
      const d = await getDiaryToday()
      const todayStr = getTodayStr()
      const td = (d && d.today) ? d.today : { date: '', content: '' }
      setDiary(prev => {
        if (diaryLocalEditAtRef.current > requestStartedAt) return prev
        const updated = normalizeDiaryPayload({
          ...prev,
          today: {
            ...prev.today,
            ...td,
            date: td.date || todayStr,
            content: td.content || ''
          }
        })
        diaryRef.current = updated
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
    if (diaryFullLoadingRef.current) return
    diaryFullLoadingRef.current = true
    const requestStartedAt = Date.now()
    try {
      const d = await getDiary()
      const localDiary = normalizeDiaryPayload(diaryRef.current)
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

      // 网络返回空 archive 时，保留缓存里的历史数据
      if (!data.archive.length) {
        const cached = readCachedDiary()
        if (cached?.archive?.length) data.archive = cached.archive
      }

      data.archive = mergeDiaryArchiveViewMeta(data.archive, localDiary.archive || [])
      if (diaryLocalEditAtRef.current > requestStartedAt) {
        data.today = normalizeDiaryPayload(diaryRef.current).today
      }

      let nextDiary = data
      archiveLoadedRef.current = true
      // 首次加载时初始化往期日记（useDidShow 若已有 archive 会提前设好随机值并置 true）
      if (!archiveInitializedRef.current && data.archive?.length > 0) {
        archiveInitializedRef.current = true
        const nextIdx = pickPreferredArchiveIdx(data.archive)
        setRandomArchiveIdx(nextIdx)
        nextDiary = recordArchiveView(data, nextIdx, { syncIfReady: true })
      } else {
        nextDiary = applyDiarySnapshot(data)
        if (archiveViewDirtyRef.current) syncViewedArchiveIfNeeded(nextDiary)
      }
    } catch {
      // 加载失败时若有缓存，仍允许保存今日日记
      if (!archiveLoadedRef.current && readCachedDiary()) {
        archiveLoadedRef.current = true
      }
    } finally {
      setDiaryLoading(false)
      diaryFullLoadingRef.current = false
    }
  }, [applyDiarySnapshot, recordArchiveView, syncViewedArchiveIfNeeded])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadDiaryToday() }, [loadDiaryToday])
  useEffect(() => { loadDiary() }, [loadDiary])   // 启动时后台加载完整归档

  useDidShow(() => {
    archiveLoadedRef.current = false
    loadDiaryToday()
    loadDiary()
    loadData()
    // 每次回到 app 前台，立即换一条往期日记（用本地 view meta，不依赖服务端是否已回包）
    const archive = diaryRef.current?.archive
    if (archive?.length > 0) {
      archiveInitializedRef.current = true  // 阻止 loadDiary 回调再次覆盖
      const nextIdx = pickPreferredArchiveIdx(archive)
      setRandomArchiveIdx(nextIdx)
      recordArchiveView(diaryRef.current, nextIdx)
    } else {
      archiveInitializedRef.current = false
      setRandomArchiveIdx(null)
    }
  })

  // 小程序切后台/关闭时立即保存日记
  useDidHide(() => {
    if (diaryTimerRef.current) {
      clearTimeout(diaryTimerRef.current)
      diaryTimerRef.current = null
    }
    const normalized = normalizeDiaryPayload(diaryRef.current)
    persistDiaryCache(normalized)
    // archiveViewDirty 不再要求 archiveLoadedRef，避免网络慢时 view stamp 丢失
    if (diaryTodayDirtyRef.current || normalized.today?.content?.trim() || archiveViewDirtyRef.current) {
      const hadDirtyViewMeta = archiveViewDirtyRef.current
      const hadDirtyToday = diaryTodayDirtyRef.current
      if (hadDirtyViewMeta) archiveViewDirtyRef.current = false
      if (hadDirtyToday) diaryTodayDirtyRef.current = false
      saveDiary(normalized).catch(() => {
        if (hadDirtyViewMeta) archiveViewDirtyRef.current = true
        if (hadDirtyToday) diaryTodayDirtyRef.current = true
      })
    }
  })

  // tab 切换：离开日记存档；切回日记重新选一条往期日记
  const prevTabRef = useRef(tab)
  useEffect(() => {
    const leaving  = prevTabRef.current === 'diary' && tab !== 'diary'
    const entering = prevTabRef.current !== 'diary' && tab === 'diary'

    if (leaving) {
      if (diaryTimerRef.current) {
        clearTimeout(diaryTimerRef.current)
        diaryTimerRef.current = null
      }
      const normalized = normalizeDiaryPayload(diaryRef.current)
      persistDiaryCache(normalized)
      if (diaryTodayDirtyRef.current || normalized.today?.content?.trim() || archiveViewDirtyRef.current) {
        const hadDirtyViewMeta = archiveViewDirtyRef.current
        const hadDirtyToday = diaryTodayDirtyRef.current
        if (hadDirtyViewMeta) archiveViewDirtyRef.current = false
        if (hadDirtyToday) diaryTodayDirtyRef.current = false
        saveDiary(normalized).catch(() => {
          if (hadDirtyViewMeta) archiveViewDirtyRef.current = true
          if (hadDirtyToday) diaryTodayDirtyRef.current = true
        })
      }
    }

    if (entering) {
      // 切回日记 tab：立即换一条往期日记，不等服务端
      const archive = diaryRef.current?.archive
      if (archive?.length > 0) {
        const nextIdx = pickPreferredArchiveIdx(archive)
        if (nextIdx !== null) {
          setRandomArchiveIdx(nextIdx)
          recordArchiveView(diaryRef.current, nextIdx)
        }
      }
      loadDiary()  // 若归档还未加载则补拉（archiveLoadedRef 守门，已加载则跳过）
    }

    prevTabRef.current = tab
  }, [tab, recordArchiveView, loadDiary])

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
        const updatedTasks = tasks.filter(t => t.id !== id)
        setTasks(updatedTasks)
        setEditTask(null)
        try {
          const cached = Taro.getStorageSync(TASKS_CACHE_KEY) || {}
          Taro.setStorageSync(TASKS_CACHE_KEY, { ...cached, tasks: updatedTasks })
        } catch {}
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
      const newTasks = [...tasks, res.task]
      setTasks(newTasks)
      try {
        const cached = Taro.getStorageSync(TASKS_CACHE_KEY) || {}
        Taro.setStorageSync(TASKS_CACHE_KEY, { ...cached, tasks: newTasks })
      } catch {}
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
    setEditTask(null)
    if (!editForm.title.trim()) return
    const updatedTasks = tasks.map(t => t.id === editTask.id ? { ...t, ...editForm } : t)
    setTasks(updatedTasks)
    try {
      await updateTask({ id: editTask.id, ...editForm })
      try {
        const cached = Taro.getStorageSync(TASKS_CACHE_KEY) || {}
        Taro.setStorageSync(TASKS_CACHE_KEY, { ...cached, tasks: updatedTasks })
      } catch {}
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'error' })
      loadData()
    }
  }

  function handleDiaryChange(content) {
    diaryLocalEditAtRef.current = Date.now()
    diaryTodayDirtyRef.current = true
    const updated = { ...diaryRef.current, today: { ...diaryRef.current.today, date: getTodayStr(), content } }
    diaryRef.current = updated
    setDiary(updated)
    if (diaryTimerRef.current) clearTimeout(diaryTimerRef.current)
    diaryTimerRef.current = setTimeout(async () => {
      try {
        setDiarySaving(true)
        const todayPayload = { today: updated.today, archive: [] }
        const normalized = normalizeDiaryPayload(todayPayload)
        persistDiaryCache(normalized)
        await saveDiary(normalized)
        if (diaryRef.current?.today?.content === updated.today.content) {
          diaryTodayDirtyRef.current = false
        }
      } catch {
        Taro.showToast({ title: '保存失败', icon: 'error' })
      } finally {
        setDiarySaving(false)
      }
    }, 1500)
  }

  async function saveDiaryMeta(updated, { todayOnly = false } = {}) {
    try {
      setDiarySaving(true)
      const payload = todayOnly
        ? normalizeDiaryPayload({ today: updated.today, archive: [] })
        : normalizeDiaryPayload(updated)
      persistDiaryCache(payload)
      await saveDiary(payload)
    } catch {
      Taro.showToast({ title: '标签保存失败', icon: 'none' })
    } finally {
      setDiarySaving(false)
    }
  }

  function handleTodayTagScore(tag, score) {
    diaryTodayDirtyRef.current = true
    const updated = {
      ...diaryRef.current,
      today: updateDiaryEntryTagScore({ ...diaryRef.current.today, date: getTodayStr() }, tag, score)
    }
    diaryRef.current = updated
    setDiary(updated)
    if (tagTimerRef.current) clearTimeout(tagTimerRef.current)
    tagTimerRef.current = setTimeout(() => saveDiaryMeta(updated, { todayOnly: true }), 600)
  }

  function handleArchiveTagScore(idx, tag, score) {
    const normalized = normalizeDiaryPayload(diaryRef.current)
    if (!normalized.archive[idx]) return
    const nextArchive = normalized.archive.slice()
    nextArchive[idx] = updateDiaryEntryTagScore(nextArchive[idx], tag, score)
    const updated = { ...normalized, archive: nextArchive }
    diaryRef.current = updated
    setDiary(updated)
    if (tagTimerRef.current) clearTimeout(tagTimerRef.current)
    tagTimerRef.current = setTimeout(() => saveDiaryMeta(updated), 600)
  }

  function closeDiaryKeyboard(e) {
    e?.stopPropagation?.()
    diaryKeyboardHeightRef.current = 0
    Taro.hideKeyboard?.()
  }

  function stopDiaryTextareaTap(e) {
    e?.stopPropagation?.()
  }

  function lockDiaryInputTouch(e) {
    e?.stopPropagation?.()
    diaryInputTouchRef.current = true
  }

  function unlockDiaryInputTouch(e) {
    e?.stopPropagation?.()
    setTimeout(() => {
      diaryInputTouchRef.current = false
    }, 0)
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
    recordArchiveView(diaryRef.current, next, { syncIfReady: true })
  }

  function fsGoBack() {
    if (fsHistory.length === 0) return
    const prevIdx = fsHistory[fsHistory.length - 1]
    setFullscreenIdx(prevIdx)
    setFsHistory(h => h.slice(0, -1))
    recordArchiveView(diaryRef.current, prevIdx, { syncIfReady: true })
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
    if (diaryInputTouchRef.current) return
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() }
  }

  function handleTouchEnd(e) {
    if (diaryInputTouchRef.current) return
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
  const today = new Date(`${getTodayStr()}T12:00:00`)
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
        <View
          className='diary-page'
          onClick={closeDiaryKeyboard}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {diaryLoading && !diary.today?.date ? (
            <View className='empty'><Text>加载中...</Text></View>
          ) : (
            // key={tab} 让内容在切换回来时重播淡入动画
            <View key='diary-content' className='diary-content-anim'>
              {/* 上半：今日日记 */}
              <View className='diary-section-top card'>
                <View className='diary-header'>
                  <Text className='diary-date'>{diary.today?.date || '今天'}</Text>
                  <View className='diary-status-wrap'>
                    {(diary.today?.tags || []).slice(0, 3).map(tag => (
                      <Text key={tag} className='diary-header-tag'>{tag}</Text>
                    ))}
                    <Text className='diary-done-btn' onClick={closeDiaryKeyboard}>完成</Text>
                  </View>
                </View>
                <ScrollView
                  className='diary-textarea-shell'
                  scrollY
                  onClick={stopDiaryTextareaTap}
                  onTouchStart={lockDiaryInputTouch}
                  onTouchEnd={unlockDiaryInputTouch}
                >
                  <Textarea
                    className='diary-textarea'
                    placeholder='今天发生了什么...'
                    value={diary.today?.content || ''}
                    onInput={e => handleDiaryChange(e.detail.value)}
                    onFocus={e => {
                      console.info('[diary-focus]', e.detail || {})
                    }}
                    onBlur={e => {
                      console.info('[diary-blur]', e.detail || {})
                    }}
                    autoHeight
                    adjustPosition={false}
                    showConfirmBar={false}
                    disableDefaultPadding
                    cursorSpacing={24}
                    maxlength={10000}
                  />
                </ScrollView>
                <DiaryTagScoreEditor entry={diary.today} onScore={handleTodayTagScore} />
              </View>

              {/* 下半：历史上的今天 / 往期日记 */}
              {randomEntry && (
                <View className='diary-section-bottom card'
                  onClick={e => { closeDiaryKeyboard(e); openFullscreen(randomArchiveIdx) }}>
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
        <View className='task-list-wrap'>
        {/* key={tab} 使切换 tab 时 ScrollView 重新挂载，触发 CSS 进场动画 */}
        <ScrollView key={tab} scrollY showScrollbar={false} className='task-list'
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
        <View className='list-fade-bottom' />
        </View>
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
          <DiaryTagScoreEditor
            entry={diary.archive[fullscreenIdx]}
            onScore={(tag, score) => handleArchiveTagScore(fullscreenIdx, tag, score)}
          />
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
        <View className='modal-mask' onClick={handleEditSave}>
          <View className='modal-box' onClick={stopProp}>
            <Text className='modal-title'>编辑任务</Text>
            <View className='form-item'>
              <Text className='form-label'>任务名称</Text>
              <Textarea className='form-input form-input-edit-tall'
                placeholder='请输入任务名称'
                value={editForm.title}
                onInput={e => setEditForm(f => ({ ...f, title: e.detail.value }))}
                adjustPosition={false}
                showConfirmBar={false}
                disableDefaultPadding
                cursorSpacing={24}
                maxlength={200} />
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
          </View>
        </View>
      )}
    </View>
  )
}
