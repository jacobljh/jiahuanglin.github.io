/* visibility.js — "who can see this item?": a model of Rust's privacy rules.
 * Used by the widget in lesson 21 and by tools/rust_verify/21_visibility.js, which compares every verdict
 * below with rustc 1.98.1 (edition 2024) on randomly generated module trees. No DOM code here.
 *
 * Input: a small subset of Rust — inline `mod`s, `fn`s, structs with named fields, and `impl` blocks placed
 * next to their struct — each item with a visibility: none (private), pub, pub(crate), pub(super),
 * pub(self) or pub(in path). `use` lines are skipped: a `use` adds a name, never an item, and the probes
 * below always go through each item's own path.
 *
 * API
 *   Vis.parse(src)            -> tree (throws Error('line N: ...') outside the subset or on what rustc rejects)
 *   Vis.render(tree)          -> canonical source (bodies shown as { … }); parse(render(t)) gives t back
 *   Vis.probes(tree)          -> [{ kind: 'call'|'assoc'|'method'|'field'|'build', mod, s, name, label }]
 *   Vis.check(tree, from, pr) -> { ok, errors: [{ code, msg }], steps: [...], masked, code }
 *        from = a module id, or Vis.EXT (another crate, which names this one `mylib`)
 *   Vis.region(tree, pr)      -> { ext: bool, mods: [bool per module id] }  (where the probe compiles)
 *   Vis.scopeOf(tree, vis)    -> 'world' | module id;   Vis.pathOf(tree, id) -> 'crate::a::b'
 *   Vis.rows(tree)            -> modules in source order with depth and subtree end (for drawing)
 *   Vis.setVis(tree, pr, text)-> a new tree with the probed item's visibility replaced
 *   Vis.visOptions(tree, pr)  -> the visibilities rustc would accept for that item
 *   Vis.visIndex(tree, pr)    -> which of them names the item's current region
 *   Vis.describe(tree, pr, from) -> the widget's readout text and KPI strings
 *   Vis.paint(ctx, W, H, tree, pr, from, walk, colors) -> draws the tree on any 2D context (no document access)
 *   Vis.PRESETS               -> the lesson's worked examples
 */
