#!/usr/bin/env node
/* Oracle for Lesson 19's widget: all_lessons/rust/lessons/ubmachine.js ("A tiny abstract machine").
 *
 *   node tools/rust_verify/19_ubmachine.js [randomScripts=600] [seed=19]
 *
 * rustc cannot judge undefined behavior (a UB program compiles, and running it proves nothing), and Miri
 * is not installed (stable toolchain only). So the oracle has four parts:
 * Part 1  a hand-derived table: every case traced to the rule it tests (an item of the Reference's UB list
 *         as recorded in FACTS G-iv, or an unsafe function's stated condition), the expected verdict written
 *         down in advance: UB kind + step (+ certain/possible for alignment), or defined + printed values + leaks.
 *         Every widget preset is in the table.
 * Part 2  random scripts: a separately written byte-level model (below; it shares only the parser) must
 *         reach the same verdict, step and output as the engine.
 * Part 3  every script the engine calls DEFINED (parts 1 and 2) is translated into real Rust, compiled once
 *         with rustc --edition 2024 (a debug build) and run; the values it prints must equal the engine's.
 *         Scripts with a UB verdict are never run.
 * Part 4  the Rust translation of every UB script is compiled, never run: the translator covers every op.
 * Prints every mismatch; exit 1 if any.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const M = require('../../all_lessons/rust/lessons/ubmachine.js');

const NRAND = +(process.argv[2] || 600), SEED = +(process.argv[3] || 19);
let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const int = (n) => Math.floor(rnd() * n);
const pick = (a) => a[int(a.length)];
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ub19_'));
const S = (...lines) => lines.join('\n');
let mismatches = 0;
const bad = (msg) => { mismatches++; console.log('MISMATCH ' + msg); };

/* ───────── Part 1: the hand-derived table (expected verdicts fixed in advance) ─────────
 * expect: 'kind@step' | 'align@step!' (misaligned on every allocation) | 'align@step?' (on some)
 *         | 'ok:v1,v2|A,B'  (defined; printed values | leaked heap blocks)                        */
