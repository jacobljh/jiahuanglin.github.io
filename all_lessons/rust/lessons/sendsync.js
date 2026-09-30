/* sendsync.js — Lesson 16's layer over traitsolver.js (which it uses unchanged).
 *
 * traitsolver.js answers "does T implement Send / Sync?" by proof search.  This file adds what the
 * lesson's widget needs on top of it:
 *   1. a span-keeping type parser (same grammar, plus `dyn Fn(A) -> R` sugar and lifetimes);
 *   2. a struct-list parser (`struct S<T> { a: T }`, `unsafe impl Send for S {}`);
 *   3. the closure rule: what a thread closure must prove for each capture
 *        by value -> T: Send     by &  -> &T: Send (= T: Sync)     by &mut -> &mut T: Send (= T: Send)
 *      plus thread::spawn's 'static (E0373 for a borrowed capture, E0521 for a borrowed type);
 *   4. a repair loop that applies one local type change per failing leaf (Rc -> Arc, Cell -> atomic or
 *      Mutex, + Send on a trait object, ...) and re-checks;
 *   5. display helpers (describe, paint) so the page's inline script only wires controls.
 * Differential-tested against rustc 1.98.1 by tools/rust_verify/16_spawn.js.
 *
 * API:
 *   SendSync.check(prog, structsText)  prog = { kind: 'send'|'sync'|'spawn'|'scope', move: bool,
 *                                                caps: [{ name, type, mode: 'val'|'ref'|'mut' }] }
 *        -> { ok, codes, leaves:[{type,trait,why}], borrowed, nonStatic, tree, trusted, errors }
 *   SendSync.repair(prog, structsText) -> { steps:[{label, from, to, where}], prog, structs, result, stop }
 *   SendSync.parseType(text), SendSync.parseStructs(text), SendSync.show(ast), SendSync.render(tree)
 */
