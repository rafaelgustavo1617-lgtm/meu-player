// Onde cada coisa fica salva. Tudo pode ser trocado por variáveis de ambiente.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT || 3000),
  // arquivo do banco de dados SQLite
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'meu-player.db'),
  // pasta onde os arquivos de áudio enviados são guardados
  musicDir: process.env.MUSIC_DIR || path.join(root, 'storage', 'music'),
  // pasta das capas extraídas dos MP3
  coversDir: process.env.COVERS_DIR || path.join(root, 'storage', 'covers'),
  // front-end servido pelo mesmo servidor (http://localhost:3000)
  frontendDir: path.resolve(root, '..', 'frontend'),
  // tamanho máximo de um arquivo enviado (300 MB)
  maxUpload: 300 * 1024 * 1024,
};
