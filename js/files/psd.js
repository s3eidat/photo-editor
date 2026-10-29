/* Files lane: PSD open and save. Layers keep their pixels, position, name, visibility, lock, opacity, fill opacity,
   blend mode, layer masks (and vector masks, rasterised), groups, clipping, live text and live shapes.
   Reading and writing run in a worker (js/files/psd-worker.js) with the vendored ag-psd library (MIT).
   Our own editable text / shape settings also ride along in the file's XMP metadata, so a file saved here and opened
   here again is exact; files from other apps are mapped from their own text and vector data. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, FX = PE.files, LIM = PE.LIM;
  var P = FX.psd = {};
  var RAD = Math.PI / 180, KAPPA = 0.5522847498;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sx() { return PE.sx || null; }
  function WS() { return PE.ws || {}; }                       // selection lane (groups, clipping, fill opacity, 27 blend modes)
  function groupsOn() { var S = sx(); return !!(S && S.tree && (PE.kindsExt || []).indexOf("group") >= 0); }

  // ---------- running ag-psd ----------
  function local(msg) {
    return FX.script("lib/ag-psd.js").then(function () {
      var A = window.agPsd;
      if (msg.op === "read") return A.readPsd(msg.buf, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true, totalMemoryLimit: 1.5e9 });
      return A.writePsd(msg.psd, msg.opts || {});
    });
  }
  var job = FX.worker("js/files/psd-worker.js", local);

  // ---------- header check before handing bytes to the parser ----------
  var MODES = ["bitmap", "greyscale", "indexed", "RGB", "CMYK", "", "", "multichannel", "duotone", "Lab"];
  function header(u8) {
    if (u8.length < 26 || u8[0] !== 0x38 || u8[1] !== 0x42 || u8[2] !== 0x50 || u8[3] !== 0x53) throw new Error("This is not a PSD file");
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), ver = dv.getUint16(4), h = dv.getUint32(14), w = dv.getUint32(18), depth = dv.getUint16(22), mode = dv.getUint16(24);
    if (ver === 2) throw new Error("Large-document (PSB) files are not supported. Save it as a regular PSD first.");
    if (ver !== 1) throw new Error("Unknown PSD version " + ver);
    if ([1, 8, 16, 32].indexOf(depth) < 0) throw new Error("Unsupported PSD bit depth (" + depth + ")");
    if ([0, 1, 2, 3].indexOf(mode) < 0) throw new Error((MODES[mode] || "This") + " colour mode PSD files cannot be opened yet. Convert the file to RGB in the app that made it.");
    PE.checkSize(w, h, "This PSD");
    return { w: w, h: h, depth: depth, mode: mode };
  }
  P.header = header;

  // ---------- small conversions ----------
  function to8(img) {     // 16- and 32-bit pixel data -> 8-bit RGBA
    if (!img || !img.data) return null;
    var d = img.data, n = img.width * img.height * 4;
    if (d instanceof Uint8ClampedArray || d instanceof Uint8Array) return { data: d, width: img.width, height: img.height };
    var o = new Uint8ClampedArray(n), i;
    if (d instanceof Uint16Array) for (i = 0; i < n; i++) o[i] = (d[i] + 128) / 257;
    else for (i = 0; i < n; i++) { var v = clamp(d[i], 0, 1); o[i] = (i & 3) === 3 ? v * 255 : 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }
    return { data: o, width: img.width, height: img.height };
  }
  P.to8 = to8;
  function colorHex(c, d) {
    if (!c) return d;
    if (c.r != null) return PE.toHex(c.r, c.g, c.b);
    if (c.fr != null) return PE.toHex(c.fr * 255, c.fg * 255, c.fb * 255);
    if (c.k != null && c.c != null) return PE.toHex(255 * (1 - c.c / 100) * (1 - c.k / 100), 255 * (1 - c.m / 100) * (1 - c.k / 100), 255 * (1 - c.y / 100) * (1 - c.k / 100));
    if (c.k != null) return PE.toHex(255 - c.k * 2.55, 255 - c.k * 2.55, 255 - c.k * 2.55);
    return d;
  }
  function rgb(hx) { var q = PE.rgbOf(hx); return { r: q[0], g: q[1], b: q[2] }; }
  // blend modes: our ids are the CSS-style names ("color-burn"); the file uses words ("color burn")
  function blendIn(b) {
    if (b === "pass through") return groupsOn() ? "pass" : "normal";
    var k = String(b || "normal").replace(/ /g, "-");
    return PE.BLENDS.indexOf(k) >= 0 ? k : "normal";
  }
  function blendOut(b) { return b === "pass" ? "pass through" : String(b || "normal").replace(/-/g, " "); }
  P.blendIn = blendIn; P.blendOut = blendOut;

  // ---------- fonts: family names <-> the PostScript names files carry ----------
  var PSN = { "Arial": "ArialMT", "Times New Roman": "TimesNewRomanPSMT", "Courier New": "CourierNewPSMT", "Trebuchet MS": "TrebuchetMS", "Comic Sans MS": "ComicSansMS",
    "Inter": "Inter-Regular", "Roboto": "Roboto-Regular", "Open Sans": "OpenSans-Regular", "Noto Sans": "NotoSans-Regular", "Noto Serif": "NotoSerif-Regular", "Segoe UI": "SegoeUI",
    "Arial Black": "Arial-Black", "Palatino Linotype": "PalatinoLinotype-Roman", "Brush Script MT": "BrushScriptMT", "Century Gothic": "CenturyGothic",
    "Noto Sans Arabic": "NotoSansArabic-Regular", "Noto Naskh Arabic": "NotoNaskhArabic-Regular", "Noto Kufi Arabic": "NotoKufiArabic-Regular", "Amiri": "Amiri-Regular",
    "Cairo": "Cairo-Regular", "Tajawal": "Tajawal-Regular", "DejaVu Sans": "DejaVuSans", "Ubuntu": "Ubuntu", "Helvetica": "Helvetica", "Georgia": "Georgia" };
  function psFont(f) { f = PE.cleanFamily(f); return PSN[f] || f.replace(/\s+/g, ""); }
  function familyOf(ps) {
    var n = String(ps || "").trim(), k;
    for (k in PSN) if (PSN[k] === n) return { f: k, bold: false, italic: false };
    var dash = n.indexOf("-"), base = (dash > 0 ? n.slice(0, dash) : n).replace(/(PSMT|PS|MT)$/, ""), style = dash > 0 ? n.slice(dash + 1) : "";
    var bold = /bold|black|heavy|semibold|demi/i.test(style), italic = /italic|oblique/i.test(style), key = base.toLowerCase();
    var fonts = PE.deviceFonts(), hit = fonts.filter(function (f) { return f.replace(/\s+/g, "").toLowerCase() === key; })[0];
    return { f: PE.cleanFamily(hit || base.replace(/([a-z])([A-Z])/g, "$1 $2") || "Inter"), bold: bold, italic: italic };
  }
  P.psFont = psFont; P.familyOf = familyOf;

  // ---------- text geometry: our box model <-> point text (origin on the first baseline) ----------
  var mctx = null;
  function baseOff(T) {      // distance from the middle of the first line to its alphabetic baseline
    if (!mctx) mctx = PE.cx2(PE.mk(4, 4));
    mctx.font = PE.fontCss(T); mctx.textBaseline = "middle";
    var m = mctx.measureText("Hxg"), d = m.alphabeticBaseline;
    return isFinite(d) && d !== 0 ? Math.abs(d) : T.size * 0.32;
  }
  function anchorOf(T) {     // un-rotated anchor (on the first baseline) and box centre
    var lay = PE.textLayout(T), b = lay.box;
    return { A: { x: T.ax, y: b.y + lay.lh * 0.5 + baseOff(T) }, C: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, lay: lay };
  }
  function rotv(v, rot, f) { var a = rot * RAD, c = Math.cos(a), s = Math.sin(a), x = v.x * f; return { x: c * x - s * v.y, y: s * x + c * v.y }; }
  function textOut(T) {
    var g = anchorOf(T), f = T.flipX ? -1 : 1, a = (T.rot || 0) * RAD, c = Math.cos(a), s = Math.sin(a);
    var v = rotv({ x: g.A.x - g.C.x, y: g.A.y - g.C.y }, T.rot || 0, f);
    return { text: String(T.text).replace(/\r?\n/g, "\r"), transform: [f * c, f * s, -s, c, g.C.x + v.x, g.C.y + v.y], antiAlias: "smooth", orientation: "horizontal", shapeType: "point",
      style: { font: { name: psFont(T.font) }, fontSize: T.size, fauxBold: T.weight >= 600, fauxItalic: !!T.italic, autoLeading: false, leading: g.lay.lh, fillColor: rgb(T.color), autoKerning: true, tracking: 0 },
      paragraphStyle: { justification: T.align === "center" || T.align === "right" ? T.align : "left" } };
  }
  P.textOut = textOut;
  function sameStyle(a, b) { return JSON.stringify([a.font && a.font.name, a.fontSize, colorHex(a.fillColor), a.fauxBold, a.fauxItalic]) === JSON.stringify([b.font && b.font.name, b.fontSize, colorHex(b.fillColor), b.fauxBold, b.fauxItalic]); }
  // -> our text settings, or null when the text cannot stay editable here without changing its look
  function textIn(t) {
    var tp = t && t.textPath && t.textPath.data, onPath = tp && (tp.type === 2 || (tp.textRange && tp.textRange[0] >= 0));
    if (!t || typeof t.text !== "string" || t.orientation === "vertical" || (t.warp && t.warp.style && t.warp.style !== "none") || onPath) return null;
    var runs = t.styleRuns || [], base = Object.assign({}, t.style || {}, runs[0] ? runs[0].style : {});
    for (var i = 1; i < runs.length; i++) if (!sameStyle(base, Object.assign({}, t.style || {}, runs[i].style))) return null;
    if (!base.font || !base.font.name || /InvisFont/.test(base.font.name)) base.font = (runs.filter(function (r) { return r.style.font && !/InvisFont/.test(r.style.font.name); })[0] || { style: { font: { name: "Inter" } } }).style.font;
    var M = t.transform || [1, 0, 0, 1, 0, 0], det = M[0] * M[3] - M[1] * M[2], k = Math.sqrt(Math.abs(det)) || 1, f = det < 0 ? -1 : 1;
    var rot = Math.atan2(M[1] * f, M[0] * f) / RAD, fam = familyOf(base.font && base.font.name), fs = base.fontSize > 0 ? base.fontSize : 12;
    var ps = t.paragraphStyle || (t.paragraphStyleRuns && t.paragraphStyleRuns[0] && t.paragraphStyleRuns[0].style) || {}, j = ps.justification || "left";
    var align = j === "center" || j === "justify-center" ? "center" : j === "right" || j === "justify-right" ? "right" : "left";
    var lh = base.autoLeading === false && base.leading > 0 ? base.leading / fs : (ps.autoLeading > 0 ? ps.autoLeading : 1.2);
    var T = { text: t.text.replace(/\r\n?/g, "\n").replace(/\u0003/g, "\n").slice(0, LIM.text), font: fam.f, size: clamp(fs * k, 1, 2000), weight: base.fauxBold || fam.bold ? 700 : 400,
      italic: !!(base.fauxItalic || fam.italic), color: colorHex(base.fillColor, "#000000"), align: align, dir: "auto", lh: clamp(lh, 0.5, 4), ax: 0, ay: 0,
      rot: Math.round((((rot % 360) + 540) % 360 - 180) * 1000) / 1000, flipX: f < 0 };
    if (Math.abs(T.rot) < 1e-6) T.rot = 0;
    var g = anchorOf(T), tgt = { x: M[4], y: M[5] };
    if (t.shapeType === "box" && t.boxBounds) {     // paragraph text: wrap to the box width, first baseline one line below the box top
      var bb = t.boxBounds;
      T.text = wrapText(T, (bb[2] - bb[0]) * k);
      g = anchorOf(T);
      var lx = align === "center" ? (bb[0] + bb[2]) / 2 : align === "right" ? bb[2] : bb[0], ly = bb[1] + (g.A.y - g.lay.box.y) / k;
      tgt = { x: M[0] * lx + M[2] * ly + M[4], y: M[1] * lx + M[3] * ly + M[5] };
    }
    var v = rotv({ x: g.A.x - g.C.x, y: g.A.y - g.C.y }, T.rot, f);
    T.ax = Math.round((tgt.x - v.x - g.C.x) * 100) / 100; T.ay = Math.round((tgt.y - v.y - g.C.y) * 100) / 100;
    return T;
  }
  P.textIn = textIn;
  // Break lines (at spaces, or between characters for text without spaces) so none is wider than maxW px.
  function wrapText(T, maxW) {
    if (!(maxW > 0)) return T.text;
    if (!mctx) mctx = PE.cx2(PE.mk(4, 4));
    mctx.font = PE.fontCss(T);
    function w(s) { return mctx.measureText(s).width; }
    return T.text.split("\n").map(function (para) {
      if (w(para) <= maxW) return para;
      var out = [], line = "", parts = /\s/.test(para) ? para.split(/(\s+)/) : Array.from(para);
      parts.forEach(function (p) {
        if (line && w(line + p) > maxW && p.trim()) { out.push(line.replace(/\s+$/, "")); line = p.replace(/^\s+/, ""); }
        else line += p;
        while (w(line) > maxW && line.length > 1) {      // one word longer than the box
          var n = line.length; while (n > 1 && w(line.slice(0, n)) > maxW) n--;
          out.push(line.slice(0, n)); line = line.slice(n);
        }
      });
      if (line) out.push(line);
      return out.join("\n");
    }).join("\n").slice(0, LIM.text);
  }
  P.wrapText = wrapText;

  // ---------- shapes: our live shapes -> bezier paths (knot = [in x, in y, anchor x, anchor y, out x, out y]) ----------
  function shapeKnots(S) {
    var x = S.x, y = S.y, w = S.w, h = S.h, t = S.type, K = [];
    function pt(px, py) { K.push([px, py, px, py, px, py]); }
    if (t === "ellipse") {
      var cx = x + w / 2, cy = y + h / 2, kx = w / 2 * KAPPA, ky = h / 2 * KAPPA;
      K = [[cx - kx, y, cx, y, cx + kx, y], [x + w, cy - ky, x + w, cy, x + w, cy + ky], [cx + kx, y + h, cx, y + h, cx - kx, y + h], [x, cy + ky, x, cy, x, cy - ky]];
    } else if (t === "triangle") { pt(x + w / 2, y); pt(x + w, y + h); pt(x, y + h); }
    else if (t === "star") { for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1; pt(x + w / 2 + Math.cos(a) * w / 2 * r, y + h / 2 + Math.sin(a) * h / 2 * r + h * 0.04); } }
    else if (t === "arrow") {
      var sh = h * 0.36, hw = Math.min(w * 0.45, h * 0.9);
      pt(x, y + h / 2 - sh / 2); pt(x + w - hw, y + h / 2 - sh / 2); pt(x + w - hw, y); pt(x + w, y + h / 2); pt(x + w - hw, y + h); pt(x + w - hw, y + h / 2 + sh / 2); pt(x, y + h / 2 + sh / 2);
    } else if (t === "line") { pt(x, y + h / 2); pt(x + w, y + h / 2); }
    else {
      var r2 = clamp(S.radius || 0, 0, Math.min(Math.abs(w), Math.abs(h)) / 2), k = r2 * KAPPA;
      if (r2 > 0) K = [[x + r2 - k, y, x + r2, y, x + r2, y], [x + w - r2, y, x + w - r2, y, x + w - r2 + k, y], [x + w, y + r2 - k, x + w, y + r2, x + w, y + r2],
        [x + w, y + h - r2, x + w, y + h - r2, x + w, y + h - r2 + k], [x + w - r2 + k, y + h, x + w - r2, y + h, x + w - r2, y + h], [x + r2, y + h, x + r2, y + h, x + r2 - k, y + h],
        [x, y + h - r2 + k, x, y + h - r2, x, y + h - r2], [x, y + r2, x, y + r2, x, y + r2 - k]];
      else { pt(x, y); pt(x + w, y); pt(x + w, y + h); pt(x, y + h); }
    }
    // rotation about the centre, flips
    var c = { x: x + w / 2, y: y + h / 2 }, A = (S.rot || 0) * RAD, co = Math.cos(A), si = Math.sin(A), fx = S.flipX ? -1 : 1, fy = S.flipY ? -1 : 1;
    function T(px, py) { var dx = (px - c.x) * fx, dy = (py - c.y) * fy; return [c.x + co * dx - si * dy, c.y + si * dx + co * dy]; }
    return K.map(function (q) { return [].concat(T(q[0], q[1]), T(q[2], q[3]), T(q[4], q[5])); });
  }
  P.shapeKnots = shapeKnots;
  function pathsFor(S) {      // [{open, op, knots:[[in, anchor, out]]}] in document px
    var ext = P.ext && P.ext.shapeKnots(S);
    return ext && ext.length ? ext : [{ open: S.type === "line", op: "combine", knots: shapeKnots(S) }];
  }
  P.pathsFor = pathsFor;
  function shapeOut(S) {
    var line = S.type === "line", sw = line ? Math.max(1, S.sw || S.h) : S.sw || 0;
    var out = { vectorMask: { paths: pathsFor(S).map(function (q, i) { return { open: q.open, operation: i ? q.op : "combine", fillRule: "non-zero", knots: q.knots.map(function (p) { return { linked: true, points: p }; }) }; }) },
      vectorFill: { type: "color", color: rgb(S.fill || S.stroke || "#000000") },
      vectorStroke: { strokeEnabled: sw > 0, fillEnabled: !line && !!S.fill, lineWidth: { units: "Pixels", value: sw }, lineDashOffset: { units: "Points", value: 0 }, miterLimit: 100,
        lineCapType: "round", lineJoinType: "round", lineAlignment: "center", scaleLock: false, strokeAdjust: false, lineDashSet: [], blendMode: "normal", opacity: 1,
        content: { type: "color", color: rgb(S.stroke || "#000000") }, resolution: 72 } };
    var vs = out.vectorStroke, dashes = PE.VX && PE.VX.DASHES;
    if (S.cap) vs.lineCapType = ["butt", "round", "square"].indexOf(S.cap) >= 0 ? S.cap : "round";
    if (S.join) vs.lineJoinType = ["miter", "round", "bevel"].indexOf(S.join) >= 0 ? S.join : "round";
    if (S.align) vs.lineAlignment = ["inside", "center", "outside"].indexOf(S.align) >= 0 ? S.align : "center";
    if (S.dash && dashes && dashes[S.dash]) vs.lineDashSet = dashes[S.dash].map(function (v) { return { units: "None", value: v }; });
    if (!S.rot && !S.flipX && !S.flipY && (S.type === "rect" || S.type === "ellipse")) {
      var r = S.type === "rect" && S.radius > 0 ? Math.min(S.radius, S.w / 2, S.h / 2) : 0, U = function (v) { return { units: "Pixels", value: v }; };
      var kd = { keyOriginType: S.type === "ellipse" ? 5 : r > 0 ? 2 : 1, keyOriginResolution: 72,
        keyOriginShapeBoundingBox: { top: U(S.y), left: U(S.x), bottom: U(S.y + S.h), right: U(S.x + S.w) },
        keyOriginBoxCorners: [{ x: S.x, y: S.y }, { x: S.x + S.w, y: S.y }, { x: S.x + S.w, y: S.y + S.h }, { x: S.x, y: S.y + S.h }] };
      if (r > 0) kd.keyOriginRRectRadii = { topRight: U(r), topLeft: U(r), bottomLeft: U(r), bottomRight: U(r) };
      out.vectorOrigination = { keyDescriptorList: [kd] };
    }
    return out;
  }
  // A shape layer from another app -> our live shape when it is a plain rectangle / rounded rectangle / ellipse
  function shapeIn(c, dpi) {
    var ko = c.vectorOrigination && c.vectorOrigination.keyDescriptorList, vs = c.vectorStroke || {}, fill = c.vectorFill;
    if (!ko || ko.length !== 1 || !c.vectorMask || c.vectorMask.paths.length !== 1) return null;
    var d = ko[0], type = { 1: "rect", 2: "rect", 5: "ellipse" }[d.keyOriginType], bb = d.keyOriginShapeBoundingBox;
    if (!type || !bb || d.keyShapeInvalidated) return null;
    if (fill && fill.type !== "color" && fill.type !== undefined) return null;
    if (vs.content && vs.content.type && vs.content.type !== "color") return null;
    var V = function (u) { return u && isFinite(u.value) ? u.value : 0; }, x0 = V(bb.left), y0 = V(bb.top), w = V(bb.right) - x0, h = V(bb.bottom) - y0;
    var cn = d.keyOriginBoxCorners, rot = 0;
    if (cn && cn.length === 4) {      // rotated live shapes keep their un-rotated box; the corners tell the angle and centre
      rot = Math.atan2(cn[1].y - cn[0].y, cn[1].x - cn[0].x) / RAD;
      var cx = (cn[0].x + cn[2].x) / 2, cy = (cn[0].y + cn[2].y) / 2, ww = Math.hypot(cn[1].x - cn[0].x, cn[1].y - cn[0].y), hh = Math.hypot(cn[3].x - cn[0].x, cn[3].y - cn[0].y);
      if (ww > 0 && hh > 0) { w = ww; h = hh; x0 = cx - w / 2; y0 = cy - h / 2; }
    }
    if (!(w >= 1 && h >= 1)) return null;
    if (!rot) {      // trust the path over a stale origin box
      var K = c.vectorMask.paths[0].knots, xs = K.map(function (k) { return k.points[2]; }), ys = K.map(function (k) { return k.points[3]; });
      var bx = Math.min.apply(null, xs), by = Math.min.apply(null, ys), bw = Math.max.apply(null, xs) - bx, bh = Math.max.apply(null, ys) - by;
      if (Math.abs(bx - x0) > 1 || Math.abs(by - y0) > 1 || Math.abs(bw - w) > 1 || Math.abs(bh - h) > 1) { if (!(bw >= 1 && bh >= 1)) return null; x0 = bx; y0 = by; w = bw; h = bh; }
    }
    var rr = d.keyOriginRRectRadii, radius = type === "rect" && rr ? Math.max(V(rr.topLeft), V(rr.topRight), V(rr.bottomLeft), V(rr.bottomRight)) : 0;
    var lw = V(vs.lineWidth) * (vs.lineWidth && vs.lineWidth.units === "Points" ? (dpi || 72) / 72 : 1), sOn = vs.strokeEnabled !== false && c.vectorStroke && lw > 0, fOn = vs.fillEnabled !== false;
    return { type: type, x: x0, y: y0, w: w, h: h, rot: Math.abs(rot) < 1e-6 ? 0 : Math.round(rot * 1000) / 1000, fill: fOn ? colorHex(fill && fill.color, "#000000") : "",
      stroke: colorHex(vs.content && vs.content.color, "#000000"), sw: sOn ? Math.min(500, lw) : 0, radius: radius, flipX: false, flipY: false };
  }
  P.shapeIn = shapeIn;

  // ---------- vector mask paths -> an alpha mask canvas covering rect R ----------
  function pathMask(vm, R) {
    var c = PE.mk(R.w, R.h), x = PE.cx2(c);
    x.translate(-R.x, -R.y); x.fillStyle = "#fff";
    if (vm.fillStartsWithAllPixels) x.fillRect(R.x, R.y, R.w, R.h);
    (vm.paths || []).forEach(function (p, i) {
      if (!p.knots || p.knots.length < 2) return;
      var t = new Path2D(), K = p.knots, n = K.length;
      t.moveTo(K[0].points[2], K[0].points[3]);
      for (var k = 1; k <= (p.open ? n - 1 : n); k++) { var a = K[k - 1].points, b = K[k % n].points; t.bezierCurveTo(a[4], a[5], b[0], b[1], b[2], b[3]); }
      if (!p.open) t.closePath();
      var op = p.operation || "combine";
      x.globalCompositeOperation = i === 0 && !vm.fillStartsWithAllPixels ? "source-over" : op === "subtract" ? "destination-out" : op === "intersect" ? "destination-in" : op === "exclude" ? "xor" : "source-over";
      x.fill(t, p.fillRule === "even-odd" ? "evenodd" : "nonzero");
    });
    if (vm.invert) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "xor"; x.fillRect(0, 0, R.w, R.h); }
    return PE.touch(c);
  }
  P.pathMask = pathMask;

  // ---------- XMP: our exact editable settings, keyed by layer id ----------
  var NS = "https://s3eidat.github.io/photo-editor/ns/1.0/";
  function b64(s) { var u = new TextEncoder().encode(s), o = ""; for (var i = 0; i < u.length; i += 0x8000) o += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(o); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new TextDecoder().decode(u); }
  function xmpOut(map) {
    return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:s3pe="' + NS + '" s3pe:layers="' + b64(JSON.stringify(map)) + '"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  }
  function xmpIn(s, W, H) {
    var m = /s3pe:layers="([A-Za-z0-9+\/=]{1,4000000})"/.exec(String(s || ""));
    if (!m) return {};
    try {
      var raw = JSON.parse(unb64(m[1])), out = {};
      if (!raw || typeof raw !== "object") return {};
      Object.keys(raw).slice(0, LIM.layers * 4).forEach(function (id) {
        var l = raw[id]; if (!l || typeof l !== "object" || !/^\d{1,6}$/.test(id)) return;
        try {
          // run it through the project validator (with the other lanes' field checks) so nothing unchecked gets in
          var kinds = ["text", "shape"].concat(PE.kindsExt || []).filter(function (k) { return k !== "smart"; }), carrier = kinds.indexOf(l.kind) >= 0 ? l.kind : "shape";
          var e = Object.assign({}, l.ext && typeof l.ext === "object" && !Array.isArray(l.ext) ? l.ext : {}, { kind: carrier, text: l.text, shape: l.shape });
          delete e.uid; delete e.parent; delete e.src; delete e.mask;
          var v = PE.parseProjectJson(JSON.stringify({ format: "s3photo", version: 1, w: W, h: H, layers: [e] })).layers[0];
          var o = { kind: l.kind, text: carrier === "text" ? v.text : null, shape: carrier === "shape" && l.kind === "shape" ? v.shape : null, ext: {}, sig: typeof l.sig === "string" ? l.sig.slice(0, 200000) : "" };
          EXT_KEYS().forEach(function (k) { if (v[k] !== undefined) o.ext[k] = v[k]; });
          out[id] = o;
        } catch (err) { /* a bad entry is ignored */ }
      });
      return out;
    } catch (e) { return {}; }
  }

  // extension fields worth restoring exactly (structure such as groups comes from the file itself)
  function EXT_KEYS() { return ((sx() && sx().KEYS) || []).concat(["blendIf"]).filter(function (k) { return ["parent", "open", "link", "smart", "uid"].indexOf(k) < 0; }); }
  // what the file says about a layer's styles / adjustment / fill / vector mask, in our terms (for comparisons)
  function sigOf(c) {
    var X = P.ext; if (!X) return "";
    var f = c.effects ? X.fxIn(c.effects) : null;
    return JSON.stringify(X.norm({ a: c.adjustment ? X.adjIn(c.adjustment) : null, f: f && f.fx, fl: c.vectorFill && !c.vectorMask ? X.fillIn(c.vectorFill) : null, v: c.vectorMask && !c.vectorFill ? X.vmaskIn(c.vectorMask) : null }));
  }
  P.sigOf = sigOf;

  // saved settings are used only while the file's own data still matches them (another app may have edited the layer)
  function textSame(T, t) {
    if (!t || T.text !== String(t.text).replace(/\r\n?/g, "\n")) return false;
    var a = textOut(T), m = t.transform || [], st = t.style || {};
    return m.length === 6 && Math.abs(a.transform[4] - m[4]) < 1 && Math.abs(a.transform[5] - m[5]) < 1 && Math.abs(a.transform[0] - m[0]) < 1e-3 && Math.abs(a.transform[1] - m[1]) < 1e-3 && Math.abs((st.fontSize || 0) - T.size) < 0.01;
  }
  function shapeSame(S, c) {
    var F = c.vectorMask && c.vectorMask.paths, M = pathsFor(S);
    if (!F || F.length !== M.length) return false;
    for (var j = 0; j < M.length; j++) {
      var p = F[j], K = M[j].knots;
      if (!p.knots || p.knots.length !== K.length) return false;
      for (var i = 0; i < K.length; i++) if (Math.abs(K[i][2] - p.knots[i].points[2]) > 0.5 || Math.abs(K[i][3] - p.knots[i].points[3]) > 0.5) return false;
    }
    return true;
  }

  // ---------- PSD structure -> document ----------
  function rectOf(c) { return { x: c.left || 0, y: c.top || 0, w: Math.max(0, (c.right || 0) - (c.left || 0)), h: Math.max(0, (c.bottom || 0) - (c.top || 0)) }; }
  function capRect(R) { return R && R.w >= 1 && R.h >= 1 && R.w <= LIM.layerSide && R.h <= LIM.layerSide && R.w * R.h <= LIM.layerPx ? R : null; }
  function grayToMask(img) {
    var g = to8(img), d = g.data, n = g.width * g.height, o = new ImageData(g.width, g.height), od = o.data;
    for (var i = 0; i < n; i++) { od[i * 4] = od[i * 4 + 1] = od[i * 4 + 2] = 255; od[i * 4 + 3] = d[i * 4]; }
    return o;
  }
  function maskIn(c, layerR, doc, liveVm) {
    var m = c.mask, vm = !liveVm && c.vectorMask && !c.vectorMask.disable && !c.vectorFill ? c.vectorMask : null;
    if ((!m || m.fromVectorData) && !vm) return null;
    var docR = { x: 0, y: 0, w: doc.w, h: doc.h }, area = PE.union(layerR && layerR.w ? layerR : null, docR), R, cv, x;
    if (m && !m.fromVectorData) {
      var mr = rectOf(m), dc = m.defaultColor ? 255 : 0;
      R = dc ? area : PE.inter(mr, area) || { x: 0, y: 0, w: 1, h: 1 };
      R = capRect(PE.rectI(R)) || docR;
      cv = PE.mk(R.w, R.h); x = PE.cx2(cv);
      if (dc) { x.fillStyle = "#fff"; x.fillRect(0, 0, R.w, R.h); x.clearRect(mr.x - R.x, mr.y - R.y, mr.w, mr.h); }
      if (m.imageData && mr.w && mr.h) { var t = PE.mk(mr.w, mr.h); PE.cx2(t).putImageData(grayToMask(m.imageData), 0, 0); x.drawImage(t, mr.x - R.x, mr.y - R.y); }
    } else { R = capRect(PE.rectI(area)) || docR; cv = PE.mk(R.w, R.h); x = PE.cx2(cv); x.fillStyle = "#fff"; x.fillRect(0, 0, R.w, R.h); }
    if (vm) { x.globalCompositeOperation = "destination-in"; x.drawImage(pathMask(vm, R), 0, 0); x.globalCompositeOperation = "source-over"; }
    return { mask: { canvas: PE.touch(cv), x: R.x, y: R.y }, on: !(m && m.disabled) };
  }

  // Convert a parsed PSD into a document. Returns { doc, notes: [..] }.
  P.toDoc = function (psd, name) {
    var W = psd.width, H = psd.height; PE.checkSize(W, H, "This PSD");
    var doc = PE.newDoc(W, H, name || "Untitled"), notes = {}, xmp = xmpIn(psd.imageResources && psd.imageResources.xmpMetadata, W, H), G = groupsOn(), S = sx();
    function note(k) { notes[k] = (notes[k] || 0) + 1; }
    var res = psd.imageResources || {}, ri = res.resolutionInfo;
    if (ri && ri.horizontalResolution > 0) doc.dpi = Math.round((ri.horizontalResolutionUnit === "PPCM" ? ri.horizontalResolution * 2.54 : ri.horizontalResolution) * 100) / 100;
    var gg = res.gridAndGuidesInformation;
    if (gg && Array.isArray(gg.guides)) doc.guides = gg.guides.slice(0, 400).filter(function (g) { return isFinite(g.location); }).map(function (g) { return { dir: g.direction === "horizontal" ? "h" : "v", pos: Math.round(g.location * 1000) / 1000 }; });
    if (Array.isArray(psd.annotations) && WS().measure) doc.notes = WS().measure.cleanNotes(psd.annotations.filter(function (a) { return a && a.type === "text" && a.iconLocation; }).map(function (a) {
      return { x: a.iconLocation.left, y: a.iconLocation.top, text: typeof a.data === "string" ? a.data.replace(/\r/g, "\n") : "", author: a.author || "", color: colorHex(a.color, "#f5c518"), date: a.date && !isNaN(Date.parse(a.date)) ? new Date(a.date).toISOString() : "" };
    }));
    if (doc.notes && !doc.notes.length) delete doc.notes;
    var out = [];
    function common(c, kind, extra, parentHidden, parentOp) {
      var o = Object.assign({ name: String(c.name || (kind === "group" ? "Group" : "Layer")).replace(/[\u0000-\u001f]/g, " ").slice(0, 100) || "Layer",
        visible: !c.hidden && !parentHidden, opacity: clamp((c.opacity == null ? 1 : c.opacity) * parentOp, 0, 1), blend: blendIn(c.blendMode),
        locked: !!(c.protected && c.protected.transparency && c.protected.composite && c.protected.position) }, extra || {});
      var L = PE.newLayer(kind, o);
      if (S && c.fillOpacity != null && c.fillOpacity < 1) L.fillOp = clamp(c.fillOpacity, 0, 1);
      if (S && c.clipping) L.clip = true;
      return L;
    }
    function kindOn(k) { return (PE.kindsExt || []).indexOf(k) >= 0; }
    var X = P.ext, stylesOn = !!(S && S.FX_DEF && X), vmOn = !!(S && S.vmaskCanvas && X);
    // styles, vector mask, pixel mask and the other exact settings, for any layer or group
    function decorate(c, L, saved, same, r) {
      if (c.effects) {
        if (stylesOn) { var f = same && saved.ext.fx ? { fx: saved.ext.fx } : X.fxIn(c.effects); if (f && f.fx) L.fx = f.fx; if (!f || f.partial || (!f.fx && !c.effects.disabled)) note("styles"); }
        else if (!c.effects.disabled) note("styles");
      }
      var live = false;
      if (c.vectorMask && !c.vectorFill && vmOn) { var vm = same && saved.ext.vmask ? saved.ext.vmask : X.vmaskIn(c.vectorMask); if (vm) { L.vmask = vm; live = true; } }
      var mk = maskIn(c, L.kind === "raster" ? { x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height } : r, doc, live);
      if (mk) { L.mask = mk.mask; L.maskOn = mk.on; }
      if (same) EXT_KEYS().forEach(function (k) { if (saved.ext[k] !== undefined && L[k] === undefined && ["fx", "adj", "fillSpec", "vmask"].indexOf(k) < 0) L[k] = PE.clone(saved.ext[k]); });
    }
    function fillPixels(fs) {     // a fill layer drawn as pixels when fill layers are not available here
      var cv = PE.mk(W, H), x = PE.cx2(cv);
      if (fs.type === "gradient") { var a = (fs.angle || 0) * RAD, hw = (Math.abs(Math.cos(a)) * W + Math.abs(Math.sin(a)) * H) / 2, g = x.createLinearGradient(W / 2 - Math.cos(a) * hw, H / 2 + Math.sin(a) * hw, W / 2 + Math.cos(a) * hw, H / 2 - Math.sin(a) * hw); g.addColorStop(0, fs.reverse ? fs.to : fs.from); g.addColorStop(1, fs.reverse ? fs.from : fs.to); x.fillStyle = g; }
      else x.fillStyle = fs.color;
      x.fillRect(0, 0, W, H); return PE.touch(cv);
    }
    function layerOf(c, parent, ph, pop) {
      var r = rectOf(c), cv = null, L;
      var saved = c.id != null ? xmp[String(c.id)] : null, same = !!(saved && saved.sig && saved.sig === sigOf(c));
      if (c.adjustment) {
        var a = same && saved.ext.adj ? saved.ext.adj : X ? X.adjIn(c.adjustment) : null;
        if (!a || !kindOn("adjust")) { note("adjust"); return null; }
        L = common(c, "adjust", {}, ph, pop); L.canvas = null; L.adj = a;
      } else if (c.text) {
        var T = saved && saved.kind === "text" && textSame(saved.text, c.text) ? saved.text : textIn(c.text);
        if (T) L = common(c, "text", { text: T }, ph, pop); else note("text");
      } else if (c.vectorFill && !c.vectorMask) {
        var fs = same && saved.ext.fillSpec ? saved.ext.fillSpec : X ? X.fillIn(c.vectorFill) : null;
        if (fs && kindOn("fill")) { L = common(c, "fill", {}, ph, pop); L.canvas = null; L.fillSpec = fs; }
        else if (fs && !(c.imageData && c.imageData.width)) { L = common(c, "raster", { canvas: fillPixels(fs), x: 0, y: 0 }, ph, pop); note("fill"); }
      } else if (c.vectorFill || (c.vectorMask && c.vectorStroke)) {
        var Sh = saved && saved.kind === "shape" && shapeSame(saved.shape, c) ? saved.shape : shapeIn(c, doc.dpi);
        if (Sh) L = common(c, "shape", { shape: Sh }, ph, pop); else note("vector");
      }
      if (!L) {
        var img = to8(c.imageData);
        if (img && img.width && img.height && capRect({ x: 0, y: 0, w: img.width, h: img.height })) cv = FX.toCanvas(img);
        else { if (img && img.width) note("big"); cv = PE.touch(PE.mk(1, 1)); r = { x: 0, y: 0, w: 1, h: 1 }; }
        L = common(c, "raster", { canvas: cv, x: r.x, y: r.y }, ph, pop);
        if (c.placedLayer) note("smart");
      }
      decorate(c, L, saved, same, r);
      if (parent) L.parent = parent.id;
      return L;
    }
    function walk(list, parent, ph, pop) {
      (list || []).forEach(function (c) {
        if (c.children) {
          if (G) {
            var g = common(c, "group", { blend: c.blendMode === "pass through" ? "pass" : blendIn(c.blendMode) }, false, 1), gs = c.id != null ? xmp[String(c.id)] : null;
            g.open = c.opened !== false; if (parent) g.parent = parent.id;
            decorate(c, g, gs, !!(gs && gs.sig && gs.sig === sigOf(c)), { x: 0, y: 0, w: W, h: H });
            walk(c.children, g, false, 1); out.push(g);
          } else {      // no group support yet: children go to the top level, the group's visibility and opacity folded in
            walk(c.children, null, ph || !!c.hidden, pop * (c.opacity == null ? 1 : c.opacity));
            note("groups");
          }
          return;
        }
        var L = layerOf(c, parent, ph, pop); if (L) out.push(L);
      });
    }
    walk(psd.children, null, false, 1);
    if (!out.length || out.length > LIM.layers) {
      if (out.length > LIM.layers) note("toomany");
      var comp = to8(psd.imageData);
      out = [PE.rasterFromCanvas(comp ? FX.toCanvas(comp) : PE.touch(PE.mk(W, H)), "Background")];
    }
    doc.layers = out; doc.active = out[out.length - 1].id;
    var N = { fill: " fill layer(s) were turned into pixels", adjust: " adjustment layer(s) were left out", styles: " layer(s) have styles that were not imported", text: " text layer(s) with mixed styles, warps or vertical text are kept as pixels",
      vector: " vector shape(s) are kept as pixels", groups: " group(s) were flattened into plain layers", big: " oversized layer(s) were left empty", smart: " smart layer(s) are kept as pixels",
      toomany: "More than " + LIM.layers + " layers: only the merged image was opened" };
    return { doc: doc, notes: Object.keys(notes).map(function (k) { return k === "toomany" ? N[k] : notes[k] + N[k]; }) };
  };

  // ---------- document -> PSD structure ----------
  function layerPixels(L, doc) {
    if (L.kind === "raster") return { canvas: L.canvas, x: L.x, y: L.y };
    if (L.kind === "text" || L.kind === "shape") return PE.surface(L, doc);
    // other kinds (fill, smart…): render the layer alone, without its opacity, blend, masks or styles (those are written separately)
    var keep = { o: L.opacity, b: L.blend, v: L.visible, m: L.maskOn, f: L.fillOp, fx: L.fx, vm: L.vmask, c: L.clip };
    L.opacity = 1; L.blend = "normal"; L.visible = true; L.maskOn = false; if (L.fillOp != null) L.fillOp = 1; if (L.fx) L.fx = null; if (L.vmask) L.vmask = null; if (L.clip) L.clip = false;
    try { return { canvas: PE.flatten(doc, { only: [L.id] }), x: 0, y: 0 }; }
    finally { L.opacity = keep.o; L.blend = keep.b; L.visible = keep.v; L.maskOn = keep.m; if (keep.f != null) L.fillOp = keep.f; if (keep.fx) L.fx = keep.fx; if (keep.vm) L.vmask = keep.vm; if (keep.c) L.clip = keep.c; }
  }
  function maskOut(M) {
    var c = M.canvas, d = FX.imageData(c), px = d.data, o = new ImageData(c.width, c.height), od = o.data;
    for (var i = 0; i < px.length; i += 4) { od[i] = od[i + 1] = od[i + 2] = px[i + 3]; od[i + 3] = 255; }
    return { left: M.x, top: M.y, right: M.x + c.width, bottom: M.y + c.height, defaultColor: 0, imageData: o };
  }
  P.fromDoc = function (doc) {
    var map = {}, nextId = 1, S = sx(), T = groupsOn() ? S.tree(doc) : null, kids = {}, roots = [], X = P.ext, notes = {};
    if (T) { doc.layers.forEach(function (L) { var p = T.parentOf(L); if (p) (kids[p.id] = kids[p.id] || []).push(L); else roots.push(L); }); }
    else roots = doc.layers.slice();
    function note(k) { notes[k] = (notes[k] || 0) + 1; }
    function extOf(L) { var l = {}; if (PE.saveExt) { try { PE.saveExt(L, l, 0, [], []); } catch (e) { /* ignore */ } } var o = {}; EXT_KEYS().forEach(function (k) { if (l[k] !== undefined) o[k] = l[k]; }); return o; }
    function decorate(L, c) {      // styles, vector mask, pixel mask
      if (L.fx && X) { var ef = X.fxOut(L.fx); if (ef) c.effects = ef; if (L.fx.patternOverlay && L.fx.patternOverlay.on) note("pattern"); }
      if (L.vmask && X && L.kind !== "shape") { var vm = X.vmaskOut(L.vmask); if (vm) c.vectorMask = vm; }
      if (L.mask) { c.mask = maskOut(L.mask); c.mask.disabled = !L.maskOn; }
    }
    function remember(L, c) {
      var e = extOf(L), keep = L.kind === "text" || L.kind === "shape" || L.kind === "adjust" || L.kind === "fill" || Object.keys(e).length;
      if (!keep) return;
      var m = { kind: L.kind, ext: e, sig: sigOf(c) };
      if (L.kind === "text") m.text = L.text; if (L.kind === "shape") m.shape = L.shape;
      map[c.id] = m;
    }
    function one(L) {
      var c = { id: nextId++, name: L.name, hidden: !L.visible, opacity: clamp(L.opacity, 0, 1), blendMode: blendOut(L.blend) };
      if (L.locked) c.protected = { transparency: true, composite: true, position: true };
      if (L.fillOp != null && L.fillOp < 1) c.fillOpacity = L.fillOp;
      if (L.clip) c.clipping = true;
      if (L.kind === "group") { c.opened = L.open !== false; c.children = (kids[L.id] || []).map(one); if (c.blendMode === "normal" && L.blend === "pass") c.blendMode = "pass through"; decorate(L, c); remember(L, c); return c; }
      if (L.kind === "adjust") {
        c.adjustment = X ? X.adjOut(L.adj) : null; c.left = 0; c.top = 0;
        if (!c.adjustment) { delete c.adjustment; note("adjust"); }
        decorate(L, c); remember(L, c); return c;
      }
      if (L.kind === "fill" && X) { var vf = X.fillOut(L.fillSpec); if (vf) c.vectorFill = vf; else note("fillpx"); }
      if (L.kind === "smart") note("smart");
      var s = layerPixels(L, doc);
      if (s && s.canvas && s.canvas.width * s.canvas.height > 1) { c.left = s.x; c.top = s.y; c.imageData = FX.imageData(s.canvas); }
      else { c.left = 0; c.top = 0; }
      if (L.kind === "text") { c.text = textOut(L.text); if (X && PE.VX) X.textOut(L.text, c.text); }
      if (L.kind === "shape") Object.assign(c, shapeOut(L.shape));
      decorate(L, c); remember(L, c);
      return c;
    }
    var children = roots.map(one), dpi = doc.dpi || 72;
    var res = { resolutionInfo: { horizontalResolution: dpi, horizontalResolutionUnit: "PPI", widthUnit: "Inches", verticalResolution: dpi, verticalResolutionUnit: "PPI", heightUnit: "Inches" },
      xmpMetadata: xmpOut(map) };
    var anns = (doc.notes || []).map(function (n) {
      return { type: "text", open: false, iconLocation: { left: Math.round(n.x), top: Math.round(n.y), right: Math.round(n.x) + 24, bottom: Math.round(n.y) + 24 },
        popupLocation: { left: Math.round(n.x) + 30, top: Math.round(n.y), right: Math.round(n.x) + 330, bottom: Math.round(n.y) + 200 }, color: rgb(PE.hex(n.color, "#f5c518")), author: n.author || "", name: "", date: n.date || "", data: String(n.text || "").replace(/\n/g, "\r") };
    });
    if (doc.guides && doc.guides.length) res.gridAndGuidesInformation = { grid: { horizontal: 18 * 32, vertical: 18 * 32 }, guides: doc.guides.map(function (g) { return { location: g.pos, direction: g.dir === "h" ? "horizontal" : "vertical" }; }) };
    var out = { width: doc.w, height: doc.h, children: children, imageData: FX.imageData(PE.flatten(doc)), imageResources: res };
    if (anns.length) out.annotations = anns;
    var NN = { adjust: " adjustment layer(s) have no PSD equivalent: other apps will not see them", smart: " smart layer(s) were written as pixels", pattern: " pattern overlay style(s) are only kept for this app", fillpx: " pattern fill layer(s) were written as pixels" };
    P.lastNotes = Object.keys(notes).map(function (k) { return notes[k] + NN[k]; });
    return out;
  };

  // ---------- bytes in / out ----------
  function buffersOf(v, out) {
    if (!v || typeof v !== "object") return out;
    if (v instanceof ImageData) { out.push(v.data.buffer); return out; }
    if (ArrayBuffer.isView(v)) return out;
    if (Array.isArray(v)) { v.forEach(function (x) { buffersOf(x, out); }); return out; }
    Object.keys(v).forEach(function (k) { buffersOf(v[k], out); });
    return out;
  }
  P.read = function (u8) {
    header(u8);
    var copy = u8.slice().buffer;
    return job({ op: "read", buf: copy }, [copy]);
  };
  P.open = function (u8, name) { return P.read(u8).then(function (psd) { return P.toDoc(psd, name); }); };
  P.save = function (doc) {
    var psd = P.fromDoc(doc);
    return job({ op: "write", psd: psd, opts: { invalidateTextLayers: true, trimImageData: true, noBackground: true } }, buffersOf(psd, [])).then(function (ab) { return new Uint8Array(ab); });
  };

  // ---------- UI ----------
  function openFile(f) {
    if (f.size > 2e9) { S3.toast("That PSD is too large to open here", "error"); return; }
    var name = String(f.name || "Image").replace(/\.[^.]+$/, "").slice(0, 100) || "Image";
    ED.working(f.arrayBuffer().then(function (ab) { return P.open(new Uint8Array(ab), name); }), "Opening PSD…").then(function (r) {
      ED.openDoc(r.doc, "Open PSD"); ED.ui.colors(); if (ED.saveNow) ED.saveNow();
      S3.toast("Opened “" + r.doc.name + "” (" + r.doc.layers.length + " layer" + (r.doc.layers.length === 1 ? "" : "s") + ")");
      r.notes.forEach(function (n) { S3.toast(n); });
    }).catch(function (e) { S3.toast(/not supported|cannot|PSD|limited/.test(e.message) ? e.message : "Could not read this PSD: " + e.message, "error"); });
  }
  FX.openers.push({ test: function (f) { return /\.psd$/i.test(f.name || "") || f.type === "image/vnd.adobe.photoshop"; }, open: openFile });
  FX.accept(".psd");
  P.saveFile = function () {
    if (!FX.need()) return;
    ED.flushProps();
    ED.working(P.save(ED.doc), "Writing PSD…").then(function (u8) {
      var b = new Blob([u8], { type: "image/vnd.adobe.photoshop" });
      FX.download(b, FX.fname("psd")); S3.done(); S3.toast("Saved " + FX.fname("psd") + " (" + S3.fmtBytes(b.size) + ")");
      (P.lastNotes || []).forEach(function (n) { S3.toast(n); });
    }).catch(function (e) { S3.toast("Could not write the PSD: " + e.message, "error"); });
  };
  FX.menu("File", ["Save as PSD…", "", P.saveFile, FX.has], "Save project (.s3photo)");

  // ---------- self-test ----------
  FX.tests.push(async function (ok, near, px, solid) {
    // header guard
    function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
    var hd = new Uint8Array(26); hd.set([0x38, 0x42, 0x50, 0x53, 0, 1]); var dv = new DataView(hd.buffer);
    dv.setUint32(14, 100); dv.setUint32(18, 100); dv.setUint16(22, 8); dv.setUint16(24, 3);
    ok(!throws(function () { header(hd); }), "psd header accepts RGB 8-bit");
    var h2 = hd.slice(); new DataView(h2.buffer).setUint16(4, 2); ok(throws(function () { header(h2); }), "psd rejects PSB");
    var h3 = hd.slice(); new DataView(h3.buffer).setUint32(18, 50000); ok(throws(function () { header(h3); }), "psd rejects huge canvas");
    var h4 = hd.slice(); new DataView(h4.buffer).setUint16(24, 4); ok(throws(function () { header(h4); }), "psd rejects CMYK with a message");
    ok(throws(function () { header(new TextEncoder().encode("GIF89a not a psd at all......")); }), "psd rejects other files");
    var bad = false; try { await P.read(hd); } catch (e) { bad = true; } ok(bad, "psd: truncated file fails cleanly");
    // 16-bit conversion
    var c16 = to8({ data: new Uint16Array([0, 65535, 32896, 65535]), width: 1, height: 1 }); ok(c16.data[0] === 0 && c16.data[1] === 255 && c16.data[2] === 128, "psd 16-bit -> 8-bit");
    // blend names
    ok(blendOut("color-burn") === "color burn" && blendIn("multiply") === "multiply" && blendIn("bogus mode") === "normal", "psd blend names");

    // text geometry: settings -> point text -> settings
    var T0 = { text: "Hello\nWorld", font: "Inter", size: 40, weight: 700, italic: true, color: "#123456", align: "center", dir: "auto", lh: 1.3, ax: 120, ay: 60, rot: 25, flipX: false };
    var T1 = textIn(textOut(T0));
    ok(T1 && near(T1.ax, 120, 0.05) && near(T1.ay, 60, 0.05) && near(T1.rot, 25, 0.01) && near(T1.size, 40, 0.01) && T1.color === "#123456" && T1.align === "center" && T1.weight === 700 && T1.italic && near(T1.lh, 1.3, 1e-6), "psd text geometry inverse " + JSON.stringify(T1));
    var T2 = textIn({ text: "Hi", transform: [2, 0, 0, 2, 10, 50], style: { font: { name: "ArialMT" }, fontSize: 12, fillColor: { r: 255, g: 0, b: 0 } } });
    ok(T2 && T2.size === 24 && T2.font === "Arial" && T2.color === "#ff0000" && near(T2.ax, 10, 0.01), "psd point text scale + font name");
    ok(textIn({ text: "x", orientation: "vertical" }) === null && textIn({ text: "ab", style: {}, styleRuns: [{ length: 1, style: { fontSize: 10 } }, { length: 1, style: { fontSize: 20 } }] }) === null, "psd complex text stays pixels");
    ok(familyOf("TimesNewRomanPSMT").f === "Times New Roman" && familyOf("Georgia-BoldItalic").bold && familyOf("Georgia-BoldItalic").italic, "psd font names");

    // vector mask rasterising: a 10x10 square path inside a 20x20 area
    var vm = { paths: [{ open: false, operation: "combine", fillRule: "non-zero", knots: [[5, 5], [15, 5], [15, 15], [5, 15]].map(function (q) { return { points: [q[0], q[1], q[0], q[1], q[0], q[1]] }; }) }] };
    var pm = pathMask(vm, { x: 0, y: 0, w: 20, h: 20 });
    ok(px(pm, 10, 10)[3] === 255 && px(pm, 2, 2)[3] === 0, "psd vector mask fills the path");
    vm.invert = true; var pm2 = pathMask(vm, { x: 0, y: 0, w: 20, h: 20 }); ok(px(pm2, 10, 10)[3] === 0 && px(pm2, 2, 2)[3] === 255, "psd inverted vector mask");

    // full round trip through the real writer and reader
    var d = PE.newDoc(64, 48, "PSD trip ✓ مرحبا"), rc = PE.mk(40, 30), rx = PE.cx2(rc), im = rx.createImageData(40, 30), rnd = window.PIX.rng(9), q;
    for (q = 0; q < im.data.length; q++) im.data[q] = q % 4 === 3 ? 255 : Math.floor(rnd() * 256);
    rx.putImageData(im, 0, 0); PE.touch(rc);
    var r1 = PE.rasterFromCanvas(rc, "Noise", 3, -2); r1.blend = "overlay"; r1.opacity = 0.6;
    var mc = PE.mk(64, 48), mx = PE.cx2(mc); mx.fillStyle = "#fff"; mx.fillRect(0, 0, 20, 48); mx.fillStyle = "rgba(255,255,255,0.5)"; mx.fillRect(20, 0, 10, 48);
    r1.mask = { canvas: PE.touch(mc), x: 0, y: 0 }; r1.maskOn = false;
    var r2 = PE.newLayer("text", { name: "Title", text: { text: "Hey\nمرحبا", font: "Inter", size: 14, color: "#aa2200", align: "right", ax: 50, ay: 6, rot: -10 } });
    var r3 = PE.newLayer("shape", { name: "Star", locked: true, visible: false, shape: { type: "star", x: 4, y: 5, w: 30, h: 20, fill: "", stroke: "#abcdef", sw: 3, rot: -20, flipX: true } });
    var r4 = PE.newLayer("shape", { name: "Box", shape: { type: "rect", x: 10, y: 8, w: 20, h: 12, fill: "#00ff00", stroke: "#000000", sw: 0, radius: 4 } });
    d.layers = [r1, r2, r3, r4]; d.active = r2.id; d.guides = [{ dir: "h", pos: 12 }, { dir: "v", pos: 30.5 }]; d.dpi = 300;
    d.notes = [{ x: 10, y: 12, text: "Line 1\nLine 2 ✓", author: "Tester", color: "#00ff00", date: "2026-10-29T10:00:00.000Z" }];
    var bytes = await P.save(d);
    ok(bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53, "psd written with signature");
    var o = (await P.open(bytes, "back")).doc, L = o.layers;
    ok(L.length === 4 && L.map(function (x) { return x.name; }).join("|") === "Noise|Title|Star|Box", "psd layer order and names " + L.map(function (x) { return x.name; }).join("|"));
    var a0 = PE.getData(r1.canvas).data, a1 = PE.getData(L[0].canvas).data, same = a0.length === a1.length;
    for (q = 0; same && q < a0.length; q++) if (a0[q] !== a1[q]) same = false;
    ok(same && L[0].x === 3 && L[0].y === -2, "psd raster pixels + offset exact");
    ok(L[0].blend === "overlay" && near(L[0].opacity, 0.6, 0.003) && L[0].maskOn === false && L[0].mask, "psd blend, opacity, mask flag");
    if (L[0].mask) {
      var f = PE.flatten({ w: 64, h: 48, layers: [Object.assign({}, L[0], { maskOn: true, opacity: 1, blend: "normal", id: "t1" })] });
      ok(px(f, 10, 10)[3] === 255 && near(px(f, 25, 10)[3], 128, 2) && px(f, 35, 10)[3] === 0, "psd mask values " + [px(f, 10, 10)[3], px(f, 25, 10)[3], px(f, 35, 10)[3]]);
    }
    ok(L[1].kind === "text" && JSON.stringify(L[1].text) === JSON.stringify(r2.text), "psd text stays editable and exact");
    ok(L[2].kind === "shape" && JSON.stringify(L[2].shape) === JSON.stringify(r3.shape) && L[2].locked && !L[2].visible, "psd shape stays editable, lock + hidden");
    ok(L[3].kind === "shape" && L[3].shape.radius === 4, "psd rounded rect");
    ok(o.notes && o.notes.length === 1 && o.notes[0].text === "Line 1\nLine 2 ✓" && o.notes[0].author === "Tester" && o.notes[0].x === 10 && o.notes[0].color === "#00ff00", "psd notes round trip " + JSON.stringify(o.notes));
    ok(o.dpi === 300 && o.guides && o.guides.length === 2 && o.guides[1].pos === 30.5 && o.guides[0].dir === "h", "psd resolution and guides");
    // a foreign-app view of the same file (no XMP): text and live shapes come from the file's own data
    var raw = await P.read(bytes); delete raw.imageResources.xmpMetadata;
    var o2 = P.toDoc(raw, "x").doc.layers;
    ok(o2[1].kind === "text" && o2[1].text.text === r2.text.text && near(o2[1].text.ax, 50, 0.1) && near(o2[1].text.ay, 6, 0.1) && near(o2[1].text.rot, -10, 0.01) && o2[1].text.align === "right", "psd text from file data");
    ok(o2[3].kind === "shape" && near(o2[3].shape.w, 20, 0.01) && o2[3].shape.fill === "#00ff00", "psd live shape from file data");
    ok(o2[2].kind === "raster" && o2[2].canvas.width > 1, "psd custom vector shape falls back to pixels");
    var flatA = PE.flatten(d), flatB = PE.flatten(o), diff = 0, da = PE.getData(flatA).data, db = PE.getData(flatB).data;
    for (q = 0; q < da.length; q++) diff = Math.max(diff, Math.abs(da[q] - db[q]));
    ok(diff <= 3, "psd round trip looks the same (max diff " + diff + ")");
    // a composite-only file opens as one layer
    var flat = await (async function () { var z = { width: 8, height: 4, imageData: new ImageData(8, 4) }; z.imageData.data.fill(200); return P.toDoc(z, "flat"); })();
    ok(flat.doc.layers.length === 1 && px(flat.doc.layers[0].canvas, 2, 2)[0] === 200, "psd without layers opens its merged image");
  });
})();