const P = {}; M.PRESETS.forEach(p => { P[p.id] = p.text; });
const TABLE = [
  // dangling: null (G35, G46: a null pointer to a non-zero-sized value is in no allocation)
  ['null u32 read', 'G35/G46', P.null, 'null@2'],
  ['null u8 write', 'G35/G46', S('let n = null()', 'n.write(1)'), 'null@2'],
  ['null bool read', 'G35/G46', S('let n = null::<bool>()', 'n.read()'), 'null@2'],
  ['null, cast, read', 'G35/G46', S('let n = null()', 'let w = n.cast::<u32>()', 'w.read()'), 'null@3'],
  ['null add(0) then read', 'G35/G46', S('let n = null::<u32>()', 'let m = n.add(0)', 'm.read()'), 'null@3'],
  ['null add(1)', 'G67 offset in bounds', S('let n = null::<u32>()', 'let m = n.add(1)'), 'arith@2'],
  // dangling: use after free (G35, G46: the allocation is no longer live)
  ['uaf preset', 'G35/G46', P.uaf, 'uaf@6'],
  ['uaf u8 write', 'G35/G46', S('let a = alloc(2, 1)', 'dealloc(a)', 'a.write(1)'), 'uaf@3'],
  ['uaf via derived pointer', 'G35/G46', S('let a = alloc(8, 4)', 'let p = a.add(4)', 'dealloc(a)', 'p.read()'), 'uaf@4'],
  ['uaf via copy', 'G35/G46', S('let a = alloc(4, 4)', 'let q = a', 'dealloc(a)', 'q.write(9)'), 'uaf@4'],
  ['add(1) on a freed block', 'G67 offset in bounds', S('let a = alloc(8, 4)', 'dealloc(a)', 'let p = a.add(1)'), 'arith@3'],
  ['add(0) on a freed block, then read', 'G35/G46', S('let a = alloc(4, 4)', 'dealloc(a)', 'let p = a.add(0)', 'p.read()'), 'uaf@4'],
  // dangling: use after scope (G35, G46: the local's storage has ended; compare I80)
  ['scope preset', 'G35/G46', P.scope, 'scope@4'],
  ['write after scope', 'G35/G46', S('let p = local(1)', 'end(p)', 'p.write(2)'), 'scope@3'],
  ['derived pointer after scope', 'G35/G46', S('let p = local(9)', 'let b = p.cast::<u8>()', 'end(p)', 'b.read()'), 'scope@4'],
  ['read before the scope ends', 'defined', S('let p = local(300)', 'let b = p.cast::<u8>()', 'b.read()', 'end(p)'), 'ok:44|'],
  // dangling: out of bounds (G35, G46: not all bytes inside one live allocation)
  ['overflow preset', 'G35/G46', P.overflow, 'oob@9'],
  ['u32 at offset 4 of 6 bytes', 'G35/G46', S('let a = alloc(6, 4)', 'let b = a.add(4)', 'b.write(1)', 'let w = b.cast::<u32>()', 'w.read()'), 'oob@5'],
  ['u8 read at the end', 'G35/G46', S('let a = alloc(4, 1)', 'let e = a.add(4)', 'e.read()'), 'oob@3'],
  ['u32 crossing the end (also misaligned: bounds first)', 'G35/G46', S('let a = alloc(4, 2)', 'let b = a.add(2)', 'let w = b.cast::<u32>()', 'w.write(1)'), 'oob@4'],
  ['local, one u32 past it', 'G35/G46', S('let p = local(1)', 'let q = p.add(1)', 'q.read()'), 'oob@3'],
  ['local byte 3', 'defined', S('let p = local(0x11223344)', 'let b = p.cast::<u8>()', 'let c = b.add(3)', 'c.read()'), 'ok:17|'],
  // pointer arithmetic (G67: offset is UB if not in bounds; the end counts, G95)
  ['arith preset', 'G67', P.arith, 'arith@4'],
  ['u8 add past the end', 'G67', S('let a = alloc(3, 1)', 'let p = a.add(4)'), 'arith@2'],
  ['end, then one more', 'G67', S('let a = alloc(4, 4)', 'let e = a.add(4)', 'let f = e.add(1)'), 'arith@3'],
  ['u32 add to the end only', 'defined', S('let a = alloc(8, 4)', 'let w = a.cast::<u32>()', 'let p = w.add(2)'), 'ok:|A'],
  ['local add(2) past the end', 'G67', S('let p = local(5)', 'let q = p.add(2)'), 'arith@2'],
  // misaligned (G35, G45)
  ['misalign preset', 'G35/G45', P.misalign, 'align@6!'],
  ['maybe preset', 'G35/G45', P.maybe, 'align@3?'],
  ['align 2, offset 2, u32 write', 'G35/G45', S('let a = alloc(8, 2)', 'let b = a.add(2)', 'let w = b.cast::<u32>()', 'w.write(7)'), 'align@4?'],
  ['align 2, offset 1, u32 read (before uninit)', 'G35/G45', S('let a = alloc(8, 2)', 'let b = a.add(1)', 'let w = b.cast::<u32>()', 'w.read()'), 'align@4!'],
  ['align 8, offset 4', 'defined', S('let a = alloc(8, 8)', 'let b = a.add(4)', 'let w = b.cast::<u32>()', 'w.write(1)', 'w.read()'), 'ok:1|A'],
  ['char at offset 2', 'G35/G45', S('let a = alloc(8, 4)', 'let b = a.add(2)', 'let c = b.cast::<char>()', 'c.read()'), 'align@4!'],
  ['align 16, offset 6 of 8 bytes: bounds first', 'G35/G46', S('let a = alloc(8, 16)', 'let b = a.add(6)', 'let w = b.cast::<u32>()', 'w.read()'), 'oob@4'],
  ['align 16, offset 6 of 16 bytes', 'G35/G45', S('let a = alloc(16, 16)', 'let b = a.add(6)', 'let w = b.cast::<u32>()', 'w.read()'), 'align@4!'],
  ['u8 at an odd offset', 'defined', S('let a = alloc(4, 4)', 'let b = a.add(3)', 'b.write(9)', 'b.read()'), 'ok:9|A'],
  ['bool at an odd offset', 'defined', S('let a = alloc(4, 1)', 'let b = a.add(1)', 'b.write(1)', 'let f = b.cast::<bool>()', 'f.read()'), 'ok:true|A'],
  // uninitialized (G42, G47, G49: integers, bool, char must be initialized)
  ['uninit preset', 'G47/G49', P.uninit, 'uninit@5'],
  ['one byte of four written', 'G47/G49', S('let a = alloc(4, 4)', 'a.write(1)', 'let w = a.cast::<u32>()', 'w.read()'), 'uninit@4'],
  ['fresh u8', 'G47/G49', S('let a = alloc(1, 1)', 'a.read()'), 'uninit@2'],
  ['fresh bool (uninit before invalid)', 'G47/G49', S('let a = alloc(1, 1)', 'let f = a.cast::<bool>()', 'f.read()'), 'uninit@3'],
  ['fresh char', 'G47/G49', S('let a = alloc(4, 4)', 'let c = a.cast::<char>()', 'c.read()'), 'uninit@3'],
  ['four bytes, one u32', 'defined', S('let a = alloc(4, 4)', 'a.write(1)', 'let b = a.add(1)', 'b.write(2)', 'let c = a.add(2)', 'c.write(3)',
    'let d = a.add(3)', 'd.write(4)', 'let w = a.cast::<u32>()', 'w.read()'), 'ok:67305985|A'],
  ['a u32, read as bytes (little-endian)', 'defined', S('let a = alloc(4, 4)', 'let w = a.cast::<u32>()', 'w.write(0x01020304)', 'a.read()', 'let b = a.add(3)', 'b.read()'), 'ok:4,1|A'],
  // invalid bool (G42, G47)
  ['bool preset', 'G47', P.bool, 'bool@4'],
  ['bool 1, freed', 'defined', S('let b = alloc(1, 1)', 'b.write(1)', 'let f = b.cast::<bool>()', 'f.read()', 'dealloc(b)'), 'ok:true|'],
  ['bool 0', 'defined', S('let b = alloc(1, 1)', 'b.write(0)', 'let f = b.cast::<bool>()', 'f.read()'), 'ok:false|A'],
  ['bool 255', 'G47', S('let b = alloc(1, 1)', 'b.write(255)', 'let f = b.cast::<bool>()', 'f.read()'), 'bool@4'],
  ['bool from the low byte of 256', 'defined', S('let a = alloc(4, 4)', 'let w = a.cast::<u32>()', 'w.write(256)', 'let f = a.cast::<bool>()', 'f.read()'), 'ok:false|A'],
  ['bool from byte 1 of 256', 'defined', S('let a = alloc(4, 4)', 'let w = a.cast::<u32>()', 'w.write(256)', 'let b = a.add(1)', 'let f = b.cast::<bool>()', 'f.read()'), 'ok:true|A'],
  // invalid char (G42, G47)
  ['char preset 0xD800', 'G47', P.char, 'char@5'],
  ['char 0xDFFF', 'G47', S('let c = alloc(4, 4)', 'let w = c.cast::<u32>()', 'w.write(0xDFFF)', 'let ch = c.cast::<char>()', 'ch.read()'), 'char@5'],
  ['char 0x110000', 'G47', S('let c = alloc(4, 4)', 'let w = c.cast::<u32>()', 'w.write(0x110000)', 'let ch = c.cast::<char>()', 'ch.read()'), 'char@5'],
  ['char 0x10FFFF', 'defined', S('let c = alloc(4, 4)', 'let w = c.cast::<u32>()', 'w.write(0x10FFFF)', 'let ch = c.cast::<char>()', 'ch.read()'), 'ok:U+10FFFF|A'],
  ['char 0x41', 'defined', S('let c = alloc(4, 4)', 'let w = c.cast::<u32>()', 'w.write(0x41)', 'let ch = c.cast::<char>()', 'ch.read()'), 'ok:U+0041|A'],
  ['char 0xE000', 'defined', S('let c = alloc(4, 4)', 'let w = c.cast::<u32>()', 'w.write(0xE000)', 'let ch = c.cast::<char>()', 'ch.read()'), 'ok:U+E000|A'],
  ['char 0xD7FF', 'defined', S('let c = alloc(4, 4)', 'let w = c.cast::<u32>()', 'w.write(0xD7FF)', 'let ch = c.cast::<char>()', 'ch.read()'), 'ok:U+D7FF|A'],
  ['char 0xFFFFFFFF', 'G47', S('let c = alloc(4, 4)', 'let w = c.cast::<u32>()', 'w.write(0xFFFFFFFF)', 'let ch = c.cast::<char>()', 'ch.read()'), 'char@5'],
  // double free (Lesson 01's family; FACTS I81, G78)
  ['double preset', 'I81', P.double, 'double@3'],
  ['free, alloc another, free the first again', 'I81', S('let a = alloc(4, 4)', 'dealloc(a)', 'let b = alloc(4, 4)', 'dealloc(a)'), 'double@4'],
  ['two blocks, each freed once', 'defined', S('let a = alloc(4, 4)', 'let b = alloc(8, 8)', 'dealloc(b)', 'dealloc(a)'), 'ok:|'],
  // zero-size allocation (G92)
  ['alloc(0, 1)', 'G92', S('let a = alloc(0, 1)'), 'zero@1'],
  ['alloc(0, 4) second', 'G92', S('let a = alloc(4, 4)', 'let z = alloc(0, 4)'), 'zero@2'],
  // leaks are not UB (G55)
  ['leak preset', 'G55', P.leak, 'ok:1|A'],
  ['two leaks', 'G55', S('let a = alloc(1, 1)', 'let b = alloc(2, 2)'), 'ok:|A,B'],
  // defined presets and the order of checks
  ['push preset', 'defined', P.push, 'ok:30|'],
  ['freed and past the end: liveness first', 'G35/G46', S('let a = alloc(4, 4)', 'let e = a.add(4)', 'dealloc(a)', 'e.read()'), 'uaf@4'],
  ['past the end and uninit: bounds first', 'G35/G46', S('let a = alloc(4, 4)', 'let b = a.add(2)', 'let w = b.cast::<u32>()', 'w.read()'), 'oob@4'],
  ['misaligned and uninit: alignment first', 'G35/G45', S('let a = alloc(8, 4)', 'let b = a.add(1)', 'let w = b.cast::<u32>()', 'w.read()'), 'align@4!'],
  ['nothing after UB runs', 'G35/G46', S('let n = null::<u32>()', 'n.read()', 'let a = alloc(0, 1)'), 'null@2'],
  ['a copied pointer', 'defined', S('let a = alloc(4, 4)', 'let w = a.cast::<u32>()', 'let v = w', 'v.write(5)', 'w.read()'), 'ok:5|A'],
  ['largest u32 local', 'defined', S('let p = local(4294967295)', 'p.read()'), 'ok:4294967295|'],
  ['local written, read, ended', 'defined', S('let p = local(7)', 'p.write(8)', 'p.read()', 'end(p)'), 'ok:8|'],
];

