#!/usr/bin/env node
/* Oracle test for Lesson 02's widget: the struct-layout model in
 * all_lessons/rust/lessons/02_places_values_stack.html  vs  the real rustc.
 *
 *   node tools/rust_verify/02_layout.js [lists=500] [seed=2] [--from=file.html|file.js]
 *
 * 1. Extracts the "layout core" from the lesson's inline script (between the two
 *    `// ---- layout core` markers), so the code under test is the code the reader runs,
 *    and checks that the "Show the core JS" listing is a verbatim excerpt of it.
 * 2. Generates random field lists from the widget's palette (plus fixed cases: every
 *    palette entry alone, the lesson's worked examples, and each of them reordered by the
 *    widget's sort button).
 * 3. Compiles ONE program with one probe per case and runs it: rustc reports size_of and
 *    align_of for the #[repr(C)] and the default-repr struct, and offset_of! for every field
 *    of the #[repr(C)] one.
 * 4. Requires exact agreement: repr(C) size, align and every offset; repr(Rust) size and
 *    align (its field ORDER is unspecified, so it is never compared).
 * 5. Checks the numeric claims the lesson's prose makes (CLAIMS below, plus the 24-orders claim) against both.
 * Prints every disagreement; exit status 1 if there is any.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), vm = require('vm');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const fromArg = (process.argv.find(a => a.startsWith('--from=')) || '').slice(7);
const LISTS = +(args[0] || 500), SEED = +(args[1] || 2);
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fromArg || path.join(ROOT, 'all_lessons', 'rust', 'lessons', '02_places_values_stack.html');

// ── 1. the code under test ─────────────────────────────────────────────
const text = fs.readFileSync(SRC, 'utf8');
const scripts = [];
if (/\.html?$/.test(SRC)) { const re = /<script>([\s\S]*?)<\/script>/g; let m; while ((m = re.exec(text))) scripts.push(m[1]); } else scripts.push(text);
const script = scripts.find(s => s.includes('// ---- layout core')) || '';
const a = script.indexOf('// ---- layout core'), b = script.indexOf('// ---- end layout core ----');
if (a < 0 || b < 0) { console.error('layout core markers not found in ' + SRC); process.exit(2); }
const core = script.slice(a, b);
const M = vm.runInNewContext(core + '\n;({ PALETTE: PALETTE, field: field, sortByAlign: sortByAlign, layout: layout })', { Math });
let problems = 0;
if (/\.html?$/.test(SRC)) {
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const shown = /<summary>Show the core JS<\/summary>\s*<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/.exec(text);
  if (!shown) { console.log('  no "Show the core JS" listing found'); problems++; }
  else if (!norm(core).includes(norm(unesc(shown[1])))) { console.log('  the "Show the core JS" listing is NOT a verbatim excerpt of the running core'); problems++; }
  else console.log(`core listing: ${unesc(shown[1]).split('\n').length} lines, verbatim excerpt of the running code`);
}

// ── 2. cases ───────────────────────────────────────────────────────────
let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const TYPES = M.PALETTE.map(p => p[0]);
const RUST = { '&T': "&'static u64", '&[T]': "&'static [u64]", '&str': "&'static str", '&dyn Debug': "&'static dyn std::fmt::Debug",
  'Box<T>': 'Box<u64>', 'Option<&T>': "Option<&'static u64>" };
const rustTy = (ty, n) => ty === '[u8; N]' ? `[u8; ${n}]` : (RUST[ty] || ty);

const WORKED = {   // the lesson's worked examples (names are the field names used in the prose)
  reading: [['valid', 'bool'], ['celsius', 'f64'], ['sensor', 'u16']],
  header: [['kind', 'u8'], ['len', 'u32'], ['flags', 'u16']],
  worst: [['a', 'u8'], ['b', 'u64'], ['c', 'u8'], ['d', 'u64'], ['e', 'u8']],
  views: [['valid', 'bool'], ['celsius', 'f64'], ['sensor', 'u16'], ['window', '&[T]'], ['label', '&str'], ['next', 'Option<&T>'], ['raw', '[u8; N]'], ['kind', 'u8']],
  checkpoint: [['tag', 'u8'], ['id', 'u64'], ['ok', 'bool'], ['count', 'u32']],
};
const cases = [];   // { id, n, list: [[name, ty]] }
const add = (list, n, tag) => cases.push({ id: cases.length, n, list, tag });
TYPES.forEach(t => { add([['f0', t]], 3, 'single'); if (t === '[u8; N]') { add([['f0', t]], 0, 'single'); add([['f0', t]], 16, 'single'); } });
Object.keys(WORKED).forEach(k => {
  add(WORKED[k], 3, k);
  const sorted = M.sortByAlign(WORKED[k].map(f => Object.assign(M.field(f[0], f[1], 3), { src: f }))).map(x => x.src);
  add(sorted, 3, k + '-sorted');
});
// the other states the prose describes: the first slider's early positions, an appended [u8; N], every field order
[1, 2, 3].forEach(k => add(WORKED.views.slice(0, k), 3, 'views-k' + k));
[5, 6].forEach(n => add(WORKED.reading.concat([['x1', '[u8; N]']]), n, 'reading+arr-n' + n));
const perms = (xs) => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms(xs.filter((_, j) => j !== i)).map(p => [x].concat(p)));
perms(WORKED.checkpoint).forEach(p => add(p, 3, 'perm:' + p.map(f => f[0]).join(',')));
for (let i = 0; i < LISTS; i++) {
  const nf = 1 + Math.floor(rnd() * 10), n = Math.floor(rnd() * 17), list = [];
  for (let j = 0; j < nf; j++) list.push(['f' + j, TYPES[Math.floor(rnd() * TYPES.length)]]);
  add(list, n, 'random');
}

// ── 3. one program, one probe per case ─────────────────────────────────
const out = ['#![allow(dead_code)]', 'use std::mem::{align_of, offset_of, size_of};'];
cases.forEach(c => {
  const body = c.list.map(f => `${f[0]}: ${rustTy(f[1], c.n)}`).join(', ');
  out.push(`#[repr(C)] struct C${c.id} { ${body} }`, `struct R${c.id} { ${body} }`);
});
out.push('fn main() {');
cases.forEach(c => {
  const offC = c.list.map(f => `offset_of!(C${c.id}, ${f[0]})`), offR = c.list.map(f => `offset_of!(R${c.id}, ${f[0]})`);
  out.push(`    println!("C${c.id}${' {}'.repeat(2 + offC.length)}", size_of::<C${c.id}>(), align_of::<C${c.id}>(), ${offC.join(', ')});`);
  out.push(`    println!("R${c.id}${' {}'.repeat(2 + offR.length)}", size_of::<R${c.id}>(), align_of::<R${c.id}>(), ${offR.join(', ')});`);
});
out.push('}');
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layout02_'));
const file = path.join(tmp, 'probe.rs'), exe = path.join(tmp, 'probe');
fs.writeFileSync(file, out.join('\n') + '\n');
const ver = cp.spawnSync(rustc, ['--version'], { encoding: 'utf8' }).stdout.trim();
const r = cp.spawnSync(rustc, ['--edition', '2024', '--error-format=json', '-o', exe, file], { encoding: 'utf8', maxBuffer: 1 << 28 });
let genBugs = 0;
for (const ln of (r.stderr || '').split('\n')) {
  let d; try { d = JSON.parse(ln); } catch (e) { continue; }
  if (d.level === 'error' && !/^aborting/.test(d.message)) { genBugs++; console.log('  [generator bug] ' + d.message); }
}
if (r.status !== 0 || genBugs) { console.log(`probe did not compile (${genBugs} errors)`); process.exit(1); }
const run = cp.spawnSync(exe, [], { encoding: 'utf8', maxBuffer: 1 << 28 });
const real = {};
run.stdout.split('\n').forEach(ln => { const p = ln.trim().split(/\s+/); if (p[0]) real[p[0]] = p.slice(1).map(Number); });

// ── 4. compare ─────────────────────────────────────────────────────────
let mism = 0, compared = 0, sameOrder = 0, sameRandom = 0;
const fmt = (L) => `size ${L.size} align ${L.align}`;
cases.forEach(c => {
  const fields = c.list.map(f => M.field(f[0], f[1], c.n));
  const LC = M.layout(fields, 'C'), LR = M.layout(fields, 'Rust');
  const offJS = {}; LC.blocks.forEach(bk => { if (!bk.pad) offJS[bk.field.name] = bk.at; });
  const rc = real['C' + c.id], rr = real['R' + c.id];
  const decl = 'struct { ' + c.list.map(f => f[0] + ': ' + rustTy(f[1], c.n)).join(', ') + ' }';
  compared += 2;
  const offOk = c.list.every((f, i) => rc[2 + i] === offJS[f[0]]);
  if (rc[0] !== LC.size || rc[1] !== LC.align || !offOk) {
    mism++; console.log(`  MISMATCH repr(C)    ${decl}\n            rustc size ${rc[0]} align ${rc[1]} offsets [${rc.slice(2)}]   model ${fmt(LC)} offsets [${c.list.map(f => offJS[f[0]])}]`);
  }
  if (rr[0] !== LR.size || rr[1] !== LR.align) {
    mism++; console.log(`  MISMATCH repr(Rust) ${decl}\n            rustc size ${rr[0]} align ${rr[1]}   model ${fmt(LR)}`);
  }
  // information only (never claimed): does rustc's chosen order happen to equal the model's?
  const offM = {}; LR.blocks.forEach(bk => { if (!bk.pad) offM[bk.field.name] = bk.at; });
  if (c.list.every((f, i) => rr[2 + i] === offM[f[0]])) { sameOrder++; if (c.tag === 'random') sameRandom++; }
});

// ── 5. the numbers the lesson's prose states ───────────────────────────
const CLAIMS = [   // [case tag, repr, size, align, padding] — each one a sentence in the lesson
  ['reading', 'C', 24, 8, 13], ['reading', 'Rust', 16, 8, 5], ['reading-sorted', 'C', 16, 8, 5],       // §2, road not taken
  ['views-k1', 'C', 1, 1, 0], ['views-k2', 'C', 16, 8, 7], ['views-k3', 'C', 24, 8, 13], ['views-k3', 'Rust', 16, 8, 5],  // §4 what to try
  ['views', 'C', 72, 8, 17], ['views', 'Rust', 56, 8, 1], ['views-sorted', 'C', 56, 8, 1],
  ['reading+arr-n5', 'Rust', 16, 8, 0], ['reading+arr-n6', 'Rust', 24, 8, 7],
  ['checkpoint', 'C', 24, 8, 10], ['checkpoint', 'Rust', 16, 8, 2], ['checkpoint-sorted', 'C', 16, 8, 2],  // checkpoint answer
  ['perm:tag,ok,count,id', 'C', 16, 8, 2],
];
let claimBad = 0;
const sizeOf = (c, repr) => M.layout(c.list.map(f => M.field(f[0], f[1], c.n)), repr);
CLAIMS.forEach(([tag, repr, size, align, padding]) => {
  const c = cases.find(x => x.tag === tag);
  const L = sizeOf(c, repr), R = real[(repr === 'C' ? 'C' : 'R') + c.id];
  if (L.size !== size || L.align !== align || L.padding !== padding || R[0] !== size || R[1] !== align) {
    claimBad++; console.log(`  CLAIM WRONG ${tag} repr(${repr}): prose says size ${size} align ${align} padding ${padding}; model ${fmt(L)} padding ${L.padding}; rustc size ${R[0]} align ${R[1]}`);
  }
});
// checkpoint answer: "so do 7 of the other 23 orders" — exactly 8 of the 24 orders reach 16 under repr(C), none goes below
const pc = cases.filter(c => c.tag.startsWith('perm:'));
const at16 = pc.filter(c => real['C' + c.id][0] === 16 && sizeOf(c, 'C').size === 16).length;
const minC = Math.min.apply(null, pc.map(c => real['C' + c.id][0]));
if (pc.length !== 24 || at16 !== 8 || minC !== 16) { claimBad++; console.log(`  CLAIM WRONG permutations: ${pc.length} orders, ${at16} at 16 B, smallest ${minC} B`); }

console.log(`${ver}: ${cases.length} field lists (${LISTS} random, ${cases.length - LISTS} fixed) = ${compared} layouts compared`);
console.log(`  repr(C): size + align + every offset_of!; repr(Rust): size + align`);
console.log(`  ${mism} mismatches, ${claimBad} wrong prose claims (of ${CLAIMS.length}), ${problems} listing problems, ${genBugs} generator problems`);
console.log(`  (info: rustc's repr(Rust) field order equalled the model's in ${sameOrder} of ${cases.length} lists, ${sameRandom} of the ${LISTS} random ones)`);
process.exit(mism || claimBad || problems || genBugs ? 1 : 0);
