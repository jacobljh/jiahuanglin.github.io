// proto/19.js — lesson 19 widget maths: the calibration scoreboard that replays the reader's 押注 (bets) from lessons 00–18.
// run: node tools/psy_qa/proto/19.js
// A record (from psy.js) looks like {id, lesson, label, kind:'num'|'pick', guess, truth, unit, min, max, tol, ok, opts}.
// A bet records ONE guess, not a stated confidence, so this is NOT a calibration curve; what it can honestly show is
//   (1) the hit count against what blind guessing would have produced (each bet has its own chance of a blind hit, p0),
//   (2) for numeric bets, the direction of the miss (too high / too low),
//   (3) the reader's own estimate of their hit share, compared with the actual one (a one-number calibration check).
// p0 for a numeric bet = the share of the slider range that counts as a hit (an interval of ± tol around the truth, clipped to [min,max]);
// p0 for a pick = 1 / number of options. Expected hits E = Σ p0; SD = sqrt(Σ p0 (1 − p0)); z = (H − E) / SD (normal approximation, only a rough guide for N this small).
function p0(r) {
  if (r.kind === 'pick') return 1 / Math.max(2, (r.opts || []).length);
  var lo = Math.max(r.min, r.truth - r.tol), hi = Math.min(r.max, r.truth + r.tol);
  return Math.max(0, hi - lo) / (r.max - r.min);
}
function isSpine(r) { return /^\d\d[a-z]$/.test(String(r.id)) && r.lesson >= 0 && r.lesson <= 18; }
function board(all) {
  var recs = [], seen = {}, i;
  for (i = 0; i < all.length; i++) if (isSpine(all[i]) && !seen[all[i].id]) { seen[all[i].id] = 1; recs.push(all[i]); }
  recs.sort(function (a, b) { return a.lesson === b.lesson ? (a.id < b.id ? -1 : 1) : a.lesson - b.lesson; });
  var n = recs.length, hits = 0, E = 0, V = 0, hi = 0, lo = 0, worst = null, worstE = -1, nNum = 0, nPick = 0, pickHits = 0, numHits = 0;
  for (i = 0; i < n; i++) {
    var r = recs[i], p = p0(r);
    E += p; V += p * (1 - p);
    if (r.ok) hits++;
    if (r.kind === 'pick') { nPick++; if (r.ok) pickHits++; }
    else {
      nNum++; if (r.ok) numHits++;
      var e = (r.guess - r.truth) / (r.max - r.min);
      if (!r.ok) { if (e > 0) hi++; else lo++; }
      if (Math.abs(e) > worstE) { worstE = Math.abs(e); worst = r; }
    }
  }
  var sd = Math.sqrt(V);
  return { recs: recs, n: n, hits: hits, E: E, sd: sd, z: sd > 0 ? (hits - E) / sd : 0, hi: hi, lo: lo, worst: worst, nNum: nNum, nPick: nPick, pickHits: pickHits, numHits: numHits };
}
// a deterministic demo set (clearly labelled 示例 on the page): 19 records, one per lesson 00–18, built from a seeded PRNG — NOT real data.
function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function demo() {
  var r = mulberry32(1901), out = [], k, kind, rec;
  for (k = 0; k <= 18; k++) {
    if (r() < 0.35) {                                                     // a pick with 3 options
      var truth = Math.floor(r() * 3), g = r() < 0.4 ? truth : Math.floor(r() * 3);
      rec = { id: (k < 10 ? '0' : '') + k + 'a', lesson: k, label: '示例', kind: 'pick', guess: g, truth: truth, opts: ['A', 'B', 'C'], ok: g === truth };
    } else {                                                              // a numeric bet on a 0–100 slider, tolerance 10
      var t = Math.round(10 + r() * 80), gg = Math.max(0, Math.min(100, Math.round(t + (r() - 0.5) * 70)));
      rec = { id: (k < 10 ? '0' : '') + k + 'a', lesson: k, label: '示例', kind: 'num', guess: gg, truth: t, unit: '', min: 0, max: 100, tol: 10, ok: Math.abs(gg - t) <= 10 };
    }
    out.push(rec);
  }
  return out;
}
function f(x, d) { return x.toFixed(d === undefined ? 2 : d); }
if (require.main === module) {
  var d = demo(), b = board(d);
  console.log('demo n', b.n, 'hits', b.hits, 'E', f(b.E), 'sd', f(b.sd), 'z', f(b.z), '| num', b.nNum, 'hits', b.numHits, 'pick', b.nPick, 'hits', b.pickHits, '| misses high/low', b.hi, b.lo, '| worst lesson', b.worst && b.worst.lesson);
  console.log(d.map(function (x) { return x.lesson + (x.kind === 'pick' ? 'p' : 'n') + (x.ok ? '+' : '-'); }).join(' '));
  // spot checks of p0
  console.log('p0 num 0-100 tol10 truth50:', f(p0({ kind: 'num', min: 0, max: 100, tol: 10, truth: 50 })), '| truth 3 (edge):', f(p0({ kind: 'num', min: 0, max: 100, tol: 10, truth: 3 })), '| pick of 3:', f(p0({ kind: 'pick', opts: ['a', 'b', 'c'] })));
  console.log('empty board:', JSON.stringify(board([])).slice(0, 120));
  console.log('filters out sidecar ids:', board([{ id: 'p01a', lesson: 1, kind: 'pick', ok: true, opts: ['a', 'b'] }, { id: '01a', lesson: 1, kind: 'pick', ok: false, opts: ['a', 'b'], guess: 0, truth: 1 }]).n);
}
if (typeof module !== 'undefined') module.exports = { p0: p0, board: board, demo: demo };
