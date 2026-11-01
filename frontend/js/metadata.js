// Lê título, artista, álbum e capa de arquivos MP3 (tags ID3v2) sem bibliotecas externas.
// Para outros formatos (ou MP3 sem tags), usa o nome do arquivo: "Artista - Título.mp3".

export async function readMetadata(file) {
  const fromName = parseFileName(file.name);
  let tags = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) { // "ID3"
      const size = synchsafe(head, 6) + 10;
      const buf = new Uint8Array(await file.slice(0, Math.min(size, 8 * 1024 * 1024)).arrayBuffer());
      tags = parseID3v2(buf);
    }
  } catch (e) {
    console.warn('Não consegui ler as tags de', file.name, e);
  }
  const duration = await readDuration(file);
  return {
    title: tags.title || fromName.title,
    artist: tags.artist || fromName.artist || 'Artista desconhecido',
    album: tags.album || '',
    cover: tags.cover || null, // Blob da imagem, se houver
    duration,
  };
}

function parseFileName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const parts = base.split(' - ');
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: '', title: base };
}

function synchsafe(b, o) {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function parseID3v2(buf) {
  const version = buf[3]; // 3 = ID3v2.3, 4 = ID3v2.4
  const flags = buf[5];
  const end = synchsafe(buf, 6) + 10;
  let pos = 10;
  if (flags & 0x40) { // header estendido
    const extSize = version === 4 ? synchsafe(buf, pos) : readUint32(buf, pos) + 4;
    pos += extSize;
  }
  const out = {};
  while (pos + 10 <= end && pos + 10 <= buf.length) {
    const id = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding
    const size = version === 4 ? synchsafe(buf, pos + 4) : readUint32(buf, pos + 4);
    const start = pos + 10;
    const data = buf.subarray(start, Math.min(start + size, buf.length));
    if (id === 'TIT2') out.title = decodeText(data);
    else if (id === 'TPE1') out.artist = decodeText(data);
    else if (id === 'TALB') out.album = decodeText(data);
    else if (id === 'APIC' && !out.cover) out.cover = decodePicture(data);
    pos = start + size;
  }
  return out;
}

function readUint32(b, o) {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

function decoderFor(enc) {
  if (enc === 1) return new TextDecoder('utf-16');
  if (enc === 2) return new TextDecoder('utf-16be');
  if (enc === 3) return new TextDecoder('utf-8');
  return new TextDecoder('iso-8859-1');
}

function decodeText(data) {
  if (!data.length) return '';
  return decoderFor(data[0]).decode(data.subarray(1)).replace(/\u0000/g, '').trim();
}

function decodePicture(data) {
  const enc = data[0];
  let i = 1;
  let mime = '';
  while (i < data.length && data[i] !== 0) mime += String.fromCharCode(data[i++]);
  i += 1; // fim do mime
  i += 1; // tipo da imagem
  // pula a descrição (terminada em 0 ou 00 00 para UTF-16)
  if (enc === 1 || enc === 2) {
    while (i + 1 < data.length && !(data[i] === 0 && data[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < data.length && data[i] !== 0) i++;
    i += 1;
  }
  if (i >= data.length) return null;
  if (!mime || mime === '-->') return null;
  if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase().replace('jpg', 'jpeg');
  return new Blob([data.slice(i)], { type: mime });
}

function readDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = 'metadata';
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    a.src = url;
  });
}