function verdictString(res) {
  if (res.ub) return res.ub.kind + '@' + res.ub.step + (res.ub.kind === 'align' ? (res.ub.certain ? '!' : '?') : '');
  return 'ok:' + res.out.join(',') + '|' + res.leaks.join(',');
}

/* ───────── Part 2: an independent byte-level model (shares only the parser) ───────── */
const SIZE = { u8: 1, bool: 1, u32: 4, char: 4 };
function refModel(ops) {
  const blocks = [];                 // { size, align, heap, state: 'live'|'gone', cell: {offset: byte} }
  const env = new Map();             // name -> { b: index|-1, o, t }
  const out = [], opBlock = new Map();
  const letter = (i) => String.fromCharCode(65 + i);
  function residues(al) { const r = []; for (let b = 0; b < 16; b += al) r.push(b); return r; }
  for (let s = 0; s < ops.length; s++) {
    const op = ops[s], step = s + 1;
    const fail = (kind, extra) => ({ ub: Object.assign({ kind, step }, extra || {}), out, leaks: [] });
    if (op.kind === 'alloc') {
      if (!(op.size > 0)) return fail('zero');
      blocks.push({ size: op.size, align: op.align, heap: true, state: 'live', cell: {} });
      opBlock.set(s, blocks.length - 1); env.set(op.name, { b: blocks.length - 1, o: 0, t: 'u8' });
    } else if (op.kind === 'local') {
      const cell = {}; let v = op.val;
      for (let k = 0; k < 4; k++) { cell[k] = v % 256; v = Math.floor(v / 256); }
      blocks.push({ size: 4, align: 4, heap: false, state: 'live', cell });
      opBlock.set(s, blocks.length - 1); env.set(op.name, { b: blocks.length - 1, o: 0, t: 'u32' });
    } else if (op.kind === 'null') env.set(op.name, { b: -1, o: 0, t: op.ty });
    else if (op.kind === 'copy') env.set(op.name, Object.assign({}, env.get(op.from)));
    else if (op.kind === 'cast') { const q = env.get(op.from); env.set(op.name, { b: q.b, o: q.o, t: op.ty }); }
    else if (op.kind === 'add') {
      const q = env.get(op.from), d = op.n * SIZE[q.t];
      if (d !== 0) {
        if (q.b < 0 || blocks[q.b].state !== 'live') return fail('arith');
        if (q.o + d > blocks[q.b].size) return fail('arith');
      }
      env.set(op.name, { b: q.b, o: q.o + d, t: q.t });
    } else if (op.kind === 'dealloc') {
      const blk = blocks[opBlock.get(op.at)];
      if (blk.state !== 'live') return fail('double');
      blk.state = 'gone';
    } else if (op.kind === 'end') {
      blocks[opBlock.get(op.at)].state = 'gone';
    } else if (op.kind === 'read' || op.kind === 'write') {
      const q = env.get(op.ptr), n = SIZE[q.t];
      if (q.b < 0) return fail('null');
      const blk = blocks[q.b];
      if (blk.state !== 'live') return fail(blk.heap ? 'uaf' : 'scope');
      for (let k = 0; k < n; k++) if (q.o + k >= blk.size) return fail('oob');
      const need = n;                                   // alignment = size for these four types
      const addrs = residues(blk.align).map(b => (b + q.o) % 16);
      const mis = addrs.filter(x => x % need !== 0).length;
      if (mis > 0) return fail('align', { certain: mis === addrs.length });
      if (op.kind === 'write') { let v = op.val; for (let k = 0; k < n; k++) { blk.cell[q.o + k] = v % 256; v = Math.floor(v / 256); } }
      else {
        let v = 0;
        for (let k = n - 1; k >= 0; k--) { if (!(q.o + k in blk.cell)) return fail('uninit'); v = v * 256 + blk.cell[q.o + k]; }
        if (q.t === 'bool') { if (v !== 0 && v !== 1) return fail('bool'); out.push(v ? 'true' : 'false'); }
        else if (q.t === 'char') {
          if (v > 0x10FFFF || (v >= 0xD800 && v < 0xE000)) return fail('char');
          let h = v.toString(16).toUpperCase(); while (h.length < 4) h = '0' + h; out.push('U+' + h);
        } else out.push(String(v));
      }
    }
  }
  const leaks = [];
  blocks.forEach((b, i) => { if (b.heap && b.state === 'live') leaks.push(letter(i)); });
  return { ub: null, out, leaks };
}

