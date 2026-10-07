import { createRequestQueue } from '../../core/request-queue.mjs';
import { diaryDayKey, entryVersion, normalizeEntry, findDiaryEntry, acceptDiaryEntry } from './model.mjs';
import { diarySyncOperation, validDiarySyncReceipt } from '../../../../miniprogram/src/utils/diary-sync.mjs';

export class DiaryController {
  constructor({ request, drafts, cache, schedule = setTimeout, cancel = clearTimeout, now = () => new Date() }) {
    this.request = request; this.repository = drafts; this.cache = cache;
    this.schedule = (...args) => schedule(...args); this.cancel = id => cancel(id); this.now = now;
    this.listeners = new Set(); this.queue = createRequestQueue(); this.pending = new Map(); this.receipts = new Map();
    this.drafts = drafts.read(); this.conflicts = {}; this.validated = new Set();
    this.diary = cache?.read() || { today: { date: '', content: '' }, archive: [] };
    this.diary.archive ||= []; this.selectedDate = null; this.timer = null; this.refreshing = null;
    this.automatic = this.diary.syncVersion === 1; this.retryTimers = new Map();
    this.versions = []; this.versionsOpen = false; this.versionsLoading = false; this.versionsCursor = null; this.versionsGeneration = 0;
    this.error = ''; this.storageError = ''; this.loading = true; this.disposed = false;
    this.state = this.view();
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.state;
  date() { return this.selectedDate || this.diary.today.date || diaryDayKey(this.now()); }
  view() {
    const date = this.date(), draft = this.drafts[date];
    return { entry: draft?.entry || findDiaryEntry(this.diary, date) || null,
      selectedDate: this.selectedDate, dirty: Boolean(draft), saving: this.pending.size > 0,
      loading: this.loading, error: this.error, storageError: this.storageError,
      conflict: this.conflicts[date] || null, drafts: Object.keys(this.drafts),
      history: this.diary.archive, restored: Boolean(draft && !this.validated.has(date)), automatic: this.automatic,
      versions: this.versions, versionsOpen: this.versionsOpen, versionsLoading: this.versionsLoading, versionsCursor: this.versionsCursor };
  }
  publish() { this.state = this.view(); if (!this.disposed) this.listeners.forEach(fn => fn()); }
  storage(operation) {
    try { operation(); this.storageError = ''; }
    catch { this.storageError = '本机草稿未能保存，请保持页面打开并重试。'; }
  }
  edit(content) {
    const date = this.date(), entry = this.view().entry;
    if (!entry || this.loading && !this.drafts[date]) return;
    const original = this.drafts[date] || { baseContent: entry.content, baseUpdatedAt: entryVersion(entry) };
    const draft = { ...original, entry: { ...entry, content }, editID: `${Date.now()}-${Math.random()}` };
    this.drafts[date] = draft;
    this.storage(() => this.repository.put(date, draft));
    this.error = ''; this.publish(); this.scheduleSave();
  }
  scheduleSave() {
    this.cancel(this.timer);
    this.timer = this.schedule(() => { this.timer = null; this.save(); }, 1500);
  }
  baselineKey(date, content, version) { return JSON.stringify([date, content, version]); }
  advanceBaseline(draft) {
    const advanced = { ...draft }, visited = new Set();
    let key = this.baselineKey(draft.entry.date, advanced.baseContent, advanced.baseUpdatedAt);
    while (this.receipts.has(key) && !visited.has(key)) {
      visited.add(key);
      const receipt = this.receipts.get(key);
      advanced.baseContent = receipt.content; advanced.baseUpdatedAt = entryVersion(receipt);
      key = this.baselineKey(draft.entry.date, advanced.baseContent, advanced.baseUpdatedAt);
    }
    return advanced;
  }
  save(date = this.date(), { keepalive = false } = {}) {
    this.cancel(this.timer); this.timer = null;
    const draft = this.drafts[date];
    if (!draft || this.conflicts[date] && !this.automatic || !this.validated.has(date)) return Promise.resolve(false);
    this.cancel(this.retryTimers.get(date)); this.retryTimers.delete(date);
    if (this.pending.has(draft.editID)) return this.pending.get(draft.editID);
    const captured = structuredClone(draft);
    const work = this.queue.enqueue(async () => {
      // An earlier queued save may have discovered an intervening cloud edit.
      if (this.conflicts[date] && !this.automatic) return false;
      // A queued automatic write superseded before it started need not upload
      // stale text. The latest draft is already persisted and will be saved next.
      if (this.automatic && this.drafts[date]?.editID !== captured.editID) return false;
      const submitted = this.advanceBaseline(captured);
      try {
        const operation = this.automatic ? diarySyncOperation({ date, content: submitted.entry.content,
          baseContent: submitted.baseContent, baseUpdatedAt: submitted.baseUpdatedAt }, captured.operation, 'web') : null;
        if (operation) {
          this.repository.prepare(captured, operation);
          if (this.drafts[date]?.editID === captured.editID) this.drafts[date].operation = operation;
        }
        const payload = JSON.stringify(operation || { date, content: submitted.entry.content,
          expectedContent: submitted.baseContent, expectedUpdatedAt: submitted.baseUpdatedAt });
        const result = await this.request(operation ? '/api/diary/sync' : '/api/diary/entry', { method: 'POST', body: payload,
          ...(keepalive && new TextEncoder().encode(payload).length < 60000 ? { keepalive: true } : {}) });
        if (operation ? !validDiarySyncReceipt(result, operation) : !result.ok || result.entry?.date !== date || result.entry.content !== submitted.entry.content) throw new Error('云端没有确认这次保存');
        const receipt = normalizeEntry(result.entry);
        this.receipts.set(this.baselineKey(date, submitted.baseContent, submitted.baseUpdatedAt), { ...receipt, content: submitted.entry.content });
        if (operation) {
          try {
            const latest = await this.request('/api/diary');
            if (!latest.today?.date || !Array.isArray(latest.archive)) throw new Error('Invalid diary');
            this.diary = { today: normalizeEntry(latest.today), archive: latest.archive.map(normalizeEntry) };
          } catch {
            const known = findDiaryEntry(this.diary, date);
            if (!known || entryVersion(known) <= entryVersion(receipt)) this.diary = acceptDiaryEntry(this.diary, receipt);
          }
        } else this.diary = acceptDiaryEntry(this.diary, receipt);
        const current = this.drafts[date];
        if (current?.editID === captured.editID) delete this.drafts[date];
        else if (current) this.drafts[date] = { ...current, baseContent: submitted.entry.content, baseUpdatedAt: entryVersion(receipt) };
        this.storage(() => this.repository.acknowledge(submitted, receipt));
        this.error = ''; delete this.conflicts[date]; this.persistCache();
        return true;
      } catch (error) {
        if (error.status === 409 && error.data?.entry) this.conflicts[date] = normalizeEntry(error.data.entry);
        this.error = error.status === 409 ? '其他端已更新这一天的日记，草稿已保留。'
          : error.status === 404 ? '暂时无法按日期保存，草稿已保留，请确认服务已更新。'
          : '保存失败，草稿已保留，请检查网络后重试。';
        return false;
      }
    });
    this.pending.set(captured.editID, work); this.publish();
    return work.finally(() => {
      this.pending.delete(captured.editID);
      if (!this.disposed && this.drafts[date] && !this.conflicts[date]) {
        this.cancel(this.retryTimers.get(date));
        this.retryTimers.set(date, this.schedule(() => { this.retryTimers.delete(date); this.save(date); }, this.error ? 30000 : 1500));
      }
      this.publish();
    });
  }
  persistCache() {
    // Keep only today's confirmed entry. Full history can exceed browser quota.
    try { this.cache?.write({ today: this.diary.today, archive: [], syncVersion: this.automatic ? 1 : undefined }); } catch {}
  }
  refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.queue.enqueue(async () => {
      try {
        const value = await this.request('/api/diary');
        if (!value.today?.date || !Array.isArray(value.archive)) throw new Error('日记数据不完整');
        const remote = { today: normalizeEntry(value.today), archive: value.archive.map(normalizeEntry) };
        this.automatic = value.syncVersion === 1;
        this.diary = remote;
        for (const [date, draft] of Object.entries(this.drafts)) {
          const entry = findDiaryEntry(remote, date);
          this.validated.add(date);
          if (entry && draft.entry.content === entry.content) {
            delete this.drafts[date]; delete this.conflicts[date];
            this.storage(() => this.repository.remove(date, draft.editID));
          } else if (!this.automatic && (!entry || draft.baseContent !== entry.content || draft.baseUpdatedAt !== entryVersion(entry))) {
            this.conflicts[date] = entry || { date, content: '', unavailable: true };
          } else delete this.conflicts[date];
        }
        this.validated.add(remote.today.date);
        this.error = ''; this.persistCache();
        if (this.drafts[this.date()] && !this.conflicts[this.date()]) this.scheduleSave();
        return true;
      } catch { this.error = '日记刷新失败，当前内容已保留，请重试。'; return false; }
      finally { this.loading = false; this.refreshing = null; this.publish(); }
    });
    return this.refreshing;
  }
  select(date = null) {
    this.save(); this.selectedDate = date;
    this.versionsGeneration++; this.versionsOpen = false; this.versions = []; this.versionsLoading = false;
    if (findDiaryEntry(this.diary, this.date())) this.validated.add(this.date());
    this.publish();
  }
  useCloud() {
    const date = this.date(), remote = this.conflicts[date];
    if (!remote || remote.unavailable || this.pending.size) return;
    this.cancel(this.timer); delete this.drafts[date]; delete this.conflicts[date];
    this.storage(() => this.repository.remove(date));
    this.diary = acceptDiaryEntry(this.diary, remote); this.error = ''; this.publish();
  }
  keepDraft() {
    const date = this.date(), remote = this.conflicts[date], draft = this.drafts[date];
    if (!draft || !remote || remote.unavailable || this.pending.size) return Promise.resolve(false);
    this.drafts[date] = { ...draft, baseContent: remote.content, baseUpdatedAt: entryVersion(remote) };
    this.storage(() => this.repository.put(date, this.drafts[date]));
    delete this.conflicts[date]; this.validated.add(date); this.publish();
    // Still uses atomic body/version comparison; no unconditional overwrite.
    return this.save(date);
  }
  flush() {
    this.cancel(this.timer); this.timer = null;
    return Promise.all(Object.keys(this.drafts).map(date => this.save(date, { keepalive: true })));
  }
  hasUnsaved() { return Object.keys(this.drafts).length > 0 || this.pending.size > 0; }
  async loadVersions(more = false) {
    if (!this.automatic || this.versionsLoading) return;
    const date = this.date(), generation = this.versionsGeneration;
    this.versionsOpen = true; this.versionsLoading = true; this.publish();
    try {
      const result = await this.request(`/api/diary/versions?date=${encodeURIComponent(date)}${more && this.versionsCursor ? `&cursor=${this.versionsCursor}` : ''}`);
      if (generation !== this.versionsGeneration || date !== this.date()) return;
      this.versions = more ? [...this.versions, ...result.versions] : result.versions;
      this.versionsCursor = result.nextCursor;
    } catch { this.error = '版本历史暂时无法读取，请稍后重试。'; }
    finally { if (generation === this.versionsGeneration) { this.versionsLoading = false; this.publish(); } }
  }
  closeVersions() { this.versionsGeneration++; this.versionsOpen = false; this.versionsLoading = false; this.publish(); }
  async restoreVersion(version) {
    const date = this.date();
    if (!this.automatic || version.date !== date || this.pending.size) return false;
    if (this.drafts[date]) { await this.save(date); if (this.drafts[date] || date !== this.date()) return false; }
    this.edit(version.content);
    this.drafts[date].baseContent = null; this.drafts[date].operation = null;
    this.storage(() => this.repository.put(date, this.drafts[date]));
    const saved = await this.save(date); if (saved) this.closeVersions(); return saved;
  }
  dispose() { this.flush(); this.disposed = true; this.retryTimers.forEach(id => this.cancel(id)); this.retryTimers.clear(); this.listeners.clear(); }
}
