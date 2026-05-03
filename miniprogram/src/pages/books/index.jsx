import { useState, useEffect, useCallback, useRef } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, ScrollView } from '@tarojs/components'
import { getData } from '../../api/index'
import './index.scss'

const BOOKS_CACHE_KEY = 'books_cache_v1'

const TABS = [
  { key: 'reading',  label: '在读' },
  { key: 'want',     label: '想读' },
  { key: 'finished', label: '读完' },
]

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
  const touchRef = useRef({ x: 0, y: 0, time: 0 })

  const loadData = useCallback(async () => {
    try {
      const data = await getData()
      const fetched = (data.books || []).filter(b => b.source === 'weread')
      setBooks(fetched)
      try { Taro.setStorageSync(BOOKS_CACHE_KEY, { books: fetched }) } catch {}
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'error' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

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
                <View className='book-cover' style={{ background: book.accent || '#2d6a4f' }}>
                  <Text className='book-cover-title'>{book.title.slice(0, 4)}</Text>
                </View>
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
      </ScrollView>
    </View>
  )
}
