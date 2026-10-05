#!/usr/bin/env node
'use strict';
/* Oracle for embodied_training_data lesson 06 (spending the budget: the allocation problem).
 * Re-derives every number the lesson quotes by code written separately from alloc_lab.js: its own prices (the arithmetic of LG.price repeated from LG.assume), its own plan lists built from the raw
 * cells of the stored table, its own one-point filter, its own exhaustive search over every plan (one point per column), its own steepest-chord march for the blocks (the engine uses a monotone chain),
 * its own rule, price rank, mixtures, sum, minimum and thresholds.  Only the table (measured on the Bench) and the price assumptions come from ledger.js.  Checks: the rule equals the best plan wherever a
 * budget ends on a block; the best plan never has a smaller cost than it says; the order of the hour-only blocks does not depend on K; every threshold; the lesson's own checkpoint by brute force.
 * Then it drives the page's widget through the states the prose names and compares what it prints with the independent computation.  Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'embodied_training_data_new')) ? 'embodied_training_data_new' : 'embodied_training_data';
const LG = require(path.join(root, dir, 'ledger.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) fail(`${m}: ${a} vs ${b}`); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 4 : d); };
const T = LG.TABLE, S = T.layouts, R = T.recover, C = T.contact, A = LG.assume;

/* ───── prices, from the assumptions (the arithmetic of LG.price written out) ───── */
const arm = A.arm_cost / A.arm_life_h;
const pOwn = (A.wage_per_h + arm) / (A.duty * (1 - A.discard));
const pSim = A.gpu_per_h / A.sim_speed + A.scene_weeks * A.week_cost / A.scene_uses_h + A.calib_h * pOwn / A.scene_uses_h;
const pVideoAttempted = (A.video_wage_per_h + A.track_per_h) / (A.video_duty * (1 - A.video_discard)) * (1 - A.video_discard);
const pCorr = (A.wage_per_h + arm) / A.sup_duty;
const pForceNoRig = (A.wage_per_h + arm) / (A.force_duty * (1 - A.discard));
const pForceL2 = (A.wage_per_h + arm + A.force_rig_cost / A.arm_life_h) / (A.force_duty * (1 - A.discard));
near(pOwn, LG.price('own'), 1e-9, 'own price'); near(pSim, LG.price('sim'), 1e-9, 'sim price'); near(pCorr, LG.price('corr'), 1e-9, 'corr price'); near(pForceL2, LG.price('force'), 1e-9, 'force price');
const HR = 9.3 / 3600, SEC_INS = C.secPerAttempt, HZ = 20;              // hours of a layout or a demonstration; seconds of an insertion attempt; frames per second
const perUnit = { sim: pSim * HR, twin: A.curate_per_h * HR, old: A.curate_per_h * HR, video: pVideoAttempted * HR, own: pOwn * HR, ins: pForceNoRig * SEC_INS / 3600 };
put('pu_sim', perUnit.sim * 1000, 3); put('pu_twin', perUnit.twin, 5); put('pu_gust', perUnit.own, 4); put('pu_ins', perUnit.ins, 4);
put('p_h_own', pOwn, 1); put('p_h_sim', pSim, 2); put('p_h_twin', A.curate_per_h, 0); put('p_h_corr', pCorr, 0); put('p_h_force', pForceNoRig, 1); put('p_h_force2', pForceL2, 1);
put('rig', A.force_rig_cost, 0); put('pipe', 2 * A.week_cost, 0);

