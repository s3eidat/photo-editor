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

    // shadows / highlights on flat greys: L' = B^(1/(1+3a*w)) with w the tonal weight
    var g64 = run([[64, 64, 64], [64, 64, 64], [64, 64, 64], [64, 64, 64]], "shadowsHighlights", { sAmt: 50, sTone: 100, sRad: 4, hAmt: 0, color: 0 }, null, 2, 2);
    var B = 64 / 255, ws = 1 - B * B * (3 - 2 * B), want = 255 * Math.pow(B, 1 / (1 + 1.5 * ws));
    ok(near(get(g64, 0)[0], want, 1.5) && get(g64, 3)[1] === get(g64, 3)[0], "shadows lift a dark grey (" + get(g64, 0)[0] + " want " + Math.round(want) + ")");
    var bw = run([[0, 0, 0], [255, 255, 255]], "shadowsHighlights", { sAmt: 100, sTone: 100, sRad: 0, hAmt: 100, hTone: 100, hRad: 0 });
    ok(get(bw, 0).join() === "0,0,0" && get(bw, 1)[0] > 250, "black stays black");
    var hi = run([[230, 230, 230]], "shadowsHighlights", { sAmt: 0, hAmt: 60, hTone: 60, hRad: 0 });
    ok(get(hi, 0)[0] < 222, "highlights recover a bright grey (" + get(hi, 0)[0] + ")");

    // fade: half of an inverted grey, multiply mode, and the old selection limits it
    function cv(px, w) { var c = PE.mk(w, 1), x = c.getContext("2d"), d = x.createImageData(w, 1); px.forEach(function (q, i) { d.data.set([q[0], q[1], q[2], 255], i * 4); }); x.putImageData(d, 0, 0); return c; }
    function cpx(c, i) { return Array.prototype.slice.call(c.getContext("2d").getImageData(i, 0, 1, 1).data, 0, 3); }
    var fb = cv([[200, 100, 0], [200, 100, 0]], 2), fa = cv([[55, 155, 255], [55, 155, 255]], 2);
    var f1 = PE.adjUI.fadeMix(fb, fa, 0.5, "source-over", null), f2 = PE.adjUI.fadeMix(fb, fa, 1, "multiply", new Uint8Array([255, 0]));
    ok(near(cpx(f1, 0)[0], 128, 1) && near(cpx(f1, 0)[2], 128, 1), "fade 50% normal");
    ok(near(cpx(f2, 0)[0], 43, 1) && near(cpx(f2, 0)[1], 61, 1) && cpx(f2, 1).join() === "200,100,0", "fade multiply inside the old selection only");
    var wk = await PE.work("adjust", [im([[50, 100, 20], [200, 150, 220]]), "autoTone", { clip: 0 }, null]);
    ok(wk.data[0] === 0 && wk.data[4] === 255, "extra ops run in the worker");
  };
})();
