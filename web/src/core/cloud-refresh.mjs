// One foreground monitor owns freshness for independent modules. A failed
// module keeps the version unacknowledged so the next check retries it.
export function createCloudRefresh({ getRevision, refresh, day = () => '' }) {
  let active = false, generation = 0, revision = null, date = null, inFlight = null;
  function check(force = false) {
    if (!active) return Promise.resolve();
    if (inFlight) return inFlight;
    const current = generation;
    const operation = (async () => {
      let next;
      try { next = (await getRevision()).revision; }
      catch (error) { if (!force && error.status !== 404) return false; }
      if (!active || current !== generation) return false;
      const nextDate = day();
      if (force || next == null || next !== revision || nextDate !== date) {
        const results = await Promise.all(refresh.map(fn => Promise.resolve().then(fn).catch(() => false)));
        if (active && current === generation && results.every(value => value !== false)) { revision = next; date = nextDate; }
      }
      return true;
    })();
    inFlight = operation;
    return operation.finally(() => { if (inFlight === operation) inFlight = null; });
  }
  return { check, start() { active = true; generation++; inFlight = null; revision = null; return check(true); },
    stop() { active = false; generation++; inFlight = null; } };
}