/* ───── the columns, from the raw cells ───── */
const MIN = 0.01;
const cummax = (a) => { const o = []; let m = -Infinity; for (const v of a) { m = Math.max(m, v); o.push(m); } return o; };
function raw(K, rig, sim) {
  const g = [], r = [], c = [];
  const gs0 = S.ownHand.s[S.ownHand.N.indexOf(8)];
  g.push({ x: 0, s: gs0, src: 'own', n: 0 });
  for (const [key, price, tag] of [[sim, perUnit.sim, 'sim'], ['twin', perUnit.twin, 'twin'], ['old', perUnit.old, 'old'], ['video', perUnit.video, 'video']]) {
    const cur = cummax(S.src[key].s['8']);
    S.M.forEach((M, i) => { if (i > 0) g.push({ x: K * price * M, s: cur[i], src: tag, n: K * M }); });
  }
  const ow = cummax(S.ownHand.s);
  S.ownHand.N.forEach((N, i) => { if (N > 8) g.push({ x: K * perUnit.own * (N - 8), s: ow[i], src: 'ownL', n: K * (N - 8) }); });
  const rs0 = R.calm.s[R.n.indexOf(20)];
  r.push({ x: 0, s: rs0, src: 'calm', n: 0 });
  for (const [key, tag] of [['g05', 'g05'], ['g10', 'g10']]) { const cur = cummax(R[key].s); R.n.forEach((n, i) => r.push({ x: K * perUnit.own * n, s: cur[i], src: tag, n: K * n })); }
  const cc = cummax(R.corr.s);
  R.corr.rounds.forEach((rd, i) => { if (rd > 0) r.push({ x: 2 * A.week_cost + K * pCorr * (R.corr.labelled[i] / HZ / 3600), s: cc[i], src: 'corr', n: K * R.corr.rollouts[i], inst: true }); });
  const plateau = C.noForce.s.slice(1).reduce((a, b) => a + b, 0) / (C.noForce.s.length - 1);
  c.push({ x: 0, s: plateau, src: 'stock', n: 0 });
  const fm = cummax(C.withForce.s);
  C.m.forEach((m, i) => c.push({ x: rig + K * perUnit.ins * m, s: fm[i], src: 'force', n: K * m, inst: rig > 0 }));
  return [g, r, c];
}
function keep(list) {                                   // the one-point rule: a plan is kept when it is dearer than every kept plan and better than the last kept by at least a point
  const s = list.slice().sort((a, b) => a.x - b.x || b.s - a.s), out = [];
  for (const p of s) { if (!out.length) out.push(p); else { const last = out[out.length - 1]; if (p.x >= last.x && p.s >= last.s + MIN - 1e-12) out.push(p); } }
  return out;
}
function model(K, rig, sim, noInst) {
  const cols = raw(K, rig, sim).map((l) => keep(noInst ? l.filter((p) => !p.inst) : l));
  return cols;
}
const prodOf = (lv) => lv[0] * lv[1] * lv[2];
function exhaustive(cols, B, obj) {                       // every plan: one point per column, within the budget; obj 'ln' (the product) or 'sum'
  let best = null;
  for (let i = 0; i < cols[0].length; i++) for (let j = 0; j < cols[1].length; j++) for (let k = 0; k < cols[2].length; k++) {
    const x = cols[0][i].x + cols[1][j].x + cols[2][k].x; if (x > B + 1e-9) continue;
    const v = obj === 'sum' ? cols[0][i].s + cols[1][j].s + cols[2][k].s : Math.log(cols[0][i].s) + Math.log(cols[1][j].s) + Math.log(cols[2][k].s);
    if (!best || v > best.v + 1e-12) best = { v, x, idx: [i, j, k], s: [cols[0][i].s, cols[1][j].s, cols[2][k].s], pts: [cols[0][i], cols[1][j], cols[2][k]] };
  }
  best.P = prodOf(best.s); return best;
}
/* the blocks of a column by the steepest chord: from the plan we stand on, the next plan is the one that gains most ln s per dollar (the farthest on a tie) */
function blocksOf(col, ci) {
  const out = []; let i = 0;
  while (i < col.length - 1) {
    let bj = -1, bl = -Infinity;
    for (let j = i + 1; j < col.length; j++) { const l = Math.log(col[j].s / col[i].s) / (col[j].x - col[i].x); if (l > bl - 1e-15) { bl = l; bj = j; } }
    out.push({ col: ci, from: i, to: bj, dx: col[bj].x - col[i].x, lam: bl, pt: col[bj] }); i = bj;
  }
  return out;
}
const sequence = (cols) => [].concat(...cols.map((c, ci) => blocksOf(c, ci))).sort((a, b) => b.lam - a.lam || a.col - b.col);
function ruleOf(cols, B) {
  const at = [0, 0, 0], closed = [false, false, false]; let left = B;
  for (const b of sequence(cols)) { if (closed[b.col] || at[b.col] !== b.from) continue; if (b.dx <= left + 1e-9) { left -= b.dx; at[b.col] = b.to; } else closed[b.col] = true; }
  for (;;) {                                            // what is left buys the best single step that fits
    let bj = -1, bl = 0;
    for (let c = 0; c < 3; c++) { const nx = cols[c][at[c] + 1]; if (!nx) continue; const dx = nx.x - cols[c][at[c]].x; if (dx > left + 1e-9) continue; const l = Math.log(nx.s / cols[c][at[c]].s) / dx; if (l > bl) { bl = l; bj = c; } }
    if (bj < 0) break; left -= cols[bj][at[bj] + 1].x - cols[bj][at[bj]].x; at[bj]++;
  }
  const s = at.map((a, c) => cols[c][a].s); return { s, P: prodOf(s), at, spent: B - left };
}
/* lesson 2's order: sources by dollars per hour; each bought to the end of its catalogue (what is left buys the largest plan of it that fits) */
const HOURLY = { sim: pSim, twin: A.curate_per_h, old: A.curate_per_h, video: pVideoAttempted, corr: pCorr, own: pOwn, force: pForceNoRig };
const ORDER = Object.keys(HOURLY).sort((a, b) => HOURLY[a] - HOURLY[b]);
const family = (src) => (src.startsWith('sim') ? 'sim' : (src === 'g05' || src === 'g10' || src === 'ownL') ? 'own' : src);
function rankOf(cols, B) {
  let left = B; const s = cols.map((c) => c[0].s);
  for (const fam of ORDER) for (let c = 0; c < 3; c++) {
    const mine = cols[c].filter((p, i) => i > 0 && family(p.src) === fam && p.x <= left + 1e-9); if (!mine.length) continue;
    const p = mine[mine.length - 1]; left -= p.x; s[c] = Math.max(s[c], p.s);
  }
  return { s, P: prodOf(s), spent: B - left };
}
function mixtureOf(cols, f, B) { const s = cols.map((c, j) => { let v = c[0].s; for (const p of c) if (p.x <= f[j] * B + 1e-9) v = p.s; return v; }); return { s, P: prodOf(s) }; }
function tunedShares(cols, B) { const b = exhaustive(cols, B); return b.x === 0 ? [0, 0, 0] : [0, 1, 2].map((c) => b.pts[c].x / b.x); }
function firstBuy(fn) { let lo = 1, hi = 1e10; for (let i = 0; i < 80; i++) { const m = Math.sqrt(lo * hi); if (fn(m).s[2] > 0.7) hi = m; else lo = m; } return hi; }
function exactThreshold(cols) {
  const noForce = cols.map((c) => c.filter((p) => p.src !== 'force' && p.src !== 'corr')), plans = [];
  for (let i = 0; i < cols[0].length; i++) for (let j = 0; j < cols[1].length; j++) for (let k = 0; k < cols[2].length; k++) if (cols[2][k].src === 'force') plans.push({ x: cols[0][i].x + cols[1][j].x + cols[2][k].x, P: cols[0][i].s * cols[1][j].s * cols[2][k].s });
  plans.sort((a, b) => a.x - b.x);
  for (const p of plans) if (p.P > exhaustive(noForce, p.x).P + 1e-12) return p.x;
  return Infinity;
}
const GRID = []; for (let i = 0; i <= 40; i++) GRID.push(Math.pow(10, 1 + i / 8));      // the widget's budgets: $10 to $1,000,000, eight steps a decade
const KS = [1, 10, 100, 1000, 10000], RIGS = [0, 5000, 15000, 30000, 60000], SIMS = ['sim0.003', 'sim0.01', 'sim0.03'];
const M0 = model(1000, A.force_rig_cost, 'sim0.01'), M0no = model(1000, A.force_rig_cost, 'sim0.01', true);
const pc = (x) => 100 * x;