/* ───────── random scripts ───────── */
const VALS = [0, 1, 2, 3, 7, 44, 255, 256, 300, 0x41, 0xD7FF, 0xD800, 0xDFFF, 0xE000, 0x10FFFF, 0x110000, 0x01020304, 0xFFFFFFFF];
const TEMPLATES = {
  value(L) { const blk = pick(['alloc(4, 4)', 'alloc(8, 4)', 'alloc(8, 8)', 'local(' + pick(VALS) + ')']); L.push('let a = ' + blk);
    const w = blk.startsWith('local') ? 'a' : 'w'; if (w === 'w') L.push('let w = a.cast::<u32>()');
    if (rnd() < 0.85) L.push(`${w}.write(${pick(VALS)})`);
    const off = pick([0, 0, 0, 1, 2, 3]); let base = w;
    if (off) { L.push(`let b = ${w}.cast::<u8>()`, `let c = b.add(${off})`); base = 'c'; }
    L.push(`let t = ${base}.cast::<${pick(['bool', 'bool', 'char', 'char', 'u8', 'u32'])}>()`, 't.read()'); },
  align(L) { const al = pick([1, 2, 4, 8, 16]); L.push(`let a = alloc(${pick([4, 8, 12, 16])}, ${al})`);
    L.push(`let b = a.add(${pick([0, 1, 2, 3, 4, 5, 6, 8])})`, `let w = b.cast::<${pick(['u32', 'u32', 'char', 'u8'])}>()`);
    if (rnd() < 0.5) L.push('let x = w.cast::<u32>()', `x.write(${pick(VALS)})`, 'w.read()'); else L.push('w.read()'); },
  scope(L) { L.push(`let p = local(${pick(VALS)})`); if (rnd() < 0.5) L.push('let q = p.cast::<u8>()'); else L.push('let q = p.add(0)');
    if (rnd() < 0.5) L.push('q.read()'); if (rnd() < 0.7) L.push('end(p)'); L.push(pick(['q.read()', 'p.read()', 'p.write(5)', 'let r = q.add(1)'])); },
  nul(L) { const t = pick(['u8', 'u32', 'bool', 'char']); L.push(`let n = null::<${t}>()`);
    if (rnd() < 0.5) L.push(`let m = n.add(${pick([0, 0, 1, 2])})`, 'm.read()'); else L.push(t === 'u8' || t === 'u32' ? pick(['n.read()', 'n.write(1)']) : 'n.read()'); },
  free(L) { L.push(`let a = alloc(${pick([1, 4, 8])}, ${pick([1, 4, 8])})`, 'let q = a');
    if (rnd() < 0.6) L.push('a.write(7)'); if (rnd() < 0.8) L.push('dealloc(a)');
    L.push(pick(['q.read()', 'a.read()', 'dealloc(a)', 'let r = q.add(1)', 'let r = q.add(0)', 'q.write(1)'])); },
};
function genTemplate() {
  const L = []; TEMPLATES[pick(Object.keys(TEMPLATES))](L); return L.join('\n');
}
function genScript() {
  if (rnd() < 0.5) { const t = genTemplate(); if (!M.parse(t).error) return t; }
  const lines = [];
  let names = [], fresh = 0;
  const want = 3 + int(10), careful = rnd() < 0.8;
  const ptrOf = (ty) => names.filter(x => !ty || x.ty === ty);
  for (let tries = 0; lines.length < want && tries < 200; tries++) {
    const r = rnd(), nm = 'p' + (fresh);
    let line = null, bind = null;
    const heapCount = names.filter(x => x.origin === 'alloc' || x.origin === 'local').length;
    if ((r < 0.16 || !names.length) && heapCount < 5) {
      const size = rnd() < 0.03 ? 0 : 1 + int(16), align = pick([1, 2, 4, 4, 4, 8, 16]);
      line = `let ${nm} = alloc(${size}, ${align})`; bind = { name: nm, ty: 'u8', origin: 'alloc' };
    } else if (r < 0.22 && heapCount < 5) { line = `let ${nm} = local(${pick(VALS)})`; bind = { name: nm, ty: 'u32', origin: 'local' }; }
    else if (r < 0.24) { const t = pick(['u8', 'u32', 'bool', 'char']); line = `let ${nm} = null::<${t}>()`; bind = { name: nm, ty: t, origin: 'null' }; }
    else if (r < 0.40 && names.length) { const s = pick(names), t = pick(['u8', 'u32', 'u32', 'bool', 'char']); line = `let ${nm} = ${s.name}.cast::<${t}>()`; bind = { name: nm, ty: t, origin: 'derived' }; }
    else if (r < 0.54 && names.length) { const s = pick(names); line = `let ${nm} = ${s.name}.add(${pick([0, 1, 1, 1, 2, 2, 3, 4, 5, 8, 16])})`; bind = { name: nm, ty: s.ty, origin: 'derived' }; }
    else if (r < 0.56 && names.length) { const s = pick(names); line = `let ${nm} = ${s.name}`; bind = { name: nm, ty: s.ty, origin: 'derived' }; }
    else if (r < 0.74 && ptrOf().some(x => x.ty === 'u8' || x.ty === 'u32')) {
      const s = pick(ptrOf().filter(x => x.ty === 'u8' || x.ty === 'u32'));
      const v = s.ty === 'u8' ? pick([0, 1, 2, 7, 44, 255]) : pick(VALS);
      line = `${s.name}.write(${rnd() < 0.3 ? '0x' + v.toString(16) : v})`;
    } else if (r < 0.90 && names.length) { const s = pick(names); line = `${s.name}.read()`; }
    else if (r < 0.96 && names.some(x => x.origin === 'alloc')) { const s = pick(names.filter(x => x.origin === 'alloc')); line = `dealloc(${s.name})`; }
    else if (names.some(x => x.origin === 'local' && !x.ended)) { const s = pick(names.filter(x => x.origin === 'local' && !x.ended)); line = `end(${s.name})`; s.pendingEnd = true; }
    if (!line) continue;
    const trial = lines.concat([line]).join('\n'), pr = M.parse(trial);
    if (pr.error) { names.forEach(x => { delete x.pendingEnd; }); continue; }
    if (careful && lines.length < want - 1) {          // keep the prefix defined most of the time
      const res = M.run(pr.ops);
      if (res.ub && rnd() < 0.85) { names.forEach(x => { delete x.pendingEnd; }); continue; }
    }
    names.forEach(x => { if (x.pendingEnd) { x.ended = true; delete x.pendingEnd; } });
    lines.push(line);
    if (bind) { names = names.filter(x => x.name !== bind.name); names.push(bind); fresh++; }
  }
  return lines.join('\n');
}

