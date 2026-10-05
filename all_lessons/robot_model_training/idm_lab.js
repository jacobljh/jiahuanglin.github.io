/* idm_lab.js — lesson 9's private engine: actions recovered from motion, and what the recovered actions are worth.
 *
 * The robot is the Bench's arm on the five-post course under the usual gust.  A policy reads the position of the cup and answers with the cup velocity it wants,
 * in metres per second (the place the hand should go, as lesson 8 wrote it); the arm's own controller (damped least squares) turns that into joint velocities.
 *   record      runs of the expert under a gust: the cup position at every frame (Z) and the velocity commanded at every frame (V).  Labelled runs keep V; footage drops it (IL.footage).
 *   fitGain     the one number of the inverse-dynamics model: what the plant does per unit command, measured on labelled runs
 *   idm         the model: a filter over the cup positions around a frame that answers the command of that frame.  kind 'fwd' (the next step divided by gain x dt) is the model;
 *               'past', 'cen' and 'win' (a ridge-fitted filter over 6 frames before and 6 after) are the labels the lesson rules out
 *   label       the model applied to footage: one pseudo-command per frame it can label
 *   trainFrames the frames a policy is trained on: the labelled frames plus the footage labelled by a model, by the policy itself ('self') or by the true commands ('true')
 *   policy      lesson 1's nearest-demo kernel regressor over (cup position -> commanded velocity); predict is its fast form; evaluate runs it on the plant
 *   press       the same arm pushes the cup down on a plate at table height; the table stops the cup, and the plate registers a press only if the arm pushes hard enough
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var IL = {};
IL.DT = 0.05; IL.GUST = 0.05; IL.JIT = 0.01; IL.NPOSTS = 5;
IL.H = [0.015, 0.015];                               // kernel bandwidth of the policy, metres (about the 0.02 rad of lesson 1)
IL.NEVAL = 200; IL.SEED = 5;
IL.plant = function (gust) { return { noise: gust === undefined ? IL.GUST : gust }; };
IL.world = function () { return BN.slalom.world(IL.NPOSTS); };

/* the expert's command in the shared space: the velocity it wants for the cup (the first half of BN.slalom.expertAct, before the arm's controller) */
IL.expertVel = function (w, q) {
  var W = BN.slalom.W, p = BN.arm.fk(q, w.body), xe = BN.slalom.xEnd(w), xa = Math.min(xe, p[0] + W.look), tgt = [xa, BN.slalom.yref(w, xa)];
  var v = [tgt[0] - p[0], tgt[1] - p[1]], d = Math.hypot(v[0], v[1]) || 1e-9, sp = W.speed * Math.min(1, Math.max(0, (xe - p[0]) / 0.06 + 0.1));
  return [v[0] / d * sp, v[1] / d * sp];
};
/* the arm's own controller: the joint velocities that give the cup the wanted velocity */
IL.control = function (w, q, v) { return BN.arm.dls(BN.arm.jac(q, w.body), v, 1e-4); };

/* runs of the expert under a gust: Z the cup positions, V the velocity commanded at every frame (one fewer than positions) */
IL.record = function (w, count, seed, gust) {
  var runs = BN.demos(w, count, BN.rng(seed), { plant: IL.plant(gust), jit: IL.JIT });
  return runs.map(function (ro) {
    var V = []; for (var t = 0; t < ro.A.length; t++) V.push(IL.expertVel(w, ro.S[t]));
    return { Z: ro.P, V: V, done: ro.done, coll: ro.coll };
  });
};
IL.footage = function (runs) { return runs.map(function (r) { return { Z: r.Z, done: r.done, coll: r.coll }; }); };       // no V: the commands are gone

/* the inverse-dynamics model: the cup moved Z[t+1] - Z[t]; the plant moves the cup g DT per unit command, so the command was that move divided by g DT.
 * g is measured on labelled runs by regressing the realised velocity on the logged command (a fit in the forward direction, which does not shrink). */
IL.fitGain = function (runs) {
  var sxy = 0, sxx = 0, n = 0;
  runs.forEach(function (r) {
    for (var t = 0; t < r.V.length; t++) for (var a = 0; a < 2; a++) { sxy += (r.Z[t + 1][a] - r.Z[t][a]) / IL.DT * r.V[t][a]; sxx += r.V[t][a] * r.V[t][a]; n++; }
  });
  return { g: sxy / sxx, n: n };
};
/* kind 'fwd': the step from this frame to the next (the effect of this frame's command); 'past': the step that arrived at this frame; 'cen': their average; 'win': a filter over
 * 6 frames before to 6 after, fitted by ridge regression of the command on the displacements (the direct inverse fit) */
