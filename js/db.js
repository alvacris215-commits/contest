'use strict';

/** Tiny IndexedDB wrapper. IndexedDB holds hundreds of MB, so photos and images are safe here. */
const DB = (() => {
  const NAME = 'contest-manager';
  const VERSION = 1;
  let db = null;

  function open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('contesters')) d.createObjectStore('contesters', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('tickets')) d.createObjectStore('tickets', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = () => { db = req.result; res(db); };
      req.onerror = () => rej(req.error);
      req.onblocked = () => rej(new Error('Database is blocked by another open tab'));
    });
  }

  function tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Transaction aborted (storage full?)'));
    });
  }

  return {
    open,
    all: s => tx(s, 'readonly', st => st.getAll()),
    put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
    putMany: (s, arr) => arr && arr.length ? tx(s, 'readwrite', st => { arr.forEach(v => st.put(v)); }) : Promise.resolve(),
    del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
    clear: s => tx(s, 'readwrite', st => st.clear()),
    get: k => tx('kv', 'readonly', st => st.get(k)),
    set: (k, v) => tx('kv', 'readwrite', st => st.put(v, k)),
  };
})();
