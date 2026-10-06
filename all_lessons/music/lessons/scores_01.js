/* scores_01.js — 第 01 课（声音是什么）的试听样本：一个音 = 一摞泛音；泛音列是一道越爬越窄的楼梯；没有按键的号角。 */
(function (MK) {
  'use strict';
  var h = MK.h;

  /* ① 把一个音一层层摞出来：基频 220 Hz（A3），每 1.5 秒加一层整数倍泛音，加到第 8 层。
     每一层是一个独立的"声部"（纯正弦，音量 1/n，即锯齿波的配方），所以可以用"声部"开关单独关掉任何一层——
     包括基频（关掉后音高仍然是 220 Hz：缺失的基频）。 */
  var voices = [], sections = [];
  for (var k = 1; k <= 8; k++) {
    var enter = 2 * (k - 1), end = 20;
    voices.push({
      name: k === 1 ? '1f 基频' : k + 'f', inst: 'sine', vol: 1 / k,
      notes: (enter ? h.rst(enter) + ' ' : '') + h.sus('@' + (220 * k), end - enter)
    });
    sections.push({ beat: enter, name: k === 1 ? 'f' : '+' + k + 'f' });
  }
  MK.defineScore('harmonic-buildup', {
    lesson: 1, title: '把一个音一层层摞出来', tag: 'demo', credit: '基频 220 Hz · 每层 1/n',
    tempo: 80, meter: [4, 4], noBars: true, toggles: true, tail: 0.6, sections: sections, voices: voices,
    note: '每条横杠是一层泛音：频率 220、440、660、880、1100、1320、1540、1760 Hz，音量按 1/n 递减。纵轴是音高——第 2 层正好高一个八度，第 3 层再高一个纯五度……试着把"1f 基频"关掉。'
  });

  /* ② 泛音列的楼梯：220 Hz 的第 1 到第 12 层泛音，一层一个音往上爬。
     用固定频率（@Hz），不是钢琴的音——所以第 7、11 层会"不在键上"。 */
  var stairs = [];
  for (var n = 1; n <= 12; n++) stairs.push('@' + (220 * n) + 'q');
  MK.defineScore('harmonic-stairs', {
    lesson: 1, title: '泛音列的楼梯：第 1 到第 12 层', tag: 'demo', credit: '220 Hz 的整数倍',
    tempo: 100, meter: [4, 4], noBars: true, tail: 0.5, fx: { room: 'room', wet: 0.1 },
    sections: [{ beat: 0, name: '八度' }, { beat: 1, name: '五度' }, { beat: 2, name: '四度' }, { beat: 3, name: '大三度' }, { beat: 4, name: '小三度' }, { beat: 5, name: '…' }],
    note: '12 个音的频率依次是 220、440、660、880、1100、1320、1540、1760、1980、2200、2420、2640 Hz（基频的 1…12 倍）。相邻两级的频率比：2:1、3:2、4:3、5:4、6:5、7:6、8:7、9:8、10:9、11:10、12:11——台阶越来越小。第 7 个音（1540 Hz）比钢琴上最近的 G6（1568 Hz）低约 31 音分，第 11 个音（2420 Hz）则几乎正好卡在两个琴键中间。',
    voices: [{ name: '泛音', inst: 'organ', vol: 1, notes: '!v=0.9 !ramp=0.45@12 ' + stairs.join(' ') + ' rw' }]
  });

  /* ③ 没有按键的号角：只用第 3、4、5、6、8 层泛音（频率比 3:4:5:6:8），纯律音高。原创仿写，不是任何一首真实军号曲。 */
  MK.defineScore('bugle-call', {
    lesson: 1, title: '没有按键的号角', tag: 'orig', credit: '只用 G C E G C 五个音',
    tempo: 104, meter: [4, 4], key: 'C', tuning: { type: 'just', tonic: 'C4' }, fx: { room: 'hall', wet: 0.16 }, tail: 1.0,
    sections: [{ beat: 0, name: '3 4 5 6' }, { beat: 8, name: '6 5 4 3' }],
    jianpu: { voice: 0, key: 'C' },
    note: '全曲只有 G C E G（和高八度的 C）：它们是同一根管子的第 3、4、5、6、8 层泛音，频率比 3:4:5:6:8。这里用纯律音高（C 与 E 之间是 5:4 的纯大三度），和一根真正的无按键号一样。',
    voices: [{
      name: '号', inst: 'brass', vol: 1, gate: 0.9,
      notes: 'G3e G3e C4q E4q G4q | G4h E4q C4q | E4e E4e G4q C5q G4q | C5h. rq | ' +
             'G4e G4e E4q C4q E4q | G4h E4q C4q | G3e G3e C4q E4q G4q | C4w |'
    }]
  });
})((typeof window !== 'undefined' && window.MusicKit) || require('./musickit.js'));
