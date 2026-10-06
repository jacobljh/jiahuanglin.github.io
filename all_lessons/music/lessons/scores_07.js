/* scores_07.js — 第 07 课（节奏与节拍）的试听样本：
   脉搏拧快变成音高；同样的滴答、不同的"拍子"；同一串音 4 个一组 vs 3 个一组；同一个网格两种排法；只剩节奏；
   同一句欢乐颂把重音挪进缝里；乔普林的雷格泰姆；律动阶梯（鼓机 → 力度 → 摇摆 → 微偏）。
   引擎新增的 barBeats（显式小节线）/ swing（按小节给）/ late（微偏）就是为这一课加的。 */
(function (MK) {
  'use strict';
  var h = MK.h, ODE = h.ODE;
  function rep(a, n) { var o = []; for (var i = 0; i < n; i++) o.push(a); return o; }
  function times(s, n) { return rep(s, n).join(' '); }

  /* ① 把脉搏越拧越快：先是 60、120 BPM 的普通脉搏，然后速度按指数一路拧到 6600 BPM（每秒 110 下），最后停在那里。
     每一下都是同一个短促的"嗒"。BPM 只是"每分钟几下"；除以 60 就是每秒几下（Hz）——和第 01 课的频率是同一件事。 */
  var P_A = 4, P_B = 8, P_G = 377, P_H = 330, P_N = P_A + P_B + P_G + P_H;
  function glideBeat(bpm) { return 12 + (bpm - 120) / (6600 - 120) * P_G; }
  MK.defineScore('pulse-to-pitch', {
    lesson: 7, title: '把脉搏越拧越快：节奏变成音高', tag: 'demo', credit: '60 → 6600 BPM（1 → 110 Hz）',
    tempo: [[0, 60], [P_A, 60], [P_A + 0.001, 120], [12, 120], [12 + P_G, 6600], [12 + P_G + P_H, 6600]],
    meter: [P_N, 4], noBars: true, barBeats: [], normalize: 'peak', tail: 0.6,
    sections: [
      { beat: 0, name: '1 Hz' }, { beat: P_A, name: '2 Hz' }, { beat: glideBeat(600), name: '10 Hz' },
      { beat: glideBeat(1200), name: '20 Hz' }, { beat: glideBeat(2400), name: '40 Hz' }, { beat: 12 + P_G, name: '110 Hz' }
    ],
    note: '前两段是普通的脉搏：每分钟 60 下（每秒 1 下），再快一倍是每分钟 120 下（每秒 2 下）。然后把速度一路拧快，卷帘图上的小竖线越挤越密。请你自己听：从哪里开始，“一下一下”的敲击变成了“一个音”？最后一段是每秒 110 下（每分钟 6600 下），正是低音 A（A2，110 Hz）——第 01 课里 440 Hz 的 A 再低两个八度。节拍和音高是同一根轴上的两端：都是“每秒重复几次”。',
    voices: [{ name: '脉冲', grid: { click: new Array(P_N + 1).join('X') }, perBeat: 1, bars: 1 }]
  });

  /* ② 同样的滴答，不同的"拍子"：每段 12 下（2、3、4 的最小公倍数），全是同一个木块声。
     第一段一模一样；后三段只改"哪几下重一点"。 */
  MK.defineScore('meter-accents', {
    lesson: 7, title: '同样的滴答，不同的“拍子”', tag: 'demo', credit: '音色、间隔都一样，只改“哪几下重一点”',
    tempo: 112, meter: [12, 4], noBars: true, normalize: 'peak', tail: 0.5,
    sections: [{ beat: 0, name: '一模一样' }, { beat: 12, name: '每 2 下重' }, { beat: 24, name: '每 3 下重' }, { beat: 36, name: '每 4 下重' }],
    note: '四段用的是同一个木块声，间隔也一样（每分钟 112 下）。第一段连重音都没有——听听你的脑子会不会自己把它们两个两个、或四个四个地分组。后三段只改一件事：每隔 2、3、4 下，把一下敲重一点，其余的轻一点。这就是 2/4、3/4、4/4 的骨架。',
    voices: [{ name: '滴答', grid: { wood: ['xxxxxxxxxxxx', 'XoXoXoXoXoXo', 'XooXooXooXoo', 'XoooXoooXooo'] }, perBeat: 1, bars: 4, dyn: 1.2 }]
  });

  /* ③ 同一串音，4 个一组 vs 3 个一组：欢乐颂开头的 12 个音（E E F G G F E D C C D E）原封不动，只改"几个音一组"。
     伴奏只有两个和弦（C 与 G7）；4/4 里是"嘭—嚓—嘭—嚓"，3/4 里是"嘭—嚓—嚓"。 */
  var CH = 'E3+G3+C4', GV = 'F3+B3+D4';
  MK.defineScore('ode-3-4', {
    lesson: 7, title: '欢乐颂的前 12 个音：4 个一组 vs 3 个一组', tag: 'pd', credit: '贝多芬 · 1824 · 本课改写了拍号',
    tempo: 108, meter: [4, 4], key: 'C', barBeats: [0, 4, 8, 12, 16, 19, 22, 25, 28, 31], toggles: true, fx: { room: 'room', wet: 0.1 }, tail: 1.0,
    sections: [{ beat: 0, name: '4 个一组（4/4）' }, { beat: 16, name: '3 个一组（3/4）' }],
    note: '同样的 12 个音，同样的速度，同样的 C 与 G7 两个和弦；只改了一件事：按几个音一组来数拍子。第一遍 4 个一组，重音在第 1、3 拍；第二遍 3 个一组，重音在每组的第一个音，左手变成“嘭—嚓—嚓”，成了圆舞曲的步子。注意：原曲是 4/4，这里改成 3/4 只是为了演示。',
    voices: [
      { name: '旋律', inst: 'flute', vol: 1, notes: 'E4q E4q F4q G4q | G4q F4q E4q D4q | C4q C4q D4q E4q | E4h rh | E4q E4q F4q | G4q G4q F4q | E4q D4q C4q | C4q D4q E4q | E4h. |' },
      {
        name: '伴奏', inst: 'piano', vol: 0.8,
        notes: ['>C2q ' + CH + 'q G2q ' + CH + 'q |', '>G2q ' + GV + 'q D3q ' + GV + 'q |', '>C2q ' + CH + 'q G2q ' + CH + 'q |', 'C2+E3+G3+C4h rh |',
                '>C2q ' + CH + 'q ' + CH + 'q |', '>G2q ' + GV + 'q ' + GV + 'q |', '>C2q ' + CH + 'q ' + CH + 'q |', '>C2q ' + CH + 'q ' + CH + 'q |', 'C2+E3+G3+C4h. |'].join(' ')
      }
    ]
  });

  /* ④ 同一个网格，两种排法：音高永远是 C D E，底下的木块一刻不停。 */
  MK.defineScore('rhythm-cells', {
    lesson: 7, title: '哆来咪：同一个网格，两种排法', tag: 'orig', credit: 'C D E · 网格不变，时值不同',
    tempo: 92, meter: [4, 4], key: 'C', fx: { room: 'room', wet: 0.1 }, tail: 0.9,
    sections: [{ beat: 0, name: '排法 A：1·1·2' }, { beat: 8, name: '排法 B：½·½·3' }],
    note: '音高永远是 C D E，底下的拍子（木块）一刻不停。排法 A：哆 1 拍、来 1 拍、咪 2 拍；排法 B：哆半拍、来半拍、咪 3 拍。同一个网格，换一种时值排列，口气就变了。',
    voices: [
      { name: '旋律', inst: 'flute', vol: 1, notes: 'C4q D4q E4h | C4q D4q E4h | C4e D4e E4h. | C4e D4e E4h. |' },
      { name: '拍子（一直在走）', grid: { wood: 'xxxx' }, perBeat: 1, bars: 4, vol: 0.5 }
    ]
  });

  /* ⑤ 只剩节奏：每个起音一下木块，音高全部抹平。A = 贝多芬第五交响曲开头五小节（含两个延长记号），B = 欢乐颂的第一句。
     拍子一律按"每小节 2 拍"切，B 的小节线另给（barBeats）。长音只表现为"隔了很久才有下一下"。 */
  var B5 = '!v=1 re G4e G4e G4e | Eb4h | re F4e F4e F4e | D4h~ | D4h |';
  MK.defineScore('rhythm-alone', {
    lesson: 7, title: '只剩节奏：认得出是哪两首吗？', tag: 'pd', credit: '两首公有领域的曲子 · 音高已全部抹平',
    tempo: [[0, 200], [2, 200], [2.05, 36], [4, 36], [4.05, 200], [6, 200], [6.05, 52], [10, 52], [10.001, 108]],
    meter: [2, 4], noBars: true, barBeats: [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 28], normalize: 'peak', tail: 0.6,
    sections: [{ beat: 0, name: 'A' }, { beat: 12, name: 'B' }],
    note: '两段都只剩节奏：所有音高被抹平成同一下敲击，长音只表现为“隔了很久才有下一下”。想一想，A 和 B 各是哪一首？',
    voices: [{ name: '敲击', grid: { wood: h.rhythmGrid(B5, 2, 2).concat(['....'], h.rhythmGrid(ODE.A, 2, 2)) }, perBeat: 2, bars: 14 }]
  });

  /* ⑥ 同一句欢乐颂，只把每小节最后一个音提前半拍（并拖长，跨过第 4 拍）；每小节的第 4 个音原来在第 4 拍，现在起在"第 3 拍的后半"。
     底下一直是同样的脉搏：底鼓踩每一拍，踩镲点在拍与拍之间。末小节（乐句收尾）保持原样。 */
  var SY = 'E4q E4q F4e G4q. | G4q F4q E4e D4q. | C4q C4q D4e E4q. | E4q. D4e D4h |';
  MK.defineScore('ode-syncopated', {
    lesson: 7, title: '同一句欢乐颂：一个音抢先半拍', tag: 'pd', credit: '贝多芬 · 1824 · 本课改写了节奏',
    tempo: 104, meter: [4, 4], key: 'C', toggles: true, speeds: [0.7, 1], fx: { room: 'room', wet: 0.1 }, tail: 1.0,
    sections: [{ beat: 0, name: '重音都在拍上' }, { beat: 16, name: '最后一个音抢先半拍' }],
    note: '同一句欢乐颂，同一个底下的脉搏（底鼓踩每一拍，踩镲点在拍与拍之间）。第一遍每个音都落在拍上；第二遍只改了每小节的最后一个音：提前半拍起（落在“第 3 拍的后半”），再拖长跨过第 4 拍。音高一个没变，只是有一个重音挪进了缝里。',
    voices: [
      { name: '旋律', inst: 'flute', vol: 1, notes: ODE.A + ' ' + SY },
      { name: '拍子', grid: { kick: 'x.x.x.x.', hat: '.o.o.o.o' }, perBeat: 2, bars: 8, vol: 0.55 }
    ]
  });

  /* ⑦ 乔普林《The Entertainer》（1902）第一段（16 小节 + 起拍 D–D♯）。Mutopia（公有领域）排版；上/下谱表分成两个声部。
     乐谱文本由该排版源码机械生成（不是手敲），见 tools/music 的说明。2/4，起拍 1.5 拍的空白用 skip 跳过。 */
  var RH = 'rq re D4s D#4s | E4s C5e E4s C5e E4s C5s~ | C5q~ C5s C6+E5+C5s D6+F5+D5s D#6+F#5+D#5s | E6+G5+E5s C6+E5+C5s D6+F5+D5s E6+G5+E5e B5+D5+B4s D6+F5+D5e | C6+E5+C5q. D4s D#4s | E4s C5e E4s C5e E4s C5s~ | C5q. A5+C5+A4s G5+C5+G4s | F#5+C5+F#4s A5+A4s C6+C5s E6+E5e D6+D5s C6+C5s A5+A4s | D6+F5+D5q. D4s D#4s | E4s C5e E4s C5e E4s C5s~ | C5q~ C5s C6+E5+C5s D6+F5+D5s D#6+F#5+D#5s | E6+G5+E5s C6+E5+C5s D6+F5+D5s E6+G5+E5e B5+D5+B4s D6+F5+D5e | C6+E5+C5q. C6+C5s D6+D5s | E6+E5s C6+C5s D6+D5s E6+E5e C6+C5s D6+D5s C6+C5s | E6+E5s C6+C5s D6+D5s E6+E5e C6+C5s D6+D5s C6+C5s | E6+G5+E5s C6+E5+C5s D6+F5+D5s E6+G5+E5e B5+D5+B4s D6+F5+D5e | C6+E5+C5q C6+E5+C5e re |', LH = 'rh | C3e C4+G3+E3e G3+G2e C4+Bb3+G3e | F3+F2e C4+A3e E3+E2e C4+G3e | G2e C4+G3+E3e G2e B3+G3+F3e | C3e C4+G3+E3e C4+G3+E3e B3+G3e | C3e C4+G3+E3e G3+G2e C4+Bb3+G3e | F3+F2e C4+A3e E3+E2e Eb3+Eb2e | D3+D2e C4+A3+F#3+D3e D3e C4+A3+F#3e | B3+G3e G3+G2e A3+A2e B3+B2e | C3e C4+G3+E3e G3+G2e C4+Bb3+G3e | F3+F2e C4+A3e E3+E2e C4+G3e | G2e C4+G3+E3e G2e B3+G3+F3e | C3e C4+G3+E3e E4+C4+G3e re | C4+C3e E4+C4+G3e Bb3+Bb2e E4+C4+G3e | A3+A2e F4+C4+A3e Ab3+Ab2e F4+C4+Ab3e | G3+G2e E4+C4+G3e G2e B3+G3e | C4+G3+C3e G3+G2e C3+C2e re |';
  var EBARS = []; for (var eb = 2; eb <= 34; eb += 2) EBARS.push(eb);
  MK.defineScore('entertainer', {
    lesson: 7, title: '乔普林《The Entertainer》：旋律错位，低音稳定', tag: 'pd', credit: '乔普林 · 1902 · 第一段（16 小节）',
    tempo: 76, meter: [2, 4], key: 'C', skip: 1.5, barBeats: EBARS, toggles: true, speeds: [0.6, 0.8, 1], fx: { room: 'room', wet: 0.12 }, tail: 1.2,
    sections: [{ beat: 2, name: 'a' }, { beat: 10, name: 'b' }, { beat: 18, name: 'a′' }, { beat: 26, name: 'c' }],
    note: '乔普林《The Entertainer》（1902）的第一段。上谱表是旋律：起音大多落在拍与拍之间，还常把音连过强拍；下谱表一直是稳稳的“嘭—嚓”，每个起音都在八分音符的格点上。试着只开一个声部听，再合起来听。乐谱取自 Mutopia 的公有领域排版，合成钢琴，不是演奏录音。',
    voices: [
      { name: '上谱表（旋律）', inst: 'piano', vol: 1, notes: RH },
      { name: '下谱表（“嘭—嚓”）', inst: 'piano', vol: 0.8, notes: LH }
    ]
  });

  /* ⑧ 律动阶梯：四段 × 4 小节，同一条节奏（底鼓、军鼓、踩镲、贝斯），每段只多加一样东西。
     ① 鼓机：每一下一样重、严格卡在格子上；② 加力度：踩镲拍上重、拍间轻，军鼓后面带轻轻的"鬼音"，贝斯拍上重；
     ③ 加摇摆：每拍里的后半拍从正中（0.5）挪到三分之二处（长—短）；④ 加微偏：军鼓整体拖后 18 毫秒。 */
  var SW = rep(0.5, 8).concat(rep(0.667, 8));
  var K1 = 'x.....x.x.......', K2 = 'X.....x.X.......', S1 = '....x.......x...', S2 = '....X..o....X..o', H1 = 'x.x.x.x.x.x.x.x.', H2 = 'X.o.X.o.X.o.X.o.';
  var BASS = '!v=0.7 ' + times('C2e C2e C2e Eb2e F2e F2e Eb2e C2e |', 4) + ' !v=0.5 ' + times('>C2e C2e >C2e Eb2e >F2e F2e >Eb2e C2e |', 12);
  MK.defineScore('groove-ladder', {
    lesson: 7, title: '律动阶梯：鼓机 → 力度 → 摇摆 → 微偏', tag: 'orig', credit: '同一条节奏，每段多加一样东西',
    tempo: 96, meter: [4, 4], key: 'C', fx: { room: 'room', wet: 0.1 }, tail: 0.8,
    sections: [{ beat: 0, name: '① 鼓机' }, { beat: 16, name: '② 力度' }, { beat: 32, name: '③ 摇摆' }, { beat: 48, name: '④ 微偏' }],
    note: '四段是同一条节奏。① 鼓机：每一下一样重，严格卡在格子上。② 加力度：踩镲拍上重、拍间轻，军鼓后面带上轻轻的“鬼音”，贝斯拍上重。③ 加摇摆：每拍里的后半拍从正中挪到三分之二处（长—短）。④ 加微偏：军鼓整体拖后 18 毫秒。网格自始至终没动，变的是“偏离网格”的方式。',
    voices: [
      { name: '底鼓', grid: { kick: rep(K1, 4).concat(rep(K2, 12)) }, perBeat: 4, bars: 16, swing: SW, dyn: 1, vol: 1 },
      { name: '军鼓', grid: { snare: rep(S1, 4).concat(rep(S2, 12)) }, perBeat: 4, bars: 16, swing: SW, late: rep(0, 12).concat(rep(0.018, 4)), dyn: 1, vol: 0.9 },
      { name: '踩镲', grid: { hat: rep(H1, 4).concat(rep(H2, 12)) }, perBeat: 4, bars: 16, swing: SW, dyn: 1, vol: 0.8 },
      { name: '贝斯', inst: 'bass', vol: 0.9, swing: SW, notes: BASS }
    ]
  });
})((typeof window !== 'undefined' && window.MusicKit) || require('./musickit.js'));
