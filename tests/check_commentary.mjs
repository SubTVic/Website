// Checks data/commentary.json: every slot is known and instant calls only use {team}/{opponent}.
// Usage: node tests/check_commentary.mjs
import fs from 'fs';
const db = JSON.parse(fs.readFileSync('data/commentary.json', 'utf8'));
const known = new Set(Object.keys(db.slots));
let n = 0, bad = [];
const check = (t, where, bark) => { n++; for (const m of t.matchAll(/\{(\w+)\}/g)) { if (!known.has(m[1])) bad.push(`${where}: unknown {${m[1]}}`); if (bark && !['team','opponent'].includes(m[1])) bad.push(`${where}: bark uses {${m[1]}}`); } };
for (const [ev, sits] of Object.entries(db.barks)) for (const [sit, o] of Object.entries(sits)) o.lines.forEach((t, i) => check(t, `barks.${ev}.${sit}.${i}`, true));
let ln = 0;
for (const [ev, sits] of Object.entries(db.lines)) for (const [sit, o] of Object.entries(sits)) for (const sp of ['pbp', 'color']) (o[sp] || []).forEach((t, i) => { ln++; check(t, `lines.${ev}.${sit}.${sp}.${i}`); });
console.log('total lines', n, 'follow-ups', ln, 'barks', n - ln);
console.log(bad.length ? bad : 'all slots known');
