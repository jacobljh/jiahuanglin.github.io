#!/usr/bin/env node
/* Oracle for World Models lesson 09, "Plan with it: search at decision time".
 *
 * The experiments are all on task T5, the maze of the Courtyard: a wall of 11 round posts at x = 4 with a gap above y = 3.9, a goal disc at (7, 1) of radius 0.45,
 * a ball that starts within 10 cm of (1, 1) at rest, one impulse |a| <= 0.6 m/s per step, 160 steps; an episode succeeds ("docks") when the ball is inside the goal disc
 * and slower than 0.5 m/s at some step.  A plan is 2H numbers; its cost is 0.2 * sum_t d_t + 3 * d_H (d = distance to the goal in the planner's own rollout).
 *
 * This oracle
 *   (1) re-implements the physics and both planners FROM THE LESSON'S SPECIFICATION (a different program structure from l09_plan.js: one flat candidate buffer, its own
 *       integrator, its own sampler table) and checks the integrator against CY.step bit for bit and the planner against the lesson's engine on whole episodes;
 *   (2) derives every number the prose quotes with that re-implementation: closed-loop success against the horizon for exact and wrong models, plans made once and run blind,
 *       random shooting against the cross-entropy method (plan quality for equal evaluations and in closed loop), the decision-level reason for the myopia
 *       (does the cheapest plan go round the wall?), the promise error of the planner's own plans (the trustworthy horizon of lesson 6, applied to plans),
 *       the hand-shaped cost and a PlaNet-sized search;
 *   (3) checks the closed forms of the lesson: the exact per-round contraction of the cross-entropy method on a quadratic bowl (chi-square quantile, Monte Carlo against it),
 *       the counting arguments, lesson 8's 83 % (re-measured with lesson 8's own engine);
 *   (4) drives the page's own widget into the states the prose describes and compares what it prints with (2).
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const T0 = Date.now();
const lap = m => process.stderr.write('  [' + ((Date.now() - T0) / 1000).toFixed(1) + ' s] ' + m + '\n');
const comma = n => n.toLocaleString('en-US');

/* ── 1. the specification, re-implemented ── */
const AM = 0.6, AM2 = AM * AM, TMAX = 160, VSTOP = 0.5, SG = 0.3, SGMIN = 0.02, GX = 7, GY = 1, GR = 0.45;
const POSTS = []; for (let y = 0.2; y <= 3.75; y += 0.35) POSTS.push([4.0, +y.toFixed(2), 0.2]);
ok('eleven posts', POSTS.length === 11, POSTS.length);

/* the integrator: the Courtyard's step for this world, written out (5 sub-steps of exact friction, walls, then the posts, which can only touch the ball when it is within reach of the wall) */
function makeStep(fric) {
  const gamma = 0.35 * fric, n = 5, h = 0.1 / n, damp = Math.exp(-gamma * h), glide = (1 - damp) / gamma, R = 0.1, WID = 8, HEI = 5, e = 0.9, eP = 0.95, out = new Float64Array(4), NP = POSTS.length;
  return function (x, y, vx, vy, ax, ay) {
    vx += ax; vy += ay;
    for (let i = 0; i < n; i++) {
      x += vx * glide; y += vy * glide; vx *= damp; vy *= damp;
      if (x < R) { x = 2 * R - x; vx = -e * vx; }
      if (x > WID - R) { x = 2 * (WID - R) - x; vx = -e * vx; }
      if (y < R) { y = 2 * R - y; vy = -e * vy; }
      if (y > HEI - R) { y = 2 * (HEI - R) - y; vy = -e * vy; }
      if (x > 3.69 && x < 4.31) for (let p = 0; p < NP; p++) {
        const P = POSTS[p], dx = x - P[0], dy = y - P[1], RR = R + P[2];
        if (dy >= RR || dy <= -RR) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < RR && d > 1e-9) {
          const nx = dx / d, ny = dy / d; x = P[0] + nx * RR; y = P[1] + ny * RR;
          const vn = vx * nx + vy * ny;
          if (vn < 0) { vx -= (1 + eP) * vn * nx; vy -= (1 + eP) * vn * ny; }
        }
      }
    }
    out[0] = x; out[1] = y; out[2] = vx; out[3] = vy;
    return out;
  };
}
const STEP = {}; const stepOf = f => STEP[f] || (STEP[f] = makeStep(f));
{ // bit for bit against the shared engine (no shortcut at all), for the three friction values the lesson uses
  for (const f of [1, 1.15, 3]) {
    const W = CY.world({ curtain: null, posts: POSTS.map(p => ({ x: p[0], y: p[1], r: p[2] })), goal: { x: GX, y: GY, r: GR }, gamma: 0.35 * f }), st = makeStep(f), rng = CY.rng(5); let worst = 0;
    for (let ep = 0; ep < 300; ep++) {
      let s = [0.5 + 7 * rng(), 0.5 + 4 * rng(), 4 * rng() - 2, 4 * rng() - 2], q = s.slice();
      for (let t = 0; t < 100; t++) { const a = [1.2 * (rng() - 0.5), 1.2 * (rng() - 0.5)]; s = CY.step(W, s, a); const o = st(q[0], q[1], q[2], q[3], a[0], a[1]); q = [o[0], o[1], o[2], o[3]]; for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(s[c] - q[c])); }
    }
    ok('integrator == CY.step to the last bit (friction x' + f + ', 30000 steps with posts and walls)', worst === 0, worst);
  }
}
/* N(0,1) draws: a table of 8192 Box-Muller variates normalised to mean 0, variance 1, indexed by the seeded generator */
const ZN = 8192, Z = new Float64Array(ZN);
{ const r = CY.rng(2718); let m = 0, v = 0;
  for (let i = 0; i < ZN; i += 2) { let u = 0; while (u === 0) u = r(); const rr = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * r(); Z[i] = rr * Math.cos(th); Z[i + 1] = rr * Math.sin(th); }
  for (let i = 0; i < ZN; i++) m += Z[i] / ZN;
  for (let i = 0; i < ZN; i++) v += (Z[i] - m) * (Z[i] - m) / ZN;
  for (let i = 0; i < ZN; i++) Z[i] = (Z[i] - m) / Math.sqrt(v);
  let m2 = 0, v2 = 0, mx = 0; for (let i = 0; i < ZN; i++) { m2 += Z[i] / ZN; v2 += Z[i] * Z[i] / ZN; mx = Math.max(mx, Math.abs(Z[i])); }
  ok('sampler table has mean 0 and variance 1', close(m2, 0, 1e-12) && close(v2, 1, 1e-12), [m2, v2]); ok('sampler table reaches 3.5 sigma', mx > 3.2, mx);
}
const gz = rng => Z[(rng() * ZN) | 0];

