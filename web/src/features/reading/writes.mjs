const EDIT_FIELDS = ['title', 'currentPage', 'totalPage', 'status', 'notes'];
export const bookBaseline = book => Object.fromEntries(EDIT_FIELDS.map(key => [key, book[key] ?? null]));
export function bookFields(book) {
  return { title: book?.title || '', currentPage: String(book?.currentPage ?? 0), totalPage: String(book?.totalPage ?? 0), status: book?.status || 'reading', notes: book?.notes || '' };
}
export function bookWrite(draft) {
  const title = draft.fields.title.trim();
  if (!title) throw new Error('请填写书名');
  if (!/^\d+$/.test(draft.fields.currentPage) || !/^\d+$/.test(draft.fields.totalPage)) throw new Error('页数需为非负整数');
  const currentPage = Number(draft.fields.currentPage), totalPage = Number(draft.fields.totalPage);
  if (!Number.isSafeInteger(currentPage) || !Number.isSafeInteger(totalPage) || totalPage > 0 && currentPage > totalPage) throw new Error('当前页不能超过总页数');
  const value = { ...draft.fields, title, currentPage, totalPage };
  if (!draft.original) return value;
  if (draft.original.source === 'weread' || draft.original._bookId) throw new Error('微信读书记录由来源同步维护');
  const initial = bookFields(draft.original), patch = {};
  for (const key of EDIT_FIELDS) {
    const old = ['currentPage', 'totalPage'].includes(key) ? Number(initial[key]) : initial[key];
    if (value[key] !== old) patch[key] = value[key];
  }
  return { ...patch, id: draft.original.id, _base: bookBaseline(draft.original), _readingWriteVersion: 1 };
}

export class ReadingController {
  constructor({ workspace, request, drafts }) {
    this.workspace = workspace; this.request = request; this.drafts = drafts;
    this.listeners = new Set(); this.state = { editor: null, saving: false, error: '', conflict: false, deleting: null, closing: false };
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.state;
  publish(patch) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  key(original) { return original ? `${typeof original.id}:${original.id}` : 'new-book'; }
  persist(editor = this.state.editor) {
    if (!editor) return;
    try { this.drafts.write({ ...this.drafts.read({}), [this.key(editor.original)]: editor }); }
    catch { this.publish({ error: '本机草稿未能保存，请保持编辑窗口打开。' }); }
  }
  discard(editor = this.state.editor) {
    if (!editor) return;
    const saved = this.drafts.read({}); delete saved[this.key(editor.original)];
    try { this.drafts.write(saved); } catch {}
  }
  open(book = null) {
    if (book?.source === 'weread' || book?._bookId) return;
    const cached = this.drafts.read({})[this.key(book)];
    this.publish({ editor: cached || { original: book ? structuredClone(book) : null, fields: bookFields(book) },
      error: cached ? '已恢复本机草稿，保存时会核对原云端版本。' : '', conflict: false, closing: false });
  }
  edit(key, value) {
    if (this.state.saving || !this.state.editor) return;
    const editor = { ...this.state.editor, fields: { ...this.state.editor.fields, [key]: value } };
    this.publish({ editor }); this.persist(editor);
  }
  dirty() { return this.state.editor && JSON.stringify(this.state.editor.fields) !== JSON.stringify(bookFields(this.state.editor.original)); }
  close() {
    if (this.state.saving) return;
    if (this.dirty()) this.publish({ closing: true });
    else { this.discard(); this.publish({ editor: null }); }
  }
  keepAndClose() { this.persist(); this.publish({ editor: null, closing: false }); }
  discardAndClose() { this.discard(); this.publish({ editor: null, closing: false }); }
  async protect() {
    const capabilities = await this.request('/api/sync-state');
    if (capabilities.readingWriteVersion !== 1) throw new Error('服务暂不支持读书编辑保护，请更新服务后再保存。');
  }
  async save() {
    if (this.state.saving || this.state.conflict || !this.state.editor) return false;
    const captured = structuredClone(this.state.editor);
    let fields;
    try { fields = bookWrite(captured); } catch (error) { this.publish({ error: error.message }); return false; }
    this.persist(captured); this.publish({ saving: true, error: '' });
    try {
      // Require protection for creates as well, matching Mac's capability check.
      await this.protect();
      const receipt = await this.request(captured.original ? '/api/books/update' : '/api/books/add', { method: 'POST', body: JSON.stringify(fields) });
      if (!receipt.ok || receipt.book?.id == null) throw new Error('云端没有确认这次保存');
      this.workspace.acceptReading(receipt); this.discard(captured); this.publish({ editor: null });
      return true;
    } catch (error) {
      if (error.status === 409 || error.status === 404 && captured.original) {
        await this.workspace.refresh(); this.publish({ conflict: true });
      }
      this.publish({ error: error.status === 409 ? '其他端修改了书籍，草稿已保留，请核对云端版本。'
        : error.status === 404 ? '暂时无法保存书籍，草稿已保留，请确认服务已更新。' : error.message });
      return false;
    } finally { this.publish({ saving: false }); }
  }
  cloudBook() { return this.workspace.data?.books.find(book => book.id === this.state.editor?.original?.id); }
  resolve(useCloud = false) {
    const cloud = this.cloudBook(), editor = this.state.editor;
    if (!cloud || !editor || this.state.saving) return;
    const fields = bookFields(cloud), original = bookFields(editor.original);
    if (!useCloud) for (const key of EDIT_FIELDS) if (editor.fields[key] !== original[key]) fields[key] = editor.fields[key];
    const next = { original: structuredClone(cloud), fields };
    this.publish({ editor: next, conflict: false, error: '' }); this.persist(next);
  }
  requestDelete(book) {
    if (book && book.source !== 'weread' && !book._bookId && !this.state.saving) this.publish({ deleting: structuredClone(book), error: '' });
  }
  async deleteBook() {
    const book = this.state.deleting;
    if (!book || this.state.saving) return false;
    this.publish({ saving: true, error: '' });
    try {
      await this.protect();
      const receipt = await this.request('/api/books/delete', { method: 'POST', body: JSON.stringify({ id: book.id, _base: bookBaseline(book), _readingWriteVersion: 1 }) });
      if (!receipt.ok) throw new Error('云端没有确认这次删除');
      this.workspace.acceptReading({}, book.id); this.discard({ original: book }); this.publish({ deleting: null }); return true;
    } catch (error) {
      this.publish({ error: error.status === 409 ? '书籍已被其他端修改，删除已停止，请刷新核对后重新选择。' : '删除失败，请检查网络或服务后重试。', deleting: null });
      await this.workspace.refresh(); return false;
    } finally { this.publish({ saving: false }); }
  }
}
