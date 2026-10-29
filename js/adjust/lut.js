/* Adjust lane: colour lookup tables. Parses .cube files (3D and 1D), applies them with trilinear interpolation,
   and builds the built-in looks from small colour functions (made for this app). Pure maths, page + worker. */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num;

  // Parse the text of a .cube file -> {kind: "3d"|"1d", n, data: Float32Array (rgb triples, red fastest), min, max, title}.
  A.parseCube = function (text) {
    var lines = String(text).split(/\r?\n/), n3 = 0, n1 = 0, min = [0, 0, 0], max = [1, 1, 1], title = "", vals = [], i;
    for (i = 0; i < lines.length; i++) {
      var ln = lines[i].replace(/#.*/, "").trim(); if (!ln) continue;
      var m = /^(\w+)\s*(.*)$/.exec(ln), kw = m ? m[1].toUpperCase() : "";
      if (kw === "TITLE") { title = m[2].replace(/^"|"$/g, "").slice(0, 80); continue; }
      if (kw === "LUT_3D_SIZE") { n3 = parseInt(m[2], 10); continue; }
      if (kw === "LUT_1D_SIZE") { n1 = parseInt(m[2], 10); continue; }
      if (kw === "DOMAIN_MIN" || kw === "DOMAIN_MAX") { var v = m[2].trim().split(/\s+/).map(Number); if (v.length !== 3 || v.some(function (x) { return !isFinite(x); })) throw new Error("Bad " + kw + " line"); if (kw === "DOMAIN_MIN") min = v; else max = v; continue; }
      if (kw === "LUT_3D_INPUT_RANGE" || kw === "LUT_1D_INPUT_RANGE") { var rr = m[2].trim().split(/\s+/).map(Number); if (rr.length === 2) { min = [rr[0], rr[0], rr[0]]; max = [rr[1], rr[1], rr[1]]; } continue; }
      var t = ln.split(/\s+/);
      if (t.length === 3 && /^[-+.\deE]/.test(t[0])) {
        var a = +t[0], b = +t[1], c = +t[2];
        if (!isFinite(a) || !isFinite(b) || !isFinite(c)) throw new Error("Bad number on line " + (i + 1));
        vals.push(a, b, c); continue;
      }
      if (/^[A-Z_0-9]+$/.test(kw)) continue;     // other keywords are ignored
      throw new Error("Unexpected text on line " + (i + 1));
    }
    if (n3 && n1) throw new Error("The file has both 1D and 3D sizes");
    if (n3) { if (n3 < 2 || n3 > 129) throw new Error("3D size must be 2–129"); if (vals.length !== n3 * n3 * n3 * 3) throw new Error("Expected " + n3 * n3 * n3 + " colours, found " + vals.length / 3); }
    else if (n1) { if (n1 < 2 || n1 > 65536) throw new Error("1D size must be 2–65536"); if (vals.length !== n1 * 3) throw new Error("Expected " + n1 + " colours, found " + vals.length / 3); }
    else throw new Error("No LUT_3D_SIZE or LUT_1D_SIZE in the file");
    if (min.some(function (x, k) { return !(max[k] > x); })) throw new Error("DOMAIN_MAX must be above DOMAIN_MIN");
    return { kind: n3 ? "3d" : "1d", n: n3 || n1, data: new Float32Array(vals), min: min, max: max, title: title };
  };
  // Pack / unpack a LUT for messages: 16-bit values over [lo, hi] (output range), base64.
  A.packLut = function (L) {
    var lo = Infinity, hi = -Infinity, d = L.data, i;
    for (i = 0; i < d.length; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    if (!(hi > lo)) hi = lo + 1;
    var u = new Uint16Array(d.length); for (i = 0; i < d.length; i++) u[i] = Math.round((d[i] - lo) / (hi - lo) * 65535);
    var b = new Uint8Array(u.buffer), s = "", CH = 0x8000;
    for (i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
    return { kind: L.kind, n: L.n, min: L.min, max: L.max, lo: lo, hi: hi, b64: btoa(s) };
  };
  A.unpackLut = function (P) {
    var b = A.b64(P.b64), u = new Uint16Array(b.buffer, 0, b.length >> 1), d = new Float32Array(u.length), lo = +P.lo, sp = +P.hi - lo;
    for (var i = 0; i < u.length; i++) d[i] = lo + u[i] / 65535 * sp;
    return { kind: P.kind === "1d" ? "1d" : "3d", n: P.n | 0, data: d, min: P.min || [0, 0, 0], max: P.max || [1, 1, 1] };
  };
  // Look up one colour (0..1 in the LUT's domain units) -> o (0..1).
  A.lutLookup = function (L, r, g, b, o) {
    var n = L.n, d = L.data, mn = L.min, mx = L.max;
    var x = clamp((r - mn[0]) / (mx[0] - mn[0]), 0, 1) * (n - 1), y = clamp((g - mn[1]) / (mx[1] - mn[1]), 0, 1) * (n - 1), z = clamp((b - mn[2]) / (mx[2] - mn[2]), 0, 1) * (n - 1);
    if (L.kind === "1d") {
      var xs = [x, y, z];
      for (var c = 0; c < 3; c++) { var i0 = Math.floor(xs[c]), i1 = Math.min(n - 1, i0 + 1), t = xs[c] - i0; o[c] = d[i0 * 3 + c] + (d[i1 * 3 + c] - d[i0 * 3 + c]) * t; }
      return o;
    }
    var x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1), z1 = Math.min(n - 1, z0 + 1), tx = x - x0, ty = y - y0, tz = z - z0;
    for (var k = 0; k < 3; k++) {
      var c000 = d[((z0 * n + y0) * n + x0) * 3 + k], c100 = d[((z0 * n + y0) * n + x1) * 3 + k], c010 = d[((z0 * n + y1) * n + x0) * 3 + k], c110 = d[((z0 * n + y1) * n + x1) * 3 + k];
      var c001 = d[((z1 * n + y0) * n + x0) * 3 + k], c101 = d[((z1 * n + y0) * n + x1) * 3 + k], c011 = d[((z1 * n + y1) * n + x0) * 3 + k], c111 = d[((z1 * n + y1) * n + x1) * 3 + k];
      var c00 = c000 + (c100 - c000) * tx, c10 = c010 + (c110 - c010) * tx, c01 = c001 + (c101 - c001) * tx, c11 = c011 + (c111 - c011) * tx;
      var c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty; o[k] = c0 + (c1 - c0) * tz;
    }
    return o;
  };
  // Build a 3D LUT from f(r, g, b) -> [r, g, b] (all 0..1).
  A.lutFromFn = function (f, n) {
    n = n || 25; var d = new Float32Array(n * n * n * 3), q = 0;
    for (var b = 0; b < n; b++) for (var g = 0; g < n; g++) for (var r = 0; r < n; r++) { var o = f(r / (n - 1), g / (n - 1), b / (n - 1)); d[q++] = o[0]; d[q++] = o[1]; d[q++] = o[2]; }
    return { kind: "3d", n: n, data: d, min: [0, 0, 0], max: [1, 1, 1] };
  };

  // ---------- built-in looks ----------
  function lum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  function sat(c, k) { var y = lum(c[0], c[1], c[2]); return [y + (c[0] - y) * k, y + (c[1] - y) * k, y + (c[2] - y) * k]; }
  function sc(t, k) { return 0.5 + (t - 0.5) * k; }
  function s(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  var LOOKS = A.LOOKS = {
    tealOrange: ["Teal and orange", function (r, g, b) { var y = lum(r, g, b), w = s(y); var c = mix([r * 0.9, g * 1.02 + 0.03, b * 1.12 + 0.05], [r * 1.12 + 0.03, g * 1.0 + 0.01, b * 0.82], w); c = sat(c, 1.12); return c.map(function (v) { return sc(v, 1.08); }); }],
    warmFilm: ["Warm film", function (r, g, b) { var c = [0.06 + r * 0.92 * 1.05, 0.05 + g * 0.9, 0.04 + b * 0.82]; c = sat(c, 0.85); return c.map(function (v) { return v + (s(v) - v) * 0.5; }); }],
    coolFilm: ["Cool film", function (r, g, b) { var c = [0.03 + r * 0.9, 0.05 + g * 0.93, 0.08 + b * 0.95]; c = sat(c, 0.8); return c.map(function (v) { return v + (s(v) - v) * 0.4; }); }],
    bleach: ["Silver bleach", function (r, g, b) { var y = lum(r, g, b), c = sat([r, g, b], 0.45), t = s(y); return c.map(function (v) { return clamp(v * 0.5 + t * 0.5 + (s(v) - v) * 0.6, 0, 1); }); }],
    fade: ["Vintage fade", function (r, g, b) { var c = sat([r, g, b], 0.75); return [0.1 + c[0] * 0.85, 0.08 + c[1] * 0.82, 0.12 + c[2] * 0.72]; }],
    cross: ["Cross process", function (r, g, b) { return [clamp(s(r) * 1.05, 0, 1), clamp(g * 1.05 + (s(g) - g) * 0.6, 0, 1), clamp(0.12 + b * 0.7, 0, 1)]; }],
    night: ["Day for night", function (r, g, b) { var y = lum(r, g, b), c = sat([r, g, b], 0.3); return [c[0] * 0.35, c[1] * 0.5 + y * 0.05, c[2] * 0.75 + y * 0.12]; }],
    monoWarm: ["Warm monochrome", function (r, g, b) { var y = s(lum(r, g, b)) * 0.6 + lum(r, g, b) * 0.4; return [y * 1.06 + 0.02, y * 0.98 + 0.01, y * 0.86]; }],
    golden: ["Golden hour", function (r, g, b) { var y = lum(r, g, b); var c = [r * 1.08 + 0.04 * (1 - y), g * 1.0 + 0.02, b * 0.85]; return sat(c, 1.1); }],
    lush: ["Lush greens", function (r, g, b) { var c = [r, g, b], mx = Math.max(r, g, b); if (g === mx) { var k = (g - Math.min(r, b)); c = [r - k * 0.08, g + k * 0.06, b + k * 0.04]; } return sat(c, 1.15).map(function (v) { return sc(v, 1.05); }); }],
    arctic: ["Arctic", function (r, g, b) { var c = sat([r * 0.92, g * 0.98, b * 1.08 + 0.03], 0.7); return c.map(function (v) { return 0.05 + v * 0.95; }); }]
  };
  var cache = {};
  A.lookLut = function (id) { if (!LOOKS[id]) return null; return cache[id] || (cache[id] = A.lutFromFn(LOOKS[id][1], 25)); };

  // p.look = built-in id, or p.lut = packed LUT; p.amount 0..100.
  A.reg("colorLookup", function (img, p, sel) {
    var L = p.lut && p.lut.b64 ? A.unpackLut(p.lut) : A.lookLut(p.look || "tealOrange"), k = clamp(num(p.amount, 100), 0, 100) / 100, o = [0, 0, 0];
    if (!L || !k) return img;
    return A.perPixel(img, sel, function (r, g, b, out) {
      A.lutLookup(L, r / 255, g / 255, b / 255, o);
      out[0] = r + (o[0] * 255 - r) * k; out[1] = g + (o[1] * 255 - g) * k; out[2] = b + (o[2] * 255 - b) * k;
    });
  });
})(typeof self !== "undefined" ? self : this);
