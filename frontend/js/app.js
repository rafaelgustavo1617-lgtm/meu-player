// Meu Player — interface: telas, navegação e ligação com o banco local e o player.
import * as db from './db.js';
import { readMetadata } from './metadata.js';
import { Player, EQ_BANDS, EQ_PRESETS } from './player.js';
import { I } from './icons.js';
import { art, mosaic, coverKey, coverUrl, forgetCover, tintFor, prepareCover, waveHeights, PALETTE } from './covers.js';

const VERSION = '2.0';
const REPO_URL = 'https://github.com/rafaelgustavo1617-lgtm/meu-player';
const ACCENTS = [['#F0B44C', 'Âmbar'], ['#7FC8A9', 'Verde'], ['#8FA8FF', 'Azul'], ['#F28C7A', 'Coral']];

const player = new Player();
const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');

const state = {
  tracks: [],
  playlists: [],
  route: { name: 'home', params: {} },
  query: '',
  libTab: 'songs',          // songs | albums | artists | playlists
  favSort: 'recent',        // recent | az | artist
  importing: null,          // { done, total, files: [{ name, status }] }
  storage: null,
  installPrompt: null,
  npOpen: false,
  visible: [],              // lista na tela (vira a fila ao tocar)
  context: '',
  settings: { accent: '#F0B44C', name: '', resume: true, eqPreset: 'Normal', eqGains: [0, 0, 0, 0, 0, 0], normalize: false },
  listen: {},               // { 'AAAA-MM-DD': segundos }
  coverTarget: null,
};

