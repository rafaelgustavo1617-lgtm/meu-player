// Todas as consultas ao banco ficam aqui. O servidor só chama estas funções.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, transaction } from './db.js';
import { config } from './config.js';
import { readMetadata } from './metadata.js';

const plain = (row) => (row ? { ...row } : row);
const rows = (list) => list.map(plain);

// ---------- Artistas e álbuns ----------

function getOrCreateArtist(name) {
  if (!name) return null;
  const found = db.prepare('SELECT id FROM artists WHERE name = ?').get(name);
  if (found) return found.id;
  return Number(db.prepare('INSERT INTO artists (name) VALUES (?)').run(name).lastInsertRowid);
}

function getOrCreateAlbum(title, artistId, year) {
  if (!title) return null;
  const found = db.prepare('SELECT id FROM albums WHERE title = ? AND artist_id IS ?').get(title, artistId);
  if (found) return found.id;
  return Number(db.prepare('INSERT INTO albums (title, artist_id, year) VALUES (?, ?, ?)').run(title, artistId, year).lastInsertRowid);
}

export function listArtists() {
  return rows(db.prepare(`
    SELECT a.id, a.name, COUNT(t.id) AS track_count, SUM(t.duration) AS total_duration
    FROM artists a JOIN tracks t ON t.artist_id = a.id
    GROUP BY a.id ORDER BY a.name COLLATE NOCASE`).all());
}

export function listAlbums() {
  return rows(db.prepare(`
    SELECT al.id, al.title, al.year, ar.name AS artist, COUNT(t.id) AS track_count,
           SUM(t.duration) AS total_duration,
           (SELECT id FROM tracks WHERE album_id = al.id AND cover_file IS NOT NULL LIMIT 1) AS cover_track_id
    FROM albums al
    LEFT JOIN artists ar ON ar.id = al.artist_id
    JOIN tracks t ON t.album_id = al.id
    GROUP BY al.id ORDER BY al.title COLLATE NOCASE`).all());
}

export function getAlbum(id) {
  const album = plain(db.prepare(`
    SELECT al.id, al.title, al.year, ar.name AS artist FROM albums al
    LEFT JOIN artists ar ON ar.id = al.artist_id WHERE al.id = ?`).get(id));
  if (!album) return null;
  album.tracks = listTracks({ album: id, sort: 'track' });
  return album;
}

// ---------- Músicas ----------

const TRACK_SELECT = `
  SELECT t.id, t.title, ar.name AS artist, al.title AS album, t.album_id, t.artist_id,
         t.track_number, t.duration, t.file_name, t.file_size, t.mime,
         (t.cover_file IS NOT NULL) AS has_cover, t.favorite, t.favorited_at,
         t.play_count, t.last_played_at, t.created_at, t.updated_at
  FROM tracks t
  LEFT JOIN artists ar ON ar.id = t.artist_id
  LEFT JOIN albums al ON al.id = t.album_id`;

const SORTS = {
  title: 't.title COLLATE NOCASE',
  recent: 't.created_at DESC',
  played: 't.last_played_at DESC',
  plays: 't.play_count DESC, t.title COLLATE NOCASE',
  track: 't.track_number, t.title COLLATE NOCASE',
  favorited: 't.favorited_at DESC',
};

