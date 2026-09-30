/* patterns.js — a miniature of rustc's match checker, for the widget in Lesson 09.
 *
 * It answers the two questions the compiler asks of every `match`:
 *   exhaustive?  (if not: error E0004 and a list of witnesses — values no arm matches)
 *   reachable?   (for each arm, and each or-pattern alternative: the unreachable_patterns lint)
 *
 * The algorithm is the classic usefulness check on a matrix of patterns, arranged to reproduce rustc's
 * verdicts and witness lists (checked against rustc, see below):
 *   - the arms form a matrix, one row per arm; an or-pattern expands into one row per alternative;
 *   - to examine a column, split its type into constructors: those some row names ("present") and
 *     the rest ("missing" — only rows with a wildcard there can match them); u8 ranges are split
 *     at every range boundary seen in the column;
 *   - specialize the matrix by each constructor and recurse; a case that reaches the end with no
 *     unguarded row left is a witness; the first rows to reach the end are useful;
 *   - a guard never covers anything: its condition is not evaluated, so later rows stay useful;
 *   - rustc prints only the witnesses reached through the "missing" branch at the first column
 *     where something is missing; `allWitnesses` also keeps the unprinted ones, which
 *     together describe every uncovered value exactly.
 * Differential-tested against rustc: tools/rust_verify/09_patterns.js.
 *
 * API:
 *   Patterns.parseType('Option<(bool, u8)>')     -> type
 *   Patterns.parseArm('Some(true) if c', ty)       -> { pat, guard, src }   (throws Error on bad input)
 *   Patterns.check(ty, arms)                       -> { exhaustive, witnesses, allWitnesses, headline,
 *                                                       arms: [{ useful, redundant: [src] }], trace }
 *   Patterns.show(witness)                         -> the witness as rustc prints it
 *   Patterns.joinWitnesses([str])                  -> "`a`, `b` and `c`" / "... and N more", as in E0004
 *   Patterns.traceText(node)                       -> one line of the case-split trace (for the canvas)
 *   Patterns.unreachableList(result, arms)         -> ["arm 3 `Some(_)`", ...] for the unreachable lint
 *   Patterns.PRESETS, Patterns.printed(result), Patterns.explain(ty, arms, k, result)
 *                                                  -> the widget's examples, E0004's witness count, its readout lines
 */
