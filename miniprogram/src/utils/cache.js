function readCache(key, fallback = null) {
  try { return wx.getStorageSync(key) || fallback } catch { return fallback }
}
function writeCache(key, value) {
  try { wx.setStorageSync(key, value); return true } catch { return false }
}
module.exports = { readCache, writeCache }
