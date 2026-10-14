// proto/p01.js — sidecar lesson 01 widget maths: 「复习计划器」 = a half-life memory with retrieval gain (a labelled DEMO model, not data).
// run: node tools/psy_qa/proto/p01.js          (NB the p prefix: proto/01.js belongs to the spine)
//
// MODEL (exact expectation, no RNG).  One item (a fact, a card) is learned once on day 0 with half-life H0.
//   Recall probability after a delay Δ with half-life h:  p = 2^(−Δ/h)                 (the half-life form of Settles & Meeder 2016, Eq. 1;
//                                                                                        FACTS_T6a "Widget constants (01) (b)": Δ/h = 1 → 0.50, 2 → 0.25 …)
//   Later sessions are self-tests with feedback.  At a session that comes Δ days after the previous one:
//     success (probability p)  : h ← h · (1 + G·(1 − p))   the harder the recall, the bigger the gain  — the lead's illustrative device (SPECS_PLAY 01)
//     failure (probability 1−p): the answer is shown, the item is relearned, h is unchanged            — ADDED here so that an interior optimum can exist
//   Test, R days after the LAST session:  recall = E[ 2^(−R/h_final) ], the expectation over all 2^(n−1) success/failure paths (n ≤ 6 → ≤ 32 paths).
//   ⇒ expected gain of one review ≈ 1 + G·p·(1−p): too soon (p ≈ 1) no gain, too late (p ≈ 0) it fails and nothing is gained — the optimum is in between.
//   WHY the failure branch: with the SPECS rule alone (every retrieval "succeeds", gain 1 + G(1−p)) the gain grows monotonically with the gap and the best
//   gap would be "as long as possible" (no interior optimum, degenerate). The failure branch is the "too long = already forgotten" half of the teaching point.
// CONSTANTS (示意, NOT fitted to any data): H0 = 10 days, G = 2 (a success at p → 0 triples h; at p = .5 doubles it), massed sessions 1 hour apart (1/24 d).
//   Chosen as round numbers so that weeks-to-months delays are readable; the Cepeda 2008 numbers are printed beside the model, never fitted.
// DELAY CONVENTION: R is measured from the LAST study session to the test (the retention interval of Cepeda et al. 2008), gap = days between sessions.
// SCHEDULES (n sessions, MEAN gap g):  massed — all gaps 1 h;  equal — every gap g;  expanding — gap k = 2·g·k/n (k = 1..n−1; same mean g, same span).
function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
var H0 = 10, G = 2, MASS = 1 / 24, GMAX = 30, GSTEP = 0.5, RS = [7, 35, 70];

function gapsFor(typ, n, g) {                       // typ 0 massed, 1 equal, 2 expanding
  var a = [], k;
  for (k = 1; k < n; k++) a.push(typ === 0 ? MASS : typ === 1 ? g : 2 * g * k / n);
  return a;
}
function run(gaps, R) {
  var st = [{ pr: 1, h: H0 }], states = [st], rk = [], i, j, nx, p, ps, rec = 0;
  for (i = 0; i < gaps.length; i++) {
    nx = []; ps = 0;
    for (j = 0; j < st.length; j++) {
      p = Math.pow(2, -gaps[i] / st[j].h);
      ps += st[j].pr * p;
      nx.push({ pr: st[j].pr * p, h: st[j].h * (1 + G * (1 - p)) });
      nx.push({ pr: st[j].pr * (1 - p), h: st[j].h });
    }
    rk.push(ps); st = nx; states.push(st);
  }
  for (j = 0; j < st.length; j++) rec += st[j].pr * Math.pow(2, -R / st[j].h);
  return { rec: rec, rk: rk, states: states, gaps: gaps };
}
function recall(typ, n, g, R) { return run(gapsFor(typ, n, g), R).rec; }
function best(typ, n, R) {                          // argmax over the slider grid 0..GMAX step GSTEP (first maximum wins)
  var bg = 0, bv = -1, g, v;
  for (g = 0; g <= GMAX + 1e-9; g += GSTEP) { v = recall(typ, n, g, R); if (v > bv + 1e-12) { bv = v; bg = g; } }
  return { g: bg, v: bv };
}
function expectedAt(states, times, k, t) {          // expected recall t days after session k (1-based), averaged over the paths alive after k sessions
  var st = states[k - 1], s = 0, j;
  for (j = 0; j < st.length; j++) s += st[j].pr * Math.pow(2, -t / st[j].h);
  return s;
}
function pc(x, d) { return (100 * x).toFixed(d === undefined ? 1 : d) + '%'; }
function f1(x) { return x.toFixed(1); }

