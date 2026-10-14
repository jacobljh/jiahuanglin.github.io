// proto/14.js — lesson 14 widget maths: 「一天里的诱惑」 — two simulated people, same resisting rule, different inputs (a labelled TOY, not data).
// run: node tools/psy_qa/proto/14.js
// Anchors (Hofmann, Baumeister, Förster & Vohs 2012, JPSP 102(6):1318–1335; N = 205, 7 days x 7 random beeps, FACTS_T7b 14-A):
//   a current desire on 49.9% of responded beeps; mean strength 4.08 on 0-7, 6.3% rated 7 ("irresistible");
//   conflict with a goal (0-4): 53.2 / 14.7 / 12.4 / 10.9 / 8.8 %  (mean 1.08);
//   a desire was actively resisted in 42% of desire occasions; enactment 69.6% if not resisted, 17.4% if resisted;
//   among RESISTED desires enactment rises from 10.8% (strength 1) to 25.8% (strength 7); among unresisted ones strength does not matter;
//   strength and conflict unrelated (r ~ 0); resisting rises with conflict (log-odds B = 0.49 per conflict point).
//   high vs low trait self-control (+1 SD vs -1 SD): strength 3.88 vs 4.20 (gap 0.32); conflict gap about 0.19 (DERIVED from B = -0.16, SD 0.59);
//   desire FREQUENCY unrelated to trait self-control (|r| ~ .04).
// NOT published (labelled 示意 in the widget): the SD of strength (derived below from "6.3% rate 7"), the per-hour slot structure (14 slots/day: each hour
//   treated like one beep), the intercept of the resisting curve (calibrated to the published 42%), the "lapse" definition, the exposure cut.
// Model per slot (hour), common random numbers for both people:
//   desire if u1 < PD * (1 - cut);  strength s = clip(mu + SD*z, 0, 7);  conflict c ~ pmf(tilt);
//   resisted if u3 < sigmoid(A + 0.49*c + o);   enacted if u4 < (resisted ? 0.108 + 0.150*(s-1)/6 : 0.696)
//   lapse = a desire with conflict >= 1 that was enacted.
var PSY = require('./_psy.js');

var DAYS = 1000, SLOTS = 14, SEED = 2014;
var PD = 0.499, PC0 = [0.532, 0.147, 0.124, 0.109, 0.088], SLOPE = 0.49;
var MU_TARGET = 4.08, SD_S = 1.58;       // SD: P(strength >= 6.5) = 6.3%  ->  z = 1.53  ->  SD = (6.5 - 4.08) / 1.53
var DSTR = 0.32, DCON = 0.19;             // high-vs-low trait self-control gap (published / derived)
var ENR0 = 0.108, ENR7 = 0.258, ENN = 0.696;

function sig(x) { return 1 / (1 + Math.exp(-x)); }
function clip(v, a, b) { return Math.max(a, Math.min(b, v)); }
function meanOf(p) { var m = 0, i; for (i = 0; i < p.length; i++) m += i * p[i]; return m; }
function tilt(lam) { var p = [], t = 0, i; for (i = 0; i < 5; i++) { p.push(PC0[i] * Math.exp(-lam * i)); t += p[i]; } for (i = 0; i < 5; i++) p[i] /= t; return p; }
function pmfWithMean(target) {            // exponential tilt of the published pmf so that its mean equals target
  var lo = -3, hi = 6, i, m;
  for (i = 0; i < 60; i++) { m = (lo + hi) / 2; if (meanOf(tilt(m)) > target) lo = m; else hi = m; }
  return tilt((lo + hi) / 2);
}
var BASEMEAN = meanOf(PC0);
// intercept A: base pmf, offset 0  ->  42% of desires resisted
function calA() { var lo = -4, hi = 2, i, m, r, c; for (i = 0; i < 60; i++) { m = (lo + hi) / 2; r = 0; for (c = 0; c < 5; c++) r += PC0[c] * sig(m + SLOPE * c); if (r > 0.42) hi = m; else lo = m; } return (lo + hi) / 2; }
var A = calA();
// mu0 such that the CLIPPED strength has mean 4.08 (estimated on the shared z stream)
var rr = PSY.rng(SEED), U = [], d, k;
for (d = 0; d < DAYS * SLOTS; d++) U.push({ u1: rr(), z: PSY.gauss(rr), u2: rr(), u3: rr(), u4: rr() });
function clippedMean(mu) { var s = 0, i; for (i = 0; i < U.length; i++) s += clip(mu + SD_S * U[i].z, 0, 7); return s / U.length; }
var MU0 = (function () { var lo = 2, hi = 6, i, m; for (i = 0; i < 50; i++) { m = (lo + hi) / 2; if (clippedMean(m) < MU_TARGET) lo = m; else hi = m; } return (lo + hi) / 2; })();

