/* ess_lab.js — lesson 22's private engine: the effective size of a dataset.
 *
 * The world is the layouts task of the ledger (bodies_lab.js, BL; lessons 7 and 8).  A SITUATION is one of the 256 layouts of your own file, an EPISODE is one recorded demonstration
 * of a situation, and the policy copies the demonstration of the stored situation nearest to a new layout, scored on the 1000 test layouts of the ledger.  What it reaches is read on the
 * ledger's own curve: the EFFECTIVE SIZE of a dataset is the number of your own layouts, each demonstrated once, that give the same success (LG.ownEquivalent, the unit of lesson 16).
 *   corpus   counts k_c of recorded episodes per situation.  scripted: the first 80 layouts, R/80 repeats each.  field: R episodes drawn by popularity p_c ~ rank^-a (ranks random).
 *   loop     generations of self-training: a generator that memorises its training set emits R episodes with the shares of the previous corpus; a fresh share is drawn from the original corpus.
 *   rig      a fixed random share of the situations was recorded on a rig whose hand tracker is offset: every recorded hand target of those situations is shifted by DELTA (1.5 cm, sideways).
 *   check    held-out consistency: the clearance of the recorded path to the posts the layout states (the posts were not recorded by the tracker) is the same in every layout; a batch whose
 *            mean differs from the rest by more than three standard errors is flagged, and its offset is estimated by that difference.
 * Everything is a function of fixed seeds (BN.rng).  Rollouts are memoised per (test layout, situation, offset), and are the ones BL.run would run: BL.execute on the same generator.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js'), BL = root.BL || require('./bodies_lab.js'), LG = root.LG || require('./ledger.js');
var ES = {};
var NS = 256, NT = 0, A = null, tests = null, DM = null, S0 = null, TAB = {}, SH = {}, me = BL.bodies.A;
ES.NS = NS; ES.DELTA = 0.015; ES.NSCRIPT = 80; ES.POPSEED = 5; ES.DRAWSEED = 100; ES.RIGSEED = 77; ES.LOOPSEED = 700;
ES.HOURS = function (n) { return LG.hours(n); };

function init() {
  if (A) return;
  A = BL.file('A'); tests = BL.testSet(); NT = tests.length; DM = new Float64Array(NT * NS);
  var t, c, k, i, w, P, n, pk, x, y, f, m = [[], [], [], [], []], v = new Float64Array(NS * 5), s;
  for (t = 0; t < NT; t++) for (c = 0; c < NS; c++) DM[t * NS + c] = BL.dist(tests[t], A[c].theta);
  for (c = 0; c < NS; c++) {                                              // the clearance of the recorded path to each stated post, where the hand crosses the post's x
    w = BL.world(A[c].theta, me); P = A[c].P; n = A[c].n;
    for (k = 0; k < 5; k++) {
      pk = w.posts[k]; for (i = 1; i < n - 1; i++) if (P[2 * i] >= pk[0]) break;
      x = P[2 * i] - P[2 * i - 2]; f = (pk[0] - P[2 * i - 2]) / Math.max(1e-9, x); y = P[2 * i - 1] + f * (P[2 * i + 1] - P[2 * i - 1]);
      v[c * 5 + k] = y - pk[1]; m[k].push(y - pk[1]);
    }
  }
  for (k = 0; k < 5; k++) m[k] = BN.stats.quantile(m[k], 0.5);
  S0 = new Float64Array(NS);                                              // per situation: mean over the posts of the clearance minus the median clearance of that post
  for (c = 0; c < NS; c++) { s = 0; for (k = 0; k < 5; k++) s += v[c * 5 + k] - m[k]; S0[c] = s / 5; }
}
ES.theta = function (c) { init(); return A[c].theta; };
ES.test = function (t) { init(); return tests[t]; };
ES.NT = function () { init(); return NT; };
ES.sig = function (c) { init(); return S0[c]; };

/* popularity of the 256 situations: share ~ rank^-a, ranks assigned at random (a = 0: every situation equally likely) */
ES.popularity = function (a, seed) {
  var r = BN.rng(seed), perm = [], p = new Float64Array(NS), s = 0, i;
  for (i = 0; i < NS; i++) perm.push(i);
  BN.shuffle(perm, r);
  for (i = 0; i < NS; i++) { p[perm[i]] = Math.pow(i + 1, -a); s += p[perm[i]]; }
  for (i = 0; i < NS; i++) p[i] /= s;
  return p;
};
/* R episodes drawn with shares p: counts per situation */
ES.draw = function (p, R, seed) {
  var r = BN.rng(seed), cum = new Float64Array(NS), cnt = new Int32Array(NS), s = 0, i, k, u, lo, hi, mid;
  for (i = 0; i < NS; i++) { s += p[i]; cum[i] = s; }
  for (k = 0; k < R; k++) {
    u = r() * s; lo = 0; hi = NS - 1;
    while (lo < hi) { mid = (lo + hi) >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; }
    cnt[lo]++;
  }
  return cnt;
};
ES.share = function (cnt, R) { var p = new Float64Array(NS), i; for (i = 0; i < NS; i++) p[i] = cnt[i] / R; return p; };
/* one generation of self-training: R episodes, a share `fresh` of them drawn from the original corpus, the rest from the shares of the previous corpus */
ES.generation = function (cnt, cnt0, R, fresh, seed) {
  var nf = Math.round(fresh * R), a = ES.draw(ES.share(cnt, R), R - nf, seed), b, i;
  if (nf > 0) { b = ES.draw(ES.share(cnt0, R), nf, seed + 500); for (i = 0; i < NS; i++) a[i] += b[i]; }
  return a;
};
/* recorded episodes, situations, and the size Kish's formula gives to the counts: (sum k)^2 / sum k^2 */
ES.stats = function (cnt) {
  var R = 0, D = 0, q = 0, i;
  for (i = 0; i < NS; i++) { R += cnt[i]; if (cnt[i] > 0) D++; q += cnt[i] * cnt[i]; }
  return { R: R, D: D, kish: R * R / q };
};
ES.expectedDistinct = function (cnt, R) { var e = 0, i; for (i = 0; i < NS; i++) e += 1 - Math.pow(1 - cnt[i] / R, R); return e; };   // situations still present after one more generation

