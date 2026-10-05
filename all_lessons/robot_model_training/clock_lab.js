/* clock_lab.js — lesson 13's private engine: a reasoner and a fast loop on two clocks, and what one model on one clock costs.
 *
 * The Bench course (five posts, gust 0.05 rad/s, 20 Hz) is run by a policy made of three things:
 *   chunk      a list of H absolute joint targets, one per step, read off the path of the course AS THE REASONER SAW IT when it looked.
 *              The reasoner is a stand-in: it is the expert's own path planner.  What it costs is the point, not how it learned the path.
 *   reasoner   looks at the scene every K steps (the observation); its chunk lands L steps later (its latency).  The newest chunk to have
 *              landed is in force, and it is usable only while its age (steps since the observation) is below H.
 *   loop       every step: take the next target of the chunk in force and command u = (k / dt)(target - q) from the FRESH joint angles,
 *              clipped at 1.5 rad/s.  With no usable chunk it holds: it tracks the last target it took and takes no new one.
 * Targets are consumed in order: c counts them, and the c-th is the point of the path at x = xStart + (cup speed) dt c (15 cm/s unless
 * o.speed says otherwise).  Holding does not skip any.  The courses and their target tables are built once and shared: nothing writes to them.
 *
 * Designs:  'split'  reasoner (L, K, H) + fast loop on fresh joints;
 *           'loop'   the whole model in the loop, best case: a decision at every step, each one L steps old, which dead-reckons the commands
 *                    it has issued since (so it is stable); naive:true drops the dead reckoning;
 *           'alone'  the fast loop with the path it was trained on and no reasoner at all.
 * Events (they fire when the cup first comes within `lead` metres, in x, of the post the event is about):
 *           'vase'   the post moves 7 cm toward the path and the expert's path bends with it (only a reasoner that looks again can see it);
 *           'shove'  the cup is displaced 7 cm toward the post, as a bump would (only the joints feel it).
 * Run i of a study uses BN.rng(1000 seed + i + 1) for the start jitter and the gusts and BN.rng(7919 seed + i + 3) for the event (the lead,
 * then the reasoner's phase): every design meets the same luck.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var CK = {};
CK.DT = 0.05; CK.VSTEP = 0.15 * 0.05; CK.VMAX = 1.5;
CK.NPOSTS = 5; CK.POST = 2; CK.SIZE = 0.07; CK.LEAD = [0.08, 0.16]; CK.GUST = 0.05; CK.JIT = 0.01;
CK.TRACK = 0.5;                       // k = K dt: the share of the error to the target that one step removes (K = 10 per second)
CK.NROLL = 300; CK.SEED = 1; CK.SHOW = 12;
CK.LS = [0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20];       // reasoner latencies of the sweeps, in steps

/* ───── the world, and the world as the reasoner sees it ───── */
CK.world = function () { return CK._w || (CK._w = BN.slalom.world(CK.NPOSTS)); };          // one shared copy: nothing writes to it
CK.moved = function (w, k, dy) {      // a copy of the course with post k moved by dy metres and the expert's via point moved with it (made once per (k, dy))
  var memo = w._mv || (w._mv = {}), id = k + '|' + dy; if (memo[id]) return memo[id];
  var w2 = { n: w.n, shift: w.shift, tilt: w.tilt, s0: w.s0, body: w.body, posts: w.posts.map(function (p) { return p.slice(); }), via: w.via.map(function (p) { return p.slice(); }) };
  w2.posts[k][1] += dy; w2.via[k + 1][1] += dy;
  if (k === 0) w2.via[0][1] += dy;
  if (k === w.n - 1) w2.via[w.n + 1][1] += dy;
  return (memo[id] = w2);
};
/* the joint target taken as the c-th: a point of the seen course's path, at the cup's nominal speed (vstep metres per step) */
CK.target = function (w, c, vstep) {
  var vs = vstep || CK.VSTEP, tab = w._tt || (w._tt = {}), A = tab[vs] || (tab[vs] = []), x;     // the table of targets of one course at one speed, filled as it is read
  if (!A[c]) { x = BN.slalom.xStart() + vs * c; A[c] = BN.arm.ik([x, BN.slalom.yref(w, x)], 1, w.body); }
  return A[c];
};
CK.side = function (w, k) { return w.s0 * (k % 2 === 0 ? 1 : -1); };     // +1: the expert passes post k above it
CK.horizon = function (w, speed) { return Math.ceil(BN.slalom.horizon(w) * 0.15 / (speed || 0.15)); };     // 1.6 x the time the nominal path takes at that speed

