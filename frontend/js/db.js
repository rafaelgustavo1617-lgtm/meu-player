// Camada de dados: tudo fica no IndexedDB do aparelho, então funciona sem internet.
// Stores:
//   tracks    -> metadados de cada música (título, artista, favorito...)
//   files     -> o arquivo de áudio em si (Blob), separado para listar rápido
//   playlists -> { id, name, trackIds[] }

const DB_NAME = 'meu-player';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tracks')) {
        const s = db.createObjectStore('tracks', { keyPath: 'id' });
        s.createIndex('addedAt', 'addedAt');
      }
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------- Músicas ----------

export async function getAllTracks() {
  return tx(['tracks'], 'readonly', (t) => promisify(t.objectStore('tracks').getAll()));
}

export async function addTrack(track, blob) {
  return tx(['tracks', 'files'], 'readwrite', (t) => {
    t.objectStore('tracks').put(track);
    t.objectStore('files').put({ id: track.id, blob });
  });
}

export async function updateTrack(track) {
  return tx(['tracks'], 'readwrite', (t) => { t.objectStore('tracks').put(track); });
}

export async function getFile(id) {
  const rec = await tx(['files'], 'readonly', (t) => promisify(t.objectStore('files').get(id)));
  return rec ? rec.blob : null;
}

export async function deleteTrack(id) {
  return tx(['tracks', 'files', 'playlists'], 'readwrite', async (t) => {
    t.objectStore('tracks').delete(id);
    t.objectStore('files').delete(id);
    // tira a música de todas as playlists também
    const store = t.objectStore('playlists');
    const lists = await promisify(store.getAll());
    for (const p of lists) {
      if (p.trackIds.includes(id)) {
        p.trackIds = p.trackIds.filter((x) => x !== id);
        store.put(p);
      }
    }
  });
}

// ---------- Playlists ----------

export async function getAllPlaylists() {
  return tx(['playlists'], 'readonly', (t) => promisify(t.objectStore('playlists').getAll()));
}

export async function savePlaylist(p) {
  return tx(['playlists'], 'readwrite', (t) => { t.objectStore('playlists').put(p); });
}

export async function deletePlaylist(id) {
  return tx(['playlists'], 'readwrite', (t) => { t.objectStore('playlists').delete(id); });
}

// ---------- Armazenamento ----------

// Pede ao navegador para não apagar os dados quando o celular estiver com pouco espaço.
export async function requestPersistence() {
  if (navigator.storage && navigator.storage.persist) {
    try { return await navigator.storage.persist(); } catch { return false; }
  }
  return false;
}

export async function storageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    try { return await navigator.storage.estimate(); } catch { /* ignora */ }
  }
  return null;
}