/* the recorded demonstration of situation c with its hand targets shifted sideways by um micrometres */
function demo(c, um) {
  if (um === 0) return A[c];
  var key = c + '|' + um, d = SH[key], P, i;
  if (!d) { P = new Float64Array(A[c].P); for (i = 0; i < A[c].n; i++) P[2 * i + 1] += um * 1e-6; d = SH[key] = { P: P, n: A[c].n }; }
  return d;
}
function outcome(t, c, um) {
  var a = TAB[um] || (TAB[um] = new Int8Array(NT * NS).fill(-1)), id = t * NS + c, r = a[id];
  if (r < 0) r = a[id] = BL.execute(me, BL.world(tests[t], me), demo(c, um), 'hand', BN.rng(1000 * BL.EVSEED + t + 1)).done ? 1 : 0;
  return r;
}
/* the policy: every test layout copies the stored situation nearest to it.  off[c] = the offset in micrometres of a stored situation, NaN when it is absent */
ES.score = function (off) {
  init();
  var ok = 0, okv = new Uint8Array(NT), pick = new Int16Array(NT), t, c, bd, bc, d;
  for (t = 0; t < NT; t++) {
    bd = Infinity; bc = -1;
    for (c = 0; c < NS; c++) { if (off[c] !== off[c]) continue; d = DM[t * NS + c]; if (d < bd) { bd = d; bc = c; } }
    pick[t] = bc; if (bc >= 0) { okv[t] = outcome(t, bc, off[bc]); ok += okv[t]; }
  }
  return { ok: ok, succ: ok / NT, okv: okv, pick: pick };
};
/* the effective size: the own layouts that give the same success on the ledger's own curve, and the sizes of the ends of the 95 % interval of the success */
ES.neq = function (s) { return LG.ownEquivalent(LG.ownCurve('hand'), s); };
ES.effective = function (ok) { var w = BN.stats.wilson(ok, NT); return { n: ES.neq(ok / NT), lo: ES.neq(w[0]), hi: ES.neq(w[1]) }; };

