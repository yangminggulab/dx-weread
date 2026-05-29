import { useState, useEffect, useCallback, useRef } from 'react'
import Taro, { useDidShow, useReady } from '@tarojs/taro'
import { View, Text, ScrollView, Image, Canvas } from '@tarojs/components'
import { getData } from '../../api/index'
import './index.scss'

const BOOKS_CACHE_KEY = 'books_cache_v2'
const DAY_GOAL_MINUTES = 30 // 30分钟/天

const TABS = [
  { key: 'reading',  label: '在读' },
  { key: 'want',     label: '想读' },
  { key: 'finished', label: '读完' },
]

function getTodayMinutes(weekDaily) {
  const now = new Date()
  const todayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
  const todayEnd = todayStart + 86400
  return Object.entries(weekDaily || {}).reduce((sum, [k, v]) => {
    const kt = parseInt(k)
    return sum + (kt >= todayStart && kt < todayEnd ? v : 0)
  }, 0)
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getStreakDays(dailyReadTimes, weekReadDaily, goalMinutes) {
  const completed = new Set(
    (dailyReadTimes || [])
      .filter(d => (d.minutes ?? Math.round((d.seconds || 0) / 60)) >= goalMinutes)
      .map(d => d.date)
  )
  if (getTodayMinutes(weekReadDaily) >= goalMinutes) completed.add(toDateStr(new Date()))
  if (!completed.size) return 0
  let streak = 0
  const d = new Date()
  if (!completed.has(toDateStr(d))) {
    d.setDate(d.getDate() - 1)
  }
  while (completed.has(toDateStr(d))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

function drawRing2d(ctx, W, H, minutes, goal) {
  const cx = W / 2, cy = H / 2
  const sw = Math.round(Math.min(W, H) * 0.20)
  const r = Math.min(W, H) / 2 - sw / 2 - 2
  const pct = goal > 0 ? minutes / goal : 0
  const start = Math.PI / 2

  ctx.clearRect(0, 0, W, H)

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = '#d4f0dc'
  ctx.lineWidth = sw
  ctx.lineCap = 'butt'
  ctx.stroke()

  if (pct <= 0) return

  if (pct >= 1) {
    // Layer 2: sealed base ring — arc(0, 2π) is a closed path with no start/end,
    // so lineCap is irrelevant and there are zero cap artifacts at six o'clock.
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = '#4cd964'
    ctx.lineWidth = sw
    ctx.lineCap = 'butt'
    ctx.stroke()

    const ov = pct % 1
    if (ov > 0) {
      const endAngle = start + Math.PI * 2 * ov

      // Layer 3: overflow arc, butt caps — tail blends into base ring, no protrusion.
      ctx.beginPath()
      ctx.arc(cx, cy, r, start, endAngle, false)
      ctx.strokeStyle = '#4cd964'
      ctx.lineWidth = sw
      ctx.lineCap = 'butt'
      ctx.stroke()

      // Layer 4: filled circle at leading edge — acts as round cap.
      // Shadow offset points toward center so it reads as "pressing on top of" the ring.
      const capX = cx + r * Math.cos(endAngle)
      const capY = cy + r * Math.sin(endAngle)
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = 6
      ctx.shadowOffsetX = -Math.cos(endAngle) * 3
      ctx.shadowOffsetY = -Math.sin(endAngle) * 3
      ctx.beginPath()
      ctx.arc(capX, capY, sw / 2, 0, Math.PI * 2)
      ctx.fillStyle = '#4cd964'
      ctx.fill()
      ctx.restore()
    }
  } else {
    ctx.beginPath()
    ctx.arc(cx, cy, r, start, start + Math.PI * 2 * pct, false)
    ctx.strokeStyle = '#4cd964'
    ctx.lineWidth = sw
    ctx.lineCap = 'round'
    ctx.stroke()
  }
}

function ReadingRing({ weekDaily, dailyReadTimes, totalReadDays, dayGoalMinutes }) {
  const todayMinutes = getTodayMinutes(weekDaily)
  const streakDays = getStreakDays(dailyReadTimes, weekDaily, dayGoalMinutes)

  const execPaint = useCallback((min, goal) => {
    Taro.createSelectorQuery()
      .select('#wr-ring')
      .fields({ node: true, size: true })
      .exec(([res]) => {
        if (!res?.node) return
        const cv = res.node
        const ctx = cv.getContext('2d')
        const dpr = Taro.getSystemInfoSync().pixelRatio
        const W = res.width || 110
        const H = res.height || 110
        cv.width = W * dpr
        cv.height = H * dpr
        ctx.scale(dpr, dpr)
        drawRing2d(ctx, W, H, min, goal)
      })
  }, [])

  useReady(() => {
    Taro.nextTick(() => execPaint(todayMinutes, dayGoalMinutes))
  })

  useEffect(() => {
    Taro.nextTick(() => execPaint(todayMinutes, dayGoalMinutes))
    const t = setTimeout(() => execPaint(todayMinutes, dayGoalMinutes), 500)
    return () => clearTimeout(t)
  }, [todayMinutes, dayGoalMinutes, execPaint])

  const hrs = Math.floor(todayMinutes / 60)
  const mins = todayMinutes % 60
  const todayStr = hrs > 0 ? `${hrs}时${mins}分` : `${mins}分钟`

  return (
    <View className='rring-card'>
      <View className='rring-row'>
        <View className='rring-wrap'>
          <Canvas type='2d' id='wr-ring' className='rring-canvas' />
        </View>
        <View className='rring-stats'>
          <View className='rring-stats-inner'>
            <View className='rring-stat-item'>
              <Text className='rring-label'>今日阅读</Text>
              <Text className='rring-val'>{todayStr}</Text>
            </View>
            <View className='rring-stat-item'>
              <Text className='rring-label'>连续完成</Text>
              <View className='rring-val-row'>
                <Text className='rring-val rring-val-plain'>{streakDays}</Text>
                <Text className='rring-unit'>天</Text>
              </View>
            </View>
            <View className='rring-stat-item'>
              <Text className='rring-label'>累积完成</Text>
              <View className='rring-val-row'>
                <Text className='rring-val rring-val-plain'>{totalReadDays}</Text>
                <Text className='rring-unit'>天</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}

export default function BooksPage() {
  const [books, setBooks] = useState(() => {
    try {
      const c = Taro.getStorageSync(BOOKS_CACHE_KEY)
      return c?.books || []
    } catch { return [] }
  })
  const [loading, setLoading] = useState(() => {
    try { return !Taro.getStorageSync(BOOKS_CACHE_KEY)?.books } catch { return true }
  })
  const [tab, setTab] = useState('reading')
  const [weekDaily, setWeekDaily] = useState({})
  const [totalReadDays, setTotalReadDays] = useState(0)
  const [dailyReadTimes, setDailyReadTimes] = useState([])
  const touchRef = useRef({ x: 0, y: 0, time: 0 })

  const loadData = useCallback(async () => {
    try {
      const data = await getData()
      const fetched = (data.books || []).filter(b => b.source === 'weread')
      setBooks(fetched)
      setWeekDaily(data.weekReadDaily || {})
      setTotalReadDays(data.totalReadDays || 0)
      setDailyReadTimes(data.wereadStats?.dailyReadTimes || [])
      try { Taro.setStorageSync(BOOKS_CACHE_KEY, { books: fetched }) } catch {}
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'error' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useDidShow(() => { loadData() })

  const finished = books.filter(b => b.status === 'finished' || (b.progressPercent ?? 0) >= 90)
  const bookKey = (b) => b._bookId || b.id
  const finishedIds = new Set(finished.map(bookKey))

  const allReading = books
    .filter(b => !finishedIds.has(bookKey(b)) && b.status === 'reading')
    .sort((a, b) => (b.readTimestamp || b.sourceUpdatedTimestamp || 0) - (a.readTimestamp || a.sourceUpdatedTimestamp || 0))
  const reading = allReading.slice(0, 3)
  const readingRest = allReading.slice(3)

  const want = [
    ...books.filter(b => !finishedIds.has(bookKey(b)) && b.status === 'want'),
    ...readingRest,
  ]

  const listMap = { reading, want, finished }
  const countMap = { reading: reading.length, want: want.length, finished: finished.length }

  function handleTouchStart(e) {
    const t = e.touches[0]
    touchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() }
  }

  function handleTouchEnd(e) {
    const t = e.changedTouches[0]
    const dx = t.clientX - touchRef.current.x
    const dy = t.clientY - touchRef.current.y
    const dt = Date.now() - touchRef.current.time
    if (dt < 100) return
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return
    const idx = TABS.findIndex(t => t.key === tab)
    if (dx < 0 && idx < TABS.length - 1) setTab(TABS[idx + 1].key)
    if (dx > 0 && idx > 0)              setTab(TABS[idx - 1].key)
  }


  return (
    <View className='books-page' onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <View className='page-header'>
        <Text className='page-title'>书单</Text>
        <Text className='page-subtitle'>共 {books.length} 本，在读 {reading.length} 本</Text>
      </View>

      <View className='tabs'>
        {TABS.map(t => (
          <View key={t.key} className={`tab-item ${tab === t.key ? 'tab-active' : ''}`} onClick={() => setTab(t.key)}>
            <Text>{t.label}</Text>
            {countMap[t.key] > 0 && <Text className='tab-count'>{countMap[t.key]}</Text>}
          </View>
        ))}
      </View>

      <View className='book-list-wrap'>
      <ScrollView key={tab} scrollY showScrollbar={false} className='book-list'>
        {loading && <View className='empty'><Text>加载中...</Text></View>}
        {!loading && listMap[tab].length === 0 && <View className='empty'><Text>暂无书籍 📚</Text></View>}

        {!loading && listMap[tab].map(book => {
          const pct = book.progressPercent ?? 0
          return (
            <View key={bookKey(book)} className='book-card card'>
              <View className='book-row'>
                {book.cover
                  ? <Image className='book-cover' src={book.cover} mode='aspectFill' />
                  : <View className='book-cover book-cover-fallback' style={{ background: book.accent || '#2d6a4f' }}>
                      <Text className='book-cover-title'>{book.title.slice(0, 4)}</Text>
                    </View>
                }
                <View className='book-info'>
                  <Text className='book-title'>{book.title}</Text>
                  {book.author ? <Text className='book-author'>{book.author}</Text> : null}
                  {book.readAt ? <Text className='book-date'>上次 {book.readAt}</Text> : null}
                  {pct > 0 && (
                    <View className='progress-row'>
                      <View className='progress-bar'>
                        <View className='progress-fill'
                          style={{ width: `${Math.min(100, pct)}%`, background: book.accent || '#2d6a4f' }} />
                      </View>
                      <Text className='progress-text'>{pct}%</Text>
                    </View>
                  )}
                  {tab === 'reading' && book.todayReadMinutes > 0 && (
                    <Text className='book-today-read'>今天读了 {book.todayReadMinutes} 分钟</Text>
                  )}
                </View>
              </View>
            </View>
          )
        })}

        {!loading && tab === 'reading' && (
          <ReadingRing
            weekDaily={weekDaily}
            dailyReadTimes={dailyReadTimes}
            totalReadDays={totalReadDays}
            dayGoalMinutes={DAY_GOAL_MINUTES}
          />
        )}
      </ScrollView>
      {tab !== 'reading' && <View className='list-fade-bottom' />}
      </View>
    </View>
  )
}
