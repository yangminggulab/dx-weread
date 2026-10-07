// Fixed sheets own keyboard avoidance; their native fields must not also push the page.
function windowInfo() {
  try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync() } catch { return {} }
}
function keyboardGeometry(base, current, keyboardHeight, contentHeight) {
  const baseline = Number(base.windowHeight) || Number(current.windowHeight) || 600
  const height = Math.max(0, Number(keyboardHeight) || 0)
  const visible = Number(current.windowHeight) || baseline
  // screenTop and windowHeight locate this viewport on the physical screen,
  // so tab bars and windows already resized by the keyboard are counted once.
  const belowWindow = Number.isFinite(current.screenTop) && Number.isFinite(current.screenHeight)
    ? Math.max(0, current.screenHeight - current.screenTop - visible)
    : Math.max(0, baseline - visible)
  const bottom = Math.max(0, height - belowWindow)
  const available = Math.max(1, visible - bottom)
  return { sheetBottom: bottom, sheetHeight: Math.ceil(Math.min(contentHeight || available * 0.9, available * 0.9)) }
}
function createKeyboardSheet(page) {
  let active = false, generation = 0, baseline = {}, height = 0, contentHeight = 0, listener = null, resizeListener = null
  function publish() {
    if (!active || page._disposed) return
    const next = keyboardGeometry(baseline, windowInfo(), height, contentHeight)
    const patch = {}
    for (const key of Object.keys(next)) if (page.data[key] !== next[key]) patch[key] = next[key]
    if (Object.keys(patch).length) page.setData(patch)
  }
  function keyboardChanged(event) {
    if (!active || page._disposed || !Number.isFinite(event.height) || event.height < 0) return
    if (height === event.height) return
    height = event.height; publish()
  }
  function resized() {
    if (!active || page._disposed) return
    if (height === 0) baseline = windowInfo()
    publish()
  }
  function close() {
    active = false; generation++
    if (listener && wx.offKeyboardHeightChange) wx.offKeyboardHeightChange(listener)
    if (resizeListener && wx.offWindowResize) wx.offWindowResize(resizeListener)
    listener = null; resizeListener = null
  }
  return {
    open() {
      if (page._disposed) return
      close(); active = true; baseline = windowInfo(); height = 0; contentHeight = 0
      const own = generation
      page.setData({ sheetBottom: 0, sheetField: '', sheetHeight: keyboardGeometry(baseline, baseline, 0, 0).sheetHeight })
      if (wx.onKeyboardHeightChange && wx.offKeyboardHeightChange) {
        listener = event => { if (own === generation) keyboardChanged(event) }
        wx.onKeyboardHeightChange(listener)
      }
      if (wx.onWindowResize && wx.offWindowResize) {
        resizeListener = () => { if (own === generation) resized() }
        wx.onWindowResize(resizeListener)
      }
      const measure = () => {
        if (!active || own !== generation || page._disposed) return
        wx.createSelectorQuery().select('.modal-content').boundingClientRect(rect => {
          if (!active || own !== generation || page._disposed || !rect || !(rect.height > 0)) return
          contentHeight = rect.height; publish()
        }).exec()
      }
      if (wx.nextTick) wx.nextTick(measure); else measure()
    },
    focus(event) {
      if (!active || page._disposed) return
      const field = event.currentTarget.dataset.field
      if (!['title', 'summary', 'tags'].includes(field)) return
      const target = `sheet-${field}`
      if (page.data.sheetField !== target) page.setData({ sheetField: target })
      keyboardChanged(event.detail || {})
    },
    keyboardChanged,
    close,
    dispose: close
  }
}
module.exports = { createKeyboardSheet, keyboardGeometry }
