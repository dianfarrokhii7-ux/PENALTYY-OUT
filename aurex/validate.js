'use strict';
const { err } = require('./errors');
const RESERVED = new Set(['admin', 'administrator', 'owner', 'root', 'system', 'aurex', 'moderator', 'referee', 'support']);
const COMMON = new Set(['password', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'password1', 'iloveyou', '11111111', 'abc12345', 'penaltyout', 'aurex123']);
const bad = (field, msg) => err(400, 'INVALID_' + field.toUpperCase(), msg, { field });

function username(v) {
  if (typeof v !== 'string') throw bad('username', 'Enter a username.');
  const s = v.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(s)) throw bad('username', 'Username must be 3–20 characters: letters, numbers or underscore.');
  if (RESERVED.has(s.toLowerCase())) throw bad('username', 'That username is reserved.');
  return s;
}
function password(v, uname) {
  if (typeof v !== 'string' || v.length < 8) throw bad('password', 'Password must be at least 8 characters.');
  if (v.length > 128) throw bad('password', 'Password must be 128 characters or fewer.');
  if (COMMON.has(v.toLowerCase()) || (uname && v.toLowerCase() === uname.toLowerCase())) throw bad('password', 'That password is too easy to guess. Pick another one.');
  return v;
}
function teamName(v) {
  if (typeof v !== 'string') throw bad('team_name', 'Enter a team name.');
  const s = v.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N} _.'-]{3,24}$/u.test(s)) throw bad('team_name', 'Team name must be 3–24 characters (letters, numbers, spaces, . _ \' -).');
  return s;
}
function teamPassword(v) {
  if (typeof v !== 'string' || v.length < 6 || v.length > 64) throw bad('team_password', 'Team password must be 6–64 characters.');
  return v;
}
const MAX_LOGO = 150 * 1024;
function logo(v) { // data URL of png / jpeg / webp; returns {mime,data:Buffer} or null
  if (v == null || v === '') return null;
  const m = typeof v === 'string' && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  if (!m) throw bad('logo', 'Logo must be a PNG, JPEG or WebP image.');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_LOGO) throw bad('logo', 'Logo is too large (150 KB max).');
  const ok = m[1] === 'image/png' ? data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    : m[1] === 'image/jpeg' ? data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!ok) throw bad('logo', 'Logo file content does not match its type.');
  return { mime: m[1], data };
}
module.exports = { username, password, teamName, teamPassword, logo, MAX_LOGO };