(function (root, TS) {
  'use strict';
  var SS = {};
  var GUARDS = ['MutexGuard', 'RwLockReadGuard', 'RwLockWriteGuard'];
  var ATOMIC = { i8: 'AtomicI8', i16: 'AtomicI16', i32: 'AtomicI32', i64: 'AtomicI64', isize: 'AtomicIsize',
    u8: 'AtomicU8', u16: 'AtomicU16', u32: 'AtomicU32', u64: 'AtomicU64', usize: 'AtomicUsize', bool: 'AtomicBool' };

  /* ───────────── 1. types, with source spans ───────────── */
  function tokenize(s) {
    var toks = [], i = 0, m, re = /\s*(->|::|[<>(),;&*\[\]+{}:=!#]|'[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*|[0-9]+)/y;
    while (i < s.length) {
      re.lastIndex = i; m = re.exec(s);
      if (!m) { if (/^\s*$/.test(s.slice(i))) break; throw new Error('unexpected character: ' + s.slice(i, i + 8)); }
      toks.push({ t: m[1], s: re.lastIndex - m[1].length, e: re.lastIndex }); i = re.lastIndex;
    }
    return toks;
  }
  function joinToks(ts) {            // canonical text of a bound such as Fn(i32, u8) -> Vec<i32>
    var out = '';
    ts.forEach(function (k, i) {
      var t = k.t, prev = i ? ts[i - 1].t : '';
      if (t === '->') out += ' -> ';
      else { if (prev === ',' || prev === 'mut' || prev === 'dyn' || (prev[0] === "'" && t !== ',' && t !== '>')) out += ' '; out += t; }
    });
    return out.replace(/\s+/g, ' ').trim();
  }
  // parse one type starting at toks[p]; returns [ast, nextP].  AST shape = traitsolver's, plus spans.
  function ty(T, p) {
    var x = T[p] && T[p].t, s = T[p] ? T[p].s : 0, r, q;
    function fin(a, np) { a.s = s; a.e = T[np - 1].e; return [a, np]; }
    if (x === '&') {
      q = p + 1; var lt = null, mut = false;
      if (T[q] && T[q].t[0] === "'") { lt = T[q].t; q++; }
      if (T[q] && T[q].t === 'mut') { mut = true; q++; }
      r = ty(T, q); return fin({ k: 'ref', mut: mut, lt: lt, to: r[0] }, r[1]);
    }
    if (x === '*') {
      q = p + 1; var m2 = T[q] && T[q].t === 'mut';
      if (!T[q] || (T[q].t !== 'mut' && T[q].t !== 'const')) throw new Error('write *const T or *mut T');
      r = ty(T, q + 1); return fin({ k: 'ptr', mut: m2, to: r[0] }, r[1]);
    }
    if (x === '(') { r = list(T, p + 1, ')'); return fin({ k: 'tuple', items: r[0] }, r[1] + 1); }
    if (x === '[') {
      r = ty(T, p + 1); q = r[1];
      if (T[q] && T[q].t === ';') { var n = T[q + 1].t; if (!T[q + 2] || T[q + 2].t !== ']') throw new Error('expected ]'); return fin({ k: 'array', elem: r[0], n: n }, q + 3); }
      if (!T[q] || T[q].t !== ']') throw new Error('expected ]'); return fin({ k: 'slice', elem: r[0] }, q + 1);
    }
    if (x === 'fn') {
      if (!T[p + 1] || T[p + 1].t !== '(') throw new Error('expected ( after fn');
      r = list(T, p + 2, ')'); q = r[1] + 1; var ret = null;
      if (T[q] && T[q].t === '->') { var rr = ty(T, q + 1); ret = rr[0]; q = rr[1]; }
      return fin({ k: 'fn', params: r[0], ret: ret }, q);
    }
    if (x === 'dyn') {
      var bounds = [], spans = []; q = p + 1;
      for (;;) {
        var b0 = q; if (!T[q]) throw new Error('expected a trait after dyn');
        if (T[q].t[0] !== "'") {
          q++; while (T[q] && T[q].t === '::') q += 2;
          if (T[q] && T[q].t === '(') {                       // Fn(A, B) -> R  sugar
            var fr = list(T, q + 1, ')'); q = fr[1] + 1;
            if (T[q] && T[q].t === '->') q = ty(T, q + 1)[1];
          } else if (T[q] && T[q].t === '<') { q = list(T, q + 1, '>')[1] + 1; }
        } else q++;
        bounds.push(joinToks(T.slice(b0, q)).replace(/^(?:[a-z_]+::)+/, '')); spans.push([T[b0].s, T[q - 1].e]);
        if (T[q] && T[q].t === '+') { q++; continue; }
        break;
      }
      var d = fin({ k: 'dyn', bounds: bounds }, q); d[0].bspans = spans; return d;
    }
    if (x && /^[A-Za-z_]/.test(x)) {
      var segs = [T[p].t]; q = p + 1;
      while (T[q] && T[q].t === '::') { segs.push(T[q + 1].t); q += 2; }
      var name = segs[segs.length - 1], he = T[q - 1].e;
      if (name === 'Weak') name = segs[segs.length - 2] === 'sync' ? 'sync::Weak' : 'rc::Weak';
      var args = [], lts = [];
      if (T[q] && T[q].t === '<') {
        q++;
        while (T[q] && T[q].t !== '>') {
          if (T[q].t[0] === "'") { lts.push(T[q].t); q++; }
          else { var ar = ty(T, q); args.push(ar[0]); q = ar[1]; }
          if (T[q] && T[q].t === ',') q++; else break;
        }
        if (!T[q] || T[q].t !== '>') throw new Error('expected > in ' + name);
        q++;
      }
      var a = fin({ k: 'path', name: name, args: args, lts: lts }, q); a[0].hs = s; a[0].he = he; return a;
    }
    throw new Error('cannot parse a type near ' + (x || 'the end'));
  }
  function list(T, p, close) {
    var out = [];
    while (T[p] && T[p].t !== close) { var r = ty(T, p); out.push(r[0]); p = r[1]; if (T[p] && T[p].t === ',') p++; else break; }
    if (!T[p] || T[p].t !== close) throw new Error('expected ' + close);
    return [out, p];
  }
  function parseType(text) {
    var T = tokenize(text); if (!T.length) throw new Error('empty type');
    var r = ty(T, 0);
    if (r[1] < T.length) throw new Error('unexpected ' + T[r[1]].t + ' after the type');
    return r[0];
  }
  function show(a) { return TS.show(a); }
  // does the type mention a lifetime other than 'static?  (fn-pointer params are higher-ranked: skipped;
  // under &'static X or Guard<'static, X> everything in X is forced to be 'static by the implied bound)
  function borrows(a) {
    switch (a.k) {
      case 'ref': return a.lt !== "'static";
      case 'ptr': return borrows(a.to);
      case 'path':
        if (a.lts.some(function (l) { return l !== "'static"; })) return true;
        if (GUARDS.indexOf(a.name) >= 0) return !a.lts.length;
        return a.args.some(borrows);
      case 'tuple': return a.items.some(borrows);
      case 'array': case 'slice': return borrows(a.elem);
      case 'dyn': return a.bounds.some(function (b) { return b[0] === "'" && b !== "'static"; });
    }
    return false;
  }
  // pre-order list of nodes (with their parent path) inside one type
  function nodes(a, out) {
    out = out || []; out.push(a);
    if (a.k === 'path') a.args.forEach(function (x) { nodes(x, out); });
    else if (a.k === 'ref' || a.k === 'ptr') nodes(a.to, out);
    else if (a.k === 'tuple') a.items.forEach(function (x) { nodes(x, out); });
    else if (a.k === 'array' || a.k === 'slice') nodes(a.elem, out);
    else if (a.k === 'fn') { a.params.forEach(function (x) { nodes(x, out); }); if (a.ret) nodes(a.ret, out); }
    return out;
  }

  /* ───────────── 2. the struct list ───────────── */
  // traitsolver parses struct fields itself and cannot read Fn(..) sugar, so a bound such as
  // `Fn(i32) -> i32` is handed to it as one alias token and translated back when goals are shown.
  var ALIAS = {}, UNALIAS = {}, nAlias = 0;
  function aliasOf(b) { if (!ALIAS[b]) { ALIAS[b] = 'FnSugar' + (++nAlias) + 'x'; UNALIAS[ALIAS[b]] = b; } return ALIAS[b]; }
  function unalias(s) { return s.replace(/FnSugar\d+x/g, function (m) { return UNALIAS[m] || m; }); }
  function forTS(text) {             // struct-field text -> text traitsolver can parse
    var a = parseType(text), cuts = [];
    nodes(a).forEach(function (n) { if (n.k === 'dyn') n.bounds.forEach(function (b, i) { if (/\(/.test(b)) cuts.push([n.bspans[i][0], n.bspans[i][1], aliasOf(b)]); }); });
    cuts.sort(function (x, y) { return y[0] - x[0]; });
    cuts.forEach(function (c) { text = text.slice(0, c[0]) + c[2] + text.slice(c[1]); });
    return text;
  }
  function parseStructs(text) {
    var src = String(text || '').replace(/\/\/[^\n]*/g, ' '), T, out = { order: [], defs: {}, errors: [] };
    try { T = tokenize(src); } catch (e) { out.errors.push(e.message); return out; }
    var p = 0, derives = [];
    function err(m) { out.errors.push(m); }
    while (p < T.length) {
      var t = T[p].t;
      if (t === '#') {                                                  // #[derive(Clone, Copy)]
        var a0 = p; while (p < T.length && T[p].t !== ']') p++;
        var at = T.slice(a0, p).map(function (k) { return k.t; });
        if (at.indexOf('derive') >= 0) derives = derives.concat(at.filter(function (k) { return /^[A-Z]/.test(k); }));
        p++; continue;
      }
      if (t === 'pub') { p++; continue; }
      if (t === 'struct') {
        var name = T[p + 1] && T[p + 1].t, params = [], fields = [], q = p + 2;
        if (!name || !/^[A-Z]/.test(name)) { err('a struct needs a capitalised name'); break; }
        if (T[q] && T[q].t === '<') {
          q++;
          while (T[q] && T[q].t !== '>') {
            if (T[q].t[0] === "'") err('struct ' + name + ': lifetime parameters are not modeled here — use &\'static fields');
            else params.push(T[q].t);
            q++; if (T[q] && T[q].t === ':') { while (T[q] && T[q].t !== ',' && T[q].t !== '>') q++; }
            if (T[q] && T[q].t === ',') q++;
          }
          q++;
        }
        var open = T[q] && T[q].t, close = open === '{' ? '}' : open === '(' ? ')' : null;
        if (!close) {
          if (open === ';') { out.order.push(name); out.defs[name] = { params: params, fields: [], names: [], unsafeImpls: {}, derives: derives, unit: true }; derives = []; p = q + 1; continue; }
          err('struct ' + name + ': expected { or ('); break;
        }
        var depth = 0, cur = [], names = [];
        for (q = q + 1; q < T.length; q++) {
          var k = T[q].t;
          if (depth === 0 && k === close) break;
          if (k === '<' || k === '(' || k === '[' || k === '{') depth++;
          else if (k === '>' || k === ')' || k === ']' || k === '}') depth--;
          if (k === ',' && depth === 0) { if (cur.length) fields.push(cur); cur = []; } else cur.push(T[q]);
        }
        if (cur.length) fields.push(cur);
        if (q >= T.length) { err('struct ' + name + ': missing ' + close); break; }
        var ftexts = [];
        fields.forEach(function (f, i) {
          var j = 0; if (f[j] && f[j].t === 'pub') j++;
          var fname = close === '}' ? f[j].t : String(i);
          if (close === '}') { if (!f[j + 1] || f[j + 1].t !== ':') { err('struct ' + name + ': write each field as name: Type'); return; } j += 2; }
          var ftext = src.slice(f[j].s, f[f.length - 1].e);
          try { var fa = parseType(ftext); if (borrows(fa)) err('struct ' + name + ', field ' + fname + ": a borrowed field needs &'static here"); }
          catch (e) { err('struct ' + name + ', field ' + fname + ': ' + e.message); return; }
          ftexts.push(ftext); names.push(fname);
        });
        p = q + 1; if (close === ')' && T[p] && T[p].t === ';') p++;
        if (out.defs[name]) err('struct ' + name + ' is defined twice');
        out.order.push(name); out.defs[name] = { params: params, fields: ftexts, names: names, unsafeImpls: {}, tuple: close === ')', derives: derives };
        derives = [];
        continue;
      }
      if (t === 'unsafe' && T[p + 1] && T[p + 1].t === 'impl') {
        var q2 = p + 2; if (T[q2] && T[q2].t === '<') { while (T[q2] && T[q2].t !== '>') q2++; q2++; }
        var tr = T[q2] && T[q2].t, sn = T[q2 + 2] && T[q2 + 2].t;
        if ((tr !== 'Send' && tr !== 'Sync') || !T[q2 + 1] || T[q2 + 1].t !== 'for' || !sn) { err('write: unsafe impl Send for Name {}'); break; }
        out.impls = out.impls || []; out.impls.push([tr, sn]);
        q2 += 3; if (T[q2] && T[q2].t === '<') { while (T[q2] && T[q2].t !== '>') q2++; q2++; }
        if (T[q2] && T[q2].t === '{') { q2++; if (T[q2] && T[q2].t === '}') q2++; }
        if (T[q2] && T[q2].t === ';') q2++;
        p = q2; continue;
      }
      err('expected struct … or unsafe impl … near "' + t + '"'); break;
    }
    (out.impls || []).forEach(function (im) { if (out.defs[im[1]]) out.defs[im[1]].unsafeImpls[im[0]] = true; else err('unsafe impl for unknown struct ' + im[1]); });
    // recursion is not modeled (rustc treats auto traits coinductively; the solver would give up)
    out.order.forEach(function (n) {
      var seen = {}, stack = [n];
      while (stack.length) {
        var c = stack.pop(); if (!out.defs[c]) continue;
        out.defs[c].fields.forEach(function (f) { nodes(parseType(f)).forEach(function (x) { if (x.k === 'path' && out.defs[x.name]) { if (x.name === n) seen.rec = true; else if (!seen[x.name]) { seen[x.name] = 1; stack.push(x.name); } } }); });
      }
      if (seen.rec) err('struct ' + n + ' contains itself: recursive types are not modeled here');
    });
    return out;
  }
  function envOf(st) {
    var env = { structs: {} };
    st.order.forEach(function (n) { var d = st.defs[n]; env.structs[n] = { params: d.params, fields: d.fields.map(forTS), unsafeImpls: d.unsafeImpls, derives: d.derives || [] }; });
    return env;
  }
  function printStructs(st) {
    var lines = [];
    st.order.forEach(function (n) {
      var d = st.defs[n], head = 'struct ' + n + (d.params.length ? '<' + d.params.join(', ') + '>' : '');
      if (d.derives && d.derives.length) lines.push('#[derive(' + d.derives.join(', ') + ')]');
      if (d.unit) lines.push(head + ';');
      else if (d.tuple) lines.push(head + '(' + d.fields.join(', ') + ');');
      else lines.push(head + ' { ' + d.fields.map(function (f, i) { return d.names[i] + ': ' + f; }).join(', ') + ' }');
      ['Send', 'Sync'].forEach(function (tr) {
        if (d.unsafeImpls[tr]) lines.push('unsafe impl' + (d.params.length ? '<' + d.params.join(', ') + '>' : '') + ' ' + tr + ' for ' + n + (d.params.length ? '<' + d.params.join(', ') + '>' : '') + ' {}');
      });
    });
    return lines.join('\n');
  }

  /* ───────────── 3. what the program must prove ───────────── */
  function unsplit(goal) { var i = goal.lastIndexOf(': '); return { type: unalias(goal.slice(0, i)), trait: goal.slice(i + 2) }; }
  function leavesOf(tree, out) {
    out = out || [];
    if (!tree.ok && tree.reason) { var g = unsplit(tree.goal); g.why = tree.reason; out.push(g); }
    tree.kids.forEach(function (k) { leavesOf(k, out); });
    return out;
  }
  function trustedIn(tree) { return (tree.ok && /^unsafe impl/.test(tree.rule || '')) || tree.kids.some(trustedIn); }
  function check(prog, structsText) {
    var st = typeof structsText === 'object' && structsText && structsText.defs ? structsText : parseStructs(structsText);
    var env = envOf(st), caps = [], errors = st.errors.slice();
    prog.caps.forEach(function (c) {
      var a; try { a = parseType(c.type); } catch (e) { errors.push(c.type + ': ' + e.message); return; }
      var eff = c.mode;
      if (prog.kind === 'spawn' || prog.kind === 'scope') {
        if (prog.move) eff = 'val';                                   // move: every capture by value
        else if (eff === 'val' && TS.solve('Copy', a, env).ok) eff = 'ref';   // a Copy value is only borrowed
      }
      caps.push({ name: c.name, ast: a, eff: eff });
    });
    if (errors.length) return { ok: false, errors: errors, codes: ['input'], leaves: [], borrowed: [], nonStatic: [], tree: null };
    var tree;
    if (prog.kind === 'send' || prog.kind === 'sync') {
      tree = TS.solve(prog.kind === 'send' ? 'Send' : 'Sync', caps[0].ast, env).tree;
    } else {
      var kids = caps.map(function (c) {
        var goalAst = c.eff === 'val' ? c.ast : { k: 'ref', mut: c.eff === 'mut', to: c.ast };
        return TS.solve('Send', goalAst, env).tree;
      });
      tree = { goal: 'closure: Send', ok: kids.every(function (k) { return k.ok; }), kids: kids,
               rule: 'a closure is Send when every capture is: by value T: Send, by & &T: Send, by &mut &mut T: Send' };
    }
    var leaves = [], seen = {};
    leavesOf(tree).forEach(function (l) { var k = l.type + '|' + l.trait; if (!seen[k]) { seen[k] = 1; leaves.push(l); } });
    // what rustc's headline names: the failing leaf — except that for a bare probe whose type is the leaf's
    // type behind references (is_send::<&RefCell<i32>>, leaf RefCell<i32>: Sync) it names the probed type
    var reported = [], rseen = {};
    leaves.forEach(function (l) {
      var r = l;
      if (prog.kind === 'send' || prog.kind === 'sync') {
        var rootTrait = prog.kind === 'send' ? 'Send' : 'Sync', peeled = caps[0].ast;
        while (peeled.k === 'ref') peeled = peeled.to;
        if (unalias(show(peeled)) === l.type && l.trait !== rootTrait) r = { type: unalias(show(caps[0].ast)), trait: rootTrait, why: l.why };
      }
      var k = r.type + '|' + r.trait; if (!rseen[k]) { rseen[k] = 1; reported.push(r); }
    });
    var res = { ok: false, errors: [], tree: tree, leaves: leaves, reported: reported, caps: caps, borrowed: [], nonStatic: [], codes: [], trusted: trustedIn(tree) };
    if (leaves.length) {
      res.codes = leaves.some(function (l) { return /^unknown type/.test(l.why); }) ? ['unknown'] : ['E0277'];
      return res;
    }
    if (prog.kind === 'spawn') {                          // type-checking passed; now 'static (borrowck)
      caps.forEach(function (c) {
        if (c.eff !== 'val') res.borrowed.push(c.name);   // E0373: the closure borrows a local
        if (borrows(c.ast)) res.nonStatic.push(c.name);   // E0521: the value itself borrows
      });
      if (res.borrowed.length) res.codes.push('E0373');
      if (res.nonStatic.length) res.codes.push('E0521');
    }
    res.ok = res.codes.length === 0;
    return res;
  }

  /* ───────────── 4. the repair loop ───────────── */
  function ruleFor(leaf, where) {       // the local type change that removes this failing leaf
    var a = parseType(leaf.type), n = a.k === 'path' ? a.name : a.k;
    if (n === 'Rc') return { label: 'Rc → Arc: an atomic count', head: 'Arc' };
    if (n === 'rc::Weak') return { label: 'rc::Weak → sync::Weak: the Arc family', head: 'std::sync::Weak' };
    if ((n === 'Cell' || n === 'RefCell' || n === 'UnsafeCell') && leaf.trait === 'Sync') {
      var inner = a.args[0], at = inner && inner.k === 'path' && !inner.args.length && ATOMIC[inner.name];
      var pat = where && where.node && where.node.args && where.node.args[0];          // as written at the site
      var generic = pat && pat.k === 'path' && where.params && where.params.indexOf(pat.name) >= 0;
      if (n === 'Cell' && at && !generic) return { label: 'Cell → ' + at + ': a synchronized cell', whole: at };
      return { label: n + ' → Mutex: the lock supplies the exclusion', head: 'Mutex' };
    }
    if (a.k === 'dyn') return { label: 'write + ' + leaf.trait + ' into the trait object', suffix: ' + ' + leaf.trait };
    if (n === 'Receiver' && leaf.trait === 'Sync') return { label: 'wrap in Mutex: Mutex<T> is Sync when T is Send', wrap: 'Mutex' };
    if (a.k === 'ptr') return { stop: 'a raw pointer carries no promise; only an unsafe impl on a wrapper can vouch for it (Lesson 19)' };
    if (GUARDS.indexOf(n) >= 0) return { stop: 'a guard must be released by the thread that locked; send the Arc<Mutex<…>> and lock inside the thread' };
    return { stop: 'no smaller type is known that removes this' };
  }
  function edit(text, node, rw) {        // splice the rewrite into the source text at the node's span
    if (rw.whole) return text.slice(0, node.s) + rw.whole + text.slice(node.e);
    if (rw.head) return text.slice(0, node.hs) + rw.head + text.slice(node.he);
    if (rw.suffix) return text.slice(0, node.e) + rw.suffix + text.slice(node.e);
    if (rw.wrap) return text.slice(0, node.s) + rw.wrap + '<' + text.slice(node.s, node.e) + '>' + text.slice(node.e);
    return text;
  }
  function match(pat, con, params, bind) {   // does a struct-field sub-type (with params) produce `con`?
    if (pat.k === 'path' && !pat.args.length && params.indexOf(pat.name) >= 0) {
      var s = show(con); if (bind[pat.name] && bind[pat.name] !== s) return false; bind[pat.name] = s; return true;
    }
    if (pat.k !== con.k) return false;
    if (pat.k === 'path') return pat.name === con.name && pat.args.length === con.args.length && pat.args.every(function (x, i) { return match(x, con.args[i], params, bind); });
    if (pat.k === 'ref' || pat.k === 'ptr') return pat.mut === con.mut && match(pat.to, con.to, params, bind);
    if (pat.k === 'tuple') return pat.items.length === con.items.length && pat.items.every(function (x, i) { return match(x, con.items[i], params, bind); });
    if (pat.k === 'array' || pat.k === 'slice') return match(pat.elem, con.elem, params, bind);
    return show(pat) === show(con);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function hasLeaf(r, leaf) { return r.leaves.some(function (l) { return l.type === leaf.type && l.trait === leaf.trait; }); }
  function repair(prog, structsText) {
    var st = parseStructs(structsText), cur = clone(prog), steps = [];
    for (var round = 0; round < 8; round++) {
      var r = check(cur, st);
      if (r.ok || r.codes[0] === 'input' || r.codes[0] === 'unknown') return { steps: steps, prog: cur, structs: printStructs(st), result: r, stop: r.ok ? null : 'not in the solver database' };
      var lent = r.caps.filter(function (c) { return c.eff !== 'val'; }).map(function (c) { return c.name; });
      if (cur.kind === 'spawn' && !cur.move && lent.length) {
        // a spawned closure that borrows always ends in E0373, so `move` is part of any fix: do it first
        steps.push({ label: 'add move: the closure takes ' + lent.join(', ') + ' by value', from: 'no move', to: 'move', where: 'the closure' });
        cur.move = true;
      } else if (r.codes[0] === 'E0277') {
        var leaf = r.leaves[0], cands = [];
        cur.caps.forEach(function (c, ci) {
          nodes(parseType(c.type)).forEach(function (n) { if (show(n) === leaf.type) cands.push({ cap: ci, node: n, where: 'the type of ' + c.name }); });
        });
        st.order.forEach(function (sn) {
          var d = st.defs[sn];
          d.fields.forEach(function (f, fi) {
            nodes(parseType(f)).forEach(function (n) {
              if (n.k === 'path' && !n.args.length && d.params.indexOf(n.name) >= 0) return;   // a bare T: the culprit is the argument
              if (match(n, parseType(leaf.type), d.params, {})) cands.push({ struct: sn, field: fi, node: n, where: 'struct ' + sn + ', field ' + d.names[fi], params: d.params });
            });
          });
        });
        // try each place the culprit is written; keep the first edit that makes this failure disappear
        var chosen = null, first = null, rw0 = null;
        for (var i = 0; i < cands.length && !chosen; i++) {
          var c = cands[i], rw = ruleFor(leaf, c);
          if (rw.stop) { rw0 = rw; continue; }
          var p2 = clone(cur), s2 = clone(st);
          if (c.cap !== undefined) p2.caps[c.cap].type = edit(p2.caps[c.cap].type, c.node, rw);
          else s2.defs[c.struct].fields[c.field] = edit(s2.defs[c.struct].fields[c.field], c.node, rw);
          var trial = { p: p2, s: s2, c: c, rw: rw };
          if (!first) first = trial;
          if (!hasLeaf(check(p2, s2), leaf)) chosen = trial;
        }
        chosen = chosen || first;
        if (!chosen) { var why = (rw0 || ruleFor(leaf)).stop || 'could not locate ' + leaf.type; return { steps: steps, prog: cur, structs: printStructs(st), result: r, stop: why }; }
        var before = chosen.c.cap !== undefined ? cur.caps[chosen.c.cap].type : st.defs[chosen.c.struct].fields[chosen.c.field];
        var after = chosen.c.cap !== undefined ? chosen.p.caps[chosen.c.cap].type : chosen.s.defs[chosen.c.struct].fields[chosen.c.field];
        steps.push({ label: chosen.rw.label, from: before, to: after, where: chosen.c.where });
        cur = chosen.p; st = chosen.s;
      } else if (r.codes.indexOf('E0373') >= 0) {
        steps.push({ label: 'add move: the closure takes ' + r.borrowed.join(', ') + ' by value', from: 'no move', to: 'move', where: 'the closure' });
        cur.move = true;
      } else {                                   // E0521: a borrowed value cannot outlive its owner
        var ci2 = -1, nd = null;
        cur.caps.forEach(function (c, i) { if (nd) return; nodes(parseType(c.type)).forEach(function (n) { if (!nd && n.k === 'ref' && n.lt !== "'static") { nd = n; ci2 = i; } }); });
        if (!nd) return { steps: steps, prog: cur, structs: printStructs(st), result: r, stop: 'the value borrows (a guard or a lifetime): no type change makes it \'static' };
        var t0 = cur.caps[ci2].type, inner = t0.slice(nd.to.s, nd.to.e);
        var t1 = t0.slice(0, nd.s) + (nd.mut ? 'Arc<Mutex<' + inner + '>>' : 'Arc<' + inner + '>') + t0.slice(nd.e);
        steps.push({ label: 'own it: a shared owner instead of a borrow', from: t0, to: t1, where: 'the type of ' + cur.caps[ci2].name });
        cur.caps[ci2].type = t1;
      }
    }
    return { steps: steps, prog: cur, structs: printStructs(st), result: check(cur, st), stop: 'gave up after 8 changes' };
  }

  /* ───────────── the widget's six questions, as programs ───────────── */
  var MODES = {
    'send':       { kind: 'send',  move: false, mode: 'val', label: 'T: Send — may it move to another thread?' },
    'sync':       { kind: 'sync',  move: false, mode: 'val', label: 'T: Sync — may &T be used from two threads?' },
    'spawn-move': { kind: 'spawn', move: true,  mode: 'val', label: 'thread::spawn(move || … value …)' },
    'spawn-ref':  { kind: 'spawn', move: false, mode: 'ref', label: 'thread::spawn(|| … &value …)  (no move)' },
    'scope-ref':  { kind: 'scope', move: false, mode: 'ref', label: 'scoped thread shares &value' },
    'scope-mut':  { kind: 'scope', move: false, mode: 'mut', label: 'scoped thread gets &mut value' }
  };
  function program(mode, type) { var m = MODES[mode]; return { kind: m.kind, move: m.move, caps: [{ name: 'value', type: type, mode: m.mode }] }; }
  // the exact Rust the oracle compiles for a program (one line), and the widget prints
  function rust(prog, fname) {
    var multi = prog.caps.length > 1;
    if (prog.kind === 'send' || prog.kind === 'sync') return 'fn ' + fname + '() { is_' + prog.kind + '::<' + prog.caps[0].type + '>(); }';
    var params = prog.caps.map(function (c) { return (c.mode === 'mut' ? 'mut ' : '') + c.name + ': ' + c.type; }).join(', ');
    var body = prog.caps.map(function (c, i) {
      var sfx = multi ? String(i) : '';
      return c.mode === 'val' ? 'let _keep' + sfx + ' = ' + c.name + ';' : c.mode === 'ref' ? 'let _peek' + sfx + ' = &' + c.name + ';' : 'let _poke' + sfx + ' = &mut ' + c.name + ';';
    }).join(' ');
    var cl = (prog.move ? 'move ' : '') + '|| { ' + body + ' }';
    if (prog.kind === 'spawn') return 'fn ' + fname + '(' + params + ') { thread::spawn(' + cl + '); }';
    return 'fn ' + fname + '(' + params + ') { thread::scope(|s| { s.spawn(' + cl + '); }); }';
  }
  SS.MODES = MODES; SS.program = program; SS.rust = rust;
  var SESSION = 'struct Session { id: u64, user: Rc<String> }';
  SS.PRESETS = [      // the widget's slider positions; the oracle compiles each of them in every mode
    { type: 'Rc<String>', mode: 'spawn-move', structs: '' },
    { type: 'Arc<Mutex<Vec<i32>>>', mode: 'spawn-move', structs: '' },
    { type: 'Arc<Cell<i32>>', mode: 'spawn-move', structs: '' },
    { type: '&RefCell<i32>', mode: 'send', structs: '' },
    { type: 'Box<dyn Fn()>', mode: 'spawn-move', structs: '' },
    { type: 'Sender<Rc<i32>>', mode: 'spawn-move', structs: '' },
    { type: "MutexGuard<'static, i32>", mode: 'spawn-move', structs: '' },
    { type: 'Session', mode: 'spawn-move', structs: SESSION },
    { type: 'Session', mode: 'spawn-move', structs: SESSION + '\nunsafe impl Send for Session {}' },
    { type: 'Cell<i32>', mode: 'scope-mut', structs: '' }
  ];

  /* ───────────── display helpers (no DOM; the widget draws what these return) ───────────── */
  var BOUND = { spawn: 'spawn', scope: 'Scope::spawn', send: 'is_send', sync: 'is_sync' };
  function splitGoal(goal) { var g = unalias(goal), i = g.lastIndexOf(': '); return [g.slice(0, i), g.slice(i + 2)]; }
  function chain(tree, kind) {           // the failing path, from the culprit outwards, in rustc's words
    var path = [], node = tree;
    while (node) { path.push(node); var bad = null; for (var i = 0; i < node.kids.length; i++) if (!node.kids[i].ok) { bad = node.kids[i]; break; } node = bad; }
    var notes = [];
    for (var j = path.length - 2; j >= 0; j--) {
      var g = splitGoal(path[j].goal);
      if (g[0] === 'closure') notes.push('used within this closure');
      else if (/every field|every element|element type/.test(path[j].rule || '')) notes.push('appears within the type `' + g[0] + '`');
      else notes.push('required for `' + g[0] + '` to implement `' + g[1] + '`');
    }
    notes.push('required by a bound in `' + BOUND[kind] + '`');
    return notes;
  }
  function headlines(r) {                // the error lines rustc would print for a result
    if (r.codes[0] === 'unknown') return r.leaves.filter(function (l) { return /^unknown type/.test(l.why); }).map(function (l) { return l.why; });
    if (r.codes[0] === 'E0277') return r.reported.map(function (l) { return 'E0277: `' + l.type + '` cannot be ' + (l.trait === 'Send' ? 'sent' : 'shared') + ' between threads safely'; });
    var out = [];
    if (r.codes.indexOf('E0373') >= 0) out.push('E0373: closure may outlive the current function, but it borrows `' + r.borrowed.join('`, `') + '`');
    if (r.codes.indexOf('E0521') >= 0) out.push('E0521: borrowed data escapes outside of function (`' + r.nonStatic.join('`, `') + '` holds a borrow)');
    return out;
  }
  function rows(tree, max) {             // tree -> at most `max` display rows; passing subtrees fold first
    function count(n) { return 1 + n.kids.reduce(function (s, k) { return s + count(k); }, 0); }
    function flat(n, d, fold, out) {
      out.push({ d: d, n: n });
      if (!n.ok && n.reason) out.push({ d: d + 1, why: n.reason });
      if (fold && d > 0 && n.ok && n.kids.length) { out[out.length - 1].hidden = count(n) - 1; return out; }
      n.kids.forEach(function (k) { flat(k, d + 1, fold, out); });
      return out;
    }
    var r = flat(tree, 0, false, []);
    if (r.length > max) r = flat(tree, 0, true, []);
    return r.length > max ? r.slice(0, max - 1).concat([{ d: 0, more: r.length - max + 1 }]) : r;
  }
  SS.BOUND = BOUND; SS.splitGoal = splitGoal; SS.chain = chain; SS.headlines = headlines; SS.rows = rows;

  // everything the widget shows, as data — so Node can check each number and verdict the lesson quotes
  function describe(mode, type, structsText) {
    type = String(type || '').trim() || '()';
    var prog = program(mode, type), res = check(prog, structsText), bad = res.codes[0] === 'input';
    var fix = bad ? null : repair(prog, structsText), pad = '          ', out = ['program   ' + rust(prog, 'start')];
    var send = !bad && check(program('send', type), structsText).ok, sync = !bad && check(program('sync', type), structsText).ok;
    function step(s) { return s.to === 'move' ? 'add move' : s.from + ' → ' + s.to; }
    var d = { prog: prog, res: res, fix: fix, send: send, sync: sync, lines: out, verdict: '', fixLine: '', staticLine: '' };
    if (bad) { out.push('input     ' + res.errors.join('\n' + pad)); d.kpis = [['input?', 'warn'], ['—', ''], ['—', ''], ['—', '']]; return d; }
    var trust = res.trusted ? ' — on the author\'s word: an unsafe impl vouches for a type, and the compiler checked nothing behind it (Lesson 19)' : '';
    if (res.ok) out.push('verdict   accepted' + trust);
    else headlines(res).forEach(function (h, i) { out.push((i ? pad : 'verdict   ') + h); });
    if (res.codes[0] === 'E0277') {
      var l0 = res.leaves[0];
      if (res.reported[0].type !== l0.type) out.push(pad + 'help: the trait `' + l0.trait + '` is not implemented for `' + l0.type + '`');
      out.push('because   ' + l0.why, 'chain     ' + chain(res.tree, prog.kind).join(' → '));
    }
    fix.steps.forEach(function (s, i) { out.push((i ? pad : 'fix       ') + (i + 1) + '. ' + step(s) + '   (' + s.label + '; ' + s.where + ')'); });
    if (fix.steps.length) out.push(pad + '⇒ ' + (fix.result.ok ? 'accepted' : 'still rejected: ' + fix.stop));
    else if (!res.ok) out.push('fix       none by a type change: ' + fix.stop);
    if (!res.ok && prog.kind === 'scope' && send && !sync) out.push('or        give the thread the value (move), or lend it as &mut: both need only T: Send');
    var ok = fix.result.ok, n = ok ? fix.steps.length : 0;
    d.kpis = [[res.codes.join(' + ') || 'accepted', res.ok ? 'good' : 'err'], [(send ? '✓' : '✗') + ' Send', send ? 'good' : 'err'], [(sync ? '✓' : '✗') + ' Sync', sync ? 'good' : 'err'],
              [res.ok ? 'none needed' : ok ? n + (n === 1 ? ' change' : ' changes') : 'no type change', res.ok ? 'good' : ok ? 'accent' : 'warn']];
    d.verdict = res.ok ? '✓ accepted' + (res.trusted ? ' — on the author\'s word (an unsafe impl)' : '') : '✗ ' + headlines(res)[0];
    d.fixLine = fix.steps.length ? 'fix: ' + fix.steps.map(step).join(', then ') + (fix.result.ok ? '  ⇒ accepted' : '') : res.ok ? '' : 'no type change removes this: ' + fix.stop;
    if (prog.kind === 'spawn') d.staticLine = res.codes[0] === 'E0277' ? "· 'static: not reached (type checking failed first)" :
      !(res.borrowed.length || res.nonStatic.length) ? "✓ 'static: the closure owns everything it captured" :
      "✗ 'static: " + (res.borrowed.length ? 'the closure borrows ' + res.borrowed.join(', ') + ' (E0373)' : res.nonStatic.join(', ') + ' holds a borrow (E0521)');
    return d;
  }
  SS.describe = describe;

  // draws a describe() result on a 2D context, W×H in CSS pixels, C = the page's colours (no DOM access)
  function paint(ctx, d, W, H, C) {
    function fit(s, x, y, w) {             // text clipped to width w with an ellipsis; returns the width drawn
      if (w < 24) return 0;
      var t = s; while (t.length > 4 && ctx.measureText(t).width > w) t = t.slice(0, -2);
      if (t !== s) t = t.slice(0, -1) + '…';
      ctx.fillText(t, x, y); return ctx.measureText(t).width;
    }
    var res = d.res, y = 14, lh = 19;
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = '11px ' + C.mono; ctx.fillStyle = C.dim; fit(rust(d.prog, 'start'), 8, y, W - 16); y += 22;
    if (!res.tree) { ctx.fillStyle = C.err; res.errors.slice(0, 8).forEach(function (e) { fit('✗ ' + e, 8, y, W - 16); y += lh; }); return; }
    rows(res.tree, Math.max(3, Math.floor((H - y - 50) / lh) - (d.staticLine ? 1 : 0))).forEach(function (row) {
      var x = 10 + row.d * 16;
      ctx.font = '11px ' + C.mono;
      if (row.more || row.why) { ctx.fillStyle = row.why ? C.err : C.dim; fit(row.why ? '↳ ' + row.why : '… ' + row.more + ' more rows', x, y, W - x - 8); y += lh; return; }
      var n = row.n, g = splitGoal(n.goal), top = g[0] === 'closure';
      var rule = row.hidden ? '(+' + row.hidden + ' ✓ below)' : top ? 'required by ' + BOUND[d.prog.kind] + ': by value T: Send · by & T: Sync · by &mut T: Send' : n.rule || '';
      ctx.font = 'bold 13px ' + C.mono; ctx.fillStyle = n.ok ? C.good : C.err; ctx.fillText(n.ok ? '✓' : '✗', x, y);
      ctx.font = '12px ' + C.mono; ctx.fillStyle = n.ok ? C.text : C.err;
      var gw = fit(top ? 'the closure: Send' : g[0] + ': ' + g[1], x + 16, y, W - x - 24);
      ctx.font = '11px ' + C.mono; ctx.fillStyle = C.dim; if (rule) fit('— ' + rule, x + 24 + gw, y, W - x - 32 - gw);
      y += lh;
    });
    ctx.font = '12px ' + C.mono;
    if (d.staticLine) { ctx.fillStyle = d.staticLine[0] === '✓' ? C.good : d.staticLine[0] === '✗' ? C.err : C.dim; fit(d.staticLine, 10, y, W - 18); }
    ctx.font = 'bold 12px ' + C.mono; ctx.fillStyle = res.ok ? C.good : C.err; fit(d.verdict, 8, H - 30, W - 16);
    ctx.font = '12px ' + C.mono; ctx.fillStyle = d.fix && d.fix.steps.length ? C.accent : C.warn; fit(d.fixLine, 8, H - 12, W - 16);
  }
  SS.paint = paint;

  function render(tree, indent) {
    indent = indent || '';
    var line = indent + (tree.ok ? '✓ ' : '✗ ') + unalias(tree.goal) + (tree.rule ? '   — ' + tree.rule : '') + (tree.reason ? '   — ' + tree.reason : '');
    return [line].concat(tree.kids.map(function (k) { return render(k, indent + '   '); })).join('\n');
  }
  SS.tokenize = tokenize; SS.parseType = parseType; SS.show = function (a) { return unalias(show(a)); };
  SS.borrows = borrows; SS.parseStructs = parseStructs; SS.printStructs = printStructs; SS.envOf = envOf;
  SS.check = check; SS.repair = repair; SS.render = render; SS.unalias = unalias; SS.nodes = nodes;
  root.SendSync = SS;
  if (typeof module !== 'undefined' && module.exports) module.exports = SS;
})(typeof window !== 'undefined' ? window : this,
   typeof window !== 'undefined' && window.TraitSolver ? window.TraitSolver : require('./traitsolver.js'));