// ---------- Utilitários ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const byTitle = (a, b) => a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' });
const trackById = (id) => state.tracks.find((t) => t.id === id);
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function fmtTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
function fmtTotal(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (!h && !m) return sec > 0 ? '< 1 min' : '0 min';
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
function fmtBytes(b) {
  if (!b) return '0 MB';
  if (b > 1e9) return (b / 1e9).toFixed(1).replace('.', ',') + ' GB';
  return Math.max(1, Math.round(b / 1e6)) + ' MB';
}
const totalDuration = (list) => list.reduce((s, t) => s + (t.duration || 0), 0);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

// ---------- Dados derivados: álbuns, artistas, playlists automáticas ----------
function albums() {
  const map = new Map();
  for (const t of state.tracks) {
    if (!t.album) continue;
    const key = `${t.artist}|${t.album}`;
    if (!map.has(key)) map.set(key, { key, title: t.album, artist: t.artist, tracks: [], year: null, lastPlayed: 0 });
    const a = map.get(key);
    a.tracks.push(t);
    a.year = a.year || t.year || null;
    a.lastPlayed = Math.max(a.lastPlayed, t.lastPlayed || 0);
  }
  for (const a of map.values()) a.tracks.sort((x, y) => (x.trackNumber || 999) - (y.trackNumber || 999) || byTitle(x, y));
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}
function artists() {
  const map = new Map();
  for (const t of state.tracks) {
    const k = t.artist || 'Artista desconhecido';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return [...map.entries()].map(([name, tracks]) => ({ name, tracks })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
const SMART = {
  mais: { name: 'Mais tocadas', icon: '↑', bg: '#E8805F', fg: '#2A0F08',
    list: () => state.tracks.filter((t) => t.playCount > 0).sort((a, b) => b.playCount - a.playCount).slice(0, 50) },
  novas: { name: 'Adicionadas agora', icon: '+', bg: '#9CC3E0', fg: '#0E1D2B',
    list: () => state.tracks.slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, 50) },
  nunca: { name: 'Nunca tocadas', icon: '?', bg: '#7FBF9C', fg: '#0D2219',
    list: () => state.tracks.filter((t) => !t.playCount && !t.lastPlayed).sort(byTitle) },
  recentes: { name: 'Tocadas recentemente', icon: '↺', bg: '#C59BE0', fg: '#1E0F2B',
    list: () => state.tracks.filter((t) => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 50) },
};

// ---------- Navegação (com o botão voltar do celular) ----------
function go(name, params = {}, { replace = false } = {}) {
  if (state.npOpen) closeNP(true);
  state.route = { name, params };
  history[replace ? 'replaceState' : 'pushState']({ route: state.route }, '');
  render(true);
  window.scrollTo(0, 0);
}
function back() {
  if (history.state && history.length > 1 && !history.state.first) history.back();
  else go('home', {}, { replace: true });
}
window.addEventListener('popstate', (e) => {
  const s = e.state;
  if (s && s.np) { if (!state.npOpen) openNP(false); return; }
  if (state.npOpen) closeNP(true);
  state.route = (s && s.route) || { name: 'home', params: {} };
  render(true);
});

// ---------- Componentes ----------
function trackRow(t, opts = {}) {
  const cur = player.current && player.current.id === t.id;
  const lead = opts.num !== undefined
    ? `<span class="num">${cur ? '▶' : opts.num}</span>`
    : `<div style="position:relative">${art(t)}${cur ? `<div class="eq-bars${player.playing ? '' : ' paused'}" style="border-radius:8px"><span></span><span></span><span></span></div>` : ''}</div>`;
  const sub = opts.sub ?? [t.artist, opts.num !== undefined ? null : fmtTime(t.duration)].filter(Boolean).join(' · ');
  return `<li class="row${cur ? ' is-current' : ''}">
    <button class="row-main" data-action="play" data-id="${t.id}">
      ${lead}
      <span class="row-text"><span class="row-title">${esc(t.title)}</span><span class="row-sub">${esc(sub)}</span></span>
      ${opts.num !== undefined ? `<span class="dur">${fmtTime(t.duration)}</span>` : ''}
      ${!opts.fav && t.fav ? `<span class="mini-heart">${I.heart(true, 14)}</span>` : ''}
    </button>
    ${opts.fav ? `<button class="icon-btn fav-on" data-action="fav" data-id="${t.id}" aria-label="Remover dos favoritos">${I.heart(true)}</button>` : ''}
    <button class="icon-btn" data-action="track-menu" data-id="${t.id}" aria-label="Mais opções para ${esc(t.title)}">${I.more()}</button>
  </li>`;
}
const trackList = (list, opts) => `<ul class="list">${list.map((t, i) => trackRow(t, typeof opts === 'function' ? opts(t, i) : opts || {})).join('')}</ul>`;

function playButtons(label = 'Tocar') {
  return `<div class="btn-row" style="margin:16px 0 8px">
    <button class="btn primary" data-action="play-all">${I.play(18)} ${label}</button>
    <button class="btn soft" data-action="shuffle-all">${I.shuffle(18)} Aleatório</button></div>`;
}

function backBtn() {
  return `<button class="icon-btn glass" data-action="back" aria-label="Voltar">${I.back()}</button>`;
}

function emptyHero() {
  return `<div class="hero">
    <div class="hero-icon">${I.upload(30)}</div>
    <h2>Traga suas músicas</h2>
    <p>Escolha os arquivos de música do seu aparelho. Eles ficam guardados aqui e tocam sem internet.</p>
    <div class="btn-row"><button class="btn primary" data-action="pick-files">Escolher arquivos</button>
    ${folderSupported() ? '<button class="btn" data-action="pick-folder">Escolher pasta</button>' : ''}</div>
  </div>`;
}
const folderSupported = () => 'webkitdirectory' in document.createElement('input') && !/iPhone|iPad|iPod|Android/.test(navigator.userAgent);

// ---------- Telas ----------
function viewHome() {
  const h = new Date().getHours();
  const hello = h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const name = state.settings.name.trim();
  const date = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const head = `<div class="top">
      <div class="top-left" style="flex-direction:column;align-items:flex-start;gap:2px">
        <span class="sub" style="font-weight:500">${esc(date.charAt(0).toUpperCase() + date.slice(1))}</span>
        <h1 style="font-size:28px">${hello}${name ? ', ' + esc(name) : ''}</h1>
      </div>
      <div class="top-actions">
        <button class="icon-btn" data-action="search" aria-label="Buscar">${I.search()}</button>
        <button class="avatar" data-action="nav" data-to="settings" aria-label="Ajustes">${esc(name ? name[0].toUpperCase() : '♪')}</button>
      </div>
    </div>
    <div class="status"><span class="dot${navigator.onLine ? ' online' : ''}"></span>
      <span class="grow">${navigator.onLine ? 'Online' : 'Modo offline'} · ${plural(state.tracks.length, 'música', 'músicas')} no aparelho</span>
      <button class="link-btn" data-action="nav" data-to="import">Importar</button></div>`;

  if (!state.tracks.length) return head + emptyHero() + installCard();

  // atalhos rápidos
  const quick = [];
  const favs = state.tracks.filter((t) => t.fav);
  quick.push(`<button class="quick-item" data-action="nav" data-to="favorites"><span class="badge-art">${I.heart(true, 24)}</span>Favoritas</button>`);
  const rec = SMART.recentes.list();
  quick.push(`<button class="quick-item" data-action="nav" data-to="smart" data-id="${rec.length ? 'recentes' : 'novas'}">${art(rec[0] || SMART.novas.list()[0])}${rec.length ? 'Tocadas recentemente' : 'Adicionadas agora'}</button>`);
  for (const p of state.playlists.slice(0, 2)) {
    const ts = p.trackIds.map(trackById).filter(Boolean);
    quick.push(`<button class="quick-item" data-action="nav" data-to="playlist" data-id="${p.id}">${mosaic(ts, '', p.name)}${esc(p.name)}</button>`);
  }
  for (const a of albums().sort((x, y) => y.lastPlayed - x.lastPlayed)) {
    if (quick.length >= 6) break;
    quick.push(`<button class="quick-item" data-action="nav" data-to="album" data-id="${esc(a.key)}">${art(a.tracks.find((t) => t.cover) || a.tracks[0])}${esc(a.title)}</button>`);
  }
  if (quick.length < 6) quick.push(`<button class="quick-item" data-action="nav" data-to="smart" data-id="nunca">${art(null, '', 'nunca')}Nunca tocadas</button>`);

  // continue ouvindo: últimos álbuns/músicas tocados
  const seen = new Set();
  const cont = [];
  for (const t of rec) {
    const k = t.album ? `${t.artist}|${t.album}` : t.id;
    if (seen.has(k)) continue;
    seen.add(k);
    cont.push(t);
    if (cont.length === 8) break;
  }
  const contHtml = cont.length ? `<div class="section"><div class="section-head"><h2>Continue ouvindo</h2></div>
    <div class="hscroll">${cont.map((t) => {
      const isCur = player.current && player.current.id === t.id;
      const pct = isCur && player.audio.duration ? (player.audio.currentTime / player.audio.duration) * 100 : 0;
      return `<button class="tile" data-action="${t.album ? 'nav' : 'play-one'}" data-to="album" data-id="${t.album ? esc(`${t.artist}|${t.album}`) : t.id}">
        <div style="position:relative">${art(t, 'xl')}${pct ? `<div class="progress-strip"><div style="width:${pct}%"></div></div>` : ''}</div>
        <span class="tile-title">${esc(t.album || t.title)}</span><span class="row-sub">${esc(t.artist)}</span></button>`;
    }).join('')}</div></div>` : '';

  const al = albums();
  const albumsHtml = al.length ? `<div class="section"><div class="section-head"><h2>Seus álbuns</h2>
      <button class="link-btn" data-action="lib-tab" data-tab="albums">Ver tudo</button></div>
    <div class="hscroll">${al.slice(0, 10).map((a) => `<button class="tile" data-action="nav" data-to="album" data-id="${esc(a.key)}">
      ${art(a.tracks.find((t) => t.cover) || a.tracks[0], 'xl')}<span class="tile-title">${esc(a.title)}</span><span class="row-sub">${esc(a.artist)}</span></button>`).join('')}</div></div>` : '';

  return head + `<div class="quick">${quick.join('')}</div>` + contHtml + albumsHtml + statsCard();
}

function statsCard() {
  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({ key: dayKey(d), label: 'DSTQQSS'[d.getDay()], today: i === 0 });
  }
  const vals = days.map((d) => state.listen[d.key] || 0);
  const week = vals.reduce((a, b) => a + b, 0);
  let prev = 0;
  for (let i = 7; i < 14; i++) { const d = new Date(today); d.setDate(d.getDate() - i); prev += state.listen[dayKey(d)] || 0; }
  const max = Math.max(...vals, 1);
  const diff = prev ? Math.round(((week - prev) / prev) * 100) : null;
  return `<div class="section card">
    <div class="stats-top"><div><div class="eyebrow">Últimos 7 dias</div><div class="stats-big">${fmtTotal(week)}</div></div>
    ${diff !== null ? `<span class="sub" style="color:${diff >= 0 ? 'var(--ok)' : 'var(--muted)'};font-weight:600">${diff >= 0 ? '+' : ''}${diff}% que a semana anterior</span>` : '<span class="sub">tempo ouvindo música</span>'}</div>
    <div class="week">${days.map((d, i) => `<div><div class="bar${d.today ? ' today' : ''}" style="height:${Math.round((vals[i] / max) * 52)}px" title="${fmtTotal(vals[i])}"></div><small>${d.label}</small></div>`).join('')}</div>
  </div>`;
}

function installCard() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return '';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return `<div class="section card">
    <div style="display:flex;gap:12px;align-items:center"><div class="hero-icon" style="width:44px;height:44px;border-radius:12px">${I.phone()}</div>
    <div><div style="font-weight:600">Instalar no celular</div><div class="sub">Abre como app e funciona sem internet</div></div></div>
    ${state.installPrompt ? '<button class="btn primary" style="width:100%;margin-top:14px" data-action="install">Instalar app</button>'
      : ios ? '<ol class="tips"><li>Abra no <b>Safari</b>.</li><li>Toque em <b>Compartilhar</b>.</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li></ol>'
      : '<ol class="tips"><li>Abra no <b>Chrome</b>.</li><li>Toque no menu <b>⋮</b>.</li><li>Escolha <b>Instalar app</b>.</li></ol>'}
  </div>`;
}

function viewLibrary() {
  const q = state.query.trim().toLowerCase();
  const head = `<div class="top"><h1>Biblioteca</h1>
      <button class="icon-btn" data-action="nav" data-to="import" aria-label="Importar músicas">${I.plus()}</button></div>
    <label class="search">${I.search(18)}<span class="sr-only">Buscar na biblioteca</span>
      <input id="search" type="search" placeholder="Buscar músicas, artistas, álbuns" value="${esc(state.query)}" autocomplete="off" enterkeyhint="search"></label>
    <div class="chips" role="group" aria-label="Mostrar">
      ${[['songs', 'Músicas'], ['albums', 'Álbuns'], ['artists', 'Artistas'], ['playlists', 'Playlists']].map(([k, l]) =>
        `<button class="chip" data-action="lib-tab" data-tab="${k}" aria-pressed="${state.libTab === k}">${l}</button>`).join('')}
    </div><div style="height:18px"></div>`;
  if (!state.tracks.length && state.libTab !== 'playlists') return head + emptyHero();

  if (state.libTab === 'albums') {
    const list = albums().filter((a) => !q || `${a.title} ${a.artist}`.toLowerCase().includes(q));
    return head + (list.length ? `<div class="grid-albums">${list.map((a) => `<button class="tile" data-action="nav" data-to="album" data-id="${esc(a.key)}">
      ${art(a.tracks.find((t) => t.cover) || a.tracks[0], 'xl')}<span class="tile-title">${esc(a.title)}</span>
      <span class="row-sub">${esc(a.artist)} · ${plural(a.tracks.length, 'música', 'músicas')}</span></button>`).join('')}</div>`
      : '<div class="empty"><strong>Nenhum álbum</strong>Músicas com o nome do álbum nas informações aparecem aqui. Você pode editar pelo menu ⋮ de cada música.</div>');
  }
  if (state.libTab === 'artists') {
    const list = artists().filter((a) => !q || a.name.toLowerCase().includes(q));
    return head + `<ul class="list">${list.map((a) => `<li class="row"><button class="row-main" data-action="nav" data-to="artist" data-id="${esc(a.name)}">
      <div class="art" style="border-radius:999px">${art(a.tracks.find((t) => t.cover) || a.tracks[0]).replace('class="art', 'style="width:100%;height:100%;border-radius:0" class="art')}</div>
      <span class="row-text"><span class="row-title">${esc(a.name)}</span><span class="row-sub">${plural(a.tracks.length, 'música', 'músicas')}</span></span>${I.right()}
      </button></li>`).join('')}</ul>`;
  }
  if (state.libTab === 'playlists') return head + playlistsSection();

  let list = state.tracks.slice();
  if (q) list = list.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q));
  list.sort(byTitle);
  state.visible = list;
  state.context = q ? `Busca “${state.query.trim()}”` : 'Biblioteca';
  return head + `<div style="display:flex;justify-content:space-between;align-items:center">
      <span class="sub" style="display:flex;gap:6px;align-items:center;color:var(--text-2)">${I.sort()} A–Z</span>
      <span class="sub">${plural(list.length, 'música', 'músicas')} · ${fmtTotal(totalDuration(list))}</span></div>
    ${list.length ? playButtons('Tocar tudo') + trackList(list) : '<div class="empty">Nada encontrado.</div>'}`;
}

