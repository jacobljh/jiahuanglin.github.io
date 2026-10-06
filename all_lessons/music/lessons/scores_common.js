/* scores_common.js — 《作曲的逻辑》乐谱库：公共工具 + 贯穿全课的"主线曲目"（欢乐颂）。
 * 每课的样本在 scores_NN.js 里；本文件先于它们加载。Node 里 require('./scores_common.js') 同样可用（见 tools/music/verify_scores.js）。 */
(function (MK) {
  'use strict';
  var h = MK.h = MK.h || {};

  /* 把字符串重复 n 次（用空格连接）：R(8, 'rh |') */
  h.R = function (n, s) { var o = []; for (var i = 0; i < n; i++) o.push(s); return o.join(' '); };

  /* 频率比 → 固定频率记号：h.at(3/2, 440) → '@660' */
  h.at = function (ratio, base) { return '@' + (base * ratio).toFixed(3).replace(/0+$/, '').replace(/\.$/, ''); };

  /* 休止 / 持续音：把 beats 拍拆成 w h q e s 的组合（持续音用连音线连起来）。
     h.rst(5) → 'rw rq'；h.sus('@220', 3) → '@220h~ @220q' */
  h.rst = function (beats) { var o = [], b = beats; [['rw', 4], ['rh', 2], ['rq', 1], ['re', 0.5], ['rs', 0.25]].forEach(function (u) { while (b >= u[1] - 1e-9) { o.push(u[0]); b -= u[1]; } }); return o.join(' '); };
  h.sus = function (pitch, beats) {
    var o = [], b = beats;
    [['w', 4], ['h', 2], ['q', 1], ['e', 0.5], ['s', 0.25]].forEach(function (u) { while (b >= u[1] - 1e-9) { o.push(pitch + u[0]); b -= u[1]; } });
    for (var i = 0; i < o.length - 1; i++) o[i] += '~';
    return o.join(' ');
  };

  /* 时值（拍）→ DSL 时值记号：1 → 'q'，1.5 → 'q.' */
  h.dur = function (d) {
    var T = [[4, 'w'], [3, 'h.'], [2, 'h'], [1.5, 'q.'], [1, 'q'], [0.75, 'e.'], [0.5, 'e'], [0.25, 's'], [0.125, 't']];
    for (var i = 0; i < T.length; i++) if (Math.abs(T[i][0] - d) < 1e-6) return T[i][1];
    throw new Error('no duration letter for ' + d);
  };
  /* 把一段 DSL 旋律"整体乘一个频率比"：每个音换成 @Hz 记号（用平均律音高 × ratio），休止与时值不变。
     用来做"同一句旋律叠上另一个音程"。 */
  h.scaleHz = function (notes, ratio) {
    return MK.parseVoice(notes, {}).events.map(function (e) {
      if (e.rest) return 'r' + h.dur(e.d);
      return h.at(ratio, MK.midiToHz(e.midi)) + h.dur(e.d);
    }).join(' ');
  };

  /* 第 06 课的"不稳定度"表（C 大调各级，0 = 家，1 = 最想动）：C D E F G A B。
     tensionCurve(notes) → [[拍, 不稳定度, 是否导音], …]，每个音一个点，按字母名取级（只适用于 C 大调的音）。 */
  h.STAB = [0.05, 0.55, 0.25, 0.60, 0.20, 0.55, 0.95];
  h.tensionCurve = function (notes) {
    var L = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
    return MK.mergeTies(MK.parseVoice(notes, {}).events).filter(function (e) { return !e.rest; }).map(function (e) {
      var deg = L[e.letter];
      return [e.beat, h.STAB[deg], deg === 6];
    });
  };

  /* "只剩节奏"：把一条旋律的每个起音换成一下鼓点，返回每小节一个 'x.x.' 串（perBeat 格/拍，barLen 拍/小节），可直接喂给 grid 声部。
     连音线延长的部分、休止都不出声——所以长音只表现为"后面隔了很久才有下一下"。 */
  h.rhythmGrid = function (notes, barLen, perBeat, ch) {
    var pv = MK.parseVoice(notes, {}), ev = MK.mergeTies(pv.events).filter(function (e) { return !e.rest; });
    var per = Math.round(barLen * perBeat), n = Math.ceil(pv.total / barLen - 1e-9), bars = [], i;
    for (i = 0; i < n; i++) { var a = []; for (var k = 0; k < per; k++) a.push('.'); bars.push(a); }
    ev.forEach(function (e) {
      var s = e.beat * perBeat, r = Math.round(s);
      if (Math.abs(s - r) > 1e-6) throw new Error('rhythmGrid: onset ' + e.beat + ' is not on a 1/' + perBeat + ' grid');
      bars[Math.floor(r / per)][r % per] = ch || 'x';
    });
    return bars.map(function (a) { return a.join(''); });
  };

  /* 起音在拍内的位置统计（"节奏"的数字化）：返回 {n, onBeat, offBeat, offFrac}。beats 为起音位置（拍），按整数拍判断是否"在拍上"。 */
  h.onsetStats = function (beats) {
    var on = beats.filter(function (b) { return Math.abs(b - Math.round(b)) < 1e-6; }).length;
    return { n: beats.length, onBeat: on, offBeat: beats.length - on, offFrac: (beats.length - on) / beats.length };
  };

  /* 纯音程的"小节行"：把若干小节的文本接起来，保证每个小节都以 | 收尾 */
  h.join = function () { return Array.prototype.slice.call(arguments).join(' '); };

  /* ───────────── 主线曲目：欢乐颂 ─────────────
     贝多芬《第九交响曲》终曲主题（1824）。四个乐句 a a′ b a′（每句 4 小节，4/4）。
     来源与核对：Mutopia（公有领域）Ode to Joy 赞美诗版 SATB 的 LilyPond 源码（G 大调），移到 C 大调后与下面逐音一致
     （tools/music/witnesses.js 里有机械比对）。 */
  h.ODE = {
    A:  'E4q E4q F4q G4q | G4q F4q E4q D4q | C4q C4q D4q E4q | E4q. D4e D4h |',      // a ：停在 D（第 2 级音；赞美诗配和声时落在属和弦 → 半终止，"问"）
    A2: 'E4q E4q F4q G4q | G4q F4q E4q D4q | C4q C4q D4q E4q | D4q. C4e C4h |',      // a′：同样的开头，停在 C（主音，配主和弦 → 完全终止，"答"）
    B:  'D4q D4q E4q C4q | D4q E4e F4e E4q C4q | D4q E4e F4e E4q D4q | C4q D4q G3h |'  // b ：桥句，离开主音又绕回（末音是低八度的 G，属音）
  };
  h.ODE.melody = [h.ODE.A, h.ODE.A2, h.ODE.B, h.ODE.A2].join(' ');                   // 16 小节
  h.ODE.sections = [{ beat: 0, name: 'a' }, { beat: 16, name: "a′" }, { beat: 32, name: 'b' }, { beat: 48, name: "a′" }];
})((typeof window !== 'undefined' && window.MusicKit) || require('./musickit.js'));
