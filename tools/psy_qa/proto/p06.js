// proto/p06.js — sidecar lesson 06 widget maths: 「同一笔奖励，晚到一天值多少？」 = hyperbolic vs exponential discounting and the preference reversal the hyperbola predicts.
// run: node tools/psy_qa/proto/p06.js          (NB the p prefix: proto/06.js belongs to the spine)
//
// A LABELLED DEMO (示意), not data. Nothing here is fitted to anyone; k is an adjustable illustration (FACTS_T6c 06-H: the human k range is second-hand and may not be quoted).
//
// DEFINITIONS (FACTS_T6c 06-H; all DERIVED from definitions, no RNG, no invented constants beyond the example's own amounts):
//   hyperbolic   V(D) = A / (1 + k·D)            [def: Mazur 1987 / Ainslie 1975; shape graded A: Myerson & Green 1995, Odum 2011]
//   exponential  V(D) = A · e^(−r·D)             with r chosen to MATCH the hyperbola at D = 30 days:  r = ln(1 + 30k)/30   (k = 0.01 ↔ r = 0.008745 /day)
//   Choice: a SMALL-SOON reward A_S that arrives t days from now  versus  a LARGE-LATER reward A_L that arrives Δ days after it (t + Δ from now).
//   Example constants (the lesson's, 示意): A_S = 50, A_L = 100, Δ = 30 days;  t = "how many days until the small reward is on offer" (0 = it is on the table now).
//   Prefers the small reward at t  ⇔  A_S/(1+k·t) > A_L/(1+k·(t+Δ))  ⇔  t < t* = (A_S(1 + kΔ) − A_L) / (k (A_L − A_S))     [hyperbolic]
//   With A_L = 2·A_S this is  t* = Δ − 1/k   (1/k = the delay at which value has halved).  A reversal in 0–90 days exists only if t* > 0, i.e. 1/k < Δ  ⇔  k > 1/30.
//   Exponential: V_L / V_S = (A_L/A_S)·e^(−rΔ) = 2/(1 + 30k) — the same for EVERY t, so the choice can never reverse (> 1 ⇔ k < 1/30).
//   Strip: what an immediate payment equal to 100 delayed D days is worth, D = 1, 7, 30, 90, 365 (FACTS DERIVED rows reproduced below).
//   Commitment (事先承诺): at t = 60 the large reward is chosen and switching is forbidden (the lesson's definition of the checkbox) — logic only; it models no take-up and no cost.
//   Reader-facing k grid (the slider is an index into this list; roughly logarithmic; presets 0.01 / 0.05 / 0.25 = indices 3 / 7 / 12).
var AS = 50, AL = 100, DL = 30, TPLAN = 60, TMAX = 90;
var KS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.04, 0.05, 0.07, 0.1, 0.15, 0.2, 0.25];
var DS = [1, 7, 30, 90, 365];

function rOf(k) { return Math.log(1 + 30 * k) / 30; }
function val(sh, A, D, k) { return sh === 'h' ? A / (1 + k * D) : A * Math.exp(-rOf(k) * D); }
function vS(sh, t, k) { return val(sh, AS, t, k); }
function vL(sh, t, k) { return val(sh, AL, t + DL, k); }
function tStar(k) { return (AS * (1 + k * DL) - AL) / (k * (AL - AS)); }
function pref(sh, t, k) { var s = vS(sh, t, k), l = vL(sh, t, k); return Math.abs(s - l) < 0.005 ? 'tie' : (s > l ? 'S' : 'L'); }
function ratio(k) { return 2 / (1 + 30 * k); }                                    // exponential: V_L / V_S, independent of t
function halfH(k) { return 1 / k; }
function halfE(k) { return Math.LN2 / rOf(k); }
function f2(x) { return x.toFixed(2); }
function fd(x) { var r = Math.round(x); return (Math.abs(x - r) < 0.05 ? String(r) : x.toFixed(1)) + ' 天'; }