function playlistsSection() {
  const lists = state.playlists.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return `<div class="section-head" style="margin-top:0"><div><h2>Automáticas</h2><div class="sub" style="margin-top:2px">Atualizadas sozinhas com o que você ouve</div></div></div>
    <div class="smart-grid">${['mais', 'novas', 'nunca'].map((k) => `<button class="smart" style="background:${SMART[k].bg};color:${SMART[k].fg}" data-action="nav" data-to="smart" data-id="${k}">
      <span>${SMART[k].icon}</span>${SMART[k].name}</button>`).join('')}</div>
    <div class="section"><div class="section-head"><h2>Suas playlists</h2>
      <button class="icon-btn accent" style="width:40px;height:40px" data-action="new-playlist" aria-label="Nova playlist">${I.plus(20)}</button></div>
    ${lists.length ? `<ul class="list">${lists.map((p) => {
      const ts = p.trackIds.map(trackById).filter(Boolean);
      return `<li class="row"><button class="row-main" data-action="nav" data-to="playlist" data-id="${p.id}">${mosaic(ts, 'lg', p.name)}
        <span class="row-text"><span class="row-title" style="font-size:16px">${esc(p.name)}</span>
        <span class="row-sub">${plural(ts.length, 'música', 'músicas')}${ts.length ? ' · ' + fmtTotal(totalDuration(ts)) : ''}</span></span>${I.right()}</button></li>`;
    }).join('')}</ul>` : '<div class="empty"><strong>Nenhuma playlist ainda</strong>Toque no + para criar e adicione músicas pelo menu ⋮.</div>'}</div>`;
}

function detailHead({ cover, eyebrow, title, sub, actions = '' }) {
  return `<div class="top">${backBtn()}${actions}</div>
    <div class="detail-head">${cover}
      <div class="detail-meta"><span class="eyebrow">${eyebrow}</span><h1>${esc(title)}</h1><span class="sub">${sub}</span></div></div>`;
}

function viewAlbum({ id }) {
  const a = albums().find((x) => x.key === id);
  if (!a) return notFound();
  state.visible = a.tracks;
  state.context = a.title;
  const coverTrack = a.tracks.find((t) => t.cover) || a.tracks[0];
  return `<div class="tinted" data-tint="${coverTrack.id}">` + detailHead({
    cover: art(coverTrack, 'detail-cover'),
    eyebrow: 'Álbum', title: a.title,
    sub: `<button class="link-btn" style="color:var(--text);padding:0;font-size:14px" data-action="nav" data-to="artist" data-id="${esc(a.artist)}">${esc(a.artist)}</button>${a.year ? ' · ' + a.year : ''} · ${plural(a.tracks.length, 'música', 'músicas')} · ${fmtTotal(totalDuration(a.tracks))}`,
  }) + playButtons() + trackList(a.tracks, (t, i) => ({ num: t.trackNumber || i + 1, sub: t.artist })) + '</div>';
}

function viewArtist({ id }) {
  const a = artists().find((x) => x.name === id);
  if (!a) return notFound();
  const list = a.tracks.slice().sort(byTitle);
  state.visible = list;
  state.context = a.name;
  const al = albums().filter((x) => x.artist === a.name);
  const coverTrack = a.tracks.find((t) => t.cover) || a.tracks[0];
  return `<div class="tinted" data-tint="${coverTrack.id}">` + detailHead({
    cover: `<div class="detail-cover" style="border-radius:999px;overflow:hidden">${art(coverTrack, '', undefined).replace('class="art', 'style="width:100%;height:100%;border-radius:0" class="art')}</div>`,
    eyebrow: 'Artista', title: a.name,
    sub: `${plural(list.length, 'música', 'músicas')}${al.length ? ' · ' + plural(al.length, 'álbum', 'álbuns') : ''}`,
  }) + playButtons() + (al.length ? `<div class="section"><div class="section-head"><h2>Álbuns</h2></div><div class="hscroll">${al.map((x) => `<button class="tile" data-action="nav" data-to="album" data-id="${esc(x.key)}">
      ${art(x.tracks.find((t) => t.cover) || x.tracks[0], 'xl')}<span class="tile-title">${esc(x.title)}</span><span class="row-sub">${x.year || plural(x.tracks.length, 'música', 'músicas')}</span></button>`).join('')}</div></div>` : '')
    + `<div class="section"><div class="section-head"><h2>Músicas</h2></div>${trackList(list)}</div></div>`;
}

function viewFavorites() {
  let list = state.tracks.filter((t) => t.fav);
  if (state.favSort === 'az') list.sort(byTitle);
  else if (state.favSort === 'artist') list.sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'pt-BR') || byTitle(a, b));
  else list.sort((a, b) => (b.favAt || 0) - (a.favAt || 0));
  state.visible = list;
  state.context = 'Favoritos';
  const head = `<div class="tinted" style="--tint:color-mix(in srgb, var(--accent) 32%, #0c0d0f)">
    <div class="fav-head"><div class="fav-badge">${I.heart(true, 44)}</div>
      <div><h1>Favoritos</h1><div class="sub" style="color:var(--text-2);margin-top:4px">${plural(list.length, 'música', 'músicas')}${list.length ? ' · ' + fmtTotal(totalDuration(list)) : ''}</div></div></div>`;
  if (!list.length) return head + '<div class="empty"><strong>Nenhum favorito ainda</strong>Toque no coração de uma música para guardar aqui.</div></div>';
  // agrupamento por data quando ordenado por "Recentes"
  let rows = '';
  if (state.favSort === 'recent') {
    let lastLabel = null;
    const weekAgo = Date.now() - 7 * 864e5;
    for (const t of list) {
      const d = new Date(t.favAt || t.addedAt);
      const label = (t.favAt || 0) > weekAgo ? 'Esta semana' : d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      if (label !== lastLabel) { rows += `</ul><div class="group-label">${esc(label)}</div><ul class="list">`; lastLabel = label; }
      rows += trackRow(t, { fav: true });
    }
    rows = `<ul class="list">${rows}</ul>`;
  } else rows = trackList(list, { fav: true });
  return head + playButtons() + `<div class="chips" style="margin-bottom:12px">
      ${[['recent', 'Recentes'], ['az', 'A–Z'], ['artist', 'Artista']].map(([k, l]) => `<button class="chip light" data-action="fav-sort" data-sort="${k}" aria-pressed="${state.favSort === k}">${l}</button>`).join('')}
    </div>${rows}</div>`;
}

function viewPlaylist({ id }) {
  const p = state.playlists.find((x) => x.id === id);
  if (!p) return notFound();
  const list = p.trackIds.map(trackById).filter(Boolean);
  state.visible = list;
  state.context = p.name;
  const first = list.find((t) => t.cover) || list[0];
  return `<div class="tinted" ${first ? `data-tint="${first.id}"` : ''}>` + detailHead({
    cover: mosaic(list, 'detail-cover', p.name),
    eyebrow: 'Playlist', title: p.name,
    sub: `${plural(list.length, 'música', 'músicas')}${list.length ? ' · ' + fmtTotal(totalDuration(list)) : ''}`,
    actions: `<button class="icon-btn glass" data-action="playlist-menu" aria-label="Opções da playlist">${I.moreH()}</button>`,
  }) + (list.length ? playButtons() + trackList(list)
    : '<div class="empty"><strong>Playlist vazia</strong>Na Biblioteca, toque no ⋮ de uma música e escolha “Adicionar à playlist”.</div>') + '</div>';
}

