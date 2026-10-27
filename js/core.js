/* Photo Editor core: document + layers, compositing, text/shape rendering, history, transforms,
   selections, .s3photo project files (zip + JSON + PNG, validated), IndexedDB autosave, worker bridge.
   No network anywhere: files are read from and written to this device only. */
(function () {
  "use strict";
  var PE = window.PE = window.PE || {}, PIX = window.PIX;
  var LIM = PE.LIM = { side: 8000, px: 40e6, layerSide: 16384, layerPx: 80e6, layers: 100, text: 5000, zip: 1.5e9, entries: 420 };
  var BLENDS = PE.BLENDS = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference"];
  var SHAPES = PE.SHAPES = ["rect", "ellipse", "triangle", "star", "arrow", "line"];

  // ---------- small helpers ----------
  var seq = 0;
  function uid(p) { seq = (seq + 1) % 1e6; return (p || "l") + Date.now().toString(36) + seq.toString(36) + Math.floor(Math.random() * 1296).toString(36); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mk(w, h) { var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function cx2(c) { return c.getContext("2d"); }
  function cloneCanvas(c) { var n = mk(c.width, c.height); cx2(n).drawImage(c, 0, 0); return n; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  var VER = new WeakMap();
  function touch(c) { if (c) VER.set(c, (VER.get(c) || 0) + 1); return c; }
  function ver(c) { return VER.get(c) || 0; }
  function getData(c, r) { r = r || { x: 0, y: 0, w: c.width, h: c.height }; return cx2(c).getImageData(r.x, r.y, r.w, r.h); }
  function rectI(r) { var x = Math.floor(r.x + 1e-6), y = Math.floor(r.y + 1e-6); return { x: x, y: y, w: Math.ceil(r.x + r.w - 1e-6) - x, h: Math.ceil(r.y + r.h - 1e-6) - y }; }
  function inter(a, b) {
    var x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    return x1 > x && y1 > y ? { x: x, y: y, w: x1 - x, h: y1 - y } : null;
  }
  function union(a, b) {
    if (!a) return b; if (!b) return a;
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }
  var HEX = /^#[0-9a-f]{6}$/i;
  function hex(v, d) { return typeof v === "string" && HEX.test(v) ? v.toLowerCase() : d; }
  function rgbOf(h) { h = hex(h, "#000000"); return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function toHex(r, g, b) { return "#" + [r, g, b].map(function (v) { return ("0" + clamp(Math.round(v), 0, 255).toString(16)).slice(-2); }).join(""); }
  function checkSize(w, h, what) {
    if (!(w >= 1 && h >= 1)) throw new Error("Size must be at least 1 × 1 px");
    if (w > LIM.side || h > LIM.side) throw new Error((what || "Image") + " sides are limited to " + LIM.side + " px (asked " + Math.round(w) + " × " + Math.round(h) + ")");
    if (w * h > LIM.px) throw new Error((what || "Image") + " is limited to " + Math.round(LIM.px / 1e6) + " megapixels (asked " + (w * h / 1e6).toFixed(1) + " MP)");
  }

  // ---------- document + layers ----------
  function newDoc(w, h, name) {
    checkSize(w, h, "A document");
    return { id: uid("d"), name: name || "Untitled", w: Math.round(w), h: Math.round(h), layers: [], active: null, sel: null, fg: "#111111", bg: "#ffffff" };
  }
  function newLayer(kind, o) {
    o = o || {};
    var L = { id: uid(), name: o.name || (kind === "text" ? "Text" : kind === "shape" ? "Shape" : "Layer"), kind: kind, visible: o.visible !== false, locked: !!o.locked,
      opacity: o.opacity == null ? 1 : o.opacity, blend: o.blend || "normal", x: o.x || 0, y: o.y || 0, canvas: o.canvas || null,
      mask: o.mask || null, maskOn: o.maskOn !== false, text: null, shape: null };
    if (kind === "raster" && !L.canvas) L.canvas = mk(o.w || 1, o.h || 1);
    if (kind === "text") L.text = Object.assign({ text: "Text", font: "Inter", size: 64, weight: 700, italic: false, color: "#111111", align: "left", dir: "auto", lh: 1.2, ax: 0, ay: 0, rot: 0, flipX: false }, o.text || {});
    if (kind === "shape") L.shape = Object.assign({ type: "rect", x: 0, y: 0, w: 100, h: 100, rot: 0, fill: "#3dd6d0", stroke: "#111111", sw: 0, radius: 0, flipX: false, flipY: false }, o.shape || {});
    return L;
  }
  function rasterFromCanvas(c, name, x, y) { return newLayer("raster", { canvas: c, name: name, x: x || 0, y: y || 0 }); }
  function findLayer(doc, id) { for (var i = 0; i < doc.layers.length; i++) if (doc.layers[i].id === id) return doc.layers[i]; return null; }
  function activeLayer(doc) { return findLayer(doc, doc.active) || doc.layers[doc.layers.length - 1] || null; }
  // Grow a raster layer (and its mask) so it covers rect r (doc coords). Returns true if the canvas object changed.
  function ensureCovers(L, r) {
    var cur = { x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height }, u = rectI(union(cur, r));
    if (u.x === cur.x && u.y === cur.y && u.w === cur.w && u.h === cur.h) return false;
    if (u.w > LIM.layerSide || u.h > LIM.layerSide || u.w * u.h > LIM.layerPx) return false;
    var n = mk(u.w, u.h); cx2(n).drawImage(L.canvas, L.x - u.x, L.y - u.y);
    L.canvas = touch(n); L.x = u.x; L.y = u.y;
    return true;
  }
  function ensureMaskCovers(L, r) {
    var M = L.mask, cur = { x: M.x, y: M.y, w: M.canvas.width, h: M.canvas.height }, u = rectI(union(cur, r));
    if (u.x === cur.x && u.y === cur.y && u.w === cur.w && u.h === cur.h) return false;
    if (u.w > LIM.layerSide || u.h > LIM.layerSide || u.w * u.h > LIM.layerPx) return false;
    var n = mk(u.w, u.h), c = cx2(n);
    c.fillStyle = "#fff"; c.fillRect(0, 0, u.w, u.h);                 // new mask area reveals
    c.clearRect(M.x - u.x, M.y - u.y, cur.w, cur.h); c.drawImage(M.canvas, M.x - u.x, M.y - u.y);
    L.mask = { canvas: touch(n), x: u.x, y: u.y };
    return true;
  }
  function whiteMask(doc) { var c = mk(doc.w, doc.h), x = cx2(c); x.fillStyle = "#fff"; x.fillRect(0, 0, doc.w, doc.h); return { canvas: touch(c), x: 0, y: 0 }; }
  function maskFromSel(doc) {
    var c = mk(doc.w, doc.h);
    if (doc.sel) cx2(c).drawImage(selCanvas(doc.sel), 0, 0);
    return { canvas: touch(c), x: 0, y: 0 };
  }

  // ---------- text ----------
  var RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/, LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
  function textDir(t) {
    if (t.dir === "rtl" || t.dir === "ltr") return t.dir;
    var s = t.text || "";
    for (var i = 0; i < s.length; i++) { var ch = s.charAt(i); if (RTL.test(ch)) return "rtl"; if (LTR.test(ch)) return "ltr"; }
    return "ltr";
  }
  function cleanFamily(f) { return String(f || "").replace(/["'`;:{}()<>\\\/@!,]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "Inter"; }
  function fontCss(t) { return (t.italic ? "italic " : "") + (t.weight >= 600 ? "700" : "400") + " " + Math.max(1, t.size) + 'px "' + cleanFamily(t.font) + '", "Noto Sans Arabic", Tahoma, sans-serif'; }
  var mctx = null;
  function mcx() { if (!mctx) mctx = cx2(mk(4, 4)); return mctx; }
  function textLayout(t) {
    var c = mcx(); c.font = fontCss(t); c.direction = textDir(t);
    var lines = String(t.text).split("\n"), ws = lines.map(function (s) { return c.measureText(s).width; });
    var w = Math.max(1, Math.max.apply(null, ws)), lh = t.size * (t.lh || 1.2), h = Math.max(lh, lines.length * lh);
    var x = t.align === "center" ? t.ax - w / 2 : t.align === "right" ? t.ax - w : t.ax;
    return { lines: lines, widths: ws, w: w, h: h, lh: lh, box: { x: x, y: t.ay, w: w, h: h } };
  }
  // ---------- vector box helpers (text + shape share: box, rotation about its centre, flips) ----------
  function vbox(L) {
    if (L.kind === "text") { var b = textLayout(L.text).box; return { x: b.x, y: b.y, w: b.w, h: b.h, rot: L.text.rot || 0, fx: !!L.text.flipX, fy: false }; }
    var s = L.shape; return { x: s.x, y: s.y, w: s.w, h: s.h, rot: s.rot || 0, fx: !!s.flipX, fy: !!s.flipY };
  }
  var RAD = Math.PI / 180;
  function rotPt(x, y, cx, cy, deg) { var a = deg * RAD, c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy; return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }; }
  function boxCorners(b) {
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(function (p) { return rotPt(p[0], p[1], cx, cy, b.rot || 0); });
  }
  function aabbOf(pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function shapePath(c, s, b) {
    var x = b.x, y = b.y, w = b.w, h = b.h, t = s.type;
    c.beginPath();
    if (t === "ellipse") c.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    else if (t === "triangle") { c.moveTo(x + w / 2, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); }
    else if (t === "star") {
      for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1; var px = x + w / 2 + Math.cos(a) * w / 2 * r, py = y + h / 2 + Math.sin(a) * h / 2 * r + h * 0.04; if (i) c.lineTo(px, py); else c.moveTo(px, py); }
      c.closePath();
    } else if (t === "arrow") {
      var sh = h * 0.36, hw = Math.min(w * 0.45, h * 0.9);
      c.moveTo(x, y + h / 2 - sh / 2); c.lineTo(x + w - hw, y + h / 2 - sh / 2); c.lineTo(x + w - hw, y); c.lineTo(x + w, y + h / 2);
      c.lineTo(x + w - hw, y + h); c.lineTo(x + w - hw, y + h / 2 + sh / 2); c.lineTo(x, y + h / 2 + sh / 2); c.closePath();
    } else if (t === "line") { c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); }
    else {
      var r2 = clamp(s.radius || 0, 0, Math.min(Math.abs(w), Math.abs(h)) / 2);
      if (r2 > 0) { c.moveTo(x + r2, y); c.arcTo(x + w, y, x + w, y + h, r2); c.arcTo(x + w, y + h, x, y + h, r2); c.arcTo(x, y + h, x, y, r2); c.arcTo(x, y, x + w, y, r2); c.closePath(); }
      else c.rect(x, y, w, h);
    }
  }
  // Draw a vector layer's content in doc coordinates onto ctx (ctx's current transform maps doc -> target).
  function drawVector(c, L) {
    var b = vbox(L), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    c.save();
    c.translate(cx, cy); c.rotate((b.rot || 0) * RAD); c.scale(b.fx ? -1 : 1, b.fy ? -1 : 1); c.translate(-cx, -cy);
    if (L.kind === "text") {
      var t = L.text, lay = textLayout(t), dir = textDir(t);
      c.font = fontCss(t); c.direction = dir; c.fillStyle = hex(t.color, "#111111"); c.textBaseline = "middle";
      lay.lines.forEach(function (s, i) {
        var y = b.y + lay.lh * (i + 0.5), w = lay.widths[i], x = t.align === "center" ? b.x + (b.w - w) / 2 : t.align === "right" ? b.x + b.w - w : b.x;
        c.textAlign = dir === "rtl" ? "right" : "left";
        c.fillText(s, dir === "rtl" ? x + w : x, y);
      });
    } else {
      var s = L.shape;
      shapePath(c, s, b);
      if (s.type !== "line" && s.fill) { c.fillStyle = hex(s.fill, "#cccccc"); c.fill(); }
      var sw = s.type === "line" ? Math.max(1, s.sw || b.h) : s.sw;
      if (sw > 0) { c.lineWidth = sw; c.strokeStyle = hex(s.stroke, "#111111"); c.lineJoin = "round"; c.lineCap = "round"; c.stroke(); }
    }
    c.restore();
  }
  // Pixels of any layer as {canvas, x, y} in doc space. Vector layers are rendered (and cached) clipped to the document.
  var VCACHE = new WeakMap();
  function surface(L, doc) {
    if (L.kind === "raster") return { canvas: L.canvas, x: L.x, y: L.y };
    var key = JSON.stringify(L.kind === "text" ? L.text : L.shape) + "|" + doc.w + "x" + doc.h, hit = VCACHE.get(L);
    if (hit && hit.key === key) return hit.s;
    var b = vbox(L), pad = L.kind === "text" ? L.text.size * 0.6 + 4 : (L.shape.sw || 0) + 4;
    var a = aabbOf(boxCorners(b)); a = { x: a.x - pad, y: a.y - pad, w: a.w + 2 * pad, h: a.h + 2 * pad };
    var r = inter(rectI(a), { x: -64, y: -64, w: doc.w + 128, h: doc.h + 128 }) || { x: 0, y: 0, w: 1, h: 1 };
    var cv = mk(r.w, r.h), c = cx2(cv);
    c.translate(-r.x, -r.y); drawVector(c, L);
    var s = { canvas: cv, x: r.x, y: r.y };
    VCACHE.set(L, { key: key, s: s });
    return s;
  }

  // ---------- compositing ----------
  var MCACHE = new WeakMap();
  function maskedSurface(L, s, mask) {
    var key = ver(s.canvas) + ":" + s.x + ":" + s.y + ":" + ver(mask.canvas) + ":" + mask.x + ":" + mask.y, hit = MCACHE.get(L);
    if (hit && hit.key === key && hit.src === s.canvas && hit.mc === mask.canvas) return hit.out;
    var t = hit && hit.out.width === s.canvas.width && hit.out.height === s.canvas.height ? hit.out : mk(s.canvas.width, s.canvas.height), c = cx2(t);
    c.globalCompositeOperation = "copy"; c.drawImage(s.canvas, 0, 0);
    c.globalCompositeOperation = "destination-in"; c.drawImage(mask.canvas, mask.x - s.x, mask.y - s.y);
    c.globalCompositeOperation = "source-over";
    MCACHE.set(L, { key: key, src: s.canvas, mc: mask.canvas, out: t });
    return t;
  }
  function gco(b) { return b === "normal" || BLENDS.indexOf(b) < 0 ? "source-over" : b; }
  // Draw the visible layers onto ctx, whose transform already maps doc px -> target px.
  // opts.over[id] = {canvas,x,y,m?} replaces a layer's pixels; opts.maskOver[id] = {canvas,x,y}; opts.hide = id; opts.only = [ids]
  function drawLayers(ctx, doc, opts) {
    opts = opts || {};
    doc.layers.forEach(function (L) {
      if (!L.visible || opts.hide === L.id || (opts.only && opts.only.indexOf(L.id) < 0)) return;
      var s = (opts.over && opts.over[L.id]) || surface(L, doc), mask = L.mask && L.maskOn ? ((opts.maskOver && opts.maskOver[L.id]) || L.mask) : null;
      var img = mask ? maskedSurface(L, s, mask) : s.canvas;
      ctx.save();
      if (s.m) ctx.transform(s.m[0], s.m[1], s.m[2], s.m[3], s.m[4], s.m[5]);
      ctx.globalAlpha = clamp(L.opacity, 0, 1); ctx.globalCompositeOperation = gco(L.blend);
      ctx.drawImage(img, s.x, s.y);
      ctx.restore();
    });
  }
  // Flatten to a new canvas. opts: {scale, rect (doc px), bg (hex, for JPG), selMask: apply selection as alpha, only, over}
  function flatten(doc, opts) {
    opts = opts || {};
    var r = opts.rect || { x: 0, y: 0, w: doc.w, h: doc.h }, k = opts.scale || 1, W = Math.max(1, Math.round(r.w * k)), H = Math.max(1, Math.round(r.h * k));
    var out = mk(W, H), c = cx2(out);
    c.imageSmoothingQuality = "high";
    c.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
    drawLayers(c, doc, opts);
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (opts.selMask && doc.sel) { c.globalCompositeOperation = "destination-in"; c.drawImage(selCanvas(doc.sel), -r.x * k, -r.y * k, doc.w * k, doc.h * k); c.globalCompositeOperation = "source-over"; }
    if (opts.bg) { c.globalCompositeOperation = "destination-over"; c.fillStyle = opts.bg; c.fillRect(0, 0, W, H); c.globalCompositeOperation = "source-over"; }
    return out;
  }

  // ---------- selections ----------
  function makeSel(doc, m) { var b = PIX.bounds(m, doc.w, doc.h, 0); return b ? { m: m, w: doc.w, h: doc.h, b: b } : null; }
  var SELC = new WeakMap();
  function selCanvas(sel) {
    var hit = SELC.get(sel); if (hit) return hit;
    var c = mk(sel.w, sel.h), x = cx2(c), b = sel.b, im = x.createImageData(b.w, b.h), d = im.data;
    for (var y = 0; y < b.h; y++) for (var xx = 0; xx < b.w; xx++) { var i = (y * b.w + xx) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = sel.m[(y + b.y) * sel.w + xx + b.x]; }
    x.putImageData(im, b.x, b.y);
    SELC.set(sel, c);
    return c;
  }
  // Rasterise a path into a selection-sized mask (anti-aliased). draw(ctx) adds the path in doc coords.
  function pathMask(doc, bbox, draw) {
    var m = new Uint8Array(doc.w * doc.h), r = inter(rectI({ x: bbox.x - 2, y: bbox.y - 2, w: bbox.w + 4, h: bbox.h + 4 }), { x: 0, y: 0, w: doc.w, h: doc.h });
    if (!r) return m;
    var c = mk(r.w, r.h), x = cx2(c);
    x.translate(-r.x, -r.y); x.fillStyle = "#fff"; draw(x); x.fill("evenodd");
    var d = x.getImageData(0, 0, r.w, r.h).data;
    for (var yy = 0; yy < r.h; yy++) for (var xx = 0; xx < r.w; xx++) m[(yy + r.y) * doc.w + xx + r.x] = d[(yy * r.w + xx) * 4 + 3];
    return m;
  }
  function selOutline(sel) {
    if (sel._ol) return sel._ol;
    var step = Math.max(1, Math.ceil(Math.max(sel.b.w, sel.b.h) / 1600)), b = sel.b, sub = new Uint8Array(b.w * b.h);
    for (var y = 0; y < b.h; y++) sub.set(sel.m.subarray((y + b.y) * sel.w + b.x, (y + b.y) * sel.w + b.x + b.w), y * b.w);
    var s = step > 1 ? PIX.shrinkMask(sub, b.w, b.h, step) : { m: sub, w: b.w, h: b.h }, seg = PIX.outline(s.m, s.w, s.h), p = new Path2D();
    // chain the edge segments into long polylines so the marching-ants dash pattern runs along the edge
    var n = seg.length / 4, used = new Uint8Array(n), ends = new Map(), i, W1 = s.w + 2;
    function key(x, y) { return y * W1 + x; }
    for (i = 0; i < n; i++) [key(seg[i * 4], seg[i * 4 + 1]), key(seg[i * 4 + 2], seg[i * 4 + 3])].forEach(function (k) { var l = ends.get(k); if (l) l.push(i); else ends.set(k, [i]); });
    function X(v) { return b.x + v * step; } function Y(v) { return b.y + v * step; }
    for (i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = 1; var cx = seg[i * 4 + 2], cy = seg[i * 4 + 3];
      p.moveTo(X(seg[i * 4]), Y(seg[i * 4 + 1])); p.lineTo(X(cx), Y(cy));
      for (;;) {
        var list = ends.get(key(cx, cy)), nx = -1;
        if (list) for (var j = 0; j < list.length; j++) if (!used[list[j]]) { nx = list[j]; break; }
        if (nx < 0) break;
        used[nx] = 1;
        if (seg[nx * 4] === cx && seg[nx * 4 + 1] === cy) { cx = seg[nx * 4 + 2]; cy = seg[nx * 4 + 3]; } else { cx = seg[nx * 4]; cy = seg[nx * 4 + 1]; }
        p.lineTo(X(cx), Y(cy));
      }
    }
    sel._ol = p;
    return p;
  }
  // Selection mask cropped to a layer-local rect (for constraining edits), or null if no selection.
  function selFor(doc, r) {
    if (!doc.sel) return null;
    var m = new Uint8Array(r.w * r.h), s = doc.sel;
    for (var y = 0; y < r.h; y++) {
      var sy = y + r.y; if (sy < 0 || sy >= s.h) continue;
      for (var x = 0; x < r.w; x++) { var sx = x + r.x; if (sx >= 0 && sx < s.w) m[y * r.w + x] = s.m[sy * s.w + sx]; }
    }
    return m;
  }

  // ---------- transforms (2D affine [a b c d e f] like canvas) ----------
  function mMul(A, B) { return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]]; }
  function mApply(m, x, y) { return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; }
  function mInv(m) { var det = m[0] * m[3] - m[1] * m[2]; if (!det) return [1, 0, 0, 1, 0, 0]; return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]; }
  // T = {cx, cy (pivot), sx, sy, rot (deg), tx, ty}: scale + rotate about the pivot, then move.
  function mTRS(T) {
    var a = (T.rot || 0) * RAD, c = Math.cos(a), s = Math.sin(a);
    var m = [1, 0, 0, 1, T.cx + (T.tx || 0), T.cy + (T.ty || 0)];
    m = mMul(m, [c, s, -s, c, 0, 0]); m = mMul(m, [T.sx == null ? 1 : T.sx, 0, 0, T.sy == null ? 1 : T.sy, 0, 0]); m = mMul(m, [1, 0, 0, 1, -T.cx, -T.cy]);
    return m;
  }
  function mBounds(m, r) { return aabbOf([mApply(m, r.x, r.y), mApply(m, r.x + r.w, r.y), mApply(m, r.x + r.w, r.y + r.h), mApply(m, r.x, r.y + r.h)]); }
  // Bake a transform into pixels: returns {canvas, x, y}.
  function bake(canvas, x, y, m, smooth) {
    var b = rectI(mBounds(m, { x: x, y: y, w: canvas.width, h: canvas.height }));
    if (b.w > LIM.layerSide || b.h > LIM.layerSide || b.w * b.h > LIM.layerPx) throw new Error("That would make the layer too large (" + b.w + " × " + b.h + ")");
    var n = mk(b.w, b.h), c = cx2(n);
    c.imageSmoothingEnabled = smooth !== false; c.imageSmoothingQuality = "high";
    c.setTransform(1, 0, 0, 1, -b.x, -b.y); c.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    c.drawImage(canvas, x, y);
    return { canvas: touch(n), x: b.x, y: b.y };
  }

  // ---------- history: meta snapshots (refs + props) and pixel tiles ----------
  function snapLayer(L) {
    return { ref: L, p: { kind: L.kind, name: L.name, visible: L.visible, locked: L.locked, opacity: L.opacity, blend: L.blend, x: L.x, y: L.y, canvas: L.canvas,
      mask: L.mask ? { canvas: L.mask.canvas, x: L.mask.x, y: L.mask.y } : null, maskOn: L.maskOn, text: clone(L.text), shape: clone(L.shape) } };
  }
  function snap(doc) { return { w: doc.w, h: doc.h, sel: doc.sel, active: doc.active, name: doc.name, layers: doc.layers.map(snapLayer) }; }
  function restore(doc, s) {
    doc.w = s.w; doc.h = s.h; doc.sel = s.sel; doc.active = s.active; doc.name = s.name;
    doc.layers = s.layers.map(function (it) {
      var L = it.ref, p = it.p;
      L.kind = p.kind; L.name = p.name; L.visible = p.visible; L.locked = p.locked; L.opacity = p.opacity; L.blend = p.blend; L.x = p.x; L.y = p.y; L.canvas = p.canvas;
      L.mask = p.mask ? { canvas: p.mask.canvas, x: p.mask.x, y: p.mask.y } : null; L.maskOn = p.maskOn; L.text = clone(p.text); L.shape = clone(p.shape);
      return L;
    });
  }
  function canvasesOf(s) { var out = []; s.layers.forEach(function (it) { if (it.p.canvas) out.push(it.p.canvas); if (it.p.mask) out.push(it.p.mask.canvas); }); return out; }
  function metaEntry(label, doc, before) {
    var after = snap(doc), a = canvasesOf(after), b = canvasesOf(before), bytes = 2000;
    b.forEach(function (c) { if (a.indexOf(c) < 0) bytes += c.width * c.height * 4; });
    a.forEach(function (c) { if (b.indexOf(c) < 0) bytes += c.width * c.height * 4; });
    if (before.sel !== after.sel) bytes += (before.sel ? before.sel.m.length : 0) + (after.sel ? after.sel.m.length : 0);
    return { label: label, bytes: bytes, undo: function () { restore(doc, before); }, redo: function () { restore(doc, after); } };
  }
  // Split before/after pixels of rect r into T x T tiles and keep only the tiles that changed.
  function diffTiles(before, after, w, h, T) {
    T = T || 64;
    var out = [];
    for (var ty = 0; ty < h; ty += T) for (var tx = 0; tx < w; tx += T) {
      var tw = Math.min(T, w - tx), th = Math.min(T, h - ty), same = true, y, i;
      for (y = 0; y < th && same; y++) { i = ((ty + y) * w + tx) * 4; for (var k = 0; k < tw * 4; k++) if (before[i + k] !== after[i + k]) { same = false; break; } }
      if (same) continue;
      var b = new Uint8ClampedArray(tw * th * 4), a = new Uint8ClampedArray(tw * th * 4);
      for (y = 0; y < th; y++) { i = ((ty + y) * w + tx) * 4; b.set(before.subarray(i, i + tw * 4), y * tw * 4); a.set(after.subarray(i, i + tw * 4), y * tw * 4); }
      out.push({ x: tx, y: ty, w: tw, h: th, b: b, a: a });
    }
    return out;
  }
  function tileEntry(label, canvas, r, beforeData) {
    var after = getData(canvas, r), tiles = diffTiles(beforeData.data, after.data, r.w, r.h, 64), bytes = 200;
    tiles.forEach(function (t) { bytes += t.b.length * 2; });
    function put(which) { var c = cx2(canvas); tiles.forEach(function (t) { c.putImageData(new ImageData(t[which], t.w, t.h), r.x + t.x, r.y + t.y); }); touch(canvas); }
    return { label: label, bytes: bytes, tiles: tiles.length, undo: function () { put("b"); }, redo: function () { put("a"); } };
  }
  function compound(label, parts) {
    parts = parts.filter(Boolean);
    return { label: label, bytes: parts.reduce(function (s, p) { return s + p.bytes; }, 0),
      undo: function () { for (var i = parts.length - 1; i >= 0; i--) parts[i].undo(); }, redo: function () { parts.forEach(function (p) { p.redo(); }); } };
  }
  function History(budget, max) { this.list = []; this.pos = 0; this.bytes = 0; this.budget = budget || 400e6; this.max = max || 60; this.dropped = 0; }
  History.prototype.push = function (e) {
    if (!e) return;
    for (var i = this.pos; i < this.list.length; i++) this.bytes -= this.list[i].bytes;
    this.list.length = this.pos;
    this.list.push(e); this.pos++; this.bytes += e.bytes;
    while ((this.list.length > this.max || this.bytes > this.budget) && this.list.length > 1) { var o = this.list.shift(); this.bytes -= o.bytes; this.pos--; this.dropped++; }
  };
  History.prototype.undo = function () { if (!this.pos) return null; var e = this.list[--this.pos]; e.undo(); return e; };
  History.prototype.redo = function () { if (this.pos >= this.list.length) return null; var e = this.list[this.pos++]; e.redo(); return e; };
  History.prototype.jump = function (n) { while (this.pos > n) this.undo(); while (this.pos < n && this.pos < this.list.length) this.redo(); };
  History.prototype.canUndo = function () { return this.pos > 0; };
  History.prototype.canRedo = function () { return this.pos < this.list.length; };
  function historyBudget() { var m = navigator.deviceMemory || 4; return m <= 2 ? 160e6 : m <= 4 ? 320e6 : 600e6; }

  // Edit pixels of a canvas held at obj[key] (a layer's canvas, or a mask object's canvas) inside rect r (canvas-local).
  // Big edits replace the canvas (meta entry, one copy kept); small ones keep only the changed 64 px tiles.
  function editPixels(doc, label, holder, key, r, draw) {
    var c = holder[key], full = { x: 0, y: 0, w: c.width, h: c.height };
    r = r ? inter(rectI(r), full) : full;
    if (!r) return null;
    if (r.w * r.h > full.w * full.h * 0.45) {
      var before = snap(doc), n = cloneCanvas(c);
      draw(cx2(n), n); holder[key] = touch(n);
      return metaEntry(label, doc, before);
    }
    var bd = getData(c, r);
    draw(cx2(c), c); touch(c);
    return tileEntry(label, c, r, bd);
  }

  // ---------- zip (stored write; stored + deflate read with limits) ----------
  var CRCT = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRCT[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipWrite(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = f.crc != null ? f.crc : crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      parts.push(lh.buffer, name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(ch.buffer, name);
      off += 30 + name.length + data.length;
    });
    var cs = central.reduce(function (s, p) { return s + p.byteLength; }, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cs, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: "application/zip" });
  }
  function zipEntries(u8) {
    if (u8.length < 22 || u8.length > LIM.zip) throw new Error("This is not a valid .s3photo file");
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), e = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("This is not a valid .s3photo file (not a zip)");
    var n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true), out = [], dec = new TextDecoder();
    if (n > LIM.entries) throw new Error("This project has too many files inside");
    for (var k = 0; k < n; k++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error("This project file is damaged");
      var method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      var nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      if (lo + 30 > u8.length || dv.getUint32(lo, true) !== 0x04034b50) throw new Error("This project file is damaged");
      var start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      if (start + csize > u8.length) throw new Error("This project file is truncated");
      out.push({ name: name, method: method, crc: crc, csize: csize, usize: usize, start: start });
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  function inflate(u8, max) {
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("This browser cannot read compressed zips"));
    var ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter(), r = ds.readable.getReader(), chunks = [], total = 0;
    w.write(u8).catch(function () {}); w.close().catch(function () {});
    function pump() {
      return r.read().then(function (x) {
        if (x.done) { var o = new Uint8Array(total), q = 0; chunks.forEach(function (c) { o.set(c, q); q += c.length; }); return o; }
        total += x.value.length;
        if (total > max) { r.cancel().catch(function () {}); throw new Error("A file inside the project is larger than it claims"); }
        chunks.push(x.value); return pump();
      });
    }
    return pump();
  }
  function zipRead(u8, entry, max) {
    if (entry.usize > max) return Promise.reject(new Error("A file inside the project is too large"));
    var raw = u8.subarray(entry.start, entry.start + entry.csize);
    var p = entry.method === 0 ? Promise.resolve(raw) : entry.method === 8 ? inflate(raw, Math.min(max, entry.usize)) : Promise.reject(new Error("Unsupported zip compression"));
    return p.then(function (d) {
      if (d.length !== entry.usize || crc32(d) !== entry.crc) throw new Error("A file inside the project is damaged (" + entry.name + ")");
      return d;
    });
  }

  // ---------- encoding / decoding ----------
  function toBlob(canvas, type, q) {
    return new Promise(function (res, rej) { canvas.toBlob(function (b) { if (b) res(b); else rej(new Error("The browser could not encode this image (too large?)")); }, type, q); });
  }
  function blobBytes(b) { return b.arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); }
  var ENC = new WeakMap();
  function pngOf(canvas) {
    var hit = ENC.get(canvas), v = ver(canvas);
    if (hit && hit.v === v) return Promise.resolve(hit);
    return toBlob(canvas, "image/png").then(blobBytes).then(function (bytes) { var e = { v: v, bytes: bytes, crc: crc32(bytes) }; ENC.set(canvas, e); return e; });
  }
  function pngSize(b) {
    if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4E || b[3] !== 0x47 || b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength); return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  function bytesToCanvas(bytes, type) {
    return createImageBitmap(new Blob([bytes], { type: type || "image/png" }), { premultiplyAlpha: "default", colorSpaceConversion: "none" }).then(function (bm) {
      var c = mk(bm.width, bm.height); cx2(c).drawImage(bm, 0, 0); if (bm.close) bm.close(); return touch(c);
    });
  }
  // Open an image file as a canvas, scaled down to the limits if needed.
  function decodeImage(file) {
    return createImageBitmap(file).catch(function () { throw new Error("Could not read " + (file.name || "this file") + " as an image (try PNG, JPG, WebP, GIF, BMP or AVIF)"); }).then(function (bm) {
      var w = bm.width, h = bm.height, k = Math.min(1, LIM.side / w, LIM.side / h, Math.sqrt(LIM.px / (w * h)));
      var W = Math.max(1, Math.floor(w * k)), H = Math.max(1, Math.floor(h * k)), c = mk(W, H), x = cx2(c);
      x.imageSmoothingQuality = "high"; x.drawImage(bm, 0, 0, W, H); if (bm.close) bm.close();
      return { canvas: touch(c), w: W, h: H, ow: w, oh: h, scaled: k < 1 };
    });
  }

  // ---------- .s3photo project files ----------
  function num(v, a, b, d) { v = +v; return isFinite(v) ? clamp(v, a, b) : d; }
  function str(v, n, d) { return typeof v === "string" ? v.slice(0, n) : d; }
  function cleanText(v) { var t = clean(v); return { text: str(t.text, LIM.text, "Text"), font: cleanFamily(t.font), size: num(t.size, 1, 2000, 64), weight: num(t.weight, 100, 900, 400) >= 600 ? 700 : 400,
    italic: t.italic === true, color: hex(t.color, "#111111"), align: ["left", "center", "right"].indexOf(t.align) >= 0 ? t.align : "left",
    dir: ["auto", "ltr", "rtl"].indexOf(t.dir) >= 0 ? t.dir : "auto", lh: num(t.lh, 0.5, 4, 1.2), ax: num(t.ax, -1e5, 1e5, 0), ay: num(t.ay, -1e5, 1e5, 0), rot: num(t.rot, -360, 360, 0), flipX: t.flipX === true }; }
  function cleanShape(v) { var s = clean(v); return { type: SHAPES.indexOf(s.type) >= 0 ? s.type : "rect", x: num(s.x, -1e5, 1e5, 0), y: num(s.y, -1e5, 1e5, 0), w: num(s.w, 1, 3 * LIM.side, 100), h: num(s.h, 1, 3 * LIM.side, 100),
    rot: num(s.rot, -360, 360, 0), fill: s.fill === "" ? "" : hex(s.fill, "#cccccc"), stroke: hex(s.stroke, "#111111"), sw: num(s.sw, 0, 500, 0), radius: num(s.radius, 0, 1e4, 0), flipX: s.flipX === true, flipY: s.flipY === true }; }
  function clean(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  // Validate project.json text -> a plain, whitelisted description. Throws on anything not a project.
  function parseProjectJson(text) {
    var d;
    try { d = JSON.parse(text); } catch (e) { throw new Error("This is not a valid .s3photo project (bad JSON)"); }
    if (!d || typeof d !== "object" || Array.isArray(d) || d.format !== "s3photo") throw new Error("This is not a Photo Editor project (.s3photo)");
    if (num(d.version, 0, 1e6, 0) > 1) throw new Error("This project was made by a newer version of Photo Editor");
    var w = Math.round(+d.w), h = Math.round(+d.h);
    if (!isFinite(w) || !isFinite(h)) throw new Error("The project has no valid size");
    checkSize(w, h, "The project");
    if (!Array.isArray(d.layers) || !d.layers.length) throw new Error("The project has no layers");
    if (d.layers.length > LIM.layers) throw new Error("The project has more than " + LIM.layers + " layers");
    var ids = {};
    var layers = d.layers.map(function (raw, i) {
      var l = clean(raw), kind = ["raster", "text", "shape"].indexOf(l.kind) >= 0 ? l.kind : null;
      if (!kind) throw new Error("Layer " + (i + 1) + " has an unknown type");
      var out = { kind: kind, name: str(l.name, 100, "Layer").replace(/[\u0000-\u001f]/g, " ") || "Layer", visible: l.visible !== false, locked: l.locked === true,
        opacity: num(l.opacity, 0, 1, 1), blend: BLENDS.indexOf(l.blend) >= 0 ? l.blend : "normal", x: Math.round(num(l.x, -LIM.layerSide, LIM.layerSide, 0)), y: Math.round(num(l.y, -LIM.layerSide, LIM.layerSide, 0)), maskOn: l.maskOn !== false };
      if (kind === "raster") { if (typeof l.src !== "string" || !/^layers\/\d{1,3}\.png$/.test(l.src) || ids[l.src]) throw new Error("Layer " + (i + 1) + " has a bad image reference"); ids[l.src] = 1; out.src = l.src; }
      if (kind === "text") out.text = cleanText(l.text);
      if (kind === "shape") out.shape = cleanShape(l.shape);
      if (l.mask != null) {
        var m = clean(l.mask);
        if (typeof m.src !== "string" || !/^masks\/\d{1,3}\.png$/.test(m.src) || ids[m.src]) throw new Error("Layer " + (i + 1) + " has a bad mask reference");
        ids[m.src] = 1; out.mask = { src: m.src, x: Math.round(num(m.x, -LIM.layerSide, LIM.layerSide, 0)), y: Math.round(num(m.y, -LIM.layerSide, LIM.layerSide, 0)) };
      }
      return out;
    });
    return { name: str(d.name, 120, "Untitled").trim() || "Untitled", w: w, h: h, fg: hex(d.fg, "#111111"), bg: hex(d.bg, "#ffffff"), active: Math.round(num(d.active, 0, layers.length - 1, layers.length - 1)), layers: layers };
  }
  function projectFiles(doc) {
    var meta = { format: "s3photo", version: 1, app: "S3eidat Photo Editor", name: doc.name, w: doc.w, h: doc.h, fg: doc.fg, bg: doc.bg, layers: [], active: 0 };
    var jobs = [], files = [];
    doc.layers.forEach(function (L, i) {
      var l = { kind: L.kind, name: L.name, visible: L.visible, locked: L.locked, opacity: Math.round(L.opacity * 1000) / 1000, blend: L.blend, x: L.x, y: L.y, maskOn: L.maskOn };
      if (L.id === doc.active) meta.active = i;
      if (L.kind === "raster") { l.src = "layers/" + i + ".png"; jobs.push(pngOf(L.canvas).then(function (e) { files.push({ name: l.src, data: e.bytes, crc: e.crc }); })); }
      if (L.text) l.text = clone(L.text);
      if (L.shape) l.shape = clone(L.shape);
      if (L.mask) { l.mask = { src: "masks/" + i + ".png", x: L.mask.x, y: L.mask.y }; jobs.push(pngOf(L.mask.canvas).then(function (e) { files.push({ name: l.mask.src, data: e.bytes, crc: e.crc }); })); }
      meta.layers.push(l);
    });
    return Promise.all(jobs).then(function () {
      files.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      return [{ name: "project.json", data: JSON.stringify(meta) }].concat(files);
    });
  }
  function saveProject(doc) { return projectFiles(doc).then(zipWrite); }
  // Open .s3photo bytes -> a document with real canvases. Everything is checked before use.
  function openProject(u8) {
    var entries = zipEntries(u8), byName = {};
    entries.forEach(function (e) { if (!/^(project\.json|layers\/\d{1,3}\.png|masks\/\d{1,3}\.png)$/.test(e.name)) return; if (byName[e.name]) throw new Error("This project file has duplicate entries"); byName[e.name] = e; });
    if (!byName["project.json"]) throw new Error("This is not a Photo Editor project (no project.json)");
    return zipRead(u8, byName["project.json"], 4e6).then(function (jb) {
      var meta = parseProjectJson(new TextDecoder().decode(jb)), doc = newDoc(meta.w, meta.h, meta.name);
      doc.fg = meta.fg; doc.bg = meta.bg;
      function img(src) {
        var e = byName[src]; if (!e) throw new Error("The project is missing " + src);
        return zipRead(u8, e, 400e6).then(function (b) {
          var s = pngSize(b);
          if (!s) throw new Error(src + " is not a PNG image");
          if (s.w < 1 || s.h < 1 || s.w > LIM.layerSide || s.h > LIM.layerSide || s.w * s.h > LIM.layerPx) throw new Error(src + " is too large (" + s.w + " × " + s.h + ")");
          return bytesToCanvas(b).then(function (c) { if (c.width !== s.w || c.height !== s.h) throw new Error(src + " could not be decoded"); return c; });
        });
      }
      return Promise.all(meta.layers.map(function (l) {
        var L = newLayer(l.kind, { name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity, blend: l.blend, x: l.x, y: l.y, maskOn: l.maskOn, text: l.text, shape: l.shape, canvas: l.kind === "raster" ? mk(1, 1) : null });
        var jobs = [];
        if (l.src) jobs.push(img(l.src).then(function (c) { L.canvas = c; }));
        if (l.mask) jobs.push(img(l.mask.src).then(function (c) { L.mask = { canvas: c, x: l.mask.x, y: l.mask.y }; }));
        return Promise.all(jobs).then(function () { return L; });
      })).then(function (layers) {
        doc.layers = layers; doc.active = layers[meta.active].id;
        return doc;
      });
    });
  }

  // ---------- IndexedDB autosave (this browser only) ----------
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error("No IndexedDB"));
      var rq = indexedDB.open("s3-photo-editor", 1);
      rq.onupgradeneeded = function () { if (!rq.result.objectStoreNames.contains("docs")) rq.result.createObjectStore("docs", { keyPath: "id" }); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction("docs", mode), out = fn(t.objectStore("docs"));
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error || new Error("Storage aborted")); };
      });
    });
  }
  var store = {
    put: function (r) { return tx("readwrite", function (s) { s.put(r); }); },
    get: function (id) { return tx("readonly", function (s) { return s.get(id); }); },
    del: function (id) { return tx("readwrite", function (s) { s.delete(id); }); },
    list: function () {
      return tx("readonly", function (s) { return s.getAll(); }).then(function (all) {
        return (all || []).map(function (r) { return { id: r.id, name: r.name, updated: r.updated, w: r.w, h: r.h, thumb: r.thumb, size: r.blob ? r.blob.size : 0 }; }).sort(function (a, b) { return b.updated - a.updated; });
      });
    }
  };

  // ---------- fonts on this device ----------
  var CANDIDATES = ["Inter", "Arial", "Helvetica", "Segoe UI", "Roboto", "Open Sans", "Noto Sans", "Ubuntu", "DejaVu Sans", "Verdana", "Tahoma", "Trebuchet MS",
    "Calibri", "Candara", "Century Gothic", "Gill Sans", "Futura", "Avenir", "Arial Black", "Impact", "Bahnschrift", "Georgia", "Times New Roman", "Cambria",
    "Palatino Linotype", "Garamond", "Baskerville", "Rockwell", "Noto Serif", "Courier New", "Consolas", "Menlo", "Comic Sans MS", "Segoe Script", "Brush Script MT",
    "Lucida Handwriting", "Papyrus", "Noto Sans Arabic", "Noto Naskh Arabic", "Noto Kufi Arabic", "Arabic Typesetting", "Traditional Arabic", "Simplified Arabic",
    "Sakkal Majalla", "Aldhabi", "Andalus", "Geeza Pro", "Al Nile", "Baghdad", "Damascus", "Al Bayan", "Diwan Kufi", "Amiri", "Cairo", "Tajawal", "Dubai"];
  var fontList = null;
  function deviceFonts() {
    if (fontList) return fontList;
    var c = mcx(), probe = "mmmmmmmmmmlli WQ@#0 أبجد هوز";
    function w(f) { c.font = "64px " + f; return c.measureText(probe).width; }
    var base = { m: w("monospace"), s: w("serif"), ss: w("sans-serif") };
    fontList = CANDIDATES.filter(function (f) {
      if (f === "Inter") return true;
      var q = '"' + f + '", ';
      return w(q + "monospace") !== base.m || w(q + "serif") !== base.s || w(q + "sans-serif") !== base.ss;
    });
    return fontList;
  }

  // ---------- worker bridge (falls back to this thread if workers are unavailable) ----------
  var W = null, alive = false, jid = 0, pend = {};
  function startWorker() {
    if (W !== null) return;
    try {
      W = new Worker("js/worker.js");
      W.onmessage = function (e) {
        var m = e.data, p = pend[m.id]; if (m.id === 0) { alive = true; return; }
        if (!p) return; delete pend[m.id];
        if (m.ok) p.res(m.result); else p.rej(new Error(m.error));
      };
      W.onerror = function () { alive = false; W = false; Object.keys(pend).forEach(function (k) { var p = pend[k]; delete pend[k]; p.local(); }); };
      W.postMessage({ id: 0, fn: "bounds", args: [new Uint8Array(1), 1, 1] });
    } catch (e) { W = false; }
  }
  function post(msg, transfer, local) {
    if (!alive || !W) return Promise.resolve().then(local);
    return new Promise(function (res, rej) {
      var id = ++jid; msg.id = id;
      pend[id] = { res: res, rej: rej, local: function () { try { res(local()); } catch (e) { rej(e); } } };
      W.postMessage(msg, transfer || []);
    });
  }
  // Run PIX[fn](...args). Inputs are copied for the worker (pass transfer=true to hand over the buffers instead).
  function work(fn, args) {
    return post({ fn: fn, args: args }, null, function () { return PIX.call(fn, args); });
  }
  var heldLocal = null;
  function workLoad(key, img, sel) { heldLocal = { key: key, img: img, sel: sel }; return post({ load: key, img: img, sel: sel }, null, function () { return true; }); }
  function workAdjust(key, op, p) {
    return post({ key: key, op: op, p: p }, null, function () {
      if (!heldLocal || heldLocal.key !== key) throw new Error("Source not loaded");
      return PIX.adjust(PIX.copyImg(heldLocal.img), op, p, heldLocal.sel);
    });
  }

  Object.assign(PE, {
    uid: uid, clamp: clamp, mk: mk, cx2: cx2, cloneCanvas: cloneCanvas, clone: clone, touch: touch, ver: ver, getData: getData, rectI: rectI, inter: inter, union: union,
    hex: hex, rgbOf: rgbOf, toHex: toHex, checkSize: checkSize, newDoc: newDoc, newLayer: newLayer, rasterFromCanvas: rasterFromCanvas, findLayer: findLayer,
    activeLayer: activeLayer, ensureCovers: ensureCovers, ensureMaskCovers: ensureMaskCovers, whiteMask: whiteMask, maskFromSel: maskFromSel,
    textDir: textDir, textLayout: textLayout, fontCss: fontCss, cleanFamily: cleanFamily, vbox: vbox, rotPt: rotPt, boxCorners: boxCorners, aabbOf: aabbOf,
    drawVector: drawVector, surface: surface, drawLayers: drawLayers, flatten: flatten, gco: gco,
    makeSel: makeSel, selCanvas: selCanvas, pathMask: pathMask, selOutline: selOutline, selFor: selFor,
    mMul: mMul, mApply: mApply, mInv: mInv, mTRS: mTRS, mBounds: mBounds, bake: bake,
    snap: snap, restore: restore, metaEntry: metaEntry, diffTiles: diffTiles, tileEntry: tileEntry, compound: compound, History: History, historyBudget: historyBudget, editPixels: editPixels,
    crc32: crc32, zipWrite: zipWrite, zipEntries: zipEntries, zipRead: zipRead, toBlob: toBlob, blobBytes: blobBytes, pngOf: pngOf, pngSize: pngSize, bytesToCanvas: bytesToCanvas, decodeImage: decodeImage,
    parseProjectJson: parseProjectJson, projectFiles: projectFiles, saveProject: saveProject, openProject: openProject, store: store, deviceFonts: deviceFonts,
    startWorker: startWorker, work: work, workLoad: workLoad, workAdjust: workAdjust, workerAlive: function () { return alive; }
  });
})();
