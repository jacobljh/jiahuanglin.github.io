/* evidence.js — what a project can learn about the real street without owning its program (shared by lessons 3-12; load after street.js).
 *
 * The Street is a program only so that a reader can run experiments.  A project holds frames and the metadata its camera writes, not the program.  Every function here
 * returns exactly what such a record would contain and nothing else; it may build the frames from SV.REAL internally (that is how the lab plays "the street"),
 * but it takes no argument that reads a hidden parameter.  Lesson-specific evidence (flat frames, an edge target, a labelled sample...) lives in the lesson's own file.
 *
 *   SV.evidence.logs(n, seed0)      n unlabelled frames of ordinary driving (a pedestrian in 2% of them): {x, gain, seed}.  `gain` is the analog gain the camera's auto-exposure
 *                                   chose for the frame, which cameras write into every frame's metadata.  Use ONLY these two fields.
 *   SV.evidence.CAMERA              the camera of lesson 3, rounded to the precision its calibration achieves: gamma, the exposure scale kappa = ev/fw (fraction of full well
 *                                   per unit of scene radiance at gain 1), full well, read noise, blur, auto-exposure.  Lessons after the third read the camera through this object.
 *   SV.evidence.linear(frame)       the frame as estimated scene radiance: (DN^gamma) / (kappa * gain), per channel (a Float32Array of 3*W*H); noise stays in it.
 * Deterministic: no Math.random, no Date. */
(function (root) {
'use strict';
var SV = root.SV, E = {};
SV.evidence = E;

E.CAMERA = { gamma: 2.2, kappa: 0.15, fw: 4000, read: 3, blur: 0.7, bits: 8, ae: { target: 0.12, maxGain: 8 } };

/* the gain SV.sense would choose for this radiance image under this sensor configuration (the camera's own exposure metadata) */
function aeGain(rad, cfg) {
  if (!cfg.ae) return 1;
  var s = 0, n = rad.length;
  for (var i = 0; i < n; i++) s += rad[i];
  var ml = cfg.ev * s / n / cfg.fw;
  return Math.min(cfg.ae.maxGain, Math.max(1, cfg.ae.target / Math.max(ml, 1e-9)));
}
E.logs = function (n, seed0) {
  var pipe = SV.clone(SV.REAL), out = new Array(n), s0 = seed0 === undefined ? SV.SEEDS.logs : seed0;
  pipe.scene.pPed = 0.02;
  for (var i = 0; i < n; i++) {
    var seed = s0 + i, rs = SV.stream(seed, 'scene'), rl = SV.stream(seed, 'look'), rn = SV.stream(seed, 'sensor');
    var scene = SV.drawScene(pipe.scene, rs), look = SV.drawLook(pipe.look, scene, rl);
    var ren = SV.render(scene, look, { maps: false });
    out[i] = { x: SV.sense(ren.rad, pipe.sensor, rn), gain: aeGain(ren.rad, pipe.sensor), seed: seed };
  }
  return out;
};
E.linear = function (frame) {
  var x = frame.x, n = x.length, out = new Float32Array(n), k = 1 / (E.CAMERA.kappa * frame.gain), g = E.CAMERA.gamma;
  for (var i = 0; i < n; i++) out[i] = Math.pow(x[i], g) * k;
  return out;
};

if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
