// API REST do Meu Player. Só usa módulos nativos do Node (http, fs, sqlite).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as repo from './repo.js';

// ---------- Mini roteador ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler });
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Arquivo grande demais')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido'); }
}

// Envia um arquivo com suporte a "Range" (necessário para avançar a música no player)
function sendFile(req, res, filePath, mime) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { throw new HttpError(404, 'Arquivo não encontrado'); }
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000' };
  if (range) {
    const start = range[1] ? parseInt(range[1], 10) : stat.size - parseInt(range[2], 10);
    const end = range[1] && range[2] ? Math.min(parseInt(range[2], 10), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
  }
}

const need = (v, msg) => { if (!v) throw new HttpError(404, msg); return v; };

// ---------- Rotas ----------

route('GET', '/api/health', () => ({ ok: true }));

// Músicas
route('GET', '/api/tracks', ({ query }) => repo.listTracks({
  q: query.get('q'), artist: query.get('artist'), album: query.get('album'),
  favorite: query.get('favorite') === '1', sort: query.get('sort') || 'title', limit: query.get('limit'),
}));
route('GET', '/api/tracks/:id', ({ params }) => need(repo.getTrack(params.id), 'Música não encontrada'));

// Upload: corpo = o próprio arquivo; nome no cabeçalho X-File-Name
route('POST', '/api/tracks', async ({ req, res }) => {
  const name = req.headers['x-file-name'] ? decodeURIComponent(req.headers['x-file-name']) : null;
  if (!name) throw new HttpError(400, 'Envie o nome do arquivo no cabeçalho X-File-Name');
  const buf = await readBody(req, config.maxUpload);
  if (!buf.length) throw new HttpError(400, 'Arquivo vazio');
  const { track, created } = repo.addTrack(buf, path.basename(name), { duration: req.headers['x-duration'] });
  return send(res, created ? 201 : 200, { ...track, created });
});

route('PATCH', '/api/tracks/:id', async ({ req, params }) =>
  need(repo.updateTrack(params.id, await readJson(req)), 'Música não encontrada'));

route('DELETE', '/api/tracks/:id', ({ params, res }) => {
  need(repo.deleteTrack(params.id), 'Música não encontrada');
  res.writeHead(204).end();
});

route('GET', '/api/tracks/:id/audio', ({ req, res, params }) => {
  const f = need(repo.getTrackFile(params.id), 'Música não encontrada');
  sendFile(req, res, f.audioPath, f.mime);
});

route('GET', '/api/tracks/:id/cover', ({ req, res, params }) => {
  const f = need(repo.getTrackFile(params.id), 'Música não encontrada');
  need(f.coverPath, 'Essa música não tem capa');
  sendFile(req, res, f.coverPath, f.coverPath.endsWith('.png') ? 'image/png' : 'image/jpeg');
});

// Trocar capa: corpo = a imagem (Content-Type image/jpeg, image/png ou image/webp)
route('PUT', '/api/tracks/:id/cover', async ({ req, params }) => {
  const buf = await readBody(req, 10 * 1024 * 1024);
  if (!buf.length) throw new HttpError(400, 'Envie a imagem no corpo da requisição');
  return need(repo.setCover(params.id, buf, (req.headers['content-type'] || '').split(';')[0]), 'Música não encontrada');
});
route('DELETE', '/api/tracks/:id/cover', ({ params }) => need(repo.setCover(params.id, null), 'Música não encontrada'));

route('POST', '/api/tracks/:id/play', async ({ req, params }) => {
  const { seconds } = await readJson(req);
  need(repo.registerPlay(params.id, seconds), 'Música não encontrada');
  return { ok: true };
});

// Artistas e álbuns
route('GET', '/api/artists', () => repo.listArtists());
route('GET', '/api/artists/:id/tracks', ({ params }) => repo.listTracks({ artist: params.id }));
route('GET', '/api/albums', () => repo.listAlbums());
route('GET', '/api/albums/:id', ({ params }) => need(repo.getAlbum(Number(params.id)), 'Álbum não encontrado'));

// Favoritos
route('GET', '/api/favorites', () => repo.listTracks({ favorite: true, sort: 'favorited' }));

// Playlists
route('GET', '/api/playlists', () => repo.listPlaylists());
route('GET', '/api/playlists/smart/:kind', ({ params }) => need(repo.smartPlaylist(params.kind), 'Playlist automática não existe'));
route('POST', '/api/playlists', async ({ req, res }) => {
  const { name, trackIds = [] } = await readJson(req);
  if (!name || !String(name).trim()) throw new HttpError(400, 'Dê um nome para a playlist');
  for (const id of trackIds) need(repo.getTrack(id), `Música ${id} não encontrada`);
  send(res, 201, repo.createPlaylist(String(name).trim(), trackIds));
});
route('GET', '/api/playlists/:id', ({ params }) => need(repo.getPlaylist(Number(params.id)), 'Playlist não encontrada'));
route('PATCH', '/api/playlists/:id', async ({ req, params }) => {
  const { name, trackIds } = await readJson(req);
  const id = Number(params.id);
  need(repo.getPlaylist(id), 'Playlist não encontrada');
  if (name) repo.renamePlaylist(id, String(name).trim());
  if (Array.isArray(trackIds)) repo.reorderPlaylist(id, trackIds);
  return repo.getPlaylist(id);
});
route('DELETE', '/api/playlists/:id', ({ params, res }) => {
  need(repo.deletePlaylist(Number(params.id)), 'Playlist não encontrada');
  res.writeHead(204).end();
});
route('POST', '/api/playlists/:id/tracks', async ({ req, params }) => {
  const { trackId } = await readJson(req);
  const id = Number(params.id);
  need(repo.getPlaylist(id), 'Playlist não encontrada');
  need(trackId && repo.getTrack(trackId), 'Música não encontrada');
  repo.addToPlaylist(id, trackId);
  return repo.getPlaylist(id);
});
route('DELETE', '/api/playlists/:id/tracks/:trackId', ({ params }) => {
  const id = Number(params.id);
  need(repo.removeFromPlaylist(id, params.trackId), 'Essa música não está na playlist');
  return repo.getPlaylist(id);
});

// Estatísticas e ajustes
route('GET', '/api/stats', () => repo.weekStats());
route('GET', '/api/settings', () => repo.getSettings());
route('PUT', '/api/settings', async ({ req }) => repo.saveSettings(await readJson(req)));

// ---------- Front-end (arquivos estáticos) ----------
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.resolve(config.frontendDir, '.' + rel);
  if (!file.startsWith(config.frontendDir + path.sep)) throw new HttpError(403, 'Proibido');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'Página não encontrada');
  res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// ---------- Servidor ----------
export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name, X-Duration, Range');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') throw new HttpError(405, 'Método não permitido');
      return serveStatic(req, res, url.pathname);
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const result = await r.handler({ req, res, params, query: url.searchParams });
      if (!res.headersSent && result !== undefined) send(res, 200, result);
      return;
    }
    throw new HttpError(404, 'Rota não encontrada');
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Erro interno' : e.message });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  server.listen(config.port, () => {
    console.log(`Meu Player rodando em http://localhost:${config.port}`);
    console.log(`Banco de dados: ${config.dbFile}`);
    console.log(`Músicas salvas em: ${config.musicDir}`);
  });
}