/* ───── the ledger lines (Table 1, scale 1) ───── */
{
  const m1 = model(1, A.force_rig_cost, 'sim0.01');
  put('s0_gen', pc(m1[0][0].s), 1); put('s0_rec', pc(m1[1][0].s), 1); put('s0_con', pc(m1[2][0].s), 1); put('P0', pc(prodOf(m1.map((c) => c[0].s))), 1);
  const find = (c, src, n) => m1[c].find((p) => p.src === src && Math.abs(p.n - n) < 1e-9);
  const sim256 = find(0, 'sim', 256), tw128 = find(0, 'twin', 128), tw256 = find(0, 'twin', 256);
  put('t1_sim_x', sim256.x, 3); put('t1_sim_s', pc(sim256.s), 1); put('t1_tw128_x', tw128.x, 2); put('t1_tw128_s', pc(tw128.s), 1); put('t1_tw256_x', tw256.x, 2); put('t1_tw256_s', pc(tw256.s), 1);
  [2, 3, 5, 10, 20].forEach((n) => { const p = find(1, 'g10', n); check(p, 'gust plan ' + n); if (p) { put('t1_g' + n + '_x', p.x, 2); put('t1_g' + n + '_s', pc(p.s), 1); } });
  const f1 = find(2, 'force', 1), f10 = find(2, 'force', 10);
  put('t1_f1_x', f1.x - A.force_rig_cost, 2); put('t1_f1_s', pc(f1.s), 1); put('t1_f10_x', f10.x - A.force_rig_cost, 2); put('t1_f10_s', pc(f10.s), 1);
  put('t1_ins_hours10', 10 * SEC_INS / 3600, 4);
  const kept = (c) => m1[c].map((p) => p.src); check(!kept(0).some((s) => s === 'old' || s === 'video' || s === 'ownL'), 'the older arm, footage and more own layouts are on no cost-to-reach curve');
  check(!kept(1).some((s) => s === 'g05' || s === 'corr'), 'gust 0.05 and corrections are on no cost-to-reach curve');
  // why corrections are dropped: three rounds on the calm demonstrations against ten gust demonstrations, within the table's noise
  const corrCells = raw(1, A.force_rig_cost, 'sim0.01')[1].filter((p) => p.src === 'corr'), c3 = corrCells[2];
  put('corr3_s', pc(c3.s), 1); put('corr3_sup', c3.x - 2 * A.week_cost, 2); put('g10_10_s', pc(R.g10.s[R.n.indexOf(10)]), 1); put('g10_10_x', perUnit.own * 10, 2);
  put('corr3_lo', pc(R.corr.lo[3]), 1); put('corr3_hi', pc(R.corr.hi[3]), 1); put('g10_10_lo', pc(R.g10.lo[R.n.indexOf(10)]), 1); put('g10_10_hi', pc(R.g10.hi[R.n.indexOf(10)]), 1);
  // the rule for a plan to count as better: with no such rule the best plan's P differs from the model's by at most this at any of the grid budgets (budgets x K = 1000)
  const rawCols = raw(1000, A.force_rig_cost, 'sim0.01').map((l) => l.slice().sort((a, b) => a.x - b.x)); let maxd = 0;
  for (const B of GRID) { const a = exhaustive(rawCols, B).P, b = exhaustive(M0, B).P; check(a >= b - 1e-12, 'the raw search cannot be worse than the model'); maxd = Math.max(maxd, a / b - 1); }
  put('rule_pt_maxgain', pc(maxd), 1);
  const lay = Math.pow(5.8, 4); put('k4', lay, 0);
  put('bench_total', exhaustive(m1, 1e6).x - A.force_rig_cost, 2);               // everything but the rig, at K = 1
}

