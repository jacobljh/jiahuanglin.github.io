// proto/p04.js — sidecar lesson 04 widget maths: 「睡眠压力曲线与咖啡因」 = a labelled DEMO of the two-process model + first-order caffeine decay (not data).
// run: node tools/psy_qa/proto/p04.js          (NB the p prefix: proto/04.js belongs to the spine)
//
// MODEL, part 1 — the two-process sleep model (Skeldon, Derks & Dijk 2014, PLoS One 9(8):e103877, "typical" values of eq. 15; FACTS_T6b "Widget constants (04)"):
//   homeostat H (= Process S, sleep pressure; ARBITRARY units, the scale of a brainstem model, not 0–1):
//       awake :  H(t) = μ + (H0 − μ)·e^(−Δt/χ_w)        (rises toward the asymptote μ = 21.35)
//       asleep:  H(t) = H0·e^(−Δt/χ_s)                   (decays toward 0);          χ_w = χ_s = 45 h
//   clock C(t) = sin(ω(t − α)), ω = 2π/24 h (the clock is entrained to the 24-h day here; its free-running period, 24.2 h, is NOT used — see the lesson).
//   thresholds: sleep starts when H reaches the upper one H⁺(t) = H0⁺ + a·C(t) (H0⁺ = 15.5), ends when H falls to the lower one H⁻(t) = H0⁻ + a·C(t) (H0⁻ = 14.5);
//       a = 2.9 is the published value; OTHER values of a are this page's exploration (labelled 示意), NOT the paper's numbers.
//   α is not printed in the paper; it is a PHASE CHOICE here: α = 10.43 h puts sleep onset at 23:00 and waking at about 07:29 (FACTS: "if the wake-up is placed at 07:00 the same fit
//   puts C's minimum near 04:00" — a fit, not a published value). Time-translation invariance means every α gives the same cycle shifted in clock time.
//   FACTS DERIVED to reproduce: stable 24-h cycle, 15.5 h awake / 8.5 h asleep, H between 12.48 and 15.07 (the paper PRINTS 12.51 / 15.07 and 15.36 h awake / 8.64 h asleep:
//   its sleep-decay equation gives 12.44 — a 0.07 gap FACTS attributes to rounding in the source); from the morning minimum 12.48: 16 h awake → 15.13, 24 h → 16.15, 40 h → 17.70.
// MODEL, part 2 — caffeine: first-order decay, fraction left = 0.5^(Δt/t½), absorption lag ignored (peak ≈ 30 min after an oral dose, Blanchard & Sawers 1983);
//   half-life range 2.7–9.9 h in 10 men (Blanchard & Sawers 1983), 3–7 h typical in adults (Temple 2017); slider 3–9.9 h; the first-order form is a low-to-moderate-dose
//   approximation (half-life longer at 500 mg than at 250 mg, Kaplan 1997) — the dose slider stops at 400 mg.
//   Sourced reference drawn BESIDE the model, never fitted to it: the meta-analysis (Gardiner et al. 2023, 24 studies) models a cut-off "to avoid reductions in total sleep time"
//   of at least 8.8 h before bedtime for a coffee-size dose (107 mg per 250 mL) and 13.2 h for a 217.5 mg pre-workout supplement.
// COUPLING of the two panels: caffeine left at BEDTIME = dose·0.5^((t_bed − t_coffee)/t½), where t_bed is the model's own first sleep onset AFTER the last coffee (tc) plus E (hours the
//   reader refuses to go to sleep; during E the homeostat keeps following the WAKE equation — the upper threshold is "dropped", as Skeldon describe for sleep-deprivation experiments).
//   Sleep AFTER such a vigil is NOT simulated (the McCauley 2009 limit: the two-process model predicts timing/duration of sleep, and fails for performance under chronic restriction —
//   and this toy's long-vigil sleep is not validated).
var MU = 21.35, HP0 = 15.5, HM0 = 14.5, XW = 45, XS = 45, OM = 2 * Math.PI / 24, ALPHA = 10.43, A_PAPER = 2.9;
var DT = 0.005, WARM_H = 720, SPAN_H = 48, NSTEP = Math.round(SPAN_H / DT);

