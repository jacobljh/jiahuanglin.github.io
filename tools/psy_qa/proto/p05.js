// proto/p05.js — sidecar lesson 05 widget maths: 「习惯强度曲线」 = the Lally et al. (2010) automaticity curve y = a − b·e^(−c·x), as a calculator.
// run: node tools/psy_qa/proto/p05.js          (NB the p prefix: proto/05.js belongs to the spine)
//
// MODEL (closed form, no RNG, no invented constants).
//   Lally, van Jaarsveld, Potts & Wardle 2010 (FACTS_T6b 05-B, "Widget constants (05)"): 96 volunteers, one self-chosen daily behaviour tied to a fixed cue, 84 days,
//   daily SRHI automaticity score (7-item subscale, 0–42).  A curve  y(x) = a − b·e^(−c·x)  was fitted to each person (x = day, a = plateau, b = gap between plateau and the
//   modelled start, c = rate per day).  62 curves fitted, 39 of the 82 analysable volunteers (48%) were "good fits" (R² ≥ .7, plateau between 21 and 49).
//   Table 2 of the paper, those 39 people, median (Q1:Q3; min–max):  a = 35 (29:43; 21–48)   b = 30 (23:39; 13–51)   c = 0.042/day (0.028:0.064; 0.010–0.170)
//   time to 95% of one's own plateau = 66 days (39:102; 18–254)  ← a MEDIAN OF INDIVIDUAL RATIOS, not the formula evaluated at the median parameters.
//   Reading of the formula (derived here): dy/dx = c·(a − y), i.e. every further day of repetition closes the same FRACTION (1 − e^(−c) ≈ 4.1% at c = .042) of the remaining gap.
//   Time to a fraction f of the plateau:  t_f = ln( b / ((1 − f)·a) ) / c      (0 if the start a − b already exceeds f·a).   f = 0.95 gives the paper's ln(20b/a)/c.
//   Daily progress  y'(x) = b·c·e^(−c·x).   One missed day (Lally 2010 SLIPS: 140 misses by 55 people → next-day automaticity −0.29 points on average; no longer-term cost):
//   drawn as a single −0.29 on the day after the miss; the day counter keeps running; "cost in days" = 0.29 / y'(x) is plain arithmetic (how long the curve takes to earn 0.29 back at
//   that day's pace), NOT a measured consequence (the paper finds the 0.29 unrelated to when the miss happened, r = .099).
// CONSTANTS: all of the above are FACTS; the only choices made here are presentation (x-axis 0–180 days, marker slider 0–120, y-axis 0–50).
function t_f(a, b, c, f) { var y0 = a - b; if (y0 >= f * a) return 0; return Math.log(b / ((1 - f) * a)) / c; }
function y(a, b, c, x) { return a - b * Math.exp(-c * x); }
function slope(a, b, c, x) { return b * c * Math.exp(-c * x); }
function f1(x) { return x.toFixed(1); }
function f2(x) { return x.toFixed(2); }
var MISS = 0.29;

// ── default state: the median parameters ──────────────────────────────────────────────────────────────────────────────
var A = 35, Y0 = 5, B = A - Y0, C = 0.042, DAY = 21;
console.log('DEFAULT  a=' + A + '  y0=' + Y0 + '  b=' + B + '  c=' + C + '  marker day=' + DAY);
console.log('  t50 / t80 / t90 / t95 =', [0.5, 0.8, 0.9, 0.95].map(function (f) { return f1(t_f(A, B, C, f)); }).join(' / '), '   (FACTS DERIVED 12.8 / 34.6 / 51.2 / 67.7)');
console.log('  y(7), y(21), y(66) =', f1(y(A, B, C, 7)), f1(y(A, B, C, 21)), f1(y(A, B, C, 66)), '   (FACTS DERIVED 12.6 / 22.6 / 33.1)');
console.log('  y(day 0, 14, 30, 45, 60, 84, 100, 150) =', [0, 14, 30, 45, 60, 84, 100, 150].map(function (x) { return f1(y(A, B, C, x)); }).join(' / '), '   (FACTS 5.0 18.3 26.5 30.5 32.6 34.1 34.6 34.9)');
console.log('  y(21)/a =', (100 * y(A, B, C, 21) / A).toFixed(1) + '%   (share of the plateau at day 21)');
console.log('  slope(7), slope(21), slope(30), slope(66) =', [7, 21, 30, 66].map(function (x) { return f2(slope(A, B, C, x)); }).join(' / '), '   (FACTS: 0.94 at day 7, 0.36 at day 30)');
console.log('  miss cost in days (0.29/slope) at day 7, 21, 30, 66, 84 =', [7, 21, 30, 66, 84].map(function (x) { return f1(MISS / slope(A, B, C, x)); }).join(' / '),
  '   (FACTS: about a third of a day early, about 0.8 at day 30)');
console.log('  daily gap-closing fraction 1 − e^(−c) =', (100 * (1 - Math.exp(-C))).toFixed(2) + '%');
console.log('  y(21) with a miss on day 20 =', f1(y(A, B, C, 21) - MISS));