/* cost of a plan (buf[off .. off + 2H)) in the model, from state s0 */
function planCost(step, s0, buf, off, H, shaped) {
  let x = s0[0], y = s0[1], vx = s0[2], vy = s0[3], c = 0, d = 0;
  for (let t = 0; t < H; t++) {
    let ax = buf[off + 2 * t], ay = buf[off + 2 * t + 1]; const n2 = ax * ax + ay * ay;
    if (n2 > AM2) { const k = AM / Math.sqrt(n2); ax *= k; ay *= k; }
    const o = step(x, y, vx, vy, ax, ay); x = o[0]; y = o[1]; vx = o[2]; vy = o[3];
    d = shaped ? geo(x, y) : Math.sqrt((x - GX) * (x - GX) + (y - GY) * (y - GY)); c += d;
  }
  return 0.2 * c + 3 * d;
}
function geo(x, y) { // distance to the goal measured around the wall (the hand-made shaping): through the middle of the gap at (4.0, 4.3) when the straight line is blocked
  const yc = y + (GY - y) * (4.0 - x) / (GX - x);
  if (x < 4.3 && !(x < 4.0 && yc >= 4.0)) return Math.sqrt((x - 4) * (x - 4) + (y - 4.3) * (y - 4.3)) + Math.sqrt((4 - GX) * (4 - GX) + (4.3 - GY) * (4.3 - GY));
  return Math.sqrt((x - GX) * (x - GX) + (y - GY) * (y - GY));
}
function cemPlan(step, s0, H, pop, rounds, elite, rng, shaped) {
  const d = 2 * H, mu = new Float64Array(d), sd = new Float64Array(d).fill(SG), P = new Float64Array(pop * d), J = new Float64Array(pop), idx = [], bestV = new Float64Array(d);
  let best = Infinity;
  for (let i = 0; i < pop; i++) idx.push(i);
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < pop; i++) { for (let j = 0; j < d; j++) P[i * d + j] = mu[j] + sd[j] * gz(rng); J[i] = planCost(step, s0, P, i * d, H, shaped); }
    idx.sort((a, b) => J[a] - J[b] || a - b);
    if (J[idx[0]] < best) { best = J[idx[0]]; for (let j = 0; j < d; j++) bestV[j] = P[idx[0] * d + j]; }
    for (let j = 0; j < d; j++) {
      let m = 0; for (let k = 0; k < elite; k++) m += P[idx[k] * d + j] / elite;
      let s2 = 0; for (let k = 0; k < elite; k++) { const e = P[idx[k] * d + j] - m; s2 += e * e / elite; }
      mu[j] = m; sd[j] = Math.max(Math.sqrt(s2), SGMIN);
    }
  }
  return { v: bestV, cost: best };
}
function shootPlan(step, s0, H, N, rng, shaped) {
  const d = 2 * H, v = new Float64Array(d), bestV = new Float64Array(d); let best = Infinity;
  for (let i = 0; i < N; i++) { for (let j = 0; j < d; j++) v[j] = SG * gz(rng); const c = planCost(step, s0, v, 0, H, shaped); if (c < best) { best = c; bestV.set(v); } }
  return { v: bestV, cost: best };
}
const clip2 = (ax, ay) => { const n2 = ax * ax + ay * ay; if (n2 > AM2) { const k = AM / Math.sqrt(n2); return [ax * k, ay * k]; } return [ax, ay]; };
const isDocked = (x, y, vx, vy) => Math.sqrt((x - GX) * (x - GX) + (y - GY) * (y - GY)) < GR && Math.sqrt(vx * vx + vy * vy) <= VSTOP;
const startOf = seed => { const r = CY.rng(7000 + seed); return [1 + 0.2 * (r() - 0.5), 1 + 0.2 * (r() - 0.5), 0, 0]; };
function rollPath(step, s0, v, H) { let x = s0[0], y = s0[1], vx = s0[2], vy = s0[3]; const pts = [[x, y]]; for (let t = 0; t < H; t++) { const a = clip2(v[2 * t], v[2 * t + 1]); const o = step(x, y, vx, vy, a[0], a[1]); x = o[0]; y = o[1]; vx = o[2]; vy = o[3]; pts.push([x, y]); } return pts; }
function imagineDock(step, s0, v, H) { let x = s0[0], y = s0[1], vx = s0[2], vy = s0[3]; for (let t = 0; t < H; t++) { const a = clip2(v[2 * t], v[2 * t + 1]); const o = step(x, y, vx, vy, a[0], a[1]); x = o[0]; y = o[1]; vx = o[2]; vy = o[3]; if (isDocked(x, y, vx, vy)) return t + 1; } return -1; }
/* one episode; cfg {H, planner 'cem'|'shoot', n, fric, mode 'mpc'|'blind', seed, shaped} -> {docked, steps, states, imagined, plan, msteps} */
function episode(cfg) {
  const real = stepOf(1), model = stepOf(cfg.fric), shaped = !!cfg.shaped; let s = startOf(cfg.seed); const states = [s]; let steps = -1, imagined = -1, plan = null, ms = 0;
  if (cfg.mode === 'blind') {
    plan = cemPlan(model, s, cfg.H, 300, 8, 30, CY.rng(1000 * cfg.seed + 500), shaped).v; imagined = imagineDock(model, s, plan, cfg.H); ms = 300 * 8 * cfg.H;
    for (let t = 0; t < cfg.H; t++) { const a = clip2(plan[2 * t], plan[2 * t + 1]); const o = real(s[0], s[1], s[2], s[3], a[0], a[1]); s = [o[0], o[1], o[2], o[3]]; states.push(s); if (isDocked(s[0], s[1], s[2], s[3])) { steps = t + 1; break; } }
  } else {
    for (let t = 0; t < TMAX; t++) {
      const rng = CY.rng(1000 * cfg.seed + t + 1);
      const r = cfg.planner === 'shoot' ? shootPlan(model, s, cfg.H, cfg.n || 300, rng, shaped) : cemPlan(model, s, cfg.H, 60, 5, 10, rng, shaped); ms += 300 * cfg.H;
      const a = clip2(r.v[0], r.v[1]); const o = real(s[0], s[1], s[2], s[3], a[0], a[1]); s = [o[0], o[1], o[2], o[3]]; states.push(s);
      if (isDocked(s[0], s[1], s[2], s[3])) { steps = t + 1; break; }
    }
  }
  return { docked: steps > 0, steps, states, imagined, plan, msteps: ms };
}
function decide(cfg, s, t) { const rng = CY.rng(1000 * cfg.seed + t + 1); return cfg.planner === 'shoot' ? shootPlan(stepOf(cfg.fric), s, cfg.H, cfg.n || 300, rng, !!cfg.shaped) : cemPlan(stepOf(cfg.fric), s, cfg.H, 60, 5, 10, rng, !!cfg.shaped); }
const NEP = 20;
const MODELS = { e: 1, a: 1.15, b: 1.3, c: 3 };
const cache = {};
function runSet(model, H, extra) { // 20 episodes (seeds 0..19) of a closed-loop or blind setting -> {dock, steps (mean over dockings), imag (blind: episodes the model said would dock)}
  extra = extra || {}; const key = JSON.stringify([model, H, extra]); if (cache[key]) return cache[key];
  let dock = 0, st = 0, imag = 0;
  for (let e = 0; e < NEP; e++) { const r = episode(Object.assign({ H, planner: 'cem', fric: MODELS[model], mode: 'mpc', seed: e }, extra)); if (r.docked) { dock++; st += r.steps; } if (r.imagined > 0) imag++; }
  return (cache[key] = { dock, steps: dock ? st / dock : NaN, imag });
}

