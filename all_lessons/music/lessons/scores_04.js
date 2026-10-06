/* scores_04.js — 第 04 课（和弦与调性）的试听样本：一个调里的七个三和弦（放在"家"的持续音上听）；三全音如何滑半音回家。 */
(function (MK) {
  'use strict';
  var h = MK.h;

  /* ① C 大调里七个音级各搭一个三和弦（叠三度），再回到 I。底下始终是一个 C 的持续音——"家"。
     质量：I 大、ii 小、iii 小、IV 大、V 大、vi 小、vii° 减。 */
  var TRIADS = [
    ['C4+E4+G4', 'I'], ['D4+F4+A4', 'ii'], ['E4+G4+B4', 'iii'], ['F4+A4+C5', 'IV'],
    ['G4+B4+D5', 'V'], ['A4+C5+E5', 'vi'], ['B4+D5+F5', 'vii°'], ['C5+E5+G5', 'I']
  ];
  MK.defineScore('diatonic-triads', {
    lesson: 4, title: '一个调里的七个三和弦', tag: 'orig', credit: 'C 大调 · 底下是 C 的持续音',
    tempo: 66, meter: [4, 4], key: 'C', noBars: true, fx: { room: 'hall', wet: 0.14 }, tail: 1.0,
    sections: TRIADS.map(function (t, i) { return { beat: i * 2, name: t[1] }; }),
    note: '七个和弦都是"隔一个音取一个"叠出来的：C–E–G、D–F–A、E–G–B、F–A–C、G–B–D、A–C–E、B–D–F，最后回到高八度的 C–E–G。质量依次是：大、小、小、大、大、小、减。底下那根 C 的持续音始终不变——每个和弦的"性格"，是相对于它来听的。',
    voices: [
      { name: '和弦', inst: 'strings', vol: 1, notes: TRIADS.map(function (t) { return t[0] + 'h'; }).join(' ') },
      { name: '"家"（C 持续音）', inst: 'cello', vol: 0.8, notes: h.sus('C2', 16) }
    ]
  });

  /* ② 属七和弦里的三全音（B–F）各滑半音：向内收拢成 C–E（大三度）；倒过来（F 在下）则向外张开成 E–C（小六度）；最后是完整的 V7 → I。
     音：G7 = G B D F；I = C E G。V7 → I 里三全音的两个音各挪半音，落点就是 I 的音。 */
  MK.defineScore('tritone-resolves', {
    lesson: 4, title: '三全音：各挪半音，回到家', tag: 'orig', credit: 'V7 → I · B–F → C–E',
    tempo: 60, meter: [4, 4], key: 'C', noBars: true, fx: { room: 'room', wet: 0.12 }, tail: 1.0,
    sections: [
      { beat: 0, name: '三全音 B–F' }, { beat: 4, name: '各滑半音 → C–E' },
      { beat: 8, name: '倒过来 F–B' }, { beat: 12, name: '→ E–C' },
      { beat: 16, name: '完整的 V7' }, { beat: 20, name: '→ I' }
    ],
    note: '前两组只有两个音：B3 与 F4（三全音）；它们各滑半音（B→C 上行，F→E 下行）就变成了 C4–E4，一个稳定的大三度。第三、四组是同样两个音上下颠倒（F3 与 B3），这次向外张开，落到 E3–C4（小六度）。最后是四声部的完整进行：G7（G G B F）→ C（C G C E）。',
    voices: [
      { name: '高声部', inst: 'organ', vol: 1, seed: 'a', notes: 'F4h. rq | E4h. rq | F3h. rq | E3h. rq | F4h. rq | E4w~ E4q rq' },
      { name: '另一半三全音', inst: 'organ', vol: 1, seed: 'b', notes: 'B3h. rq | C4h. rq | B3h. rq | C4h. rq | B3h. rq | C4w~ C4q rq' },
      { name: '内声部', inst: 'organ', vol: 0.9, seed: 'c', notes: 'rw rw rw rw | G3h. rq | G3w~ G3q rq' },
      { name: '低音', inst: 'organ', vol: 0.9, seed: 'd', notes: 'rw rw rw rw | G2h. rq | C3w~ C3q rq' }
    ]
  });
})((typeof window !== 'undefined' && window.MusicKit) || require('./musickit.js'));