/* ───────── Rust translation ───────── */
function toRust(ops, fname) {
  const L = [`fn ${fname}() { unsafe {`];
  ops.forEach((op, i) => {
    const v = (n) => 'v_' + n;
    if (op.kind === 'alloc') L.push(`    let lay_${i} = Layout::from_size_align(${op.size}, ${op.align}).unwrap();`,
      `    let ${v(op.name)}: *mut u8 = alloc(lay_${i}); if ${v(op.name)}.is_null() { handle_alloc_error(lay_${i}); }`);
    else if (op.kind === 'local') L.push(`    let mut slot_${i}: u32 = ${op.val}; let ${v(op.name)}: *mut u32 = &raw mut slot_${i};`);
    else if (op.kind === 'null') L.push(`    let ${v(op.name)} = null_mut::<${op.ty}>();`);
    else if (op.kind === 'cast') L.push(`    let ${v(op.name)} = ${v(op.from)}.cast::<${op.ty}>();`);
    else if (op.kind === 'add') L.push(`    let ${v(op.name)} = ${v(op.from)}.add(${op.n});`);
    else if (op.kind === 'copy') L.push(`    let ${v(op.name)} = ${v(op.from)};`);
    else if (op.kind === 'write') L.push(`    ${v(op.ptr)}.write(${op.val});`);
    else if (op.kind === 'read') L.push(op.ty === 'char' ? `    println!("U+{:04X}", ${v(op.ptr)}.read() as u32);` : `    println!("{}", ${v(op.ptr)}.read());`);
    else if (op.kind === 'dealloc') L.push(`    dealloc(${v(op.ptr)}, lay_${op.at});`);
    else if (op.kind === 'end') L.push(`    // end(${op.ptr}): the scope ends (never followed by a use in a defined script)`);
  });
  L.push('} }');
  return L.join('\n');
}
const HEADER = '#![allow(unused, unused_mut, unused_unsafe, dead_code)]\nuse std::alloc::{alloc, dealloc, handle_alloc_error, Layout};\nuse std::ptr::null_mut;\n';