/* ── 2. the lesson's engine must agree with the specification, episode for episode ── */
const L9 = require(path.join(DIR, 'l09_plan.js'));
for (const c of [{ H: 60, planner: 'cem', fric: 1, mode: 'mpc', seed: 3 }, { H: 25, planner: 'cem', fric: 1.15, mode: 'mpc', seed: 4 }, { H: 60, planner: 'shoot', n: 300, fric: 1, mode: 'mpc', seed: 5 },
                 { H: 80, planner: 'cem', fric: 1.15, mode: 'blind', seed: 6 }, { H: 5, planner: 'cem', fric: 1, mode: 'mpc', seed: 7, shaped: true }, { H: 50, planner: 'cem', fric: 3, mode: 'mpc', seed: 8 }]) {
  const a = L9.episode(c), b = episode(c);
  ok('engine == specification: ' + JSON.stringify(c), a.docked === b.docked && a.steps === b.steps && a.msteps === b.msteps && a.states.length === b.states.length && a.states.every((s, i) => s.every((v, k) => v === b.states[i][k])), [a.steps, b.steps]);
}
{ let bad = 0; for (const sd of [1, 2718, 7003, 9005, 19159, 3500]) { const a = CY.rng(sd), b = L9.rng(sd); for (let i = 0; i < 2000; i++) if (a() !== b()) bad++; } ok('the engine\'s generator is the Courtyard\'s, bit for bit', bad === 0, bad); }
lap('engine == specification');