function viewSmart({ id }) {
  const s = SMART[id];
  if (!s) return notFound();
  const list = s.list();
  state.visible = list;
  state.context = s.name;
  return `<div class="tinted" style="--tint:${s.bg}">` + detailHead({
    cover: `<div class="detail-cover" style="background:${s.bg};color:${s.fg};display:flex;align-items:center;justify-content:center;font:700 80px var(--display)">${s.icon}</div>`,
    eyebrow: 'Playlist automática', title: s.name, sub: plural(list.length, 'música', 'músicas'),
  }) + (list.length ? playButtons() + trackList(list) : '<div class="empty">Ainda não tem músicas aqui. Ela se atualiza sozinha conforme você ouve.</div>') + '</div>';
}

function viewImport() {
  const st = state.storage;
  const used = st ? st.usage : 0;
  const quota = st ? st.quota : 0;
  const imp = state.importing;
  return `<div class="top"><div class="top-left">${backBtn()}<h2>Importar músicas</h2></div></div>
    ${emptyHero().replace('Traga suas músicas', state.tracks.length ? 'Adicionar mais músicas' : 'Traga suas músicas')}
    <div style="margin-top:6px;text-align:center" class="sub">MP3, M4A, FLAC, WAV e OGG</div>
    ${imp ? `<div class="section card">
      <div style="display:flex;justify-content:space-between;align-items:baseline"><b data-imp-count>Importando ${imp.done} de ${imp.total}</b></div>
      <div class="bar-track" style="margin:12px 0 6px"><div data-imp-bar style="width:${(imp.done / imp.total) * 100}%"></div></div>
      <div data-imp-files>${importFilesHtml()}</div></div>` : ''}
    <div class="section card">
      <div class="meter-top"><span>${plural(state.tracks.length, 'música', 'músicas')} no aparelho</span><span>${fmtBytes(used)}${quota ? ' de ' + fmtBytes(quota) : ''}</span></div>
      <div class="bar-track" style="margin-bottom:0"><div style="width:${quota ? Math.max(1, (used / quota) * 100) : 0}%"></div></div>
    </div>
    <div class="section tip">${I.info()}<span>Dica: nomeie os arquivos como <b>Artista - Música.mp3</b>. Se o MP3 já tiver capa, nome e álbum nas informações, o app usa tudo sozinho.</span></div>
    ${installCard()}`;
}
function importFilesHtml() {
  const files = state.importing ? state.importing.files.slice(-5) : [];
  const icon = { done: ['done', '✓'], now: ['now', '•'], skip: ['', '='], fail: ['', '!'] };
  return files.map((f) => `<div class="file-row"><span class="file-icon ${icon[f.status][0]}">${icon[f.status][1]}</span>
    <span class="row-text"><span class="row-title" style="font-weight:500">${esc(f.name)}</span>
    <span class="row-sub" style="font-size:12px">${{ done: 'Pronto', now: 'Lendo informações…', skip: 'Já estava na biblioteca', fail: 'Não consegui ler' }[f.status]}</span></span></div>`).join('');
}

function viewSettings() {
  const st = state.storage;
  const used = st ? st.usage : 0;
  const quota = st ? st.quota : 0;
  const name = state.settings.name.trim();
  return `<div class="top"><h1>Ajustes</h1></div>
    <div class="card" style="display:flex;align-items:center;gap:14px">
      <span class="avatar" style="width:52px;height:52px;font-size:22px">${esc(name ? name[0].toUpperCase() : '♪')}</span>
      <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:16px">${esc(name || 'Meu Player')}</div>
      <div class="sub">${plural(state.tracks.length, 'música', 'músicas')} · ${plural(state.playlists.length, 'playlist', 'playlists')} · ${fmtBytes(used)}</div></div>
    </div>

    <div class="settings-group"><span class="eyebrow">Você</span><div class="settings-card">
      <label class="setting"><span class="setting-text"><span class="setting-title">Seu nome</span><span class="setting-desc">Aparece na saudação do Início</span></span>
        <input class="name-input" id="name-input" type="text" maxlength="24" placeholder="Opcional" value="${esc(state.settings.name)}"></label>
    </div></div>

    <div class="settings-group"><span class="eyebrow">Aparência</span><div class="settings-card">
      <div class="setting"><span class="setting-title">Cor de destaque</span>
        <div class="swatches">${ACCENTS.map(([c, n]) => `<button class="swatch" style="color:${c}" data-action="accent" data-color="${c}" aria-label="Cor ${n}" aria-pressed="${state.settings.accent === c}"><span style="background:${c}"></span></button>`).join('')}</div></div>
    </div></div>

    <div class="settings-group"><span class="eyebrow">Reprodução</span><div class="settings-card">
      <div class="setting"><span class="setting-text"><span class="setting-title">Continuar de onde parou</span><span class="setting-desc">Ao abrir o app de novo</span></span>
        <button class="switch" role="switch" aria-checked="${state.settings.resume}" data-action="toggle-setting" data-key="resume" aria-label="Continuar de onde parou"></button></div>
      <div class="setting"><span class="setting-text"><span class="setting-title">Normalizar volume</span><span class="setting-desc">Todas as músicas no mesmo nível</span></span>
        <button class="switch" role="switch" aria-checked="${state.settings.normalize}" data-action="toggle-normalize" aria-label="Normalizar volume"></button></div>
      <button class="setting" data-action="nav" data-to="eq"><span class="setting-title">Equalizador</span>
        <span class="sub" style="display:flex;align-items:center;gap:6px">${esc(state.settings.eqPreset)} ${I.right(16)}</span></button>
    </div></div>

    <div class="settings-group"><span class="eyebrow">Armazenamento</span><div class="card">
      <div class="meter-top"><span>Músicas no aparelho</span><span>${fmtBytes(used)}${quota ? ' de ' + fmtBytes(quota) : ''}</span></div>
      <div class="bar-track"><div style="width:${quota ? Math.max(1, (used / quota) * 100) : 0}%"></div></div>
      <div class="btn-row"><button class="btn primary" data-action="nav" data-to="import">Importar músicas</button>
      <button class="btn" data-action="export">Fazer backup</button></div>
    </div></div>
    ${installCard()}
    <div class="settings-group"><span class="eyebrow">Sobre</span><div class="settings-card">
      <div class="setting"><span class="setting-title">Versão</span><span class="sub">${VERSION}</span></div>
      <a class="setting" href="${REPO_URL}" target="_blank" rel="noopener"><span class="setting-title" style="display:flex;gap:10px;align-items:center">${I.github()} Código no GitHub</span>${I.right(16)}</a>
    </div></div>`;
}

function viewEq() {
  const on = state.settings.eqPreset !== 'Normal' || state.settings.eqGains.some((g) => g);
  const H = 220;
  return `<div class="top"><div class="top-left">${backBtn()}<h2>Equalizador</h2></div>
      <button class="switch" role="switch" aria-checked="${on}" data-action="eq-toggle" aria-label="Ligar equalizador"></button></div>
    <div class="chips" style="margin-top:0;margin-bottom:20px;flex-wrap:wrap">${[...Object.keys(EQ_PRESETS), 'Personalizado'].map((p) =>
      p === 'Personalizado' && state.settings.eqPreset !== p ? '' :
      `<button class="chip" data-action="eq-preset" data-preset="${p}" aria-pressed="${state.settings.eqPreset === p}">${p}</button>`).join('')}</div>
    <div class="card eq-card${on ? '' : ' eq-off'}">
      <div class="eq-scale"><span>+12 dB</span><span>0 dB</span><span>−12 dB</span></div>
      <div class="eq-bands">${EQ_BANDS.map((hz, i) => {
        const v = state.settings.eqGains[i];
        const y = Math.round(((12 - v) / 24) * H);
        return `<div class="eq-band"><b data-eq-val="${i}">${v > 0 ? '+' : ''}${v}</b>
          <div class="eq-slider"><div class="track"></div><div class="zero"></div>
            <div class="fill" data-eq-fill="${i}" style="top:${Math.min(y, H / 2)}px;height:${Math.abs(y - H / 2)}px"></div>
            <div class="knob" data-eq-knob="${i}" style="top:${y}px"></div>
            <input type="range" min="-12" max="12" step="1" value="${v}" data-eq-band="${i}" aria-label="${hz >= 1000 ? hz / 1000 + ' kHz' : hz + ' Hz'}"></div>
          <small>${hz >= 1000 ? (hz / 1000).toString().replace('.', ',') + 'k' : hz}</small></div>`;
      }).join('')}</div>
    </div>
    <div class="settings-group"><div class="settings-card">
      <div class="setting"><span class="setting-text"><span class="setting-title">Normalizar volume</span><span class="setting-desc">Todas as músicas no mesmo nível</span></span>
        <button class="switch" role="switch" aria-checked="${state.settings.normalize}" data-action="toggle-normalize" aria-label="Normalizar volume"></button></div>
    </div></div>
    <p class="sub" style="margin-top:14px;line-height:1.5">No iPhone, o equalizador pode pausar a música com a tela bloqueada. Se acontecer, use “Normal”.</p>`;
}

