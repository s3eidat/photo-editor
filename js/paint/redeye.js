/* Photo Editor paint lane: red-eye removal. Click on an eye (or drag a box around it): the red pupil next to
   the click is found, its red is replaced by the other channels and it is darkened, with a soft edge. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX, K = ED.ui.kit, h = S3.h;
  PP.icons({ "t-redeye": ["M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z", ["circle", { cx: "12", cy: "12", r: "3", fill: "currentColor" }], "M17 3.5l2 2M19 3.5l-2 2"] });
  var o = PP.opts("redeye", { pupil: 50, dark: 50, size: 60 });

  // img: {data, width, height}; (cx, cy) the click inside it. Returns {mask: Float32Array weights, count}.
  PPX.redEyeMask = function (img, cx, cy, pupil, R) {
    var w = img.width, hh = img.height, d = img.data, n = w * hh, s = new Float32Array(n), i;
    var t = 0.55 - PPX.clamp(pupil, 0, 100) / 100 * 0.35, lo = t * 0.6;
    for (i = 0; i < n; i++) { var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; s[i] = r > 40 && d[i * 4 + 3] > 0 ? (r - (g + b) / 2) / r : 0; }
    // seed: the reddest pixel close to the click
    var best = -1, bv = 0;
    for (var y = 0; y < hh; y++) for (var x = 0; x < w; x++) {
      var dd = Math.hypot(x - cx, y - cy); if (dd > R) continue;
      var v = s[y * w + x] - dd / R * 0.15; if (s[y * w + x] > t && v > bv) { bv = v; best = y * w + x; }
    }
    var m = new Float32Array(n), cnt = 0;
    if (best < 0) return { mask: m, count: 0 };
    var stack = [best], seen = new Uint8Array(n); seen[best] = 1;
    while (stack.length) {
      var p = stack.pop(), px = p % w, py = (p - px) / w;
      m[p] = PPX.clamp((s[p] - lo) / (t - lo), 0, 1); cnt++;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o2) {
        var nx = px + o2[0], ny = py + o2[1]; if (nx < 0 || ny < 0 || nx >= w || ny >= hh) return;
        var q = ny * w + nx; if (seen[q] || s[q] <= lo || Math.hypot(nx - cx, ny - cy) > R * 1.5) return; seen[q] = 1; stack.push(q);
      });
    }
    return { mask: m, count: cnt };
  };
  PPX.redEyeFix = function (img, m, dark) {
    var d = img.data, k = 1 - PPX.clamp(dark, 0, 100) / 100 * 0.7;
    for (var i = 0; i < m.length; i++) {
      var w = m[i]; if (!w) continue;
      var q = i * 4, r = d[q], g = d[q + 1], b = d[q + 2], nr = (g + b) / 2 * k, ng = g * k, nb = b * k;
      d[q] = r + (nr - r) * w; d[q + 1] = g + (ng - g) * w; d[q + 2] = b + (nb - b) * w;
    }
    return img;
  };
  PP.redEye = function (rect, click) {
    var t = PP.target("pixels"); if (!t) return false;
    var L = t.L, cv = L.canvas, R = PE.inter(PE.rectI({ x: rect.x - L.x, y: rect.y - L.y, w: rect.w, h: rect.h }), { x: 0, y: 0, w: cv.width, h: cv.height });
    if (!R) { ED.push(t.grow); return false; }
    var img = PE.getData(cv, R), cx = click.x - L.x - R.x, cy = click.y - L.y - R.y, res = PPX.redEyeMask(img, cx, cy, o.pupil, Math.max(R.w, R.h) / 2);
    if (!res.count) { ED.push(t.grow); S3.toast("No red pupil found there. Click right on the red, or drag a box around the eye."); return false; }
    var sm = PE.selFor(ED.doc, { x: R.x + L.x, y: R.y + L.y, w: R.w, h: R.h });
    if (sm) for (var i = 0; i < res.mask.length; i++) res.mask[i] *= sm[i] / 255;
    PPX.redEyeFix(img, res.mask, o.dark);
    var e = PE.editPixels(ED.doc, "Red eye", L, "canvas", R, function (c) { c.putImageData(img, R.x, R.y); });
    ED.push(PE.compound("Red eye", [t.grow, e]));
    return true;
  };
  PP.addTool("redeye", "Red eye", "J", "heal", {
    down: function (p) { ED.drag = { kind: "marquee", a: p, rect: null, ellipse: false, redeye: true }; },
    move: function (p) { var dr = ED.drag, a = dr.a; dr.rect = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) }; },
    up: function (p) {
      var dr = ED.drag; ED.drag = null; if (!dr) return;
      var r = dr.rect && dr.rect.w * ED.zoom > 6 && dr.rect.h * ED.zoom > 6 ? dr.rect : { x: dr.a.x - o.size / 2, y: dr.a.y - o.size / 2, w: o.size, h: o.size };
      var c = dr.rect && r === dr.rect ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : dr.a;
      PP.redEye(r, c); void p;
    }
  });
  PP.cursors.redeye = "crosshair";
  PP.groups.forEach(function (g) { if (g.key === "J") g.ids.push("redeye"); });
  PP.optsFor.redeye = function (items) {
    return [items[0], K.range("Pupil size", o.pupil, 1, 100, 1, function (v) { o.pupil = v; ED.saveOpts(); }, function (v) { return v + "%"; }),
      K.range("Darken", o.dark, 1, 100, 1, function (v) { o.dark = v; ED.saveOpts(); }, function (v) { return v + "%"; }),
      K.field("Search", K.numInput(o.size, 8, 600, function (v) { o.size = v; ED.saveOpts(); }), "pe-num"),
      h("span", { "class": "pe-hint", text: "Click the red pupil, or drag a box around the eye." })];
  };
  PP.test("red eye", function (ok) {
    var s = PP.scratch(60, 40, "#d8b8a0"), c = PE.cx2(s.L.canvas);
    c.fillStyle = "#c81e1e"; c.beginPath(); c.arc(30, 20, 7, 0, Math.PI * 2); c.fill(); c.fillStyle = "#ff6060"; c.fillRect(29, 19, 2, 2); PE.touch(s.L.canvas);
    Object.assign(o, { pupil: 50, dark: 50, size: 40 });
    ok(PP.redEye({ x: 10, y: 0, w: 40, h: 40 }, { x: 31, y: 21 }), "finds the pupil");
    var q = PP.px(s.L.canvas, 33, 20), skin = PP.px(s.L.canvas, 5, 5), glint = PP.px(s.L.canvas, 29, 19);
    ok(q[0] < 40 && Math.abs(q[0] - q[1]) < 25, "pupil is dark and no longer red (" + q + ")");
    ok(skin.join() === "216,184,160,255", "skin around it is untouched");
    ok(glint[0] < 140, "the highlight inside the pupil is fixed too (" + glint + ")");
    ED.undo(); ok(PP.px(s.L.canvas, 33, 20)[0] === 200, "undo");
    ok(!PP.redEye({ x: 0, y: 0, w: 12, h: 12 }, { x: 5, y: 5 }), "no red, no change");
  });
})();
