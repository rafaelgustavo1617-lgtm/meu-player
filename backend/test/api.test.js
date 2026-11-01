// Testes da API: rodam com "npm test" usando um banco temporário.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meu-player-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.MUSIC_DIR = path.join(tmp, 'music');
process.env.COVERS_DIR = path.join(tmp, 'covers');

const { server } = await import('../src/server.js');
let base;

before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const api = async (method, url, body, headers = {}) => {
  const isBuf = Buffer.isBuffer(body);
  const res = await fetch(base + url, {
    method,
    headers: isBuf ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : isBuf ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

// MP3 mínimo: tag ID3v2.3 com título/artista/álbum + 1 frame MPEG1 128 kbps
function fakeMp3(title, artist, album) {
  const frame = (id, text) => {
    const data = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
    const h = Buffer.alloc(10);
    h.write(id, 0, 'latin1');
    h.writeUInt32BE(data.length, 4);
    return Buffer.concat([h, data]);
  };
  const frames = Buffer.concat([frame('TIT2', title), frame('TPE1', artist), frame('TALB', album)]);
  const size = frames.length;
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0,
    (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  const audio = Buffer.alloc(16000 * 3); // ~3 s a 128 kbps
  for (let i = 0; i < audio.length; i += 418) audio.set([0xff, 0xfb, 0x90, 0x00], i);
  return Buffer.concat([header, frames, audio]);
}

let trackId;

test('envia uma música e lê as tags', async () => {
  const r = await api('POST', '/api/tracks', fakeMp3('Noite em Santos', 'Banda da Garagem', 'Estrada'),
    { 'X-File-Name': encodeURIComponent('noite.mp3'), 'Content-Type': 'audio/mpeg' });
  assert.equal(r.status, 201);
  assert.equal(r.body.title, 'Noite em Santos');
  assert.equal(r.body.artist, 'Banda da Garagem');
  assert.equal(r.body.album, 'Estrada');
  assert.ok(r.body.duration > 2 && r.body.duration < 4, `duração ${r.body.duration}`);
  trackId = r.body.id;
});

test('não duplica a mesma música', async () => {
  const r = await api('POST', '/api/tracks', fakeMp3('Noite em Santos', 'Banda da Garagem', 'Estrada'),
    { 'X-File-Name': 'noite.mp3' });
  assert.equal(r.status, 200);
  assert.equal(r.body.created, false);
  assert.equal((await api('GET', '/api/tracks')).body.length, 1);
});

test('usa o nome do arquivo quando não há tags', async () => {
  const r = await api('POST', '/api/tracks', Buffer.alloc(2000, 1), { 'X-File-Name': encodeURIComponent('Lo-fi - Chuva no vidro.wav') });
  assert.equal(r.body.title, 'Chuva no vidro');
  assert.equal(r.body.artist, 'Lo-fi');
});

test('busca, artistas e álbuns', async () => {
  assert.equal((await api('GET', '/api/tracks?q=chuva')).body.length, 1);
  assert.equal((await api('GET', '/api/artists')).body.length, 2);
  const albums = (await api('GET', '/api/albums')).body;
  assert.equal(albums[0].title, 'Estrada');
  assert.equal((await api('GET', `/api/albums/${albums[0].id}`)).body.tracks.length, 1);
});

test('edita informações e favorita', async () => {
  const r = await api('PATCH', `/api/tracks/${trackId}`, { title: 'Noite em Santos (ao vivo)', favorite: true });
  assert.equal(r.body.title, 'Noite em Santos (ao vivo)');
  assert.equal(r.body.favorite, true);
  assert.equal((await api('GET', '/api/favorites')).body.length, 1);
});

test('toca o áudio com Range', async () => {
  const res = await fetch(`${base}/api/tracks/${trackId}/audio`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, 100);
});

test('registra reprodução e estatísticas', async () => {
  await api('POST', `/api/tracks/${trackId}/play`, { seconds: 180 });
  const t = (await api('GET', `/api/tracks/${trackId}`)).body;
  assert.equal(t.play_count, 1);
  const stats = (await api('GET', '/api/stats')).body;
  assert.equal(stats.days[0].seconds, 180);
  assert.equal((await api('GET', '/api/playlists/smart/mais-tocadas')).body.length, 1);
});

test('playlists: criar, adicionar, remover, excluir', async () => {
  const p = (await api('POST', '/api/playlists', { name: 'Pra treinar' })).body;
  let r = await api('POST', `/api/playlists/${p.id}/tracks`, { trackId });
  assert.equal(r.body.tracks.length, 1);
  r = await api('DELETE', `/api/playlists/${p.id}/tracks/${trackId}`);
  assert.equal(r.body.tracks.length, 0);
  assert.equal((await api('DELETE', `/api/playlists/${p.id}`)).status, 204);
  assert.equal((await api('GET', `/api/playlists/${p.id}`)).status, 404);
});

test('troca e remove a capa', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ff3f0005fe02fe0def46b80000000049454e44ae426082', 'hex');
  let r = await api('PUT', `/api/tracks/${trackId}/cover`, png, { 'Content-Type': 'image/png' });
  assert.equal(r.status, 200);
  assert.equal(r.body.track.has_cover, true);
  const img = await fetch(`${base}/api/tracks/${trackId}/cover`);
  assert.equal(img.headers.get('content-type'), 'image/png');
  r = await api('DELETE', `/api/tracks/${trackId}/cover`);
  assert.equal(r.body.track.has_cover, false);
  assert.equal(fs.readdirSync(process.env.COVERS_DIR).length, 0);
});

test('ajustes', async () => {
  const r = await api('PUT', '/api/settings', { accent: '#F0B44C', equalizer: 'Graves' });
  assert.equal(r.body.equalizer, 'Graves');
});

test('apagar música remove arquivo e artista órfão', async () => {
  assert.equal((await api('DELETE', `/api/tracks/${trackId}`)).status, 204);
  assert.equal(fs.readdirSync(process.env.MUSIC_DIR).length, 1);
  assert.equal((await api('GET', '/api/artists')).body.length, 1);
});