/* held-out consistency: Welch z of the clearance signature of the rig's situations against the rest (present situations only); the estimate of the offset is the difference of means */
ES.check = function (cnt, rig) {
  init();
  var a = [], b = [], c, ma = 0, mb = 0, va = 0, vb = 0;
  for (c = 0; c < NS; c++) if (cnt[c] > 0) (rig[c] ? a : b).push(S0[c] + (rig[c] ? ES.DELTA : 0));
  if (a.length < 3 || b.length < 3) return null;
  for (c = 0; c < a.length; c++) ma += a[c] / a.length; for (c = 0; c < b.length; c++) mb += b[c] / b.length;
  for (c = 0; c < a.length; c++) va += (a[c] - ma) * (a[c] - ma) / (a.length - 1); for (c = 0; c < b.length; c++) vb += (b[c] - mb) * (b[c] - mb) / (b.length - 1);
  var z = (ma - mb) / Math.sqrt(va / a.length + vb / b.length);
  return { z: z, dhat: ma - mb, nB: a.length, nN: b.length, sdB: Math.sqrt(va), sdN: Math.sqrt(vb), flagged: Math.abs(z) > 3 };
};
/* which situations the rig recorded: the first share*D present situations of a fixed random order */
ES.rigSet = function (cnt, share) {
  var perm = [], r = BN.rng(ES.RIGSEED), rig = new Uint8Array(NS), i, D = 0, m = 0;
  for (i = 0; i < NS; i++) { perm.push(i); if (cnt[i] > 0) D++; }
  BN.shuffle(perm, r);
  for (i = 0; i < NS && m < Math.round(share * D); i++) if (cnt[perm[i]] > 0) { rig[perm[i]] = 1; m++; }
  return rig;
};

/* a corpus and the policy trained on it.  spec: {mode: 'scripted' | 'field', R, a, gens, fresh, rig (share), act: 'keep' | 'drop' | 'fix', seed} */
ES.build = function (spec) {
  init();
  var seed = spec.seed || 1, R = spec.R, cnt0, cnt, g, c, rig, ck = null, off = new Float64Array(NS), r;
  if (spec.mode === 'scripted') { cnt0 = new Int32Array(NS); for (c = 0; c < ES.NSCRIPT; c++) cnt0[c] = Math.round(R / ES.NSCRIPT); }
  else cnt0 = ES.draw(ES.popularity(spec.a, ES.POPSEED), R, ES.DRAWSEED + seed);
  cnt = cnt0; R = ES.stats(cnt0).R;
  for (g = 1; g <= (spec.gens || 0); g++) cnt = ES.generation(cnt, cnt0, R, spec.fresh || 0, ES.LOOPSEED * seed + g);
  rig = ES.rigSet(cnt0, spec.rig || 0);
  for (c = 0; c < NS; c++) off[c] = cnt[c] > 0 ? (rig[c] ? Math.round(ES.DELTA * 1e6) : 0) : NaN;
  if (spec.rig > 0) {
    ck = ES.check(cnt, rig);
    if (ck && ck.flagged && spec.act === 'drop') for (c = 0; c < NS; c++) if (rig[c]) off[c] = NaN;
    if (ck && ck.flagged && spec.act === 'fix') for (c = 0; c < NS; c++) if (rig[c] && off[c] === off[c]) off[c] = Math.round((ES.DELTA - ck.dhat) * 1e4) * 100;
  }
  r = ES.score(off);
  var st = ES.stats(cnt), st0 = ES.stats(cnt0), mass = 0;
  for (c = 0; c < NS; c++) if (cnt[c] > 0) mass += cnt0[c] / st0.R;
  return { cnt: cnt, cnt0: cnt0, R: st.R, D: st.D, D0: st0.D, kish: st.kish, off: off, rig: rig, check: ck, score: r, eff: ES.effective(r.ok), mass: mass };
};

