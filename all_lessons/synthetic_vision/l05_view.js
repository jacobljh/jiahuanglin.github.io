/* l05_view.js — the drawing of Lesson 5's widget (load after streetview.js and l05_cases.js).  Only draws; every number it prints comes from SV.l05 or SV.L05. */
(function (root) {
'use strict';
var SV = root.SV, L = SV.l05, V = SV.view, C = V.C, W = SV.CAM.W, H = SV.CAM.H;
function pct(x, d) { return (100 * x).toFixed(d === undefined ? 0 : d) + '%'; }
function overlay(ctx, mask, x, y, w, h, color, alpha) {
  var cw = w / W, ch = h / H, i, j;
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
  for (j = 0; j < H; j++) for (i = 0; i < W; i++) if (mask[j * W + i]) ctx.fillRect(x + i * cw, y + j * ch, cw, ch);
  ctx.restore();
}
function hatch(ctx, x, y, w, h) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.strokeStyle = C.red; ctx.globalAlpha = 0.28; ctx.lineWidth = 1;
  for (var d = -h; d < w; d += 7) { ctx.beginPath(); ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); ctx.stroke(); }
  ctx.restore();
}

/* panel 1: the eight cells, the street's share (teal, with whiskers) against the program's (amber) */
function drawTable(ctx, x, y, w, st) {
  var lw = 64, cw = (w - lw - 6) / 2, rh = 54, nar = cw < 130, b, k, c;
  V.mono(ctx, 'cell share: street (teal), program (amber)', x, y + 6, C.mute, 10);
  for (k = 0; k < 2; k++) V.text(ctx, k ? 'stepping out' : 'open', x + lw + k * (cw + 6) + cw / 2, y + 22, C.ink, 11, 'center', 600);
  for (b = 0; b < 4; b++) {
    var ry = y + 32 + b * rh;
    V.mono(ctx, L.BAND_NAMES[b].replace(' to ', '-').replace(' m and beyond', '+').replace(' m', ''), x, ry + 22, C.mute, 9.5);
    for (k = 0; k < 2; k++) {
      c = 2 * b + k;
      var cx = x + lw + k * (cw + 6), p = st.T.share[c], qq = st.q[c], never = qq < 0.01, bw = cw - 4, sc = bw / 0.65, wh = st.B.cells[c];
      V.frame(ctx, cx, ry, cw, rh - 4, never ? C.redSoft : C.panel, never ? C.red : C.grid);
      if (never) hatch(ctx, cx, ry, cw, rh - 4);
      V.mono(ctx, (nar ? '' : 'street ') + pct(p) + ' (' + pct(wh[0]) + '-' + pct(wh[1]) + ')', cx + 4, ry + 9, C.ink, 9.5);
      ctx.fillStyle = C.teal; ctx.fillRect(cx + 2, ry + 15, Math.min(bw, p * sc), 8);
      V.line(ctx, cx + 2 + Math.min(bw, wh[0] * sc), ry + 19, cx + 2 + Math.min(bw, wh[1] * sc), ry + 19, C.ink, 1.3);
      V.mono(ctx, (nar ? '' : 'program ') + pct(qq, qq > 0 && qq < 0.1 ? 1 : 0) + (never ? ': never drawn' : ''), cx + 4, ry + 31, never ? C.red : C.ink, 9.5);
      ctx.fillStyle = C.amber; ctx.fillRect(cx + 2, ry + 37, Math.min(bw, qq * sc), 7);
    }
  }
}

