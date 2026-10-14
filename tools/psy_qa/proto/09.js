// proto/07.js — lesson 07 widget maths: the same face on different bodies → the label follows the context, in proportion to how plausible the context makes the face.
// 受 Aviezer 等人 2008 启发的简化模型 (示意): NOT their equation; two free numbers (β, γ) and a hand-set similarity table (示意).
// run: node tools/psy_qa/proto/07.js
// Labels (6-way forced choice): 愤怒 anger, 厌恶 disgust, 恐惧 fear, 开心 happiness, 悲伤 sadness, 惊讶 surprise.
// Face evidence:   P(face | label k) ∝ exp(β · S_k),  S_k = how similar the shown face (a disgust face) is to the typical face of emotion k.
// Context evidence (the body/scene says emotion c): added log-weight on label c:  γ · S_c   (gated: the context counts only as far as the face makes it plausible)
//                                                                              or γ · 1     (ungated: every context pulls equally hard).
// Posterior ∝ exp(face evidence + context evidence).
var LAB = ['愤怒', '厌恶', '恐惧', '开心', '悲伤', '惊讶'];
var S = { 愤怒: 0.70, 厌恶: 1.00, 恐惧: 0.25, 开心: 0.00, 悲伤: 0.35, 惊讶: 0.00 };     // similarity of the shown (disgust) face to each emotion's typical face (示意, hand-set)
var BETA = 3.7, GAMMA = 4.4;                                                                 // β: how diagnostic the face is; γ: how strong the context is (示意, set by hand to Aviezer's anger-body and no-context cells)
function posterior(ctx, beta, gamma, gated) {
  var w = LAB.map(function (k) { var e = beta * S[k]; if (ctx && ctx === k) e += gamma * (gated === false ? 1 : S[k]); return Math.exp(e); });
  var z = w.reduce(function (a, b) { return a + b; }, 0); return w.map(function (x) { return x / z; });
}
if (require.main === module) {
  var human = { none: { 厌恶: 65.6 }, 厌恶: { 厌恶: 91 }, 恐惧: { 厌恶: 59, 恐惧: 13 }, 悲伤: { 厌恶: 35, 悲伤: 29 }, 愤怒: { 厌恶: 11, 愤怒: 87 } };
  ['gated', 'ungated'].forEach(function (mode) {
    console.log('=== ' + mode + ' (β=' + BETA + ', γ=' + GAMMA + ')');
    ['none', '厌恶', '恐惧', '悲伤', '愤怒'].forEach(function (c) {
      var p = posterior(c === 'none' ? null : c, BETA, GAMMA, mode === 'gated');
      console.log((c === 'none' ? '无背景(单独的脸)' : '背景=' + c).padEnd(14), LAB.map(function (k, i) { return k + ' ' + (100 * p[i]).toFixed(0).padStart(2) + '%'; }).join('  '), mode === 'gated' ? '  | 人类(Aviezer 2008, N=16, 图读数):' + JSON.stringify(human[c]) : '');
    });
  });
  console.log('β sweep (face diagnosticity), anger context, gated:'); [0, 1, 2, 3.7, 6, 8].forEach(function (b) { var p = posterior('愤怒', b, GAMMA); var q = posterior(null, b, GAMMA); console.log('  β=' + b, '  无背景 厌恶 ' + (100 * q[1]).toFixed(0) + '%   愤怒背景: 厌恶 ' + (100 * p[1]).toFixed(0) + '%  愤怒 ' + (100 * p[0]).toFixed(0) + '%'); });
  console.log('γ sweep (context strength), sadness context, gated:'); [0, 2, 4.4, 8, 10].forEach(function (g) { var p = posterior('悲伤', BETA, g); console.log('  γ=' + g, '厌恶 ' + (100 * p[1]).toFixed(0) + '%  悲伤 ' + (100 * p[4]).toFixed(0) + '%'); });
  console.log('γ sweep, fear context, gated vs ungated:'); [0, 4.4, 8, 10].forEach(function (g) { var a = posterior('恐惧', BETA, g, true), b = posterior('恐惧', BETA, g, false); console.log('  γ=' + g, ' gated 恐惧 ' + (100 * a[2]).toFixed(0) + '%  ungated 恐惧 ' + (100 * b[2]).toFixed(0) + '%'); });
  // fit quality (gated): errors on the labelled human cells
  var cells = [['none', 1, 65.6], ['厌恶', 1, 91], ['恐惧', 1, 59], ['恐惧', 2, 13], ['悲伤', 1, 35], ['悲伤', 4, 29], ['愤怒', 1, 11], ['愤怒', 0, 87]], se = 0;
  cells.forEach(function (c) { var p = posterior(c[0] === 'none' ? null : c[0], BETA, GAMMA)[c[1]] * 100; se += (p - c[2]) * (p - c[2]); console.log('  cell', c[0], LAB[c[1]], 'model', p.toFixed(1), 'human', c[2], 'diff', (p - c[2]).toFixed(1)); });
  console.log('RMSE over 8 cells:', Math.sqrt(se / cells.length).toFixed(1), 'points');
}
module.exports = { posterior: posterior, LAB: LAB, S: S, BETA: BETA, GAMMA: GAMMA };
