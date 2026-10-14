// proto/13.js — lesson 13 widget maths: finding words in a stream with no pauses, using only transitional probabilities.
// (受 Saffran, Aslin & Newport 1996 启发的示意模型 — a labelled demo model, NOT an infant model)
// run: node tools/psy_qa/proto/13.js
// Language: W "words", each 3 syllables, all 3W syllables distinct. Stream = words in random order, no word immediately repeated, no gaps.
//   inside a word TP(next | this) = 1;   across a word boundary TP = 1/(W−1)  (the next word is any of the other W−1).
// Learner (offline, "after listening"): each syllable is mis-heard with probability eps (replaced by a random one of the 3W syllables);
//   TP^(b|a) = count(a→b)/count(a) over everything heard; a boundary is posted after syllable i when its TP^ is lower than the larger
//   of its two neighbouring transitions by more than DIP.  Scored against the true boundaries.
// The same code is ported verbatim into 13_language.html (RNG = mulberry32 = PSY.rng).
var WORDS = [['tu','pi','ro'],['go','la','bu'],['bi','da','ku'],['pa','do','ti'],['me','ka','ni'],['so','fe','lu'],['na','hi','we'],['zo','ra','mi']];
function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function learn(o) {                 // o: W, N, eps, dip, seed
  var rng = mulberry32(o.seed), W = o.W, S = 3 * W, N = o.N, stream = [], bound = [], prev = -1, w, j, i;
  while (stream.length < N) { do { w = Math.floor(rng() * W); } while (w === prev && W > 1); prev = w; for (j = 0; j < 3; j++) { stream.push(3 * w + j); bound.push(j === 2 ? 1 : 0); } }
  stream = stream.slice(0, N); bound = bound.slice(0, N);       // bound[i] = 1 → a word boundary follows syllable i
  var heard = [];
  for (i = 0; i < N; i++) heard.push(rng() < o.eps ? Math.floor(rng() * S) : stream[i]);
  var pair = {}, cnt = [], a, b;
  for (i = 0; i < S; i++) cnt.push(0);
  for (i = 0; i < N - 1; i++) { a = heard[i]; b = heard[i + 1]; cnt[a]++; pair[a * S + b] = (pair[a * S + b] || 0) + 1; }
  var T = [];
  for (i = 0; i < N - 1; i++) { a = heard[i]; b = heard[i + 1]; T.push(cnt[a] ? (pair[a * S + b] || 0) / cnt[a] : 0); }
  var flag = [], hit = 0, fn = 0, fa = 0, tn = 0, sIn = 0, nIn = 0, sAc = 0, nAc = 0;
  for (i = 0; i < N - 1; i++) {
    var nb = Math.max(i > 0 ? T[i - 1] : 0, i < T.length - 1 ? T[i + 1] : 0), says = T[i] < nb - o.dip;
    flag.push(says ? 1 : 0);
    if (bound[i]) { sAc += T[i]; nAc++; } else { sIn += T[i]; nIn++; }
    if (bound[i] && says) hit++; else if (bound[i] && !says) fn++; else if (!bound[i] && says) fa++; else tn++;
  }
  return { stream: stream, bound: bound, heard: heard, T: T, flag: flag,
    hit: hit / Math.max(1, hit + fn), fa: fa / Math.max(1, fa + tn), tpIn: nIn ? sIn / nIn : 0, tpAc: nAc ? sAc / nAc : 0,
    acc: (hit + tn) / Math.max(1, hit + fn + fa + tn), nHit: hit, nFn: fn, nFa: fa, nTn: tn };
}
var GRID = []; (function () { for (var j = 0; j <= 13; j++) GRID.push(Math.round(12 * Math.pow(250, j / 13))); })();
function curve(o, seeds) {          // mean accuracy over seeds 1..seeds at each grid N
  var out = [], k, j, s;
  for (j = 0; j < GRID.length; j++) { s = 0; for (k = 1; k <= seeds; k++) s += learn({ W: o.W, N: GRID[j], eps: o.eps, dip: o.dip, seed: k }).acc; out.push(s / seeds); }
  return out;
}
function firstAbove(cv, thr) { for (var j = 0; j < cv.length; j++) if (cv[j] >= thr) return GRID[j]; return null; }
function pc(x) { return (100 * x).toFixed(0) + '%'; }
if (require.main === module) {
  console.log('GRID', GRID.join(' '));
  var D = { W: 4, eps: 0, dip: 0.15 };
  console.log('--- default W=4 eps 0 dip .15, seed 1: single run vs N');
  [30, 60, 120, 540, 3000].forEach(function (N) { var r = learn({ W: 4, N: N, eps: 0, dip: 0.15, seed: 1 }); console.log('N', N, 'hit', pc(r.hit), 'fa', pc(r.fa), 'acc', pc(r.acc), 'TP in', r.tpIn.toFixed(2), 'across', r.tpAc.toFixed(2)); });
  console.log('--- seeds 1..6 at N=540 (acc) and N=30 (hit)');
  for (var k = 1; k <= 6; k++) { var a = learn({ W: 4, N: 540, eps: 0, dip: 0.15, seed: k }), b = learn({ W: 4, N: 30, eps: 0, dip: 0.15, seed: k }); console.log(' seed', k, 'N540 acc', pc(a.acc), ' N30 hit', pc(b.hit), 'fa', pc(b.fa), 'acc', pc(b.acc)); }
  var cases = { 'default W4': { W: 4, eps: 0, dip: 0.15 }, 'W2': { W: 2, eps: 0, dip: 0.15 }, 'W3': { W: 3, eps: 0, dip: 0.15 }, 'W8': { W: 8, eps: 0, dip: 0.15 }, 'eps .10': { W: 4, eps: 0.1, dip: 0.15 }, 'eps .20': { W: 4, eps: 0.2, dip: 0.15 }, 'dip .05': { W: 4, eps: 0, dip: 0.05 }, 'dip .60': { W: 4, eps: 0, dip: 0.6 }, 'W3 dip .60': { W: 3, eps: 0, dip: 0.6 } };
  Object.keys(cases).forEach(function (n) { var cv = curve(cases[n], 8); console.log(n.padEnd(12), cv.map(function (x) { return (100 * x).toFixed(0); }).join(' '), ' | ≥95% at N =', firstAbove(cv, 0.95), ' ≥90% at', firstAbove(cv, 0.90)); });
  console.log('--- single run seed 1 at N=540 for the presets');
  Object.keys(cases).forEach(function (n) { var c = cases[n], r = learn({ W: c.W, N: 540, eps: c.eps, dip: c.dip, seed: 1 }); console.log(n.padEnd(12), 'hit', pc(r.hit), 'fa', pc(r.fa), 'acc', pc(r.acc), 'TPin', r.tpIn.toFixed(2), 'TPac', r.tpAc.toFixed(2)); });
  console.log('--- floor: share of within-word transitions = 2/3 =', (2 / 3).toFixed(3));
}
if (typeof module !== 'undefined') module.exports = { learn: learn, curve: curve, GRID: GRID, WORDS: WORDS };
