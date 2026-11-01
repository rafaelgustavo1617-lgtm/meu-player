// ============================================================================
//  LABORATÓRIO DE SEGURANÇA — Ataque à senha do Meu Player
// ----------------------------------------------------------------------------
//  Este programa ATACA a proteção de senha do SEU PRÓPRIO app, na SUA máquina.
//  Serve só para aprender como funcionam os ataques e por que as defesas
//  importam. NÃO use nenhuma técnica daqui contra contas, sites ou pessoas
//  que não sejam você — isso é crime (art. 154-A do Código Penal).
//
//  Como rodar:   node lab/ataque-senha.js
// ============================================================================

import crypto from 'node:crypto';

// Estas são EXATAMENTE as mesmas contas que o app usa em frontend/js/lock.js.
// É assim que o app guarda a senha: nunca o texto, só este "hash".
const enc = new TextEncoder();
const toHex = (buf) => Buffer.from(buf).toString('hex');

function hash(senha, salt, iteracoes) {
  // PBKDF2 = repete um cálculo "iteracoes" vezes, de propósito, para ficar lento.
  return toHex(crypto.pbkdf2Sync(enc.encode(senha), salt, iteracoes, 32, 'sha256'));
}

// Simula o app guardando uma senha: gera um sal aleatório e o hash.
function appGuardaSenha(senha, iteracoes) {
  const salt = crypto.randomBytes(16);
  return { salt, hash: hash(senha, salt, iteracoes), iteracoes };
}

// ---------------------------------------------------------------------------
// O "dicionário" do atacante: as senhas mais usadas do mundo. O primeiro
// lugar que qualquer ataque tenta. (Lista real das senhas mais vazadas.)
// ---------------------------------------------------------------------------
const DICIONARIO = [
  '123456', '123456789', '12345678', '1234', '12345', '000000', '111111',
  'password', 'senha', 'qwerty', 'abc123', 'admin', 'root', '1234567',
  'iloveyou', 'gabriel', 'rafael', 'musica', 'brasil', 'flamengo', '102030',
];

// Ataque 1: DICIONÁRIO — testa só a lista de senhas comuns. Rapidíssimo.
function ataqueDicionario(alvo) {
  const t0 = performance.now();
  for (const tentativa of DICIONARIO) {
    if (hash(tentativa, alvo.salt, alvo.iteracoes) === alvo.hash) {
      return { achou: tentativa, tentativas: DICIONARIO.indexOf(tentativa) + 1, ms: performance.now() - t0 };
    }
  }
  return { achou: null, tentativas: DICIONARIO.length, ms: performance.now() - t0 };
}

// Ataque 2: FORÇA BRUTA — testa TODAS as combinações possíveis, em ordem, até
// achar. Garante achar, mas o tempo explode conforme a senha cresce.
function ataqueForcaBruta(alvo, charset, tamanho) {
  const t0 = performance.now();
  let tentativas = 0;
  const indices = new Array(tamanho).fill(0);
  while (true) {
    const tentativa = indices.map((i) => charset[i]).join('');
    tentativas++;
    if (hash(tentativa, alvo.salt, alvo.iteracoes) === alvo.hash) {
      return { achou: tentativa, tentativas, ms: performance.now() - t0 };
    }
    let p = tamanho - 1; // "+1" como um hodômetro
    while (p >= 0 && ++indices[p] >= charset.length) { indices[p] = 0; p--; }
    if (p < 0) return { achou: null, tentativas, ms: performance.now() - t0 };
  }
}

// Mede a velocidade real da sua máquina: quantas tentativas por segundo ela
// faz com um certo número de repetições. É a base de todo o resto.
function velocidade(iteracoes) {
  const salt = crypto.randomBytes(16);
  const t0 = performance.now();
  const N = 400;
  for (let i = 0; i < N; i++) hash('teste' + i, salt, iteracoes);
  return N / ((performance.now() - t0) / 1000);
}