/* ── 3. the entry: lesson 8's search, re-measured with its own engine ── */
{ // for each of 60 launches draw 128 random nudges, keep the best penalised one, run it in the world; the goal is 1.5 m higher than the one the policy practised for
  const L8 = require(path.join(DIR, 'l08_imagine.js')), S = L8.launches(60, 5), base = new L8.Model(L8.makeLog(300, 1.2, 104), { seed: 552 }), G2 = { x: 6.6, y: 4.0, r: 0.5 };
  const sr = L8.search(base, S, G2, 128, 1, 77); facts.l8_search = 100 * sr.reHits; facts.l8_search_imag = 100 * sr.imHits; facts.l8_queries = 60 * 128;
  ok('lesson 8: the model searched afresh at the new goal beats 75 % in the world', facts.l8_search > 75, facts.l8_search);
  lap('lesson 8 search');
}
facts.posts_n = POSTS.length;
facts.gap_m = 5 - (3.7 + 0.2);                                   // free height above the top post (m)
facts.start_goal_m = Math.hypot(7 - 1, 0);                       // straight-line distance from the start to the goal (m)
facts.d_step = Math.exp(-0.35 * 0.1);                            // friction per step
facts.route_m = 2 * Math.hypot(3, 3.3);                          // start -> middle of the gap (4, 4.3) -> goal
{ // share of the route on which it is farther from the goal than the wall is (3.3 m): the cost sees the route as worse than the wall for most of its length
  const leg1 = Math.hypot(3, 3.3), leg2 = Math.hypot(3, 3.3), far = (leg1 + (leg2 - 3.3)) / (leg1 + leg2); facts.route_far_share = far; ok('the way round is farther from the goal than the wall for most of its length', far > 0.5, far);
}

/* ── 4. why a short horizon fails: the cheapest plan from the start, 12 searches of 2400 plans per horizon (exact model) ── */
const DH = [10, 12, 20, 25, 30, 35, 40, 45, 50, 60];
{
  const s0 = [1, 1, 0, 0], step = stepOf(1);
  for (const H of DH) {
    let pass = 0, dend = 0, xend = 0;
    for (let k = 0; k < 12; k++) {
      const r = cemPlan(step, s0, H, 300, 8, 30, CY.rng(9000 + k), false), pts = rollPath(step, s0, r.v, H); let xm = 0; for (const p of pts) xm = Math.max(xm, p[0]);
      if (xm > 4.3) pass++; const e = pts[H]; dend += Math.hypot(e[0] - GX, e[1] - GY) / 12; xend += e[0] / 12;
    }
    facts['diag_' + H] = pass; facts['diag_d_' + H] = dend; facts['diag_x_' + H] = xend;
  }
  ok('the cheapest plan goes round the wall for H >= 50 and never for H <= 30', facts.diag_30 === 0 && facts.diag_50 === 12 && facts.diag_60 === 12, [facts.diag_30, facts.diag_50, facts.diag_60]);
  ok('the cheapest plan at H = 12 and 25 runs at the wall', facts.diag_12 === 0 && facts.diag_25 === 0 && facts.diag_x_25 < 4.0, [facts.diag_12, facts.diag_25, facts.diag_x_25]);
  ok('the number of plans that go round never decreases with the horizon', DH.every((H, i, a) => i === 0 || facts['diag_' + H] >= facts['diag_' + a[i - 1]]), DH);
  ok('a short plan that runs at the wall ends 3.3 m from the goal', close(facts.diag_d_30, 3.3, 0.05), facts.diag_d_30);
  facts.top_dist = Math.hypot(GX - 4.0, GY - 4.3);                // distance from the middle of the gap to the goal
  lap('diagnostic');
}

/* ── 5. closed-loop success against the horizon (20 episodes per point) ── */
for (const H of [5, 12, 25, 35, 40, 45, 50, 60, 80, 100]) { const r = runSet('e', H); facts['dk_e_' + H] = r.dock; facts['st_e_' + H] = r.steps; }
ok('closed loop, exact model: nothing docks up to H = 25, a step between 35 and 50, then every episode', facts.dk_e_5 === 0 && facts.dk_e_12 === 0 && facts.dk_e_25 === 0 && facts.dk_e_35 < facts.dk_e_45 && facts.dk_e_45 < facts.dk_e_50 && facts.dk_e_50 < 20 && facts.dk_e_60 === 20 && facts.dk_e_80 === 20 && facts.dk_e_100 === 20, [facts.dk_e_35, facts.dk_e_45, facts.dk_e_50]);
lap('closed loop, exact model');
for (const H of [50, 60, 80, 100]) { const r = runSet('a', H); facts['dk_a_' + H] = r.dock; facts['st_a_' + H] = r.steps; }
lap('closed loop, friction x1.15');
{ const r = runSet('b', 60); facts.dk_b_60 = r.dock; facts.st_b_60 = r.steps; }
for (const H of [60, 80, 100, 130]) { const r = runSet('c', H); facts['dk_c_' + H] = r.dock; facts['st_c_' + H] = r.steps; }
ok('a friction x3 model needs H = 130 and fails at 60', facts.dk_c_60 === 0 && facts.dk_c_130 === 20 && facts.dk_c_80 < facts.dk_c_100 && facts.dk_c_100 < 20, [facts.dk_c_60, facts.dk_c_80, facts.dk_c_100, facts.dk_c_130]);
ok('re-planning repairs 15 % and 30 % too much friction at H >= 60', facts.dk_a_60 === 20 && facts.dk_a_80 === 20 && facts.dk_a_100 === 20 && facts.dk_b_60 === 20, [facts.dk_a_60, facts.dk_a_80, facts.dk_a_100, facts.dk_b_60]);
ok('15 % too much friction moves the step only a little (H = 50)', facts.dk_a_50 > 10 && facts.dk_a_50 <= facts.dk_e_50, [facts.dk_a_50, facts.dk_e_50]);
{ // no U-shaped curve in this lesson: a longer horizon never docked fewer episodes, for the exact model, the 15 % model and the x3 model (the grids the prose quotes)
  const mono = a => a.every((v, i) => i === 0 || v >= a[i - 1]);
  ok('closed-loop docks never fall as the horizon grows (exact: 5..100; x1.15: 50..100; x3: 60..130)',
     mono([5, 12, 25, 35, 40, 45, 50, 60, 80, 100].map(H => facts['dk_e_' + H])) && mono([50, 60, 80, 100].map(H => facts['dk_a_' + H])) && mono([60, 80, 100, 130].map(H => facts['dk_c_' + H])));
}
lap('closed loop, friction x1.3 and x3');
{ const r = runSet('e', 60, { planner: 'shoot', n: 300 }); facts.dk_sh300 = r.dock; facts.st_sh300 = r.steps; ok('random shooting (300 plans) docks in the loop, a little slower than CEM', r.dock >= 18 && r.steps > facts.st_e_60, [r.dock, r.steps, facts.st_e_60]); }
{ const r = runSet('e', 5, { shaped: true }); facts.dk_shaped_5 = r.dock; facts.st_shaped_5 = r.steps; }
{ const r = runSet('e', 12, { shaped: true }); facts.dk_shaped_12 = r.dock; facts.st_shaped_12 = r.steps; }
ok('a cost that knows the way round docks with 5 and 12 steps, faster than the plain cost at 60', facts.dk_shaped_5 === 20 && facts.dk_shaped_12 === 20 && facts.st_shaped_5 < facts.st_e_60 && facts.st_shaped_12 < facts.st_e_60, [facts.st_shaped_5, facts.st_shaped_12]);
lap('shooting and shaped cost');
for (const H of [80, 100]) for (const m of ['e', 'a']) { const r = runSet(m, H, { mode: 'blind' }); facts['bl_' + m + '_' + H] = r.dock; facts['bli_' + m + '_' + H] = r.imag; }
ok('a blind plan under the exact model keeps its promise and needs H near 100', facts.bl_e_100 === facts.bli_e_100 && facts.bl_e_80 === facts.bli_e_80 && facts.bl_e_80 <= 12 && facts.bl_e_100 >= 15, [facts.bl_e_80, facts.bl_e_100]);
ok('a blind plan under the 15 % model: the model promises more than the world delivers, by most of it at H = 100', facts.bli_a_80 > facts.bl_a_80 && facts.bli_a_100 >= 3 * facts.bl_a_100 && facts.bl_a_100 < facts.bl_e_100, [facts.bli_a_80, facts.bl_a_80, facts.bli_a_100, facts.bl_a_100]);
lap('blind plans');