/* ───── one run ─────
 * o: design, L, K, H, event ('none' | 'vase' | 'shove'), lead (m), phase (0 .. K-1), naive, speed (m/s), track (k), gust, size, post, log (keep the per-step bookkeeping) */
CK.rollout = function (w0, o, rng) {
  var L = o.L, K = Math.max(1, o.K), H = o.H, k = o.track === undefined ? CK.TRACK : o.track, gust = o.gust === undefined ? CK.GUST : o.gust, size = o.size === undefined ? CK.SIZE : o.size;
  var vs = (o.speed || 0.15) * CK.DT, pk = o.post === undefined ? CK.POST : o.post, T = CK.horizon(w0, o.speed), xe = BN.slalom.xEnd(w0), sgn = CK.side(w0, pk), dt = CK.DT, ev = o.event || 'none', phase = o.phase || 0;
  var q = BN.slalom.startQ(w0, CK.JIT * BN.randn(rng)).slice(), P = [], hist = [q.slice()], uapp = [], plans = [], act = o.log ? [] : null;
  var wTrue = w0, wMoved = null, fired = -1, last = CK.target(w0, 0, vs), c = 0, held = 0, coll = false, done = false, steps = T, nextObs = phase - K * (Math.ceil((L + H) / K) + 2), active = null, lag = NaN, t, j, p, u, tgt, qs;
  for (t = 0; t < T; t++) {
    p = BN.arm.fk(q, w0.body); P.push(p);
    if (BN.slalom.collide(wTrue, p)) { coll = true; steps = t; break; }
    if (p[0] > xe - 0.02) { done = true; steps = t; break; }
    if (ev === 'vase' && fired < 0 && p[0] >= w0.posts[pk][0] - o.lead) {
      fired = t; wMoved = CK.moved(w0, pk, sgn * size); wTrue = wMoved;
      lag = o.design === 'loop' ? L : o.design === 'alone' ? NaN : phase + K * Math.ceil((t - phase) / K) + L - t;       // steps until a chunk that has seen it is in force
    }
    if (o.design === 'loop') {                                   // one model in the loop: it acts on what it saw L steps ago
      var s = t - L, seen = (wMoved && s >= fired) ? wMoved : w0;
      qs = hist[Math.max(0, s)].slice();
      if (!o.naive) for (j = Math.max(0, s); j < t; j++) { qs[0] += dt * uapp[j][0]; qs[1] += dt * uapp[j][1]; }
      tgt = CK.target(seen, ++c, vs);
      u = [(k / dt) * (tgt[0] - qs[0]), (k / dt) * (tgt[1] - qs[1])];
    } else if (o.design === 'alone') {                           // the fast loop with the path it was trained on
      tgt = CK.target(w0, ++c, vs); u = [(k / dt) * (tgt[0] - q[0]), (k / dt) * (tgt[1] - q[1])];
    } else {                                                     // two clocks: the reasoner looks every K steps, its chunk lands L steps later
      while (nextObs <= t) { plans.push({ s: nextObs, land: nextObs + L, seen: (wMoved && nextObs >= fired) ? wMoved : w0, moved: !!(wMoved && nextObs >= fired) }); nextObs += K; }
      active = null; for (j = plans.length - 1; j >= 0; j--) if (plans[j].land <= t) { active = plans[j]; break; }
      if (!active || t - active.s >= H) { held++; if (act) act.push(-1); tgt = last; }
      else { if (act) act.push(active.s); tgt = last = CK.target(active.seen, ++c, vs); }
      u = [(k / dt) * (tgt[0] - q[0]), (k / dt) * (tgt[1] - q[1])];
    }
    u[0] = Math.max(-CK.VMAX, Math.min(CK.VMAX, u[0])); u[1] = Math.max(-CK.VMAX, Math.min(CK.VMAX, u[1])); uapp.push(u);
    if (ev === 'shove' && fired < 0 && p[0] >= w0.posts[pk][0] - o.lead) {
      fired = t; lag = o.design === 'loop' ? L : 0; var dq = BN.arm.dls(BN.arm.jac(q, w0.body), [0, -sgn * size], 1e-4); q[0] += dq[0]; q[1] += dq[1];
    }
    q[0] += dt * (u[0] + gust * BN.randn(rng)); q[1] += dt * (u[1] + gust * BN.randn(rng));
    hist.push(q.slice());
  }
  return { done: done, coll: coll, steps: steps, T: T, fired: fired, held: held, lag: lag, P: P, plans: plans, act: act, w: wTrue };
};

