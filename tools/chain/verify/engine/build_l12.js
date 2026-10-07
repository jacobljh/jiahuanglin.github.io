#!/usr/bin/env node
'use strict';
/* build_l12.js — the deterministic builder of all_lessons/synthetic_vision/l12_data.js (SV.L12), the closed-loop outcome tables of Lesson 12 (proof).
 *
 *   node build_l12.js                 run every job (2 workers), merge, write l12_data.js
 *   node build_l12.js --job NAME      run one job (aaaa | aaba | abba | bbba | street | pbin); its result goes to tools/chain/syn_notes/w12/jobs/NAME.json
 *   node build_l12.js --merge         merge the job files into l12_data.js
 *   node build_l12.js --check         recompute a few cells from scratch with the l11_episode.js engine and compare them with l12_data.js
 *
 * WHAT IT STORES.  Twelve candidate SYSTEMS (the twelve distinct detectors of SV.TABLES.models: the four programs whose scene is the naive one have the same detector as the program that differs only
 * in the label rule, so a..b and a..a repeat) are run through Lesson 11's closed loop (policy: brake once two of the last three frames alarm; the lab's shuttle) in FIVE WORLDS:
 *   aaaa aaba abba bbba   the exact-stage programs of Lessons 2 to 5 with the program's walking speed (1.4 m/s)      seeds 22,000,000 + i, i < NP     (the same situations in the four programs: CRN)
 *   street                SV.REAL with the street's walking speeds (LAB PRIVILEGE: only the lab can run it)         seeds 22,500,000 + i, i < NS     (its own situations: independent of the programs')
 * Within a world every system meets the same situations (CRN).  Two OPERATING-POINT protocols: 'S' = each system's exam threshold (10% false alarms on the street's pedestrian-free validation frames: what a project
 * with free unlabelled logs sets, Lesson 10), 'W' = the exam's rule applied inside the world (10% false alarms on the world's own pedestrian-free validation frames: what a project with only the program has).
 * In the street the two protocols coincide.  Stored per world: zc (the pedestrian's near surface, mm), the step-out stratum, and per (protocol, system) the decision frames kd (a character: '0' = never, else
 * 48 + kd + 1) and the collision bits.  The stopping margin is closed-form from (zc, kd).  Seeds from 22,000,000 (the private block of Lesson 12).
 * The scorer shares the feature map between systems (the expensive part) and is checked against SV.score / l11_episode.js in --check and in the oracle. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '../../../../all_lessons/synthetic_vision');
const JOBS = path.resolve(__dirname, '../../syn_notes/w12/jobs');
const SV = require(path.join(root, 'street.js'));
require(path.join(root, 'tables.js'));
const L = require(path.join(root, 'l11_episode.js'));
const T = SV.TABLES;

const r5 = (x) => +Number(x).toPrecision(5);
const SYS = ['aaaa', 'aaba', 'abaa', 'abba', 'baaa', 'baab', 'baba', 'babb', 'bbaa', 'bbab', 'bbba', 'bbbb'];
const TWIN = { aaab: 'aaaa', aabb: 'aaba', abab: 'abaa', abbb: 'abba' };
const PROGS = ['aaaa', 'aaba', 'abba', 'bbba'];
const SEED = { prog: 22000000, street: 22500000, pbin: 22900000 };
const NP = 1000, NS = 2000, NPBIN = 1000000;
const SH = L.shuttle(), POL = L.POLICY;
const model = (code) => { const m = T.models['swap@' + code]; return { code: code, dim: SV.DIM, w: m.w, mu: m.mu, sd: m.sd, thr: m.thrReal }; };
const MODELS = SYS.map(model);
const worldOf = (id) => (id === 'street' ? L.streetWorld() : L.programWorld(id));

/* the operating point inside a world: the exam's rule (10% false alarms) on the world's own pedestrian-free validation frames (800 frames of the program's validation seed) */
function ownThresholds(world) {
  const val = SV.makeSet(world.pipe, 800, SV.SEEDS.simVal), neg = val.filter((s) => !s.y), maps = neg.map((s) => SV.featureMap(s.x));
  return MODELS.map((m) => {
    const sc = maps.map((fm) => { let best = -Infinity; for (let c = 0; c < fm.nu * fm.nv; c++) { const z = cellLogit(m, fm.F, c); if (z > best) best = z; } return best; });
    return r5(SV.thrAtFPR(sc, SV.EXAM.fa));
  });
}
/* the cell logit of street.js, written out (same arithmetic, same order: scores are bit-identical to SV.score) */
function cellLogit(m, F, c) { const dim = m.dim; let z = m.w[dim]; for (let j = 0; j < dim; j++) z += m.w[j] * (F[c * dim + j] - m.mu[j]) / m.sd[j]; return z; }
/* decision frames of every system, for several threshold vectors at once, on one situation: the frames are rendered once, their feature maps computed once */
function decideMany(sit, thrSets) {
  const kEnd = L.lastFrame(sit, SH), M = MODELS.length, S = thrSets.length;
  const kd = thrSets.map(() => new Array(M).fill(-1)), al = thrSets.map(() => MODELS.map(() => []));
  let live = M * S;
  for (let k = 0; k <= kEnd && live > 0; k++) {
    const fm = SV.featureMap(L.frame(sit, k)), nc = fm.nu * fm.nv;
    for (let j = 0; j < M; j++) {
      let need = false; for (let s = 0; s < S; s++) if (kd[s][j] < 0) need = true;
      if (!need) continue;
      let best = -Infinity; for (let c = 0; c < nc; c++) { const z = cellLogit(MODELS[j], fm.F, c); if (z > best) best = z; }
      for (let s = 0; s < S; s++) if (kd[s][j] < 0) {
        al[s][j].push(best > thrSets[s][j]);
        if (L.windowCount(al[s][j], k, POL.n) >= POL.m) { kd[s][j] = k; live--; }
      }
    }
  }
  return kd;
}
const chr = (kd) => String.fromCharCode(48 + kd + 1);