/* ── 6. plan quality, equal evaluations (start state, H as stated; means over repeated searches) ── */
{
  const s0 = [1, 1, 0, 0], step = stepOf(1), mean = (R, f) => { let a = 0; for (let r = 0; r < R; r++) a += f(r) / R; return a; };
  for (const H of [3, 12, 25, 60]) {
    const c6k = mean(6, r => cemPlan(step, s0, H, 600, 10, 60, CY.rng(20000 + r), false).cost);
    const c300 = mean(6, r => cemPlan(step, s0, H, 60, 5, 10, CY.rng(20000 + r), false).cost);
    const s300 = mean(6, r => shootPlan(step, s0, H, 300, CY.rng(30000 + r), false).cost);
    facts['q_cem6k_' + H] = c6k; facts['q_cem300_' + H] = c300; facts['q_sh300_' + H] = s300; facts['ex_' + H] = 100 * (s300 / c6k - 1);
    if (H === 60) {
      facts.q_sh3k = mean(6, r => shootPlan(step, s0, H, 3000, CY.rng(30000 + r), false).cost);
      facts.q_sh30k = mean(6, r => shootPlan(step, s0, H, 30000, CY.rng(30000 + r), false).cost);
      facts.q_sh300k = mean(6, r => shootPlan(step, s0, H, 300000, CY.rng(30000 + r), false).cost);
      facts.cem300_excess_60 = 100 * (c300 / c6k - 1);
    }
  }
  ok('CEM with 6000 plans beats shooting with 300000 at H = 60', facts.q_cem6k_60 < facts.q_sh300k, [facts.q_cem6k_60, facts.q_sh300k]);
  ok('CEM with 300 plans beats shooting with 300 at H = 60', facts.q_cem300_60 < facts.q_sh300_60, [facts.q_cem300_60, facts.q_sh300_60]);
  ok('shooting improves with N at H = 60', facts.q_sh300_60 > facts.q_sh3k && facts.q_sh3k > facts.q_sh30k && facts.q_sh30k > facts.q_sh300k, [facts.q_sh300_60, facts.q_sh3k, facts.q_sh30k, facts.q_sh300k]);
  ok('shooting at 300 plans is close to CEM at H = 3 and far at H = 60', facts.ex_3 < 5 && facts.ex_60 > 50, [facts.ex_3, facts.ex_60]);
  { // how thin is the set of good plans?  Of N random plans (shooting's own sampler), how many cost within 10 % of the cheapest plan found (the 6000-plan search above)?
    const N = 20000; facts.thin_n = N;
    for (const H of [3, 12, 25, 60]) {
      const rg = CY.rng(41000 + H), d = 2 * H, v = new Float64Array(d), lim = 1.1 * facts['q_cem6k_' + H]; let n10 = 0;
      for (let i = 0; i < N; i++) { for (let j = 0; j < d; j++) v[j] = SG * gz(rg); if (planCost(step, s0, v, 0, H, false) <= lim) n10++; }
      facts['thin_' + H] = n10;
    }
    ok('the set of good plans is a sliver: most random plans are near the cheapest at H = 3, a handful at H = 12 (the cheapest plan needs full thrust all the way), more at 25 (time to stop at the wall), none at 60',
       facts.thin_3 > 0.9 * N && facts.thin_12 < 0.001 * N && facts.thin_25 > facts.thin_12 && facts.thin_25 < 0.02 * N && facts.thin_60 === 0, [facts.thin_3, facts.thin_12, facts.thin_25, facts.thin_60]);
  }
  // PlaNet-sized search at H = 12: 1000 plans, 10 rounds, 100 elites; does the cheapest plan go round the wall?
  let pass = 0; for (let k = 0; k < 12; k++) { const r = cemPlan(step, s0, 12, 1000, 10, 100, CY.rng(9000 + k), false), pts = rollPath(step, s0, r.v, 12); let xm = 0; for (const p of pts) xm = Math.max(xm, p[0]); if (xm > 4.3) pass++; }
  facts.planet_pass = pass; ok('a PlaNet-sized search at H = 12 never goes round the wall', pass === 0, pass);
  facts.msteps_60 = 300 * 60; facts.msteps_12 = 300 * 12; facts.planet_msteps = 1000 * 10 * 12;
  lap('plan quality, PlaNet-sized search');
}

