// proto/08.js — lesson 08 hardware: one leaky integrate-and-fire neuron, N plastic synapses, STDP, ATP ledger.
// Constants from FACTS_T3a §08 (Gerstner 2014 / OpenStax): V_rest -70, threshold -55, tau_m 10 ms, t_ref 2 ms,
// STDP window ~ +-20 ms (Bi & Poo 1998). Reset potential, EPSP size, STDP amplitudes, input rates = DEMO choices.
// Spike cost 2.4e9 ATP (Lennie 2003) ; sustainable average 0.16 spikes/s/neuron (Lennie 2003).
var PSY_RNG = function (seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

function sim(opt) {
  var NA = opt.NA, NB = opt.NB, N = NA + NB;
  var rate = opt.rate;               // Hz per presynaptic neuron
  var c = opt.c;                     // correlation parameter of group A (prob a shared event is copied)
  var rho = opt.rho;                 // A-/A+
  var wmax = opt.wmax, aplus = opt.aplus;
  var T = opt.T;                     // seconds simulated
  var rnd = PSY_RNG(opt.seed || 2026);
  var dt = 0.001, steps = Math.round(T / dt);
  var tau = 0.010, vrest = -70, thr = -55, reset = -70, tref = 0.002;
  var taup = 0.020, taum = 0.020;
  var w = [], x = [], i, k;
  for (i = 0; i < N; i++) { w.push(opt.w0 * wmax); x.push(0); }
  var y = 0, V = vrest, refl = 0;
  // shared events for group A: rate lamS, each A neuron copies a shared event with prob c ; independent rate chosen so total rate = rate
  var lamS = opt.lamS;               // shared event rate (Hz)
  var pInd = Math.max(0, (rate - lamS * c)) * dt;   // independent spike prob per step for A
  var pB = rate * dt;
  var snaps = [], spikesTotal = 0, spikesWin = 0, rateSnaps = [];
  var snapEvery = Math.round(1 / dt);  // 1 s
  var dpost = Math.exp(-dt / taum), dpre = Math.exp(-dt / taup), dv = Math.exp(-dt / tau);
  for (k = 0; k < steps; k++) {
    var shared = rnd() < lamS * dt;
    var drive = 0, pre = [];
    for (i = 0; i < N; i++) {
      var s = false;
      if (i < NA) { if (shared && rnd() < c) s = true; if (!s && rnd() < pInd) s = true; }
      else { if (rnd() < pB) s = true; }
      pre.push(s);
    }
    // decay traces
    y *= dpost;
    for (i = 0; i < N; i++) x[i] *= dpre;
    // presynaptic spikes: EPSP jump, depression by post trace, bump pre trace
    for (i = 0; i < N; i++) if (pre[i]) {
      drive += w[i];
      if (opt.stdp) { w[i] -= rho * aplus * wmax * y; if (w[i] < 0) w[i] = 0; }
      x[i] += 1;
    }
    // membrane
    if (refl > 0) { refl -= dt; V = reset; }
    else {
      V = vrest + (V - vrest) * dv + drive;
      if (V >= thr) {
        spikesTotal++; spikesWin++;
        V = reset; refl = tref;
        if (opt.stdp) for (i = 0; i < N; i++) { w[i] += aplus * wmax * x[i]; if (w[i] > wmax) w[i] = wmax; }
        y += 1;
      }
    }
    if ((k + 1) % snapEvery === 0) {
      var mA = 0, mB = 0;
      for (i = 0; i < NA; i++) mA += w[i];
      for (i = NA; i < N; i++) mB += w[i];
      snaps.push([mA / NA / wmax, NB ? mB / NB / wmax : 0]);
      rateSnaps.push(spikesWin); spikesWin = 0;
    }
  }
  return { w: w, snaps: snaps, rateSnaps: rateSnaps, spikes: spikesTotal, wmax: wmax };
}

function summary(r, label) {
  var n = r.snaps.length, f = r.snaps[0], l = r.snaps[n - 1];
  var r0 = (r.rateSnaps[0] + r.rateSnaps[1] + r.rateSnaps[2]) / 3, r1 = (r.rateSnaps[n - 1] + r.rateSnaps[n - 2] + r.rateSnaps[n - 3]) / 3;
  var tail = Math.min(10, n); var rt = 0; for (var i = n - tail; i < n; i++) rt += r.rateSnaps[i]; rt /= tail;
  console.log(label, 'A:', f[0].toFixed(2), '->', l[0].toFixed(2), ' B:', f[1].toFixed(2), '->', l[1].toFixed(2), ' rate first3s', r0.toFixed(1), 'last10s', rt.toFixed(1), 'Hz');
}

if (require.main === module) {
  var base = { NA: 20, NB: 20, rate: 15, c: 0.5, rho: 1.05, wmax: 1.0, aplus: 0.01, T: 120, seed: 2026, w0: 0.5, lamS: 5, stdp: true };
  function mk(o) { var b = {}, k; for (k in base) b[k] = base[k]; for (k in o) b[k] = o[k]; return b; }
  summary(sim(mk({ stdp: false })), 'no STDP         ');
  summary(sim(mk({})), 'default c.5 r1.05');
  summary(sim(mk({ rho: 0.9 })), 'rho .9           ');
  summary(sim(mk({ rho: 1.2 })), 'rho 1.2          ');
  summary(sim(mk({ c: 0 })), 'c 0             ');
  summary(sim(mk({ c: 1 })), 'c 1             ');
}
if (typeof module !== 'undefined') module.exports = { sim: sim, rng: PSY_RNG };