/* ───── the sequence at K = 1,000 (Table 2) ───── */
const seq = sequence(M0);
{
  const cum = []; let t = 0; for (const b of seq) { t += b.dx; cum.push(t); }
  seq.forEach((b, i) => { const k = i + 1; put('b' + k + '_dx', b.dx, 0); put('b' + k + '_lam', b.lam * 1000, 4); put('b' + k + '_cum', cum[i], 0); put('b' + k + '_s', pc(b.pt.s), 1); put('b' + k + '_n', b.pt.n, 0); });
  put('nblocks', seq.length, 0); put('total_cost', t, 0);
  check(seq.map((b) => b.pt.src).join(',') === 'sim,sim,sim,sim,sim,sim,g10,g10,g10,twin,force,twin,g10', 'order of blocks at K = 1000: ' + seq.map((b) => b.pt.src).join(','));
  put('lam_ratio', seq[0].lam / seq[seq.length - 1].lam, 0);
  put('sim_share', 100 * cum[5] / t, 2);
  put('b11_dx_hours', M0[2][1].x - A.force_rig_cost, 0);
  const rigBlock = seq[10]; check(rigBlock.pt.src === 'force' && rigBlock.pt.n === 10000, 'the 11th block is the rig and 10,000 insertions');
  put('rig_block_cost', rigBlock.dx, 0); put('rig_block_gain', Math.log(rigBlock.pt.s / M0[2][0].s), 3); put('rig_block_lam', rigBlock.lam * 1000, 4);
  put('twin_tail_lam', seq[11].lam * 1000, 4); put('gust_tail_lam', seq[12].lam * 1000, 4); put('twin_net', seq[9].dx, 0); put('twin128_cost', M0[0].find((p) => p.src === 'twin' && p.n === 128000).x, 0);
  put('step1_first', M0[2][1].x, 0); put('step1_gain', Math.log(M0[2][1].s / M0[2][0].s), 3); put('step1_lam', Math.log(M0[2][1].s / M0[2][0].s) / M0[2][1].x * 1000, 4);
  put('step2_lam', Math.log(M0[2][2].s / M0[2][1].s) / (M0[2][2].x - M0[2][1].x) * 1000, 4);
  // lambda is proportional to 1/s: the weakest first
  put('lam_gen_start_ratio', Math.log(M0[0][1].s / M0[0][0].s) / M0[0][1].x / (Math.log(M0[1][2].s / M0[1][0].s) / M0[1][2].x), 1);
  // order independent of K (hour-only blocks), the rig block's place by K
  const hourOrder = (K) => sequence(model(K, A.force_rig_cost, 'sim0.01')).filter((b) => b.pt.src !== 'force').map((b) => b.pt.src + b.pt.n / K).join(',');
  const base = hourOrder(1); for (const K of KS) check(hourOrder(K) === base, 'the order of the hour-only blocks must not depend on K (K = ' + K + ')');
  for (const K of KS) { const sq = sequence(model(K, A.force_rig_cost, 'sim0.01')); put('rigrank_K' + K, 1 + sq.findIndex((b) => b.pt.src === 'force'), 0); put('nbl_K' + K, sq.length, 0); }
  for (const K of [1, 10]) { const sq = sequence(model(K, A.force_rig_cost, 'sim0.01')); put('lamK_' + K + '_first', sq[0].lam, 3); }
  const lam1 = sequence(model(1, A.force_rig_cost, 'sim0.01')); put('K1_first_lam', lam1[0].lam, 2); put('K1_last_hour_lam', lam1.filter((b) => b.pt.src !== 'force').slice(-1)[0].lam * 1000, 3); put('K1_rig_lam', lam1.find((b) => b.pt.src === 'force').lam * 1000, 4);
  // the rule is the best plan wherever the budget ends on a block
  let c2 = 0; for (let i = 0; i < seq.length; i++) { const B = cum[i]; const r = ruleOf(M0, B + 1e-6), e = exhaustive(M0, B + 1e-6); check(Math.abs(r.P - e.P) < 1e-9, `the rule must be the best plan at the block boundary ${B.toFixed(0)}: ${r.P} vs ${e.P}`); c2++; }
  put('boundaries_checked', c2, 0);
  let worst = 0, mean = 0, wB = 0; for (const B of GRID) { const r = ruleOf(M0, B), e = exhaustive(M0, B); check(r.P <= e.P + 1e-12, 'the rule cannot beat the exhaustive search'); const g = 1 - r.P / e.P; mean += g / GRID.length; if (g > worst) { worst = g; wB = B; } }
  put('rule_worst_gap', pc(worst), 1); put('rule_worst_B', wB, 0); put('rule_mean_gap', pc(mean), 2);
  const m0r = model(1000, 0, 'sim0.01'); let w0 = 0; for (const B of GRID) { const g = 1 - ruleOf(m0r, B).P / exhaustive(m0r, B).P; w0 = Math.max(w0, g); } put('rule_worst_gap_norig', pc(w0), 1);
}

