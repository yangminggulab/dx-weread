
const {
  normalizeDiaryPayload,
  DIARY_DRAFT_KEY,
  DIARY_CACHE_KEY,
  LEGACY_DIARY_CACHE_KEYS,
  DIARY_VIEW_META_KEY,
} = require('./model.mjs')

function readCachedDiary() {
  for (const key of [
    DIARY_DRAFT_KEY,
    DIARY_CACHE_KEY,
    ...LEGACY_DIARY_CACHE_KEYS,
  ]) {
    try {
      const cached = wx.getStorageSync(key)
      if (cached) return { ...normalizeDiaryPayload(cached), syncVersion: cached.syncVersion }
    } catch {}
  }
  return null
}

function persistDiaryCache(diary) {
  try {
    // 只缓存当天日记，归档从服务端拉取，避免 storage 超限闪退
    const safe = diary && typeof diary === 'object' ? diary : {}
    wx.setStorageSync(DIARY_CACHE_KEY, {
      today: safe.today || {},
      archive: [],
      syncVersion: safe.syncVersion,
    })
    for (const key of LEGACY_DIARY_CACHE_KEYS) {
      wx.removeStorageSync(key)
    }
  } catch {}
}

// view meta 单独存一份 { date: lastViewedAt }，避免 persistDiaryCache 把 archive 存成 [] 导致时间戳丢失
// _viewMetaCache 是内存镜像，避免每次 pickPreferredArchiveIdx 都走同步 storage 读（官方明确禁止高频 getStorageSync）
let _viewMetaCache = null
function readViewMeta() {
  if (_viewMetaCache !== null) return _viewMetaCache
  try {
    _viewMetaCache = wx.getStorageSync(DIARY_VIEW_META_KEY) || {}
  } catch {
    _viewMetaCache = {}
  }
  return _viewMetaCache
}
function persistViewMeta(archive) {
  try {
    const existing = readViewMeta()
    const updated = { ...existing }
    ;(archive || []).forEach((e) => {
      if (
        e?.date &&
        e?.lastViewedAt &&
        (!updated[e.date] || e.lastViewedAt > updated[e.date])
      ) {
        updated[e.date] = e.lastViewedAt
      }
    })
    _viewMetaCache = updated // 先更新内存镜像
    wx.setStorageSync(DIARY_VIEW_META_KEY, updated)
  } catch {}
}

function persistDiaryDraft(diary, owner, onlyIfOwned = false, sync = {}) {
  try {
    if (onlyIfOwned && wx.getStorageSync(DIARY_DRAFT_KEY)?.owner !== owner)
      return false
    wx.setStorageSync(DIARY_DRAFT_KEY, {
      today: diary.today,
      archive: [],
      owner,
      ...sync,
    })
    return true
  } catch {
    return false
  }
}

function clearDiaryDraft(owner) {
  try {
    if (wx.getStorageSync(DIARY_DRAFT_KEY)?.owner !== owner) return false
    wx.removeStorageSync(DIARY_DRAFT_KEY)
    return true
  } catch {
    return false
  }
}

module.exports = {
  readCachedDiary,
  persistDiaryCache,
  readViewMeta,
  persistViewMeta,
  persistDiaryDraft,
  clearDiaryDraft,
}