// independent re-implementations for the FACTS DERIVED checks ----------------------------------------------------------
function cepedaRecall(g, t) { var A = 0.760 + (1 - 0.760) * Math.exp(-0.017 * g), Rr = 1 + 0.092 * Math.pow(Math.log(g + 1) - 3.453, 2); return A * Math.pow(0.011 * t + 1, -Rr); }
function cepedaBest(t) { var bg = 0, bv = -1, g; for (g = 0; g <= 120; g += 0.01) { var v = cepedaRecall(g, t); if (v > bv) { bv = v; bg = g; } } return { g: bg, v: bv }; }
function sm2(q, n) {                                // exact decimal arithmetic: EF in hundredths, interval rounded UP
  var ef = 250, out = [], I = 0, i, d;
  for (i = 1; i <= n; i++) {
    d = 5 - q; ef = Math.max(130, ef + Math.round(10 - d * (8 + d * 2)));   // EF' = EF + (0.1 − (5−q)(0.08 + (5−q)·0.02))
    if (q < 3) { I = 1; } else if (i === 1) I = 1; else if (i === 2) I = 6; else I = Math.ceil(I * ef / 100 - 1e-12);
    out.push(I);
  }
  return { I: out, ef: ef / 100 };
}
function sm2Float(q, n) {                           // the naive floating-point version (to show where FACTS' 151 / 469 came from)
  var ef = 2.5, out = [], I = 0, i, d;
  for (i = 1; i <= n; i++) { d = 5 - q; ef = Math.max(1.3, ef + (0.1 - d * (0.08 + d * 0.02))); if (i === 1) I = 1; else if (i === 2) I = 6; else I = Math.ceil(I * ef); out.push(I); }
  return out;
}
var FW = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
function fsrsR(t, S) { return Math.pow(1 + (19 / 81) * t / S, -0.5); }
function fsrsI(r, S) { return (S / (19 / 81)) * (Math.pow(r, 1 / -0.5) - 1); }
function fsrsGood(k) {                              // always "Good" (G = 3), review exactly when R = 0.90, FSRS-4.5 defaults
  var S = FW[2], D = FW[4], out = [], i, R = 0.9, w = FW;
  for (i = 0; i < k; i++) {
    var I = fsrsI(0.9, S); out.push({ S: S, I: I });
    var nS = S * (Math.exp(w[8]) * (11 - D) * Math.pow(S, -w[9]) * (Math.exp(w[10] * (1 - R)) - 1) + 1);
    D = w[7] * FW[4] + (1 - w[7]) * (D - w[6] * 0);          // D' = w7·D0(3) + (1−w7)(D − w6(G−3)), G = 3
    out[out.length - 1].next = nS; S = nS;
  }
  return out;
}

