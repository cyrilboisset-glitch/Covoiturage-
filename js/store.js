// Stockage local (IndexedDB). Rien ne quitte le téléphone.
const DB_NAME = 'covoiturage-pde';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('tickets')) db.createObjectStore('tickets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction annulée'));
  });
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const kvGet = (key) => tx('kv', 'readonly', (s) => req2p(s.get(key)));
export const kvSet = (key, value) => tx('kv', 'readwrite', (s) => { s.put(value, key); });
export const kvDel = (key) => tx('kv', 'readwrite', (s) => { s.delete(key); });

export const getAll = (store) => tx(store, 'readonly', (s) => req2p(s.getAll()));
export const put = (store, obj) => tx(store, 'readwrite', (s) => { s.put(obj); });
export const del = (store, id) => tx(store, 'readwrite', (s) => { s.delete(id); });
export const clear = (store) => tx(store, 'readwrite', (s) => { s.clear(); });

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch (_) { /* ignoré */ }
}
