/* Workspace (files lane): colour maths for the Info panel, image modes and proofing. sRGB (D65) <-> CIE XYZ <-> Lab
   (D50 white point with Bradford adaptation, the convention editors use), HSB, and a simple CMYK. */
(function () {
  "use strict";
  var PE = window.PE, WS = PE.ws;
  var C = WS.color = {};
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function gam(v) { v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, v * 255)); }
  C.lin = lin; C.gam = gam;
  // sRGB -> XYZ D50 (sRGB matrix already Bradford-adapted to D50)
  C.rgb2xyz = function (r, g, b) {
    var R = lin(r), G = lin(g), B = lin(b);
    return [0.4360747 * R + 0.3850649 * G + 0.1430804 * B, 0.2225045 * R + 0.7168786 * G + 0.0606169 * B, 0.0139322 * R + 0.0971045 * G + 0.7141733 * B];
  };
  C.xyz2rgb = function (X, Y, Z) {
    return [gam(3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z), gam(-0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z), gam(0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z)];
  };
  var WX = 0.96422, WY = 1, WZ = 0.82521;
  function f(t) { return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; }
  function fi(t) { var t3 = t * t * t; return t3 > 216 / 24389 ? t3 : (116 * t - 16) / (24389 / 27); }
  C.rgb2lab = function (r, g, b) { var x = C.rgb2xyz(r, g, b), fx = f(x[0] / WX), fy = f(x[1] / WY), fz = f(x[2] / WZ); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
  C.lab2rgb = function (L, a, b) { var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200; return C.xyz2rgb(fi(fx) * WX, (L > 8 ? fy * fy * fy : L / (24389 / 27)) * WY, fi(fz) * WZ); };
  C.rgb2hsb = function (r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, hh = 0;
    if (d) { if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
    return [hh, mx ? d / mx * 100 : 0, mx / 255 * 100];
  };
  C.rgb2cmyk = function (r, g, b) {      // device-independent "simple" CMYK (no profile)
    var k = 1 - Math.max(r, g, b) / 255; if (k >= 1) return [0, 0, 0, 100];
    return [(1 - r / 255 - k) / (1 - k) * 100, (1 - g / 255 - k) / (1 - k) * 100, (1 - b / 255 - k) / (1 - k) * 100, k * 100];
  };
  C.lum = function (r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; };

  PE.files.tests.push(async function (ok, near) {
    var L = C.rgb2lab(255, 0, 0); ok(near(L[0], 54.29, 0.05) && near(L[1], 80.8, 0.1) && near(L[2], 69.89, 0.1), "Lab of pure red (D50) " + L.map(function (v) { return v.toFixed(2); }));
    var W = C.rgb2lab(255, 255, 255); ok(near(W[0], 100, 0.01) && near(W[1], 0, 0.01) && near(W[2], 0, 0.01), "Lab of white");
    var back = C.lab2rgb.apply(null, C.rgb2lab(30, 140, 220)); ok(near(back[0], 30, 0.5) && near(back[1], 140, 0.5) && near(back[2], 220, 0.5), "Lab round trip");
    var hs = C.rgb2hsb(255, 128, 0); ok(near(hs[0], 30.1, 0.2) && near(hs[1], 100, 0.01) && near(hs[2], 100, 0.01), "HSB");
    var k = C.rgb2cmyk(255, 0, 0); ok(k.join() === "0,100,100,0", "simple CMYK");
  });
})();
