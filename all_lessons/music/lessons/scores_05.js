/* scores_05.js — 第 05 课（和声进行）的试听样本：一句话 I→IV→V7→I；《欢乐颂》四部和声里的"问"与"答"；巴赫 C 大调前奏曲里的 I–ii–V–I。 */
(function (MK) {
  'use strict';
  var h = MK.h;

  /* ① 一句完整的话：I → IV → V7 → I。四个声部，每个声部只走很小的一步（S 逐级上行，A/T 几乎不动），低音沿"根音"走。 */
  MK.defineScore('sentence-i-iv-v-i', {
    lesson: 5, title: '一句话：家 → 离家 → 最紧 → 回家', tag: 'orig', credit: 'I – IV – V7 – I',
    tempo: 72, meter: [4, 4], key: 'C', noBars: true, toggles: true, fx: { room: 'hall', wet: 0.14 }, tail: 1.2,
    sections: [{ beat: 0, name: 'I 家' }, { beat: 2, name: 'IV 离家' }, { beat: 4, name: 'V7 最紧' }, { beat: 6, name: 'I 回家' }],
    note: '四个和弦：C（G–E–C 向上叠）→ F → G7 → C。看卷帘图上四条线：高声部 G→A→B→C 一级一级往上走，到 V7 时停在 B（导音），最后一步半音落进 C；中间两条线几乎不动——"几乎没动，却悄悄换了和弦"。',
    voices: [
      { name: '高声部', inst: 'organ', vol: 1, seed: 's', notes: 'G4h A4h B4h C5w' },
      { name: '中声部', inst: 'organ', vol: 0.9, seed: 'a', notes: 'E4h F4h F4h E4w' },
      { name: '内声部', inst: 'organ', vol: 0.9, seed: 't', notes: 'C4h C4h D4h C4w' },
      { name: '低音', inst: 'organ', vol: 1, seed: 'b', notes: 'C3h F2h G2h C3w' }
    ]
  });

  /* ② 《欢乐颂》的赞美诗四部和声（前两句，C 大调）。
     来源：Mutopia（公有领域）Ode to Joy 赞美诗版 SATB 的 LilyPond 源码（G 大调，移到 C 大调），逐音与 witnesses.js 比对。
     第 3、7 小节低音比源码低一个八度（源码里低音与次中音同音，疑为八度笔误；只影响声部排列，不影响和弦）。
     第一句停在 D 上、配 G 和弦（V，半终止，"问"）；第二句 V → I（完全终止，"答"）。 */
  var S = 'E4q E4q F4q G4q | G4q F4q E4q D4q | C4q C4q D4q E4q | E4q. D4e D4h | E4q E4q F4q G4q | G4q F4q E4q D4q | C4q C4q D4q E4q | D4q. C4e C4h |';
  var A = 'C4q C4q D4q C4q | C4q. D4e C4q B3q | G3q G3q B3q C4q | C4q. B3e B3h | C4q C4q D4q C4q | C4q. D4e C4q B3q | G3q G3q B3q C4q | C4q B3q G3h |';
  var T = 'G3q G3q F3q E3q | A3q. G3e G3q G3q | E3q E3q G3q G3q | G3q. G3e G3h | G3q G3q F3q E3q | A3q. G3e G3q G3q | E3q E3q G3q G3q | G3q G3q E3h |';
  var B = 'C3q C3q C3q C3q | A2q. B2e C3q G2q | E2q E2q D2q C2q | G2q. G2e G2h | C3q C3q C3q C3q | A2q. B2e C3q G2q | E2q E2q D2q C2q | G2q G2q C2h |';
  MK.defineScore('ode-hymn', {
    lesson: 5, title: '欢乐颂（四部和声）：一问一答', tag: 'pd', credit: '贝多芬 · 1824 · 赞美诗配和声',
    tempo: 100, meter: [4, 4], key: 'C', toggles: true, fx: { room: 'church', wet: 0.16 }, tail: 1.6,
    jianpu: { voice: 0, key: 'C' },
    sections: [{ beat: 0, name: 'a' }, { beat: 14, name: 'V·半终止' }, { beat: 16, name: "a′" }, { beat: 29, name: 'V→I' }],
    note: '两句旋律的前三小节完全一样；差别只在句尾：第一句停在 D 上，下面的和声落在 G 和弦（V）——话没说完（半终止）；第二句的 D 先挂着，再落回 C，和声走 V → I——话说完了（完全终止）。试着关掉其他声部，只听高声部和低音。',
    voices: [
      { name: '高音', inst: 'organ', vol: 1, seed: 's', notes: S },
      { name: '中音', inst: 'organ', vol: 0.85, seed: 'a', notes: A },
      { name: '次中音', inst: 'organ', vol: 0.85, seed: 't', notes: T },
      { name: '低音', inst: 'organ', vol: 1, seed: 'b', notes: B }
    ]
  });

  /* ③ 巴赫《平均律键盘曲集》第一卷 C 大调前奏曲（BWV 846）前 8 小节。
     每小节一个和弦，右手每半小节重复同一个三音琶音，左手一个内声部 + 一个低音。
     I – ii(Dm7/C) – V(G7/B) – I | vi(Am/C) – V/V(D7/C) – V(G/B) – I(Cmaj7/B)。
     来源与核对：Mutopia（公有领域，排版者放弃版权）BWV 846 Prelude 1 的 LilyPond 源码（见 witnesses.js 逐音比对）。 */
  var FIG = [['G4', 'C5', 'E5'], ['A4', 'D5', 'F5'], ['G4', 'D5', 'F5'], ['G4', 'C5', 'E5'], ['A4', 'E5', 'A5'], ['F#4', 'A4', 'D5'], ['G4', 'D5', 'G5'], ['E4', 'G4', 'C5']];
  var INNER = ['E4', 'D4', 'D4', 'E4', 'E4', 'D4', 'D4', 'C4'];
  var BASS = ['C4', 'C4', 'B3', 'C4', 'C4', 'C4', 'B3', 'B3'];
  var rh = [], lhIn = [], lhBs = [];
  FIG.forEach(function (f, i) {
    var half = 're ' + f[0] + 's ' + f[1] + 's ' + f[2] + 's ' + f[0] + 's ' + f[1] + 's ' + f[2] + 's';
    rh.push(half + ' ' + half + ' |');
    var inn = 'rs ' + INNER[i] + 'e.~ ' + INNER[i] + 'q';
    lhIn.push(inn + ' ' + inn + ' |');
    lhBs.push(BASS[i] + 'h ' + BASS[i] + 'h |');
  });
  MK.defineScore('bach-prelude-c', {
    lesson: 5, title: '巴赫 C 大调前奏曲（前 8 小节）', tag: 'pd', credit: '巴赫 · BWV 846 · 1722',
    tempo: 72, meter: [4, 4], key: 'C', toggles: true, fx: { room: 'hall', wet: 0.14 }, tail: 1.4,
    sections: [{ beat: 0, name: 'I' }, { beat: 4, name: 'ii' }, { beat: 8, name: 'V' }, { beat: 12, name: 'I' }, { beat: 16, name: 'vi' }, { beat: 20, name: 'V/V' }, { beat: 24, name: 'V' }, { beat: 28, name: 'I' }],
    note: '头四小节正是 I–ii–V–I，却几乎"没动"：低音只是 C → C → B → C，左手内声部 E → D → D → E，右手每小节只换掉琶音里的一两个音（比如第 2、3 小节里的 F 一直留着，到第 4 小节才落成 E）。后四小节用同样的手法继续往前走。',
    voices: [
      { name: '右手琶音', inst: 'piano', vol: 1, notes: rh.join(' ') },
      { name: '左手内声部', inst: 'piano', vol: 0.9, notes: lhIn.join(' ') },
      { name: '低音', inst: 'piano', vol: 1, notes: lhBs.join(' ') }
    ]
  });
})((typeof window !== 'undefined' && window.MusicKit) || require('./musickit.js'));
