/* Selection lane: fill layers (kind "fill"): a solid colour, gradient or pattern that fills the canvas, edited any
   time in Properties. It has a mask (from the selection when there is one), and blends, clips and takes styles
   like any layer. Painting on it paints its mask. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, h = S3.h;
  PE.kindsExt.push("fill");
  var TYPES = [["solid", "Solid colour"], ["gradient", "Gradient"], ["pattern", "Pattern"]];
  function spec(type, d) {
    if (type === "gradient") return { type: "gradient", from: d.fg, to: d.bg, style: "linear", angle: 90, scale: 100, reverse: false, fade: false };
    if (type === "pattern") return { type: "pattern", pattern: "dots", color: d.fg, bg: "#ffffff", scale: 100 };
    return { type: "solid", color: d.fg };
  }
  function draw(c, s, w, hh) {
    if (s.type === "gradient") {
      var cx = w / 2, cy = hh / 2, t = (s.angle || 0) * Math.PI / 180, sc = Math.max(0.1, (s.scale || 100) / 100), half = (Math.abs(Math.cos(t)) * w + Math.abs(Math.sin(t)) * hh) / 2 * sc;
      var dx = Math.cos(t) * half, dy = -Math.sin(t) * half, c0 = s.reverse ? s.to : s.from, c1 = s.reverse ? s.from : s.to, g;
      function stop(col, a) { var q = PE.rgbOf(col); return "rgba(" + q.join(",") + "," + a + ")"; }
      var a0 = s.fade && s.reverse ? 0 : 1, a1 = s.fade && !s.reverse ? 0 : 1;
      if (s.style === "radial") g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.hypot(w, hh) / 2 * sc));
      else g = c.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      if (s.style === "reflected") { g.addColorStop(0, stop(c1, a1)); g.addColorStop(0.5, stop(c0, a0)); g.addColorStop(1, stop(c1, a1)); }
      else { g.addColorStop(0, stop(c0, a0)); g.addColorStop(1, stop(c1, a1)); }
      c.fillStyle = g; c.fillRect(0, 0, w, hh); return;
    }
    if (s.type === "pattern") {
      if (s.bg) { c.fillStyle = s.bg; c.fillRect(0, 0, w, hh); }
      var tc = PE.mk(24, 24), tx = PE.cx2(tc); tx.drawImage(SX.patternTile(s.pattern), 0, 0); tx.globalCompositeOperation = "source-in"; tx.fillStyle = s.color; tx.fillRect(0, 0, 24, 24);
      var pat = c.createPattern(tc, "repeat"), k = Math.max(0.05, (s.scale || 100) / 100);
      if (pat.setTransform) pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
      c.fillStyle = pat; c.fillRect(0, 0, w, hh); return;
    }
    c.fillStyle = s.color || "#000000"; c.fillRect(0, 0, w, hh);
  }
  var CACHE = new WeakMap();
  PE.surfaceExt.fill = function (L, doc) {
    var s = L.fillSpec || { type: "solid", color: "#000000" }, key = JSON.stringify(s) + doc.w + "x" + doc.h, hit = CACHE.get(L);
    if (hit && hit.key === key) return hit.s;
    var c = PE.mk(doc.w, doc.h); draw(PE.cx2(c), s, doc.w, doc.h);
    var out = { canvas: PE.touch(c), x: 0, y: 0 }; CACHE.set(L, { key: key, s: out }); return out;
  };
  PE.vboxExt.fill = function () { var d = ED.doc; return { x: 0, y: 0, w: d.w, h: d.h, rot: 0, fx: false, fy: false }; };
  PE.xfExt.fill = function () {};
  var ed0 = PE.editableExt;
  PE.editableExt = function (L, need) {
    if (ed0 && !ed0(L, need)) return false;
    if (L.kind === "fill" && need === "pixels") {
      if (!L.mask) { S3.toast("Fill layers are edited in Properties. Add a mask to paint where it shows, or rasterize it.", "error"); return false; }
      if (!ED.maskEdit) { ED.maskEdit = true; ED.emit("layers"); }
    }
    return true;
  };

  SX.newFill = function (type) {
    if (!SX.need()) return;
    var d = ED.doc, L = PE.newLayer("fill", { name: TYPES.filter(function (t) { return t[0] === type; })[0][1] + " fill" });
    L.canvas = null; L.fillSpec = spec(type, d);
    L.mask = d.sel ? PE.maskFromSel(d) : PE.whiteMask(d); L.maskOn = true;
    SX.insertAbove(L, "New fill layer", function () { d.sel = null; });    // the selection became its mask
  };
  SX.chooseFill = function () {
    if (!SX.need()) return;
    var grid = h("div", { "class": "pe-adjgrid" }), dlg;
    TYPES.forEach(function (t) { grid.appendChild(h("button", { type: "button", "class": "pe-preset", onclick: function () { dlg.close(); SX.newFill(t[0]); } }, [h("b", { text: t[1] })])); });
    dlg = ED.ui.w.modal("New fill layer", h("div", { "class": "stack" }, [h("p", { "class": "faint pe-p", text: "A colour, gradient or pattern you can change any time in Properties." + (ED.doc.sel ? " Its mask starts from your selection." : "") }), grid]), null);
  };

  // ---------- Properties ----------
  SX.props.fill = function (P, L) {
    var w = ED.ui.w, s = L.fillSpec = L.fillSpec || spec("solid", ED.doc), edit = function (fn) { SX.liveEdit({ adj: { op: "fill" } }, fn); };
    function color(label, key) { var c = h("input", { type: "color", value: s[key] || "#000000" }); c.addEventListener("input", function () { edit(function () { s[key] = c.value; }); }); return h("label", { "class": "pe-pf pe-pcol" }, [h("span", { text: label }), c]); }
    P.appendChild(h("div", { "class": "pe-phead" }, [w.svg("t-mask"), h("b", { text: L.name }), h("span", { "class": "faint", text: "Fill layer" })]));
    var box = h("div", { "class": "pe-adjbox" });
    box.appendChild(w.seg("", TYPES, s.type, function (v) { ED.meta("Fill type", function () { var n = spec(v, ED.doc); if (v === "solid" && s.color) n.color = s.color; L.fillSpec = n; }); }));
    if (s.type === "solid") box.appendChild(color("Colour", "color"));
    if (s.type === "gradient") {
      box.appendChild(h("div", { "class": "pe-pgrid" }, [color("From", "from"), color("To", "to")]));
      box.appendChild(w.select("Style", [["linear", "Linear"], ["radial", "Radial"], ["reflected", "Reflected"]], s.style, function (v) { edit(function () { s.style = v; }); }));
      box.appendChild(w.range("Angle", s.angle, -180, 180, 1, function (v) { edit(function () { s.angle = v; }); }, function (v) { return v + "°"; }));
      box.appendChild(w.range("Scale", s.scale, 10, 200, 1, function (v) { edit(function () { s.scale = v; }); }, function (v) { return v + "%"; }));
      box.appendChild(h("div", { "class": "pe-prow" }, [w.check("Reverse", s.reverse, function (v) { edit(function () { s.reverse = v; }); }), w.check("Fade to transparent", s.fade, function (v) { edit(function () { s.fade = v; }); })]));
    }
    if (s.type === "pattern") {
      box.appendChild(w.select("Pattern", SX.PATTERNS, s.pattern, function (v) { edit(function () { s.pattern = v; }); }));
      box.appendChild(h("div", { "class": "pe-pgrid" }, [color("Colour", "color"), color("Background", "bg")]));
      box.appendChild(w.range("Scale", s.scale, 10, 400, 1, function (v) { edit(function () { s.scale = v; }); }, function (v) { return v + "%"; }));
    }
    P.appendChild(box);
    P.appendChild(h("div", { "class": "pe-prow" }, [w.btn("Rasterize", function () { ED.rasterize(L, true); }, "ghost"), L.mask ? null : w.btn("Add mask", function () { ED.LOPS.addMask(!!ED.doc.sel); }, "ghost", "t-mask")]));
    SX.maskProps(P, L);
  };

  // ---------- project files ----------
  var ENUM = { type: ["solid", "gradient", "pattern"], style: ["linear", "radial", "reflected"], pattern: SX.PATTERNS.map(function (p) { return p[0]; }) };
  SX.fields.fillSpec = {
    save: function (L) { return L.kind === "fill" && L.fillSpec ? PE.clone(L.fillSpec) : undefined; },
    parse: function (v, out) {
      if (out.kind !== "fill" || !v || typeof v !== "object") return undefined;
      var o = { type: ENUM.type.indexOf(v.type) >= 0 ? v.type : "solid" };
      ["color", "from", "to", "bg"].forEach(function (k) { var c = PE.hex(v[k], null); if (c) o[k] = c; });
      ["angle", "scale"].forEach(function (k) { var n = SX.num(v[k], -1000, 1000); if (n !== undefined) o[k] = n; });
      ["reverse", "fade"].forEach(function (k) { if (v[k] === true) o[k] = true; });
      ["style", "pattern"].forEach(function (k) { if (ENUM[k].indexOf(v[k]) >= 0) o[k] = v[k]; });
      return o;
    }
  };
  SX.menu("Layer", [["New fill layer…", "", SX.chooseFill, SX.has]], "New adjustment layer…");

  SX.tests.push(async function (ok, near) {
    var d = SX.scratch(20, 10, [PE.rasterFromCanvas(SX.solid(20, 10, "#ffffff"), "bg")]); d.fg = "#ff0000"; d.bg = "#0000ff";
    d.sel = PE.makeSel(d, window.PIX.rectMask(20, 10, 0, 0, 10, 10));
    SX.newFill("solid"); var F = d.layers[1];
    ok(F.kind === "fill" && F.mask && SX.px(PE.flatten(d), 2, 2).join() === "255,0,0,255" && SX.px(PE.flatten(d), 15, 2).join() === "255,255,255,255", "solid fill layer, masked by the selection");
    ED.meta("g", function () { F.fillSpec = { type: "gradient", from: "#000000", to: "#ffffff", style: "linear", angle: 0, scale: 100 }; });
    var f = PE.flatten(d); ok(SX.px(f, 0, 5)[0] < 40 && SX.px(f, 9, 5)[0] > 100, "gradient fill");
    ED.undo(); ok(F.fillSpec.type === "solid", "undo fill change");
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer())); ok(od.layers[1].kind === "fill" && od.layers[1].fillSpec.color === "#ff0000", "fill layers round-trip");
    ok(SX.fields.fillSpec.parse({ type: "x", color: "url(a)", pattern: "<b>" }, { kind: "fill" }).type === "solid", "fill fields whitelisted");
  });
})();
