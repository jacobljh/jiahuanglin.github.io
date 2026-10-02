/* l07_causal.js — private engine of World Models lesson 07, "What does my action cause?".  Global CA; needs courtyard.js (CY) loaded first.
 *
 * Everything the lesson's widget computes and draws lives here (CA.paint); the page script only wires the controls.
 *   the log      N episodes of the Courtyard on the x axis.  A hidden wind w ~ N(0, SW^2) blows along x for the whole episode; the ball also gets a small velocity kick
 *                (SV) every step.  The ball is launched and WATCHED for k steps with no nudge, then it gets one nudge a along x, and the log records y = how far the
 *                ball moves in the next TAU = 20 steps (2 s).  Every episode keeps its own wind and its own kick sequence, so the SAME episode can be re-run with another
 *                nudge: that is a counterfactual, available to a simulator and never to a real log.
 *   the law      without walls  y = B (v + a) + C w + kicks,  v = the ball's velocity at the nudge; B and C are read off the simulator (unit nudge, unit wind).
 *   the operator feels w and nudges against it: a = -kappa w + sigma_eps e, kappa = C / B (it cancels the wind in expectation); a "coin" ignores the wind: a = sigma_eps e.
 *                e is one fixed draw per episode, so moving sigma_eps re-scales the SAME log.
 *   the models   least squares of y on [1, v, a] (+ the filter's belief about w, + w itself), fitted by partialling the nudge out (Frisch-Waugh) and checked
 *                against the closed form  beta_hat = B - C kappa V / (kappa^2 V + sigma_eps^2),  V = what the model's inputs leave unexplained of the wind.
 *   the belief   the nudge-free watch phase gives increments u = v' - d v = c w + kick: Gaussian fusion (precisions add) = the filter of lesson 2 with the wind as its state.
 *   the exams    see-error (fresh episodes from the SAME process) and do-error (fresh episodes whose nudge is set by fiat, independent of the wind).
 *   experiment B a deterministic slice: the ball at NOM, response f(a) of the 2 s displacement to a nudge a (the right wall folds it back for a > 1.39), a bootstrap ensemble
 *                of small MLPs fitted to nudges in [-R, R], and two ways to spend more nudges: at random, or where the members disagree (CA.fork starts a run from the base
 *                log, CA.more spends one more batch and refits, so a click on the page costs one batch, not the whole history).
 * Deterministic: seeded generators only.  Node: module.exports.
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require !== 'undefined' ? require('./courtyard.js') : null);
var CA = {};
CA.SW = 0.3; CA.SV = 0.03; CA.TAU = 20; CA.KMAX = 16; CA.AMAX = 3;
CA.W = CY.world({ curtain: null, sigV: CA.SV });                    // the world of experiment A (the wind is set per episode)
CA.W0 = CY.world({ curtain: null });                                // the calm, kick-free world of experiment B

/* B, C, c, d read off the simulator: free flight is linear, so a unit perturbation in a 1 km arena gives the exact gains */
CA.gains = function () {
  var big = CY.world({ W: 1e3, H: 1e3, curtain: null }), s = [500, 500, 1.7, 0], g = {};
  function disp(a, wind) { big.wind = [wind, 0]; var q = CY.step(big, s, [a, 0]), t; for (t = 1; t < CA.TAU; t++) q = CY.step(big, q, null); return q[0] - s[0]; }
  g.B = disp(1, 0) - disp(0, 0); g.C = disp(0, 1) - disp(0, 0); g.kappa = g.C / g.B;
  big.wind = [1, 0]; g.c = CY.step(big, [500, 500, 0, 0], null)[2]; g.d = Math.exp(-big.gamma * big.dt);
  return g;
};
CA.g = CA.gains();

