/* scores_00.js — 第 00 课（导览）的试听样本：预期被"吊住"、预期被"推翻"。 */
(function (MK) {
  'use strict';
  var h = MK.h, R = h.R;

  /* ① 一条没唱完的音阶 —— 原创演示。
     do re mi fa sol la ti 之后停住 5 拍，再回到高八度的 do。整段声音里没有任何"悬念"，悬念全在听者的预期里。 */
  MK.defineScore('unfinished-scale', {
    lesson: 0, title: '一条没唱完的音阶', tag: 'orig', credit: 'do re mi fa sol la ti … do',
    tempo: 96, meter: [4, 4], key: 'C', fx: { room: 'room' },
    jianpu: { voice: 0, key: 'C' },
    sections: [{ beat: 0, name: '上行' }, { beat: 7, name: '沉默' }, { beat: 12, name: '到家' }],
    note: '简谱里的 <b>0</b> 是休止，<b>–</b> 是延长。从第 7 个音 <b>7</b> 到最后的 <b>1̇</b> 之间有整整 5 拍没有任何声音——卷帘图上那段空白，就是预期在悬着。',
    voices: [
      { name: '钢琴', inst: 'piano', vol: 1, notes: 'C4q D4q E4q F4q | G4q A4q B4q rq | rw | C5w |' }
    ]
  });

  /* ② 海顿《第 94 交响曲"惊愕"》第二乐章（Andante，C 大调，2/4）的主题 —— 公有领域。
     旋律音高与节奏：对照 Wikipedia 上的 LilyPond 谱例（tools/music/witnesses.js 里逐音核对）。
     配器与力度是示意：第一遍弱（弓弦低音），第二遍更弱（拨弦低音），第 16 小节第二拍落下全奏的属和弦（G–B–D）。 */
  var HA = 'C4e C4e E4e E4e | G4e G4e E4q | F4e F4e D4e D4e | B3e B3e G3q | C4e C4e E4e E4e | G4e G4e E4q | C5e C5e F#4e F#4e |';
  var BASS = 'C3q G2q | C3q G2q | G2q G2q | G2q G2q | C3q G2q | C3q G2q | D3q D3q |';
  MK.defineScore('haydn-surprise', {
    lesson: 0, title: '海顿《惊愕》交响曲 · 第二乐章主题', tag: 'pd', credit: '海顿 · 1791',
    tempo: 64, meter: [2, 4], key: 'C', normalize: 'peak', fx: { room: 'hall', wet: 0.18 }, tail: 1.2,
    jianpu: { voice: 0, key: 'C' },
    sections: [{ beat: 0, name: '第一遍 · 弱' }, { beat: 16, name: '第二遍 · 更弱' }, { beat: 31, name: '！' }],
    note: '这是原曲主题的<b>合成演示</b>，配器与力度是示意，只保留了与"惊愕"有关的东西：旋律本身、两遍的力度对比、以及第二遍最后一小节——旋律的最后一个音只响半拍，然后是半拍的空白，全奏和弦才落下。',
    voices: [
      { name: '小提琴', inst: 'violin', vol: 3.2, dyn: 0.9, gate: 0.62,
        notes: '!v=0.6 ' + HA + ' G4q G3e re | !v=0.33 ' + HA + ' G4e re rq |' },
      { name: '低音（弓）', inst: 'cello', vol: 2.2, dyn: 0.9, gate: 0.7,
        notes: '!v=0.55 ' + BASS + ' G2q rq | ' + R(8, 'rh |') },
      { name: '低音（拨弦）', inst: 'bass', vol: 2.4, dyn: 0.9,
        notes: R(8, 'rh |') + ' !v=0.35 ' + BASS + ' G2q rq |' },
      { name: '铜管', inst: 'brass', vol: 0.8, dyn: 1,
        notes: R(15, 'rh |') + ' rq !v=1 G3+D4+G4+B4q |' },
      { name: '弦乐群', inst: 'strings', vol: 0.8, dyn: 1,
        notes: R(15, 'rh |') + ' rq !v=1 G2+G3+D4+G4+B4+D5q |' },
      { name: '定音鼓', inst: 'timpani', vol: 0.9, dyn: 1,
        notes: R(15, 'rh |') + ' rq !v=1 G2q |' }
    ]
  });
})((typeof window !== 'undefined' && window.MusicKit) || require('./musickit.js'));
