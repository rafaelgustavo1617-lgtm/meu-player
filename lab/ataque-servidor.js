// ============================================================================
//  LABORATÓRIO DE SEGURANÇA — Ataque ao servidor do Meu Player
// ----------------------------------------------------------------------------
//  Ataca o SEU PRÓPRIO servidor, na SUA máquina, para mostrar uma falha real:
//  a API não tem senha nenhuma. Qualquer um que alcança o servidor entra.
//  Só para aprender. Nunca faça isto contra servidor que não seja seu.
//
//  Como rodar:   node lab/ataque-servidor.js
// ============================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Sobe o SEU servidor numa pastinha temporária, como se fosse o do seu computador.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alvo-'));
process.env.DB_FILE = path.join(tmp, 'musicas.db');
process.env.MUSIC_DIR = path.join(tmp, 'music');
process.env.COVERS_DIR = path.join(tmp, 'covers');

const { server } = await import('../backend/src/server.js');
const { addTrack } = await import('../backend/src/repo.js');

// Finge que VOCÊ já tem músicas guardadas (as suas, particulares).
const mp3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, ...new Array(2000).fill(0)]);
addTrack(mp3, 'Banda da Garagem - Noite em Santos.mp3');
addTrack(mp3.subarray(0, 1500), 'Minhas gravacoes - Ensaio secreto.mp3');

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const diz = async (texto, ms = 1100) => { console.log(texto); await pausa(ms); };

await new Promise((r) => server.listen(0, r));
const PORTA = server.address().port;
const ALVO = `http://localhost:${PORTA}`;

console.log('\n🎯  LABORATÓRIO — invadindo o SEU servidor\n');
console.log('═'.repeat(60));

await diz(`\n    O seu servidor está no ar em ${ALVO}`);
await diz('    Você tem suas músicas guardadas lá. Tudo particular... será?\n');
await diz('    Agora eu sou o ATACANTE. Não tenho a sua senha do app.');
await diz('    Só vou bater direto na porta do servidor e PEDIR as músicas:\n', 1400);

// ATAQUE 1: ler tudo, sem senha nenhuma
const r = await fetch(`${ALVO}/api/tracks`);
const musicas = await r.json();
await diz(`    > GET /api/tracks   (resposta ${r.status} — deu certo)\n`, 1200);
await diz('    💥 O servidor me entregou a sua biblioteca inteira:\n');
for (const m of musicas) await diz(`        • ${m.title}  —  ${m.artist}`, 700);

await diz('\n    E eu nem precisei de senha. A porta estava destrancada.\n', 1500);
console.log('─'.repeat(60));

// ATAQUE 2: apagar uma música, também sem senha
await diz('\n    Pior: posso APAGAR as suas músicas. Vou apagar uma:\n', 1300);
const alvo = musicas.find((m) => m.title.includes('Ensaio'));
const del = await fetch(`${ALVO}/api/tracks/${alvo.id}`, { method: 'DELETE' });
await diz(`    > DELETE /api/tracks/${alvo.id.slice(0, 8)}...   (resposta ${del.status})\n`, 1200);
const sobrou = await (await fetch(`${ALVO}/api/tracks`)).json();
await diz(`    💥 "${alvo.title}" foi apagada. Sobraram ${sobrou.length} de ${musicas.length}.\n`, 1500);

console.log('═'.repeat(60));
console.log('\n🔎  O que isso ensina:\n');
console.log('    • A senha do APP protege só a tela do celular.');
console.log('    • O SERVIDOR não tem senha nenhuma. Quem chega nele, manda.');
console.log('    • Falha clássica: "Broken Access Control" (a nº 1 do OWASP).');
console.log('    • A defesa é LOGIN no servidor: sem token válido, ele diz 401 e');
console.log('      recusa o pedido — antes de entregar ou apagar qualquer coisa.\n');

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