/* ───── the exact path, and the rules at equal budgets (Table 3) ───── */
const BUD = { b1334: GRID[17], b10k: GRID[24], b23k: GRID[27], b42k: GRID[29], b17k: GRID[26], b13k: GRID[25], b31k: GRID[28], b100k: GRID[32] };
{
  const f = tunedShares(M0, BUD.b10k); put('mix10_gen', pc(f[0]), 0); put('mix10_rec', pc(f[1]), 0); put('mix10_con', pc(f[2]), 0);
  for (const [tag, B] of [['1334', BUD.b1334], ['10k', BUD.b10k], ['23k', BUD.b23k], ['42k', BUD.b42k], ['17k', BUD.b17k], ['31k', BUD.b31k], ['100k', BUD.b100k]]) {
    const e = exhaustive(M0, B), r = ruleOf(M0, B), it = exhaustive(M0no, B), rk = rankOf(M0, B), mx = mixtureOf(M0, f, B), sm = exhaustive(M0, B, 'sum'), sh = tunedShares(M0, B);
    put('x_' + tag + '_best', pc(e.P), 1); put('x_' + tag + '_rule', pc(r.P), 1); put('x_' + tag + '_item', pc(it.P), 1); put('x_' + tag + '_rank', pc(rk.P), 1); put('x_' + tag + '_mix', pc(mx.P), 1); put('x_' + tag + '_sum', pc(sm.P), 1);
    put('x_' + tag + '_spent', e.x, 0); put('x_' + tag + '_gen', pc(e.s[0]), 1); put('x_' + tag + '_rec', pc(e.s[1]), 1); put('x_' + tag + '_con', pc(e.s[2]), 1);
    put('sh_' + tag + '_gen', pc(sh[0]), 0); put('sh_' + tag + '_rec', pc(sh[1]), 0); put('sh_' + tag + '_con', pc(sh[2]), 0);
    put('x_' + tag + '_rank_spent', rk.spent, 0); put('x_' + tag + '_rank_gen', pc(rk.s[0]), 1); put('x_' + tag + '_rank_rec', pc(rk.s[1]), 1);
  }
  check(F.x_10k_mix === F.x_10k_best, 'a mixture is exactly the best plan at the budget it was tuned for');
  // the shares of the best plan across the budgets: the generalise share
  const shg = GRID.filter((B) => B >= 100).map((B) => tunedShares(M0, B)[0]); put('share_gen_max', pc(Math.max(...shg)), 0); put('share_gen_min', pc(Math.min(...shg.filter((x) => x > 0))), 1);
  put('x_100_gen_share', pc(tunedShares(M0, GRID[8])[0]), 0);
  // the best of 231 fixed share vectors over the 41 budgets: the most it keeps at the worst budget
  const opt = GRID.map((B) => exhaustive(M0, B).P); let bestW = null, bestM = null;
  for (let a = 0; a <= 20; a++) for (let b = 0; a + b <= 20; b++) {
    const f2 = [a / 20, b / 20, (20 - a - b) / 20]; let worst = Infinity, tot = 0;
    GRID.forEach((B, i) => { const r = mixtureOf(M0, f2, B).P / opt[i]; worst = Math.min(worst, r); tot += Math.log(r); });
    if (!bestW || worst > bestW.worst + 1e-12) bestW = { f: f2, worst }; if (!bestM || tot > bestM.tot + 1e-12) bestM = { f: f2, tot: tot / GRID.length, worst };
  }
  put('fm_minimax_worst', pc(bestW.worst), 1); put('fm_minimax_gen', pc(bestW.f[0]), 0); put('fm_minimax_rec', pc(bestW.f[1]), 0); put('fm_minimax_con', pc(bestW.f[2]), 0); put('fm_mean_worst', pc(bestM.worst), 1); put('fm_n', 231, 0);
  // the sum picks the same plan as the product at every grid budget with the 1 % simulator
  let same = 0; for (const B of GRID) { const a = exhaustive(M0, B), b = exhaustive(M0, B, 'sum'); if (Math.abs(a.P - b.P) < 1e-9) same++; } put('sum_same', same, 0); put('n_grid', GRID.length, 0);
  const M3 = model(1000, A.force_rig_cost, 'sim0.03'); let gw = 0, gB = 0, gE = 0, gS = 0;
  for (const B of GRID) { const a = exhaustive(M3, B), b = exhaustive(M3, B, 'sum'); const g = 1 - b.P / a.P; if (g > gw + 1e-12) { gw = g; gB = B; gE = a.P; gS = b.P; } }
  put('sum3_gap', pc(gw), 1); put('sum3_B', gB, 0); put('sum3_best', pc(gE), 1); put('sum3_sum', pc(gS), 1); put('sum3_budget', GRID[16], 0); put('sum3_best_1000', pc(exhaustive(M3, GRID[16]).P), 1); put('sum3_sum_1000', pc(exhaustive(M3, GRID[16], 'sum').P), 1);
  // the minimum
  const eq = [];  // every plan within $10,000 whose smallest level is the contact plateau, and the spread of their P
  let mm = null; for (let i = 0; i < M0[0].length; i++) for (let j = 0; j < M0[1].length; j++) for (let k = 0; k < M0[2].length; k++) { const x = M0[0][i].x + M0[1][j].x + M0[2][k].x; if (x > BUD.b10k + 1e-9) continue; const v = Math.min(M0[0][i].s, M0[1][j].s, M0[2][k].s); if (!mm || v > mm.v + 1e-12 || (Math.abs(v - mm.v) < 1e-12 && x < mm.x)) mm = { v, x, P: M0[0][i].s * M0[1][j].s * M0[2][k].s }; }
  let lo = Infinity, hi = 0, cnt = 0; for (let i = 0; i < M0[0].length; i++) for (let j = 0; j < M0[1].length; j++) for (let k = 0; k < M0[2].length; k++) { const x = M0[0][i].x + M0[1][j].x + M0[2][k].x; if (x > BUD.b10k + 1e-9) continue; const v = Math.min(M0[0][i].s, M0[1][j].s, M0[2][k].s); if (Math.abs(v - mm.v) < 1e-12) { const P = M0[0][i].s * M0[1][j].s * M0[2][k].s; lo = Math.min(lo, P); hi = Math.max(hi, P); cnt++; } }
  put('min_value', pc(mm.v), 1); put('min_spend', mm.x, 0); put('min_P', pc(mm.P), 1); put('min_ties', cnt, 0); put('min_lo', pc(lo), 1); put('min_hi', pc(hi), 1);
}

