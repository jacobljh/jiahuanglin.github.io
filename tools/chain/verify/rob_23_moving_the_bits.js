#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 23 (was lesson 08 of the old data series: add 15 to the lesson numbers in comments below) (moving the bits: the infrastructure bill).
 * Everything the lesson quotes is arithmetic on stated constants, so the oracle re-derives it by paths that share no code with pipeline_lab.js:
 *   - exact rational arithmetic (BigInt fractions, constants parsed from decimal strings) for bytes, tokens, FLOPs, rates, cores, bills and shares;
 *   - the published figures the page cites, recomputed from their definitions (bytes per decoded frame, tokens per image, the so400m weight count, DROID bytes per hour, NVDEC upper bounds);
 *   - the pipeline as a queue simulated a second way: a fixed-step simulation with per-worker countdowns (the engine uses next-event time), measuring the busy fraction of the accelerator
 *     and, by Little's law, the number of decoders that must be working;
 *   - the ledger's prices recomputed from LG.assume with their formulas written out again.
 * Then it compares every engine output with the independent one and drives the page's widget through the states the prose describes.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const BN = require(path.join(root, dir, 'bench.js'));
const LG = require(path.join(root, dir, 'ledger.js'));
const PL = require(path.join(root, dir, 'pipeline_lab.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { if (!Number.isFinite(v)) { fail('fact ' + k + ' is not finite'); return; } F[k] = +(+v).toFixed(d === undefined ? 4 : d); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol * Math.max(1e-12, Math.abs(b)))) fail(`${m}: ${a} vs ${b}`); };

/* ───── exact rationals ───── */
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { const t = a % b; a = b; b = t; } return a; };
class Q {
  constructor(n, d) { d = d === undefined ? 1n : d; if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; this.n = n / g; this.d = d / g; }
  static of(s) {                                           // exact value of a decimal string such as '989.5e12', '0.02', '12'
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:e(-?\d+))?$/.exec(String(s)); if (!m) throw new Error('bad decimal ' + s);
    const frac = m[3] || '', e = (m[4] ? +m[4] : 0) - frac.length; let n = BigInt(m[2] + frac); if (m[1]) n = -n;
    return e >= 0 ? new Q(n * 10n ** BigInt(e), 1n) : new Q(n, 10n ** BigInt(-e));
  }
  add(o) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Q(this.n * o.n, this.d * o.d); }
  div(o) { return new Q(this.n * o.d, this.d * o.n); }
  lt(o) { return this.n * o.d < o.n * this.d; }
  min(o) { return this.lt(o) ? this : o; }
  num() { return Number(this.n) / Number(this.d); }
}
const q = (x) => (x instanceof Q ? x : typeof x === 'bigint' ? new Q(x) : Q.of(x));
const I = (n) => new Q(BigInt(n));

/* ───── the constants of the lesson, as decimal strings (exact) ───── */
const K = {
  q: I(8000000).div(I(1920 * 1080 * 30)),            // bits per pixel per frame: 8 Mbit/s at 1080p30
  yuv: q('1.5'), mfu: q('0.4'), peakH: q('1979e12').div(I(2)), peakA: q('312e12'),
  coreFps: I(120), nvFps: I(771), PX1080: I(1920 * 1080), gop: I(30), link: q('1.5e9'),
  stor: q('0.02'), net: q('0.02'), core: q('0.04'), E: I(10), M: I(12), H: I(1000),
};
const gpuH = q(String(LG.assume.gpu_per_h));
const tokensOf = (side) => { const s = Math.floor(side / 14); return I(s * s); };
const so400m = (() => { const d = 1152n, L = 27n, m = 4304n; return new Q(L * (4n * d * d + 2n * d * m)); })();
const MODELS = { '25M': q('25e6'), '93M': q('93e6'), '411M': so400m, '1B': q('1e9'), '7B': q('7e9') };
const RES = { 224: [224, 224], 360: [640, 360], 480: [854, 480], 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] };

