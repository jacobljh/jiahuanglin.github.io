// proto/09.js — lesson 09 learning: Rescorla–Wagner, three-phase experiment (A+ ; AX+ ; A- ).
// Rule (Rescorla & Wagner 1972; as in Sutton & Barto 2018 §14.2.2 / Rescorla 2008): for every cue present on a trial
//   ΔV_i = αβ (λ − ΣV),   ΣV = sum of V over the cues present,  λ = asymptote the outcome supports (1 present, 0 absent;
//   scaled up for a stronger outcome).  αβ is fitted per experiment — NO standard value exists in the sources read, so
//   the widget uses αβ = 0.2 as a labelled DEMO value (cap 0.5 so that two cues present stay monotone: 2·αβ ≤ 1).
// Everything printed here is a MODEL OUTPUT (associative strength V and error δ), not data.
function rw(o) {
  var ab = o.ab, n1 = o.n1, n2 = o.n2, n3 = o.n3, l2 = o.l2;
  var VA = 0, VX = 0, t = [], i, d;
  for (i = 0; i < n1; i++) { d = 1 - VA; VA += ab * d; t.push({ ph: 1, d: d, VA: VA, VX: VX, lam: 1 }); }
  for (i = 0; i < n2; i++) { d = l2 - (VA + VX); VA += ab * d; VX += ab * d; t.push({ ph: 2, d: d, VA: VA, VX: VX, lam: l2 }); }
  for (i = 0; i < n3; i++) { d = 0 - VA; VA += ab * d; t.push({ ph: 3, d: d, VA: VA, VX: VX, lam: 0 }); }
  return t;
}
function end(t, ph) { var r = null, i; for (i = 0; i < t.length; i++) if (t[i].ph === ph) r = t[i]; return r; }
function first(t, ph) { var i; for (i = 0; i < t.length; i++) if (t[i].ph === ph) return t[i]; return null; }
function f(x, k) { return x.toFixed(k === undefined ? 3 : k); }
if (require.main === module) {
  console.log('--- single cue V_n = 1-(1-ab)^n (FACTS DERIVED: ab .2 -> .200 .360 .672 .893 after 1,2,5,10)');
  [0.1, 0.2, 0.3, 0.5].forEach(function (ab) {
    var out = [], thr = { 50: 0, 90: 0, 95: 0, 99: 0 }, V = 0, n = 0, k;
    var t = rw({ ab: ab, n1: 60, n2: 0, n3: 0, l2: 1 });
    for (k in thr) { for (n = 0; n < t.length; n++) if (t[n].VA >= k / 100) { thr[k] = n + 1; break; } }
    console.log('ab', ab, 'V1,2,5,10', [1, 2, 5, 10].map(function (i) { return f(t[i - 1].VA); }).join(' '), 'trials to 50/90/95/99%', thr[50], thr[90], thr[95], thr[99]);
  });
  console.log('--- blocking: V_X at end of phase 2 (8 AX+ trials, lam 1) after n1 earlier A+ trials; FACTS: ab .2 -> .492 .082 .014 .002; ab .1 -> .416 .179 .077 .033');
  [0.2, 0.1].forEach(function (ab) {
    console.log('ab', ab, [0, 8, 16, 24].map(function (n1) { var t = rw({ ab: ab, n1: n1, n2: 8, n3: 0, l2: 1 }); return f(end(t, 2).VX); }).join(' '));
  });
  console.log('--- unblocking (ab .2, n1 16, n2 8): V_X for lam2 = 1, 2, 4  (FACTS: .014 .505 1.489)');
  [1, 2, 4].forEach(function (l2) { var t = rw({ ab: 0.2, n1: 16, n2: 8, n3: 0, l2: l2 }); console.log('lam2', l2, 'V_X', f(end(t, 2).VX), 'first AX error', f(first(t, 2).d)); });
  console.log('--- widget default: ab .2, n1 16, n2 8, lam2 1, n3 4');
  var t = rw({ ab: 0.2, n1: 16, n2: 8, n3: 4, l2: 1 });
  console.log('first outcome error', f(first(t, 1).d), ' V_A end ph1', f(end(t, 1).VA), ' first AX error', f(first(t, 2).d), ' V_X end ph2', f(end(t, 2).VX), ' V_A end ph2', f(end(t, 2).VA), ' first omission error', f(first(t, 3).d), ' V_A end ph3', f(end(t, 3).VA));
  console.log('--- presets');
  var P = { control: { ab: 0.2, n1: 0, n2: 8, n3: 4, l2: 1 }, unblock4: { ab: 0.2, n1: 16, n2: 8, n3: 4, l2: 4 }, unblock2: { ab: 0.2, n1: 16, n2: 8, n3: 4, l2: 2 }, slow: { ab: 0.05, n1: 16, n2: 8, n3: 4, l2: 1 }, nofx: { ab: 0.2, n1: 16, n2: 8, n3: 0, l2: 1 } };
  Object.keys(P).forEach(function (k) {
    var t = rw(P[k]);
    console.log(k, 'V_A ph1', f(end(t, 1) ? end(t, 1).VA : 0), 'first AX err', f(first(t, 2).d), 'V_X ph2', f(end(t, 2).VX), 'V_A ph2', f(end(t, 2).VA), 'omission err', first(t, 3) ? f(first(t, 3).d) : '-', 'V_A ph3', end(t, 3) ? f(end(t, 3).VA) : '-');
  });
  console.log('--- stability: 2 cues at ab .5: error factor (1-2ab) =', 1 - 2 * 0.5);
}
if (typeof module !== 'undefined') module.exports = { rw: rw };
