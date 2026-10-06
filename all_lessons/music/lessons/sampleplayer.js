/* sampleplayer.js — 《作曲的逻辑》试听播放器
 *
 * 一个页面里所有的"试听样本"共用同一个 <audio> 元素（传输层），样本由 musickit.js 在点击时（或滚动到附近时）
 * 同步渲染成 WAV Blob。点击处理函数里全程同步 → 满足 iOS/Safari 对"必须在用户手势里 play()"的要求；
 * 走的是普通媒体播放，不依赖 AudioContext，因此也不受 iPhone 静音拨片对 Web Audio 的静音影响。
 * 界面：钢琴卷帘（带播放头）+ 简谱（当前音高亮）+ 声部开关 + 速度 + "听不到声音？"诊断。
 *
 * 对外：
 *   MusicPlayer.mountAll(root)            把 .sample[data-piece] 变成播放器
 *   MusicPlayer.clip(piece, opts)         给小部件用：在点击里渲染并播放一段（opts.onTick/onEnd）
 *   MusicPlayer.audioContext()            给"必须实时"的小部件（滑块连续发声）用的共享 AudioContext，已做移动端解锁
 *   MusicPlayer.mountCheck(el)            "声音自检"小部件
 */
(function () {
  'use strict';
  var MK = window.MusicKit;
  if (!MK) { console.warn('musickit.js not loaded'); return; }

  /* ───────────── 环境探测 ───────────── */
  var ua = navigator.userAgent || '';
  var isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isWeChat = /MicroMessenger/i.test(ua);
  var isAndroid = /Android/i.test(ua);
  var canWav = (function () { try { var a = document.createElement('audio'); return !!(a.canPlayType && a.canPlayType('audio/wav')); } catch (e) { return false; } })();

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function fmtTime(s) { s = Math.max(0, s); var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }

  /* ───────────── 共享传输层：一个 <audio> ───────────── */
  var T = { a: null, cur: null, raf: 0 };
  function audioEl() {
    if (T.a) return T.a;
    var a = new Audio();
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    a.addEventListener('play', function () { if (T.cur) setState(T.cur, 'playing'); loop(); });
    a.addEventListener('pause', function () { if (T.cur && !a.ended && T.cur.state !== 'idle') setState(T.cur, 'paused'); });
    a.addEventListener('ended', function () { var c = T.cur; if (c) { setState(c, 'idle'); if (c.onEnd) c.onEnd(); } });
    a.addEventListener('error', function () {
      var c = T.cur; if (!c) return;
      var code = a.error ? a.error.code : '?';
      say(c, '播放出错（媒体错误 ' + code + '）。请刷新页面重试；若仍不行，看下面"听不到声音？"。', true);
      setState(c, 'idle');
    });
    T.a = a;
    return a;
  }

  function stopCurrent() {
    var a = T.a, c = T.cur;
    if (!a || !c) return;
    try { a.pause(); } catch (e) { }
    setState(c, 'idle');
    T.cur = null;
  }

  function loop() {
    cancelAnimationFrame(T.raf);
    function frame() {
      var a = T.a, c = T.cur;
      if (!a || !c || a.paused || a.ended) return;     // 已经停了：收尾由 setState 负责，这里不再回调（否则会把"结束"又画回"播放中"）
      var t = a.currentTime;
      if (c.onTick) c.onTick(t);
      if (c.draw) c.draw(t);
      T.raf = requestAnimationFrame(frame);
    }
    T.raf = requestAnimationFrame(frame);
  }

  /* 在点击处理函数里同步调用：把 pl.url 装进 <audio> 并播放。 */
  function transportPlay(pl, startAt) {
    var a = audioEl();
    if (T.cur && T.cur !== pl) stopCurrent();
    var fresh = T.cur !== pl || a.src !== pl.url;
    T.cur = pl;
    if (fresh) { a.src = pl.url; if (startAt) seekWhenReady(a, startAt); }
    else if (a.ended) { a.currentTime = startAt || 0; }
    else if (startAt != null) { a.currentTime = startAt; }
    setState(pl, 'loading');
    var p;
    try { p = a.play(); } catch (e) { p = Promise.reject(e); }
    if (p && p.catch) {
      p.then(function () { watchdog(pl); }).catch(function (err) {
        var name = err && err.name;
        if (name === 'NotAllowedError') say(pl, '浏览器没有允许播放——请再点一次 ▶。', true);
        else if (name === 'AbortError') { /* 被后一次点击打断，忽略 */ }
        else say(pl, '播放没有开始（' + (name || err) + '）。看下面"听不到声音？"。', true);
        if (name !== 'AbortError') setState(pl, 'idle');
      });
    }
  }
  function seekWhenReady(a, t) {
    var f = function () { a.removeEventListener('loadedmetadata', f); try { a.currentTime = t; } catch (e) { } };
    a.addEventListener('loadedmetadata', f);
  }
  /* 点了播放但时钟 1.6 秒内没动：给出提示（常见原因：静音、系统阻止、设备路由）。 */
  function watchdog(pl) {
    var a = T.a, t0 = a.currentTime;
    setTimeout(function () {
      if (T.cur === pl && !a.paused && a.currentTime - t0 < 0.15) {
        say(pl, '已发出播放请求，但声音还没有走起来——请看下面"听不到声音？"。', true);
        var d = pl.root && pl.root.querySelector('.sp-help'); if (d) d.open = true;
      }
    }, 1600);
  }

  function setState(pl, s) {
    pl.state = s;
    if (pl.onState) pl.onState(s);
    if (!pl.root) return;
    var b = pl.btn;
    if (b) {
      b.textContent = s === 'playing' ? '⏸ 暂停' : s === 'paused' ? '▶ 继续' : s === 'loading' ? '… 载入' : s === 'rendering' ? '… 准备' : '▶ 播放';
      b.classList.toggle('playing', s === 'playing');
    }
    if (pl.stopBtn) pl.stopBtn.disabled = (s === 'idle' || s === 'rendering');
    if (s === 'playing') say(pl, '播放中 · ' + fmtTime(T.a ? T.a.currentTime : 0) + ' / ' + fmtTime(pl.r.duration));
    else if (s === 'idle' && pl.r) { say(pl, pl.readyText); if (pl.draw) pl.draw(-1); }
    pl.root.classList.toggle('is-playing', s === 'playing');
  }
  function say(pl, msg, warn) {
    if (!pl.statusEl) return;
    pl.statusEl.textContent = msg;
    pl.statusEl.classList.toggle('warn', !!warn);
  }

  /* ───────────── 渲染（同步） ───────────── */
  function pieceMask(pl) { return pl.piece.voices.map(function (v, i) { return pl.mask[i] !== false; }); }

  function renderPlayer(pl) {
    var piece = pl.piece, t0 = (window.performance && performance.now) ? performance.now() : 0;
    setState(pl, 'rendering');
    var r = MK.render(piece, { tempoScale: pl.speed });
    pl.r = r;
    var samples = r.samples;
    if (piece.toggles && pl.mask.some(function (x) { return x === false; })) {
      samples = MK.mixStems(r.stems, pieceMask(pl), { room: r.room, wet: piece.fx && piece.fx.wet, lowpass: piece.fx && piece.fx.lowpass, sr: r.sr, normalize: 'fixed', gain: r.mixGain });
    }
    publish(pl, samples);
    var ms = (window.performance && performance.now) ? Math.round(performance.now() - t0) : 0;
    pl.durText = fmtTime(r.duration) + ' / ' + fmtTime(r.duration);
    pl.readyText = '就绪 · 时长 ' + fmtTime(r.duration) + (pl.speed !== 1 ? ' · ' + pl.speed + '×' : '') + ' · 合成 ' + ms + ' ms';
    if (!piece.toggles) r.stems = null;
    buildGeometry(pl);
    setState(pl, 'idle');
  }
  function publish(pl, samples) {
    var wav = MK.encodeWav(samples, pl.r.sr);
    var blob = new Blob([wav], { type: 'audio/wav' });
    var old = pl.url;
    pl.url = URL.createObjectURL(blob);
    if (old) setTimeout(function () { try { URL.revokeObjectURL(old); } catch (e) { } }, 4000);
  }
  function ensure(pl) { if (!pl.url) renderPlayer(pl); }

  /* ───────────── 钢琴卷帘 ───────────── */
  var VOICE_COLORS = ['#60a5fa', '#fbbf24', '#34d399', '#f472b6', '#a78bfa', '#fb923c', '#22d3ee'];
  var DRUM_ROWS = { kick: 0, snare: 1, clap: 1, tom: 1, hat: 2, ohat: 2, ride: 2, click: 2, wood: 2 };

  function buildGeometry(pl) {
    var r = pl.r, ev = r.events, lo = 127, hi = 0, hasDrum = false;
    ev.forEach(function (e) { if (e.drum) hasDrum = true; else { if (e.midi < lo) lo = e.midi; if (e.midi > hi) hi = e.midi; } });
    if (lo > hi) { lo = 55; hi = 79; }
    lo = Math.floor(lo) - 1; hi = Math.ceil(hi) + 1;
    if (hi - lo < 12) { var mid = (hi + lo) / 2; lo = Math.floor(mid - 6); hi = Math.ceil(mid + 6); }
    pl.geom = { lo: lo, hi: hi, hasDrum: hasDrum, dur: Math.max(0.5, r.duration) };
  }

  function sizeCanvas(pl) {
    var c = pl.canvas, w = Math.max(240, c.clientWidth || 600), h = pl.geom && pl.geom.hasDrum ? 170 : 140;
    if (w < 420) h = Math.round(h * 0.85);
    if (pl.piece.curve) h += 62;                          // 卷帘下面多一条"曲线带"（如张力线）
    var dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.style.height = h + 'px';
      pl.base = null;
    }
    pl.cw = w; pl.ch = h; pl.dpr = dpr;
  }

  function drawBase(pl) {
    sizeCanvas(pl);
    var W = pl.cw, H = pl.ch, g = pl.geom, r = pl.r;
    var off = document.createElement('canvas'); off.width = pl.canvas.width; off.height = pl.canvas.height;
    var x = off.getContext('2d'); x.setTransform(pl.dpr, 0, 0, pl.dpr, 0, 0);
    x.fillStyle = '#0b1020'; x.fillRect(0, 0, W, H);
    var cv = pl.piece.curve, padL = 8, padR = 8, padT = 18, padB = (g.hasDrum ? 52 : 10) + (cv ? 62 : 0);
    var pw = W - padL - padR, ph = H - padT - padB, dur = g.dur;
    pl.px = function (t) { return padL + t / dur * pw; };
    pl.py = function (m) { return padT + (1 - (m - g.lo) / (g.hi - g.lo)) * ph; };
    pl.pad = { l: padL, r: padR, t: padT, b: padB, w: pw, h: ph };
    // 音高格线（C 音）
    x.strokeStyle = 'rgba(255,255,255,0.07)'; x.lineWidth = 1;
    for (var m = Math.ceil(g.lo); m <= g.hi; m++) if (m % 12 === 0) { var yy = Math.round(pl.py(m)) + 0.5; x.beginPath(); x.moveTo(padL, yy); x.lineTo(W - padR, yy); x.stroke(); }
    // 小节线
    var meter = pl.piece.meter || [4, 4], barLen = meter[0] * 4 / meter[1];
    x.strokeStyle = 'rgba(255,255,255,0.10)';
    var skip = pl.piece.skip || 0;
    var bars = pl.piece.barBeats;                         // 曲子显式给出小节线（拍号中途变化 / 自由长度的演示）；否则按拍号等距画
    if (bars) bars.forEach(function (b) { var tt = r.timeOf(b); if (tt < -0.001 || tt > dur + 0.01) return; var xx = Math.round(pl.px(tt)) + 0.5; x.beginPath(); x.moveTo(xx, padT - 4); x.lineTo(xx, padT + ph); x.stroke(); });
    else for (var b = skip; ; b += barLen) { var tt = r.timeOf(b); if (tt > dur + 0.01) break; var xx = Math.round(pl.px(tt)) + 0.5; x.beginPath(); x.moveTo(xx, padT - 4); x.lineTo(xx, padT + ph); x.stroke(); }
    // 段落标注
    x.font = '11px system-ui,sans-serif'; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    (pl.piece.sections || []).forEach(function (s) {
      var tt = r.timeOf(s.beat); if (tt < 0) return;
      var xs = pl.px(tt);
      x.strokeStyle = 'rgba(253,230,138,0.55)'; x.beginPath(); x.moveTo(Math.round(xs) + 0.5, 2); x.lineTo(Math.round(xs) + 0.5, padT + ph); x.stroke();
      x.fillStyle = '#fde68a'; x.fillText(s.name, xs + 3, 12);
    });
    // 音符
    var nh = Math.max(3, Math.min(10, ph / (g.hi - g.lo) * 0.9));
    r.events.forEach(function (e) {
      if (e.drum) return;
      var x0 = pl.px(e.t0), x1 = Math.max(x0 + 2, pl.px(e.t1) - 1), y = pl.py(e.midi) - nh / 2;
      x.fillStyle = VOICE_COLORS[e.voice % VOICE_COLORS.length];
      x.globalAlpha = pl.piece.voices[e.voice] && pl.mask[e.voice] === false ? 0.15 : 0.9;
      x.fillRect(x0, y, x1 - x0, nh);
    });
    x.globalAlpha = 1;
    // 鼓
    if (g.hasDrum) {
      var laneH = 14, y0 = padT + ph + 8;
      ['底鼓', '军鼓/拍手', '镲/节拍'].forEach(function (nm, i) { x.fillStyle = 'rgba(255,255,255,0.4)'; x.fillText(nm, padL + 2, y0 + i * (laneH + 2) + 10); });
      r.events.forEach(function (e) {
        if (!e.drum) return;
        var row = DRUM_ROWS[e.drum]; if (row == null) row = 2;
        x.fillStyle = ['#f87171', '#fbbf24', '#93c5fd'][row];
        x.fillRect(pl.px(e.t0), y0 + row * (laneH + 2) + 2, 3, laneH - 4);
      });
    }
    // 曲线带：把一个"随时间变化的量"（如张力线）画在卷帘下面，与播放头对齐
    if (cv) {
      var y0 = padT + ph + 18, hh = 38, pts = cv.points.map(function (p) { return { t: r.timeOf(p[0]), v: p[1], hot: p[2] }; });
      x.fillStyle = 'rgba(255,255,255,0.05)'; x.fillRect(padL, y0, pw, hh);
      x.strokeStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.moveTo(padL, y0 + hh + 0.5); x.lineTo(padL + pw, y0 + hh + 0.5); x.stroke();
      x.fillStyle = 'rgba(245,158,11,0.95)'; x.font = '11px system-ui,sans-serif'; x.textAlign = 'left'; x.fillText(cv.label || '', padL + 3, y0 - 5);
      x.strokeStyle = '#f59e0b'; x.lineWidth = 2; x.beginPath();
      var prevY = null;
      pts.forEach(function (p, i) {
        var X = pl.px(p.t), Y = y0 + (1 - p.v) * hh;
        if (i === 0) x.moveTo(X, Y); else { x.lineTo(X, prevY); x.lineTo(X, Y); }
        prevY = Y;
      });
      if (prevY !== null) x.lineTo(pl.px(dur), prevY);
      x.stroke(); x.lineWidth = 1;
      pts.forEach(function (p) { x.fillStyle = p.hot ? '#f87171' : '#fbbf24'; x.beginPath(); x.arc(pl.px(p.t), y0 + (1 - p.v) * hh, 2.6, 0, Math.PI * 2); x.fill(); });
      pl.pad.stripY = y0 + hh;
    }
    pl.base = off;
  }

  function drawRoll(pl, now) {
    if (!pl.r) return;
    if (!pl.base || pl.base.width !== pl.canvas.width) drawBase(pl);
    var c = pl.canvas, x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(pl.base, 0, 0);
    x.setTransform(pl.dpr, 0, 0, pl.dpr, 0, 0);
    if (now >= 0) {
      var g = pl.geom, nh = Math.max(3, Math.min(10, pl.pad.h / (g.hi - g.lo) * 0.9));
      pl.r.events.forEach(function (e) {
        if (e.drum || now < e.t0 || now >= e.t1 + 0.02) return;
        if (pl.mask[e.voice] === false) return;
        var x0 = pl.px(e.t0), x1 = Math.max(x0 + 2, pl.px(e.t1) - 1), y = pl.py(e.midi) - nh / 2;
        x.fillStyle = '#fde68a'; x.fillRect(x0, y - 1, x1 - x0, nh + 2);
      });
      var px = Math.round(pl.px(Math.min(now, pl.geom.dur))) + 0.5;
      x.strokeStyle = '#ffffff'; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(px, 4); x.lineTo(px, pl.pad.stripY ? pl.pad.stripY : pl.pad.t + pl.pad.h + (pl.geom.hasDrum ? 50 : 4)); x.stroke(); x.lineWidth = 1;
    }
  }

  /* ───────────── 简谱 ───────────── */
  function jpDur(d) {                                   // 时值 → 简谱写法：延音线 – / 下划线 / 附点
    var e = 1e-6;
    if (d >= 1 - e) { var f = Math.floor(d + e), fr = d - f; return { dashes: f - 1, unders: 0, dot: fr > 0.45 }; }
    var bases = [[0.5, 1], [0.25, 2], [0.125, 3]];
    for (var i = 0; i < bases.length; i++) {
      if (Math.abs(d - bases[i][0]) < e) return { dashes: 0, unders: bases[i][1], dot: false };
      if (Math.abs(d - bases[i][0] * 1.5) < e) return { dashes: 0, unders: bases[i][1], dot: true };
    }
    return { dashes: 0, unders: d >= 0.45 ? 1 : d >= 0.2 ? 2 : 3, dot: false };
  }
  function buildJianpu(pl) {
    var cfg = pl.piece.jianpu; if (!cfg || !pl.jpEl) return;
    var v = pl.piece.voices[cfg.voice || 0];
    var pv = MK.parseVoice(v.notes, v), ev = MK.mergeTies(pv.events), skip = pl.piece.skip || 0;
    var toks = MK.jianpuTokens(ev, cfg.key || pl.piece.key || 'C');
    var bars = pv.barLines.slice(), bi = 0, html = '', i, idx = 0;
    pl.jpBeats = [];
    for (i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.beat < skip - 1e-9) continue;
      while (bi < bars.length && bars[bi] <= t.beat + 1e-9) { if (bars[bi] > skip + 1e-9) html += '<span class="jb">|</span>'; bi++; }
      var jd = jpDur(t.d), dashes = jd.dashes, unders = jd.unders, dot = jd.dot;
      var digit = t.rest ? '0' : String(t.n);
      var accTxt = !t.rest && t.acc ? (t.acc > 0 ? '♯' : '♭') : '';
      html += '<span class="jn' + (t.rest ? ' jr' : '') + '" data-i="' + idx + '" data-o="' + (t.rest ? 0 : t.oct) + '" data-u="' + unders + '">' +
        (accTxt ? '<i class="ja">' + accTxt + '</i>' : '') + '<b>' + digit + '</b>' + (dot ? '<i class="jdot">·</i>' : '') + '</span>';
      for (var k = 0; k < dashes; k++) html += '<span class="jd">–</span>';
      pl.jpBeats.push(t.beat);
      idx++;
    }
    pl.jpEl.innerHTML = html;
    pl.jpEl.classList.toggle('long', idx > 72);
    pl.jpNodes = pl.jpEl.querySelectorAll('.jn');
    pl.jpLabel = '1=' + (cfg.key || pl.piece.key || 'C');
    if (pl.jpKey) pl.jpKey.textContent = pl.jpLabel;
  }
  function highlightJianpu(pl, now) {
    if (!pl.jpNodes || !pl.jpBeats || !pl.r) return;
    var cur = -1;
    if (now >= 0) {
      for (var i = 0; i < pl.jpBeats.length; i++) { if (pl.r.timeOf(pl.jpBeats[i]) <= now + 1e-3) cur = i; else break; }
    }
    if (cur === pl.jpCur) return;
    if (pl.jpCur >= 0 && pl.jpNodes[pl.jpCur]) pl.jpNodes[pl.jpCur].classList.remove('on');
    if (cur >= 0 && pl.jpNodes[cur]) {
      pl.jpNodes[cur].classList.add('on');
      var n = pl.jpNodes[cur], box = pl.jpEl;
      if (box.scrollHeight > box.clientHeight + 4) {            // 简谱区域有滚动条时，让当前音保持可见
        var top = n.offsetTop - box.offsetTop; if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 30) box.scrollTop = Math.max(0, top - 20);
      }
    }
    pl.jpCur = cur;
  }

  /* ───────────── 播放器的界面 ───────────── */
  var SRC_LABEL = { pd: '公有领域', orig: '原创示意', demo: '声学演示', folk: '传统民歌' };

  function mount(root) {
    if (root.__sp) return root.__sp;
    var id = root.getAttribute('data-piece'), piece = MK.scores[id];
    if (!piece) { root.appendChild(el('div', 'hint', '（缺少乐谱：' + id + '）')); return null; }
    var pl = { root: root, piece: piece, speed: 1, mask: piece.voices.map(function () { return true; }), state: 'idle', url: null, jpCur: -1 };
    root.__sp = pl;
    root.classList.add('sample');
    var staticBox = root.querySelector('.sp-static'); if (staticBox) staticBox.style.display = 'none';
    var titleEl = root.querySelector('.title');
    if (!titleEl) { titleEl = el('div', 'title', '🎧 ' + (piece.title || id)); root.insertBefore(titleEl, root.firstChild); }

    // 标签：来源 / 合成说明
    var tags = el('div', 'sp-tags');
    tags.appendChild(el('span', 'chip ' + (piece.tag || 'demo'), SRC_LABEL[piece.tag] || '演示'));
    if (piece.credit) tags.appendChild(el('span', 'chip', piece.credit));
    tags.appendChild(el('span', 'chip', '合成演示 · 非录音'));
    var hint = root.querySelector('.hint');
    root.insertBefore(tags, hint ? hint.nextSibling : titleEl.nextSibling);

    // 控件
    var ctl = el('div', 'controls');
    pl.btn = el('button', 'primary sp-play', '▶ 播放'); pl.btn.type = 'button';
    pl.btn.setAttribute('aria-label', '播放 / 暂停：' + (piece.title || id));
    pl.stopBtn = el('button', 'sp-stop', '■ 停止'); pl.stopBtn.type = 'button'; pl.stopBtn.disabled = true;
    ctl.appendChild(pl.btn); ctl.appendChild(pl.stopBtn);
    if (piece.speeds) {
      var sp = el('span', 'sp-speeds', '<span class="lbl">速度</span>');
      piece.speeds.forEach(function (s) {
        var b = el('button', 'sp-speed' + (s === 1 ? ' on' : ''), s + '×'); b.type = 'button'; b.setAttribute('data-s', s);
        b.addEventListener('click', function () { setSpeed(pl, s, sp); });
        sp.appendChild(b);
      });
      ctl.appendChild(sp);
    }
    if (piece.toggles) {
      var vs = el('span', 'sp-voices', '<span class="lbl">声部</span>');
      piece.voices.forEach(function (v, i) {
        var lab = el('label', 'sp-vt'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
        var dot = el('i', 'dot'); dot.style.background = VOICE_COLORS[i % VOICE_COLORS.length];
        cb.addEventListener('change', function () { toggleVoice(pl, i, cb); });
        lab.appendChild(cb); lab.appendChild(dot); lab.appendChild(document.createTextNode(' ' + (v.name || v.inst)));
        vs.appendChild(lab);
      });
      ctl.appendChild(vs);
    }
    root.appendChild(ctl);

    pl.canvas = el('canvas', 'dist-canvas sp-roll'); pl.canvas.setAttribute('role', 'img');
    pl.canvas.setAttribute('aria-label', '钢琴卷帘：' + (piece.title || id) + '，横轴时间、纵轴音高；点击可跳到该处播放');
    root.appendChild(pl.canvas);

    if (piece.jianpu) {
      var jw = el('div', 'sp-jwrap'); jw.appendChild(el('div', 'sp-jlabel', '简谱 <span class="k"></span>'));
      pl.jpKey = jw.querySelector('.k');
      pl.jpEl = el('div', 'sp-jp'); jw.appendChild(pl.jpEl); root.appendChild(jw);
      buildJianpu(pl);
    }
    if (piece.note) root.appendChild(el('div', 'hint sp-note', piece.note));
    pl.statusEl = el('div', 'hint sp-status', '点 ▶ 播放（第一次点击时合成，约零点几秒）');
    root.appendChild(pl.statusEl);
    root.appendChild(helpPanel());

    pl.draw = function (t) { drawRoll(pl, t); highlightJianpu(pl, t); };
    pl.onTick = function (t) {
      var sec = Math.floor(t);
      if (sec !== pl.lastSec && pl.state === 'playing') { pl.lastSec = sec; say(pl, '播放中 · ' + fmtTime(t) + ' / ' + fmtTime(pl.r.duration)); }
    };

    pl.btn.addEventListener('click', function () { onPlayClick(pl); });
    pl.stopBtn.addEventListener('click', function () { if (T.cur === pl) { stopCurrent(); } });
    pl.canvas.addEventListener('click', function (ev) {
      ensure(pl);
      var rect = pl.canvas.getBoundingClientRect(), u = (ev.clientX - rect.left - pl.pad.l) / pl.pad.w;
      var t = Math.max(0, Math.min(1, u)) * pl.geom.dur;
      transportPlay(pl, t);
    });
    window.addEventListener('resize', function () { pl.base = null; if (pl.r && T.cur !== pl) drawRoll(pl, -1); });
    schedulePrerender(pl);
    return pl;
  }

  function onPlayClick(pl) {
    var a = audioEl();
    if (T.cur === pl && !a.paused && !a.ended) { a.pause(); return; }
    ensure(pl);
    transportPlay(pl, T.cur === pl && a.ended ? 0 : null);
  }
  function setSpeed(pl, s, wrap) {
    var wasCur = T.cur === pl, a = T.a, pos = wasCur && a ? a.currentTime : 0, playing = wasCur && a && !a.paused && !a.ended;
    var old = pl.speed; pl.speed = s;
    Array.prototype.forEach.call(wrap.querySelectorAll('.sp-speed'), function (b) { b.classList.toggle('on', parseFloat(b.getAttribute('data-s')) === s); });
    pl.url = null; pl.r = null;
    renderPlayer(pl);
    if (wasCur) {
      var np = pos * old / s;
      if (playing) { T.cur = null; transportPlay(pl, np); }
      else { a.src = pl.url; seekWhenReady(a, np); }
    }
  }
  function toggleVoice(pl, i, cb) {
    var n = pl.mask.filter(function (x) { return x !== false; }).length;
    if (!cb.checked && n <= 1) { cb.checked = true; return; }          // 至少留一个声部
    pl.mask[i] = cb.checked;
    var wasCur = T.cur === pl, a = T.a, pos = wasCur ? a.currentTime : 0, playing = wasCur && !a.paused;
    ensure(pl);
    var samples = MK.mixStems(pl.r.stems, pieceMask(pl), { room: pl.r.room, wet: pl.piece.fx && pl.piece.fx.wet, lowpass: pl.piece.fx && pl.piece.fx.lowpass, sr: pl.r.sr, normalize: 'fixed', gain: pl.r.mixGain });
    publish(pl, samples);
    pl.base = null; drawRoll(pl, wasCur ? pos : -1);
    if (wasCur) { a.src = pl.url; seekWhenReady(a, pos); if (playing) { var p = a.play(); if (p && p.catch) p.catch(function () { }); } }
  }

  /* 滚动到附近时才渲染（省电）；不支持 IntersectionObserver 的浏览器在页面空闲后依次渲染。 */
  var io = null, pending = [];
  function schedulePrerender(pl) {
    if ('IntersectionObserver' in window) {
      if (!io) io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { var p = en.target.__sp; io.unobserve(en.target); if (p && !p.url) setTimeout(function () { if (!p.url && T.cur !== p) { try { renderPlayer(p); drawRoll(p, -1); } catch (e) { say(p, '合成失败：' + e.message, true); } } }, 30); }
        });
      }, { rootMargin: '500px 0px' });
      io.observe(pl.root);
    } else {
      pending.push(pl);
    }
  }
  function drainPending() {
    var pl = pending.shift(); if (!pl) return;
    if (!pl.url) { try { renderPlayer(pl); drawRoll(pl, -1); } catch (e) { say(pl, '合成失败：' + e.message, true); } }
    setTimeout(drainPending, 120);
  }

  /* ───────────── "听不到声音？"面板 ───────────── */
  function helpPanel() {
    var d = el('details', 'sp-help');
    var items = [];
    items.push('先确认设备音量不是 0、没有连到一个没开机的蓝牙耳机/音箱；浏览器标签页没有被"静音此网站"。');
    if (isIOS) items.push('iPhone / iPad：把机身侧面的<strong>静音拨片</strong>拨到响铃一侧再试。本页的试听走的是普通媒体播放（和播客同一条路），通常不受静音拨片影响；但本页少数<em>实时发声</em>的滑块实验用的是 Web Audio，会被静音拨片压掉。');
    if (isWeChat) items.push('微信内置浏览器：先点一下页面里的 ▶（需要一次点击才允许出声）；仍不行就点右上角"在浏览器打开"。');
    if (isAndroid) items.push('Android：在系统"媒体音量"里调大；部分省电模式会暂停网页音频。');
    if (!canWav) items.push('这个浏览器似乎不能播放 WAV 音频。请换用较新的 Safari / Chrome / Edge / Firefox。');
    items.push('点 ▶ 后画面里的播放头会向右走；如果播放头在走而没有声音，问题在设备/系统音量，不在页面；如果播放头不动，请刷新后再点一次。');
    d.innerHTML = '<summary>听不到声音？</summary><ul>' + items.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>';
    return d;
  }

  /* ───────────── 给小部件用：一次性播放一段 ───────────── */
  var clipSeq = 0, lastClipUrl = null;
  function clip(piece, opts) {
    opts = opts || {};
    if (!piece.id) piece.id = 'clip-' + (++clipSeq);
    var a = audioEl();
    var pl = { piece: piece, speed: opts.tempoScale || 1, mask: [], clip: true, state: 'idle', root: null };
    var r = MK.render(piece, { tempoScale: pl.speed, room: opts.room });
    pl.r = r;
    publish(pl, r.samples);
    if (lastClipUrl) { var stale = lastClipUrl; setTimeout(function () { try { URL.revokeObjectURL(stale); } catch (e) { } }, 4000); }
    lastClipUrl = pl.url;
    pl.onTick = opts.onTick; pl.onEnd = opts.onEnd; pl.onState = opts.onState;
    transportPlay(pl, 0);
    return { events: r.events, duration: r.duration, timeOf: r.timeOf, stop: function () { if (T.cur === pl) stopCurrent(); } };
  }

  /* ───────────── 给"必须实时"的小部件用：共享 AudioContext + 移动端解锁 ───────────── */
  var sharedCtx = null, silent = null;
  function silentAudio() {
    if (silent) return silent;
    try {
      var wav = MK.encodeWav(new Float32Array(2400), 8000);
      silent = new Audio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
      silent.loop = true; silent.setAttribute('playsinline', ''); silent.volume = 0.01;
    } catch (e) { silent = null; }
    return silent;
  }
  function unlockWebAudio(ctx) {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { }
    if (isIOS && !navigator.audioSession) { var s = silentAudio(); if (s) { var p = s.play(); if (p && p.catch) p.catch(function () { }); } }
    if (ctx.state !== 'running') { var q = ctx.resume(); if (q && q.catch) q.catch(function () { }); }
    // 切后台/被电话打断后会变成 suspended/interrupted：下一次手势里再唤醒
    var wake = function () { if (ctx.state !== 'running') { var r = ctx.resume(); if (r && r.catch) r.catch(function () { }); } };
    ['click', 'touchend', 'keydown'].forEach(function (ev) { document.addEventListener(ev, wake, true); });
  }
  function audioContext() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!sharedCtx) { sharedCtx = new AC(); unlockWebAudio(sharedCtx); }
    else if (sharedCtx.state !== 'running') { var q = sharedCtx.resume(); if (q && q.catch) q.catch(function () { }); }
    return sharedCtx;
  }

  /* ───────────── "声音自检" ───────────── */
  var CHIME = { id: 'sound-check', tempo: 90, meter: [4, 4], tail: 0.4, fx: { room: 'room' },
    voices: [{ inst: 'bell', notes: 'A4e E5e A5q' }, { inst: 'piano', notes: 'A3q A3q' }] };
  function mountCheck(root) {
    root.classList.add('widget');
    root.innerHTML = '<div class="title">🔊 先测一下：你的设备现在能出声吗？</div>' +
      '<div class="hint">下面两个按钮分别走两条不同的声音路径。本课的"试听样本"用第一条（普通媒体播放，最稳）；个别需要实时发声的滑块实验用第二条（Web Audio）。哪一条听不到，就能知道问题出在哪。</div>' +
      '<div class="controls"><button type="button" class="primary sc-a">▶ 测试 1：试听样本通道</button><button type="button" class="sc-w">▶ 测试 2：实时发声通道</button></div>' +
      '<div class="kpi-grid"><div class="kpi"><div class="k">设备</div><div class="v sc-dev">—</div></div><div class="kpi"><div class="k">试听通道</div><div class="v sc-ra">未测试</div></div><div class="kpi"><div class="k">实时通道</div><div class="v sc-rw">未测试</div></div></div>' +
      '<div class="hint sc-tip"></div>';
    var dev = isIOS ? 'iPhone/iPad' : isAndroid ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '电脑/其他';
    if (isWeChat) dev += ' · 微信';
    root.querySelector('.sc-dev').textContent = dev;
    var ra = root.querySelector('.sc-ra'), rw = root.querySelector('.sc-rw'), tip = root.querySelector('.sc-tip');
    tip.textContent = isIOS ? 'iPhone 小提示：如果测试 1 有声、测试 2 没有声，几乎可以肯定是机身侧面的静音拨片——拨到响铃一侧即可。' : '如果两个都"在播放"但没有声音，请检查系统音量、耳机/蓝牙输出，以及浏览器标签页是否被静音。';
    root.querySelector('.sc-a').addEventListener('click', function () {
      ra.textContent = '请求播放…';
      clip(JSON.parse(JSON.stringify(CHIME)), {
        onState: function (s) { if (s === 'playing') ra.textContent = '已在播放 ✓'; },
        onEnd: function () { ra.textContent = '播放完成 ✓（听到了吗？）'; }
      });
      setTimeout(function () { if (/请求播放/.test(ra.textContent)) ra.textContent = '没有开始 ✗'; }, 2500);
    });
    root.querySelector('.sc-w').addEventListener('click', function () {
      var ctx = audioContext();
      if (!ctx) { rw.textContent = '浏览器不支持 ✗'; return; }
      var t0 = ctx.currentTime + 0.05;
      [440, 659.25].forEach(function (f, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + i * 0.3); g.gain.linearRampToValueAtTime(0.2, t0 + i * 0.3 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.3 + 0.5);
        o.connect(g); g.connect(ctx.destination); o.start(t0 + i * 0.3); o.stop(t0 + i * 0.3 + 0.55);
      });
      rw.textContent = '状态：' + ctx.state + (ctx.state === 'running' ? ' ✓（听到了吗？）' : ' ✗');
      setTimeout(function () { rw.textContent = '状态：' + ctx.state + (ctx.state === 'running' ? ' ✓' : ' ✗ 被浏览器挂起'); }, 700);
    });
  }

  function mountAll(root) {
    root = root || document;
    Array.prototype.forEach.call(root.querySelectorAll('.sample[data-piece]'), function (n) { mount(n); });
    Array.prototype.forEach.call(root.querySelectorAll('.sound-check'), function (n) { if (!n.__sc) { n.__sc = 1; mountCheck(n); } });
    if (pending.length) setTimeout(drainPending, 600);
  }

  window.MusicPlayer = { mountAll: mountAll, mount: mount, clip: clip, audioContext: audioContext, mountCheck: mountCheck, transport: T, env: { isIOS: isIOS, isWeChat: isWeChat, isAndroid: isAndroid, canWav: canWav } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mountAll(); });
  else mountAll();
})();