/* one state of the pipeline, in exact arithmetic.  o: res (key of RES), fps, cams, model (key), acc ('H'|'A'), cores, nvdec (0|1), read ('enc'|'rand'|'dec'), pm (price multiplier), input (px) */
function state(o) {
  o = Object.assign({ res: 1080, fps: 30, cams: 3, model: '93M', acc: 'H', cores: 8, nvdec: 0, read: 'enc', pm: '1', input: 224 }, o);
  const [w, h] = RES[o.res], px = I(w * h), n = tokensOf(o.input), P = MODELS[o.model], peak = o.acc === 'H' ? K.peakH : K.peakA;
  const D = K.mfu.mul(peak).div(I(6).mul(P).mul(n));                                       // frames per second one accelerator trains on
  const g = o.read === 'rand' ? K.gop.add(I(1)).div(I(2)) : I(1);                          // frames decoded for each frame used
  const coreFps = K.coreFps.mul(K.PX1080).div(px), engFps = K.nvFps.mul(K.PX1080).div(px), eng = I(o.acc === 'H' ? 7 : 5).mul(I(o.nvdec));
  const encFrame = px.mul(K.q).div(I(8)), decFrame = px.mul(K.yuv);
  const readBytes = o.read === 'dec' ? decFrame : g.mul(encFrame);
  const sRead = K.link.div(readBytes);
  const sDec = o.read === 'dec' ? null : I(o.cores).mul(coreFps).add(eng.mul(engFps)).div(g);
  const S = sDec === null ? sRead : sDec.min(sRead);
  const busy = S.lt(D) ? S.div(D) : I(1);
  const frames = I(o.cams * o.fps * 3600), stored = frames.mul(o.read === 'dec' ? decFrame : encFrame);
  const secs = frames.div(D.min(S)), useful = frames.div(D);
  const pm = q(o.pm), hourS = I(3600);
  const storage = stored.div(q('1e9')).mul(K.stor).mul(K.M).mul(pm);
  const network = frames.mul(readBytes).div(q('1e9')).mul(K.net).mul(pm);
  const cores = I(o.cores).mul(secs).div(hourS).mul(K.core);
  const idle = secs.sub(useful).div(hourS).mul(gpuH), learn = useful.div(hourS).mul(gpuH);
  const once = o.read === 'dec' ? frames.mul(px).div(K.coreFps.mul(K.PX1080)).div(hourS).mul(K.core) : I(0);
  const pipeline = storage.add(once).add(K.E.mul(network.add(cores).add(idle)));
  const need = o.read === 'dec' ? I(0) : D.mul(g).div(coreFps);                           // Little's law: arrival rate x time in a decoder
  return { o, w, h, px, n, D, g, coreFps, engFps, sDec, sRead, S, busy, frames, stored, secs, useful, storage, network, cores, idle, learn, once, pipeline, need, readBytes, encFrame, decFrame,
           perToken: o.read === 'dec' ? I(0) : g.mul(px).div(n), learning: K.E.mul(learn),
           stage: !S.lt(D) ? 'accelerator' : (o.read !== 'dec' && sDec.lt(sRead) ? 'decode' : 'read') };
}
const N_ = (x) => x.num();

/* ───── the pipeline simulated a second way: fixed steps, a countdown per worker (the engine jumps from event to event) ───── */
function tickSim(st, T, stepsPerFrame) {
  const w = st.o, ts = [], px = st.px.num();
  if (w.read === 'dec') ts.push(0); else {
    for (let j = 0; j < w.cores; j++) ts.push(st.g.num() * px / (120 * 1920 * 1080));
    const eng = st.o.acc === 'H' ? 7 : 5; if (w.nvdec) for (let j = 0; j < eng; j++) ts.push(st.g.num() * px / (771 * 1920 * 1080));
  }
  const ta = 1 / N_(st.D), tr = 1 / N_(st.sRead), dt = Math.min(ta, ...ts.filter((x) => x > 0)) / stepsPerFrame, KB = 64, m = ts.length;
  const rem = new Float64Array(m).fill(-1), state = new Uint8Array(m);                      // state 0 idle, 1 decoding, 2 holding a finished frame
  let readClock = 0, ready = 0, buf = 0, accRem = 0, busy = 0, steps = Math.round(T / dt), t0 = Math.floor(steps / 4), lsum = 0, lcnt = 0, frames = 0;
  for (let s = 0; s < steps; s++) {
    readClock += dt; while (readClock >= tr) { readClock -= tr; ready++; }
    for (let j = 0; j < m; j++) {
      if (state[j] === 2 && buf < KB) { buf++; state[j] = 0; }
      if (state[j] === 0 && ready > 0) { ready--; rem[j] = ts[j]; state[j] = 1; }
      if (state[j] === 1) { rem[j] -= dt; if (rem[j] <= 1e-15) { if (buf < KB) { buf++; state[j] = 0; } else state[j] = 2; } }
    }
    if (accRem <= 0 && buf > 0) { buf--; accRem = ta; }
    if (accRem > 0) { accRem -= dt; if (s >= t0) busy++; if (accRem <= 1e-15) { accRem = 0; frames++; } }
    if (s >= t0) { let nb = 0; for (let j = 0; j < m; j++) if (state[j] === 1) nb++; lsum += nb; lcnt++; }
  }
  return { busy: busy / (steps - t0), L: lsum / lcnt };
}