function viewQueue() {
  const cur = player.current;
  if (!cur) return `<div class="top"><div class="top-left">${backBtn()}<h2>Fila</h2></div></div><div class="empty">Nada tocando agora.</div>`;
  const up = player.upcoming();
  return `<div class="top"><div class="top-left">${backBtn()}<h2>Fila</h2></div>
      ${up.length ? '<button class="link-btn" data-action="queue-clear">Limpar</button>' : ''}</div>
    <div class="eyebrow" style="margin-bottom:10px">Tocando agora</div>
    <button class="card row-main" style="width:100%;padding:10px" data-action="open-np">
      <div style="position:relative">${art(cur, 'sm')}<div class="eq-bars${player.playing ? '' : ' paused'}" style="border-radius:8px"><span></span><span></span><span></span></div></div>
      <span class="row-text"><span class="row-title" style="color:var(--accent)">${esc(cur.title)}</span><span class="row-sub">${esc(cur.artist)}</span></span></button>
    <div class="btn-row" style="margin:14px 0 20px">
      <button class="btn${player.shuffle ? ' primary' : ''}" style="height:40px" data-action="shuffle">${I.shuffle(16)} Aleatório</button>
      <button class="btn${player.repeat !== 'off' ? ' primary' : ''}" style="height:40px" data-action="repeat">${I.repeat(16)} ${{ off: 'Repetir', all: 'Repetindo todas', one: 'Repetindo uma' }[player.repeat]}</button></div>
    <div class="section-head" style="margin-bottom:4px"><span class="eyebrow">A seguir${player.contextName ? ' · de ' + esc(player.contextName) : ''}</span>
      <span class="sub">${plural(up.length, 'música', 'músicas')} · ${fmtTotal(totalDuration(up))}</span></div>
    ${up.length ? `<ul class="list">${up.map((t, i) => `<li class="row"><button class="row-main" data-action="queue-jump" data-i="${i}">${art(t, 'sm')}
      <span class="row-text"><span class="row-title">${esc(t.title)}</span><span class="row-sub">${esc(t.artist)} · ${fmtTime(t.duration)}</span></span></button>
      <button class="icon-btn" data-action="queue-remove" data-i="${i}" aria-label="Tirar ${esc(t.title)} da fila">${I.x()}</button></li>`).join('')}</ul>`
      : '<div class="empty">Depois desta, a fila acaba.</div>'}`;
}

const notFound = () => `<div class="top">${backBtn()}</div><div class="empty"><strong>Não encontrado</strong>Talvez tenha sido apagado.</div>`;

const VIEWS = { home: viewHome, library: viewLibrary, album: viewAlbum, artist: viewArtist, favorites: viewFavorites,
  playlist: viewPlaylist, smart: viewSmart, import: viewImport, settings: viewSettings, eq: viewEq, queue: viewQueue };
const NAV_OF = { home: 'home', library: 'library', album: 'library', artist: 'library', playlist: 'library', smart: 'library',
  favorites: 'favorites', settings: 'settings', eq: 'settings', import: 'home', queue: 'home' };

