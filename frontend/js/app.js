// Interface do app: telas, navegação e ligação com o banco local e o player.
import * as db from './db.js';
import { readMetadata } from './metadata.js';
import { Player } from './player.js';

const player = new Player();

const state = {
  tracks: [],
  playlists: [],
  view: 'library',        // library | favorites | playlists | playlist | import
  playlistId: null,
  query: '',
  group: 'songs',         // songs | artists | albums
  groupFilter: null,      // { type: 'artist' | 'album', value }
  importing: null,        // { done, total }
  storage: null,
  installPrompt: null,
  npOpen: false,
  npTrackId: null,
  visible: [],            // músicas da lista que está na tela (vira a fila ao tocar)
  contextName: '',
};

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');

// ---------- Ícones ----------
const I = {
  search: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  down: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  up: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>',
  shuffle: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>',
  repeat: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  more: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
  moreH: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  heart: (on) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`,
  play: (s = 22) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
  pause: (s = 22) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
  prev: '<svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M18 5v14l-10-7z"/><rect x="5" y="5" width="2.5" height="14" rx="1"/></svg>',
  next: '<svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5v14l10-7z"/><rect x="16.5" y="5" width="2.5" height="14" rx="1"/></svg>',
  chevDown: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  chevRight: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  back: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
  plus: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  x: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>',
  list: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h12"/><path d="M3 12h12"/><path d="M3 18h8"/><circle cx="18" cy="17" r="3"/><path d="M21 17V5"/></svg>',
  trash: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
  edit: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  image: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
  phone: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>',
};

// ---------- Utilitários ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtTotal(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

function fmtBytes(b) {
  if (!b) return '0 MB';
  if (b > 1e9) return (b / 1e9).toFixed(1).replace('.', ',') + ' GB';
  return Math.round(b / 1e6) + ' MB';
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Capas geradas: músicas sem capa ganham uma arte com formas e cores fixas
// por álbum (ou por título, se não tiver álbum). As mesmas do design.
const PALETTE = [
  ['#2E4A6B', '#9CC3E0', '#F4F2EC'], ['#6E2F25', '#E8805F', '#F6D7B0'], ['#24433A', '#7FBF9C', '#E8F0D8'],
  ['#4B3560', '#C59BE0', '#F2E6FA'], ['#5A461A', '#F0B44C', '#FFF1D0'], ['#2F3033', '#D9D4C7', '#F0B44C'],
];
function hashOf(key) {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

const coverUrls = new Map();
function coverUrl(track) {
  if (!track || !track.cover) return null;
  if (!coverUrls.has(track.id)) coverUrls.set(track.id, URL.createObjectURL(track.cover));
  return coverUrls.get(track.id);
}
function forgetCover(id) {
  if (coverUrls.has(id)) { URL.revokeObjectURL(coverUrls.get(id)); coverUrls.delete(id); }
}

function art(track, cls = '', key) {
  const url = coverUrl(track);
  if (url) return `<div class="art ${cls}"><img src="${url}" alt=""></div>`;
  const h = hashOf(key ?? (track ? track.album || track.title : ''));
  const [a, b, c] = PALETTE[h % PALETTE.length];
  const variant = (h >>> 8) % 4;
  return `<div class="art gen v${variant} ${cls}" style="--a:${a};--b:${b};--c:${c}" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`;
}

// Reduz a imagem escolhida para 600x600 (corte central) e devolve um JPEG
async function prepareCover(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(600, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close && bmp.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

const byTitle = (a, b) => a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' });
const trackById = (id) => state.tracks.find((t) => t.id === id);

// ---------- Renderização das telas ----------
function render() {
  document.querySelectorAll('.nav button').forEach((b) => {
    const active = b.dataset.view === state.view || (state.view === 'playlist' && b.dataset.view === 'playlists');
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const views = { library: viewLibrary, favorites: viewFavorites, playlists: viewPlaylists, playlist: viewPlaylist, import: viewImport };
  app.innerHTML = (views[state.view] || viewLibrary)();
  renderMini();
}

function trackRow(t, opts = {}) {
  const cur = player.current && player.current.id === t.id;
  const sub = [t.artist, fmtTime(t.duration)].filter(Boolean).join(' · ');
  return `<li class="row${cur ? ' is-current' : ''}">
    <button class="row-main" data-action="play" data-id="${t.id}">
      ${art(t)}
      <span class="row-text"><span class="row-title">${esc(t.title)}</span><span class="row-sub">${esc(sub)}</span></span>
    </button>
    ${opts.fav ? `<button class="icon-btn${t.fav ? ' fav-on' : ''}" data-action="fav" data-id="${t.id}" aria-label="${t.fav ? 'Remover dos favoritos' : 'Favoritar'}">${I.heart(t.fav)}</button>` : ''}
    <button class="icon-btn" data-action="track-menu" data-id="${t.id}" aria-label="Mais opções para ${esc(t.title)}">${I.more}</button>
  </li>`;
}

function emptyLibrary() {
  return `<div class="empty"><strong>Sua biblioteca está vazia</strong>
    Importe músicas do seu aparelho. Elas ficam salvas aqui e tocam sem internet.
    <div class="btn-row" style="margin-top:18px"><button class="btn primary" data-action="pick-files">Importar músicas</button></div>
  </div>`;
}

function viewLibrary() {
  const q = state.query.trim().toLowerCase();
  let list = state.tracks.slice();
  if (state.groupFilter) {
    const { type, value } = state.groupFilter;
    list = list.filter((t) => (type === 'artist' ? t.artist : t.album) === value);
  }
  if (q) list = list.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q));
  list.sort(byTitle);

  const head = `<div class="view-head"><h1>Biblioteca</h1><span class="pill">${I.down} Offline</span></div>
    <label class="search">${I.search}<span class="sr-only">Buscar na biblioteca</span>
      <input id="search" type="search" placeholder="Músicas, artistas, álbuns" value="${esc(state.query)}" autocomplete="off">
    </label>
    <div class="chips" role="group" aria-label="Agrupar por">
      ${[['songs', 'Músicas'], ['artists', 'Artistas'], ['albums', 'Álbuns']].map(([k, label]) =>
        `<button class="chip" data-action="group" data-group="${k}" aria-pressed="${state.group === k}">${label}</button>`).join('')}
      ${state.groupFilter ? `<button class="chip filter" data-action="clear-filter" aria-label="Limpar filtro ${esc(state.groupFilter.value)}">${esc(state.groupFilter.value || 'Sem álbum')} ${I.x}</button>` : ''}
    </div>`;

  if (!state.tracks.length) return head + emptyLibrary();

  if (state.group !== 'songs') {
    const key = state.group === 'artists' ? 'artist' : 'album';
    const groups = new Map();
    for (const t of state.tracks) {
      const k = t[key] || '';
      if (q && !k.toLowerCase().includes(q)) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
    state.visible = [];
    return head + `<div class="section-head"><h2>${state.group === 'artists' ? 'Artistas' : 'Álbuns'}</h2></div>
      <ul class="list">${sorted.map(([name, ts]) => `<li class="row">
        <button class="row-main" data-action="open-group" data-type="${key}" data-value="${esc(name)}">
          ${art(ts.find((t) => t.cover) || ts[0], '', name)}
          <span class="row-text"><span class="row-title">${esc(name || (key === 'album' ? 'Sem álbum' : 'Artista desconhecido'))}</span>
          <span class="row-sub">${plural(ts.length, 'música', 'músicas')}</span></span>
          ${I.chevRight}
        </button></li>`).join('')}</ul>`;
  }

  state.visible = list;
  state.contextName = state.groupFilter ? state.groupFilter.value : 'Biblioteca';

  const recent = state.tracks.filter((t) => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 3);
  const recentHtml = !q && !state.groupFilter && recent.length ? `
    <div class="section-head"><h2>Tocadas recentemente</h2></div>
    <div class="grid3">${recent.map((t) => `<button class="tile" data-action="play-recent" data-id="${t.id}">
      ${art(t)}<span>${esc(t.title)}</span><span class="row-sub" style="margin-top:-4px">${esc(t.artist)}</span></button>`).join('')}</div>` : '';

  return head + recentHtml + `
    <div class="section-head"><h2>${q ? 'Resultados' : 'Todas as músicas'}</h2>
      ${list.length ? `<button class="icon-btn" data-action="shuffle-all" aria-label="Tocar em ordem aleatória">${I.shuffle}</button>` : ''}
    </div>
    ${list.length ? `<ul class="list">${list.map((t) => trackRow(t)).join('')}</ul>` : '<div class="empty">Nada encontrado.</div>'}`;
}

function viewFavorites() {
  const list = state.tracks.filter((t) => t.fav).sort((a, b) => (b.favAt || 0) - (a.favAt || 0));
  state.visible = list;
  state.contextName = 'Favoritos';
  const total = list.reduce((s, t) => s + (t.duration || 0), 0);
  return `<div class="view-head"><h1>Favoritos</h1></div>
    <div class="card warm">
      <div class="badge big">${I.heart(true)}</div>
      <div style="flex:1;min-width:0"><div class="card-title">${plural(list.length, 'música', 'músicas')}</div>
      <div class="card-sub">${total >= 60 ? fmtTotal(total) + ' · ' : ''}Salvas no aparelho · tocam sem internet</div></div>
      ${list.length ? `<button class="icon-btn accent" style="width:52px;height:52px" data-action="play-all" aria-label="Tocar favoritos">${I.play()}</button>` : ''}
    </div>
    ${list.length ? `<ul class="list" style="margin-top:16px">${list.map((t) => trackRow(t, { fav: true })).join('')}</ul>`
      : `<div class="empty"><strong>Nenhum favorito ainda</strong>Toque no coração de uma música para guardar aqui.</div>`}`;
}

function viewPlaylists() {
  const lists = state.playlists.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return `<div class="view-head"><h1>Playlists</h1>
      <button class="icon-btn accent" data-action="new-playlist" aria-label="Nova playlist">${I.plus}</button></div>
    ${lists.length ? `<ul class="list">${lists.map((p) => {
      const ts = p.trackIds.map(trackById).filter(Boolean);
      const total = ts.reduce((s, t) => s + (t.duration || 0), 0);
      return `<li class="row"><button class="row-main" data-action="open-playlist" data-id="${p.id}">
        ${art(ts.find((t) => t.cover), 'lg', p.name)}
        <span class="row-text"><span class="row-title">${esc(p.name)}</span>
        <span class="row-sub">${plural(ts.length, 'música', 'músicas')}${ts.length ? ' · ' + fmtTotal(total) : ''}</span></span>
        ${I.chevRight}</button></li>`;
    }).join('')}</ul>`
      : `<div class="empty"><strong>Nenhuma playlist</strong>Crie uma no botão + e adicione músicas pelo menu ⋮ de cada música.</div>`}`;
}

function viewPlaylist() {
  const p = state.playlists.find((x) => x.id === state.playlistId);
  if (!p) { state.view = 'playlists'; return viewPlaylists(); }
  const list = p.trackIds.map(trackById).filter(Boolean);
  state.visible = list;
  state.contextName = p.name;
  return `<div class="view-head">
      <button class="icon-btn" data-action="nav" data-view="playlists" aria-label="Voltar para playlists">${I.back}</button>
      <button class="icon-btn" data-action="playlist-menu" aria-label="Opções da playlist">${I.moreH}</button>
    </div>
    <h1 style="margin-bottom:4px">${esc(p.name)}</h1>
    <div class="row-sub" style="margin-bottom:16px">${plural(list.length, 'música', 'músicas')}</div>
    ${list.length ? `<div class="btn-row" style="margin-bottom:12px">
        <button class="btn primary" data-action="play-all">${I.play(18)} Tocar</button>
        <button class="btn" data-action="shuffle-all">${I.shuffle} Aleatório</button></div>
      <ul class="list">${list.map((t) => trackRow(t)).join('')}</ul>`
      : `<div class="empty"><strong>Playlist vazia</strong>Na Biblioteca, toque no ⋮ de uma música e escolha “Adicionar à playlist”.</div>`}`;
}

function viewImport() {
  const folderSupported = 'webkitdirectory' in document.createElement('input') && !/iPhone|iPad|iPod/.test(navigator.userAgent);
  const st = state.storage;
  const used = st ? st.usage : 0;
  const quota = st ? st.quota : 0;
  const pct = quota ? Math.max(1, Math.min(100, (used / quota) * 100)) : 0;
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  return `<div class="view-head"><h1>Importar</h1></div>
    <div class="card">
      <div class="card-head"><div class="badge">${I.up}</div>
        <div><div class="card-title">Importar músicas</div><div class="card-sub">MP3, M4A, FLAC, WAV ou OGG do seu aparelho</div></div></div>
      <div class="btn-row">
        <button class="btn primary" data-action="pick-files" ${state.importing ? 'disabled' : ''}>Escolher arquivos</button>
        ${folderSupported ? `<button class="btn" data-action="pick-folder" ${state.importing ? 'disabled' : ''}>Escolher pasta</button>` : ''}
      </div>
      ${state.importing ? `<div class="progress-line">Importando ${state.importing.done} de ${state.importing.total}…</div>` : ''}
      <div class="meter">
        <div class="meter-top"><span>${plural(state.tracks.length, 'música', 'músicas')} no aparelho</span><span>${fmtBytes(used)}${quota ? ' de ' + fmtBytes(quota) : ''}</span></div>
        <div class="bar"><div style="width:${pct}%"></div></div>
      </div>
    </div>

    ${isStandalone ? '' : `<div class="card" style="margin-top:16px">
      <div class="card-head"><div class="badge">${I.phone}</div>
        <div><div class="card-title">Instalar no celular</div><div class="card-sub">Abre como app e funciona sem internet</div></div></div>
      ${state.installPrompt ? `<button class="btn primary" data-action="install">Instalar app</button>`
        : isIOS ? `<ol class="tips"><li>Abra este site no <b>Safari</b>.</li><li>Toque em <b>Compartilhar</b> (o quadrado com a seta).</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li></ol>`
        : `<ol class="tips"><li>Abra este site no <b>Chrome</b>.</li><li>Toque no menu <b>⋮</b> no canto de cima.</li><li>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li></ol>`}
    </div>`}`;
}

// ---------- Mini player e tela "Tocando agora" ----------
function renderMini() {
  const mini = $('#mini');
  const t = player.current;
  if (!t) { mini.hidden = true; return; }
  mini.hidden = false;
  const pct = player.audio.duration ? (player.audio.currentTime / player.audio.duration) * 100 : 0;
  mini.innerHTML = `
    <button class="row-main" data-action="open-np" aria-label="Abrir tocando agora: ${esc(t.title)}">
      ${art(t)}
      <span class="row-text"><span class="row-title" style="font-size:14px">${esc(t.title)}</span>
      <span class="row-sub" style="font-size:12px;color:#a9acb2">${esc(t.artist)} · <span data-mini-time>${fmtTime(player.audio.currentTime)} / ${fmtTime(player.audio.duration || t.duration)}</span></span></span>
    </button>
    <button class="icon-btn accent" data-action="toggle" aria-label="${player.playing ? 'Pausar' : 'Tocar'}">${player.playing ? I.pause(16) : I.play(16)}</button>
    <div class="mini-progress"><div data-mini-bar style="width:${pct}%"></div></div>`;
}

function updateMiniProgress() {
  const t = player.current;
  if (!t) return;
  const bar = $('[data-mini-bar]');
  const time = $('[data-mini-time]');
  if (bar) bar.style.width = (player.audio.duration ? (player.audio.currentTime / player.audio.duration) * 100 : 0) + '%';
  if (time) time.textContent = `${fmtTime(player.audio.currentTime)} / ${fmtTime(player.audio.duration || t.duration)}`;
}

function renderNP() {
  const np = $('#np');
  const t = player.current;
  if (!t) { closeNP(); return; }
  state.npTrackId = t.id;
  const fresh = trackById(t.id) || t;
  np.innerHTML = `
    <div class="np-top">
      <button class="icon-btn" data-action="close-np" aria-label="Fechar">${I.chevDown}</button>
      <div class="np-ctx"><small>Tocando de</small><span>${esc(player.contextName || 'Biblioteca')}</span></div>
      <button class="icon-btn" data-action="track-menu" data-id="${t.id}" aria-label="Mais opções">${I.moreH}</button>
    </div>
    ${art(fresh, 'cover')}
    <div class="np-meta">
      <div><h2 class="np-title">${esc(fresh.title)}</h2><div class="np-artist">${esc([fresh.artist, fresh.album].filter(Boolean).join(' · '))}</div></div>
      <button class="icon-btn ghost${fresh.fav ? ' fav-on' : ''}" style="color:${fresh.fav ? 'var(--accent)' : 'var(--muted)'}" data-action="fav" data-id="${t.id}" aria-label="${fresh.fav ? 'Remover dos favoritos' : 'Favoritar'}" aria-pressed="${!!fresh.fav}">${I.heart(fresh.fav)}</button>
    </div>
    <div class="seek">
      <label class="sr-only" for="seek">Posição da música</label>
      <input id="seek" type="range" min="0" max="1000" value="0">
      <div class="times"><span data-np-cur>0:00</span><span data-np-dur>${fmtTime(fresh.duration)}</span></div>
    </div>
    <div class="controls">
      <button class="icon-btn ${player.shuffle ? 'on' : 'off'}" data-action="shuffle" aria-label="Aleatório" aria-pressed="${player.shuffle}">${I.shuffle}</button>
      <button class="icon-btn big" data-action="prev" aria-label="Anterior">${I.prev}</button>
      <button class="icon-btn play" data-action="toggle" aria-label="${player.playing ? 'Pausar' : 'Tocar'}">${player.playing ? I.pause(30) : I.play(30)}</button>
      <button class="icon-btn big" data-action="next" aria-label="Próxima">${I.next}</button>
      <button class="icon-btn ${player.repeat !== 'off' ? 'on' : 'off'}${player.repeat === 'one' ? ' repeat-one' : ''}" data-action="repeat" aria-label="Repetir: ${{ off: 'desligado', all: 'todas', one: 'uma' }[player.repeat]}">${I.repeat}</button>
    </div>
    <div class="np-foot">${I.down}<span>Arquivo no aparelho · toca sem internet</span></div>`;
  updateNPProgress();
}

let seeking = false;
function updateNPProgress() {
  if (!state.npOpen) return;
  const a = player.audio;
  const seek = $('#seek');
  if (seek && !seeking) seek.value = a.duration ? Math.round((a.currentTime / a.duration) * 1000) : 0;
  const cur = $('[data-np-cur]');
  const dur = $('[data-np-dur]');
  if (cur) cur.textContent = fmtTime(a.currentTime);
  if (dur && a.duration) dur.textContent = fmtTime(a.duration);
}

function openNP() {
  state.npOpen = true;
  renderNP();
  const np = $('#np');
  np.classList.add('open');
  np.setAttribute('aria-hidden', 'false');
}
function closeNP() {
  state.npOpen = false;
  const np = $('#np');
  np.classList.remove('open');
  np.setAttribute('aria-hidden', 'true');
}

// ---------- Folha inferior (menus) ----------
function openSheet(html) {
  $('#sheet-root').innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  const input = $('#sheet-root input');
  if (input) setTimeout(() => input.focus(), 50);
}
function closeSheet() { $('#sheet-root').innerHTML = ''; }

function trackMenu(id) {
  const t = trackById(id);
  if (!t) return;
  const inPlaylist = state.view === 'playlist' && !state.npOpen;
  openSheet(`<h3>${esc(t.title)}</h3><p class="sheet-sub">${esc(t.artist)}</p>
    <button class="sheet-item" data-action="fav" data-id="${id}" data-close="1">${I.heart(t.fav)} ${t.fav ? 'Remover dos favoritos' : 'Favoritar'}</button>
    <button class="sheet-item" data-action="add-to-playlist" data-id="${id}">${I.list} Adicionar à playlist</button>
    <button class="sheet-item" data-action="change-cover" data-id="${id}">${I.image} ${t.cover ? 'Trocar capa' : 'Escolher capa'}</button>
    ${t.cover ? `<button class="sheet-item" data-action="remove-cover" data-id="${id}">${I.x} Tirar capa</button>` : ''}
    ${inPlaylist ? `<button class="sheet-item" data-action="remove-from-playlist" data-id="${id}">${I.x} Tirar desta playlist</button>` : ''}
    <button class="sheet-item danger" data-action="confirm-delete" data-id="${id}">${I.trash} Apagar do aparelho</button>`);
}

function addToPlaylistSheet(id) {
  const lists = state.playlists.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  openSheet(`<h3>Adicionar à playlist</h3>
    <button class="sheet-item" data-action="new-playlist" data-id="${id}">${I.plus} Nova playlist</button>
    ${lists.map((p) => `<button class="sheet-item" data-action="add-to" data-playlist="${p.id}" data-id="${id}">${I.list} ${esc(p.name)}</button>`).join('')}`);
}

function playlistNameSheet({ trackId = '', rename = false } = {}) {
  const p = rename ? state.playlists.find((x) => x.id === state.playlistId) : null;
  openSheet(`<form data-form="playlist" data-track="${trackId}" data-rename="${rename ? 1 : ''}">
    <h3>${rename ? 'Renomear playlist' : 'Nova playlist'}</h3>
    <label class="sr-only" for="pl-name">Nome da playlist</label>
    <input id="pl-name" type="text" name="name" maxlength="60" placeholder="Nome da playlist" value="${esc(p ? p.name : '')}" required>
    <div class="btn-row"><button type="button" class="btn" data-action="close-sheet">Cancelar</button><button class="btn primary">${rename ? 'Salvar' : 'Criar'}</button></div>
  </form>`);
}

// ---------- Ações ----------
async function playFrom(list, id) {
  if (!list.length) return;
  player.contextName = state.contextName;
  await player.playList(list, id);
}

async function toggleFav(id) {
  const t = trackById(id);
  if (!t) return;
  t.fav = !t.fav;
  t.favAt = t.fav ? Date.now() : null;
  await db.updateTrack(t);
  player.patchTrack(t);
  toast(t.fav ? 'Adicionada aos favoritos' : 'Removida dos favoritos');
  render();
  if (state.npOpen) renderNP();
}

async function importFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(f.name));
  if (!files.length) { toast('Nenhum arquivo de áudio encontrado'); return; }
  await db.requestPersistence();
  const existing = new Set(state.tracks.map((t) => `${t.fileName}|${t.size}`));
  state.importing = { done: 0, total: files.length };
  render();
  let added = 0;
  for (const f of files) {
    if (!existing.has(`${f.name}|${f.size}`)) {
      try {
        const meta = await readMetadata(f);
        const track = { id: db.uid(), ...meta, fileName: f.name, size: f.size, addedAt: Date.now(), fav: false };
        await db.addTrack(track, f);
        state.tracks.push(track);
        added++;
      } catch (e) {
        console.error('Falha ao importar', f.name, e);
      }
    }
    state.importing.done++;
    if (state.view === 'import') {
      const line = $('.progress-line');
      if (line) line.textContent = `Importando ${state.importing.done} de ${state.importing.total}…`;
    }
  }
  state.importing = null;
  state.storage = await db.storageEstimate();
  toast(added ? `${plural(added, 'música importada', 'músicas importadas')}` : 'Essas músicas já estavam na biblioteca');
  render();
}

// Coloca (ou tira) a capa da música e de todas as outras do mesmo álbum
async function applyCover(id, blob) {
  const t = trackById(id);
  if (!t) return 0;
  const sameAlbum = t.album
    ? state.tracks.filter((x) => x.album === t.album && x.artist === t.artist)
    : [t];
  for (const x of sameAlbum) {
    x.cover = blob;
    forgetCover(x.id);
    await db.updateTrack(x);
    player.patchTrack(x);
  }
  if (player.current && sameAlbum.some((x) => x.id === player.current.id)) {
    player.updateMediaSession(trackById(player.current.id));
  }
  render();
  if (state.npOpen) renderNP();
  return sameAlbum.length;
}

async function deleteTrack(id) {
  await db.deleteTrack(id);
  state.tracks = state.tracks.filter((t) => t.id !== id);
  state.playlists.forEach((p) => { p.trackIds = p.trackIds.filter((x) => x !== id); });
  forgetCover(id);
  player.removeTrack(id);
  state.storage = await db.storageEstimate();
  closeSheet();
  if (state.npOpen) { if (player.current) renderNP(); else closeNP(); }
  toast('Música apagada');
  render();
}

const actions = {
  nav: (el) => { state.view = el.dataset.view; closeNP(); render(); window.scrollTo(0, 0); },
  play: (el) => playFrom(state.visible, el.dataset.id),
  'play-recent': (el) => {
    state.contextName = 'Tocadas recentemente';
    const recent = state.tracks.filter((t) => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed);
    playFrom(recent, el.dataset.id);
  },
  'play-all': () => { if (player.shuffle) player.toggleShuffle(); playFrom(state.visible, state.visible[0]?.id); },
  'shuffle-all': () => {
    if (!player.shuffle) player.shuffle = true;
    const pick = state.visible[Math.floor(Math.random() * state.visible.length)];
    playFrom(state.visible, pick?.id);
  },
  toggle: () => player.toggle(),
  next: () => player.next(),
  prev: () => player.prev(),
  shuffle: () => player.toggleShuffle(),
  repeat: () => player.cycleRepeat(),
  fav: (el) => { if (el.dataset.close) closeSheet(); toggleFav(el.dataset.id); },
  'open-np': () => openNP(),
  'close-np': () => closeNP(),
  group: (el) => { state.group = el.dataset.group; render(); },
  'open-group': (el) => { state.groupFilter = { type: el.dataset.type, value: el.dataset.value }; state.group = 'songs'; state.query = ''; render(); },
  'clear-filter': () => { state.groupFilter = null; render(); },
  'open-playlist': (el) => { state.view = 'playlist'; state.playlistId = el.dataset.id; render(); window.scrollTo(0, 0); },
  'track-menu': (el) => trackMenu(el.dataset.id),
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
    const p = state.playlists.find((x) => x.id === state.playlistId);
    if (!p) return;
    p.trackIds = p.trackIds.filter((x) => x !== el.dataset.id);
    await db.savePlaylist(p);
    closeSheet();
    render();
  },
  'playlist-menu': () => openSheet(`<h3>Playlist</h3>
    <button class="sheet-item" data-action="rename-playlist">${I.edit} Renomear</button>
    <button class="sheet-item danger" data-action="delete-playlist">${I.trash} Excluir playlist</button>`),
  'rename-playlist': () => playlistNameSheet({ rename: true }),
  'delete-playlist': async () => {
    await db.deletePlaylist(state.playlistId);
    state.playlists = state.playlists.filter((p) => p.id !== state.playlistId);
    closeSheet();
    state.view = 'playlists';
    toast('Playlist excluída');
    render();
  },
  'confirm-delete': (el) => {
    const t = trackById(el.dataset.id);
    openSheet(`<h3>Apagar “${esc(t.title)}”?</h3><p class="sheet-sub">O arquivo sai do app e de todas as playlists. O original no seu aparelho continua onde estava.</p>
      <div class="btn-row"><button class="btn" data-action="close-sheet">Cancelar</button><button class="btn danger" data-action="delete-track" data-id="${t.id}">Apagar</button></div>`);
  },
  'delete-track': (el) => deleteTrack(el.dataset.id),
  'change-cover': (el) => {
    state.coverTarget = el.dataset.id;
    closeSheet();
    $('#pick-cover').click();
  },
  'remove-cover': async (el) => {
    closeSheet();
    await applyCover(el.dataset.id, null);
    toast('Capa removida');
  },
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
};

document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('.nav button[data-view]');
  if (navBtn) { actions.nav(navBtn); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form="playlist"]');
  if (!form) return;
  e.preventDefault();
  const name = form.elements.name.value.trim();
  if (!name) return;
  if (form.dataset.rename) {
    const p = state.playlists.find((x) => x.id === state.playlistId);
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
});

// Busca: atualiza a lista sem perder o foco do campo
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    state.query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = $('#search');
    s.focus();
    s.setSelectionRange(pos, pos);
  }
  if (e.target.id === 'seek') {
    seeking = true;
    const a = player.audio;
    const cur = $('[data-np-cur]');
    if (cur && a.duration) cur.textContent = fmtTime((e.target.value / 1000) * a.duration);
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'seek') { player.seek(e.target.value / 1000); seeking = false; }
  if (e.target.id === 'pick-cover') {
    const file = e.target.files[0];
    const id = state.coverTarget;
    e.target.value = '';
    if (!file || !id) return;
    prepareCover(file)
      .then((blob) => applyCover(id, blob))
      .then((n) => toast(n > 1 ? `Capa aplicada em ${n} músicas do álbum` : 'Capa atualizada'))
      .catch(() => toast('Não consegui abrir essa imagem'));
  }
  if (e.target.id === 'pick-files' || e.target.id === 'pick-folder') {
    importFiles(e.target.files).finally(() => { e.target.value = ''; });
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if ($('#sheet-root').innerHTML) closeSheet(); else if (state.npOpen) closeNP(); }
});

// ---------- Reação ao player ----------
let lastTrackId = null;
let lastPlaying = null;
player.addEventListener('change', async () => {
  const t = player.current;
  const id = t ? t.id : null;
  if (id !== lastTrackId || player.playing !== lastPlaying) {
    const trackChanged = id !== lastTrackId;
    lastTrackId = id;
    lastPlaying = player.playing;
    if (trackChanged && t) {
      const stored = trackById(id);
      if (stored) { stored.lastPlayed = Date.now(); db.updateTrack(stored); }
    }
    render();
    if (state.npOpen) renderNP();
  } else {
    updateMiniProgress();
    updateNPProgress();
  }
});
// botões de shuffle/repeat mudam o estado sem trocar de música
player.addEventListener('change', () => {
  if (!state.npOpen) return;
  const sh = $('#np [data-action="shuffle"]');
  const rp = $('#np [data-action="repeat"]');
  if (sh) { sh.className = `icon-btn ${player.shuffle ? 'on' : 'off'}`; sh.setAttribute('aria-pressed', player.shuffle); }
  if (rp) {
    rp.className = `icon-btn ${player.repeat !== 'off' ? 'on' : 'off'}${player.repeat === 'one' ? ' repeat-one' : ''}`;
    rp.setAttribute('aria-label', `Repetir: ${{ off: 'desligado', all: 'todas', one: 'uma' }[player.repeat]}`);
  }
});

// ---------- Instalação (PWA) ----------
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
  if (state.view === 'import') render();
});
window.addEventListener('appinstalled', () => { state.installPrompt = null; toast('App instalado!'); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker falhou', e));
  });
}

// ---------- Início ----------
async function init() {
  [state.tracks, state.playlists, state.storage] = await Promise.all([db.getAllTracks(), db.getAllPlaylists(), db.storageEstimate()]);
  if (!state.tracks.length) state.view = 'import';
  render();
}
init();
