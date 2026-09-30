/* coherence.js — lesson 11's "Can I write this impl?" checker (orphan rule + overlap check) and the small
 * crate model (structs with derives) that both halves of the lesson-11 widget read.
 *
 * It mirrors rustc's coherence checker on a deliberately small vocabulary: the crate's own structs, the
 * crate's own traits, std's Display, Debug, Clone, Copy, Default, ToString and From<_>, the std types
 * i32 u8 f64 bool char String str Vec Option Box, references and tuples. Anything else is refused with a
 * message instead of being guessed. Differentially tested against rustc: tools/rust_verify/11_coherence.js.
 *
 * API (pure, no DOM, except draw):
 *   Coherence.parseCrate(src)      -> { structs:{Name:{params,fields:[[name,type]],derives,line}}, traits:{}, errors:[] }
 *   Coherence.parseImpl(text, cr)  -> { params:[{name,bounds}], trait, args:[ty], self:ty, text }   (throws)
 *   Coherence.orphan(impl, cr)     -> { code: null|'E0117'|'E0210', inputs:[{text,kind}], local, uncovered }
 *   Coherence.check(cr, haveTexts, newText) -> { codes, orphan, conflict, near, haveErrors, deriveErrors }
 *   Coherence.solverEnv(cr)        -> env for TraitSolver.solve: a derive bounds each type PARAMETER
 *   Coherence.deriveProblem(cr, name, trait) -> null | reason why #[derive(trait)] on it is rejected
 *   Coherence.explainSolve(crateSrc, typeText, trait)   -> the widget's question 1 as data (tree, words, KPIs)
 *   Coherence.explainImpl(crateSrc, haveText, implText) -> the widget's question 2 as data (orphan cells, overlap rows)
 *   Coherence.draw(canvas, result)  -> paints either result (the one function here that touches a canvas)
 *   Coherence.CRATE, Coherence.EXAMPLES -> the widget's default crate and its sixteen worked examples
 */