function render(animate = false) {
  const { name, params } = state.route;
  document.querySelectorAll('.nav-btn').forEach((b) => {
    if (b.dataset.nav === NAV_OF[name]) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  app.innerHTML = (VIEWS[name] || viewHome)(params);
  if (animate) { app.classList.remove('view-enter'); void app.offsetWidth; app.classList.add('view-enter'); }
  const tintEl = app.querySelector('[data-tint]');
  if (tintEl) tintFor(trackById(tintEl.dataset.tint)).then((c) => tintEl.style.setProperty('--tint', c));
  renderMini();
}

// ---------- Mini player ----------
function renderMini() {
  const mini = $('#mini');
  const t = player.current;
  if (!t) { mini.hidden = true; return; }
  mini.hidden = false;
  mini.innerHTML = `
    <button class="row-main" data-action="open-np" aria-label="Abrir tocando agora">${art(t, 'sm')}
      <span class="row-text"><span class="row-title">${esc(t.title)}</span><span class="row-sub">${esc(t.artist)}</span></span></button>
    <button class="icon-btn ghost" data-action="next" aria-label="Próxima" style="color:var(--text-2)">${I.next(22)}</button>
    <button class="icon-btn accent" data-action="toggle" aria-label="${player.playing ? 'Pausar' : 'Tocar'}">${player.playing ? I.pause(16) : I.play(16)}</button>
    <div class="mini-progress"><div data-mini-bar></div></div>`;
  updateProgress();
}

// ---------- Tocando agora ----------
let seeking = false;
function renderNP() {
  const np = $('#np');
  const t = player.current;
  if (!t) { closeNP(); return; }
  const fresh = trackById(t.id) || t;
  const heights = waveHeights(t.id);
  const sleepOn = !!player.sleepAt;
  np.innerHTML = `<div class="np-inner">
    <div class="np-top">
      <button class="icon-btn glass" data-action="close-np" aria-label="Minimizar">${I.down()}</button>
      <button class="np-ctx" data-action="np-context"><small>Tocando de</small><span>${esc(player.contextName || 'Biblioteca')}</span></button>
      <button class="icon-btn glass" data-action="track-menu" data-id="${t.id}" aria-label="Mais opções">${I.moreH()}</button>
    </div>
    ${art(fresh, 'cover')}
    <div class="np-meta">
      <div><h2 class="np-title">${esc(fresh.title)}</h2>
        <button class="np-artist link-btn" style="color:rgba(244,242,236,.75);padding:0;font-weight:400" data-action="nav" data-to="artist" data-id="${esc(fresh.artist)}">${esc(fresh.artist)}</button></div>
      <button class="icon-btn ghost" style="color:${fresh.fav ? 'var(--accent)' : 'rgba(244,242,236,.75)'}" data-action="fav" data-id="${t.id}" aria-label="${fresh.fav ? 'Remover dos favoritos' : 'Favoritar'}" aria-pressed="${!!fresh.fav}">${I.heart(fresh.fav, 26)}</button>
    </div>
    <div><div class="wave"><div class="wave-bars">${heights.map((h) => `<span style="height:${h}%"></span>`).join('')}</div>
      <input id="seek" type="range" min="0" max="1000" value="0" aria-label="Posição da música"></div>
      <div class="times"><span data-np-cur>0:00</span><span data-np-dur>${fmtTime(fresh.duration)}</span></div></div>
    <div class="controls">
      <button class="icon-btn ${player.shuffle ? 'on' : 'off'}" data-action="shuffle" aria-label="Aleatório" aria-pressed="${player.shuffle}">${I.shuffle(22)}</button>
      <button class="icon-btn big" data-action="prev" aria-label="Anterior">${I.prev()}</button>
      <button class="icon-btn play" data-action="toggle" aria-label="${player.playing ? 'Pausar' : 'Tocar'}">${player.playing ? I.pause(30) : I.play(30)}</button>
      <button class="icon-btn big" data-action="next" aria-label="Próxima">${I.next()}</button>
      <button class="icon-btn ${player.repeat !== 'off' ? 'on' : 'off'}${player.repeat === 'one' ? ' repeat-one' : ''}" data-action="repeat" aria-label="Repetir: ${{ off: 'desligado', all: 'todas', one: 'uma' }[player.repeat]}">${I.repeat()}</button>
    </div>
    <div class="np-tools">
      <button data-action="nav" data-to="queue">${I.queue()}Fila</button>
      <button data-action="nav" data-to="eq" class="${state.settings.eqPreset !== 'Normal' ? 'on' : ''}">${I.eq()}${state.settings.eqPreset !== 'Normal' ? esc(state.settings.eqPreset) : 'Equalizador'}</button>
      <button data-action="sleep-menu" class="${sleepOn ? 'on' : ''}">${I.moon()}<span data-sleep-label>${sleepLabel()}</span></button>
      <button data-action="rate"><span class="rate">${String(player.rate).replace('.', ',')}×</span>Velocidade</button>
    </div></div>`;
  tintFor(fresh).then((c) => np.style.setProperty('--tint', c));
  updateProgress();
}

function sleepLabel() {
  if (!player.sleepAt) return 'Timer';
  if (player.sleepAt === 'end') return 'Fim da música';
  return `${Math.max(1, Math.ceil((player.sleepAt - Date.now()) / 60000))} min`;
}

function updateProgress() {
  const a = player.audio;
  const frac = a.duration ? a.currentTime / a.duration : 0;
  const bar = $('[data-mini-bar]');
  if (bar) bar.style.width = frac * 100 + '%';
  if (!state.npOpen) return;
  const seek = $('#seek');
  if (seek && !seeking) seek.value = Math.round(frac * 1000);
  const shown = seeking && seek ? seek.value / 1000 : frac;
  const bars = document.querySelectorAll('.wave-bars span');
  const lit = Math.round(shown * bars.length);
  bars.forEach((b, i) => b.classList.toggle('on', i < lit));
  const cur = $('[data-np-cur]');
  const dur = $('[data-np-dur]');
  if (cur) cur.textContent = fmtTime(shown * (a.duration || 0));
  if (dur && a.duration) dur.textContent = fmtTime(a.duration);
  const sl = $('[data-sleep-label]');
  if (sl) sl.textContent = sleepLabel();
}

function openNP(push = true) {
  if (!player.current) return;
  state.npOpen = true;
  if (push) history.pushState({ route: state.route, np: true }, '');
  renderNP();
  const np = $('#np');
  np.classList.add('open');
  np.setAttribute('aria-hidden', 'false');
}
function closeNP(silent = false) {
  if (!state.npOpen) return;
  state.npOpen = false;
  const np = $('#np');
  np.classList.remove('open');
  np.setAttribute('aria-hidden', 'true');
  if (!silent && history.state && history.state.np) history.back();
}

// ---------- Menus (folha inferior) ----------
function openSheet(html) {
  $('#sheet-root').innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  const input = $('#sheet-root input');
  if (input) setTimeout(() => input.focus(), 60);
}
const closeSheet = () => { $('#sheet-root').innerHTML = ''; };

function trackMenu(id) {
  const t = trackById(id);
  if (!t) return;
  const inPlaylist = state.route.name === 'playlist' && !state.npOpen;
  openSheet(`<div class="sheet-head">${art(t, 'sm')}<div class="row-text"><h3>${esc(t.title)}</h3><span class="row-sub">${esc(t.artist)}${t.album ? ' · ' + esc(t.album) : ''}</span></div></div>
    ${player.current && player.current.id !== id ? `<button class="sheet-item" data-action="play-next" data-id="${id}">${I.playNext()} Tocar a seguir</button>` : ''}
    <button class="sheet-item" data-action="fav" data-id="${id}" data-close="1">${I.heart(t.fav, 20)} ${t.fav ? 'Remover dos favoritos' : 'Favoritar'}</button>
    <button class="sheet-item" data-action="add-to-playlist" data-id="${id}">${I.addList()} Adicionar à playlist</button>
    ${inPlaylist ? `<button class="sheet-item" data-action="remove-from-playlist" data-id="${id}">${I.x(20)} Tirar desta playlist</button>` : ''}
    ${t.album ? `<button class="sheet-item" data-action="nav" data-to="album" data-id="${esc(`${t.artist}|${t.album}`)}">${I.disc()} Ir para o álbum</button>` : ''}
    <button class="sheet-item" data-action="nav" data-to="artist" data-id="${esc(t.artist)}">${I.user()} Ir para o artista</button>
    <button class="sheet-item" data-action="edit-info" data-id="${id}">${I.edit()} Editar informações</button>
    <button class="sheet-item" data-action="change-cover" data-id="${id}">${I.image()} ${t.cover ? 'Trocar capa' : 'Escolher capa'}</button>
    ${t.cover ? `<button class="sheet-item" data-action="remove-cover" data-id="${id}">${I.x(20)} Tirar capa</button>` : ''}
    <button class="sheet-item danger" data-action="confirm-delete" data-id="${id}">${I.trash()} Apagar do aparelho</button>`);
}

function editInfoSheet(id) {
  const t = trackById(id);
  openSheet(`<form data-form="edit" data-id="${id}"><h3 style="margin:4px 4px 14px">Editar informações</h3>
    <label class="sub" for="ed-title" style="margin-left:4px">Título</label><input id="ed-title" type="text" name="title" value="${esc(t.title)}" required style="margin-top:6px">
    <label class="sub" for="ed-artist" style="margin-left:4px">Artista</label><input id="ed-artist" type="text" name="artist" value="${esc(t.artist)}" style="margin-top:6px">
    <label class="sub" for="ed-album" style="margin-left:4px">Álbum</label><input id="ed-album" type="text" name="album" value="${esc(t.album)}" placeholder="Opcional" style="margin-top:6px">
    <div class="btn-row"><button type="button" class="btn" data-action="close-sheet">Cancelar</button><button class="btn primary">Salvar</button></div></form>`);
}

function addToPlaylistSheet(id) {
  const lists = state.playlists.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  openSheet(`<h3 style="margin:4px 4px 10px">Adicionar à playlist</h3>
    <button class="sheet-item" data-action="new-playlist" data-id="${id}">${I.plus(20)} Nova playlist</button>
    ${lists.map((p) => `<button class="sheet-item" data-action="add-to" data-playlist="${p.id}" data-id="${id}">${mosaic(p.trackIds.map(trackById).filter(Boolean), 'sm', p.name)} ${esc(p.name)}</button>`).join('')}`);
}

function playlistNameSheet({ trackId = '', rename = false } = {}) {
  const p = rename ? state.playlists.find((x) => x.id === state.route.params.id) : null;
  openSheet(`<form data-form="playlist" data-track="${trackId}" data-rename="${rename ? 1 : ''}">
    <h3 style="margin:4px 4px 14px">${rename ? 'Renomear playlist' : 'Nova playlist'}</h3>
    <label class="sr-only" for="pl-name">Nome da playlist</label>
    <input id="pl-name" type="text" name="name" maxlength="60" placeholder="Nome da playlist" value="${esc(p ? p.name : '')}" required>
    <div class="btn-row"><button type="button" class="btn" data-action="close-sheet">Cancelar</button><button class="btn primary">${rename ? 'Salvar' : 'Criar'}</button></div></form>`);
}

function sleepSheet() {
  const opts = [[15, '15 minutos'], [30, '30 minutos'], [45, '45 minutos'], [60, '1 hora'], ['end', 'Fim desta música']];
  openSheet(`<h3 style="margin:4px 4px 6px">Timer de sono</h3><p>A música para sozinha depois do tempo escolhido.</p>
    ${opts.map(([v, l]) => `<button class="sheet-item" data-action="sleep" data-min="${v}">${I.moon()} ${l}</button>`).join('')}
    ${player.sleepAt ? `<button class="sheet-item danger" data-action="sleep" data-min="">${I.x(20)} Desligar timer</button>` : ''}`);
}

// ---------- Ações ----------
async function playFrom(list, id, context = state.context) {
  if (!list.length) return;
  await player.playList(list, id, context);
}

async function saveTrack(t) {
  await db.updateTrack(t);
  player.patchTrack(t);
}

async function toggleFav(id) {
  const t = trackById(id);
  if (!t) return;
  t.fav = !t.fav;
  t.favAt = t.fav ? Date.now() : null;
  await saveTrack(t);
  toast(t.fav ? 'Adicionada aos favoritos' : 'Removida dos favoritos');
  render();
  if (state.npOpen) renderNP();
}

async function applyCover(id, blob) {
  const t = trackById(id);
  if (!t) return 0;
  const group = t.album ? state.tracks.filter((x) => x.album === t.album && x.artist === t.artist) : [t];
  for (const x of group) { x.cover = blob; forgetCover(x.id); await saveTrack(x); }
  if (player.current && group.some((x) => x.id === player.current.id)) player.updateMediaSession(trackById(player.current.id));
  render();
  if (state.npOpen) renderNP();
  return group.length;
}

async function importFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(f.name));
  if (!files.length) { toast('Nenhum arquivo de áudio encontrado'); return; }
  await db.requestPersistence();
  const existing = new Set(state.tracks.map((t) => `${t.fileName}|${t.size}`));
  state.importing = { done: 0, total: files.length, files: [] };
  if (state.route.name !== 'import') go('import'); else render();
  let added = 0;
  for (const f of files) {
    const entry = { name: f.name, status: 'now' };
    state.importing.files.push(entry);
    updateImportUI();
    if (existing.has(`${f.name}|${f.size}`)) entry.status = 'skip';
    else {
      try {
        const meta = await readMetadata(f);
        const track = { id: db.uid(), ...meta, fileName: f.name, size: f.size, addedAt: Date.now(), fav: false, playCount: 0 };
        await db.addTrack(track, f);
        state.tracks.push(track);
        existing.add(`${f.name}|${f.size}`);
        entry.status = 'done';
        added++;
      } catch (e) {
        console.error('Falha ao importar', f.name, e);
        entry.status = 'fail';
      }
    }
    state.importing.done++;
    updateImportUI();
  }
  state.importing = null;
  state.storage = await db.storageEstimate();
  toast(added ? `${plural(added, 'música importada', 'músicas importadas')}` : 'Essas músicas já estavam na biblioteca');
  render();
}
function updateImportUI() {
  if (state.route.name !== 'import' || !state.importing) return;
  const c = $('[data-imp-count]');
  if (!c) { render(); return; }
  c.textContent = `Importando ${state.importing.done} de ${state.importing.total}`;
  $('[data-imp-bar]').style.width = (state.importing.done / state.importing.total) * 100 + '%';
  $('[data-imp-files]').innerHTML = importFilesHtml();
}

