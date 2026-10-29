/* Photo Editor paint lane: history brush. Paints the active layer (or its mask) back from an earlier state in the
   History panel, with every brush dynamic. The source is the opening state unless you pick another step; the
   eraser's "Erase to history" option uses the same source. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, K = ED.ui.kit, h = S3.h;
  PP.icons({ "t-hbrush": ["M20.5 3.5c-3 .8-8.7 6-10.9 9.2l1.9 1.9c3.2-2.2 8.3-7.9 9-11.1z", "M9.2 13.5c-2.1 0-3.7 1.6-3.7 3.6 0 1.4-.9 2.3-2 2.9 3.1.6 7.4-.4 7.7-4.6", "M3 6.5a4 4 0 1 1 1.2 2.8M3 4v2.8h2.8"] });
  var SRC = { hist: null, entry: null };          // entry null = the opening state
  function srcIndex() {
    var H = ED.hist; if (!H) return 0;
    if (SRC.hist !== H || !SRC.entry) return 0;
    var i = H.list.indexOf(SRC.entry); return i < 0 ? 0 : i + 1;
  }
  PP.historySource = function (n) { var H = ED.hist; SRC.hist = H; SRC.entry = n > 0 ? H.list[n - 1] : null; mark(); if (PP.spec[ED.tool] && ED.tool === "hbrush") ED.ui.buildOpts(); };
  // Pixels of layer L (or its mask) as they were at history position n: {canvas, x, y} or null.
  PP.stateOf = function (L, mask, n) {
    var H = ED.hist, pos = H.pos, out = null;
    function grab() {
      if (ED.doc.layers.indexOf(L) < 0) return null;
      if (mask) return L.mask ? { canvas: PE.cloneCanvas(L.mask.canvas), x: L.mask.x, y: L.mask.y } : null;
      var s = PE.surface(L, ED.doc); return { canvas: PE.cloneCanvas(s.canvas), x: s.x, y: s.y };
    }
    if (n === pos) return grab();
    // an unrecorded change (a layer just grown for this stroke) is put back after the round trip
    var keep = { canvas: L.canvas, x: L.x, y: L.y, mask: L.mask };
    try { H.jump(n); out = grab(); } finally { H.jump(pos); L.canvas = keep.canvas; L.x = keep.x; L.y = keep.y; L.mask = keep.mask; }
    return out;
  };
  function begin(st) {
    if (st.mask) { S3.toast("The history brush paints layer pixels: click the layer thumbnail (not the mask) first", "error"); return false; }
    var n = srcIndex(), s = PP.stateOf(st.L, st.mask, n);
    if (!s) { S3.toast("This layer did not exist at the history brush's source step. Pick another step.", "error"); return false; }
    st.src = s.canvas; st.srcOff = { x: st.ox - s.x, y: st.oy - s.y };
    return true;
  }
  PP.engineTool("hbrush", { label: "History brush", fill: "history", begin: begin }, { size: 40, hard: 0.6 });
  PP.addTool("hbrush", "History brush", "Y", "pencil", ED.TOOLS.hbrush);
  PP.group("Y", ["hbrush"]);
  function options() {
    var H = ED.hist, opts = [["0", (H && H.base) || "Open"]];
    if (H) H.list.forEach(function (e, i) { opts.push([String(i + 1), (i + 1) + ". " + e.label]); });
    return opts;
  }
  PP.optsFor.hbrush = function (items) {
    return PP.brushBar("hbrush", items, [K.select("Source", options(), String(srcIndex()), function (v) { PP.historySource(+v); })],
      "Paints this layer back to how it was at the source step. Undo history steps stay as they are.");
  };
  // eraser: erase to history
  PP.opts("eraser", { toHist: false });
  var es = PP.spec.eraser, ebegin = es.begin;
  es.begin = function (st, p, e) {
    if (st.o.toHist) { st.spec = Object.assign({}, PP.spec.hbrush, { label: "Erase to history" }); return begin(st); }
    return ebegin ? ebegin(st, p, e) : true;
  };
  var ebar = PP.optsFor.eraser;
  PP.optsFor.eraser = function (items) { var out = ebar(items), o = ED.o.eraser; out.splice(out.length - 1, 0, K.check("Erase to history", o.toHist, function (v) { o.toHist = v; ED.saveOpts(); })); return out; };
  // History panel: mark the source step
  function mark() {
    var rows = S3.$$("#hist .pe-hrow"), n = srcIndex();
    rows.forEach(function (r, i) { r.classList.toggle("pp-hsrc", i === n); if (i === n) r.title = "History brush source"; else if (r.title === "History brush source") r.title = ""; });
  }
  ED.on("changed", function () { if (SRC.hist && SRC.hist !== ED.hist) { SRC.hist = null; SRC.entry = null; } mark(); if (ED.tool === "hbrush") ED.ui.buildOpts(); });
  PP.ready.push(function () {
    var box = document.getElementById("hist"); if (!box) return;
    box.addEventListener("click", function (e) {      // Alt+click a step: make it the history brush's source
      var r = e.target.closest && e.target.closest(".pe-hrow"); if (!r || !e.altKey) return;
      e.preventDefault(); e.stopPropagation(); PP.historySource(S3.$$("#hist .pe-hrow").indexOf(r)); S3.toast("History brush source set");
    }, true);
    mark();
  });
  PP.shortcut("History brush source", "Alt+click a step in History");

  PP.test("history brush", function (ok) {
    var s = PP.scratch(60, 30, "#ffffff"); s.d.fg = "#ff0000";
    Object.assign(ED.o.brush, { size: 60, hard: 1, op: 1, flow: 1 }); PP.drive("brush", [{ x: 30, y: 15 }]);
    s.d.fg = "#0000ff"; PP.drive("brush", [{ x: 30, y: 15 }]);
    ok(PP.px(s.L.canvas, 10, 10)[2] === 255 && PP.px(s.L.canvas, 10, 10)[0] === 0, "painted blue over red");
    PP.historySource(0); Object.assign(ED.o.hbrush, { size: 10, hard: 1, op: 1, flow: 1 });
    PP.drive("hbrush", [{ x: 10, y: 10 }]);
    ok(PP.px(s.L.canvas, 10, 10).join() === "255,255,255,255" && PP.px(s.L.canvas, 40, 10)[2] === 255, "paints back the opening state");
    ok(ED.hist.pos === 3, "history intact (3 steps)");
    PP.historySource(1); PP.drive("hbrush", [{ x: 40, y: 10 }]);
    ok(PP.px(s.L.canvas, 40, 10)[0] === 255 && PP.px(s.L.canvas, 40, 10)[2] === 0, "paints back the red step");
    ED.undo(); ED.undo(); ok(PP.px(s.L.canvas, 10, 10)[2] === 255, "undo history brush");
    ED.o.eraser.toHist = true; Object.assign(ED.o.eraser, { size: 10, hard: 1, op: 1, flow: 1 }); PP.historySource(0);
    PP.drive("eraser", [{ x: 50, y: 20 }]); ED.o.eraser.toHist = false;
    ok(PP.px(s.L.canvas, 50, 20).join() === "255,255,255,255", "erase to history");
  });
})();