/* ── 7. the promise error of the planner's own plans (the model's imagined path against what the plan does in the world) ── */
{
  const KS = [1, 5, 12, 25, 40, 60], H = 60, real = stepOf(1);
  for (const m of ['a', 'b']) {
    const per = []; // per-decision error curves, to take medians at every k
    for (let e = 0; e < NEP; e++) {
      const c = { H, planner: 'cem', fric: MODELS[m], mode: 'mpc', seed: e }, r = episode(c);
      for (let t = 0; t < r.states.length - 1; t += 5) { const s = r.states[t], d = decide(c, s, t), im = rollPath(stepOf(MODELS[m]), s, d.v, H), re = rollPath(real, s, d.v, H); per.push(im.map((p, k) => Math.hypot(p[0] - re[k][0], p[1] - re[k][1]))); }
    }
    const med = k => { const a = per.map(x => x[k]).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
    for (const k of KS) facts['pe_' + m + '_' + k] = med(k);
    let k5 = -1, k45 = -1; for (let k = 0; k <= H; k++) { const v = med(k); if (k5 < 0 && v > 0.05) k5 = k; if (k45 < 0 && v > GR) k45 = k; }
    facts['tau5_' + m] = k5; facts['tau45_' + m] = k45; facts['pe_n_' + m] = per.length;
    ok('promise error grows with the number of steps (friction model ' + m + ')', med(1) < med(5) && med(5) < med(12) && med(12) < med(25) && med(25) < med(40) && med(40) < med(60), KS.map(k => med(k)));
  }
  ok('the loop docks at H = 60, beyond the trustworthy horizon at the goal radius', facts.tau45_a < 60 && facts.tau45_b < 60 && facts.dk_a_60 === 20 && facts.dk_b_60 === 20, [facts.tau45_a, facts.tau45_b]);
  facts.promise_share = 100 * facts.tau5_a / 1000;                // the share of a 1000-step plan over which the model's promise (5 cm) holds
  lap('promise error');
}

/* ── 8. closed forms ── */
// 8a. the cross-entropy round on a quadratic bowl: the per-coordinate variance left in the elite fraction rho of N(0, I_d), exactly, by the chi-square law
function lgamma(x) { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const cj of c) s += cj / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
function gammaP(a, x) { // regularised lower incomplete gamma P(a, x)
  if (x <= 0) return 0;
  if (x < a + 1) { let ap = a, sum = 1 / a, del = sum; for (let n = 0; n < 5000; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; } return sum * Math.exp(-x + a * Math.log(x) - lgamma(a)); }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d; for (let i = 1; i < 5000; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-15) break; }
  return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
function chi2Quantile(d, rho) { let lo = 0, hi = d + 40 * Math.sqrt(2 * d) + 50; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (gammaP(d / 2, mid / 2) < rho) lo = mid; else hi = mid; } return (lo + hi) / 2; }
const RHO = 10 / 60;
function varLeft(d) { const q = chi2Quantile(d, RHO); return gammaP((d + 2) / 2, q / 2) / RHO; }  // E[z_1^2 | |z|^2 <= q]
ok('gamma function check: P(1, x) = 1 - exp(-x)', close(gammaP(1, 0.7), 1 - Math.exp(-0.7), 1e-12));
ok('chi-square check: d = 2 quantile is -2 ln(1 - rho)', close(chi2Quantile(2, RHO), -2 * Math.log(1 - RHO), 1e-9), [chi2Quantile(2, RHO), -2 * Math.log(1 - RHO)]);
for (const d of [2, 24, 120, 2000]) { facts['cv_' + d] = Math.sqrt(varLeft(d)); }
facts.cv5_120 = Math.pow(facts.cv_120, 5); facts.cv5_2000 = Math.pow(facts.cv_2000, 5); facts.cv5_2 = Math.pow(facts.cv_2, 5); facts.cv5_24 = Math.pow(facts.cv_24, 5); facts.cv5_2000_pct = 100 * facts.cv5_2000;
for (const d of [24, 120, 2000]) { const raw = Math.log(0.3 / 0.03) / -Math.log(facts['cv_' + d]); facts['ck_rounds_' + d + '_raw'] = raw; facts['ck_rounds_' + d] = Math.ceil(raw); }
facts.rounds_2000_raw = facts.ck_rounds_2000_raw;
ok('the large-d law: the per-round factor is about 1 - 1.06 / sqrt(d)', close(facts.cv_2000, 1 - 1.06 / Math.sqrt(2000), 0.001) && close(Math.sqrt(varLeft(20000)), 1 - 1.06 / Math.sqrt(20000), 0.0005), [facts.cv_2000, 1 - 1.06 / Math.sqrt(2000)]);
{ // Monte Carlo of the same quantity: draw N(0, I_d), keep the 1/6 with the smallest |z|^2, the mean squared coordinate of the kept ones
  const rng = CY.rng(61);
  for (const [d, n] of [[2, 200000], [24, 100000], [120, 40000], [2000, 6000]]) {
    const r2 = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < d; j++) { const z = CY.randn(rng); s += z * z; } r2[i] = s; }
    const sorted = Float64Array.from(r2).sort(); const k = Math.round(n * RHO); let acc = 0; for (let i = 0; i < k; i++) acc += sorted[i]; const mc = acc / (k * d), ex = varLeft(d);
    ok('contraction of a CEM round on a bowl, Monte Carlo against the chi-square formula (d = ' + d + ')', Math.abs(mc / ex - 1) < 0.02, [mc, ex]);
  }
  lap('contraction law');
}
// 8b. one CEM round (6000 draws, 1000 elite) on a 24-dimensional bowl shrinks its spread by the predicted factor
{
  const d = 24, rng = CY.rng(77); const pop = 6000, el = 1000; let s2 = 0;
  const pts = []; for (let i = 0; i < pop; i++) { const z = new Float64Array(d); let r2 = 0; for (let j = 0; j < d; j++) { z[j] = CY.randn(rng); r2 += z[j] * z[j]; } pts.push([r2, z]); }
  pts.sort((a, b) => a[0] - b[0]); for (let k = 0; k < el; k++) for (let j = 0; j < d; j++) s2 += pts[k][1][j] * pts[k][1][j] / (el * d);
  ok('one CEM round (6000 draws, 1000 elite) on a 24-dimensional bowl: spread factor', close(Math.sqrt(s2), facts.cv_24, 0.01), [Math.sqrt(s2), facts.cv_24]);
}
// 8c. counting: plans with two values per number, and the tree of b actions to depth d
const mant = x => +(x / Math.pow(10, Math.floor(Math.log10(x)))).toFixed(12), expo = x => Math.floor(Math.log10(x));
facts.box_3 = Math.pow(2, 6); facts.box_12 = Math.pow(2, 24); facts.box_60 = Math.pow(2, 120); facts.box_60_m = mant(facts.box_60); facts.box_60_e = expo(facts.box_60);
facts.tree8_5 = Math.pow(8, 5); facts.tree8_10 = Math.pow(8, 10); facts.tree8_20 = Math.pow(8, 20); facts.tree8_40 = Math.pow(8, 40);
facts.tree8_20_m = mant(facts.tree8_20); facts.tree8_20_e = expo(facts.tree8_20); facts.tree8_40_m = mant(facts.tree8_40); facts.tree8_40_e = expo(facts.tree8_40);
ok('8^40 = 2^120', facts.tree8_40 === facts.box_60 && facts.tree8_40_e === facts.box_60_e);
facts.tree_frac5 = 100 * 800 / facts.tree8_5; { const f = 800 / facts.tree8_10; facts.tree_frac10_m = mant(f); facts.tree_frac10_e = -expo(f); }
// 8d. the model-step bill, and the price of a real model
{ const r = L9.episode({ H: 60, planner: 'cem', fric: 1, mode: 'mpc', seed: 0 }), q = episode({ H: 60, planner: 'cem', fric: 1, mode: 'mpc', seed: 0 });
  facts.msteps_ep_60 = q.msteps; facts.dec_ep_60 = q.states.length - 1; ok('model steps counted = plans x horizon x decisions', q.msteps === 300 * 60 * (q.states.length - 1) && r.msteps === q.msteps, [r.msteps, q.msteps]); }