/* ───── 1 · an hour, weighed ───── */
const s0 = state({});
const frame1080 = 1920 * 1080 * 3 / 2;
check(N_(s0.decFrame) === frame1080 && frame1080 === 3110400, 'a decoded 1080p frame is 3,110,400 bytes');
const encPs = N_(s0.encFrame) * 30, decPs = frame1080 * 30;
near(encPs, 1e6, 1e-12, '8 Mbit/s is 1.000 MB/s');
put('fb', frame1080 / 1e6, 4); put('enc_ps', encPs / 1e6, 3); put('enc_cam_h', encPs * 3600 / 1e9, 2); put('dec_ps', decPs / 1e6, 1); put('dec_cam_h', decPs * 3600 / 1e9, 1);
put('ratio', decPs / encPs, 1); put('bpp', N_(K.q), 4); put('bits_dec', 12, 0);
put('enc_h', N_(s0.stored) / 1e9, 1); put('dec_h', N_(s0.frames) * frame1080 / 1e9, 0); put('frames_h', N_(s0.frames), 0); put('frames_cam_h', 30 * 3600, 0);
put('corp_enc_tb', N_(s0.stored) * 1000 / 1e12, 1); put('corp_dec_pb', N_(s0.frames) * frame1080 * 1000 / 1e15, 3);
check(Math.abs(F.corp_dec_pb - 1.008) < 1e-9, 'a corpus of 1,000 hours is 1.008 PB decoded');
// DROID (published): 350 h of successful episodes; 1.7 TB RLDS, 8.7 TB raw stereo MP4, 5.6 TB raw non-stereo; 3 stereo cameras = 6 streams of 1280 x 720 at 15 Hz
const dr = (tb) => tb * 1e12 / 350 / 1e9;
put('d_rlds', dr(1.7), 2); put('d_mp4', dr(8.7), 2); put('d_nonst', dr(5.6), 1);
const dBpp = 8.7e12 * 8 / (350 * 3600 * 6 * 1280 * 720 * 15);
put('d_bpp', dBpp, 2); put('d_factor', dBpp / N_(K.q), 1); put('d_ratio', 12 / dBpp, 0);

/* ───── 2 · what the accelerator eats ───── */
put('tok224', N_(tokensOf(224)), 0); put('tok384', N_(tokensOf(384)), 0); put('tok_wrong', 28 * 28, 0); put('tok384_raw', 384 / 14, 2);
put('so_layer', Number(4n * 1152n * 1152n + 2n * 1152n * 4304n) / 1e6, 2); put('so_P', N_(so400m) / 1e6, 1);
put('peak_ratio', 989.5 / 312, 2);
const MK = ['25M', '93M', '411M', '1B', '7B'];
for (const k of MK) { const s = state({ model: k }); put('D_' + k, N_(s.D), 0); put('hs_' + k, N_(s.frames) / N_(s.D), 0); put('hh_' + k, N_(s.frames) / N_(s.D) / 3600, 2); }
put('tps_93M', N_(K.mfu.mul(K.peakH).div(I(6).mul(MODELS['93M']))), 0);
put('flops_tok_93M', 6 * 93e6 / 1e6, 0);
put('Da_93M', N_(state({ acc: 'A' }).D), 0);