/* drawing for the widget: the box of layouts (shift across, tilt up) with the 1000 test layouts coloured by outcome and the stored layouts as rings, and the sizes in hours on a log scale */
ES.comma = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
ES.hh = function (v) { return (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3)) + ' h'; };
function ring(ctx, x, y, r, color, dash) { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke(); ctx.restore(); }
function cross(ctx, x, y) { var D = BN.draw, g = BN.C.dim; D.line(ctx, x - 3, y - 3, x + 3, y + 3, g, 1.2); D.line(ctx, x - 3, y + 3, x + 3, y - 3, g, 1.2); }
function mapPanel(ctx, x, y, w, h, b) {
  var D = BN.draw, C = BN.C, X = function (s) { return x + (s + 0.1) / 0.2 * w; }, Y = function (t) { return y + (0.2 - t) / 0.4 * h; }, k, th, c, r;
  D.frame(ctx, x, y, w, h, '#fbfbfe');
  ctx.globalAlpha = 0.6;
  for (k = 0; k < ES.NT(); k++) { th = ES.test(k); ctx.fillStyle = b.score.okv[k] ? C.teal : C.red; ctx.fillRect(X(th[0]) - 1.2, Y(th[1]) - 1.2, 2.4, 2.4); }
  ctx.globalAlpha = 1;
  for (c = 0; c < NS; c++) {
    th = ES.theta(c);
    if (b.cnt[c] > 0 && b.off[c] === b.off[c]) { r = 2.5 + 1.6 * Math.log(b.cnt[c]) / Math.LN2; ring(ctx, X(th[0]), Y(th[1]), r, b.rig[c] ? C.amber : C.ink, b.rig[c] && b.off[c] < 1e4 ? [3, 2] : null); }
    else if (b.cnt0[c] > 0) cross(ctx, X(th[0]), Y(th[1]));
  }
  D.text(ctx, 'shift of the row (-10 to +10 cm)', x + w / 2, y + h + 9, C.mute, 10, 'center');
  D.text(ctx, 'tilt', x + 4, y + 8, C.mute, 10);
}
function barPanel(ctx, x, y, w, h, b) {
  var D = BN.draw, C = BN.C, rows = [['recorded', ES.HOURS(b.R), ES.comma(b.R) + ' episodes', C.purple], ['different layouts', ES.HOURS(b.D), ES.comma(b.D) + ' layouts', C.cyan],
    ["Kish's formula", ES.HOURS(b.kish), b.kish.toFixed(1) + ' layouts', C.dim], ['measured size', ES.HOURS(b.eff.n), ES.comma(b.eff.n) + ' layouts', C.teal]];
  var x0 = x + 6, x1 = x + w - 6, lx = function (v) { return x0 + (Math.log(v) / Math.LN10 + 2.5) / 5 * (x1 - x0); }, rh = (h - 40) / rows.length, i, yy, t;
  D.frame(ctx, x, y, w, h, '#fbfbfe');
  for (t = -2; t <= 2; t++) { D.line(ctx, lx(Math.pow(10, t)), y + 22, lx(Math.pow(10, t)), y + h - 18, C.grid, 1); D.mono(ctx, Math.pow(10, t) + ' h', lx(Math.pow(10, t)), y + h - 9, C.dim, 9, 'center'); }
  D.text(ctx, 'hours of motion, log scale', x + w / 2, y + 10, C.mute, 10, 'center');
  for (i = 0; i < rows.length; i++) {
    yy = y + 28 + i * rh;
    D.text(ctx, rows[i][0], x0, yy, C.ink, 11);
    D.mono(ctx, ES.hh(rows[i][1]) + ' · ' + rows[i][2], x1, yy, C.mute, 10, 'right');
    ctx.fillStyle = rows[i][3]; ctx.fillRect(x0, yy + 8, Math.max(2, lx(rows[i][1]) - x0), 14);
    if (i === 3) D.line(ctx, lx(ES.HOURS(b.eff.lo)), yy + 15, lx(ES.HOURS(b.eff.hi)), yy + 15, C.ink, 2);
  }
}
ES.paint = function (cv, b) {
  var s, W, H, mh;
  cv.style.height = (cv.clientWidth < 600 ? 640 : 470) + 'px';
  s = BN.draw.setup(cv); W = s.w; H = s.h;
  if (W < 600) { mh = Math.round(H * 0.5); mapPanel(s.ctx, 6, 6, W - 12, mh - 14, b); barPanel(s.ctx, 6, mh + 12, W - 12, H - mh - 18, b); }
  else { mh = Math.round(W * 0.5); mapPanel(s.ctx, 6, 6, mh, H - 24, b); barPanel(s.ctx, mh + 18, 6, W - mh - 24, H - 24, b); }
};

root.ESS = ES;
if (typeof module !== 'undefined' && module.exports) module.exports = ES;
})(typeof window !== 'undefined' ? window : globalThis);
