import { useState, useEffect, useCallback, useRef } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, ScrollView, Image, Canvas } from '@tarojs/components'
import { getData } from '../../api/index'
import './index.scss'

const BOOKS_CACHE_KEY = 'books_cache_v2'
const WEEK_GOAL_MINUTES = 300 // 5小时/周

const TABS = [
  { key: 'reading',  label: '在读' },
  { key: 'want',     label: '想读' },
  { key: 'finished', label: '读完' },
]

function getWeekDayDots(weekDaily) {
  const now = new Date()
  const dow = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
  monday.setHours(0, 0, 0, 0)
  return ['一','二','三','四','五','六','日'].map((label, i) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    const tsStart = Math.floor(day.getTime() / 1000)
    const tsEnd = tsStart + 86400
    const hasRead = Object.entries(weekDaily || {}).some(([k, v]) => {
      const kt = parseInt(k)
      return v > 0 && kt >= tsStart && kt < tsEnd
    })
    const isToday = day.toDateString() === now.toDateString()
    return { label, hasRead, isToday }
  })
}

function drawRing(ctx, W, H, minutes, goal) {
  const cx = W / 2, cy = H / 2
  const sw = 12
  const r = Math.min(W, H) / 2 - sw - 2
  const pct = goal > 0 ? Math.min(1, minutes / goal) : 0
  ctx.clearRect(0, 0, W, H)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = '#f0ede8'
  ctx.lineWidth = sw
  ctx.lineCap = 'round'
  ctx.stroke()
  if (pct > 0) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct)
    ctx.strokeStyle = '#2d6a4f'
    ctx.lineWidth = sw
    ctx.lineCap = 'round'
    ctx.stroke()
  }
}

function WeeklyRing({ weekMinutes, weekDaily, goalMinutes }) {
  useEffect(() => {
    Taro.nextTick(() => {
      Taro.createSelectorQuery()
        .select('#wr-ring')
        .fields({ node: true, size: true })
        .exec(([res]) => {
          if (!res?.node) return
          const cv = res.node
          const ctx = cv.getContext('2d')
          const dpr = Taro.getSystemInfoSync().pixelRatio
          cv.width = res.width * dpr
          cv.height = res.height * dpr
          ctx.scale(dpr, dpr)
          drawRing(ctx, res.width, res.height, weekMinutes, goalMinutes)
        })
    })
  }, [weekMinutes, goalMinutes])

  const hrs = Math.floor(weekMinutes / 60)
  const mins = weekMinutes % 60
  const timeStr = hrs > 0
    ? `${hrs}小时${mins > 0 ? mins + '分' : ''}`
    : `${mins || 0}分钟`
  const pctNum = Math.min(100, Math.round(weekMinutes / (goalMinutes || 1) * 100))
  const dayDots = getWeekDayDots(weekDaily)

  return (
    <View className='week-ring-card card'>
      <View className='week-ring-top'>
        <View className='week-ring-wrap'>
          <Canvas type='2d' id='wr-ring' className='week-ring-canvas' />
          <View className='week-ring-center'>
            <Text className='week-ring-time'>{timeStr}</Text>
            <Text className='week-ring-sub'>本周阅读</Text>
          </View>
        </View>
        <View className='week-ring-stats'>
          <Text className='week-ring-pct'>{pctNum}%</Text>
          <Text className='week-ring-goal'>目标 {Math.floor(goalMinutes / 60)} 小时/周</Text>
        </View>
      </View>
      <View className='week-ring-days'>
        {dayDots.map((d, i) => (
          <View key={i} className='week-day-item'>
            <View className={`week-day-dot${d.hasRead ? ' week-day-done' : ''}${d.isToday ? ' week-day-today' : ''}`} />
            <Text className={`week-day-label${d.isToday ? ' week-day-label-today' : ''}`}>{d.label}</Text>
          </View>
        ))}
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
  const [weekMinutes, setWeekMinutes] = useState(0)
  const [weekDaily, setWeekDaily] = useState({})
  const touchRef = useRef({ x: 0, y: 0, time: 0 })

  const loadData = useCallback(async () => {
    try {
      const data = await getData()
      const fetched = (data.books || []).filter(b => b.source === 'weread')
      setBooks(fetched)
      setWeekMinutes(data.weekReadMinutes || 0)
      setWeekDaily(data.weekReadDaily || {})
      try { Taro.setStorageSync(BOOKS_CACHE_KEY, { books: fetched }) } catch {}
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'error' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useDidShow(() => { loadData() })

  const finished = books.filter(b => (b.progressPercent ?? 0) >= 99)
  const finishedIds = new Set(finished.map(b => b.id))

  const reading = books
    .filter(b => !finishedIds.has(b.id) && b.status === 'reading')
    .sort((a, b) => (b.readTimestamp || b.sourceUpdatedTimestamp || 0) - (a.readTimestamp || a.sourceUpdatedTimestamp || 0))
    .slice(0, 3)

  const want = books.filter(b => !finishedIds.has(b.id) && b.status === 'want')

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

      <ScrollView key={tab} scrollY showScrollbar={false} className='book-list'>
        {loading && <View className='empty'><Text>加载中...</Text></View>}
        {!loading && listMap[tab].length === 0 && <View className='empty'><Text>暂无书籍 📚</Text></View>}

        {!loading && listMap[tab].map(book => {
          const pct = book.progressPercent ?? 0
          return (
            <View key={book.id} className='book-card card'>
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
          <WeeklyRing
            weekMinutes={weekMinutes}
            weekDaily={weekDaily}
            goalMinutes={WEEK_GOAL_MINUTES}
          />
        )}
      </ScrollView>
    </View>
  )
}