/* panel 2: the strip of labelled frames, and the ground-plane construction on the chosen one */
function drawStrip(ctx, x, y, w, st, B) {
  var gx = 6, tw = (w - 2 * gx) / 3, th = tw / 4, k;
  for (k = 0; k < B.strip.length; k++) {
    var i = B.strip[k], tx = x + (k % 3) * (tw + gx), ty = y + Math.floor(k / 3) * (th + 24), r = B.RS[i], sel = k === st.sel;
    V.image(ctx, tx, ty, tw, th, B.FR[i].x, { gain: 1.6, border: sel ? C.ink : C.grid });
    overlay(ctx, B.LB[i].ped, tx, ty, tw, th, C.teal, 0.55);
    if (B.LB[i].veh) overlay(ctx, B.LB[i].veh, tx, ty, tw, th, C.mute, 0.28);
    if (sel) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(tx, ty, tw, th); }
    V.mono(ctx, (k + 1) + ': ' + r.z.toFixed(1) + ' m', tx, ty + th + 9, sel ? C.ink : C.mute, 9);
    V.mono(ctx, r.step ? 'stepping out' : 'open', tx, ty + th + 19, r.step ? C.red : (sel ? C.ink : C.mute), 9);
  }
}
function drawFrame(ctx, x, y, w, st, B, truth) {
  var i = B.strip[st.sel], f = B.FR[i], r = B.RS[i], ih = w / 4, ch = ih / H, cw = w / W, d = r.jb + 0.75 - SV.CAM.V0, A0 = L.wholeArea(st.rs);
  V.image(ctx, x, y, w, ih, f.x, { gain: 1.6 });
  overlay(ctx, B.LB[i].ped, x, y, w, ih, C.teal, 0.5);
  if (B.LB[i].veh) overlay(ctx, B.LB[i].veh, x, y, w, ih, C.mute, 0.3);
  var yh = y + SV.CAM.V0 * ch, yf = y + (r.jb + 0.75) * ch, xb = x + Math.min(W - 2, r.u1 + 3) * cw;
  V.line(ctx, x, yh, x + w, yh, C.blue, 1.2, [4, 3]);
  V.line(ctx, x, yf, x + w, yf, C.red, 1.4);
  V.line(ctx, xb, yh, xb, yf, C.amber, 2);
  V.mono(ctx, 'horizon', x + 3, yh - 5, C.blue, 9);
  V.mono(ctx, 'foot row', x + 3, yf + 7, C.red, 9);
  var bn = L.BAND_NAMES[r.band].replace(' to ', '-').replace(' m and beyond', '+').replace(' m', '');
  var lines = ['foot row ' + r.jb + ': v = ' + (r.jb + 0.75).toFixed(2) + ', v - V0 = ' + d.toFixed(2) + ' px',
    'z = f hc / (v - V0) = ' + (SV.CAM.f * SV.CAM.hc).toFixed(1) + ' / ' + d.toFixed(2) + ' = ' + r.z.toFixed(1) + ' m',
    'between ' + r.lo.toFixed(1) + ' and ' + r.hi.toFixed(1) + ' m: band ' + bn,
    r.step ? 'touches a nearer vehicle: stepping out' : 'touches no nearer vehicle: open',
    'visible ' + L.phi(r, A0).toFixed(2) + ' (area / whole, A0 = ' + A0.toFixed(2) + ' m2)'];
  if (truth) { var t = L.truthOf(f); lines.push('truth: axis ' + t.z.toFixed(1) + ' m, off by ' + (r.z - t.z).toFixed(1) + ' m, ' + (t.mode === 'emerge' ? 'steps out' : 'open')); }
  lines.forEach(function (s, k) { V.mono(ctx, s, x, y + ih + 12 + 13 * k, k === 3 ? (r.step ? C.red : C.green) : C.ink, 9.5); });
}

/* panel 3: the coverage estimate against n (band: 10th to 90th percentile of draws, from the builder), and the chance that the rarest cell is missing */
function drawCurve(ctx, x, y, w, h, st, D) {
  var NS = D.protocol.NS, cu = D.pool.curve, PB = D.pool.cellFrames[1], k;
  var P = V.plot(ctx, x + 40, y + 16, w - 56, h - 44, { xmin: 25, xmax: 800, xlog: true, ymin: 0, ymax: 1, xticks: NS, yticks: [0, 0.25, 0.5, 0.75, 1], yfmt: function (t) { return Math.round(100 * t) + '%'; }, xlabel: 'labelled frames n' });
  var lo = NS.map(function (n) { return cu[n].cover.lo; }), md = NS.map(function (n) { return cu[n].cover.med; }), hi = NS.map(function (n) { return cu[n].cover.hi; });
  ctx.save(); ctx.fillStyle = C.tealSoft; ctx.beginPath();
  NS.forEach(function (n, j) { if (j) ctx.lineTo(P.X(n), P.Y(hi[j])); else ctx.moveTo(P.X(n), P.Y(hi[j])); });
  for (k = NS.length - 1; k >= 0; k--) ctx.lineTo(P.X(NS[k]), P.Y(lo[k]));
  ctx.closePath(); ctx.fill(); ctx.restore();
  V.curve(ctx, P, NS, md, C.teal, 2); V.dots(ctx, P, NS, md, C.teal, 3);
  V.line(ctx, P.bx, P.Y(D.pool.cover), P.bx + P.bw, P.Y(D.pool.cover), C.teal, 1, [5, 4]);
  var xs = [], ab = [];
  for (k = 0; k <= 40; k++) { var nn = 25 * Math.pow(32, k / 40); xs.push(nn); ab.push(L.pAbsent(PB, nn)); }
  V.curve(ctx, P, xs, ab, C.red, 2);
  V.line(ctx, P.X(st.n), P.by, P.X(st.n), P.by + P.bh, C.ink, 1, [3, 3]);
  V.dot(ctx, P.X(st.n), P.Y(st.cov), 5, C.ink, C.white);
  V.dot(ctx, P.X(st.n), P.Y(L.pAbsent(PB, st.n)), 4.5, C.red, C.white);
  V.mono(ctx, 'coverage vs n: median, 10-90%', P.bx + 6, P.by + 10, C.teal, 9.5);
  V.mono(ctx, 'dot: sample; dashed: ' + pct(D.pool.cover, 1) + ' pool', P.bx + 6, P.by + 22, C.mute, 9.5);
  V.mono(ctx, 'red: rarest cell missing ' + pct(L.pAbsent(PB, st.n)), P.bx + 6, P.by + 34, C.red, 9.5);
}