if (require.main === module) {
  var line = function (s) { console.log(s); };
  line('=== 1. FACTS DERIVED reproduced ===');
  line('HLR p = 2^(−Δ/h):  ' + [0.152, 0.25, 0.5, 1, 2, 3, 4].map(function (x) { return 'Δ/h=' + x + ' → ' + (100 * Math.pow(2, -x)).toFixed(2) + '%'; }).join(' · '));
  line('Cepeda 2008 surface, argmax over g (step .01):   FACTS: 7→4.96 (71%, +4.4%) 14→8.0 (57%) 28→11.8 (42%, +25.8%) 35→13.1 (37%) 56→15.8 (28%) 70→17.1 (24%, +72.9%) 100→18.9 (19%) 180→21.5 (12%) 350→23.6 (6.7%, +416%) 365→23.7 (6.5%) 730→25.2 (3.5%)');
  [7, 14, 28, 35, 56, 70, 100, 180, 350, 365, 730].forEach(function (t) { var b = cepedaBest(t); line('  RI ' + String(t).padStart(3) + ': g* = ' + b.g.toFixed(2) + ' d (' + (100 * b.g / t).toFixed(1) + '% of RI), recall ' + (100 * b.v).toFixed(1) + '%, gain vs g=0 ' + (100 * (b.v / cepedaRecall(0, t) - 1)).toFixed(1) + '%'); });
  line('Cepeda measured best gaps (recall): RI 7→1 d, 35→11, 70→21, 350→21; (recognition 1, 7, 7, 21). ratios: ' + [[7, 1], [35, 11], [70, 21], [350, 21]].map(function (x) { return x[0] + ':' + (100 * x[1] / x[0]).toFixed(1) + '%'; }).join(' '));
  line('SM-2 (exact decimal)   q=3: ' + sm2(3, 6).I.join(', ') + '   q=4: ' + sm2(4, 6).I.join(', ') + '   q=5: ' + sm2(5, 6).I.join(', ') + '   [FACTS says q=3 1,6,13,26,47,79 · q=4 1,6,15,38,95,238 · q=5 1,6,17,50,151,469]');
  line('SM-2 (floating point) q=3: ' + sm2Float(3, 6).join(', ') + '   q=4: ' + sm2Float(4, 6).join(', ') + '   q=5: ' + sm2Float(5, 6).join(', ') + '   ← FACTS q=5 matches THIS (151, 469 are float round-up artefacts; exact = 150, 465)');
  line('SM-2 EF after 6 reps: q=3 ' + sm2(3, 6).ef.toFixed(2) + ' q=4 ' + sm2(4, 6).ef.toFixed(2) + ' q=5 ' + sm2(5, 6).ef.toFixed(2));
  line('FSRS-4.5 I/S at retention r: ' + [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5].map(function (r) { return r + ' → ' + fsrsI(r, 1).toFixed(3); }).join(' · '));
  line('FSRS-4.5 R(k·S):           ' + [0.25, 0.5, 1, 2, 4, 8, 16, 32].map(function (k) { return k + ' → ' + (100 * fsrsR(k, 1)).toFixed(1) + '%'; }).join(' · '));
  line('FSRS-4.5 "Good" always, review at R=.9 (FACTS: 3.7, 14.1, 46.9, 139.6, 377 d; multipliers 3.8, 3.3, 3.0, 2.7):');
  var fg = fsrsGood(5); line('  intervals ' + fg.map(function (x) { return x.I.toFixed(1); }).join(', ') + '   S multipliers ' + fg.slice(0, 4).map(function (x) { return (x.next / x.S).toFixed(2); }).join(', '));
  var cum = 0; line('  cumulative day ' + fg.map(function (x) { cum += x.I; return cum.toFixed(1); }).join(', '));

  line('\n=== 2. the widget model (H0 = ' + H0 + ', G = ' + G + ') ===');
  line('limit cases: n=1 baseline 2^(−R/H0) for R=35: ' + pc(Math.pow(2, -35 / H0)) + ' | n=2, g=0: ' + pc(recall(1, 2, 0, 35)) + ' | n=2, g=30: ' + pc(recall(1, 2, 30, 35)) + ' | g→∞: ' + pc(recall(1, 2, 1e6, 35)) + ' | massed n=4: ' + pc(recall(0, 4, 0, 35)));
  line('expected gain of one review 1 + G·p(1−p): max at p = .5 → ' + (1 + G * 0.25).toFixed(2) + '×');
  line('n = 2, equal spacing — best gap vs delay (grid ' + GSTEP + ' d):');
  var bs2 = {};
  RS.concat([350]).forEach(function (R) {
    var b = best(1, 2, R); bs2[R] = b;
    var gm = Math.max(b.g, 0), fine = (function () { var bg = 0, bv = -1, g; for (g = 0; g <= 60; g += 0.01) { var v = recall(1, 2, g, R); if (v > bv) { bv = v; bg = g; } } return bg; })();
    line('  R=' + R + ': best g = ' + f1(b.g) + ' d (' + (100 * b.g / R).toFixed(0) + '% of R) → ' + pc(b.v) + ' ; massed ' + pc(recall(0, 2, 0, R)) + ' ; continuous argmax (step .01, to 60 d) ' + fine.toFixed(2) + ' d');
  });
  line('  triple for KPI4 (7/35/70): ' + RS.map(function (R) { return f1(bs2[R].g); }).join(' / ') + ' d ; ratios ' + RS.map(function (R) { return (100 * bs2[R].g / R).toFixed(0) + '%'; }).join(' / '));
  line('\nbest mean gap and recall by (R, n, schedule):');
  RS.forEach(function (R) {
    [2, 3, 4, 5, 6].forEach(function (n) {
      var be = best(1, n, R), bx = best(2, n, R), m = recall(0, n, 0, R);
      line('  R=' + String(R).padStart(2) + ' n=' + n + '  equal ' + f1(be.g).padStart(4) + ' d ' + pc(be.v).padStart(6) + '  | expanding ' + f1(bx.g).padStart(4) + ' d ' + pc(bx.v).padStart(6) + '  | massed ' + pc(m).padStart(6));
    });
  });

  line('\n=== 3. default state candidates (R=35, equal) ===');
  [[4, 2], [4, 3], [3, 2], [3, 3], [2, 2], [4, 1], [4, 5]].forEach(function (c) {
    var n = c[0], g = c[1], r = run(gapsFor(1, n, g), 35), m = recall(0, n, 0, 35), b = best(1, n, 35);
    line('  n=' + n + ' g=' + g + ' → ' + pc(r.rec) + '  massed ' + pc(m) + '  best ' + f1(b.g) + ' d ' + pc(b.v) + '  P(recall at reviews) ' + r.rk.map(function (x) { return pc(x, 0); }).join(' → '));
  });

  line('\n=== 3b. every widget number the lesson prose quotes (section 四, the paragraph after the widget; kpi.js prints the same) ===');
  (function () {
    var d = run(gapsFor(1, 4, 2), 35), b4 = best(1, 4, 35), bo = run(gapsFor(1, 4, b4.g), 35), g30 = run(gapsFor(1, 4, 30), 35);
    var pr = function (r) { return r.rk.map(function (x) { return pc(x, 0); }).join(' → '); };
    line('  default n=4 g=2 R=35: ' + pc(d.rec) + ' | massed ' + pc(recall(0, 4, 0, 35)) + ' | at the reviews ' + pr(d));
    line('  best equal gap n=4: ' + f1(b4.g) + ' d → ' + pc(b4.v) + ' | at the reviews ' + pr(bo) + ' ;  g=30: ' + pc(g30.rec) + ' | at the reviews ' + pr(g30));
    line('  n=2 → 6 (R=35): massed ' + pc(recall(0, 2, 0, 35)) + ' → ' + pc(recall(0, 6, 0, 35)) + ' ; best equal ' + pc(best(1, 2, 35).v) + ' → ' + pc(best(1, 6, 35).v));
    line('  n=2 best gaps (R=7/35/70): ' + RS.map(function (R) { return f1(best(1, 2, R).g); }).join(' / ') + ' d  vs  Cepeda 2008 measured 1 / 11 / 21 d (not fitted)');
    line('  expanding vs equal, each at its own best: n=4 ' + pc(best(2, 4, 35).v) + ' vs ' + pc(best(1, 4, 35).v) + ' ; n=6 ' + pc(best(2, 6, 35).v) + ' vs ' + pc(best(1, 6, 35).v));
  })();

  line('\n=== 4. Monte-Carlo check of the exact expectation (200,000 items, seed 3) ===');
  (function () {
    var rng = mulberry32(3), n = 4, g = 6, R = 35, N = 200000, i, k, s = 0, h, p, ok;
    var gp = gapsFor(1, n, g);
    for (i = 0; i < N; i++) {
      h = H0;
      for (k = 0; k < gp.length; k++) { p = Math.pow(2, -gp[k] / h); if (rng() < p) h = h * (1 + G * (1 - p)); }
      s += (rng() < Math.pow(2, -R / h)) ? 1 : 0;
    }
    line('  n=4, g=6, R=35: MC ' + pc(s / N, 2) + ' vs exact ' + pc(recall(1, 4, 6, 35), 2));
  })();

  line('\n=== 5. PSY.rng identity check is not needed (the model uses no RNG); psy.js loads: ===');
  (function () {
    var fs = require('fs'), vm = require('vm'), path = require('path');
    var src = fs.readFileSync(path.join(__dirname, '../../../all_lessons/psychology_play/lessons/psy.js'), 'utf8');
    var win = { localStorage: { getItem: function () { return null; }, setItem: function () {} } }; win.window = win; vm.createContext(win); vm.runInContext(src, win);
    line('  PSY.phi(1.2816) = ' + win.PSY.phi(1.2816).toFixed(5));
  })();
}
if (typeof module !== 'undefined') module.exports = { gapsFor: gapsFor, run: run, recall: recall, best: best, H0: H0, G: G };