/* ───── 3 · what the decoders must make for each token ───── */
put('core_mpx', 120 * 1920 * 1080 / 1e6, 1); put('eng_cores', 771 / 120, 1); put('nv_h100', 7 * 771, 0); put('nv_a100', 5 * 771, 0);
put('ppt', N_(s0.perToken), 0); put('ppt_native', 14 * 14, 0); put('ppt_rand', N_(state({ read: 'rand' }).perToken), 0);
put('bpt_stored', N_(s0.encFrame) / 256, 0); put('bpt_dec', N_(s0.decFrame) / 256, 0); put('bpt_in', 224 * 224 * 3 / 256, 0);
put('w_dec', 1000 / 120, 2);
put('need', N_(s0.need), 1); put('sdec', N_(s0.sDec), 0); put('sread', N_(s0.sRead), 0); put('D', N_(s0.D), 0); put('busy', 100 * N_(s0.busy), 1);
put('stall', 100 * (1 - N_(s0.busy)), 0); put('t_dec_s', N_(s0.secs), 1); put('t_ok_s', N_(s0.useful), 1);
put('need23_busy', 100 * N_(state({ cores: 23 }).busy), 1);
{ // the same stages in tokens per second: capacity = rate / units per token
  const corePx = K.coreFps.mul(K.PX1080), tokDec = I(8).mul(corePx).div(s0.perToken), tokEnc = K.link.div(s0.encFrame.div(I(256))), sdd = state({ read: 'dec' }), tokDecRead = K.link.div(sdd.decFrame.div(I(256)));
  put('acc_tflops', N_(K.mfu.mul(K.peakH)) / 1e12, 1); put('dec_mpx8', N_(I(8).mul(corePx)) / 1e6, 1); put('core_tok', N_(corePx.div(s0.perToken)), 0);
  put('tok_dec', N_(tokDec), 0); put('tok_enc', N_(tokEnc), 0); put('tok_decread', N_(tokDecRead), 0);
  near(N_(tokDec), N_(s0.sDec) * 256, 1e-12, 'decoder tokens per second = frames per second x 256'); near(N_(tokDecRead), N_(sdd.sRead) * 256, 1e-12, 'read tokens per second = frames per second x 256');
  near(N_(tokDec) / N_(s0.D.mul(I(256))), N_(s0.busy), 1e-12, 'busy as a ratio of token capacities'); near(N_(tokDecRead) / N_(s0.D.mul(I(256))), N_(sdd.busy), 1e-12, 'busy when frames are read decoded');
}
const pStarOf = (o) => { const st = state(o); return N_(K.mfu.mul(K.peakH).div(I(6).mul(tokensOf(224)).mul(st.sDec))) / 1e6; };
put('p_star', pStarOf({}), 0); put('p_star_4k', pStarOf({ res: 2160 }), 0); put('p_star_rand', pStarOf({ read: 'rand' }), 0);
for (const k of ['25M', '93M', '411M', '1B']) for (const r of [480, 1080, 2160]) put(`need_${k}_${r}`, N_(state({ model: k, res: r }).need), 1);
for (const k of MK) for (const r of [224, 360, 480, 720, 1080, 1440, 2160]) put(`b_${k}_${r}`, 100 * N_(state({ model: k, res: r }).busy), 0);
const nv25 = state({ model: '25M', nvdec: 1 }), nv93 = state({ nvdec: 1 }), nv93k = state({ nvdec: 1, res: 2160 });
const k4 = state({ res: 2160 }), m25 = state({ model: '25M' }), rd = state({ read: 'rand' });
put('k4_busy', 100 * N_(k4.busy), 1); put('k4_need', N_(k4.need), 1); put('k4_enc', N_(k4.stored) / 1e9, 1); put('m25_busy', 100 * N_(m25.busy), 1); put('m25_need', N_(m25.need), 1);
put('rand_need', N_(rd.need), 1); put('rand_busy', 100 * N_(rd.busy), 1); put('rand_bill', N_(rd.pipeline), 1); put('c23_need_gap', N_(s0.need) - 23, 2);
put('nv25_busy', 100 * N_(nv25.busy), 1); put('nv93_busy', 100 * N_(nv93.busy), 1); put('nv93k_busy', 100 * N_(nv93k.busy), 1); put('nv_supply', N_(nv93.sDec), 0);

/* ───── the queue, simulated a second way, against the closed form and against Little's law ───── */
const SIM = [['def', {}], ['k4', { res: 2160 }], ['m25', { model: '25M' }], ['m25n', { model: '25M', nvdec: 1 }], ['dec', { read: 'dec' }], ['k480', { res: 480 }], ['rand', { read: 'rand' }]];
for (const [nm, o] of SIM) {
  const st = state(o), sim = tickSim(st, nm === 'rand' ? 6 : 2.4, 24), eng = PL.simulate(PL.cfg(engineCfg(o)), 4000, 0.02);
  check(Math.abs(sim.busy - N_(st.busy)) < 0.012, `fixed-step simulation of state ${nm}: busy ${sim.busy.toFixed(4)} vs closed form ${N_(st.busy).toFixed(4)}`);
  check(Math.abs(eng.busy - N_(st.busy)) < 0.012, `event simulation of state ${nm}: busy ${eng.busy.toFixed(4)} vs closed form ${N_(st.busy).toFixed(4)}`);
}
{ // Little's law: with more cores than needed (30, need 23.09) the decoders that are working, on average, number D x (time in a decoder); with fewer (8) all of them work
  const gen = state({ cores: 30 }), a = tickSim(gen, 2.4, 24), b = tickSim(s0, 2.4, 24);
  near(a.L, N_(gen.need), 0.03, 'Little: decoders working at 30 cores'); near(b.L, 8, 0.02, 'Little: decoders working at 8 cores (all of them)');
  put('little_L', a.L, 1); put('little_need', N_(gen.need), 1);
}
function engineCfg(o) { const r = RES[o.res || 1080]; return { w: r[0], h: r[1], fps: o.fps || 30, cams: o.cams || 3, P: Number(MODELS[o.model || '93M'].n) / Number(MODELS[o.model || '93M'].d), acc: o.acc === 'A' ? 'A100' : 'H100', cores: o.cores === undefined ? 8 : o.cores, nvdec: o.nvdec || 0, read: o.read || 'enc', pm: o.pm === undefined ? 1 : +o.pm, input: o.input || 224 }; }

