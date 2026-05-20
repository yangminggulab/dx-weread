import { useState, useEffect, useCallback, useRef } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
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

function drawArrowTip(ctx, cx, cy, r, angle, sw) {
  const tipX = cx + r * Math.cos(angle)
  const tipY = cy + r * Math.sin(angle)
  const half = sw / 2
  ctx.beginPath()
  ctx.arc(tipX, tipY, half, 0, Math.PI * 2)
  ctx.fillStyle = '#7ef587'
  ctx.fill()
  const dir = angle + Math.PI / 2
  const s = half * 0.5
  ctx.save()
  ctx.translate(tipX, tipY)
  ctx.rotate(dir)
  ctx.beginPath()
  ctx.moveTo(0, -s * 1.3)
  ctx.lineTo(s * 0.8, s * 0.8)
  ctx.lineTo(-s * 0.8, s * 0.8)
  ctx.closePath()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fill()
  ctx.restore()
}

function drawRing(ctx, W, H, minutes, goal) {
  const cx = W / 2, cy = H / 2
  const sw = 22
  const r = Math.min(W, H) / 2 - sw / 2 - 2
  const pct = goal > 0 ? minutes / goal : 0
  const start = -Math.PI / 2

  ctx.clearRect(0, 0, W, H)

  // Track
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'
  ctx.lineWidth = sw
  ctx.lineCap = 'butt'
  ctx.stroke()

  if (pct <= 0) return

  if (pct >= 1) {
    // Full first lap
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = '#4cd964'
    ctx.lineWidth = sw
    ctx.lineCap = 'butt'
    ctx.stroke()

    const overflow = pct % 1
    if (overflow > 0.005) {
      ctx.beginPath()
      ctx.arc(cx, cy, r, start, start + Math.PI * 2 * overflow)
      ctx.strokeStyle = '#7ef587'
      ctx.lineWidth = sw
      ctx.lineCap = 'round'
      ctx.stroke()
      drawArrowTip(ctx, cx, cy, r, start + Math.PI * 2 * overflow, sw)
    } else {
      drawArrowTip(ctx, cx, cy, r, start, sw)
    }
  } else {
    ctx.beginPath()
    ctx.arc(cx, cy, r, start, start + Math.PI * 2 * pct)
    ctx.strokeStyle = '#4cd964'
    ctx.lineWidth = sw
    ctx.lineCap = 'round'
    ctx.stroke()
  }
}

function ReadingRing({ weekDaily, totalReadDays, dayGoalMinutes }) {
  const todayMinutes = getTodayMinutes(weekDaily)

  useEffect(() => {
    const paint = () => {
      Taro.createSelectorQuery()
        .select('#wr-ring')
        .fields({ node: true, size: true })
        .exec(([res]) => {
          if (!res?.node) return
          const cv = res.node
          const ctx = cv.getContext('2d')
          const dpr = Taro.getSystemInfoSync().pixelRatio
          const W = res.width || 90
          const H = res.height || 90
          cv.width = W * dpr
          cv.height = H * dpr
          ctx.scale(dpr, dpr)
          drawRing(ctx, W, H, todayMinutes, dayGoalMinutes)
        })
    }
    Taro.nextTick(paint)
    const t = setTimeout(paint, 500)
    return () => clearTimeout(t)
  }, [todayMinutes, dayGoalMinutes])

  const hrs = Math.floor(todayMinutes / 60)
  const mins = todayMinutes % 60
  const todayStr = hrs > 0 ? `${hrs}时${mins}分` : `${mins}分钟`

  return (
    <View className='rring-card'>
      <View className='rring-row'>
        <View className='rring-side'>
          <Text className='rring-val'>{todayStr}</Text>
          <Text className='rring-label'>今日阅读</Text>
        </View>
        <View className='rring-wrap'>
          <Canvas type='2d' id='wr-ring' className='rring-canvas' />
        </View>
        <View className='rring-side'>
          <View className='rring-side-top'>
            <Text className='rring-val rring-val-days'>{totalReadDays}</Text>
            <Text className='rring-unit'>天</Text>
          </View>
          <Text className='rring-label'>累计完成</Text>
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
  const touchRef = useRef({ x: 0, y: 0, time: 0 })

  const loadData = useCallback(async () => {
    try {
      const data = await getData()
      const fetched = (data.books || []).filter(b => b.source === 'weread')
      setBooks(fetched)
      setWeekDaily(data.weekReadDaily || {})
      setTotalReadDays(data.totalReadDays || 0)
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
          <ReadingRing
            weekDaily={weekDaily}
            totalReadDays={totalReadDays}
            dayGoalMinutes={DAY_GOAL_MINUTES}
          />
        )}
      </ScrollView>
    </View>
  )
}
