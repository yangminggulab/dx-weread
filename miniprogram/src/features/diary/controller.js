const api = require('../../api/index')
const { diaryArchiveMetadata, reconcileDiaryToday, diarySyncOperation } = require('../../utils/diary-sync.mjs')
const model = require('./model.mjs')
const storage = require('./storage')
const { readCache } = require('../../utils/cache')
const { createRequestQueue } = require('../../utils/request-queue.mjs')
const { registerDiarySaver } = require('./save-coordinator')

// Controller keeps archives in memory. Page.setData receives only visible entries.
class DiaryController {
  constructor(render) {
    this.render = render
    this.alive = true
    this.diary = storage.readCachedDiary() || model.createEmptyDiary()
    this.owner = `${Date.now()}-${Math.random()}`
    this.dirty = Boolean(readCache(model.DIARY_DRAFT_KEY))
    const restored = readCache(model.DIARY_DRAFT_KEY)
    this.syncVersion = restored?.syncVersion || this.diary.syncVersion
    this.baseContent = restored ? restored.baseContent ?? null : this.diary.today.content
    this.baseUpdatedAt = restored ? restored.baseUpdatedAt || '' : this.diary.today.updatedAt || ''
    this.operation = restored?.operation || null
    this.editVersion = 0
    this.confirmedEditVersion = -1
    this.mutation = 0
    this.pending = new Set()
    this.saveQueue = createRequestQueue()
    this.saveRequests = new Map()
    this.conflict = null
    this.loading = false
    this.archiveLoaded = false
    this.archiveDirty = false
    this.randomDate = ''
    this.readerDate = ''
    this.history = []
    this.timer = null
    this.saveStatus = this.dirty ? 'draft' : 'loading'
    this.refreshFailed = false
    if (this.dirty && !this.persistDraft(this.diary)) this.saveStatus = 'storage-error'
    this.unregisterSaver = registerDiarySaver(this.owner, () => this.flush())
    this.publish()
  }
  publish() {
    if (!this.alive) return
    const preview = this.diary.archive.find(entry => entry.date === this.randomDate) || null
    const reader = this.diary.archive.find(entry => entry.date === this.readerDate) || null
    const isHistoryToday = Boolean(preview && preview.date.slice(5) === model.getTodayStr().slice(5))
    this.render({
      today: this.diary.today, saveStatus: this.saveStatus,
      saving: this.pending.size > 0, conflict: this.conflict, automatic: this.syncVersion === 1,
      refreshFailed: this.refreshFailed, preview, reader,
      archiveCount: this.diary.archive.length, canGoBack: this.history.length > 0,
      historyLabel: preview ? (isHistoryToday ? `历史上的今天 · ${preview.date.slice(0, 4)}` : `往期日记 · ${preview.date}`) : '往期日记',
      isHistoryToday
    })
  }
  persistDraft(diary, onlyIfOwned = false) {
    return storage.persistDiaryDraft(diary, this.owner, onlyIfOwned, { syncVersion: this.syncVersion,
      baseContent: this.baseContent, baseUpdatedAt: this.baseUpdatedAt, operation: this.operation })
  }
  apply(value) {
    this.diary = model.normalizeDiaryPayload(value)
    // A disposed instance cannot replace a newer page's cache while its save settles.
    const draft = readCache(model.DIARY_DRAFT_KEY)
    if (this.alive || !draft || draft.owner === this.owner) storage.persistDiaryCache({ ...this.diary, syncVersion: this.syncVersion })
    this.publish()
    return this.diary
  }
  edit(content) {
    if (!this.dirty) {
      this.baseContent = this.diary.today.content
      this.baseUpdatedAt = this.diary.today.updatedAt || ''
    }
    this.editVersion += 1
    this.mutation += 1
    this.dirty = true
    this.diary.today = { ...this.diary.today, content }
    const stored = this.persistDraft(this.diary)
    this.saveStatus = stored ? (this.conflict ? 'conflict' : 'draft') : 'storage-error'
    this.publish()
    this.scheduleSave()
  }
  scheduleSave() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.save(), 1500)
  }
  save(overwriteConflict = false) {
    if (!this.dirty) return Promise.resolve()
    const version = this.editVersion
    if (this.saveRequests.has(version)) return this.saveRequests.get(version)
    const work = this.saveQueue.enqueue(async () => {
      // Resolve an immutable operation left by a lost receipt before constructing
      // a write for later keystrokes. Both phases retain the latest local text.
      const replaying = this.operation && this.operation.content !== this.diary.today.content
      await this.savePending(overwriteConflict)
      if (replaying && this.dirty && !this.operation && !this.conflict && !['error', 'storage-error'].includes(this.saveStatus)) {
        await this.savePending(overwriteConflict)
      }
    })
    this.saveRequests.set(version, work)
    return work.finally(() => { this.saveRequests.delete(version) })
  }
  async savePending(overwriteConflict = false) {
    if (!this.dirty) return
    const snapshot = model.normalizeDiaryPayload(this.diary)
    const version = this.editVersion
    // Flush/hide/unload may all arrive for one edit. Coalesce before touching storage.
    if (this.pending.has(version)) return
    const operation = this.syncVersion === 1 ? this.operation || diarySyncOperation({ ...snapshot.today,
      baseContent: this.baseContent, baseUpdatedAt: this.baseUpdatedAt }, null, 'miniprogram') : null
    if (operation) snapshot.today = { ...snapshot.today, date: operation.date, content: operation.content }
    if (operation) this.operation = operation
    // Persist the current draft plus the submitted operation, never replace newer
    // input with a queued or replayed snapshot.
    const stored = this.persistDraft(this.diary, !this.alive)
    // An operation must survive a crash before it is sent.
    if (operation && !stored) {
      this.saveStatus = 'storage-error'; this.publish()
      clearTimeout(this.timer)
      if (this.alive) this.timer = setTimeout(() => this.save(), 30000)
      return
    }
    if (this.conflict && !overwriteConflict && !operation) {
      this.saveStatus = stored ? 'conflict' : 'storage-error'; this.publish(); return
    }
    this.pending.add(version)
    this.saveStatus = 'saving'; this.publish()
    try {
      const result = operation ? await api.syncDiaryEntry(operation) : await api.saveDiary({ today: snapshot.today, overwriteConflict })
      const receipt = operation ? { today: result.entry } : result
      let confirmed = receipt.today
      if (operation) {
        try {
          const latest = model.normalizeDiaryPayload(await api.getDiary())
          confirmed = latest.today.date === snapshot.today.date ? latest.today : latest.archive.find(entry => entry.date === snapshot.today.date) || confirmed
        } catch {
          if ((this.diary.today.updatedAt || '') > (confirmed.updatedAt || '')) confirmed = this.diary.today
        }
      }
      if (!receipt || !receipt.today) throw new Error('Missing diary receipt')
      if (version < this.confirmedEditVersion) return
      this.confirmedEditVersion = version
      if (this.diary.today.date === snapshot.today.date) {
        const unchanged = version === this.editVersion && snapshot.today.content === this.diary.today.content
        const today = unchanged ? confirmed : { ...this.diary.today, updatedAt: receipt.today.updatedAt }
        this.baseContent = snapshot.today.content
        this.baseUpdatedAt = receipt.today.updatedAt || ''
        if (this.operation?.operationId === operation?.operationId) this.operation = null
        this.mutation += 1
        this.diary = model.normalizeDiaryPayload({ ...this.diary, today })
        if (unchanged) {
          this.dirty = false
          storage.clearDiaryDraft(this.owner)
          this.saveStatus = 'saved'
        } else {
          this.saveStatus = this.persistDraft(this.diary, true) ? 'draft' : 'storage-error'
        }
        this.apply(this.diary)
      }
      this.conflict = null
    } catch (error) {
      if (version < this.confirmedEditVersion) return
      if (!operation && error.statusCode === 409 && error.today) {
        this.conflict = error.today
        this.saveStatus = stored ? 'conflict' : 'storage-error'
      } else this.saveStatus = stored ? 'error' : 'storage-error'
    } finally {
      this.pending.delete(version)
      if (this.alive && this.dirty && !this.conflict) {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.save(), ['error', 'storage-error'].includes(this.saveStatus) ? 30000 : 1500)
      }
      this.publish()
    }
  }
  useCloud() {
    if (!this.conflict || this.pending.size) return
    clearTimeout(this.timer)
    const today = this.conflict
    this.conflict = null; this.dirty = false
    this.editVersion += 1; this.mutation += 1
    storage.clearDiaryDraft(this.owner)
    this.saveStatus = 'saved'
    this.apply({ ...this.diary, today })
  }
  async refresh() {
    if (this.loading || !this.alive) return false
    this.loading = true
    const mutation = this.mutation
    try {
      await api.waitForDiarySaves()
      // Returning from a failed version restoration can leave a newer recovery
      // draft owned by that page. Adopt it before reading the cloud head.
      const recovered = readCache(model.DIARY_DRAFT_KEY)
      if (!this.dirty && recovered?.owner !== this.owner && recovered?.today) {
        this.diary.today = recovered.today
        this.baseContent = recovered.baseContent ?? null
        this.baseUpdatedAt = recovered.baseUpdatedAt || ''
        this.operation = recovered.operation || null
        this.dirty = true
        this.editVersion++; this.mutation++; this.saveStatus = 'draft'
        this.persistDraft(this.diary)
      }
      const raw = await api.getDiary()
      const remote = model.normalizeDiaryPayload(raw)
      this.syncVersion = raw.syncVersion
      if (!this.alive) return false
      if (!remote.today.date) remote.today.date = model.getTodayStr()
      const local = model.normalizeDiaryPayload(this.diary)
      local.today.updatedAt = api.diarySaveBaseline(local.today.date, local.today.updatedAt)
      const unchanged = this.mutation === mutation
      if (this.dirty && unchanged && local.today.date === remote.today.date &&
          (local.today.updatedAt || '') === (remote.today.updatedAt || '') &&
          local.today.content === remote.today.content &&
          JSON.stringify(local.today.tagScores) === JSON.stringify(remote.today.tagScores)) {
        this.dirty = false; storage.clearDiaryDraft(this.owner)
      }
      const result = this.syncVersion === 1
        ? { today: this.dirty || !unchanged ? local.today : remote.today, conflict: null }
        : reconcileDiaryToday(local.today, remote.today, { dirty: this.dirty, changedDuringRequest: !unchanged })
      if (this.syncVersion === 1) this.conflict = null
      if (result.conflict) { this.conflict = result.conflict; this.saveStatus = 'conflict' }
      remote.today = result.today
      remote.archive = model.mergeDiaryArchiveViewMeta(remote.archive, local.archive)
      if (this.dirty) this.persistDraft(remote, true)
      else if (unchanged) { this.saveStatus = 'saved'; this.conflict = null; this.operation = null; this.baseContent = remote.today.content; this.baseUpdatedAt = remote.today.updatedAt || '' }
      this.refreshFailed = false
      this.archiveLoaded = true
      if (!remote.archive.some(entry => entry.date === this.readerDate)) this.readerDate = ''
      this.history = this.history.filter(date => remote.archive.some(entry => entry.date === date))
      const initialize = !remote.archive.some(entry => entry.date === this.randomDate)
      this.apply(remote)
      if (initialize) this.recall()
      if (this.archiveDirty) this.syncViews()
      if (this.dirty && !this.conflict && (unchanged || this.syncVersion === 1)) this.scheduleSave()
      return true
    } catch {
      this.refreshFailed = true; this.publish(); return false
    } finally { this.loading = false }
  }
  recall() {
    const index = model.pickPreferredArchiveIdx(this.diary.archive, storage.readViewMeta())
    this.randomDate = index == null ? '' : this.diary.archive[index].date
    if (index != null) this.recordView(index)
    else this.publish()
  }
  recordView(index) {
    this.archiveDirty = true
    const stamped = model.stampArchiveEntryViewed(this.diary, index)
    storage.persistViewMeta(stamped.archive)
    this.apply(stamped)
  }
  async syncViews() {
    if (!this.archiveLoaded || !this.archiveDirty) return
    this.archiveDirty = false
    try { await api.saveDiary({ archive: diaryArchiveMetadata(this.diary.archive) }) }
    catch { this.archiveDirty = true }
  }
  openReader() { this.readerDate = this.randomDate; this.history = []; this.publish() }
  closeReader() { this.readerDate = ''; this.publish() }
  next() {
    const candidates = this.diary.archive.filter(entry => entry.date !== this.readerDate)
    if (!candidates.length) return
    this.history.push(this.readerDate)
    this.readerDate = candidates[Math.floor(Math.random() * candidates.length)].date
    this.recordView(this.diary.archive.findIndex(entry => entry.date === this.readerDate))
    this.syncViews()
  }
  back() {
    if (!this.history.length) return
    this.readerDate = this.history.pop()
    this.recordView(this.diary.archive.findIndex(entry => entry.date === this.readerDate))
    this.syncViews()
  }
  flush() {
    clearTimeout(this.timer); this.timer = null
    if (this.alive) storage.persistDiaryCache({ ...this.diary, syncVersion: this.syncVersion })
    const saving = this.save()
    this.syncViews()
    return saving
  }
  dispose() {
    const saving = this.flush()
    this.alive = false
    saving.finally(() => this.unregisterSaver()).catch(() => {})
  }
}
module.exports = { DiaryController }
