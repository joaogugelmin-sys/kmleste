// Armazenamento local (IndexedDB): apontamentos e fotos ficam só no celular.
const DB_NAME = 'kmleste';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('aps', { keyPath: 'id', autoIncrement: true });
      const f = db.createObjectStore('fotos', { keyPath: 'id', autoIncrement: true });
      f.createIndex('apId', 'apId');
      db.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  async putAp(ap) { return tx('aps', 'readwrite', (s) => req(s.put(ap))); },
  async getAp(id) { return tx('aps', 'readonly', (s) => req(s.get(id))); },
  async allAps() { return tx('aps', 'readonly', (s) => req(s.getAll())); },
  async delAp(id) {
    const fotos = await this.fotosOf(id);
    await tx('fotos', 'readwrite', (s) => { fotos.forEach((f) => s.delete(f.id)); });
    return tx('aps', 'readwrite', (s) => req(s.delete(id)));
  },
  async putFoto(f) { return tx('fotos', 'readwrite', (s) => req(s.put(f))); },
  async getFoto(id) { return tx('fotos', 'readonly', (s) => req(s.get(id))); },
  async delFoto(id) { return tx('fotos', 'readwrite', (s) => req(s.delete(id))); },
  async fotosOf(apId) { return tx('fotos', 'readonly', (s) => req(s.index('apId').getAll(apId))); },
  async get(k, def) { const v = await tx('kv', 'readonly', (s) => req(s.get(k))); return v === undefined ? def : v; },
  async set(k, v) { return tx('kv', 'readwrite', (s) => req(s.put(v, k))); },
};
