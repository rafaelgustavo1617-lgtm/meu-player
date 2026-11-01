// Senha do app. A senha nunca é guardada: só um "hash" PBKDF2-SHA256 com sal aleatório,
// gerado pela Web Crypto API do navegador.
import { getMeta, setMeta } from './db.js';

const ITERATIONS = 210000;
const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(bits);
}

// compara sem "atalho" (mesmo tempo para qualquer diferença)
function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hasPassword() {
  return !!(await getMeta('lock'));
}

export async function setPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  await setMeta('lock', { salt: toHex(salt), hash, iterations: ITERATIONS, createdAt: Date.now() });
}

export async function checkPassword(password) {
  const rec = await getMeta('lock');
  if (!rec) return true;
  const hash = await derive(password, fromHex(rec.salt), rec.iterations);
  return same(hash, rec.hash);
}

export async function removePassword() {
  await setMeta('lock', null);
}

// Limite de tentativas: depois de 5 erros, espera 30 s (e dobra a cada nova rodada)
const attempts = { count: 0, until: 0, round: 0 };
export function lockedFor() {
  return Math.max(0, Math.ceil((attempts.until - Date.now()) / 1000));
}
export function registerFail() {
  attempts.count++;
  if (attempts.count >= 5) {
    attempts.round++;
    attempts.until = Date.now() + 30000 * 2 ** (attempts.round - 1);
    attempts.count = 0;
  }
}
export function registerSuccess() {
  attempts.count = 0;
  attempts.round = 0;
  attempts.until = 0;
}