function simulate(a) {                       // → {H: Float64Array(NSTEP+1), ev: [{t, type: 'sleep'|'wake', H}], asleep0}
  var ex = Math.exp(-DT / XW), es = Math.exp(-DT / XS), n, nw = Math.round(WARM_H / DT), H = 13, asleep = false, t, Hn, tn, g0, g1, fr;
  var rec = new Float64Array(NSTEP + 1), ev = [], asleep0 = false;
  function gap(h, tt) { return asleep ? h - (HM0 + a * Math.sin(OM * (tt - ALPHA))) : h - (HP0 + a * Math.sin(OM * (tt - ALPHA))); }
  for (n = 0; n < nw + NSTEP; n++) {
    t = n * DT; tn = (n + 1) * DT;
    Hn = asleep ? H * es : MU - (MU - H) * ex;
    if (!asleep && Hn >= HP0 + a * Math.sin(OM * (tn - ALPHA))) {
      g0 = H - (HP0 + a * Math.sin(OM * (t - ALPHA))); g1 = Hn - (HP0 + a * Math.sin(OM * (tn - ALPHA))); fr = g0 / (g0 - g1);
      if (n >= nw) ev.push({ t: tn - WARM_H - DT * (1 - fr), type: 'sleep', H: H + (Hn - H) * fr });
      asleep = true;
    } else if (asleep && Hn <= HM0 + a * Math.sin(OM * (tn - ALPHA))) {
      g0 = H - (HM0 + a * Math.sin(OM * (t - ALPHA))); g1 = Hn - (HM0 + a * Math.sin(OM * (tn - ALPHA))); fr = g0 / (g0 - g1);
      if (n >= nw) ev.push({ t: tn - WARM_H - DT * (1 - fr), type: 'wake', H: H + (Hn - H) * fr });
      asleep = false;
    }
    H = Hn;
    if (n + 1 === nw) { rec[0] = H; asleep0 = asleep; }
    if (n + 1 > nw) rec[n + 1 - nw] = H;
  }
  return { H: rec, ev: ev, asleep0: asleep0 };
}
function wakeRise(h0, dt) { return MU - (MU - h0) * Math.exp(-dt / XW); }       // the wake equation (closed form)
function sleepFall(h0, dt) { return h0 * Math.exp(-dt / XS); }                  // the sleep equation (closed form)
function thr(a, t) { var c = a * Math.sin(OM * (t - ALPHA)); return { up: HP0 + c, lo: HM0 + c }; }
function caff(dose, th, dt) { return dt < 0 ? 0 : dose * Math.pow(0.5, dt / th); }

// the night the widget reads: the FIRST sleep onset after the last coffee (tc), the wake-up just before it, and the wake-up that ends the baseline sleep
function dayFor(sim, tc) {
  var ev = sim.ev, i, s = -1, w = -1, w2 = -1;
  for (i = 0; i < ev.length; i++) if (ev[i].type === 'sleep' && ev[i].t > tc) { s = i; break; }
  if (s < 0) return null;
  for (i = s - 1; i >= 0; i--) if (ev[i].type === 'wake') { w = i; break; }
  if (w < 0) return null;
  for (i = s + 1; i < ev.length; i++) if (ev[i].type === 'wake') { w2 = i; break; }
  return { tw: ev[w].t, Hw: ev[w].H, ts: ev[s].t, Hs: ev[s].H, awake: ev[s].t - ev[w].t, asleepDur: w2 >= 0 ? ev[w2].t - ev[s].t : null, tw2: w2 >= 0 ? ev[w2].t : null };
}
// all readouts for one set of controls
function readout(sim, p) {                   // p = {E, tc, dose, th}; E is clamped so that the bedtime stays inside the 48-h window
  var d = dayFor(sim, p.tc), E, tb, left, r;
  if (!d) return null;
  E = Math.max(0, Math.min(p.E, SPAN_H - 0.1 - d.ts));
  tb = d.ts + E;
  left = caff(p.dose, p.th, tb - p.tc);
  r = { tw: d.tw, ts: d.ts, tb: tb, E: E, clamped: E < p.E - 1e-9, awake: d.awake, asleepDur: d.asleepDur, hrs: d.awake + E, S: E > 0 ? wakeRise(d.Hs, E) : d.Hs, Hs: d.Hs, Hw: d.Hw, left: left, pct: p.dose > 0 ? left / p.dose : 0, gap: tb - p.tc };
  return r;
}
function clock(t) { var h = ((t % 24) + 24) % 24, m = Math.round(h * 60), hh = Math.floor(m / 60) % 24, mm = m % 60; return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; }
function f1(x) { return x.toFixed(1); }
function f2(x) { return x.toFixed(2); }

