// r4 独立重推：14 有限责任与风险转移。直接对两个状态求期望，不复用页面代码。
var S = 105;
function pay(X, D, q) {                     // 一个状态下：股东、债权人所得
  var sh = Math.max(X - D, 0) - q * Math.max(D - X, 0);
  var cr = Math.min(X, D) + q * Math.max(D - X, 0);
  return [sh, cr];
}
function proj(states, D, q) {               // states: [[概率, 回报], ...]
  var sh = 0, cr = 0, val = 0;
  states.forEach(function (s) { var p = pay(s[1], D, q); sh += s[0] * p[0]; cr += s[0] * p[1]; val += s[0] * s[1]; });
  return { sh: sh, cr: cr, val: val };
}
function run(D, q, dl, g) {
  var mR = S - g, Sp = proj([[1, S]], D, q), Rp = proj([[.5, mR + dl], [.5, mR - dl]], D, q);
  var pickR = Rp.sh > Sp.sh + 1e-9, ch = pickR ? Rp : Sp;
  return { S: Sp, R: Rp, pickR: pickR, loss: Sp.val - ch.val, rec: ch.cr / D, prem: D / ch.cr - 1 };
}
function show(label, D, q, dl, g) {
  var r = run(D, q, dl, g);
  console.log(label.padEnd(10), 'D=' + D, 'q=' + q, 'Δ=' + dl, 'g=' + g,
    '| 股东 S/R ' + r.S.sh.toFixed(2) + '/' + r.R.sh.toFixed(2), '选' + (r.pickR ? 'R' : 'S'),
    '| 损失 ' + r.loss.toFixed(2), '| 回收率 ' + (r.rec * 100).toFixed(2) + '%', '溢价 ' + (r.prem * 100).toFixed(2) + '%',
    '| 债权人 R 下 ' + r.R.cr.toFixed(2));
}
show('债务很少', 30, 0, 50, 5);
show('高负债', 80, 0, 50, 5);
show('面纱0.5', 80, 0.5, 50, 5);
show('无限责任', 80, 1, 50, 5);
show('Δ=0', 80, 0, 0, 5);
show('g=0', 80, 0, 50, 0);
// D*：q=0 时首个让股东改选 R 的 D
function dstar(q, dl, g) { for (var d = 1; d <= 150; d += 0.01) if (run(d, q, dl, g).pickR) return d; return null; }
console.log('D* (q=0, Δ=50, g=5):', dstar(0, 50, 5), ' q=.5:', dstar(.5, 50, 5), ' q=1:', dstar(1, 50, 5), ' g=0:', dstar(0, 50, 0));
// q*：D=80 时让股东恰好改选 S 的 q
function qstar(D, dl, g) { for (var q = 0; q <= 1.0001; q += 0.0005) if (!run(D, q, dl, g).pickR) return q; return null; }
console.log('q* (D=80):', qstar(80, 50, 5), '  解析 2/3 =', 2 / 3);
// 守恒：股东 + 债权人 = 期望回报
var bad = 0, cnt = 0, nan = 0;
for (var D = 10; D <= 140; D += 5) for (var q = 0; q <= 1; q += .05) for (var dl = 0; dl <= 70; dl += 5) for (var g = 0; g <= 30; g++) {
  var r = run(D, q, dl, g); cnt++;
  var chk = (r.pickR ? r.R.sh + r.R.cr : r.S.sh + r.S.cr) - (r.pickR ? r.R.val : r.S.val);
  if (Math.abs(chk) > 1e-9) bad++;
  if (!isFinite(r.rec) || !isFinite(r.prem) || !isFinite(r.loss)) nan++;
}
console.log('网格', cnt, '守恒违反', bad, '非有限值', nan);
// 同一个 D 下，q 越大，债权人回收率越高、股东在 R 下所得越低
console.log('q 单调:', [0, .25, .5, .75, 1].map(function (q) { var r = run(80, q, 50, 5); return r.R.sh.toFixed(1) + '/' + (r.R.cr).toFixed(1); }).join('  '));
// 能让债权人相信 S 时的总价值：80+25 = 105；做不到：65+35 = 100
var a = run(80, 0, 50, 5); console.log('承诺 S:', 80 + a.S.sh, ' 不能承诺:', a.R.cr + a.R.sh);
// Thompson 复核算术
console.log('Thompson', (636 / 1583 * 100).toFixed(2), (339 / 786 * 100).toFixed(2), (237 / 637 * 100).toFixed(2), ' 786+637=', 786 + 637);