/* ───── N runs of one setting; the event and the reasoner's phase of run i come from their own generator ───── */
CK.study = function (o, N, seed, keep) {
  seed = seed === undefined ? CK.SEED : seed; var w0 = CK.world(), ok = 0, co = 0, held = 0, steps = 0, lagSum = 0, lagN = 0, rolls = [], i;
  for (i = 0; i < N; i++) {
    var rng = BN.rng(1000 * seed + i + 1), re = BN.rng(7919 * seed + i + 3), lead = CK.LEAD[0] + (CK.LEAD[1] - CK.LEAD[0]) * re(), phase = Math.floor(re() * Math.max(1, o.K));
    var oo = {}; for (var key in o) oo[key] = o[key]; oo.lead = lead; oo.phase = phase; oo.log = i < (keep || 0);
    var r = CK.rollout(w0, oo, rng);
    if (r.done) { ok++; steps += r.steps; } if (r.coll) co++; held += r.held; if (!isNaN(r.lag)) { lagSum += r.lag; lagN++; }
    if (i < (keep || 0)) { r.lead = lead; r.phase = phase; rolls.push(r); }
  }
  return { N: N, succ: ok / N, coll: co / N, timeout: 1 - (ok + co) / N, ci: BN.stats.wilson(ok, N), held: held / N, steps: ok ? steps / ok : NaN, lag: lagN ? lagSum / lagN : NaN, rolls: rolls, T: CK.horizon(w0, o.speed) };
};
/* ───── the arithmetic of the clocks ───── */
/* the loop e(t+1) = e(t) - k e(t-d) is stable only for k below this ceiling (lesson 6) */
CK.ceiling = function (d) { return 2 * Math.sin(Math.PI / (4 * d + 2)); };
/* a reasoner with P parameters: time to read N tokens (2 P N operations, compute bound at F operations/s) and to write n tokens (2 P bytes of weights
 * read per token at B bytes/s, memory bound), in seconds; the ruler is round numbers, not a product */
CK.F = 100e12; CK.B = 1e12; CK.NTOK = 250; CK.NOUT = 8;
CK.readTime = function (P, N, n, F, B) { F = F || CK.F; B = B || CK.B; return 2 * P * N / F + n * 2 * P / B; };
/* the largest P whose read-and-write time fits in tau seconds */
CK.maxParams = function (tau, N, n, F, B) { F = F || CK.F; B = B || CK.B; return tau / (2 * N / F + 2 * n / B); };
/* chunk bookkeeping: steps of every K-step cycle with no usable chunk, share of steps spent moving, accelerators busy, mean delay before an event is seen */
CK.gap = function (L, K, H) { return Math.max(0, L + K - H); };
CK.moving = function (L, K, H) { return Math.min(1, Math.max(0, (H - L) / K)); };
CK.accel = function (L, K) { return Math.ceil(L / K); };
CK.meanAge = function (L, K) { return L + (K - 1) / 2; };

