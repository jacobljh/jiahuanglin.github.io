#!/usr/bin/env node
/* Oracle for Lesson 05 ("Borrowing — the law"): EXHAUSTIVE differential test of the law as the widget shows it.
 *
 *   node tools/rust_verify/05_law_grid.js [length=4]
 *
 * The lesson's widget applies the law to one place (`note: String`) that up to two borrows (`a`, `b`) reach.
 * Every well-formed sequence of `length` statements over the menu below is compiled by the real rustc, and the
 * same sequence is checked by MiniRust (all_lessons/rust/lessons/minirust.js). Per program the two must agree on
 *   (1) the set of (error code, line)                        — what the widget's verdict says, and
 *   (2) for loan conflicts, the line where the earlier borrow is made and the line of its later use
 *       — what the widget's bars are anchored on.
 * Exit status 1 on any mismatch. The menu covers the five ways a name can act on the place: a new shared borrow,
 * a new exclusive borrow, a method call that borrows in disguise (`len`, `push`), an assignment, and a move.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const MR = require(process.env.MR || path.join(__dirname, '../../all_lessons/rust/lessons/minirust.js'));
const LEN = +(process.argv[2] || 4);
const BATCH = 500;
const rustc = process.env.RUSTC || 'rustc';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'law-grid-'));

// statement menu: [text, defines, uses]
const MENU = [
  ['let a = &note;', 'a', null],
  ['let a = &mut note;', 'a', null],
  ['let b = &note;', 'b', null],
  ['let b = &mut note;', 'b', null],
  ['println!("{}", a);', null, 'a'],
  ['println!("{}", b);', null, 'b'],
  ['let n = note.len();', null, null],
  ['note.push(\'!\');', null, null],
  ['note = String::from("bob");', null, null],
  ['drop(note);', null, null],
];

function wellFormed(seq) {
  const defined = new Set();
  for (const i of seq) {
    const [, def, use] = MENU[i];
    if (use && !defined.has(use)) return false;
    if (def) { if (defined.has(def)) return false; defined.add(def); }
  }
  return true;
}
const programs = [];
(function gen(prefix) {
  if (prefix.length === LEN) { if (wellFormed(prefix)) programs.push(prefix.slice()); return; }
  for (let i = 0; i < MENU.length; i++) { prefix.push(i); gen(prefix); prefix.pop(); }
})([]);

const PRELUDE = '#![allow(unused)]\n';
function bodyOf(seq) { return ['    let mut note = String::from("ada");'].concat(seq.map(i => '    ' + MENU[i][0])); }

function rustcErrors(file) {
  const r = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '--error-format=json', '-A', 'warnings', '-o', path.join(tmp, 'x.rmeta'), file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = [];
  for (const ln of r.stderr.split('\n')) {
    let d; try { d = JSON.parse(ln); } catch (e) { continue; }
    if (d.level !== 'error' || /^aborting/.test(d.message)) continue;
    const spans = d.spans || [], prim = spans.find(s => s.is_primary) || spans[0];
    let loanLine = null, useLine = null;
    for (const s of spans) {
      const lab = s.label || '';
      if (/later used/.test(lab)) useLine = s.line_start;
      else if (!s.is_primary && /borrow.*occurs here|is borrowed here/.test(lab)) loanLine = s.line_start;
    }
    out.push({ code: (d.code && d.code.code) || '', line: prim ? prim.line_start : 0, loanLine, useLine, msg: d.message });
  }
  return out;
}

let total = 0, bad = 0, shown = 0, withErr = 0, linesChecked = 0, linesBad = 0;
const codeCounts = {};
for (let b = 0; b * BATCH < programs.length; b++) {
  const chunk = programs.slice(b * BATCH, (b + 1) * BATCH);
  const src = [PRELUDE.trimEnd()], ranges = [];
  chunk.forEach((seq, i) => {
    const body = bodyOf(seq), start = src.length + 2;          // 1-based number of the first body line
    src.push('fn p' + i + '() {'); body.forEach(l => src.push(l)); src.push('}');
    ranges.push({ i, seq, start: src.length - body.length, end: src.length - 1, body });
  });
  const text = src.join('\n') + '\n', file = path.join(tmp, 'b' + b + '.rs');
  fs.writeFileSync(file, text);
  const real = rustcErrors(file), mine = MR.check(text);
  if (mine.parseError) { console.log('ENGINE PARSE ERROR', JSON.stringify(mine.parseError)); process.exit(2); }
  const rangeOf = (line) => ranges.find(r => line >= r.start && line <= r.end);
  const by = ranges.map(() => ({ real: [], mine: [] }));
  real.forEach(e => { const r = rangeOf(e.line); if (r) by[r.i].real.push(e); else console.log('rustc error outside any program:', e.code, e.msg, 'line', e.line); });
  mine.errors.forEach(e => { const r = rangeOf(e.line); if (r) by[r.i].mine.push(e); else console.log('engine error outside programs', e.code, e.msg, 'line', e.line); });
  ranges.forEach(r => {
    total++;
    const key = (e) => e.code + '@' + (e.line - r.start);
    const a = new Set(by[r.i].real.map(key)), c = new Set(by[r.i].mine.map(key));
    if (a.size) withErr++;
    by[r.i].real.forEach(e => { codeCounts[e.code] = (codeCounts[e.code] || 0) + 1; });
    let same = a.size === c.size && [...a].every(k => c.has(k)), why = 'codes/lines differ';
    if (same) {                                                  // the bars: earlier borrow and later use, per loan error
      for (const re of by[r.i].real) {
        if (!/^E0(499|502|505|506|503)$/.test(re.code)) continue;
        const me = by[r.i].mine.find(m => m.code === re.code && m.line === re.line);
        linesChecked++;
        if (!me || (re.loanLine !== null && me.loanLine !== re.loanLine) || (re.useLine !== null && me.useLine !== re.useLine)) {
          linesBad++; same = false; why = 'loan/use lines differ: rustc B=' + (re.loanLine - r.start) + ' U=' + (re.useLine - r.start) + ' vs mine B=' + (me && me.loanLine - r.start) + ' U=' + (me && me.useLine - r.start); break;
        }
      }
    }
    if (!same) {
      bad++;
      if (shown++ < 6) {
        console.log('\n──── MISMATCH (' + why + ') ────'); r.body.forEach((l, k) => console.log(String(k + 1).padStart(3) + '  ' + l));
        console.log('rustc: ' + [...a].sort().join(' '));  by[r.i].real.forEach(e => console.log('   ', e.code, '@' + (e.line - r.start), e.msg));
        console.log('mine : ' + [...c].sort().join(' '));  by[r.i].mine.forEach(e => console.log('   ', e.code, '@' + (e.line - r.start), e.msg));
      }
    }
  });
}
console.log('\n' + (total - bad) + '/' + total + ' well-formed programs agree with rustc (' + bad + ' mismatches); ' + withErr + ' of them are rejected by rustc;');
console.log('loan/use lines checked on ' + linesChecked + ' conflict errors (' + linesBad + ' mismatches); rustc codes seen: ' + JSON.stringify(codeCounts));
process.exit(bad ? 1 : 0);