(function (root) {
  'use strict';
  var V = {}, EXT = -1;
  V.EXT = EXT;

  /* ───────────── tokens ───────────── */
  function tokenize(src) {
    var toks = [], i = 0, line = 1, n = src.length, c, j;
    while (i < n) {
      c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
        i += 2; continue;
      }
      if (c === '"') {
        j = i + 1;
        while (j < n && src[j] !== '"') { if (src[j] === '\\') j++; if (src[j] === '\n') line++; j++; }
        toks.push({ t: 's', v: src.slice(i, j + 1), line: line }); i = j + 1; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        j = i; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        toks.push({ t: 'id', v: src.slice(i, j), line: line }); i = j; continue;
      }
      if (/[0-9]/.test(c)) {
        j = i; while (j < n && /[A-Za-z0-9_.]/.test(src[j])) j++;
        toks.push({ t: 'n', v: src.slice(i, j), line: line }); i = j; continue;
      }
      if (c === "'") {                                          // char literal or lifetime
        if (src[i + 1] === '\\') { j = src.indexOf("'", i + 2); toks.push({ t: 's', v: src.slice(i, j + 1), line: line }); i = j + 1; continue; }
        if (src[i + 2] === "'") { toks.push({ t: 's', v: src.slice(i, i + 3), line: line }); i += 3; continue; }
        j = i + 1; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        toks.push({ t: 'lt', v: src.slice(i, j), line: line }); i = j; continue;
      }
      if (c === ':' && src[i + 1] === ':') { toks.push({ t: 'p', v: '::', line: line }); i += 2; continue; }
      if (c === '-' && src[i + 1] === '>') { toks.push({ t: 'p', v: '->', line: line }); i += 2; continue; }
      toks.push({ t: 'p', v: c, line: line }); i++;
    }
    return toks;
  }
  function joinType(ts) {                                       // tokens -> readable type text
    var out = '';
    ts.forEach(function (t, k) {
      var prev = ts[k - 1];
      if (prev && (prev.v === ',' || prev.v === ':' || ((prev.t === 'id' || prev.t === 'lt') && (t.t === 'id' || t.t === 'lt' || t.t === 'n')))) out += ' ';
      if (t.v === '->' || (prev && prev.v === '->')) out += ' ';
      out += t.v;
    });
    return out.replace(/\s+/g, ' ').trim();
  }

  /* ───────────── parsing ───────────── */
  function parse(src) {
    var toks = tokenize(String(src || '')), p = 0;
    var mods = [{ id: 0, name: 'crate', parent: -1, vis: null, line: 0, fns: [], structs: [], kids: [], pending: [], order: [] }];
    function peek() { return toks[p]; }
    function fail(msg, tok) { var t = tok || peek() || toks[toks.length - 1] || { line: 1 }; throw new Error('line ' + t.line + ': ' + msg); }
    function isP(v) { var t = toks[p]; return !!t && t.t === 'p' && t.v === v; }
    function isId(v) { var t = toks[p]; return !!t && t.t === 'id' && (v === undefined || t.v === v); }
    function eatP(v) { if (!isP(v)) fail('expected `' + v + '`' + (peek() ? ', found `' + peek().v + '`' : ' before the end')); return toks[p++]; }
    function ident() {
      if (!isId() || /^(mod|fn|struct|impl|pub|use|self|super|crate|in)$/.test(peek().v)) fail('expected a name' + (peek() ? ', found `' + peek().v + '`' : ''));
      return toks[p++].v;
    }
    function balanced(open, close) {                           // skip open … close, return the inner tokens
      var start = eatP(open), d = 1, inner = [];
      while (true) {
        var t = toks[p++];
        if (!t) fail('`' + open + '` is never closed', start);
        if (t.t === 'p' && t.v === open) d++;
        else if (t.t === 'p' && t.v === close) { d--; if (d === 0) return inner; }
        inner.push(t);
      }
    }
    function attrs() { while (isP('#')) { p++; if (isP('!')) p++; balanced('[', ']'); } }
    function vis() {
      var t = peek();
      if (!isId('pub')) return { k: 'priv', text: '', line: t ? t.line : 0 };
      p++;
      if (!isP('(')) return { k: 'pub', text: 'pub', line: t.line };
      p++;
      var r;
      if (isId('crate')) { p++; r = { k: 'crate', text: 'pub(crate)' }; }
      else if (isId('self')) { p++; r = { k: 'self', text: 'pub(self)' }; }
      else if (isId('super')) { p++; r = { k: 'super', text: 'pub(super)' }; }
      else if (isId('in')) {
        p++;
        var segs = [];
        if (!isId()) fail('expected a module path after `pub(in`');
        segs.push(toks[p++].v);
        while (isP('::')) { p++; if (!isId()) fail('expected a module name'); segs.push(toks[p++].v); }
        r = { k: 'in', segs: segs, text: 'pub(in ' + segs.join('::') + ')' };
      } else fail('after `pub(` write crate, self, super or in <path>');
      eatP(')');
      r.line = t.line;
      return r;
    }
    function fnRest(what) {                                    // after `fn name`: (params) [-> ty] { body }
      if (isP('<')) balanced('<', '>');
      var params = balanced('(', ')'), ret = [];
      while (peek() && !isP('{') && !isP(';')) ret.push(toks[p++]);
      if (isP(';')) fail('give the ' + what + ' a body: { … }');
      balanced('{', '}');
      var hasSelf = params.some(function (t) { return t.t === 'id' && t.v === 'self'; });
      var sig = '(' + joinType(params) + ')' + (ret.length ? ' ' + joinType(ret) : '');
      return { hasSelf: hasSelf, sig: sig.replace('( ', '(') };
    }
    function newMod(name, parent, v, line) {
      var m = { id: mods.length, name: name, parent: parent.id, vis: v, line: line, fns: [], structs: [], kids: [], pending: [], order: [] };
      mods.push(m); parent.kids.push(m.id); parent.order.push({ k: 'mod', id: m.id });
      return m;
    }
    function taken(mod, name, ns, line) {
      var clash = ns === 'type'
        ? mod.kids.some(function (k) { return mods[k].name === name; }) || mod.structs.some(function (s) { return s.name === name; })
        : mod.fns.some(function (f) { return f.name === name; });
      if (clash) fail('the name `' + name + '` is defined twice in this module (rustc: E0428)', { line: line });
    }
    function fields() {
      var out = [];
      while (!isP('}')) {
        attrs();
        var v = vis(), start = peek(), name = ident();
        eatP(':');
        var ty = [], d = 0;
        while (peek() && !(d === 0 && (isP(',') || isP('}')))) {
          var t = toks[p++];
          if (t.t === 'p' && (t.v === '<' || t.v === '(' || t.v === '[')) d++;
          if (t.t === 'p' && (t.v === '>' || t.v === ')' || t.v === ']')) d--;
          ty.push(t);
        }
        if (!ty.length) fail('field `' + name + '` needs a type');
        if (out.some(function (f) { return f.name === name; })) fail('field `' + name + '` is declared twice (rustc: E0124)', start);
        out.push({ name: name, vis: v, ty: joinType(ty) });
        if (isP(',')) p++;
      }
      p++;
      if (!out.length) fail('give the struct at least one named field');
      return out;
    }
    function body(mod, braced) {
      while (true) {
        if (braced && isP('}')) { p++; return; }
        if (!peek()) { if (braced) fail('`mod ' + mod.name + '` is never closed'); return; }
        attrs();
        if (braced && isP('}')) { p++; return; }
        if (!peek()) return;
        var v = vis(), kw = peek(), line = kw.line;
        if (isId('mod')) {
          p++;
          var mname = ident();
          if (isP(';')) fail('write the module inline: mod ' + mname + ' { … }');
          taken(mod, mname, 'type', line);
          eatP('{');
          body(newMod(mname, mod, v, line), true);
        } else if (isId('fn')) {
          p++;
          var fname = ident();
          taken(mod, fname, 'value', line);
          var f = fnRest('function');
          mod.fns.push({ name: fname, vis: v, sig: f.sig, line: line });
          mod.order.push({ k: 'fn', name: fname });
        } else if (isId('struct')) {
          p++;
          var sname = ident();
          taken(mod, sname, 'type', line);
          if (isP('<')) fail('generic structs are not modelled here; write concrete field types');
          if (isP(';') || isP('(')) fail('only structs with named fields are modelled: struct ' + sname + ' { … }');
          eatP('{');
          mod.structs.push({ name: sname, vis: v, fields: fields(), methods: [], line: line });
          mod.order.push({ k: 'struct', name: sname });
        } else if (isId('impl')) {
          if (v.k !== 'priv') fail('an impl block takes no visibility; put it on each fn');
          p++;
          var tname = ident();
          eatP('{');
          var ms = [];
          while (!isP('}')) {
            if (!peek()) fail('`impl ' + tname + '` is never closed');
            attrs();
            var mv = vis(), mline = peek().line;
            if (!isId('fn')) fail('an impl block here holds only fns');
            p++;
            var mn = ident(), r = fnRest('method');
            if (ms.some(function (x) { return x.name === mn; })) fail('`' + mn + '` is defined twice (rustc: E0592)', { line: mline });
            ms.push({ name: mn, vis: mv, hasSelf: r.hasSelf, sig: r.sig, line: mline });
          }
          p++;
          mod.pending.push({ type: tname, methods: ms, line: line });
        } else if (isId('use')) {
          while (peek() && !isP(';')) p++;
          eatP(';');
        } else {
          fail('this widget models mod, fn, struct and impl only (found `' + kw.v + '`)');
        }
      }
    }
    body(mods[0], false);
    var tree = { mods: mods };
    mods.forEach(function (m) {                                // attach impls to their structs
      m.pending.forEach(function (im) {
        var s = m.structs.filter(function (x) { return x.name === im.type; })[0];
        if (!s) throw new Error('line ' + im.line + ': keep each impl in the module of its struct (no struct `' + im.type + '` in ' + pathOf(tree, m.id) + ')');
        im.methods.forEach(function (x) {
          if (s.methods.some(function (y) { return y.name === x.name; })) throw new Error('line ' + x.line + ': `' + x.name + '` is defined twice (rustc: E0592)');
          s.methods.push(x);
        });
      });
      delete m.pending;
    });
    mods.forEach(function (m, i) { m.depth = i === 0 ? 0 : mods[m.parent].depth + 1; });
    // resolve every visibility now, so that what rustc would refuse is refused here
    mods.forEach(function (m) {
      if (m.id) resolveVis(tree, m.vis, m.parent);
      m.fns.forEach(function (f) { resolveVis(tree, f.vis, m.id); });
      m.structs.forEach(function (s) {
        resolveVis(tree, s.vis, m.id);
        s.fields.forEach(function (f) { resolveVis(tree, f.vis, m.id); });
        s.methods.forEach(function (x) { resolveVis(tree, x.vis, m.id); });
      });
    });
    return tree;
  }

  /* ───────────── visibility → the region it names ───────────── */
  function isWithin(tree, inner, outer) {                     // inner is outer or a descendant of it
    for (var m = inner; m >= 0; m = tree.mods[m].parent) if (m === outer) return true;
    return false;
  }
  function pathOf(tree, id) {
    var segs = [];
    for (var m = id; m > 0; m = tree.mods[m].parent) segs.unshift(tree.mods[m].name);
    return ['crate'].concat(segs).join('::');
  }
  // the visibility `v` written on an item that sits in module `home`: resolve it to 'world' or a module id
  function resolveVis(tree, v, home) {
    var fail = function (msg) { throw new Error('line ' + v.line + ': ' + msg); };
    if (v.k === 'pub') v.scope = 'world';
    else if (v.k === 'crate') v.scope = 0;
    else if (v.k === 'priv' || v.k === 'self') v.scope = home;
    else if (v.k === 'super') {
      if (home === 0) fail('pub(super) at the crate root: the root has no parent (rustc: E0433, too many leading `super` keywords)');
      v.scope = tree.mods[home].parent;
    } else {
      var segs = v.segs, at;
      if (segs[0] === 'crate') at = 0;
      else if (segs[0] === 'self') at = home;
      else if (segs[0] === 'super') { if (home === 0) fail('too many leading `super` keywords (rustc: E0433)'); at = tree.mods[home].parent; }
      else fail('from edition 2018 on, a pub(in …) path starts with crate, self or super');
      for (var k = 1; k < segs.length; k++) {
        if (segs[k] === 'super') {
          if (k > 0 && segs[k - 1] !== 'super' && !(k === 1 && segs[0] === 'self')) fail('`super` may only lead a path');
          if (at === 0) fail('too many leading `super` keywords (rustc: E0433)');
          at = tree.mods[at].parent; continue;
        }
        var kid = tree.mods[at].kids.filter(function (c) { return tree.mods[c].name === segs[k]; })[0];
        if (kid === undefined) fail('no module `' + segs[k] + '` in ' + pathOf(tree, at));
        at = kid;
      }
      if (!isWithin(tree, home, at)) fail(v.text + ' must name an enclosing module of this item (rustc: E0742)');
      v.scope = at;
    }
    return v.scope;
  }
  V.scopeOf = function (tree, v) { return v.scope; };
  V.pathOf = pathOf;
  function visibleFrom(tree, scope, from) {  // scope: 'world', or the module a visibility names
    if (scope === 'world') return true;  // pub
    if (from === EXT) return false;  // anything narrower never leaves the crate
    return isWithin(tree, from, scope);  // from is that module, or inside it
  }
  function scopeWords(tree, v) {
    var w = v.text || 'private';
    if (v.scope === 'world') return w + ': any module, in any crate, that can reach it';
    if (v.scope === 0) return w + ': the whole crate, no other crate';
    return w + ': ' + pathOf(tree, v.scope) + ' and the modules inside it';
  }

  /* ───────────── probes ───────────── */
  function probes(tree) {                                     // every access the tree offers, in source order
    var out = [];
    (function walk(m) {
      m.order.forEach(function (e) {
        if (e.k === 'mod') return walk(tree.mods[e.id]);
        if (e.k === 'fn') return out.push({ kind: 'call', mod: m.id, name: e.name, label: 'fn · ' + pathOf(tree, m.id) + '::' + e.name + '()' });
        var s = m.structs.filter(function (x) { return x.name === e.name; })[0];
        s.fields.forEach(function (f) { out.push({ kind: 'field', mod: m.id, s: s.name, name: f.name, label: s.name + ' · v.' + f.name + ' = …' }); });
        s.methods.forEach(function (x) {
          out.push(x.hasSelf ? { kind: 'method', mod: m.id, s: s.name, name: x.name, label: s.name + ' · v.' + x.name + '(…)' }
                             : { kind: 'assoc', mod: m.id, s: s.name, name: x.name, label: s.name + ' · ' + s.name + '::' + x.name + '(…)' });
        });
        out.push({ kind: 'build', mod: m.id, s: s.name, name: s.name, label: s.name + ' · ' + s.name + ' { ' + s.fields.map(function (f) { return f.name; }).join(', ') + ' }' });
      });
    })(tree.mods[0]);
    return out;
  }
  function findStruct(tree, pr) { return tree.mods[pr.mod].structs.filter(function (s) { return s.name === pr.s; })[0]; }
  function target(tree, pr) {                                   // the item whose own visibility the probe tests
    var m = tree.mods[pr.mod];
    if (pr.kind === 'call') return m.fns.filter(function (f) { return f.name === pr.name; })[0];
    var s = findStruct(tree, pr);
    if (!s) return null;
    if (pr.kind === 'field') return s.fields.filter(function (f) { return f.name === pr.name; })[0];
    if (pr.kind === 'method' || pr.kind === 'assoc') return s.methods.filter(function (f) { return f.name === pr.name; })[0];
    return s;
  }
  function list(names) {                                      // `a`, `b` and `c` — rustc's wording
    var q = names.map(function (n) { return '`' + n + '`'; });
    return q.length < 2 ? q[0] : q.slice(0, -1).join(', ') + ' and ' + q[q.length - 1];
  }
  // each step an access takes: the crate root, every module on the item's path, the item, then what
  // the access touches on it (a field, a method, or every field of a literal)
  function stepsOf(tree, from, pr) {
    var out = [{ seg: from === EXT ? 'mylib' : 'crate', what: 'the crate root: always reachable', ok: true, path: true }];
    function see(seg, kind, name, v, path) {
      out.push({ seg: seg, kind: kind, name: name, what: scopeWords(tree, v), ok: visibleFrom(tree, v.scope, from), path: path });
    }
    var chain = [], t = target(tree, pr), s = findStruct(tree, pr);
    for (var id = pr.mod; id > 0; id = tree.mods[id].parent) chain.unshift(tree.mods[id]);
    chain.forEach(function (m) { see(m.name, 'module', m.name, m.vis, true); });
    if (pr.kind === 'call') { see(t.name + '()', 'function', t.name, t.vis, true); return out; }
    see(s.name, 'struct', s.name, s.vis, true);
    if (pr.kind === 'field') see('.' + t.name, 'field', t.name, t.vis, false);
    if (pr.kind === 'method') see('.' + t.name + '()', 'method', t.name, t.vis, false);
    if (pr.kind === 'assoc') see('::' + t.name + '()', 'associated function', t.name, t.vis, false);
    if (pr.kind === 'build') s.fields.forEach(function (f) { see('{ ' + f.name + ' }', 'field', f.name, f.vis, false); });
    return out;
  }
  function message(code, pr, s, bad) {                         // rustc's wording for each code
    if (code === 'E0603') return bad[0].kind + ' `' + bad[0].name + '` is private';
    if (code === 'E0616') return 'field `' + pr.name + '` of struct `' + s.name + '` is private';
    if (code === 'E0624') return bad[0].kind + ' `' + pr.name + '` is private';
    var n = bad.map(function (x) { return x.name; }), many = n.length > 1;   // E0451: one error names them all
    return (many ? 'fields ' : 'field ') + list(n) + ' of struct `' + s.name + '` ' + (many ? 'are' : 'is') + ' private';
  }
  // what rustc reports for this access when it is the only code in module `from` (or in another crate)
  function check(tree, from, pr) {
    var steps = stepsOf(tree, from, pr), bad = steps.filter(function (x) { return !x.ok; }), errors = [], masked = null;
    var path = bad.filter(function (x) { return x.path; }), own = bad.filter(function (x) { return !x.path; });
    function err(code, b) { return { code: code, msg: message(code, pr, findStruct(tree, pr), b) }; }
    if (path.length) errors.push(err('E0603', path));  // rustc names only the first private step
    if (own.length) {  // the field, method or literal itself
      var e = err({ field: 'E0616', method: 'E0624', assoc: 'E0624', build: 'E0451' }[pr.kind], own);
      if (e.code === 'E0451' && path.length) masked = e; else errors.push(e);  // a later pass, skipped once an error exists
    }
    return { ok: !errors.length, errors: errors, steps: steps, masked: masked, code: errors.map(function (x) { return x.code; }).join(' + ') };
  }

  function region(tree, pr) {
    return { ext: check(tree, EXT, pr).ok, mods: tree.mods.map(function (m) { return check(tree, m.id, pr).ok; }) };
  }
  // how the probe reads as Rust, written in `from`
  function probeCode(tree, from, pr) {
    var base = from === EXT ? 'mylib' : 'crate';
    var path = pathOf(tree, pr.mod).replace(/^crate/, base);
    var s = pr.kind === 'call' ? null : findStruct(tree, pr);
    if (pr.kind === 'call') return path + '::' + pr.name + '();';
    if (pr.kind === 'assoc') return path + '::' + pr.s + '::' + pr.name + '(…);';
    if (pr.kind === 'build') return 'let v = ' + path + '::' + pr.s + ' { ' + s.fields.map(function (f) { return f.name + ': …'; }).join(', ') + ' };';
    var head = '/* v: &mut ' + path + '::' + pr.s + ' */ ';
    return head + (pr.kind === 'field' ? 'v.' + pr.name + ' = …;' : 'v.' + pr.name + '(…);');
  }

  /* ───────────── editing and drawing helpers ───────────── */
  function rows(tree) {
    var out = [];
    (function walk(id) {
      var at = out.length;
      out.push({ id: id, depth: tree.mods[id].depth, end: at });
      tree.mods[id].kids.forEach(walk);
      out[at].end = out.length - 1;
    })(0);
    return out;
  }
  function renderVis(v) { return v.text ? v.text + ' ' : ''; }
  function render(tree) {
    var out = [];
    function mod(id, ind) {
      var m = tree.mods[id], pad = new Array(ind + 1).join('    ');
      m.order.forEach(function (e) {
        if (e.k === 'fn') {
          var f = m.fns.filter(function (x) { return x.name === e.name; })[0];
          out.push(pad + renderVis(f.vis) + 'fn ' + f.name + f.sig + ' { … }');
        } else if (e.k === 'struct') {
          var s = m.structs.filter(function (x) { return x.name === e.name; })[0];
          out.push(pad + renderVis(s.vis) + 'struct ' + s.name + ' {');
          s.fields.forEach(function (f) { out.push(pad + '    ' + renderVis(f.vis) + f.name + ': ' + f.ty + ','); });
          out.push(pad + '}');
          if (s.methods.length) {
            out.push(pad + 'impl ' + s.name + ' {');
            s.methods.forEach(function (x) { out.push(pad + '    ' + renderVis(x.vis) + 'fn ' + x.name + x.sig + ' { … }'); });
            out.push(pad + '}');
          }
        } else {
          var c = tree.mods[e.id];
          if (!c.order.length) { out.push(pad + renderVis(c.vis) + 'mod ' + c.name + ' {}'); return; }
          out.push(pad + renderVis(c.vis) + 'mod ' + c.name + ' {');
          mod(e.id, ind + 1);
          out.push(pad + '}');
        }
      });
    }
    mod(0, 0);
    return out.join('\n') + '\n';
  }
  function visOptions(tree, pr) {
    var home = pr.mod, opts = ['private'];
    if (home > 0) opts.push('pub(super)');
    var anc = [];
    for (var a = tree.mods[home].parent; a > 0; a = tree.mods[a].parent) anc.unshift(a);
    anc.forEach(function (a) { opts.push('pub(in ' + pathOf(tree, a) + ')'); });
    opts.push('pub(crate)', 'pub');
    return opts;
  }
  function visIndex(tree, pr) {                               // the option naming the item's own region
    var v = target(tree, pr).vis, o = visOptions(tree, pr), i = o.indexOf(v.text || 'private');
    if (i >= 0 || v.k === 'self') return Math.max(i, 0);          // pub(self) is private
    for (i = o.length - 1; i > 0; i--) if (resolveVis(tree, visFromText(o[i]), pr.mod) === v.scope) return i;   // pub(in crate) is pub(crate), …
    return 0;
  }
  function visFromText(text) {
    if (!text || text === 'private') return { k: 'priv', text: '' };
    if (text === 'pub') return { k: 'pub', text: 'pub' };
    var m = /^pub\((crate|self|super|in (.+))\)$/.exec(text);
    if (!m) throw new Error('not a visibility: ' + text);
    return m[2] ? { k: 'in', segs: m[2].split('::'), text: text } : { k: m[1], text: text };
  }
  function setVis(tree, pr, text) {
    var copy = parse(render(tree)), t = target(copy, pr), nv = visFromText(text);
    nv.line = t.vis.line;
    t.vis = nv;
    return parse(render(copy));                                // re-parse: resolves (and validates) the new scope
  }

  /* ───────────── what the widget shows (pure: a 2D context in, strings out) ───────────── */
  // everything the readout and the KPI cards say about probe `pr` tried from `from`
  function describe(tree, pr, from) {
    var res = check(tree, from, pr), rg = region(tree, pr), cnt = rg.mods.filter(Boolean).length;
    var where = from === EXT ? 'another crate' : pathOf(tree, from), bad = res.steps.filter(function (s) { return !s.ok; })[0];
    var lines = ['from ' + where + ':  ' + probeCode(tree, from, pr)];
    res.steps.forEach(function (s) { lines.push('  ' + (s.ok ? '✓ ' : '✗ ') + (s.seg + '              ').slice(0, 14) + s.what); });
    lines.push(res.ok ? 'rustc 1.98.1: compiles.' : res.errors.map(function (e) { return 'rustc 1.98.1: error[' + e.code + ']: ' + e.msg; }).join('\n'));
    if (res.masked) lines.push('(fix that, and rustc goes on to report error[' + res.masked.code + ']: ' + res.masked.msg + ')');
    lines.push('This access compiles from ' + cnt + ' of ' + tree.mods.length + ' modules' + (rg.ext ? ', and from other crates.' : ', and never from another crate.'));
    return { ok: res.ok, text: lines.join('\n'), where: where, verdict: res.ok ? 'compiles' : res.code,
             decided: bad ? bad.seg + ' — ' + bad.what.split(':')[0] : 'every step visible',
             count: cnt + ' of ' + tree.mods.length, ext: rg.ext ? 'yes' : 'no' };
  }
  // the module tree as rows (another crate on top), shaded where the probe compiles; `walk` = modules the slider visits
  function paint(ctx, W, H, tree, pr, from, walk, C) {
    var rg = region(tree, pr), rs = rows(tree), tv = target(tree, pr).vis;
    var list = [{ ext: true }].concat(rs), n = list.length, rh = Math.min(34, (H - 40) / n), x0 = 34;
    function Y(i) { return 10 + i * rh + rh / 2; }
    ctx.clearRect(0, 0, W, H); ctx.font = '12px ' + C.mono; ctx.textBaseline = 'middle';
    list.forEach(function (row, i) {
      var id = row.ext ? EXT : row.id, ok = row.ext ? rg.ext : rg.mods[row.id], y = Y(i), m = row.ext ? null : tree.mods[row.id];
      ctx.fillStyle = ok ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.07)';
      ctx.fillRect(x0, y - rh / 2 + 2, W - x0 - 8, rh - 4);
      var x = x0 + 10 + (row.ext ? 0 : row.depth * 22), name = row.ext ? 'another crate (sees this one as mylib)' : row.id === 0 ? 'crate' : 'mod ' + m.name;
      ctx.textAlign = 'left'; ctx.fillStyle = C.text; ctx.fillText(name, x, y);
      x += ctx.measureText(name).width + 8;
      if (m && row.id) { var vt = m.vis.text || 'private'; ctx.fillStyle = C.dim; ctx.fillText(vt, x, y); x += ctx.measureText(vt).width + 10; }
      if (!row.ext && row.id === pr.mod) {
        ctx.fillStyle = C.live;
        ctx.fillText('★ ' + (pr.kind === 'call' ? pr.name + '()' : pr.kind === 'build' ? pr.s + ' { … }' : pr.s + (pr.kind === 'assoc' ? '::' : '.') + pr.name), x, y);
      }
      ctx.textAlign = 'right'; ctx.fillStyle = ok ? C.good : C.err;
      ctx.fillText(ok ? '✓ compiles' : '✗ ' + check(tree, id, pr).code, W - 14, y);
      if (row.ext || walk.indexOf(row.id) >= 0) {
        ctx.beginPath(); ctx.arc(x0 - 8, y, 4, 0, 6.2832);
        if (id === from) { ctx.fillStyle = C.acc; ctx.fill(); } else { ctx.strokeStyle = C.dim; ctx.lineWidth = 1.2; ctx.stroke(); }
      }
      if (id === from) { ctx.strokeStyle = C.acc; ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y - rh / 2 + 2, W - x0 - 10, rh - 4); }
      if (row.ext) { ctx.strokeStyle = C.border; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0, y + rh / 2); ctx.lineTo(W - 8, y + rh / 2); ctx.stroke(); ctx.setLineDash([]); }
    });
    var a = tv.scope === 'world' ? 0 : 1 + rs.map(function (q) { return q.id; }).indexOf(tv.scope), b = tv.scope === 'world' ? n - 1 : 1 + rs[a - 1].end;
    ctx.fillStyle = C.live; ctx.fillRect(10, Y(a) - rh / 2 + 4, 4, Y(b) - Y(a) + rh - 8);
    ctx.textAlign = 'left'; ctx.fillText('▌ the region its own visibility names: ' + (tv.text || 'private'), 10, H - 14);
  }

  /* ───────────── the lesson's worked examples ───────────── */
  var MYVEC = function (lenVis) {
    return [
      'pub mod collections {',
      '    pub mod myvec {',
      '        pub struct MyVec {',
      '            ptr: NonNull<i32>,',
      '            cap: usize,',
      '            ' + lenVis + 'len: usize,',
      '        }',
      '        impl MyVec {',
      '            pub fn with_capacity(cap: usize) -> MyVec { … }',
      '            pub fn push(&mut self, x: i32) { … }',
      '            pub fn len(&self) -> usize { … }',
      '            fn grow(&mut self) { … }',
      '        }',
      '        mod tests {}',
      '    }',
      '    pub(crate) fn audit() { … }',
      '}',
      'mod app {}', ''].join('\n');
  };
  V.PRESETS = [
    { name: 'MyVec, private len', src: MYVEC(''), probe: 'MyVec · v.len = …', walk: 'crate::collections::myvec::tests', at: 1,
      note: 'Lesson 20\'s invariant, kept: only myvec and its tests module may write len.' },
    { name: 'MyVec, pub len (the mutant)', src: MYVEC('pub '), probe: 'MyVec · v.len = …', walk: 'crate::collections::myvec::tests', at: 0,
      note: 'pub len: every module, and every crate that depends on this one, may write len.' },
    { name: 'forging a MyVec literal', src: MYVEC(''), probe: 'MyVec · MyVec { ptr, cap, len }', walk: 'crate::collections::myvec::tests', at: 1,
      note: 'A private field also forbids the struct literal: outside code must call with_capacity.' },
    { name: 'pub(crate) stops at the crate', src: MYVEC(''), probe: 'fn · crate::collections::audit()', walk: 'crate::app', at: 0,
      note: 'pub(crate): every module of this crate, and nothing outside it.' },
    { name: 'pub(super) and a grandparent', src: [
      'mod a {', '    pub mod b {', '        pub(super) fn f() { … }', '    }', '    pub fn g() { … }', '}', 'pub fn h() { … }', ''].join('\n'),
      probe: 'fn · crate::a::b::f()', walk: 'crate::a::b', at: 1,
      note: 'The Reference\'s case: pub(super) on f in b reaches a (and b), not the crate root.' },
    { name: 'the Book\'s restaurant (listing 7-3)', src: [
      'mod front_of_house {', '    mod hosting {', '        fn add_to_waitlist() { … }', '    }', '}', 'pub fn eat_at_restaurant() { … }', ''].join('\n'),
      probe: 'fn · crate::front_of_house::hosting::add_to_waitlist()', walk: 'crate::front_of_house::hosting', at: 1,
      note: 'A parent cannot see into a child\'s private items: make hosting pub, then add_to_waitlist.' }
  ];

  V.parse = parse; V.render = render; V.probes = probes; V.check = check; V.region = region;
  V.rows = rows; V.probeCode = probeCode; V.setVis = setVis; V.visOptions = visOptions; V.visIndex = visIndex; V.target = target;
  V.describe = describe; V.paint = paint;
  root.Vis = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : this);