/* ───── the picture: the table from above, the two clocks over one run, success against latency ─────
 * S: { st: {design ('split' | 'loop' | 'alone'), naive (loop only), event, L, K, H}, sim: a study with kept runs, curves: {split, loop (arrays over CK.LS, possibly partial), alone (number or null)} } */
CK.MARKS = [['π0', 73 / 50, 0], ['OpenVLA', 1000 / 6 / 50, 1], ['Gemini', 5, 0], ['planner', 10, 1]];
CK.paint = function (cv, S) {
  var D = BN.draw, C = BN.C, st = S.st, sim = S.sim, cur = S.curves, r0 = sim.rolls[0], i;
  var narrow = (cv.clientWidth || 640) < 600, wantH = narrow ? 720 : 700;
  if (cv.style.height !== wantH + 'px') cv.style.height = wantH + 'px';
  var s = D.setup(cv), ctx = s.ctx, W = s.w, Hc = s.h, pad = 8, base = CK.world(), xp = base.posts[CK.POST][0];
  /* A: the table from above, twelve runs, the vase before and after, the band where the event fires */
  var aH = narrow ? 156 : Math.round(Hc * 0.32), v = D.view(pad, pad, W - 2 * pad, aH, BN.slalom.xStart() - 0.05, BN.slalom.xEnd(base) + 0.05, 0.32, 0.8);
  D.workspace(ctx, v, r0.w);
  if (st.event !== 'none') { ctx.save(); ctx.fillStyle = C.amberSoft; ctx.globalAlpha = 0.55; ctx.fillRect(v.X(xp - CK.LEAD[1]), v.by + 1, (CK.LEAD[1] - CK.LEAD[0]) * v.s, v.bh - 2); ctx.restore(); }
  if (st.event === 'vase') {
    var op = base.posts[CK.POST], np = r0.w.posts[CK.POST];
    ctx.save(); ctx.strokeStyle = C.dim; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(v.X(op[0]), v.Y(op[1]), BN.slalom.W.postR * v.s, 0, 6.2832); ctx.stroke(); ctx.restore();
    D.line(ctx, v.X(op[0]), v.Y(op[1]), v.X(np[0]), v.Y(np[1]), C.red, 1.5); D.dot(ctx, v.X(np[0]), v.Y(np[1]), BN.slalom.W.postR * v.s, C.redSoft, C.red);
  }
  sim.rolls.forEach(function (ro) {
    D.trace(ctx, v, ro.P, ro.done ? C.cyan : ro.coll ? C.red : C.amber, 1.6, 0.8);
    if (ro.coll) { var pe = ro.P[ro.P.length - 1]; D.dot(ctx, v.X(pe[0]), v.Y(pe[1]), 3.5, C.red); }
  });
  D.arm(ctx, v, BN.slalom.startQ(base), base.body, C.ink, 3);
  D.mono(ctx, sim.rolls.length + ' of ' + sim.N + ' runs' + (st.event !== 'none' ? '; shaded: where the event fires' : ''), v.bx + 6, v.by + 10, C.mute, 10);
  [['reached the mat', C.cyan], ['touched a post', C.red], ['timed out', C.amber]].forEach(function (lg, n) {
    var lx = v.bx + 6 + (narrow ? 0 : n * 130), ly = v.by + v.bh - 10 - (narrow ? (2 - n) * 13 : 0);
    ctx.fillStyle = lg[1]; ctx.fillRect(lx, ly - 4, 10, 8); D.mono(ctx, lg[0], lx + 14, ly, C.mute, 10);
  });
  /* B: the two clocks over run 0 */
  var by0 = pad + aH + 12, bh = narrow ? 140 : 134, lab = narrow ? 40 : 76, bx0 = pad + lab, bw = W - 2 * pad - lab - 4;
  var span = narrow ? 56 : 84, t0 = Math.max(0, (r0.fired < 0 ? 40 : r0.fired) - 22), X = function (t) { return bx0 + (t - t0) / span * bw; };
  D.frame(ctx, pad, by0, W - 2 * pad, bh, C.white);
  var rowH = narrow ? 11 : 13, ly = by0 + (narrow ? 44 : 32), l2 = ly + 3 * rowH + 8;
  if (st.design !== 'split') D.mono(ctx, st.design === 'loop' ? 'one decision per step, each ' + st.L + (st.L === 1 ? ' step' : ' steps') + ' old' + (st.naive ? ', used as if current' : '') : 'no reasoner: the chunk never changes', pad + 6, by0 + 8, C.mute, 10);
  else [['reasoner looking', C.amber], ['chunk usable', C.tealSoft], ['chunk in force', C.teal], ['no chunk: holds', C.red]].forEach(function (lg, n) {
    var lx = pad + 6 + (narrow ? (n % 2) * 122 : n * 140), lyy = by0 + 8 + (narrow ? Math.floor(n / 2) * 12 : 0);
    ctx.fillStyle = lg[1]; ctx.fillRect(lx, lyy - 4, 10, 8); D.mono(ctx, lg[0], lx + 14, lyy, C.mute, 10);
  });
  if (st.design === 'split') D.text(ctx, narrow ? 'slow' : 'reasoner', pad + 6, ly + rowH * 1.5, C.mute, 11);
  D.text(ctx, narrow ? 'fast' : 'fast loop', pad + 6, l2 + 6, C.mute, 11);
  if (st.design === 'split') {
    var plans = r0.plans, K = Math.max(1, st.K);
    plans.forEach(function (p, n) {
      if (p.s + st.H < t0 || p.s > t0 + span) return;
      var row = (((Math.round(p.s / K)) % 3) + 3) % 3, y = ly + row * rowH, nl = n + 1 < plans.length ? plans[n + 1].land : 1e9, a = Math.max(t0, p.s), b = Math.min(t0 + span, p.s + st.L);
      if (b > a) { ctx.fillStyle = C.amber; ctx.fillRect(X(a), y, X(b) - X(a), rowH - 3); }
      a = Math.max(t0, p.s + st.L); b = Math.min(t0 + span, p.s + st.H);
      if (b > a) { ctx.fillStyle = C.tealSoft; ctx.fillRect(X(a), y, X(b) - X(a), rowH - 3); }
      a = Math.max(t0, p.land); b = Math.min(t0 + span, p.s + st.H, nl);
      if (b > a) { ctx.fillStyle = C.teal; ctx.fillRect(X(a), y, X(b) - X(a), rowH - 3); }
    });
  }
  for (i = t0; i < Math.min(t0 + span, r0.steps); i++) { ctx.fillStyle = (st.design === 'split' && r0.act && r0.act[i] === -1) ? C.red : C.teal; ctx.fillRect(X(i), l2, Math.max(1, X(i + 1) - X(i) - 0.6), 12); }
  if (r0.coll && r0.steps >= t0 && r0.steps <= t0 + span) { D.dot(ctx, X(r0.steps), l2 + 6, 5, C.red); if (X(r0.steps) < W - pad - 50) D.mono(ctx, 'touch', X(r0.steps) + 9, l2 + 6, C.red, 10); }
  if (r0.fired >= t0) {
    D.line(ctx, X(r0.fired), ly - 4, X(r0.fired), l2 + 14, C.red, 1.5); D.mono(ctx, 'event', X(r0.fired) - 4, ly - 8, C.red, 10, 'right');
    if (!isNaN(r0.lag) && r0.lag > 0 && r0.fired + r0.lag <= t0 + span) { D.line(ctx, X(r0.fired + r0.lag), ly - 4, X(r0.fired + r0.lag), l2 + 14, C.green, 1.5, [4, 3]); D.mono(ctx, st.event === 'vase' ? 'chunk that knows' : 'model feels it', X(r0.fired + r0.lag) + 4, ly - 8, C.green, 10); }
  }
  for (i = Math.ceil(t0 / 10) * 10; i <= t0 + span; i += 10) { D.line(ctx, X(i), l2 + 14, X(i), l2 + 18, C.dim, 1); D.mono(ctx, String(i), X(i), l2 + 26, C.mute, 10, 'center'); }
  D.mono(ctx, 'steps (1 step = 50 ms)', W - pad - 6, by0 + bh - 8, C.mute, 10, 'right');
  /* C: success against the reasoner's latency */
  var cy0 = by0 + bh + 12, cx = pad + 34, cw = W - cx - pad - 10, cyp = cy0 + 34, ph = Hc - cyp - 42;
  var PL = D.plot(ctx, [], cx, cyp, cw, ph, { xmin: 0, xmax: 20, ymin: 0, ymax: 100, xticks: [0, 2, 4, 6, 8, 10, 12, 16, 20], yticks: [0, 50, 100], xlabel: 'reasoner latency L (steps of 50 ms)', ylabel: 'success (%)' });
  if (st.design === 'split') { var xr = st.H - st.K; if (xr >= 0 && xr < 20) { ctx.save(); ctx.fillStyle = C.redSoft; ctx.globalAlpha = 0.5; ctx.fillRect(PL.X(xr), cyp, PL.X(20) - PL.X(xr), ph); ctx.restore(); D.line(ctx, PL.X(xr), cyp, PL.X(xr), cyp + ph, C.red, 1, [4, 3]); if (PL.X(20) - PL.X(xr) > 104) D.mono(ctx, 'H < L + K: the arm holds', PL.X(xr) + 5, cyp + 18, C.red, 9); } }
  CK.MARKS.forEach(function (m) { var px = PL.X(m[1]); D.line(ctx, px, cyp + ph - 5, px, cyp + ph, C.ink, 1.5); if (!narrow) D.mono(ctx, m[0], px, cyp + ph - 10 - m[2] * 12, C.ink, 9, 'center'); });
  function curve(vals, color, width) { var xs = CK.LS.slice(0, vals.length), ys = vals.map(function (a) { return a * 100; }); if (xs.length > 1) D.path(ctx, xs.map(function (x, m) { return [PL.X(x), PL.Y(ys[m])]; }), color, width); xs.forEach(function (x, m) { D.dot(ctx, PL.X(x), PL.Y(ys[m]), 2.5, color); }); }
  if (cur.loop) curve(cur.loop, C.purple, 1.8); if (cur.split) curve(cur.split, C.teal, 2.2);
  if (cur.alone !== null && cur.alone !== undefined) D.line(ctx, PL.X(0), PL.Y(cur.alone * 100), PL.X(20), PL.Y(cur.alone * 100), C.dim, 1.5, [5, 4]);
  D.dot(ctx, PL.X(st.L), PL.Y(sim.succ * 100), 5.5, C.amber, C.ink);
  [['two clocks', C.teal], [st.naive ? 'one model in the loop, naive' : 'one model in the loop', C.purple], ['fast loop alone', C.dim]].forEach(function (lg, n) {
    var lx = cx + (narrow ? [0, 96, 190] : st.naive ? [0, 130, 340] : [0, 168, 336])[n], lyy = cy0 + 8; if (narrow) lg = [['two clocks', C.teal], [st.naive ? 'naive loop' : 'in the loop', C.purple], ['alone', C.dim]][n];
    D.line(ctx, lx, lyy, lx + 14, lyy, lg[1], 2.5); D.mono(ctx, lg[0], lx + 18, lyy, C.mute, 10);
  });
};

root.CK = CK;
if (typeof module !== 'undefined' && module.exports) module.exports = CK;
})(typeof window !== 'undefined' ? window : globalThis);
