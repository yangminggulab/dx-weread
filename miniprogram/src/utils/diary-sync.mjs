import { createRequestQueue } from './request-queue.mjs'

// Web and native WeChat share the immutable operation/receipt contract.
export function diarySyncOperation(draft, existing, source) {
  if (existing && existing.date === draft.date && existing.content === draft.content && existing.source === source) return existing
  const operationId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID()
    : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return { operationId, source, date: draft.date, content: draft.content,
    baseContent: typeof draft.baseContent === 'string' ? draft.baseContent : null,
    baseUpdatedAt: draft.baseUpdatedAt || '' }
}
export function validDiarySyncReceipt(receipt, operation) {
  return receipt && receipt.ok === true && receipt.syncVersion === 1 && receipt.operationId === operation.operationId
    && receipt.submittedContent === operation.content && receipt.entry && receipt.entry.date === operation.date
    && typeof receipt.entry.content === 'string' && ['saved', 'merged', 'preserved'].includes(receipt.outcome)
}

// A browsing event must never resubmit a cached diary body.
export function diaryArchiveMetadata(archive = []) {
  return archive.map(entry => ({
    date: entry.date,
    viewCount: entry.viewCount,
    lastViewedAt: entry.lastViewedAt,
    tags: entry.tags,
    tagScores: entry.tagScores
  }))
}

export function reconcileDiaryToday(local, remote, { dirty = false, changedDuringRequest = false } = {}) {
  const conflict = dirty && !changedDuringRequest &&
    (local.date !== remote.date || (local.updatedAt || '') !== (remote.updatedAt || ''))
  return {
    today: dirty || changedDuringRequest ? local : remote,
    conflict: conflict ? remote : null
  }
}

export function createDiaryWriter(write, sync) {
  const queue = createRequestQueue()
  const acknowledgedVersions = new Map()
  const key = (date, version) => JSON.stringify([date, version || ''])

  const resolveBaseline = (date, version) => {
    let expected = version || ''
    const visited = new Set()
    while (acknowledgedVersions.has(key(date, expected)) && !visited.has(expected)) {
      visited.add(expected)
      expected = acknowledgedVersions.get(key(date, expected))
    }
    return expected
  }

  return {
    resolveBaseline,
    sync(operation) {
      const snapshot = JSON.parse(JSON.stringify(operation))
      return queue.enqueue(async () => {
        const receipt = await sync(snapshot)
        if (!validDiarySyncReceipt(receipt, snapshot)) throw new Error('云端没有确认这次同步')
        return receipt
      })
    },
    save(payload) {
      // Snapshot now, before another keystroke or queued save changes the draft.
      const snapshot = JSON.parse(JSON.stringify(payload))
      return queue.enqueue(async () => {
        if (!snapshot.today) return write(snapshot)
        const date = snapshot.today.date
        const expected = resolveBaseline(date, snapshot.today.updatedAt)
        const receipt = await write({ ...snapshot, expectedUpdatedAt: expected })
        const confirmed = receipt && receipt.today
        if (confirmed && confirmed.date === date && confirmed.updatedAt !== expected) {
          acknowledgedVersions.set(key(date, expected), confirmed.updatedAt || '')
        }
        return receipt
      })
    },
    wait: () => queue.wait()
  }
}