/* ───────────── the log ───────────── */
CA.log = function (N, seed) {
  var rng = CY.rng(seed), eps = [], i, t, q, s, w, e, u, rk, tr, us;
  for (i = 0; i < N; i++) {
    s = CY.launch(CA.W, rng); w = CA.SW * CY.randn(rng); e = CY.randn(rng); u = rng();
    rk = CY.rng(1000003 * seed + i); tr = [s]; us = []; CA.W.wind = [w, 0];
    for (t = 0; t < CA.KMAX; t++) { q = CY.step(CA.W, tr[t], null, rk); us.push(q[2] - CA.g.d * tr[t][2]); tr.push(q); }     // watched, not nudged
    eps.push({ w: w, e: e, u: u, tr: tr, us: us, ko: 1000003 * seed + 500000 + i });
  }
  return eps;
};
CA.outcome = function (ep, k, a, wind) {                            // the 2 s after a nudge a at step k: same wind, same kicks for every a
  var rk = CY.rng(ep.ko), q, t;
  CA.W.wind = [wind === undefined ? ep.w : wind, 0];
  q = CY.step(CA.W, ep.tr[k], [a, 0], rk);
  for (t = 1; t < CA.TAU; t++) q = CY.step(CA.W, q, null, rk);
  return q[0] - ep.tr[k][0];
};
CA.nudge = function (ep, who, se) { return (who === 'operator' ? -CA.g.kappa * ep.w : 0) + se * ep.e; };
CA.belief = function (ep, k) {                                      // N(m, P): the wind after k nudge-free steps; precisions add
  var g = CA.g, prec = 1 / (CA.SW * CA.SW) + k * g.c * g.c / (CA.SV * CA.SV), num = 0, t;
  for (t = 0; t < k; t++) num += g.c * ep.us[t] / (CA.SV * CA.SV);
  return { m: num / prec, P: 1 / prec };
};
CA.rows = function (eps, k, nudgeOf, withMiss) {                    // one row per episode: what the model may see, and the outcome
  return eps.map(function (ep) {
    var a = nudgeOf(ep), y = CA.outcome(ep, k, a);
    return { v: ep.tr[k][2], a: a, y: y, wb: CA.belief(ep, k).m, w: ep.w, miss: withMiss ? y - CA.outcome(ep, k, 0, 0) : 0 };
  });
};

/* ───────────── least squares ───────────── */
CA.ols = function (X, y) {                                          // normal equations; X rows include the intercept
  var p = X[0].length, A = new Float64Array(p * p), b = new Float64Array(p), i, j, l;
  for (i = 0; i < X.length; i++) for (j = 0; j < p; j++) { b[j] += X[i][j] * y[i]; for (l = 0; l < p; l++) A[j * p + l] += X[i][j] * X[i][l]; }
  return CY.la.solve(A, b, p);
};
CA.COLS = { state: function (r) { return [1, r.v]; }, belief: function (r) { return [1, r.v, r.wb]; }, wind: function (r) { return [1, r.v, r.w]; } };
CA.fit = function (rows, model) {                                   // the nudge's coefficient by partialling out the other inputs (Frisch-Waugh)
  var Z = rows.map(CA.COLS[model]), n = rows.length, ca = CA.ols(Z, rows.map(function (r) { return r.a; })), i, saa = 0, say = 0, ap = [], yp, th;
  for (i = 0; i < n; i++) ap.push(rows[i].a - Z[i].reduce(function (s, z, j) { return s + z * ca[j]; }, 0));
  var cy = CA.ols(Z, rows.map(function (r) { return r.y; })), ypa = [];
  for (i = 0; i < n; i++) { ypa.push(rows[i].y - Z[i].reduce(function (s, z, j) { return s + z * cy[j]; }, 0)); saa += ap[i] * ap[i]; say += ap[i] * ypa[i]; }
  if (saa / n < 1e-8) return { ok: false, ap: ap, yp: ypa };             // the nudge is a function of the other inputs: nothing to learn its effect from
  var beta = say / saa;
  th = CA.ols(Z, rows.map(function (r) { return r.y - beta * r.a; }));
  return { ok: true, beta: beta, th: th, ap: ap, yp: ypa };
};
CA.predict = function (m, model, r) { return CA.COLS[model](r).reduce(function (s, z, j) { return s + z * m.th[j]; }, m.beta * r.a); };
CA.rms = function (xs) { var s = 0; xs.forEach(function (x) { s += x * x; }); return Math.sqrt(s / xs.length); };
CA.formula = function (V, se, kappa) { var g = CA.g; return g.B - g.C * kappa * V / (kappa * kappa * V + se * se); };
CA.varLeft = function (rows, cols) {                                // sample variance of the wind that the model's inputs leave unexplained
  var Z = rows.map(CA.COLS[cols]), th = CA.ols(Z, rows.map(function (r) { return r.w; })), s = 0;
  rows.forEach(function (r, i) { var e = r.w - Z[i].reduce(function (t, z, j) { return t + z * th[j]; }, 0); s += e * e / rows.length; });
  return s;
};
CA.P = function (k) { var g = CA.g; return 1 / (1 / (CA.SW * CA.SW) + k * g.c * g.c / (CA.SV * CA.SV)); };      // the belief's variance after k steps

