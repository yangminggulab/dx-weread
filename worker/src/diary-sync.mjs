// Pure three-way merge. Raw Unicode text and whitespace are never normalized.
// Ambiguous edits fall back to version preservation, never guessed prose.
function changes(base, value) {
  const a = Array.from(base), b = Array.from(value);
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const left = a.slice(prefix, a.length - suffix), right = b.slice(prefix, b.length - suffix);
  // Bound CPU/memory on unrelated long bodies; the caller preserves both versions.
  if ((left.length + 1) * (right.length + 1) > 1000000) return null;
  const width = right.length + 1, table = new Uint32Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
    table[i * width + j] = left[i] === right[j] ? 1 + table[(i + 1) * width + j + 1]
      : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  }
  const edits = []; let i = 0, j = 0, current;
  const flush = () => { if (current) { edits.push(current); current = null; } };
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) { flush(); i++; j++; continue; }
    current ||= { start: prefix + i, end: prefix + i, text: '' };
    if (j < right.length && (i === left.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) current.text += right[j++];
    else { i++; current.end = prefix + i; }
  }
  flush(); return edits;
}
export function mergeDiaryText(base, local, remote) {
  if (local === remote || remote === base) return { content: local, conflict: false };
  if (local === base) return { content: remote, conflict: false };
  if (typeof base !== 'string') return { content: local, conflict: true };
  const ours = changes(base, local), theirs = changes(base, remote);
  if (!ours || !theirs) return { content: local, conflict: true };
  const edits = [...ours];
  for (const other of theirs) {
    let duplicate = false;
    for (const edit of ours) {
      if (edit.start === other.start && edit.end === other.end && edit.text === other.text) { duplicate = true; break; }
      const overlap = edit.start === edit.end ? edit.start >= other.start && edit.start <= other.end
        : other.start === other.end ? other.start >= edit.start && other.start <= edit.end
        : edit.start < other.end && other.start < edit.end;
      if (overlap) return { content: local, conflict: true };
    }
    if (!duplicate) edits.push(other);
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  const chars = Array.from(base); let at = 0, content = '';
  for (const edit of edits) { content += chars.slice(at, edit.start).join('') + edit.text; at = edit.end; }
  return { content: content + chars.slice(at).join(''), conflict: false };
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function recordDiaryVersion(kv, date, content, { source = 'server', reason = 'saved' } = {}) {
  const id = await digest(date + '\n' + content), key = `diary_version:${date}:${id}`;
  if (await kv.get(key)) return id;
  const createdAt = new Date().toISOString();
  await kv.put(key, JSON.stringify({ id, date, content, source, reason, createdAt }));
  const indexKey = `diary_versions:${date}`, index = JSON.parse(await kv.get(indexKey) || '[]');
  index.unshift({ id, createdAt });
  await kv.put(indexKey, JSON.stringify(index));
  return id;
}

// Must run inside TaskState's serialized SQLite transaction: version snapshots,
// head update and replay receipt either all commit or all roll back.
export async function syncDiary(kv, diary, body, save, effectiveDate) {
  const date = body?.date, operationId = body?.operationId;
  const validDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
  if (!validDate || date > effectiveDate || typeof body.content !== 'string'
      || !(body.baseContent === null || typeof body.baseContent === 'string')
      || typeof body.baseUpdatedAt !== 'string' || typeof operationId !== 'string'
      || !/^[A-Za-z0-9:_-]{8,100}$/.test(operationId) || !['apple', 'web', 'miniprogram'].includes(body.source)) {
    return { status: 400, value: { error: '日期或同步操作无效' } };
  }
  const fingerprint = await digest(JSON.stringify([date, body.content, body.baseContent, body.baseUpdatedAt, body.source]));
  const operationKey = `diary_operation:${operationId}`, previous = JSON.parse(await kv.get(operationKey) || 'null');
  if (previous) return previous.fingerprint === fingerprint ? { status: 200, value: previous.receipt }
    : { status: 400, value: { error: '同一同步操作不能携带不同内容' } };
  let current = diary.today.date === date ? diary.today : diary.archive.find(entry => entry.date === date);
  // A day that was never uploaded before 05:00 can be created explicitly. It
  // remains its original date; unknown/missing historical bodies are backed up.
  if (!current) current = { date, content: '', updatedAt: '' };
  const merged = mergeDiaryText(body.baseContent, body.content, current.content);
  // Preserve all raw participants before changing the canonical body, including
  // deliberate clears and unknown legacy baselines. Never prune conflict copies.
  await recordDiaryVersion(kv, date, current.content, { reason: 'previous' });
  if (body.baseContent !== null) await recordDiaryVersion(kv, date, body.baseContent, { source: body.source, reason: 'baseline' });
  await recordDiaryVersion(kv, date, body.content, { source: body.source, reason: merged.conflict ? 'concurrent' : 'submitted' });
  const entry = merged.content === current.content ? current : { ...current, content: merged.content,
    updatedAt: new Date(Math.max(Date.now(), (Date.parse(current.updatedAt) || 0) + 1)).toISOString() };
  await recordDiaryVersion(kv, date, entry.content, { source: body.source, reason: merged.conflict ? 'preserved' : 'merged' });
  if (entry !== current || !diary.archive.some(item => item.date === date) && diary.today.date !== date) {
    if (diary.today.date === date) diary.today = entry;
    else diary.archive = diary.archive.filter(item => item.date !== date).concat(entry);
    await save(diary);
  }
  const receipt = { ok: true, syncVersion: 1, operationId, submittedContent: body.content, entry,
    outcome: merged.conflict ? 'preserved' : entry.content === body.content ? 'saved' : 'merged' };
  await kv.put(operationKey, JSON.stringify({ fingerprint, receipt }));
  return { status: 200, value: receipt };
}

export async function diaryVersions(kv, date, cursor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isSafeInteger(cursor) || cursor < 0) return null;
  const index = JSON.parse(await kv.get(`diary_versions:${date}`) || '[]');
  if (cursor > index.length) return null;
  // Stable oldest-based cursor: new head versions do not shift later pages.
  const end = cursor || index.length, start = Math.max(0, end - 20);
  const items = index.slice(index.length - end, index.length - start);
  const versions = await Promise.all(items.map(async ({ id }) => JSON.parse(await kv.get(`diary_version:${date}:${id}`))));
  return { versions, nextCursor: start || null };
}
