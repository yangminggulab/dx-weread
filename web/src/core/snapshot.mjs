function rebaseAppEdits(base, local, remote) {
  const result = { ...remote };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of ['tasks', 'notes', 'updates']) {
    const before = new Map((base[key] || []).map(item => [item.id, item]));
    const current = new Map((local[key] || []).map(item => [item.id, item]));
    const merged = new Map((remote[key] || []).map(item => [item.id, item]));
    for (const [id, old] of before) {
      const next = current.get(id);
      if (!next) merged.delete(id);
      else if (!same(old, next)) {
        const item = { ...(merged.get(id) || next) };
        for (const field of new Set([...Object.keys(old), ...Object.keys(next)])) {
          if (same(old[field], next[field])) continue;
          if (field in next) item[field] = next[field]; else delete item[field];
        }
        merged.set(id, item);
      }
    }
    for (const [id, next] of current) if (!before.has(id)) merged.set(id, next);
    result[key] = [...merged.values()];
  }
  return result;
}

export { rebaseAppEdits };
