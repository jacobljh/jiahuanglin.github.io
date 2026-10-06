/* pipeline_lab.js — the private engine of lesson 23 (moving the bits): the pipeline that carries an hour of video from storage to an accelerator, and its bill.
 *
 * No Bench measurement here: arithmetic on the labelled assumptions in PL.A (the lesson prints them in a table) and on published figures (marked "published").
 * Every rate is PER ONE ACCELERATOR and in frames per second (a frame is one camera image), so that every stage can be set beside what the accelerator consumes.
 *
 *   PL.tokens(c)        tokens the model reads from one frame: floor(input / patch)^2
 *   PL.demand(c)        frames per second one accelerator trains on: mfu x peak / (6 P x tokens)
 *   PL.rates(c)         the stages: demand D, decode supply, read supply, S = the slower, busy = min(1, S / D), the stage that binds, cores needed (Little's law), pixels decoded per token
 *   PL.bytes(c)         stored and decoded bytes of one effective hour
 *   PL.bill(c, E, M)    dollars per effective hour: storage for M months, and per epoch the network, the cores and the accelerator-time (its idle part apart); E epochs;
 *                       .pipeline = storage + once + E x (network + cores + idle) is the transport price t of the hour, .learning = E x the accelerator-time that trains
 *   PL.billBytes(b, E, M, pm)  the same for a stream with no decode stage (b bytes an hour, for example a force channel): b x (storage x M + network x E)
 *   PL.simulate(c, N, W) the pipeline as a queue (read -> decoders -> buffer -> accelerator), frame by frame: measured busy fraction, and the jobs that start before W seconds
 *   PL.map(c)           busy fraction over model size x stored resolution, the other settings of c unchanged
 *   PL.RES, PL.MODELS, PL.base, PL.cfg(o)   the stored sizes, the model sizes, the default state of the lesson, and a state with some fields changed
 *
 * c = { w, h, fps, cams, P, acc, cores, nvdec, read, pm, input }.   read: 'enc' frames read in order from encoded video; 'rand' random frames of encoded video (a keyframe every PL.A.gop frames,
 * so g = (gop + 1) / 2 frames are decoded for each frame used); 'dec' decoded frames read from disk.   pm multiplies the prices of bytes (storage and network).
 * The accelerator price is the ledger's (LG.assume.gpu_per_h) when ledger.js is loaded.
 */