/* ───── the instrument ───── */
{
  const th = {};
  for (const K of KS) { const m = model(K, A.force_rig_cost, 'sim0.01'), mn = model(K, A.force_rig_cost, 'sim0.01', true); th[K] = { exact: exactThreshold(m), rule: firstBuy((B) => ruleOf(m, B)), rank: firstBuy((B) => rankOf(m, B)) };
    put('th_exact_K' + K, th[K].exact, 0); put('th_rule_K' + K, th[K].rule, 0); put('th_rank_K' + K, th[K].rank, 0); }
  check(th[1000].exact < th[1000].rule && th[1000].rule < th[1000].rank, 'at K = 1000 the best plan buys the instrument before the block order, which buys it before the price rank');
  check(th[10000].exact < th[10000].rule && th[10000].rule < th[10000].rank, 'at K = 10000 too');
  check(th[1].rank - th[1].exact < 20, 'at K = 1 the three rules start the instrument within $20 of each other');
  put('th_gap_K1', th[1].rank - th[1].exact, 0); put('th_ratio_K1000', th[1000].rank / th[1000].exact, 2); put('th_ratio_K10000', th[10000].rank / th[10000].exact, 1);
  // the plan at the exact threshold, and the item-by-item plan at every budget
  const e = exhaustive(M0, th[1000].exact + 1e-6); put('thx_P', pc(e.P), 1); put('thx_spent', e.x, 0); put('thx_gen', pc(e.s[0]), 1); put('thx_rec', pc(e.s[1]), 1); put('thx_con', pc(e.s[2]), 1);
  put('thx_ins_n', e.pts[2].n, 0); put('thx_rig_share', pc(A.force_rig_cost / e.x), 0);
  const e2 = exhaustive(M0, th[1000].exact + 1000); put('thx2_P', pc(e2.P), 1);
  const noI = exhaustive(M0no, 1e9); put('item_P', pc(noI.P), 1); put('item_cost', noI.x, 0); put('item_gen', pc(noI.s[0]), 1); put('item_rec', pc(noI.s[1]), 1);
  check(Math.abs(exhaustive(M0no, 1e6).P - noI.P) < 1e-12, 'the item-by-item plan does not improve with money');
  // the path of the best plan: when the twin enters, leaves (for the rig) and returns
  let prev = '', ev = [];
  for (let l = 1; l <= 6; l += 0.001) { const B = Math.pow(10, l), b = exhaustive(M0, B); const key = b.pts.map((p) => p.src).join(','); if (key !== prev) { ev.push({ B, spent: b.x, key, P: b.P, s: b.s }); prev = key; } }
  const tin = ev.find((v) => v.key.startsWith('twin')); const rin = ev.find((v) => v.key.endsWith('force')); const tback = ev.find((v) => v.key.startsWith('twin') && v.key.endsWith('force'));
  put('ev_twin_in', tin.spent, 0); put('ev_rig_in', rin.spent, 0); put('ev_twin_back', tback.spent, 0);
  check(rin.key.startsWith('sim'), 'the plan that buys the rig first holds the simulator, not the twin');
  put('ev_rig_in_P', pc(rin.P), 1);
  // the rig as a lump, against the rig per hour (lesson 2): the rig written off over the arm's 4,000 wall-clock hours is amort_h dollars of every kept motion hour of force data
  const kept = A.force_duty * (1 - A.discard), amortH = A.force_rig_cost / A.arm_life_h / kept, insHours = 10000 * SEC_INS / 3600;
  put('amort_h', amortH, 2); put('amort_wall', A.force_rig_cost / A.arm_life_h, 2); put('life_K', A.arm_life_h * kept / (10 * SEC_INS / 3600), 0);
  put('hours_K1000', insHours, 1); put('amort_charge', insHours * amortH, 0); put('lump_ratio', A.force_rig_cost / (insHours * amortH), 0);
  near(amortH, pForceL2 - pForceNoRig, 1e-9, 'the rig share of lesson 2\'s force hour');
  // K = 1: the whole bill is the rig
  const m1 = model(1, A.force_rig_cost, 'sim0.01'); const full1 = exhaustive(m1, 1e9); put('K1_full_cost', full1.x, 2); put('K1_rig_share', 100 * A.force_rig_cost / full1.x, 2); put('K1_full_P', pc(full1.P), 1);
  put('full_P', pc(exhaustive(M0, 1e9).P), 1); put('full_cost', exhaustive(M0, 1e9).x, 0);
  // the break-even for the rig against the best alternative left at the threshold: the price at which the block's average equals the tail's value per dollar
  const tailLam = seq[11].lam, gain = Math.log(M0[2][2].s / M0[2][0].s), hours = M0[2][2].x - A.force_rig_cost; put('rig_breakeven', gain / tailLam - hours, 0);
  // a rig that costs nothing: the lump disappears and the rule is the best plan at the block boundaries
  const mz = model(1000, 0, 'sim0.01'); put('norig_thr', exactThreshold(mz), 0);
  // the road not taken: amortise the rig into the hour (lesson 2's price)
  const insAm = pForceL2 * SEC_INS / 3600; const mAm = model(1000, 0, 'sim0.01'); mAm[2] = keep(raw(1000, 0, 'sim0.01')[2].map((p) => (p.src === 'force' ? Object.assign({}, p, { x: 1000 * insAm * p.n / 1000 }) : p)));
  const amPlan = exhaustive(mAm, 1e9); put('am_cost', amPlan.x, 0); put('am_P', pc(amPlan.P), 1); put('am_ins', insAm, 4);
  const real = exhaustive(M0, 1e9); put('am_real', real.x, 0); put('am_short', real.x - amPlan.x, 0);
  put('am_at_budget', pc(exhaustive(M0, amPlan.x).P), 1);
}