IL.idm = function (runs, kind) {
  var G = IL.fitGain(runs), s = 1 / (G.g * IL.DT);
  if (kind === 'past') return { g: G.g, n: G.n, B: 1, F: 0, js: [-1], c: [-s] };
  if (kind === 'cen') return { g: G.g, n: G.n, B: 1, F: 1, js: [-1, 1], c: [-s / 2, s / 2] };
  if (kind === 'win') { var W = IL.idmWindow(runs, 6, 6); W.g = G.g; return W; }
  return { g: G.g, n: G.n, B: 0, F: 1, js: [1], c: [s] };
};
/* a filter over the frames B before to F after, fitted by ridge regression of the command on the displacements */
IL.idmWindow = function (runs, B, F, lam) {
  var js = [], j; for (j = -B; j <= F; j++) if (j !== 0) js.push(j);
  var m = js.length, A = new Float64Array(m * m), b = new Float64Array(m), x = new Array(m), n = 0;
  runs.forEach(function (r) {
    for (var t = B; t + F < r.Z.length && t < r.V.length; t++) for (var a = 0; a < 2; a++) {
      for (var k = 0; k < m; k++) x[k] = r.Z[t + js[k]][a] - r.Z[t][a];
      for (k = 0; k < m; k++) { b[k] += x[k] * r.V[t][a]; for (var l = 0; l < m; l++) A[k * m + l] += x[k] * x[l]; }
      n++;
    }
  });
  var tr = 0; for (j = 0; j < m; j++) tr += A[j * m + j];
  for (j = 0; j < m; j++) A[j * m + j] += (lam === undefined ? 1e-6 : lam) * tr / m;
  var c = BN.la.solve(A, b, m);
  return { B: B, F: F, js: js, c: Array.prototype.slice.call(c), n: n };
};
/* the model's answer at frame t of a track Z of cup positions (needs B frames before and F after) */
IL.say = function (M, Z, t) {
  var o = [0, 0];
  for (var k = 0; k < M.js.length; k++) { var zz = Z[t + M.js[k]], z0 = Z[t]; o[0] += M.c[k] * (zz[0] - z0[0]); o[1] += M.c[k] * (zz[1] - z0[1]); }
  return o;
};
/* pseudo-labels: [cup position, inferred command] for every frame of every run that has its B frames before and F after */
IL.label = function (M, runs) {
  var out = [];
  runs.forEach(function (r) { for (var t = M.B; t + M.F < r.Z.length; t++) out.push([r.Z[t], IL.say(M, r.Z, t)]); });
  return out;
};
/* labelled frames as the policy stores them: [cup position, commanded velocity] */
IL.frames = function (runs) {
  var out = []; runs.forEach(function (r) { for (var t = 0; t < r.V.length; t++) out.push([r.Z[t], r.V[t]]); }); return out;
};
/* error of the model against the commands on runs that carry them, relative to the size of the commands (the number training reports) */
IL.idmError = function (M, runs) {
  var se = 0, ss = 0;
  runs.forEach(function (r) { for (var t = M.B; t + M.F < r.Z.length && t < r.V.length; t++) { var v = IL.say(M, r.Z, t); se += Math.pow(v[0] - r.V[t][0], 2) + Math.pow(v[1] - r.V[t][1], 2); ss += r.V[t][0] * r.V[t][0] + r.V[t][1] * r.V[t][1]; } });
  return Math.sqrt(se / ss);
};

/* what the policy is trained on: the labelled frames, plus the footage labelled by one of: 'fwd' 'past' 'cen' 'win' (an inverse-dynamics model fitted on the labelled runs),
 * 'self' (the policy built from the labelled frames alone answers for every footage frame), 'true' (the commands the footage's demonstrator really gave: the Bench knows them) */
