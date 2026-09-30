/* minirust.js — a miniature Rust: parser, ownership & borrow checker, and interpreter.
 * Used by the widgets of Lessons 03-08 ("Rust from the Contract Up").
 *
 * WHAT IT DOES
 *   check   parses a small Rust subset (fn / struct / impl, let, &, &mut, loops, methods on String and Vec,
 *           lifetimes in signatures), lowers every function to a control-flow graph and runs the analyses
 *           the real checker runs: liveness, move / initialisation dataflow, region inference by subset
 *           constraints, loans in scope, two-phase borrows, universal regions for signatures.
 *   run     interprets the same programs: places are cells, String / Vec / Box are handles to heap records,
 *           and every drop, move, free and print is recorded with a snapshot of the stack and the heap.
 *
 * WHY IT CAN BE TRUSTED
 *   Both halves are differential-tested against rustc 1.98.1 (edition 2024):
 *     tools/rust_verify/borrowck_fuzz.js   random programs: the set of (error code, line) must match rustc's
 *     tools/rust_verify/drop_fuzz.js       random programs: stdout (the drop order) must match the real run
 *   It is a teaching model of the algorithm, not a Rust compiler: anything outside the subset is reported
 *   as "not supported by the mini checker" instead of being guessed.
 *
 * API   MiniRust.check(src)    -> { ok, errors:[{code,msg,line,fn,loanLine,useLine,kind}], parseError }
 *       MiniRust.analyze(src)  -> { fns:[graph, locals, loans, regions, liveness ...], errors, parseError }
 *       MiniRust.run(src, {conds:[...]})  -> { events:[{k,line,text,snap}], out:[lines], error, exit }
 *       MiniRust.flow(src) / flowAll(src) -> per-line liveness, loans in scope and the B / A / U points of every error (Lesson 07)
 *       MiniRust.sigs(src)    -> every signature as written and with all lifetimes spelled out, and the elision rule that fired (Lesson 08)
 */
