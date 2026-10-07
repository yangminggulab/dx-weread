import { rebaseAppEdits } from './snapshot.mjs';

const snapshot = data => ({ tasks: data.tasks || [], updates: data.updates || [] });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalize = data => ({ ...data, tasks: data.tasks || [], books: data.books || [], notes: data.notes || [], updates: data.updates || [] });

// Owns dashboard data and legacy task snapshot writes. Diary and reading drafts
// have separate controllers; neither participates in task snapshot writes.
export class WorkspaceController {
  constructor({ request, cache, personal = true, schedule = setTimeout, cancel = clearTimeout }) {
    this.request = request; this.cache = cache; this.personal = personal;
    this.schedule = (...args) => schedule(...args); this.cancel = id => cancel(id);
    this.listeners = new Set(); this.epoch = 0; this.readingEpoch = 0; this.timer = null; this.saving = null; this.refreshing = null;
    this.taskConflict = false; this.disposed = false;
    const cached = cache?.read();
    this.data = cached ? normalize(cached) : null;
    this.base = this.data ? snapshot(this.data) : null;
    this.state = { data: this.data, loading: !this.data, error: '', syncError: '', taskConflict: false, saving: false };
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.state;
  publish(patch = {}) { this.state = { ...this.state, data: this.data, ...patch }; this.listeners.forEach(fn => fn()); }
  dirty() { return this.data && this.base && !same(snapshot(this.data), this.base); }
  persistCache() { try { this.cache?.write({ ...this.data, ...this.base }); } catch {} }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    const epoch = this.epoch, readingEpoch = this.readingEpoch;
    this.refreshing = (async () => {
      try {
        const incoming = normalize(await this.request('/api/data'));
        const retainTasks = epoch !== this.epoch || this.dirty() || this.saving || this.state.syncError;
        const retainBooks = readingEpoch !== this.readingEpoch;
        this.data = { ...incoming,
          ...(retainTasks ? snapshot(this.data) : {}),
          ...(retainBooks ? { books: this.data.books } : {}),
        };
        if (!retainTasks) this.base = snapshot(incoming);
        this.persistCache(); this.publish({ error: '' });
        return true;
      } catch { this.publish({ error: '任务与读书刷新失败，已保留上次数据。' }); return false; }
      finally { this.refreshing = null; this.publish({ loading: false }); }
    })();
    return this.refreshing;
  }
  log(type, text) { this.data.updates = [{ id: Date.now(), type, text, time: '刚刚' }, ...this.data.updates].slice(0, 8); }
  changeTasks(change, type, text) {
    if (!this.data || !this.base) return;
    this.epoch++; this.data = { ...this.data, tasks: change(this.data.tasks) };
    if (text) this.log(type, text);
    this.publish(); this.cancel(this.timer);
    this.timer = this.schedule(() => { this.timer = null; this.flushTasks(); }, 800);
  }
  saveTask(form, original) {
    const id = original?.id ?? Math.max(0, ...this.data.tasks.map(t => Number.isSafeInteger(t.id) ? t.id : 0)) + 1;
    this.changeTasks(tasks => original ? tasks.map(t => t.id === id ? { ...t, ...form } : t)
      : [...tasks, { ...form, id, createdAt: new Date().toISOString().slice(0, 10) }],
    original ? 'note' : 'add', `${original ? '更新' : '新增'}任务「${form.title}」`);
  }
  toggleTask(id) {
    const task = this.data?.tasks.find(t => t.id === id);
    if (!task) return;
    const status = task.status === 'completed' ? 'in_progress' : 'completed';
    this.changeTasks(tasks => tasks.map(t => t.id === id ? { ...t, status } : t), 'complete', status === 'completed' ? `完成「${task.title}」` : '');
  }
  async flushTasks() {
    this.cancel(this.timer); this.timer = null;
    if (this.saving) return this.saving;
    if (!this.dirty() || this.taskConflict) return;
    this.publish({ saving: true });
    this.saving = (async () => {
      try {
        while (this.dirty()) {
          const submitted = structuredClone(snapshot(this.data)), readingEpoch = this.readingEpoch;
          const receipt = await this.request('/api/data', { method: 'POST', body: JSON.stringify({ ...submitted, ...(this.personal ? { _base: this.base } : {}) }) });
          const saved = receipt.data ? normalize(receipt.data) : { ...this.data, ...submitted };
          const rebased = rebaseAppEdits(submitted, snapshot(this.data), saved);
          this.base = snapshot(saved); this.data = normalize({ ...rebased,
            ...(readingEpoch !== this.readingEpoch ? { books: this.data.books } : {}),
          }); this.epoch++;
          this.persistCache(); this.publish({ syncError: '', taskConflict: false });
        }
      } catch (error) {
        this.taskConflict = error.status === 409;
        this.publish({ taskConflict: this.taskConflict, syncError: this.taskConflict ? '其他端修改了相同任务，当前编辑已保留，请核对后重试。' : '暂时无法连接云端，当前编辑已保留，会自动重试。' });
        if (!this.taskConflict && !this.disposed) {
          this.cancel(this.timer);
          this.timer = this.schedule(() => { this.timer = null; this.flushTasks(); }, 30000);
        }
      } finally { this.saving = null; this.publish({ saving: false }); }
    })();
    return this.saving;
  }
  async retryTasks() {
    try {
      const remote = normalize(await this.request('/api/data'));
      this.data = normalize(rebaseAppEdits(this.base, snapshot(this.data), remote));
      this.base = snapshot(remote); this.epoch++; this.taskConflict = false; this.publish({ syncError: '', taskConflict: false });
      return this.flushTasks();
    } catch { this.publish({ syncError: '获取云端任务失败，当前编辑已保留。' }); }
  }
  acceptReading(receipt, deletedID) {
    if (!this.data) return;
    this.readingEpoch++;
    this.data = { ...this.data, books: receipt.book
      ? [receipt.book, ...this.data.books.filter(b => b.id !== receipt.book.id)]
      : this.data.books.filter(b => b.id !== deletedID) };
    this.persistCache(); this.publish();
  }
  dispose() { this.disposed = true; this.flushTasks(); this.listeners.clear(); }
}