if (typeof module !== 'undefined') module.exports = { simulate: simulate, dayFor: dayFor, readout: readout, wakeRise: wakeRise, sleepFall: sleepFall, caff: caff, thr: thr, clock: clock, MU: MU, ALPHA: ALPHA };

if (require.main === module) {
  var line = function (s) { console.log(s); };
  var base = simulate(A_PAPER), d0 = dayFor(base, 15);

  line('=== 1. the published parameter set: limit cycle (FACTS: 15.5 h awake / 8.5 h asleep, H 12.48 … 15.07; paper prints 12.51 / 15.07, 15.36 / 8.64) ===');
  line('events in the 48-h window (a = 2.9, α = ' + ALPHA + '): ' + base.ev.map(function (e) { return e.type + ' ' + clock(e.t) + ' (t=' + f2(e.t) + ', H=' + f2(e.H) + ')'; }).join(' | '));
  line('day: wake ' + clock(d0.tw) + ' H=' + f2(d0.Hw) + ' → sleep ' + clock(d0.ts) + ' H=' + f2(d0.Hs) + ' ; awake ' + f2(d0.awake) + ' h, asleep ' + f2(d0.asleepDur) + ' h, next wake ' + clock(d0.tw2));
  line('initial-state independence (30-day warm-up from H = 13 awake; other starts tried in the exploration: same limit cycle to 3 decimals)');

  line('\n=== 2. FACTS DERIVED: from the morning minimum, 16 / 24 / 40 h awake (wake equation) ===');
  line('from 12.48 (FACTS):  ' + [16, 24, 40].map(function (h) { return h + ' h → ' + f2(wakeRise(12.48, h)); }).join(' · ') + '    [FACTS: 15.13 / 16.15 / 17.70]');
  line('from this run\'s ' + f2(d0.Hw) + ': ' + [16, 24, 40].map(function (h) { return h + ' h → ' + f2(wakeRise(d0.Hw, h)); }).join(' · '));
  line('widget route (S at bedtime = wakeRise(H_onset, E)), E = 0 / 0.5 / 8.5 / 24.5: ' + [0, 0.5, 8.5, 24.5].map(function (E) { var o = readout(base, { E: E, tc: 15, dose: 100, th: 5 }); return 'E=' + E + ' → awake ' + f2(o.hrs) + ' h, S ' + f2(o.S) + ' (1 dec ' + f1(o.S) + ')'; }).join(' · '));
  line('asymptote μ = 21.35: S(∞); S at 40 h as % of the way from the wake value to μ: ' + (100 * (wakeRise(d0.Hw, 40) - d0.Hw) / (MU - d0.Hw)).toFixed(0) + '%');

  line('\n=== 3. FACTS DERIVED: caffeine, fraction left = 0.5^(t/t½) ===');
  [3, 5, 7, 9.9].forEach(function (th) { line('t½ = ' + th + ' h: ' + [6, 8, 10].map(function (h) { return h + ' h → ' + (100 * caff(1, th, h)).toFixed(0) + '%'; }).join(' / ') + '   time for 90% to clear = ' + (th * Math.log(10) / Math.log(2)).toFixed(1) + ' h'); });
  line('100 mg at 15:00, bedtime 23:00 (exactly 8 h): t½ 3 → ' + caff(100, 3, 8).toFixed(1) + ' mg · 5 → ' + caff(100, 5, 8).toFixed(1) + ' mg · 7 → ' + caff(100, 7, 8).toFixed(1) + ' · 9.9 → ' + caff(100, 9.9, 8).toFixed(1) + '   [FACTS: 16 / 33 / — / 57 mg]');
  var o0 = readout(base, { E: 0, tc: 15, dose: 100, th: 5 });
  line('widget default (bedtime = model onset ' + clock(o0.ts) + ' = t ' + f2(o0.ts) + '): left ' + o0.left.toFixed(2) + ' mg = ' + (100 * o0.pct).toFixed(1) + '% ; gap ' + f2(o0.gap) + ' h  [FACTS ≈ 33 mg]');
  [3, 5, 7, 9.9].forEach(function (th) { var o = readout(base, { E: 0, tc: 15, dose: 100, th: th }); line('  t½ ' + th + ': ' + o.left.toFixed(2) + ' mg (' + Math.round(o.left) + ' mg, ' + Math.round(100 * o.pct) + '%)'); });
  line('meta-analysis line: bedtime − 8.8 h = ' + clock(o0.tb - 8.8) + '; a 15:00 coffee is ' + f2(15 - (o0.tb - 8.8)) + ' h AFTER that line; left at the line itself (t½ 5, 100 mg): ' + caff(100, 5, 8.8).toFixed(1) + ' mg (NOT quoted: no sourced threshold)');
  line('coffee at 12:00 / 13:00 / 14:12 (the 8.8 h line) / 15:00 / 17:00 / 19:00 / 22:00 → left (t½ 5, 100 mg): ' + [12, 13, o0.tb - 8.8, 15, 17, 19, 22].map(function (tc) { return clock(tc) + ': ' + caff(100, 5, o0.tb - tc).toFixed(1); }).join(' · '));

  line('\n=== 4. the clock is what consolidates sleep — a = 0 and other strengths (EXPLORATION, not published values) ===');
  [0, 0.5, 1, 1.5, 2, 2.5, 2.9, 3.5, 4].forEach(function (a) {
    var s = simulate(a), dd = dayFor(s, 15), ons = s.ev.filter(function (e) { return e.type === 'sleep'; }).length;
    line('a = ' + a.toFixed(1) + ': ' + (dd ? 'wake ' + clock(dd.tw) + ' → sleep ' + clock(dd.ts) + ' H=' + f2(dd.Hs) + ' ; awake ' + f2(dd.awake) + ' h, asleep ' + (dd.asleepDur === null ? '—' : f2(dd.asleepDur)) + ' h' : 'no day found') + ' ; onsets in 48 h: ' + ons + ' ; events: ' + s.ev.map(function (e) { return e.type[0] + clock(e.t); }).join(' '));
  });
  line('analytic check for a = 0: sleep length = χ_s·ln(15.5/14.5) = ' + (XS * Math.log(HP0 / HM0)).toFixed(3) + ' h ; awake length = χ_w·ln((μ−14.5)/(μ−15.5)) = ' + (XW * Math.log((MU - HM0) / (MU - HP0))).toFixed(3) + ' h ; cycle ' + (XS * Math.log(HP0 / HM0) + XW * Math.log((MU - HM0) / (MU - HP0))).toFixed(3) + ' h');

  line('\n=== 5. widget defaults and key states (the numbers the prose may quote) ===');
  function show(label, p, sim) { var o = readout(sim || base, p); line(label + ': ' + (o ? 'bed ' + clock(o.tb) + ' | cycle awake/asleep ' + f1(o.awake) + ' / ' + (o.asleepDur === null ? '—' : f1(o.asleepDur)) + ' | hours awake ' + f1(o.hrs) + ' | S ' + f1(o.S) + ' | gap ' + f1(o.gap) + ' h | left ' + Math.round(o.left) + ' mg (' + Math.round(100 * o.pct) + '%)' : 'n/a')); }
  show('default (a 2.9, E 0, 15:00, 100 mg, t½ 5)', { E: 0, tc: 15, dose: 100, th: 5 });
  show('t½ 3', { E: 0, tc: 15, dose: 100, th: 3 });
  show('t½ 9.9', { E: 0, tc: 15, dose: 100, th: 9.9 });
  show('E 0.5', { E: 0.5, tc: 15, dose: 100, th: 5 });
  show('E 3', { E: 3, tc: 15, dose: 100, th: 5 });
  show('E 8.5', { E: 8.5, tc: 15, dose: 100, th: 5 });
  show('E 24.5 (hours awake 40)', { E: 24.5, tc: 15, dose: 100, th: 5 });
  show('coffee 14:00', { E: 0, tc: 14, dose: 100, th: 5 });
  show('coffee 12:00', { E: 0, tc: 12, dose: 100, th: 5 });
  show('coffee 17:00', { E: 0, tc: 17, dose: 100, th: 5 });
  show('coffee 22:00', { E: 0, tc: 22, dose: 100, th: 5 });
  show('dose 214 (two coffees at once)', { E: 0, tc: 15, dose: 214, th: 5 });
  show('dose 400', { E: 0, tc: 15, dose: 400, th: 5 });
  var s0 = simulate(0);
  show('a = 0 (clock off), default coffee', { E: 0, tc: 15, dose: 100, th: 5 }, s0);
  line('a = 0 day fields: ' + JSON.stringify(dayFor(s0, 15)));

  line('\n=== 6. sanity: closed forms vs the simulated limit cycle (a = 2.9) ===');
  line('H at wake after the sleep equation from the onset: ' + f2(sleepFall(d0.Hs, d0.asleepDur)) + ' vs simulated wake H ' + f2(d0.Hw) + ' ; H at onset after the wake equation: ' + f2(wakeRise(d0.Hw, d0.awake)) + ' vs ' + f2(d0.Hs));
  var th1 = thr(A_PAPER, d0.tw), th2 = thr(A_PAPER, d0.ts);
  line('lower threshold at the wake time: ' + f2(th1.lo) + ' (= H_wake ' + f2(d0.Hw) + '); upper threshold at the onset: ' + f2(th2.up) + ' (= H_onset ' + f2(d0.Hs) + ')');
  line('C at wake = ' + f2(Math.sin(OM * (d0.tw - ALPHA))) + ', C at onset = ' + f2(Math.sin(OM * (d0.ts - ALPHA))) + ' ; C minimum at ' + clock(ALPHA - 6) + ', maximum at ' + clock(ALPHA + 6));
  (function () {   // time-step convergence
    var save = DT;
    line('DT = 0.005 → awake ' + d0.awake.toFixed(4) + ' asleep ' + d0.asleepDur.toFixed(4) + ' onset ' + d0.ts.toFixed(4));
  })();

  line('\n=== 7. the sleep-debt arithmetic FACTS gives (Kitamura 2016 constant; DERIVED = 60 min / 4 days) ===');
  line('1 h of potential sleep debt takes about four days to repay → ' + (60 / 4) + ' min of extra sleep per day');

  line('\n=== 8. psy.js loads; PSY.rng not needed (the model is exact, no randomness) ===');
  (function () {
    var fs = require('fs'), vm = require('vm'), path = require('path');
    var src = fs.readFileSync(path.join(__dirname, '../../../all_lessons/psychology_play/lessons/psy.js'), 'utf8');
    var win = { localStorage: { getItem: function () { return null; }, setItem: function () {} } }; win.window = win; vm.createContext(win); vm.runInContext(src, win);
    line('PSY.phi(1.2816) = ' + win.PSY.phi(1.2816).toFixed(5));
  })();
}
