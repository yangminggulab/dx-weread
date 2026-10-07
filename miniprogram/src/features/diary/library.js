const api = require('../../api/index')
const model = require('./model.mjs')
const storage = require('./storage')
const { diaryArchiveMetadata } = require('../../utils/diary-sync.mjs')
const { diaryEntries } = require('./presentation.mjs')
let remembered = null
function rememberDiary(diary) { remembered = model.normalizeDiaryPayload(diary) }

// History/reader never acquire the editor's draft owner or submit a diary body.
class DiaryLibrary {
  constructor(changed) {
    this.diary = model.normalizeDiaryPayload(remembered || storage.readCachedDiary() || model.createEmptyDiary())
    this.changed = changed
    this.loading = false
    this.failed = false
    this.alive = true
  }
  get entries() { return diaryEntries(this.diary) }
  async refresh() {
    if (!this.alive || this.loading) return false
    this.loading = true
    try {
      await api.waitForDiarySaves()
      const remote = model.normalizeDiaryPayload(await api.getDiary())
      if (!this.alive) return false
      remote.archive = model.mergeDiaryArchiveViewMeta(remote.archive, this.diary.archive)
      this.diary = remote; rememberDiary(remote); this.failed = false
      this.changed(); return true
    } catch {
      if (this.alive) { this.failed = true; this.changed() }
      return false
    } finally { this.loading = false }
  }
  async viewed(date) {
    const index = this.diary.archive.findIndex(entry => entry.date === date)
    if (index < 0) return
    this.diary = model.stampArchiveEntryViewed(this.diary, index)
    storage.persistViewMeta(this.diary.archive)
    rememberDiary(this.diary)
    // Reuse the original queued metadata-only writer; no cached body is sent.
    try { await api.saveDiary({ archive: diaryArchiveMetadata(this.diary.archive) }) } catch {}
  }
  dispose() { this.alive = false }
}
module.exports = { DiaryLibrary, rememberDiary }