export function listTracks({ q, artist, album, favorite, sort = 'title', limit = 1000 } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push('(t.title LIKE ? OR ar.name LIKE ? OR al.title LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (artist) { where.push('t.artist_id = ?'); params.push(Number(artist)); }
  if (album) { where.push('t.album_id = ?'); params.push(Number(album)); }
  if (favorite) where.push('t.favorite = 1');
  const sql = `${TRACK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${SORTS[sort] || SORTS.title} LIMIT ?`;
  return rows(db.prepare(sql).all(...params, Math.min(Number(limit) || 1000, 5000))).map(fixBools);
}

export function getTrack(id) {
  return fixBools(plain(db.prepare(`${TRACK_SELECT} WHERE t.id = ?`).get(id)));
}

function fixBools(t) {
  if (t) { t.favorite = !!t.favorite; t.has_cover = !!t.has_cover; }
  return t;
}

export function getTrackFile(id) {
  const r = db.prepare('SELECT file_path, mime, file_size, cover_file FROM tracks WHERE id = ?').get(id);
  if (!r) return null;
  return {
    audioPath: path.join(config.musicDir, r.file_path),
    mime: r.mime,
    size: r.file_size,
    coverPath: r.cover_file ? path.join(config.coversDir, r.cover_file) : null,
  };
}

const MIME_BY_EXT = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg' };

// Adiciona uma música a partir do conteúdo do arquivo (Buffer).
// Retorna { track, created } — created = false se ela já existia.
export function addTrack(buf, fileName, extra = {}) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw Object.assign(new Error(`Formato não suportado: .${ext}`), { status: 415 });

  const dup = db.prepare('SELECT id FROM tracks WHERE file_name = ? AND file_size = ?').get(fileName, buf.length);
  if (dup) return { track: getTrack(dup.id), created: false };

  const meta = readMetadata(buf, fileName);
  const id = crypto.randomUUID();
  const filePath = `${id}.${ext}`;
  fs.writeFileSync(path.join(config.musicDir, filePath), buf);

  let coverFile = null;
  if (meta.cover) {
    coverFile = `${id}.${meta.cover.mime.includes('png') ? 'png' : 'jpg'}`;
    fs.writeFileSync(path.join(config.coversDir, coverFile), meta.cover.data);
  }

  try {
    transaction(() => {
      const artistId = getOrCreateArtist(extra.artist || meta.artist);
      const albumId = getOrCreateAlbum(extra.album || meta.album, artistId, meta.year);
      db.prepare(`INSERT INTO tracks (id, title, artist_id, album_id, track_number, duration, file_name, file_path, file_size, mime, cover_file)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, extra.title || meta.title, artistId, albumId, meta.trackNumber, Number(extra.duration) || meta.duration || 0,
          fileName, filePath, buf.length, mime, coverFile);
      if (coverFile && albumId) db.prepare('UPDATE albums SET cover_file = COALESCE(cover_file, ?) WHERE id = ?').run(coverFile, albumId);
    });
  } catch (e) {
    fs.rmSync(path.join(config.musicDir, filePath), { force: true });
    if (coverFile) fs.rmSync(path.join(config.coversDir, coverFile), { force: true });
    throw e;
  }
  return { track: getTrack(id), created: true };
}

// Edita informações: { title, artist, album, track_number, duration, favorite }
export function updateTrack(id, data) {
  const current = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
  if (!current) return null;
  transaction(() => {
    const sets = [];
    const params = [];
    if (data.title !== undefined) { sets.push('title = ?'); params.push(String(data.title).trim() || current.title); }
    if (data.artist !== undefined) { sets.push('artist_id = ?'); params.push(getOrCreateArtist(data.artist || null)); }
    if (data.album !== undefined) {
      const artistId = data.artist !== undefined ? getOrCreateArtist(data.artist || null) : current.artist_id;
      sets.push('album_id = ?'); params.push(getOrCreateAlbum(data.album || null, artistId, null));
    }
    if (data.track_number !== undefined) { sets.push('track_number = ?'); params.push(data.track_number ? Number(data.track_number) : null); }
    if (data.duration !== undefined) { sets.push('duration = ?'); params.push(Number(data.duration) || 0); }
    if (data.favorite !== undefined) {
      sets.push('favorite = ?', "favorited_at = CASE WHEN ? THEN datetime('now') ELSE NULL END");
      params.push(data.favorite ? 1 : 0, data.favorite ? 1 : 0);
    }
    if (!sets.length) return;
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    cleanupOrphans();
  });
  return getTrack(id);
}

export function deleteTrack(id) {
  const r = db.prepare('SELECT file_path, cover_file FROM tracks WHERE id = ?').get(id);
  if (!r) return false;
  transaction(() => {
    db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
    cleanupOrphans();
  });
  fs.rmSync(path.join(config.musicDir, r.file_path), { force: true });
  if (r.cover_file) {
    const stillUsed = db.prepare('SELECT 1 FROM albums WHERE cover_file = ?').get(r.cover_file);
    if (!stillUsed) fs.rmSync(path.join(config.coversDir, r.cover_file), { force: true });
  }
  return true;
}

// Apaga artistas/álbuns que ficaram sem nenhuma música
function cleanupOrphans() {
  db.exec(`DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL);
           DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM tracks WHERE artist_id IS NOT NULL)
             AND id NOT IN (SELECT DISTINCT artist_id FROM albums WHERE artist_id IS NOT NULL);`);
}

// Troca (ou remove, com buf = null) a capa da música e das outras do mesmo álbum
export function setCover(id, buf, mime) {
  const t = db.prepare('SELECT id, album_id FROM tracks WHERE id = ?').get(id);
  if (!t) return null;
  let coverFile = null;
  if (buf) {
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw Object.assign(new Error('Envie uma imagem JPG, PNG ou WEBP'), { status: 415 });
    coverFile = `${crypto.randomUUID()}.${mime.split('/')[1].replace('jpeg', 'jpg')}`;
    fs.writeFileSync(path.join(config.coversDir, coverFile), buf);
  }
  const ids = t.album_id
    ? db.prepare('SELECT id FROM tracks WHERE album_id = ?').all(t.album_id).map((r) => r.id)
    : [id];
  const old = new Set(ids.map((x) => db.prepare('SELECT cover_file FROM tracks WHERE id = ?').get(x).cover_file).filter(Boolean));
  transaction(() => {
    const stmt = db.prepare("UPDATE tracks SET cover_file = ?, updated_at = datetime('now') WHERE id = ?");
    ids.forEach((x) => stmt.run(coverFile, x));
    if (t.album_id) db.prepare('UPDATE albums SET cover_file = ? WHERE id = ?').run(coverFile, t.album_id);
  });
  // apaga arquivos de capa que ninguém mais usa
  for (const f of old) {
    const used = db.prepare('SELECT 1 FROM tracks WHERE cover_file = ? UNION SELECT 1 FROM albums WHERE cover_file = ?').get(f, f);
    if (!used) fs.rmSync(path.join(config.coversDir, f), { force: true });
  }
  return { updated: ids.length, track: getTrack(id) };
}

// Registra que a música tocou (para "Mais tocadas", "Tocadas recentemente" e estatísticas)
export function registerPlay(id, seconds = 0) {
  const exists = db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(id);
  if (!exists) return false;
  transaction(() => {
    db.prepare('INSERT INTO plays (track_id, seconds) VALUES (?, ?)').run(id, Number(seconds) || 0);
    db.prepare("UPDATE tracks SET play_count = play_count + 1, last_played_at = datetime('now') WHERE id = ?").run(id);
  });
  return true;
}

// ---------- Playlists ----------

export function listPlaylists() {
  return rows(db.prepare(`
    SELECT p.id, p.name, p.created_at, p.updated_at, COUNT(pt.track_id) AS track_count,
           COALESCE(SUM(t.duration), 0) AS total_duration
    FROM playlists p
    LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    LEFT JOIN tracks t ON t.id = pt.track_id
    GROUP BY p.id ORDER BY p.name COLLATE NOCASE`).all());
}

export function getPlaylist(id) {
  const p = plain(db.prepare('SELECT id, name, created_at, updated_at FROM playlists WHERE id = ?').get(id));
  if (!p) return null;
  p.tracks = rows(db.prepare(`${TRACK_SELECT} JOIN playlist_tracks pt ON pt.track_id = t.id
    WHERE pt.playlist_id = ? ORDER BY pt.position`).all(id)).map(fixBools);
  return p;
}

export function createPlaylist(name, trackIds = []) {
  const id = transaction(() => {
    const pid = Number(db.prepare('INSERT INTO playlists (name) VALUES (?)').run(name).lastInsertRowid);
    trackIds.forEach((tid) => addToPlaylist(pid, tid));
    return pid;
  });
  return getPlaylist(id);
}

export function renamePlaylist(id, name) {
  const r = db.prepare("UPDATE playlists SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
  return r.changes ? getPlaylist(id) : null;
}

export function deletePlaylist(id) {
  return db.prepare('DELETE FROM playlists WHERE id = ?').run(id).changes > 0;
}

export function addToPlaylist(playlistId, trackId) {
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM playlist_tracks WHERE playlist_id = ?').get(playlistId).p;
  db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)').run(playlistId, trackId, pos);
  db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
}

export function removeFromPlaylist(playlistId, trackId) {
  return db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlistId, trackId).changes > 0;
}

// Reordena: recebe a lista de ids na nova ordem
export function reorderPlaylist(playlistId, trackIds) {
  transaction(() => {
    const stmt = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?');
    trackIds.forEach((tid, i) => stmt.run(i, playlistId, tid));
  });
  return getPlaylist(playlistId);
}

// Playlists automáticas
export function smartPlaylist(kind) {
  if (kind === 'mais-tocadas') return listTracks({ sort: 'plays', limit: 50 }).filter((t) => t.play_count > 0);
  if (kind === 'adicionadas-agora') return listTracks({ sort: 'recent', limit: 50 });
  if (kind === 'nunca-tocadas') return rows(db.prepare(`${TRACK_SELECT} WHERE t.play_count = 0 ORDER BY t.created_at DESC`).all()).map(fixBools);
  return null;
}

// ---------- Estatísticas e ajustes ----------

export function weekStats() {
  const days = rows(db.prepare(`
    SELECT date(played_at, 'localtime') AS day, ROUND(SUM(seconds)) AS seconds, COUNT(*) AS plays
    FROM plays WHERE played_at >= datetime('now', '-6 days', 'start of day')
    GROUP BY day ORDER BY day`).all());
  const totals = plain(db.prepare(`
    SELECT (SELECT COUNT(*) FROM tracks) AS tracks, (SELECT COUNT(*) FROM artists) AS artists,
           (SELECT COUNT(*) FROM albums) AS albums, (SELECT COUNT(*) FROM playlists) AS playlists,
           (SELECT COALESCE(SUM(file_size), 0) FROM tracks) AS bytes`).get());
  return { days, totals };
}

export function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

export function saveSettings(obj) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  transaction(() => { for (const [k, v] of Object.entries(obj)) stmt.run(k, JSON.stringify(v)); });
  return getSettings();
}
