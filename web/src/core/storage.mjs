export function createJSONStorage(storage, key) {
  return {
    read(fallback = null) {
      try { return JSON.parse(storage?.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
    },
    write(value) {
      if (!storage) throw new Error('浏览器存储不可用');
      storage.setItem(key, JSON.stringify(value));
    },
  };
}

export function browserStorage() { try { return globalThis.localStorage; } catch { return null; } }
export function tabIdentity() {
  try {
    let id = sessionStorage.getItem('mpl_tab_id');
    if (!id) { id = globalThis.crypto.randomUUID(); sessionStorage.setItem('mpl_tab_id', id); }
    return id;
  } catch { return `${Date.now()}-${Math.random()}`; }
}
