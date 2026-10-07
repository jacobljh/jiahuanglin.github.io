'use strict';
/* syn_lab.js — the canonical experiment of the Synthetic Vision Data series, shared by build_tables.js (which writes tables.js) and by the per-lesson oracles.
 *
 *   canon({pick, N, seed})   train the fixed detector on N frames of a hybrid program (pick = four letters for scene, look, sensor, label; a = the program SIM0,
 *                            b = the real street), then grade it on the real street:
 *                              realMiss      miss rate at 10 % false alarms (threshold from 1500 real validation frames) over pedestrians with >= 6 visible px^2
 *                              ownMiss/ownAUC the same exam on the training program's own frames (threshold from its own validation frames)
 *                              carriedFA     false-alarm rate on real pedestrian-free frames when the threshold is the one chosen on the training program (operating-point transfer)
 *                              logsAlarm     the alarm rate of that threshold on 1000 unlabelled real frames (pedestrians are rare in them) — the label-free gap meter
 *                              domAUC        AUC between the detector's scores on real unlabelled frames and on the program's pedestrian-free frames (0.5 = indistinguishable)
 *                            It returns a plain object plus the model, whose weights are rounded to 5 significant digits: a page that embeds them scores exactly as this code did.
 *   node syn_lab.js '{"pick":"aaaa","N":160,"seed":1}'     prints one JSON line (no weights unless "model":true)
 * Every number is a function of fixed seeds; there is no Math.random and no Date in the lab. */
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '../../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new/street.js')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));

const NT = 3000, NV = 1500, NLOG = 1000, NOWN_V = 800, NOWN_T = 1500;
const r5 = (x) => +Number(x).toPrecision(5);
const roundModel = (m) => ({ dim: m.dim, w: Array.from(m.w, r5), mu: Array.from(m.mu, r5), sd: Array.from(m.sd, r5), n: m.n });
const pipeOf = (pick) => { const p = {}; ['scene', 'look', 'sensor', 'label'].forEach((k, i) => { p[k] = pick[i]; }); return SV.hybrid(SV.SIM0, SV.REAL, p); };
const scores = (m, set) => SV.scoreSet(m, set);
const negs = (set, sc) => sc.filter((_, i) => !set[i].y);
const r4 = (x) => (x === null || x === undefined || !isFinite(x)) ? null : +x.toFixed(4);

let _real = null;                                   // the real test / validation / log frames are the same for every job: build once per process
const real = () => _real || (_real = { test: SV.real.test(NT), val: SV.real.val(NV), logs: SV.real.logs(NLOG) });

function canonPipe(pipe, N, seed, tag) {
  const train = SV.makeSet(pipe, N, SV.SEEDS.train + seed * 100000);
  const model = roundModel(SV.train(train, { seed: seed }));
  const R = real(), sT = scores(model, R.test), sV = scores(model, R.val), sL = scores(model, R.logs);
  const thrReal = SV.thrAtFPR(negs(R.val, sV), SV.EXAM.fa);
  const ex = SV.exam(R.test, sT, { thr: thrReal });
  const own = SV.makeSet(pipe, NOWN_V, SV.SEEDS.simVal), sO = scores(model, own), thrOwn = SV.thrAtFPR(negs(own, sO), SV.EXAM.fa);
  const ownTest = SV.makeSet(pipe, NOWN_T, SV.SEEDS.simTest), sOT = scores(model, ownTest), exOwn = SV.exam(ownTest, sOT, { thr: thrOwn });
  const carried = SV.exam(R.test, sT, { thr: thrOwn });
  const byMode = (mode) => { let k = 0, n = 0; R.test.forEach((s, i) => { if (s.y && s.area >= SV.EXAM.minArea && s.mode === mode) { n++; if (sT[i] > thrReal) k++; } }); return n ? 1 - k / n : null; };
  const out = { pick: tag, N: N, seed: seed,
    realMiss: r4(ex.miss), missOpen: r4(byMode('open')), missEmerge: r4(byMode('emerge')), realAUC: r4(ex.auc), realN: ex.n,
    ownMiss: r4(exOwn.miss), ownAUC: r4(exOwn.auc),
    carriedFA: r4(carried.fa), logsAlarm: r4(SV.rate(sL, thrOwn)), domAUC: r4(SV.auc(sL, negs(ownTest, sOT))),
    thrReal: r5(thrReal), thrOwn: r5(thrOwn) };
  return { result: out, model: model, scores: { test: sT, val: sV, logs: sL } };
}
function canon(spec) {
  const pick = spec.pick || 'aaaa';
  return canonPipe(pipeOf(pick), spec.N || 1600, spec.seed || 1, pick);
}

module.exports = { SV, canon, canonPipe, roundModel, pipeOf, real, NT, NV, NLOG };

if (require.main === module) {
  const spec = JSON.parse(process.argv[2]), t0 = process.hrtime.bigint(), r = canon(spec);
  r.result.sec = +(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1);
  if (spec.model) r.result.model = r.model;
  console.log(JSON.stringify(r.result));
}
