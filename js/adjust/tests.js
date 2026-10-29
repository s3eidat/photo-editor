/* Adjust lane: known-answer checks, run by S3_SELFTEST (app.js) through PE.adjustTests(ok, near). */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX;
  function im(px, w, h) { var d = new Uint8ClampedArray(px.length * 4); px.forEach(function (c, i) { d.set([c[0], c[1], c[2], c.length > 3 ? c[3] : 255], i * 4); }); return { data: d, width: w || px.length, height: h || 1 }; }
  function get(img, i) { return Array.prototype.slice.call(img.data, i * 4, i * 4 + 3); }
  function run(px, op, p, sel, w, h) { var a = im(px, w, h); PIX.adjust(a, op, p || {}, sel); return a; }
  PE.adjustTests = async function (ok, near) {
    // auto tone / contrast / colour
    var a1 = run([[50, 100, 20], [200, 150, 220]], "autoTone", { clip: 0 });
    ok(get(a1, 0).join() === "0,0,0" && get(a1, 1).join() === "255,255,255", "auto tone stretches each channel");
    var a2 = run([[50, 100, 20], [200, 150, 220]], "autoContrast", { clip: 0 });
    ok(near(get(a2, 0)[0], 38) && near(get(a2, 0)[1], 102) && get(a2, 0)[2] === 0 && get(a2, 1)[2] === 255 && near(get(a2, 1)[0], 230), "auto contrast stretches all channels together");
    var cast = []; for (var i = 0; i < 64; i++) { var v = 40 + i * 2.5; cast.push([v * 0.8, v * 0.9, Math.min(255, v * 1.25)]); }
    cast.push([0, 0, 0]); cast.push([255, 255, 255]);
    var a3 = run(cast, "autoColor", { clip: 0 }), s = [0, 0, 0];
    for (i = 0; i < 64; i++) { var q = get(a3, i); s[0] += q[0]; s[1] += q[1]; s[2] += q[2]; }
    ok(Math.abs(s[0] - s[2]) / 64 < 6 && Math.abs(s[1] - s[2]) / 64 < 6, "auto colour neutralises a cast (" + s.map(function (x) { return Math.round(x / 64); }) + ")");
    var a4 = run([[50, 50, 50], [200, 200, 200]], "autoContrast", { clip: 0 }, new Uint8Array([255, 0]));
    ok(get(a4, 1).join() === "200,200,200", "auto ops respect the selection");
    var wk = await PE.work("adjust", [im([[50, 100, 20], [200, 150, 220]]), "autoTone", { clip: 0 }, null]);
    ok(wk.data[0] === 0 && wk.data[4] === 255, "extra ops run in the worker");
  };
})();