facts.vj_evals = 800 * 10; facts.vj_hours = 1000 * 16 / 3600;     // V-JEPA 2-AC: 800 samples, 10 refinements, 16 s per action; 1000 actions
lap('closed forms');

/* ── 9. the states the prose describes, computed independently (for the widget) ── */
const E0 = episode({ H: 60, planner: 'cem', fric: 1, mode: 'mpc', seed: 0 });
facts.ep0_steps = E0.steps;
{ const d0 = decide({ H: 60, planner: 'cem', fric: 1, seed: 0 }, E0.states[0], 0), s0 = decide({ H: 60, planner: 'shoot', n: 300, fric: 1, seed: 0 }, E0.states[0], 0); facts.ep0_J = d0.cost; facts.ep0_q_cem = d0.cost; facts.ep0_q_sh = s0.cost; }
{ const E12 = episode({ H: 12, planner: 'cem', fric: 1, mode: 'mpc', seed: 0 }); let near = 1e9; for (const s of E12.states) near = Math.min(near, Math.hypot(s[0] - GX, s[1] - GY)); facts.ep12_near = near; ok('the H = 12 episode does not dock', !E12.docked); }
{ const c = { H: 80, planner: 'cem', fric: 1.15, mode: 'blind', seed: 0 }, B = episode(c), im = rollPath(stepOf(1.15), B.states[0], B.plan, 80), re = rollPath(stepOf(1), B.states[0], B.plan, 80); let k45 = -1;
  for (let k = 0; k <= 80; k++) if (k45 < 0 && Math.hypot(im[k][0] - re[k][0], im[k][1] - re[k][1]) > GR) k45 = k; facts.ep0_blind_tau45 = k45; }
ok('episode 0 at H = 60 docks', E0.docked, E0.steps);