// the five KPI strings and the note, exactly as the widget builds them
function kpis(st) {
  var k = st.k, sh = st.shape, t = st.t, p = pref(sh, t, k), ts = tStar(k), out = {};
  out.k1 = f2(vS(sh, t, k)); out.k2 = f2(vL(sh, t, k));
  out.k3 = st.commit ? '大奖（承诺锁定）' : (p === 'S' ? '小奖' : p === 'L' ? '大奖' : '一样（临界）');
  out.k4 = sh === 'e' ? '无（指数不反转）' : (ts > 0 ? fd(ts) : '无（一直选大奖）');
  out.k5 = sh === 'h' ? fd(halfH(k)) : fd(halfE(k));
  return out;
}
function strip(k) {
  var h = DS.map(function (D) { return f2(val('h', 100, D, k)); }).join(' / '), e = DS.map(function (D) { return f2(val('e', 100, D, k)); }).join(' / ');
  return '100 晚到 1 / 7 / 30 / 90 / 365 天，现在值——双曲：' + h + '；指数（30 天处对齐）：' + e;
}
function note(st) {
  var k = st.k, sh = st.shape, t = st.t, s = vS(sh, t, k), l = vL(sh, t, k), p = pref(sh, t, k), ts = tStar(k), a;
  if (sh === 'e') a = '指数下，大奖现值 ÷ 小奖现值 = ' + f2(ratio(k)) + '，对每一个 t 都一样，所以选择不会反转。';
  else if (ts > 0) a = '反转日 t* = 30 − 1/k = ' + fd(ts) + '：距小奖比这更远时选大奖，更近时换成小奖。';
  else a = '价值减半要等 ' + fd(1 / k) + '，比两个奖励的间隔（30 天）还长，任何时候都选大奖，没有反转。';
  if (st.commit) a += p === 'S' ? (sh === 'h' ? '承诺挡住了一次改主意：不承诺的话，此刻小奖（' + f2(s) + '）比大奖（' + f2(l) + '）更值。' : '指数下早晚想法一致，一直想要小奖；承诺只是把选择换成了大奖。') : p === 'L' ? '承诺在这里没拦住任何东西：不承诺你现在也选大奖。' : '此刻两者一样，承诺没有改变什么。';
  return a;
}

if (typeof module !== 'undefined') module.exports = { vS: vS, vL: vL, val: val, tStar: tStar, pref: pref, kpis: kpis, note: note, strip: strip, rOf: rOf, KS: KS };

