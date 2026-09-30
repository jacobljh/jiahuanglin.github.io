/* dyncompat.js — can this trait become `dyn Trait`, and what goes in its table?
 * Used by the widget in lesson 13 and by tools/rust_verify/13_dyncompat.js, which compares every
 * verdict below with rustc 1.98.1 (edition 2024) on randomly generated traits.
 *
 * A trait is { name, sup: 'none'|'Sized'|'Clone'|'Debug', items: [item] }; an item is one of
 *   { kind: 'fn', name, recv: 'ref'|'mut'|'value'|'box'|'none', ret: 'unit'|'f64'|'self'|'impl'|'boxdyn',
 *     generic: bool, selfArg: bool, async: bool, sized: bool }     (sized = `where Self: Sized`;
 *                                                                  boxdyn = `-> Box<dyn ThisTrait>`)
 *   { kind: 'const', name }
 *   { kind: 'type', name, gat: bool }                               (gat = `type Item<'a> where Self: 'a`)
 *
 * API
 *   DynCompat.render(trait)          -> the trait as Rust source (one item per line)
 *   DynCompat.probe(trait, named)    -> `fn f(_: &dyn Shape<Out = f64>) {}` (named=false: bare `&dyn Shape`)
 *   DynCompat.analyze(trait, named)  -> { code: null|'E0038'|'E0191', reasons: [rustc's words],
 *                                         items: [{ name, verdict, why }], vtable: [slot names] | null }
 *   verdicts: 'slot' (dispatchable: gets a table entry), 'sized' (excluded by where Self: Sized),
 *             'value' (by-value self: allowed, but not callable through the pointer), 'breaks',
 *             'type' (an associated type: fixed by writing dyn Shape<Out = …>)
 *   DynCompat.describe(trait, k)     -> the verdict for the first k items, in words (the widget's readout)
 *   DynCompat.paint(ctx, W, H, trait, k, colors) -> draws pointer, table and items on any 2D context
 *   DynCompat.mount(document)        -> wires the lesson's widget (#w13); the only function that touches the DOM
 */