/* ───── every engine output against the exact one ───── */
for (const [nm, o] of [['def', {}], ['k4', { res: 2160 }], ['k480', { res: 480 }], ['c24', { cores: 24 }], ['m411', { model: '411M' }], ['m25n', { model: '25M', nvdec: 1 }], ['dec', { read: 'dec' }], ['rand', { read: 'rand' }],
                       ['f15', { fps: 15 }], ['in112', { input: 112 }], ['a100', { acc: 'A' }], ['pm10', { pm: '10' }], ['cp', { res: 224 }], ['old', { res: 480, fps: 15, cams: 2 }]]) {
  const st = state(o), c = PL.cfg(engineCfg(o)), r = PL.rates(c), b = PL.bytes(c), bl = PL.bill(c, 10, 12);
  near(r.D, N_(st.D), 1e-9, nm + ' demand'); near(r.busy, N_(st.busy), 1e-9, nm + ' busy'); near(r.need, N_(st.need), 1e-9, nm + ' need'); near(r.perToken, N_(st.perToken), 1e-9, nm + ' pixels per token');
  near(r.sRead, N_(st.sRead), 1e-9, nm + ' read'); if (st.sDec) near(r.sDec, N_(st.sDec), 1e-9, nm + ' decode'); check(r.stage === st.stage, `${nm} stage ${r.stage} vs ${st.stage}`);
  near(b.stored, N_(st.stored), 1e-9, nm + ' stored'); near(bl.pipeline, N_(st.pipeline), 1e-9, nm + ' pipeline bill'); near(bl.idle, N_(st.idle), 1e-9, nm + ' idle'); near(bl.cores, N_(st.cores), 1e-9, nm + ' cores');
  near(bl.storage, N_(st.storage), 1e-9, nm + ' storage'); near(bl.network, N_(st.network), 1e-9, nm + ' network'); near(bl.learning, N_(st.learning), 1e-9, nm + ' learning');
}
put('map_def_93M_1080', 100 * PL.map(PL.cfg({}))[1][4], 1); check(Math.abs(PL.map(PL.cfg({}))[1][4] - N_(s0.busy)) < 1e-12, 'the stall map agrees with the state it marks');

/* ───── the claims of the prose, asserted ───── */
{
  const c6 = state({ cams: 6 }), f15x = state({ fps: 15 }), a = state({ model: '411M' });
  check(N_(f15x.busy) === N_(s0.busy) && N_(c6.busy) === N_(s0.busy), 'the frame rate and the number of cameras change the bill and never the busy fraction');
  check(Math.abs(N_(f15x.pipeline) / N_(s0.pipeline) - 0.5) < 1e-12 && Math.abs(N_(c6.pipeline) / N_(s0.pipeline) - 2) < 1e-12, 'every term of the bill is linear in the frames moved');
  check(s0.stage === 'decode' && state({ read: 'dec' }).stage === 'read' && a.stage === 'accelerator', 'decode binds at the defaults, the read link when frames are decoded on disk, the accelerator for the 411 M model');
  const Pst = N_(K.mfu.mul(K.peakH).div(I(6).mul(I(256)).mul(s0.sDec)));
  const below = Object.assign({}, s0.o, { model: '93M' });
  const busyAt = (P) => { MODELS.__x = q(String(Math.round(P))); const st = state(Object.assign({}, below, { model: '__x' })); return N_(st.busy); };
  check(busyAt(0.99 * Pst) < 1 && busyAt(1.01 * Pst) === 1, 'the decode-bound models are exactly those below p_star');
  check(N_(state({ nvdec: 1 }).busy) === 1 && N_(state({ model: '25M', nvdec: 1 }).busy) < 1 && N_(state({ res: 2160, nvdec: 1 }).busy) < 1, 'the NVDEC engines are enough for the 93 M model at 1080p and not for the 25 M model or 4K');
}

/* ───── ledger prices, the formulas written out again ───── */
const a = LG.assume, arm = a.arm_cost / a.arm_life_h, ownP = (a.wage_per_h + arm) / (a.duty * (1 - a.discard));
const simP = a.gpu_per_h / a.sim_speed + a.scene_weeks * a.week_cost / a.scene_uses_h + a.calib_h * ownP / a.scene_uses_h;
const forceP = (a.wage_per_h + arm + a.force_rig_cost / a.arm_life_h) / (a.force_duty * (1 - a.discard)), corrP = (a.wage_per_h + arm) / a.sup_duty;
near(LG.price('own'), ownP, 1e-12, 'own price'); near(LG.price('sim'), simP, 1e-12, 'sim price'); near(LG.price('force'), forceP, 1e-12, 'force price'); near(LG.price('corr'), corrP, 1e-12, 'corr price');
put('p_own', ownP, 2); put('p_twin', a.curate_per_h, 2); put('p_sim', simP, 4); put('p_force', forceP, 2); put('p_corr', corrP, 2); put('gpu_h', a.gpu_per_h, 2);