/* ───────── run ───────── */
const cases = [];      // { name, text, ops, res, expect? }
let p1ok = 0;
TABLE.forEach(([name, rule, text, expect]) => {
  const pr = M.parse(text);
  if (pr.error) { bad(`[table] ${name}: parse error ${pr.error}`); return; }
  const res = M.run(pr.ops), got = verdictString(res);
  if (got !== expect) bad(`[table] ${name} (${rule}): expected ${expect}, engine says ${got}`); else p1ok++;
  const ref = verdictString(refModel(pr.ops));
  if (ref !== expect) bad(`[table] ${name}: expected ${expect}, reference model says ${ref}`);
  cases.push({ name: 'table: ' + name, text, ops: pr.ops, res });
});
const presetsInTable = M.PRESETS.filter(p => TABLE.some(t => t[2] === p.text)).length;
if (presetsInTable !== M.PRESETS.length) bad(`only ${presetsInTable} of ${M.PRESETS.length} presets are in the table`);
console.log(`Part 1  hand-derived table: ${p1ok}/${TABLE.length} verdicts as written in advance (${presetsInTable} presets included)`);

let p2ok = 0, nr = 0;
const kinds = {};
while (nr < NRAND) {
  const text = genScript(), pr = M.parse(text);
  if (pr.error) { bad(`[random] generator produced an unparsable script: ${pr.error}\n${text}`); nr++; continue; }
  nr++;
  const res = M.run(pr.ops), a = verdictString(res), b = verdictString(refModel(pr.ops));
  if (a !== b) bad(`[random #${nr}] engine ${a} vs reference model ${b}\n${text}`); else p2ok++;
  const k = res.ub ? res.ub.kind : 'defined'; kinds[k] = (kinds[k] || 0) + 1;
  cases.push({ name: 'random #' + nr, text, ops: pr.ops, res });
}
console.log(`Part 2  random scripts: ${p2ok}/${NRAND} agree with the independent byte-level model`);
console.log('        verdict mix: ' + Object.keys(kinds).sort().map(k => k + ' ' + kinds[k]).join(', '));