/* one setting of experiment A: train log, three fits, the two exams, the cost of the log */
CA.TRAIN = null; CA.SEE = null; CA.DO = null;
CA.init = function (N, NT) { CA.TRAIN = CA.log(N, 7); CA.SEE = CA.log(NT, 11); CA.DO = CA.log(NT, 13); };
CA.run = function (k, who, se) {
  var kap = who === 'operator' ? CA.g.kappa : 0, rows = CA.rows(CA.TRAIN, k, function (ep) { return CA.nudge(ep, who, se); }, true), out = { rows: rows, kap: kap }, models = ['state', 'belief', 'wind'];
  var see = CA.rows(CA.SEE, k, function (ep) { return CA.nudge(ep, who, se); }), dof = CA.rows(CA.DO, k, function (ep) { return 2 * ep.u - 1; });
  models.forEach(function (mo) {
    var f = CA.fit(rows, mo), V = mo === 'state' ? CA.varLeft(rows, 'state') : mo === 'belief' ? CA.P(k) : 0;
    out[mo] = { fit: f, V: V, formula: kap === 0 ? CA.g.B : (V === 0 && se === 0 ? NaN : CA.formula(V, se, kap)) };
    if (f.ok) { out[mo].see = CA.rms(see.map(function (r) { return r.y - CA.predict(f, mo, r); })); out[mo].dof = CA.rms(dof.map(function (r) { return r.y - CA.predict(f, mo, r); })); }
  });
  out.cost = CA.rms(rows.map(function (r) { return r.miss; }));
  return out;
};

CA.slopes = function (k, who, se) {                                 // just the three slopes (the sweep over sigma_eps draws these)
  var rows = CA.rows(CA.TRAIN, k, function (ep) { return CA.nudge(ep, who, se); }, false), o = {};
  ['state', 'belief', 'wind'].forEach(function (mo) { var f = CA.fit(rows, mo); o[mo] = f.ok ? f.beta : NaN; });
  return o;
};

