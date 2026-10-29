/* Files lane: PSD mapping for the layer features other lanes add, used by psd.js when those features are present.
   Layer styles (L.fx) <-> effects, adjustment layers (kind "adjust", L.adj) <-> adjustment layers, fill layers
   (kind "fill", L.fillSpec) <-> solid colour / gradient fill layers, vector masks (L.vmask) <-> vector masks, and the
   vector lane's extended shapes (any path) and type settings. Each mapping is two plain functions (out / in) so that
   a value written and read back can be compared: our exact settings (kept in the file's XMP) are restored only while
   the file's own data still says the same thing, so an edit made in another app always wins. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, FX = PE.files, P = FX.psd;
  var X = P.ext = {};
  function clamp(v, a, b) { v = +v; return isFinite(v) ? (v < a ? a : v > b ? b : v) : a; }
  function rgb(hx) { var q = PE.rgbOf(hx); return { r: q[0], g: q[1], b: q[2] }; }
  function hex(c, d) { return c && c.r != null ? PE.toHex(c.r, c.g, c.b) : d; }
  function U(v) { return { units: "Pixels", value: +v || 0 }; }
  function V(u) { return u && isFinite(u.value) ? u.value : isFinite(u) ? +u : 0; }
  // normalise for comparisons: numbers to 2 decimals, keys sorted
  X.norm = function norm(v) {
    if (typeof v === "number") return Math.round(v * 100) / 100;
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") { var o = {}; Object.keys(v).sort().forEach(function (k) { if (v[k] !== undefined) o[k] = norm(v[k]); }); return o; }
    return v;
  };
  X.same = function (a, b) { return JSON.stringify(X.norm(a)) === JSON.stringify(X.norm(b)); };
  function bo(b) { return P.blendOut(b || "normal"); }
  function bi(b) { return P.blendIn(b || "normal"); }

  // ---------- adjustment layers ----------
  var CH = [["r", "red"], ["g", "green"], ["b", "blue"]], HS = ["reds", "yellows", "greens", "cyans", "blues", "magentas"];
  var BW_DEF = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 };
  function HS_DEF(i) { var m = [0, 60, 120, 180, 240, 300][i]; return { a: (m + 315) % 360, b: (m + 345) % 360, c: (m + 15) % 360, d: (m + 45) % 360, hue: 0, saturation: 0, lightness: 0 }; }
  function lvOut(v) { v = Array.isArray(v) ? v : [0, 1, 255, 0, 255]; return { shadowInput: Math.round(clamp(v[0], 0, 253)), highlightInput: Math.round(clamp(v[2], 2, 255)), shadowOutput: Math.round(clamp(v[3], 0, 255)), highlightOutput: Math.round(clamp(v[4], 0, 255)), midtoneInput: Math.round(clamp(v[1], 0.1, 9.99) * 100) / 100 }; }
  function lvIn(l) { l = l || {}; return [clamp(l.shadowInput || 0, 0, 253), Math.round(clamp(l.midtoneInput || 1, 0.1, 9.99) * 100) / 100, clamp(l.highlightInput == null ? 255 : l.highlightInput, 2, 255), clamp(l.shadowOutput || 0, 0, 255), clamp(l.highlightOutput == null ? 255 : l.highlightOutput, 0, 255)]; }
  function hsbRgb(hh, sat, v) { var f = function (n) { var k = (n + hh / 60) % 6; return Math.round(255 * (v - v * sat * Math.max(0, Math.min(k, 4 - k, 1)))); }; return { r: f(5), g: f(3), b: f(1) }; }
  function rgbHsb(c) { var r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, hh = 0;
    if (d) hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [Math.round(hh * 60) % 360, mx ? Math.round(d / mx * 100) : 0]; }
  X.adjOut = function (a) {
    if (!a || !a.op) return null; var p = a.p || {}, o = null;
    switch (a.op) {
      case "brightness": o = { type: "brightness/contrast", brightness: Math.round(clamp(p.b, -150, 150)), contrast: Math.round(clamp(p.c, -100, 100)), useLegacy: true }; break;
      case "brightnessPlus": o = { type: "brightness/contrast", brightness: Math.round(clamp(p.b, -150, 150)), contrast: Math.round(clamp(p.c, p.legacy ? -100 : -50, 100)), useLegacy: !!p.legacy }; break;
      case "levelsPlus": o = { type: "levels" }; [["rgb", "rgb"]].concat(CH).forEach(function (c) { o[c[1]] = lvOut(p[c[0]]); }); break;
      case "levels": o = { type: "levels", rgb: { shadowInput: Math.round(p.inB || 0), highlightInput: Math.round(p.inW == null ? 255 : p.inW), shadowOutput: Math.round(p.outB || 0), highlightOutput: Math.round(p.outW == null ? 255 : p.outW), midtoneInput: p.gamma || 1 } }; break;
      case "curves": case "curvesPlus": o = { type: "curves" }; [["rgb", "rgb"]].concat(CH).forEach(function (c) { var pts = p[c[0]]; if (Array.isArray(pts) && pts.length >= 2) o[c[1]] = pts.map(function (q) { return { input: Math.round(q[0]), output: Math.round(q[1]) }; }); }); break;
      case "exposure": o = { type: "exposure", exposure: +p.ev || 0, offset: +p.offset || 0, gamma: p.gamma || 1 }; break;
      case "vibrance": o = { type: "vibrance", vibrance: Math.round(p.vibrance || 0), saturation: Math.round(p.sat || 0) }; break;
      case "hueSat": if (p.colorize) return null; o = { type: "hue/saturation", master: { a: 0, b: 0, c: 0, d: 0, hue: Math.round(p.hue || 0), saturation: Math.round(p.sat || 0), lightness: Math.round(p.light || 0) } }; break;
      case "colorBalance": var cb = function (v) { v = v || [0, 0, 0]; return { cyanRed: v[0] || 0, magentaGreen: v[1] || 0, yellowBlue: v[2] || 0 }; }; o = { type: "color balance", shadows: cb(p.sh), midtones: cb(p.mid), highlights: cb(p.hi), preserveLuminosity: p.keepLum !== false }; break;
      case "hueSatPlus": var M = Array.isArray(p.master) ? p.master : [0, 0, 0], col = Array.isArray(p.colorize) ? p.colorize : null;
        o = { type: "hue/saturation", colorize: !!col, master: { hue: Math.round(+M[0] || 0), saturation: Math.round(+M[1] || 0), lightness: Math.round(+M[2] || 0) } };
        if (col) o.colorization = { hue: Math.round(clamp(col[0], 0, 360)), saturation: Math.round(clamp(col[1], 0, 100)), lightness: Math.round(clamp(col[2], -100, 100)) };
        HS.forEach(function (k, i) { var q = (p.ranges || [])[i]; o[k] = Array.isArray(q) ? { a: Math.round(+q[3] || 0), b: Math.round(+q[4] || 0), c: Math.round(+q[5] || 0), d: Math.round(+q[6] || 0), hue: Math.round(+q[0] || 0), saturation: Math.round(+q[1] || 0), lightness: Math.round(+q[2] || 0) } : HS_DEF(i); }); break;
      case "bw": case "bwPlus": o = { type: "black & white" }; HS.forEach(function (k) { o[k] = Math.round(p[k] == null ? BW_DEF[k] : p[k]); });
        if (a.op === "bwPlus" && p.tint) { o.useTint = true; o.tintColor = hsbRgb(+p.tintHue || 0, clamp(p.tintSat, 0, 100) / 100, 0.88); } break;
      case "threshold": o = { type: "threshold", level: Math.round(p.level || 128) }; break;
      case "invert": o = { type: "invert" }; break;
      case "desaturate": o = { type: "hue/saturation", master: { a: 0, b: 0, c: 0, d: 0, hue: 0, saturation: -100, lightness: 0 } }; break;
      case "posterize": o = { type: "posterize", levels: Math.round(clamp(p.levels, 2, 255)) }; break;
      case "photoFilter": o = { type: "photo filter", color: rgb(PE.hex(p.color, "#ec8a00")), density: clamp(p.density, 0, 100) / 100, preserveLuminosity: p.keepLum !== false }; break;
      case "channelMixer": var mx = function (v) { v = v || [0, 0, 0, 0]; return { red: v[0] || 0, green: v[1] || 0, blue: v[2] || 0, constant: v[3] || 0 }; };
        o = { type: "channel mixer", monochrome: !!p.mono, red: mx(p.r), green: mx(p.g), blue: mx(p.b) }; if (p.mono) o.gray = mx(p.gray); break;
      case "gradientMap": if (!Array.isArray(p.stops) || p.stops.length < 2) return null;
        o = { type: "gradient map", gradientType: "solid", name: "Custom", reverse: !!p.reverse, dither: !!p.dither, smoothness: 1,
          colorStops: p.stops.map(function (s) { return { location: clamp(s[0], 0, 1), midpoint: 0.5, color: rgb(PE.hex(s[1], "#000000")) }; }), opacityStops: [{ location: 0, midpoint: 0.5, opacity: 1 }, { location: 1, midpoint: 0.5, opacity: 1 }] }; break;
      case "selectiveColor": if (!p.adj) return null; o = { type: "selective color", mode: p.method === "absolute" ? "absolute" : "relative" };
        Object.keys(p.adj).forEach(function (k) { var v = p.adj[k] || []; o[k] = { c: v[0] || 0, m: v[1] || 0, y: v[2] || 0, k: v[3] || 0 }; }); break;
      default: return null;
    }
    return o;
  };
  X.adjIn = function (a) {
    if (!a || !a.type) return null; var o;
    function has(op) { return !!(ED.ADJ && ED.ADJ[op]) || op === "invert" || op === "desaturate"; }
    switch (a.type) {
      case "brightness/contrast":       // the classic (linear) maths is the editor's own; the modern curve comes from the adjust lane
        o = !a.useLegacy && has("brightnessPlus") ? { op: "brightnessPlus", p: { b: clamp(a.brightness || 0, -150, 150), c: clamp(a.contrast || 0, -50, 100), legacy: false } } : { op: "brightness", p: { b: clamp(a.brightness || 0, -150, 150), c: clamp(a.contrast || 0, -100, 100) } }; break;
      case "levels": if (CH.some(function (c) { return a[c[1]] && lvIn(a[c[1]]).join() !== "0,1,255,0,255"; }) && has("levelsPlus")) { o = { op: "levelsPlus", p: {} }; [["rgb", "rgb"]].concat(CH).forEach(function (c) { o.p[c[0]] = lvIn(a[c[1]]); }); break; }
        var l = a.rgb || { shadowInput: 0, highlightInput: 255, shadowOutput: 0, highlightOutput: 255, midtoneInput: 1 };
        o = { op: "levels", p: { inB: clamp(l.shadowInput, 0, 253), inW: clamp(l.highlightInput, 2, 255), gamma: clamp(l.midtoneInput || 1, 0.1, 9.99), outB: clamp(l.shadowOutput, 0, 255), outW: clamp(l.highlightOutput, 0, 255) } }; break;
      case "curves": o = { op: "curves", p: {} }; [["rgb", "rgb"]].concat(CH).forEach(function (c) { var pts = a[c[1]]; o.p[c[0]] = Array.isArray(pts) && pts.length >= 2 ? pts.slice(0, 14).map(function (q) { return [clamp(q.input, 0, 255), clamp(q.output, 0, 255)]; }) : [[0, 0], [255, 255]]; }); break;
      case "exposure": o = { op: "exposure", p: { ev: clamp(a.exposure || 0, -5, 5), offset: clamp(a.offset || 0, -0.5, 0.5), gamma: clamp(a.gamma || 1, 0.1, 4) } }; break;
      case "vibrance": o = { op: "vibrance", p: { vibrance: clamp(a.vibrance || 0, -100, 100), sat: clamp(a.saturation || 0, -100, 100) } }; break;
      case "hue/saturation": var m = a.master || {};
        if (a.colorize || HS.some(function (k) { var c = a[k]; return c && (c.hue || c.saturation || c.lightness); })) {      // colourise and per-range edits need the fuller panel
          var cz = a.colorization || {}; o = { op: "hueSatPlus", p: { master: [clamp(m.hue || 0, -180, 180), clamp(m.saturation || 0, -100, 100), clamp(m.lightness || 0, -100, 100)], colorize: a.colorize ? [clamp(cz.hue || 0, 0, 360), clamp(cz.saturation == null ? 25 : cz.saturation, 0, 100), clamp(cz.lightness || 0, -100, 100)] : null,
            ranges: HS.map(function (k, i) { var c = a[k] || HS_DEF(i); return [clamp(c.hue || 0, -180, 180), clamp(c.saturation || 0, -100, 100), clamp(c.lightness || 0, -100, 100), clamp(c.a || 0, 0, 360), clamp(c.b || 0, 0, 360), clamp(c.c || 0, 0, 360), clamp(c.d || 0, 0, 360)]; }) } }; break;
        }
        o = { op: "hueSat", p: { hue: clamp(m.hue || 0, -180, 180), sat: clamp(m.saturation || 0, -100, 100), light: clamp(m.lightness || 0, -100, 100), colorize: false } }; break;
      case "color balance": var cv = function (v) { v = v || {}; return [clamp(v.cyanRed || 0, -100, 100), clamp(v.magentaGreen || 0, -100, 100), clamp(v.yellowBlue || 0, -100, 100)]; };
        o = { op: "colorBalance", p: { sh: cv(a.shadows), mid: cv(a.midtones), hi: cv(a.highlights), keepLum: a.preserveLuminosity !== false } }; break;
      case "black & white": o = { op: a.useTint ? "bwPlus" : "bw", p: {} }; HS.forEach(function (k) { o.p[k] = clamp(a[k] == null ? BW_DEF[k] : a[k], -200, 300); });
        if (a.useTint) { var tc = a.tintColor && a.tintColor.r != null ? rgbHsb(a.tintColor) : [42, 20]; o.p.tint = true; o.p.tintHue = tc[0]; o.p.tintSat = tc[1]; } break;
      case "threshold": o = { op: "threshold", p: { level: clamp(a.level || 128, 1, 255) } }; break;
      case "invert": o = { op: "invert", p: {} }; break;
      case "posterize": o = { op: "posterize", p: { levels: clamp(a.levels || 4, 2, 255) } }; break;
      case "photo filter": var pc = a.color, C = PE.ws && PE.ws.color;
        if (pc && pc.l != null && C) { var q = C.lab2rgb(pc.l * 100, pc.a * 128, pc.b * 128); pc = { r: q[0], g: q[1], b: q[2] }; }
        if (!pc || pc.r == null) return null; o = { op: "photoFilter", p: { color: hex(pc, "#ec8a00"), density: clamp((a.density || 0) * 100, 0, 100), keepLum: a.preserveLuminosity !== false } }; break;
      case "channel mixer": var mv = function (v) { v = v || {}; return [v.red || 0, v.green || 0, v.blue || 0, v.constant || 0]; };
        o = { op: "channelMixer", p: { mono: !!a.monochrome, r: mv(a.red || { red: 100 }), g: mv(a.green || { green: 100 }), b: mv(a.blue || { blue: 100 }), gray: mv(a.gray || { red: 40, green: 40, blue: 20 }) } }; break;
      case "gradient map": if (a.gradientType !== "solid" || !Array.isArray(a.colorStops) || a.colorStops.length < 2) return null;
        o = { op: "gradientMap", p: { stops: a.colorStops.slice(0, 32).map(function (s) { return [clamp(s.location, 0, 1), hex(s.color, "#000000")]; }), reverse: !!a.reverse, dither: !!a.dither } }; break;
      case "selective color": o = { op: "selectiveColor", p: { method: a.mode === "absolute" ? "absolute" : "relative", adj: {} } };
        ["reds", "yellows", "greens", "cyans", "blues", "magentas", "whites", "neutrals", "blacks"].forEach(function (k) { var v = a[k] || {}; o.p.adj[k] = [v.c || 0, v.m || 0, v.y || 0, v.k || 0]; }); break;
      default: return null;
    }
    return has(o.op) ? o : null;
  };

  // ---------- blend if (blending ranges, grey channel) ----------
  X.blendIfOut = function (b) {
    if (!b || !b.self || !b.under) return null; var full = { sourceRange: [0, 0, 255, 255], destRange: [0, 0, 255, 255] };
    return { compositeGrayBlendSource: b.self.map(Math.round), compositeGraphBlendDestinationRange: b.under.map(Math.round), ranges: [full, full, full, full] };
  };
  X.blendIfIn = function (r) {
    if (!r || !Array.isArray(r.compositeGrayBlendSource) || !Array.isArray(r.compositeGraphBlendDestinationRange)) return null;
    var s2 = r.compositeGrayBlendSource.slice(0, 4).map(function (v) { return clamp(v, 0, 255); }), u = r.compositeGraphBlendDestinationRange.slice(0, 4).map(function (v) { return clamp(v, 0, 255); });
    if (s2.length !== 4 || u.length !== 4 || (s2.join() === "0,0,255,255" && u.join() === "0,0,255,255")) return null;
    return { self: s2, under: u };
  };

  // ---------- layer styles ----------
  function gradOut(from, to, rev) { return { name: "Custom", type: "solid", smoothness: 1, colorStops: [{ color: rgb(from), location: 0, midpoint: 0.5 }, { color: rgb(to), location: 1, midpoint: 0.5 }], opacityStops: [{ opacity: 1, location: 0, midpoint: 0.5 }, { opacity: 1, location: 1, midpoint: 0.5 }] }; }
  var BEV = { inner: "inner bevel", outer: "outer bevel", emboss: "emboss", pillow: "pillow emboss", stroke: "stroke emboss" };
  X.fxOut = function (fx) {
    if (!fx) return null; var o = {}, any = false;
    function on(k) { return fx[k] && fx[k].on; }
    var e;
    if (on("dropShadow")) { e = fx.dropShadow; o.dropShadow = [{ enabled: true, present: true, blendMode: bo(e.blend), color: rgb(e.color), opacity: clamp(e.op, 0, 1), angle: e.angle || 0, distance: U(e.dist), choke: U(e.spread), size: U(e.size), useGlobalLight: false }]; any = true; }
    if (on("innerShadow")) { e = fx.innerShadow; o.innerShadow = [{ enabled: true, present: true, blendMode: bo(e.blend), color: rgb(e.color), opacity: clamp(e.op, 0, 1), angle: e.angle || 0, distance: U(e.dist), choke: U(e.choke), size: U(e.size), useGlobalLight: false }]; any = true; }
    if (on("outerGlow")) { e = fx.outerGlow; o.outerGlow = { enabled: true, present: true, blendMode: bo(e.blend), color: rgb(e.color), opacity: clamp(e.op, 0, 1), choke: U(e.spread), size: U(e.size), technique: "softer" }; any = true; }
    if (on("innerGlow")) { e = fx.innerGlow; o.innerGlow = { enabled: true, present: true, blendMode: bo(e.blend), color: rgb(e.color), opacity: clamp(e.op, 0, 1), choke: U(e.choke), size: U(e.size), source: e.source === "center" ? "center" : "edge", technique: "softer" }; any = true; }
    if (on("bevel")) { e = fx.bevel; o.bevel = { enabled: true, present: true, style: BEV[e.style] || "inner bevel", technique: "smooth", strength: clamp(e.depth, 1, 1000) / 100, direction: e.dir === "down" ? "down" : "up", size: U(e.size), soften: U(e.soften),
      angle: e.angle || 0, altitude: e.altitude || 30, useGlobalLight: false, highlightBlendMode: bo(e.hiBlend), highlightColor: rgb(e.hiColor), highlightOpacity: clamp(e.hiOp, 0, 1), shadowBlendMode: bo(e.shBlend), shadowColor: rgb(e.shColor), shadowOpacity: clamp(e.shOp, 0, 1) }; any = true; }
    if (on("satin")) { e = fx.satin; o.satin = { enabled: true, present: true, blendMode: bo(e.blend), color: rgb(e.color), opacity: clamp(e.op, 0, 1), angle: e.angle || 0, distance: U(e.dist), size: U(e.size), invert: e.invert !== false }; any = true; }
    if (on("colorOverlay")) { e = fx.colorOverlay; o.solidFill = [{ enabled: true, present: true, blendMode: bo(e.blend), color: rgb(e.color), opacity: clamp(e.op, 0, 1) }]; any = true; }
    if (on("gradOverlay")) { e = fx.gradOverlay; o.gradientOverlay = [{ enabled: true, present: true, blendMode: bo(e.blend), opacity: clamp(e.op, 0, 1), gradient: gradOut(e.from, e.to), type: ["linear", "radial", "angle", "reflected", "diamond"].indexOf(e.style) >= 0 ? e.style : "linear", angle: e.angle == null ? 90 : e.angle, scale: (e.scale || 100) / 100, reverse: !!e.reverse, align: true, dither: false, offset: { x: 0, y: 0 } }]; any = true; }
    if (on("stroke")) { e = fx.stroke; o.stroke = [{ enabled: true, present: true, size: U(e.size), position: ["inside", "center", "outside"].indexOf(e.pos) >= 0 ? e.pos : "outside", fillType: "color", blendMode: bo(e.blend), opacity: clamp(e.op, 0, 1), color: rgb(e.color) }]; any = true; }
    if (!any) return null;
    if (fx.on === false) o.disabled = true;
    o.scale = 1;
    return o;
  };
  X.fxIn = function (ef) {
    if (!ef) return null; var o = {}, any = false, notes = 0;
    function first(v) { return Array.isArray(v) ? v.filter(function (x) { return x && x.enabled !== false; })[0] : v && v.enabled !== false ? v : null; }
    function stops(g) { var cs = g && g.colorStops; return g && g.type === "solid" && cs && cs.length >= 2 ? [hex(cs[0].color, "#000000"), hex(cs[cs.length - 1].color, "#ffffff")] : null; }
    var e;
    if ((e = first(ef.dropShadow))) { o.dropShadow = { on: true, blend: bi(e.blendMode), color: hex(e.color, "#000000"), op: clamp(e.opacity == null ? 0.75 : e.opacity, 0, 1), angle: e.angle || 0, dist: V(e.distance), spread: V(e.choke), size: V(e.size) }; any = true; }
    if ((e = first(ef.innerShadow))) { o.innerShadow = { on: true, blend: bi(e.blendMode), color: hex(e.color, "#000000"), op: clamp(e.opacity == null ? 0.75 : e.opacity, 0, 1), angle: e.angle || 0, dist: V(e.distance), choke: V(e.choke), size: V(e.size) }; any = true; }
    if ((e = first(ef.outerGlow))) { o.outerGlow = { on: true, blend: bi(e.blendMode), color: hex(e.color, "#ffffbe"), op: clamp(e.opacity == null ? 0.75 : e.opacity, 0, 1), spread: V(e.choke), size: V(e.size) }; any = true; }
    if ((e = first(ef.innerGlow))) { o.innerGlow = { on: true, blend: bi(e.blendMode), color: hex(e.color, "#ffffbe"), op: clamp(e.opacity == null ? 0.75 : e.opacity, 0, 1), source: e.source === "center" ? "center" : "edge", choke: V(e.choke), size: V(e.size) }; any = true; }
    if ((e = first(ef.bevel))) { var st = Object.keys(BEV).filter(function (k) { return BEV[k] === e.style; })[0] || "inner";
      o.bevel = { on: true, style: st, depth: clamp((e.strength == null ? 1 : e.strength) * 100, 1, 1000), dir: e.direction === "down" ? "down" : "up", size: V(e.size), soften: V(e.soften), angle: e.angle || 0, altitude: e.altitude || 30,
        hiBlend: bi(e.highlightBlendMode || "screen"), hiColor: hex(e.highlightColor, "#ffffff"), hiOp: clamp(e.highlightOpacity == null ? 0.75 : e.highlightOpacity, 0, 1), shBlend: bi(e.shadowBlendMode || "multiply"), shColor: hex(e.shadowColor, "#000000"), shOp: clamp(e.shadowOpacity == null ? 0.75 : e.shadowOpacity, 0, 1) }; any = true; }
    if ((e = first(ef.satin))) { o.satin = { on: true, blend: bi(e.blendMode), color: hex(e.color, "#000000"), op: clamp(e.opacity == null ? 0.5 : e.opacity, 0, 1), angle: e.angle || 0, dist: V(e.distance), size: V(e.size), invert: e.invert !== false }; any = true; }
    if ((e = first(ef.solidFill))) { o.colorOverlay = { on: true, blend: bi(e.blendMode), color: hex(e.color, "#000000"), op: clamp(e.opacity == null ? 1 : e.opacity, 0, 1) }; any = true; }
    if ((e = first(ef.gradientOverlay))) { var s = stops(e.gradient); if (s) { o.gradOverlay = { on: true, blend: bi(e.blendMode), op: clamp(e.opacity == null ? 1 : e.opacity, 0, 1), from: s[0], to: s[1], style: ["linear", "radial", "angle", "reflected", "diamond"].indexOf(e.type) >= 0 ? e.type : "linear", angle: e.angle == null ? 90 : e.angle, scale: clamp((e.scale || 1) * 100, 10, 1000), reverse: !!e.reverse }; any = true; } else notes++; }
    if ((e = first(ef.stroke))) { if (!e.fillType || e.fillType === "color") { o.stroke = { on: true, size: V(e.size), pos: ["inside", "center", "outside"].indexOf(e.position) >= 0 ? e.position : "outside", blend: bi(e.blendMode), color: hex(e.color, "#000000"), op: clamp(e.opacity == null ? 1 : e.opacity, 0, 1) }; any = true; } else notes++; }
    if (first(ef.patternOverlay)) notes++;
    if (!any) return notes ? { fx: null, partial: true } : null;
    o.on = !ef.disabled;
    return { fx: o, partial: notes > 0 };
  };

  // ---------- fill layers ----------
  X.fillOut = function (s) {
    if (!s) return null;
    if (s.type === "solid") return { type: "color", color: rgb(PE.hex(s.color, "#000000")) };
    if (s.type === "gradient" && !s.fade) { var g = gradOut(PE.hex(s.from, "#000000"), PE.hex(s.to, "#ffffff")); return Object.assign(g, { style: ["linear", "radial", "reflected"].indexOf(s.style) >= 0 ? s.style : "linear", angle: s.angle == null ? 90 : s.angle, scale: (s.scale || 100) / 100, reverse: !!s.reverse, align: true, dither: false }); }
    return null;
  };
  X.fillIn = function (f) {
    if (!f) return null;
    if (f.type === "color" && f.color) return { type: "solid", color: hex(f.color, "#000000") };
    if (f.type === "solid" && f.colorStops && f.colorStops.length >= 2) {
      return { type: "gradient", from: hex(f.colorStops[0].color, "#000000"), to: hex(f.colorStops[f.colorStops.length - 1].color, "#ffffff"), style: ["linear", "radial", "reflected"].indexOf(f.style) >= 0 ? f.style : "linear", angle: f.angle == null ? 90 : f.angle, scale: clamp((f.scale || 1) * 100, 10, 1000), reverse: !!f.reverse, fade: false };
    }
    return null;
  };

  // ---------- vector masks: L.vmask = {paths:[{closed, pts:[[x,y,inX,inY,outX,outY]]}], on, invert, feather} ----------
  X.vmaskOut = function (vm) {
    if (!vm || !Array.isArray(vm.paths) || !vm.paths.length) return null;
    return { invert: !!vm.invert, disable: vm.on === false, paths: vm.paths.filter(function (p) { return p && p.pts && p.pts.length >= 2; }).map(function (p, i) {
      return { open: p.closed === false, operation: i === 0 ? "combine" : (p.op === "subtract" ? "subtract" : p.op === "intersect" ? "intersect" : p.op === "exclude" ? "exclude" : "combine"), fillRule: "non-zero",
        knots: p.pts.map(function (q) { return { linked: true, points: [q[2], q[3], q[0], q[1], q[4], q[5]] }; }) };
    }) };
  };
  X.vmaskIn = function (vm) {
    if (!vm || !Array.isArray(vm.paths) || !vm.paths.length || vm.fillStartsWithAllPixels) return null;
    var paths = vm.paths.filter(function (p) { return p.knots && p.knots.length >= 2; }).slice(0, 200).map(function (p) {
      var o = { closed: !p.open, pts: p.knots.slice(0, 5000).map(function (k) { var q = k.points; return [q[2], q[3], q[0], q[1], q[4], q[5]]; }) };
      if (p.operation && p.operation !== "combine") o.op = p.operation;
      return o;
    });
    return paths.length ? { paths: paths, on: !vm.disable, invert: !!vm.invert, feather: 0 } : null;
  };

  // ---------- extended shapes: any shape the vector lane can build becomes its exact path ----------
  X.shapeKnots = function (S) {
    var VX = PE.VX; if (!VX || !VX.docComps) return null;
    try {
      return VX.docComps({ kind: "shape", shape: S }).filter(function (c) { return c.pts && c.pts.length >= 2; }).map(function (c, i) {
        return { open: c.closed === false, op: i === 0 ? "combine" : ({ add: "combine", subtract: "subtract", intersect: "intersect", exclude: "exclude" })[c.op] || "combine",
          knots: c.pts.map(function (q) { return [q[2], q[3], q[0], q[1], q[4], q[5]]; }) };
      });
    } catch (e) { return null; }
  };

  // ---------- extended type settings (vector lane) on top of the base style ----------
  X.textOut = function (T, base) {
    var st = base.style, ps = base.paragraphStyle;
    if (T.track) st.tracking = Math.round(T.track);
    if (T.kern === "none") { st.autoKerning = false; st.kerning = 0; }
    if (T.base) st.baselineShift = T.base;
    if (T.hs && T.hs !== 100) st.horizontalScale = T.hs / 100;
    if (T.vs && T.vs !== 100) st.verticalScale = T.vs / 100;
    if (T.caps === "all") st.fontCaps = 2; else if (T.caps === "small") st.fontCaps = 1;
    if (T.under) st.underline = true; if (T.strike) st.strikethrough = true; if (T.fbold) st.fauxBold = true;
    if (T.sup === "sup" || T.sup === true) st.fontBaseline = 1; else if (T.sup === "sub") st.fontBaseline = 2;
    if (T.align && T.align.indexOf("justify") === 0) ps.justification = T.align;
    if (T.indL) ps.startIndent = T.indL; if (T.indR) ps.endIndent = T.indR; if (T.indF) ps.firstLineIndent = T.indF;
    if (T.spB) ps.spaceBefore = T.spB; if (T.spA) ps.spaceAfter = T.spA;
    return base;
  };

  // ---------- self-test (pure mappings; the integration with each lane is checked where both are present) ----------
  FX.tests.push(async function (ok) {
    var cases = [{ op: "levels", p: { inB: 10, inW: 240, gamma: 1.3, outB: 5, outW: 250 } }, { op: "curves", p: { rgb: [[0, 0], [100, 140], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 20], [255, 255]] } },
      { op: "hueSat", p: { hue: 30, sat: -20, light: 5, colorize: false } }, { op: "colorBalance", p: { sh: [0, 0, 0], mid: [10, -5, 3], hi: [0, 0, 0], keepLum: true } }, { op: "exposure", p: { ev: 1.5, offset: 0.01, gamma: 0.9 } },
      { op: "bw", p: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 } }, { op: "threshold", p: { level: 100 } }, { op: "vibrance", p: { vibrance: 30, sat: -10 } }, { op: "brightness", p: { b: 12, c: -4 } }];
    var bad = cases.filter(function (c) { var back = X.adjIn(X.adjOut(c)); return !back || back.op !== c.op || !X.same(back.p, c.p); }).map(function (c) { return c.op; });
    ok(!bad.length, "psd adjustment mapping round trip " + bad.join(","));
    // the adjust lane's fuller panels: native PSD structures out, and back to the same op where that op exists here
    var rg = [0, 1, 2, 3, 4, 5].map(function (i) { var d = HS_DEF(i); return [0, 0, 0, d.a, d.b, d.c, d.d]; }); rg[0] = [30, 20, -10, 315, 345, 15, 45];
    var plus = [{ op: "levelsPlus", p: { rgb: [5, 1.2, 250, 0, 255], r: [20, 1, 255, 0, 240], g: [0, 0.9, 255, 0, 255], b: [0, 1, 230, 10, 255] } },
      { op: "hueSatPlus", p: { master: [10, -5, 0], colorize: null, ranges: rg } }, { op: "hueSatPlus", p: { master: [0, 0, 0], colorize: [200, 40, -10], ranges: rg } },
      { op: "bwPlus", p: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: true, tintHue: 30, tintSat: 40 } }, { op: "brightnessPlus", p: { b: 30, c: -20, legacy: false } }];
    var lo = X.adjOut(plus[0]), ho = X.adjOut(plus[2]), bo2 = X.adjOut(plus[3]);
    ok(lo.red.shadowInput === 20 && lo.red.highlightOutput === 240 && lo.blue.shadowOutput === 10 && lo.rgb.midtoneInput === 1.2 && ho.colorize && ho.colorization.hue === 200 && ho.reds.hue === 30 && ho.reds.a === 315 && bo2.useTint && !X.adjOut(plus[4]).useLegacy && X.adjOut({ op: "brightness", p: { b: 1, c: 1 } }).useLegacy, "psd mapping of the fuller adjustment panels (out)");
    if (["levelsPlus", "hueSatPlus", "bwPlus", "brightnessPlus"].every(function (k) { return ED.ADJ && ED.ADJ[k]; })) {
      bad = plus.filter(function (c) { var back = X.adjIn(X.adjOut(c)); return !back || back.op !== c.op || !X.same(back.p, c.p); }).map(function (c) { return c.op; });
      ok(!bad.length, "psd mapping of the fuller adjustment panels (round trip) " + bad.join(","));
    }
    var tint = X.adjIn({ type: "black & white", reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, useTint: true, tintColor: { r: 225, g: 211, b: 179 } });
    ok(!tint || (tint.op === "bwPlus" && tint.p.tintHue === 42 && tint.p.tintSat === 20), "psd black & white tint reads the tint colour");
    var fx = { on: true, dropShadow: { on: true, blend: "multiply", color: "#112233", op: 0.6, angle: 135, dist: 9, spread: 10, size: 12 }, stroke: { on: true, size: 3, pos: "inside", blend: "normal", color: "#ff0000", op: 1 },
      gradOverlay: { on: true, blend: "screen", op: 0.8, from: "#000000", to: "#ffffff", style: "radial", angle: 45, scale: 150, reverse: true }, bevel: { on: true, style: "emboss", depth: 200, dir: "down", size: 6, soften: 1, angle: 120, altitude: 30, hiBlend: "screen", hiColor: "#ffffff", hiOp: 0.75, shBlend: "multiply", shColor: "#000000", shOp: 0.75 } };
    var back = X.fxIn(X.fxOut(fx)).fx;
    ok(back && X.same(back.dropShadow, fx.dropShadow) && X.same(back.stroke, fx.stroke) && X.same(back.gradOverlay, fx.gradOverlay) && X.same(back.bevel, fx.bevel), "psd layer style mapping round trip");
    var vm = { paths: [{ closed: true, pts: [[10, 10, 8, 10, 12, 10], [30, 10, 30, 10, 30, 10], [20, 30, 20, 30, 20, 30]] }], on: true, invert: false, feather: 0 };
    ok(X.same(X.vmaskIn(X.vmaskOut(vm)), vm), "psd vector mask mapping round trip");
    ok(X.same(X.fillIn(X.fillOut({ type: "solid", color: "#336699" })), { type: "solid", color: "#336699" }) && X.fillIn(X.fillOut({ type: "gradient", from: "#000000", to: "#ff0000", style: "radial", angle: 30, scale: 120, reverse: false, fade: false })).style === "radial", "psd fill layer mapping");
  });
})();