function tempoLegivel(s) {
  if (s < 1) return 'menos de 1 segundo';
  if (s < 60) return `${s.toFixed(1)} segundos`;
  if (s < 3600) return `${(s / 60).toFixed(1)} minutos`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} horas`;
  if (s < 31536000) return `${(s / 86400).toFixed(1)} dias`;
  const anos = s / 31536000;
  if (anos < 1e6) return `${Math.round(anos).toLocaleString('pt-BR')} anos`;
  if (anos < 1e9) return `${(anos / 1e6).toFixed(1)} milhões de anos`;
  return `${(anos / 1e9).toFixed(1)} bilhões de anos`;
}

const linha = (c = '─') => console.log(c.repeat(64));
const num = (n) => n.toLocaleString('pt-BR');

// ============================================================================
//  OS EXPERIMENTOS
// ============================================================================
const ITER_APP = 210000; // o que o Meu Player usa hoje
const DIGITOS = '0123456789';
const MINUSC = 'abcdefghijklmnopqrstuvwxyz';
const ALFANUM = MINUSC + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

console.log('\n🔒  LABORATÓRIO DE SENHAS — atacando o SEU Meu Player\n');
linha('═');

// ---- Experimento 1: senha fraca x dicionário --------------------------------
console.log('\n[1] Senha fraca "1234" — ataque de dicionário\n');
let alvo = appGuardaSenha('1234', ITER_APP);
console.log('    O app guardou só isto (hash):', alvo.hash.slice(0, 32) + '...');
console.log('    O atacante NÃO vê a senha. Ele vai adivinhando:\n');
let r = ataqueDicionario(alvo);
if (r.achou) console.log(`    💥 QUEBRADA: "${r.achou}" na tentativa ${r.tentativas}, em ${r.ms.toFixed(0)} ms.`);
console.log('    → Senha óbvia cai na hora. Está na primeira lista que todo atacante tenta.\n');
linha();

// ---- Experimento 2: PIN de 4 dígitos x força bruta --------------------------
// Para a demonstração ser rápida, aqui a quebra roda com POUCAS repetições.
// Logo abaixo a gente calcula quanto levaria com as 210.000 reais do app.
console.log('\n[2] PIN "7431" (4 números) — força bruta\n');
const alvoDemo = appGuardaSenha('7431', 1000);
console.log('    Não está no dicionário. O atacante testa 0000, 0001, 0002...\n');
r = ataqueForcaBruta(alvoDemo, DIGITOS, 4);
console.log(`    💥 QUEBRADA: "${r.achou}" após ${num(r.tentativas)} tentativas, em ${(r.ms / 1000).toFixed(1)} s.`);
console.log('    → Só 10.000 combinações possíveis. Um PIN curto não resiste.\n');
linha();

// ---- Experimento 3: por que o PBKDF2 (as repetições) importa ----------------
console.log('\n[3] A defesa escondida: as 210.000 repetições do PBKDF2\n');
console.log('    Medindo quanto tempo o atacante levaria para testar os 10.000 PINs:\n');
for (const iter of [1, 1000, ITER_APP]) {
  const seg = 10000 / velocidade(iter);
  console.log(`    ${String(num(iter)).padStart(8)} repetições → testar todos os PINs levaria ${tempoLegivel(seg)}`);
}
console.log('\n    → Mesmo PIN fraco. Quanto mais repetições, mais LENTO fica para o');
console.log('      atacante. É por isso que o app usa 210.000 de propósito.\n');
linha();

// ---- Experimento 4: senha forte é imbatível ---------------------------------
console.log('\n[4] Por que uma senha FORTE vence — a conta do tempo\n');
const casos = [
  ['PIN de 4 números', DIGITOS.length, 4],
  ['6 letras minúsculas', MINUSC.length, 6],
  ['8 letras e números', ALFANUM.length, 8],
  ['12 letras e números', ALFANUM.length, 12],
];
const vel = velocidade(ITER_APP); // velocidade real, com as repetições do app
console.log(`    Velocidade da sua máquina: ~${num(Math.round(vel))} tentativas/segundo (com 210.000 repetições)\n`);
for (const [nome, alf, tam] of casos) {
  const comb = Math.pow(alf, tam);
  const seg = comb / vel / 2; // /2 = em média acha na metade do caminho
  console.log(`    ${nome.padEnd(22)} ${String(num(comb)).padStart(26)} combinações → ${tempoLegivel(seg)}`);
}
console.log('\n    → Cada caractere a mais multiplica o tempo. Senha longa é imbatível');
console.log('      na força bruta, mesmo o atacante tendo o hash em mãos.\n');
linha('═');
console.log('\n✅  Lições:');
console.log('    1. O app nunca guarda sua senha, só o hash — bom.');
console.log('    2. Senha curta/óbvia cai mesmo com hash. O tamanho é o que protege.');
console.log('    3. PBKDF2 (repetições) deixa cada tentativa lenta, segurando o ataque.');
console.log('    4. Regra de ouro: só ataque o que é SEU. Aqui, foi o seu próprio app.\n');
