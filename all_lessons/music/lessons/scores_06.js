/* scores_06.js — 第 06 课（旋律）的试听样本：跳进与填回（小星星）；《欢乐颂》的张力线；一颗动机的五种长法；贝多芬第五的开头；和弦音与和声外音。 */
(function (MK) {
  'use strict';
  var h = MK.h, R = h.R;

  /* ① 跳进设置期待，级进偿还它：《小星星》的前两行。C→G 跳了一个纯五度，中间的 D E F 被"空"了出来；下一行 F E D C 一级一级走下来，把缺口填回。
     旋律：法国民歌 Ah! vous dirai-je, maman（1761 年出版）。逐音对照 Wikipedia 的 LilyPond。 */
  MK.defineScore('leap-and-fill', {
    lesson: 6, title: '跳进，然后填回：《小星星》的前两行', tag: 'folk', credit: 'Ah! vous dirai-je, maman · 1761',
    tempo: 100, meter: [4, 4], key: 'C', fx: { room: 'room', wet: 0.12 }, toggles: false,
    jianpu: { voice: 0, key: 'C' },
    sections: [{ beat: 2, name: '跳进 C→G' }, { beat: 8, name: '级进下行·填回' }],
    note: '第一个动作是一个<b>跳进</b>：第二个 C 一跃到 G（纯五度），中间的 D、E、F 三个音被"空"了出来。后面先在 A、G 附近绕了一下，到第三、四小节才用 F–E–D–C 一级一级走下来，把这段空隙补满。',
    voices: [{ name: '旋律', inst: 'flute', vol: 1, notes: 'C4q C4q G4q G4q | A4q A4q G4h | F4q F4q E4q E4q | D4q D4q C4h |' }]
  });

  /* ② 《欢乐颂》整条旋律与它的张力线：每个音按第 06 课的"不稳定度"表打分（C 最稳 0.05，导音 B 最高 0.95，这条旋律里没有 B）。 */
  var ODE = h.ODE;
  MK.defineScore('ode-tension', {
    lesson: 6, title: '欢乐颂与它的张力线', tag: 'pd', credit: '贝多芬 · 1824',
    tempo: 108, meter: [4, 4], key: 'C', fx: { room: 'hall', wet: 0.14 },
    jianpu: { voice: 0, key: 'C' }, sections: ODE.sections,
    curve: { label: '张力线：离主音 C 越远、越不稳，越高', points: h.tensionCurve(ODE.melody) },
    note: '卷帘图下面的橙色折线，是每个音按"不稳定度"表打的分：C 贴着地板（0.05），E、G 较低，D、F 较高。注意四个乐句的终点：第一句停在 D（0.55，离地板还远）；第三句（桥句）一直在 D、F 这些较不稳的音上来回，最后落在低八度的 G；只有第二、四句的终点 C 才贴着地板。',
    voices: [{ name: '旋律', inst: 'flute', vol: 1, notes: ODE.melody }]
  });

  /* ③ 一颗动机，五种长法：动机 C D E G E（与"动机发展器"默认值相同）。
     原型 → 重复 → 移位（上移一个音阶级）→ 模进（连爬三档）→ 倒影（以首音 C 为轴上下翻转）→ 扩大（时值×2）→ 缩小（时值×½）。 */
  var M = ['C4', 'D4', 'E4', 'G4', 'E4'], MDEG = [0, 1, 2, 4, 2], NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  function nm(deg, oct0) { var o = oct0 + Math.floor(deg / 7), k = ((deg % 7) + 7) % 7; return NAMES[k] + o; }
  function motif(degs, dur) { return degs.map(function (d) { return nm(d, 4) + dur; }).join(' '); }
  function sh(d) { return MDEG.map(function (x) { return x + d; }); }
  var segs = [
    ['原型', motif(MDEG, 'e')],
    ['重复', motif(MDEG, 'e') + ' ' + motif(MDEG, 'e')],
    ['移位 +2度', motif(sh(1), 'e')],
    ['模进 ×3', motif(sh(0), 'e') + ' ' + motif(sh(1), 'e') + ' ' + motif(sh(2), 'e')],
    ['倒影', motif(MDEG.map(function (x) { return -x; }), 'e')],
    ['扩大 ×2', motif(MDEG, 'q')],
    ['缩小 ×½', motif(MDEG, 's') + ' ' + motif(MDEG, 's')]
  ];
  var mnotes = [], msec = [], mb = 0, allForCurve = [];
  segs.forEach(function (sg) {
    var ev = MK.parseVoice(sg[1], {}), cells = Math.ceil((ev.total + 1) / 4) * 4;     // 每段占整数个 4 拍格子，段间留白
    msec.push({ beat: mb, name: sg[0] });
    mnotes.push(sg[1] + ' ' + h.rst(cells - ev.total));
    allForCurve.push(sg[1] + ' ' + h.rst(cells - ev.total));
    mb += cells;
  });
  MK.defineScore('motif-techniques', {
    lesson: 6, title: '一颗动机，五种长法', tag: 'orig', credit: '动机 C D E G E',
    tempo: 100, meter: [4, 4], key: 'C', noBars: true, fx: { room: 'room', wet: 0.1 }, tail: 0.8,
    sections: msec,
    curve: { label: '张力线（导音 B 标红）', points: h.tensionCurve(allForCurve.join(' ')) },
    note: '同一颗种子的七种样子：原样重复；整体抬高一个音阶级（移位）；一档一档往上爬（模进）；上下翻转（倒影，C D E G E 变成 C B A F A）；每个音拉长一倍（扩大）；压短一半、说两遍（缩小）。卷帘图上能看见：形状在，位置、方向或长度变了。',
    voices: [{ name: '动机', inst: 'piano', vol: 1, notes: mnotes.join(' ') }]
  });

  /* ④ 贝多芬第五交响曲开头五小节（1808）：动机 G G G E♭，然后原样低一个音级再来一遍（F F F D）——模进。
     音高与时值对照 Wikipedia 的 LilyPond；两个延长记号（fermata）用速度曲线"停"住。 */
  MK.defineScore('beethoven5-opening', {
    lesson: 6, title: '贝多芬第五交响曲：开头的动机与模进', tag: 'pd', credit: '贝多芬 · 1808',
    tempo: [[0, 200], [2, 200], [2.05, 36], [4, 36], [4.05, 200], [6, 200], [6.05, 52], [10, 52]],
    meter: [2, 4], key: 'Cm', fx: { room: 'hall', wet: 0.16 }, tail: 1.6,
    sections: [{ beat: 0, name: '动机' }, { beat: 4, name: '模进（低一级）' }],
    note: '开头是八分休止加三个短音，再接一个带延长记号的长音：G G G E♭。第二遍原样低一个音阶级：F F F D。两个延长记号处，速度被拉得很慢，这是原谱要求的"停住"。这个"短短短长"的节奏，将在整首交响曲的四个乐章里反复出现。',
    voices: [
      { name: '弦乐', inst: 'strings', vol: 1, dyn: 0.6, notes: '!v=1 re G4e G4e G4e | Eb4h | re F4e F4e F4e | D4h~ | D4h |' },
      { name: '单簧管', inst: 'clarinet', vol: 0.8, dyn: 0.6, notes: '!v=1 re G4e G4e G4e | Eb4h | re F4e F4e F4e | D4h~ | D4h |' },
      { name: '大提琴', inst: 'cello', vol: 0.7, dyn: 0.6, notes: '!v=1 re G3e G3e G3e | Eb3h | re F3e F3e F3e | D3h~ | D3h |' }
    ]
  });

  /* ⑤ 和弦音与和声外音：C 大三和弦一直在底下响着。先只用和弦音，再加入外音（每个都级进解决），最后让两个外音悬着。 */
  MK.defineScore('nonchord-tones', {
    lesson: 6, title: '和弦音与和声外音', tag: 'orig', credit: '底下始终是 C 大三和弦',
    tempo: 76, meter: [4, 4], key: 'C', fx: { room: 'hall', wet: 0.12 }, tail: 1.0,
    jianpu: { voice: 0, key: 'C' },
    sections: [{ beat: 0, name: '只用和弦音' }, { beat: 8, name: '外音，随即解决' }, { beat: 16, name: '外音悬着' }],
    note: '第一段：C E G E C，全是和弦里的音，稳。第二段：E–F–E、E–D–C、C–B–C 三处各插进一个<b>外音</b>（F、D、B），每个都一级滑回和弦音。第三段：G–A 停住，让外音 A 悬着；停顿之后才补上 G。',
    voices: [
      { name: '旋律', inst: 'flute', vol: 1, notes: 'C4q E4q G4q E4q | C4w | E4q F4q E4q D4q | C4q B3q C4h | G4q A4q rh | G4w |' },
      { name: '和弦', inst: 'pad', vol: 0.55, notes: 'C3+G3+C4+E4w~ | C3+G3+C4+E4w~ | C3+G3+C4+E4w~ | C3+G3+C4+E4w~ | C3+G3+C4+E4w~ | C3+G3+C4+E4w |' }
    ]
  });
})((typeof window !== 'undefined' && window.MusicKit) || require('./musickit.js'));