/* the whole canvas: cv, the state {n, rs, T, q, B, cov, sel}, the labelled budget, the data, and whether the lab-truth line is shown */
L.draw = function (cv, st, B, D, truth) {
  cv.style.height = (cv.clientWidth < 640 ? 840 : 580) + 'px';
  var S = V.setup(cv), ctx = S.ctx, w = S.w, narrow = w < 640, pad = 8, lw = narrow ? w - 2 * pad : Math.floor(w * 0.55) - pad;
  drawTable(ctx, pad, 2, lw, st);
  var rx = narrow ? pad : pad + lw + 14, rw = narrow ? w - 2 * pad : w - rx - pad, ry = narrow ? 262 : 2;
  V.mono(ctx, 'labelled frames (pedestrian teal)', rx, ry + 6, C.mute, 10);
  drawStrip(ctx, rx, ry + 14, rw, st, B);
  var th = (rw - 12) / 12, fy = ry + 14 + 2 * (th + 24) + 6;
  drawFrame(ctx, rx, fy, rw, st, B, truth);
  var cy = fy + rw / 4 + 12 + 13 * 6 + 6;
  if (!narrow) cy = Math.max(cy, 262);
  drawCurve(ctx, pad, cy, w - 2 * pad, Math.min(250, (narrow ? 840 : 580) - cy - 4), st, D);
};

/* the page's wiring: the controls and readouts of the widget #w05, and a redraw on every change */
L.wire = function () {
  var cv = document.getElementById('w05-canvas'), D = SV.L05;
  if (!cv || !D) return;
  var NS = D.protocol.NS, PB = D.pool.cellFrames[1], B = L.budget().pickStrip([0, 2, 4, 6, 3, 5], 300), el = {};
  ['n', 'n-v', 'fr', 'fr-v', 'prog', 'truth', 'cov', 'bey', 'step', 'rare', 'z'].forEach(function (k) { el[k] = document.getElementById('w05-' + k); });
  function pr(x) { return Math.round(100 * x) + '%'; }
  function state() {
    var n = NS[+el.n.value], rs = B.grow(n).RS.slice(0, n), T = L.tally(rs), q = D.q[el.prog.value].share;
    return { n: n, rs: rs, T: T, q: q, B: L.bootstrap(rs, 200, 7, q), cov: L.coverage(T.share, q, 0.01), sel: Math.min(+el.fr.value, B.strip.length - 1) };
  }
  function update() {
    var st = state(), r = B.RS[B.strip[st.sel]];
    el['n-v'].textContent = String(st.n); el['fr-v'].textContent = String(st.sel + 1);
    el.cov.textContent = pr(st.cov) + ' (' + pr(st.B.cover[0]) + '-' + pr(st.B.cover[1]) + ')';
    el.bey.textContent = pr(L.beyond(st.T.share)); el.step.textContent = pr(L.stepShare(st.T.share));
    el.rare.textContent = st.T.counts[1] + ' (expect ' + (st.n * PB).toFixed(1) + ')';
    el.z.textContent = r.z.toFixed(1) + ' m (' + r.lo.toFixed(1) + '-' + r.hi.toFixed(1) + '), ' + (r.step ? 'stepping out' : 'open') + ', visible ' + L.phi(r, L.wholeArea(st.rs)).toFixed(2);
    L.draw(cv, st, B, D, el.truth.checked);
  }
  ['input', 'change'].forEach(function (ev) { [el.n, el.fr, el.prog, el.truth].forEach(function (e) { e.addEventListener(ev, update); }); });
  window.addEventListener('resize', update);
  update();
};

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
