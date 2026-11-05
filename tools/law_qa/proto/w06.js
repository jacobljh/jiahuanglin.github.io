// w06.js — prototype of the lesson-06 widget "谁来为预防出钱" (run: node tools/law_qa/proto/w06.js)
// Re-derivation of the BIBLE §5 spec (b=20, L=100, p0=0.5).
'use strict';
function model(P) {
  var L = P.L, p0 = P.p0, b = P.b, r = P.r;
  function p(x) { return p0 / (1 + x); }
  function u(x) { return x + p(x) * L; }               // per-unit social cost
  var xs = Math.max(0, Math.sqrt(p0 * L) - 1);          // argmin u : 1 = p0 L/(1+x)^2
  var us = u(xs);
  function B(a) { return b * a - a * a / 2; }
  function W(a, x) { return B(a) - a * u(x); }          // social welfare of (a, x)
  // none: injurer bears nothing -> x=0, a=b
  var none = { x: 0, a: b };
  // strict: injurer bears u(x) -> x*, a = max(0, b-u*)
  var strict = { x: xs, a: Math.max(0, b - us) };
  // negligence with court standard xd = r * x*
  var xd = r * xs;
  // Injurer's per-unit cost: comply -> xd (no liability); breach with x<xd -> pays u(x) (all loss).
  // best breach cost = min_{x<xd} u(x) = u(min(xd, xs)); comply iff xd <= that (tie -> comply)
  var breachCost = (xd <= xs) ? u(xd) : us;
  var comply = xd <= breachCost + 1e-12;
  var neg;
  if (comply) neg = { x: xd, a: Math.max(0, b - xd), comply: true };
  else neg = { x: xs, a: Math.max(0, b - us), comply: false };
  [none, neg, strict].forEach(function (s) {
    s.acc = s.a * p(s.x); s.W = W(s.a, s.x); s.care = s.a * s.x; s.loss = s.a * p(s.x) * L;
  });
  // victims' uncompensated loss: none -> all; negligence (complied) -> all residual; strict -> 0; negligent-breacher pays
  none.victim = none.loss; neg.victim = neg.comply ? neg.loss : 0; strict.victim = 0;
  return { xs: xs, us: us, none: none, neg: neg, strict: strict, xd: xd, comply: comply, u: u, p: p };
}
function show(tag, P) {
  var m = model(P);
  function f(x, d) { return x.toFixed(d === undefined ? 2 : d); }
  console.log(tag + '  x*=' + f(m.xs) + ' u*=' + f(m.us) + ' a*=' + f(m.strict.a) + ' W*=' + f(m.strict.W) +
    ' | none a=' + f(m.none.a) + ' acc=' + f(m.none.acc) + ' W=' + f(m.none.W) +
    ' | neg xd=' + f(m.xd) + (m.neg.comply ? '' : '(BREACH)') + ' a=' + f(m.neg.a) + ' acc=' + f(m.neg.acc) + ' W=' + f(m.neg.W) + ' victim=' + f(m.neg.victim) +
    ' | strict acc=' + f(m.strict.acc));
  return m;
}
var D = { L: 100, p0: 0.5, b: 20, r: 1 };
show('default            ', D);
[0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.1, 2.16, 2.17, 2.5].forEach(function (r) { show('r=' + r + '      '.slice(String(r).length), { L: 100, p0: 0.5, b: 20, r: r }); });
console.log('--- other parameters');
show('b=40               ', { L: 100, p0: 0.5, b: 40, r: 1 });
show('b=10               ', { L: 100, p0: 0.5, b: 10, r: 1 });
show('L=300              ', { L: 300, p0: 0.5, b: 20, r: 1 });
show('L=20 p0=0.1        ', { L: 20, p0: 0.1, b: 20, r: 1 });
show('L=300 p0=0.8 b=10  ', { L: 300, p0: 0.8, b: 10, r: 1 });
// closed forms
var xs = Math.sqrt(50) - 1, us = 2 * Math.sqrt(50) - 1, as = 20 - us;
console.log('closed form: x*=' + xs.toFixed(4) + ' u*=' + us.toFixed(4) + ' a*=' + as.toFixed(4) + ' W*=(b-u*)^2/2=' + ((20 - us) * (20 - us) / 2).toFixed(4));
// negligence at xd=x*: a=b-x*, W = B(a)-a u*
var aN = 20 - xs; console.log('neg: a=' + aN.toFixed(4) + ' W=' + (20 * aN - aN * aN / 2 - aN * us).toFixed(4) + ' accidents=' + (aN * 0.5 / (1 + xs)).toFixed(4) + ' vs ' + (as * 0.5 / (1 + xs)).toFixed(4));
// second-best standard (negligence): scan r
var best = { r: 0, W: -1e9 };
for (var r = 0; r <= 2.1; r += 0.005) { var m = model({ L: 100, p0: 0.5, b: 20, r: r }); if (m.neg.W > best.W) { best = { r: r, W: m.neg.W, xd: m.xd }; } }
console.log('second-best negligence standard (complying region): r=' + best.r.toFixed(3) + ' xd=' + best.xd.toFixed(3) + ' W=' + best.W.toFixed(3));
// judgment-proof illustration for the §7 prose: injurer's assets w cap the liability at w per accident? (illustrative)
[100, 50, 10, 2].forEach(function (w) { console.log('liability cap ' + w + ' -> effective loss -> x=' + (Math.sqrt(0.5 * w) - 1).toFixed(3)); });
