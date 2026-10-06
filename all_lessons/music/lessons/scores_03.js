/* scores_03.js — 第 03 课（音阶与律制）的试听样本：纯律键盘上的"走样"、大调与小调音阶、同一首《欢乐颂》只改一个音。 */
(function (MK) {
  'use strict';
  var h = MK.h;

  /* ① 按 C 调调好的纯律键盘。
     C、F、G 三个大三和弦都是精确的 4:5:6；但把 D 当根音弹一个小三和弦（D F A），D–A 变成 40:27（≈680 音分，比纯五度低 22 音分），
     D–F 变成 32:27（≈294 音分，比纯小三度低 22 音分）——这就是"一个调里无可挑剔，换个落脚点就走样"。
     对照：同样的和弦进行用十二平均律弹。 */
  var JUST = { type: 'just', tonic: 'C4' };
  function jz(name) { return h.at(1, MK.tunedHz(MK.parsePitch(name).midi, JUST)); }       // 纯律键盘上这个键的频率（@Hz 记号）
  function J(names, dur) { return names.map(jz).join('+') + dur; }
  function E(names, dur) { return names.join('+') + dur; }
  var C = ['C4', 'E4', 'G4'], F = ['F4', 'A4', 'C5'], G = ['G4', 'B4', 'D5'], Dm = ['D4', 'F4', 'A4'];
  MK.defineScore('just-keyboard', {
    lesson: 3, title: '按 C 调调好的纯律键盘', tag: 'demo', credit: '纯律 vs 十二平均律',
    tempo: 80, meter: [4, 4], noBars: true, fx: { room: 'room', wet: 0.1 }, tail: 0.8,
    sections: [{ beat: 0, name: '纯律：C F G C' }, { beat: 10, name: '纯律：C Dm G C' }, { beat: 21, name: '平均律：C Dm G C' }],
    note: '第一段：纯律键盘上的 C、F、G 三个大三和弦，都是精确的 4:5:6。第二段：同一副键盘，中间换成以 D 为根的小三和弦（D F A）——D 与 A 之间是 40:27（≈680 音分），比纯五度低约 22 音分；它的泛音与别的音错开约 11 Hz，所以发"毛"。第三段：同样的进行改用十二平均律，每个音程都只偏一点点（五度 −2 音分）。',
    voices: [{
      name: '和弦', inst: 'organ', vol: 1,
      notes: [J(C, 'h'), J(F, 'h'), J(G, 'h'), J(C, 'h'), 'rh',
              J(C, 'h'), J(Dm, 'h.'), J(G, 'h'), J(C, 'h'), 'rh',
              E(C, 'h'), E(Dm, 'h.'), E(G, 'h'), E(C, 'h'), 'rh'].join(' ')
    }]
  });

  /* ② 大调音阶与自然小调音阶（从 C 起）。步长 2-2-1-2-2-2-1 与 2-1-2-2-1-2-2。 */
  MK.defineScore('scales-major-minor', {
    lesson: 3, title: '大调音阶 vs 自然小调音阶', tag: 'orig', credit: '2-2-1-2-2-2-1 与 2-1-2-2-1-2-2',
    tempo: 100, meter: [4, 4], key: 'C', fx: { room: 'room', wet: 0.12 },
    jianpu: { voice: 0, key: 'C' },
    sections: [{ beat: 0, name: '大调' }, { beat: 12, name: '自然小调' }],
    note: '两条音阶都从 C 出发。对比简谱：大调是 1 2 3 4 5 6 7，小调把第 3、6、7 级各降低半音，写作 1 2 ♭3 4 5 ♭6 ♭7。',
    voices: [{
      name: '钢琴', inst: 'piano', vol: 1,
      notes: 'C4q D4q E4q F4q | G4q A4q B4q C5q | rw | C4q D4q Eb4q F4q | G4q Ab4q Bb4q C5q | rw |'
    }]
  });

  /* ③ 同一首《欢乐颂》，大调与小调——只把每个 E 降低半音（第 3 级），其余一概不动；背景是不含"三度"的 C–G 持续音，对两遍一视同仁。 */
  var A2 = h.ODE.A2, A2m = A2.replace(/E4/g, 'Eb4');
  var drone = 'C3+G3w~ | C3+G3w~ | C3+G3w~ | C3+G3w | rw |';
  MK.defineScore('ode-major-minor', {
    lesson: 3, title: '欢乐颂：大调与小调只差一个音', tag: 'pd', credit: '贝多芬 · 1824',
    tempo: 100, meter: [4, 4], key: 'C', fx: { room: 'hall', wet: 0.14 },
    jianpu: { voice: 0, key: 'C' },
    sections: [{ beat: 0, name: '大调' }, { beat: 20, name: '小调：每个 E 降半音' }],
    note: '两遍的旋律、节奏、速度、背景（C 与 G 的持续音，里面没有"三度"）完全一样，差别只有一个：第二遍把每个 E 换成了 E♭——也就是把第 3 级降低半音。注意简谱里的 3 变成了 ♭3。',
    voices: [
      { name: '旋律', inst: 'flute', vol: 1, notes: A2 + ' rw | ' + A2m + ' rw |' },
      { name: '背景持续音', inst: 'pad', vol: 0.55, notes: drone + ' ' + drone }
    ]
  });
})((typeof window !== 'undefined' && window.MusicKit) || require('./musickit.js'));
