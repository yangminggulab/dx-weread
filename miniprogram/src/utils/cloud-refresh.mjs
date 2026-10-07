export function createCloudRefresh({ getVersion, refresh, day = () => '', onError = () => {} }) {
  let active = false
  let generation = 0
  let revision = null
  let date = null
  let retry = false
  let inFlight = null

  function check(force = false) {
    if (!active) return Promise.resolve()
    if (inFlight) return inFlight
    const current = generation
    const operation = (async () => {
      let next, versionError
      try {
        next = (await getVersion()).revision
        if (!Number.isSafeInteger(next) || next < 0) throw new Error('Invalid sync revision')
      } catch (error) {
        next = undefined
        versionError = error
      }
      if (!active || current !== generation) return false
      // A read fallback can replace an unavailable freshness hint, never an
      // authorization decision. Keep the last revision unacknowledged on errors.
      if ([401, 403].includes(versionError?.statusCode)) {
        retry = true; onError(versionError); return false
      }
      const nextDate = day()
      if (force || retry || next == null || next !== revision || nextDate !== date) {
        let succeeded, refreshError
        try { succeeded = await refresh() }
        catch (error) { succeeded = false; refreshError = error }
        if (!active || current !== generation) return false
        if (succeeded === false) {
          retry = true; onError(refreshError || versionError || new Error('Cloud refresh failed')); return false
        }
        revision = next; date = nextDate; retry = false; onError(null)
      }
      return true
    })()
    inFlight = operation
    return operation.finally(() => {
      if (inFlight === operation) inFlight = null
    })
  }

  return {
    check,
    start() {
      active = true
      generation += 1
      inFlight = null
      revision = null
      date = null
      retry = false
      return check(true)
    },
    stop() {
      active = false
      generation += 1
      inFlight = null
    }
  }
}
