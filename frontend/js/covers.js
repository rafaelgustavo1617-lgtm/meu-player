// Capas: imagem real (quando a música tem) ou arte gerada com formas e cores
// fixas por álbum. Também descobre a "cor da capa" para pintar o fundo do player.

export const PALETTE = [
  ['#2E4A6B', '#9CC3E0', '#F4F2EC'], ['#6E2F25', '#E8805F', '#F6D7B0'], ['#24433A', '#7FBF9C', '#E8F0D8'],
  ['#4B3560', '#C59BE0', '#F2E6FA'], ['#5A461A', '#F0B44C', '#FFF1D0'], ['#2F3033', '#D9D4C7', '#F0B44C'],
];

function hashOf(key) {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export const coverKey = (t) => (t ? (t.album ? `${t.artist}|${t.album}` : t.title) : '');

function generated(key) {
  const h = hashOf(key);
  return { colors: PALETTE[h % PALETTE.length], variant: (h >>> 8) % 4 };
}

const urls = new Map();
export function coverUrl(track) {
  if (!track || !track.cover) return null;
  if (!urls.has(track.id)) urls.set(track.id, URL.createObjectURL(track.cover));
  return urls.get(track.id);
}
export function forgetCover(id) {
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  tints.delete(id);
}

// HTML da capa. `key` permite gerar arte para algo que não é música (ex.: playlist)
export function art(track, cls = '', key) {
  const url = key === undefined ? coverUrl(track) : null;
  if (url) return `<div class="art ${cls}"><img src="${url}" alt="" loading="lazy"></div>`;
  const { colors: [a, b, c], variant } = generated(key ?? coverKey(track));
  return `<div class="art gen v${variant} ${cls}" style="--a:${a};--b:${b};--c:${c}" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`;
}

// Mosaico 2x2 para playlists
export function mosaic(tracks, cls = '', key = '') {
  const withArt = [];
  const seen = new Set();
  for (const t of tracks) {
    const k = t.cover ? t.id : coverKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    withArt.push(t);
    if (withArt.length === 4) break;
  }
  if (withArt.length < 4) return art(withArt[0] || null, cls, withArt[0] ? undefined : key);
  return `<div class="art mosaic ${cls}">${withArt.map((t) => art(t)).join('')}</div>`;
}

// Cor de fundo do player: média da imagem, ou a cor base da arte gerada
const tints = new Map();
export async function tintFor(track) {
  if (!track) return '#1A2638';
  if (!track.cover) return generated(coverKey(track)).colors[0];
  if (tints.has(track.id)) return tints.get(track.id);
  try {
    const bmp = await createImageBitmap(track.cover, { resizeWidth: 24, resizeHeight: 24 });
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    // escurece para o texto branco continuar legível
    const k = 0.55;
    const hex = '#' + [r, g, b].map((v) => Math.round((v / n) * k).toString(16).padStart(2, '0')).join('');
    tints.set(track.id, hex);
    return hex;
  } catch {
    return '#1A2638';
  }
}

// Reduz a imagem escolhida para 600x600 (corte central) e devolve um JPEG
export async function prepareCover(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(600, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}

// Forma de onda decorativa (estável por música)
export function waveHeights(id, n = 56) {
  let h = hashOf(id);
  const out = [];
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const base = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.42 + (h % 7)));
    out.push(Math.round(18 + 70 * base * (0.6 + (h % 100) / 250)));
  }
  return out;
}
