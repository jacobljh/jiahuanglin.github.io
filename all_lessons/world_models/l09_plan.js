/* l09_plan.js — planning at decision time on the maze of the Courtyard (World Models, lesson 09).
 *
 * Everything the lesson's widget computes lives here; the page script only draws and wires controls.
 *   world     task T5: a wall of 11 round posts at x = 4 with a gap above y = 3.95; goal disc at (7, 1) of radius 0.45; start near (1, 1)
 *   model     the planner's copy of that world; `fric` multiplies its friction (1 = exact, 1.15 = 15 % too much)
 *   plan      2H numbers: one impulse per step, clipped to |a| <= 0.6 m/s.  Its cost is J = 0.2 * sum_t d_t + 3 * d_H, d = distance to the goal in the model's rollout
 *   planners  random shooting (the best of N plans drawn from N(0, 0.3^2)) and the cross-entropy method (sample, keep the elite, refit the mean and spread, repeat)
 *   control   receding horizon: plan, run the first action in the TRUE world, look, plan again; or plan once and run the plan blind
 *   success   the ball is inside the goal disc and slower than 0.5 m/s ("docked") at some step within 160
 * Randomness: decision t of episode `seed` draws from L9.rng(1000 * seed + t + 1) (the Courtyard's generator), so any decision can be recomputed on its own.  Deterministic.
 * Needs courtyard.js (CY).  Node: module.exports.
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require !== 'undefined' ? require('./courtyard.js') : null);
var L9 = {};
/* Hot loops use these local names: a global lookup such as Math.sqrt costs microseconds inside the headless test harness (a sandboxed global object), a closure variable costs nothing. */
var sqrt = Math.sqrt, imul = Math.imul, exp = Math.exp, min = Math.min, max = Math.max;
var AMAX = 0.6, AMAX2 = AMAX * AMAX, T = 160, VSTOP = 0.5, SIG0 = 0.3, SIGMIN = 0.02, GOAL = { x: 7.0, y: 1.0, r: 0.45 }, GX = GOAL.x, GY = GOAL.y;
var POSTS = [], yy;
for (yy = 0.2; yy <= 3.75; yy += 0.35) POSTS.push({ x: 4.0, y: +yy.toFixed(2), r: 0.2 });
L9.AMAX = AMAX; L9.T = T; L9.VSTOP = VSTOP; L9.GOAL = GOAL; L9.POSTS = POSTS; L9.SIG0 = SIG0;
L9.CEM = { pop: 60, iters: 5, elite: 10 };                      // the planner of the lesson: 60 plans, 5 rounds, the best 10 kept
L9.BLIND = { pop: 300, iters: 8, elite: 30 };                   // the larger search a plan gets when it is made once and run blind

