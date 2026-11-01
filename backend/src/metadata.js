// Lê título, artista, álbum, ano, faixa e capa (ID3v2) e estima a duração de MP3s.
// Sem bibliotecas externas.

export function readMetadata(buf, fileName) {
  const fromName = parseFileName(fileName);
  let tags = {};
  let audioStart = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    audioStart = synchsafe(buf, 6) + 10;
    try { tags = parseID3v2(buf.subarray(0, Math.min(audioStart, buf.length))); } catch { /* tags quebradas */ }
  }
  const isMp3 = /\.mp3$/i.test(fileName);
  return {
    title: tags.title || fromName.title,
    artist: tags.artist || fromName.artist || null,
    album: tags.album || null,
    year: tags.year ? parseInt(tags.year, 10) || null : null,
    trackNumber: tags.track ? parseInt(tags.track, 10) || null : null,
    cover: tags.cover || null, // { mime, data }
    duration: isMp3 ? mp3Duration(buf, audioStart) : 0,
  };
}

export function parseFileName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const parts = base.split(' - ');
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: null, title: base };
}

function synchsafe(b, o) {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function decodeText(data) {
  if (!data.length) return '';
  const enc = data[0];
  const body = data.subarray(1);
  let s;
  if (enc === 1) s = new TextDecoder('utf-16').decode(body);
  else if (enc === 2) s = new TextDecoder('utf-16be').decode(body);
  else if (enc === 3) s = body.toString('utf8');
  else s = body.toString('latin1');
  return s.replace(/\u0000/g, '').trim();
}

function parseID3v2(buf) {
  const version = buf[3];
  const end = synchsafe(buf, 6) + 10;
  let pos = 10;
  if (buf[5] & 0x40) pos += version === 4 ? synchsafe(buf, pos) : buf.readUInt32BE(pos) + 4;
  const out = {};
  while (pos + 10 <= Math.min(end, buf.length)) {
    const id = buf.toString('latin1', pos, pos + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version === 4 ? synchsafe(buf, pos + 4) : buf.readUInt32BE(pos + 4);
    const data = buf.subarray(pos + 10, pos + 10 + size);
    if (id === 'TIT2') out.title = decodeText(data);
    else if (id === 'TPE1') out.artist = decodeText(data);
    else if (id === 'TALB') out.album = decodeText(data);
    else if (id === 'TYER' || id === 'TDRC') out.year = decodeText(data).slice(0, 4);
    else if (id === 'TRCK') out.track = decodeText(data).split('/')[0];
    else if (id === 'APIC' && !out.cover) out.cover = decodePicture(data);
    pos += 10 + size;
  }
  return out;
}

function decodePicture(data) {
  const enc = data[0];
  let i = 1;
  let mime = '';
  while (i < data.length && data[i] !== 0) mime += String.fromCharCode(data[i++]);
  i += 2; // fim do mime + tipo da imagem
  if (enc === 1 || enc === 2) {
    while (i + 1 < data.length && !(data[i] === 0 && data[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < data.length && data[i] !== 0) i++;
    i += 1;
  }
  if (i >= data.length || !mime || mime === '-->') return null;
  if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase().replace('jpg', 'jpeg');
  return { mime, data: Buffer.from(data.subarray(i)) };
}

// Duração do MP3: usa o cabeçalho Xing/Info (VBR) quando existe; senão, calcula pelo bitrate.
const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG1 Layer III
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],     // MPEG2/2.5 Layer III
};
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function mp3Duration(buf, start) {
  for (let i = start; i < Math.min(buf.length - 4, start + 64 * 1024); i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (buf[i + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[i + 1] >> 1) & 3;       // 1 = Layer III
    if (versionBits === 1 || layer !== 1) continue;
    const brIndex = buf[i + 2] >> 4;
    const srIndex = (buf[i + 2] >> 2) & 3;
    if (brIndex === 0 || brIndex === 15 || srIndex === 3) continue;
    const mpeg1 = versionBits === 3;
    const bitrate = BITRATES[mpeg1 ? 1 : 2][brIndex] * 1000;
    const sampleRate = SAMPLE_RATES[versionBits][srIndex];
    const samplesPerFrame = mpeg1 ? 1152 : 576;
    const mono = (buf[i + 3] >> 6) === 3;
    const sideInfo = mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const x = i + 4 + sideInfo;
    const tag = buf.toString('latin1', x, x + 4);
    if ((tag === 'Xing' || tag === 'Info') && (buf.readUInt32BE(x + 4) & 1)) {
      const frames = buf.readUInt32BE(x + 8);
      return (frames * samplesPerFrame) / sampleRate;
    }
    return ((buf.length - i) * 8) / bitrate;
  }
  return 0;
}