/* ───── 5 · three roads ───── */
// pre-decode everything
const sd = state({ read: 'dec' });
put('pd_storage_year', N_(sd.storage), 1); put('pd_ratio_p', N_(sd.storage) / ownP * 100, 0); put('pd_net', N_(sd.network) * 10, 1); put('pd_total', N_(sd.pipeline), 1); put('pd_share', N_(sd.pipeline) / ownP * 100, 0);
put('pd_busy', 100 * N_(sd.busy), 1); put('pd_read_gbs', N_(s0.D.mul(s0.decFrame)) / 1e9, 1); put('pd_read_fps', N_(sd.sRead), 0); put('pd_link_gbs', 1.5, 1);
put('pd_once', N_(sd.once), 3);
const decEpoch = N_(s0.frames.div(K.coreFps).div(I(3600)).mul(K.core)), extraMonth = (N_(s0.frames) * frame1080 - N_(s0.stored)) / 1e9 * 0.02;
put('pd_dec_epoch', decEpoch, 3); put('pd_extra_month', extraMonth, 2); put('pd_breakeven', extraMonth / decEpoch, 0); put('pd_core_h', N_(s0.frames.div(K.coreFps)) / 3600, 2);
put('pd_busy_411', 100 * N_(state({ read: 'dec', model: '411M' }).busy), 0);
// lower the frame rate and the resolution
const f15 = state({ fps: 15 }), k480 = state({ res: 480 }), in112 = state({ input: 112 }), cp = state({ res: 224 });
put('f15_busy', 100 * N_(f15.busy), 1); put('f15_bill', N_(f15.pipeline), 2); put('f15_ratio', N_(f15.pipeline) / N_(s0.pipeline), 2); put('f15_enc', N_(f15.stored) / 1e9, 1);
put('k480_busy', 100 * N_(k480.busy), 0); put('k480_enc', N_(k480.stored) / 1e9, 2); put('k480_bytes_ratio', N_(s0.px) / N_(k480.px), 2); put('k480_need', N_(k480.need), 1); put('k480_bill', N_(k480.pipeline), 2);
put('in112_D', N_(in112.D), 0); put('in112_need', N_(in112.need), 1); put('in112_busy', 100 * N_(in112.busy), 1); put('tok112', N_(tokensOf(112)), 0); put('in112_ratio', N_(in112.D) / N_(s0.D), 0);
const clr = (wpx) => wpx * 1 / 500;                                                         // pixels across a 1 mm clearance when the view is 500 mm wide
for (const r of [224, 360, 480, 720, 1080]) put('clr_' + r, clr(RES[r][0]), 1);
put('clr_min_w', 2 * 500 / 1, 0);
put('cp_need', N_(cp.need), 1); put('cp_enc', N_(cp.stored) / 1e9, 2); put('cp_bill', N_(cp.pipeline), 2); put('cp_ppt', N_(cp.perToken), 0); put('cp_ratio', N_(s0.pipeline) / N_(cp.pipeline), 0);
put('cp_once_core_h', N_(s0.frames.div(K.coreFps).div(I(3600))), 2); put('cp_once', decEpoch, 2);
// more accelerators on the same cores
const half = state({ cores: 4 }), eight = state({ cores: 1 });
check(Math.abs(N_(half.frames.div(I(2).mul(half.S))) - N_(s0.frames.div(s0.S))) < 1e-9, 'two accelerators on the same cores take as long for an epoch'); put('acc2_wall', N_(half.frames.div(I(2).mul(half.S))), 1);
put('acc2_busy', 100 * N_(half.busy), 1); put('acc2_epoch_same', N_(half.frames.div(half.D.min(half.S))) / N_(s0.frames.div(s0.D.min(s0.S))), 2);
put('acc2_bill', N_(half.pipeline), 2); put('acc2_idle', N_(half.idle) * 10, 2); put('acc2_idle_def', N_(s0.idle) * 10, 2);
put('acc_epoch_def', N_(s0.secs) / 3600 * LG.assume.gpu_per_h, 3); put('acc_epoch_acc2', N_(half.secs) / 3600 * LG.assume.gpu_per_h, 3);   // accelerator-seconds per hour of data: half.secs is already the total over both cards
put('a100_busy', 100 * N_(state({ acc: 'A' }).busy), 0); put('a100_need', N_(state({ acc: 'A' }).need), 1); put('h100_a100', N_(s0.D) / N_(state({ acc: 'A' }).D), 2);
put('acc16_busy', 100 * N_(eight.busy), 1);

