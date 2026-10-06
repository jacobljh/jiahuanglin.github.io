/* musickit.js — 《作曲的逻辑》共享音乐引擎（乐谱 → 声音）
 *
 * 一条线走到底：文本乐谱(DSL) → 解析成音符事件 → 确定性 DSP 合成 → 16-bit WAV → <audio> 播放。
 * 为什么不直接用 Web Audio：浏览器对 AudioContext 有一串限制（自动播放策略、iPhone 静音键、
 * 后台标签节流、主线程卡顿丢拍），而 <audio> 播放一段现成的 WAV 是所有设备上最少意外的路径。
 * 所以这里把"合成"做成纯函数（不碰任何浏览器 API），Node 和浏览器跑同一份代码——
 * 便于用独立的音高检测器验证"渲染出来的声音里真的有乐谱上的那些音"。
 *
 * 约定：不用 Math.random / Date（确定性）；噪声来自带种子的 mulberry32。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MusicKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAU = Math.PI * 2;
  var DEFAULT_SR = 32000;

  /* ───────────────────────── 1. 音高 ───────────────────────── */

  var LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var LETTER_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  var NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function hzToMidi(f) { return 69 + 12 * Math.log(f / 440) / Math.LN2; }
  function midiName(m) {
    var r = Math.round(m);
    return NAMES_SHARP[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
  }

  /* 解析一个音高记号：C4  F#4  Bb3  m60  @261.63，后面可跟 ^23（升 23 音分）或 ^-14。 */
  function parsePitch(tok) {
    var cents = 0, caret = tok.indexOf('^');
    if (caret >= 0) { cents = parseFloat(tok.slice(caret + 1)); tok = tok.slice(0, caret); }
    var m, p;
    if ((m = /^([A-G])(#{1,2}|b{1,2}|x)?(-?\d)$/.exec(tok))) {
      var acc = !m[2] ? 0 : m[2] === 'x' ? 2 : (m[2][0] === '#' ? m[2].length : -m[2].length);
      var oct = parseInt(m[3], 10);
      p = { midi: 12 * (oct + 1) + LETTER[m[1]] + acc + cents / 100, letter: m[1], acc: acc, oct: oct, fixedHz: false };
    } else if ((m = /^m(\d+)$/.exec(tok))) {
      var mm = parseInt(m[1], 10), nm = NAMES_SHARP[mm % 12];
      p = { midi: mm + cents / 100, letter: nm[0], acc: nm.length > 1 ? 1 : 0, oct: Math.floor(mm / 12) - 1, fixedHz: false };
    } else if ((m = /^@(\d+(?:\.\d+)?)$/.exec(tok))) {
      var hz = parseFloat(m[1]) * Math.pow(2, cents / 1200), r = Math.round(hzToMidi(hz)), n2 = NAMES_SHARP[((r % 12) + 12) % 12];
      p = { midi: hzToMidi(hz), hz: hz, letter: n2[0], acc: n2.length > 1 ? 1 : 0, oct: Math.floor(r / 12) - 1, fixedHz: true };
    } else {
      throw new Error('bad pitch token: ' + tok);
    }
    return p;
  }

  /* 律制：把"相对主音的半音数"映射成频率比。et=十二平均律（默认），just=5 限纯律，pyth=五度相生律。 */
  var RATIOS = {
    just: [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8],
    pyth: [1, 256 / 243, 9 / 8, 32 / 27, 81 / 64, 4 / 3, 729 / 512, 3 / 2, 128 / 81, 27 / 16, 16 / 9, 243 / 128]
  };
  function tunedHz(midi, tuning) {
    if (!tuning || tuning.type === 'et' || !RATIOS[tuning.type]) return midiToHz(midi);
    var tonic = parsePitch(tuning.tonic || 'C4').midi;
    var rel = Math.round(midi - tonic), oct = Math.floor(rel / 12), deg = ((rel % 12) + 12) % 12;
    var tonicHz = tuning.tonicHz || midiToHz(tonic);
    return tonicHz * Math.pow(2, oct) * RATIOS[tuning.type][deg] * Math.pow(2, ((midi - tonic) - rel) / 12);
  }

  /* ───────────────────────── 2. 乐谱 DSL ─────────────────────────
     音符 = 音高 + 时值：   E4q  F#4e.  Bb3h  C4+E4+G4h（和弦）  rq（休止）
     时值：w=4 h=2 q=1 e=0.5 s=0.25 t=0.125（单位：四分音符拍）；后缀 . 附点、3 三连音（×2/3）
     连音线：音符后加 ~ ；小节线：|（用来校验每小节拍数是否等于拍号）
     指令：!v=0.7 力度  !g=0.9 断奏比例  !tr=12 移调(半音)  !ramp=0.9@8 在接下来 8 拍内把力度渐变到 0.9
     前缀 > 表示重音。 */
  var DURS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 0.125 };
  function durBeats(letter, mod) {
    var d = DURS[letter];
    if (mod === '.') d *= 1.5; else if (mod === '..') d *= 1.75; else if (mod === '3') d *= 2 / 3;
    return d;
  }

  function parseVoice(src, o) {
    o = o || {};
    var tokens = String(src).split(/\s+/).filter(Boolean);
    var beat = 0, vel = o.vel == null ? 0.8 : o.vel, gate = o.gate == null ? 1 : o.gate, tr = o.shift || 0;
    var ramp = null, events = [], barLines = [], errors = [];
    for (var ti = 0; ti < tokens.length; ti++) {
      var tok = tokens[ti], m;
      if (/^\|+\]?$/.test(tok)) { barLines.push(beat); continue; }
      if (tok[0] === '!') {
        var kv = /^!(\w+)=(.+)$/.exec(tok);
        if (!kv) { errors.push('bad directive ' + tok); continue; }
        if (kv[1] === 'v') { vel = parseFloat(kv[2]); ramp = null; }
        else if (kv[1] === 'g') gate = parseFloat(kv[2]);
        else if (kv[1] === 'tr') tr = parseFloat(kv[2]);
        else if (kv[1] === 'ramp') {
          var rr = /^([\d.]+)@([\d.]+)$/.exec(kv[2]);
          if (rr) ramp = { from: vel, to: parseFloat(rr[1]), b0: beat, b1: beat + parseFloat(rr[2]) };
          else errors.push('bad ramp ' + tok);
        } else errors.push('unknown directive ' + tok);
        continue;
      }
      var accent = false;
      if (tok[0] === '>') { accent = true; tok = tok.slice(1); }
      if ((m = /^r([whqest])(\.{1,2}|3)?$/.exec(tok))) {
        var rd = durBeats(m[1], m[2]);
        events.push({ rest: true, beat: beat, d: rd });
        beat += rd;
        continue;
      }
      m = /^(.+?)([whqest])(\.{1,2}|3)?(~)?$/.exec(tok);
      if (!m) { errors.push('bad token ' + tok); continue; }
      var d = durBeats(m[2], m[3]), tie = !!m[4], ps;
      try { ps = m[1].split('+').map(parsePitch); } catch (e) { errors.push(e.message + ' in ' + tok); continue; }
      var v = vel;
      if (ramp) {
        var u = ramp.b1 > ramp.b0 ? (beat - ramp.b0) / (ramp.b1 - ramp.b0) : 1;
        v = ramp.from + (ramp.to - ramp.from) * Math.max(0, Math.min(1, u));
      }
      if (accent) v = Math.min(1, v + 0.2);
      for (var pi = 0; pi < ps.length; pi++) {
        var pp = ps[pi];
        var sp = pp;
        if (tr) { var rm = Math.round(pp.midi + tr), nm2 = NAMES_SHARP[((rm % 12) + 12) % 12]; sp = { letter: nm2[0], acc: nm2.length > 1 ? 1 : 0, oct: Math.floor(rm / 12) - 1 }; }
        events.push({
          beat: beat, d: d, midi: pp.midi + tr, hz: pp.fixedHz ? pp.hz * Math.pow(2, tr / 12) : null,
          vel: v, gate: gate, tie: tie, accent: accent, letter: sp.letter, acc: sp.acc, oct: sp.oct,
          chord: ps.length > 1 ? ti : -1, token: tok
        });
      }
      beat += d;
    }
    return { events: events, barLines: barLines, total: beat, errors: errors };
  }

  /* 连音线合并：同一声部里，下一个音若与本音同音高且正好接在本音结束处，则并入。 */
  function mergeTies(events) {
    var out = [], pending = {};
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.rest) { out.push(e); continue; }
      var key = e.midi.toFixed(3), prev = pending[key];
      if (prev && Math.abs(prev.beat + prev.d - e.beat) < 1e-9) {
        prev.d += e.d; prev.tie = e.tie;
        if (!e.tie) delete pending[key];
        continue;
      }
      var ne = {}; for (var k in e) ne[k] = e[k];
      out.push(ne);
      if (e.tie) pending[key] = ne; else delete pending[key];
    }
    return out;
  }

  /* 校验：每个声部每一小节是否恰好等于拍号；各旋律声部是否等长；指令/音高是否可解析。 */
  function validatePiece(piece) {
    var errs = [], warns = [];
    var meter = piece.meter || [4, 4], barLen = meter[0] * 4 / meter[1], lens = [];
    (piece.voices || []).forEach(function (v, vi) {
      var nm = 'voice ' + vi + ' (' + (v.name || v.inst) + ')';
      if (v.grid) { lens.push({ i: vi, len: (v.bars || 1) * barLen, perc: true }); return; }
      var pv = parseVoice(v.notes, v);
      pv.errors.forEach(function (e) { errs.push(nm + ': ' + e); });
      var bounds = [0].concat(pv.barLines);
      if (pv.barLines.length === 0 || Math.abs(pv.barLines[pv.barLines.length - 1] - pv.total) > 1e-9) bounds.push(pv.total);
      if (piece.barBeats && !v.noBarCheck) {                 // 小节线位置由曲子显式给出（拍号中途变化 / 自由长度的演示）：声部里的 | 必须正好落在这些拍点上
        var want = piece.barBeats.filter(function (b) { return b > 1e-9 && b < pv.total - 1e-9; }).concat([pv.total]);
        var got = bounds.slice(1);
        if (want.length !== got.length || want.some(function (b, k) { return Math.abs(b - got[k]) > 1e-6; })) errs.push(nm + ': bar lines at [' + got.join(',') + '] ≠ barBeats [' + want.join(',') + ']');
      } else if (!v.noBarCheck && !piece.noBars) {
        for (var b = 1; b < bounds.length; b++) {
          var len = bounds[b] - bounds[b - 1];
          if (Math.abs(len - barLen) > 1e-6 && !(b === bounds.length - 1 && len < barLen && piece.shortLast)) {
            errs.push(nm + ': bar ' + b + ' has ' + len + ' beats, expected ' + barLen);
          }
        }
      }
      lens.push({ i: vi, len: pv.total });
    });
    var mel = lens.filter(function (l) { return !l.perc; });
    mel.forEach(function (l) {
      if (Math.abs(l.len - mel[0].len) > 1e-6 && !piece.voices[l.i].allowShort) errs.push('voice ' + l.i + ' length ' + l.len + ' ≠ voice ' + mel[0].i + ' length ' + mel[0].len);
    });
    if (!piece.tempo) errs.push('no tempo');
    return { ok: errs.length === 0, errors: errs, warnings: warns };
  }

  /* ───────────────────────── 3. 时间轴 ─────────────────────────
     tempo 可以是一个数（BPM），也可以是 [[拍, BPM], ...]，相邻两点之间 BPM 线性变化（渐慢 rit.）。 */
  function makeTimeMap(tempo, scale) {
    scale = scale || 1;
    var pts = (typeof tempo === 'number') ? [[0, tempo]] : tempo.map(function (p) { return [p[0], p[1]]; });
    if (pts[0][0] > 0) pts.unshift([0, pts[0][1]]);
    pts.push([pts[pts.length - 1][0] + 1e6, pts[pts.length - 1][1]]);
    function seg(db, t0, t1) {
      if (db <= 0) return 0;
      if (Math.abs(t1 - t0) < 1e-9) return 60 * db / t0;
      return 60 * db / (t1 - t0) * Math.log(t1 / t0);
    }
    var cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + seg(pts[i][0] - pts[i - 1][0], pts[i - 1][1], pts[i][1]));
    return function (beat) {
      var i2 = 1;
      while (i2 < pts.length - 1 && beat > pts[i2][0]) i2++;
      var b0 = pts[i2 - 1][0], t0 = pts[i2 - 1][1], b1 = pts[i2][0], t1 = pts[i2][1];
      var tb = t0 + (t1 - t0) * (beat - b0) / (b1 - b0);
      return (cum[i2 - 1] + seg(beat - b0, t0, tb)) / scale;
    };
  }

  /* ───────────────────────── 4. 噪声与小工具 ───────────────────────── */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  /* 起音（线性）+ 释放（指数，−60 dB）。返回的长度 = 音长 + 释放尾巴。 */
  function ampEnv(sr, dur, attack, release) {
    var nOn = Math.max(1, Math.round(dur * sr)), nRel = Math.max(1, Math.round(release * sr));
    var e = new Float32Array(nOn + nRel), nA = Math.max(1, Math.round(attack * sr));
    var rf = Math.pow(0.001, 1 / nRel), i;
    for (i = 0; i < nOn; i++) e[i] = i < nA ? i / nA : 1;
    var g = e[nOn - 1];
    for (i = nOn; i < e.length; i++) { g *= rf; e[i] = g; }
    return e;
  }

  /* ───────────────────────── 5. 乐器（纯函数：音高 → 波形） ─────────────────────────
     约定：inst(sr, hz, durSec, vel, rng, opt) 返回 Float32Array，长度 = 音长 + 释放尾巴。 */

  var INST = {};

  /* 通用加法合成：partials = [{r, a, tau}]，r=频率比（可非整数→钟/马林巴），tau=衰减时间常数（秒，Infinity=持续）。
     无颤音时用二阶递推产生正弦（比逐点 Math.sin 快 3–4 倍，对几万点内的误差可忽略）。 */
  function additive(sr, f0, dur, vel, spec, rng) {
    var env = ampEnv(sr, dur, spec.attack, spec.release), n = env.length, out = new Float32Array(n), i;
    var vib = null;
    if (spec.vibrato) {
      vib = new Float32Array(n);
      var acc = 0, vr = spec.vibrato.rate, vd = spec.vibrato.depth, vdl = spec.vibrato.delay || 0, vph = rng() * TAU;
      for (i = 0; i < n; i++) {
        var t = i / sr, w = t < vdl ? 0 : Math.min(1, (t - vdl) / 0.35);
        acc += vd * w * Math.sin(TAU * vr * t + vph);
        vib[i] = acc;
      }
    }
    var bright = spec.bright || 0, nyq = 0.46 * sr;
    for (var pi = 0; pi < spec.partials.length; pi++) {
      var p = spec.partials[pi], fp = f0 * p.r;
      if (fp > nyq) continue;
      var a = p.a * (bright ? Math.pow(0.4 + 0.6 * vel, bright * pi) : 1);
      if (a < 1e-4) continue;
      var w0 = TAU * fp / sr, dec = isFinite(p.tau) ? Math.exp(-1 / (p.tau * sr)) : 1, d = 1;
      var ph0 = p.ph !== undefined ? p.ph : rng() * TAU;
      var bm = spec.envPow ? Math.min(4, 1 + Math.floor(pi * spec.envPow)) : 1;
      if (vib) {
        for (i = 0; i < n; i++) {
          var e1 = env[i], eb = bm === 1 ? e1 : bm === 2 ? e1 * e1 : bm === 3 ? e1 * e1 * e1 : e1 * e1 * e1 * e1;
          out[i] += a * eb * d * Math.sin(w0 * (i + vib[i]) + ph0);
          d *= dec;
        }
      } else {
        var c2 = 2 * Math.cos(w0), s0 = Math.sin(ph0 - w0), s1 = Math.sin(ph0), s2;
        for (i = 0; i < n; i++) {
          var e2 = env[i], eb2 = bm === 1 ? e2 : bm === 2 ? e2 * e2 : bm === 3 ? e2 * e2 * e2 : e2 * e2 * e2 * e2;
          out[i] += a * eb2 * d * s1;
          s2 = c2 * s1 - s0; s0 = s1; s1 = s2;
          d *= dec;
        }
      }
    }
    if (spec.noise) {                       // 气声 / 弓噪：一阶低通噪声 × 起音附近包络
      var nz = spec.noise, lp = 0, k = 1 - Math.exp(-TAU * (nz.cut || 3000) / sr);
      var na = nz.amp * (0.5 + 0.5 * vel), tdec = nz.tau || 0.12, sust = nz.sustain || 0;
      for (i = 0; i < n; i++) {
        lp += k * ((rng() * 2 - 1) - lp);
        out[i] += lp * na * env[i] * (sust + (1 - sust) * Math.exp(-i / (tdec * sr)));
      }
    }
    var gain = spec.gain * (0.35 + 0.65 * vel);
    for (i = 0; i < n; i++) out[i] *= gain;
    return out;
  }

  var INF = Infinity;
  function ps(list) { return list.map(function (x) { return { r: x[0], a: x[1], tau: x[2] === undefined ? INF : x[2] }; }); }

  INST.sine = function (sr, f, dur, vel, rng) {
    return additive(sr, f, dur, vel, { partials: [{ r: 1, a: 1, tau: INF, ph: 0 }], attack: 0.01, release: 0.05, gain: 0.42 }, rng);
  };
  INST.organ = function (sr, f, dur, vel, rng) {
    return additive(sr, f, dur, 0.9 + 0.1 * vel, {
      partials: ps([[1, 1], [2, 0.55], [3, 0.38], [4, 0.28], [5, 0.1], [6, 0.12], [8, 0.06]]),
      attack: 0.014, release: 0.075, gain: 0.2, noise: { amp: 0.012, cut: 5000, tau: 0.03 }
    }, rng);
  };
  INST.flute = function (sr, f, dur, vel, rng) {
    return additive(sr, f, dur, vel, {
      partials: ps([[1, 1], [2, 0.3 + 0.25 * vel], [3, 0.09], [4, 0.035]]),
      attack: 0.075, release: 0.14, gain: 0.34,
      vibrato: { rate: 5.2, depth: 0.006, delay: 0.28 },
      noise: { amp: 0.05, cut: 4200, tau: 0.09, sustain: 0.35 }
    }, rng);
  };
  INST.clarinet = function (sr, f, dur, vel, rng) {
    return additive(sr, f, dur, vel, {
      partials: ps([[1, 1], [2, 0.04], [3, 0.55], [4, 0.03], [5, 0.32], [6, 0.02], [7, 0.17], [9, 0.09], [11, 0.04]]),
      attack: 0.04, release: 0.1, gain: 0.3, noise: { amp: 0.025, cut: 3000, tau: 0.08, sustain: 0.3 }
    }, rng);
  };
  INST.brass = function (sr, f, dur, vel, rng) {
    var list = []; for (var n = 1; n <= 16; n++) list.push([n, Math.pow(n, -0.62)]);
    return additive(sr, f, dur, vel, {
      partials: ps(list), attack: 0.055, release: 0.11, gain: 0.2, envPow: 0.22, bright: 0.14,
      vibrato: { rate: 5.0, depth: 0.003, delay: 0.5 }, noise: { amp: 0.02, cut: 2500, tau: 0.07 }
    }, rng);
  };
  function chorus(sr, f, dur, vel, rng, detunes, mk) {
    var acc = null;
    for (var v = 0; v < detunes.length; v++) {
      var w = additive(sr, f * Math.pow(2, detunes[v] / 1200), dur, vel, mk(v), rng);
      if (!acc) acc = w; else for (var i = 0; i < acc.length; i++) acc[i] += w[i];
    }
    return acc;
  }
  INST.strings = function (sr, f, dur, vel, rng) {
    var list = []; for (var n = 1; n <= 14; n++) list.push([n, Math.pow(n, -1.05)]);
    return chorus(sr, f, dur, vel, rng, [-6, 0, 6], function (v) {
      return { partials: ps(list), attack: 0.13, release: 0.28, gain: 0.17, bright: 0.1, vibrato: { rate: 5.1 + 0.15 * v, depth: 0.0035, delay: 0.25 + 0.05 * v }, noise: v === 1 ? { amp: 0.012, cut: 2500, tau: 0.2, sustain: 0.2 } : null };
    });
  };
  INST.pad = function (sr, f, dur, vel, rng) {
    var list = []; for (var n = 1; n <= 9; n++) list.push([n, Math.pow(n, -1.5)]);
    return chorus(sr, f, dur, vel, rng, [-9, -3, 3, 9], function () { return { partials: ps(list), attack: 0.35, release: 0.55, gain: 0.13 }; });
  };
  INST.saw = function (sr, f, dur, vel, rng) {
    var list = []; for (var n = 1; n <= 40; n++) list.push([n, 1 / n]);
    return chorus(sr, f, dur, vel, rng, [-7, 0, 7], function () { return { partials: ps(list), attack: 0.006, release: 0.07, gain: 0.12 }; });
  };
  /* 单声部锯齿波（不带 saw 的"超级锯齿"失谐合唱）：做"拍音/泛音重合"类的对照实验时用，免得合唱的拍音盖过要听的东西。 */
  INST.sawtooth = function (sr, f, dur, vel, rng) {
    var list = []; for (var n = 1; n <= 40; n++) list.push([n, 1 / n]);
    return additive(sr, f, dur, vel, { partials: ps(list), attack: 0.012, release: 0.05, gain: 0.2 }, rng);
  };
  INST.square = function (sr, f, dur, vel, rng) {
    var list = []; for (var n = 1; n <= 31; n += 2) list.push([n, 1 / n]);
    return additive(sr, f, dur, vel, { partials: ps(list), attack: 0.004, release: 0.05, gain: 0.3 }, rng);
  };
  INST.sub = function (sr, f, dur, vel, rng) {
    return additive(sr, f, dur, vel, { partials: ps([[1, 1], [2, 0.28, 0.5], [3, 0.08, 0.3]]), attack: 0.006, release: 0.06, gain: 0.55 }, rng);
  };
  INST.synbass = function (sr, f, dur, vel, rng) {
    var list = []; for (var n = 1; n <= 10; n++) list.push([n, Math.pow(n, -1.4), n > 2 ? 0.35 : INF]);
    return additive(sr, f, dur, vel, { partials: ps(list), attack: 0.004, release: 0.05, gain: 0.5 }, rng);
  };
  INST.marimba = function (sr, f, dur, vel, rng) {
    var k = Math.pow(262 / f, 0.35);
    return additive(sr, f, Math.min(dur, 0.12), vel, {
      partials: ps([[1, 1, 0.55 * k], [3.93, 0.38, 0.14 * k], [9.2, 0.1, 0.05 * k]]),
      attack: 0.002, release: 0.3 * k, gain: 0.5, noise: { amp: 0.05, cut: 1800, tau: 0.006 }
    }, rng);
  };
  INST.bell = function (sr, f, dur, vel, rng) {
    var k = Math.pow(523 / f, 0.2);
    return additive(sr, f, Math.min(dur, 0.1), vel, {
      partials: ps([[1, 1, 2.2 * k], [2.0, 0.5, 1.6 * k], [2.76, 0.45, 1.1 * k], [5.4, 0.28, 0.7 * k], [8.93, 0.14, 0.35 * k]]),
      attack: 0.001, release: 1.6, gain: 0.34
    }, rng);
  };
  INST.celesta = function (sr, f, dur, vel, rng) {
    return additive(sr, f, Math.min(dur, 0.1), vel, {
      partials: ps([[1, 1, 1.1], [2, 0.22, 0.5], [4.1, 0.1, 0.25], [6.6, 0.04, 0.12]]),
      attack: 0.0015, release: 0.9, gain: 0.42
    }, rng);
  };

  /* 独奏弦乐（与上面的"弦乐群"pad 不同：起音快、单声部、带颤音与弓噪），小提琴 / 大提琴。 */
  INST.violin = function (sr, f, dur, vel, rng) {
    var list = []; for (var n = 1; n <= 18; n++) list.push([n, Math.pow(n, -1.0)]);
    return additive(sr, f, dur, vel, {
      partials: ps(list), attack: 0.045, release: 0.12, gain: 0.22, bright: 0.12,
      vibrato: { rate: 5.6, depth: 0.0042, delay: 0.22 }, noise: { amp: 0.014, cut: 3500, tau: 0.1, sustain: 0.25 }
    }, rng);
  };
  INST.cello = function (sr, f, dur, vel, rng) {
    var list = []; for (var n = 1; n <= 22; n++) list.push([n, Math.pow(n, -1.25)]);
    return additive(sr, f, dur, vel, {
      partials: ps(list), attack: 0.07, release: 0.16, gain: 0.3, bright: 0.1,
      vibrato: { rate: 5.0, depth: 0.003, delay: 0.3 }, noise: { amp: 0.012, cut: 1800, tau: 0.14, sustain: 0.25 }
    }, rng);
  };

  /* 钢琴：非谐性拉伸的泛音 + 双衰减（先快后慢）+ 琴槌位置梳状谱 + 双弦拍音 + 琴槌敲击声。 */
  INST.piano = function (sr, f, dur, vel, rng, opt) {
    opt = opt || {};
    var env = ampEnv(sr, dur, 0.0015, opt.pedal ? 0.9 : 0.2), n = env.length, out = new Float32Array(n), i;
    var N = clamp(Math.floor(4800 / f), 3, 10);
    var B = clamp(4e-5 * Math.pow(f / 100, 1.5), 3e-5, 4e-3);
    var tauS = clamp(5 * Math.pow(261.6 / f, 0.6), 0.9, 12), tauF = clamp(0.5 * Math.pow(261.6 / f, 0.3), 0.15, 1.2);
    var v = 0.35 + 0.65 * vel, nyq = 0.46 * sr;
    for (var k = 1; k <= N; k++) {
      var fk = k * f * Math.sqrt(1 + B * k * k);
      if (fk > nyq) break;
      var comb = Math.abs(Math.sin(Math.PI * k * 0.118)) + 0.08;
      var a = Math.pow(k, -1.05) * comb * Math.pow(v, 0.25 * (k - 1));
      if (a < 5e-4) continue;
      var shrink = 1 / (1 + 0.38 * (k - 1));
      var df = Math.exp(-1 / (tauF * shrink * sr)), ds = Math.exp(-1 / (tauS * shrink * sr)), xf = 1, xs = 1;
      var w0 = TAU * fk / sr, ph = rng() * TAU, c2 = 2 * Math.cos(w0), s0 = Math.sin(ph - w0), s1 = Math.sin(ph), s2;
      var beat = k <= 4, bw = TAU * (fk * 0.0006) / sr, bph = rng() * TAU, mod = 0.32;
      for (i = 0; i < n; i++) {
        var g = a * env[i] * (0.62 * xf + 0.38 * xs);
        if (beat) g *= 1 + mod * Math.cos(bw * i + bph);
        out[i] += g * s1;
        s2 = c2 * s1 - s0; s0 = s1; s1 = s2;
        xf *= df; xs *= ds;
      }
    }
    var tn = Math.min(n, Math.round(0.02 * sr)), lp = 0, kk = 1 - Math.exp(-TAU * clamp(f * 3, 500, 2600) / sr);
    for (var q = 0; q < tn; q++) { lp += kk * ((rng() * 2 - 1) - lp); out[q] += lp * 0.22 * Math.pow(v, 1.5) * Math.exp(-q / (0.0045 * sr)); }
    var gain = 0.34 * (0.3 + 0.7 * vel);
    for (i = 0; i < n; i++) out[i] *= gain;
    return out;
  };

  /* Karplus–Strong 拨弦：循环延迟 = 整数延迟线 Lb + 低通滤波器群延迟 damp + 全通分数延迟 frac = sr/f，音准 ±2 音分内。 */
  function karplus(sr, f, dur, vel, rng, o) {
    var T60 = o.T60, damp = o.damp == null ? 0.5 : o.damp, tailT = o.release == null ? 0.08 : o.release;
    var total = dur + Math.min(T60 * 0.5, 1.5) + tailT, n = Math.round(total * sr), out = new Float32Array(n);
    var Ttot = sr / f, Lb = Math.max(3, Math.floor(Ttot - damp - 0.5)), frac = Ttot - damp - Lb, ap = (1 - frac) / (1 + frac);
    var buf = new Float32Array(Lb), i, lp0 = 0, kk = 1 - Math.exp(-TAU * (o.exciteCut || 6000) / sr);
    for (i = 0; i < Lb; i++) { lp0 += kk * ((rng() * 2 - 1) - lp0); buf[i] = lp0; }
    var pos = Math.max(1, Math.round((o.pos || 0.2) * Lb)), tmp = new Float32Array(Lb), mean = 0, pk = 0;
    for (i = 0; i < Lb; i++) tmp[i] = buf[i] - (i >= pos ? buf[i - pos] : 0) * 0.9;
    for (i = 0; i < Lb; i++) mean += tmp[i];
    mean /= Lb;
    for (i = 0; i < Lb; i++) { buf[i] = tmp[i] - mean; if (Math.abs(buf[i]) > pk) pk = Math.abs(buf[i]); }
    for (i = 0; i < Lb; i++) buf[i] /= (pk || 1);
    var g = Math.pow(0.001, 1 / (T60 * f)), apx = 0, apy = 0, prevX = 0, idx = 0;
    var relStart = Math.round(dur * sr), rf = Math.pow(0.001, 1 / Math.max(1, tailT * sr)), gate = 1;
    var amp = (0.35 + 0.65 * vel) * (o.gain || 0.5);
    for (var s = 0; s < n; s++) {
      var x = buf[idx];
      var avg = (1 - damp) * x + damp * prevX; prevX = x;
      var fb = avg * g, y = ap * (fb - apy) + apx; apx = fb; apy = y;
      buf[idx] = y; idx = idx + 1 === Lb ? 0 : idx + 1;
      if (s >= relStart) gate *= rf;
      out[s] = x * amp * gate;
    }
    return out;
  }
  function sumInto(a, b) {
    var m = Math.max(a.length, b.length), o = new Float32Array(m), i;
    for (i = 0; i < a.length; i++) o[i] += a[i];
    for (i = 0; i < b.length; i++) o[i] += b[i];
    return o;
  }
  INST.harpsichord = function (sr, f, dur, vel, rng) {
    var a = karplus(sr, f, dur, 0.85, rng, { T60: 2.2 * Math.pow(262 / f, 0.25), damp: 0.5, pos: 0.18, gain: 0.5, release: 0.07 });
    if (f * 2 < sr * 0.4) a = sumInto(a, karplus(sr, f * 2, dur, 0.85, rng, { T60: 1.4, damp: 0.5, pos: 0.18, gain: 0.26, release: 0.05 }));
    var cl = Math.min(a.length, Math.round(0.004 * sr));
    for (var k = 0; k < cl; k++) a[k] += (rng() * 2 - 1) * 0.05 * Math.exp(-k / (0.0012 * sr));
    return a;
  };
  INST.guitar = function (sr, f, dur, vel, rng) { return karplus(sr, f, dur, vel, rng, { T60: 1.8 * Math.pow(196 / f, 0.2), damp: 0.46, pos: 0.15, gain: 0.55, exciteCut: 4500, release: 0.1 }); };
  INST.harp = function (sr, f, dur, vel, rng) { return karplus(sr, f, dur, vel, rng, { T60: 3.2 * Math.pow(262 / f, 0.2), damp: 0.5, pos: 0.25, gain: 0.55, exciteCut: 5000, release: 0.18 }); };
  INST.zheng = function (sr, f, dur, vel, rng) { return karplus(sr, f, dur, vel, rng, { T60: 2.6 * Math.pow(262 / f, 0.2), damp: 0.44, pos: 0.12, gain: 0.55, exciteCut: 7500, release: 0.25 }); };
  INST.bass = function (sr, f, dur, vel, rng) { return karplus(sr, f, dur, vel, rng, { T60: 1.3, damp: 0.38, pos: 0.3, gain: 0.8, exciteCut: 900, release: 0.07 }); };
  INST.pluck = INST.guitar;

  INST.timpani = function (sr, f, dur, vel, rng) {
    var n = Math.round(1.6 * sr), out = new Float32Array(n), ph = 0, i;
    for (i = 0; i < n; i++) {
      var t = i / sr, fr = f * (1 + 0.28 * Math.exp(-t / 0.045));
      ph += TAU * fr / sr;
      out[i] = (Math.sin(ph) * 0.8 + Math.sin(ph * 1.5) * 0.18 * Math.exp(-t / 0.2)) * Math.exp(-t / 0.55) * (0.5 + 0.5 * vel) * 0.7;
    }
    for (i = 0; i < Math.min(n, 400); i++) out[i] += (rng() * 2 - 1) * 0.3 * Math.exp(-i / 80);
    return out;
  };

  /* 上升的噪声（build-up 里的"嘶——"）：音高无关，持续时间内噪声越来越亮、越来越响。 */
  INST.riser = function (sr, f, dur, vel, rng) {
    var n = Math.round((dur + 0.04) * sr), out = new Float32Array(n), lp = 0, lp2 = 0;
    for (var i = 0; i < n; i++) {
      var u = Math.min(1, i / (dur * sr)), fc = 250 * Math.pow(9000 / 250, u), k = 1 - Math.exp(-TAU * fc / sr);
      lp += k * ((rng() * 2 - 1) - lp); lp2 += k * (lp - lp2);
      out[i] = lp2 * (0.06 + 0.94 * u * u) * (i > n - 0.04 * sr ? (n - i) / (0.04 * sr) : 1) * 0.9 * (0.4 + 0.6 * vel);
    }
    return out;
  };

  /* 随时间变化的低通（滤波器扫频）：pts = [[秒, 截止频率Hz], ...]，在对数频率上线性插值。 */
  function sweepLowpass(x, sr, pts) {
    var n = x.length, out = new Float32Array(n), y1 = 0, y2 = 0, seg = 0, k = 0;
    for (var i = 0; i < n; i++) {
      if ((i & 31) === 0) {
        var t = i / sr;
        while (seg < pts.length - 2 && t > pts[seg + 1][0]) seg++;
        var a = pts[seg], b = pts[Math.min(seg + 1, pts.length - 1)];
        var u = b[0] > a[0] ? Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))) : 1;
        var fc = Math.exp(Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * u);
        k = 1 - Math.exp(-TAU * Math.min(fc, sr * 0.45) / sr);
      }
      y1 += k * (x[i] - y1); y2 += k * (y1 - y2); out[i] = y2;
    }
    return out;
  }

  /* 打击乐 */
  function scaleBuf(a, g) { for (var i = 0; i < a.length; i++) a[i] *= g; return a; }
  var DRUM = {
    kick: function (sr, vel, rng) {
      var n = Math.round(0.42 * sr), o = new Float32Array(n), ph = 0;
      for (var i = 0; i < n; i++) {
        var t = i / sr; ph += TAU * (46 + 120 * Math.exp(-t / 0.032)) / sr;
        o[i] = Math.sin(ph) * Math.exp(-t / 0.13) * 0.95 + (i < 90 ? (rng() * 2 - 1) * 0.25 * (1 - i / 90) : 0);
      }
      return scaleBuf(o, 0.9 * (0.4 + 0.6 * vel));
    },
    snare: function (sr, vel, rng) {
      var n = Math.round(0.28 * sr), o = new Float32Array(n), lp = 0, lp2 = 0, k1 = 1 - Math.exp(-TAU * 7000 / sr), k2 = 1 - Math.exp(-TAU * 1500 / sr);
      for (var i = 0; i < n; i++) {
        var t = i / sr, x = rng() * 2 - 1; lp += k1 * (x - lp); lp2 += k2 * (lp - lp2);
        o[i] = (lp - lp2) * 3.2 * Math.exp(-t / 0.07) + Math.sin(TAU * 188 * t) * Math.exp(-t / 0.045) * 0.55;
      }
      return scaleBuf(o, 0.55 * (0.4 + 0.6 * vel));
    },
    hat: function (sr, vel, rng) {
      var n = Math.round(0.09 * sr), o = new Float32Array(n), lp = 0, k = 1 - Math.exp(-TAU * 7500 / sr);
      for (var i = 0; i < n; i++) { var x = rng() * 2 - 1; lp += k * (x - lp); o[i] = (x - lp) * Math.exp(-i / (0.018 * sr)); }
      return scaleBuf(o, 0.3 * (0.4 + 0.6 * vel));
    },
    ohat: function (sr, vel, rng) {
      var n = Math.round(0.45 * sr), o = new Float32Array(n), lp = 0, k = 1 - Math.exp(-TAU * 6500 / sr);
      for (var i = 0; i < n; i++) { var x = rng() * 2 - 1; lp += k * (x - lp); o[i] = (x - lp) * Math.exp(-i / (0.1 * sr)); }
      return scaleBuf(o, 0.28 * (0.4 + 0.6 * vel));
    },
    ride: function (sr, vel, rng) {
      var n = Math.round(1.1 * sr), o = new Float32Array(n), lp = 0, k = 1 - Math.exp(-TAU * 5500 / sr), i;
      var parts = [[3180, 1], [4390, 0.8], [5710, 0.7], [7840, 0.55], [9990, 0.3]];
      for (i = 0; i < n; i++) {
        var t = i / sr, x = rng() * 2 - 1; lp += k * (x - lp);
        var s = (x - lp) * 0.5 * Math.exp(-t / 0.22);
        for (var p = 0; p < parts.length; p++) if (parts[p][0] < sr * 0.45) s += Math.sin(TAU * parts[p][0] * t) * parts[p][1] * 0.12 * Math.exp(-t / (0.45 - 0.05 * p));
        o[i] = s;
      }
      for (i = 0; i < Math.min(n, 120); i++) o[i] += (rng() * 2 - 1) * 0.35 * (1 - i / 120);
      return scaleBuf(o, 0.3 * (0.4 + 0.6 * vel));
    },
    clap: function (sr, vel, rng) {
      var n = Math.round(0.25 * sr), o = new Float32Array(n), lp = 0, lp2 = 0, k1 = 1 - Math.exp(-TAU * 3500 / sr), k2 = 1 - Math.exp(-TAU * 900 / sr);
      for (var i = 0; i < n; i++) {
        var t = i / sr, x = rng() * 2 - 1; lp += k1 * (x - lp); lp2 += k2 * (lp - lp2);
        var burst = (t < 0.008 || (t > 0.012 && t < 0.02) || (t > 0.025 && t < 0.034)) ? 1 : 0;
        o[i] = (lp - lp2) * (burst ? 2.6 : 0) + (lp - lp2) * 1.6 * Math.exp(-t / 0.07) * (t > 0.034 ? 1 : 0);
      }
      return scaleBuf(o, 0.5 * (0.4 + 0.6 * vel));
    },
    tom: function (sr, vel) {
      var n = Math.round(0.4 * sr), o = new Float32Array(n), ph = 0;
      for (var i = 0; i < n; i++) { var t = i / sr; ph += TAU * (110 + 90 * Math.exp(-t / 0.05)) / sr; o[i] = Math.sin(ph) * Math.exp(-t / 0.14); }
      return scaleBuf(o, 0.7 * (0.4 + 0.6 * vel));
    },
    click: function (sr, vel) {
      var n = Math.round(0.05 * sr), o = new Float32Array(n);
      for (var i = 0; i < n; i++) { var t = i / sr; o[i] = Math.sin(TAU * 1500 * t) * Math.exp(-t / 0.008); }
      return scaleBuf(o, 0.6 * (0.4 + 0.6 * vel));
    },
    wood: function (sr, vel) {
      var n = Math.round(0.07 * sr), o = new Float32Array(n);
      for (var i = 0; i < n; i++) { var t = i / sr; o[i] = (Math.sin(TAU * 900 * t) + 0.4 * Math.sin(TAU * 1730 * t)) * Math.exp(-t / 0.012); }
      return scaleBuf(o, 0.45 * (0.4 + 0.6 * vel));
    }
  };

  /* ───────────────────────── 6. 混响与效果（作用在总线上） ───────────────────────── */

  var ROOMS = {
    dry: null,
    room: { comb: [1116, 1188, 1277, 1356], fb: 0.74, damp: 0.35, wet: 0.16, tail: 1 },
    hall: { comb: [1557, 1617, 1491, 1422], fb: 0.84, damp: 0.28, wet: 0.2, tail: 2 },
    church: { comb: [1999, 2111, 2237, 2383], fb: 0.9, damp: 0.22, wet: 0.26, tail: 3.5 },
    bathroom: { comb: [331, 389, 421, 467], fb: 0.82, damp: 0.1, wet: 0.24, tail: 1.5 }
  };
  function reverb(x, sr, name, wetOverride) {
    var cfg = ROOMS[name]; if (!cfg) return x;
    var scale = sr / 44100, n = x.length, wet = wetOverride == null ? cfg.wet : wetOverride, out = new Float32Array(n);
    var combs = cfg.comb.map(function (d) { var L = Math.round(d * scale); return { buf: new Float32Array(L), i: 0, L: L, lp: 0 }; });
    var aps = [556, 441].map(function (d) { var L = Math.round(d * scale); return { buf: new Float32Array(L), i: 0, L: L }; });
    for (var s = 0; s < n; s++) {
      var xin = x[s] * 0.25, acc = 0, c, a;
      for (c = 0; c < combs.length; c++) {
        var cb = combs[c], y = cb.buf[cb.i];
        cb.lp = y * (1 - cfg.damp) + cb.lp * cfg.damp;
        cb.buf[cb.i] = xin + cb.lp * cfg.fb;
        cb.i = cb.i + 1 === cb.L ? 0 : cb.i + 1;
        acc += y;
      }
      for (a = 0; a < aps.length; a++) {
        var ap = aps[a], bo = ap.buf[ap.i], ai = acc;
        acc = -ai + bo; ap.buf[ap.i] = ai + bo * 0.5;
        ap.i = ap.i + 1 === ap.L ? 0 : ap.i + 1;
      }
      out[s] = x[s] + acc * wet * 1.6;
    }
    return out;
  }
  function lowpass(x, sr, cutoff) {
    var k = 1 - Math.exp(-TAU * cutoff / sr), y = 0, y2 = 0, out = new Float32Array(x.length);
    for (var i = 0; i < x.length; i++) { y += k * (x[i] - y); y2 += k * (y - y2); out[i] = y2; }
    return out;
  }

  /* ───────────────────────── 7. 渲染一首曲子 ───────────────────────── */

  function swingPos(pos, swing) {                 // pos∈[0,1) 拍内位置；swing=反拍八分音符所在位置（0.5 直、0.667 摇摆）
    return pos < 0.5 ? pos * (swing / 0.5) : swing + (pos - 0.5) * ((1 - swing) / 0.5);
  }

  function render(piece, opts) {
    opts = opts || {};
    var sr = opts.sr || piece.sr || DEFAULT_SR;
    var tmap = makeTimeMap(piece.tempo, opts.tempoScale || 1);
    var skip = piece.skip || 0, t00 = skip ? tmap(skip) : 0;
    var T = function (b) { return tmap(b) - t00; };
    var meter = piece.meter || [4, 4], barLen = meter[0] * 4 / meter[1];
    var origin = piece.pickup ? piece.pickup - barLen : 0;
    var cache = {}, all = [], voiceEvents = [], endSec = 0, vlist = piece.voices || [], enabled = opts.enabled;

    vlist.forEach(function (v) {
      var evs = [];
      if (v.grid) {
        var perBeat = v.perBeat || 4, bars = v.bars || 1;
        Object.keys(v.grid).forEach(function (name) {
          var pat = v.grid[name];
          for (var b = 0; b < bars; b++) {
            var pb = Array.isArray(pat) ? pat[b % pat.length] : pat;
            var swing = Array.isArray(v.swing) ? v.swing[b % v.swing.length] : (v.swing || 0.5);      // swing 可以按小节给：[0.5, 0.5, 0.667, …]
            for (var s = 0; s < pb.length; s++) {
              var ch = pb[s]; if (ch === '.' || ch === ' ' || ch === '-') continue;
              var beatInBar = s / perBeat, whole = Math.floor(beatInBar), fr = beatInBar - whole;
              var beat = b * barLen + whole + (swing !== 0.5 ? swingPos(fr, swing) : fr);
              var vel = ch === 'X' ? 1 : ch === 'x' ? 0.8 : ch === 'o' ? 0.45 : 0.7;
              if (beat < skip - 1e-9) continue;
              evs.push({ drum: name, beat: beat, d: 0.25, vel: vel * (v.vel == null ? 1 : v.vel) });
            }
          }
        });
        endSec = Math.max(endSec, T(bars * barLen));
      } else {
        var pv = parseVoice(v.notes, v), merged = mergeTies(pv.events), hold = v.hold || 0;
        merged.forEach(function (e) {
          if (e.rest || e.beat < skip - 1e-9) return;
          var d = e.d, bt = e.beat;
          if (hold) {
            var endHold = origin + (Math.floor((e.beat - origin) / hold + 1e-9) + 1) * hold;
            if (endHold - e.beat > d) d = endHold - e.beat;
          }
          if (v.swing != null) {                               // 摇摆：把每拍内部的位置重新映射（0.5 = 直，0.667 = 三连音式的"长—短"），起音与结束一起映射
            var sw = v.swing, bi = Math.max(0, Math.floor((e.beat - origin + 1e-9) / barLen));
            var sv = Array.isArray(sw) ? sw[bi % sw.length] : sw;
            if (Math.abs(sv - 0.5) > 1e-9) {
              var smap = function (x) { var w0 = Math.floor(x + 1e-9); return w0 + swingPos(x - w0, sv); };
              var nb = smap(e.beat), ne = smap(e.beat + d);
              bt = nb; d = Math.max(0.02, ne - nb);
            }
          }
          evs.push({ beat: bt, d: d, dNotated: e.d, midi: e.midi, vel: e.vel, gate: e.gate, letter: e.letter, acc: e.acc, oct: e.oct, hz: e.hz, token: e.token, chord: e.chord });
          endSec = Math.max(endSec, T(bt + d));
        });
      }
      voiceEvents.push(evs);
    });

    var room = (opts.room !== undefined ? opts.room : (piece.fx && piece.fx.room)) || 'dry';
    var tail = piece.tail == null ? 0.8 : piece.tail;
    var extra = room !== 'dry' ? ROOMS[room].tail : 0.4;
    var nTotal = Math.ceil((endSec + tail + extra) * sr);
    var stems = [];

    vlist.forEach(function (v, vi) {
      var stem = new Float32Array(nTotal), skipV = enabled && enabled.indexOf(vi) < 0;
      var vol = v.vol == null ? 1 : v.vol, instName = v.inst || 'piano', gate0 = v.gate == null ? 1 : v.gate;
      var lateAt = function (beat) {                         // 微偏：声部整体提前(<0)/延后(>0)若干秒（"推"与"拖"）；可以按小节给数组
        if (Array.isArray(v.late)) return v.late[Math.max(0, Math.floor((beat - origin + 1e-9) / barLen)) % v.late.length] || 0;
        return v.late || 0;
      };
      voiceEvents[vi].forEach(function (e) {
        var late = lateAt(e.beat);
        var t0 = Math.max(0, T(e.beat) + late), t1 = Math.max(t0, T(e.beat + e.d) + late);
        var evHz = e.drum ? null : (e.hz != null ? e.hz : tunedHz(e.midi, piece.tuning));
        all.push({ voice: vi, t0: t0, t1: e.dNotated != null ? T(e.beat + e.dNotated) + late : t1, beat: e.beat, d: e.dNotated != null ? e.dNotated : e.d, midi: e.midi, hz: evHz, vel: e.vel, drum: e.drum, letter: e.letter, acc: e.acc, oct: e.oct, token: e.token });
        if (skipV) return;
        var i0 = Math.round(t0 * sr), buf;
        if (e.drum) {
          var fn = DRUM[e.drum]; if (!fn) throw new Error('unknown drum ' + e.drum);
          var dk = 'd|' + e.drum + '|' + e.vel.toFixed(2);
          buf = cache[dk] || (cache[dk] = fn(sr, e.vel, mulberry32(hashStr(piece.id + e.drum))));
          mixInto(stem, buf, i0, vol * (v.dyn ? Math.pow(Math.max(0.02, e.vel), v.dyn) : 1));
          return;
        }
        var inst = INST[instName]; if (!inst) throw new Error('unknown instrument ' + instName);
        var durSec = Math.max(0.03, (t1 - t0) * (e.gate == null ? gate0 : e.gate));
        var hz = evHz;
        var ck = [instName, hz.toFixed(3), durSec.toFixed(3), e.vel.toFixed(2), v.pedal ? 'p' : '', v.trimAttack || 0, v.seed || ''].join('|');
        buf = cache[ck];
        if (!buf) {
          buf = inst(sr, hz, durSec, e.vel, mulberry32(hashStr(piece.id + instName + hz.toFixed(2) + (v.seed || ''))), { pedal: v.pedal });
          if (v.trimAttack) {                    // "剪掉起音"：去掉开头 trimAttack 秒，再用 30 ms 淡入
            var cut = Math.min(buf.length - 1, Math.round(v.trimAttack * sr)), fi = Math.round(0.03 * sr), nb = new Float32Array(buf.length - cut);
            for (var q = 0; q < nb.length; q++) nb[q] = buf[q + cut] * (q < fi ? q / fi : 1);
            buf = nb;
          }
          cache[ck] = buf;
        }
        mixInto(stem, buf, i0, vol * (v.gain == null ? 1 : v.gain) * (v.dyn ? Math.pow(Math.max(0.02, e.vel), v.dyn) : 1));
      });
      if (v.sweep) stem = sweepLowpass(stem, sr, v.sweep.map(function (p) { return [T(p[0]), p[1]]; }));
      stems.push(stem);
    });

    var info = {};
    var mix = mixStems(stems, null, { room: room, wet: opts.wet != null ? opts.wet : (piece.fx && piece.fx.wet), lowpass: opts.lowpass || (piece.fx && piece.fx.lowpass), normalize: piece.normalize, sr: sr, out: info });
    all.sort(function (a, b) { return a.t0 - b.t0 || a.midi - b.midi; });
    return { sr: sr, samples: mix, stems: stems, events: all, duration: endSec, piece: piece, timeOf: T, room: room, mixGain: info.gain };
  }

  function mixInto(dst, src, i0, g) {
    var n = Math.min(src.length, dst.length - i0);
    for (var i = 0; i < n; i++) dst[i0 + i] += src[i] * g;
  }

  /* 把若干声部相加，过低通/混响，归一化。 */
  function mixStems(stems, mask, o) {
    o = o || {};
    var n = stems[0].length, y = new Float32Array(n), i;
    for (var s = 0; s < stems.length; s++) {
      if (mask && !mask[s]) continue;
      var st = stems[s];
      for (i = 0; i < n; i++) y[i] += st[i];
    }
    var sr = o.sr || DEFAULT_SR;
    if (o.lowpass) y = lowpass(y, sr, o.lowpass);
    if (o.room && o.room !== 'dry') y = reverb(y, sr, o.room, o.wet);
    var norm = o.normalize === undefined ? 'loud' : o.normalize, g = 1, limit = true;
    if (norm === 'peak') {                         // 保留曲内的力度对比：只把最高峰放到 −1 dBFS
      var pk = o.refPeak || 0;
      if (!pk) for (i = 0; i < n; i++) { var a = Math.abs(y[i]); if (a > pk) pk = a; }
      g = pk > 1e-9 ? 0.89 / pk : 1; limit = false;
    } else if (norm === 'loud') {                  // 响度对齐：不同乐器/曲子放在一页里，音量不要忽大忽小
      var ss = 0, cnt = 0, pk2 = 0;
      for (i = 0; i < n; i++) { var v = y[i], av = Math.abs(v); if (av > 1e-4) { ss += v * v; cnt++; } if (av > pk2) pk2 = av; }
      var rms = cnt ? Math.sqrt(ss / cnt) : 0;
      g = rms > 1e-9 ? (o.targetRms || 0.115) / rms : 1;
      if (pk2 * g > 1.5) g = 1.5 / pk2;            // 峰值太尖的曲子（鼓、拨弦）宁可略轻一点，也不压成方波
    } else if (norm === 'fixed') {                 // 用同一个增益重混（关掉某个声部时，其余声部音量不变）
      g = o.gain || 1;
    }
    if (g !== 1 || limit) {
      for (i = 0; i < n; i++) {
        var q = y[i] * g, aq = Math.abs(q);
        y[i] = (!limit || aq <= 0.7) ? q : (q < 0 ? -1 : 1) * (0.7 + 0.25 * Math.tanh((aq - 0.7) / 0.25));   // 软限幅
      }
    }
    if (o.out) o.out.gain = g;
    return y;
  }

  /* ───────────────────────── 8. WAV ───────────────────────── */

  function toInt16(f32) {
    var n = f32.length, o = new Int16Array(n), fadeIn = Math.min(n, 64), fadeOut = Math.min(n, 640);
    for (var i = 0; i < n; i++) {
      var x = f32[i];
      if (i < fadeIn) x *= i / fadeIn;
      if (i >= n - fadeOut) x *= (n - 1 - i) / fadeOut;
      x = x > 1 ? 1 : x < -1 ? -1 : x;
      o[i] = Math.round(x * 32767);
    }
    return o;
  }
  function encodeWav(f32, sr) {
    var pcm = toInt16(f32), n = pcm.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf), i;
    function str(o, s) { for (var j = 0; j < s.length; j++) dv.setUint8(o + j, s.charCodeAt(j)); }
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * 2, true);
    for (i = 0; i < n; i++) dv.setInt16(44 + i * 2, pcm[i], true);
    return new Uint8Array(buf);
  }

  /* ───────────────────────── 9. 简谱 ─────────────────────────
     用音名的字母与升降号推算级数，所以 D♯ 在 C 调里是 ♯2、E♭ 是 ♭3。key = 简谱里的 "1=" ，如 'C'、'G'、'Bb'。 */
  var MAJOR_OFFSET = [0, 2, 4, 5, 7, 9, 11];
  function jianpuTokens(events, key) {
    var kp = /^([A-G])(#|b)?$/.exec(key || 'C'), tL = LETTER_IDX[kp[1]];
    var tonicPc = (LETTER[kp[1]] + (kp[2] === '#' ? 1 : kp[2] === 'b' ? -1 : 0) + 12) % 12;
    var mids = events.filter(function (e) { return !e.rest; }).map(function (e) { return e.midi; }).sort(function (a, b) { return a - b; });
    var med = mids.length ? mids[Math.floor(mids.length / 2)] : 60, refDo = 48 + tonicPc, best = 1e9;
    for (var k = 0; k < 4; k++) { var cand = 48 + tonicPc + 12 * k, dd = Math.abs(med - (cand + 5)); if (dd < best) { best = dd; refDo = cand; } }
    return events.map(function (e) {
      if (e.rest) return { rest: true, beat: e.beat, d: e.d };
      var deg = (LETTER_IDX[e.letter] - tL + 7) % 7;
      var want = ((LETTER[e.letter] + e.acc - tonicPc) % 12 + 12) % 12;
      var acc = want - MAJOR_OFFSET[deg];
      if (acc > 6) acc -= 12; if (acc < -6) acc += 12;
      var spelled = 12 * (e.oct + 1) + LETTER[e.letter] + e.acc;
      var oct = Math.round((spelled - (refDo + MAJOR_OFFSET[deg] + acc)) / 12);
      return { n: deg + 1, acc: acc, oct: oct, beat: e.beat, d: e.d, midi: e.midi };
    });
  }

  /* ───────────────────────── 10. 乐谱库 ───────────────────────── */
  var scores = {};
  function defineScore(id, def) { def.id = id; scores[id] = def; return def; }

  return {
    version: '1.0', DEFAULT_SR: DEFAULT_SR,
    midiToHz: midiToHz, hzToMidi: hzToMidi, midiName: midiName, parsePitch: parsePitch, tunedHz: tunedHz, RATIOS: RATIOS,
    parseVoice: parseVoice, mergeTies: mergeTies, validatePiece: validatePiece, makeTimeMap: makeTimeMap,
    INST: INST, DRUM: DRUM, ROOMS: ROOMS, sweepLowpass: sweepLowpass, render: render, mixStems: mixStems, reverb: reverb, lowpass: lowpass,
    encodeWav: encodeWav, jianpuTokens: jianpuTokens, mulberry32: mulberry32, hashStr: hashStr,
    scores: scores, defineScore: defineScore
  };
});
