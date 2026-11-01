// Importa todas as músicas de uma pasta (e subpastas) para o banco.
// Uso: npm run import -- "C:\Users\Rafael\Music"   ou   npm run import -- ~/Músicas
import fs from 'node:fs';
import path from 'node:path';
import { addTrack } from '../src/repo.js';

const folder = process.argv[2];
if (!folder) {
  console.error('Diga qual pasta importar. Exemplo: npm run import -- ~/Músicas');
  process.exit(1);
}

const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (AUDIO.test(entry.name)) yield full;
  }
}

let added = 0, skipped = 0, failed = 0;
for (const file of walk(path.resolve(folder))) {
  try {
    const { track, created } = addTrack(fs.readFileSync(file), path.basename(file));
    if (created) { added++; console.log(`+ ${track.artist || 'Artista desconhecido'} — ${track.title}`); }
    else skipped++;
  } catch (e) {
    failed++;
    console.warn(`! ${path.basename(file)}: ${e.message}`);
  }
}
console.log(`\nPronto: ${added} adicionadas, ${skipped} já existiam, ${failed} com erro.`);
