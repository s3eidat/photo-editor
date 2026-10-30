/* Photo Editor paint lane: pencil. Hard, aliased dabs on whole pixels (pixel art, crisp lines).
   Auto erase: a stroke that starts on the foreground colour paints the background colour instead. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, K = ED.ui.kit;
  PP.icons({ "t-pencil": ["M15.5 4.5l4 4L8 20H4v-4z", "M13 7l4 4", "M4 20l2.5-.6"] });
  PP.engineTool("pencil", {
    label: "Pencil", fill: "color", pencil: true,
    begin: function (st, p) {
      if (!st.o.autoErase || st.mask) return true;
      var x = Math.floor(p.x - st.ox), y = Math.floor(p.y - st.oy);
      if (x < 0 || y < 0 || x >= st.w || y >= st.h) return true;
      var q = PE.cx2(st.holder.canvas).getImageData(x, y, 1, 1).data;
      if (q[3] === 255 && PE.toHex(q[0], q[1], q[2]) === ED.doc.fg.toLowerCase()) { st.fg = st.bgc; if (!st.o.perTip) st.color = st.bgc; }
      return true;
    }
  }, { size: 1, hard: 1, spacing: 25, sizeC: "off", autoErase: false });
  PP.addTool("pencil", "Pencil", "B", "brush", ED.TOOLS.pencil);
  PP.group("B", ["brush", "pencil"]);
  PP.optsFor.pencil = function (items) {
    var o = ED.o.pencil;
    return PP.brushBar("pencil", items, [K.check("Auto erase", o.autoErase, function (v) { o.autoErase = v; ED.saveOpts(); })],
      "Hard edges on whole pixels. Alt+click picks a colour, Shift+click draws a straight line.", { noHard: true });
  };
  PP.test("pencil", function (ok) {
    var s = PP.scratch(40, 20), px = PP.px; s.d.fg = "#ff0000"; s.d.bg = "#0000ff";
    Object.assign(ED.o.pencil, { size: 3, op: 1, flow: 1, autoErase: false });
    PP.drive("pencil", [{ x: 5.5, y: 10.5 }, { x: 30.5, y: 10.5 }]);
    var a = px(s.L.canvas, 18, 10), edge = px(s.L.canvas, 18, 12), mid = px(s.L.canvas, 18, 11);
    ok(a[0] === 255 && a[1] === 0 && mid[0] === 255 && mid[1] === 0 && edge[1] === 255, "pencil paints whole pixels, no anti-aliasing (" + mid + " / " + edge + ")");
    var soft = false; for (var x = 0; x < 40; x++) for (var y = 0; y < 20; y++) { var q = px(s.L.canvas, x, y); if (q[1] > 0 && q[1] < 255) soft = true; }
    ok(!soft, "no partial pixels");
    ED.o.pencil.autoErase = true;
    PP.drive("pencil", [{ x: 18.5, y: 10.5 }]);
    ok(px(s.L.canvas, 18, 10)[2] === 255, "auto erase paints the background colour over the foreground");
  });
})();