/* ───── 6 · the bill ───── */
put('b_storage', N_(s0.storage), 2); put('b_network', N_(s0.network) * 10, 2); put('b_cores', N_(s0.cores) * 10, 2); put('b_idle', N_(s0.idle) * 10, 2); put('b_total', N_(s0.pipeline), 2);
put('b_learn', N_(s0.learning), 2); put('b_bytes', N_(s0.storage) + 10 * N_(s0.network), 2); put('b_bytes_share', 100 * (N_(s0.storage) + 10 * N_(s0.network)) / N_(s0.pipeline), 0);
put('b_idle_share', 100 * 10 * N_(s0.idle) / N_(s0.pipeline), 0); put('b_cores_share', 100 * 10 * N_(s0.cores) / N_(s0.pipeline), 0);
put('share_own', 100 * N_(s0.pipeline) / ownP, 1); put('share_twin', 100 * N_(s0.pipeline) / a.curate_per_h, 0); put('share_corr', 100 * N_(s0.pipeline) / corrP, 1);
put('sim_x', N_(s0.pipeline) / simP, 0);
const c24 = state({ cores: 24 });
put('c24_total', N_(c24.pipeline), 2); put('c24_save', N_(s0.pipeline) - N_(c24.pipeline), 2); put('c24_cores', N_(c24.cores) * 10, 2); put('c24_cores_def', N_(s0.cores) * 10, 2);
put('c24_extra_cores', N_(c24.cores.sub(s0.cores)) * 10, 2); put('c24_busy', 100 * N_(c24.busy), 0); put('c24_epoch_h', N_(c24.secs) / 3600 * 1000 / 8, 1); put('def_epoch_h', N_(s0.secs) / 3600 * 1000 / 8, 1);
const pm10 = state({ pm: '10' }), pm01 = state({ pm: '0.1' });
put('pm10_total', N_(pm10.pipeline), 1); put('pm10_idle_share', 100 * 10 * N_(pm10.idle) / N_(pm10.pipeline), 0); put('pm01_total', N_(pm01.pipeline), 2); put('pm01_idle_share', 100 * 10 * N_(pm01.idle) / N_(pm01.pipeline), 0);
// a budget buys B / p hours and moving them costs t each: the share is t / p whatever B is
const shares = [];
for (const B of [100, 1000, 100000]) { const hrs = B / ownP; put('bud_' + B + '_h', hrs, 2); put('bud_' + B + '_move', hrs * N_(s0.pipeline), 2); put('bud_' + B + '_share', 100 * hrs * N_(s0.pipeline) / B, 2); shares.push(hrs * N_(s0.pipeline) / B); }
check(Math.abs(shares[0] - shares[1]) < 1e-12 && Math.abs(shares[1] - shares[2]) < 1e-12 && Math.abs(shares[0] - N_(s0.pipeline) / ownP) < 1e-12, 'the transport share is t / p whatever the budget');
put('bud_twin_h', 1000 / a.curate_per_h, 1); put('bud_twin_move', 1000 / a.curate_per_h * N_(s0.pipeline), 0);
// kinds of hour
const old = state({ res: 480, fps: 15, cams: 2 }), forceBytes = 6 * 4 * 1000 * 3600;
put('k_own_gb', N_(s0.stored) / 1e9, 1); put('k_old_gb', N_(old.stored) / 1e9, 2); put('k_force_gb', forceBytes / 1e9, 3); put('k_old_t', N_(old.pipeline), 2);
put('k_force_t', forceBytes / 1e9 * (0.02 * 12 + 10 * 0.02), 3); put('k_old_share', 100 * N_(old.pipeline) / a.curate_per_h, 1); put('k_force_share', 100 * forceBytes / 1e9 * (0.02 * 12 + 10 * 0.02) / forceP, 3);
put('k_own_tok', N_(s0.frames) * 256 / 1e6, 1); put('k_old_tok', N_(old.frames) * 256 / 1e6, 1); put('k_old_ppt', N_(old.perToken), 0);
near(PL.billBytes(forceBytes, 10, 12), forceBytes / 1e9 * (0.02 * 12 + 10 * 0.02), 1e-12, 'force bill'); check(Math.abs(PL.bill(PL.cfg(engineCfg({ res: 480, fps: 15, cams: 2 })), 10, 12).pipeline - N_(old.pipeline)) < 1e-9, 'old arm bill');
put('k_old_bytes_x', N_(s0.stored) / N_(old.stored), 0);
{ // a force-bearing demonstration is an own-format hour (the arm's cameras are in its price) plus the force channel
  const fb = forceBytes / 1e9, tot = N_(s0.stored) / 1e9 + fb, tT = N_(s0.pipeline) + forceBytes / 1e9 * (0.02 * 12 + 10 * 0.02);
  put('k_force_tot_gb', tot, 1); put('k_force_tot_t', tT, 2); put('k_force_tot_share', 100 * tT / forceP, 1); put('k_force_frac', 100 * fb / (N_(s0.stored) / 1e9), 1);
}
// the ledger with transport: cost per effective hour (p + t) / rho at the rates of lessons 1 and 2 is not recomputed here; the added dollars per hour are
put('t_over_p_twin_hours', N_(s0.pipeline) / a.curate_per_h, 3);