(function (root) {
  'use strict';
  var TS = root.TraitSolver || (typeof require === 'function' ? require('./traitsolver.js') : null);
  var C = {};

  var FOREIGN = { i32: 0, u8: 0, f64: 0, bool: 0, char: 0, String: 0, str: 0, Vec: 1, Option: 1, Box: 1 };
  var IMPL_TRAITS = ['Display', 'Debug', 'Clone', 'Default', 'ToString', 'From'];
  var BOUND_TRAITS = ['Display', 'Debug', 'Clone', 'Copy', 'Default'];
  var DERIVABLE = ['Clone', 'Copy', 'Debug', 'Default', 'PartialEq', 'Eq', 'PartialOrd', 'Ord', 'Hash'];
  var SUPER = { Copy: ['Clone'], Eq: ['PartialEq'], PartialOrd: ['PartialEq'], Ord: ['PartialOrd', 'Eq', 'PartialEq'] };
  C.IMPL_TRAITS = IMPL_TRAITS; C.BOUND_TRAITS = BOUND_TRAITS; C.DERIVABLE = DERIVABLE;

  /* ───────────── the crate: structs with derives, traits ───────────── */
  function splitTop(s) {                       // split at commas that are not inside <> () []
    var out = [], d = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '<' || ch === '(' || ch === '[') d++;
      if (ch === '>' && s[i - 1] !== '-') d--;
      if (ch === ')' || ch === ']') d--;
      if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function matchClose(s, i) {                  // s[i] is an opener; index of its partner
    var open = s[i], close = { '(': ')', '{': '}', '<': '>' }[open], d = 0;
    for (var j = i; j < s.length; j++) {
      if (s[j] === open) d++;
      else if (s[j] === close && !(close === '>' && s[j - 1] === '-')) { d--; if (d === 0) return j; }
    }
    return -1;
  }
  function parseCrate(src) {
    var text = String(src || '').replace(/\/\/[^\n]*/g, '');
    var cr = { structs: {}, traits: {}, order: [], errors: [] };
    var re = /\b(struct|trait)\s+([A-Za-z_]\w*)/g, m;
    while ((m = re.exec(text))) {
      var kind = m[1], name = m[2], i = re.lastIndex, params = [];
      var line = text.slice(0, m.index).split('\n').length;
      while (text[i] === ' ') i++;
      if (text[i] === '<') {
        var gc = matchClose(text, i);
        params = splitTop(text.slice(i + 1, gc)).filter(function (p) { return p[0] !== "'"; }).map(function (p) { return p.split(':')[0].trim(); });
        i = gc + 1;
      }
      while (text[i] === ' ') i++;
      if (kind === 'trait') {
        cr.traits[name] = { params: params, line: line };
        if (text[i] === '{') re.lastIndex = matchClose(text, i) + 1;
        continue;
      }
      var fields = [];
      if (text[i] === '{' || text[i] === '(') {
        var close = matchClose(text, i), body = text.slice(i + 1, close), named = text[i] === '{';
        splitTop(body).forEach(function (f, k) {
          if (named) { var c = f.indexOf(':'); fields.push([f.slice(0, c).replace(/^pub\s+/, '').trim(), f.slice(c + 1).trim()]); }
          else fields.push([String(k), f.replace(/^pub\s+/, '').trim()]);
        });
        re.lastIndex = close + 1;
      }
      var before = text.slice(0, m.index), derives = [], dm;
      var attrs = /((?:\s*#\[[^\]]*\])*)\s*(?:pub\s+)?$/.exec(before)[1];
      var dre = /#\[derive\(([^)]*)\)\]/g;
      while ((dm = dre.exec(attrs))) dm[1].split(',').forEach(function (d) { d = d.trim(); if (d) derives.push(d); });
      derives.forEach(function (d) { if (DERIVABLE.indexOf(d) < 0) cr.errors.push('line ' + line + ': cannot derive `' + d + '` (derivable: ' + DERIVABLE.join(', ') + ')'); });
      params.forEach(function (p) {
        if (!fields.some(function (f) { return new RegExp('\\b' + p + '\\b').test(f[1]); })) cr.errors.push('line ' + line + ': parameter `' + p + '` of `' + name + '` is never used (rustc: E0392)');
      });
      cr.structs[name] = { params: params, fields: fields, derives: derives.filter(function (d) { return DERIVABLE.indexOf(d) >= 0; }), line: line };
      cr.order.push(name);
    }
    return cr;
  }

  /* A derive writes impl<T: Tr> Tr for S<T>: the bound sits on each type PARAMETER, and a struct without
     parameters gets an unconditional impl. So for a use-site question the solver sees the parameters as
     the "fields". (Whether the derive itself is accepted is a separate, definition-time check below.) */
  function solverEnv(cr, keepInvalid) {
    var env = { structs: {} };
    Object.keys(cr.structs).forEach(function (n) {
      var s = cr.structs[n];
      env.structs[n] = { params: s.params.slice(), fields: s.params.slice(),
        derives: s.derives.filter(function (d) { return keepInvalid || !deriveProblem(cr, n, d); }) };
    });
    return env;
  }
  function deriveProblem(cr, name, trait) {
    var s = cr.structs[name];
    if (!s) return 'no struct `' + name + '`';
    var need = SUPER[trait] || [];
    for (var i = 0; i < need.length; i++)
      if (s.derives.indexOf(need[i]) < 0) return '#[derive(' + trait + ')] needs `' + name + ': ' + need[i] + '` too, and ' + name + ' does not derive it';
    var env = solverEnv(cr, true);            // other derives are taken as written: each is checked at its own struct
    s.params.forEach(function (p) { env.structs[p] = { params: [], fields: [], derives: [trait].concat(SUPER[trait] || []) }; });
    for (var k = 0; k < s.fields.length; k++) {
      var r;
      try { r = TS.solve(trait, TS.parse(s.fields[k][1]), env); } catch (e) { return 'cannot read field type `' + s.fields[k][1] + '`'; }
      if (!r.ok) return 'field `' + s.fields[k][0] + ': ' + s.fields[k][1] + '` is not ' + trait +
        (s.params.length ? ' when all it may assume is ' + s.params.map(function (p) { return p + ': ' + trait; }).join(', ') : '') + ' (' + TS.chain(r.tree).slice(-1)[0] + ')';
    }
    return null;
  }

  /* ───────────── types: params, variables, locality ───────────── */
  var GLOBAL = { k: 'path', name: 'Global', args: [] };   // Vec<T> and Box<T> are really Vec<T, Global>, Box<T, Global>
  function norm(a, params, cr, std) {          // TraitSolver AST -> coherence type; refuses what it cannot judge
    if (a.k === 'path') {
      if (params.indexOf(a.name) >= 0 && !a.args.length) return { k: 'param', name: a.name };
      if (std && a.name === 'Global') return GLOBAL;
      var arity = cr.structs[a.name] ? cr.structs[a.name].params.length : FOREIGN[a.name];
      if (arity === undefined) throw new Error('`' + a.name + '` is outside this model (known: your structs, ' + Object.keys(FOREIGN).join(', ') + ')');
      var alloc = !cr.structs[a.name] && (a.name === 'Vec' || a.name === 'Box');
      if (a.args.length !== arity && !(std && alloc && a.args.length === 2)) throw new Error('`' + a.name + '` takes ' + arity + ' type argument' + (arity === 1 ? '' : 's') + ' (rustc: E0107)');
      var args = a.args.map(function (x) { return norm(x, params, cr, std); });
      if (alloc && args.length === 1) args.push(GLOBAL);
      return { k: 'path', name: a.name, args: args };
    }
    if (a.k === 'ref') return { k: 'ref', mut: a.mut, to: norm(a.to, params, cr, std) };
    if (a.k === 'tuple' && a.items.length >= 2) return { k: 'tuple', items: a.items.map(function (x) { return norm(x, params, cr, std); }) };
    throw new Error('this model handles paths, references and tuples only');
  }
  function show(t, s) {
    t = walk(t, s);
    switch (t.k) {
      case 'path':
        var args = t.args.filter(function (x) { x = walk(x, s); return !(x.k === 'path' && x.name === 'Global'); });
        return t.name.replace(/^\?/, '') + (args.length ? '<' + args.map(function (x) { return show(x, s); }).join(', ') + '>' : '');
      case 'ref': return '&' + (t.mut ? 'mut ' : '') + show(t.to, s);
      case 'tuple': return '(' + t.items.map(function (x) { return show(x, s); }).join(', ') + ')';
      case 'param': return t.name;
      case 'var': return '_';
    }
    return '?';
  }
  function walk(t, s) { while (t && t.k === 'var' && s && s[t.id]) t = s[t.id]; return t; }
  function kids(t) { return t.k === 'path' ? t.args : t.k === 'ref' ? [t.to] : t.k === 'tuple' ? t.items : []; }
  function isFundamental(t) { return t.k === 'ref' || (t.k === 'path' && t.name === 'Box'); }
  function isLocal(t, cr, s) {                 // a local struct, or &/&mut/Box of something local
    t = walk(t, s);
    if (t.k === 'path' && cr.structs[t.name]) return true;
    return isFundamental(t) && isLocal(kids(t)[0], cr, s);
  }
  function uncovered(t, s, kind) {             // a parameter/variable reachable only through & and Box
    t = walk(t, s);
    if (t.k === kind) return t;
    return isFundamental(t) ? uncovered(kids(t)[0], s, kind) : null;
  }

  /* ───────────── parsing an impl header ───────────── */
  function parseImpl(text, cr, anyTrait) {
    var src = String(text).trim(), brace = src.indexOf('{');
    if (brace >= 0) src = src.slice(0, brace);
    src = src.replace(/;\s*$/, '').trim();
    if (!/^impl\b/.test(src)) throw new Error('an impl header starts with `impl`');
    src = src.slice(4).trim();
    var params = [];
    if (src[0] === '<') {
      var gc = matchClose(src, 0);
      splitTop(src.slice(1, gc)).forEach(function (p) {
        if (p[0] === "'") return;
        var parts = p.split(':'), bounds = parts.length > 1 ? parts.slice(1).join(':').split('+').map(function (b) { return b.trim(); }).filter(Boolean) : [];
        var nm = parts[0].trim(), unsized = bounds.indexOf('?Sized') >= 0;
        if (!/^[A-Z]\w*$/.test(nm)) throw new Error('bad type parameter `' + nm + '`');
        if (unsized && !anyTrait) throw new Error('`?Sized` is outside this model');
        bounds = bounds.filter(function (b) { return b !== '?Sized'; }).map(function (b) { return b.split('::').pop(); });
        if (bounds.length > 1) throw new Error('this model allows one bound per parameter');
        bounds.forEach(function (b) { if (BOUND_TRAITS.indexOf(b) < 0 && !cr.traits[b]) throw new Error('bound `' + b + '` is outside this model (known: ' + BOUND_TRAITS.concat(Object.keys(cr.traits)).join(', ') + ')'); });
        params.push({ name: nm, bounds: bounds, unsized: unsized });
      });
      src = src.slice(gc + 1).trim();
    }
    var d = 0, cut = -1;
    for (var i = 0; i < src.length && cut < 0; i++) {
      var ch = src[i];
      if (ch === '<' || ch === '(') d++; else if (ch === '>' || ch === ')') d--;
      else if (d === 0 && src.slice(i, i + 3) === 'for' && /\s/.test(src[i - 1] || '') && /\s/.test(src[i + 3] || '')) cut = i;
    }
    if (cut < 0) throw new Error('expected `impl Trait for Type`');
    var trText = src.slice(0, cut).trim(), negative = trText[0] === '!';
    var tr = TS.parse(negative ? trText.slice(1) : trText), selfAst = TS.parse(src.slice(cut + 3).trim());
    if (tr.k !== 'path') throw new Error('expected a trait name before `for`');
    var names = params.map(function (p) { return p.name; });
    if (IMPL_TRAITS.indexOf(tr.name) < 0 && !cr.traits[tr.name] && !(anyTrait && BOUND_TRAITS.indexOf(tr.name) >= 0)) throw new Error('trait `' + tr.name + '` is outside this model (known: ' + IMPL_TRAITS.concat(Object.keys(cr.traits)).join(', ') + ')');
    var want = tr.name === 'From' ? 1 : cr.traits[tr.name] ? cr.traits[tr.name].params.length : 0;
    if (tr.args.length !== want) throw new Error('`' + tr.name + '` takes ' + want + ' type argument' + (want === 1 ? '' : 's'));
    return { params: params, trait: tr.name, args: tr.args.map(function (x) { return norm(x, names, cr, anyTrait); }), self: norm(selfAst, names, cr, anyTrait), negative: negative, text: String(text).trim().replace(/\s*\{[\s\S]*$/, '').replace(/, A>/g, '>') };
  }

  /* ───────────── the orphan rule (Reference "Orphan rules", RFC 2451) ───────────── */
  function orphan(imp, cr) {
    var inputs = [imp.self].concat(imp.args), out = { code: null, inputs: [], local: -1, uncovered: null };
    inputs.forEach(function (t) { out.inputs.push({ text: show(t), kind: isLocal(t, cr) ? 'local' : uncovered(t, null, 'param') ? 'uncovered' : 'foreign' }); });
    if (cr.traits[imp.trait]) { out.traitLocal = true; return out; }       // your trait: always allowed
    for (var i = 0; i < inputs.length; i++) {                             // T0 = Self, then the trait's arguments
      if (isLocal(inputs[i], cr)) { out.local = i; return out; }          // first local type: allowed
      var p = uncovered(inputs[i], null, 'param');
      if (p) { out.code = 'E0210'; out.uncovered = p.name; return out; }  // a bare T before any local type
    }
    out.code = 'E0117';                                                   // nothing local at all
    return out;
  }

  /* ───────────── std's impls (only the ones a crate-local goal can reach) ───────────── */
  var STD_SRC = [
    'impl Display for i32', 'impl Display for u8', 'impl Display for f64', 'impl Display for bool', 'impl Display for char', 'impl Display for String', 'impl Display for str',
    'impl<T: ?Sized + Display> Display for &T', 'impl<T: ?Sized + Display> Display for &mut T', 'impl<T: ?Sized + Display, A> Display for Box<T, A>',
    'impl Debug for i32', 'impl Debug for u8', 'impl Debug for f64', 'impl Debug for bool', 'impl Debug for char', 'impl Debug for String', 'impl Debug for str',
    'impl<T: ?Sized + Debug> Debug for &T', 'impl<T: ?Sized + Debug> Debug for &mut T', 'impl<T: ?Sized + Debug, A> Debug for Box<T, A>', 'impl<T: Debug, A> Debug for Vec<T, A>', 'impl<T: Debug> Debug for Option<T>',
    'impl Clone for i32', 'impl Clone for u8', 'impl Clone for f64', 'impl Clone for bool', 'impl Clone for char', 'impl Clone for String',
    'impl<T: ?Sized> Clone for &T', 'impl<T: ?Sized> !Clone for &mut T', 'impl<T: Clone, A: Clone> Clone for Box<T, A>', 'impl Clone for Box<str>', 'impl<T: Clone, A: Clone> Clone for Vec<T, A>', 'impl Clone for Global', 'impl<T: Clone> Clone for Option<T>',
    'impl Copy for i32', 'impl Copy for u8', 'impl Copy for f64', 'impl Copy for bool', 'impl Copy for char', 'impl<T: ?Sized> Copy for &T', 'impl<T: Copy> Copy for Option<T>',
    'impl Default for i32', 'impl Default for u8', 'impl Default for f64', 'impl Default for bool', 'impl Default for char', 'impl Default for String', 'impl Default for &str', 'impl Default for &mut str',
    'impl<T> Default for Vec<T>', 'impl<T> Default for Option<T>', 'impl<T: Default> Default for Box<T>', 'impl Default for Box<str>',
    'impl<T: ?Sized + Display> ToString for T',
    'impl<T> From<T> for T', 'impl<T> From<T> for Option<T>', 'impl<T> From<&Option<T>> for Option<&T>', 'impl<T> From<T> for Box<T>',
    'impl From<String> for Vec<u8>', 'impl From<i32> for f64', 'impl From<u8> for i32', 'impl From<u8> for f64', 'impl From<bool> for i32', 'impl From<u8> for char', 'impl From<char> for String'
  ];
  var STD = null;
  function stdImpls() {
    if (!STD) STD = STD_SRC.map(function (t) { var i = parseImpl(t, { structs: {}, traits: {} }, true); i.source = 'std'; return i; });
    return STD;
  }
  function derivedImpl(cr, name, trait) {
    var s = cr.structs[name];
    var gen = s.params.length ? '<' + s.params.map(function (p) { return p + ': ' + trait; }).join(', ') + '>' : '';
    var self = name + (s.params.length ? '<' + s.params.join(', ') + '>' : '');
    var names = s.params;
    return { params: s.params.map(function (p) { return { name: p, bounds: [trait] }; }), trait: trait, args: [],
      self: norm(TS.parse(self), names, cr), text: 'impl' + gen + ' ' + trait + ' for ' + self, source: 'derive', struct: name, line: s.line };
  }

  /* ───────────── unification with fresh variables ───────────── */
  var nextVar = 0;
  function instantiate(imp) {
    var map = {};
    imp.params.forEach(function (p) { map[p.name] = { k: 'var', id: 'v' + (nextVar++) }; });
    function sub(t) {
      if (t.k === 'param') return map[t.name];
      if (t.k === 'path') return { k: 'path', name: t.name, args: t.args.map(sub) };
      if (t.k === 'ref') return { k: 'ref', mut: t.mut, to: sub(t.to) };
      if (t.k === 'tuple') return { k: 'tuple', items: t.items.map(sub) };
      return t;
    }
    var bounds = [];                           // written bounds, plus the implicit `T: Sized` of every parameter
    imp.params.forEach(function (p) {
      p.bounds.forEach(function (b) { bounds.push({ trait: b, self: map[p.name], args: [] }); });
      if (!p.unsized) bounds.push({ trait: 'Sized', self: map[p.name], args: [] });
    });
    return { inputs: [sub(imp.self)].concat(imp.args.map(sub)), bounds: bounds, vars: imp.params.map(function (p) { return map[p.name]; }) };
  }
  function occurs(id, t, s) { t = walk(t, s); if (t.k === 'var') return t.id === id; return kids(t).some(function (k) { return occurs(id, k, s); }); }
  function unify(a, b, s) {
    a = walk(a, s); b = walk(b, s);
    if (a.k === 'var' && b.k === 'var' && a.id === b.id) return true;
    if (a.k === 'var') { if (occurs(a.id, b, s)) return false; s[a.id] = b; return true; }
    if (b.k === 'var') return unify(b, a, s);
    if (a.k !== b.k) return false;
    if (a.k === 'path' && (a.name !== b.name || a.args.length !== b.args.length)) return false;
    if (a.k === 'ref' && a.mut !== b.mut) return false;
    var ka = kids(a), kb = kids(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) if (!unify(ka[i], kb[i], s)) return false;
    return true;
  }
  function copy(s) { var o = {}; for (var k in s) o[k] = s[k]; return o; }

  /* Could these goals hold together, in this crate or in any crate that could ever be linked with it?
     This mirrors rustc's coherence mode (the next-generation solver): goals are retried until nothing
     changes; a goal only one impl can satisfy pins that impl's types; a goal nobody may ever satisfy
     makes the whole set impossible, and then the two impls being compared are disjoint. */
  var SUPERS = { Clone: ['Sized'], Copy: ['Clone'], Default: ['Sized'], From: ['Sized'] };
  function nkeys(s) { return Object.keys(s).length; }
  function key(t, s) {                         // like show(), but variables keep their identity
    t = walk(t, s);
    return t.k === 'var' ? '?' + t.id : t.k === 'path' ? t.name + '<' + t.args.map(function (x) { return key(x, s); }).join(',') + '>'
      : t.k === 'ref' ? '&' + (t.mut ? 'mut ' : '') + key(t.to, s) : '(' + kids(t).map(function (x) { return key(x, s); }).join(',') + ')';
  }
  function solveAll(goals, s, ctx, depth) {
    var pending = goals.slice(), why = [];
    for (var round = 0; round < 8 && pending.length; round++) {
      var next = [], before = nkeys(s);
      why = [];
      for (var i = 0; i < pending.length; i++) {
        var r = evalGoal(pending[i], s, ctx, depth);
        if (!r.may) return { may: false, goal: pending[i], why: r.why, s: s };
        if (r.s) s = r.s;
        if (!r.certain) { next.push(pending[i]); why.push(r.why); }
      }
      pending = next;
      if (nkeys(s) === before) break;
    }
    return { may: true, certain: !pending.length, s: s, pending: pending, why: why };
  }
  function evalGoal(g, s, ctx, depth) {
    var self = walk(g.self, s), inputs = [g.self].concat(g.args), here = '`' + show(g.self, s) + ': ' + g.trait + '`';
    if (depth > 10) return { may: true, why: 'too deep to decide' };
    var k = g.trait + ' ' + inputs.map(function (t) { return key(t, s); }).join(' ');
    if (ctx.stack.indexOf(k) >= 0) return { may: true, why: here + ' depends on itself, which rustc leaves undecided' };
    if (g.trait === 'Sized') {
      if (self.k === 'var') return { may: true, why: 'not known yet' };
      return (self.k === 'path' && self.name === 'str') ? { may: false, why: '`str` is not Sized' } : { may: true, certain: true };
    }
    if (self.k === 'var') return { may: true, why: 'the type is not pinned down, so some type could satisfy ' + here };
    // rustc's trait_ref_is_knowable: may another crate, now or in a future version, add an impl?
    var down = inputs.some(function (t) { return uncovered(t, s, 'var'); });
    if (down || (!ctx.cr.traits[g.trait] && !inputs.some(function (t) { return isLocal(t, ctx.cr, s); }))) {
      var sup = solveAll((SUPERS[g.trait] || []).map(function (tr) { return { trait: tr, self: g.self, args: [] }; }), s, ctx, depth + 1);
      if (!sup.may) return { may: false, why: sup.why };        // a supertrait can still rule it out
      return { may: true, why: down ? 'a downstream crate could implement ' + here
                                    : 'std may add an impl making ' + here + ' true in a future version' };
    }
    // the goal is yours to answer: only the impls that exist today can make it true
    var cands = ctx.impls(g.trait), alive = [];
    ctx.stack.push(k);
    for (var i = 0; i < cands.length; i++) {
      var s2 = copy(s), inst = instantiate(cands[i]), ok = true;
      for (var j = 0; j < inputs.length && ok; j++) ok = unify(inst.inputs[j], inputs[j], s2);
      if (!ok) continue;
      var r = solveAll(inst.bounds, s2, ctx, depth + 1);
      if (r.may) alive.push({ imp: cands[i], r: r });
    }
    ctx.stack.pop();
    if (!alive.length) return { may: false, why: 'only this crate could make ' + here + ' true, and no impl here does' };
    if (alive.length === 1) return { may: true, certain: alive[0].r.certain, s: alive[0].r.s, why: here + ' holds (' + alive[0].imp.text + ')' };
    return { may: true, why: 'several impls could make ' + here + ' true' };
  }
  function overlap(a, b, ctx) {                // null, or whether/why the two impls could both apply to one type
    if (a.trait !== b.trait) return null;
    var s = {}, ia = instantiate(a), ib = instantiate(b);
    for (var i = 0; i < ia.inputs.length; i++) if (!unify(ia.inputs[i], ib.inputs[i], s)) return null;
    var r = solveAll(ia.bounds.concat(ib.bounds), s, ctx, 0);
    var at = show(ia.inputs[0], r.s) + (ia.inputs.length > 1 ? ' (' + a.trait + '<' + ia.inputs.slice(1).map(function (t) { return show(t, r.s); }).join(', ') + '>)' : '');
    if (!r.may) return { disjoint: true, at: at, goal: show(r.goal.self, r.s) + ': ' + r.goal.trait, why: r.why };
    return { at: at, notes: r.why.filter(function (w) { return !/^not known yet/.test(w); }) };
  }

  /* rustc's `specializes(std_impl, your_impl)`: std's crates enable specialization, so a std impl that applies
     to a subset of your impl's types (yours is identical or more general) is taken as a specialization of
     yours rather than a conflict — only an orphan-rule violation can be that general. */
  function holds(g, s, ctx, depth) {
    var t = walk(g.self, s);
    if (t.rigid) return g.trait === 'Sized' ? !t.rigid.unsized : t.rigid.bounds.indexOf(g.trait) >= 0 || (g.trait === 'Clone' && t.rigid.bounds.indexOf('Copy') >= 0);
    if (g.trait === 'Sized') return !(t.k === 'path' && t.name === 'str');
    var k = g.trait + ' ' + key(g.self, s);
    if (t.k === 'var' || depth > 10 || ctx.stack.indexOf(k) >= 0) return false;
    ctx.stack.push(k);
    var ok = ctx.impls(g.trait).some(function (imp) {
      var s2 = copy(s), inst = instantiate(imp), ins = [g.self].concat(g.args);
      for (var j = 0; j < ins.length; j++) if (!unify(inst.inputs[j], ins[j], s2)) return false;
      return inst.bounds.every(function (b) { return holds(b, s2, ctx, depth + 1); });
    });
    ctx.stack.pop();
    return ok;
  }
  function specializes(sp, par, ctx) {
    if (!!sp.negative !== !!par.negative) return false;
    var s = {}, pi = instantiate(par), si = instantiate(sp);
    sp.params.forEach(function (p, k) { s[si.vars[k].id] = { k: 'path', name: '?' + p.name + si.vars[k].id, args: [], rigid: p }; });
    for (var i = 0; i < pi.inputs.length; i++) if (!unify(pi.inputs[i], si.inputs[i], s)) return false;
    return pi.bounds.every(function (b) { return holds(b, s, ctx, 0); });
  }

  /* ───────────── the whole check, in rustc's order ───────────── */
  function unconstrained(imp) {
    var used = {};
    (function scan(t) { if (t.k === 'param') used[t.name] = 1; kids(t).forEach(scan); })({ k: 'tuple', items: [imp.self].concat(imp.args) });
    return imp.params.filter(function (p) { return !used[p.name]; }).map(function (p) { return p.name; });
  }
  function check(cr, haveTexts, newText) {
    var res = { haveErrors: [], deriveErrors: [], codes: [], conflict: null, near: [] }, manual = [];
    (haveTexts || []).forEach(function (t, k) {
      if (!String(t).trim()) return;
      try { var h = parseImpl(t, cr); h.source = 'crate'; h.line = k + 1; manual.push(h); }
      catch (e) { res.haveErrors.push('already-written line ' + (k + 1) + ': ' + e.message); }
    });
    var mine = parseImpl(newText, cr); mine.source = 'new';
    manual.push(mine);
    var derived = [];
    cr.order.forEach(function (n) { cr.structs[n].derives.forEach(function (d) { if (IMPL_TRAITS.indexOf(d) >= 0 || BOUND_TRAITS.indexOf(d) >= 0) derived.push(derivedImpl(cr, n, d)); }); });
    var inserted = [];
    var ctx = { cr: cr, stack: [], impls: function (tr) {
      return stdImpls().concat(manual, derived).filter(function (i) { return i.trait === tr && !i.negative; });
    } };
    function blanket(i) { return i.self.k === 'param'; }
    function notBlanket(i) { return !blanket(i); }
    // rustc inserts std's impls, then your written impls in source order, then the derive-generated ones;
    // an impl that overlaps one already inserted is reported (on itself) and left out. Blanket impls
    // (Self is a bare parameter) are compared first.
    manual.concat(derived).forEach(function (imp) {
      var codes = [], o = orphan(imp, cr), found = null;
      if (o.code) codes.push(o.code);
      if (unconstrained(imp).length) codes.push('E0207');
      if (blanket(imp) && !cr.traits[imp.trait]) {       // impl<T> Foreign for T: E0210, and rustc leaves it out
        imp.result = { codes: codes, orphan: o, conflict: null, left: true };   // of the overlap check entirely
        if (imp === mine) { res.codes = codes; res.orphan = o; res.unconstrained = unconstrained(imp); res.left = true; }
        else if (codes.length && imp.source === 'crate') res.haveErrors.push('already-written line ' + imp.line + ' (' + imp.text + '): ' + codes.join(', '));
        return;
      }
      var others = stdImpls().filter(blanket).concat(inserted.filter(blanket), stdImpls().filter(notBlanket), inserted.filter(notBlanket));
      for (var i = 0; i < others.length && !found; i++) {
        var ov = overlap(others[i], imp, ctx);
        if (ov && ov.disjoint) { if (imp === mine) res.near.push({ with: others[i], ov: ov }); continue; }
        if (ov && others[i].source === 'std' && specializes(others[i], imp, ctx)) { if (imp === mine) res.near.push({ with: others[i], ov: ov, specialized: true }); continue; }
        if (ov) found = { with: others[i], ov: ov };
      }
      if (found && found.with.negative) codes.push('E0751');                  // std says "never": always reported
      else if (found && (found.with.source !== 'std' || !o.code)) codes.push('E0119');
      if (!found) inserted.push(imp);
      imp.result = { codes: codes, orphan: o, conflict: found };
      if (imp === mine) { res.codes = codes; res.orphan = o; res.conflict = found; res.unconstrained = unconstrained(imp); }
      else if (codes.length && imp.source === 'crate') res.haveErrors.push('already-written line ' + imp.line + ' (' + imp.text + '): ' + codes.join(', '));
      else if (codes.length) res.deriveErrors.push({ struct: imp.struct, trait: imp.trait, codes: codes, conflict: found });
    });
    res.impl = mine; res.all = manual.concat(derived);
    return res;
  }

  /* ───────────── the widget's two questions, answered as data (no DOM, so Node can test them) ───────────── */
  function structsIn(a, cr, out) {             // the crate's structs that a type mentions; a wrong arity is E0107
    if (a.k === 'path' && cr.structs[a.name]) {
      var want = cr.structs[a.name].params.length;
      if (a.args.length !== want) throw new Error('`' + a.name + '` takes ' + want + ' type argument(s) (rustc: E0107)');
      if (out.indexOf(a.name) < 0) out.push(a.name);
    }
    [].concat(a.args || [], a.items || [], a.params || [], a.to || [], a.elem || [], a.ret || []).forEach(function (x) { structsIn(x, cr, out); });
    return out;
  }
  function ifDerived(cr, n, tr) {              // would #[derive(tr)] on n be accepted? (checked once, at the definition)
    if (DERIVABLE.indexOf(tr) < 0) return tr + ' cannot be derived: you write that impl yourself';
    var s = cr.structs[n], o = { structs: {}, traits: cr.traits, order: cr.order, errors: [] };
    for (var k in cr.structs) o.structs[k] = cr.structs[k];
    o.structs[n] = { params: s.params, fields: s.fields, derives: s.derives.concat([tr]), line: s.line };
    return deriveProblem(o, n, tr);
  }
  function explainSolve(src, typeText, tr) {   // question 1: does TYPE implement TRAIT? (proof tree, failing chain in words)
    var cr = parseCrate(src), ast = TS.parse(typeText), names = structsIn(ast, cr, []), lines = [], sick = 0;
    var r = TS.solve(tr, ast, solverEnv(cr)), path = [r.tree], bad;
    (function flat(t, d) {
      var rule = t.rule || t.reason || '', m = /^#\[derive\((\w+)\)\] on (\w+) needs/.exec(rule);
      if (m) { var ps = cr.structs[m[2]].params; rule = ps.length ? 'derive wrote impl<' + ps.map(function (p) { return p + ': ' + m[1]; }).join(', ') + '>' : 'derive wrote an impl with no conditions'; }
      lines.push({ d: d, ok: t.ok, goal: t.goal, rule: rule });
      t.kids.forEach(function (k) { flat(k, d + 1); });
    })(r.tree, 0);
    while ((bad = path[path.length - 1].kids.filter(function (k) { return !k.ok; })[0])) path.push(bad);
    var leaf = path[path.length - 1];
    var msg = r.ok ? TS.show(ast) + ': ' + tr + ' holds.' : path.map(function (n) { var c = n.goal.lastIndexOf(': '); return n.goal.slice(0, c) + ' is not ' + n.goal.slice(c + 2); }).join(' because ') + (leaf.reason ? ' — ' + leaf.reason : '') + '.';
    var defs = names.map(function (n) {
      var s = cr.structs[n], has = s.derives.indexOf(tr) >= 0, prob = ifDerived(cr, n, tr), ps = s.params.join(', ');
      var bound = s.params.map(function (p) { return p + ': ' + tr; }).join(', '), would = '#[derive(' + tr + ')] ' + (prob ? 'would be rejected: ' + prob : 'would be accepted');
      if (has && prob) { sick++; msg += '\nThe crate itself is rejected: #[derive(' + tr + ')] on ' + n + ' fails: ' + prob + '.'; }
      else if (has && ps) msg += '\n#[derive(' + tr + ')] on ' + n + ' wrote impl<' + bound + '> ' + tr + ' for ' + n + '<' + ps + '>: the bound is on ' + ps + ', not on the fields.';
      else if (!has) msg += '\n' + n + ' has no ' + tr + ' impl; ' + would + '.';
      return !has ? { tone: 'dim', text: '· ' + n + ' has no ' + tr + ' impl; ' + would }
        : prob ? { tone: 'err', text: '✗ #[derive(' + tr + ')] on ' + n + ' is rejected: ' + prob }
        : { tone: 'good', text: '✓ #[derive(' + tr + ')] on ' + n + ': every field passes' + (ps ? ' given ' + bound : '') };
    });
    cr.errors.forEach(function (e) { msg += '\nCrate: ' + e; });
    return { title: 'Does ' + TS.show(ast) + ' implement ' + tr + '?', lines: lines, defs: defs, msg: msg, ok: r.ok && !sick,
      kpi: [['goals checked', String(lines.length)], ['failing goal', r.ok ? '—' : leaf.goal], ['verdict', sick ? 'crate rejected' : r.ok ? 'holds' : 'does not hold']] };
  }
  function explainImpl(src, haveText, implText) {   // question 2: may this crate write this impl?
    var cr = parseCrate(src), res = check(cr, String(haveText || '').split('\n'), implText), o = res.orphan, imp = res.impl, cf = res.conflict;
    var codes = res.codes.slice(), rows = [], where = cf && (cf.with.source === 'std' ? 'std' : 'your crate');
    var viaDerive = res.deriveErrors.filter(function (d) { return d.conflict && d.conflict.with === imp; });
    viaDerive.forEach(function (d) { d.codes.forEach(function (c) { if (codes.indexOf(c) < 0) codes.push(c); }); });
    var bare = o.inputs.map(function (p) { return p.kind; }).indexOf('uncovered');
    var cells = [{ label: 'trait', text: imp.trait, kind: o.traitLocal ? 'local' : 'foreign', hit: !!o.traitLocal }].concat(o.inputs.map(function (p, i) {
      return { label: i ? 'T' + i + ' (trait argument)' : 'T0 (Self)', text: p.text, kind: p.kind, hit: o.local === i || (o.code === 'E0210' && bare === i) };
    }));
    var msg = codes.length ? 'Rejected: ' + codes.join(', ') + '.' : 'Accepted: this crate may write this impl.';
    if (o.code === 'E0117') msg += '\n' + imp.trait + ' is not your trait and no type in the header is yours, so any crate could write this same impl. Wrap the type in a newtype.';
    if (o.code === 'E0210') msg += '\n`' + o.uncovered + '` stands for every type, other crates\' types included, and no local type comes before it.';
    if (res.left) rows.push({ tone: 'dim', text: 'skipped: rustc leaves an impl of a foreign trait for a bare T out of this check' });
    if (cf) {
      rows.push({ tone: 'err', text: '✗ ' + (cf.with.negative ? 'E0751' : 'E0119') + ': ' + cf.with.text + ' (' + where + ') also applies to ' + cf.ov.at });
      if (cf.ov.notes.length) rows.push({ tone: 'excl', text: '   because ' + cf.ov.notes[0] });
      msg += '\nOverlaps ' + cf.with.text + ' (' + where + ') at ' + cf.ov.at + (cf.ov.notes.length ? ', because ' + cf.ov.notes[0] : '') + '.';
    }
    viaDerive.forEach(function (d) {
      rows.push({ tone: 'err', text: '✗ E0119: #[derive(' + d.trait + ')] on ' + d.struct + ' already wrote this impl (reported at the derive)' });
      msg += '\n#[derive(' + d.trait + ')] on ' + d.struct + ' already wrote this impl; rustc reports the clash at the derive.';
    });
    res.near.forEach(function (n) {
      if (n.specialized) return;
      rows.push({ tone: 'good', text: '✓ ' + n.with.text + ' would need ' + n.ov.goal }, { tone: 'dim', text: '   ' + n.ov.why });
      msg += '\nNo overlap with ' + n.with.text + ': it would need ' + n.ov.goal + ' — ' + n.ov.why + '.';
    });
    if (!rows.length) rows.push({ tone: 'good', text: '✓ no impl of ' + imp.trait + ' in std, in your crate or from a derive can apply to the same type' });
    res.haveErrors.concat(cr.errors).forEach(function (e) { msg += '\nNote: ' + e; });
    return { title: imp.text, cells: cells, rows: rows, msg: msg, ok: !codes.length, codes: codes,
      orphan: { tone: o.code ? 'err' : 'good', text: o.code === 'E0117' ? '✗ E0117: nothing in the header is local' : o.code === 'E0210' ? '✗ E0210: `' + o.uncovered + '` is uncovered, and no local type comes before it' : o.traitLocal ? '✓ the trait is local' : '✓ first local type: ' + o.inputs[o.local].text },
      kpi: [['orphan rule', o.code || (o.traitLocal ? 'ok: local trait' : 'ok: local type')], ['overlap check', res.left ? 'skipped' : (cf || viaDerive.length) ? 'conflict' : 'none'], ['rustc says', codes.length ? codes.join(' + ') : 'accepted']] };
  }

  /* ───────────── drawing: an explain* result in, pixels out (like mrview.js; nothing kept between calls) ───────────── */
  function cssv(n, fb) { try { var v = getComputedStyle(document.documentElement).getPropertyValue(n); return (v && v.trim()) || fb; } catch (e) { return fb; } }
  function draw(cv, q) {
    var P = { good: cssv('--good', '#16a34a'), err: cssv('--err', '#dc2626'), excl: cssv('--excl', '#d97706'), mute: cssv('--text-mute', '#5b6573'),
              dim: cssv('--text-dim', '#94a3b8'), text: cssv('--text', '#1f2430'), mono: cssv('--mono', 'monospace') };
    var ctx = cv.getContext('2d'), dpr = root.devicePixelRatio || 1, rc = cv.getBoundingClientRect(), W = Math.max(320, rc.width), H = Math.max(300, rc.height);
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.font = '12px ' + P.mono; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    function fit(s, w) { s = String(s); while (s.length > 3 && ctx.measureText(s).width > w) s = s.slice(0, -2); return s; }
    function txt(s, x, y, tone, w) { ctx.fillStyle = P[tone] || tone; ctx.fillText(fit(s, w || 2000), x, y); }
    txt(q.title, 10, 16, q.kpi.length ? 'text' : 'err', W - 20);
    if (q.lines) {                              // question 1: the proof tree, then what each derive promised at its definition
      var lh = 19, top = 54, max = Math.max(1, Math.floor((H - top - (q.defs.length ? 28 + 16 * q.defs.length : 8)) / lh));
      txt('what the compiler must prove, one goal per line (✓ holds, ✗ fails):', 10, 34, 'mute', W - 20);
      q.lines.slice(0, max).forEach(function (l, i) {
        var y = top + i * lh, x = 14 + l.d * 22, col = Math.max(W * 0.46, x + 150);
        txt(l.ok ? '✓' : '✗', x, y, l.ok ? 'good' : 'err'); txt(l.goal, x + 16, y, 'text', col - x - 26); txt(l.rule, col, y, 'dim', W - col - 8);
      });
      if (q.lines.length > max) txt('… ' + (q.lines.length - max) + ' more', 14, top + max * lh, 'dim');
      if (q.defs.length) txt('checked once, at each struct\'s definition:', 10, H - 14 - 16 * q.defs.length, 'mute', W - 20);
      q.defs.forEach(function (d, i) { txt(d.text, 10, H - 10 - 16 * (q.defs.length - 1 - i), d.tone, W - 20); });
    } else if (q.cells) {                       // question 2: one box per header input (orphan rule), then the overlap rows
      txt('1 · orphan rule: is the trait local, or is a local type ahead of every bare type parameter?', 10, 38, 'mute', W - 20);
      var bw = Math.min(180, (W - 20) / q.cells.length - 8);
      q.cells.forEach(function (c, i) {
        var x = 10 + i * (bw + 8), tone = c.kind === 'local' ? 'good' : c.kind === 'uncovered' ? 'excl' : 'dim';
        ctx.strokeStyle = P[tone]; ctx.lineWidth = c.hit ? 3 : 1; ctx.strokeRect(x, 50, bw, 40);
        txt(c.label, x + 6, 61, 'dim', bw - 10); txt(c.text + ' · ' + c.kind, x + 6, 79, tone, bw - 10);
      });
      txt(q.orphan.text, 10, 106, q.orphan.tone, W - 20);
      txt('2 · overlap check: could another impl of the trait apply to the same type?', 10, 132, 'mute', W - 20);
      q.rows.slice(0, Math.floor((H - 150) / 18)).forEach(function (r, i) { txt(r.text, 10, 152 + i * 18, r.tone, W - 20); });
    }
  }
  C.draw = draw;

  /* the widget's default crate and its sixteen worked examples:
     [type, trait] asks question 1; [impl, impls already in the crate] asks question 2 */
  C.CRATE = ['#[derive(Clone, Debug, PartialEq)]', 'struct Reading { celsius: f64, label: String }',
    '#[derive(Clone, Copy, Debug, Default, PartialEq, PartialOrd)]', 'struct Meters(f64);', '#[derive(Clone, Debug, Default)]',
    'struct Scores(Vec<i32>);', '#[derive(Clone)]', 'struct Shared<T> { ptr: Rc<T> }', 'trait Describe {}'].join('\n');
  C.EXAMPLES = [['Vec<String>', 'Clone'], ['Option<Box<i32>>', 'Copy'], ['HashMap<String, Vec<f64>>', 'Eq'], ['(i32, f64)', 'Hash'],
    ['Reading', 'Eq'], ['Shared<Mutex<i32>>', 'Clone'], ['Vec<Reading>', 'Debug'],
    ['impl Display for Vec<i32>', ''], ['impl Display for Scores', ''], ['impl<T> Display for T', ''], ['impl From<Meters> for f64', ''],
    ['impl<T> From<T> for Meters', ''], ['impl Describe for Meters', 'impl<T> Describe for T'], ['impl Describe for Meters', 'impl<T: Display> Describe for T'],
    ['impl Describe for Vec<u8>', 'impl<T: Display> Describe for T'], ['impl Clone for Scores', '']];

  C.parseCrate = parseCrate; C.solverEnv = solverEnv; C.deriveProblem = deriveProblem;
  C.parseImpl = parseImpl; C.orphan = orphan; C.check = check; C.show = function (t) { return show(t); };
  C.isLocal = isLocal; C.stdImpls = stdImpls; C.explainSolve = explainSolve; C.explainImpl = explainImpl;
  root.Coherence = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : this);
