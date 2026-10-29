/* Photo Editor paint lane: mixer brush. A brush that carries paint (the reservoir, loaded with the foreground colour
   or Alt+click on the canvas) and picks up the wet paint it passes over. Wet = how much it picks up, Load = how
   much paint it holds, Mix = canvas paint versus reservoir paint; load / clean the brush after each stroke. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, K = ED.ui.kit;
  PP.icons({ "t-mixer": ["M20.5 3.5c-3 .8-8.7 6-10.9 9.2l1.9 1.9c3.2-2.2 8.3-7.9 9-11.1z", "M9.2 13.5c-2.1 0-3.7 1.6-3.7 3.6 0 1.4-.9 2.3-2 2.9 3.1.6 7.4-.4 7.7-4.6", "M15 20.5c0-1.4 1-2.2 2-3.5 1 1.3 2 2.1 2 3.5a2 2 0 0 1-4 0z"] });
  var B = { resv: null, P: null, S: 0, amt: 1 };        // the brush: reservoir colour, picked-up paint, paint left
  PP.mixerState = B;
  var PRESETS = [["dry", "Dry", 0, 50, 0], ["moist", "Moist", 25, 50, 40], ["wet", "Wet", 60, 50, 60], ["vwet", "Very wet", 95, 70, 85], ["clean", "Wet, clean only", 80, 1, 100]];
  PP.runTool("mixer", {
    label: "Mixer brush", fill: "color", mask: false,
    begin: function (st, p, e) {
      var o = st.o, S = Math.ceil(o.size) + 3;
      if (e && e.altKey) {        // load the brush from the canvas
        var x = Math.floor(p.x - st.ox), y = Math.floor(p.y - st.oy);
        if (x >= 0 && y >= 0 && x < st.w && y < st.h) { var q = PE.cx2(st.holder.canvas).getImageData(x, y, 1, 1).data; if (q[3]) { B.resv = [q[0], q[1], q[2]]; B.amt = 1; B.P = null; S3.toast("Brush loaded from the canvas"); } }
        return false;
      }
      if (o.loadAfter || !B.resv) { B.resv = st.fg.slice(); B.amt = 1; }
      if (o.cleanAfter || !B.P || B.S !== S) {
        B.S = S; B.P = new Float32Array(S * S * 4);
        for (var j = 0; j < S * S; j++) { B.P[j * 4] = B.resv[0]; B.P[j * 4 + 1] = B.resv[1]; B.P[j * 4 + 2] = B.resv[2]; B.P[j * 4 + 3] = 255; }
      }
      st.decay = 1 - 1 / (PE.clamp(o.load, 1, 100) * 3 + 1);
      return true;
    },
    stamp: function (st, x, y, d, ang, rnd, flip, col, a) {
      var o = st.o, S = B.S, half = S >> 1, ix = Math.round(x), iy = Math.round(y), D = st.img.data, P = B.P, W = st.w;
      var wet = PE.clamp(o.wet, 0, 100) / 100, mix = PE.clamp(o.mix, 0, 100) / 100, R = B.resv, amt = B.amt, flow = PE.clamp(o.flow, 0, 1);
      // fresh reservoir paint per dab, scaled by the dab spacing so the result does not depend on how dense the dabs are
      var sf = PE.clamp(o.spacing / 50, 0.02, 1), rd = wet > 0 ? amt * (1 - mix * wet) * sf : amt;
      PP.dabEach(st, x, y, d, ang, rnd, 1, function (i, w) {
        var px = i % W, py = (i - px) / W, fx = px - ix + half, fy = py - iy + half; if (fx < 0 || fy < 0 || fx >= S || fy >= S) return;
        var f = (fy * S + fx) * 4, q = i * 4, al = D[q + 3] / 255;
        var c0 = D[q] * al, c1 = D[q + 1] * al, c2 = D[q + 2] * al, c3 = D[q + 3];
        var k = wet * w;           // pick up wet paint from the canvas
        P[f] += (c0 - P[f]) * k; P[f + 1] += (c1 - P[f + 1]) * k; P[f + 2] += (c2 - P[f + 2]) * k; P[f + 3] += (c3 - P[f + 3]) * k;
        var r = rd;      // how much clean reservoir paint goes on
        var p0 = P[f] + (R[0] - P[f]) * r, p1 = P[f + 1] + (R[1] - P[f + 1]) * r, p2 = P[f + 2] + (R[2] - P[f + 2]) * r, p3 = P[f + 3] + (255 - P[f + 3]) * r;
        var t = w * flow * (wet > 0 ? 1 : amt);
        var o0 = c0 + (p0 - c0) * t, o1 = c1 + (p1 - c1) * t, o2 = c2 + (p2 - c2) * t, o3 = c3 + (p3 - c3) * t;
        if (o3 <= 0.5) { D[q + 3] = 0; return; }
        D[q] = o0 / o3 * 255; D[q + 1] = o1 / o3 * 255; D[q + 2] = o2 / o3 * 255; D[q + 3] = o3;
      }, flip);
      B.amt = amt * st.decay;
    }
  }, { size: 40, hard: 0.6, op: 1, flow: 0.8, spacing: 8, wet: 60, load: 50, mix: 60, loadAfter: true, cleanAfter: true, sizeC: "pressure" });
  PP.addTool("mixer", "Mixer brush", "B", "colorrep", ED.TOOLS.mixer);
  PP.groups.forEach(function (g) { if (g.key === "B") g.ids.push("mixer"); });
  PP.optsFor.mixer = function (items) {
    var o = ED.o.mixer, sv = function () { ED.saveOpts(); }, cur = PRESETS.filter(function (p) { return p[2] === o.wet && p[3] === o.load && p[4] === o.mix; })[0];
    return PP.brushBar("mixer", items, [
      K.select("Preset", [["", "Custom"]].concat(PRESETS.map(function (p) { return [p[0], p[1]]; })), cur ? cur[0] : "", function (v) { var p = PRESETS.filter(function (x) { return x[0] === v; })[0]; if (!p) return; o.wet = p[2]; o.load = p[3]; o.mix = p[4]; sv(); ED.ui.buildOpts(); }),
      K.range("Wet", o.wet, 0, 100, 1, function (v) { o.wet = v; sv(); }, function (v) { return v + "%"; }),
      K.range("Load", o.load, 1, 100, 1, function (v) { o.load = v; sv(); }, function (v) { return v + "%"; }),
      K.range("Mix", o.mix, 0, 100, 1, function (v) { o.mix = v; sv(); }, function (v) { return v + "%"; }),
      K.check("Load after each stroke", o.loadAfter, function (v) { o.loadAfter = v; sv(); }), K.check("Clean after each stroke", o.cleanAfter, function (v) { o.cleanAfter = v; sv(); })],
      "Paints with the foreground colour and blends with the wet paint under it. Alt+click loads the brush from the canvas.", { noOp: true, noSym: true });
  };
  PP.test("mixer brush", function (ok) {
    var s = PP.scratch(80, 30, "#ffffff"), c = PE.cx2(s.L.canvas); c.fillStyle = "#ffff00"; c.fillRect(40, 0, 40, 30); PE.touch(s.L.canvas); s.d.fg = "#0000ff";
    Object.assign(ED.o.mixer, { size: 14, hard: 1, flow: 1, wet: 0, load: 100, mix: 0, loadAfter: true, cleanAfter: true });
    PP.drive("mixer", [{ x: 10, y: 8 }, { x: 70, y: 8 }]);
    var a = PP.px(s.L.canvas, 60, 8); ok(a[2] > 230 && a[0] < 25, "dry: plain paint over the yellow (" + a + ")");
    Object.assign(ED.o.mixer, { wet: 90, mix: 80, load: 50 });
    PP.drive("mixer", [{ x: 10, y: 22 }, { x: 70, y: 22 }]);
    var w = PP.px(s.L.canvas, 30, 22), y = PP.px(s.L.canvas, 70, 22);
    ok(w[0] > 60 && w[2] > 120, "wet: the blue mixes with the white it picks up (" + w + ")");
    ok(y[0] > 90 && y[1] > 90, "wet: the yellow is picked up and blended (" + y + ")");
    ED.undo(); ED.undo(); ok(PP.px(s.L.canvas, 60, 8).join() === "255,255,0,255", "undo");
    ED.TOOLS.mixer.down({ x: 60, y: 10 }, PP.ev({ altKey: true })); ok(PE.paint.mixerState.resv.join() === "255,255,0", "Alt+click loads the brush from the canvas");
  });
})();