IL.trainFrames = function (src, labelled, footage) {
  var fr = IL.frames(labelled);
  if (src === 'true') return fr.concat(IL.frames(footage));
  if (src === 'self') { var own = IL.policy(fr); footage.forEach(function (r) { for (var t = 0; t < r.V.length; t++) fr.push([r.Z[t], IL.predict(own, r.Z[t])]); }); return fr; }
  return fr.concat(IL.label(IL.idm(labelled, src), footage));
};
/* the policy: nearest-demo kernel regressor over the cup position; the answer is a wanted cup velocity */
IL.policy = function (frames) {
  var nw = new BN.NW(IL.H); frames.forEach(function (f) { nw.add(f[0], f[1]); }); return nw;
};
/* the kernel answer at a query, written out for speed: the same cells, order and arithmetic as BN.NW.predict */
IL.predict = function (nw, q) {
  var h0 = nw.h[0], h1 = nw.h[1], q0 = q[0], q1 = q[1], c0 = Math.floor(q0 / nw.cell[0]) + 1024, c1 = Math.floor(q1 / nw.cell[1]) + 1024, g = nw.g, o0 = 0, o1 = 0, tot = 0;
  for (var i0 = -1; i0 <= 1; i0++) for (var i1 = -1; i1 <= 1; i1++) {
    var a = g[(c0 + i0) * 2048 + c1 + i1]; if (!a) continue;
    for (var t = 0; t < a.length; t++) {
      var id = a[t], x = nw.X[id], z0 = (x[0] - q0) / h0, z1 = (x[1] - q1) / h1, e = z0 * z0 + z1 * z1;
      if (e > 9) continue;
      var w = Math.exp(-0.5 * e), y = nw.Y[id]; tot += w; o0 += w * y[0]; o1 += w * y[1];
    }
  }
  if (tot < 1e-12) { var nb = nw.nearest(q); return nb < 0 ? [0, 0] : nw.Y[nb].slice(); }
  return [o0 / tot, o1 / tot];
};
IL.evaluate = function (w, nw, N, seed) {
  return BN.evaluate(w, function () { return function (q) { return IL.control(w, q, IL.predict(nw, BN.arm.fk(q, w.body))); }; }, N || IL.NEVAL, seed || IL.SEED, { plant: IL.plant(), jit: IL.JIT });
};


/* ───────────── pressing: the table stops the cup ───────────── */
/* The cup starts Y0 - YW above a plate that sits on the table at x = PX, height YW, and is told to go down and push.  The table stops it: if the plant would carry the cup below YW,
 * the arm is put back on the table surface (same x), so pushing harder changes nothing the cup does.  The plate registers a press when the arm has pushed down at a commanded speed of
 * at least NEED m/s for HOLD frames in a row while the cup is on the table.  The demonstrator descends at 0.15 m/s and keeps pushing down at PUSH m/s until the clip ends. */
IL.PRESS = { x: 0.30, yw: 0.45, y0: 0.60, push: 0.15, need: 0.08, hold: 10, T: 70, kx: 3 };
IL.pressRun = function (policy, seed, gust, n, need) {
  var P = IL.PRESS, need = need === undefined ? P.need : need, rng = BN.rng(seed), body = BN.arm.A, out = [], k;
  for (k = 0; k < (n || 1); k++) {
    var q = BN.arm.ik([P.x + IL.JIT * BN.randn(rng), P.y0], 1, body), Z = [], V = [], run = 0, hit = false, t;
    for (t = 0; t < P.T; t++) {
      var p = BN.arm.fk(q, body); Z.push(p);
      var v = policy(p, t); V.push(v);
      if (p[1] <= P.yw + 1e-9 && v[1] <= -need) { run++; if (run >= P.hold) hit = true; } else run = 0;
      var u = IL.control({ body: body }, q, v);
      for (var a = 0; a < 2; a++) q[a] += IL.DT * (Math.max(-1.5, Math.min(1.5, u[a])) + gust * BN.randn(rng));
      var pn = BN.arm.fk(q, body);
      if (pn[1] < P.yw) q = BN.arm.ik([pn[0], P.yw], 1, body);
    }
    Z.push(BN.arm.fk(q, body)); out.push({ Z: Z, V: V, hit: hit });
  }
  return out;
};
/* the demonstrator: down at 0.15 m/s, then pushing at `push` m/s (a little sideways correction toward the plate) */
IL.pressDemo = function (push) { var P = IL.PRESS; return function (p) { return [P.kx * (P.x - p[0]), p[1] > P.yw + 1e-9 ? -P.push : -push]; }; };
IL.pressFootage = function (count, seed, push) { return IL.pressRun(IL.pressDemo(push === undefined ? IL.PRESS.push : push), seed, IL.GUST, count); };

root.IL = IL;
if (typeof module !== 'undefined' && module.exports) module.exports = IL;
})(typeof window !== 'undefined' ? window : globalThis);
