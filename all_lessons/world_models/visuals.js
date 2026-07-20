(function () {
  'use strict';

  const C = {
    ink: '#20202a', mute: '#747386', dim: '#aaa8b8', grid: '#e7e5ef',
    purple: '#6d4aff', purpleSoft: '#dcd6ff', cyan: '#0891b2',
    cyanSoft: '#cceef4', amber: '#d97706', amberSoft: '#fde7c6',
    green: '#15935a', greenSoft: '#d5f2e2', red: '#dc3f55', redSoft: '#f9d8df',
    white: '#ffffff', panel: '#f8f8fc', code: '#f2f1f7'
  };

  function setup(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(300, canvas.clientWidth || 700);
    const h = Math.max(180, canvas.clientHeight || 250);
    const rw = Math.round(w * dpr), rh = Math.round(h * dpr);
    if (canvas.width !== rw || canvas.height !== rh) {
      canvas.width = rw; canvas.height = rh;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    return { ctx, w, h };
  }

  function line(ctx, x1, y1, x2, y2, color, width, dash) {
    ctx.save(); ctx.strokeStyle = color || C.ink; ctx.lineWidth = width || 1;
    ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }

  function path(ctx, pts, color, width, dash) {
    if (!pts.length) return;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke(); ctx.restore();
  }

  function dot(ctx, x, y, r, fill, stroke) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    const rr = Math.min(r || 8, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function label(ctx, text, x, y, color, size, align, weight) {
    ctx.fillStyle = color || C.ink;
    ctx.font = `${weight || 500} ${size || 12}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y);
  }

  function mono(ctx, text, x, y, color, size, align) {
    ctx.fillStyle = color || C.mute; ctx.font = `${size || 10}px "SF Mono", Menlo, monospace`;
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y);
  }

  function arrow(ctx, x1, y1, x2, y2, color, width) {
    line(ctx, x1, y1, x2, y2, color, width || 1.5);
    const a = Math.atan2(y2 - y1, x2 - x1), s = 6;
    ctx.save(); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - s * Math.cos(a - .45), y2 - s * Math.sin(a - .45));
    ctx.lineTo(x2 - s * Math.cos(a + .45), y2 - s * Math.sin(a + .45)); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function node(ctx, x, y, w, h, title, sub, fill, stroke) {
    roundRect(ctx, x, y, w, h, 8, fill || C.white, stroke || C.grid);
    label(ctx, title, x + w / 2, y + h / 2 - (sub ? 7 : 0), C.ink, 12, 'center', 650);
    if (sub) mono(ctx, sub, x + w / 2, y + h / 2 + 10, C.mute, 9, 'center');
  }

  function control(widget, role) { return widget.querySelector(`[data-role="${role}"]`); }
  function value(widget, role, fallback) {
    const el = control(widget, role); return el ? (el.type === 'range' ? Number(el.value) : el.value) : fallback;
  }
  function metric(widget, name, text) {
    const el = widget.querySelector(`[data-metric="${name}"]`); if (el) el.textContent = text;
  }
  function syncValues(widget) {
    widget.querySelectorAll('input[type="range"][data-role]').forEach(input => {
      const out = widget.querySelector(`[data-value="${input.dataset.role}"]`);
      if (out) out.textContent = `${input.value}${input.dataset.suffix || ''}`;
    });
  }

  // Lesson 01: observed steps are filtered to truth; free-run then drifts by an integrated velocity error.
  function renderLoop(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const horizon = value(widget, 'horizon', 5);
    const known = 3;                                    // observed steps 0..2
    const n = known + horizon;
    const pad = 30, mid = h * .52, span = w - pad * 2, dx = span / Math.max(1, n - 1);
    mono(ctx, 'OBSERVED (filtered to truth)', pad, 15, C.mute, 9);
    mono(ctx, 'IMAGINED (free-run)', w - pad, 15, C.mute, 9, 'right');
    for (let i = 0; i <= 4; i++) { const yy = 34 + i * (h - 58) / 4; line(ctx, pad, yy, w - pad, yy, C.grid, 1); }
    const trueY = i => mid + 40 * Math.sin(0.4 + i * 0.5);
    const velErr = 7;                                   // px/step error that survives once evidence ends
    const tp = [], pp = []; let pred = trueY(0);
    for (let i = 0; i < n; i++) {
      const x = pad + i * dx; tp.push([x, trueY(i)]);
      if (i < known) pred = trueY(i); else pred = pred + (trueY(i) - trueY(i - 1)) + velErr;
      pp.push([x, pred]);
    }
    path(ctx, tp, C.cyan, 2.6);
    path(ctx, pp.slice(known - 1), C.purple, 2.6, [5, 4]);
    tp.forEach((p, i) => dot(ctx, p[0], p[1], i < known ? 5 : 3, i < known ? C.cyan : C.dim));
    pp.forEach((p, i) => { if (i >= known) dot(ctx, p[0], p[1], 4, C.purple, C.white); });
    const ex = pad + (known - 1) * dx;
    line(ctx, ex, 26, ex, h - 14, C.amber, 1.4, [4, 4]);
    mono(ctx, 'last evidence', ex + 5, h - 14, C.amber, 8);
    label(ctx, 'truth', w - pad - 4, tp[n - 1][1] + 12, C.cyan, 10, 'right');
    label(ctx, 'imagined', w - pad - 4, pp[n - 1][1] - 10, C.purple, 10, 'right');
    const drift = Math.abs(pp[n - 1][1] - tp[n - 1][1]) / 40 * 100;   // % of state amplitude
    metric(widget, 'state', 'learned xₜ'); metric(widget, 'horizon', `${horizon} steps`);
    metric(widget, 'drift', `${drift.toFixed(0)}%`); metric(widget, 'use', horizon < 6 ? 'plan locally' : 're-observe');
  }

  function renderBelief(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const reliability = value(widget, 'reliability', 75) / 100;
    const evidence = value(widget, 'evidence', 2);
    const odds = Math.pow(reliability / Math.max(.001, 1 - reliability), evidence);
    const p = odds / (1 + odds);
    const split = Math.min(w * .42, 285);
    mono(ctx, 'HIDDEN WORLD', 22, 18, C.mute, 9);
    roundRect(ctx, 25, 40, split - 45, h - 65, 10, '#f2f1f7', C.grid);
    label(ctx, '?', (split - 20) / 2, h * .44, C.dim, 54, 'center', 600);
    line(ctx, 42, 55, split - 38, h - 42, '#d6d3e2', 4);
    line(ctx, split - 38, 55, 42, h - 42, '#d6d3e2', 4);
    label(ctx, `${evidence} noisy glimpse${evidence === 1 ? '' : 's'}`, (split - 20) / 2, h - 35, C.mute, 11, 'center');
    mono(ctx, 'BELIEF, NOT A GUESS', split + 18, 18, C.mute, 9);
    const barX = split + 45, barW = Math.max(90, w - barX - 35), barH = 33;
    label(ctx, 'door A', split + 18, 67, C.ink, 12);
    roundRect(ctx, barX, 51, barW, barH, 7, C.code, C.grid);
    roundRect(ctx, barX, 51, barW * p, barH, 7, C.purple, null);
    mono(ctx, `${(p * 100).toFixed(1)}%`, barX + barW - 8, 68, p > .55 ? C.white : C.ink, 10, 'right');
    label(ctx, 'door B', split + 18, 121, C.ink, 12);
    roundRect(ctx, barX, 105, barW, barH, 7, C.code, C.grid);
    roundRect(ctx, barX, 105, barW * (1 - p), barH, 7, C.cyan, null);
    mono(ctx, `${((1 - p) * 100).toFixed(1)}%`, barX + barW - 8, 122, (1 - p) > .55 ? C.white : C.ink, 10, 'right');
    const entropy = -(p * Math.log2(Math.max(p, 1e-6)) + (1 - p) * Math.log2(Math.max(1 - p, 1e-6)));
    roundRect(ctx, split + 18, 163, w - split - 38, 54, 8, entropy > .65 ? C.amberSoft : C.greenSoft, C.grid);
    label(ctx, entropy > .65 ? 'uncertain → gather information' : 'confident enough → act', split + 32, 182, C.ink, 12, 'left', 650);
    mono(ctx, 'the belief state carries both hypotheses', split + 32, 201, C.mute, 9);
    metric(widget, 'posterior', `${(p * 100).toFixed(1)}% A`); metric(widget, 'entropy', `${entropy.toFixed(2)} bits`);
    metric(widget, 'memory', evidence > 1 ? 'history fused' : 'one frame'); metric(widget, 'decision', entropy > .65 ? 'observe' : 'act');
  }

  function renderBottleneck(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const slots = value(widget, 'capacity', 3);
    const inputs = [
      ['position', C.purple], ['velocity', C.cyan], ['object', C.green],
      ['texture', C.amber], ['glare', C.dim], ['sensor noise', C.red]
    ];
    const x1 = 25, x2 = w * .5 - 35, x3 = w - 145;
    mono(ctx, 'OBSERVATION FACTORS', x1, 16, C.mute, 9);
    mono(ctx, `${slots} LATENT SLOTS`, x2 - 8, 16, C.mute, 9);
    mono(ctx, 'OBJECTIVES', x3, 16, C.mute, 9);
    inputs.forEach((it, i) => {
      const y = 43 + i * 31;
      roundRect(ctx, x1, y - 10, 105, 21, 5, C.white, C.grid); dot(ctx, x1 + 11, y, 4, it[1]); label(ctx, it[0], x1 + 22, y, C.ink, 10);
      const kept = i < slots;
      if (kept) arrow(ctx, x1 + 108, y, x2 - 9, 54 + i * Math.min(36, 155 / Math.max(slots - 1, 1)), it[1], 1.2);
    });
    for (let i = 0; i < slots; i++) {
      const y = 54 + i * Math.min(36, 155 / Math.max(slots - 1, 1));
      roundRect(ctx, x2, y - 11, 67, 23, 11, i < 3 ? C.purpleSoft : C.amberSoft, C.grid);
      mono(ctx, `z${i + 1}`, x2 + 33, y, C.ink, 10, 'center');
    }
    arrow(ctx, x2 + 70, 92, x3 - 12, 78, C.purple, 1.5);
    arrow(ctx, x2 + 70, 132, x3 - 12, 157, C.amber, 1.5);
    node(ctx, x3, 51, 117, 52, 'predict future', 'keep dynamics', C.purpleSoft, '#bdb3ff');
    node(ctx, x3, 130, 117, 52, 'reconstruct', 'keep pixels', C.amberSoft, '#efd09f');
    // 3 causal factors (position, velocity, object) drive prediction; recon keeps ALL 6 factors.
    const pred = Math.max(0, Math.round(100 * Math.min(slots, 3) / 3 - Math.max(0, slots - 3) * 4));
    const recon = Math.round(100 * slots / 6);
    metric(widget, 'predict', `${pred}%`); metric(widget, 'reconstruct', `${recon}%`);
    metric(widget, 'nuisance', slots > 3 ? 'leaking in' : 'discarded'); metric(widget, 'choice', slots === 3 ? 'sufficient' : slots < 3 ? 'too narrow' : 'too literal');
  }

  // Lesson 06: iterate the DERIVED recurrence e(k+1)=J·e(k)+δ (not a fake curve).
  function renderDynamics(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const J = value(widget, 'jacobian', 1.08);
    const delta = value(widget, 'error', 3) / 100;
    const H = value(widget, 'horizon', 12);
    const left = 44, right = w - 16, top = 26, bottom = h - 28;
    // real error propagation, starting exactly on the true state (e0 = 0)
    const e = [0];
    for (let k = 0; k < H; k++) e.push(J * e[k] + delta);
    const eH = e[H];
    const contact = 0.40;                                   // wrong-contact boundary (lesson §3)
    const bound = J < 0.999 ? delta / (1 - J) : Infinity;   // contraction fixed point
    const maxY = Math.max(contact * 1.3, eH * 1.1, isFinite(bound) ? bound * 1.2 : 0, 0.05);
    const X = k => left + (H ? k / H : 0) * (right - left);
    const Y = v => bottom - Math.min(v, maxY) / maxY * (bottom - top);
    mono(ctx, 'error e(k)', 8, top - 8, C.mute, 8); mono(ctx, 'step k →', right, h - 11, C.mute, 8, 'right');
    for (let i = 0; i <= 4; i++) { const yy = top + i * (bottom - top) / 4; line(ctx, left, yy, right, yy, C.grid, 1); }
    line(ctx, left, bottom, right, bottom, C.dim, 1); line(ctx, left, top, left, bottom, C.dim, 1);
    if (contact < maxY) { line(ctx, left, Y(contact), right, Y(contact), C.amber, 1.2, [5, 4]); mono(ctx, 'wrong-contact boundary 0.40', left + 6, Y(contact) - 7, C.amber, 8); }
    if (isFinite(bound) && bound < maxY) { line(ctx, left, Y(bound), right, Y(bound), C.green, 1.2, [3, 3]); mono(ctx, `bound δ/(1−J)=${bound.toFixed(2)}`, right - 4, Y(bound) - 7, C.green, 8, 'right'); }
    const pts = e.map((v, k) => [X(k), Y(v)]);
    path(ctx, pts, C.purple, 2.7);
    pts.forEach((p, k) => { if (k % Math.max(1, Math.round(H / 8)) === 0 || k === H) dot(ctx, p[0], Math.max(top, p[1]), 3, C.purple); });
    let cross = -1; for (let k = 0; k <= H; k++) { if (e[k] >= contact) { cross = k; break; } }
    if (cross > 0) { line(ctx, X(cross), top, X(cross), bottom, C.red, 1, [2, 3]); mono(ctx, `k=${cross}`, X(cross) + 3, top + 9, C.red, 8); }
    label(ctx, 'e(k+1)=J·e(k)+δ', right - 5, top + 12, C.purple, 11, 'right', 650);
    const regime = J > 1.001 ? 'amplifying' : J < 0.999 ? 'contracting' : 'linear';
    metric(widget, 'one', `${(delta * 100).toFixed(0)}%`);
    metric(widget, 'rollout', eH >= 100 ? '≫ 1' : eH.toFixed(2));
    metric(widget, 'regime', `J ${regime}`);
    metric(widget, 'fix', (J < 0.999 && bound < contact) ? 'self-correcting' : cross > 0 ? 'shorten / re-observe' : 'watch horizon');
  }

  // Lesson 05: real bimodal outcome density; the MSE (conditional-mean) prediction falls in the valley.
  function renderUncertainty(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const sep = value(widget, 'separation', 60) / 100;   // gap between the two valid modes
    const massL = value(widget, 'mass', 50) / 100;        // probability of the upper mode
    const sx = 34, sy = h / 2;
    mono(ctx, 'ONE PRESENT', 16, 15, C.mute, 9); mono(ctx, 'BIMODAL FUTURE', w - 16, 15, C.mute, 9, 'right');
    const amp = h * .33 * sep, yUp = sy - amp, yDn = sy + amp;
    const mean = massL * yUp + (1 - massL) * yDn;          // conditional (MSE-optimal) mean
    const obX = w * .52, obW = 44;
    roundRect(ctx, obX, sy - 24, obW, 48, 9, C.redSoft, '#ef9dab');
    label(ctx, 'obstacle', obX + obW / 2, sy, C.red, 10, 'center', 650);
    dot(ctx, sx, sy, 8, C.ink);
    const span = w - sx - 66;
    function fam(target, n, col) {
      for (let i = 0; i < n; i++) {
        const j = (i - (n - 1) / 2) * 3.5, pts = [];
        for (let k = 0; k <= 24; k++) { const q = k / 24; pts.push([sx + q * span, sy + (target - sy) * Math.sin(Math.PI * q / 2) + j * Math.sin(Math.PI * q)]); }
        path(ctx, pts, col, 1.3);
      }
    }
    const nUp = Math.round(massL * 10), nDn = 10 - nUp;
    fam(yUp, nUp, 'rgba(109,74,255,.34)'); fam(yDn, nDn, 'rgba(8,145,178,.34)');
    path(ctx, [[sx, sy], [sx + span, mean]], C.red, 1.8, [5, 4]);
    mono(ctx, 'MSE mean', sx + span - 2, mean - 6, C.red, 8, 'right');
    // real density profile on the right edge
    const dx = w - 56, dh = h * .74, dtop = sy - dh / 2, sigma = dh * .085;
    const dens = y => massL * Math.exp(-((y - yUp) ** 2) / (2 * sigma * sigma)) + (1 - massL) * Math.exp(-((y - yDn) ** 2) / (2 * sigma * sigma));
    const peak = Math.max(dens(yUp), dens(yDn)), curve = [];
    for (let y = dtop; y <= dtop + dh; y += 3) curve.push([dx + dens(y) / peak * 38, y]);
    path(ctx, curve, C.purple, 2);
    line(ctx, dx, dtop, dx, dtop + dh, C.grid, 1);
    dot(ctx, dx + dens(yUp) / peak * 38, yUp, 3, C.purple); dot(ctx, dx + dens(yDn) / peak * 38, yDn, 3, C.cyan);
    const meanDens = dens(mean) / peak;
    dot(ctx, dx + meanDens * 38, mean, 4, C.red, C.white);
    const inValley = meanDens < 0.4 && massL > 0.15 && massL < 0.85;
    const entropy = -(massL * Math.log2(Math.max(massL, 1e-6)) + (1 - massL) * Math.log2(Math.max(1 - massL, 1e-6)));
    metric(widget, 'modes', massL > .15 && massL < .85 ? '2 valid' : '1 dominant');
    metric(widget, 'entropy', `${entropy.toFixed(2)} bits`);
    metric(widget, 'mean', inValley ? 'in the valley' : 'near a mode');
    metric(widget, 'planner', inValley ? 'keep both modes' : 'one mode ok');
  }

  // Lesson 07: compute the §4 confounding example live — observational vs do(a).
  function renderCausality(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const mode = value(widget, 'mode', 'observe');
    const pIcy = value(widget, 'prior', 20) / 100;
    const conf = value(widget, 'confound', 90) / 100;        // P(hard | icy)
    const pDry = 1 - pIcy, pHardDry = 0.10;
    const sYdh = .90, sYdg = .70, sYih = .40, sYig = .10;      // success table (lesson defaults)
    const pHard = pDry * pHardDry + pIcy * conf, pGentle = 1 - pHard;
    const pYhard = (pDry * pHardDry * sYdh + pIcy * conf * sYih) / Math.max(1e-6, pHard);
    const pYgentle = (pDry * (1 - pHardDry) * sYdg + pIcy * (1 - conf) * sYig) / Math.max(1e-6, pGentle);
    const obs = pYhard - pYgentle;                             // observational effect (can flip negative)
    const doHard = pDry * sYdh + pIcy * sYih, doGentle = pDry * sYdg + pIcy * sYig;
    const intv = doHard - doGentle;                            // interventional effect
    const active = mode === 'observe' ? obs : intv;
    const cx = w * .5;
    mono(ctx, mode === 'observe' ? 'PASSIVE DATA · BACKDOOR A ← U → Y OPEN' : 'do(a) · BACKDOOR CUT', 18, 14, C.mute, 9);
    node(ctx, cx - 54, 24, 108, 34, 'road U', pIcy > .5 ? 'mostly icy' : 'mostly dry', C.amberSoft, '#efce9c');
    node(ctx, 40, 92, 104, 34, 'brake A', 'hard / gentle', C.purpleSoft, '#bdb3ff');
    node(ctx, w - 144, 92, 104, 34, 'stop Y', 'success', C.cyanSoft, '#9ddce7');
    arrow(ctx, cx + 26, 58, w - 108, 92, C.amber, 1.5);        // U → Y (always)
    arrow(ctx, 146, 109, w - 146, 109, C.purple, 1.8);          // A → Y (always)
    if (mode === 'observe') {
      arrow(ctx, cx - 26, 58, 120, 92, C.amber, 1.5);           // U → A (open backdoor)
      mono(ctx, 'U→A: policy reserves hard braking for ice', cx, 78, C.red, 8, 'center');
    } else {
      line(ctx, cx - 26, 58, 120, 92, C.dim, 1, [4, 4]);
      const mx = (cx - 26 + 120) / 2, my = 76;
      line(ctx, mx - 7, my - 7, mx + 7, my + 7, C.red, 3); line(ctx, mx - 7, my + 7, mx + 7, my - 7, C.red, 3);
      mono(ctx, 'action set by us, not by U', cx, 78, C.green, 8, 'center');
    }
    // both signed effects shown; active one outlined → the sign flip is visible
    const bx = 178, bw = w - bx - 24, zero = bx + bw * .5, scale = (bw * .5) / 0.5;
    const rows = [['observational  P(Y|hard)−P(Y|gentle)', obs, mode === 'observe'],
                  ['interventional  do(hard)−do(gentle)', intv, mode === 'intervene']];
    rows.forEach((r, i) => {
      const y = h - 58 + i * 28;
      mono(ctx, r[0], 20, y + 6, r[2] ? C.ink : C.mute, 8);
      line(ctx, zero, y - 3, zero, y + 15, C.dim, 1);
      const v = Math.max(-0.5, Math.min(0.5, r[1])), col = r[1] >= 0 ? C.green : C.red;
      roundRect(ctx, v >= 0 ? zero : zero + v * scale, y, Math.max(1, Math.abs(v * scale)), 12, 3, col, r[2] ? C.ink : null);
      mono(ctx, `${r[1] >= 0 ? '+' : ''}${(r[1] * 100).toFixed(0)}pt`, r[1] >= 0 ? zero + v * scale + 5 : zero + v * scale - 5, y + 6, col, 9, r[1] >= 0 ? 'left' : 'right');
    });
    const noConf = Math.abs(obs - intv) < 0.02;
    metric(widget, 'effect', `${active >= 0 ? '+' : ''}${(active * 100).toFixed(0)} pt`);
    metric(widget, 'meaning', mode === 'observe' ? (noConf ? '≈ causal' : 'association') : 'causal effect');
    metric(widget, 'policy', mode === 'observe' ? 'off-policy risk' : 'controllable');
    metric(widget, 'need', mode === 'observe' ? 'adjust for U / randomize' : 'needs coverage');
  }

  const ARCH = {
    rssm: { name: 'Recurrent state-space', nodes: ['encoder', 'memory hₜ', 'stochastic zₜ', 'decoder / heads'], sub: ['pixels → latent', 'history', 'uncertainty', 'reward + obs'], color: C.purple, trade: ['compact', 'fast rollout', 'state aliasing'] },
    token: { name: 'Autoregressive tokens', nodes: ['tokenizer', 'token history', 'next-token model', 'detokenizer'], sub: ['frames → ids', 'long context', 'p(xₜ₊₁|x≤t)', 'video / state'], color: C.cyan, trade: ['scales well', 'discrete', 'sequential decode'] },
    diffusion: { name: 'Diffusion / flow', nodes: ['conditioner', 'noisy future', 'denoising path', 'future sample'], sub: ['state + action', 'many modes', 'iterative solve', 'high fidelity'], color: C.amber, trade: ['multimodal', 'slow sample', 'weak state'] },
    jepa: { name: 'Predictive embeddings', nodes: ['context encoder', 'predictor', 'target encoder', 'latent target'], sub: ['visible past', 'abstract future', 'stop-grad / EMA', 'no pixels'], color: C.green, trade: ['semantic', 'efficient', 'decoder optional'] }
  };

  function renderArchitectures(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const key = value(widget, 'architecture', 'rssm'), a = ARCH[key] || ARCH.rssm;
    mono(ctx, a.name.toUpperCase(), 20, 17, a.color, 9);
    const pad = 22, gap = 12, nw = (w - pad * 2 - gap * 3) / 4, y = 58;
    a.nodes.forEach((n, i) => {
      node(ctx, pad + i * (nw + gap), y, nw, 62, n, a.sub[i], i === 2 ? `${a.color}22` : C.white, i === 2 ? a.color : C.grid);
      if (i < 3) arrow(ctx, pad + i * (nw + gap) + nw, y + 31, pad + (i + 1) * (nw + gap) - 3, y + 31, a.color, 1.5);
    });
    const by = 157;
    a.trade.forEach((t, i) => {
      const bw = (w - 44 - 16) / 3;
      roundRect(ctx, 22 + i * (bw + 8), by, bw, 40, 7, i === 2 ? C.redSoft : C.panel, C.grid);
      mono(ctx, i === 2 ? 'COST' : (i === 0 ? 'STRENGTH' : 'SHAPE'), 30 + i * (bw + 8), by + 12, i === 2 ? C.red : C.mute, 8);
      label(ctx, t, 30 + i * (bw + 8), by + 27, C.ink, 11, 'left', 620);
    });
    metric(widget, 'unit', key === 'token' ? 'tokens' : key === 'rssm' ? 'latent state' : key === 'diffusion' ? 'trajectory' : 'embedding');
    metric(widget, 'sample', key === 'rssm' || key === 'jepa' ? 'fast' : key === 'token' ? 'sequential' : 'iterative');
    metric(widget, 'uncertainty', key === 'diffusion' || key === 'rssm' ? 'native' : 'implicit'); metric(widget, 'best', a.trade[0]);
  }

  function renderPlanning(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const horizon = value(widget, 'horizon', 10), samples = value(widget, 'samples', 64);
    const gx = w - 34, gy = 35, sx = 30, sy = h - 31;
    mono(ctx, 'IMAGINED ACTION SEQUENCES', 15, 15, C.mute, 9);
    roundRect(ctx, w * .38, h * .33, w * .23, h * .28, 9, C.redSoft, '#ef9dab');
    mono(ctx, 'collision', w * .495, h * .47, C.red, 9, 'center');
    dot(ctx, sx, sy, 7, C.ink); dot(ctx, gx, gy, 9, C.green); label(ctx, 'goal', gx - 13, gy + 18, C.green, 9, 'center');
    const shown = Math.min(18, Math.max(5, Math.round(Math.log2(samples) * 2)));
    let best = null, bestScore = Infinity;
    for (let i = 0; i < shown; i++) {
      const pts = [[sx, sy]];
      const bias = (i - shown / 2) / shown;
      for (let t = 1; t <= horizon; t++) {
        const q = t / horizon;
        const x = sx + q * (gx - sx);
        const avoid = Math.sin(Math.PI * q) * (48 + bias * 70);
        const y = sy + q * (gy - sy) + (i % 2 ? -1 : 1) * avoid;
        pts.push([x, y]);
      }
      const mid = pts[Math.floor(pts.length / 2)];
      const hit = mid[0] > w * .35 && mid[0] < w * .64 && mid[1] > h * .28 && mid[1] < h * .66;
      const score = (hit ? 1000 : 0) + Math.abs(avoidEnd(pts, gx, gy)) + Math.abs(bias) * 20;
      if (score < bestScore) { bestScore = score; best = pts; }
      path(ctx, pts, hit ? 'rgba(220,63,85,.16)' : 'rgba(109,74,255,.14)', 1);
    }
    if (best) path(ctx, best, C.purple, 3);
    const reach = horizon >= 8;
    if (!reach) {
      const x = sx + (gx - sx) * horizon / 8; line(ctx, x, 20, x, h - 20, C.amber, 1, [4, 4]);
      mono(ctx, 'horizon ends', x - 4, h - 15, C.amber, 8, 'right');
    }
    metric(widget, 'rollouts', String(samples)); metric(widget, 'horizon', `${horizon} steps`);
    metric(widget, 'goal', reach ? 'visible' : 'beyond horizon'); metric(widget, 'loop', 'plan → act 1 → replan');
  }
  function avoidEnd(pts, gx, gy) { const p = pts[pts.length - 1]; return Math.hypot(p[0] - gx, p[1] - gy); }

  function renderImagination(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const imagined = value(widget, 'imagined', 8);
    const bias = value(widget, 'bias', 10) / 100;
    const split = w * .47;
    mono(ctx, 'REAL EXPERIENCE', 16, 16, C.mute, 9);
    mono(ctx, 'LATENT IMAGINATION', split + 16, 16, C.mute, 9);
    roundRect(ctx, 18, 34, split - 29, h - 52, 9, '#f7fafb', C.grid);
    roundRect(ctx, split + 10, 34, w - split - 28, h - 52, 9, '#faf9ff', '#dcd6ff');
    const realN = 4;
    for (let i = 0; i < realN; i++) {
      const x = 42 + i * (split - 85) / (realN - 1);
      const y = h * .58 + Math.sin(i * 1.1) * 31;
      if (i) arrow(ctx, 42 + (i - 1) * (split - 85) / (realN - 1), h * .58 + Math.sin((i - 1) * 1.1) * 31, x - 7, y, C.cyan, 1.5);
      dot(ctx, x, y, 7, C.cyan); mono(ctx, i === 0 ? 'observe' : 'transition', x, y + 17, C.mute, 8, 'center');
    }
    arrow(ctx, split - 2, h / 2, split + 17, h / 2, C.purple, 2);
    const sx = split + 36, sy = h * .55;
    dot(ctx, sx, sy, 7, C.purple);
    const branches = Math.min(12, Math.max(3, imagined));
    for (let b = 0; b < branches; b++) {
      const pts = [[sx, sy]];
      for (let t = 1; t <= 9; t++) {
        const q = t / 9;
        const x = sx + q * (w - sx - 26);
        const y = sy + Math.sin(q * 3.5 + b * .62) * (12 + b * 1.7) + bias * q * q * 75;
        pts.push([x, y]);
      }
      path(ctx, pts, b === 0 ? C.purple : 'rgba(109,74,255,.19)', b === 0 ? 2.5 : 1.1);
    }
    // model exploitation: the actor selects the argmax of K noisy imagined returns,
    // so optimism ≈ δ·√(2 ln K) — even zero-mean error is positively selected (§7).
    const K = imagined;
    const gap = bias * Math.sqrt(2 * Math.log(Math.max(2, K)));   // δ·√(2 ln K), guarded at K<2
    const oodX = split + (w - split) * .68;
    if (gap > 0.25) {
      roundRect(ctx, oodX, 42, w - oodX - 35, 30, 6, C.redSoft, '#ef9dab');
      mono(ctx, 'selected by exploitation', oodX + (w - oodX - 35) / 2, 57, C.red, 8, 'center');
      line(ctx, oodX, 75, oodX, h - 23, C.red, 1, [4, 4]);
    }
    mono(ctx, 'expensive, grounded', 28, h - 29, C.cyan, 8);
    mono(ctx, 'δ·√(2 ln K) gap', w - 29, h - 29, C.purple, 8, 'right');
    metric(widget, 'ratio', `${K}:1`); metric(widget, 'gain', `${K}× updates`);
    metric(widget, 'quality', `${(gap * 100).toFixed(0)}%`); metric(widget, 'risk', gap > 0.3 ? 'model exploitation' : 'bounded');
  }

  function renderSpatial(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const view = value(widget, 'viewpoint', 35) / 100;
    const split = w * .58;
    mono(ctx, 'PERSISTENT WORLD FRAME', 15, 15, C.mute, 9);
    mono(ctx, 'CURRENT CAMERA', split + 16, 15, C.mute, 9);
    roundRect(ctx, 18, 31, split - 30, h - 48, 8, '#f7fafb', C.grid);
    // map grid
    for (let x = 35; x < split - 15; x += 28) line(ctx, x, 32, x, h - 18, '#edf0f2', 1);
    for (let y = 48; y < h - 15; y += 28) line(ctx, 18, y, split - 12, y, '#edf0f2', 1);
    const ox = split * .56, oy = h * .47;
    roundRect(ctx, ox - 26, oy - 36, 52, 72, 6, C.amberSoft, '#e4bd7d'); label(ctx, 'wall', ox, oy, C.amber, 10, 'center', 650);
    const objectX = ox + 67, objectY = oy - 15;
    dot(ctx, objectX, objectY, 9, C.green); mono(ctx, 'object', objectX, objectY + 18, C.green, 8, 'center');
    const angle = -.7 + view * 2.1, camX = ox - 95 * Math.cos(angle), camY = oy - 78 * Math.sin(angle);
    dot(ctx, camX, camY, 7, C.purple); line(ctx, camX, camY, camX + 52 * Math.cos(angle), camY + 52 * Math.sin(angle), C.purple, 2);
    const visible = Math.abs(angle) > .35;
    path(ctx, [[camX,camY],[objectX,objectY]], visible ? 'rgba(21,147,90,.6)' : 'rgba(220,63,85,.45)', 1.2, [4,4]);
    // camera panel
    const px = split + 16, pw = w - split - 31;
    roundRect(ctx, px, 32, pw, h - 49, 8, '#e9eef4', C.grid);
    line(ctx, px, h * .73, px + pw, h * .73, '#c8d0d9', 1);
    roundRect(ctx, px + pw * .36, h * .36, pw * .27, h * .37, 3, C.amberSoft, '#e4bd7d');
    if (visible) { dot(ctx, px + pw * .75, h * .48, 10, C.green); mono(ctx, 'seen now', px + pw * .75, h * .48 + 19, C.green, 8, 'center'); }
    else { mono(ctx, 'occluded', px + pw * .76, h * .49, C.red, 9, 'center'); }
    roundRect(ctx, px + 10, h - 45, pw - 20, 18, 5, visible ? C.greenSoft : C.purpleSoft, null);
    mono(ctx, visible ? 'observation refreshes memory' : 'memory preserves object permanence', px + pw / 2, h - 36, visible ? C.green : C.purple, 8, 'center');
    metric(widget, 'frame', 'world / SE(3)'); metric(widget, 'visible', visible ? 'yes' : 'no');
    metric(widget, 'memory', 'object persists'); metric(widget, 'failure', visible ? 'none' : 'frame-only forgets');
  }

  function renderGeometry(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const camera = value(widget, 'camera', 20) / 100;
    const action = value(widget, 'action', 'none');
    const split = w * .43;
    mono(ctx, 'WORLD STATE (STABLE FRAME)', 15, 15, C.mute, 9);
    mono(ctx, 'RENDERED OBSERVATION', split + 16, 15, C.mute, 9);
    roundRect(ctx, 17, 34, split - 29, h - 52, 9, '#f7fafb', C.grid);
    const wx = action === 'move' ? 2.7 : 2.0;
    const rows = [['object x', wx.toFixed(1) + ' m'], ['object y', '1.4 m'], ['velocity', action === 'move' ? '+0.7 m/s' : '0.0 m/s'], ['camera pose', `${Math.round(camera * 180)}°`]];
    rows.forEach((r,i)=>{
      const y=48+i*37; roundRect(ctx,30,y,split-55,28,6,C.white,C.grid);
      label(ctx,r[0],40,y+14,C.mute,10); mono(ctx,r[1],split-37,y+14,i===3?C.cyan:C.purple,10,'right');
    });
    roundRect(ctx, 30, h - 49, split - 55, 19, 5, action === 'move' ? C.amberSoft : C.greenSoft, null);
    mono(ctx, action === 'move' ? 'action changes state' : 'camera changes only observation', split / 2, h - 39, action === 'move' ? C.amber : C.green, 8, 'center');
    const px=split+14, py=34, pw=w-split-31, ph=h-52;
    roundRect(ctx,px,py,pw,ph,9,'#e8edf4',C.grid);
    // horizon and perspective grid
    line(ctx,px,py+ph*.48,px+pw,py+ph*.48,'#b9c3ce',1);
    for(let i=0;i<6;i++){
      const q=i/5; line(ctx,px+pw*.5,py+ph*.48,px+q*pw,py+ph,'#c8d0da',1);
    }
    for(let i=1;i<5;i++){
      const q=i/5; const y=py+ph*.48+Math.pow(q,1.7)*ph*.52; line(ctx,px,y,px+pw,y,'#c8d0da',1);
    }
    const phase=camera*Math.PI*2;
    const ox=px+pw*.5+Math.sin(phase)*pw*.22+(action==='move'?pw*.09:0);
    const oy=py+ph*.55-Math.cos(phase)*ph*.07;
    const s=25+Math.cos(phase)*5;
    roundRect(ctx,ox-s/2,oy-s/2,s,s,4,C.purple,'#4e32c7');
    line(ctx,ox-s/2,oy-s/2,ox-s/2+10,oy-s/2-8,'#9a88ff',1.5);
    line(ctx,ox+s/2,oy-s/2,ox+s/2+10,oy-s/2-8,'#4e32c7',1.5);
    line(ctx,ox-s/2+10,oy-s/2-8,ox+s/2+10,oy-s/2-8,'#9a88ff',1.5);
    mono(ctx,`view ${Math.round(camera*180)}°`,px+pw-10,py+13,C.cyan,8,'right');
    metric(widget,'world',action==='move'?'changed':'unchanged'); metric(widget,'pixels','changed');
    metric(widget,'cause',action==='move'?'action + camera':'camera only'); metric(widget,'decoder','render O(s,c)');
  }

  function renderSimulator(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const action = value(widget, 'action', 'left'), steps = value(widget, 'steps', 6);
    mono(ctx, 'ACTION-CONDITIONED ROLLOUT', 15, 15, C.mute, 9);
    const panels = Math.min(5, Math.max(3, Math.round(w / 150))), gap = 8, pad = 16;
    const pw = (w - pad * 2 - gap * (panels - 1)) / panels, ph = h - 55;
    for (let i = 0; i < panels; i++) {
      const x = pad + i * (pw + gap), q = i / (panels - 1);
      roundRect(ctx, x, 32, pw, ph, 7, '#e9eef4', C.grid);
      // perspective road
      line(ctx, x + pw * .17, 32 + ph, x + pw * .43, 32 + ph * .42, '#aeb7c2', 2);
      line(ctx, x + pw * .83, 32 + ph, x + pw * .57, 32 + ph * .42, '#aeb7c2', 2);
      line(ctx, x + pw * .5, 32 + ph, x + pw * .5, 32 + ph * .44, C.white, 1.5, [6,5]);
      const dir = action === 'left' ? -1 : action === 'right' ? 1 : 0;
      const carX = x + pw * .5 + dir * q * pw * .24;
      roundRect(ctx, carX - 8, 32 + ph * (.76 - q * .15), 16, 22, 4, C.purple, null);
      mono(ctx, `t+${Math.round(q * steps)}`, x + 7, 44, C.mute, 8);
      if (i > 0) arrow(ctx, x - gap + 1, 32 + ph / 2, x - 2, 32 + ph / 2, C.purple, 1);
    }
    label(ctx, `action: ${action}`, w / 2, h - 13, C.purple, 11, 'center', 650);
    const fidelity = Math.max(45, 96 - steps * 3.5);
    metric(widget, 'control', action); metric(widget, 'fidelity', `${fidelity.toFixed(0)}%`);
    metric(widget, 'horizon', `${steps} frames`); metric(widget, 'test', 'change action → change future');
  }

  function renderMultimodal(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const query = value(widget, 'query', 'where');
    const layers = [
      { key: 'where', title: 'geometry', sub: 'where things are', color: C.cyan },
      { key: 'what', title: 'semantics', sub: 'what things mean', color: C.green },
      { key: 'next', title: 'dynamics', sub: 'what changes next', color: C.purple },
      { key: 'why', title: 'causal / language', sub: 'goals and reasons', color: C.amber }
    ];
    mono(ctx, 'COMPOSED WORLD STATE', 15, 15, C.mute, 9);
    const gap = 8, pad = 17, nw = (w - pad * 2 - gap * 3) / 4;
    layers.forEach((l, i) => {
      const active = l.key === query;
      node(ctx, pad + i * (nw + gap), 42, nw, 65, l.title, l.sub, active ? `${l.color}28` : C.white, active ? l.color : C.grid);
      if (active) roundRect(ctx, pad + i * (nw + gap) + nw / 2 - 16, 112, 32, 5, 2, l.color, null);
    });
    const active = layers.find(l => l.key === query) || layers[0];
    arrow(ctx, w / 2, 122, w / 2, 149, active.color, 1.8);
    const answers = {
      where: ['Object is behind the wall', 'use persistent 3D memory'],
      what: ['It is a closed red valve', 'bind label to the object track'],
      next: ['It will keep rolling downhill', 'simulate dynamics before acting'],
      why: ['Open it to restore flow', 'language supplies goal semantics']
    };
    roundRect(ctx, w * .18, 150, w * .64, 55, 9, `${active.color}18`, active.color);
    label(ctx, answers[query][0], w / 2, 169, C.ink, 13, 'center', 650);
    mono(ctx, answers[query][1], w / 2, 190, C.mute, 9, 'center');
    metric(widget, 'active', active.title); metric(widget, 'answer', query);
    metric(widget, 'grounding', query === 'why' ? 'goal ↔ scene' : 'state ↔ observation'); metric(widget, 'output', 'belief + action');
  }

  function renderEvaluation(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const horizon = value(widget, 'horizon', 12), latency = value(widget, 'latency', 80);
    const cx = Math.min(w * .34, 235), cy = h * .52, radius = Math.min(83, h * .35);
    const axes = ['perception', 'dynamics', 'action effect', 'uncertainty', 'task utility'];
    const vals = [
      .88, Math.max(.25, .94 - horizon * .035), .79,
      Math.max(.32, .86 - horizon * .022), Math.min(.9, .48 + latency / 250)
    ];
    mono(ctx, 'EVALUATE THE LOOP, NOT ONE FRAME', 15, 15, C.mute, 9);
    for (let ring = 1; ring <= 4; ring++) {
      const pts = axes.map((_, i) => {
        const a = -Math.PI / 2 + i * Math.PI * 2 / axes.length;
        return [cx + Math.cos(a) * radius * ring / 4, cy + Math.sin(a) * radius * ring / 4];
      }); pts.push(pts[0]); path(ctx, pts, C.grid, 1);
    }
    axes.forEach((aName, i) => {
      const a = -Math.PI / 2 + i * Math.PI * 2 / axes.length;
      line(ctx, cx, cy, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, C.grid, 1);
      label(ctx, aName, cx + Math.cos(a) * (radius + 15), cy + Math.sin(a) * (radius + 13), C.mute, 9, Math.cos(a) < -.2 ? 'right' : Math.cos(a) > .2 ? 'left' : 'center');
    });
    const poly = vals.map((v, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / axes.length; return [cx + Math.cos(a) * radius * v, cy + Math.sin(a) * radius * v]; });
    ctx.save(); ctx.globalAlpha = .16; ctx.fillStyle = C.purple; ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]); poly.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.fill(); ctx.restore();
    path(ctx, [...poly, poly[0]], C.purple, 2.2); poly.forEach(p => dot(ctx, p[0], p[1], 3, C.purple));
    const px = w * .57, pw = w - px - 18;
    mono(ctx, 'SYSTEM ENVELOPE', px, 42, C.mute, 9);
    const weakestValue = Math.min(...vals);
    const weakestIndex = vals.indexOf(weakestValue);
    const releaseFloor = .60;
    const deadlineFeasible = latency <= 55;
    const releaseReady = weakestValue >= releaseFloor && deadlineFeasible;
    const rows = [
      ['rollout horizon', `${horizon} steps`, horizon > 16 ? C.red : C.green],
      ['planner P99', `${latency} ms`, latency <= 55 ? C.green : C.red],
      ['closed-loop score', `${Math.round(vals.reduce((a,b)=>a+b,0) / vals.length * 100)}/100`, C.purple],
      ['release gate', releaseReady ? 'pass' : 'blocked', releaseReady ? C.green : C.red]
    ];
    rows.forEach((r, i) => {
      const y = 64 + i * 39; roundRect(ctx, px, y, pw, 30, 6, C.panel, C.grid);
      label(ctx, r[0], px + 9, y + 15, C.mute, 10); mono(ctx, r[1], px + pw - 9, y + 15, r[2], 10, 'right');
    });
    const score = Math.round(vals.reduce((a,b)=>a+b,0) / vals.length * 100);
    metric(widget, 'score', `${score}/100`); metric(widget, 'weakest', axes[weakestIndex]);
    metric(widget, 'latency', `${latency} ms`);
    metric(widget, 'ship', releaseReady ? 'inside gate' : weakestValue < releaseFloor ? `block: ${axes[weakestIndex]}` : 'block: latency');
  }

  function renderScaling(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const resolution = value(widget, 'resolution', 256);
    const fps = value(widget, 'fps', 12);
    const horizon = value(widget, 'horizon', 8);
    const patch = 16;
    const tokensFrame = Math.pow(resolution / patch, 2);
    const tokens = tokensFrame * fps * horizon;
    const attention = tokens * tokens;
    mono(ctx, 'TRAJECTORY TOKEN ACCOUNTANT', 15, 15, C.mute, 9);
    const left = 19, top = 38, gridW = Math.min(w * .44, 320), gridH = h - 59;
    roundRect(ctx, left, top, gridW, gridH, 8, '#f7fafb', C.grid);
    const cols = Math.min(12, Math.max(4, Math.round(resolution / 32)));
    const rows = Math.min(8, Math.max(3, Math.round(cols * .64)));
    const cw = (gridW - 24) / cols, ch = (gridH - 27) / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const heat = (x + y) / (cols + rows);
      ctx.fillStyle = heat > .57 ? C.purpleSoft : heat > .3 ? C.cyanSoft : '#e9eef4';
      ctx.fillRect(left + 12 + x * cw, top + 12 + y * ch, cw - 1, ch - 1);
    }
    mono(ctx, `${resolution}×${resolution} frame → ${tokensFrame.toLocaleString()} tokens`, left + gridW / 2, top + gridH - 8, C.mute, 8, 'center');
    const rx = left + gridW + 22, rw = w - rx - 18;
    const stages = [
      ['per frame', tokensFrame],
      [`× ${fps} fps`, tokensFrame * fps],
      [`× ${horizon}s horizon`, tokens],
      ['dense attention pairs', attention]
    ];
    stages.forEach((s, i) => {
      const y = 40 + i * 45;
      roundRect(ctx, rx, y, rw, 34, 7, i === 3 ? C.redSoft : C.panel, C.grid);
      label(ctx, s[0], rx + 9, y + 12, C.mute, 9);
      mono(ctx, compact(s[1]), rx + rw - 9, y + 22, i === 3 ? C.red : C.purple, 11, 'right');
      if (i < 3) arrow(ctx, rx + rw / 2, y + 35, rx + rw / 2, y + 44, C.dim, 1);
    });
    metric(widget, 'tokens', compact(tokens)); metric(widget, 'attention', compact(attention));
    metric(widget, 'pressure', tokens > 1e6 ? 'extreme' : tokens > 2e5 ? 'high' : 'manageable');
    metric(widget, 'response', tokens > 4e5 ? 'compress / factorize' : 'train dense');
  }

  function compact(n) {
    if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(Math.round(n));
  }

  // Lesson 13: autoregressive playable rollout — a latent action steers; memory sets the consistency horizon.
  function renderInteractive(widget, canvas) {
    const { ctx, w, h } = setup(canvas);
    const action = value(widget, 'action', 'forward');
    const memory = value(widget, 'memory', 8);
    const consistency = 1 - Math.exp(-memory / 6);       // object persistence, saturating in memory
    const horizon = Math.round(consistency * 20);         // playable steps before drift / forgetting
    mono(ctx, 'AUTOREGRESSIVE PLAYABLE ROLLOUT · one frame per action', 15, 14, C.mute, 9);
    const panels = 5, pad = 16, gap = 8;
    const pw = (w - pad * 2 - gap * (panels - 1)) / panels, ph = h - 74, top = 30;
    const dir = action === 'turnL' ? -1 : action === 'turnR' ? 1 : 0;
    for (let i = 0; i < panels; i++) {
      const x = pad + i * (pw + gap);
      roundRect(ctx, x, top, pw, ph, 7, '#eef2f7', C.grid);
      line(ctx, x, top + ph * .5, x + pw, top + ph * .5, '#c8d0da', 1);   // ground/horizon line
      // the latent action sets landmark motion: turns pan it out of frame, forward approaches, wait holds
      let lx = x + pw * 0.5, ly = top + ph * 0.42, r = 7;
      if (action === 'forward') { ly = top + ph * (0.30 + i * 0.09); r = 5 + i * 1.3; }
      else if (action === 'wait') { lx = x + pw * 0.64; }
      else { lx = x + pw * 0.5 + dir * (i - 1.5) * pw * 0.30; }
      const inView = lx > x + 8 && lx < x + pw - 8 && ly < top + ph - 10;
      if (inView) { dot(ctx, lx, ly, r, C.green); mono(ctx, 'landmark', lx, ly + r + 8, C.green, 7, 'center'); }
      else if (consistency > 0.5) { const ex = lx <= x + pw * .5 ? x + 5 : x + pw - 5; dot(ctx, ex, top + ph * .42, 4, C.purpleSoft, C.purple); mono(ctx, 'remembered', x + pw * .5, top + 14, C.purple, 7, 'center'); }
      else { mono(ctx, 'forgotten', x + pw * .5, top + ph * .42, C.red, 8, 'center'); }
      roundRect(ctx, x + pw * .5 - 6, top + ph - 20, 12, 14, 3, C.purple, null);   // avatar / "you"
      mono(ctx, `t+${i}`, x + 7, top + 12, C.mute, 8);
      if (i > 0) arrow(ctx, x - gap + 1, top + ph / 2, x - 2, top + ph / 2, C.purple, 1.2);
    }
    label(ctx, action === 'turnL' ? 'action: turn left' : action === 'turnR' ? 'action: turn right' : action === 'forward' ? 'action: move forward' : 'action: wait', w / 2, h - 12, C.purple, 11, 'center', 650);
    metric(widget, 'control', action === 'turnL' ? 'turn left' : action === 'turnR' ? 'turn right' : action);
    metric(widget, 'consistency', `${(consistency * 100).toFixed(0)}%`);
    metric(widget, 'memory', `${memory} frames`);
    metric(widget, 'horizon', `${horizon} steps`);
  }

  const renderers = {
    loop: renderLoop, belief: renderBelief, bottleneck: renderBottleneck,
    dynamics: renderDynamics, uncertainty: renderUncertainty, causality: renderCausality,
    architectures: renderArchitectures, imagination: renderImagination, planning: renderPlanning,
    spatial: renderSpatial, geometry: renderGeometry, simulator: renderSimulator, multimodal: renderMultimodal,
    scaling: renderScaling, evaluation: renderEvaluation, interactive: renderInteractive
  };

  function initWidget(widget) {
    const canvas = widget.querySelector('canvas[data-world-demo]');
    if (!canvas) return;
    const fn = renderers[canvas.dataset.worldDemo];
    if (!fn) return;
    const draw = () => { syncValues(widget); fn(widget, canvas); };
    widget.addEventListener('input', draw);
    widget.addEventListener('change', draw);
    widget.addEventListener('click', event => {
      const button = event.target.closest('[data-set-role]');
      if (!button) return;
      const el = control(widget, button.dataset.setRole);
      if (el) { el.value = button.dataset.setValue; draw(); }
    });
    if ('ResizeObserver' in window) new ResizeObserver(draw).observe(canvas);
    else window.addEventListener('resize', draw);
    draw();
  }

  document.querySelectorAll('.widget').forEach(initWidget);
})();