(function (root) {
  'use strict';
  var DC = {};

  var RECV = { ref: '&self', mut: '&mut self', value: 'self', box: 'self: Box<Self>', none: '' };
  var RET = { unit: '', f64: ' -> f64', self: ' -> Self', impl: ' -> impl Display' };

  function renderItem(it, tr) {
    if (it.kind === 'const') return 'const ' + it.name + ': u32;';
    if (it.kind === 'type') return it.gat ? 'type ' + it.name + "<'a> where Self: 'a;" : 'type ' + it.name + ';';
    var args = [];
    if (RECV[it.recv]) args.push(RECV[it.recv]);
    if (it.generic) args.push('t: T');
    if (it.selfArg) args.push('other: &Self');
    var ret = it.ret === 'boxdyn' ? ' -> Box<' + dynType(tr, true, 'Self::') + '>' : RET[it.ret];
    return (it.async ? 'async ' : '') + 'fn ' + it.name + (it.generic ? '<T>' : '') + '(' + args.join(', ') + ')' +
      ret + (it.sized ? ' where Self: Sized' : '') + ';';
  }
  function render(tr) {
    var sup = { none: '', Sized: ': Sized', Clone: ': Clone', Debug: ': Debug' }[tr.sup || 'none'];
    var body = tr.items.map(function (it) { return '    ' + renderItem(it, tr); });
    return 'trait ' + tr.name + sup + ' {' + (body.length ? '\n' + body.join('\n') + '\n' : ' ') + '}';
  }
  function assocTypes(tr) { return tr.items.filter(function (it) { return it.kind === 'type' && !it.gat; }); }
  function dynType(tr, named, inside) {         // inside: 'Self::' when written in the trait's own items
    var ts = assocTypes(tr);
    return 'dyn ' + tr.name + (named && ts.length ? '<' + ts.map(function (t) { return t.name + ' = ' + (inside ? inside + t.name : 'f64'); }).join(', ') + '>' : '');
  }
  function probe(tr, named) { return 'fn f(_: &' + dynType(tr, named) + ') {}'; }

  // What one method does to the table: the reasons rustc gives, in rustc's order.
  function methodReasons(it) {
    if (it.sized) return [];                                   // excluded: no table entry needed
    var n = '`' + it.name + '`';
    if (it.recv === 'none') return ['associated function ' + n + ' has no `self` parameter'];
    var r = [];
    if (it.selfArg) r.push('method ' + n + ' references the `Self` type in this parameter');
    if (it.ret === 'self' && !it.async) r.push('method ' + n + ' references the `Self` type in its return type');
    if (it.async) r.push('method ' + n + ' is `async`');
    if (it.ret === 'impl' && !it.async) r.push('method ' + n + ' references an `impl Trait` type in its return type');
    if (it.generic) r.push('method ' + n + ' has generic type parameters');
    return r;
  }

  function analyze(tr, named) {
    var items = tr.items.map(function (it) {
      if (it.kind === 'const') return { name: it.name, verdict: 'breaks', why: ['it contains associated const `' + it.name + '`'] };
      if (it.kind === 'type') return it.gat ? { name: it.name, verdict: 'breaks', why: ['it contains generic associated type `' + it.name + '`'] }
                                            : { name: it.name, verdict: 'type', why: [] };
      var r = methodReasons(it);
      if (r.length) return { name: it.name, verdict: 'breaks', why: r };
      if (it.sized) return { name: it.name, verdict: 'sized', why: [] };
      if (it.recv === 'value') return { name: it.name, verdict: 'value', why: [] };
      return { name: it.name, verdict: 'slot', why: [] };
    });
    // rustc's order of checks (observed): a Sized requirement first (reported alone), then the first
    // generic associated type (reported alone), then unnamed associated types (E0191), then all the rest.
    var sizedSelf = tr.sup === 'Sized' || tr.sup === 'Clone';
    var code = null, reasons = [];
    if (sizedSelf) { code = 'E0038'; reasons = ['it requires `Self: Sized`']; }
    else {
      var gats = tr.items.filter(function (it) { return it.kind === 'type' && it.gat; });
      if (gats.length) { code = 'E0038'; reasons = ['it contains generic associated type `' + gats[0].name + '`']; }
      else if (!named && assocTypes(tr).length) code = 'E0191';
      else {
        tr.items.forEach(function (it, i) { if (it.kind !== 'type') reasons = reasons.concat(items[i].why); });
        if (reasons.length) code = 'E0038';
      }
    }
    var vtable = null;
    if (code !== 'E0038') {
      vtable = ['drop_in_place', 'size', 'align'];
      if (tr.sup === 'Debug') vtable.push('Debug::fmt');
      items.forEach(function (x) { if (x.verdict === 'slot') vtable.push(x.name); });
    }
    return { code: code, reasons: reasons, items: items, vtable: vtable, sizedSelf: sizedSelf };
  }

  /* ── For the lesson's widget: the verdict in words, and a picture of it. Both are pure functions of
   *    (trait, number of items declared): `describe` returns text, `paint` draws on any 2D context. ── */
  var WORD = { slot: 'in the table', sized: 'left out (where Self: Sized): concrete types only',
               value: 'allowed, but a call through the pointer is E0161', breaks: 'breaks the trait',
               type: 'named by the type: dyn Shape<… = f64>' };
  var MARK = { slot: '✓', sized: '○', value: '○', breaks: '✗', type: '=' };
  function declared(tr, k) { return { name: tr.name, sup: tr.sup, items: tr.items.slice(0, k) }; }
  function describe(full, k) {
    var tr = declared(full, k), a = analyze(tr, true), bare = analyze(tr, false);
    var lines = [render(tr), probe(tr, true).replace('fn f', 'fn draw'), ''];
    tr.items.forEach(function (it, j) {
      var v = a.items[j]; lines.push((v.name + '          ').slice(0, 10) + ' ' + WORD[v.verdict] + (v.why.length ? ': ' + v.why.join('; ') : ''));
    });
    if (a.code === 'E0038') {
      lines.push('', 'error[E0038]: the trait `' + tr.name + '` is not dyn compatible');
      a.reasons.forEach(function (x) { lines.push('  ...because ' + x); });
      if (a.sizedSelf) lines.push('(while the trait requires Sized, rustc reports nothing else: set the supertrait to none)');
      var own = tr.items.filter(function (it) { return it.kind === 'fn' && it.ret === 'boxdyn'; }).map(function (it) { return '`' + it.name + '`'; });
      if (own.length) lines.push('(rustc repeats this error at ' + own.join(', ') + ': a return type that names dyn ' + tr.name + ' is a use of it too)');
    } else {
      lines.push('', 'accepted: each implementing type gets a table (contents, not layout) of ' + a.vtable.length + ' entries: ' + a.vtable.join(', ') + '.');
      if (bare.code === 'E0191') lines.push('(a bare `&dyn ' + tr.name + '` is E0191: the type must name every associated type)');
    }
    var c = { slot: 0, out: 0, breaks: 0 };
    a.items.forEach(function (v) { if (v.verdict === 'slot') c.slot++; else if (v.verdict === 'breaks') c.breaks++; else if (v.verdict !== 'type') c.out++; });
    return { a: a, text: lines.join('\n'), counts: c };
  }
  function paint(ctx, W, H, full, k, C) {
    var tr = declared(full, k), a = analyze(tr, true), n = full.items.length;
    function fit(s, w) { if (ctx.measureText(s).width <= w) return s; while (s.length > 2 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; }
    function T(s, x, y, col, w) { ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.fillText(w ? fit(s, w) : s, x, y); }
    function arrow(xa, ya, xb, yb, col) {
      var g = Math.atan2(yb - ya, xb - xa);
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xb, yb); ctx.lineTo(xb - 7 * Math.cos(g - 0.45), yb - 7 * Math.sin(g - 0.45));
      ctx.lineTo(xb - 7 * Math.cos(g + 0.45), yb - 7 * Math.sin(g + 0.45)); ctx.closePath(); ctx.fill();
    }
    ctx.clearRect(0, 0, W, H);
    ctx.font = (W < 520 ? 10 : 11) + 'px ' + C.mono; ctx.textBaseline = 'middle'; ctx.lineWidth = 1.5;
    var pw = Math.max(80, Math.min(128, W * 0.2)), x1 = 10 + pw + 22, tw = Math.max(92, Math.min(176, W * 0.27));
    var x2 = x1 + tw + 16, iw = W - x2 - 6;
    // (1) the fat pointer, and the value it no longer names
    T('&dyn ' + tr.name, 10, 12, C.mute);
    ctx.strokeStyle = C.shared; ctx.strokeRect(10, 24, pw, 26); T('data   ●', 16, 37, C.shared, pw - 8);
    ctx.strokeStyle = C.live; ctx.strokeRect(10, 52, pw, 26); T('vtable ●', 16, 65, C.live, pw - 8);
    ctx.strokeStyle = C.border; ctx.strokeRect(10, 120, pw, 54);
    T('some ' + tr.name, 16, 136, C.text, pw - 10); T('(type erased)', 16, 157, C.dim, pw - 10);
    arrow(10 + pw - 14, 37, 10 + pw * 0.5, 119, C.shared);
    arrow(10 + pw - 14, 65, x1 - 3, 36, C.live);
    // (2) the table each implementing type would get (contents, not layout: the order is not specified)
    var rows = a.vtable || ['drop_in_place', 'size', 'align'], rh = Math.min(24, (H - 64) / Math.max(rows.length, 7));
    T(a.vtable ? 'vtable, one per type' : 'no vtable: E0038', x1, 12, a.vtable ? C.live : C.err, tw);
    rows.forEach(function (name, i) {
      var y = 24 + i * rh;
      ctx.strokeStyle = !a.vtable ? C.err : i < 3 ? C.border : C.good; ctx.setLineDash(a.vtable ? [] : [4, 3]);
      ctx.strokeRect(x1, y, tw, rh - 3); ctx.setLineDash([]);
      T(name, x1 + 6, y + (rh - 3) / 2, !a.vtable ? C.dim : i < 3 ? C.mute : C.text, tw - 10);
    });
    var yf = 24 + rows.length * rh + 8;
    if (a.vtable) T('grey: to drop and free it', x1, yf, C.dim, tw);
    if (a.vtable && yf + 14 < H - 26) T('(no order is specified)', x1, yf + 14, C.dim, tw);
    // (3) the trait's items and their verdicts
    T('trait ' + tr.name + (tr.sup !== 'none' ? ': ' + tr.sup : ''), x2, 12, C.mute, iw);
    var ih = Math.min(36, (H - 64) / Math.max(n, 4));
    full.items.forEach(function (it, j) {
      var y = 24 + j * ih, on = j < k, v = on ? a.items[j] : null;
      var col = !on ? C.dim : v.verdict === 'slot' ? C.good : v.verdict === 'breaks' ? C.err : v.verdict === 'type' ? C.shared : C.excl;
      T(on ? MARK[v.verdict] : '·', x2, y + 8, col);
      T(renderItem(it, tr).replace(/;$/, ''), x2 + 13, y + 8, on ? C.text : C.dim, iw - 14);
      T(!on ? 'not declared yet' : v.why.length ? v.why[0] : WORD[v.verdict], x2 + 13, y + 22, col, iw - 14);
      if (on && v.verdict === 'slot' && a.vtable) {
        var row = a.vtable.indexOf(it.name);
        ctx.strokeStyle = C.good; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath();
        ctx.moveTo(x2 - 3, y + 8); ctx.lineTo(x1 + tw + 2, 24 + row * rh + (rh - 3) / 2); ctx.stroke(); ctx.setLineDash([]);
      }
    });
    var bad = a.code === 'E0038';
    T(bad ? 'rustc: error[E0038], ' + a.reasons.length + (a.reasons.length === 1 ? ' reason' : ' reasons')
          : 'rustc: accepted, ' + a.vtable.length + ' table entries', 10, H - 12, bad ? C.err : C.good, W - 20);
  }

  /* ── Browser glue for lesson 13's widget (#w13). The only code here that touches the DOM; Node never calls it. ── */
  function F(name, recv, ret, o) { o = o || {}; return { kind: 'fn', name: name, recv: recv, ret: ret, generic: !!o.g, selfArg: !!o.s, async: !!o.a, sized: !!o.z }; }
  function A() { return F('area', 'ref', 'f64'); }
  var PRESETS = [                                                          // the lesson's worked examples
    ['none', [A(), F('grow', 'mut', 'unit'), F('clone_box', 'ref', 'boxdyn')]],   // 0 the running trait
    ['none', [A(), F('dup', 'ref', 'self')]],                                     // 1 §3's E0038
    ['none', [A(), F('dup', 'ref', 'self', { z: 1 })]],                           // 2 the escape hatch
    ['none', [A(), F('scale', 'mut', 'unit', { g: 1 })]],                         // 3 a generic method
    ['none', [A(), F('overlap', 'ref', 'f64', { s: 1 })]],                        // 4 Self in a parameter
    ['Clone', [A(), F('dup', 'ref', 'self'), F('scale', 'mut', 'unit', { g: 1 })]], // 5 rustc stops at Sized
    ['none', [F('new', 'none', 'self'), A()]],                                    // 6 no receiver
    ['none', [{ kind: 'const', name: 'SIDES' }, A()]],                            // 7 an associated const
    ['none', [{ kind: 'type', name: 'Out', gat: false }, A()]],                   // 8 an associated type
    ['none', [F('load', 'ref', 'f64', { a: 1 }), F('label', 'ref', 'impl')]],     // 9 async, impl Trait
    ['none', [A(), F('consume', 'value', 'f64'), F('boxed', 'box', 'f64')]],      // 10 self vs Box<Self>
    ['Debug', [A(), F('grow', 'mut', 'unit')]]                                    // 11 a supertrait's entry
  ];
  function mount(doc) {
    var $ = function (id) { return doc.getElementById(id); }, cv = $('w13-canvas');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    function cssv(n, fb) { try { var v = root.getComputedStyle(doc.documentElement).getPropertyValue(n); return (v && v.trim()) || fb; } catch (e) { return fb; } }
    var C = { good: cssv('--good', '#16a34a'), err: cssv('--err', '#dc2626'), excl: cssv('--excl', '#d97706'), shared: cssv('--shared', '#2563eb'),
              live: cssv('--live', '#7c3aed'), mute: cssv('--text-mute', '#5b6573'), dim: cssv('--text-dim', '#94a3b8'),
              text: cssv('--text', '#1f2430'), border: cssv('--border', '#dde2ea'), mono: cssv('--mono', 'monospace') };
    var st = { name: 'Shape', sup: 'none', items: [], k: 0 };
    function load(i) {
      var p = PRESETS[i] || PRESETS[0];
      st.sup = p[0]; st.items = p[1].map(function (x) { var y = {}; for (var q in x) y[q] = x[q]; return y; });
      st.k = st.items.length; $('w13-sup').value = st.sup; sync();
    }
    function sync() { var s = $('w13-k'); s.max = String(st.items.length); s.value = String(st.k); draw(); }
    function uniq(b) { var name = b, n = 2; while (st.items.some(function (x) { return x.name === name; })) name = b + n++; return name; }
    function autoName(it) {
      return uniq(it.recv === 'none' ? (it.ret === 'self' ? 'new' : 'make') : it.async ? 'load' : it.ret === 'impl' ? 'label' :
        it.ret === 'self' ? 'dup' : it.ret === 'boxdyn' ? 'clone_box' : it.generic ? 'scale' : it.selfArg ? 'overlap' :
        it.recv === 'value' ? 'consume' : it.recv === 'box' ? 'boxed' : it.recv === 'mut' ? 'grow' : 'area');
    }
    function push(it) { st.items = st.items.slice(0, st.k); st.items.push(it); st.k = st.items.length; sync(); }
    function draw() {
      var k = Math.max(0, Math.min(st.items.length, st.k)), dpr = root.devicePixelRatio || 1, r = cv.getBoundingClientRect();
      var W = Math.max(320, r.width), H = Math.max(300, r.height);
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx, W, H, st, k, C);                                          // the picture
      var d = describe(st, k), bad = d.a.code === 'E0038';                 // the same result, in words
      $('w13-k1').textContent = bad ? 'E0038' : 'dyn compatible';
      $('w13-k2').textContent = d.a.vtable ? String(d.a.vtable.length) : '—';
      $('w13-k3').textContent = d.counts.slot + ' / ' + d.counts.out + ' / ' + d.counts.breaks;
      $('w13-k4').textContent = String(d.a.reasons.length);
      $('w13-k-v').textContent = k + ' / ' + st.items.length;
      var rd = $('w13-read'); rd.textContent = d.text; rd.className = 'readout ' + (bad ? 'err' : 'ok');
    }
    $('w13-k').addEventListener('input', function () { st.k = +$('w13-k').value; draw(); });
    $('w13-preset').addEventListener('change', function () { load(+$('w13-preset').value); });
    $('w13-sup').addEventListener('change', function () { st.sup = $('w13-sup').value; draw(); });
    $('w13-add').addEventListener('click', function () {
      var it = F('', $('w13-recv').value, $('w13-ret').value, { g: $('w13-gen').checked, s: $('w13-sarg').checked, a: $('w13-async').checked, z: $('w13-sized').checked });
      it.name = autoName(it); push(it);
    });
    $('w13-const').addEventListener('click', function () { push({ kind: 'const', name: uniq('SIDES') }); });
    $('w13-type').addEventListener('click', function () { push({ kind: 'type', name: uniq('Out'), gat: false }); });
    $('w13-pop').addEventListener('click', function () { st.items = st.items.slice(0, Math.max(0, st.k - 1)); st.k = st.items.length; sync(); });
    if (root.addEventListener) root.addEventListener('resize', draw);
    load(0);
  }

  DC.render = render; DC.renderItem = renderItem; DC.probe = probe; DC.dynType = dynType; DC.analyze = analyze;
  DC.describe = describe; DC.paint = paint; DC.mount = mount; DC.PRESETS = PRESETS;
  root.DynCompat = DC;
  if (typeof module !== 'undefined' && module.exports) module.exports = DC;
})(typeof window !== 'undefined' ? window : this);
