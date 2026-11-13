'use strict';
// Password / secret hashing (scrypt, built into Node – no native dependency) and token helpers.
const crypto = require('crypto');
const COST = { N: 32768, r: 8, p: 1 };
const scrypt = (secret, salt, len, o) => new Promise((res, rej) =>
  crypto.scrypt(secret, salt, len, { N: o.N, r: o.r, p: o.p, maxmem: 128 * o.N * o.r * 2 }, (e, k) => (e ? rej(e) : res(k))));

async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(secret).normalize('NFKC'), salt, 32, COST);
  return ['s1', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifySecret(secret, stored) {
  try {
    const [v, N, r, p, s, k] = String(stored).split('$');
    if (v !== 's1') return false;
    const want = Buffer.from(k, 'base64');
    const got = await scrypt(String(secret).normalize('NFKC'), Buffer.from(s, 'base64'), want.length, { N: +N, r: +r, p: +p });
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch (_) { return false; }
}
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function safeEqual(a, b) { // constant-time comparison of two arbitrary strings
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
const ALPHA = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no I L O U 0 1
function makeRecoveryCode() { // 16 symbols ≈ 78 bits
  const b = crypto.randomBytes(16); let s = '';
  for (let i = 0; i < 16; i++) { s += ALPHA[b[i] % ALPHA.length]; if (i % 4 === 3 && i < 15) s += '-'; }
  return s;
}
const normRecovery = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
module.exports = { hashSecret, verifySecret, randomToken, sha256, safeEqual, makeRecoveryCode, normRecovery };