const JOBS_FN = {
  pbin: () => ({ p: L.binProbs(L.streetWorld(), NPBIN, SEED.pbin).map((x) => +x.toFixed(5)), n: NPBIN }),
};
['aaaa', 'aaba', 'abba', 'bbba', 'street'].forEach((id) => {
  JOBS_FN[id] = () => {
    const world = worldOf(id), isStreet = id === 'street', n = isStreet ? NS : NP, s0 = isStreet ? SEED.street : SEED.prog;
    const thrS = MODELS.map((m) => m.thr), thrW = isStreet ? null : ownThresholds(world), sets = isStreet ? [thrS] : [thrS, thrW];
    const protos = isStreet ? ['S'] : ['S', 'W'];
    const zc = [], bin = [], kd = {}, col = {};
    protos.forEach((p) => { kd[p] = SYS.map(() => []); col[p] = SYS.map(() => []); });
    for (let i = 0; i < n; i++) {
      const sit = L.situation(world, s0 + i, SH);
      zc.push(Math.round((sit.z0 - sit.r) * 1000)); bin.push(L.binOf(sit.z0));
      const dec = decideMany(sit, sets);
      protos.forEach((p, s) => dec[s].forEach((k, j) => { kd[p][j].push(chr(k)); col[p][j].push(L.finish(sit, SH, k, [], []).collision ? '1' : '0'); }));
      sit.xs = []; sit.rads = [];
    }
    const out = { n: n, seed0: s0, zc: zc, bin: bin.join(''), thr: { S: thrS.map(r5) }, kd: {}, col: {} };
    if (thrW) out.thr.W = thrW;
    protos.forEach((p) => { out.kd[p] = kd[p].map((a) => a.join('')); out.col[p] = col[p].map((a) => a.join('')); });
    return out;
  };
});

function runJob(name) {
  if (!JOBS_FN[name]) throw new Error('unknown job ' + name);
  const t0 = Date.now(), res = JOBS_FN[name]();
  res.sec = +((Date.now() - t0) / 1000).toFixed(1);
  fs.mkdirSync(JOBS, { recursive: true });
  fs.writeFileSync(path.join(JOBS, name + '.json'), JSON.stringify(res));
  console.error('job ' + name + ' done in ' + res.sec + ' s');
}