(function (root) {
'use strict';
var PL = {}, PX1080 = 1920 * 1080;

PL.A = {
  bpp: 8e6 / (1920 * 1080 * 30),          // bits per pixel per frame of the stored stream: 8 Mbit/s at 1080p30, the upload recommendation (a robot logger sets its own)
  yuv: 1.5,                               // bytes per decoded pixel: YUV 4:2:0, 8 bit
  patch: 14,                              // pixels per patch side (SigLIP so400m, published)
  input: 224,                             // pixels per side of the image the model reads: floor(224 / 14)^2 = 256 tokens (published)
  flops: { H100: 989.5e12, A100: 312e12 },  // dense BF16 peak, FLOP/s (the datasheets print twice these with sparsity)
  engines: { H100: 7, A100: 5 },          // NVDEC engines on the chip (published)
  nvdecFps: 771,                          // 1080p H.264 frames per second per NVDEC engine, indicative (published, the Turing row)
  mfu: 0.4,                               // share of the peak FLOP/s that training reaches (assumed)
  coreFps: 120,                           // 1080p frames per second one core decodes, with colour conversion and resize (assumed)
  gop: 30,                                // frames between keyframes in the random-access case (assumed)
  linkBps: 1.5e9,                         // bytes per second one accelerator can read from storage (assumed: a 100 Gbit/s link shared by eight)
  storGBm: 0.02, netGB: 0.02, coreH: 0.04,  // $ per GB-month stored, $ per GB read, $ per core-hour (assumed)
  epochs: 10, months: 12, corpusH: 1000     // epochs per run, months the corpus is kept, effective hours of the illustrative corpus (assumed)
};
PL.RES = [[224, 224], [640, 360], [854, 480], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]];
PL.so400m = function () { var d = 1152, L = 27, m = 4304; return L * (4 * d * d + 2 * d * m); };       // weights of the 27 layers: attention (4 d^2) and MLP (2 d m) per layer
PL.MODELS = [{ k: '25M', P: 25e6 }, { k: '93M', P: 93e6 }, { k: '411M', P: PL.so400m() }, { k: '1B', P: 1e9 }, { k: '7B', P: 7e9 }];
PL.base = { w: 1920, h: 1080, fps: 30, cams: 3, P: 93e6, acc: 'H100', cores: 8, nvdec: 0, read: 'enc', pm: 1 };
PL.gpuH = function () { return (root.LG && root.LG.assume && root.LG.assume.gpu_per_h) || 2.5; };
PL.cfg = function (o) { var c = {}, k; for (k in PL.base) c[k] = PL.base[k]; for (k in o) c[k] = o[k]; return c; };

PL.tokens = function (c) { var s = Math.floor((c.input || PL.A.input) / PL.A.patch); return s * s; };
PL.demand = function (c) { return PL.A.mfu * PL.A.flops[c.acc] / (6 * c.P * PL.tokens(c)); };

PL.rates = function (c) {
  var A = PL.A, px = c.w * c.h, n = PL.tokens(c), D = PL.demand(c), g = c.read === 'rand' ? (A.gop + 1) / 2 : 1;   // g: frames decoded for each frame used
  var coreFps = A.coreFps * PX1080 / px, engFps = A.nvdecFps * PX1080 / px, eng = c.nvdec ? A.engines[c.acc] : 0;      // frames per second of this size: one core, one NVDEC engine
  var sDec = c.read === 'dec' ? Infinity : (c.cores * coreFps + eng * engFps) / g;
  var bytes = c.read === 'dec' ? A.yuv * px : g * px * A.bpp / 8;                                                       // bytes read from storage for each frame used
  var sRead = A.linkBps / bytes, S = Math.min(sDec, sRead);
  return { D: D, n: n, g: g, sDec: sDec, sRead: sRead, S: S, busy: Math.min(1, S / D), stage: S >= D ? 'accelerator' : (sRead < sDec ? 'read' : 'decode'),
           perToken: c.read === 'dec' ? 0 : g * px / n, need: c.read === 'dec' ? 0 : D * g / coreFps, bytesPerFrame: bytes };
};

PL.bytes = function (c) {
  var A = PL.A, px = c.w * c.h, frames = c.cams * c.fps * 3600, enc = frames * px * A.bpp / 8, dec = frames * px * A.yuv;
  return { frames: frames, enc: enc, dec: dec, ratio: dec / enc, stored: c.read === 'dec' ? dec : enc };
};

PL.billBytes = function (bytesPerHour, E, M, pm) { var A = PL.A, p = pm == null ? 1 : pm; return bytesPerHour / 1e9 * (A.storGBm * M + E * A.netGB) * p; };

PL.bill = function (c, E, M) {
  var A = PL.A, r = PL.rates(c), b = PL.bytes(c), pm = c.pm == null ? 1 : c.pm, gpu = PL.gpuH();
  var secs = b.frames / Math.min(r.D, r.S), useful = b.frames / r.D;                          // accelerator-seconds per effective hour and epoch, and the part of them that trains
  var read = b.frames * r.bytesPerFrame;                                                        // bytes read per epoch
  var storage = b.stored / 1e9 * A.storGBm * M * pm, network = read / 1e9 * A.netGB * pm;
  var cores = c.cores * secs / 3600 * A.coreH, idle = (secs - useful) / 3600 * gpu, learn = useful / 3600 * gpu;       // per epoch
  var once = c.read === 'dec' ? b.frames * c.w * c.h / (A.coreFps * PX1080) / 3600 * A.coreH : 0;                      // decoding the corpus once, ahead of time
  return { storage: storage, network: network, cores: cores, idle: idle, learn: learn, once: once, secs: secs, read: read,
           pipeline: storage + once + E * (network + cores + idle), learning: E * learn };
};

/* the pipeline as a queue.  The read stage streams one frame every 1 / sRead s; a decoder takes the next frame, decodes it (g x w x h / rate seconds) and puts it in a buffer of K frames; a decoder
 * whose frame finds the buffer full waits holding it.  The accelerator takes a frame from the buffer and trains on it for 1 / D seconds.  N frames in all; the busy fraction is measured after the first quarter. */
PL.simulate = function (c, N, W) {
  var A = PL.A, r = PL.rates(c), px = c.w * c.h, eng = c.nvdec ? A.engines[c.acc] : 0, K = 64, ts = [], j, t = 0, b = 0, accEnd = Infinity, done = 0, k = 0, st;
  if (c.read === 'dec') ts.push(0); else { for (j = 0; j < c.cores; j++) ts.push(r.g * px / (A.coreFps * PX1080)); for (j = 0; j < eng; j++) ts.push(r.g * px / (A.nvdecFps * PX1080)); }
  var m = ts.length, ta = 1 / r.D, tr = 1 / r.sRead, fin = [], held = [], as = [], dec = [], acc = [], nt;
  for (j = 0; j < m; j++) { fin.push(Infinity); held.push(false); }
  while (done < N) {
    for (j = 0; j < m; j++) if (fin[j] === Infinity && !held[j]) { st = Math.max(t, ++k * tr); fin[j] = st + ts[j]; if (st < W) dec.push([j, st, fin[j]]); }
    if (accEnd === Infinity && b > 0) { b--; accEnd = t + ta; as.push(t); if (t < W) acc.push([t, t + ta]); }
    for (j = 0; j < m && b < K; j++) if (held[j]) { held[j] = false; b++; }
    nt = accEnd; for (j = 0; j < m; j++) if (!held[j] && fin[j] < nt) nt = fin[j];
    t = nt; if (accEnd <= t) { accEnd = Infinity; done++; }
    for (j = 0; j < m; j++) if (!held[j] && fin[j] <= t) { fin[j] = Infinity; if (b < K) b++; else held[j] = true; }
  }
  var n0 = Math.floor(as.length / 4);
  return { busy: (as.length - n0) * ta / (t - as[n0]), end: t, dec: dec, acc: acc, lanes: m, ta: ta, ts: ts };
};

PL.map = function (c) { return PL.MODELS.map(function (md) { return PL.RES.map(function (rs) { return PL.rates(PL.cfg(Object.assign({}, c, { P: md.P, w: rs[0], h: rs[1] }))).busy; }); }); };

root.PL = PL;
if (typeof module !== 'undefined' && module.exports) module.exports = PL;
})(typeof window !== 'undefined' ? window : globalThis);