(function (root) {
  'use strict';
  var MR = {};
  /* ───────────────────────────── lexer ───────────────────────────── */
  function lex(src) {
    var toks = [], i = 0, line = 1, n = src.length;
    var P2 = ['->', '::', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '..', '=>'];
    function push(t, v, l) { toks.push({ t: t, v: v, line: l }); }
    while (i < n) {
      var c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
        i += 2; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        var j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        push('id', src.slice(i, j), line); i = j; continue;
      }
      if (/[0-9]/.test(c)) {
        var k = i + 1;
        while (k < n && /[0-9_]/.test(src[k])) k++;
        while (k < n && /[A-Za-z0-9]/.test(src[k])) k++;       // integer suffix (u8, usize, i32 …)
        push('int', src.slice(i, k), line); i = k; continue;
      }
      if (c === '"') {
        var m = i + 1, s = '', l0 = line;
        while (m < n && src[m] !== '"') {
          if (src[m] === '\\') { s += src[m] + src[m + 1]; m += 2; continue; }
          if (src[m] === '\n') line++;
          s += src[m]; m++;
        }
        push('str', s, l0); i = m + 1; continue;
      }
      if (c === "'") {
        if (src[i + 1] === '\\') { var e = src.indexOf("'", i + 3); push('char', src.slice(i + 1, e), line); i = e + 1; continue; }
        if (src[i + 2] === "'") { push('char', src[i + 1], line); i += 3; continue; }
        var q = i + 1;
        while (q < n && /[A-Za-z0-9_]/.test(src[q])) q++;
        push('life', src.slice(i, q), line); i = q; continue;      // "'a"
      }
      var two = src.substr(i, 2);
      if (P2.indexOf(two) >= 0) { push('p', two, line); i += 2; continue; }
      push('p', c, line); i++;
    }
    push('eof', '', line);
    return toks;
  }

  /* ───────────────────────────── parser ───────────────────────────── */
  function MRError(msg, line) { this.message = msg; this.line = line; this.isMR = true; }
  MRError.prototype = Object.create(Error.prototype);

  var INT_NAMES = { i32: 1, usize: 1, u32: 1, i64: 1, u64: 1, u8: 1, i8: 1, u16: 1, i16: 1, isize: 1, u128: 1, i128: 1 };

  function parse(src) {
    var toks = lex(src), p = 0;
    function peek(k) { return toks[Math.min(p + (k || 0), toks.length - 1)]; }
    function isP(v, k) { var t = peek(k); return (t.t === 'p' || t.t === 'id') && t.v === v; }
    function next() { return toks[p++]; }
    function fail(msg) { throw new MRError(msg, peek().line); }
    function expect(v) { if (!isP(v)) fail('expected `' + v + '` but found `' + (peek().v || 'end of input') + '`'); return next(); }
    function accept(v) { if (isP(v)) { next(); return true; } return false; }
    function ident() { var t = next(); if (t.t !== 'id') { p--; fail('expected a name but found `' + (t.v || 'end of input') + '`'); } return t.v; }

    /* ── types ── */
    function parseType() {
      var t = peek();
      if (isP('&')) {
        next();
        var lt = null; if (peek().t === 'life') lt = next().v;
        var mut = accept('mut');
        return { k: 'ref', mut: mut, lt: lt, to: parseType() };
      }
      if (isP('(')) { next(); expect(')'); return { k: 'unit' }; }
      if (t.t === 'id') {
        var name = next().v;
        if (INT_NAMES[name]) return { k: 'int', name: name };
        if (name === 'bool') return { k: 'bool' };
        if (name === 'char') return { k: 'char' };
        if (name === 'str') return { k: 'str' };
        if (name === 'String') return { k: 'String' };
        if (name === 'Vec') { expect('<'); var el = parseType(); expect('>'); return { k: 'Vec', el: el }; }
        if (name === 'Box') { expect('<'); var bel = parseType(); expect('>'); return { k: 'Box', el: bel }; }
        var targs = [];
        if (isP('<')) {                              // Foo<'a>
          next();
          while (!isP('>')) { if (peek().t === 'life') targs.push(next().v); else fail('only lifetime arguments are supported on user types'); accept(','); }
          expect('>');
        }
        return { k: 'adt', name: name, lts: targs };
      }
      fail('expected a type but found `' + (t.v || 'end of input') + '`');
    }

    /* ── expressions ── */
    var noStruct = 0;
    function parseExpr() { return parseAssign(); }

    function parseAssign() {
      var line = peek().line;
      var lhs = parseRange();
      if (isP('=') && !isP('==')) { next(); var rhs = parseAssign(); return { k: 'assign', lhs: lhs, rhs: rhs, line: line }; }
      if (isP('+=') || isP('-=') || isP('*=') || isP('/=')) { var op = next().v; var r2 = parseAssign(); return { k: 'assign', lhs: lhs, rhs: r2, op: op[0], line: line }; }
      return lhs;
    }
    function parseRange() {
      var line = peek().line;
      var a = parseBin(0);
      if (isP('..')) { next(); var b = parseBin(0); return { k: 'range', a: a, b: b, line: line }; }
      return a;
    }
    var PREC = [['||'], ['&&'], ['==', '!=', '<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
    function parseBin(lv) {
      if (lv >= PREC.length) return parseUnary();
      var line = peek().line;
      var a = parseBin(lv + 1);
      for (;;) {
        var t = peek();
        if (t.t === 'p' && PREC[lv].indexOf(t.v) >= 0) {
          // do not treat `&&` after an expression as a binary op when it can only be part of `&&x`? (never after an operand)
          next();
          var b = parseBin(lv + 1);
          a = { k: 'bin', op: t.v, a: a, b: b, line: line };
        } else break;
      }
      return a;
    }
    function parseUnary() {
      var line = peek().line;
      if (isP('*')) { next(); return { k: 'un', op: '*', e: parseUnary(), line: line }; }
      if (isP('!')) { next(); return { k: 'un', op: '!', e: parseUnary(), line: line }; }
      if (isP('-')) { next(); return { k: 'un', op: '-', e: parseUnary(), line: line }; }
      if (isP('&&')) { next(); var inner = { k: 'addr', mut: accept('mut'), e: parseUnary(), line: line }; return { k: 'addr', mut: false, e: inner, line: line }; }
      if (isP('&')) { next(); var mut = accept('mut'); return { k: 'addr', mut: mut, e: parseUnary(), line: line }; }
      return parsePostfix();
    }
    function parseArgs() {
      expect('(');
      var args = [];
      var save = noStruct; noStruct = 0;
      while (!isP(')')) { args.push(parseExpr()); if (!accept(',')) break; }
      noStruct = save;
      expect(')');
      return args;
    }
    function parsePostfix() {
      var e = parsePrimary();
      for (;;) {
        var line = peek().line;
        if (isP('.') && !isP('..')) {
          next();
          var nm = next();
          if (nm.t === 'int') { e = { k: 'field', e: e, name: nm.v, line: line }; continue; }
          if (nm.t !== 'id') fail('expected a field or method name');
          if (isP('(')) { e = { k: 'mcall', recv: e, name: nm.v, args: parseArgs(), line: line }; }
          else e = { k: 'field', e: e, name: nm.v, line: line };
          continue;
        }
        if (isP('[')) { next(); var save = noStruct; noStruct = 0; var idx = parseExpr(); noStruct = save; expect(']'); e = { k: 'index', e: e, idx: idx, line: line }; continue; }
        break;
      }
      return e;
    }
    function parseBlockOrFail() { if (!isP('{')) fail('expected `{`'); return parseBlock(); }
    function parsePrimary() {
      var t = peek(), line = t.line;
      if (t.t === 'int') { next(); return { k: 'int', v: t.v, line: line }; }
      if (t.t === 'str') { next(); return { k: 'str', v: t.v, line: line }; }
      if (t.t === 'char') { next(); return { k: 'char', v: t.v, line: line }; }
      if (isP('(')) {
        next();
        if (accept(')')) return { k: 'unit', line: line };
        var save = noStruct; noStruct = 0;
        var e = parseExpr(); noStruct = save; expect(')');
        return { k: 'paren', e: e, line: line };
      }
      if (isP('{')) { return { k: 'block', b: parseBlock(), line: line }; }
      if (isP('true') || isP('false')) { next(); return { k: 'bool', v: t.v === 'true', line: line }; }
      if (isP('if')) return parseIf();
      if (isP('while')) { next(); noStruct++; var c = parseExpr(); noStruct--; return { k: 'while', cond: c, body: parseBlockOrFail(), line: line }; }
      if (isP('loop')) { next(); return { k: 'loop', body: parseBlockOrFail(), line: line }; }
      if (isP('for')) {
        next(); var mutv = accept('mut'); var nm = ident(); expect('in');
        noStruct++; var it = parseExpr(); noStruct--;
        return { k: 'for', name: nm, mut: mutv, iter: it, body: parseBlockOrFail(), line: line };
      }
      if (isP('break')) { next(); return { k: 'break', line: line }; }
      if (isP('continue')) { next(); return { k: 'continue', line: line }; }
      if (isP('return')) {
        next(); var val = null;
        if (!isP(';') && !isP('}')) val = parseExpr();
        return { k: 'return', e: val, line: line };
      }
      if (t.t === 'id') {
        // path or macro or struct literal
        var segs = [next().v];
        while (isP('::')) { next(); segs.push(ident()); }
        if (isP('!') && segs.length === 1 && !isP('!=')) {
          next();
          var name = segs[0];
          if (name === 'println' || name === 'print' || name === 'assert' || name === 'assert_eq') {
            expect('('); var fmt = null, args = [];
            var sv = noStruct; noStruct = 0;
            if (peek().t === 'str') { fmt = next().v; }
            while (accept(',')) { if (isP(')')) break; args.push(parseExpr()); }
            noStruct = sv;
            expect(')');
            return { k: 'macro', name: name, fmt: fmt, args: args, line: line };
          }
          if (name === 'vec') {
            expect('['); var items = []; var sv2 = noStruct; noStruct = 0;
            while (!isP(']')) { items.push(parseExpr()); if (!accept(',')) break; }
            noStruct = sv2; expect(']');
            return { k: 'vec', items: items, line: line };
          }
          fail('unsupported macro `' + name + '!`');
        }
        if (isP('(')) { return { k: 'call', path: segs, args: parseArgs(), line: line }; }
        if (isP('{') && !noStruct && /^[A-Z]/.test(segs[segs.length - 1])) {
          next(); var fields = []; var sv3 = noStruct; noStruct = 0;
          while (!isP('}')) { var fnm = ident(); var fe; if (accept(':')) fe = parseExpr(); else fe = { k: 'path', segs: [fnm], line: line }; fields.push({ n: fnm, e: fe }); if (!accept(',')) break; }
          noStruct = sv3; expect('}');
          return { k: 'slit', name: segs[segs.length - 1], fields: fields, line: line };
        }
        return { k: 'path', segs: segs, line: line };
      }
      fail('unexpected `' + (t.v || 'end of input') + '`');
    }
    function parseIf() {
      var line = peek().line; expect('if');
      noStruct++; var c = parseExpr(); noStruct--;
      var then = parseBlockOrFail(), els = null;
      if (isP('else')) {
        next();
        if (isP('if')) els = parseIf(); else els = { k: 'block', b: parseBlockOrFail(), line: peek().line };
      }
      return { k: 'if', cond: c, then: then, els: els, line: line };
    }

    /* ── statements / blocks ── */
    function blockLike(e) { return e.k === 'if' || e.k === 'while' || e.k === 'loop' || e.k === 'for' || e.k === 'block'; }
    function parseBlock() {
      var line = peek().line;
      expect('{');
      var stmts = [], tail = null;
      while (!isP('}')) {
        if (peek().t === 'eof') fail('unclosed `{`');
        if (accept(';')) continue;
        var s = parseStmt();
        if (s.k === 'expr' && s.tailCandidate) {
          if (isP('}')) { tail = s.e; break; }
          s.tailCandidate = false;
        }
        stmts.push(s);
      }
      var endLine = peek().line;
      expect('}');
      return { stmts: stmts, tail: tail, line: line, endLine: endLine };
    }
    function parseStmt() {
      var t = peek(), line = t.line;
      if (isP('let')) {
        next(); var mut = accept('mut'); var nm = ident(); var ty = null, init = null;
        if (accept(':')) ty = parseType();
        if (accept('=')) init = parseExpr();
        expect(';');
        return { k: 'let', name: nm, mut: mut, ty: ty, init: init, line: line };
      }
      if (isP('fn') || isP('struct') || isP('impl') || isP('use') || isP('#')) fail('items inside function bodies are not supported here');
      var e;
      if (isP('if') || isP('while') || isP('loop') || isP('for') || isP('{')) {
        // a block-like expression in statement position ends the statement: `if c { .. } *r += 1;` is two statements
        e = parsePrimary();
        if (accept(';')) return { k: 'expr', e: e, line: line, semi: true };
        return { k: 'expr', e: e, line: line, semi: false, tailCandidate: true };
      }
      e = parseExpr();
      if (accept(';')) return { k: 'expr', e: e, line: line, semi: true };
      if (blockLike(e)) return { k: 'expr', e: e, line: line, semi: false, tailCandidate: true };
      if (isP('}')) return { k: 'expr', e: e, line: line, semi: false, tailCandidate: true };
      fail('expected `;` but found `' + (peek().v || 'end of input') + '`');
    }

    /* ── items ── */
    function parseFn(attrs, owner) {
      var line = peek().line;
      expect('fn'); var name = ident();
      var lts = [], outlives = [];
      if (isP('<')) {
        next();
        while (!isP('>')) {
          var lt = next(); if (lt.t !== 'life') fail('only lifetime generics are supported');
          lts.push(lt.v);
          if (accept(':')) { do { outlives.push([lt.v, next().v]); } while (accept('+')); }
          accept(',');
        }
        expect('>');
      }
      expect('(');
      var params = [], selfKind = null, selfLt = null;
      while (!isP(')')) {
        var pl = peek().line;
        if (isP('self') || (isP('mut') && isP('self', 1))) {
          var m0 = accept('mut'); next(); selfKind = 'val'; params.push({ name: 'self', mut: m0, ty: null, isSelf: true, line: pl });
        } else if (isP('&') && (isP('self', 1) || (isP('mut', 1) && isP('self', 2)) || (peek(1).t === 'life' && (isP('self', 2) || (isP('mut', 2) && isP('self', 3)))))) {
          next(); var slt = null; if (peek().t === 'life') slt = next().v;
          var sm = accept('mut'); next();
          selfKind = sm ? 'mut' : 'ref'; selfLt = slt;
          params.push({ name: 'self', mut: false, ty: null, isSelf: true, selfMut: sm, selfLt: slt, line: pl });
        } else {
          var pm = accept('mut'); var pn = ident(); expect(':'); var pty = parseType();
          params.push({ name: pn, mut: pm, ty: pty, line: pl });
        }
        if (!accept(',')) break;
      }
      expect(')');
      var ret = null;
      if (accept('->')) ret = parseType();
      if (isP('where')) {
        next();
        while (peek().t === 'life') { var a = next().v; expect(':'); do { outlives.push([a, next().v]); } while (accept('+')); if (!accept(',')) break; }
      }
      var body = null;
      if (!accept(';')) body = parseBlock();          // prelude signatures have no body
      return { k: 'fn', name: name, lts: lts, outlives: outlives, params: params, selfKind: selfKind, selfLt: selfLt, ret: ret, body: body, line: line, owner: owner || null };
    }
    function parseItem() {
      var attrs = { derive: [] };
      while (isP('#')) {
        next(); accept('!'); expect('['); var an = ident();
        if (an === 'derive') { expect('('); while (!isP(')')) { attrs.derive.push(ident()); accept(','); } expect(')'); }
        else { while (!isP(']')) next(); }
        expect(']');
      }
      if (isP('pub')) next();
      var line = peek().line;
      if (isP('fn')) return parseFn(attrs, null);
      if (isP('use')) { while (!isP(';')) next(); next(); return null; }
      if (isP('struct')) {
        next(); var name = ident(); var lts = [];
        if (isP('<')) { next(); while (!isP('>')) { lts.push(next().v); accept(','); } expect('>'); }
        var fields = [];
        if (accept(';')) return { k: 'struct', name: name, lts: lts, fields: fields, derive: attrs.derive, line: line };
        expect('{');
        while (!isP('}')) { if (isP('pub')) next(); var fnm = ident(); expect(':'); fields.push({ name: fnm, ty: parseType() }); if (!accept(',')) break; }
        expect('}');
        return { k: 'struct', name: name, lts: lts, fields: fields, derive: attrs.derive, line: line };
      }
      if (isP('impl')) {
        next(); var ilts = [];
        if (isP('<')) { next(); while (!isP('>')) { ilts.push(next().v); accept(','); } expect('>'); }
        var first = parseType(), trait = null, target = first;
        if (accept('for')) { trait = first; target = parseType(); }
        expect('{'); var fns = [];
        while (!isP('}')) { if (isP('pub')) next(); fns.push(parseFn({ derive: [] }, target)); }
        expect('}');
        return { k: 'impl', lts: ilts, trait: trait, target: target, fns: fns, line: line };
      }
      fail('expected an item (`fn`, `struct`, `impl`) but found `' + (peek().v || 'end of input') + '`');
    }
    var items = [];
    while (peek().t !== 'eof') { var it = parseItem(); if (it) items.push(it); }
    return { items: items };
  }
  /* ───────────────────────────── types & the world ───────────────────────────── */
  function tyStr(t) {
    if (!t) return '?';
    switch (t.k) {
      case 'int': return t.name || 'i32';
      case 'bool': return 'bool'; case 'char': return 'char'; case 'unit': return '()'; case 'str': return 'str';
      case 'String': return 'String'; case 'never': return '!';
      case 'Vec': return 'Vec<' + tyStr(t.el) + '>';
      case 'Box': return 'Box<' + tyStr(t.el) + '>';
      case 'ref': return '&' + (t.lt ? t.lt + ' ' : '') + (t.mut ? 'mut ' : '') + tyStr(t.to);
      case 'adt': return t.name + (t.lts && t.lts.length ? '<' + t.lts.join(', ') + '>' : '');
      case 'iter': return t.kind === 'shared' ? 'Iter' : t.kind === 'mut' ? 'IterMut' : 'IntoIter';
    }
    return '?';
  }
  function hasRegion(t) { return !!t && (t.k === 'ref' || (t.k === 'iter' && t.kind !== 'own') || (t.k === 'adt' && t.lts && t.lts.length > 0)); }

  function World(prog) {
    this.structs = {}; this.fns = {}; this.impls = {}; this.drops = {}; this.errors = [];
    var self = this;
    prog.items.forEach(function (it) {
      if (it.k === 'struct') self.structs[it.name] = it;
    });
    prog.items.forEach(function (it) {
      if (it.k === 'fn') self.fns[it.name] = it;
      if (it.k === 'impl') {
        var key = implKey(it.target);
        if (it.trait && it.trait.name === 'Drop') { self.drops[key] = it; }
        self.impls[key] = self.impls[key] || {};
        it.fns.forEach(function (f) { self.impls[key][f.name] = f; });
      }
    });
  }
  function implKey(t) {
    if (t.k === 'Vec') return 'Vec'; if (t.k === 'adt') return t.name;
    return t.k;
  }
  World.prototype.isCopy = function (t) {
    switch (t.k) {
      case 'int': case 'bool': case 'char': case 'unit': case 'never': return true;
      case 'ref': return !t.mut;
      case 'adt': { var s = this.structs[t.name]; return !!s && s.derive.indexOf('Copy') >= 0; }
      default: return false;
    }
  };
  World.prototype.needsDrop = function (t) {
    if (!t) return false;                 // a `let r;` that is never assigned has no type yet
    switch (t.k) {
      case 'String': case 'Vec': case 'Box': return true;
      case 'iter': return t.kind === 'own';
      case 'adt': {
        if (this.drops[t.name]) return true;
        var s = this.structs[t.name]; if (!s) return false;
        for (var i = 0; i < s.fields.length; i++) if (this.needsDrop(s.fields[i].ty)) return true;
        return false;
      }
      default: return false;
    }
  };
  World.prototype.field = function (t, name) {
    if (t.k === 'Box' && name === '*') return t.el;          // the target of a Box behaves like a field of it
    if (t.k !== 'adt') return null;
    var s = this.structs[t.name]; if (!s) return null;
    for (var i = 0; i < s.fields.length; i++) if (s.fields[i].name === name) return s.fields[i].ty;
    return null;
  };

  /* prelude: the standard-library surface the mini language knows, written as signatures */
  var PRELUDE_SRC = [
    'impl String {',
    '  fn push_str(&mut self, s: &str); fn push(&mut self, c: char); fn len(&self) -> usize; fn is_empty(&self) -> bool;',
    '  fn clear(&mut self); fn clone(&self) -> String; fn as_str(&self) -> &str;',
    '}',
    'impl str { fn len(&self) -> usize; fn is_empty(&self) -> bool; fn to_string(&self) -> String; }',
    'impl Vec<T> {',
    '  fn push(&mut self, x: T); fn len(&self) -> usize; fn is_empty(&self) -> bool; fn clear(&mut self);',
    '  fn clone(&self) -> Vec<T>; fn insert(&mut self, i: usize, x: T); fn remove(&mut self, i: usize) -> T;',
    '  fn iter(&self) -> Iter; fn iter_mut(&mut self) -> IterMut; fn truncate(&mut self, n: usize);',
    '}',
  ].join('\n');
  /* ───────────────────────────── signatures ───────────────────────────── */
  function cloneTy(t) { return JSON.parse(JSON.stringify(t)); }
  function substTy(t, map) {
    if (!t) return t;
    if (t.k === 'adt' && map[t.name]) return cloneTy(map[t.name]);
    if (t.k === 'ref') return { k: 'ref', mut: t.mut, lt: t.lt, to: substTy(t.to, map) };
    if (t.k === 'Vec') return { k: 'Vec', el: substTy(t.el, map) };
    return t;
  }

  /* Resolve lifetimes of a signature (explicit or elided), applying the three elision rules.
     Result: params[i].ty carries concrete `lt` names on every reference; sig.ret likewise. */
  function makeSig(world, decl, ownerTy) {
    var sig = { name: decl.name, decl: decl, lts: decl.lts.slice(), outlives: decl.outlives.slice(), params: [], ret: null, selfKind: decl.selfKind, errs: [], owner: ownerTy || null, retTied: false, rule: 0, fresh: [] };
    var counter = 0, inputLts = [], paramLts = [];
    function fresh() { var n = '_' + (counter++); sig.fresh.push(n); return n; }
    function normLt(l) { return l === "'static" ? 'static' : l; }                  // the source spelling and the literal's region are one region
    function padPath(t) {                                                          // `Words` names `Words<'_>`: the parameters it hides are elided too
      var sd = world.structs[t.name], need = sd && sd.lts ? sd.lts.length : 0;
      t.lts = t.lts || []; while (t.lts.length < need) t.lts.push("'_");
    }
    decl.params.forEach(function (p) {
      if (p.isSelf) {
        var st = ownerTy ? cloneTy(ownerTy) : { k: 'adt', name: 'Self', lts: [] };
        if (decl.selfKind === 'val') { sig.params.push({ name: 'self', ty: st, mut: p.mut, isSelf: true }); }
        else {
          var lt = p.selfLt || fresh();
          inputLts.push(lt);
          sig.params.push({ name: 'self', ty: { k: 'ref', mut: decl.selfKind === 'mut', lt: lt, to: st }, mut: false, isSelf: true, selfLt: lt });
        }
        return;
      }
      var ty = cloneTy(p.ty), mark = inputLts.length;
      (function fill(t) {
        if (t.k === 'ref') { t.lt = t.lt && t.lt !== "'_" ? normLt(t.lt) : fresh(); inputLts.push(t.lt); fill(t.to); }
        else if (t.k === 'Vec') fill(t.el);
        else if (t.k === 'adt' && t.lts) { padPath(t); t.lts = t.lts.map(function (l) { if (l === "'_") { l = fresh(); } l = normLt(l); inputLts.push(l); return l; }); }
      })(ty);
      sig.params.push({ name: p.name, ty: ty, mut: p.mut });
      paramLts.push(inputLts.slice(mark).filter(function (l, i, a) { return a.indexOf(l) === i; }));
    });
    if (decl.ret) {
      var rt = cloneTy(decl.ret);
      var distinct = inputLts.filter(function (l, i) { return inputLts.indexOf(l) === i; });
      var selfLt = null; sig.params.forEach(function (p) { if (p.isSelf && p.selfLt) selfLt = p.selfLt; });
      var elide = function () {
        if (selfLt) { sig.rule = sig.rule || 3; return selfLt; }
        var bearing = paramLts.filter(function (set) { return set.length > 0; });     // rule 2 counts parameters: two that both say 'a are still two
        if (bearing.length === 1 && bearing[0].length === 1) { sig.rule = sig.rule || 2; return bearing[0][0]; }
        sig.rule = 'none';
        var zip = [], pi = 0;
        sig.params.forEach(function (p) { if (p.isSelf) return; if (paramLts[pi] && paramLts[pi].length) zip.push({ name: p.name, n: paramLts[pi].length }); pi++; });
        var head = 'this function\'s return type contains a borrowed value', note;
        if (!zip.length) note = head + ', but there is no value for it to be borrowed from';
        else if (zip.length === 1) note = head + ', but the signature does not say which one of `' + zip[0].name + '`\'s ' + zip[0].n + ' lifetimes it is borrowed from';
        else if (distinct.length === 1) note = head + ' with an elided lifetime, but the lifetime cannot be derived from the arguments';
        else {
          var items = zip.map(function (z) { return z.n === 1 ? '`' + z.name + '`' : 'one of `' + z.name + '`\'s ' + z.n + ' lifetimes'; });
          note = head + ', but the signature does not say whether it is borrowed from ' + (items.length === 2 ? items[0] + ' or ' + items[1] : items.slice(0, -1).join(', ') + ', or ' + items[items.length - 1]);
        }
        if (!sig.errs.length) sig.errs.push({ code: 'E0106', msg: 'missing lifetime specifier', line: decl.line, note: note });
        return '_err';
      };
      (function fill(t) {
        if (t.k === 'ref') { t.lt = t.lt && t.lt !== "'_" ? normLt(t.lt) : elide(); fill(t.to); }
        else if (t.k === 'Vec') fill(t.el);
        else if (t.k === 'adt') {
          if (t.name === 'Iter' || t.name === 'IterMut') { sig.retTied = true; t.__iter = t.name === 'Iter' ? 'shared' : 'mut'; t.lt = elide(); }
          else if (t.lts) { padPath(t); t.lts = t.lts.map(function (l) { return l === "'_" ? elide() : normLt(l); }); }
        }
      })(rt);
      sig.ret = rt;
    }
    return sig;
  }

  /* ───────────────────────────── lowering ───────────────────────────── */
  var TY_INT = { k: 'int' }, TY_BOOL = { k: 'bool' }, TY_UNIT = { k: 'unit' }, TY_CHAR = { k: 'char' };
  function P(l, p) { return { l: l, p: p || [] }; }
  function placeStr(F, pl) {
    var s = F.locals[pl.l].name || ('_' + pl.l);
    for (var i = 0; i < pl.p.length; i++) {
      var pr = pl.p[i];
      if (pr.k === 'd') s = '*' + s; else s = s + '.' + pr.n;
    }
    // (*r).f prints as r.f ; the target of a Box, b.*, prints as *b
    return s.replace(/^\*(\w+)\.(\w+)$/, '$1.$2').replace(/^(\w+)\.\*$/, '*$1');
  }

  function lowerFn(world, decl, sig, allSigs) {
    var F = { world: world, decl: decl, sig: sig, nodes: [], locals: [], regions: [], edges: [], loans: [], errs: [], scopes: [], loops: [], cur: -1, univ: {}, retLocal: null, name: decl.name };
    function err(code, msg, line, extra) { var e = { code: code, msg: msg, line: line, curNode: F.cur }; if (extra) for (var k in extra) e[k] = extra[k]; F.errs.push(e); return e; }
    function unsupported(msg, line) { throw new MRError('not supported by the mini checker: ' + msg, line); }

    /* regions */
    function newRegion(name, kind) { F.regions.push({ id: F.regions.length, name: name, kind: kind || 'var' }); return F.regions.length - 1; }
    function flow(from, to) { if (from >= 0 && to >= 0 && from !== to) F.edges.push([from, to, F.lineHint || 0]); }
    function univ(name) { if (F.univ[name] === undefined) F.univ[name] = newRegion(name, 'univ'); return F.univ[name]; }

    /* nodes */
    function newNode(op, line) { var n = { id: F.nodes.length, op: op, line: line, succ: [], pred: [] }; F.nodes.push(n); if (line) F.lineHint = line; return n; }
    function link(a, b) { F.nodes[a].succ.push(b); F.nodes[b].pred.push(a); }
    function emit(op, line) { var n = newNode(op, line); if (F.cur >= 0) link(F.cur, n.id); F.cur = n.id; return n; }

    /* locals & scopes */
    function newLocal(name, ty, opts) {
      opts = opts || {};
      var l = { id: F.locals.length, name: name, ty: ty, mut: !!opts.mut, temp: !!opts.temp, line: opts.line || 0, rv: -1, borrowed: false, param: !!opts.param, tp: null };
      if (hasRegion(ty)) l.rv = newRegion(name || ('_' + l.id), 'local');
      F.locals.push(l);
      return l;
    }
    function pushScope(kind) { F.scopes.push({ kind: kind, names: {}, locals: [] }); return F.scopes.length - 1; }
    function exitLocals(s, line) {
      for (var i = s.locals.length - 1; i >= 0; i--) {
        var l = F.locals[s.locals[i]];
        if (l.temp && !l.borrowed && !world.needsDrop(l.ty)) continue;
        if (world.needsDrop(l.ty)) emit({ k: 'drop', local: l.id }, line);
        emit({ k: 'sdead', local: l.id }, line);
      }
    }
    function popScope(line) { var s = F.scopes.pop(); if (F.cur >= 0) exitLocals(s, line); }
    function exitScopesTo(depth, line) { if (F.cur < 0) return; for (var i = F.scopes.length - 1; i >= depth; i--) exitLocals(F.scopes[i], line); }
    function declare(name, ty, opts, scopeIdx) {
      var l = newLocal(name, ty, opts);
      var sc = F.scopes[scopeIdx === undefined ? F.scopes.length - 1 : scopeIdx];
      sc.locals.push(l.id);
      if (name) sc.names[name] = l.id;
      return l;
    }
    function bind(name, l, scopeIdx) { F.scopes[scopeIdx === undefined ? F.scopes.length - 1 : scopeIdx].names[name] = l.id; }
    function lookup(name) {
      for (var i = F.scopes.length - 1; i >= 0; i--) if (F.scopes[i].names[name] !== undefined) return F.locals[F.scopes[i].names[name]];
      return null;
    }
    function stmtScopeIdx() { for (var i = F.scopes.length - 1; i >= 0; i--) if (F.scopes[i].kind === 'stmt') return i; return F.scopes.length - 1; }
    function newTemp(ty, ext) {
      var idx = stmtScopeIdx();
      if (ext) { for (var j = idx - 1; j >= 0; j--) if (F.scopes[j].kind === 'block' || F.scopes[j].kind === 'fn') { idx = j; break; } }
      return declare(null, ty, { temp: true }, idx);
    }

    /* loans */
    function newLoan(place, mut, twoPhase, line) {
      var loan = { id: F.loans.length, node: -1, place: place, mut: mut, twoPhase: !!twoPhase && !world.noTwoPhase, act: -1, line: line, rv: newRegion('loan' + F.loans.length, 'loan') };
      F.loans.push(loan);
      F.locals[place.l].borrowed = true;
      // supporting prefixes: reborrowing through a reference keeps that reference's region alive
      var l = F.locals[place.l];
      if (l.rv >= 0) flow(l.rv, loan.rv);       // `&'s T` is well-formed only if what T holds (or, through `*r`, r itself) outlives 's
      return loan;
    }

    /* ── types helpers ── */
    function resolveTy(t) { return t; }
    function isCopy(t) { return world.isCopy(t); }
    function derefTy(t) { return t.k === 'ref' ? t.to : null; }

    /* ── method lookup ── */
    var PRELUDE_SIGS = allSigs.prelude;
    function lookupMethod(baseTy, name) {
      var key = implKey(baseTy);
      var userTbl = world.impls[key];
      if (userTbl && userTbl[name]) return allSigs.user[key + '::' + name];
      if (allSigs.prelude[key + '::' + name]) return allSigs.prelude[key + '::' + name];
      return null;
    }

    /* ── pure typer for receivers / lvalues ── */
    function typeOfExpr(e) {
      switch (e.k) {
        case 'paren': return typeOfExpr(e.e);
        case 'int': return TY_INT; case 'bool': return TY_BOOL; case 'char': return TY_CHAR; case 'unit': return TY_UNIT;
        case 'str': return { k: 'ref', mut: false, to: { k: 'str' }, lt: 'static' };
        case 'path': { if (e.segs.length === 1) { var l = lookup(e.segs[0]); if (l) return l.ty || TY_INT; } throw new MRError('cannot find value `' + e.segs.join('::') + '` in this scope', e.line); }
        case 'field': { var t = typeOfExpr(e.e); while (t.k === 'ref') t = t.to; var f = world.field(t, e.name); if (!f) throw new MRError('no field `' + e.name + '` on type `' + tyStr(t) + '`', e.line); return f; }
        case 'un': { var it = typeOfExpr(e.e); if (e.op === '*') { if (it.k === 'Box') return it.el; if (it.k !== 'ref') throw new MRError('type `' + tyStr(it) + '` cannot be dereferenced', e.line); return it.to; } return e.op === '!' ? it : it; }
        case 'index': { var bt = typeOfExpr(e.e); while (bt.k === 'ref') bt = bt.to; if (bt.k !== 'Vec') throw new MRError('cannot index into a value of type `' + tyStr(bt) + '`', e.line); return bt.el; }
        case 'addr': return { k: 'ref', mut: e.mut, lt: null, to: typeOfExpr(e.e) };
        case 'mcall': {
          var rt = typeOfExpr(e.recv), base = rt; while (base.k === 'ref') base = base.to;
          var sg = lookupMethod(base, e.name);
          if (!sg) throw new MRError('no method named `' + e.name + '` found for `' + tyStr(base) + '`', e.line);
          return methodRet(sg, base);
        }
        case 'call': return callRet(e);
        case 'bin': { if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].indexOf(e.op) >= 0) return TY_BOOL; return TY_INT; }
        case 'macro': return TY_UNIT;
        case 'vec': { var el = e.items.length ? typeOfExpr(e.items[0]) : TY_INT; return { k: 'Vec', el: el }; }
        case 'slit': return { k: 'adt', name: e.name, lts: [] };
        case 'block': case 'if': return TY_UNIT;
        default: return TY_UNIT;
      }
    }
    function methodRet(sg, base) {
      var m = {}; if (base.k === 'Vec') m.T = base.el;
      var r = sg.ret ? substTy(sg.ret, m) : TY_UNIT;
      if (r.k === 'adt' && r.__iter) return { k: 'iter', kind: r.__iter, el: base.k === 'Vec' ? base.el : TY_INT, lt: r.lt };
      return r;
    }
    function callRet(e) {
      var s = e.path;
      var last = s[s.length - 1];
      if (s.length === 1 && last === 'drop') return TY_UNIT;
      if (s.length === 1 && last === 'cond' && !allSigs.userFns.cond) return TY_BOOL;
      if (s.length >= 2 && s[s.length - 2] === 'String' && (last === 'from' || last === 'new')) return { k: 'String' };
      if (s.length >= 2 && s[s.length - 2] === 'Box' && last === 'new') return { k: 'Box', el: typeOfExpr(e.args[0]) };
      if (s.length >= 2 && s[s.length - 2] === 'Vec' && (last === 'new' || last === 'with_capacity')) return { k: 'Vec', el: TY_INT, __infer: true };
      if (s.length >= 2 && s[s.length - 2] === 'mem') {
        if (last === 'take') { var a = typeOfExpr(e.args[0]); return a.k === 'ref' ? a.to : a; }
        if (last === 'replace') { var b = typeOfExpr(e.args[0]); return b.k === 'ref' ? b.to : b; }
        return TY_UNIT;      // swap, forget
      }
      if (s.length === 1 && allSigs.userFns[last]) return allSigs.userFns[last].ret || TY_UNIT;
      if (s.length === 2 && allSigs.user[s[0] + '::' + last]) return allSigs.user[s[0] + '::' + last].ret || TY_UNIT;
      throw new MRError('cannot find function `' + s.join('::') + '` in this scope', e.line);
    }

    /* ── lvalues ── */
    function isPlaceExpr(e) {
      switch (e.k) {
        case 'paren': return isPlaceExpr(e.e);
        case 'path': return e.segs.length === 1 && !!lookup(e.segs[0]);
        case 'field': case 'index': return true;
        case 'un': return e.op === '*';
        default: return false;
      }
    }
    function placeMutable(pl) {
      var l = F.locals[pl.l], ty = l.ty, mut = l.mut || l.temp;
      var why = null;
      for (var i = 0; i < pl.p.length; i++) {
        var pr = pl.p[i];
        if (pr.k === 'd') {
          if (ty.k !== 'ref') { ty = ty; continue; }
          mut = ty.mut; why = ty.mut ? null : 'ref'; ty = ty.to;
        } else { ty = world.field(ty, pr.n) || ty; }
      }
      return { mutable: mut, why: why };
    }
    function valueAsPlace(e) {
      var r = rvalue(e, {});
      var t = newTemp(r.ty);
      emitAssign(t, r, e.line);
      return { place: P(t.id), ty: r.ty };
    }
    function derefPlace(b, line) {
      if (b.ty.k === 'Box') return { place: P(b.place.l, b.place.p.concat([{ k: 'f', n: '*' }])), ty: b.ty.el };
      if (b.ty.k !== 'ref') throw new MRError('type `' + tyStr(b.ty) + '` cannot be dereferenced', line);
      return { place: P(b.place.l, b.place.p.concat([{ k: 'd' }])), ty: b.ty.to };
    }
    function lvalue(e, mutCtx) {
      switch (e.k) {
        case 'paren': return lvalue(e.e, mutCtx);
        case 'path': {
          var l = lookup(e.segs[0]);
          if (!l) throw new MRError('cannot find value `' + e.segs[0] + '` in this scope', e.line);
          return { place: P(l.id), ty: l.ty };
        }
        case 'field': {
          var b = isPlaceExpr(e.e) ? lvalue(e.e, mutCtx) : valueAsPlace(e.e);
          while (b.ty.k === 'ref' || b.ty.k === 'Box') b = derefPlace(b, e.line);
          var ft = world.field(b.ty, e.name);
          if (!ft) throw new MRError('no field `' + e.name + '` on type `' + tyStr(b.ty) + '`', e.line);
          return { place: P(b.place.l, b.place.p.concat([{ k: 'f', n: e.name }])), ty: ft };
        }
        case 'un': {
          var ib = isPlaceExpr(e.e) ? lvalue(e.e, mutCtx) : valueAsPlace(e.e);
          return derefPlace(ib, e.line);
        }
        case 'index': {
          var base = isPlaceExpr(e.e) ? lvalue(e.e, mutCtx) : valueAsPlace(e.e);
          while (base.ty.k === 'ref') base = derefPlace(base, e.line);
          if (base.ty.k !== 'Vec') throw new MRError('cannot index into a value of type `' + tyStr(base.ty) + '`', e.line);
          // Index::index(&base, i) / IndexMut::index_mut(&mut base, i): an ordinary (not two-phase) autoref
          var refTy = { k: 'ref', mut: !!mutCtx, lt: null, to: base.ty };
          var t = newTemp(refTy);
          if (mutCtx) checkMutBorrow(base, e.line);
          var loan = newLoan(base.place, !!mutCtx, false, e.line);
          emitAssign(t, { rv: { k: 'ref', loan: loan.id, place: base.place, mut: !!mutCtx }, ty: refTy, link: function (d) { flow(loan.rv, d.rv); } }, e.line);
          var io = operand(e.idx, {});
          var resTy = { k: 'ref', mut: !!mutCtx, lt: null, to: base.ty.el };
          var r = newTemp(resTy);
          var sgRegion = newRegion('index', 'call');
          flow(t.rv, sgRegion);
          emitAssign(r, { rv: { k: 'call', callee: mutCtx ? 'index_mut' : 'index', ops: [{ k: 'move', place: P(t.id) }, io.op] }, ty: resTy, link: function (d) { flow(sgRegion, d.rv); } }, e.line);
          return { place: P(r.id, [{ k: 'd' }]), ty: base.ty.el, viaIndex: true };
        }
      }
      return null;
    }
    F.mutUses = {};       // local id -> [{line, cur}]  (borrows of an immutable local; grouped into one diagnostic later)
    function checkMutBorrow(lv, line) {
      var m = placeMutable(lv.place);
      if (m.mutable) return;
      var nm = placeStr(F, lv.place);
      if (m.why === 'ref') err('E0596', 'cannot borrow `' + nm + '` as mutable, as it is behind a `&` reference', line);
      else { (F.mutUses[lv.place.l] = F.mutUses[lv.place.l] || []).push({ line: line, cur: F.cur, name: nm }); }
    }

    /* ── assignment of an rvalue result into a local ── */
    function emitAssign(dest, rvres, line, destPlace) {
      var n = emit({ k: 'assign', dest: destPlace || (dest ? P(dest.id) : null), rv: rvres.rv }, line);
      if (rvres.rv.k === 'ref') { F.loans[rvres.rv.loan].node = n.id; }
      if (rvres.rv.k === 'call') {
        rvres.rv.ops.forEach(function (o) {
          if (o.place && o.place.p.length === 0 && F.locals[o.place.l].tp !== null) F.loans[F.locals[o.place.l].tp].act = n.id;
        });
      }
      if (dest && rvres.link) rvres.link(dest);
      return n;
    }

    /* ── operands ── */
    function konst(ty) { return { rv: { k: 'const' }, ty: ty, link: null }; }
    function useOperandOf(lv, ctx, line) {
      var ty = lv.ty;
      if (isCopy(ty)) return { op: { k: 'copy', place: lv.place }, ty: ty };
      if (ty.k === 'ref' && ty.mut && ctx.reborrowOk) {
        // implicit reborrow: `&mut *r`, two-phase (arguments and receivers only); an `&mut T` handed to a
        // parameter of type `&T` is coerced, i.e. reborrowed as shared: `&*r`
        var sharedT = !!ctx.sharedTarget;
        var rp = P(lv.place.l, lv.place.p.concat([{ k: 'd' }]));
        var rt = { k: 'ref', mut: !sharedT, lt: null, to: ty.to };
        var t = newTemp(rt);
        var loan = newLoan(rp, !sharedT, !sharedT, line);
        if (!sharedT) t.tp = loan.id;
        emitAssign(t, { rv: { k: 'ref', loan: loan.id, place: rp, mut: !sharedT }, ty: rt, link: function (d) { flow(loan.rv, d.rv); } }, line);
        return { op: { k: 'move', place: P(t.id) }, ty: rt };
      }
      // moving out from behind a reference / index is rejected
      if (lv.place.p.some(function (x) { return x.k === 'd'; })) {
        var nm = placeStr(F, lv.place);
        var first = null; var ty0 = F.locals[lv.place.l].ty;
        if (lv.viaIndex) err('E0507', 'cannot move out of index of `Vec<' + tyStr(ty) + '>`', line);
        else err('E0507', 'cannot move out of `' + nm + '` which is behind a ' + (ty0.k === 'ref' && ty0.mut ? 'mutable' : 'shared') + ' reference', line);
        return { op: { k: 'copy', place: lv.place }, ty: ty };
      }
      return { op: { k: 'move', place: lv.place }, ty: ty };
    }
    function operand(e, ctx) {
      ctx = ctx || {};
      if (e.k === 'paren') return operand(e.e, ctx);
      if (e.k === 'int' || e.k === 'bool' || e.k === 'char' || e.k === 'str' || e.k === 'unit') {
        return { op: { k: 'const' }, ty: typeOfExpr(e) };
      }
      if (isPlaceExpr(e)) {
        var lv = lvalue(e, false);
        var uo = useOperandOf(lv, ctx, e.line);
        // MIR reads a place with projections into a temporary before the call/operation that consumes it
        if (uo.op.place && uo.op.place.p.length > 0) {
          var tmp = newTemp(uo.ty);
          var fr = hasRegion(uo.ty) ? fieldRegion(uo.op.place) : -1;
          emitAssign(tmp, { rv: { k: 'use', op: uo.op }, ty: uo.ty, link: fr >= 0 ? function (d) { flow(fr, d.rv); } : null }, e.line);
          return { op: { k: isCopy(uo.ty) ? 'copy' : 'move', place: P(tmp.id) }, ty: uo.ty };
        }
        return uo;
      }
      var r = rvalue(e, ctx);
      if (r.rv.k === 'const') return { op: { k: 'const' }, ty: r.ty };
      var t = newTemp(r.ty);
      emitAssign(t, r, e.line);
      return { op: { k: isCopy(r.ty) ? 'copy' : 'move', place: P(t.id) }, ty: r.ty };
    }
    /* the region a reference read out of a field of `pl` comes from: what the struct holds */
    function fieldRegion(pl) {
      var b = F.locals[pl.l];
      if (b.innerRv !== undefined) return b.innerRv;                                   // through `self: &'1 W<'a>`: 'a
      if (b.ty && b.ty.k === 'adt' && b.rv >= 0 && pl.p.length && pl.p[0].k !== 'd') return b.rv;      // `w: W<'w>`: the struct's own region
      return -1;
    }
    function operandLocal(o) { return o.op && o.op.place && o.op.place.p.length === 0 ? F.locals[o.op.place.l] : null; }

    /* ── rvalues ── */
    function useRV(o) {
      var src = operandLocal(o), fr = -1;
      if (!src && o.op && o.op.place && o.op.place.p.length > 0 && hasRegion(o.ty)) fr = fieldRegion(o.op.place);      // a reference read out of a field
      return { rv: { k: 'use', op: o.op }, ty: o.ty, link: src && src.rv >= 0 ? function (d) { flow(src.rv, d.rv); } : (fr >= 0 ? function (d) { flow(fr, d.rv); } : null) };
    }
    function rvalue(e, ctx) {
      ctx = ctx || {};
      switch (e.k) {
        case 'int': case 'bool': case 'char': case 'str': case 'unit': return konst(typeOfExpr(e));
        case 'paren': return rvalue(e.e, ctx);
        case 'path': case 'field': case 'index': case 'un':
          if (isPlaceExpr(e)) { var lvp = lvalue(e, false); return useRV(useOperandOf(lvp, ctx, e.line)); }
          if (e.op === '!' || e.op === '-') { var ua = operand(e.e, {}); return { rv: { k: 'unop', a: ua.op }, ty: typeOfExpr(e), link: null }; }
          break;
        case 'bin': return lowerBin(e);
        case 'addr': return lowerAddr(e, ctx);
        case 'call': return lowerCall(e, ctx);
        case 'mcall': return lowerMCall(e, ctx);
        case 'macro': return lowerMacro(e);
        case 'vec': {
          var ops = e.items.map(function (it) { return operand(it, {}).op; });
          var elTy = e.items.length ? typeOfExpr(e.items[0]) : (ctx.want && ctx.want.k === 'Vec' ? ctx.want.el : TY_INT);
          return { rv: { k: 'aggr', ops: ops }, ty: { k: 'Vec', el: elTy }, link: null };
        }
        case 'slit': {
          var st = world.structs[e.name];
          if (!st) throw new MRError('cannot find struct `' + e.name + '` in this scope', e.line);
          var byName = {}; e.fields.forEach(function (f) { byName[f.n] = f.e; });
          var ops2 = [], flows = [];
          e.fields.forEach(function (f) { var o = operand(f.e, {}); ops2.push(o.op); var sl = operandLocal(o); if (sl && sl.rv >= 0) flows.push(sl.rv); });
          st.fields.forEach(function (f) { if (!byName[f.name]) err('E0063', 'missing field `' + f.name + '` in initializer of `' + e.name + '`', e.line); });
          return { rv: { k: 'aggr', ops: ops2 }, ty: { k: 'adt', name: e.name, lts: st.lts && st.lts.length ? st.lts.slice() : [] }, link: flows.length ? function (d) { flows.forEach(function (f) { flow(f, d.rv); }); } : null };
        }
        case 'assign': lowerAssign(e); return konst(TY_UNIT);
        case 'if': case 'block': case 'while': case 'loop': case 'for': case 'break': case 'continue': case 'return': {
          // statement-like expressions used for value
          var dest = { local: null };
          lowerControl(e, dest);
          if (dest.local) { return { rv: { k: 'use', op: { k: isCopy(dest.local.ty) ? 'copy' : 'move', place: P(dest.local.id) } }, ty: dest.local.ty, link: dest.local.rv >= 0 ? function (d) { flow(dest.local.rv, d.rv); } : null }; }
          return konst(TY_UNIT);
        }
      }
      throw new MRError('unsupported expression `' + e.k + '`', e.line);
    }

    function lowerBin(e) {
      var op = e.op;
      if (op === '&&' || op === '||') {
        var t = newTemp(TY_BOOL);
        var a = operand(e.a, {});
        emitAssign(t, { rv: { k: 'use', op: a.op }, ty: TY_BOOL }, e.line);
        var br = emit({ k: 'branch' }, e.line);
        var startB = newNode({ k: 'nop' }, e.line); link(br.id, startB.id); F.cur = startB.id;
        var b = operand(e.b, {});
        emitAssign(t, { rv: { k: 'use', op: b.op }, ty: TY_BOOL }, e.line);
        var join = newNode({ k: 'nop' }, e.line); link(F.cur, join.id); link(br.id, join.id); F.cur = join.id;
        return { rv: { k: 'use', op: { k: 'copy', place: P(t.id) } }, ty: TY_BOOL, link: null };
      }
      var cmp = ['==', '!=', '<', '>', '<=', '>='].indexOf(op) >= 0;
      // comparing non-Copy values borrows both operands
      var ta = typeOfExpr(e.a);
      if (cmp && !isCopy(ta) && ta.k !== 'ref' && isPlaceExpr(e.a) && isPlaceExpr(e.b)) {
        var la = lvalue(e.a, false), lb = lvalue(e.b, false);
        var borrow = function (lv) {
          var loan = newLoan(lv.place, false, false, e.line); var rt = { k: 'ref', mut: false, lt: null, to: lv.ty }; var tt = newTemp(rt);
          emitAssign(tt, { rv: { k: 'ref', loan: loan.id, place: lv.place, mut: false }, ty: rt, link: function (d) { flow(loan.rv, d.rv); } }, e.line);
          return { k: 'move', place: P(tt.id) };
        };
        var oa = borrow(la), ob = borrow(lb);
        return { rv: { k: 'binop', a: oa, b: ob }, ty: TY_BOOL, link: null };
      }
      var x = operand(e.a, {}), y = operand(e.b, {});
      return { rv: { k: 'binop', a: x.op, b: y.op }, ty: cmp ? TY_BOOL : x.ty, link: null };
    }

    function lowerAddr(e, ctx) {
      var inner = e.e;
      while (inner.k === 'paren') inner = inner.e;
      if (isPlaceExpr(inner)) {
        var lv = lvalue(inner, e.mut);
        if (e.mut) checkMutBorrow(lv, e.line);
        var loan = newLoan(lv.place, e.mut, false, e.line);
        var rt = { k: 'ref', mut: e.mut, lt: null, to: lv.ty };
        return { rv: { k: 'ref', loan: loan.id, place: lv.place, mut: e.mut }, ty: rt, link: function (d) { d.borrowOf = { place: lv.place, mut: e.mut }; flow(loan.rv, d.rv); } };
      }
      // borrow of a temporary; `let x = &temp;` extends the temporary to the end of the block
      var r = rvalue(inner, {});
      var t = newTemp(r.ty, ctx.letInit);
      emitAssign(t, r, e.line);
      var loan2 = newLoan(P(t.id), e.mut, false, e.line);
      return { rv: { k: 'ref', loan: loan2.id, place: P(t.id), mut: e.mut }, ty: { k: 'ref', mut: e.mut, lt: null, to: r.ty }, link: function (d) { flow(loan2.rv, d.rv); } };
    }

    function lowerMacro(e) {
      if (e.name === 'assert') { e.args.forEach(function (a) { operand(a, {}); }); return konst(TY_UNIT); }
      var items = e.args.slice();
      if (e.fmt) {
        var re = /\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_]*)(?::[^}]*)?\}/g, m;
        while ((m = re.exec(e.fmt))) if (m[1]) items.push({ k: 'path', segs: [m[1]], line: e.line });
      }
      var ops = [];
      items.forEach(function (it) {
        var inner = it; while (inner.k === 'paren') inner = inner.e;
        var lv;
        if (isPlaceExpr(inner)) lv = lvalue(inner, false);
        else { var r = rvalue(inner, {}); var tmp = newTemp(r.ty); emitAssign(tmp, r, e.line); lv = { place: P(tmp.id), ty: r.ty }; }
        var loan = newLoan(lv.place, false, false, e.line);
        var rt = { k: 'ref', mut: false, lt: null, to: lv.ty };
        var t = newTemp(rt);
        emitAssign(t, { rv: { k: 'ref', loan: loan.id, place: lv.place, mut: false }, ty: rt, link: function (d) { flow(loan.rv, d.rv); } }, e.line);
        ops.push({ k: 'move', place: P(t.id) });
      });
      return { rv: { k: 'call', callee: e.name, ops: ops, builtin: true }, ty: TY_UNIT, link: null };
    }

    /* instantiate a signature at a call site; returns region lookup */
    function instantiate(sg) {
      var C = {};
      function rvOf(name) { if (name === 'static') return univ('static'); if (C[name] === undefined) C[name] = newRegion('call:' + sg.name + ':' + name, 'call'); return C[name]; }
      sg.outlives.forEach(function (pr) { flow(rvOf(pr[0]), rvOf(pr[1])); });
      return rvOf;
    }
    function finishCall(sg, argOps, argTys, retTy, line, calleeName) {
      var rvOf = instantiate(sg);
      sg.params.forEach(function (p, i) {
        var pt = p.ty, src = pt && argOps[i] ? operandLocal({ op: argOps[i] }) : null;
        if (pt && pt.k === 'ref') {
          if (src && src.rv >= 0) flow(src.rv, rvOf(pt.lt));
          // `&'s mut W<'a>` given `&mut w` with `w: W<'w>`: what w holds is what 'a stands for (both ways behind `&mut`, which is invariant)
          if (src && src.borrowOf && pt.to.k === 'adt' && pt.to.lts && pt.to.lts.length) {
            var base = F.locals[src.borrowOf.place.l];
            if (base.rv >= 0) pt.to.lts.forEach(function (lt) { flow(base.rv, rvOf(lt)); if (pt.mut) flow(rvOf(lt), base.rv); });
          }
        } else if (pt && pt.k === 'adt' && pt.lts && pt.lts.length && src && src.rv >= 0) {
          pt.lts.forEach(function (lt) { flow(src.rv, rvOf(lt)); });
        }
      });
      var link = null;
      if (sg.ret) {
        var rlt = sg.ret.k === 'ref' ? sg.ret.lt : (sg.ret.__iter ? sg.ret.lt : null);
        if (rlt) link = function (d) { flow(rvOf(rlt), d.rv); };
        else if (sg.ret.k === 'adt' && sg.ret.lts && sg.ret.lts.length) link = function (d) { sg.ret.lts.forEach(function (lt) { flow(rvOf(lt), d.rv); }); };
      }
      return { rv: { k: 'call', callee: calleeName || sg.name, ops: argOps }, ty: retTy, link: link };
    }
    function paramOperand(arg, pty) {
      var isRef = pty && pty.k === 'ref';
      var o = operand(arg, { reborrowOk: isRef, sharedTarget: isRef && !pty.mut });
      // &String → &str deref coercion changes only the type
      return o;
    }

    function lowerCall(e, ctx) {
      var s = e.path, last = s[s.length - 1];
      var line = e.line;
      if (s.length === 1 && last === 'cond' && !allSigs.userFns.cond) {
        return { rv: { k: 'const' }, ty: TY_BOOL, link: null };        // the mini language's built-in unknowable condition
      }
      if (s.length === 1 && last === 'drop') {
        var d = operand(e.args[0], {});
        return { rv: { k: 'call', callee: 'drop', ops: [d.op], builtin: true }, ty: TY_UNIT, link: null };
      }
      if (s.length >= 2 && s[s.length - 2] === 'String' && (last === 'from' || last === 'new')) {
        var ops0 = e.args.map(function (a) { return operand(a, {}).op; });
        return { rv: { k: 'call', callee: 'String::' + last, ops: ops0, builtin: true }, ty: { k: 'String' }, link: null };
      }
      if (s.length >= 2 && s[s.length - 2] === 'Vec' && (last === 'new' || last === 'with_capacity')) {
        var ops1 = e.args.map(function (a) { return operand(a, {}).op; });
        var el = ctx.want && ctx.want.k === 'Vec' ? ctx.want.el : TY_INT;
        return { rv: { k: 'call', callee: 'Vec::' + last, ops: ops1, builtin: true }, ty: { k: 'Vec', el: el }, link: null };
      }
      if (s.length >= 2 && s[s.length - 2] === 'Box' && last === 'new') {
        var bo = operand(e.args[0], {});
        return { rv: { k: 'call', callee: 'Box::new', ops: [bo.op], builtin: true }, ty: { k: 'Box', el: bo.ty }, link: null };
      }
      if (s.length >= 2 && s[s.length - 2] === 'mem' && last === 'forget') {
        var fo = operand(e.args[0], {});
        return { rv: { k: 'call', callee: 'mem::forget', ops: [fo.op], builtin: true }, ty: TY_UNIT, link: null };
      }
      if (s.length >= 2 && s[s.length - 2] === 'mem' && ['take', 'replace', 'swap'].indexOf(last) >= 0) {
        var mops = e.args.map(function (a) { return operand(a, { reborrowOk: true }).op; });
        var t0 = typeOfExpr(e.args[0]); var inner = t0.k === 'ref' ? t0.to : t0;
        return { rv: { k: 'call', callee: 'mem::' + last, ops: mops, builtin: true }, ty: last === 'swap' ? TY_UNIT : inner, link: null };
      }
      var sg = null;
      if (s.length === 1) sg = allSigs.userFns[last];
      else if (s.length === 2) sg = allSigs.user[s[0] + '::' + last];
      if (!sg) throw new MRError('cannot find function `' + s.join('::') + '` in this scope', line);
      if (sg.errs.length) { sg.errs.forEach(function () { }); }
      var ops = [], tys = [];
      e.args.forEach(function (a, i) { var o = paramOperand(a, sg.params[i] && sg.params[i].ty); ops.push(o.op); tys.push(o.ty); });
      return finishCall(sg, ops, tys, sg.ret || TY_UNIT, line, s.join('::'));
    }

    function lowerMCall(e, ctx) {
      var line = e.line;
      var rt = typeOfExpr(e.recv), base = rt, derefs = 0;
      while (base.k === 'ref') { base = base.to; derefs++; }
      var sg = lookupMethod(base, e.name);
      if (!sg) throw new MRError('no method named `' + e.name + '` found for `' + tyStr(base) + '` in the mini language', line);
      var kind = sg.selfKind;
      var recvOp, recvArgTy;
      var mutCtx = kind === 'mut';
      // receiver place (or a temporary holding the receiver value)
      var recvLv;
      var recvIsPlace = isPlaceExpr(e.recv);
      if (recvIsPlace) recvLv = lvalue(e.recv, mutCtx && derefs === 0);
      else { var rr = rvalue(e.recv, {}); var tt = newTemp(rr.ty); emitAssign(tt, rr, line); recvLv = { place: P(tt.id), ty: rr.ty }; }
      if (kind === 'val') {
        recvOp = useOperandOf(recvLv, {}, line).op;
      } else if (kind === 'ref') {
        if (rt.k === 'ref' && !rt.mut && derefs === 1) recvOp = { k: 'copy', place: recvLv.place };           // already a shared reference: passed as is
        else {
          var bl = recvLv; while (bl.ty.k === 'ref') bl = derefPlace(bl, line);                                // reborrow &*r  or autoref &x
          var loan = newLoan(bl.place, false, false, line);
          var t = newTemp({ k: 'ref', mut: false, lt: null, to: bl.ty });
          emitAssign(t, { rv: { k: 'ref', loan: loan.id, place: bl.place, mut: false }, ty: t.ty, link: function (d) { d.borrowOf = { place: bl.place, mut: false }; flow(loan.rv, d.rv); } }, line);
          recvOp = { k: 'move', place: P(t.id) };
        }
      } else {     // &mut self
        var bl2 = recvLv; while (bl2.ty.k === 'ref') {
          if (!bl2.ty.mut) { /* through a shared reference */ }
          bl2 = derefPlace(bl2, line);
        }
        checkMutBorrow(bl2, line);
        var loan2 = newLoan(bl2.place, true, true, line);
        var t2 = newTemp({ k: 'ref', mut: true, lt: null, to: bl2.ty });
        t2.tp = loan2.id;
        emitAssign(t2, { rv: { k: 'ref', loan: loan2.id, place: bl2.place, mut: true }, ty: t2.ty, link: function (d) { d.borrowOf = { place: bl2.place, mut: true }; flow(loan2.rv, d.rv); } }, line);
        recvOp = { k: 'move', place: P(t2.id) };
      }
      var m = {}; if (base.k === 'Vec') m.T = base.el;
      var ops = [recvOp];
      e.args.forEach(function (a, i) {
        var pty = sg.params[i + (sg.selfKind ? 1 : 0)] ? sg.params[i + (sg.selfKind ? 1 : 0)].ty : null;
        var o = paramOperand(a, pty && substTy(pty, m));
        ops.push(o.op);
      });
      var ret = methodRet(sg, base);
      return finishCall(sg, ops, [], ret, line, (base.k === 'adt' ? base.name : tyStr(base).replace(/<.*/, '')) + '::' + e.name);
    }

    /* ── statements ── */
    function lowerAssign(e) {
      var line = e.line;
      var lhsTy = typeOfExpr(e.lhs);
      var rhs;
      if (e.op) {
        var lv0 = lvalue(e.lhs, true);
        var cur = operand(e.rhs, {});
        rhs = { rv: { k: 'binop', a: { k: 'copy', place: lv0.place }, b: cur.op }, ty: lhsTy, link: null };
        assignTo(lv0, rhs, line, true);
        return;
      }
      if (isPlaceExpr(e.rhs)) rhs = useRV(operand(e.rhs, {}));          // `x = *r`: the place is read into a temporary first (MIR does)
      else rhs = rvalue(e.rhs, { want: lhsTy, reborrowOk: false });
      if (rhs.rv.k === 'call' && !rhs.rv.builtin) {          // `lhs = f(..)`: the call runs first, its result is moved in
        var tmpr = newTemp(rhs.ty);
        emitAssign(tmpr, rhs, line);
        rhs = useRV({ op: { k: isCopy(rhs.ty) ? 'copy' : 'move', place: P(tmpr.id) }, ty: rhs.ty });
      }
      var lv = lvalue(e.lhs, true);
      assignTo(lv, rhs, line, false);
    }
    function assignTo(lv, rhs, line, isCompound) {
      var pl = lv.place;
      if (pl.p.length > 0 || F.locals[pl.l].temp) {
        var m = placeMutable(pl);
        if (!m.mutable) {
          var nm = placeStr(F, pl);
          if (m.why === 'ref') err('E0594', 'cannot assign to `' + nm + '`, which is behind a `&` reference', line);
          else err('E0594', 'cannot assign to `' + nm + '`, as `' + F.locals[pl.l].name + '` is not declared as mutable', line);
        }
      }
      var dest = pl.p.length === 0 ? F.locals[pl.l] : null;
      if (dest && dest.ty === null) { dest.ty = rhs.ty; if (hasRegion(rhs.ty)) dest.rv = newRegion(dest.name || ('_' + dest.id), 'local'); }
      var n = emit({ k: 'assign', dest: pl, rv: rhs.rv, compound: !!isCompound, userAssign: true, destTy: lv.ty }, line);
      if (rhs.rv.k === 'ref') F.loans[rhs.rv.loan].node = n.id;
      if (rhs.rv.k === 'call') rhs.rv.ops.forEach(function (o) { if (o.place && o.place.p.length === 0 && F.locals[o.place.l].tp !== null) F.loans[F.locals[o.place.l].tp].act = n.id; });
      if (rhs.link) {
        // whole-local destination: its region receives the flow; a field/deref destination pours into the base local's region
        var tgt = F.locals[pl.l];
        if (tgt.rv >= 0) rhs.link(tgt);
      }
    }

    function lowerStmt(s) {
      switch (s.k) {
        case 'let': return lowerLet(s);
        case 'expr': {
          pushScope('stmt');
          var e = s.e;
          if (e.k === 'if' || e.k === 'while' || e.k === 'loop' || e.k === 'for' || e.k === 'block' || e.k === 'break' || e.k === 'continue' || e.k === 'return') lowerControl(e, null);
          else if (e.k === 'assign') lowerAssign(e);
          else {
            var r = rvalue(e, {});
            if (r.rv.k !== 'const') {
              if (r.ty.k === 'unit' || r.ty.k === 'never' || (!world.needsDrop(r.ty) && !hasRegion(r.ty))) emitAssign(null, r, s.line);
              else { var t = newTemp(r.ty); emitAssign(t, r, s.line); }
            }
          }
          popScope(s.line);
          return;
        }
      }
    }
    function lowerLet(s) {
      var line = s.line;
      var blockIdx = F.scopes.length - 1;
      pushScope('stmt');
      var declTy = s.ty ? cloneTy(s.ty) : null;
      if (declTy) (function fill(t) { if (t.k === 'ref') fill(t.to); else if (t.k === 'Vec') fill(t.el); })(declTy);
      if (!s.init) {
        var lu = declare(s.name, declTy || null, { mut: s.mut, line: line }, blockIdx);
        emit({ k: 'decl', local: lu.id }, line);
        popScope(line);
        return;
      }
      var wantRef = declTy && declTy.k === 'ref' && declTy.mut;
      var r = rvalue(s.init, { want: declTy, letInit: true, reborrowOk: wantRef });
      var ty = declTy && declTy.k !== 'Vec' ? declTy : r.ty;
      if (declTy && declTy.k === 'Vec') ty = declTy;
      if (r.rv.k === 'use' && wantRef && r.rv.op && r.rv.op.k === 'move') { /* moved &mut (no reborrow in this position) */ }
      var x = newLocal(s.name, ty, { mut: s.mut, line: line });
      F.scopes[blockIdx].locals.push(x.id);
      // the new name becomes visible after the initializer
      var n = emitAssign(x, r, line);
      F.scopes[blockIdx].names[s.name] = x.id;
      n.op.init = true;
      popScope(line);
    }

    function lowerBlockInto(b, dest, newScope) {
      if (newScope !== false) pushScope('block');
      b.stmts.forEach(lowerStmt);
      if (b.tail) {
        pushScope('stmt');
        assignTail(b.tail, dest);
        popScope(b.endLine);
      }
      if (newScope !== false) popScope(b.endLine);
    }
    function assignTail(e, dest) {
      var line = e.line;
      var ctlKinds = { 'if': 1, 'while': 1, 'loop': 1, 'for': 1, 'block': 1, 'break': 1, 'continue': 1, 'return': 1 };
      if (ctlKinds[e.k]) { lowerControl(e, dest); return; }
      if (e.k === 'assign') { lowerAssign(e); return; }
      var r = rvalue(e, { want: dest && dest.local ? dest.local.ty : (dest && dest.want) || null, reborrowOk: !!(dest && dest.reborrowOk) });
      if (!dest) { if (r.rv.k !== 'const') { if (r.ty.k === 'unit' || (!world.needsDrop(r.ty) && !hasRegion(r.ty))) emitAssign(null, r, line); else { var t = newTemp(r.ty); emitAssign(t, r, line); } } return; }
      if (!dest.local) {
        if (dest.isRet) dest.local = F.retLocal;
        else { dest.local = declare(null, r.ty, { temp: true }, dest.scopeIdx !== undefined ? dest.scopeIdx : F.scopes.length - 2); }
      }
      if (dest.local) {
        var n = emit({ k: 'assign', dest: P(dest.local.id), rv: r.rv }, line);
        if (r.rv.k === 'ref') F.loans[r.rv.loan].node = n.id;
        if (r.rv.k === 'call') r.rv.ops.forEach(function (o) { if (o.place && o.place.p.length === 0 && F.locals[o.place.l].tp !== null) F.loans[F.locals[o.place.l].tp].act = n.id; });
        if (r.link && dest.local.rv >= 0) r.link(dest.local);
      }
    }

    /* the line of the closing brace that ends an `if` / `else if` / `else` chain: where control joins again */
    function endOfIf(e) {
      if (e.k === 'if') return e.els ? endOfIf(e.els) : (e.then.endLine || e.line);
      if (e.k === 'block') return e.b.endLine || e.line;
      return e.line;
    }
    function lowerControl(e, dest) {
      var line = e.line;
      switch (e.k) {
        case 'block': lowerBlockInto(e.b, dest); return;
        case 'if': {
          if (dest && !dest.local && !dest.isRet) dest.scopeIdx = F.scopes.length - 1 - (F.scopes[F.scopes.length - 1].kind === 'stmt' ? 1 : 0);
          pushScope('stmt'); condition(e.cond, line); popScope(line);
          var br = emit({ k: 'branch' }, line).id;
          F.cur = br; lowerBlockInto(e.then, dest);
          var endThen = F.cur;
          F.cur = br;
          if (e.els) { if (e.els.k === 'if') lowerControl(e.els, dest); else lowerBlockInto(e.els.b, dest); }
          var endElse = F.cur;
          var join = newNode({ k: 'nop' }, endOfIf(e));
          if (endThen >= 0) link(endThen, join.id);
          if (endElse >= 0) link(endElse, join.id);
          F.cur = (endThen >= 0 || endElse >= 0) ? join.id : -1;
          return;
        }
        case 'while': {
          var head = emit({ k: 'nop' }, line).id;
          pushScope('stmt'); condition(e.cond, line); popScope(line);
          var br2 = emit({ k: 'branch' }, line).id;
          var exit = newNode({ k: 'nop' }, e.body.endLine || line).id;
          F.loops.push({ head: head, exit: exit, depth: F.scopes.length });
          var bodyStart = newNode({ k: 'nop' }, line).id; link(br2, bodyStart); F.cur = bodyStart;
          lowerBlockInto(e.body, null);
          if (F.cur >= 0) link(F.cur, head);
          F.loops.pop();
          link(br2, exit);
          F.cur = exit;
          return;
        }
        case 'loop': {
          var head2 = emit({ k: 'nop' }, line).id;
          var exit2 = newNode({ k: 'nop' }, e.body.endLine || line).id;
          F.loops.push({ head: head2, exit: exit2, depth: F.scopes.length });
          lowerBlockInto(e.body, null);
          if (F.cur >= 0) link(F.cur, head2);
          F.loops.pop();
          F.cur = F.nodes[exit2].pred.length ? exit2 : -1;
          return;
        }
        case 'for': return lowerFor(e);
        case 'break': case 'continue': {
          var L = F.loops[F.loops.length - 1];
          if (!L) throw new MRError('`' + e.k + '` outside of a loop', line);
          exitScopesTo(L.depth, line);
          if (F.cur >= 0) link(F.cur, e.k === 'break' ? L.exit : L.head);
          F.cur = -1;
          return;
        }
        case 'return': {
          if (e.e) {
            pushScope('stmt');
            assignTail(e.e, { isRet: true, reborrowOk: true });
            // (assignTail already assigned into the return local)
            popScope(line);
          }
          exitScopesTo(0, line);
          if (F.cur >= 0) emit({ k: 'ret' }, line);
          F.cur = -1;
          return;
        }
      }
    }
    function condition(c, line) {
      var o = operand(c, {});
      // the condition value is read once
      emit({ k: 'nop', reads: o.op }, line);
    }

    function lowerFor(e) {
      var line = e.line;
      pushScope('block');                                    // holds the iterator (and temporaries of the iterable)
      pushScope('stmt');
      var itTy, itSrc = null, kind, elTy;
      var ie = e.iter; while (ie.k === 'paren') ie = ie.e;
      var itLocal;
      if (ie.k === 'range') {
        var ao = operand(ie.a, {}), bo = operand(ie.b, {});
        itTy = { k: 'iter', kind: 'own', el: TY_INT, range: true };
        itLocal = declare(null, itTy, { temp: true }, F.scopes.length - 2);
        emit({ k: 'assign', dest: P(itLocal.id), rv: { k: 'aggr', ops: [ao.op, bo.op] } }, line);
        elTy = TY_INT;
      } else {
        var r = rvalue(e.iter, { letInit: true });
        var ty = r.ty;
        if (ty.k === 'ref' && ty.to.k === 'Vec') { itTy = { k: 'iter', kind: ty.mut ? 'mut' : 'shared', el: ty.to.el }; elTy = { k: 'ref', mut: ty.mut, lt: null, to: ty.to.el }; }
        else if (ty.k === 'iter') { itTy = ty; elTy = ty.kind === 'own' ? ty.el : { k: 'ref', mut: ty.kind === 'mut', lt: null, to: ty.el }; }
        else if (ty.k === 'Vec') { itTy = { k: 'iter', kind: 'own', el: ty.el }; elTy = ty.el; }
        else throw new MRError('`' + tyStr(ty) + '` is not an iterator in the mini language', line);
        var tmp = newTemp(ty, true);
        emitAssign(tmp, r, line);
        itLocal = declare(null, itTy, { temp: true }, F.scopes.length - 2);
        var src = operandLocal({ op: { k: 'move', place: P(tmp.id) } });
        var n0 = emit({ k: 'assign', dest: P(itLocal.id), rv: { k: 'use', op: { k: isCopy(ty) ? 'copy' : 'move', place: P(tmp.id) } } }, line);
        if (tmp.rv >= 0 && itLocal.rv >= 0) flow(tmp.rv, itLocal.rv);
      }
      popScope(line);                                          // temporaries of the iterable die here (extended ones live in the outer block)
      var head = emit({ k: 'nop' }, line).id;
      var exit = newNode({ k: 'nop' }, e.body.endLine || line).id;
      F.loops.push({ head: head, exit: exit, depth: F.scopes.length });
      pushScope('block');                                      // one iteration: holds the loop variable
      var x = declare(e.name, elTy, { mut: e.mut, line: line });
      var nx = emit({ k: 'assign', dest: P(x.id), rv: { k: 'next', it: itLocal.id } }, line);
      nx.op.loopVar = true;
      if (itLocal.rv >= 0 && x.rv >= 0) flow(itLocal.rv, x.rv);
      lowerBlockInto(e.body, null);
      link(nx.id, exit);                                       // successors of the `next` node: [body, exit] (MIR order matters for reporting)
      popScope(e.body.endLine);
      if (F.cur >= 0) link(F.cur, head);
      F.loops.pop();
      F.cur = exit;
      popScope(e.body.endLine || line);
    }

    /* ── function driver ── */
    pushScope('fn');
    // parameters
    sig.params.forEach(function (p) {
      var ty = p.ty;
      var l = declare(p.name, ty, { mut: p.mut, param: true, line: decl.line });
      if (ty.k === 'ref') {
        l.rv = univ(ty.lt);
        if (ty.to.k === 'adt' && ty.to.lts && ty.to.lts.length) l.innerRv = univ(ty.to.lts[0]);       // `self: &'1 W<'a>`: the struct's own lifetime is 'a
      }
      else if (ty.k === 'adt' && ty.lts && ty.lts.length) { l.rv = univ(ty.lts[0]); }
      l.init0 = true;
    });
    if (sig.ret && sig.ret.k !== 'unit') {
      var rl = newLocal('_0', sig.ret, { temp: true });
      if (sig.ret.k === 'ref') rl.rv = univ(sig.ret.lt);
      else if (sig.ret.k === 'adt' && sig.ret.lts && sig.ret.lts.length) rl.rv = univ(sig.ret.lts[0]);
      F.retLocal = rl;
    }
    var entry = newNode({ k: 'nop', entry: true }, decl.line);
    F.cur = entry.id;
    F.entry = entry.id;
    if (decl.body) {
      pushScope('block');
      decl.body.stmts.forEach(lowerStmt);
      if (decl.body.tail) {
        pushScope('stmt');
        assignTail(decl.body.tail, F.retLocal ? { isRet: true, reborrowOk: true } : null);
        popScope(decl.body.endLine);
      }
      popScope(decl.body.endLine);
      exitScopesTo(0, decl.body.endLine);
      if (F.cur >= 0) emit({ k: 'ret' }, decl.body.endLine);
    }
    F.exitNode = -1;
    return F;
  }
  /* ───────────────────────────── analyses ───────────────────────────── */
  function opPlace(o) { return o && o.place ? o.place : null; }

  /* every access a node performs, in evaluation order */
  function accessesOf(F, n) {
    var out = [], op = n.op;
    function opAcc(o) { if (o && o.place) out.push({ pl: o.place, kind: o.k === 'move' ? 'move' : 'copy', depth: 'deep' }); }
    switch (op.k) {
      case 'assign': {
        var rv = op.rv;
        // assigning to a place whose type has a destructor first drops the old value (`DropAndReplace`)
        if (op.userAssign && op.dest && op.destTy && F.world.needsDrop(op.destTy)) out.push({ pl: op.dest, kind: 'replace', depth: 'deep' });
        switch (rv.k) {
          case 'use': opAcc(rv.op); break;
          case 'ref': {
            var loan = F.loans[rv.loan];
            out.push({ pl: rv.place, kind: loan.twoPhase ? 'reserve' : (rv.mut ? 'mborrow' : 'sborrow'), depth: 'deep', loan: loan.id });
            break;
          }
          case 'call':
            rv.ops.forEach(opAcc);
            rv.ops.forEach(function (o) {
              if (o.place && o.place.p.length === 0) {
                var tl = F.locals[o.place.l];
                if (tl.tp !== null && F.loans[tl.tp].twoPhase && F.loans[tl.tp].act === n.id) out.push({ pl: F.loans[tl.tp].place, kind: 'activate', depth: 'deep', loan: tl.tp });
              }
            });
            break;
          case 'binop':
            opAcc(rv.a); opAcc(rv.b);
            if (op.compound && out.length) out[out.length - (rv.b && rv.b.place ? 2 : 1)].span = 'cmp';
            break;
          case 'unop': opAcc(rv.a); break;
          case 'aggr': rv.ops.forEach(opAcc); break;
          case 'next': out.push({ pl: { l: rv.it, p: [] }, kind: 'copy', depth: 'deep', iter: true }); break;
        }
        if (op.dest) out.push({ pl: op.dest, kind: 'write', depth: 'shallow', whole: op.dest.p.length === 0, span: op.compound ? 'cmp' : undefined });
        break;
      }
      case 'sdead': out.push({ pl: { l: op.local, p: [] }, kind: 'sdead', depth: 'shallow' }); break;
      case 'drop': out.push({ pl: { l: op.local, p: [] }, kind: 'drop', depth: 'deep' }); break;
      case 'nop': if (op.reads) opAcc(op.reads); break;
      case 'ret': if (F.retLocal) out.push({ pl: { l: F.retLocal.id, p: [] }, kind: 'copy', depth: 'deep' }); break;
    }
    return out;
  }

  function placesConflict(bpl, apl, depth) {
    if (bpl.l !== apl.l) return false;
    var bp = bpl.p, ap = apl.p, n = Math.min(bp.length, ap.length);
    for (var i = 0; i < n; i++) if (bp[i].k === 'f' && ap[i].k === 'f' && bp[i].n !== ap[i].n) return false;
    if (ap.length >= bp.length) return true;
    if (depth === 'shallow') { for (var j = ap.length; j < bp.length; j++) if (bp[j].k === 'd') return false; }
    return true;
  }

  function bitset(n) { return new Uint8Array(n); }

  /* the law at one point: does this access conflict with this loan, which is in scope here?  → error code, or null.
     (`S` = the owner ends while the loan is live; the caller turns it into E0597 / E0716 / E0515.) */
  function accessVerdict(F, a, L, nid) {
    var mutNow = L.mut && (!L.twoPhase || F.activeAt[L.id][nid]);
    switch (a.kind) {
      case 'copy': return mutNow ? 'E0503' : null;
      case 'sborrow': return mutNow ? 'E0502' : null;
      case 'reserve': return L.mut ? 'E0499' : null;                          // a reservation may coexist with shared loans, never with an exclusive one
      case 'mborrow': case 'activate': return L.mut ? 'E0499' : 'E0502';
      case 'write': case 'replace': return 'E0506';
      case 'move': return 'E0505';
      case 'drop': case 'sdead': return 'S';
    }
    return null;
  }

  function analyze(F) {
    var N = F.nodes.length;
    /* reachability from entry */
    var reach = bitset(N), stack = [F.entry];
    reach[F.entry] = 1;
    while (stack.length) { var x = stack.pop(); F.nodes[x].succ.forEach(function (s) { if (!reach[s]) { reach[s] = 1; stack.push(s); } }); }
    F.reach = reach;
    F.acc = F.nodes.map(function (n) { return reach[n.id] ? accessesOf(F, n) : []; });

    /* liveness of region-carrying locals */
    var liveIn = F.nodes.map(function () { return new Set(); });
    var usesN = F.nodes.map(function (n, i) {
      var u = new Set(), d = new Set();
      F.acc[i].forEach(function (a) {
        if (a.kind === 'sdead' || a.kind === 'drop') return;
        if (a.kind === 'write' && a.whole) d.add(a.pl.l); else u.add(a.pl.l);
      });
      return { u: u, d: d };
    });
    var changed = true, livePasses = 0, liveSnaps = [];
    while (changed) {
      changed = false; livePasses++;
      for (var i = N - 1; i >= 0; i--) {
        if (!reach[i]) continue;
        var out = new Set();
        F.nodes[i].succ.forEach(function (s) { liveIn[s].forEach(function (v) { out.add(v); }); });
        var cur = new Set(usesN[i].u);
        out.forEach(function (v) { if (!usesN[i].d.has(v)) cur.add(v); });
        if (cur.size !== liveIn[i].size) { liveIn[i] = cur; changed = true; }
        else { var same = true; cur.forEach(function (v) { if (!liveIn[i].has(v)) same = false; }); if (!same) { liveIn[i] = cur; changed = true; } }
      }
      liveSnaps.push(liveIn.map(function (st) { return Array.from(st); }));
    }
    F.liveIn = liveIn; F.usesN = usesN; F.livePasses = livePasses; F.liveSnaps = liveSnaps;

    /* regions: liveness constraints, universals, then subset propagation */
    var R = F.regions.length, pts = [];
    for (var r = 0; r < R; r++) pts.push(bitset(N));
    F.locals.forEach(function (l) {
      if (l.rv < 0) return;
      for (var k = 0; k < N; k++) if (reach[k] && liveIn[k].has(l.id)) pts[l.rv][k] = 1;
    });
    F.regions.forEach(function (rg) { if (rg.kind === 'univ') for (var k = 0; k < N; k++) if (reach[k]) pts[rg.id][k] = 1; });
    changed = true;
    var guard = 0;
    while (changed && guard++ < 1000) {
      changed = false;
      F.edges.forEach(function (e) {
        var a = pts[e[0]], b = pts[e[1]];
        for (var k = 0; k < N; k++) if (b[k] && !a[k]) { a[k] = 1; changed = true; }
      });
    }
    F.pts = pts;

    /* which regions a loan flows into (reachability along edges) */
    var adj = []; for (r = 0; r < R; r++) adj.push([]);
    F.edges.forEach(function (e) { adj[e[0]].push(e[1]); });
    function reachableRegions(start) {
      var seen = new Set([start]), st = [start];
      while (st.length) { var c = st.pop(); adj[c].forEach(function (d) { if (!seen.has(d)) { seen.add(d); st.push(d); } }); }
      return seen;
    }
    F.adj = adj; F.reachableRegions = reachableRegions;

    /* loans in scope */
    function prefixOf(d, pl) {          // is place d a prefix of place pl?
      if (d.l !== pl.l || d.p.length > pl.p.length) return false;
      for (var i = 0; i < d.p.length; i++) { var a = d.p[i], b = pl.p[i]; if (a.k !== b.k || (a.k === 'f' && a.n !== b.n)) return false; }
      return true;
    }
    function kills(n, L) {
      var op = n.op;
      // rustc kills every loan whose place *conflicts* with the assigned one (either may be the prefix)
      if (op.k === 'assign' && op.dest && placesConflict(L.place, op.dest, 'deep')) return true;
      if (op.k === 'sdead' && op.local === L.place.l) return true;
      return false;
    }
    F.inScope = F.loans.map(function (L) {
      var sc = bitset(N);
      if (L.node < 0 || !reach[L.node]) return sc;
      var pt = pts[L.rv];
      var queue = [], start = F.nodes[L.node];
      if (!kills(start, L)) start.succ.forEach(function (s) { queue.push(s); });
      while (queue.length) {
        var p = queue.shift();
        if (sc[p] || !pt[p] || !reach[p]) continue;
        sc[p] = 1;
        if (kills(F.nodes[p], L)) continue;
        F.nodes[p].succ.forEach(function (s) { queue.push(s); });
      }
      return sc;
    });
    /* the block-shaped ("lexical") region of each loan: from the borrow to the end of the scope of whatever holds it,
       that is, up to the holder's own StorageDead (locals die in reverse order of declaration, so a reference declared
       after its owner dies first). Regions that reach the end of the function and beyond (a universal region) are left as
       they are. */
    F.endLine = {}; F.endNode = {};
    F.nodes.forEach(function (n) {
      if (n.op.k !== 'sdead') return;
      var id = n.op.local, cur = F.endNode[id];
      if (cur === undefined || (n.line || 0) > F.nodes[cur].line || ((n.line || 0) === F.nodes[cur].line && n.id > cur)) { F.endNode[id] = n.id; F.endLine[id] = n.line || 0; }
    });
    F.lexEnd = F.loans.map(function (L) {
      var regs = F.reachableRegions(L.rv), endL = L.line || 0, toCaller = false;
      F.regions.forEach(function (rg) { if (rg.kind === 'univ' && regs.has(rg.id)) toCaller = true; });
      F.locals.forEach(function (l) { if (l.rv >= 0 && regs.has(l.rv) && F.endNode[l.id] !== undefined) endL = Math.max(endL, F.endLine[l.id]); });
      return { line: toCaller ? Infinity : endL };
    });
    if (F.lexical) {
      F.loans.forEach(function (L) {
        if (L.node < 0 || !reach[L.node] || F.lexEnd[L.id].line === Infinity) return;
        var regs = F.reachableRegions(L.rv), holder = {}, any = false;
        F.locals.forEach(function (l) { if (l.rv >= 0 && regs.has(l.rv) && F.endNode[l.id] !== undefined) { holder[l.id] = 1; any = true; } });
        var sc = bitset(N), q = [], start = F.nodes[L.node];
        if (!kills(start, L)) start.succ.forEach(function (s) { q.push(s); });
        while (q.length) {
          var p = q.shift(), n = F.nodes[p];
          if (sc[p] || !reach[p]) continue;
          if (!any && (n.line || 0) > L.line) continue;                  // held only by a temporary: the statement
          sc[p] = 1;
          if (n.op.k === 'sdead' && holder[n.op.local]) continue;          // the holder dies here: the block-shaped region ends on this path
          if (kills(n, L)) continue;
          n.succ.forEach(function (s) { q.push(s); });
        }
        F.inScope[L.id] = sc;
      });
    }
    /* two-phase loans: from the activation point on they behave as exclusive */
    F.activeAt = F.loans.map(function (L) {
      var ac = bitset(N);
      if (!L.twoPhase) { for (var k = 0; k < N; k++) ac[k] = 1; return ac; }
      if (L.act < 0) return ac;
      ac[L.act] = 1;
      var q = [L.act];
      while (q.length) { var c = q.shift(); F.nodes[c].succ.forEach(function (s) { if (!ac[s] && F.inScope[L.id][s]) { ac[s] = 1; q.push(s); } }); }
      return ac;
    });

    computeDominators(F);
    // lowering-time errors in unreachable code do not exist for rustc (its MIR never contains that code)
    F.errs = F.errs.filter(function (e) { return e.curNode === undefined || (e.curNode >= 0 && reach[e.curNode]); });
    // E0596 on an immutable local: one diagnostic per local; with several borrows its primary span is the declaration
    Object.keys(F.mutUses).forEach(function (k) {
      var us = F.mutUses[k].filter(function (u) { return u.cur >= 0 && reach[u.cur]; });
      if (!us.length) return;
      F.errs.push({ code: 'E0596', msg: 'cannot borrow `' + us[0].name + '` as mutable, as it is not declared as mutable', line: us.length > 1 ? (F.locals[+k].line || us[0].line) : us[0].line, uses: us.map(function (u) { return u.line; }) });
    });
    F.rpo = reversePostorder(F);
    checkAccesses(F);
    initAnalysis(F);
    checkUniversals(F);
    return F;
  }

  /* rustc visits blocks in reverse postorder whose DFS takes the LAST MIR successor first; for our
     [then/body, else/exit] ordering that is a plain forward DFS.  Later reports on the same move-out
     set are suppressed, so this order decides which line a duplicate is attributed to. */
  function reversePostorder(F) {
    var N = F.nodes.length, seen = new Uint8Array(N), post = [], st = [[F.entry, 0]];
    seen[F.entry] = 1;
    while (st.length) {
      var top = st[st.length - 1], succ = F.nodes[top[0]].succ;
      if (top[1] < succ.length) { var s = succ[top[1]++]; if (!seen[s]) { seen[s] = 1; st.push([s, 0]); } }
      else { post.push(top[0]); st.pop(); }
    }
    return post.reverse();
  }

  /* dominator sets over the reachable graph */
  function computeDominators(F) {
    var N = F.nodes.length, dom = [], all = new Set();
    for (var i = 0; i < N; i++) if (F.reach[i]) all.add(i);
    for (i = 0; i < N; i++) dom.push(F.reach[i] ? (i === F.entry ? new Set([i]) : new Set(all)) : null);
    var ch = true;
    while (ch) {
      ch = false;
      for (i = 0; i < N; i++) {
        if (!F.reach[i] || i === F.entry) continue;
        var acc = null;
        F.nodes[i].pred.forEach(function (p) {
          if (!F.reach[p]) return;
          if (acc === null) acc = new Set(dom[p]); else acc.forEach(function (v) { if (!dom[p].has(v)) acc.delete(v); });
        });
        if (acc === null) acc = new Set();
        acc.add(i);
        if (acc.size !== dom[i].size) { dom[i] = acc; ch = true; }
      }
    }
    F.dom = dom;
  }

  /* rustc's get_moved_indexes: which move-outs of the path (or a parent) reach this use.  Moves from
     earlier iterations of a loop (back edges) count only if no forward move reaches. */
  function movedIndexes(F, useNode, key) {
    var result = new Set(), visited = new Set();
    function moveHere(nid) {
      return F.acc[nid].some(function (a) { return a.kind === 'move' && !a.pl.p.some(function (x) { return x.k === 'd'; }) && isPrefixKey(pathKey(a.pl), key); });
    }
    function initHere(nid) {
      return F.acc[nid].some(function (a) { return a.kind === 'write' && !a.pl.p.some(function (x) { return x.k === 'd'; }) && isPrefixKey(pathKey(a.pl), key); });
    }
    var stack = [], back = [];
    function preds(loc, sink) {
      var any = false;
      F.nodes[loc].pred.forEach(function (p) {
        if (!F.reach[p]) return;
        any = true;
        if (F.dom[p].has(loc)) back.push(p); else sink.push(p);
      });
      return any;
    }
    var reachedStart = false;
    preds(useNode, stack);
    function step(loc) {
      if (visited.has(loc)) return true;
      visited.add(loc);
      if (initHere(loc)) return true;
      if (F.nodes[loc].op.k !== 'sdead' && moveHere(loc)) { result.add(loc); return true; }
      return false;
    }
    while (stack.length) {
      var loc = stack.pop();
      if (step(loc)) continue;
      if (!preds(loc, stack)) reachedStart = true;
    }
    var isArg = F.locals[+key.split('.')[0]].param;
    var traversed = false;
    if ((isArg || !reachedStart) && result.size === 0) {
      while (back.length) {
        var b = back.pop();
        if (step(b)) { traversed = true; continue; }
        F.nodes[b].pred.forEach(function (p) { if (F.reach[p]) back.push(p); });
      }
    }
    return { moves: Array.from(result).sort(function (x, y) { return x - y; }), backEdge: traversed && result.size > 0 };
  }

  /* ── moves, definite initialisation, E0384 ── */
  function pathKey(pl) {
    var s = String(pl.l);
    for (var i = 0; i < pl.p.length; i++) { if (pl.p[i].k === 'd') break; s += '.' + pl.p[i].n; }
    return s;
  }
  function isPrefixKey(a, b) { return b === a || b.indexOf(a + '.') === 0; }   // a is prefix of (or equal to) b
  function fullKey(pl) { var s = String(pl.l); for (var i = 0; i < pl.p.length; i++) s += pl.p[i].k === 'd' ? '.*' : '.' + pl.p[i].n; return s; }
  function isPrefixFull(a, b) { return b === a || b.indexOf(a + '.') === 0; }
  function initAnalysis(F) {
    var N = F.nodes.length;
    var uninitIn = F.nodes.map(function () { return null; });       // Set of keys, or null when unvisited
    var movesIn = F.nodes.map(function () { return null; });         // Map key -> Set(nodeIds)
    var everIn = F.nodes.map(function () { return null; });
    function copyState(st) { var m = new Map(); st.m.forEach(function (v, k) { m.set(k, new Set(v)); }); return { u: new Set(st.u), m: m, e: new Set(st.e) }; }
    function join(a, b) {          // returns true when a changed
      var ch = false;
      b.u.forEach(function (k) { if (!a.u.has(k)) { a.u.add(k); ch = true; } });
      b.e.forEach(function (k) { if (!a.e.has(k)) { a.e.add(k); ch = true; } });
      b.m.forEach(function (v, k) { if (!a.m.has(k)) { a.m.set(k, new Set()); } var s = a.m.get(k); v.forEach(function (x) { if (!s.has(x)) { s.add(x); ch = true; } }); });
      return ch;
    }
    var st0 = { u: new Set(), m: new Map(), e: new Set() };
    F.locals.forEach(function (l) { if (l.param) st0.e.add(String(l.id)); });
    var IN = F.nodes.map(function () { return null; });
    IN[F.entry] = st0;
    var work = [F.entry];
    function transfer(n, st, report) {
      var op = n.op;
      if (op.k === 'decl') {
        var k0 = String(op.local); st.u.add(k0); st.m.delete(k0);
        return;
      }
      F.acc[n.id].forEach(function (a) {
        var K = pathKey(a.pl);
        var throughDeref = a.pl.p.some(function (x) { return x.k === 'd'; });
        if (a.kind === 'write') {
          if (report && a.whole) checkImmutableReassign(F, n, a, st);
          // writing through `*r` / `x.f` requires the base to be initialised
          // (only the base and its ancestors matter: a sibling field that was moved out does not block `p.a = ..`)
          if (report && a.pl.p.length) { var bp = { l: a.pl.l, p: a.pl.p.slice(0, a.pl.p.length - 1) }; checkUseInit(F, n, { pl: bp, kind: 'wbase', viaField: a.pl.p[a.pl.p.length - 1].k === 'f' }, pathKey(bp), st); }
          if (!throughDeref) {
            var rm = []; st.u.forEach(function (k) { if (isPrefixKey(K, k)) rm.push(k); }); rm.forEach(function (k) { st.u.delete(k); });
            var rm2 = []; st.m.forEach(function (v, k) { if (isPrefixKey(K, k)) rm2.push(k); }); rm2.forEach(function (k) { st.m.delete(k); });
          }
          if (a.whole) st.e.add(K);
          return;
        }
        if (a.kind === 'sdead') { st.e.delete(String(a.pl.l)); return; }
        if (a.kind === 'drop' || a.kind === 'activate' || a.kind === 'replace') return;
        // a use: everything on the path must be initialised
        if (report) checkUseInit(F, n, a, K, st);
        if (a.kind === 'move' && !throughDeref) {
          st.u.add(K);
          if (!st.m.has(K)) st.m.set(K, new Set());
          st.m.get(K).add(n.id);
        }
      });
    }
    function checkImmutableReassign(F, n, a, st) {
      var l = F.locals[a.pl.l];
      if (l.mut || l.temp) return;
      if (n.op.init || n.op.loopVar || F.replaceErr[n.id]) return;
      if (st.e.has(String(l.id))) F.errs.push({ code: 'E0384', msg: (l.param ? 'cannot assign to immutable argument `' + l.name + '`' : 'cannot assign twice to immutable variable `' + l.name + '`'), line: n.line, node: n.id, kind: 'reassign', local: l.id });
    }
    function checkUseInit(F, n, a, K, st) {
      var culprit = null, partial = false;
      st.u.forEach(function (k) {
        if (isPrefixKey(k, K)) culprit = culprit || k;                                        // an ancestor (or the place itself) is uninitialised
        else if (isPrefixKey(K, k) && a.kind !== 'write' && a.kind !== 'wbase') { partial = true; culprit = culprit || k; }   // a descendant was moved out
      });
      if (culprit === null) return;
      var mvi = movedIndexes(F, n.id, culprit);
      var moves = mvi.moves.length ? new Set(mvi.moves) : null;
      var l = F.locals[a.pl.l];
      var name = l.name || '_' + l.id;
      var nm = placeStr(F, a.pl);
      // rustc names the nearest ancestor that has a move path: using `l.text` after `l` moved says `l`
      if (isPrefixKey(culprit, K)) {
        var depth = culprit.split('.').length - 1;
        if (depth < a.pl.p.length && a.pl.p.slice(0, depth).every(function (s) { return s.k === 'f'; })) nm = placeStr(F, { l: a.pl.l, p: a.pl.p.slice(0, depth) });
      }
      var borrowKind = (a.kind === 'sborrow' || a.kind === 'mborrow' || a.kind === 'reserve');
      if (moves && moves.size) {
        var mv = mvi.moves;
        F.errs.push({ code: 'E0382', msg: (a.kind === 'wbase' && a.viaField ? 'assign to part of ' : borrowKind ? 'borrow of ' : 'use of ') + (partial ? 'partially ' : '') + 'moved value: `' + nm + '`', line: n.line, node: n.id, kind: 'moved', local: l.id, moveNodes: mv, borrow: borrowKind, path: K, full: fullKey(a.pl) });
      } else {
        F.errs.push({ code: 'E0381', msg: 'used binding `' + nm + '` ' + (st.e.has(String(l.id)) ? 'is possibly-uninitialized' : 'isn\'t initialized'), line: n.line, node: n.id, kind: 'uninit', local: l.id, path: K });
      }
    }
    while (work.length) {
      var id = work.shift(), n = F.nodes[id];
      var st = copyState(IN[id]);
      transfer(n, st, false);
      n.succ.forEach(function (s) {
        if (!IN[s]) { IN[s] = copyState(st); work.push(s); }
        else if (join(IN[s], st)) work.push(s);
      });
    }
    // second pass: report on the fixed point, in reverse postorder
    var before = F.errs.length;
    F.rpo.forEach(function (id) {
      var n = F.nodes[id];
      if (!IN[n.id] || !F.reach[n.id]) return;
      transfer(n, copyState(IN[n.id]), true);
    });
    // rustc keeps one diagnostic per distinct set of reaching move-outs (a later report of the same set
    // replaces an earlier one unless the earlier place already covers it), and one E0381 per local
    var buffered = new Map(), doneU = new Set(), kept = [];
    F.errs.slice(before).forEach(function (e) {
      if (e.kind === 'moved') {
        var key = e.moveNodes.join(',');
        var prev = buffered.get(key);
        if (prev && isPrefixFull(e.full, prev.full)) return;             // used place is a prefix of the reported one: suppressed
        buffered.set(key, e);
      } else if (e.kind === 'uninit') { if (doneU.has(e.local)) return; doneU.add(e.local); kept.push(e); }
      else kept.push(e);
    });
    buffered.forEach(function (e) { kept.push(e); });
    F.errs.length = before; kept.forEach(function (e) { F.errs.push(e); });
    F.uninitIn = IN.map(function (s) { return s ? s.u : null; });
  }

  /* ── borrow conflicts ── */
  /* the assignment of the return value that precedes an exit sequence (drops and StorageDeads of the scopes being left) */
  function retAssignOf(F, nid) {
    if (!F.retLocal) return null;
    var cur = nid, guard = 0;
    while (guard++ < 64) {
      var n = F.nodes[cur];
      if (n.op.k === 'assign' && n.op.dest && n.op.dest.l === F.retLocal.id && n.op.dest.p.length === 0) return n;
      if (n.op.k !== 'sdead' && n.op.k !== 'drop') return null;
      if (n.pred.length !== 1) return null;
      cur = n.pred[0];
    }
    return null;
  }
  /* does the value assigned to the return place at `ra` carry loan L? (rustc reports each returned expression on its own) */
  function carriesLoan(F, ra, L) {
    var rv = ra.op.rv, carriers = new Set([L.rv]), st = [L.rv];
    while (st.length) {                                   // follow the flow, but do not leave through a universal region: p and the result share one when elision ties them
      var c = st.pop();
      if (c !== L.rv && F.regions[c].kind === 'univ') continue;
      F.adj[c].forEach(function (d) { if (!carriers.has(d)) { carriers.add(d); st.push(d); } });
    }
    function viaLocal(pl) { if (!pl) return false; var l = F.locals[pl.l]; return !!l && l.rv >= 0 && F.regions[l.rv].kind !== 'univ' && carriers.has(l.rv); }
    if (rv.k === 'ref') return rv.loan === L.id || viaLocal(rv.place);
    if (rv.k === 'use') return !rv.op || viaLocal(rv.op.place);
    if (rv.k === 'call') return (rv.ops || []).some(function (o) { return o.k === 'ref' ? o.loan === L.id : viaLocal(o.place); });
    return true;
  }
  function checkAccesses(F) {
    var N = F.nodes.length, seen = new Set(), reservationReported = new Set();
    F.replaceErr = {}; var errSpans = new Set();
    function flowsToReturn(L) {
      if (!F.retLocal) return false;
      return F.reachableRegions(L.rv).has(F.retLocal.rv);
    }
    // rustc visits blocks in reverse postorder; within a node, accesses in evaluation order
    F.rpo.forEach(function (nid) {
      var n = F.nodes[nid];
      if (!F.reach[nid]) return;
      F.acc[nid].forEach(function (a) {
        var pkey = pathKey(a.pl);
        if (a.kind === 'activate' && reservationReported.has(pkey)) return;
        if (a.kind === 'write' && F.replaceErr[nid]) return;                       // same place, same span: already reported
        if (a.span && errSpans.has(nid + '|' + a.span + '|' + fullKey(a.pl))) return;
        for (var li = 0; li < F.loans.length; li++) {           // one diagnostic per access: the first conflicting loan wins
          var L = F.loans[li];
          if (!F.inScope[L.id][nid]) continue;
          if (a.loan === L.id && a.kind === 'activate') continue;          // (the loan's own creation can meet the loan itself only around a loop: "borrowed here in the previous iteration")
          if (!placesConflict(L.place, a.pl, a.depth)) continue;
          var retA = (a.kind === 'drop' || a.kind === 'sdead') ? retAssignOf(F, nid) : null;
          if (retA && flowsToReturn(L) && !carriesLoan(F, retA, L)) continue;       // this exit returns something else
          var code = accessVerdict(F, a, L, nid);
          if (!code) continue;
          var X = F.locals[L.place.l];
          var nm = placeStr(F, L.place);
          var msg, line = n.line, dropLine = null;
          if (code === 'S') {
            dropLine = n.line;
            if (flowsToReturn(L)) {
              code = 'E0515';
              var site = retSite(F, L) || retA;
              var direct = site ? (site.op.rv.k === 'ref' && site.op.rv.loan === L.id) : true;
              msg = X.temp ? (direct ? 'cannot return reference to temporary value' : 'cannot return value referencing temporary value') : (direct ? 'cannot return reference to local variable `' + nm + '`' : 'cannot return value referencing local variable `' + nm + '`');
              if (X.param) msg = direct ? 'cannot return reference to function parameter `' + nm + '`' : 'cannot return value referencing function parameter `' + nm + '`';
              line = site ? site.line : L.line;
            }
            else if (X.temp) { code = 'E0716'; msg = 'temporary value dropped while borrowed'; line = L.line; }
            else { code = 'E0597'; msg = '`' + nm + '` does not live long enough'; line = L.line; }
          } else if (code === 'E0499') msg = 'cannot borrow `' + nm + '` as mutable more than once at a time';
          else if (code === 'E0502') msg = a.kind === 'mborrow' || a.kind === 'activate' ? 'cannot borrow `' + placeStr(F, a.pl) + '` as mutable because it is also borrowed as immutable' : 'cannot borrow `' + placeStr(F, a.pl) + '` as immutable because it is also borrowed as mutable';
          else if (code === 'E0503') msg = 'cannot use `' + placeStr(F, a.pl) + '` because it was mutably borrowed';
          else if (code === 'E0505') msg = 'cannot move out of `' + placeStr(F, a.pl) + '` because it is borrowed';
          else if (code === 'E0506') msg = 'cannot assign to `' + placeStr(F, a.pl) + '` because it is borrowed';
          var key = dropLine === null ? code + ':' + L.id + ':' + line + ':' + nid + ':' + a.kind : code + ':' + L.id;      // a loan that outlives its owner is reported once, at the first exit that shows it
          if (a.kind === 'reserve') reservationReported.add(pkey);
          if (a.kind === 'replace') F.replaceErr[nid] = true;
          if (a.span && a.kind !== 'write') { errSpans.add(nid + '|' + a.span + '|' + fullKey(a.pl)); F.replaceErr[nid] = true; }
          if (!seen.has(key)) {
            seen.add(key);
            F.errs.push({ code: code, msg: msg, line: line, node: nid, kind: 'loan', loan: L.id, loanLine: dropLine === null ? L.line : L.line, dropLine: dropLine, useLine: findUse(F, L, nid), access: a.kind, accessLine: n.line });
          }
          if (dropLine !== null && F.univ['static'] !== undefined && F.reachableRegions(L.rv).has(F.univ['static'])) continue;      // "argument requires that `s` is borrowed for 'static": one error per borrow
          break;
        }
      });
    });
  }
  function retSite(F, L) {
    var best = null;
    F.nodes.forEach(function (n) {
      if (best !== null || !F.reach[n.id] || n.op.k !== 'assign' || !n.op.dest || !F.retLocal || n.op.dest.l !== F.retLocal.id || n.op.dest.p.length) return;
      if (carriesLoan(F, n, L)) best = n;
    });
    return best;
  }

  /* first later point at which anything that carries the loan is used (rustc's "borrow later used here").
     Carriers follow the flow but do not leave through a universal region: a parameter and the result share one when
     elision ties them, and that would make every later use of the parameter look like a use of the loan.  When the loan
     only lives on because it is returned, the "use" is the returned expression ("returning this value requires ..."). */
  /* the locals that hold the loan, directly or through anything made from it */
  function carrierLocals(F, L) {
    var seenR = new Set([L.rv]), st = [L.rv], carriers = new Set();
    while (st.length) {
      var c0 = st.pop();
      if (c0 !== L.rv && F.regions[c0].kind === 'univ') continue;
      F.adj[c0].forEach(function (d) { if (!seenR.has(d)) { seenR.add(d); st.push(d); } });
    }
    F.locals.forEach(function (l) { if (l.rv >= 0 && seenR.has(l.rv) && F.regions[l.rv].kind !== 'univ') carriers.add(l.id); });
    return carriers;
  }
  /* rustc explains a borrow by the nearest region that is live where the conflicting access happens: a breadth-first
     walk over the outlives edges from the loan's own region, stopping at the first region that some local live on
     entry to the access mentions; the "later use" is then the first use, along the region's points, of a local of that
     very region (so a loop's iterator, which mentions the loan's region itself, is found before the loop variable). */
  function subRegionLiveAt(F, L, from) {
    var liveAt = F.liveIn[from], seen = new Set([L.rv]), q = [L.rv];
    while (q.length) {
      var r = q.shift();
      if (r === L.rv || F.regions[r].kind !== 'univ') {
        var live = false;
        F.locals.forEach(function (l) { if (l.rv === r && liveAt.has(l.id)) live = true; });
        if (live) return r;
      }
      F.adj[r].forEach(function (d) { if (!seen.has(d)) { seen.add(d); q.push(d); } });
    }
    return -1;
  }
  function findUse(F, L, from) {
    var sub = subRegionLiveAt(F, L, from), carriers = new Set(), pt;
    if (sub >= 0) { F.locals.forEach(function (l) { if (l.rv === sub) carriers.add(l.id); }); pt = F.pts[sub]; }
    else { carriers = carrierLocals(F, L); pt = F.pts[L.rv]; }
    var seen = new Set([from]), q = [from];
    while (q.length) {
      var c = q.shift();
      var succ = F.nodes[c].succ;
      for (var i = succ.length - 1; i >= 0; i--) {           // rustc's MIR lists the else / exit target first
        var s = succ[i];
        if (seen.has(s) || !pt[s]) continue;
        seen.add(s);
        var used = F.acc[s].some(function (a) { return a.kind !== 'sdead' && a.kind !== 'drop' && !(a.kind === 'write' && a.whole) && carriers.has(a.pl.l); });
        if (used) return F.nodes[s].line;
        q.push(s);
      }
    }
    if (sub >= 0) { var alt = findUseAll(F, L, from); if (alt !== null) return alt; }
    if (F.retLocal && F.reachableRegions(L.rv).has(F.retLocal.rv)) { var site = retSite(F, L); if (site) return site.line; }
    return null;
  }
  /* the plain version: the first later use of anything that carries the loan */
  function findUseAll(F, L, from) {
    var carriers = carrierLocals(F, L), pt = F.pts[L.rv], seen = new Set([from]), q = [from];
    while (q.length) {
      var c = q.shift(), succ = F.nodes[c].succ;
      for (var i = succ.length - 1; i >= 0; i--) {
        var s = succ[i];
        if (seen.has(s) || !pt[s]) continue;
        seen.add(s);
        if (F.acc[s].some(function (a) { return a.kind !== 'sdead' && a.kind !== 'drop' && !(a.kind === 'write' && a.whole) && carriers.has(a.pl.l); })) return F.nodes[s].line;
        q.push(s);
      }
    }
    return null;
  }

  /* ── universal regions: what the signature promises vs what the body needs ── */
  function checkUniversals(F) {
    var sig = F.sig;
    var univIds = {}; for (var nm in F.univ) univIds[F.univ[nm]] = nm;
    // declared outlives, transitively; 'static outlives everything
    var decl = {};
    function add(a, b) { (decl[a] = decl[a] || new Set()).add(b); }
    sig.outlives.forEach(function (o) { add(o[0], o[1]); });
    // implied bounds (Reference): a parameter of type `&'x T` lets the body assume that everything T holds outlives 'x
    function holds(t, out) {
      if (!t) return;
      if (t.k === 'ref') { out.push(t.lt); holds(t.to, out); }
      else if (t.k === 'adt' && t.lts) t.lts.forEach(function (l) { out.push(l); });
      else if (t.k === 'Vec' || t.k === 'Box') holds(t.el, out);
    }
    function implied(t) {
      if (!t) return;
      if (t.k === 'ref') { var inner = []; holds(t.to, inner); inner.forEach(function (y) { if (y !== t.lt) add(y, t.lt); }); implied(t.to); }
      else if (t.k === 'Vec' || t.k === 'Box') implied(t.el);
    }
    sig.params.forEach(function (p) { implied(p.ty); });
    function provable(u, v) {
      if (u === v || u === 'static') return true;
      var seen = new Set([u]), st = [u];
      while (st.length) { var c = st.pop(); if (c === v) return true; (decl[c] || []).forEach(function (d) { if (!seen.has(d)) { seen.add(d); st.push(d); } }); }
      return false;
    }
    var edgeLine = {};
    F.edges.forEach(function (e) { var k = e[0] + '>' + e[1]; if (edgeLine[k] === undefined) edgeLine[k] = e[2]; });
    for (var ur in univIds) {
      var reach = F.reachableRegions(+ur);
      reach.forEach(function (v) {
        if (v === +ur || univIds[v] === undefined) return;
        var u = univIds[ur], w = univIds[v];
        if (provable(u, w)) return;
        // find the line where the flow enters w
        var line = null;
        F.edges.forEach(function (e) { if (e[1] === v && reach.has(e[0]) && e[2]) line = e[2]; });
        var named = function (s) { return s.charAt(0) !== '_' && s !== 'static'; };
        if (named(w) && !named(u)) {
          var pn = ''; sig.params.forEach(function (p) { if (p.ty && p.ty.k === 'ref' && p.ty.lt === u) pn = p.name; });
          F.errs.push({ code: 'E0621', msg: 'explicit lifetime required in the type of `' + pn + '`', line: line || sig.decl.line, kind: 'universal', from: u, to: w });
        } else {
          F.errs.push({ code: '', msg: 'lifetime may not live long enough', line: line || sig.decl.line, kind: 'universal', from: u, to: w, note: 'requires that `' + u + '` must outlive `' + w + '`' });
        }
      });
    }
  }
  /* ───────────────────────────── driver & API ───────────────────────────── */
  function buildSigs(world, prog) {
    var allSigs = { userFns: {}, user: {}, prelude: {}, errs: [] };
    var pre = parse(PRELUDE_SRC);
    pre.items.forEach(function (it) {
      if (it.k !== 'impl') return;
      var owner = it.target.k === 'Vec' ? { k: 'Vec', el: { k: 'adt', name: 'T', lts: [] } } : it.target;
      it.fns.forEach(function (f) { allSigs.prelude[implKey(it.target) + '::' + f.name] = makeSig(world, f, owner); });
    });
    prog.items.forEach(function (it) {
      if (it.k === 'fn') { var s = makeSig(world, it, null); allSigs.userFns[it.name] = s; allSigs.errs = allSigs.errs.concat(s.errs.map(function (e) { e.fn = it.name; return e; })); }
      if (it.k === 'impl') {
        var owner = it.target;
        if (owner.k === 'adt' && !owner.lts) owner.lts = [];
        it.fns.forEach(function (f) {
          var s2 = makeSig(world, f, owner);
          allSigs.user[implKey(it.target) + '::' + f.name] = s2;
          allSigs.errs = allSigs.errs.concat(s2.errs.map(function (e) { e.fn = f.name; return e; }));
        });
      }
    });
    return allSigs;
  }

  /* MR.analyze(src) → { fns: [FnIR…], errors: [...], parseError } — full data for the widgets */
  function analyzeProgram(src, opts) {
    opts = opts || {};
    var res = { fns: [], errors: [], parseError: null };
    var prog;
    try { prog = parse(src); } catch (e) { if (e.isMR) { res.parseError = { msg: e.message, line: e.line }; return res; } throw e; }
    var world = new World(prog); world.noTwoPhase = !!opts.noTwoPhase;
    var allSigs;
    try { allSigs = buildSigs(world, prog); } catch (e) { if (e.isMR) { res.parseError = { msg: e.message, line: e.line }; return res; } throw e; }
    res.errors = res.errors.concat(allSigs.errs);
    var todo = [];
    prog.items.forEach(function (it) {
      if (it.k === 'fn' && it.body) todo.push([it, allSigs.userFns[it.name]]);
      if (it.k === 'impl') it.fns.forEach(function (f) { if (f.body) todo.push([f, allSigs.user[implKey(it.target) + '::' + f.name]]); });
    });
    todo.forEach(function (pair) {
      var decl = pair[0], sig = pair[1];
      if (sig.errs.some(function (e) { return e.code === 'E0106'; })) return;     // rustc stops this function at the signature
      var F;
      try {
        F = lowerFn(world, decl, sig, allSigs); F.lexical = !!opts.lexical;
        var untyped = F.locals.filter(function (l) { return l.ty === null && !l.temp; });
        if (untyped.length) {                       // rustc stops at E0282 before borrow checking
          untyped.forEach(function (l) { res.errors.push({ code: 'E0282', msg: 'type annotations needed', line: l.line, fn: decl.name }); });
          return;
        }
        analyze(F);
      }
      catch (e) { if (e.isMR) { res.parseError = res.parseError || { msg: e.message, line: e.line, fn: decl.name }; return; } throw e; }
      F.errs.forEach(function (e) {
        e.fn = decl.name;
        if (e.moveNodes) e.moveLines = e.moveNodes.map(function (id) { return F.nodes[id].line; });
      });
      res.errors = res.errors.concat(F.errs);
      res.fns.push(F);
    });
    res.errors.sort(function (a, b) { return (a.line - b.line) || String(a.code).localeCompare(String(b.code)); });
    res.ok = res.errors.length === 0 && !res.parseError;
    res.world = world;
    return res;
  }

  /* MR.loans(src) → { fns:[{ name, loans:[{ id, mut, twoPhase, place, line, lines, ofRef, deref }] }], parseError }
     `lines` = the source lines over which the loan's region holds, walking forward from the borrow expression
     (kills by assignment are ignored: this is the extent of the *region*, the bar the widgets draw).
     `ofRef` marks the shared borrow a macro takes of a reference variable, `deref` a reborrow through `*r`:
     bookkeeping loans the views usually hide. */
  MR.loans = function (src) {
    var r = analyzeProgram(src), out = { fns: [], parseError: r.parseError };
    r.fns.forEach(function (F) {
      out.fns.push({
        name: F.name,
        loans: F.loans.map(function (L) {
          var set = {}, pt = F.pts[L.rv], seen = {}, q = L.node >= 0 && F.reach[L.node] ? F.nodes[L.node].succ.slice() : [];
          if (L.line) set[L.line] = 1;
          while (q.length) {
            var p = q.shift();
            if (seen[p] || !pt[p] || !F.reach[p]) continue;
            seen[p] = 1; if (F.nodes[p].line) set[F.nodes[p].line] = 1;
            F.nodes[p].succ.forEach(function (s) { q.push(s); });
          }
          var loc = F.locals[L.place.l];
          return {
            id: L.id, mut: !!L.mut, twoPhase: !!L.twoPhase, place: placeStr(F, L.place), line: L.line,
            lines: Object.keys(set).map(Number).sort(function (x, y) { return x - y; }),
            ofRef: !!loc && L.place.p.length === 0 && !!loc.ty && loc.ty.k === 'ref',
            deref: L.place.p.some(function (s) { return s.k === 'd'; })
          };
        })
      });
    });
    return out;
  };

  /* MR.nesting(src) → Lesson 06's rule, computed: is every borrow's region inside its owner's extent?
     { fns:[{ name, owners:[{name,kind,from,to}], loans:[{ id, mut, place, line, region:[lines], lexEnd, owner, outside:[lines], toCaller, fits }] }],
       errors (rustc-style, real regions), lexErrors (the same checks with block-shaped regions), parseError }
     extents are in source lines: a variable lives from its `let` to the closing line of its block, a temporary
     to the end of its statement, a parameter's referent beyond the function (`to` = Infinity). */
  function pubErr(e) { return { code: e.code, msg: e.msg, line: e.line, loanLine: e.loanLine, useLine: e.useLine, dropLine: e.dropLine, accessLine: e.accessLine, kind: e.kind, fn: e.fn, loan: e.loan }; }
  MR.nesting = function (src) {
    var real = analyzeProgram(src), lex = analyzeProgram(src, { lexical: true });
    var out = { fns: [], errors: real.errors.map(pubErr), lexErrors: lex.errors.map(pubErr), parseError: real.parseError || lex.parseError };
    real.fns.forEach(function (F) {
      var fnEnd = 0; F.nodes.forEach(function (n) { if ((n.line || 0) > fnEnd) fnEnd = n.line; });
      var owners = [], seen = {};
      var loans = F.loans.map(function (L) {
        var set = {}, pt = F.pts[L.rv], vis = {}, q = L.node >= 0 && F.reach[L.node] ? F.nodes[L.node].succ.slice() : [];
        if (L.line) set[L.line] = 1;
        while (q.length) {
          var p = q.shift();
          if (vis[p] || !pt[p] || !F.reach[p]) continue;
          vis[p] = 1; if (F.nodes[p].line) set[F.nodes[p].line] = 1;
          F.nodes[p].succ.forEach(function (s) { q.push(s); });
        }
        var region = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
        var regs = F.reachableRegions(L.rv), toCaller = false;
        F.regions.forEach(function (rg) { if (rg.kind === 'univ' && regs.has(rg.id)) toCaller = true; });
        var root = F.locals[L.place.l], behind = L.place.p.some(function (s) { return s.k === 'd'; }), kind, from, to;
        if (behind) { kind = root.param ? 'caller' : 'reborrow'; from = 0; to = Infinity; }
        else if (root.temp) { kind = 'temp'; from = root.line || L.line; to = F.endLine[root.id] !== undefined ? F.endLine[root.id] : from; }
        else if (root.param) { kind = 'param'; from = root.line || 1; to = F.endLine[root.id] !== undefined ? F.endLine[root.id] : fnEnd; }
        else { kind = 'local'; from = root.line; to = F.endLine[root.id] !== undefined ? F.endLine[root.id] : fnEnd; }
        var outside = region.filter(function (ln) { return ln > to; });
        var fits = outside.length === 0 && !(toCaller && to !== Infinity);
        var ownerName = behind ? null : (root.temp ? '⟨temporary⟩' : root.name);
        if (ownerName && !seen[ownerName + ':' + from]) { seen[ownerName + ':' + from] = 1; owners.push({ name: ownerName, kind: kind, from: from, to: to }); }
        return { id: L.id, mut: !!L.mut, twoPhase: !!L.twoPhase, place: (root.temp && !behind) ? '⟨temporary⟩' : placeStr(F, L.place), line: L.line, region: region, lexEnd: F.lexEnd[L.id].line, owner: ownerName, ownerKind: kind, ownerFrom: from, ownerTo: to, outside: outside, toCaller: toCaller, fits: fits,
                 ofRef: !behind && L.place.p.length === 0 && !!root.ty && root.ty.k === 'ref', deref: behind };
      });
      var locals = F.locals.filter(function (l) { return l.name && !l.temp && l.name !== '_0'; }).map(function (l) {
        return { name: l.name, from: l.line || 1, to: F.endLine[l.id] !== undefined ? F.endLine[l.id] : fnEnd, ref: !!l.ty && l.ty.k === 'ref', param: !!l.param };
      });
      out.fns.push({ name: F.name, end: fnEnd, owners: owners, locals: locals, loans: loans });
    });
    return out;
  };

  /* MR.flow(src, opts) → what the checker computes, point by point (Lesson 07's widget).
       opts.noTwoPhase  treat every auto-referenced `&mut` as an ordinary exclusive borrow (the counterfactual of the two-phase section)
     { parseError, errors:[{ code, msg, line, loanLine, useLine, accessLine, kind }],
       fns:[{ name, passes, trace:[{ line: [names] }] (the live sets after each pass), code:[lines that hold a program point], ends:[lines where a path leaves the function],
              at:{ line: { live:[names], scope:[loan ids], acc:[{ kind, text, place, loan, hits:[{ loan, code }] }] } },
              arcs:[{ from, to, kind:'jump'|'back' }],
              loans:[{ id, mut, twoPhase, place, line, scope:[lines], holders:[names], bookkeeping }] }] }
     `live` is the set of named references (and `⟨iterator⟩`) live on entry to the line; `scope` the loans in scope on entry; `acc` the accesses the line performs, each with the loans it meets and the verdict of the law against them. */
  function accText(F, a) {
    var p = placeStr(F, a.pl);
    switch (a.kind) {
      case 'copy': return 'read ' + p;
      case 'move': return 'move ' + p;
      case 'write': return 'write ' + p;
      case 'replace': return 'write ' + p + ' (drops the old value)';
      case 'sborrow': return 'shared borrow of ' + p;
      case 'mborrow': return 'exclusive borrow of ' + p;
      case 'reserve': return 'reserve an exclusive borrow of ' + p;
      case 'activate': return 'activate the exclusive borrow of ' + p;
      case 'sdead': return p + ' goes out of scope';
      case 'drop': return 'drop ' + p;
    }
    return a.kind + ' ' + p;
  }
  MR.flow = function (src, opts) {
    var r = analyzeProgram(src, opts), out = { fns: [], errors: r.errors.map(pubErr), parseError: r.parseError };
    r.fns.forEach(function (F) {
      var N = F.nodes.length, entry = {}, byLine = {}, codeSet = {};
      F.nodes.forEach(function (n) {
        if (!F.reach[n.id] || !n.line) return;
        if (entry[n.line] === undefined) entry[n.line] = n.id;
        (byLine[n.line] = byLine[n.line] || []).push(n.id);
        codeSet[n.line] = 1;
      });
      var code = Object.keys(codeSet).map(Number).sort(function (x, y) { return x - y; });
      var nextCode = {}; code.forEach(function (ln, i) { nextCode[ln] = code[i + 1]; });
      function shownLocal(l) {           // named references, and the iterator a `for` loop holds
        if (l.rv < 0) return false;
        if (l.name && !l.temp && l.name !== '_0') return true;
        return !!l.ty && l.ty.k === 'iter' && l.ty.kind !== 'own';
      }
      function nm(l) { return l.name && !l.temp ? l.name : '⟨iterator⟩'; }
      // the points at which control enters a line: a point whose predecessor lies on another line (or the function's entry).
      // A `for` header and the brace that closes a loop have two.
      var entries = {};
      code.forEach(function (ln) {
        var es = byLine[ln].filter(function (nid) { return nid === F.entry || F.nodes[nid].pred.some(function (p) { return F.reach[p] && F.nodes[p].line !== ln; }); });
        entries[ln] = es.length ? es : [byLine[ln][0]];
      });
      var at = {};
      code.forEach(function (ln) {
        var live = [], scope = [];
        entries[ln].forEach(function (nid) {
          F.liveIn[nid].forEach(function (id) { var l = F.locals[id]; if (shownLocal(l) && live.indexOf(nm(l)) < 0) live.push(nm(l)); });
          F.loans.forEach(function (L) { if (F.inScope[L.id][nid] && scope.indexOf(L.id) < 0) scope.push(L.id); });
        });
        var acc = [];
        byLine[ln].forEach(function (nid) {
          F.acc[nid].forEach(function (a) {
            var hits = [];
            F.loans.forEach(function (L) {
              if (!F.inScope[L.id][nid] || (a.loan === L.id && a.kind === 'activate') || !placesConflict(L.place, a.pl, a.depth)) return;
              var c = accessVerdict(F, a, L, nid);
              if (c === 'S') { c = F.locals[L.place.l].temp ? 'E0716' : 'E0597'; }
              hits.push({ loan: L.id, code: c });
            });
            acc.push({ kind: a.kind, text: accText(F, a), place: placeStr(F, a.pl), loan: a.loan === undefined ? null : a.loan, node: nid, hits: hits });
          });
        });
        at[ln] = { live: live, scope: scope, acc: acc };
      });
      // control-flow edges that are not simply "the next line down"
      var arcs = [], seenArc = {}, ends = [];
      F.nodes.forEach(function (n) {
        if (!F.reach[n.id] || !n.line) return;
        if (n.op.k === 'ret' && ends.indexOf(n.line) < 0) ends.push(n.line);
        n.succ.forEach(function (sid) {
          var m = F.nodes[sid];
          if (!F.reach[sid] || !m.line || m.line === n.line) return;
          if (m.line === nextCode[n.line]) return;
          var key = n.line + '>' + m.line;
          if (seenArc[key]) return; seenArc[key] = 1;
          arcs.push({ from: n.line, to: m.line, kind: m.line <= n.line ? 'back' : 'jump' });
        });
      });
      // loans: the lines on which each is in scope (lines without a point are transparent)
      var loans = F.loans.map(function (L) {
        var set = {};
        if (L.line) set[L.line] = 1;
        code.forEach(function (ln) { if (at[ln].scope.indexOf(L.id) >= 0) set[ln] = 1; });
        var lines = Object.keys(set).map(Number).sort(function (x, y) { return x - y; });
        var have = {}; lines.forEach(function (ln) { have[ln] = 1; });
        var filled = lines.slice();
        for (var ln = lines[0]; ln !== undefined && ln <= lines[lines.length - 1]; ln++) {
          if (have[ln] || codeSet[ln]) continue;
          var prev = null, next = null;
          for (var k = 0; k < code.length; k++) { if (code[k] < ln) prev = code[k]; if (code[k] > ln && next === null) next = code[k]; }
          if (prev !== null && next !== null && have[prev] && have[next]) { filled.push(ln); have[ln] = 1; }
        }
        filled.sort(function (x, y) { return x - y; });
        var regs = F.reachableRegions(L.rv), holders = [], carriers = carrierLocals(F, L);
        F.locals.forEach(function (l) { if (shownLocal(l) && carriers.has(l.id) && holders.indexOf(nm(l)) < 0) holders.push(nm(l)); });
        var loc = F.locals[L.place.l], behind = L.place.p.some(function (x) { return x.k === 'd'; });
        var toCaller = false; F.regions.forEach(function (rg) { if (rg.kind === 'univ' && regs.has(rg.id)) toCaller = true; });
        return { id: L.id, mut: !!L.mut, twoPhase: !!L.twoPhase, place: placeStr(F, L.place), line: L.line, scope: filled, holders: holders, toCaller: toCaller,
                 ofRef: !behind && L.place.p.length === 0 && !!loc.ty && loc.ty.k === 'ref', deref: behind, temp: !!loc.temp };
      });
      // the liveness sets after each pass of the fixed-point iteration, by line (the lesson's table of passes)
      var trace = F.liveSnaps.map(function (snap) {
        var byL = {};
        code.forEach(function (ln) {
          var names = [];
          entries[ln].forEach(function (nid) { snap[nid].forEach(function (id) { var l = F.locals[id]; if (shownLocal(l) && names.indexOf(nm(l)) < 0) names.push(nm(l)); }); });
          byL[ln] = names;
        });
        return byL;
      });
      out.fns.push({ name: F.name, passes: F.livePasses, trace: trace, code: code, ends: ends, at: at, arcs: arcs, loans: loans });
    });
    return out;
  };

  /* MR.flowAll(src, opts) → the whole file as one picture: the per-function data of MR.flow merged (loan ids made unique),
     plus `vis`, the loans worth drawing (not bookkeeping loans of one line: macro reads, call temporaries, reborrows of temporaries). */
  MR.flowAll = function (src, opts) {
    var f = MR.flow(src, opts);
    var m = { at: {}, arcs: [], ends: [], code: [], passes: 0, loans: [], errors: [], parseError: f.parseError };
    var names = f.fns.map(function (fn) { return fn.name; });
    f.fns.forEach(function (fn, k) {
      var off = k * 1000;
      Object.keys(fn.at).forEach(function (ln) {
        var a = fn.at[ln];
        m.at[ln] = { live: a.live, scope: a.scope.map(function (i) { return i + off; }),
                     acc: a.acc.map(function (x) { return { kind: x.kind, text: x.text, place: x.place, hits: x.hits.map(function (h) { return { loan: h.loan + off, code: h.code }; }) }; }) };
      });
      m.arcs = m.arcs.concat(fn.arcs); m.ends = m.ends.concat(fn.ends); m.code = m.code.concat(fn.code); m.passes = Math.max(m.passes, fn.passes);
      fn.loans.forEach(function (l) { var c = {}; for (var key in l) c[key] = l[key]; c.id = l.id + off; m.loans.push(c); });
    });
    m.errors = f.errors.map(function (e) {
      var c = {}; for (var key in e) c[key] = e[key];
      var k = names.indexOf(e.fn);
      c.loan = e.loan !== undefined && e.loan !== null && k >= 0 ? e.loan + k * 1000 : null;
      return c;
    });
    var named = {}; m.errors.forEach(function (e) { if (e.loan !== null) named[e.loan] = 1; });
    m.vis = m.loans.filter(function (l) { return named[l.id] || (!l.ofRef && !l.temp && !/_\d/.test(l.place) && l.scope.length > 1); });
    return m;
  };

  /* MR.sigs(src) → { fns:[{ name, line, written, explicit, rule, fresh, errs }], parseError }
     For every function and method: the signature as written, and with every lifetime spelled out.
       rule   which elision rule gave the output its lifetime: 0 nothing was elided, 2 the one input lifetime,
              3 the lifetime of `&self`, 'none' the rules could not decide (E0106, `explicit` is null)
       fresh  how many lifetime parameters rule 1 had to invent for elided inputs
     `explicit` is what the compiler means by `written`; it reads only the signature, never the body. */
  MR.sigs = function (src) {
    var out = { fns: [], parseError: null }, prog;
    try { prog = parse(src); } catch (e) { if (e.isMR) { out.parseError = { msg: e.message, line: e.line }; return out; } throw e; }
    var world = new World(prog), lines = src.split('\n');
    function written(decl) {
      var t = '';
      for (var i = decl.line - 1; i < lines.length && i < decl.line + 5; i++) {
        t += (t ? ' ' : '') + lines[i].trim();
        if (/[{;]/.test(lines[i])) break;
      }
      return t.replace(/^pub\s+/, '').replace(/\s*[{;].*$/, '');
    }
    function explicit(sig) {
      if (sig.rule === 'none') return null;
      var d = sig.decl, used = {}, names = {}, letters = 'abcdefghijklmnopqrstuvwxyz', li = 0;
      d.lts.forEach(function (l) { used[l] = 1; });
      ((sig.owner && sig.owner.lts) || []).forEach(function (l) { used[l] = 1; });
      sig.fresh.forEach(function (f) { var n; do { n = "'" + letters.charAt(li++); } while (used[n]); used[n] = 1; names[f] = n; });
      function nm(l) { return names[l] || (l === 'static' ? "'static" : l); }
      function show(t) {
        if (!t) return '?';
        if (t.k === 'ref') return '&' + (t.lt ? nm(t.lt) + ' ' : '') + (t.mut ? 'mut ' : '') + show(t.to);
        if (t.k === 'Vec') return 'Vec<' + show(t.el) + '>';
        if (t.k === 'Box') return 'Box<' + show(t.el) + '>';
        if (t.k === 'adt') return t.name + (t.lts && t.lts.length ? '<' + t.lts.map(nm).join(', ') + '>' : '');
        return tyStr(t);
      }
      var params = sig.params.map(function (p) {
        if (p.isSelf) return p.ty.k === 'ref' ? '&' + nm(p.selfLt) + ' ' + (p.ty.mut ? 'mut ' : '') + 'self' : (p.mut ? 'mut ' : '') + 'self';
        return (p.mut ? 'mut ' : '') + p.name + ': ' + show(p.ty);
      });
      var bounds = {}; d.outlives.forEach(function (o) { (bounds[o[0]] = bounds[o[0]] || []).push(o[1]); });
      var lts = d.lts.map(function (l) { return l + (bounds[l] ? ': ' + bounds[l].join(' + ') : ''); }).concat(sig.fresh.map(function (f) { return names[f]; }));
      return 'fn ' + d.name + (lts.length ? '<' + lts.join(', ') + '>' : '') + '(' + params.join(', ') + ')' + (sig.ret ? ' -> ' + show(sig.ret) : '');
    }
    function entry(decl, owner) {
      var sg = makeSig(world, decl, owner);
      return { name: decl.name, line: decl.line, written: written(decl), explicit: explicit(sg), rule: sg.rule, fresh: sg.fresh.length, errs: sg.errs.map(function (e) { return { code: e.code, msg: e.msg, line: e.line, note: e.note }; }) };
    }
    try {
      prog.items.forEach(function (it) {
        if (it.k === 'fn') out.fns.push(entry(it, null));
        if (it.k === 'impl') it.fns.forEach(function (f) { out.fns.push(entry(f, it.target)); });
      });
    } catch (e) { if (e.isMR) { out.parseError = { msg: e.message, line: e.line }; return out; } throw e; }
    return out;
  };

  MR.parse = parse; MR.lex = lex; MR.analyze = analyzeProgram; MR.tyStr = tyStr; MR.placeStr = placeStr;
  MR.check = function (src) {
    var r = analyzeProgram(src);
    return { ok: r.ok, errors: r.errors.map(function (e) { return { code: e.code, msg: e.msg, line: e.line, fn: e.fn, loanLine: e.loanLine, useLine: e.useLine, dropLine: e.dropLine, accessLine: e.accessLine, moveLines: e.moveLines, kind: e.kind, note: e.note }; }), parseError: r.parseError };
  };
  /* ───────────────────────────── interpreter: run the program, record every drop ───────────────────────────── */
  /* MR.run(src, {conds:[true,false,…]}) -> { events:[{k,line,text,snap}], out:[lines], error, exit }
     Places are cells; a reference is a pointer to a cell; String / Vec / Box are handles to heap records.
     Scope exit drops locals in reverse declaration order, a struct runs its own `Drop::drop` first and then
     drops its fields in declaration order, temporaries die at the end of their statement. */
  function runProgram(src, opts) {
    opts = opts || {};
    var prog = parse(src), world = new World(prog);
    var conds = opts.conds && opts.conds.length ? opts.conds : [false], condI = 0;
    var events = [], out = [], heap = {}, heapSeq = 0, frames = [], curLine = 0, fuel = opts.fuel || 60000, maxEv = opts.maxEvents || 1200;
    var snapOn = opts.snapshots !== false, copyBits = !!opts.copyBits;    // copyBits: the hypothetical "assignment copies the header" machine
    var PanicSig = function (msg) { this.panic = msg; this.line = curLine; };      // the line is taken here: unwinding moves curLine to the closing braces
    var halted = false;          // after a stop that rustc would have reported at compile time nothing else happens: no unwinding, no output
    function staticStop(msg) {   // the machine stops at the offending line, before any unwinding
      ev('error', msg, {});
      halted = true;
      var s = new PanicSig(msg); s.reported = true; return s;
    }
    var Sig = function (k, v) { this.sig = k; this.val = v; };

    /* ── values ── */
    var UNIT = { t: 'unit' };
    function cellOf(v, st) { return { v: v, st: st || 'live' }; }
    function isCopyVal(v) {
      switch (v.t) {
        case 'int': case 'bool': case 'char': case 'unit': case 'str': return true;
        case 'ref': return !v.mut;
        case 'struct': return (world.structs[v.name].derive || []).indexOf('Copy') >= 0;
      }
      return false;
    }
    function needsDropVal(v) {
      switch (v.t) {
        case 'String': case 'Vec': case 'Box': case 'iterOwn': return true;
        case 'struct':
          if (world.drops[v.name]) return true;
          return Object.keys(v.f).some(function (k) { return v.f[k].st === 'live' && needsDropVal(v.f[k].v); });
      }
      return false;
    }
    function owns(v) { return v.t === 'String' || v.t === 'Vec' || v.t === 'Box' || v.t === 'struct' || v.t === 'iterOwn'; }
    function alloc(kind, extra) {
      var id = ++heapSeq, h = { id: id, kind: kind, freed: false };
      for (var k in extra) h[k] = extra[k];
      heap[id] = h;
      return h;
    }
    /* a String / Vec / Box value is a handle (its header); `id` names the heap block behind it, 0 = no block yet
       (an empty String or Vec owns no allocation until it needs room) */
    function attach(v) { var h = alloc(v.t, { owner: v }); v.id = h.id; return v; }
    function mkString(s, cap) { var v = { t: 'String', id: 0, s: s, cap: cap === undefined ? s.length : cap }; return v.cap > 0 ? attach(v) : v; }
    function mkVec(items, cap) { var v = { t: 'Vec', id: 0, items: items.map(function (x) { return cellOf(x); }), cap: cap === undefined ? items.length : cap }; return v.cap > 0 ? attach(v) : v; }
    function mkBox(x) { return attach({ t: 'Box', id: 0, inner: cellOf(x) }); }
    function free(id, label) {
      var h = heap[id];
      if (h.freed) { ev('doublefree', 'free #' + id + ' AGAIN — the block was already freed', { id: id }); throw new PanicSig('double free of block #' + id + ' (undefined behavior in C++; the machine stops here)'); }
      h.freed = true; ev('free', 'free ' + h.kind + ' #' + id + (label ? ' (' + label + ')' : ''), { id: id });
    }
    function strOf(v) { while (v.t === 'ref') v = v.cell.v; if (v.t === 'str') return v.v; if (v.t === 'String') return v.s; throw new PanicSig('not a string'); }

    /* ── events & snapshots ── */
    function fmtVal(v, dbg) {
      switch (v.t) {
        case 'int': case 'bool': return String(v.v);
        case 'char': return dbg ? "'" + v.v + "'" : v.v;
        case 'unit': return '()';
        case 'str': return dbg ? JSON.stringify(v.v) : v.v;
        case 'String': return dbg ? JSON.stringify(v.s) : v.s;
        case 'ref': return fmtVal(v.cell.v, dbg);
        case 'Vec': return '[' + v.items.map(function (c) { return c.st === 'live' ? fmtVal(c.v, true) : '_'; }).join(', ') + ']';
        case 'Box': return fmtVal(v.inner.v, dbg);
        case 'struct': {
          var s = world.structs[v.name];
          return v.name + ' { ' + s.fields.map(function (f) { var c = v.f[f.name]; return f.name + ': ' + (c.st === 'live' ? fmtVal(c.v, true) : '⟨' + c.st + '⟩'); }).join(', ') + ' }';
        }
      }
      return '?';
    }
    function shortVal(v) {
      switch (v.t) {
        case 'int': case 'bool': case 'char': case 'unit': return fmtVal(v, true);
        case 'str': return JSON.stringify(v.v);
        case 'String': return 'String { ptr→' + (v.id ? '#' + v.id : 'none') + ', cap ' + v.cap + ', len ' + v.s.length + ' }';
        case 'Vec': return 'Vec { ptr→' + (v.id ? '#' + v.id : 'none') + ', cap ' + v.cap + ', len ' + v.items.length + ' }';
        case 'Box': return 'Box { ptr→#' + v.id + ' }';
        case 'ref': return (v.mut ? '&mut ' : '&') + (v.cell.label || '…');
        case 'struct': return v.name + ' { ' + world.structs[v.name].fields.map(function (f) { var c = v.f[f.name]; return f.name + ': ' + (c.st === 'live' ? shortVal(c.v) : '⟨' + c.st + '⟩'); }).join(', ') + ' }';
        case 'iterOwn': return 'IntoIter';
      }
      return '?';
    }
    function heapRefs(v, acc) {
      if (!v) return acc;
      if ((v.t === 'String' || v.t === 'Vec' || v.t === 'Box') && v.id) acc.push(v.id);
      if (v.t === 'struct') Object.keys(v.f).forEach(function (k) { var c = v.f[k]; if (c.st === 'live') heapRefs(c.v, acc); });
      return acc;
    }
    function snapshot() {
      if (!snapOn) return null;
      var stack = frames.map(function (fr) {
        var ls = [];
        fr.scopes.forEach(function (sc) { sc.locals.forEach(function (L) { ls.push({ name: L.name, st: L.cell.st, desc: L.cell.st === 'live' ? shortVal(L.cell.v) : '', heap: L.cell.st === 'live' ? heapRefs(L.cell.v, []) : [] }); }); });
        (fr.temps || []).forEach(function (ts) { ts.forEach(function (c) { ls.push({ name: '⟨temp⟩', st: c.st, desc: c.st === 'live' ? shortVal(c.v) : '', heap: c.st === 'live' ? heapRefs(c.v, []) : [] }); }); });
        return { fn: fr.name, locals: ls };
      });
      var hp = Object.keys(heap).map(function (k) {
        var h = heap[k];
        var o = h.owner, d = h.kind === 'String' ? JSON.stringify(o.s) : h.kind === 'Vec' ? '[' + o.items.map(function (c) { return c.st === 'live' ? fmtVal(c.v, true) : '_'; }).join(', ') + ']' : h.kind === 'Box' ? fmtVal(o.inner.v, true) : '';
        if (h.kind !== 'Box') d += '   cap ' + o.cap;
        return { id: h.id, kind: h.kind, desc: d, freed: h.freed };
      });
      return { stack: stack, heap: hp, out: out.length };
    }
    function ev(k, text, extra) {
      if (halted) return;
      if (events.length >= maxEv) throw new PanicSig('too many steps for the visualiser (limit ' + maxEv + ' events)');
      var e = { k: k, line: curLine, text: text, snap: null };
      if (extra) for (var x in extra) e[x] = extra[x];
      events.push(e);
      if (k !== 'alloc') e.snap = snapshot();
    }
    function spend() { if (--fuel < 0) throw new PanicSig('step limit reached (is there an infinite loop?)'); }

    /* ── drops ── */
    function dropCell(cell, why, label) {
      if (halted || cell.st !== 'live') return;                          // moved out, or already ended: nothing to do
      var v = cell.v;
      if (!needsDropVal(v)) { cell.st = 'dropped'; return; }   // plain data has no ending to run
      var shown = label.charAt(0) === '⟨' ? label + ' = ' + shortVal(v).slice(0, 44) : label;
      ev('drop', 'drop ' + shown + (why ? '  (' + why + ')' : ''), { label: label, why: why });
      if (v.t === 'struct') {
        if (world.drops[v.name]) callFn(world.impls[v.name]['drop'], [{ t: 'ref', mut: true, cell: cell }], 'Drop::drop');   // 1. its own Drop::drop
        world.structs[v.name].fields.forEach(function (f) { dropCell(v.f[f.name], 'field', label + '.' + f.name); });          // 2. then its fields, in declaration order
      } else if (v.t === 'Vec') {
        v.items.forEach(function (c, i) { dropCell(c, 'element', label + '[' + i + ']'); });                                  // elements, first to last
        cell.st = 'dropped'; if (v.id) free(v.id, label);                                                                      // 3. then the memory it owns
      } else if (v.t === 'Box') { dropCell(v.inner, 'contents', '*' + label); cell.st = 'dropped'; free(v.id, label); }
      else if (v.t === 'String') { cell.st = 'dropped'; if (v.id) free(v.id, label); }
      else if (v.t === 'iterOwn') {
        for (var i = v.pos; i < v.items.length; i++) dropCell(v.items[i], 'unconsumed', label + '[' + i + ']');
        cell.st = 'dropped'; if (v.id) free(v.id, label);
      }
      cell.st = 'dropped';
    }
    function dropScope(sc) {
      for (var i = sc.locals.length - 1; i >= 0; i--) {
        var L = sc.locals[i];
        if (L.cell.st === 'live') dropCell(L.cell, 'scope end', L.name);
        else if (L.cell.st === 'moved' && L.cell.v && needsDropVal(L.cell.v)) { ev('skip', L.name + ' was moved: nothing to drop', { label: L.name }); }
      }
    }

    /* ── frames / scopes / temps ── */
    function fr() { return frames[frames.length - 1]; }
    function pushScope() { fr().scopes.push({ locals: [] }); }
    // the scope stays on the frame while its locals are being dropped, so the machine can show them ending one by one
    function popScope() { var f = fr(), sc = f.scopes[f.scopes.length - 1]; try { dropScope(sc); } finally { f.scopes.pop(); } }
    function declare(name, cell) { cell.label = name; fr().scopes[fr().scopes.length - 1].locals.push({ name: name, cell: cell }); }
    function lookup(name) {
      var f = fr();
      for (var i = f.scopes.length - 1; i >= 0; i--) { var ls = f.scopes[i].locals; for (var j = ls.length - 1; j >= 0; j--) if (ls[j].name === name) return ls[j].cell; }
      return null;
    }
    function beginStmt() { fr().temps.push([]); }
    function endStmt() {
      var ts = fr().temps.pop();
      for (var i = ts.length - 1; i >= 0; i--) if (ts[i].st === 'live') dropCell(ts[i], 'temporary', '⟨temp⟩');
    }
    function tempCell(v) { var c = cellOf(v); c.label = '⟨temp⟩'; var ts = fr().temps[fr().temps.length - 1]; ts.push(c); return c; }

    /* ── labels for events ── */
    function labelOf(e) {
      switch (e.k) {
        case 'paren': return labelOf(e.e);
        case 'path': return e.segs.join('::');
        case 'field': return labelOf(e.e) + '.' + e.name;
        case 'index': return labelOf(e.e) + '[…]';
        case 'un': return '*' + labelOf(e.e);
        case 'addr': return '&' + (e.mut ? 'mut ' : '') + labelOf(e.e);
      }
      return '⟨value⟩';
    }
    function isPlace(e) {
      switch (e.k) {
        case 'paren': return isPlace(e.e);
        case 'path': return e.segs.length === 1 && !!lookup(e.segs[0]);
        case 'field': case 'index': return true;
        case 'un': return e.op === '*';
      }
      return false;
    }

    /* ── places ── */
    function derefCell(c) {
      var v = c.v;
      if (v.t === 'ref') return v.cell;
      if (v.t === 'Box') return v.inner;
      throw new PanicSig('cannot dereference a non-reference');
    }
    function placeCell(e) {
      spend();
      switch (e.k) {
        case 'paren': return placeCell(e.e);
        case 'path': { var c = lookup(e.segs[0]); if (!c) throw new PanicSig('unknown name `' + e.segs[0] + '`'); return c; }
        case 'field': {
          var b = isPlace(e.e) ? placeCell(e.e) : tempCell(evalExpr(e.e));
          if (b.st !== 'live') throw staticStop('use of ' + b.st + ' value `' + labelOf(e.e) + '`');
          while (b.v.t === 'ref' || b.v.t === 'Box') { b = derefCell(b); if (b.st !== 'live') throw staticStop('use of ' + b.st + ' value `*' + labelOf(e.e) + '`'); }
          if (b.v.t !== 'struct') throw new PanicSig('no field `' + e.name + '`');
          var fc = b.v.f[e.name]; if (!fc) throw new PanicSig('no field `' + e.name + '`');
          if (!fc.label) fc.label = (b.label || '') + '.' + e.name;
          return fc;
        }
        case 'un': { var ib = isPlace(e.e) ? placeCell(e.e) : tempCell(evalExpr(e.e)); if (ib.st !== 'live') throw staticStop('use of ' + ib.st + ' value `' + labelOf(e.e) + '`'); return derefCell(ib); }
        case 'index': {
          var base = isPlace(e.e) ? placeCell(e.e) : tempCell(evalExpr(e.e));
          if (base.st !== 'live') throw staticStop('use of ' + base.st + ' value `' + labelOf(e.e) + '`');
          while (base.v.t === 'ref') base = derefCell(base);
          if (base.v.t !== 'Vec') throw new PanicSig('cannot index');
          var idx = evalExpr(e.idx).v, items = base.v.items;
          if (idx < 0 || idx >= items.length) throw new PanicSig('index out of bounds: the len is ' + items.length + ' but the index is ' + idx);
          return items[idx];
        }
      }
      throw new PanicSig('not a place');
    }
    /* read a place used as an operand: Copy values are copied, everything else moves out */
    function takeOperand(e) {
      var c = placeCell(e);
      if (c.st !== 'live') throw staticStop('use of ' + c.st + ' value `' + labelOf(e) + '`');
      if (isCopyVal(c.v)) return c.v;
      if (c.v.t === 'ref') return c.v;           // &mut is re-borrowed by the checker; here it is passed along
      // a place somebody else relies on cannot be left dead: the checker says E0507, and the machine stops at the same spot
      if (e.k === 'index') throw staticStop('cannot move out of index of `Vec`: the vector still owns the element');
      if (e.k === 'un' && e.op === '*' && isPlace(e.e)) {
        var bc = placeCell(e.e);
        if (bc.v.t === 'ref') throw staticStop('cannot move out of `' + labelOf(e) + '` which is behind a ' + (bc.v.mut ? 'mutable' : 'shared') + ' reference');
      }
      if (copyBits && needsDropVal(c.v)) { ev('copy', labelOf(e) + ' copied bit for bit — now two names hold the same header', { label: labelOf(e) }); return c.v; }
      var v = c.v;
      c.st = 'moved';
      ev('move', labelOf(e) + ' moved out', { label: labelOf(e) });
      return v;
    }

    /* ── expressions ── */
    function evalExpr(e) {
      spend();
      if (e.line) curLine = e.line;
      switch (e.k) {
        case 'paren': return evalExpr(e.e);
        case 'int': return { t: 'int', v: Number(e.v) };
        case 'bool': return { t: 'bool', v: e.v };
        case 'char': return { t: 'char', v: e.v };
        case 'str': return { t: 'str', v: e.v };
        case 'unit': return UNIT;
        case 'path': case 'field': case 'index': return takeOperand(e);
        case 'un': {
          if (e.op === '*') return takeOperand(e);
          var x = evalExpr(e.e);
          if (e.op === '!') return { t: 'bool', v: !x.v };
          return { t: 'int', v: -x.v };
        }
        case 'addr': {
          var c = isPlace(e.e) ? placeCell(e.e) : tempCell(evalExpr(e.e));
          if (c.st !== 'live' && isPlace(e.e)) throw staticStop('borrow of ' + c.st + ' value `' + labelOf(e.e) + '`');
          if (!c.label) c.label = labelOf(e.e);
          return { t: 'ref', mut: e.mut, cell: c };
        }
        case 'bin': return evalBin(e);
        case 'range': return { t: 'range', a: evalExpr(e.a).v, b: evalExpr(e.b).v };
        case 'assign': evalAssign(e); return UNIT;
        case 'slit': {
          var sd = world.structs[e.name]; if (!sd) throw new PanicSig('unknown struct `' + e.name + '`');
          var vals = {};
          e.fields.forEach(function (f) { vals[f.n] = evalExpr(f.e); });
          var fields = {};
          sd.fields.forEach(function (f) { fields[f.name] = cellOf(vals[f.name]); });
          return { t: 'struct', name: e.name, f: fields };
        }
        case 'vec': { var items = e.items.map(evalExpr); return mkVec(items); }
        case 'macro': return evalMacro(e);
        case 'call': return evalCall(e);
        case 'mcall': return evalMCall(e);
        case 'block': return execBlock(e.b);
        case 'if': {
          beginStmt(); var cv; try { cv = evalExpr(e.cond); } finally { endStmt(); }
          if (cv.v) return execBlock(e.then);
          if (e.els) return evalExpr(e.els);
          return UNIT;
        }
        case 'while': {
          for (;;) {
            beginStmt(); var w; try { w = evalExpr(e.cond); } finally { endStmt(); }
            if (!w.v) break;
            try { execBlock(e.body); } catch (s) { if (s instanceof Sig) { if (s.sig === 'break') break; if (s.sig === 'continue') continue; } throw s; }
          }
          return UNIT;
        }
        case 'loop': {
          for (;;) { try { execBlock(e.body); } catch (s) { if (s instanceof Sig) { if (s.sig === 'break') break; if (s.sig === 'continue') continue; } throw s; } }
          return UNIT;
        }
        case 'for': return evalFor(e);
        case 'break': throw new Sig('break');
        case 'continue': throw new Sig('continue');
        case 'return': { var rv = e.e ? evalExpr(e.e) : UNIT; throw new Sig('return', rv); }
      }
      throw new PanicSig('the interpreter does not support `' + e.k + '`');
    }
    function evalBin(e) {
      if (e.op === '&&') { var a1 = evalExpr(e.a); return a1.v ? evalExpr(e.b) : a1; }
      if (e.op === '||') { var a2 = evalExpr(e.a); return a2.v ? a2 : evalExpr(e.b); }
      var a = derefAll(evalExpr(e.a)), b = derefAll(evalExpr(e.b));
      var x = a.t === 'String' || a.t === 'str' ? strOf(a) : a.v, y = b.t === 'String' || b.t === 'str' ? strOf(b) : b.v;
      switch (e.op) {
        case '+': return { t: 'int', v: x + y }; case '-': return { t: 'int', v: x - y }; case '*': return { t: 'int', v: x * y };
        case '/': if (y === 0) throw new PanicSig('attempt to divide by zero'); return { t: 'int', v: Math.trunc(x / y) };
        case '%': if (y === 0) throw new PanicSig('attempt to calculate the remainder with a divisor of zero'); return { t: 'int', v: x % y };
        case '==': return { t: 'bool', v: x === y }; case '!=': return { t: 'bool', v: x !== y };
        case '<': return { t: 'bool', v: x < y }; case '>': return { t: 'bool', v: x > y };
        case '<=': return { t: 'bool', v: x <= y }; case '>=': return { t: 'bool', v: x >= y };
      }
      throw new PanicSig('operator ' + e.op);
    }
    function derefAll(v) { while (v.t === 'ref') v = v.cell.v; return v; }
    function evalAssign(e) {
      var val;
      if (e.op) {
        var cur = placeCell(e.lhs); var r = evalExpr(e.rhs), d = derefAll(r);
        var nv = e.op === '+' ? cur.v.v + d.v : e.op === '-' ? cur.v.v - d.v : e.op === '*' ? cur.v.v * d.v : Math.trunc(cur.v.v / d.v);
        cur.v = { t: 'int', v: nv }; ev('assign', labelOf(e.lhs) + ' = ' + nv, { label: labelOf(e.lhs) }); return;
      }
      val = evalExpr(e.rhs);
      var target = placeCell(e.lhs);
      if (target.st === 'live') dropCell(target, 'overwritten by assignment', labelOf(e.lhs));
      target.v = val; target.st = 'live';
      ev('assign', labelOf(e.lhs) + ' = ' + shortVal(val), { label: labelOf(e.lhs) });
    }
    function evalMacro(e) {
      function peek(a) {
        if (isPlace(a)) { var pc = placeCell(a); if (pc.st !== 'live') throw staticStop('borrow of ' + pc.st + ' value `' + labelOf(a) + '`'); return pc.v; }
        var v = evalExpr(a); if (owns(v)) tempCell(v); return v;
      }
      if (e.name === 'println' || e.name === 'print') {
        var args = e.args.map(peek), ai = 0;
        var text = (e.fmt || '').replace(/\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_]*)?(?::([^}]*))?\}/g, function (m, nm, spec) {
          if (m === '{{') return '{'; if (m === '}}') return '}';
          var v;
          if (nm) { var c = lookup(nm); if (!c) throw new PanicSig('unknown name `' + nm + '`'); v = c.v; } else v = args[ai++];
          return fmtVal(derefAll(v), spec && spec.indexOf('?') >= 0);
        });
        if (e.name === 'println') { out.push(text); ev('print', 'print: ' + text, { text: text }); }
        else { out.push(text); ev('print', 'print: ' + text, { text: text }); }
        args.forEach(function (a) { /* arguments are borrowed; owned temporaries were registered */ });
        return UNIT;
      }
      if (e.name === 'assert') { var c1 = evalExpr(e.args[0]); if (!c1.v) throw new PanicSig('assertion failed'); return UNIT; }
      if (e.name === 'assert_eq') { var l = derefAll(peek(e.args[0])), r = derefAll(peek(e.args[1])); if (fmtVal(l) !== fmtVal(r)) throw new PanicSig('assertion `left == right` failed'); return UNIT; }
      throw new PanicSig('macro ' + e.name);
    }

    /* ── calls ── */
    function evalArgs(args) {
      return args.map(function (a) {
        var v = evalExpr(a);
        // an owned value that is only borrowed by the callee stays a temporary of this statement
        return v;
      });
    }
    function evalCall(e) {
      var s = e.path, last = s[s.length - 1];
      if (s[0] === 'std' && s.length > 1) s = s.slice(1);
      if (s.length === 1 && last === 'cond') { var b = conds[condI % conds.length]; condI++; return { t: 'bool', v: !!b }; }
      if (s.length === 1 && last === 'drop') {
        var d = evalExpr(e.args[0]);
        var c = cellOf(d); c.label = labelOf(e.args[0]);
        ev('call', 'drop(' + c.label + ')', {});
        dropCell(c, 'drop()', c.label);
        return UNIT;
      }
      if (s.length === 2 && s[0] === 'String' && (last === 'from' || last === 'new')) {
        if (last === 'new') return mkString('', 0);
        return mkString(strOf(evalExpr(e.args[0])));
      }
      if (s.length === 2 && s[0] === 'Vec' && (last === 'new' || last === 'with_capacity')) {
        return mkVec([], last === 'with_capacity' ? evalExpr(e.args[0]).v : 0);
      }
      if (s.length === 2 && s[0] === 'Box' && last === 'new') return mkBox(evalExpr(e.args[0]));
      if (s.length === 2 && s[0] === 'mem') {
        if (last === 'forget') { var fv = evalExpr(e.args[0]); ev('forget', 'mem::forget(' + labelOf(e.args[0]) + ') — the value is never dropped', {}); return UNIT; }
        if (last === 'take' || last === 'replace') {
          var rf = evalExpr(e.args[0]); var tc = rf.cell;
          var old = tc.v;
          var nv;
          if (last === 'take') nv = defaultLike(old); else nv = evalExpr(e.args[1]);
          tc.v = nv; ev('assign', 'mem::' + last + ' swapped in a new value', {});
          return old;
        }
        if (last === 'swap') {
          var r1 = evalExpr(e.args[0]), r2 = evalExpr(e.args[1]);
          var tmp = r1.cell.v; r1.cell.v = r2.cell.v; r2.cell.v = tmp; ev('assign', 'mem::swap', {}); return UNIT;
        }
      }
      var f, name = s.join('::');
      if (s.length === 1) f = world.fns[last];
      else if (s.length === 2 && world.impls[s[0]]) f = world.impls[s[0]][last];
      if (!f) throw new PanicSig('cannot find function `' + name + '`');
      return callFn(f, evalArgs(e.args), name);
    }
    function defaultLike(v) {
      if (v.t === 'String') return mkString('', 0);
      if (v.t === 'Vec') return mkVec([], 0);
      if (v.t === 'int') return { t: 'int', v: 0 };
      if (v.t === 'bool') return { t: 'bool', v: false };
      throw new PanicSig('no Default for this value');
    }
    function callFn(f, args, name) {
      spend();
      if (!f.body) throw new PanicSig('function `' + name + '` has no body');
      var frame = { name: name || f.name, scopes: [{ locals: [] }], temps: [] };
      frames.push(frame);
      var callLine = curLine;
      f.params.forEach(function (p, i) { var c = cellOf(args[i]); declare(p.isSelf ? 'self' : p.name, c); });
      ev('call', 'call ' + frame.name, { fn: frame.name });
      var ret = UNIT;
      try {
        try { ret = execBlock(f.body); }
        catch (s) { if (s instanceof Sig && s.sig === 'return') ret = s.val; else throw s; }
      } finally {
        // parameters are dropped after the body's locals, in reverse order of declaration
        curLine = f.body.endLine || curLine;
        try { dropScope(frame.scopes[frame.scopes.length - 1]); } finally { frame.scopes.pop(); frames.pop(); curLine = callLine; }
      }
      return ret;
    }
    function evalMCall(e) {
      var name = e.name;
      var recvCell = isPlace(e.recv) ? placeCell(e.recv) : tempCell(evalExpr(e.recv));
      if (!recvCell.label) recvCell.label = labelOf(e.recv);
      var c = recvCell;
      // auto-deref: find the cell whose value has the method
      var tries = 0;
      for (;;) {
        var v = c.v, uf = userMethod(v, name);
        if (uf || nativeHas(v, name)) break;
        if (v.t === 'ref') { c = v.cell; } else if (v.t === 'Box') { c = v.inner; } else throw new PanicSig('no method `' + name + '` on ' + v.t);
        if (++tries > 4) throw new PanicSig('method not found');
      }
      var target = c.v, uf2 = userMethod(target, name);
      if (uf2) {
        var selfArg;
        if (uf2.selfKind === 'val') {
          if (isCopyVal(target)) selfArg = target;
          else { if (c.st !== 'live') throw staticStop('use of moved value `' + labelOf(e.recv) + '`'); selfArg = target; c.st = 'moved'; ev('move', labelOf(e.recv) + ' moved into the method', { label: labelOf(e.recv) }); }
        } else selfArg = { t: 'ref', mut: uf2.selfKind === 'mut', cell: c };
        var rest = evalArgs(e.args);
        return callFn(uf2, [selfArg].concat(rest), (target.name || target.t) + '::' + name);
      }
      return native(c, target, name, e);
    }
    function userMethod(v, name) {
      if (v.t !== 'struct') return null;
      var tbl = world.impls[v.name];
      return tbl && tbl[name] ? tbl[name] : null;
    }
    var NAT = {
      String: ['push_str', 'push', 'len', 'is_empty', 'clear', 'clone', 'as_str', 'capacity', 'to_string'],
      str: ['len', 'is_empty', 'to_string', 'clone'],
      Vec: ['push', 'len', 'is_empty', 'clear', 'clone', 'insert', 'remove', 'iter', 'iter_mut', 'truncate', 'capacity', 'pop'],
      struct: ['clone'],
      Box: [], int: ['clone'], bool: ['clone'], char: ['clone']
    };
    function nativeHas(v, name) { if (v.t === 'struct') return name === 'clone' && (world.structs[v.name].derive || []).indexOf('Clone') >= 0; return (NAT[v.t] || []).indexOf(name) >= 0; }
    /* the buffer is full: get a bigger one, move the elements over, release the old one (the allocator may in fact
       extend in place; the model always moves, which is the case the law of Lesson 05 has to survive) */
    function growTo(v, need, minNonZero) {
      if (need <= v.cap) return;
      var old = v.id;
      v.cap = Math.max(v.cap * 2, need, minNonZero);
      attach(v);
      ev('alloc', (old ? 'reallocate: ' : 'allocate: ') + v.t + ' buffer #' + v.id + ' with room for ' + v.cap, { id: v.id });
      if (old) free(old, 'replaced by #' + v.id);
    }
    function cloneValue(v) {
      switch (v.t) {
        case 'String': return mkString(v.s);
        case 'Vec': { var it = v.items.map(function (c) { return cloneValue(c.v); }); return mkVec(it); }
        case 'Box': return mkBox(cloneValue(v.inner.v));
        case 'struct': { var f = {}; Object.keys(v.f).forEach(function (k) { f[k] = cellOf(cloneValue(v.f[k].v)); }); return { t: 'struct', name: v.name, f: f }; }
        case 'ref': return v.mut ? v : v;
      }
      return v;
    }
    function native(c, v, name, e) {
      var args = e.args.map(evalExpr);
      var h = v;
      switch (v.t) {
        case 'String':
          switch (name) {
            case 'push_str': { var t = strOf(args[0]); h.s += t; growTo(h, h.s.length, 8); ev('assign', labelOf(e.recv) + '.push_str(' + JSON.stringify(t) + ')', {}); return UNIT; }
            case 'push': h.s += args[0].v; growTo(h, h.s.length, 8); ev('assign', labelOf(e.recv) + '.push(…)', {}); return UNIT;
            case 'len': return { t: 'int', v: h.s.length };
            case 'capacity': return { t: 'int', v: h.cap };
            case 'is_empty': return { t: 'bool', v: h.s.length === 0 };
            case 'clear': h.s = ''; ev('assign', labelOf(e.recv) + '.clear()', {}); return UNIT;
            case 'clone': case 'to_string': return mkString(h.s);
            case 'as_str': return { t: 'str', v: h.s };
          }
          break;
        case 'str':
          switch (name) {
            case 'len': return { t: 'int', v: v.v.length };
            case 'is_empty': return { t: 'bool', v: v.v.length === 0 };
            case 'to_string': case 'clone': return name === 'clone' ? v : mkString(v.v);
          }
          break;
        case 'Vec':
          switch (name) {
            case 'push': { var it = args[0]; h.items.push(cellOf(it)); growTo(h, h.items.length, 4); ev('assign', labelOf(e.recv) + '.push(' + shortVal(it) + ')', {}); return UNIT; }
            case 'len': return { t: 'int', v: h.items.length };
            case 'capacity': return { t: 'int', v: h.cap };
            case 'is_empty': return { t: 'bool', v: h.items.length === 0 };
            case 'clear': { h.items.forEach(function (ic, i) { dropCell(ic, 'element', labelOf(e.recv) + '[' + i + ']'); }); h.items = []; ev('assign', labelOf(e.recv) + '.clear()', {}); return UNIT; }
            case 'truncate': { var n = args[0].v; var gone = h.items.splice(n); gone.forEach(function (ic, i) { dropCell(ic, 'element', labelOf(e.recv) + '[' + (n + i) + ']'); }); return UNIT; }
            case 'insert': { var ix = args[0].v; if (ix > h.items.length) throw new PanicSig('insertion index (is ' + ix + ') should be <= len (is ' + h.items.length + ')'); h.items.splice(ix, 0, cellOf(args[1])); growTo(h, h.items.length, 4); ev('assign', labelOf(e.recv) + '.insert', {}); return UNIT; }
            case 'remove': { var rx = args[0].v; if (rx >= h.items.length) throw new PanicSig('removal index (is ' + rx + ') should be < len (is ' + h.items.length + ')'); var rc = h.items.splice(rx, 1)[0]; return rc.v; }
            case 'pop': { throw new PanicSig('Option is not supported by the mini interpreter'); }
            case 'clone': return cloneValue(v);
            case 'iter': return { t: 'iter', items: h.items.slice(), pos: 0, mut: false };
            case 'iter_mut': return { t: 'iter', items: h.items.slice(), pos: 0, mut: true };
          }
          break;
        case 'struct': if (name === 'clone') return cloneValue(v); break;
        case 'int': case 'bool': case 'char': if (name === 'clone') return v; break;
      }
      throw new PanicSig('no method `' + name + '` on ' + v.t);
    }

    /* ── for loops ── */
    function evalFor(e) {
      var itv;
      beginStmt();
      try { itv = evalExpr(e.iter); } catch (x) { endStmt(); throw x; }
      var items, own = null;
      if (itv.t === 'range') { items = []; for (var i = itv.a; i < itv.b; i++) items.push({ t: 'int', v: i }); }
      else if (itv.t === 'ref' && itv.cell.v.t === 'Vec') { var hv = itv.cell.v; items = hv.items.map(function (c) { return { t: 'ref', mut: itv.mut, cell: c }; }); }
      else if (itv.t === 'iter') { items = itv.items.slice(itv.pos).map(function (c) { return { t: 'ref', mut: itv.mut, cell: c }; }); }
      else if (itv.t === 'Vec') {
        own = { t: 'iterOwn', id: itv.id, items: itv.items, pos: 0 };      // the buffer is freed when the iterator is dropped
        var cell = cellOf(own); cell.label = '⟨into_iter⟩'; fr().temps[fr().temps.length - 1].push(cell);
        items = null;
      } else { endStmt(); throw new PanicSig('cannot iterate over this value'); }
      try {
        var n = items ? items.length : own.items.length;
        for (var k = 0; k < n; k++) {
          var val;
          if (own) { var ic = own.items[k]; own.pos = k + 1; val = ic.v; ic.st = 'moved'; } else val = items[k];
          pushScope();
          var xc = cellOf(val); declare(e.name, xc);
          ev('let', 'for: ' + e.name + ' = ' + shortVal(val), { label: e.name });
          try { execBlock(e.body); }
          catch (s) { if (s instanceof Sig && (s.sig === 'break' || s.sig === 'continue')) { popScope(); if (s.sig === 'break') break; continue; } popScope(); throw s; }
          popScope();
        }
      } finally { endStmt(); }
      return UNIT;
    }

    /* ── statements & blocks ── */
    function execStmt(s) {
      spend();
      curLine = s.line || curLine;
      if (s.k === 'let') return execLet(s);
      beginStmt();
      try {
        var v = evalExpr(s.e);
        // an owned value that nobody kept is a temporary: it dies at the end of the statement
        if (s.semi !== false && v && owns(v)) { var c = tempCell(v); c.label = '⟨value⟩'; }
      } finally { endStmt(); }
    }
    function execLet(s) {
      beginStmt();
      try {
        if (!s.init) { var uc = cellOf(UNIT, 'uninit'); declare(s.name, uc); ev('let', 'let ' + s.name + ' (uninitialised)', { label: s.name }); return; }
        if (s.name === '_') {
          if (isPlace(s.init)) return;                       // `let _ = x;` does not even move x
          var dv = evalExpr(s.init);
          if (owns(dv)) { var dc = tempCell(dv); dc.label = '_'; }
          return;
        }
        var val, cell;
        var ini = s.init; while (ini.k === 'paren') ini = ini.e;
        if (ini.k === 'addr' && !isPlace(ini.e)) {
          // temporary lifetime extension: `let r = &make();` keeps the temporary until the end of the block
          var tv = evalExpr(ini.e);
          var tc = cellOf(tv); tc.label = '⟨temp⟩';
          declare('⟨temp⟩', tc);
          val = { t: 'ref', mut: ini.mut, cell: tc };
        } else val = evalExpr(s.init);
        cell = cellOf(val);
        declare(s.name, cell);
        ev('let', 'let ' + s.name + ' = ' + shortVal(val), { label: s.name });
      } finally { endStmt(); }
    }
    function execBlock(b) {
      pushScope();
      var res = UNIT;
      try {
        for (var i = 0; i < b.stmts.length; i++) execStmt(b.stmts[i]);
        if (b.tail) {
          beginStmt();
          try { res = evalExpr(b.tail); } finally { endStmt(); }
        }
      } finally {
        curLine = b.endLine || curLine;
        popScope();
      }
      return res;
    }

    /* ── entry ── */
    var result = { events: events, out: out, error: null, exit: 'ok', heap: heap };
    var main = world.fns['main'];
    if (!main) { result.error = { msg: 'no `fn main`', line: 0 }; return result; }
    try {
      frames.push({ name: 'main', scopes: [{ locals: [] }], temps: [] });
      try { execBlock(main.body); } finally { try { dropScope(frames[0].scopes[frames[0].scopes.length - 1]); } finally { frames[0].scopes.pop(); } }
      frames.pop();
    } catch (x) {
      if (x instanceof PanicSig) {
        result.exit = 'panic'; result.error = { msg: x.panic, line: x.line || curLine };
        if (!x.reported) events.push({ k: 'error', line: x.line || curLine, text: x.panic, snap: events.length ? events[events.length - 1].snap : snapshot() });
      }
      else if (x instanceof Sig && x.sig === 'return') { /* `return` from main: the unwinding already dropped everything */ }
      else if (x instanceof Sig) { result.error = { msg: 'stray ' + x.sig, line: curLine }; }
      else throw x;
    }
    return result;
  }
  MR.run = runProgram;
  root.MiniRust = MR;
  if (typeof module !== 'undefined' && module.exports) module.exports = MR;
})(typeof window !== 'undefined' ? window : this);
