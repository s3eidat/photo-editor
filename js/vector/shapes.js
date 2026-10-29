/* Vector lane: shape tool upgrade. Rectangle (rounded), ellipse, triangle, polygon (any number of sides), star
   (points and indent), line with arrowheads, arrow and a library of custom shapes, all as live shape layers with
   fill, stroke colour, width, dash pattern, alignment (inside / centre / outside), caps and joins. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, VG = PE.VG, UI = VX.ui, h = S3.h;
  var TYPES = [["rect", "Rectangle"], ["ellipse", "Ellipse"], ["triangle", "Triangle"], ["polygon", "Polygon"], ["star", "Star"], ["line", "Line"], ["arrow", "Arrow"], ["custom", "Custom shape"]];
  var DASH_OPTS = [["solid", "Solid"], ["dash", "Dashed"], ["dot", "Dotted"], ["dashdot", "Dash dot"], ["long", "Long dash"]];
  var o = ED.o.shape;
  [["fill", "#3dd6d0"], ["sides", 6], ["starSides", 5], ["indent", 0.5], ["dash", "solid"], ["align", "center"], ["arrowS", false], ["arrowE", false], ["lib", "heart"], ["cap", "round"], ["join", "round"]]
    .forEach(function (d) { if (o[d[0]] === undefined) o[d[0]] = d[1]; });

  function dashKey(arr) { if (!arr || !arr.length) return "solid"; var j = JSON.stringify(arr); for (var k in VX.DASHES) if (JSON.stringify(VX.DASHES[k]) === j) return k; return "custom"; }
  VX.dashKey = dashKey;
  // extra fields a new shape gets from the tool options
  function styleNew(S) {
    var d = VX.DASHES[o.dash]; if (d) S.dash = d.slice();
    if (o.align && o.align !== "center" && S.type !== "line") S.align = o.align;
    if (o.cap && o.cap !== "round") S.cap = o.cap;
    if (o.join && o.join !== "round") S.join = o.join;
  }

  // ---------- creation: wrap the core shape tool ----------
  var T = ED.TOOLS.shape, down0 = T.down;
  T.down = function (p, e) {
    var type = o.type;
    if (type === "custom" || type === "polygon") o.type = "rect";      // core creates a box we then re-type
    try { down0(p, e); } finally { o.type = type; }
    var dr = ED.drag; if (!dr || !dr.L) return;
    var S = dr.L.shape;
    if (S.type !== "line") S.fill = o.noFill ? "" : PE.hex(o.fill, ED.doc.fg); else S.stroke = PE.hex(o.stroke, ED.doc.fg);
    if (type === "polygon") { S.type = "polygon"; S.sides = o.sides; dr.L.name = "Polygon"; }
    if (type === "star") { S.sides = o.starSides; S.indent = o.indent; }
    if (type === "custom") { S.type = "path"; S.comps = VG.libComps(o.lib) || VG.libComps("heart"); S.lib = o.lib; dr.L.name = (VG.LIB.filter(function (x) { return x[0] === o.lib; })[0] || [0, "Shape"])[1]; }
    if (type === "line") { if (o.arrowS) S.arrowS = true; if (o.arrowE) S.arrowE = true; }
    if (type !== "rect" && type !== "polygon") delete S.radius;
    styleNew(S);
    ED.emit("layers");
  };

  // ---------- options bar ----------
  UI.opts("shape", function (items) {
    var w = ED.ui.w, out = [items[0]];
    out.push(w.seg("", TYPES.map(function (t) { return [t[0], t[1], t[1], "s-" + t[0]]; }), o.type, function (v) { o.type = v; ED.saveOpts(); ED.ui.buildOpts(); }));
    if (o.type !== "line") {
      out.push(h("span", { "class": "pe-of" }, [h("span", { text: "Fill" }), UI.color("", o.fill, function (v) { o.fill = v; o.noFill = false; ED.saveOpts(); }, "Fill colour"),
        w.btn("", function () { o.fill = ED.doc ? ED.doc.fg : o.fill; o.noFill = false; ED.saveOpts(); ED.ui.buildOpts(); }, "ghost icon", "t-reset", "Use the foreground colour")]));
      out.push(w.check("No fill", o.noFill, function (v) { o.noFill = v; ED.saveOpts(); }));
    }
    out.push(h("span", { "class": "pe-of" }, [h("span", { text: o.type === "line" ? "Colour" : "Stroke" }), UI.color("", o.stroke, function (v) { o.stroke = v; ED.saveOpts(); }, "Stroke colour")]));
    out.push(w.field(o.type === "line" ? "Weight" : "Width", w.numInput(o.sw, 0, 500, function (v) { o.sw = v; ED.saveOpts(); }), "pe-num"));
    out.push(w.select("Dash", DASH_OPTS, o.dash, function (v) { o.dash = v; ED.saveOpts(); }));
    if (o.type !== "line") out.push(w.select("Align", [["inside", "Inside"], ["center", "Centre"], ["outside", "Outside"]], o.align, function (v) { o.align = v; ED.saveOpts(); }));
    if (o.type === "rect" || o.type === "polygon") out.push(w.field("Radius", w.numInput(o.radius || 0, 0, 5000, function (v) { o.radius = v; ED.saveOpts(); }), "pe-num"));
    if (o.type === "polygon") out.push(w.field("Sides", w.numInput(o.sides, 3, 100, function (v) { o.sides = v; ED.saveOpts(); }), "pe-num"));
    if (o.type === "star") {
      out.push(w.field("Points", w.numInput(o.starSides, 3, 100, function (v) { o.starSides = v; ED.saveOpts(); }), "pe-num"));
      out.push(w.field("Indent %", w.numInput(Math.round(o.indent * 100), 1, 99, function (v) { o.indent = v / 100; ED.saveOpts(); }), "pe-num"));
    }
    if (o.type === "line") {
      out.push(w.check("Start arrow", o.arrowS, function (v) { o.arrowS = v; ED.saveOpts(); }));
      out.push(w.check("End arrow", o.arrowE, function (v) { o.arrowE = v; ED.saveOpts(); }));
    }
    if (o.type === "custom") out.push(libPicker(o.lib, function (id) { o.lib = id; ED.saveOpts(); ED.ui.buildOpts(); }));
    out.push(h("span", { "class": "pe-hint", text: "Drag to draw (Shift = square / 15° steps, Alt = from centre). Edit anchors with the direct-selection tool (A)." }));
    return out;
  });
  // grid of custom shapes, each drawn from its own path
  function libThumb(id, size) {
    var c = h("canvas", { width: String(size * 2), height: String(size * 2), "class": "pe-vlibc" }), x = c.getContext("2d"), cs = VG.libComps(id);
    x.scale(size * 2 / 100, size * 2 / 100); x.translate(8, 8); x.scale(0.84, 0.84);
    x.beginPath(); VG.trace(x, VX.unitToBox(cs, { x: 0, y: 0, w: 100, h: 100 }));
    x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#ddd"; x.fill("nonzero");
    return c;
  }
  VX.libThumb = libThumb;
  function libPicker(cur, onPick) {
    var wrap = h("div", { "class": "pe-vlibw" }), pop = h("div", { "class": "pe-vlib", role: "listbox", "aria-label": "Custom shapes", hidden: true });
    var name = (VG.LIB.filter(function (x) { return x[0] === cur; })[0] || VG.LIB[0])[1];
    var b = h("button", { type: "button", "class": "btn small ghost pe-vlibb", "aria-haspopup": "listbox", title: "Choose a custom shape" }, [libThumb(cur, 12), name]);
    VG.LIB.forEach(function (e) {
      var it = h("button", { type: "button", "class": "pe-vlibi", role: "option", "aria-selected": String(e[0] === cur), title: e[1], "aria-label": e[1] }, [libThumb(e[0], 18)]);
      it.addEventListener("click", function () { pop.hidden = true; onPick(e[0]); });
      pop.appendChild(it);
    });
    b.addEventListener("click", function (ev) { ev.stopPropagation(); pop.hidden = !pop.hidden; });
    document.addEventListener("click", function (ev) { if (!wrap.contains(ev.target)) pop.hidden = true; });
    wrap.appendChild(b); wrap.appendChild(pop);
    return wrap;
  }
  VX.libPicker = libPicker;

  // gradient stops: colour, position, opacity; add, remove, reverse
  function stopsEditor(S, live) {
    var box = h("div", { "class": "pe-vstops" }), G = S.grad;
    G.stops.forEach(function (st, i) {
      var col = h("input", { type: "color", "class": "pe-vcol", value: st[1], "aria-label": "Stop colour" });
      col.addEventListener("input", function () { live("Gradient", function () { G.stops[i][1] = col.value; }); });
      var pos = h("input", { type: "number", "class": "input", min: "0", max: "100", value: String(Math.round(st[0] * 100)), "aria-label": "Stop position %", title: "Position %" });
      pos.addEventListener("input", function () { live("Gradient", function () { G.stops[i][0] = PE.clamp(+pos.value / 100, 0, 1); G.stops.sort(function (a, b) { return a[0] - b[0]; }); }); });
      var op = h("input", { type: "number", "class": "input", min: "0", max: "100", value: String(Math.round((st[2] == null ? 1 : st[2]) * 100)), "aria-label": "Stop opacity %", title: "Opacity %" });
      op.addEventListener("input", function () { live("Gradient", function () { G.stops[i][2] = PE.clamp(+op.value / 100, 0, 1); }); });
      var del = ED.ui.w.btn("", function () { if (G.stops.length <= 2) return; live("Gradient", function () { G.stops.splice(i, 1); }); ED.ui.buildProps(); }, "ghost icon", "i-trash", "Remove stop");
      box.appendChild(h("div", { "class": "pe-vstop" }, [col, pos, h("span", { "class": "faint", text: "%" }), op, h("span", { "class": "faint", text: "α" }), del]));
    });
    box.appendChild(h("div", { "class": "pe-prow" }, [
      ED.ui.w.btn("Add stop", function () { live("Gradient", function () { var a = G.stops[G.stops.length - 2], b = G.stops[G.stops.length - 1]; G.stops.splice(G.stops.length - 1, 0, [(a[0] + b[0]) / 2, a[1], 1]); }); ED.ui.buildProps(); }, "ghost"),
      ED.ui.w.btn("Reverse", function () { live("Gradient", function () { G.stops = G.stops.map(function (q) { return [1 - q[0], q[1], q[2]]; }).reverse(); }); ED.ui.buildProps(); }, "ghost")]));
    return box;
  }

  // ---------- Properties panel for shape layers ----------
  UI.props(function (P, L) {
    if (!L || L.kind !== "shape") return;
    // replace the basic shape block (between the header and the mask section) with the full one
    var kids = Array.prototype.slice.call(P.children), stop = kids.findIndex(function (k) { return k.tagName === "H3"; });
    kids.slice(1, stop < 0 ? kids.length : stop).forEach(function (k) { k.remove(); });
    var at = P.children[1] || null, S = L.shape, line = S.type === "line", live = UI.live;
    function E(label, f) { return function (v) { live(label, function () { f(v); }); }; }
    var tsel = h("select", { "class": "select", "aria-label": "Shape" }), cur = S.type === "path" ? "path" : S.type;
    TYPES.filter(function (t) { return t[0] !== "custom"; }).concat([["path", "Path"]]).forEach(function (t) { var op = h("option", { value: t[0], text: t[1] }); if (t[0] === cur) op.selected = true; tsel.appendChild(op); });
    tsel.addEventListener("change", function () {
      var v = tsel.value;
      if (v === "path") { live("Convert to path", function () { VX.setDocComps(L, VX.docComps(L)); }); ED.ui.buildProps(); return; }
      live("Shape type", function () { S.type = v; delete S.comps; delete S.lib; if (v === "polygon" && !S.sides) S.sides = 6; if (v === "star" && !S.sides) { S.sides = 5; S.indent = 0.5; } });
      ED.ui.buildProps();
    });
    var g1 = h("div", { "class": "pe-pgrid" }, [h("label", { "class": "pe-pf pe-span2" }, [h("span", { text: "Shape" }), tsel]),
      UI.pnum("X", S.x, E("Move", function (v) { S.x = v; })), UI.pnum("Y", S.y, E("Move", function (v) { S.y = v; })),
      UI.pnum("W", S.w, E("Resize", function (v) { S.w = v; }), 1, 1, 3 * PE.LIM.side), UI.pnum("H", S.h, E("Resize", function (v) { S.h = v; }), 1, 1, 3 * PE.LIM.side),
      UI.pnum("Rotation", S.rot || 0, E("Rotate", function (v) { S.rot = v; }), 1, -360, 360)]);
    if (S.type === "rect" || S.type === "polygon" || S.type === "star") g1.appendChild(UI.pnum("Corner radius", S.radius || 0, E("Radius", function (v) { S.radius = v; }), 1, 0, 1e4));
    if (S.type === "polygon" || S.type === "star") {
      g1.appendChild(UI.pnum(S.type === "star" ? "Points" : "Sides", S.sides || 5, E("Sides", function (v) { S.sides = Math.round(v); }), 1, 3, 100));
      g1.appendChild(UI.pnum("Star indent %", Math.round((S.indent == null ? (S.type === "star" ? 0.5 : 0) : S.indent) * 100), E("Star indent", function (v) { S.indent = v / 100; if (S.type === "polygon" && v > 0) S.type = "star"; }), 1, 0, 99));
    }
    P.insertBefore(g1, at);
    // appearance
    P.insertBefore(h("h3", { text: "Appearance" }), at);
    var g2 = h("div", { "class": "pe-pgrid" });
    if (!line && S.fill) {
      g2.appendChild(UI.psel("Fill type", [["solid", "Solid colour"], ["linear", "Linear gradient"], ["radial", "Radial gradient"]], S.grad ? S.grad.type : "solid", function (v) {
        live("Fill type", function () { if (v === "solid") delete S.grad; else S.grad = S.grad ? Object.assign(S.grad, { type: v }) : { type: v, angle: 0, scale: 1, stops: [[0, S.fill, 1], [1, ED.doc.bg, 1]] }; }); ED.ui.buildProps(); }));
    }
    if (!line && S.grad && S.fill) {
      g2.appendChild(UI.pnum(S.grad.type === "radial" ? "Size %" : "Angle °", S.grad.type === "radial" ? Math.round((S.grad.scale || 1) * 100) : S.grad.angle || 0, E("Gradient", function (v) { if (S.grad.type === "radial") S.grad.scale = Math.max(0.1, v / 100); else S.grad.angle = v; }), 1, -360, 1000));
    } else if (!line) {
      g2.appendChild(S.fill ? UI.pcolor("Fill", S.fill, E("Fill", function (v) { S.fill = v; })) : h("span", { "class": "pe-pf faint", text: "No fill" }));
      g2.appendChild(UI.pnum("Fill opacity %", Math.round((S.fillOp == null ? 1 : S.fillOp) * 100), E("Fill opacity", function (v) { S.fillOp = v / 100; if (S.fillOp >= 1) delete S.fillOp; }), 1, 0, 100));
    }
    g2.appendChild(UI.pcolor(line ? "Colour" : "Stroke", S.stroke, E("Stroke", function (v) { S.stroke = v; })));
    g2.appendChild(UI.pnum(line ? "Weight" : "Stroke width", S.sw || 0, E("Stroke width", function (v) { S.sw = v; }), 1, 0, 500));
    var dk = dashKey(S.dash);
    g2.appendChild(UI.psel("Dash", DASH_OPTS.concat(dk === "custom" ? [["custom", "Custom"]] : []), dk, function (v) { if (v === "custom") return; live("Dash", function () { if (VX.DASHES[v]) S.dash = VX.DASHES[v].slice(); else delete S.dash; }); ED.ui.buildProps(); }));
    var di = h("input", { "class": "input", value: (S.dash || []).join(" "), placeholder: "e.g. 4 2", title: "Dash and gap lengths, in stroke widths" });
    di.addEventListener("change", function () { var a = di.value.split(/[\s,]+/).map(Number).filter(function (v) { return isFinite(v) && v >= 0; }).slice(0, 8); live("Dash", function () { if (a.length && a.some(function (v) { return v > 0; })) S.dash = a; else delete S.dash; }); });
    g2.appendChild(h("label", { "class": "pe-pf" }, [h("span", { text: "Dash pattern" }), di]));
    if (!line) g2.appendChild(UI.psel("Align", [["inside", "Inside"], ["center", "Centre"], ["outside", "Outside"]], S.align || "center", E("Stroke align", function (v) { if (v === "center") delete S.align; else S.align = v; })));
    g2.appendChild(UI.psel("Caps", [["butt", "Butt"], ["round", "Round"], ["square", "Square"]], S.cap || "round", E("Stroke caps", function (v) { S.cap = v; })));
    g2.appendChild(UI.psel("Corners", [["miter", "Miter"], ["round", "Round"], ["bevel", "Bevel"]], S.join || "round", E("Stroke corners", function (v) { S.join = v; })));
    P.insertBefore(g2, at);
    if (!line && S.grad && S.fill) P.insertBefore(stopsEditor(S, live), at);
    if (line) {
      P.insertBefore(h("div", { "class": "pe-prow" }, [ED.ui.w.check("Start arrow", !!S.arrowS, E("Arrowhead", function (v) { if (v) S.arrowS = true; else delete S.arrowS; })),
        ED.ui.w.check("End arrow", !!S.arrowE, E("Arrowhead", function (v) { if (v) S.arrowE = true; else delete S.arrowE; }))]), at);
      if (S.arrowS || S.arrowE) P.insertBefore(h("div", { "class": "pe-pgrid" }, [UI.pnum("Head width ×", S.aw || 5, E("Arrowhead", function (v) { S.aw = v; }), 0.5, 1, 50),
        UI.pnum("Head length ×", S.al || 5, E("Arrowhead", function (v) { S.al = v; }), 0.5, 1, 50), UI.pnum("Concavity %", S.ac || 0, E("Arrowhead", function (v) { S.ac = v; }), 1, -50, 50)]), at);
    }
    var row = h("div", { "class": "pe-prow" }, [
      line ? null : ED.ui.w.check("No fill", !S.fill, function (v) { live("Fill", function () { S.fill = v ? "" : (S.fill0 || ED.doc.fg); }); ED.ui.buildProps(); }),
      S.type !== "path" ? ED.ui.w.btn("Edit as path", function () { live("Convert to path", function () { VX.setDocComps(L, VX.docComps(L)); }); ED.setTool("dsel"); }, "ghost", "v-path", "Turn this shape into a free path whose anchors you can edit") : null,
      ED.ui.w.btn("Rasterize", function () { ED.rasterize(L, true); }, "ghost")]);
    P.insertBefore(row, at);
    if (S.type === "path" && S.comps && S.comps.length > 1 && VX.pathOpsRow) P.insertBefore(VX.pathOpsRow(L), at);
  });
})();