/* ───── what the plan assumed: only a share q of the hours is new ───── */
{
  const cell = (ns, ss, n) => { if (n <= ns[0]) return ss[0]; for (let i = 1; i < ns.length; i++) if (n <= ns[i]) return ss[i - 1] + (ss[i] - ss[i - 1]) * (n - ns[i - 1]) / (ns[i] - ns[i - 1]); return ss[ss.length - 1]; };
  const plan = exhaustive(M0, 1e9), full = plan.s;
  for (const [tag, q] of [['1', 1], ['2', 0.5], ['4', 0.25]]) {
    const g = cell([0].concat(S.M.slice(1)), [S.src.twin.s['8'][0]].concat(S.src.twin.s['8'].slice(1)), 256 * q), r = cell(R.n, R.g10.s, 20 * q), c = cell(C.m, C.withForce.s, 10 * q), P = g * r * c;
    put('q' + tag + '_gen', pc(g), 1); put('q' + tag + '_rec', pc(r), 1); put('q' + tag + '_con', pc(c), 1); put('q' + tag + '_P', pc(P), 1);
  }
  near(F.q1_P, pc(plan.P), 0.06, 'the plan with every hour new is the full plan'); put('q_budget', plan.x, 0); put('q_drop', F.q1_P - F.q4_P, 1);
  put('batons_q', 100 * 800 / 100000, 1);
}

/* ───── the checkpoint: a small exact instance, done by brute force ───── */
{
  const cols = [[{ x: 0, s: 0.40 }, { x: 20, s: 0.60 }, { x: 50, s: 0.80 }], [{ x: 0, s: 0.50 }, { x: 80, s: 0.90, inst: true }], [{ x: 0, s: 1 }]];
  const lam = (c, i) => Math.log(cols[c][i].s / cols[c][i - 1].s) / (cols[c][i].x - cols[c][i - 1].x);
  put('ck_lamA1', lam(0, 1), 4); put('ck_lamA2', lam(0, 2), 4); put('ck_lamB', Math.log(0.9 / 0.5) / 80, 4); put('ck_gainB', Math.log(0.9 / 0.5), 3); put('ck_gainA1', Math.log(0.6 / 0.4), 3);
  const best = (B, noI) => { let b = null; for (const a of cols[0]) for (const c of cols[1]) { if (noI && c.inst) continue; if (a.x + c.x > B) continue; const P = a.s * c.s; if (!b || P > b.P + 1e-12) b = { P, a, c }; } return b; };
  put('ck_best100', best(100).P, 2); put('ck_item100', best(100, true).P, 2); put('ck_best90', best(90).P, 2); put('ck_best130', best(130).P, 2); put('ck_best100_x', best(100).a.x + best(100).c.x, 0);
  check(best(100).a.x === 20 && best(100).c.inst, 'at $100 the best plan holds A1 and the instrument, not A2');
  // the rule: blocks in order of lambda, then the best step that fits
  const ruleAt = (B) => { const order = [[0, 1, lam(0, 1), 20], [0, 2, lam(0, 2), 30], [1, 1, Math.log(0.9 / 0.5) / 80, 80]].sort((p, q) => q[2] - p[2]); let left = B, at = [0, 0]; for (const [c, k, , dx] of order) { if (at[c] !== k - 1) continue; if (dx <= left) { left -= dx; at[c] = k; } } return cols[0][at[0]].s * cols[1][at[1]].s; };
  put('ck_rule100', ruleAt(100), 2); put('ck_rule130', ruleAt(130), 2);
}

/* ───── a few more numbers the prose quotes ───── */
{
  const at = (c, src, n) => M0[c].find((p) => p.src === src && Math.abs(p.n - n) < 1e-6);
  put('p_sim256_K1000', at(0, 'sim', 256000).x, 0); put('twin256_K1000', at(0, 'twin', 256000).x, 0); put('g20_K1000', at(1, 'g10', 20000).x, 0); put('g2_K1000', at(1, 'g10', 2000).x, 0);
  put('x_23k_rank_left', BUD.b23k - F.x_23k_rank_spent, 0); put('con_full_K1', A.force_rig_cost + 10 * perUnit.ins, 0);
  const f10 = tunedShares(M0, BUD.b10k); put('mix10_rec_1334', f10[1] * BUD.b1334, 0); put('mix10_gen_1334', f10[0] * BUD.b1334, 0);
  const s1 = at(2, 'force', 1000), s2 = at(2, 'force', 10000); put('step2_gain', Math.log(s2.s / s1.s), 3); put('step2_dx', s2.x - s1.x, 0);
  put('ck_gainA2', Math.log(0.8 / 0.6), 3); put('thx_hours', 1000 * perUnit.ins, 0);
}

