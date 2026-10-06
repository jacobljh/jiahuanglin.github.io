/* scores_02.js — 第 02 课（协和与音程）的试听样本：协和的阶梯、同一句旋律叠上不同音程、拍音的阶梯、毕达哥拉斯音差。
 * 全部用"精确频率比"（@Hz 记号），不经过钢琴的十二平均律——课上说的就是比例本身。 */
(function (MK) {
  'use strict';
  var h = MK.h;

  /* ① 从最简单到最复杂：12 个比值，低音固定 220 Hz，管风琴音色（泛音清晰，才听得出"泛音对得上对不上"）。
     排序依据：分子×分母（越小越简单）。同度、八度、五度、四度……直到三全音 45:32。 */
  var LADDER = [[1, 1, '同度'], [2, 1, '八度'], [3, 2, '纯五度'], [4, 3, '纯四度'], [5, 3, '大六度'], [5, 4, '大三度'],
                [6, 5, '小三度'], [8, 5, '小六度'], [9, 8, '大二度'], [15, 8, '大七度'], [16, 15, '小二度'], [45, 32, '三全音']];
  var lo = [], hi = [], secs = [];
  LADDER.forEach(function (r, i) {
    lo.push('@220h re');
    hi.push(h.at(r[0] / r[1], 220) + 'h re');
    secs.push({ beat: i * 2.5, name: r[0] + ':' + r[1] });
  });
  MK.defineScore('interval-ladder', {
    lesson: 2, title: '协和的阶梯：从最简单的比到最复杂的比', tag: 'demo', credit: '低音 220 Hz · 管风琴音色',
    tempo: 80, meter: [4, 4], noBars: true, fx: { room: 'room', wet: 0.1 }, tail: 0.6, sections: secs,
    note: '十二对音，依次是：' + LADDER.map(function (r) { return r[2] + ' ' + r[0] + ':' + r[1]; }).join('、') + '。每一对都是低音 220 Hz 加上按精确比例算出的高音，排序依据是"分子×分母"从小到大。',
    voices: [{ name: '低音', inst: 'organ', vol: 1, seed: 'lo', notes: lo.join(' ') }, { name: '高音', inst: 'organ', vol: 1, seed: 'hi', notes: hi.join(' ') }]
  });

  /* ② 同一句旋律，叠上另一个音程：欢乐颂的头两小节（E E F G | G F E D），第二条线整体乘一个频率比。
     原旋律 → +八度(2:1) → +五度(3:2) → +三全音(45:32) → +小二度(16:15)。 */
  var TUNE = 'E4q E4q F4q G4q | G4q F4q E4q D4q |';
  var VERS = [[null, '原旋律'], [2, '+八度 2:1'], [3 / 2, '+五度 3:2'], [45 / 32, '+三全音 45:32'], [16 / 15, '+小二度 16:15']];
  var m1 = [], m2 = [], s2 = [];
  VERS.forEach(function (v, i) {
    m1.push(TUNE + ' rq |');
    m2.push((v[0] ? h.scaleHz(TUNE, v[0]) : h.rst(8)) + ' rq |');
    s2.push({ beat: i * 9, name: v[1] });
  });
  MK.defineScore('ode-doubling', {
    lesson: 2, title: '同一句旋律，叠上另一条"影子"', tag: 'pd', credit: '贝多芬 · 欢乐颂 · 1824',
    tempo: 120, meter: [4, 4], key: 'C', noBars: true, fx: { room: 'room', wet: 0.1 }, tail: 0.6, sections: s2,
    note: '第一条线始终是原旋律（欢乐颂开头：E E F G | G F E D）；第二条线是它的"影子"，每个音的频率都乘同一个比例：2:1（高八度）、3:2（高纯五度）、45:32（三全音）、16:15（小二度）。只改比例，别的什么都不变。',
    voices: [{ name: '原旋律', inst: 'organ', vol: 1, seed: 'a', notes: m1.join(' ') }, { name: '影子', inst: 'organ', vol: 1, seed: 'b', notes: m2.join(' ') }]
  });

  /* ③ 拍音的阶梯：440 Hz 的纯音，加上一个只高 Δ Hz 的纯音；Δ = 1、3、7、15、35、70、140。 */
  var DELTA = [1, 3, 7, 15, 35, 70, 140], b1 = [], b2 = [], s3 = [];
  DELTA.forEach(function (d, i) {
    b1.push('@440w re'); b2.push('@' + (440 + d) + 'w re');
    s3.push({ beat: i * 4.5, name: '差 ' + d + ' Hz' });
  });
  MK.defineScore('beating-ladder', {
    lesson: 2, title: '拍音的阶梯：两个纯音越拉越开', tag: 'demo', credit: '440 Hz + (440+Δ) Hz · 纯正弦',
    tempo: 90, meter: [4, 4], noBars: true, tail: 0.4, sections: s3,
    note: '七组纯正弦，下面的音永远是 440 Hz，上面的音依次是 441、443、447、455、475、510、580 Hz。拍频就是两个频率的差：每秒 1 次、3 次、7 次、15 次、35 次、70 次、140 次。',
    voices: [{ name: '440 Hz', inst: 'sine', vol: 1, seed: 'a', notes: b1.join(' ') }, { name: '440 + Δ', inst: 'sine', vol: 1, seed: 'b', notes: b2.join(' ') }]
  });

  /* ④ 十二个纯五度，回不到起点：C 出发，一路往上叠纯五度（×3/2），每次超出一个八度就折回来；
     叠到第 12 次，本该回到 C，却高出 23.46 音分（毕达哥拉斯音差），与真正的 C 同响时每秒拍 3.57 次。 */
  var f0 = MK.midiToHz(60), f = f0, circle = [], names = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'E♯', 'B♯'];
  for (var k = 0; k <= 12; k++) { circle.push(f); f *= 1.5; while (f >= 2 * f0 - 1e-9) f /= 2; }
  var lastHz = circle[12];
  var up = circle.map(function (x) { return h.at(1, x) + 'e'; }).join(' ');
  var cNote = h.at(1, f0), bNote = h.at(1, lastHz);
  MK.defineScore('pythagorean-comma', {
    lesson: 2, title: '十二个纯五度，回不到起点', tag: 'demo', credit: '音差 ≈ 23.46 音分 · 拍频 ≈ 3.6 Hz',
    tempo: 120, meter: [4, 4], noBars: true, fx: { room: 'room', wet: 0.1 }, tail: 0.8,
    sections: [{ beat: 0, name: '12 个纯五度' }, { beat: 7.5, name: '出发的 C' }, { beat: 10, name: '走完一圈的 C' }, { beat: 12.5, name: '一起响' }],
    note: '前 13 个音是五度圈的 C G D A E B F♯ C♯ G♯ D♯ A♯ E♯ B♯（每个音都折回同一个八度里）。最后一个 B♯ 本该就是出发的 C，实际是 ' + lastHz.toFixed(2) + ' Hz，比 C（' + f0.toFixed(2) + ' Hz）高 ' + (1200 * Math.log2(lastHz / f0)).toFixed(2) + ' 音分。两个一起响时，拍频 = ' + (lastHz - f0).toFixed(2) + ' Hz。',
    voices: [{
      name: '五度圈', inst: 'organ', vol: 1, seed: 'a',
      notes: up + ' rq ' + cNote + 'h re rh re ' + cNote + 'w rw'
    }, {
      name: '走完一圈的 C', inst: 'organ', vol: 1, seed: 'b',
      notes: h.rst(10) + ' ' + bNote + 'h re ' + bNote + 'w rw'
    }]
  });
})((typeof window !== 'undefined' && window.MusicKit) || require('./musickit.js'));
