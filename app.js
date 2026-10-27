/* Photo Editor — demo document and self-test. The editor lives in js/ (pix, core, editor, ui). */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed;

  // A "photo" drawn in code (no stock images): a lake at sunset with hills, a reflection and film grain.
  function scene(w, h) {
    var c = PE.mk(w, h), x = PE.cx2(c), g = x.createLinearGradient(0, 0, 0, h * 0.62);
    g.addColorStop(0, "#1d2b64"); g.addColorStop(0.45, "#a8466b"); g.addColorStop(0.8, "#f39060"); g.addColorStop(1, "#ffd59a");
    x.fillStyle = g; x.fillRect(0, 0, w, h * 0.62);
    var sun = x.createRadialGradient(w * 0.62, h * 0.55, 0, w * 0.62, h * 0.55, w * 0.22);
    sun.addColorStop(0, "rgba(255,246,214,1)"); sun.addColorStop(0.18, "rgba(255,226,160,.95)"); sun.addColorStop(1, "rgba(255,180,110,0)");
    x.fillStyle = sun; x.fillRect(0, 0, w, h * 0.62);
    [["#5b2d5e", 0.5, 0.07, 1.1], ["#3b1d47", 0.56, 0.06, 2.3], ["#241336", 0.6, 0.035, 3.7]].forEach(function (l, i) {
      x.fillStyle = l[0]; x.beginPath(); x.moveTo(0, h * 0.62);
      for (var k = 0; k <= 40; k++) x.lineTo(k / 40 * w, h * l[1] - (Math.sin(k * 0.35 * l[3] + i) * 0.6 + Math.sin(k * 0.9 + i * 2) * 0.4) * h * l[2]);
      x.lineTo(w, h * 0.62); x.closePath(); x.fill();
    });
    x.fillStyle = "#2b1d45"; x.fillRect(0, h * 0.62, w, h * 0.38);
    x.save(); x.translate(0, h * 1.24); x.scale(1, -1); x.globalAlpha = 0.6; x.drawImage(c, 0, h * 0.24, w, h * 0.38, 0, h * 0.24, w, h * 0.38); x.restore();   // reflection
    var wg = x.createLinearGradient(0, h * 0.62, 0, h); wg.addColorStop(0, "rgba(25,20,60,.25)"); wg.addColorStop(1, "rgba(10,10,30,.75)");
    x.fillStyle = wg; x.fillRect(0, h * 0.62, w, h * 0.38);
    x.strokeStyle = "rgba(255,225,170,.35)"; x.lineWidth = Math.max(1, h * 0.003);
    for (var r = 0; r < 26; r++) { var yy = h * (0.64 + r * 0.013), half = w * (0.03 + r * 0.004); x.beginPath(); x.moveTo(w * 0.62 - half, yy); x.lineTo(w * 0.62 + half, yy); x.stroke(); }
    var id = x.getImageData(0, 0, w, h); PIX.noise(id, 2.2, true, true, 11); x.putImageData(id, 0, 0);
    return PE.touch(c);
  }

  window.S3_DEMO = async function () {
    await ED.ready;
    var W = 1600, H = 1067, d = PE.newDoc(W, H, "Lake at sunset");
    var bg = PE.rasterFromCanvas(scene(W, H), "Photo");
    // a warm glow layer with a gradient mask (fades out towards the water)
    var glowC = PE.mk(W, H), gx = PE.cx2(glowC), gg = gx.createRadialGradient(W * 0.62, H * 0.5, 0, W * 0.62, H * 0.5, W * 0.6);
    gg.addColorStop(0, "rgba(255,170,90,.95)"); gg.addColorStop(1, "rgba(255,120,60,0)"); gx.fillStyle = gg; gx.fillRect(0, 0, W, H);
    var glow = PE.rasterFromCanvas(PE.touch(glowC), "Warm glow"); glow.blend = "screen"; glow.opacity = 0.55;
    var mc = PE.mk(W, H), mx = PE.cx2(mc), mg = mx.createLinearGradient(0, H * 0.45, 0, H * 0.8);
    mg.addColorStop(0, "rgba(255,255,255,1)"); mg.addColorStop(1, "rgba(255,255,255,0)"); mx.fillStyle = mg; mx.fillRect(0, 0, W, H);
    glow.mask = { canvas: PE.touch(mc), x: 0, y: 0 };
    var band = PE.newLayer("shape", { name: "Title band", opacity: 0.85, blend: "multiply", shape: { type: "rect", x: 96, y: 96, w: 640, h: 210, fill: "#2a1d4a", stroke: "#ffd59a", sw: 0, radius: 26 } });
    var title = PE.newLayer("text", { name: "Golden hour", text: { text: "Golden hour", font: "Georgia", size: 92, weight: 700, italic: true, color: "#ffe7bd", align: "left", ax: 140, ay: 120 } });
    var ar = PE.newLayer("text", { name: "ساعة ذهبية", text: { text: "ساعة ذهبية", font: "Noto Naskh Arabic", size: 58, weight: 400, color: "#ffd59a", align: "left", dir: "rtl", ax: 140, ay: 222 } });
    d.layers = [bg, glow, band, title, ar]; d.active = glow.id; d.fg = "#ffd59a"; d.bg = "#1d2b64";
    ED.testing = false;
    ED.openDoc(d, "Open");
    ED.ui.colors();
    var sel = PE.makeSel(d, ED.marqueeMask({ x: W * 0.47, y: H * 0.36, w: W * 0.3, h: H * 0.38 }, true));
    d.sel = sel; ED.setActive(glow.id, true); ED.setTool("brush");
    ED.changed();
    await new Promise(function (r) { setTimeout(r, 250); });
  };

  window.S3_SELFTEST = async function () {
    var fails = [];
    function ok(c, m) { if (!c) fails.push(m); }
    function near(a, b, e) { return Math.abs(a - b) <= (e == null ? 1 : e); }
    function px(c, x, y) { return Array.prototype.slice.call(PE.cx2(c).getImageData(x, y, 1, 1).data); }
    function solid(w, hh, css) { var c = PE.mk(w, hh), x = PE.cx2(c); x.fillStyle = css; x.fillRect(0, 0, w, hh); return PE.touch(c); }
    var savedDoc = ED.doc, savedHist = ED.hist;
    ED.testing = true;

    // 1. blend-mode maths (W3C formulas) and the canvas compositor agree
    var m1 = PIX.compositePixel("multiply", [200, 100, 50, 255], [128, 255, 0, 255], 1);
    ok(near(m1[0], 100) && m1[1] === 100 && m1[2] === 0 && m1[3] === 255, "multiply maths");
    var s1 = PIX.compositePixel("screen", [100, 0, 255, 255], [100, 255, 0, 255], 1);
    ok(near(s1[0], 161) && s1[1] === 255 && s1[2] === 255, "screen maths");
    var o1 = PIX.compositePixel("overlay", [64, 192, 128, 255], [200, 200, 200, 255], 1);
    ok(near(o1[0], 100) && near(o1[1], 228) && near(o1[2], 200), "overlay maths");
    ok(PIX.compositePixel("difference", [200, 10, 0, 255], [50, 60, 255, 255], 1).slice(0, 3).join() === "150,50,255", "difference maths");
    var pairs = [[[200, 120, 40, 255], [30, 180, 250, 255], 1], [[90, 200, 160, 255], [240, 60, 120, 200], 0.6], [[10, 250, 128, 140], [200, 100, 30, 255], 0.8]];
    PE.BLENDS.forEach(function (mode) {
      pairs.forEach(function (pr, k) {
        var d = PE.newDoc(2, 1, "t"), b = PE.rasterFromCanvas(solid(2, 1, "rgba(" + pr[0].slice(0, 3).join(",") + "," + pr[0][3] / 255 + ")")), s = PE.rasterFromCanvas(solid(2, 1, "rgba(" + pr[1].slice(0, 3).join(",") + "," + pr[1][3] / 255 + ")"));
        var bb = px(b.canvas, 0, 0), ss = px(s.canvas, 0, 0);
        s.blend = mode; s.opacity = pr[2]; d.layers = [b, s];
        var got = px(PE.flatten(d), 0, 0), exp = PIX.compositePixel(mode, bb, ss, pr[2]);
        ok(near(got[3], exp[3], 2) && (exp[3] < 8 || (near(got[0], exp[0], 3) && near(got[1], exp[1], 3) && near(got[2], exp[2], 3))), "compositor " + mode + " #" + k + " got " + got + " want " + exp);
      });
    });

    // 2. layer masks: black hides, white shows, grey is partial; mask moves with its offset
    var md = PE.newDoc(4, 1, "m"), ml = PE.rasterFromCanvas(solid(4, 1, "#ff0000")), mc = PE.mk(4, 1), mx = PE.cx2(mc);
    mx.fillStyle = "#fff"; mx.fillRect(0, 0, 1, 1); mx.fillStyle = "rgba(255,255,255,0.5)"; mx.fillRect(1, 0, 1, 1); ml.mask = { canvas: PE.touch(mc), x: 0, y: 0 }; md.layers = [ml];
    var mf = PE.flatten(md);
    ok(px(mf, 0, 0)[3] === 255 && near(px(mf, 1, 0)[3], 128, 2) && px(mf, 2, 0)[3] === 0, "mask hides / shows / partial");
    ml.maskOn = false; ok(px(PE.flatten(md), 3, 0)[3] === 255, "disabled mask shows all");

    // 3. magic wand flood fill on a synthetic image
    var W = 20, img = { data: new Uint8ClampedArray(W * W * 4), width: W, height: W };
    for (var y = 0; y < W; y++) for (var x = 0; x < W; x++) {
      var i = (y * W + x) * 4, red = (x >= 2 && x < 8 && y >= 2 && y < 8) || (x >= 12 && x < 16 && y >= 12 && y < 16);
      img.data[i] = red ? 220 + (x % 3) : 20; img.data[i + 1] = 30; img.data[i + 2] = red ? 30 : 200; img.data[i + 3] = 255;
    }
    function count(m) { var n = 0; for (var q = 0; q < m.length; q++) if (m[q] >= 128) n++; return n; }
    ok(count(PIX.wand(img, 3, 3, 10, true)) === 36, "wand contiguous");
    ok(count(PIX.wand(img, 3, 3, 10, false)) === 52, "wand non-contiguous");
    ok(count(PIX.wand(img, 3, 3, 0, true)) < 36, "wand tolerance 0 is strict");
    ok(count(PIX.wand(img, 0, 0, 10, true)) === 400 - 52, "wand background");
    PE.startWorker();
    for (var wt = 0; wt < 40 && !PE.workerAlive(); wt++) await new Promise(function (r) { setTimeout(r, 25); });
    var wm = await PE.work("wand", [{ data: new Uint8ClampedArray(img.data), width: W, height: W }, 3, 3, 10, true]);
    ok(count(wm) === 36, "wand via worker" + (PE.workerAlive() ? "" : " (fallback)"));

    // 4. selection booleans + feather + grow
    var A = PIX.rectMask(10, 10, 0, 0, 6, 10), B = PIX.rectMask(10, 10, 4, 0, 6, 10);
    ok(count(PIX.combine(A, B, "add")) === 100 && count(PIX.combine(A, B, "subtract")) === 40 && count(PIX.combine(A, B, "intersect")) === 20 && count(PIX.combine(A, B, "new")) === 60, "selection booleans");
    ok(count(PIX.invertMask(A)) === 40, "invert selection");
    var F = PIX.feather(PIX.rectMask(60, 60, 15, 15, 30, 30), 60, 60, 8);
    ok(F[30 * 60 + 30] > 250 && near(F[30 * 60 + 15], 128, 25) && F[30 * 60 + 2] < 10 && F[30 * 60 + 10] < F[30 * 60 + 14], "feather falloff");
    ok(count(PIX.grow(PIX.rectMask(20, 20, 5, 5, 4, 4), 20, 20, 2)) === 64 && count(PIX.grow(PIX.rectMask(20, 20, 5, 5, 6, 6), 20, 20, -1)) === 16, "expand / contract");
    var bb2 = PIX.bounds(PIX.rectMask(30, 20, 3, 4, 10, 5), 30, 20); ok(bb2.x === 3 && bb2.y === 4 && bb2.w === 10 && bb2.h === 5, "selection bounds");

    // 5. adjustments on known colours
    var lv = PIX.lutLevels(50, 200, 1, 0, 255); ok(lv[50] === 0 && lv[200] === 255 && near(lv[125], 128) && lv[10] === 0 && lv[250] === 255, "levels in");
    ok(near(PIX.lutLevels(0, 255, 2, 0, 255)[64], 128) && PIX.lutLevels(0, 255, 1, 20, 220)[0] === 20 && PIX.lutLevels(0, 255, 1, 20, 220)[255] === 220, "levels gamma / out");
    var cid = PIX.lutCurve([[0, 0], [255, 255]]), ok1 = true; for (var q = 0; q < 256; q++) if (cid[q] !== q) ok1 = false; ok(ok1, "curve identity");
    var cv = PIX.lutCurve([[0, 0], [128, 192], [255, 255]]), mono = true; for (q = 1; q < 256; q++) if (cv[q] < cv[q - 1]) mono = false;
    ok(cv[128] === 192 && mono && cv[0] === 0 && cv[255] === 255, "curve through point, monotone");
    function adj(rgb, op, p) { var im = { data: new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]), width: 1, height: 1 }; PIX.adjust(im, op, p); return Array.prototype.slice.call(im.data, 0, 3); }
    ok(adj([255, 0, 0], "hueSat", { hue: 120 }).join() === "0,255,0", "hue +120: red -> green");
    ok(adj([255, 0, 0], "hueSat", { hue: -120 }).join() === "0,0,255", "hue -120: red -> blue");
    var gr = adj([255, 0, 0], "hueSat", { sat: -100 }); ok(gr[0] === gr[1] && gr[1] === gr[2] && near(gr[0], 128), "saturation -100");
    ok(adj([100, 100, 100], "brightness", { b: 20, c: 0 }).join() === "120,120,120", "brightness");
    ok(adj([10, 128, 250], "invert").join() === "245,127,5", "invert");
    ok(adj([255, 0, 0], "bw", PIX.BW_DEFAULT).join() === "102,102,102" && adj([255, 255, 0], "bw", PIX.BW_DEFAULT)[0] === 153, "black & white weights");
    ok(adj([100, 160, 90], "threshold", { level: 128 })[0] === 255 && adj([100, 100, 90], "threshold", { level: 128 })[0] === 0, "threshold");
    ok(near(adj([128, 128, 128], "exposure", { ev: 1 })[0], 175), "exposure +1 stop (linear light)");
    var vb = adj([200, 120, 120], "vibrance", { vibrance: 50 }); ok(vb[0] > 200 && vb[1] < 120, "vibrance boosts muted colour");
    var cb = adj([128, 128, 128], "colorBalance", { mid: [50, 0, 0], keepLum: false }); ok(cb[0] > 150 && cb[1] === 128, "colour balance midtones");
    var sel1 = new Uint8Array([0, 255]), im2 = { data: new Uint8ClampedArray([10, 10, 10, 255, 10, 10, 10, 255]), width: 2, height: 1 };
    PIX.adjust(im2, "invert", {}, sel1); ok(im2.data[0] === 10 && im2.data[4] === 245, "adjustment respects selection");
    var bl = { data: new Uint8ClampedArray(9 * 4), width: 9, height: 1 }; for (q = 0; q < 9; q++) { bl.data[q * 4] = q === 4 ? 255 : 0; bl.data[q * 4 + 3] = 255; }
    PIX.gaussian(bl, 4); var sum = 0; for (q = 0; q < 9; q++) sum += bl.data[q * 4]; ok(bl.data[16] < 255 && bl.data[12] > 0 && near(sum, 255, 12), "gaussian blur spreads, keeps energy");
    var pxl = { data: new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 255]), width: 2, height: 1 }; PIX.pixelate(pxl, 2); ok(pxl.data[0] === 100 && pxl.data[4] === 100, "pixelate averages");
    await PE.workLoad("selftest", { data: new Uint8ClampedArray([0, 50, 100, 255]), width: 1, height: 1 }, null);
    var wres = await PE.workAdjust("selftest", "invert", {}); ok(wres.data[0] === 255 && wres.data[1] === 205 && wres.data[2] === 155, "preview pipeline (worker load + adjust)");

    // 6. healing: texture from the source, tone from the destination's edge
    var HW = 40, dst = { data: new Uint8ClampedArray(HW * HW * 4), width: HW, height: HW }, src = { data: new Uint8ClampedArray(HW * HW * 4), width: HW, height: HW }, hm = new Uint8Array(HW * HW);
    for (q = 0; q < HW * HW; q++) { var yy = Math.floor(q / HW); dst.data.set([150, 150, 150, 255], q * 4); src.data.set([60 + (yy % 2) * 20, 60 + (yy % 2) * 20, 60 + (yy % 2) * 20, 255], q * 4); var xx = q % HW; if (Math.hypot(xx - 20, yy - 20) < 9) hm[q] = 255; }
    var hr = PIX.heal(dst, src, hm), cIn = hr.data[(20 * HW + 20) * 4], cIn2 = hr.data[(21 * HW + 20) * 4];
    ok(near((cIn + cIn2) / 2, 150, 8) && Math.abs(cIn - cIn2) >= 15 && hr.data[0] === 150, "healing matches tone, keeps texture");

    // 7. transform maths
    var R = PE.mTRS({ cx: 0, cy: 0, rot: 90 }), pt = PE.mApply(R, 1, 0); ok(near(pt.x, 0, 1e-9) && near(pt.y, 1, 1e-9), "rotate 90");
    var M = PE.mTRS({ cx: 5, cy: 10, sx: 2, sy: 2, rot: 90, tx: 3, ty: -4 }), inv = PE.mInv(M), back = PE.mApply(inv, PE.mApply(M, 7, 3).x, PE.mApply(M, 7, 3).y);
    ok(near(back.x, 7, 1e-9) && near(back.y, 3, 1e-9), "inverse matrix");
    var bk = PE.bake(solid(10, 20, "#00f"), 0, 0, M); ok(bk.canvas.width === 40 && bk.canvas.height === 20, "baked transform size");
    var fl = PE.mk(4, 1); PE.cx2(fl).fillStyle = "#f00"; PE.cx2(fl).fillRect(0, 0, 1, 1);
    var fb = PE.bake(fl, 0, 0, [-1, 0, 0, 1, 4, 0], false); ok(px(fb.canvas, 3, 0)[0] === 255 && px(fb.canvas, 0, 0)[3] === 0 && fb.x === 0, "flip is pixel-exact");
    var sh = PE.newLayer("shape", { shape: { type: "rect", x: 10, y: 10, w: 20, h: 10 } }), xf = { b: { x: 10, y: 10, w: 20, h: 10, r0: 0 }, sx: 2, sy: 2, rot: 30, tx: 5, ty: 0 };
    ED.transformLayer(sh, ED.xfMatrix(xf), xf);
    ok(near(sh.shape.w, 40, 1e-6) && near(sh.shape.h, 20, 1e-6) && near(sh.shape.x + 20, 25, 1e-6) && near(sh.shape.y + 10, 15, 1e-6) && near(sh.shape.rot, 30, 1e-6), "vector free transform stays editable");

    // 8. editor flows on a scratch document: paint + undo/redo (tiles), crop size, canvas rotate
    var td = PE.newDoc(120, 80, "test"), base = PE.rasterFromCanvas(solid(120, 80, "#ffffff"), "Background"); td.layers = [base]; td.active = base.id;
    ED.doc = td; ED.hist = new PE.History(200e6, 60); ED.maskEdit = false; ED.live = { over: {}, maskOver: {}, hide: null };
    var keepTool = ED.tool, o = ED.o.brush, keepO = Object.assign({}, o);
    ED.tool = "brush"; o.size = 6; o.hard = 1; o.op = 1; td.fg = "#ff0000";
    var ev = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false };
    ED.TOOLS.brush.down({ x: 10, y: 40 }, ev); ED.TOOLS.brush.move({ x: 60, y: 40 }, ev); ED.TOOLS.brush.up({ x: 60, y: 40 }, ev);
    var p1 = px(base.canvas, 30, 40), e1 = ED.hist.list[ED.hist.pos - 1];
    ok(p1[0] === 255 && p1[1] === 0 && px(base.canvas, 30, 10)[1] === 255, "brush paints");
    ok(e1 && e1.bytes < 120 * 80 * 4, "paint step stores only changed tiles");
    ED.undo(); ok(px(base.canvas, 30, 40)[1] === 255, "undo paint");
    ED.redo(); ok(px(base.canvas, 30, 40)[1] === 0, "redo paint");
    td.sel = PE.makeSel(td, PIX.rectMask(120, 80, 0, 0, 40, 80));
    ED.TOOLS.brush.down({ x: 20, y: 60 }, ev); ED.TOOLS.brush.move({ x: 100, y: 60 }, ev); ED.TOOLS.brush.up({ x: 100, y: 60 }, ev);
    ok(px(base.canvas, 20, 60)[1] === 0 && px(base.canvas, 80, 60)[1] === 255, "paint stays inside the selection");
    td.sel = null; ED.tool = "eraser"; Object.assign(ED.o.eraser, { size: 10, hard: 1, op: 1 });
    ED.TOOLS.eraser.down({ x: 100, y: 20 }, ev); ED.TOOLS.eraser.up({ x: 100, y: 20 }, ev); ok(px(base.canvas, 100, 20)[3] === 0, "eraser clears to transparent");
    ED.undo(); ok(px(base.canvas, 100, 20)[3] === 255, "undo erase");
    base.mask = PE.whiteMask(td); ED.maskEdit = true; ED.tool = "brush"; td.fg = "#000000";
    ED.TOOLS.brush.down({ x: 90, y: 70 }, ev); ED.TOOLS.brush.up({ x: 90, y: 70 }, ev);
    ok(px(PE.flatten(td), 90, 70)[3] === 0 && px(PE.flatten(td), 60, 70)[3] === 255, "painting black on a mask hides");
    ED.maskEdit = false; base.mask = null;
    var steps = ED.hist.pos;
    ED.crop = { x: 10, y: 10, w: 50, h: 40 }; ED.o.crop.trim = true; ED.applyCrop();
    ok(td.w === 50 && td.h === 40 && base.canvas.width === 50 && base.canvas.height === 40 && PE.flatten(td).width === 50, "crop output size");
    ED.undo(); ok(td.w === 120 && td.h === 80 && base.canvas.width === 120, "undo crop");
    ED.rotateCanvas("cw"); ok(td.w === 80 && td.h === 120 && px(base.canvas, 79 - 40, 30)[1] === 0, "rotate canvas 90°");
    ED.jump(steps); ok(td.w === 120 && ED.hist.pos === steps, "history jump");
    ED.canvasSize(200, 100, 4, "#00ff00"); ok(td.w === 200 && px(PE.flatten(td), 2, 2)[1] === 255 && px(PE.flatten(td), 2, 2)[0] === 0, "canvas size with fill");
    ED.undo();
    ED.imageSize(60, 40); ok(td.w === 60 && base.canvas.width === 60, "image size resamples layers");
    ED.undo();
    ED.tool = keepTool; Object.assign(o, keepO);

    // 9. memory-bounded history and tile diffs
    var H = new PE.History(1000, 60), noop = function () {};
    for (q = 0; q < 5; q++) H.push({ label: "x" + q, bytes: 400, undo: noop, redo: noop });
    ok(H.list.length === 2 && H.dropped === 3 && H.pos === 2 && H.bytes === 800, "history memory budget");
    var b1 = new Uint8ClampedArray(200 * 200 * 4), a1 = new Uint8ClampedArray(b1); a1[(130 * 200 + 70) * 4] = 9;
    var tl = PE.diffTiles(b1, a1, 200, 200, 64); ok(tl.length === 1 && tl[0].x === 64 && tl[0].y === 128, "only changed tiles kept");

    // 10. .s3photo round trip is pixel-exact; text/shape stay editable
    var rd = PE.newDoc(64, 48, "Round trip ✓ مرحبا"), rc = PE.mk(64, 48), rx = PE.cx2(rc), rim = rx.createImageData(64, 48);
    var rnd = PIX.rng(5); for (q = 0; q < rim.data.length; q++) rim.data[q] = q % 4 === 3 ? (q % 3 ? 255 : Math.floor(rnd() * 256)) : Math.floor(rnd() * 256);
    rx.putImageData(rim, 0, 0); PE.touch(rc);
    var r1 = PE.rasterFromCanvas(rc, "Noise", 3, -2); r1.blend = "overlay"; r1.opacity = 0.7;
    var rm = PE.mk(64, 48), rmx = PE.cx2(rm), rg = rmx.createLinearGradient(0, 0, 64, 0); rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(1, "rgba(255,255,255,0)"); rmx.fillStyle = rg; rmx.fillRect(0, 0, 64, 48);
    r1.mask = { canvas: PE.touch(rm), x: 1, y: 2 }; r1.maskOn = false;
    var r2 = PE.newLayer("text", { name: "T", text: { text: "Hello\nمرحبا", size: 20, color: "#123456", align: "center", dir: "auto", ax: 30, ay: 5, rot: 12 } });
    var r3 = PE.newLayer("shape", { name: "S", locked: true, visible: false, shape: { type: "star", x: 4, y: 5, w: 30, h: 20, fill: "", stroke: "#abcdef", sw: 3, rot: -20, flipX: true } });
    rd.layers = [r1, r2, r3]; rd.active = r2.id;
    var blob = await PE.saveProject(rd), rb = new Uint8Array(await blob.arrayBuffer()), od = await PE.openProject(rb);
    var a0 = PE.getData(r1.canvas).data, a2 = PE.getData(od.layers[0].canvas).data, same = a0.length === a2.length;
    for (q = 0; same && q < a0.length; q++) if (a0[q] !== a2[q]) same = false;
    ok(same, "raster pixels round-trip exactly");
    var m0 = PE.getData(r1.mask.canvas).data, m2 = PE.getData(od.layers[0].mask.canvas).data, msame = true;
    for (q = 3; q < m0.length; q += 4) if (m0[q] !== m2[q]) { msame = false; break; }
    ok(msame && od.layers[0].mask.x === 1 && od.layers[0].maskOn === false, "mask round-trips exactly");
    ok(od.w === 64 && od.h === 48 && od.name === rd.name && od.layers[0].x === 3 && od.layers[0].y === -2 && od.layers[0].blend === "overlay" && near(od.layers[0].opacity, 0.7, 1e-9), "layer props round-trip");
    ok(JSON.stringify(od.layers[1].text) === JSON.stringify(r2.text) && JSON.stringify(od.layers[2].shape) === JSON.stringify(r3.shape) && od.layers[2].locked && !od.layers[2].visible && od.active === od.layers[1].id, "text and shape stay editable");

    // 11. malicious / broken projects are rejected or neutralised
    var enc = new TextEncoder();
    async function rejects(files, why) {
      var threw = false;
      try { var z = files instanceof Uint8Array ? files : new Uint8Array(await PE.zipWrite(files).arrayBuffer()); await PE.openProject(z); } catch (e) { threw = true; }
      ok(threw, "rejects " + why);
    }
    var png1 = (await PE.pngOf(solid(2, 2, "#f00"))).bytes;
    function pj(o2) { return JSON.stringify(Object.assign({ format: "s3photo", version: 1, name: "x", w: 10, h: 10, layers: [{ kind: "raster", src: "layers/0.png" }] }, o2)); }
    await rejects(enc.encode("not a zip at all, sorry"), "non-zip");
    await rejects([{ name: "layers/0.png", data: png1 }], "missing project.json");
    await rejects([{ name: "project.json", data: "{bad json" }], "bad JSON");
    await rejects([{ name: "project.json", data: pj({ format: "s3design" }) }, { name: "layers/0.png", data: png1 }], "other format");
    await rejects([{ name: "project.json", data: pj({ version: 7 }) }, { name: "layers/0.png", data: png1 }], "newer version");
    await rejects([{ name: "project.json", data: pj({ w: 100000, h: 10 }) }, { name: "layers/0.png", data: png1 }], "huge canvas");
    await rejects([{ name: "project.json", data: pj({ w: 7000, h: 7000 }) }, { name: "layers/0.png", data: png1 }], "too many megapixels");
    var many = []; for (q = 0; q < 101; q++) many.push({ kind: "text" });
    await rejects([{ name: "project.json", data: pj({ layers: many }) }], "too many layers");
    await rejects([{ name: "project.json", data: pj({ layers: [{ kind: "raster", src: "../../etc/x.png" }] }) }, { name: "../../etc/x.png", data: png1 }], "path traversal");
    await rejects([{ name: "project.json", data: pj({ layers: [{ kind: "script" }] }) }], "unknown layer type");
    await rejects([{ name: "project.json", data: pj({}) }, { name: "layers/0.png", data: enc.encode("<svg onload=alert(1)>") }], "non-PNG layer data");
    var bigPng = new Uint8Array(png1); new DataView(bigPng.buffer).setUint32(16, 30000); new DataView(bigPng.buffer).setUint32(20, 30000);
    await rejects([{ name: "project.json", data: pj({}) }, { name: "layers/0.png", data: bigPng }], "oversized PNG header (decompression bomb)");
    var good = new Uint8Array(await PE.zipWrite([{ name: "project.json", data: pj({}) }, { name: "layers/0.png", data: png1 }]).arrayBuffer());
    var bad = new Uint8Array(good); bad[good.length - 22 - 46 * 2 - 30 - 20] ^= 0xff;
    var crcBroken = new Uint8Array(good); crcBroken[90] ^= 0x55;
    await rejects(crcBroken, "corrupted bytes (CRC)");
    var evil = pj({ name: "<img src=x onerror=alert(1)>", fg: "red;background:url(x)", layers: [{ kind: "text", name: "\u0000evil", blend: "javascript", opacity: 99, text: { text: "<b>hi</b>", font: 'Arial"; } body {', size: -5, color: "expression(1)", align: "justify" } },
      JSON.parse('{"kind":"shape","__proto__":{"polluted":1},"shape":{"type":"<svg>","fill":"url(#x)","w":1e12}}')] });
    var sd = PE.parseProjectJson(evil), st = sd.layers[0].text;
    ok(sd.name === "<img src=x onerror=alert(1)>" && sd.fg === "#111111" && sd.layers[0].blend === "normal" && sd.layers[0].opacity === 1 && sd.layers[0].name.indexOf("\u0000") < 0, "fields clamped and whitelisted");
    ok(st.text === "<b>hi</b>" && !/["{};]/.test(st.font) && st.size === 1 && st.color === "#111111" && st.align === "left", "text fields sanitised");
    ok(sd.layers[1].shape.type === "rect" && sd.layers[1].shape.fill === "#cccccc" && sd.layers[1].shape.w === 3 * PE.LIM.side && ({}).polluted === undefined, "shape fields whitelisted");
    ok(S3.h("span", { text: sd.name }).innerHTML.indexOf("<img") < 0, "names shown as text, never HTML");
    void bad;

    // 12. export: dimensions and formats, selection export
    var xd = PE.newDoc(300, 200, "x"), xl = PE.rasterFromCanvas(solid(300, 200, "#3366cc")); xd.layers = [xl];
    var pngB = new Uint8Array(await (await PE.toBlob(PE.flatten(xd, { scale: 0.5 }), "image/png")).arrayBuffer()), ps = PE.pngSize(pngB);
    ok(ps && ps.w === 150 && ps.h === 100, "PNG export size");
    var jb = await PE.toBlob(PE.flatten(xd, { bg: "#ffffff" }), "image/jpeg", 0.8), jbytes = new Uint8Array(await jb.arrayBuffer()), jbm = await createImageBitmap(jb);
    ok(jbytes[0] === 0xFF && jbytes[1] === 0xD8 && jbm.width === 300 && jbm.height === 200, "JPG export");
    var wb = await PE.toBlob(PE.flatten(xd), "image/webp", 0.8), wbytes = new Uint8Array(await wb.arrayBuffer());
    ok(wb.type !== "image/webp" || (String.fromCharCode(wbytes[0], wbytes[1], wbytes[2], wbytes[3]) === "RIFF" && String.fromCharCode(wbytes[8], wbytes[9], wbytes[10], wbytes[11]) === "WEBP"), "WebP export");
    xd.sel = PE.makeSel(xd, ED.marqueeMask({ x: 100, y: 50, w: 80, h: 40 }, true, xd));
    var sc = PE.flatten(xd, { rect: xd.sel.b, selMask: true });
    ok(near(sc.width, 80, 2) && near(sc.height, 40, 2) && px(sc, 0, 0)[3] === 0 && px(sc, Math.floor(sc.width / 2), Math.floor(sc.height / 2))[3] === 255, "export selection crops and masks");
    var tx = PE.newLayer("text", { text: { text: "مرحبا", ax: 10, ay: 10, size: 30 } }); ok(PE.textDir(tx.text) === "rtl" && PE.textDir({ text: "Hi", dir: "auto" }) === "ltr", "text direction");

    // restore whatever was open
    ED.testing = false;
    if (savedDoc) { ED.doc = savedDoc; ED.hist = savedHist; ED.live = { over: {}, maskOver: {}, hide: null }; ED.changed(); ED.fit(); }
    else { ED.doc = null; ED.hist = null; ED.live = { over: {}, maskOver: {}, hide: null }; ED.changed(); }
    return fails.length ? fails : true;
  };
})();
