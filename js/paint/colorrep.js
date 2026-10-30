/* Photo Editor paint lane: colour replacement. A brush that recolours only colours close to the one sampled under
   its centre with the foreground colour, keeping their brightness (modes: colour, hue, saturation, luminosity). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX, K = ED.ui.kit;
  PP.icons({ "t-colorrep": ["M20.5 3.5c-3 .8-8.7 6-10.9 9.2l1.9 1.9c3.2-2.2 8.3-7.9 9-11.1z", "M9.2 13.5c-2.1 0-3.7 1.6-3.7 3.6 0 1.4-.9 2.3-2 2.9 3.1.6 7.4-.4 7.7-4.6", "M3 4.5h5M5.5 2v5"] });
  PP.covTool("colorrep", {
    label: "Colour replacement", fill: "color", mask: false,
    begin: function (st) { st.smp = null; st.o.protect = false; return true; },
    perDab: PP.colorLimit.perDab, weight: PP.colorLimit.weight,
    effect: function (st, px) { var o = PPX.recolor(st.o.cmode, px, st.fg); return [o[0], o[1], o[2], px[3]]; }
  }, { size: 40, hard: 0.8, op: 1, spacing: 15, sample: "cont", limits: "contig", tol: 30, cmode: "color" });
  PP.addTool("colorrep", "Colour replacement", "B", "pencil", ED.TOOLS.colorrep);
  PP.groups.forEach(function (g) { if (g.key === "B") g.ids.push("colorrep"); });
  PP.optsFor.colorrep = function (items) {
    var o = ED.o.colorrep, sv = function () { ED.saveOpts(); };
    return PP.brushBar("colorrep", items, [
      K.select("Mode", [["color", "Colour"], ["hue", "Hue"], ["saturation", "Saturation"], ["luminosity", "Luminosity"]], o.cmode, function (v) { o.cmode = v; sv(); }),
      K.select("Sampling", [["cont", "Continuous"], ["once", "Once"], ["swatch", "Background colour"]], o.sample, function (v) { o.sample = v; sv(); }),
      K.select("Limits", [["contig", "Contiguous"], ["dis", "Discontiguous"]], o.limits, function (v) { o.limits = v; sv(); }),
      K.range("Tolerance", o.tol, 0, 100, 1, function (v) { o.tol = v; sv(); }, function (v) { return v + "%"; })],
      "Recolours what is under the centre of the tip with the foreground colour, keeping light and shade.", { noFlow: true, noSym: true });
  };
  PP.test("colour replacement", function (ok) {
    var s = PP.scratch(60, 30, "#c03030"), c = PE.cx2(s.L.canvas); c.fillStyle = "#601818"; c.fillRect(0, 15, 60, 15); c.fillStyle = "#30c030"; c.fillRect(40, 0, 20, 30); PE.touch(s.L.canvas);
    s.d.fg = "#2050ff";
    Object.assign(ED.o.colorrep, { size: 80, hard: 1, op: 1, sample: "cont", limits: "dis", tol: 60, cmode: "color" });
    PP.drive("colorrep", [{ x: 10, y: 10 }]);
    var a = PP.px(s.L.canvas, 10, 5), b = PP.px(s.L.canvas, 10, 25), g = PP.px(s.L.canvas, 50, 5);
    ok(a[2] > a[0] && b[2] > b[0], "red becomes blue (" + a + " / " + b + ")");
    ok(PPX.lumF([a[0] / 255, a[1] / 255, a[2] / 255]) > PPX.lumF([b[0] / 255, b[1] / 255, b[2] / 255]) + 0.1, "light and shade are kept");
    ok(g.join() === "48,192,48,255", "the green, outside the tolerance, stays");
  });
})();