/* ───────────── experiment B: where the log is silent ───────────── */
CA.NOM = [3.6, 2.5, 1.6, 0]; CA.M = 5; CA.H = 12; CA.EP = 600;
CA.room = CA.W0.W - CA.W0.r - CA.NOM[0];                         // how far the ball can move to the right before its centre meets the wall
CA.respond = function (a) { var q = CY.step(CA.W0, CA.NOM, [a, 0]), t; for (t = 1; t < CA.TAU; t++) q = CY.step(CA.W0, q, null); return q[0] - CA.NOM[0]; };
CA.GRID = []; (function () { for (var i = 0; i <= 120; i++) CA.GRID.push(-3 + i * 0.05); })();
CA.TRUTH = CA.GRID.map(CA.respond);
CA.start = function (R, n, seed) { var r = CY.rng(100 + seed), A = [], Y = [], i, a; for (i = 0; i < n; i++) { a = -R + 2 * R * r(); A.push(a); Y.push(CA.respond(a)); } return { A: A, Y: Y }; };
CA.members = function (A, Y, seed) {                               // a bootstrap ensemble of small MLPs: nudge/3 -> displacement/4
  var nets = [], m, i, j, r, Xb, Yb, net;
  for (m = 0; m < CA.M; m++) {
    r = CY.rng(seed * 100 + m); Xb = []; Yb = [];
    for (i = 0; i < A.length; i++) { j = Math.floor(r() * A.length); Xb.push([A[j] / 3]); Yb.push([Y[j] / 4]); }
    net = new CY.MLP([1, CA.H, CA.H, 1], seed * 10 + m + 1); net.fit(Xb, Yb, { epochs: CA.EP, lr: 0.02, batch: 64, seed: m + 3 }); nets.push(net);
  }
  return nets;
};
CA.band = function (nets, a) {                                      // ensemble mean and spread (std of the members) at a nudge a
  var v = nets.map(function (n) { return n.predict([a / 3])[0] * 4; }), mean = CY.stats.mean(v), s = 0;
  v.forEach(function (x) { s += (x - mean) * (x - mean) / v.length; });
  return { m: mean, s: Math.sqrt(s) };
};
CA.members_at = function (nets) { return nets.map(function (n) { return CA.GRID.map(function (a) { return n.predict([a / 3])[0] * 4; }); }); };   // each member's own curve
CA.curve = function (nets) { var m = [], s = []; CA.GRID.forEach(function (a) { var b = CA.band(nets, a); m.push(b.m); s.push(b.s); }); return { m: m, s: s }; };
CA.errors = function (cv, R) {                                      // RMS error of the ensemble mean inside the log's range and beyond it; worst case; the edge a = 3; spreads
  var o = { inn: 0, out: 0, max: 0, sin: 0, sout: 0, e3: 0, s3: 0 }, ni = 0, no = 0, last = CA.GRID.length - 1;
  CA.GRID.forEach(function (a, i) {
    var e = cv.m[i] - CA.TRUTH[i];
    o.max = Math.max(o.max, Math.abs(e));
    if (Math.abs(a) <= R + 1e-9) { o.inn += e * e; o.sin += cv.s[i]; ni++; } else { o.out += e * e; o.sout += cv.s[i]; no++; }
  });
  o.inn = Math.sqrt(o.inn / ni); o.out = Math.sqrt(o.out / Math.max(1, no)); o.sin /= ni; o.sout /= Math.max(1, no);
  o.e3 = cv.m[last] - CA.TRUTH[last]; o.s3 = cv.s[last];
  return o;
};
CA.pickRandom = function (r, nb) { var p = [], j; for (j = 0; j < nb; j++) p.push(-3 + 6 * r()); return p; };
CA.pickDisagree = function (nets, nb, sep) {                       // the nudges where the members disagree most, at least sep apart
  var cand = CA.GRID.map(function (a) { return { a: a, s: CA.band(nets, a).s }; }).sort(function (p, q) { return q.s - p.s; }), picks = [], i;
  for (i = 0; i < cand.length && picks.length < nb; i++) if (picks.every(function (p) { return Math.abs(p - cand[i].a) >= sep; })) picks.push(cand[i].a);
  return picks;
};
/* a run of experiment B: the log and its ensemble (the base), then batches of nb nudges chosen by `strategy` ('random' | 'disagree'), the ensemble refitted after each */
CA.fork = function (base, strategy, nb) { return { A: base.A.slice(), Y: base.Y.slice(), nets: base.nets, seed: base.seed, strategy: strategy, nb: nb, r: CY.rng(900 + base.seed) }; };
CA.more = function (run) {                                          // spend one more batch, then refit
  var picks = run.strategy === 'random' ? CA.pickRandom(run.r, run.nb) : CA.pickDisagree(run.nets, run.nb, 0.4);
  picks.forEach(function (a) { run.A.push(a); run.Y.push(CA.respond(a)); });
  run.nets = CA.members(run.A, run.Y, run.seed);
  return run;
};
CA.explore = function (R, n0, seed, strategy, rounds, nb) {
  var d = CA.start(R, n0, seed), run = CA.fork({ A: d.A, Y: d.Y, nets: CA.members(d.A, d.Y, seed), seed: seed }, strategy, nb), rd;
  for (rd = 0; rd < rounds; rd++) CA.more(run);
  return run;
};