/* CY.rng, bit for bit (a test checks it), with imul as a local name */
L9.rng = function (seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = imul(t ^ (t >>> 15), t | 1);
    t ^= t + imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

L9.world = function (fric) { return CY.world({ curtain: null, posts: POSTS, goal: GOAL, gamma: 0.35 * (fric || 1) }); };

/* The Courtyard's step for this world, with the posts out of the way when the ball is nowhere near them (identical to CY.step, tested to the last bit). */
L9.stepper = function (w) {
  var n = w.sub, h = w.dt / n, damp = exp(-w.gamma * h), glide = (1 - damp) / w.gamma, R = w.r, W = w.W, Hh = w.H, e = w.e, eP = w.ePost, P = w.posts, np = P.length;
  var px = new Float64Array(np), py = new Float64Array(np), pr = new Float64Array(np), lo = Infinity, hi = -Infinity, out = new Float64Array(4), i;
  for (i = 0; i < np; i++) { px[i] = P[i].x; py[i] = P[i].y; pr[i] = P[i].r; lo = min(lo, px[i] - pr[i] - R); hi = max(hi, px[i] + pr[i] + R); }
  return function (x, y, vx, vy, ax, ay) {
    vx += ax; vy += ay;
    for (var i = 0; i < n; i++) {
      x += vx * glide; y += vy * glide; vx *= damp; vy *= damp;
      if (x < R) { x = 2 * R - x; vx = -e * vx; }
      if (x > W - R) { x = 2 * (W - R) - x; vx = -e * vx; }
      if (y < R) { y = 2 * R - y; vy = -e * vy; }
      if (y > Hh - R) { y = 2 * (Hh - R) - y; vy = -e * vy; }
      if (x > lo && x < hi) for (var p = 0; p < np; p++) {
        var dy = y - py[p], RR = R + pr[p];
        if (dy >= RR || dy <= -RR) continue;                    // too far above or below this post to touch it
        var dx = x - px[p], d = sqrt(dx * dx + dy * dy);
        if (d < RR && d > 1e-9) {
          var nx = dx / d, ny = dy / d; x = px[p] + nx * RR; y = py[p] + ny * RR;
          var vn = vx * nx + vy * ny;
          if (vn < 0) { vx -= (1 + eP) * vn * nx; vy -= (1 + eP) * vn * ny; }
        }
      }
    }
    out[0] = x; out[1] = y; out[2] = vx; out[3] = vy;
    return out;
  };
};
var STEPPERS = {};
L9.stepperFor = function (fric) { var k = String(fric || 1); return STEPPERS[k] || (STEPPERS[k] = L9.stepper(L9.world(fric))); };

/* N(0,1) draws: a table of 8192 Box-Muller variates (normalised to mean 0, variance 1), indexed by the seeded generator.  A plan has up to 200 numbers and a decision draws 300 plans:
 * exact Box-Muller on every draw would be half of the planner's time. */
var ZN = 8192, Z = new Float64Array(ZN);
(function () {
  var r = L9.rng(2718), i, u, rr, th, m = 0, v = 0;
  for (i = 0; i < ZN; i += 2) { u = 0; while (u === 0) u = r(); rr = sqrt(-2 * Math.log(u)); th = 2 * Math.PI * r(); Z[i] = rr * Math.cos(th); Z[i + 1] = rr * Math.sin(th); }
  for (i = 0; i < ZN; i++) m += Z[i] / ZN;
  for (i = 0; i < ZN; i++) v += (Z[i] - m) * (Z[i] - m) / ZN;
  for (i = 0; i < ZN; i++) Z[i] = (Z[i] - m) / sqrt(v);
})();
L9.gauss = function (rng) { return function () { return Z[(rng() * ZN) | 0]; }; };

/* the cost of a plan: roll the model H steps, add 0.2 times the distance to the goal at every step and 3 times the last one */
L9.cost = function (step, s0, v, H) {
  var x = s0[0], y = s0[1], vx = s0[2], vy = s0[3], c = 0, d = 0, t, ax, ay, n2, k, o;
  for (t = 0; t < H; t++) {
    ax = v[2 * t]; ay = v[2 * t + 1]; n2 = ax * ax + ay * ay;
    if (n2 > AMAX2) { k = AMAX / sqrt(n2); ax *= k; ay *= k; }
    o = step(x, y, vx, vy, ax, ay); x = o[0]; y = o[1]; vx = o[2]; vy = o[3];
    d = sqrt((x - GX) * (x - GX) + (y - GY) * (y - GY)); c += d;
  }
  return 0.2 * c + 3 * d;
};
/* the same cost with the distance measured AROUND the wall (hand-made shaping: it knows where the gap is) */
L9.geo = function (x, y) {
  var wx = 4.0, wy = 4.3, yc = y + (GY - y) * (4.0 - x) / (GX - x);
  if (x < 4.3 && !(x < 4.0 && yc >= 4.0)) return sqrt((x - wx) * (x - wx) + (y - wy) * (y - wy)) + sqrt((wx - GX) * (wx - GX) + (wy - GY) * (wy - GY));
  return sqrt((x - GX) * (x - GX) + (y - GY) * (y - GY));
};
L9.costShaped = function (step, s0, v, H) {
  var x = s0[0], y = s0[1], vx = s0[2], vy = s0[3], c = 0, d = 0, t, ax, ay, n2, k, o;
  for (t = 0; t < H; t++) {
    ax = v[2 * t]; ay = v[2 * t + 1]; n2 = ax * ax + ay * ay;
    if (n2 > AMAX2) { k = AMAX / sqrt(n2); ax *= k; ay *= k; }
    o = step(x, y, vx, vy, ax, ay); x = o[0]; y = o[1]; vx = o[2]; vy = o[3];
    d = L9.geo(x, y); c += d;
  }
  return 0.2 * c + 3 * d;
};

/* random shooting: draw N plans, keep the cheapest.  hist[i] is the best cost after i + 1 plans; keep = true also returns every plan */
L9.shoot = function (step, s0, H, N, gauss, cf, keep) {
  var d = 2 * H, v = new Float64Array(d), bestV = new Float64Array(d), best = Infinity, hist = new Float64Array(N), all = keep ? [] : null, i, j, c;
  cf = cf || L9.cost;
  for (i = 0; i < N; i++) {
    for (j = 0; j < d; j++) v[j] = SIG0 * gauss();
    c = cf(step, s0, v, H);
    if (c < best) { best = c; bestV.set(v); }
    hist[i] = best; if (keep) all.push(Float64Array.from(v));
  }
  return { v: bestV, cost: best, evals: N, hist: hist, plans: all };
};
/* the cross-entropy method: draw `pop` plans around (mu, sd), keep the `elite` cheapest, refit mu and sd to them, repeat.
 * hist[i] is the best cost after i + 1 plans; o.keepFirst also returns the plans of the first round */
L9.cem = function (step, s0, H, o, gauss, cf) {
  var pop = o.pop, iters = o.iters, el = o.elite, d = 2 * H, mu = new Float64Array(d), sd = new Float64Array(d).fill(SIG0), plans = [], cost = new Float64Array(pop), order = [];
  var best = Infinity, bestV = new Float64Array(d), hist = new Float64Array(pop * iters), first = null, it, i, j, k, m, s2, e;
  cf = cf || L9.cost;
  for (i = 0; i < pop; i++) { plans.push(new Float64Array(d)); order.push(i); }
  for (it = 0; it < iters; it++) {
    for (i = 0; i < pop; i++) {
      for (j = 0; j < d; j++) plans[i][j] = mu[j] + sd[j] * gauss();
      cost[i] = cf(step, s0, plans[i], H);
      hist[it * pop + i] = min(cost[i], it + i ? hist[it * pop + i - 1] : Infinity);
    }
    if (it === 0 && o.keepFirst) first = plans.map(function (p) { return Float64Array.from(p); });
    order.sort(function (a, b) { return cost[a] - cost[b] || a - b; });
    if (cost[order[0]] < best) { best = cost[order[0]]; bestV.set(plans[order[0]]); }
    for (j = 0; j < d; j++) {
      m = 0; for (k = 0; k < el; k++) m += plans[order[k]][j] / el;
      s2 = 0; for (k = 0; k < el; k++) { e = plans[order[k]][j] - m; s2 += e * e / el; }
      mu[j] = m; sd[j] = max(sqrt(s2), SIGMIN);
    }
  }
  return { v: bestV, cost: best, evals: pop * iters, mu: mu, sd: sd, plans: plans, costs: cost, order: order, hist: hist, first: first };
};

L9.clip = function (ax, ay) { var n2 = ax * ax + ay * ay, k; if (n2 > AMAX2) { k = AMAX / sqrt(n2); return [ax * k, ay * k]; } return [ax, ay]; };
L9.docked = function (x, y, vx, vy) { var dx = x - GX, dy = y - GY; return sqrt(dx * dx + dy * dy) < GOAL.r && sqrt(vx * vx + vy * vy) <= VSTOP; };
L9.start = function (seed) { var r = L9.rng(7000 + seed); return [1 + 0.2 * (r() - 0.5), 1 + 0.2 * (r() - 0.5), 0, 0]; };
L9.path = function (step, s0, v, H) {                           // positions along a plan (H + 1 points)
  var x = s0[0], y = s0[1], vx = s0[2], vy = s0[3], pts = [[x, y]], t, a, o;
  for (t = 0; t < H; t++) { a = L9.clip(v[2 * t], v[2 * t + 1]); o = step(x, y, vx, vy, a[0], a[1]); x = o[0]; y = o[1]; vx = o[2]; vy = o[3]; pts.push([x, y]); }
  return pts;
};
L9.imagineDock = function (step, s0, v, H) {                    // does the plan dock, according to this model?  Returns the step or -1
  var x = s0[0], y = s0[1], vx = s0[2], vy = s0[3], t, a, o;
  for (t = 0; t < H; t++) { a = L9.clip(v[2 * t], v[2 * t + 1]); o = step(x, y, vx, vy, a[0], a[1]); x = o[0]; y = o[1]; vx = o[2]; vy = o[3]; if (L9.docked(x, y, vx, vy)) return t + 1; }
  return -1;
};

/* Why a short horizon fails: from the start, 12 searches of 300 x 8 plans each; how many of the cheapest plans go round the wall (past x = 4.3)? */
L9.diagnose = function (fric, shaped, H) {
  var step = L9.stepperFor(fric), s0 = [1, 1, 0, 0], cf = shaped ? L9.costShaped : L9.cost, pass = 0, k, r, pts, i, xm;
  for (k = 0; k < 12; k++) {
    r = L9.cem(step, s0, H, L9.BLIND, L9.gauss(L9.rng(9000 + k)), cf); pts = L9.path(step, s0, r.v, H); xm = 0;
    for (i = 0; i < pts.length; i++) xm = max(xm, pts[i][0]);
    if (xm > 4.3) pass++;
  }
  return pass;
};

/* One decision: the plan the planner would make at state s on step t of episode `seed`.  c: {H, planner 'cem' | 'shoot', n (plans for shooting), fric, shaped}.
 * keep = true also returns the candidates (the plans of the first round of the cross-entropy method, or all of the shooting plans) for drawing. */
L9.decide = function (c, s, t, keep) {
  var model = L9.stepperFor(c.fric), gauss = L9.gauss(L9.rng(1000 * c.seed + t + 1)), cf = c.shaped ? L9.costShaped : L9.cost;
  return c.planner === 'shoot' ? L9.shoot(model, s, c.H, c.n || 300, gauss, cf, keep) : L9.cem(model, s, c.H, keep ? { pop: L9.CEM.pop, iters: L9.CEM.iters, elite: L9.CEM.elite, keepFirst: true } : L9.CEM, gauss, cf);
};

/* One episode in the true world.  c: as above plus mode 'mpc' (re-plan every step) or 'blind' (plan once, run H steps), seed.
 * Returns {docked, steps, states (T + 1 states at most), msteps (model steps spent), imagined (blind: the step at which the model said it would dock, or -1)}. */
L9.episode = function (c) {
  var real = L9.stepperFor(1), model = L9.stepperFor(c.fric), s = L9.start(c.seed), states = [s], msteps = 0, steps = -1, imagined = -1, t, r, a, o, lim;
  if (c.mode === 'blind') {
    r = L9.cem(model, s, c.H, L9.BLIND, L9.gauss(L9.rng(1000 * c.seed + 500)), c.shaped ? L9.costShaped : L9.cost); msteps = r.evals * c.H;
    imagined = L9.imagineDock(model, s, r.v, c.H); lim = c.H;
    for (t = 0; t < lim; t++) {
      a = L9.clip(r.v[2 * t], r.v[2 * t + 1]); o = real(s[0], s[1], s[2], s[3], a[0], a[1]); s = [o[0], o[1], o[2], o[3]]; states.push(s);
      if (L9.docked(s[0], s[1], s[2], s[3])) { steps = t + 1; break; }
    }
  } else {
    for (t = 0; t < T; t++) {
      r = L9.decide(c, s, t); msteps += r.evals * c.H;
      a = L9.clip(r.v[0], r.v[1]); o = real(s[0], s[1], s[2], s[3], a[0], a[1]); s = [o[0], o[1], o[2], o[3]]; states.push(s);
      if (L9.docked(s[0], s[1], s[2], s[3])) { steps = t + 1; break; }
    }
  }
  return { docked: steps > 0, steps: steps, states: states, msteps: msteps, imagined: imagined, plan: c.mode === 'blind' ? r.v : null };
};

root.L9 = L9;
if (typeof module !== 'undefined' && module.exports) module.exports = L9;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