function merge() {
  const J = (n) => JSON.parse(fs.readFileSync(path.join(JOBS, n + '.json'), 'utf8'));
  const worlds = {}; ['aaaa', 'aaba', 'abba', 'bbba', 'street'].forEach((id) => { const j = J(id); delete j.sec; worlds[id] = j; });
  const P = J('pbin');
  const twinsOk = Object.keys(TWIN).every((t) => JSON.stringify(T.models['swap@' + t].w) === JSON.stringify(T.models['swap@' + TWIN[t]].w) && T.models['swap@' + t].thrReal === T.models['swap@' + TWIN[t]].thrReal);
  if (!twinsOk) throw new Error('a twin detector differs from its original');
  const out = { cfg: { v0: SH.v0, a: SH.a, tau: SH.tau, half: SH.half, dt: L.DT, m: POL.m, n: POL.n, bins: L.BINS, np: NP, ns: NS, seeds: SEED, streetDyn: L.STREET_DYN, programDyn: L.PROGRAM_DYN },
    systems: SYS, twins: TWIN, worlds: ['aaaa', 'aaba', 'abba', 'bbba', 'street'], pbin: P.p, pbinN: P.n, data: worlds };
  const txt = '/* l12_data.js — generated by tools/chain/verify/engine/build_l12.js; never edited by hand.  SV.L12: the closed-loop outcome tables of Lesson 12 (proof): twelve systems in five worlds. */\n(function (root) {\n  var SV = root.SV; SV.L12 = ' +
    JSON.stringify(out) + ';\n})(typeof window !== \'undefined\' ? window : (typeof globalThis !== \'undefined\' ? globalThis : this));\n';
  fs.writeFileSync(path.join(root, 'l12_data.js'), txt);
  console.error('wrote l12_data.js (' + txt.length + ' bytes)');
}

/* recompute a few (world, protocol, system) cells from scratch with the engine's own episode (SV.score through l11_episode.js) and compare */
function check() {
  require(path.join(root, 'l12_data.js'));
  const D = SV.L12; let bad = 0, cells = 0;
  const probes = [['street', 'S', 'bbba', 5], ['aaba', 'W', 'abba', 7], ['aaaa', 'S', 'baba', 3], ['bbba', 'W', 'aaaa', 11]];
  probes.forEach(([id, p, code, off]) => {
    const w = D.data[id], j = D.systems.indexOf(code), world = worldOf(id), thr = w.thr[p][j], m = Object.assign({}, MODELS[j]);
    for (let i = off; i < Math.min(w.n, off + 40); i++) {
      const ep = L.episode(world, m, { thr: thr, m: POL.m, n: POL.n }, w.seed0 + i, { sh: SH });
      cells++;
      if (chr(ep.kDecide) !== w.kd[p][j][i] || (ep.collision ? '1' : '0') !== w.col[p][j][i]) { bad++; console.error('MISMATCH ' + [id, p, code, i].join(' ') + ': engine ' + ep.kDecide + '/' + ep.collision + ' stored ' + (w.kd[p][j].charCodeAt(i) - 49) + '/' + w.col[p][j][i]); }
      if (Math.round((ep.sit.z0 - ep.sit.r) * 1000) !== w.zc[i]) { bad++; console.error('MISMATCH zc ' + id + ' ' + i); }
    }
  });
  const o = ownThresholds(worldOf('aaba')); if (JSON.stringify(o) !== JSON.stringify(D.data.aaba.thr.W)) { bad++; console.error('MISMATCH own thresholds of aaba'); }
  console.error(bad ? bad + ' mismatches' : 'check ok (' + cells + ' episodes)');
  process.exit(bad ? 1 : 0);
}

const argv = process.argv.slice(2);
if (argv[0] === '--job') runJob(argv[1]);
else if (argv[0] === '--merge') merge();
else if (argv[0] === '--check') check();
else if (require.main === module) {
  const queue = ['street', 'aaaa', 'aaba', 'abba', 'bbba', 'pbin'];
  let active = 0, failed = false;
  const next = () => {
    if (!queue.length) { if (!active) { if (failed) process.exit(1); merge(); } return; }
    const name = queue.shift(); active++;
    const p = spawn(process.execPath, [__filename, '--job', name], { stdio: 'inherit' });
    p.on('exit', (code) => { active--; if (code) { failed = true; console.error('job ' + name + ' failed'); } next(); });
  };
  next(); next();
}