// Part 3: compile and run every DEFINED script as real Rust
const defined = cases.filter(c => !c.res.ub), ubs = cases.filter(c => c.res.ub);
let src = HEADER;
defined.forEach((c, i) => { src += `// ${c.name}\n` + toRust(c.ops, 'case_' + i) + '\n'; });
src += 'fn main() {\n' + defined.map((c, i) => `    println!("#{}", ${i}); case_${i}();`).join('\n') + '\n}\n';
const f3 = path.join(tmp, 'defined.rs'), exe = path.join(tmp, 'defined');
fs.writeFileSync(f3, src);
const c3 = cp.spawnSync(rustc, ['--edition', '2024', '-C', 'opt-level=0', '-o', exe, f3], { encoding: 'utf8' });
if (c3.status !== 0) { bad('[rustc] the defined scripts did not compile:\n' + c3.stderr.slice(0, 3000)); }
else {
  const r3 = cp.spawnSync(exe, [], { encoding: 'utf8', timeout: 60000 });
  if (r3.status !== 0) bad(`[run] the binary exited with ${r3.status} ${r3.signal || ''}\n${(r3.stderr || '').slice(0, 2000)}`);
  const blocks = {}; let cur = null;
  (r3.stdout || '').split('\n').forEach(l => { const m = /^#(\d+)$/.exec(l); if (m) { cur = +m[1]; blocks[cur] = []; } else if (l !== '' && cur !== null) blocks[cur].push(l.trim()); });
  let p3ok = 0;
  defined.forEach((c, i) => {
    const got = (blocks[i] || []).join(','), want = c.res.out.join(',');
    if (got !== want) bad(`[run] ${c.name}: rustc-built program printed [${got}], engine [${want}]\n${c.text}`); else p3ok++;
  });
  console.log(`Part 3  defined scripts compiled and run as Rust: ${p3ok}/${defined.length} print exactly the engine's values`);
}

// Part 4: the Rust translation of every UB script compiles (not run)
let src4 = HEADER;
ubs.forEach((c, i) => { src4 += `// ${c.name}: ${verdictString(c.res)}\n` + toRust(c.ops, 'ub_' + i) + '\n'; });
const f4 = path.join(tmp, 'ub.rs');
fs.writeFileSync(f4, src4);
const c4 = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '-o', path.join(tmp, 'ub.rmeta'), f4], { encoding: 'utf8' });
if (c4.status !== 0) bad('[rustc] UB translations did not compile:\n' + c4.stderr.slice(0, 3000));
else console.log(`Part 4  UB scripts translated to Rust: all ${ubs.length} compile (none is run)`);

const total = TABLE.length + NRAND;
console.log(`\n${total} cases (${TABLE.length} hand-derived + ${NRAND} random), ${defined.length} defined and run, ${ubs.length} UB never run: ${mismatches} mismatch(es)`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(mismatches ? 1 : 0);
