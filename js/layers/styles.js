/* Selection lane: layer styles. L.fx = {on, dropShadow:{…}, innerShadow, outerGlow, innerGlow, bevel, satin,
   colorOverlay, gradOverlay, patternOverlay, stroke}. Effects are rendered from the layer's masked alpha into a
   cached padded box: shadows/glows are drawn behind the layer, interior effects on its pixels (they ignore Fill),
   stroke and outer bevels after it, each with its own blend mode. Edited live in a floating panel. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, FXM = window.FXM, ED = PE.ed, SX = PE.sx, h = S3.h;
  var DEF = {
    dropShadow: { on: false, blend: "multiply", color: "#000000", op: 0.75, angle: 120, dist: 8, spread: 0, size: 10 },
    innerShadow: { on: false, blend: "multiply", color: "#000000", op: 0.75, angle: 120, dist: 5, choke: 0, size: 6 },
    outerGlow: { on: false, blend: "screen", color: "#ffffbe", op: 0.75, spread: 0, size: 14 },
    innerGlow: { on: false, blend: "screen", color: "#ffffbe", op: 0.75, source: "edge", choke: 0, size: 10 },
    bevel: { on: false, style: "inner", depth: 100, dir: "up", size: 6, soften: 0, angle: 120, altitude: 30, hiBlend: "screen", hiColor: "#ffffff", hiOp: 0.75, shBlend: "multiply", shColor: "#000000", shOp: 0.75 },
    satin: { on: false, blend: "multiply", color: "#000000", op: 0.5, angle: 19, dist: 11, size: 14, invert: true },
    colorOverlay: { on: false, blend: "normal", color: "#e5484d", op: 1 },
    gradOverlay: { on: false, blend: "normal", op: 1, from: "#000000", to: "#ffffff", style: "linear", angle: 90, scale: 100, reverse: false },
    patternOverlay: { on: false, blend: "multiply", op: 0.6, pattern: "dots", color: "#000000", scale: 100 },
    stroke: { on: false, size: 3, pos: "outside", blend: "normal", color: "#000000", op: 1 }
  };
  var ORDER = ["dropShadow", "innerShadow", "outerGlow", "innerGlow", "bevel", "satin", "colorOverlay", "gradOverlay", "patternOverlay", "stroke"];
  var NAMES = { dropShadow: "Drop shadow", innerShadow: "Inner shadow", outerGlow: "Outer glow", innerGlow: "Inner glow", bevel: "Bevel & emboss", satin: "Satin",
    colorOverlay: "Colour overlay", gradOverlay: "Gradient overlay", patternOverlay: "Pattern overlay", stroke: "Stroke" };
  SX.FX_DEF = DEF; SX.FX_ORDER = ORDER;
  function on(L, k) { return !!(L.fx && L.fx.on !== false && L.fx[k] && L.fx[k].on); }
  SX.fxOn = function (L) { return !!(L.fx && L.fx.on !== false && ORDER.some(function (k) { return on(L, k); })); };
  function eff(L, k) { return Object.assign({}, DEF[k], L.fx[k]); }

  // ---------- patterns (drawn in code, two-tone tiles) ----------
  var PATTERNS = [["dots", "Dots"], ["checker", "Checker"], ["stripes", "Diagonal stripes"], ["grid", "Grid"], ["linen", "Linen"], ["noise", "Noise"], ["waves", "Waves"]];
  var TILES = {};
  function tile(name) {
    if (TILES[name]) return TILES[name];
    var S = 24, c = PE.mk(S, S), x = PE.cx2(c); x.fillStyle = "#000";
    if (name === "checker") { x.fillRect(0, 0, 12, 12); x.fillRect(12, 12, 12, 12); }
    else if (name === "stripes") { x.beginPath(); for (var k = -24; k < 48; k += 8) { x.moveTo(k, 0); x.lineTo(k + 4, 0); x.lineTo(k + 4 - 24, 24); x.lineTo(k - 24, 24); x.closePath(); } x.fill(); }
    else if (name === "grid") { x.fillRect(0, 0, 24, 2); x.fillRect(0, 0, 2, 24); }
    else if (name === "linen") { for (var y = 0; y < S; y += 3) { x.globalAlpha = 0.5 + 0.5 * ((y * 7) % 5) / 5; x.fillRect(0, y, S, 1); } for (var xx = 0; xx < S; xx += 3) { x.globalAlpha = 0.35; x.fillRect(xx, 0, 1, S); } x.globalAlpha = 1; }
    else if (name === "noise") { var im = x.createImageData(S, S), r = PIX.rng(9); for (var i = 0; i < S * S; i++) { im.data[i * 4 + 3] = Math.floor(r() * 256); } x.putImageData(im, 0, 0); }
    else if (name === "waves") { x.lineWidth = 2.5; x.strokeStyle = "#000"; for (var wy = 6; wy < S; wy += 12) { x.beginPath(); for (var wx = 0; wx <= S; wx++) { var yy = wy + Math.sin(wx / S * Math.PI * 2) * 3; if (wx) x.lineTo(wx, yy); else x.moveTo(wx, yy); } x.stroke(); } }
    else { x.beginPath(); x.arc(6, 6, 3.4, 0, Math.PI * 2); x.arc(18, 18, 3.4, 0, Math.PI * 2); x.fill(); }
    return (TILES[name] = c);
  }

  // ---------- rendering ----------
  function planeCanvas(a, w, hh, color) {
    var c = PE.mk(w, hh), x = PE.cx2(c), im = x.createImageData(w, hh), d = im.data, rgb = PE.rgbOf(color || "#ffffff");
    for (var i = 0, j = 0; i < a.length; i++, j += 4) { d[j] = rgb[0]; d[j + 1] = rgb[1]; d[j + 2] = rgb[2]; d[j + 3] = a[i] * 255; }
    x.putImageData(im, 0, 0); return c;
  }
  function padFor(L) {
    var p = 2, k;
    if (on(L, "dropShadow")) { k = eff(L, "dropShadow"); p = Math.max(p, (k.dist || 0) + (k.size || 0) * 1.5 + 2); }
    if (on(L, "innerShadow")) { k = eff(L, "innerShadow"); p = Math.max(p, (k.dist || 0) + (k.size || 0) + 2); }
    if (on(L, "outerGlow")) { k = eff(L, "outerGlow"); p = Math.max(p, (k.size || 0) * 1.5 + 2); }
    if (on(L, "innerGlow")) { k = eff(L, "innerGlow"); p = Math.max(p, (k.size || 0) + 2); }
    if (on(L, "bevel")) { k = eff(L, "bevel"); p = Math.max(p, (k.size || 0) * 2.5 + 2); }
    if (on(L, "satin")) { k = eff(L, "satin"); p = Math.max(p, (k.dist || 0) + (k.size || 0) + 2); }
    if (on(L, "stroke")) { k = eff(L, "stroke"); p = Math.max(p, (k.size || 0) + 2); }
    return Math.ceil(Math.min(p, 800));
  }
  var NAT = PIX.BLEND_NATIVE;
  function gco(b) { return NAT[b] || "source-over"; }
  var BOUNDS = new WeakMap();
  function contentBounds(img) {
    var v = PE.ver(img), hit = BOUNDS.get(img);
    if (hit && hit.v === v && hit.w === img.width) return hit.b;
    var b = PIX.alphaBounds(PE.getData(img)); BOUNDS.set(img, { v: v, w: img.width, b: b }); return b;
  }
  var CACHE = new WeakMap();
  // live: while painting this layer, heavy effects are computed at lower resolution (the final render is full size).
  function styled(L, P, live) {
    var key = PE.ver(P.img) + "@" + P.x + "," + P.y + ":" + P.img.width + "x" + P.img.height + ":" + JSON.stringify(L.fx) + ":" + SX.fillOf(L) + (live ? ":live" : ""), hit = CACHE.get(L);
    if (hit && hit.key === key && hit.src === P.img) return Object.assign({}, hit.out, { m: P.m });
    var ab = live ? { x: 0, y: 0, w: P.img.width, h: P.img.height } : contentBounds(P.img);
    if (!ab) return P;
    var pad = padFor(L), W = ab.w + 2 * pad, H = ab.h + 2 * pad, ox = P.x + ab.x - pad, oy = P.y + ab.y - pad, i;
    if (W * H > 40e6) return P;
    var block = PE.mk(W, H), bc = PE.cx2(block);
    bc.drawImage(P.img, pad - ab.x, pad - ab.y);
    // heavy planes at scale k (1 normally, smaller while painting): a2 is W2 x H2
    var k = live && W * H > 2.5e5 ? Math.sqrt(2.5e5 / (W * H)) : 1, W2 = Math.max(1, Math.round(W * k)), H2 = Math.max(1, Math.round(H * k)), a2, a;
    if (k < 1) { var sm = PE.mk(W2, H2), sx = PE.cx2(sm); sx.drawImage(block, 0, 0, W2, H2); var sd = sx.getImageData(0, 0, W2, H2).data; a2 = new Float32Array(W2 * H2); for (i = 0; i < a2.length; i++) a2[i] = sd[i * 4 + 3] / 255; }
    else { var px = bc.getImageData(0, 0, W, H).data; a = a2 = new Float32Array(W * H); for (i = 0; i < a.length; i++) a[i] = px[i * 4 + 3] / 255; }
    var fill = SX.fillOf(L);
    if (fill < 1) { bc.globalCompositeOperation = "copy"; bc.globalAlpha = fill; bc.drawImage(P.img, pad - ab.x, pad - ab.y); bc.globalAlpha = 1; bc.globalCompositeOperation = "source-over"; }
    var behind = [], after = [], e;
    function sc(e0) { if (k === 1) return e0; var o = Object.assign({}, e0); ["size", "dist", "soften"].forEach(function (f) { if (o[f]) o[f] *= k; }); return o; }
    function full(plane, color) { var c = planeCanvas(plane, W2, H2, color); if (k === 1) return c; var u = PE.mk(W, H), ux = PE.cx2(u); ux.imageSmoothingQuality = "high"; ux.drawImage(c, 0, 0, W, H); return u; }
    function part(list, plane, color, blend, op) { list.push({ img: full(plane, color), x: ox, y: oy, blend: blend, alpha: op }); }
    function inside(plane, color, blend, op, fullRes) { bc.save(); bc.globalCompositeOperation = gco(blend); bc.globalAlpha = op; bc.drawImage(fullRes ? planeCanvas(plane, W, H, color) : full(plane, color), 0, 0); bc.restore(); }
    if (on(L, "dropShadow")) { e = eff(L, "dropShadow"); part(behind, FXM.dropShadow(a2, W2, H2, sc(e)), e.color, e.blend, e.op); }
    if (on(L, "outerGlow")) { e = eff(L, "outerGlow"); part(behind, FXM.outerGlow(a2, W2, H2, sc(e)), e.color, e.blend, e.op); }
    if (on(L, "innerShadow")) { e = eff(L, "innerShadow"); inside(FXM.innerShadow(a2, W2, H2, sc(e)), e.color, e.blend, e.op); }
    if (on(L, "innerGlow")) { e = eff(L, "innerGlow"); inside(FXM.innerGlow(a2, W2, H2, sc(e)), e.color, e.blend, e.op); }
    if (on(L, "satin")) { e = eff(L, "satin"); inside(FXM.satin(a2, W2, H2, sc(e)), e.color, e.blend, e.op); }
    var shape = null;
    function shapeC() { if (shape) return shape; shape = PE.mk(W, H); var x = PE.cx2(shape); x.drawImage(P.img, pad - ab.x, pad - ab.y); return shape; }   // the layer's own alpha
    if (on(L, "patternOverlay")) {
      e = eff(L, "patternOverlay");
      var pc = PE.mk(W, H), px2 = PE.cx2(pc), pat = px2.createPattern(tile(e.pattern), "repeat"), sc = Math.max(0.05, (e.scale || 100) / 100);
      if (pat.setTransform) pat.setTransform(new DOMMatrix([sc, 0, 0, sc, -ox % (24 * sc), -oy % (24 * sc)]));
      px2.fillStyle = pat; px2.fillRect(0, 0, W, H); px2.globalCompositeOperation = "source-in"; px2.fillStyle = e.color; px2.fillRect(0, 0, W, H);
      px2.globalCompositeOperation = "destination-in"; px2.drawImage(shapeC(), 0, 0);
      bc.save(); bc.globalCompositeOperation = gco(e.blend); bc.globalAlpha = e.op; bc.drawImage(pc, 0, 0); bc.restore();
    }
    if (on(L, "gradOverlay")) {
      e = eff(L, "gradOverlay");
      var gc = PE.mk(W, H), gx = PE.cx2(gc), cx = pad + ab.w / 2, cy = pad + ab.h / 2, t = (e.angle || 0) * Math.PI / 180, sc2 = Math.max(0.1, (e.scale || 100) / 100);
      var half = (Math.abs(Math.cos(t)) * ab.w + Math.abs(Math.sin(t)) * ab.h) / 2 * sc2, dx = Math.cos(t) * half, dy = -Math.sin(t) * half, c0 = e.reverse ? e.to : e.from, c1 = e.reverse ? e.from : e.to, g;
      if (e.style === "radial") { g = gx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.hypot(ab.w, ab.h) / 2 * sc2)); g.addColorStop(0, c0); g.addColorStop(1, c1); }
      else if (e.style === "reflected") { g = gx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy); g.addColorStop(0, c1); g.addColorStop(0.5, c0); g.addColorStop(1, c1); }
      else { g = gx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy); g.addColorStop(0, c0); g.addColorStop(1, c1); }
      gx.fillStyle = g; gx.fillRect(0, 0, W, H); gx.globalCompositeOperation = "destination-in"; gx.drawImage(shapeC(), 0, 0);
      bc.save(); bc.globalCompositeOperation = gco(e.blend); bc.globalAlpha = e.op; bc.drawImage(gc, 0, 0); bc.restore();
    }
    if (on(L, "colorOverlay")) { e = eff(L, "colorOverlay"); var co = PE.mk(W, H), cx2 = PE.cx2(co); cx2.drawImage(shapeC(), 0, 0); cx2.globalCompositeOperation = "source-in"; cx2.fillStyle = e.color; cx2.fillRect(0, 0, W, H); bc.save(); bc.globalCompositeOperation = gco(e.blend); bc.globalAlpha = e.op; bc.drawImage(co, 0, 0); bc.restore(); }
    if (on(L, "bevel")) {
      e = eff(L, "bevel"); var bv = FXM.bevel(a2, W2, H2, sc(e));
      if (e.style === "inner") { inside(bv.sh, e.shColor, e.shBlend, e.shOp); inside(bv.hi, e.hiColor, e.hiBlend, e.hiOp); }
      else { part(after, bv.sh, e.shColor, e.shBlend, e.shOp); part(after, bv.hi, e.hiColor, e.hiBlend, e.hiOp); }
    }
    if (on(L, "stroke")) { e = eff(L, "stroke"); part(after, FXM.stroke(a2, W2, H2, sc(e)), e.color, e.blend, e.op); }
    PE.touch(block);
    var out = { img: block, x: ox, y: oy, alpha: 1, behind: behind, after: after };
    CACHE.set(L, { key: key, src: P.img, out: out });
    return Object.assign({}, out, { m: P.m });
  }
  SX.styled = styled;
  SX.prepExt.push(function (R, L, P, o) { return o.noFx || !SX.fxOn(L) ? P : styled(L, P, !!(R.opts.over && R.opts.over[L.id] && !R.opts.over[L.id].m)); });

  // ---------- the style panel (floating, live) ----------
  var panel = null;
  function blendSel(label, val, onSet) { return ED.ui.w.select(label, PIX.BLEND_LIST.filter(function (m) { return NAT[m[0]]; }), val, onSet); }
  function color(label, val, onSet) { var c = h("input", { type: "color", value: val }); c.addEventListener("input", function () { onSet(c.value); }); return ED.ui.w.field(label, c); }
  function controls(k, e, set) {
    var w = ED.ui.w, pct = w.pct, px = w.px, deg = function (v) { return v + "°"; }, out = [];
    function R(key, label, min, max, step, fmt) { out.push(w.range(label, e[key], min, max, step, function (v) { set(key, v); }, fmt)); }
    if (k === "bevel") {
      out.push(w.select("Style", [["inner", "Inner bevel"], ["outer", "Outer bevel"], ["emboss", "Emboss"], ["pillow", "Pillow emboss"]], e.style, function (v) { set("style", v); }));
      R("depth", "Depth", 1, 1000, 1, function (v) { return v + "%"; }); out.push(w.seg("Direction", [["up", "Up"], ["down", "Down"]], e.dir, function (v) { set("dir", v); }));
      R("size", "Size", 0, 250, 1, px); R("soften", "Soften", 0, 16, 1, px); R("angle", "Angle", -180, 180, 1, deg); R("altitude", "Altitude", 0, 90, 1, deg);
      out.push(blendSel("Highlight", e.hiBlend, function (v) { set("hiBlend", v); }), color("Highlight colour", e.hiColor, function (v) { set("hiColor", v); })); R("hiOp", "Highlight opacity", 0, 1, 0.01, pct);
      out.push(blendSel("Shadow", e.shBlend, function (v) { set("shBlend", v); }), color("Shadow colour", e.shColor, function (v) { set("shColor", v); })); R("shOp", "Shadow opacity", 0, 1, 0.01, pct);
      return out;
    }
    if (k === "stroke") { R("size", "Size", 1, 250, 1, px); out.push(w.select("Position", [["outside", "Outside"], ["inside", "Inside"], ["center", "Centre"]], e.pos, function (v) { set("pos", v); })); }
    out.push(blendSel("Blend mode", e.blend, function (v) { set("blend", v); }));
    if (k !== "gradOverlay") out.push(color("Colour", e.color, function (v) { set("color", v); }));
    R("op", "Opacity", 0, 1, 0.01, pct);
    if (k === "dropShadow" || k === "innerShadow") { R("angle", "Angle", -180, 180, 1, deg); R("dist", "Distance", 0, 500, 1, px); R(k === "dropShadow" ? "spread" : "choke", k === "dropShadow" ? "Spread" : "Choke", 0, 100, 1, function (v) { return v + "%"; }); R("size", "Size", 0, 250, 1, px); }
    if (k === "outerGlow") { R("spread", "Spread", 0, 100, 1, function (v) { return v + "%"; }); R("size", "Size", 0, 250, 1, px); }
    if (k === "innerGlow") { out.push(w.seg("Source", [["edge", "Edge"], ["center", "Centre"]], e.source, function (v) { set("source", v); })); R("choke", "Choke", 0, 100, 1, function (v) { return v + "%"; }); R("size", "Size", 0, 250, 1, px); }
    if (k === "satin") { R("angle", "Angle", -180, 180, 1, deg); R("dist", "Distance", 1, 250, 1, px); R("size", "Size", 0, 250, 1, px); out.push(w.check("Invert", e.invert, function (v) { set("invert", v); })); }
    if (k === "gradOverlay") {
      out.push(color("From", e.from, function (v) { set("from", v); }), color("To", e.to, function (v) { set("to", v); }));
      out.push(w.select("Style", [["linear", "Linear"], ["radial", "Radial"], ["reflected", "Reflected"]], e.style, function (v) { set("style", v); }));
      R("angle", "Angle", -180, 180, 1, deg); R("scale", "Scale", 10, 150, 1, function (v) { return v + "%"; }); out.push(w.check("Reverse", e.reverse, function (v) { set("reverse", v); }));
    }
    if (k === "patternOverlay") { out.push(w.select("Pattern", PATTERNS, e.pattern, function (v) { set("pattern", v); })); R("scale", "Scale", 10, 400, 1, function (v) { return v + "%"; }); }
    return out;
  }
  SX.openStyle = function (L, focus) {
    L = L || ED.layer();
    if (!SX.need() || !L) return;
    if (L.kind === "adjust") { S3.toast("Adjustment layers have no layer style", "error"); return; }
    if (L.kind === "group") { S3.toast("Styles apply to pixel, text, shape and fill layers. Pick a layer inside the group.", "error"); return; }
    if (panel) closePanel(false);
    ED.cancelModes();
    var before = PE.snap(ED.doc), orig = PE.clone(L.fx || null), stage = S3.$("#stage");
    if (!L.fx) L.fx = { on: true };
    var box = h("div", { "class": "pe-float pe-fxpanel", role: "dialog", "aria-label": "Layer style" }), body = h("div", { "class": "pe-fbody" });
    var open = focus || ORDER.filter(function (k) { return on(L, k); })[0] || "dropShadow";
    function changed() { ED.render(); }
    function build() {
      body.textContent = "";
      body.appendChild(ED.ui.w.check("Show effects", L.fx.on !== false, function (v) { L.fx.on = v; changed(); }));
      ORDER.forEach(function (k) {
        var cur = L.fx[k] ? Object.assign({}, DEF[k], L.fx[k]) : Object.assign({}, DEF[k]);
        var cb = h("input", { type: "checkbox", "aria-label": NAMES[k] }); cb.checked = !!(L.fx[k] && L.fx[k].on);
        cb.addEventListener("change", function () { L.fx[k] = Object.assign({}, cur, L.fx[k] || {}, { on: cb.checked }); if (cb.checked) open = k; changed(); build(); });
        var head = h("div", { "class": "pe-fxhead" + (open === k ? " open" : "") }, [cb, h("button", { type: "button", "class": "pe-fxname", "aria-expanded": String(open === k), text: NAMES[k], onclick: function () { open = open === k ? null : k; build(); } })]);
        body.appendChild(head);
        if (open === k) {
          var sec = h("div", { "class": "pe-fxsec" });
          controls(k, cur, function (key, v) { var e2 = L.fx[k] = Object.assign({}, cur, L.fx[k] || {}); e2[key] = v; cur[key] = v; if (!e2.on) { e2.on = true; cb.checked = true; } changed(); }).forEach(function (el) { sec.appendChild(el); });
          body.appendChild(sec);
        }
      });
    }
    var w = ED.ui.w;
    box.appendChild(h("div", { "class": "row between pe-fhead" }, [h("b", { text: "Layer style: " + L.name })]));
    box.appendChild(body);
    box.appendChild(h("div", { "class": "row pe-ffoot" }, [w.btn("Clear", function () { L.fx = { on: true }; changed(); build(); }, "ghost"), h("span", { "class": "grow" }), w.btn("Cancel", function () { closePanel(false); }, "ghost"), w.btn("OK", function () { closePanel(true); }, "primary")]));
    stage.appendChild(box);
    panel = { box: box, L: L, before: before, orig: orig };
    ED.modal = true;
    build(); changed();
  };
  function closePanel(ok) {
    var p = panel; if (!p) return;
    panel = null; ED.modal = false; p.box.remove();
    var L = p.L;
    if (L.fx && !SX.fxOn(L) && !ORDER.some(function (k) { return L.fx[k]; })) delete L.fx;
    if (!ok) { if (p.orig) L.fx = p.orig; else delete L.fx; ED.changed(); return; }
    if (JSON.stringify(p.orig || null) === JSON.stringify(L.fx || null)) { ED.changed(); return; }
    ED.push(PE.metaEntry("Layer style", ED.doc, p.before));
  }
  SX.closeStyle = closePanel;
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (!panel) return false;
    if (e.key === "Escape") { e.preventDefault(); closePanel(false); return true; }
    if (e.key === "Enter" && !ED.isTyping(e)) { e.preventDefault(); closePanel(true); return true; }
    return false;
  });
  ED.on("changed", function (why) { if (panel && (why === "open" || !ED.doc || !PE.findLayer(ED.doc, panel.L.id))) { var p = panel; panel = null; ED.modal = false; p.box.remove(); } });

  // ---------- copy / paste / clear ----------
  var clip = null;
  SX.copyStyle = function () { var L = ED.layer(); if (!L || !L.fx) { S3.toast("This layer has no style to copy", "error"); return; } clip = PE.clone(L.fx); S3.toast("Layer style copied"); };
  SX.pasteStyle = function () {
    if (!clip) { S3.toast("Copy a layer style first", "error"); return; }
    var list = SX.pickedList().filter(function (L) { return L.kind !== "adjust" && L.kind !== "group"; }); if (!list.length) return;
    ED.meta("Paste layer style", function () { list.forEach(function (L) { L.fx = PE.clone(clip); }); });
  };
  SX.clearStyle = function () { var list = SX.pickedList().filter(function (L) { return L.fx; }); if (!list.length) return; ED.meta("Clear layer style", function () { list.forEach(function (L) { delete L.fx; }); }); };
  function hasFx() { var L = ED.layer(); return !!(L && L.fx); }
  SX.menu("Layer", [["Layer style…", "", function () { SX.openStyle(); }, SX.has], ["Copy layer style", "", SX.copyStyle, hasFx], ["Paste layer style", "", SX.pasteStyle, function () { return !!clip && SX.has(); }], ["Clear layer style", "", SX.clearStyle, hasFx]], "Create / release clipping mask");
  document.addEventListener("DOMContentLoaded", function () {
    var foot = S3.$(".pe-lfoot"), m = S3.$("#lMask"); if (!foot || !m) return;
    foot.insertBefore(h("button", { type: "button", "class": "btn ghost icon small", id: "lFx", title: "Layer style (shadow, glow, stroke…)", "aria-label": "Layer style", onclick: function () { SX.openStyle(); } }, [ED.ui.w.svg("t-fx")]), m);
  });

  // ---------- project files (whitelisted fields) ----------
  var BLENDS_OK = function (v) { return typeof v === "string" && NAT[v] ? v : undefined; };
  var ENUMS = { style: ["inner", "outer", "emboss", "pillow", "linear", "radial", "reflected"], dir: ["up", "down"], source: ["edge", "center"], pos: ["outside", "inside", "center"], pattern: PATTERNS.map(function (p) { return p[0]; }) };
  function cleanEffect(k, v) {
    if (!v || typeof v !== "object") return undefined;
    var o = {}, d = DEF[k];
    Object.keys(d).forEach(function (f) {
      var x = v[f], def = d[f];
      if (x === undefined) return;
      if (typeof def === "boolean") o[f] = x === true;
      else if (typeof def === "number") { x = +x; if (isFinite(x)) o[f] = Math.max(-1000, Math.min(1000, x)); }
      else if (/[Bb]lend$/.test(f) || f === "blend") { var b = BLENDS_OK(x); if (b) o[f] = b; }
      else if (/^#/.test(def)) { var c = PE.hex(x, null); if (c) o[f] = c; }
      else if (ENUMS[f] && ENUMS[f].indexOf(x) >= 0) o[f] = x;
    });
    ["op", "hiOp", "shOp"].forEach(function (f) { if (o[f] != null) o[f] = Math.max(0, Math.min(1, o[f])); });
    return o;
  }
  SX.fields.fx = {
    save: function (L) { return L.fx ? PE.clone(L.fx) : undefined; },
    parse: function (v) { if (!v || typeof v !== "object") return undefined; var o = { on: v.on !== false }; ORDER.forEach(function (k) { var e = cleanEffect(k, v[k]); if (e) o[k] = e; }); return o; }
  };

  SX.tests.push(async function (ok, near) {
    var a = new Float32Array(20 * 20); for (var y = 5; y < 15; y++) for (var x = 5; x < 15; x++) a[y * 20 + x] = 1;
    var st = FXM.stroke(a, 20, 20, { size: 2, pos: "outside" }); ok(st[10 * 20 + 3] === 1 && st[10 * 20 + 2] === 0 && st[10 * 20 + 10] === 0, "outside stroke ring");
    var si = FXM.stroke(a, 20, 20, { size: 2, pos: "inside" }); ok(si[10 * 20 + 6] === 1 && si[10 * 20 + 8] === 0 && si[10 * 20 + 4] === 0, "inside stroke ring");
    var ds = FXM.dropShadow(a, 20, 20, { angle: 180, dist: 3, size: 0, spread: 0 }); ok(ds[10 * 20 + 16] === 1 && ds[10 * 20 + 6] === 0, "drop shadow offset away from the light");
    var ish = FXM.innerShadow(a, 20, 20, { angle: 180, dist: 2, size: 0, choke: 0 }); ok(ish[10 * 20 + 5] === 1 && ish[10 * 20 + 12] === 0 && ish[10 * 20 + 3] === 0, "inner shadow stays inside");
    var bv = FXM.bevel(a, 20, 20, { size: 3, angle: 180, altitude: 30, style: "inner" }); ok(bv.hi[10 * 20 + 5] > 0.2 && bv.sh[10 * 20 + 14] > 0.2 && bv.hi[10 * 20 + 14] === 0, "bevel lights the side facing the light");
    // end to end: red square with a black outside stroke over white
    var bg = PE.rasterFromCanvas(SX.solid(20, 20, "#ffffff"), "bg"), sq = PE.mk(20, 20); PE.cx2(sq).fillStyle = "#ff0000"; PE.cx2(sq).fillRect(5, 5, 10, 10);
    var L = PE.rasterFromCanvas(PE.touch(sq), "sq"), d = SX.scratch(20, 20, [bg, L]);
    L.fx = { on: true, stroke: { on: true, size: 2, pos: "outside", color: "#000000", op: 1, blend: "normal" } };
    var f = PE.flatten(d); ok(SX.px(f, 3, 10).join() === "0,0,0,255" && SX.px(f, 10, 10).join() === "255,0,0,255" && SX.px(f, 1, 10).join() === "255,255,255,255", "stroke renders around the layer");
    L.fillOp = 0; L.fx.colorOverlay = { on: true, color: "#00ff00", op: 1, blend: "normal" };
    f = PE.flatten(d); ok(SX.px(f, 10, 10).join() === "0,255,0,255", "overlays ignore fill opacity");
    L.fillOp = 1; L.fx = { on: true, dropShadow: { on: true, color: "#000000", op: 1, blend: "multiply", angle: 180, dist: 4, spread: 0, size: 0 } };
    f = PE.flatten(d); ok(SX.px(f, 17, 10).join() === "0,0,0,255" && SX.px(f, 12, 10)[0] === 255, "drop shadow behind the layer");
    L.fx.on = false; ok(SX.px(PE.flatten(d), 17, 10)[0] === 255, "effects can be hidden");
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer())); ok(od.layers[1].fx && od.layers[1].fx.dropShadow.dist === 4 && od.layers[1].fx.on === false, "styles round-trip");
    var bad = SX.fields.fx.parse({ stroke: { size: "9e9", color: "red;x", blend: "javascript:", pos: "everywhere" }, evil: { on: true } });
    ok(bad.stroke.size === 1000 && !bad.stroke.color && !bad.stroke.blend && !bad.stroke.pos && !bad.evil, "style fields from files are whitelisted");
  });
})();
