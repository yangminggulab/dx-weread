// Keep setData small: the diary's complete archive never enters page data.
function updateView(page, view) {
  if (page._disposed) return
  const patch = {}
  Object.keys(view).forEach(key => {
    if (JSON.stringify(page.data[key]) === JSON.stringify(view[key])) return
    if (key === 'today' && page.data.today) {
      Object.keys(view.today).forEach(field => {
        if (JSON.stringify(page.data.today[field]) !== JSON.stringify(view.today[field])) patch[`today.${field}`] = view.today[field]
      })
    } else patch[key] = view[key]
  })
  if (Object.keys(patch).length) page.setData(patch)
}
module.exports = { updateView }
