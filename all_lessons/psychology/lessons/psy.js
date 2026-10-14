/* psy.js — shared helpers for 《心理学》 and 《从零学会用脑》.
   1. 押注 (prediction-first bets):  <div class="bet" id="wNN-bet" data-id="NNa" data-lesson="N" data-kind="num|pick" …>
        num : data-min data-max data-step data-unit data-truth [data-start] [data-tol]   → slider, 命中 if |guess−truth| ≤ tol (default 10% of range)
        pick: data-options="A|B|C" data-truth="<index>"                                  → one button per option
      The element must contain <div class="bet-q">…</div> and <div class="bet-reveal">…</div>; the reveal stays hidden until the reader locks a guess.
      Locked bets are saved (localStorage, try/catch, in-memory fallback) as self-contained records
      {id, lesson, label, kind, guess, truth, unit, min, max, tol, ok, opts}; lesson 19 replays them as a calibration scoreboard.
   2. widget helpers: PSY.rng(seed) (seeded, deterministic), PSY.gauss(rng), PSY.fit(canvas, cssHeight) (DPR-aware), PSY.phi / PSY.probit, PSY.mean/sd/corr, PSY.C (canvas colours).
   No Math.random / Date anywhere (house rule: widgets are deterministic). */
(function (root) {
  'use strict';
  var KEY = 'psy.bets.v1';
  var mem = {};

  function readAll() {
    try {
      var s = root.localStorage.getItem(KEY);
      var o = s ? JSON.parse(s) : {};
      if (o && typeof o === 'object') { mem = o; return o; }
    } catch (e) { /* storage blocked or empty: fall back */ }
    return mem;
  }
  function writeAll(o) {
    mem = o;
    try { root.localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* in-memory only */ }
  }

  var PSY = root.PSY = root.PSY || {};

  /* ───────── records ───────── */
  PSY.rec = function (id) { var o = readAll(); return o[id] || null; };
  PSY.all = function () {
    var o = readAll(), out = [], k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out.push(o[k]);
    out.sort(function (a, b) { return a.lesson === b.lesson ? (a.id < b.id ? -1 : 1) : a.lesson - b.lesson; });
    return out;
  };
  PSY.save = function (r) { var o = readAll(); o[r.id] = r; writeAll(o); };
  PSY.clear = function () { writeAll({}); };

  /* ───────── numbers ───────── */
  function decimals(step) { var s = String(step), i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  PSY.fmt = function (v, step, unit) { return (Math.abs(v) >= 1e5 ? Math.round(v).toLocaleString('en-US') : Number(v).toFixed(decimals(step || 1))) + (unit || ''); };
  PSY.rng = function (seed) {                      // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  PSY.gauss = function (r) { var u = r() || 1e-12, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  function erf(x) {                                // Abramowitz–Stegun 7.1.26, |error| < 1.5e-7
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  PSY.phi = function (z) { return 0.5 * (1 + erf(z / Math.SQRT2)); };
  PSY.probit = function (p) {                      // inverse normal CDF by bisection
    if (p <= 0) return -8; if (p >= 1) return 8;
    var lo = -8, hi = 8, i;
    for (i = 0; i < 60; i++) { var m = (lo + hi) / 2; if (PSY.phi(m) < p) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  PSY.mean = function (a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; };
  PSY.sd = function (a) { var m = PSY.mean(a), s = 0, i; for (i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return a.length > 1 ? Math.sqrt(s / (a.length - 1)) : 0; };
  PSY.corr = function (x, y) {
    var mx = PSY.mean(x), my = PSY.mean(y), sxy = 0, sxx = 0, syy = 0, i;
    for (i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); syy += (y[i] - my) * (y[i] - my); }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  };
  PSY.C = { bg: '#f7f8fa', ink: '#1f2430', mute: '#5b6573', dim: '#94a3b8', grid: '#dde2ea', accent: '#2563eb', amber: '#d97706', ok: '#16a34a', bad: '#dc2626', soft: '#eef2ff' };

  /* ───────── canvas ───────── */
  PSY.fit = function (cv, cssH) {
    var dpr = Math.min(root.devicePixelRatio || 1, 3);
    var w = cv.clientWidth || (cv.parentNode && cv.parentNode.clientWidth) || 680;
    var h = cssH || cv.clientHeight || 300;
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h, dpr: dpr };
  };

  /* ───────── bets ───────── */
  function el(tag, cls, text) {
    var e = root.document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function show(e, on) { e.style.display = on ? '' : 'none'; }
  function num(box, k, d) { var v = parseFloat(box.getAttribute(k)); return isNaN(v) ? d : v; }

  function initBet(box) {
    if (box._psy) return;
    box._psy = true;
    var id = box.getAttribute('data-id') || '';
    var kind = box.getAttribute('data-kind') || 'num';
    var lesson = parseInt(box.getAttribute('data-lesson'), 10);
    if (isNaN(lesson)) lesson = parseInt(String(id).replace(/\D/g, '').slice(0, 2), 10) || 0;
    var q = box.querySelector('.bet-q');
    var reveal = box.querySelector('.bet-reveal');
    var label = box.getAttribute('data-label') || (q ? String(q.textContent || '') : '').slice(0, 60);
    var truth = num(box, 'data-truth', 0);
    var row = el('div', 'bet-in');
    var board = el('div', 'bet-score');
    var done = false;

    function lockNum(guess, min, max, step, unit, tol, restored) {
      var err = Math.abs(guess - truth);
      var ok = err <= tol + 1e-9;
      var r = { id: id, lesson: lesson, label: label, kind: 'num', guess: guess, truth: truth, unit: unit, min: min, max: max, tol: tol, ok: ok };
      if (!restored) PSY.save(r);
      board.textContent = '你押 ' + PSY.fmt(guess, step, unit) + ' · 真实值 ' + PSY.fmt(truth, step, unit) + ' · 差 ' + PSY.fmt(err, step, unit) + (ok ? ' · 命中（容差 ±' + PSY.fmt(tol, step, unit) + '）' : ' · 没命中（容差 ±' + PSY.fmt(tol, step, unit) + '）');
    }
    function lockPick(i, opts, restored) {
      var ok = i === truth;
      var r = { id: id, lesson: lesson, label: label, kind: 'pick', guess: i, truth: truth, opts: opts, ok: ok };
      if (!restored) PSY.save(r);
      board.textContent = '你选了「' + opts[i] + '」 · 正确答案：「' + opts[truth] + '」 · ' + (ok ? '押中了' : '没押中');
    }
    function finish() {
      done = true;
      box.classList.add('locked');
      if (reveal) { show(reveal, true); reveal.insertBefore(board, reveal.firstChild || null); }
    }

    if (reveal) show(reveal, false);

    if (kind === 'pick') {
      var opts = String(box.getAttribute('data-options') || '').split('|');
      var holder = el('div', 'bet-opts');
      var btns = [];
      var prev = PSY.rec(id);
      opts.forEach(function (o, i) {
        var b = el('button', '', o);
        b.addEventListener('click', function () {
          if (done) return;
          lockPick(i, opts, false);
          mark(i);
          finish();
        });
        btns.push(b); holder.appendChild(b);
      });
      var mark = function (i) {
        btns.forEach(function (b, j) { b.disabled = true; if (j === i) b.classList.add('picked'); if (j === truth) b.classList.add('right'); else if (j === i) b.classList.add('wrong'); });
      };
      row.appendChild(holder);
      if (reveal) box.insertBefore(row, reveal); else box.appendChild(row);
      if (prev && prev.kind === 'pick' && prev.guess >= 0 && prev.guess < opts.length) { lockPick(prev.guess, opts, true); mark(prev.guess); finish(); }
      return;
    }

    /* kind === 'num' */
    var min = num(box, 'data-min', 0), max = num(box, 'data-max', 100), step = num(box, 'data-step', 1);
    var unit = box.getAttribute('data-unit') || '';
    var tol = num(box, 'data-tol', (max - min) * 0.1);
    var start = num(box, 'data-start', (min + max) / 2);
    var inp = el('input');
    inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(start);
    var val = el('span', 'bet-val', PSY.fmt(start, step, unit));
    var go = el('button', 'primary', '锁定我的猜测');
    inp.addEventListener('input', function () { val.textContent = PSY.fmt(parseFloat(inp.value), step, unit); });
    go.addEventListener('click', function () {
      if (done) return;
      var g = parseFloat(inp.value);
      if (isNaN(g)) g = start;
      lockNum(g, min, max, step, unit, tol, false);
      inp.disabled = true; go.disabled = true;
      finish();
    });
    row.appendChild(inp); row.appendChild(val); row.appendChild(go);
    if (reveal) box.insertBefore(row, reveal); else box.appendChild(row);
    var p = PSY.rec(id);
    if (p && p.kind === 'num') {
      inp.value = String(p.guess); val.textContent = PSY.fmt(p.guess, step, unit);
      lockNum(p.guess, min, max, step, unit, tol, true);
      inp.disabled = true; go.disabled = true;
      finish();
    }
  }

  var GRADE = { a: 'A 稳健：多个独立团队、足够样本或大型重复/元分析一致', b: 'B 成立但有限定：方向可靠，大小或边界条件有争议', c: 'C 有争议：重复结果不一或证据单薄', d: 'D 站不住：大型/预注册重复失败，或已被撤回、大幅修正' };
  PSY.init = function () {
    var boxes = root.document.querySelectorAll('.bet');
    var i;
    for (i = 0; i < boxes.length; i++) initBet(boxes[i]);
    var evs = root.document.querySelectorAll('.ev');           // tooltips for the evidence badges
    for (i = 0; i < evs.length; i++) {
      var m = /ev-([abcd])/.exec(String(evs[i].className || ''));
      if (m && !evs[i].getAttribute('title')) { evs[i].setAttribute('title', GRADE[m[1]]); evs[i].setAttribute('aria-label', GRADE[m[1]]); }
    }
  };

  var doc = root.document;
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', PSY.init);
    else PSY.init();
  }
})(typeof window !== 'undefined' ? window : this);
