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

function paintRing(canvasId, minutes, goal) {
  const S = 110  // drawing size (matches 220rpx on standard screen)
  const cx = S / 2, cy = S / 2
  const sw = 18
  const r = S / 2 - sw / 2 - 2
  const pct = goal > 0 ? minutes / goal : 0
  const start = -Math.PI / 2

  const ctx = Taro.createCanvasContext(canvasId)

  // Track
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.setStrokeStyle('#1a3d28')
  ctx.setLineWidth(sw)
  ctx.setLineCap('butt')
  ctx.stroke()

  if (pct > 0) {
    if (pct >= 1) {
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.setStrokeStyle('#4cd964')
      ctx.setLineWidth(sw)
      ctx.setLineCap('butt')
      ctx.stroke()
      const ov = pct % 1
      if (ov > 0.005) {
        ctx.beginPath()
        ctx.arc(cx, cy, r, start, start + Math.PI * 2 * ov)
        ctx.setStrokeStyle('#7ef587')
        ctx.setLineWidth(sw)
        ctx.setLineCap('round')
        ctx.stroke()
        const tipAngle = start + Math.PI * 2 * ov
        const tx = cx + r * Math.cos(tipAngle)
        const ty = cy + r * Math.sin(tipAngle)
        ctx.beginPath()
        ctx.arc(tx, ty, sw / 2, 0, Math.PI * 2)
        ctx.setFillStyle('#7ef587')
        ctx.fill()
      }
    } else {
      ctx.beginPath()
      ctx.arc(cx, cy, r, start, start + Math.PI * 2 * pct)
      ctx.setStrokeStyle('#4cd964')
      ctx.setLineWidth(sw)
      ctx.setLineCap('round')
      ctx.stroke()
    }
  }

  ctx.draw()
}

function ReadingRing({ weekDaily, totalReadDays, dayGoalMinutes }) {
  const todayMinutes = getTodayMinutes(weekDaily)

  useEffect(() => {
    const paint = () => paintRing('wr-ring', todayMinutes, dayGoalMinutes)
    Taro.nextTick(paint)
    const t = setTimeout(paint, 300)
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
          <Canvas canvas-id='wr-ring' className='rring-canvas' />
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