(function (root) {
  'use strict';
  var P = {};

  /* ───────────── types ───────────── */
  function tyBool() { return { k: 'bool', name: 'bool' }; }
  function tyU8() { return { k: 'int', name: 'u8', lo: 0, hi: 256 }; }
  function tyTuple(items) {
    return { k: 'tuple', items: items, name: '(' + items.map(function (t) { return t.name; }).join(', ') + (items.length === 1 ? ',' : '') + ')' };
  }
  function tyEnum(name, prefix, variants) { return { k: 'enum', name: name, prefix: prefix, variants: variants }; }
  function tyOption(t) { return tyEnum('Option<' + t.name + '>', '', [{ n: 'None', f: [] }, { n: 'Some', f: [t] }]); }
  function tyResult(t, e) { return tyEnum('Result<' + t.name + ', ' + e.name + '>', '', [{ n: 'Ok', f: [t] }, { n: 'Err', f: [e] }]); }
  function tyLight() { return tyEnum('Light', 'Light::', [{ n: 'Off', f: [] }, { n: 'Red', f: [] }, { n: 'Amber', f: [] }, { n: 'Green', f: [tyBool()] }]); }

  function parseType(s) {
    var toks = String(s).match(/[A-Za-z_][A-Za-z0-9_]*|[<>(),]/g) || [], p = 0;
    function expect(x) { if (toks[p++] !== x) throw new Error('type: expected ' + x); }
    function ty() {
      var t = toks[p++];
      if (t === '(') {
        var items = [];
        while (toks[p] !== ')') { items.push(ty()); if (toks[p] === ',') p++; else break; }
        expect(')');
        return tyTuple(items);
      }
      if (t === 'bool') return tyBool();
      if (t === 'u8') return tyU8();
      if (t === 'Light') return tyLight();
      if (t === 'Option' || t === 'Result') {
        expect('<'); var a = ty(), b = null;
        if (t === 'Result') { expect(','); b = ty(); }
        expect('>');
        return t === 'Option' ? tyOption(a) : tyResult(a, b);
      }
      throw new Error('unknown type ' + t);
    }
    var r = ty();
    if (p !== toks.length) throw new Error('type: trailing tokens');
    return r;
  }

  /* ───────────── pattern syntax ───────────── */
  function lex(s) {
    var re = /\s*(=>|\.\.=|\.\.|::|[()|@,&{}\[\]!<>=-]|[0-9][0-9_]*(?:u8)?|[A-Za-z_][A-Za-z0-9_]*)/y, out = [], i = 0, m;
    while (i < s.length) {
      re.lastIndex = i; m = re.exec(s);
      if (!m) { if (/^\s*$/.test(s.slice(i))) break; throw new Error('unexpected character `' + s.slice(i).trim()[0] + '`'); }
      out.push(m[1]); i = re.lastIndex;
    }
    return out;
  }
  var KEYWORDS = { 'true': 1, 'false': 1, 'if': 1, 'match': 1, 'let': 1, 'ref': 1, 'mut': 1 };
  function isIdent(t) { return !!t && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && !KEYWORDS[t] && t !== '_'; }
  function isNum(t) { return !!t && /^[0-9]/.test(t); }

  function parsePat(toks) {
    var p = 0;
    function peek(k) { return toks[p + (k || 0)]; }
    function expect(x) { if (toks[p] !== x) throw new Error('expected `' + x + '`' + (toks[p] ? ', found `' + toks[p] + '`' : ' at the end')); p++; }
    function num() {
      var t = toks[p++];
      if (t === '-') throw new Error('u8 has no negative values');
      if (!isNum(t)) throw new Error('expected a number' + (t ? ', found `' + t + '`' : ''));
      return parseInt(t.replace(/_/g, '').replace(/u8$/, ''), 10);
    }
    function list() {                           // after '(' : items with an optional `..`
      var items = [], rest = -1, trailing = false;
      while (peek() !== ')') {
        if (peek() === undefined) throw new Error('missing `)`');
        if (peek() === '..' && (peek(1) === ',' || peek(1) === ')')) {
          if (rest >= 0) throw new Error('`..` can be used at most once');
          rest = items.length; p++;
        } else items.push(orPat());
        trailing = false;
        if (peek() === ',') { p++; trailing = true; } else break;
      }
      expect(')');
      return { items: items, rest: rest, trailing: trailing };
    }
    function orPat() {
      if (peek() === '|') p++;
      var alts = [atPat()];
      while (peek() === '|') { p++; alts.push(atPat()); }
      return alts.length === 1 ? alts[0] : { k: 'or', alts: alts };
    }
    function atPat() {
      if (isIdent(peek()) && peek(1) === '@') { var name = toks[p]; p += 2; return { k: 'bind', name: name, sub: atom() }; }
      return atom();
    }
    function atom() {
      var t = peek();
      if (t === undefined) throw new Error('expected a pattern');
      if (t === '(') {
        p++; var l = list();
        if (l.items.length === 1 && l.rest < 0 && !l.trailing) return { k: 'paren', inner: l.items[0] };
        return { k: 'tuple', items: l.items, rest: l.rest };
      }
      if (t === '..=') { p++; return { k: 'range', lo: null, hi: num(), incl: true }; }
      if (t === '..') { p++; return { k: 'range', lo: null, hi: num(), incl: false }; }
      if (t === '-') throw new Error('u8 has no negative values');
      if (isNum(t)) {
        var lo = num();
        if (peek() === '..=') { p++; return { k: 'range', lo: lo, hi: num(), incl: true }; }
        if (peek() === '..') { p++; if (isNum(peek()) || peek() === '-') return { k: 'range', lo: lo, hi: num(), incl: false }; return { k: 'range', lo: lo, hi: null, incl: false }; }
        return { k: 'lit', v: lo };
      }
      if (t === '_') { p++; return { k: 'wild' }; }
      if (t === 'true' || t === 'false') { p++; return { k: 'bool', v: t === 'true' }; }
      if (t === 'ref' || t === 'mut') throw new Error('`' + t + '` changes how a binding binds, not what it matches — leave it out here');
      if (t === '&') throw new Error('reference patterns (`&p`) are not part of this checker');
      if (isIdent(t)) {
        var path = [toks[p++]];
        while (peek() === '::') { p++; if (!isIdent(peek())) throw new Error('expected a name after `::`'); path.push(toks[p++]); }
        var args = null, rest = -1;
        if (peek() === '(') { p++; var l2 = list(); args = l2.items; rest = l2.rest; }
        if (peek() === '{') throw new Error('struct patterns `{ .. }` are not part of this checker');
        return { k: 'path', path: path, args: args, rest: rest };
      }
      throw new Error('unexpected `' + t + '`');
    }
    var r = orPat();
    if (p < toks.length) throw new Error('unexpected `' + toks[p] + '`');
    return r;
  }

  /* ───────────── lowering: syntax + type -> deconstructed pattern ───────────── */
  var uid = 0;
  function wildPat(src) { return { id: ++uid, k: 'wild', src: src || '_', useful: false }; }
  function ctorPat(c, fields, src) { return { id: ++uid, k: 'ctor', c: c, fields: fields, src: src, useful: false }; }
  function showRange(lo, hi) { return hi - lo === 1 ? String(lo) : lo + '..=' + (hi - 1); }

  function expandRest(items, rest, n, what) {
    if (rest < 0) {
      if (items.length !== n) throw new Error(what + ' has ' + n + ' field' + (n === 1 ? '' : 's') + ', the pattern has ' + items.length);
      return items;
    }
    if (items.length > n) throw new Error(what + ' has only ' + n + ' field' + (n === 1 ? '' : 's'));
    var out = items.slice(0, rest);
    for (var i = 0; i < n - items.length; i++) out.push({ k: 'wild' });
    return out.concat(items.slice(rest));
  }

  function lower(sp, ty) {
    switch (sp.k) {
      case 'paren': return lower(sp.inner, ty);
      case 'wild': return wildPat('_');
      case 'bind':
        if (!sp.sub) return wildPat(sp.name);
        var d = lower(sp.sub, ty); d.src = sp.name + ' @ ' + (sp.sub.k === 'or' ? '(' + d.src + ')' : d.src); return d;
      case 'or':
        var alts = sp.alts.map(function (a) { return lower(a, ty); });
        return { id: ++uid, k: 'or', alts: alts, src: alts.map(function (a) { return a.src; }).join(' | '), useful: false };
      case 'bool':
        if (ty.k !== 'bool') throw new Error('`' + sp.v + '` is a bool, but this position holds ' + ty.name);
        return ctorPat({ t: 'bool', v: sp.v }, [], String(sp.v));
      case 'lit': case 'range':
        if (ty.k !== 'int') throw new Error('a number cannot match ' + ty.name);
        var lo, hi, src;
        if (sp.k === 'lit') { lo = sp.v; hi = sp.v + 1; src = String(sp.v); }
        else {
          lo = sp.lo === null ? ty.lo : sp.lo;
          hi = sp.hi === null ? ty.hi : (sp.incl ? sp.hi + 1 : sp.hi);
          src = (sp.lo === null ? '' : sp.lo) + (sp.incl ? '..=' : '..') + (sp.hi === null ? '' : sp.hi);
          if (sp.lo !== null && sp.hi !== null && hi <= lo) throw new Error('`' + src + '` is empty: the lower bound must be ' + (sp.incl ? 'at most' : 'below') + ' the upper');
          if (sp.lo === null && hi <= lo) throw new Error('`' + src + '` is empty');
        }
        if (lo < ty.lo || (sp.k === 'lit' ? lo : (sp.hi === null ? lo : sp.hi)) > ty.hi - 1) throw new Error('`' + src + '` is out of range for u8 (0..=255)');
        return ctorPat({ t: 'int', lo: lo, hi: hi }, [], src);
      case 'tuple':
        if (ty.k !== 'tuple') throw new Error('a tuple pattern cannot match ' + ty.name);
        var its = expandRest(sp.items, sp.rest, ty.items.length, 'this tuple');
        var fs = its.map(function (x, i) { return lower(x, ty.items[i]); });
        return ctorPat({ t: 'tup' }, fs, '(' + srcList(sp.items, sp.rest, fs, its) + (ty.items.length === 1 && sp.rest < 0 ? ',' : '') + ')');
      case 'path':
        return lowerPath(sp, ty);
    }
    throw new Error('unsupported pattern');
  }
  function srcList(items, rest, fs, expanded) {
    // re-print the fields as written (keeping `..` where the user wrote it)
    var out = [], j = 0;
    for (var i = 0; i < items.length; i++) {
      if (i === rest) out.push('..');
      while (expanded[j] !== items[i]) j++;
      out.push(fs[j].src); j++;
    }
    if (rest === items.length) out.push('..');
    return out.join(', ');
  }
  function lowerPath(sp, ty) {
    var path = sp.path, name = path[path.length - 1], qual = path.slice(0, -1).join('::');
    if (ty.k !== 'enum') {
      if (path.length === 1 && sp.args === null) return wildPat(name);          // a binding
      throw new Error('`' + path.join('::') + '` is a variant, but this position holds ' + ty.name);
    }
    var idx = -1;
    ty.variants.forEach(function (v, i) { if (v.n === name) idx = i; });
    var okQual = ty.prefix ? (qual + '::' === ty.prefix) : (qual === '' || qual === ty.name.replace(/<.*$/, ''));
    if (idx < 0 || !okQual) {
      if (path.length === 1 && sp.args === null) {
        if (ty.prefix && idx >= 0) throw new Error('write `' + ty.prefix + name + '`: a bare `' + name + '` would be a new variable that matches everything');
        return wildPat(name);                                                   // a binding
      }
      throw new Error('`' + path.join('::') + '` is not a variant of ' + ty.name + ' (its variants: ' + ty.variants.map(function (v) { return ty.prefix + v.n; }).join(', ') + ')');
    }
    var v = ty.variants[idx], disp = ty.prefix + v.n;
    if (v.f.length === 0) {
      if (sp.args !== null) throw new Error('`' + disp + '` carries no payload: write it without parentheses');
      return ctorPat({ t: 'var', i: idx }, [], disp);
    }
    if (sp.args === null) throw new Error('`' + disp + '` carries a payload: write `' + disp + '(_)`');
    var its = expandRest(sp.args, sp.rest, v.f.length, '`' + disp + '`');
    var fs = its.map(function (x, i) { return lower(x, v.f[i]); });
    return ctorPat({ t: 'var', i: idx }, fs, disp + '(' + srcList(sp.args, sp.rest, fs, its) + ')');
  }

  function parseArm(line, ty) {
    var s = String(line).replace(/\/\/.*$/, '');
    var cut = s.indexOf('=>'); if (cut >= 0) s = s.slice(0, cut);
    s = s.replace(/,\s*$/, '').trim();
    if (!s) return null;
    var toks = lex(s), depth = 0, gi = -1;
    for (var i = 0; i < toks.length; i++) {
      if (toks[i] === '(') depth++; else if (toks[i] === ')') depth--;
      else if (toks[i] === 'if' && depth === 0) { gi = i; break; }
    }
    var ptoks = gi >= 0 ? toks.slice(0, gi) : toks;
    if (gi >= 0 && gi === toks.length - 1) throw new Error('`if` needs a condition after it');
    var pat = lower(parsePat(ptoks), ty);
    return { pat: pat, guard: gi >= 0, src: s };
  }

  /* ───────────── constructors of a type ───────────── */
  var MISSING = { t: 'missing' };
  function arity(ty, c) {
    if (c === MISSING) return 0;
    if (ty.k === 'tuple') return ty.items.length;
    if (ty.k === 'enum') return ty.variants[c.i].f.length;
    return 0;
  }
  function fieldTypes(ty, c) {
    if (c === MISSING) return [];
    if (ty.k === 'tuple') return ty.items;
    if (ty.k === 'enum') return ty.variants[c.i].f;
    return [];
  }
  function covers(head, c) {                   // does a row whose head is `head` match constructor c?
    if (head.k === 'wild') return true;
    if (c === MISSING) return false;
    var h = head.c;
    if (c.t === 'bool') return h.v === c.v;
    if (c.t === 'var') return h.i === c.i;
    if (c.t === 'tup') return true;
    if (c.t === 'int') return h.lo <= c.lo && c.hi <= h.hi;
    return false;
  }
  // split the column into present and missing constructors, in rustc's order
  function splitCol(ty, heads) {
    var present = [], missing = [], seen = heads.filter(function (h) { return h.k === 'ctor'; }).map(function (h) { return h.c; });
    if (ty.k === 'bool') {
      [true, false].forEach(function (b) {
        (seen.some(function (c) { return c.v === b; }) ? present : missing).push({ t: 'bool', v: b });
      });
    } else if (ty.k === 'enum') {
      ty.variants.forEach(function (v, i) {
        (seen.some(function (c) { return c.i === i; }) ? present : missing).push({ t: 'var', i: i });
      });
    } else if (ty.k === 'tuple') {
      (seen.length ? present : missing).push({ t: 'tup' });
    } else if (ty.k === 'int') {
      // parenthesis matching over the boundaries of the seen ranges (rustc's IntRange::split)
      var bd = [];
      seen.forEach(function (c) { bd.push([c.lo, 1]); bd.push([c.hi, -1]); });
      bd.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      bd.push([ty.hi, 0]);
      var prev = ty.lo, count = 0;
      bd.forEach(function (b) {
        if (b[0] !== prev) (count > 0 ? present : missing).push({ t: 'int', lo: prev, hi: b[0] });
        prev = b[0]; count += b[1];
      });
    }
    return { present: present, missing: missing };
  }

  /* ───────────── witnesses: construction and printing ───────────── */
  var WILD = { k: 'wild' };
  function wctor(ty, c, fields) { return { k: 'ctor', ty: ty, c: c, fields: fields }; }
  function wildFrom(ty, c) { var f = []; for (var i = 0; i < arity(ty, c); i++) f.push(WILD); return wctor(ty, c, f); }
  function fmtU8(v) { return v === 255 ? 'u8::MAX' : v + '_u8'; }
  function show(w) {
    if (w.k === 'wild') return '_';
    var c = w.c, ty = w.ty;
    if (c.t === 'bool') return String(c.v);
    if (c.t === 'int') return c.hi - c.lo === 1 ? fmtU8(c.lo) : fmtU8(c.lo) + '..=' + fmtU8(c.hi - 1);
    if (c.t === 'tup') return '(' + w.fields.map(show).join(', ') + (w.fields.length === 1 ? ',' : '') + ')';
    var v = ty.variants[c.i];
    return ty.prefix + v.n + (v.f.length ? '(' + w.fields.map(show).join(', ') + ')' : '');
  }
  function ctorLabel(ty, c) {                  // compact label for the trace
    if (c === MISSING) return 'missing';
    if (c.t === 'bool') return String(c.v);
    if (c.t === 'int') return showRange(c.lo, c.hi);
    if (c.t === 'tup') return '(..)';
    return ty.prefix + ty.variants[c.i].n + (ty.variants[c.i].f.length ? '(..)' : '');
  }

  /* ───────────── the usefulness algorithm ───────────── */
  function pushRow(M, row) {                   // expand an or-pattern at the head into one row per alternative
    var h = row.pats[0];
    if (h && h.k === 'or') {
      h.alts.forEach(function (alt) {
        pushRow(M, { pats: [alt].concat(row.pats.slice(1)), arm: row.arm, guard: row.guard, parent: row.parent, useful: false });
      });
    } else M.rows.push(row);
  }

  function specialize(M, c, ctorRelevant) {
    var col = M.cols[0], ty = col.ty, n = arity(ty, c);
    var sub = fieldTypes(ty, c).map(function (t, i) { return { ty: t, pos: col.pos + '.' + i, scrut: false }; });
    var assign = {}; for (var k in M.assign) assign[k] = M.assign[k];
    assign[col.pos] = { ty: ty, c: c, kids: sub.map(function (s) { return s.pos; }) };
    var S = { rows: [], cols: sub.concat(M.cols.slice(1)), relevant: M.relevant && ctorRelevant, depth: M.depth + 1, assign: assign };
    M.rows.forEach(function (r, i) {
      var h = r.pats[0];
      if (!covers(h, c)) return;
      var fields = [];
      if (h.k === 'wild') { for (var j = 0; j < n; j++) fields.push(wildPat()); }
      else if (c !== MISSING) fields = h.fields;
      pushRow(S, { pats: fields.concat(r.pats.slice(1)), arm: r.arm, guard: r.guard, parent: i, useful: false });
    });
    return S;
  }

  function renderValue(assign, pos) {
    var e = assign[pos];
    if (!e) return '·';
    if (e.missing) return e.missing;
    var ty = e.ty, c = e.c, kids = e.kids.map(function (k) { return renderValue(assign, k); });
    if (c.t === 'bool') return String(c.v);
    if (c.t === 'int') return showRange(c.lo, c.hi);
    if (c.t === 'tup') return '(' + kids.join(', ') + (kids.length === 1 ? ',' : '') + ')';
    var v = ty.variants[c.i];
    return ty.prefix + v.n + (v.f.length ? '(' + kids.join(', ') + ')' : '');
  }
  function armsOf(rows) { var s = []; rows.forEach(function (r) { if (s.indexOf(r.arm) < 0) s.push(r.arm); }); return s.sort(function (a, b) { return a - b; }); }

  function record(M, st) {                   // one line of the trace per matrix examined
    var node = { depth: M.depth, value: renderValue(M.assign, 'r'), arms: armsOf(M.rows), rel: M.relevant, arm: -1, guarded: [] };
    if (st.trace.length < st.limit) st.trace.push(node); else st.truncated = true;
    return node;
  }
  function describe(node, ty, sp) {
    node.kind = 'split'; node.ty = ty.name;
    node.present = sp.present.map(function (c) { return ctorLabel(ty, c); });
    node.missing = sp.missing.map(function (c) { return ctorLabel(ty, c); });
  }
  function missingLabel(ty, missing, individual) {
    var s = individual ? missing.map(function (mc) { return show(wildFrom(ty, mc)).replace(/_u8/g, '').replace(/u8::MAX/g, '255'); }) : ['_'];
    return s.length > 3 ? s.slice(0, 3).join(' | ') + ' | …' : s.join(' | ');
  }

  // ── the core: every witness of matrix M, each tagged with whether rustc prints it ──
  function baseCase(M, node) {               // no columns left: the first unguarded row takes this case
    var useful = true;
    M.rows.forEach(function (r) {
      r.useful = useful;
      if (useful) { if (!r.guard) node.arm = r.arm; else if (node.guarded.indexOf(r.arm) < 0) node.guarded.push(r.arm); }
      if (!r.guard) useful = false;          // a guard never covers, so the rows after it stay useful
    });
    node.kind = node.arm >= 0 ? 'covered' : 'uncovered';
    return useful ? [{ pats: [], rel: M.relevant }] : [];
  }
  function compute(M, st) {
    var node = record(M, st);
    if (M.cols.length === 0) return baseCase(M, node);
    var col = M.cols[0], ty = col.ty, out = [];
    var sp = splitCol(ty, M.rows.map(function (r) { return r.pats[0]; }));
    var individual = col.scrut || sp.present.length > 0;       // list the missing ones, or just say `_`
    describe(node, ty, sp);
    sp.present.concat(sp.missing.length ? [MISSING] : []).forEach(function (c) {
      // rustc prints what a present constructor finds only when nothing is missing in this column
      var S = specialize(M, c, c === MISSING || sp.missing.length === 0);
      if (c === MISSING) S.assign[col.pos] = { missing: missingLabel(ty, sp.missing, individual) };
      var w = compute(S, st);
      if (c === MISSING) {
        var heads = individual ? sp.missing.map(function (mc) { return wildFrom(ty, mc); }) : [WILD];
        heads.forEach(function (hd) { w.forEach(function (x) { out.push({ pats: [hd].concat(x.pats), rel: x.rel }); }); });
      } else {
        var n = arity(ty, c);
        w.forEach(function (x) { out.push({ pats: [wctor(ty, c, x.pats.slice(0, n))].concat(x.pats.slice(n)), rel: x.rel }); });
      }
      S.rows.forEach(function (cr) { if (cr.useful) M.rows[cr.parent].useful = true; });   // a row is useful if a child is
    });
    M.rows.forEach(function (r) { if (r.useful) r.pats[0].useful = true; });
    return out;
  }

  function isUseful(p) { return p.k === 'or' ? p.alts.some(isUseful) : p.useful; }
  function redundantIn(p, out) {             // outermost sub-patterns that never matched anything new
    if (!isUseful(p)) { out.push(p.src); return out; }
    (p.k === 'or' ? p.alts : (p.fields || [])).forEach(function (q) { redundantIn(q, out); });
    return out;
  }

  function joinWitnesses(list) {
    var q = list.map(function (s) { return '`' + s + '`'; });
    if (q.length === 1) return q[0];
    if (q.length <= 3) return q.slice(0, -1).join(', ') + ' and ' + q[q.length - 1];
    return q.slice(0, 3).join(', ') + ' and ' + (q.length - 3) + ' more';
  }

  function check(ty, arms, opts) {
    opts = opts || {};
    var st = { trace: [], limit: opts.traceLimit || 2000, truncated: false };
    var M = { rows: [], cols: [{ ty: ty, pos: 'r', scrut: true }], relevant: true, depth: 0, assign: {} };
    arms.forEach(function (a, i) {
      a.pat.useful = false;
      resetUseful(a.pat);
      pushRow(M, { pats: [a.pat], arm: i, guard: !!a.guard, parent: i, useful: false });
    });
    var wits = compute(M, st);
    var all = wits.map(function (w) { return show(w.pats[0]); });
    var printed = wits.filter(function (w) { return w.rel; }).map(function (w) { return show(w.pats[0]); });
    var exhaustive = wits.length === 0;
    var headline = null;
    if (!exhaustive) {
      headline = arms.length === 0 && ty.k !== 'enum'
        ? 'non-exhaustive patterns: type `' + ty.name + '` is non-empty'
        : 'non-exhaustive patterns: ' + joinWitnesses(printed) + ' not covered';
    }
    return {
      exhaustive: exhaustive, witnesses: printed, allWitnesses: all, headline: headline,
      arms: arms.map(function (a) { var u = isUseful(a.pat); return { useful: u, redundant: u ? redundantIn(a.pat, []) : [] }; }),
      trace: st.trace, truncated: st.truncated
    };
  }
  function resetUseful(p) {
    p.useful = false;
    (p.k === 'or' ? p.alts : (p.fields || [])).forEach(resetUseful);
  }

  /* ───────────── text for the widget: one trace line, and the unreachable list ───────────── */
  function traceText(nd) {
    var v = nd.depth === 0 ? 'x' : nd.value;
    var g = nd.guarded && nd.guarded.length ? '  (guarded arm ' + nd.guarded.map(function (x) { return x + 1; }).join(', ') + ' not counted)' : '';
    if (nd.kind === 'covered') return v + '   → arm ' + (nd.arm + 1) + g;
    if (nd.kind === 'uncovered') return v + '   ✗ no arm' + g + (nd.rel ? '' : '  (rustc does not print it)');
    if (nd.present.length === 1 && nd.present[0] === '(..)') return v + '   ' + nd.ty + ': one constructor, split its fields';
    return v + '   ' + nd.ty + ': ' + nd.present.join(' ') + (nd.missing.length ? (nd.present.length ? '  + ' : '') + 'missing ' + nd.missing.join(' ') : '');
  }
  function unreachableList(res, arms) {
    var out = [];
    res.arms.forEach(function (x, i) {
      if (!x.useful) out.push('arm ' + (i + 1) + ' `' + arms[i].src + '`');
      else x.redundant.forEach(function (s) { out.push('alternative `' + s + '` of arm ' + (i + 1)); });
    });
    return out;
  }

  /* ───────────── the widget's worked examples and readout (DOM-free, so Node can check each sentence) ───────────── */
  var PRESETS = [                   // one per type; the lesson's "What to try" walks them
    { ty: 'Option<bool>', arms: ['Some(true)', 'None', 'Some(false)', 'Some(_)'] },
    { ty: 'bool', arms: ['true', 'false', '_'] },
    { ty: '(bool, bool)', arms: ['(true, true)', '(false, _)', '(_, false)', '(true, _)'] },
    { ty: 'Option<Option<bool>>', arms: ['Some(Some(true))', 'Some(None)', 'None', 'Some(Some(false))'] },
    { ty: 'Light', arms: ['Light::Green(true)', 'Light::Green(false) if night', 'Light::Red | Light::Amber', 'Light::Off', '_'] },
    { ty: 'Result<u8, bool>', arms: ['Ok(0)', 'Ok(1..=254)', 'Err(true)', 'Ok(255)', 'Err(_)'] },
    { ty: 'u8', arms: ['0', '1..=9', 'n if n >= 100', '10..=99', '100..', '42'] }
  ];
  function printed(res) {           // how many witnesses the E0004 line names (none for "type `T` is non-empty")
    return res.exhaustive || / is non-empty$/.test(res.headline) ? 0 : res.witnesses.length;
  }
  function explain(ty, arms, k, res) {
    var used = arms.slice(0, k), n = printed(res);
    var L = ['match x { … }  where x: ' + ty.name + ', using ' + (k === arms.length ? 'all ' + k : 'the first ' + k + ' of ' + arms.length) + ' arms'];
    if (res.exhaustive) L.push('exhaustive: rustc accepts this match.');
    else {
      L.push('error[E0004]: ' + res.headline);
      L.push('every uncovered case (a disjoint list): ' + res.allWitnesses.map(function (s) { return '`' + s + '`'; }).join(', '));
      if (n && n < res.allWitnesses.length) L.push('rustc prints ' + n + ' of ' + res.allWitnesses.length + ': where a column has constructors no arm names, it reports only the cases under those.');
    }
    unreachableList(res, used).forEach(function (u) { L.push('warning: unreachable pattern: ' + u + ' (earlier arms take everything it matches)'); });
    L.push(res.trace.length + ' cases examined' + (used.some(function (a) { return a.guard; }) ? '; an arm with a guard never counts as covering.' : '.'));
    return L;
  }

  P.PRESETS = PRESETS;
  P.printed = printed;
  P.explain = explain;
  P.parseType = parseType;
  P.parseArm = parseArm;
  P.check = check;
  P.show = show;
  P.joinWitnesses = joinWitnesses;
  P.traceText = traceText;
  P.unreachableList = unreachableList;
  root.Patterns = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : this);