/* ── 10. the page's own widget ── */
const PAGE = path.join(DIR, '09_planning_mpc_muzero.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
if (HAVE_PAGE) {
  const page = loadPage(PAGE, { dpr: 1 });
  ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
  const HS = [3, 5, 8, 12, 18, 25, 30, 35, 40, 45, 50, 60, 80, 100, 130], MODSEL = { e: '1', a: '1.15', b: '1.3', c: '3' };
  const setup = (H, model, pl, mode, cost, ep, t) => { page.set('w09-h', HS.indexOf(H)); page.set('w09-mod', MODSEL[model]); page.set('w09-pl', pl); page.set('w09-mode', mode); page.set('w09-cost', cost); page.set('w09-ep', ep || 0); page.set('w09-t', t || 0); };
  const want = (id, txt) => ok('widget ' + id + ' reads ' + JSON.stringify(txt), page.text(id) === txt, page.text(id));
  const r1 = x => x.toFixed(1);
  const r20 = (d, st, mode, im) => d + ' of 20 docked' + (mode === 'blind' ? ' · model promised ' + im : (d ? ' · mean ' + st.toFixed(1) + ' steps' : ''));
  // the default state: H = 60, exact model, cross-entropy, re-plan, straight distance, episode 0, decision 0
  setup(60, 'e', 'cem', 'mpc', 'dist');
  want('w09-h-v', 'H = 60 (120 numbers)'); want('w09-res', facts.ep0_steps + ' steps'); want('w09-q', r1(facts.ep0_q_cem) + ' / ' + r1(facts.ep0_q_sh)); want('w09-pass', 'yes');
  want('w09-ms', comma(300 * 60)); want('w09-mse', comma(facts.msteps_ep_60)); want('w09-tau', 'no error'); want('w09-t-v', 'decision 0 of ' + facts.dec_ep_60);
  { // a later decision: the plan the oracle's planner makes at the oracle's state
    const t = 17, s = E0.states[t], d = decide({ H: 60, planner: 'cem', fric: 1, seed: 0 }, s, t), q = decide({ H: 60, planner: 'shoot', n: 300, fric: 1, seed: 0 }, s, t);
    page.set('w09-t', t); want('w09-q', r1(d.cost) + ' / ' + r1(q.cost)); want('w09-t-v', 'decision 17 of ' + facts.dec_ep_60); }
  // H = 12: the ball parks at the wall; the sweep over horizons
  setup(12, 'e', 'cem', 'mpc', 'dist'); want('w09-res', 'not docked'); want('w09-near', facts.ep12_near.toFixed(2) + ' m'); want('w09-diag', facts.diag_12 + ' of 12');
  for (const H of [30, 35, 40, 45, 50, 60]) { page.set('w09-h', HS.indexOf(H)); want('w09-diag', facts['diag_' + H] + ' of 12'); }
  // 20 episodes, closed loop, exact model
  for (const H of [5, 12, 25, 35, 40, 45, 50, 60, 80, 100]) { setup(H, 'e', 'cem', 'mpc', 'dist'); want('w09-r20', '— (press the button)'); page.click('w09-run'); want('w09-r20', r20(facts['dk_e_' + H], facts['st_e_' + H], 'mpc')); }
  setup(60, 'e', 'shoot', 'mpc', 'dist'); page.click('w09-run'); want('w09-r20', r20(facts.dk_sh300, facts.st_sh300, 'mpc'));
  for (const H of [50, 60, 80, 100]) { setup(H, 'a', 'cem', 'mpc', 'dist'); page.click('w09-run'); want('w09-r20', r20(facts['dk_a_' + H], facts['st_a_' + H], 'mpc')); }
  setup(60, 'b', 'cem', 'mpc', 'dist'); page.click('w09-run'); want('w09-r20', r20(facts.dk_b_60, facts.st_b_60, 'mpc'));
  for (const H of [60, 80, 100, 130]) { setup(H, 'c', 'cem', 'mpc', 'dist'); page.click('w09-run'); want('w09-r20', r20(facts['dk_c_' + H], facts['st_c_' + H], 'mpc')); }
  for (const H of [5, 12]) { setup(H, 'e', 'cem', 'mpc', 'shaped'); page.click('w09-run'); want('w09-r20', r20(facts['dk_shaped_' + H], facts['st_shaped_' + H], 'mpc')); }
  // plans made once and run blind
  for (const H of [80, 100]) for (const m of ['e', 'a']) { setup(H, m, 'cem', 'blind', 'dist'); page.click('w09-run'); want('w09-r20', r20(facts['bl_' + m + '_' + H], 0, 'blind', facts['bli_' + m + '_' + H])); }
  // the promise error at the start of the blind plan (15 % too much friction, H = 80, episode 0): first crossing of 5 cm and of the goal radius
  setup(80, 'a', 'cem', 'blind', 'dist');
  { const c = { H: 80, planner: 'cem', fric: 1.15, mode: 'blind', seed: 0 }, B = episode(c), im = rollPath(stepOf(1.15), B.states[0], B.plan, 80), re = rollPath(stepOf(1), B.states[0], B.plan, 80); let k5 = -1, k45 = -1;
    for (let k = 0; k <= 80; k++) { const e = Math.hypot(im[k][0] - re[k][0], im[k][1] - re[k][1]); if (k5 < 0 && e > 0.05) k5 = k; if (k45 < 0 && e > GR) k45 = k; }
    want('w09-tau', k5 + ' / ' + k45 + ' steps'); ok('the blind plan\'s promise error crosses the goal radius at the step the prose quotes', k45 === facts.ep0_blind_tau45, [k45, facts.ep0_blind_tau45]); }
  ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
  lap('widget');
}
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