// ── independent check: day-by-day recurrence (gap closes by the factor e^(−c) each day) reproduces the closed form at integer days ──
(function () {
  var yy = A - B, d, maxErr = 0, first = {}, fr = [0.5, 0.8, 0.9, 0.95];
  for (d = 0; d <= 400; d++) {
    maxErr = Math.max(maxErr, Math.abs(yy - y(A, B, C, d)));
    fr.forEach(function (f) { if (first[f] === undefined && yy >= f * A) first[f] = d; });
    yy = yy + (1 - Math.exp(-C)) * (A - yy);
  }
  console.log('RECURRENCE max |recurrence − closed form| over days 0..400 =', maxErr.toExponential(2), '   first INTEGER day ≥ f·a:', fr.map(function (f) { return first[f]; }).join(' / '),
    '(= ceil of 12.8 / 34.6 / 51.2 / 67.7 → 13 / 35 / 52 / 68)');
})();

// ── FACTS DERIVED tables ──────────────────────────────────────────────────────────────────────────────────────────────
console.log('\nEFFECT OF THE RATE c  (a = 35, b = 30): days to 80% / 95%   (FACTS: .010 → 145.5/284.2, .028 → 52.0/101.5, .042 → 34.6/67.7, .064 → 22.7/44.4, .170 → 8.6/16.7)');
[0.010, 0.028, 0.042, 0.064, 0.170].forEach(function (c) { console.log('  c = ' + c.toFixed(3) + ' → ' + f1(t_f(35, 30, c, 0.8)) + ' / ' + f1(t_f(35, 30, c, 0.95)) + '   t50 ' + f1(t_f(35, 30, c, 0.5)) + '  t90 ' + f1(t_f(35, 30, c, 0.9)) + '   y(21) = ' + f1(y(35, 30, c, 21)) + ' (' + Math.round(100 * y(35, 30, c, 21) / 35) + '% of the plateau)'); });

console.log('\nEFFECT OF THE START y0 (a = 35, c = .042): days to 80% / 95%   (FACTS: 0 → 38.3/71.3, 3 → 36.2/69.2, 5 → 34.6/67.7, 10 → 30.3/63.3, 15 → 25.0/58.0, 20 → 18.1/51.2, 25 → 8.5/41.5, 28 → 0/33.0)');
[0, 3, 5, 10, 15, 20, 25, 28].forEach(function (y0) { console.log('  y0 = ' + y0 + ' → ' + f1(t_f(35, 35 - y0, 0.042, 0.8)) + ' / ' + f1(t_f(35, 35 - y0, 0.042, 0.95))); });

console.log('\nEFFECT OF THE PLATEAU a (y0 = 5, c = .042): days to 50 / 80 / 90 / 95%  — what matters is the start as a share of the plateau, b/a = 1 − y0/a');
[21, 29, 35, 43, 48].forEach(function (a) { console.log('  a = ' + a + ' (b = ' + (a - 5) + ', b/a = ' + ((a - 5) / a).toFixed(3) + ') → ' + [0.5, 0.8, 0.9, 0.95].map(function (f) { return f1(t_f(a, a - 5, 0.042, f)); }).join(' / ')); });
console.log('  scale check: (a, y0) = (35, 5) vs (70, 10) → t95 =', f1(t_f(35, 30, 0.042, 0.95)), f1(t_f(70, 60, 0.042, 0.95)), '(same ratio b/a, same time)');

// ── published quartiles of c vs published quartiles of t95 (a, b at their medians: sensitivity only, NOT a description of real people) ──
console.log('\nSENSITIVITY: t95 from c = min / Q1 / median / Q3 / max with a = 35, b = 30:', [0.010, 0.028, 0.042, 0.064, 0.170].map(function (c) { return f1(t_f(35, 30, c, 0.95)); }).join(' / '),
  '   vs paper: 254 (max) / 102 (Q3) / 66 / 39 (Q1) / 18 (min) — note the ORDER: slow c ↔ long time');
console.log('  fraction of the plateau at day 21 for c = min / Q1 / median / Q3 / max =', [0.010, 0.028, 0.042, 0.064, 0.170].map(function (c) { return Math.round(100 * y(35, 30, c, 21) / 35) + '%'; }).join(' / '));

// ── paper's own numbers that the widget prints beside the model (static, from FACTS) ──────────────────────────────────
console.log('\nPAPER (static):  t95 median 66 (Q1:Q3 39:102; range 18–254), 39 of 82 analysable (48%), 96 took part; gap-closing 4.1%/day; 66 vs 67.7: median of ratios ≠ ratio of medians');
console.log('  by behaviour (not significantly different): eating 65, drinking 59, exercise 91 days to 95% (n = 10 / 15 / 13)');

// ── how many days could a reader be "at 80%/95%" by day 21 on the rate grid: the 21-day marker ─────────────────────────────
console.log('\n21-DAY MARKER at the median parameters: y(21) =', f1(y(35, 30, 0.042, 21)), '= ' + Math.round(100 * y(35, 30, 0.042, 21) / 35) + '% of the plateau; t80 = ' + f1(t_f(35, 30, 0.042, 0.8)) + ' d, t95 = ' + f1(t_f(35, 30, 0.042, 0.95)) + ' d');
console.log('  scale midpoint 21 reached at day', f1(Math.log(30 / (35 - 21)) / 0.042), '(FACTS DERIVED 18.1; convenience marker only)');
console.log('  80% of the GAIN above the start (y0 → a): ln5/c =', f1(Math.log(5) / 0.042), ' (FACTS 38.3)');
