#!/usr/bin/env node
'use strict';
/* regression test of the shared evidence layer (all_lessons/synthetic_vision_new/evidence.js) */
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '../../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new/evidence.js')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));
const E = require(path.join(root, dir, 'evidence.js'));
let bad = 0;
const check = (c, m) => { if (!c) { bad++; console.error('FAIL ' + m); } };

const A = E.logs(40), B = SV.real.logs(40), A2 = E.logs(40);
check(A.every((f, i) => f.x.length === B[i].x.length && f.x.every((v, j) => v === B[i].x[j])), 'evidence.logs frames equal SV.real.logs frames');
check(A.every((f, i) => f.x.every((v, j) => v === A2[i].x[j]) && f.gain === A2[i].gain), 'evidence.logs is deterministic');
check(A.every((f) => f.gain >= 1 && f.gain <= E.CAMERA.ae.maxGain), 'gains lie in [1, maxGain]');
check(A.every((f) => Object.keys(f).sort().join() === 'gain,seed,x'), 'a log frame exposes only x, gain and seed');
/* the linearised frame has the mean scene radiance (before clipping and quantisation errors), within a few per cent */
const pipe = SV.clone(SV.REAL); pipe.scene.pPed = 0.02;
let worst = 0, used = 0;
A.forEach((f) => {
  const rs = SV.stream(f.seed, 'scene'), rl = SV.stream(f.seed, 'look'), scene = SV.drawScene(pipe.scene, rs), look = SV.drawLook(pipe.look, scene, rl);
  const rad = SV.render(scene, look, { maps: false }).rad, lin = E.linear(f);
  let a = 0, b = 0; for (let i = 0; i < rad.length; i++) { a += rad[i]; b += lin[i]; }
  a /= rad.length; b /= rad.length;
  if (f.gain < E.CAMERA.ae.maxGain) { used++; worst = Math.max(worst, Math.abs(b / a - 1)); }       // frames at the gain cap are clipped more often
});
check(used > 10 && worst < 0.05, 'linear() recovers the frame-mean radiance within 5% (worst ' + worst.toFixed(4) + ' over ' + used + ' frames)');
const g = E.logs(300).map((f) => f.gain).sort((a, b) => a - b);
check(g[0] > 1.5 && g[299] === 8 && g.filter((v) => v === 8).length > 60, 'the street is dark: gains from about 1.9 to the cap, a quarter or more at the cap');
if (bad) { console.error(bad + ' failed'); process.exit(1); }
console.log('test_evidence: ok');