async function deleteTrack(id) {
  await db.deleteTrack(id);
  state.tracks = state.tracks.filter((t) => t.id !== id);
  state.playlists.forEach((p) => { p.trackIds = p.trackIds.filter((x) => x !== id); });
  forgetCover(id);
  player.removeTrack(id);
  state.storage = await db.storageEstimate();
  closeSheet();
  if (state.npOpen && !player.current) closeNP();
  toast('Música apagada');
  render();
}

async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await db.setMeta('settings', state.settings);
}

function applyAccent() {
  document.documentElement.style.setProperty('--accent', state.settings.accent);
}

function applyEq() {
  player.setEq({ gains: state.settings.eqGains, normalize: state.settings.normalize, preset: state.settings.eqPreset });
}

function exportBackup() {
  const data = {
    app: 'Meu Player', version: VERSION, exportedAt: new Date().toISOString(),
    playlists: state.playlists.map((p) => ({ name: p.name, tracks: p.trackIds.map(trackById).filter(Boolean).map((t) => ({ title: t.title, artist: t.artist, album: t.album, file: t.fileName })) })),
    favorites: state.tracks.filter((t) => t.fav).map((t) => ({ title: t.title, artist: t.artist, file: t.fileName })),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `meu-player-backup-${dayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const actions = {
  nav: (el) => { closeSheet(); go(el.dataset.to, el.dataset.id !== undefined ? { id: el.dataset.to === 'playlist' ? el.dataset.id : el.dataset.id } : {}); },
  back: () => back(),
  search: () => { state.libTab = 'songs'; go('library'); setTimeout(() => $('#search')?.focus(), 50); },
  'lib-tab': (el) => { state.libTab = el.dataset.tab; if (state.route.name !== 'library') go('library'); else render(); },
  'fav-sort': (el) => { state.favSort = el.dataset.sort; render(); },
  play: (el) => playFrom(state.visible, el.dataset.id),
  'play-one': (el) => playFrom([trackById(el.dataset.id)], el.dataset.id, 'Tocadas recentemente'),
  'play-all': () => { if (player.shuffle) player.toggleShuffle(); playFrom(state.visible, state.visible[0]?.id); },
  'shuffle-all': () => {
    if (!player.shuffle) player.shuffle = true;
    playFrom(state.visible, state.visible[Math.floor(Math.random() * state.visible.length)]?.id);
  },
  toggle: () => player.toggle(),
  next: () => player.next(),
  prev: () => player.prev(),
  shuffle: () => { player.toggleShuffle(); if (state.route.name === 'queue') render(); },
  repeat: () => { player.cycleRepeat(); if (state.route.name === 'queue') render(); },
  rate: () => { player.cycleRate(); toast(`Velocidade ${String(player.rate).replace('.', ',')}×`); },
  fav: (el) => { if (el.dataset.close) closeSheet(); toggleFav(el.dataset.id); },
  'open-np': () => openNP(),
  'close-np': () => closeNP(),
  'np-context': () => {
    const t = player.current;
    if (t && t.album && player.contextName === t.album) go('album', { id: `${t.artist}|${t.album}` });
    else closeNP();
  },
  'sleep-menu': () => sleepSheet(),
  sleep: (el) => {
    const v = el.dataset.min;
    player.setSleep(v === 'end' ? 'end' : v ? Number(v) : null);
    closeSheet();
    toast(v ? (v === 'end' ? 'Para no fim desta música' : `A música para em ${v} min`) : 'Timer desligado');
    if (state.npOpen) renderNP();
  },
  'queue-jump': (el) => player.jumpTo(Number(el.dataset.i)),
  'queue-remove': (el) => { player.removeUpcoming(Number(el.dataset.i)); render(); },
  'queue-clear': () => { player.clearUpcoming(); render(); toast('Fila limpa'); },
  'play-next': (el) => { player.playNext(trackById(el.dataset.id)); closeSheet(); toast('Toca em seguida'); },
  'track-menu': (el) => trackMenu(el.dataset.id),
  'edit-info': (el) => editInfoSheet(el.dataset.id),
  'add-to-playlist': (el) => addToPlaylistSheet(el.dataset.id),
  'new-playlist': (el) => playlistNameSheet({ trackId: el.dataset.id || '' }),
  'add-to': async (el) => {
    const p = state.playlists.find((x) => x.id === el.dataset.playlist);
    if (!p) return;
    if (!p.trackIds.includes(el.dataset.id)) { p.trackIds.push(el.dataset.id); await db.savePlaylist(p); }
    closeSheet();
    toast(`Adicionada a “${p.name}”`);
    render();
  },
  'remove-from-playlist': async (el) => {
    const p = state.playlists.find((x) => x.id === state.route.params.id);
    if (!p) return;
    p.trackIds = p.trackIds.filter((x) => x !== el.dataset.id);
    await db.savePlaylist(p);
    closeSheet();
    render();
  },
  'playlist-menu': () => openSheet(`<h3 style="margin:4px 4px 10px">Playlist</h3>
    <button class="sheet-item" data-action="rename-playlist">${I.edit()} Renomear</button>
    <button class="sheet-item danger" data-action="delete-playlist">${I.trash()} Excluir playlist</button>`),
  'rename-playlist': () => playlistNameSheet({ rename: true }),
  'delete-playlist': async () => {
    const id = state.route.params.id;
    await db.deletePlaylist(id);
    state.playlists = state.playlists.filter((p) => p.id !== id);
    closeSheet();
    toast('Playlist excluída');
    back();
  },
  'confirm-delete': (el) => {
    const t = trackById(el.dataset.id);
    openSheet(`<h3 style="margin:4px 4px 8px">Apagar “${esc(t.title)}”?</h3><p>Ela sai do app e de todas as playlists. O arquivo original no seu aparelho continua onde estava.</p>
      <div class="btn-row"><button class="btn" data-action="close-sheet">Cancelar</button><button class="btn danger" data-action="delete-track" data-id="${t.id}">Apagar</button></div>`);
  },
  'delete-track': (el) => deleteTrack(el.dataset.id),
  'change-cover': (el) => { state.coverTarget = el.dataset.id; closeSheet(); $('#pick-cover').click(); },
  'remove-cover': async (el) => { closeSheet(); await applyCover(el.dataset.id, null); toast('Capa removida'); },
  'close-sheet': () => closeSheet(),
  'pick-files': () => $('#pick-files').click(),
  'pick-folder': () => $('#pick-folder').click(),
  install: async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    render();
  },
  accent: async (el) => { await saveSettings({ accent: el.dataset.color }); applyAccent(); render(); },
  'toggle-setting': async (el) => { await saveSettings({ [el.dataset.key]: !state.settings[el.dataset.key] }); render(); },
  'toggle-normalize': async () => { await saveSettings({ normalize: !state.settings.normalize }); applyEq(); render(); },
  'eq-toggle': async () => {
    const on = state.settings.eqPreset !== 'Normal' || state.settings.eqGains.some((g) => g);
    const preset = on ? 'Normal' : (state.settings.lastPreset || 'Graves');
    await saveSettings({ eqPreset: preset, eqGains: EQ_PRESETS[preset].slice(), lastPreset: on ? state.settings.eqPreset : state.settings.lastPreset });
    applyEq();
    render();
  },
  'eq-preset': async (el) => {
    const p = el.dataset.preset;
    if (!EQ_PRESETS[p]) return;
    await saveSettings({ eqPreset: p, eqGains: EQ_PRESETS[p].slice() });
    applyEq();
    render();
  },
  export: () => { exportBackup(); toast('Backup salvo nos downloads'); },
};

document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('.nav-btn[data-nav]');
  if (navBtn) {
    if (navBtn.dataset.nav === 'library' && state.route.name === 'library') state.libTab = 'songs';
    go(navBtn.dataset.nav);
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.dataset.form === 'playlist') {
    const name = form.elements.name.value.trim();
    if (!name) return;
    if (form.dataset.rename) {
      const p = state.playlists.find((x) => x.id === state.route.params.id);
      p.name = name;
      await db.savePlaylist(p);
    } else {
      const p = { id: db.uid(), name, trackIds: form.dataset.track ? [form.dataset.track] : [], createdAt: Date.now() };
      await db.savePlaylist(p);
      state.playlists.push(p);
      toast(form.dataset.track ? `Adicionada a “${name}”` : 'Playlist criada');
    }
    closeSheet();
    render();
  }
  if (form.dataset.form === 'edit') {
    const t = trackById(form.dataset.id);
    const title = form.elements.title.value.trim();
    if (!t || !title) return;
    t.title = title;
    t.artist = form.elements.artist.value.trim() || 'Artista desconhecido';
    t.album = form.elements.album.value.trim();
    await saveTrack(t);
    if (player.current && player.current.id === t.id) player.updateMediaSession(t);
    closeSheet();
    toast('Informações salvas');
    render();
    if (state.npOpen) renderNP();
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'search') {
    state.query = el.value;
    const pos = el.selectionStart;
    render();
    const s = $('#search');
    s.focus();
    s.setSelectionRange(pos, pos);
  } else if (el.id === 'seek') {
    seeking = true;
    updateProgress();
  } else if (el.dataset.eqBand !== undefined) {
    const i = Number(el.dataset.eqBand);
    const v = Number(el.value);
    const gains = state.settings.eqGains.slice();
    gains[i] = v;
    state.settings.eqGains = gains;
    state.settings.eqPreset = Object.keys(EQ_PRESETS).find((k) => EQ_PRESETS[k].every((g, j) => g === gains[j])) || 'Personalizado';
    applyEq();
    const y = Math.round(((12 - v) / 24) * 220);
    $(`[data-eq-val="${i}"]`).textContent = (v > 0 ? '+' : '') + v;
    $(`[data-eq-knob="${i}"]`).style.top = y + 'px';
    Object.assign($(`[data-eq-fill="${i}"]`).style, { top: Math.min(y, 110) + 'px', height: Math.abs(y - 110) + 'px' });
  } else if (el.id === 'name-input') {
    saveSettings({ name: el.value });
  }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'seek') { player.seek(el.value / 1000); seeking = false; }
  if (el.dataset.eqBand !== undefined) { saveSettings({}); render(); }
  if (el.id === 'pick-cover') {
    const file = el.files[0];
    const id = state.coverTarget;
    el.value = '';
    if (!file || !id) return;
    prepareCover(file).then((blob) => applyCover(id, blob))
      .then((n) => toast(n > 1 ? `Capa aplicada em ${n} músicas do álbum` : 'Capa atualizada'))
      .catch(() => toast('Não consegui abrir essa imagem'));
  }
  if (el.id === 'pick-files' || el.id === 'pick-folder') importFiles(el.files).finally(() => { el.value = ''; });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if ($('#sheet-root').innerHTML) closeSheet(); else if (state.npOpen) closeNP(); }
  if (e.key === ' ' && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName) && player.current) { e.preventDefault(); player.toggle(); }
});
window.addEventListener('online', () => { if (state.route.name === 'home') render(); });
window.addEventListener('offline', () => { if (state.route.name === 'home') render(); });

// ---------- Reação ao player: estatísticas, sessão, interface ----------
let lastTime = 0;
let listenedThisTrack = 0;
let countedThisTrack = false;
let saveTimer = 0;

player.addEventListener('track', () => {
  listenedThisTrack = 0;
  countedThisTrack = false;
  lastTime = 0;
  const t = player.current && trackById(player.current.id);
  if (t && player.autoplayed) { t.lastPlayed = Date.now(); db.updateTrack(t); }
  if (state.npOpen) renderNP();
});
player.addEventListener('change', () => {
  renderMini();
  if (state.npOpen) renderNP();
  // atualiza as animações de "tocando" na lista sem redesenhar tudo
  document.querySelectorAll('.row').forEach((r) => {
    const b = r.querySelector('[data-action="play"]');
    if (b) r.classList.toggle('is-current', !!player.current && b.dataset.id === player.current.id);
  });
  if (['queue'].includes(state.route.name)) render();
  else if (!document.querySelector('.is-current .eq-bars') && player.current && state.visible.some((t) => t.id === player.current.id)) render();
  else document.querySelectorAll('.eq-bars').forEach((x) => x.classList.toggle('paused', !player.playing));
  if (!player.playing) saveSession();
});
player.addEventListener('time', () => {
  updateProgress();
  const now = player.audio.currentTime;
  const delta = now - lastTime;
  lastTime = now;
  if (!player.playing || delta <= 0 || delta > 2) return;
  const k = dayKey();
  state.listen[k] = (state.listen[k] || 0) + delta;
  listenedThisTrack += delta;
  if (!countedThisTrack && listenedThisTrack >= Math.min(30, (player.audio.duration || 60) * 0.5)) {
    countedThisTrack = true;
    const t = trackById(player.current.id);
    if (t) { t.playCount = (t.playCount || 0) + 1; db.updateTrack(t); }
  }
  if (Date.now() - saveTimer > 10000) { saveTimer = Date.now(); db.setMeta('listen', state.listen); saveSession(); }
});

function saveSession() {
  if (!player.current) return;
  db.setMeta('session', {
    ids: player.order.map((i) => player.queue[i].id), pos: player.pos,
    time: player.audio.currentTime || 0, context: player.contextName, shuffle: player.shuffle, repeat: player.repeat,
  });
  db.setMeta('listen', state.listen);
}
window.addEventListener('pagehide', saveSession);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSession(); });

async function restoreSession() {
  const s = await db.getMeta('session');
  if (!s || !s.ids || !s.ids.length) return;
  const list = s.ids.map(trackById).filter(Boolean);
  if (!list.length) return;
  player.queue = list;
  player.order = list.map((_, i) => i);
  player.pos = Math.min(Math.max(0, s.pos), list.length - 1);
  player.contextName = s.context || '';
  player.shuffle = !!s.shuffle;
  player.repeat = s.repeat || 'off';
  await player.load(false, s.time || 0);
}

// ---------- Instalação (PWA) ----------
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
  if (['home', 'import', 'settings'].includes(state.route.name)) render();
});
window.addEventListener('appinstalled', () => { state.installPrompt = null; toast('App instalado!'); render(); });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker falhou', e)));
}

// ---------- Início ----------
async function init() {
  const [tracks, playlists, storage, settings, listen] = await Promise.all([
    db.getAllTracks(), db.getAllPlaylists(), db.storageEstimate(), db.getMeta('settings'), db.getMeta('listen', {}),
  ]);
  state.tracks = tracks.map((t) => ({ playCount: 0, ...t, artist: t.artist || 'Artista desconhecido' }));
  state.playlists = playlists;
  state.storage = storage;
  state.listen = listen || {};
  if (settings) Object.assign(state.settings, settings);
  applyAccent();
  if (state.settings.eqPreset !== 'Normal' || state.settings.normalize) applyEq();
  history.replaceState({ route: state.route, first: true }, '');
  render(true);
  if (state.settings.resume) { await restoreSession(); renderMini(); }
}
init();