/* ───── the states of the widget the prose names: independent values, then the widget's ───── */
const STATES = [['d', 27, 3, 2, 1], ['b10', 24, 3, 2, 1], ['b17', 26, 3, 2, 1], ['b31', 28, 3, 2, 1], ['b42', 29, 3, 2, 1], ['b13', 17, 3, 2, 1], ['b100', 32, 3, 2, 1], ['k1', 27, 0, 2, 1], ['k4', 27, 4, 2, 1], ['r0', 27, 3, 0, 1], ['r30', 27, 3, 3, 1], ['r60', 27, 3, 4, 1],
  ['s3', 16, 3, 2, 2], ['s03', 16, 3, 2, 0], ['k2', 20, 2, 1, 1]];
const SV = {};
for (const [tag, bi, ki, ri, si] of STATES) {
  const K = KS[ki], rig = RIGS[ri], B = GRID[bi], m = model(K, rig, SIMS[si]), mn = model(K, rig, SIMS[si], true);
  const e = exhaustive(m, B), r = ruleOf(m, B), it = exhaustive(mn, B), rk = rankOf(m, B), sm = exhaustive(m, B, 'sum'), f = tunedShares(m, B);
  const th = { exact: exactThreshold(m), rule: firstBuy((b) => ruleOf(m, b)), rank: firstBuy((b) => rankOf(m, b)) };
  const v = { B, e, r, it, rk, sm, th, mixh: mixtureOf(m, f, B / 2).P, mixd: mixtureOf(m, f, 2 * B).P, bh: exhaustive(m, B / 2).P, bd: exhaustive(m, 2 * B).P };
  SV[tag] = v;
  put('w_' + tag + '_spent', e.x, 0); put('w_' + tag + '_gen', pc(e.s[0]), 1); put('w_' + tag + '_rec', pc(e.s[1]), 1); put('w_' + tag + '_con', pc(e.s[2]), 1); put('w_' + tag + '_P', pc(e.P), 1);
  put('w_' + tag + '_rule', pc(r.P), 1); put('w_' + tag + '_item', pc(it.P), 1); put('w_' + tag + '_rank', pc(rk.P), 1); put('w_' + tag + '_sum', pc(sm.P), 1);
  put('w_' + tag + '_mixh', pc(v.mixh), 1); put('w_' + tag + '_mixd', pc(v.mixd), 1); put('w_' + tag + '_bh', pc(v.bh), 1); put('w_' + tag + '_bd', pc(v.bd), 1);
  put('w_' + tag + '_thb', th.exact, 0); put('w_' + tag + '_thr', th.rule, 0); put('w_' + tag + '_thk', th.rank, 0);
}
check(F.w_d_P === F.x_23k_best, 'the default state is the $23,714 row');
put('sat_ratio', (A.force_rig_cost + 10 * perUnit.ins) / (perUnit.sim * 256), 0);
check(SV.r0.th.exact < SV.d.th.exact, 'a rig that costs nothing is bought sooner');

/* ───── the widget prints what the independent computation gives ───── */
const html = path.join(root, dir, '06_the_allocation_problem.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what, rel) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9 + (rel || 0) * Math.abs(want))) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const second = (id) => { const mm = /\(best plan ([\d.]+) %\)/.exec(pg.text(id)); return mm ? parseFloat(mm[1]) : NaN; };
  for (const [tag, bi, ki, ri, si] of STATES) {
    pg.set('w06-bud', bi); pg.set('w06-k', ki); pg.set('w06-rig', ri); pg.set('w06-sim', SIMS[si]); pg.drain();
    const v = SV[tag], e = v.e, w = 'state ' + tag;
    eqd('w06-spent', e.x, 0, w + ' spent'); eqd('w06-gen', pc(e.s[0]), 1, w + ' generalise'); eqd('w06-rec', pc(e.s[1]), 1, w + ' recover'); eqd('w06-con', pc(e.s[2]), 1, w + ' contact'); eqd('w06-P', pc(e.P), 1, w + ' P');
    eqd('w06-rule', pc(v.r.P), 1, w + ' block order'); eqd('w06-item', pc(v.it.P), 1, w + ' item by item'); eqd('w06-rank', pc(v.rk.P), 1, w + ' price rank'); eqd('w06-sum', pc(v.sm.P), 1, w + ' sum');
    eqd('w06-mixh', pc(v.mixh), 1, w + ' mixture at half'); eqd('w06-mixd', pc(v.mixd), 1, w + ' mixture at double');
    check(Math.abs(second('w06-mixh') - pc(v.bh)) < 0.051, w + ': best plan at half the budget'); check(Math.abs(second('w06-mixd') - pc(v.bd)) < 0.051, w + ': best plan at twice the budget');
    eqd('w06-thb', v.th.exact, 0, w + ' threshold, best plan'); eqd('w06-thr', v.th.rule, 0, w + ' threshold, block order', 1e-4); eqd('w06-thk', v.th.rank, 0, w + ' threshold, price rank', 1e-4);
  }
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