if (require.main === module) {
  var line = function (s) { console.log(s); };
  line('=== 1. FACTS DERIVED: an immediate payment equal to 100 delayed D days (hyperbolic), D = 1, 7, 30, 90, 365 ===');
  [0.01, 0.05, 0.1, 0.25].forEach(function (k) { line('k = ' + k + ': ' + DS.map(function (D) { return f2(val('h', 100, D, k)); }).join(' / ')); });
  line('   FACTS: k = 0.05 → 95.24 / 74.07 / 40.00 / 18.18 / 5.19 · k = 0.01 → 99.01 / 93.46 / 76.92 / 52.63 / 21.51 · k = 0.10 → 90.91 / 58.82 / 25.00 / 10.00 / 2.67 · k = 0.25 → 80.00 / 36.36 / 11.76 / 4.26 / 1.08');
  line('   half-value delay 1/k (FACTS: 6,250 / 100 / 20 / 10 / 4 d for k = 0.00016 / 0.01 / 0.05 / 0.1 / 0.25): ' + [0.00016, 0.01, 0.05, 0.1, 0.25].map(function (k) { return k + ' → ' + Math.round(1 / k); }).join(' · '));
  line('   exponential matched at 30 d to k = 0.01: r = ' + rOf(0.01).toFixed(6) + '/day → ' + DS.map(function (D) { return f2(val('e', 100, D, 0.01)); }).join(' / ') + '   (FACTS: 99.13 / 94.06 / 76.92 / 45.52 / 4.11)');
  line('   exponential matched to k = 0.05: r = ' + rOf(0.05).toFixed(6) + ' → ' + DS.map(function (D) { return f2(val('e', 100, D, 0.05)); }).join(' / ') + '   (= 100·0.4^(D/30))');

  line('\n=== 2. FACTS DERIVED: the preference reversal, $50 at day t vs $100 at day t+30 (k = 0.05) ===');
  line('hyperbolic t = 0: ' + f2(vS('h', 0, 0.05)) + ' vs ' + f2(vL('h', 0, 0.05)) + '   t = 60: ' + f2(vS('h', 60, 0.05)) + ' vs ' + f2(vL('h', 60, 0.05)) + '   [FACTS: 50.00 vs 40.00; 12.50 vs 18.18]');
  line('exponential with r = 0.02 (the FACTS example): ratio at t = 0 and t = 60 = ' + (100 * Math.exp(-0.02 * 30) / 50).toFixed(4) + ' and ' + (100 * Math.exp(-0.02 * 90) / (50 * Math.exp(-0.02 * 60))).toFixed(4) + '   [FACTS: 1.0976 at both]');
  line('exponential matched to k = 0.05: t = 0 → ' + f2(vS('e', 0, 0.05)) + ' vs ' + f2(vL('e', 0, 0.05)) + ' ; t = 60 → ' + f2(vS('e', 60, 0.05)) + ' vs ' + f2(vL('e', 60, 0.05)) + ' ; ratio ' + f2(ratio(0.05)) + ' (= 2/(1+30k))');

  line('\n=== 3. reversal day: closed form vs a numerical scan (step 0.001 d), every k on the slider; identity t* = 30 − 1/k ===');
  KS.forEach(function (k) {
    var ts = tStar(k), scan = null, t;
    for (t = 0; t <= TMAX + 1e-9; t += 0.001) if (vS('h', t, k) <= vL('h', t, k)) { scan = t; break; }          // first t where the large reward is at least as good
    var inRange = ts > 0 && ts <= TMAX;
    var chk = (ts <= 0) ? (scan !== null && scan < 0.002) : (scan !== null && Math.abs(scan - ts) < 0.002);
    line('k = ' + String(k).padEnd(5) + ' 1/k = ' + (1 / k).toFixed(1).padStart(7) + '  t* = ' + ts.toFixed(3).padStart(9) + '  (30 − 1/k = ' + (30 - 1 / k).toFixed(3).padStart(9) + ')  scan: ' + (scan === null ? 'none' : scan.toFixed(3)) + '  reversal in 0–90: ' + (inRange ? 'yes' : 'no ') + '  ' + (chk ? 'OK' : 'MISMATCH') + '  | ratio(exp) ' + f2(ratio(k)) + ' → exp always ' + (ratio(k) > 1 ? 'LARGE' : 'SMALL'));
  });
  line('threshold k = 1/30 = ' + (1 / 30).toFixed(5) + '   (k = 0.03 → no reversal, k = 0.04 → t* = ' + tStar(0.04) + ')');

  line('\n=== 4. no reversal for the exponential at ANY t: preference over a dense grid, every k ===');
  KS.forEach(function (k) {
    var seen = {}, t;
    for (t = 0; t <= TMAX; t++) seen[pref('e', t, k)] = 1;
    var seenH = {};
    for (t = 0; t <= TMAX; t++) seenH[pref('h', t, k)] = 1;
    line('k = ' + String(k).padEnd(5) + ' exponential: ' + Object.keys(seen).join('/') + '   hyperbolic: ' + Object.keys(seenH).join('/'));
  });

  line('\n=== 5. widget states (KPI strings exactly as the widget prints them) ===');
  function show(label, st) { var q = kpis(st); line(label + ': V_S ' + q.k1 + ' | V_L ' + q.k2 + ' | pick ' + q.k3 + ' | reversal ' + q.k4 + ' | half ' + q.k5); line('   note: ' + note(st)); }
  var base = { k: 0.05, shape: 'h', t: 60, commit: false };
  show('DEFAULT  k .05 hyperbolic t 60', base);
  show('t = 30', { k: 0.05, shape: 'h', t: 30, commit: false });
  show('t = 11', { k: 0.05, shape: 'h', t: 11, commit: false });
  show('t = 10 (tie)', { k: 0.05, shape: 'h', t: 10, commit: false });
  show('t = 9', { k: 0.05, shape: 'h', t: 9, commit: false });
  show('t = 0', { k: 0.05, shape: 'h', t: 0, commit: false });
  show('t = 0 commit', { k: 0.05, shape: 'h', t: 0, commit: true });
  show('t = 60 commit', { k: 0.05, shape: 'h', t: 60, commit: true });
  show('exponential k .05 t 60', { k: 0.05, shape: 'e', t: 60, commit: false });
  show('exponential k .05 t 0', { k: 0.05, shape: 'e', t: 0, commit: false });
  show('exponential k .05 t 0 commit', { k: 0.05, shape: 'e', t: 0, commit: true });
  show('k .01 hyperbolic t 60', { k: 0.01, shape: 'h', t: 60, commit: false });
  show('k .01 hyperbolic t 0', { k: 0.01, shape: 'h', t: 0, commit: false });
  show('k .01 exponential t 0', { k: 0.01, shape: 'e', t: 0, commit: false });
  show('k .25 hyperbolic t 60', { k: 0.25, shape: 'h', t: 60, commit: false });
  show('k .25 hyperbolic t 26', { k: 0.25, shape: 'h', t: 26, commit: false });
  show('k .25 hyperbolic t 0', { k: 0.25, shape: 'h', t: 0, commit: false });
  show('k .1 hyperbolic t 0', { k: 0.1, shape: 'h', t: 0, commit: false });
  show('k .03 hyperbolic t 0', { k: 0.03, shape: 'h', t: 0, commit: false });
  show('k .04 hyperbolic t 0', { k: 0.04, shape: 'h', t: 0, commit: false });
  line('strip k .05: ' + strip(0.05));
  line('strip k .01: ' + strip(0.01));
  line('strip k .25: ' + strip(0.25));

  line('\n=== 6. sanity: the identity V_L/V_S for the hyperbola at the reversal day, and the matched exponentials agree at D = 30 ===');
  KS.forEach(function (k) {
    var ts = tStar(k), h30 = val('h', 100, 30, k), e30 = val('e', 100, 30, k);
    line('k = ' + String(k).padEnd(5) + ' V_S(t*)/V_L(t*) = ' + (ts > 0 ? (vS('h', ts, k) / vL('h', ts, k)).toFixed(6) : 'n/a') + '   D = 30: hyperbolic ' + h30.toFixed(4) + ' exponential ' + e30.toFixed(4) + (Math.abs(h30 - e30) < 1e-9 ? '  (match)' : '  MISMATCH'));
  });

  line('\n=== 7. the 85% rule table (FACTS 06-F DERIVED; text table in section 七; not a widget) ===');
  function erf(x) { var s = x < 0 ? -1 : 1, t, y; x = Math.abs(x); t = 1 / (1 + 0.3275911 * x); y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
  function Phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function phi(z) { return Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); }
  [0.5, 1, 1.5, 2].forEach(function (b) { line('βΔ = ' + b + ': ER = Φ(−βΔ) = ' + Phi(-b).toFixed(4) + '  accuracy = ' + (100 * (1 - Phi(-b))).toFixed(2) + '%   speed ∝ Δ·φ(βΔ) at β = 1 → ' + (b * phi(b)).toFixed(4)); });
  line('optimum: βΔ = 1 → ER = ' + Phi(-1).toFixed(6) + ', accuracy ' + (100 * (1 - Phi(-1))).toFixed(4) + '%   (FACTS: 0.158655 / 0.841345; speed peak Δ·φ(Δ) = 0.2420 at Δ = 1)');
  var best = 0, bx = 0, x; for (x = 0.001; x < 4; x += 0.001) if (x * phi(x) > best) { best = x * phi(x); bx = x; }
  line('numerical maximum of Δ·φ(Δ): at Δ = ' + bx.toFixed(3) + ' value ' + best.toFixed(4));
  line('other noise (FACTS): Laplace ER* = ½e⁻¹ = ' + (0.5 * Math.exp(-1)).toFixed(6) + ' (accuracy ' + (1 - 0.5 * Math.exp(-1)).toFixed(6) + '), Cauchy 0.25');
}
