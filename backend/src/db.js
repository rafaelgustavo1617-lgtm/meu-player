// Banco de dados SQLite (módulo nativo do Node 22, sem dependências).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
fs.mkdirSync(config.musicDir, { recursive: true });
fs.mkdirSync(config.coversDir, { recursive: true });

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Migrações: cada item roda uma única vez, na ordem. Para mudar o banco no futuro,
// adicione um novo item no fim da lista (nunca edite os antigos).
const migrations = [
  `
  CREATE TABLE artists (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE albums (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    artist_id   INTEGER REFERENCES artists(id) ON DELETE SET NULL,
    year        INTEGER,
    cover_file  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (title, artist_id)
  );

  CREATE TABLE tracks (
    id              TEXT PRIMARY KEY,               -- UUID
    title           TEXT NOT NULL,
    artist_id       INTEGER REFERENCES artists(id) ON DELETE SET NULL,
    album_id        INTEGER REFERENCES albums(id) ON DELETE SET NULL,
    track_number    INTEGER,
    duration        REAL NOT NULL DEFAULT 0,        -- segundos
    file_name       TEXT NOT NULL,                  -- nome original
    file_path       TEXT NOT NULL,                  -- nome do arquivo em storage/music
    file_size       INTEGER NOT NULL,
    mime            TEXT NOT NULL,
    cover_file      TEXT,                           -- nome do arquivo em storage/covers
    favorite        INTEGER NOT NULL DEFAULT 0,
    favorited_at    TEXT,
    play_count      INTEGER NOT NULL DEFAULT 0,
    last_played_at  TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_tracks_artist ON tracks(artist_id);
  CREATE INDEX idx_tracks_album ON tracks(album_id);
  CREATE UNIQUE INDEX idx_tracks_file ON tracks(file_name, file_size);

  CREATE TABLE playlists (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    added_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (playlist_id, track_id)
  );

  -- histórico: cada vez que uma música toca (usado nas estatísticas e "Mais tocadas")
  CREATE TABLE plays (
    id          INTEGER PRIMARY KEY,
    track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    seconds     REAL NOT NULL DEFAULT 0,
    played_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_plays_date ON plays(played_at);

  -- ajustes do app (cor de destaque, equalizador, etc.) como chave/valor
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM _migrations').get().v;
  migrations.forEach((sql, i) => {
    const version = i + 1;
    if (version <= done) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (version, applied_at) VALUES (?, datetime('now'))").run(version);
      db.exec('COMMIT');
      console.log(`Banco atualizado para a versão ${version}`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });
}
migrate();

// Executa várias operações como uma só (tudo ou nada)
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
