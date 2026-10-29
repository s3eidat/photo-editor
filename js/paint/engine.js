/* Photo Editor paint lane: the brush engine. One stroke pipeline drives every painting tool:
   tip (round, or sampled from an image), spacing, smoothing, pen pressure / tilt / rotation, shape dynamics,
   scattering, colour dynamics, transfer, texture, dual tip, build-up and symmetry.
   "Paint" tools stamp dabs into a stroke buffer that is composited once with the tool's opacity (brush, pencil,
   eraser, clone, healing, pattern stamp, history brush). Tools that change the pixels under the tip instead
   (blur, smudge, dodge…) plug in through spec.begin / spec.stamp / spec.preview / spec.commit.
   Undo goes through the core: only the changed 64 px tiles are kept. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX, RAD = Math.PI / 180;

  // ---------- brush settings (every engine tool keeps its own copy in ED.o[tool]) ----------
  var BDEF = PP.BDEF = {
    size: 30, hard: 0.8, op: 1, flow: 1, spacing: 12, angle: 0, round: 100, tip: "", flipX: false, smooth: 0,
    sizeJ: 0, sizeC: "pressure", sizeMin: 0, fade: 25, angleJ: 0, angleC: "off", roundJ: 0, roundC: "off", roundMin: 25,
    scatter: 0, scatterBoth: false, count: 1, countJ: 0,
    fgbgJ: 0, fgbgC: "off", hueJ: 0, satJ: 0, briJ: 0, purity: 0, perTip: true,
    opJ: 0, opC: "off", flowJ: 0, flowC: "off",
    tex: "", texDepth: 60, texScale: 100, texInvert: false, texEach: false,
    dual: "", dualSize: 20, dualSpacing: 30, dualScatter: 0, dualCount: 1,
    buildup: false, sym: "off", symN: 6, symX: 50, symY: 50
  };
  PP.DYN_KEYS = Object.keys(BDEF).filter(function (k) { return ["size", "hard", "op"].indexOf(k) < 0; });
  var SPEC = PP.spec = {};
  // Make `id` an engine tool. spec: {label, fill: "color"|"erase"|"clone"|"pattern"|"history", pencil, sym, mask (allowed on masks),
  // pixels (needs layer pixels), defs (extra option defaults), begin(st, p, e) -> false aborts, stamp, preview, commit}
  PP.engineTool = function (id, spec, defs) {
    SPEC[id] = spec; spec.defs = defs || null;
    if (["brush", "eraser", "clone", "heal"].indexOf(id) < 0 && !spec.noCursor) PP.cursors[id] = "none";
    PP.opts(id, Object.assign({}, BDEF, defs || {}));
    ED.TOOLS[id] = { down: strokeStart, move: strokeMove, up: strokeEnd };
  };
  PP.resetForTest.push(function () {      // deterministic strokes while the self-test runs
    var keep = {};
    Object.keys(SPEC).forEach(function (id) { var o = ED.o[id]; keep[id] = Object.assign({}, o); PP.DYN_KEYS.forEach(function (k) { if (k in BDEF) o[k] = BDEF[k]; }); if (SPEC[id].defs) Object.assign(o, SPEC[id].defs); });
    return function () { Object.keys(keep).forEach(function (id) { var o = ED.o[id]; Object.keys(o).forEach(function (k) { delete o[k]; }); Object.assign(o, keep[id]); }); };
  });

  // ---------- sampled tips (alpha masks) ----------
  PP.tips = PP.tips || {};       // id -> {id, name, canvas (white, alpha = paint), w, h}
  PP.tipOf = function (id) { return id && PP.tips[id] ? PP.tips[id] : null; };

  // ---------- pen input ----------
  function inputOf(e) {
    var pen = !!(e && e.pointerType === "pen");
    var tx = pen ? +e.tiltX || 0 : 0, ty = pen ? +e.tiltY || 0 : 0;
    return { pr: pen ? PE.clamp(+e.pressure || 0, 0, 1) : 1, tilt: PE.clamp(Math.hypot(tx, ty) / 90, 0, 1), tiltA: tx || ty ? Math.atan2(ty, tx) / RAD : 0, twist: pen ? +e.twist || 0 : 0, pen: pen };
  }
  PP.inputOf = inputOf;
  function mixIn(a, b, t) { return { pr: a.pr + (b.pr - a.pr) * t, tilt: a.tilt + (b.tilt - a.tilt) * t, tiltA: b.tiltA, twist: b.twist, pen: b.pen }; }

  // ---------- stroke ----------
  // Stroke buffers are kept between strokes: a fresh layer-sized canvas costs a lot on its first draw.
  var POOL = {};
  function pooled(key, w, h) {
    var c = POOL[key];
    if (!c || c.width !== w || c.height !== h) c = POOL[key] = PE.mk(w, h);
    else { var x = PE.cx2(c); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, w, h); }
    return c;
  }
  function strokeStart(p, e) {
    var tool = ED.tool, spec = SPEC[tool], o = ED.o[tool];
    if ((tool === "brush" || tool === "pencil") && e.altKey) { ED.pick(p, false); return; }
    var L = ED.layer();
    if (!L) { S3.toast("Add a layer first", "error"); return; }
    if ((tool === "clone" || tool === "heal") && (e.altKey || !ED.cloneSrc)) {
      if (e.altKey) { ED.cloneSrc = { x: p.x, y: p.y }; ED.cloneOff = null; S3.toast("Source set. Now paint where you want to copy it."); ED.renderOvl(); }
      else S3.toast("Alt+click (or long-press with Alt on) a clean area first to set the source", "error");
      return;
    }
    if (spec.mask === false && ED.maskEdit && L.mask) { S3.toast(spec.label + " works on layer pixels: click the layer thumbnail (not the mask) first", "error"); return; }
    var t = PP.target(); if (!t) return;
    var cv = t.holder.canvas;
    var st = ED.stroke = { L: t.L, mask: t.mask, holder: t.holder, tool: tool, spec: spec, o: Object.assign({}, o), ox: t.holder.x, oy: t.holder.y,
      bbox: null, grow: t.grow, last: null, n: 0, dir: null, dir0: null, R: Math.random, inp: inputOf(e), w: cv.width, h: cv.height };
    st.tip = PP.tipOf(st.o.tip); st.pencil = !!(spec.pencil || (tool === "eraser" && st.o.mode === "pencil"));
    st.fg = PE.rgbOf(ED.doc.fg); st.bgc = PE.rgbOf(ED.doc.bg);
    st.maskV = PP.lum(st.fg) / 255;
    if (!st.o.perTip) st.color = dabColor(st, st.inp);
    if (st.o.sym !== "off" && spec.sym !== false) st.sym = symSetup(st);
    if (st.o.tex && PP.patternOf && PP.patternOf(st.o.tex)) st.tex = texSetup(st);
    if (!spec.process) {
      st.buf = pooled("buf", cv.width, cv.height); st.bctx = PE.cx2(st.buf);
      if (spec.preview) st.live = PE.mk(cv.width, cv.height); else initTiles(st, false);     // preview straight into the layer
      if (st.o.dual) { st.dualBuf = pooled("dual", cv.width, cv.height); st.dctx = PE.cx2(st.dualBuf); st.dualTip = st.o.dual === "round" ? null : PP.tipOf(st.o.dual); }
    }
    if (tool === "clone" || tool === "heal") {
      st.src = PE.cloneCanvas(cv);
      if (!o.aligned || !ED.cloneOff) ED.cloneOff = { x: ED.cloneSrc.x - p.x, y: ED.cloneSrc.y - p.y };
      st.off = ED.cloneOff; st.srcOff = st.off;
    }
    if (spec.begin && spec.begin(st, p, e) === false) { ED.stroke = null; ED.push(st.grow); return; }
    ED.drag = { kind: "stroke", cancel: function () { if (st.timer) clearInterval(st.timer); if (spec.cancel) spec.cancel(st); else if (st.orig) restoreRect(st, st.bbox); } };
    var lp = { x: p.x - st.ox, y: p.y - st.oy };
    if (e.shiftKey && ED.lastPt && ED.lastPt.L === st.L) { st.last = { x: ED.lastPt.x - st.ox, y: ED.lastPt.y - st.oy }; segment(st, lp, st.inp); }
    else { dab(st, lp.x, lp.y, st.inp); st.last = lp; }
    st.sp = lp; st.raw = lp;
    if (st.o.buildup && !spec.noBuildup) st.timer = setInterval(function () { if (ED.stroke !== st) { clearInterval(st.timer); return; } if (Date.now() - (st.t || 0) > 70) { dab(st, st.last.x, st.last.y, st.inp); preview(); } }, 70);
    preview();
  }
  function strokeMove(p, e) {
    var st = ED.stroke; if (!st) return;
    var inp = inputOf(e), lp = { x: p.x - st.ox, y: p.y - st.oy };
    st.raw = lp;
    if (st.o.smooth > 0) {         // pulled string: the brush follows the pointer at a distance
      var R = st.o.smooth / 100 * 60 / ED.zoom, d = Math.hypot(lp.x - st.sp.x, lp.y - st.sp.y);
      if (d <= R) { st.inp = inp; return; }
      st.sp = { x: st.sp.x + (lp.x - st.sp.x) * (d - R) / d, y: st.sp.y + (lp.y - st.sp.y) * (d - R) / d };
      lp = st.sp;
    }
    segment(st, lp, inp);
    preview();
  }
  PP.strokeMove = strokeMove;
  // Lay dabs from the last dab towards b, one spacing apart.
  function segment(st, b, inp) {
    var a = st.last, i0 = st.inp, dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
    if (dist < 1e-6) { st.inp = inp; return; }
    var ux = dx / dist, uy = dy / dist, done = 0;
    st.dir = Math.atan2(dy, dx) / RAD; if (st.dir0 == null) st.dir0 = st.dir;
    for (var guard = 0; guard < 100000; guard++) {
      var step = Math.max(0.5, Math.max(1, st.o.size * (st.lastF || 1)) * PE.clamp(st.o.spacing, 1, 1000) / 100);
      if (st.pencil) step = Math.max(1, step);
      if (done + step > dist + 1e-9) break;
      done += step;
      var q = { x: a.x + ux * done, y: a.y + uy * done };
      dab(st, q.x, q.y, mixIn(i0, inp, done / dist));
      st.last = q;
    }
    st.inp = inp;
  }
  function ctl(kind, inp, st) {
    if (kind === "pressure") return inp.pr;
    if (kind === "tilt") return inp.tilt;
    if (kind === "fade") return Math.max(0, 1 - st.n / Math.max(1, st.o.fade));
    return 1;
  }
  // One dab with dynamics at holder-local (x, y).
  function dab(st, x, y, inp) {
    var o = st.o, R = st.R, f = 1;
    st.n++; st.t = Date.now();
    if (o.sizeC !== "off") f = o.sizeMin / 100 + (1 - o.sizeMin / 100) * ctl(o.sizeC, inp, st);
    if (o.sizeJ) f *= 1 - o.sizeJ / 100 * R();
    st.lastF = Math.max(0.02, f);
    var d = Math.max(st.pencil ? 1 : 0.6, o.size * f);
    var ang = o.angle;
    if (o.angleC === "direction") ang += st.dir || 0; else if (o.angleC === "tilt") ang += inp.tiltA; else if (o.angleC === "rotation") ang += inp.twist; else if (o.angleC === "initial") ang += st.dir0 || 0;
    if (o.angleJ) ang += (R() * 2 - 1) * o.angleJ / 100 * 180;
    var rnd = PE.clamp(o.round, 1, 100) / 100, rmin = o.roundMin / 100;
    if (o.roundC !== "off") rnd *= rmin + (1 - rmin) * ctl(o.roundC, inp, st);
    if (o.roundJ) rnd *= Math.max(rmin, 1 - o.roundJ / 100 * R());
    var a = PE.clamp(o.flow, 0, 1);
    if (o.flowC !== "off") a *= ctl(o.flowC, inp, st);
    if (o.flowJ) a *= 1 - o.flowJ / 100 * R();
    if (o.opC !== "off") a *= ctl(o.opC, inp, st);
    if (o.opJ) a *= 1 - o.opJ / 100 * R();
    var count = Math.max(1, Math.round(o.count * (1 - o.countJ / 100 * R())));
    var dir = (st.dir || 0) * RAD, nx = -Math.sin(dir), ny = Math.cos(dir);
    for (var k = 0; k < count; k++) {
      var px = x, py = y;
      if (o.scatter) {
        var s = o.scatter / 100 * d, u = (R() * 2 - 1) * s;
        if (o.scatterBoth) { px += (R() * 2 - 1) * s; py += u; } else { px += nx * u; py += ny * u; }
      }
      var col = st.mask ? [255, 255, 255] : o.perTip ? dabColor(st, inp) : st.color;
      if (st.sym) st.sym(px, py, ang, function (sx, sy, sa, flip) { stampAll(st, sx, sy, d, sa, rnd, flip !== !!o.flipX, col, a, inp); });
      else stampAll(st, px, py, d, ang, rnd, !!o.flipX, col, a, inp);
    }
  }
  PP.dab = dab;
  function stampAll(st, x, y, d, ang, rnd, flip, col, a, inp) {
    if (st.spec.stamp) st.spec.stamp(st, x, y, d, ang, rnd, flip, col, a, inp); else stamp(st, x, y, d, ang, rnd, flip, col, a);
    if (st.dualBuf) dualStamp(st, x, y, d);
  }
  // Colour dynamics: foreground/background mix, hue / saturation / brightness jitter, purity.
  function dabColor(st, inp) {
    var o = st.o, R = st.R, c = st.fg;
    if (o.fgbgJ || o.fgbgC !== "off") {
      var t = (o.fgbgC === "pressure" ? 1 - inp.pr : o.fgbgC === "fade" ? 1 - ctl("fade", inp, st) : 0);
      t = PE.clamp(t + o.fgbgJ / 100 * R(), 0, 1);
      c = [c[0] + (st.bgc[0] - c[0]) * t, c[1] + (st.bgc[1] - c[1]) * t, c[2] + (st.bgc[2] - c[2]) * t];
    }
    if (o.hueJ || o.satJ || o.briJ || o.purity) {
      var hsb = PPX.rgb2hsb(c[0], c[1], c[2]);
      if (o.hueJ) hsb[0] += (R() * 2 - 1) * o.hueJ / 100 * 180;
      if (o.satJ) hsb[1] += (R() * 2 - 1) * o.satJ;
      if (o.briJ) hsb[2] += (R() * 2 - 1) * o.briJ;
      if (o.purity) hsb[1] = o.purity > 0 ? hsb[1] + (100 - hsb[1]) * o.purity / 100 : hsb[1] * (1 + o.purity / 100);
      c = PPX.hsb2rgb(hsb[0], hsb[1], hsb[2]);
    }
    return c;
  }
  PP.dabColor = dabColor;

  // ---------- symmetry ----------
  function symSetup(st) {
    var o = st.o, cx = ED.doc.w * PE.clamp(o.symX, 0, 100) / 100 - st.ox, cy = ED.doc.h * PE.clamp(o.symY, 0, 100) / 100 - st.oy, n = Math.max(2, Math.min(32, Math.round(o.symN) || 6));
    return function (x, y, a, emit) {
      var dx = x - cx, dy = y - cy;
      emit(x, y, a, false);
      if (o.sym === "v" || o.sym === "vh") emit(cx - dx, y, -a, true);
      if (o.sym === "h" || o.sym === "vh") emit(x, cy - dy, 180 - a, true);
      if (o.sym === "vh") emit(cx - dx, cy - dy, a + 180, false);
      if (o.sym === "diag") emit(cx + dy, cy + dx, 90 - a, true);
      if (o.sym === "radial" || o.sym === "mandala") {
        for (var k = 1; k < n; k++) { var t = k * 2 * Math.PI / n, c = Math.cos(t), s = Math.sin(t); emit(cx + dx * c - dy * s, cy + dx * s + dy * c, a + k * 360 / n, false); }
        if (o.sym === "mandala") for (k = 0; k < n; k++) { var t2 = k * 2 * Math.PI / n, c2 = Math.cos(t2), s2 = Math.sin(t2), mx = -dx; emit(cx + mx * c2 - dy * s2, cy + mx * s2 + dy * c2, -a + k * 360 / n, true); }
      }
    };
  }
  PP.symSetup = symSetup;

  // ---------- stamping (paint family) ----------
  var dabC = null, dabX = null;
  function dabCanvas(s) {
    if (!dabC || dabC.width < s || dabC.height < s) { dabC = PE.mk(Math.max(s, dabC ? dabC.width : 0), Math.max(s, dabC ? dabC.height : 0)); dabX = PE.cx2(dabC); }
    dabX.setTransform(1, 0, 0, 1, 0, 0); dabX.globalAlpha = 1; dabX.globalCompositeOperation = "source-over"; dabX.clearRect(0, 0, s, s);
    return dabX;
  }
  // Aliased (pencil) tips, cached by size / roundness / angle / flip.
  var PCACHE = new Map();
  function pencilTip(st, d, rnd, ang, flip) {
    var tip = st.tip, key = (tip ? tip.id : "r") + "|" + Math.round(d) + "|" + Math.round(rnd * 100) + "|" + Math.round(ang) + "|" + (flip ? 1 : 0);
    var hit = PCACHE.get(key); if (hit) return hit;
    var D = Math.max(1, Math.round(d)), n = tip ? Math.ceil(D * 1.42) + 2 : D, c = PE.mk(n, n), x = PE.cx2(c), im;
    if (tip) {
      x.translate(n / 2, n / 2); x.rotate(ang * RAD); x.scale(flip ? -1 : 1, rnd);
      var k = D / Math.max(tip.w, tip.h); x.drawImage(tip.canvas, -tip.w * k / 2, -tip.h * k / 2, tip.w * k, tip.h * k);
      im = x.getImageData(0, 0, n, n);
      for (var i = 3; i < im.data.length; i += 4) im.data[i] = im.data[i] >= 128 ? 255 : 0;
    } else {
      im = x.createImageData(n, n);
      var r = D / 2, ca = Math.cos(-ang * RAD), sa = Math.sin(-ang * RAD), ry = Math.max(0.5, r * rnd);
      for (var yy = 0; yy < n; yy++) for (var xx = 0; xx < n; xx++) {
        var ux = xx + 0.5 - n / 2, uy = yy + 0.5 - n / 2, vx = ux * ca - uy * sa, vy = ux * sa + uy * ca;
        if (D <= 1 || (vx * vx) / (r * r) + (vy * vy) / (ry * ry) <= 1.0001) { var q = (yy * n + xx) * 4; im.data[q] = im.data[q + 1] = im.data[q + 2] = 255; im.data[q + 3] = 255; }
      }
    }
    x.setTransform(1, 0, 0, 1, 0, 0); x.putImageData(im, 0, 0);
    if (PCACHE.size > 48) PCACHE.delete(PCACHE.keys().next().value);
    PCACHE.set(key, c);
    return c;
  }
  // Draw the tip's alpha into the dab canvas centred at (cx, cy) of a s x s square.
  function tipAlpha(dc, st, cx, cy, d, ang, rnd, flip, hard) {
    dc.translate(cx, cy); if (ang) dc.rotate(ang * RAD); dc.scale(flip ? -1 : 1, rnd);
    var tip = st.tip;
    if (tip) { var k = d / Math.max(tip.w, tip.h); dc.imageSmoothingEnabled = true; dc.imageSmoothingQuality = "high"; dc.drawImage(tip.canvas, -tip.w * k / 2, -tip.h * k / 2, tip.w * k, tip.h * k); }
    else ED.tipFill(dc, 0, 0, d / 2, hard, "#000000");
    dc.setTransform(1, 0, 0, 1, 0, 0);
  }
  // Render a full dab (tip shape filled with the tool's source) into the dab canvas; returns its placement.
  function renderDab(st, x, y, d, ang, rnd, flip, col) {
    var s, ix, iy, dc;
    if (st.pencil) {
      var T = pencilTip(st, d, rnd, ang, flip); s = T.width;
      ix = Math.round(x - s / 2); iy = Math.round(y - s / 2);
      dc = dabCanvas(s); dc.drawImage(T, 0, 0);
    } else {
      s = Math.ceil(d * (st.tip ? 1.42 : 1)) + 3; ix = Math.floor(x - s / 2); iy = Math.floor(y - s / 2);
      dc = dabCanvas(s); tipAlpha(dc, st, x - ix, y - iy, d, ang, rnd, flip, st.o.hard);
    }
    dc.globalCompositeOperation = "source-in";
    var fill = st.spec.fill;
    if (fill === "clone" || fill === "history") dc.drawImage(st.src, -(ix + st.srcOff.x), -(iy + st.srcOff.y));
    else if (fill === "pattern" && st.pat) { st.pat.setTransform(new DOMMatrix([st.patK, 0, 0, st.patK, -(ix + st.ox - st.patX), -(iy + st.oy - st.patY)])); dc.fillStyle = st.pat; dc.fillRect(0, 0, s, s); }
    else { dc.fillStyle = PP.rgba(col, 1); dc.fillRect(0, 0, s, s); }
    if (st.tex && st.o.texEach) { dc.globalCompositeOperation = "destination-out"; dc.globalAlpha = st.tex.depth; st.tex.pat.setTransform(new DOMMatrix([st.tex.k, 0, 0, st.tex.k, -(ix + st.ox), -(iy + st.oy)])); dc.fillStyle = st.tex.pat; dc.fillRect(0, 0, s, s); dc.globalAlpha = 1; }
    dc.globalCompositeOperation = "source-over";
    return { s: s, x: ix, y: iy, c: dabC };
  }
  PP.renderDab = renderDab;
  function stamp(st, x, y, d, ang, rnd, flip, col, a) {
    var c = st.bctx, b;
    if (!st.tip && !st.pencil && !(st.tex && st.o.texEach) && (st.spec.fill === "color" || st.spec.fill === "erase")) {
      var r = Math.max(0.5, d / 2);
      c.save(); c.globalAlpha = a; c.translate(x, y); if (ang) c.rotate(ang * RAD); if (rnd < 1) c.scale(1, rnd);
      ED.tipFill(c, 0, 0, r, st.o.hard, PE.toHex(col[0], col[1], col[2])); c.restore();
      b = { x: x - r - 1, y: y - r - 1, w: 2 * r + 2, h: 2 * r + 2 };
    } else {
      var D = renderDab(st, x, y, d, ang, rnd, flip, col);
      c.save(); c.globalAlpha = a; c.drawImage(D.c, 0, 0, D.s, D.s, D.x, D.y, D.s, D.s); c.restore();
      b = { x: D.x, y: D.y, w: D.s, h: D.s };
    }
    clipSel(st, c, b);
    st.bbox = PE.union(st.bbox, b); st.dirty = PE.union(st.dirty, b);
  }
  PP.stamp = stamp;
  function clipSel(st, c, b) {
    if (st.noSel || !ED.doc || !ED.doc.sel) return;      // keep paint inside the selection
    c.save(); c.beginPath(); c.rect(b.x, b.y, b.w, b.h); c.clip(); c.globalCompositeOperation = "destination-in";
    c.drawImage(PE.selCanvas(ED.doc.sel), -st.ox, -st.oy); c.restore();
  }
  PP.clipSel = clipSel;
  function dualStamp(st, x, y, d) {
    var o = st.o, R = st.R, n = Math.max(1, Math.round(o.dualCount)), c = st.dctx, ds = Math.max(1, o.dualSize * d / 100);
    for (var k = 0; k < n; k++) {
      var px = x + (R() * 2 - 1) * o.dualScatter / 100 * d, py = y + (R() * 2 - 1) * o.dualScatter / 100 * d;
      c.save(); c.translate(px, py); c.rotate(R() * Math.PI * 2);
      if (st.dualTip) { var t = st.dualTip, kk = ds / Math.max(t.w, t.h); c.drawImage(t.canvas, -t.w * kk / 2, -t.h * kk / 2, t.w * kk, t.h * kk); }
      else ED.tipFill(c, 0, 0, ds / 2, 0.9, "#000000");
      c.restore();
    }
  }
  // Texture over a whole stroke image: the pattern's dark parts take paint away (by depth). (dx, dy) = doc position of the image.
  PP.texStroke = function (c, tex, dx, dy, w, hh) {
    c.save(); c.globalCompositeOperation = "destination-out"; c.globalAlpha = tex.depth;
    tex.pat.setTransform(new DOMMatrix([tex.k, 0, 0, tex.k, -dx, -dy])); c.fillStyle = tex.pat; c.fillRect(0, 0, w, hh); c.restore();
  };
  function texSetup(st) {
    var P = PP.patternOf(st.o.tex), m = PP.texMask(P, st.o.texInvert);
    return { pat: st.bctx ? st.bctx.createPattern(m, "repeat") : PE.cx2(PE.mk(1, 1)).createPattern(m, "repeat"), k: PE.clamp(st.o.texScale, 1, 1000) / 100, depth: PE.clamp(st.o.texDepth, 0, 100) / 100, mask: m };
  }

  // ---------- original pixels, read lazily in 128 px tiles (paint and process tools preview into the layer) ----------
  var LT = 128;
  function initTiles(st, keepOrig) {
    var W = st.w, H = st.h;
    st.cv = st.holder.canvas; st.cx = PE.cx2(st.cv); st.dirty = null;
    st.img = new ImageData(W, H); st.orig = keepOrig ? new ImageData(W, H) : st.img;
    st.ltx = Math.ceil(W / LT); st.loaded = new Uint8Array(st.ltx * Math.ceil(H / LT));
  }
  function ensureTiles(st, R) {
    var tx0 = Math.max(0, Math.floor(R.x / LT)), ty0 = Math.max(0, Math.floor(R.y / LT)), tx1 = Math.min(st.ltx - 1, Math.floor((R.x + R.w - 1) / LT)), ty1 = Math.min(Math.ceil(st.h / LT) - 1, Math.floor((R.y + R.h - 1) / LT));
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) {
      var k = ty * st.ltx + tx; if (st.loaded[k]) continue;
      st.loaded[k] = 1;
      var x = tx * LT, y = ty * LT, w = Math.min(LT, st.w - x), h = Math.min(LT, st.h - y), t = st.cx.getImageData(x, y, w, h).data;
      for (var j = 0; j < h; j++) {
        var row = t.subarray(j * w * 4, (j + 1) * w * 4), at = ((y + j) * st.w + x) * 4;
        st.img.data.set(row, at); if (st.orig !== st.img) st.orig.data.set(row, at);
      }
    }
  }
  function regionOf(img, R) {      // copy of rect R of a full-size ImageData
    var out = new ImageData(R.w, R.h), W = img.width;
    for (var j = 0; j < R.h; j++) out.data.set(img.data.subarray(((R.y + j) * W + R.x) * 4, ((R.y + j) * W + R.x + R.w) * 4), j * R.w * 4);
    return out;
  }
  function clipR(st, r) { return r && PE.inter(PE.rectI(r), { x: 0, y: 0, w: st.w, h: st.h }); }
  function restoreRect(st, r) { var R = clipR(st, r); if (!R) return; ensureTiles(st, R); st.cx.putImageData(st.orig, 0, 0, R.x, R.y, R.w, R.h); PE.touch(st.cv); ED.render(); }
  Object.assign(PP, { initTiles: initTiles, ensureTiles: ensureTiles, regionOf: regionOf, clipR: clipR, restoreRect: restoreRect });

  // ---------- compositing the stroke ----------
  var scratch = null;
  // The stroke as an image over rect R (default: its bounding box), with the dual tip and texture applied.
  function strokeImage(st, R) {
    if (!st.dualBuf && !(st.tex && !st.o.texEach)) return R ? { img: st.buf, sx: R.x, sy: R.y, x: R.x, y: R.y, w: R.w, h: R.h } : { img: st.buf, x: 0, y: 0 };
    var bb = R || PE.inter(PE.rectI(st.bbox || { x: 0, y: 0, w: 1, h: 1 }), { x: 0, y: 0, w: st.w, h: st.h }) || { x: 0, y: 0, w: 1, h: 1 };
    if (!scratch || scratch.width < bb.w || scratch.height < bb.h) scratch = PE.mk(Math.max(bb.w, scratch ? scratch.width : 0), Math.max(bb.h, scratch ? scratch.height : 0));
    var c = PE.cx2(scratch); c.globalCompositeOperation = "copy"; c.drawImage(st.buf, bb.x, bb.y, bb.w, bb.h, 0, 0, bb.w, bb.h);
    if (st.dualBuf) { c.globalCompositeOperation = "destination-in"; c.drawImage(st.dualBuf, bb.x, bb.y, bb.w, bb.h, 0, 0, bb.w, bb.h); }
    if (st.tex && !st.o.texEach) PP.texStroke(c, st.tex, bb.x + st.ox, bb.y + st.oy, bb.w, bb.h);
    c.globalCompositeOperation = "source-over";
    return { img: scratch, x: bb.x, y: bb.y, w: bb.w, h: bb.h };
  }
  function drawImg(c, I) { if (I.w) c.drawImage(I.img, I.sx || 0, I.sy || 0, I.w, I.h, I.x, I.y, I.w, I.h); else c.drawImage(I.img, 0, 0); }
  function applyStroke(c, st, R) {
    var I = strokeImage(st, R), op = PE.clamp(st.o.op, 0, 1);
    c.save();
    if (st.mask && st.spec.fill !== "erase") {
      // masks move towards the foreground's brightness: m' = m (1 - a) + v a
      c.globalAlpha = op; c.globalCompositeOperation = "destination-out"; drawImg(c, I);
      c.globalAlpha = op * st.maskV; c.globalCompositeOperation = "lighter"; drawImg(c, I);
    } else {
      c.globalAlpha = op; c.globalCompositeOperation = st.spec.fill === "erase" ? "destination-out" : "source-over"; drawImg(c, I);
    }
    c.restore();
  }
  PP.applyStroke = applyStroke;
  var pvRaf = 0;
  function preview() {
    if (pvRaf) return;
    pvRaf = requestAnimationFrame(function () {
      pvRaf = 0; var st = ED.stroke; if (!st) return;
      var o;
      if (st.spec.preview) o = st.spec.preview(st); else flush(st);
      if (o) { if (st.mask) ED.live.maskOver[st.L.id] = o; else ED.live.over[st.L.id] = o; }
      ED.render();
    });
  }
  PP.preview = preview;
  // Write the changed rectangle: the original pixels, then the stroke over them.
  function flush(st) {
    var R = clipR(st, st.dirty); st.dirty = null; if (!R) return;
    ensureTiles(st, R); st.cx.putImageData(st.orig, 0, 0, R.x, R.y, R.w, R.h);
    applyStroke(st.cx, st, R); PE.touch(st.cv);
  }
  function strokeEnd(p) {
    var st = ED.stroke; ED.drag = null; if (!st) return;
    if (st.timer) clearInterval(st.timer);
    if (st.o.smooth > 0 && st.raw) segment(st, st.raw, st.inp);       // catch up with the pointer
    ED.lastPt = { x: st.last.x + st.ox, y: st.last.y + st.oy, L: st.L };
    var label = st.spec.label + (st.mask ? " (mask)" : "");
    if (st.spec.commit) { st.spec.commit(st, label); return; }
    var bb = st.bbox && PE.inter(PE.rectI(st.bbox), { x: 0, y: 0, w: st.w, h: st.h });
    if (!bb) { ED.stroke = null; ED.push(st.grow); ED.changed(); return; }
    if (st.tool !== "heal") {
      flush(st); ensureTiles(st, bb);
      var e1 = PE.tileEntry(label, st.cv, bb, regionOf(st.orig, bb));
      ED.stroke = null; ED.push(PE.compound(label, [st.grow, e1])); return;
    }
    restoreRect(st, bb);      // the preview goes; the healed pixels replace it
    // healing: texture from the source, colour / brightness matched to the surroundings (worker)
    var pad = 6, R = PE.inter({ x: bb.x - pad, y: bb.y - pad, w: bb.w + 2 * pad, h: bb.h + 2 * pad }, { x: 0, y: 0, w: st.w, h: st.h });
    var cv = st.holder.canvas, dst = PE.getData(cv, R), srcC = PE.mk(R.w, R.h);
    PE.cx2(srcC).drawImage(st.src, -(R.x + st.off.x), -(R.y + st.off.y));
    var I = strokeImage(st), mc = PE.mk(R.w, R.h); PE.cx2(mc).drawImage(I.img, I.w ? I.x - R.x : -R.x, I.w ? I.y - R.y : -R.y);
    var src = PE.getData(srcC), md = PE.getData(mc).data, m = new Uint8Array(R.w * R.h), op = PE.clamp(st.o.op, 0, 1);
    for (var i = 0; i < m.length; i++) m[i] = Math.round(md[i * 4 + 3] * op);
    ED.working(PE.work("heal", [{ data: dst.data, width: R.w, height: R.h }, { data: src.data, width: R.w, height: R.h }, m]), "Healing…").then(function (res) {
      var e2 = PE.editPixels(ED.doc, label, st.holder, "canvas", R, function (c) { c.putImageData(new ImageData(new Uint8ClampedArray(res.data), R.w, R.h), R.x, R.y); });
      ED.stroke = null; ED.push(PE.compound(label, [st.grow, e2]));
    }).catch(function (err) { ED.stroke = null; ED.changed(); S3.toast(err.message, "error"); });
  }
  PP.strokeEnd = strokeEnd;
  PP.strokeStart = strokeStart;

  // ---------- the core's painting tools now run on this engine ----------
  PP.engineTool("brush", { label: "Brush", fill: "color" });
  PP.engineTool("eraser", { label: "Eraser", fill: "erase" }, { mode: "brush" });
  PP.engineTool("clone", { label: "Clone stamp", fill: "clone", sym: false }, { aligned: true });
  PP.engineTool("heal", { label: "Healing brush", fill: "clone", sym: false, mask: false, noBuildup: true }, { aligned: true });

  // ---------- overlay: symmetry guides and the tip outline ----------
  PP.overlay(function (c, docPath, cur, dpr) {
    var o = ED.o[ED.tool], spec = SPEC[ED.tool], d = ED.doc;
    if (!d || !spec || !o) return;
    if (o.sym && o.sym !== "off" && spec.sym !== false) docPath(c, function (c, px) {
      var cx = d.w * o.symX / 100, cy = d.h * o.symY / 100, R = Math.hypot(d.w, d.h);
      c.save(); c.setLineDash([6 * px, 5 * px]); c.lineWidth = px; c.strokeStyle = "rgba(27,140,255,.85)"; c.beginPath();
      var lines = o.sym === "v" ? [90] : o.sym === "h" ? [0] : o.sym === "vh" ? [0, 90] : o.sym === "diag" ? [45] : [];
      if (o.sym === "radial" || o.sym === "mandala") { var n = Math.max(2, Math.min(32, Math.round(o.symN) || 6)); for (var k = 0; k < n; k++) lines.push(-90 + k * 360 / n); }
      lines.forEach(function (a) {
        var u = Math.cos(a * RAD), v = Math.sin(a * RAD), half = o.sym === "radial" || o.sym === "mandala";
        c.moveTo(half ? cx : cx - u * R, half ? cy : cy - v * R); c.lineTo(cx + u * R, cy + v * R);
      });
      c.stroke(); c.restore();
    });
    if (cur && !ED.modal && (o.round < 100 || o.angle || o.tip)) {      // non-round tips: show their footprint
      var r = Math.max(1, o.size * ED.zoom / 2);
      c.save(); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.translate(cur.x, cur.y); c.rotate(o.angle * RAD);
      c.beginPath(); c.ellipse(0, 0, r, Math.max(0.5, r * (o.tip ? 1 : o.round / 100)), 0, 0, Math.PI * 2);
      c.setLineDash([3, 3]); c.strokeStyle = "rgba(27,140,255,.9)"; c.lineWidth = 1; c.stroke(); c.restore();
    }
  });
  // Other engine tools (not the core's four) draw their own size circle.
  var CORE = ["brush", "eraser", "clone", "heal"];
  PP.overlay(function (c, docPath, cur, dpr) {
    if (!cur || ED.modal || CORE.indexOf(ED.tool) >= 0 || !SPEC[ED.tool] || SPEC[ED.tool].noCursor) return;
    var o = ED.o[ED.tool], r = Math.max(1, o.size * ED.zoom / 2);
    c.save(); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.beginPath(); c.arc(cur.x, cur.y, r, 0, Math.PI * 2); c.strokeStyle = "rgba(0,0,0,.8)"; c.lineWidth = 1.5; c.stroke();
    c.beginPath(); c.arc(cur.x, cur.y, Math.max(0.5, r - 1.5), 0, Math.PI * 2); c.strokeStyle = "rgba(255,255,255,.9)"; c.lineWidth = 1; c.stroke();
    c.restore();
  });
})();