/* ───────────── drawing: the widget's three panels, on the shared canvas kit CY.draw ───────────── */
CA.SIGS = []; (function () { var i; for (i = 0; i <= 12; i++) CA.SIGS.push(i * 0.125); })();   // the noise levels of the sweep
CA.fx = function (x, d) { if (!isFinite(x)) return 'n/a'; var s = Math.abs(x).toFixed(d); return (x < 0 && +s > 0 ? '−' : '') + s; };
/* ST = CA.run(k, who, se) plus k, who, se, R;  EX = experiment B at R;  rounds = batches of nudges spent;  sw = CA.slopes(k, who, s) for s in CA.SIGS */
CA.paint = function (cv, ST, EX, rounds, sw) {
  var D = CY.draw, C = CY.C, g = CA.g, fx = CA.fx, SIGS = CA.SIGS;
  function panel(ctx, b, title) {                                // frame + title, cut with an ellipsis at the panel's own edge
    D.frame(ctx, b[0], b[1], b[2], b[3], C.white);
    var t = String(title), n = t.length, m, w;
    if (ctx.measureText) {
      ctx.font = '9px "SF Mono", Menlo, Consolas, monospace';
      for (; n > 4; n--) { m = ctx.measureText(n < t.length ? t.slice(0, n) + '\u2026' : t); w = m && m.width; if (!(w > b[2] - 14)) break; }
    }
    D.mono(ctx, n < t.length ? t.slice(0, n) + '\u2026' : t, b[0] + 8, b[1] + 12, C.mute, 9);
  }

  function drawLog(ctx, b) {                                     // the log as an added-variable plot
    panel(ctx, b, 'the log: nudge a against distance moved y, velocity subtracted');
    var f = ST.state.fit, n = f.ap.length, i, sd = 0;
    for (i = 0; i < n; i++) sd += f.ap[i] * f.ap[i] / n;
    sd = Math.sqrt(sd);
    var xr = Math.max(0.8, Math.ceil(2.8 * sd / 0.2) * 0.2), yr = Math.max(1.2, g.B * xr * 1.1), bx = b[0] + 30, by = b[1] + 22, bw = b[2] - 40, bh = b[3] - 44;
    var X = function (x) { return bx + (x + xr) / (2 * xr) * bw; }, Y = function (y) { return by + bh / 2 - y / yr * bh / 2; };
    D.line(ctx, bx, Y(0), bx + bw, Y(0), C.grid, 1); D.line(ctx, X(0), by, X(0), by + bh, C.grid, 1);
    for (i = 0; i < n; i++) if (Math.abs(f.yp[i]) < yr && Math.abs(f.ap[i]) < xr) D.dot(ctx, X(f.ap[i]), Y(f.yp[i]), 1.5, 'rgba(8,145,178,0.30)');
    D.line(ctx, X(-xr), Y(-g.B * xr), X(xr), Y(g.B * xr), C.green, 2, [6, 4]);
    if (f.ok) D.line(ctx, X(-xr), Y(-f.beta * xr), X(xr), Y(f.beta * xr), C.purple, 2.8);
    D.label(ctx, 'true effect ' + fx(g.B, 2), bx + 6, by + 8, C.green, 9);
    D.label(ctx, f.ok ? 'the log teaches ' + fx(f.beta, 2) : 'no variation in the nudge', bx + 6, by + 21, C.purple, 9);
    D.mono(ctx, 'x: nudge ±' + fx(xr, 1) + ' m/s,  y: distance ±' + fx(yr, 1) + ' m', bx + bw, by + bh + 12, C.mute, 9, 'right');
  }
  function drawSweep(ctx, b) {                                   // what each model learns as the noise grows
    panel(ctx, b, 'slope learned (m per m/s) against the noise σε in the nudges');
    var bx = b[0] + 34, by = b[1] + 22, bw = b[2] - 46, bh = b[3] - 56, lo = -0.2, hi = 1.7, i, s, pts;
    var X = function (s) { return bx + s / 1.5 * bw; }, Y = function (v) { return by + bh - (v - lo) / (hi - lo) * bh; };
    [0, 0.5, 1, 1.5].forEach(function (v) { D.line(ctx, bx, Y(v), bx + bw, Y(v), C.grid, 1); D.mono(ctx, fx(v, 1), bx - 4, Y(v), C.mute, 9, 'right'); D.mono(ctx, fx(v, 1), X(v), by + bh + 11, C.mute, 9, 'center'); });
    D.line(ctx, bx, Y(g.B), bx + bw, Y(g.B), C.green, 1.6, [6, 4]); D.mono(ctx, 'true effect', bx + bw - 4, Y(g.B) - 8, C.green, 9, 'right');
    [['state', C.purple, ST.state.V], ['belief', C.cyan, ST.belief.V]].forEach(function (m) {
      pts = []; for (i = 1; i <= 150; i++) { s = i * 0.01; pts.push([X(s), Y(ST.kap === 0 ? g.B : CA.formula(m[2], s, ST.kap))]); }
      D.path(ctx, pts, m[1], 1.8);
    });
    [['state', C.purple], ['belief', C.cyan], ['wind', C.green]].forEach(function (m) { SIGS.forEach(function (sg, j) { if (isFinite(sw[j][m[0]])) D.dot(ctx, X(sg), Y(Math.max(lo, Math.min(hi, sw[j][m[0]]))), 2.6, m[1], C.white); }); });
    D.line(ctx, X(ST.se), by, X(ST.se), by + bh, C.amber, 1.5, [3, 3]);
    D.mono(ctx, 'σε (m/s)', bx + bw, by + bh + 24, C.mute, 9, 'right');
  }
  function drawB(ctx, b) {                                       // experiment B: the calm world, a nudge, the ensemble
    panel(ctx, b, 'calm world (ball at 3.6 m, 1.6 m/s): distance moved in 2 s');
    var R = ST.R, bx = b[0] + 34, by = b[1] + 22, bw = b[2] - 46, bh = b[3] - 46, lo = -2.6, hi = 6.9, i;
    var X = function (a) { return bx + (a + 3) / 6 * bw; }, Y = function (y) { return by + bh - (y - lo) / (hi - lo) * bh; };
    var P = function (v) { return v.map(function (y, j) { return [X(CA.GRID[j]), Y(y)]; }); };
    ctx.fillStyle = 'rgba(8,145,178,0.10)'; ctx.fillRect(X(-R), by, X(R) - X(-R), bh);
    [0, 2, 4, 6].forEach(function (v) { D.line(ctx, bx, Y(v), bx + bw, Y(v), C.grid, 1); D.mono(ctx, fx(v, 0), bx - 4, Y(v), C.mute, 9, 'right'); });
    [-3, -2, -1, 0, 1, 2, 3].forEach(function (a) { D.mono(ctx, fx(a, 0), X(a), by + bh + 11, C.mute, 9, 'center'); });
    D.line(ctx, bx, Y(CA.room), bx + bw, Y(CA.room), C.red, 1.2, [4, 3]); D.mono(ctx, 'right wall: the ball cannot move farther than ' + fx(CA.room, 1) + ' m', bx + 4, Y(CA.room) - 8, C.red, 9);
    if (rounds === 0) {
      EX.base.mem.forEach(function (m) { D.path(ctx, P(m), 'rgba(109,74,255,0.35)', 1); });
      D.path(ctx, P(EX.base.cv.m), C.purple, 2.4);
    } else {
      D.path(ctx, P(EX.base.cv.m), 'rgba(109,74,255,0.4)', 1.4, [4, 3]);
      D.path(ctx, P(EX.rnd.cv.m), C.cyan, 2.2);
      D.path(ctx, P(EX.dis.cv.m), C.amber, 2.2);
    }
    D.path(ctx, P(CA.TRUTH), C.ink, 2.6);
    for (i = 0; i < EX.base.A.length; i++) D.dot(ctx, X(EX.base.A[i]), Y(EX.base.Y[i]), 3, C.ink, C.white);
    if (rounds) [['rnd', C.cyan], ['dis', C.amber]].forEach(function (t) { for (i = 12; i < EX[t[0]].A.length; i++) D.dot(ctx, X(EX[t[0]].A[i]), Y(EX[t[0]].Y[i]), 4, C.white, t[1]); });
    var L = CA.GRID.length - 1;
    D.label(ctx, 'a = 3: ' + (rounds ? 'first model ' : 'model ') + fx(EX.base.cv.m[L], 2) + ' m, world ' + fx(CA.TRUTH[L], 2) + ' m', bx + bw - 4, by + 8, C.purple, 9, 'right');
    D.mono(ctx, 'nudge a (m/s)', bx + bw, by + bh + 25, C.mute, 9, 'right');
    D.mono(ctx, 'log: ' + EX.base.A.length + ' nudges in ±' + fx(R, 1), bx + 4, by + bh - 8, C.mute, 9);
  }
  cv.style.height = (cv.clientWidth < 620 ? 880 : 610) + 'px';
  var S = D.setup(cv), ctx = S.ctx, w = S.w, h = S.h, a1, a2, b3, pw;
  if (w < 620) { a1 = [8, 8, w - 16, 262]; a2 = [8, 282, w - 16, 252]; b3 = [8, 554, w - 16, h - 562]; }
  else { pw = Math.round(w * 0.46); a1 = [8, 8, pw, 270]; a2 = [pw + 20, 8, w - pw - 28, 270]; b3 = [8, 292, w - 16, h - 300]; }
  drawLog(ctx, a1); drawSweep(ctx, a2); drawB(ctx, b3);
};

root.CA = CA;
if (typeof module !== 'undefined' && module.exports) module.exports = CA;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