// person: { x: arrangement (0..2, 1 = the published high-vs-low gap), cut: exposure cut 0..0.6, o: resisting tendency offset (log-odds) }
function run(p) {
  var pmf = pmfWithMean(BASEMEAN - DCON * p.x), cdf = [], t = 0, i, c, s, r = { des: 0, con: 0, res: 0, enact: 0, lapse: 0, str: 0, sres: 0 };
  for (c = 0; c < 5; c++) { t += pmf[c]; cdf.push(t); }
  var mu = MU0 - DSTR * p.x, pd = PD * (1 - p.cut);
  for (i = 0; i < U.length; i++) {
    var u = U[i];
    if (!(u.u1 < pd)) continue;
    c = 0; while (c < 4 && u.u2 >= cdf[c]) c++;
    s = clip(mu + SD_S * u.z, 0, 7);
    var res = u.u3 < sig(A + SLOPE * c + p.o);
    var pe = res ? ENR0 + (ENR7 - ENR0) * (s - 1) / 6 : ENN;
    var en = u.u4 < pe;
    r.des++; r.str += s; if (c >= 1) r.con++; if (res) r.res++; if (en) r.enact++; if (en && c >= 1) r.lapse++;
  }
  var n = DAYS;
  return { des: r.des / n, con: r.con / n, res: r.res / n, enact: r.enact / n, lapse: r.lapse / n, strMean: r.des ? r.str / r.des : 0, resShare: r.des ? r.res / r.des : 0, enactShare: r.des ? r.enact / r.des : 0 };
}
// the resisting offset the hard-resister needs to match a target number of lapses (CRN => lapses is monotone non-increasing in o)
function matchO(pA, targetLapse) {
  var lo = 0, hi = 8, i, m, q = { x: pA.x, cut: pA.cut, o: hi };
  if (run(q).lapse > targetLapse) return null;
  for (i = 0; i < 40; i++) { m = (lo + hi) / 2; q.o = m; if (run(q).lapse > targetLapse) lo = m; else hi = m; }
  q.o = hi; return { o: hi, r: run(q) };
}
function f(v, d) { return v.toFixed(d === undefined ? 2 : d); }
function show(name, pA, pB) {
  var a = run(pA), b = run(pB), m = matchO(pA, b.lapse);
  console.log(name);
  console.log('   A 硬扛型  des', f(a.des), 'conf', f(a.con), 'resist', f(a.res), 'lapse', f(a.lapse), 'enact', f(a.enact), '| str', f(a.strMean), 'resShare', f(a.resShare, 3), 'enactShare', f(a.enactShare, 3));
  console.log('   B 安排型  des', f(b.des), 'conf', f(b.con), 'resist', f(b.res), 'lapse', f(b.lapse), 'enact', f(b.enact), '| str', f(b.strMean), 'resShare', f(b.resShare, 3), 'enactShare', f(b.enactShare, 3));
  console.log('   match: ', m ? 'o_A = ' + f(m.o) + ' -> A resist ' + f(m.r.res) + ' lapse ' + f(m.r.lapse) + ' (B resist ' + f(b.res) + ')' : '追不平');
  return { a: a, b: b, m: m };
}
if (require.main === module) {
  console.log('A (intercept) =', f(A, 4), ' MU0 =', f(MU0, 4), ' base conflict mean =', f(BASEMEAN, 4), ' clipped mean at MU0 =', f(clippedMean(MU0), 3));
  console.log('P(resist | c) =', [0, 1, 2, 3, 4].map(function (c) { return f(sig(A + SLOPE * c), 3); }).join(' '));
  show('sanity: identical persons (x=0,cut=0,o=0)', { x: 0, cut: 0, o: 0 }, { x: 0, cut: 0, o: 0 });
  show('default: o_A=0, x=1, cut=0', { x: 0, cut: 0, o: 0 }, { x: 1, cut: 0, o: 0 });
  show('x=2', { x: 0, cut: 0, o: 0 }, { x: 2, cut: 0, o: 0 });
  show('A resist +1.5 vs B x=1', { x: 0, cut: 0, o: 1.5 }, { x: 1, cut: 0, o: 0 });
  show('A resist +3 vs B x=1', { x: 0, cut: 0, o: 3 }, { x: 1, cut: 0, o: 0 });
  show('cut 30% only (x=0)', { x: 0, cut: 0, o: 0 }, { x: 0, cut: 0.3, o: 0 });
  show('x=1 + cut 30%', { x: 0, cut: 0, o: 0 }, { x: 1, cut: 0.3, o: 0 });
}
if (typeof module !== 'undefined') module.exports = { run: run, matchO: matchO };
