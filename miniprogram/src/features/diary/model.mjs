function createEmptyDiary() {
  return { today: { date: getTodayStr(), content: '' }, archive: [] }
}
const DIARY_VIEW_WINDOW_DAYS = 30

const DIARY_CACHE_KEY = 'diary_cache_v2'
const DIARY_DRAFT_KEY = 'diary_draft_v1'
const LEGACY_DIARY_CACHE_KEYS = ['diary_cache_v1']
const DIARY_VIEW_META_KEY = 'diary_view_meta_v1' // 轻量 view meta，单独持久化，不随 archive 一起被清空
const DIARY_TAGS = [
  '学习卡壳',
  '复习考试',
  '焦虑内耗',
  '灾难化',
  '失眠亢奋',
  '安静恢复',
  '计划执行',
  '决策止损',
  '求职面试',
  '人际边界',
]

// Same day boundary as the Worker and Mac: 05:00 in Asia/Shanghai.
function getTodayStr(now = new Date()) {
  const shifted = new Date(now.getTime() + 3 * 60 * 60 * 1000)
  return `${shifted.getUTCFullYear()}-${String(
    shifted.getUTCMonth() + 1
  ).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
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
  tags.forEach((item) => {
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
    DIARY_TAGS.forEach((tag) => {
      const score = coerceDiaryTagScore(scores[tag])
      if (score > 0) normalized[tag] = score
    })
  }
  normalizeDiaryTags(tags).forEach((tag) => {
    if (!normalized[tag]) normalized[tag] = 1
  })
  return DIARY_TAGS.reduce((acc, tag) => {
    if (normalized[tag] > 0) acc[tag] = normalized[tag]
    return acc
  }, {})
}

function withNormalizedDiaryTags(entry) {
  const tagScores = normalizeDiaryTagScores(entry && entry.tagScores, entry && entry.tags)
  return {
    ...entry,
    tags: DIARY_TAGS.filter((tag) => tagScores[tag] > 0),
    tagScores,
  }
}

function normalizeDiaryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const date = String(entry.date || '').trim()
  if (!date) return null
  return withNormalizedDiaryTags({
    ...entry,
    date,
    content: String(entry.content == null ? '' : entry.content),
    viewCount: coerceDiaryViewCount(entry.viewCount),
    lastViewedAt: String(entry.lastViewedAt || '').trim(),
  })
}

function mergeDiaryEntryViewMeta(baseEntry, overlayEntry) {
  const normalizedBase = normalizeDiaryEntry(baseEntry)
  const normalizedOverlay = normalizeDiaryEntry(overlayEntry)
  if (!normalizedBase || !normalizedOverlay)
    return normalizedBase || normalizedOverlay
  return {
    ...normalizedBase,
    viewCount: Math.max(
      normalizedBase.viewCount || 0,
      normalizedOverlay.viewCount || 0
    ),
    lastViewedAt:
      [normalizedBase.lastViewedAt || '', normalizedOverlay.lastViewedAt || '']
        .sort()
        .slice(-1)[0] || '',
  }
}

function mergeDiaryArchiveViewMeta(baseArchive = [], overlayArchive = []) {
  const overlayMap = new Map(
    overlayArchive
      .map(normalizeDiaryEntry)
      .filter(Boolean)
      .map((entry) => [entry.date, entry])
  )

  return baseArchive
    .map(normalizeDiaryEntry)
    .filter(Boolean)
    .map((entry) => mergeDiaryEntryViewMeta(entry, overlayMap.get(entry.date)))
}

function normalizeDiaryPayload(payload) {
  const diary = payload && typeof payload === 'object' ? payload : {}
  const today =
    diary.today && typeof diary.today === 'object' ? diary.today : {}

  return {
    today: withNormalizedDiaryTags({
      ...today,
      date: String(today.date || '').trim(),
      content: String(today.content == null ? '' : today.content),
    }),
    archive: Array.isArray(diary.archive)
      ? diary.archive.map(normalizeDiaryEntry).filter(Boolean)
      : [],
  }
}

function wasViewedRecently(entry, days = DIARY_VIEW_WINDOW_DAYS) {
  const lastViewedAt = String((entry && entry.lastViewedAt) || '').trim()
  if (!lastViewedAt) return false
  const viewedAt = new Date(lastViewedAt).getTime()
  if (Number.isNaN(viewedAt)) return false
  return Date.now() - viewedAt < days * 24 * 60 * 60 * 1000
}

// 从最近一个月没看过的条目里随机选；全都看过时从全部里选
// 不再强制"历史上的今天"永远赢（会导致每天都刷出同一条）
function pickPreferredArchiveIdx(archive, viewMeta = {}) {
  if (!archive || !archive.length) return null
  // 用本地持久化的 view meta 补充服务端可能丢失的 lastViewedAt
  const enriched = archive.map((e) => {
    const stored = viewMeta[e && e.date]
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

function stampArchiveEntryViewed(
  diary,
  idx,
  viewedAt = new Date().toISOString()
) {
  const normalized = normalizeDiaryPayload(diary)
  const current = normalized.archive[idx]
  if (!current) return normalized

  const nextArchive = normalized.archive.slice()
  nextArchive[idx] = {
    ...current,
    viewCount: coerceDiaryViewCount(current.viewCount) + 1,
    lastViewedAt: viewedAt,
  }

  return {
    ...normalized,
    archive: nextArchive,
  }
}

export {
  createEmptyDiary,
  DIARY_DRAFT_KEY,
  DIARY_CACHE_KEY,
  LEGACY_DIARY_CACHE_KEYS,
  DIARY_VIEW_META_KEY,
  DIARY_TAGS,
  getTodayStr,
  normalizeDiaryPayload,
  mergeDiaryArchiveViewMeta,
  pickPreferredArchiveIdx,
  stampArchiveEntryViewed,
}