/* ───── the checkpoint exercise ───── */
{ // a hand calculation: an A100 (312 TFLOPS) at 0.4, a model of 100 M parameters reading 224 px (256 tokens), two cameras of 1080p30, four cores per accelerator at 120 fps of 1080p each
  const D = K.mfu.mul(q('312e12')).div(I(6).mul(q('100e6')).mul(I(256))), frames = I(2 * 30 * 3600), S4 = I(4).mul(K.coreFps);
  put('ck_D', N_(D), 1); put('ck_need', N_(D.div(K.coreFps)), 2); put('ck_busy4', 100 * N_(S4.div(D)), 1); put('ck_frames', N_(frames), 0);
  put('ck_full_s', N_(frames.div(D)), 0); put('ck_stall_s', N_(frames.div(S4)), 0); put('ck_idle_s', N_(frames.div(S4).sub(frames.div(D))), 0);
  put('ck_idle_cost', N_(frames.div(S4).sub(frames.div(D)).div(I(3600)).mul(gpuH)) * 10, 3);
  put('ck_enc_gb', N_(frames.mul(K.PX1080).mul(K.q).div(I(8))) / 1e9, 1); put('ck_dec_gb', N_(frames.mul(K.PX1080).mul(K.yuv)) / 1e9, 1);
  put('ck_core_cost', N_(I(3).mul(frames.div(D)).div(I(3600)).mul(K.core)) * 10, 3);                // three more cores for the epoch's accelerator time, ten epochs
}

/* ───── the widget prints what the independent computation gives ───── */
const html = path.join(root, dir, '23_moving_the_bits.html');
const STATES = {};
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9 + 1e-9 * Math.abs(want))) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const resIdx = { 224: 0, 360: 1, 480: 2, 720: 3, 1080: 4, 1440: 5, 2160: 6 };
  const WS = [['def', {}], ['k4', { res: 2160 }], ['k480', { res: 480 }], ['c24', { cores: 24 }], ['c23', { cores: 23 }], ['m411', { model: '411M' }], ['m25', { model: '25M' }], ['m25n', { model: '25M', nvdec: 1 }],
              ['m1b', { model: '1B' }], ['m7b', { model: '7B' }], ['nv93', { nvdec: 1 }], ['nv93k', { res: 2160, nvdec: 1 }], ['c4', { cores: 4 }], ['dec', { read: 'dec' }], ['rand', { read: 'rand' }], ['f15', { fps: 15 }], ['cam6', { cams: 6 }], ['pm10', { pm: '10' }], ['pm01', { pm: '0.1' }], ['k1440', { res: 1440 }], ['k224', { res: 224 }]];
  for (const [nm, o] of WS) {
    const oo = Object.assign({ res: 1080, fps: 30, cams: 3, model: '93M', cores: 8, nvdec: 0, read: 'enc', pm: '1' }, o), st = state(oo);
    pg.set('w08-res', resIdx[oo.res]); pg.set('w08-cores', oo.cores); pg.set('w08-model', oo.model); pg.set('w08-fps', oo.fps); pg.set('w08-cams', oo.cams);
    pg.set('w08-dec', oo.nvdec ? 'nvdec' : 'cpu'); pg.set('w08-read', oo.read); pg.set('w08-price', oo.pm); pg.drain();
    const what = 'widget state ' + nm;
    eqd('w08-enc', N_(st.stored) / 1e9, 1, what + ' stored GB'); eqd('w08-ppt', N_(st.perToken), 0, what + ' pixels per token');
    eqd('w08-D', N_(st.D), 0, what + ' demand'); eqd('w08-sread', N_(st.sRead), 0, what + ' read supply'); eqd('w08-busy', 100 * N_(st.busy), 1, what + ' busy');
    if (st.sDec) eqd('w08-sdec', N_(st.sDec), 0, what + ' decode supply'); if (oo.read !== 'dec') eqd('w08-need', N_(st.need), 1, what + ' cores needed');
    eqd('w08-decb', N_(st.frames) * N_(st.px) * 1.5 / 1e9, 0, what + ' decoded GB'); eqd('w08-bill', N_(st.pipeline), 2, what + ' pipeline bill'); eqd('w08-idle', 10 * N_(st.idle), 2, what + ' idle accelerators');
    eqd('w08-share', 100 * N_(st.pipeline) / ownP, 1, what + ' share of an own hour'); eqd('w08-epoch', N_(st.frames.mul(st.readBytes)) * 1000 / 1e12, 1, what + ' TB per epoch');
    const simShown = pg.num('w08-sim'); if (!(Math.abs(simShown - 100 * N_(st.busy)) <= 1.2)) fail(`${what}: simulated busy shown ${simShown} vs ${(100 * N_(st.busy)).toFixed(1)}`);
    if (pg.text('w08-stage').trim().toLowerCase().indexOf(st.stage) < 0) fail(`${what}: binding stage shown "${pg.text('w08-stage')}" vs ${st.stage}`);
    STATES[nm] = true;
  }
  // back to the default: the widget must print the page's opening numbers
  pg.set('w08-res', 4); pg.set('w08-cores', 8); pg.set('w08-model', '93M'); pg.set('w08-fps', 30); pg.set('w08-cams', 3); pg.set('w08-dec', 'cpu'); pg.set('w08-read', 'enc'); pg.set('w08-price', '1'); pg.drain();
  eqd('w08-busy', F.busy, 1, 'default busy'); eqd('w08-D', F.D, 0, 'default demand');
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
