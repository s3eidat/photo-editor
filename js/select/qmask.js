/* Selection lane: Quick mask mode (Q). The selection becomes a temporary mask shown as a red film over what is
   NOT selected; paint, erase, fill or draw gradients on it with the usual tools (black masks, white selects), then
   press Q again to turn it back into a selection. Implemented as a hidden helper layer whose layer mask is the
   quick mask, so every painting tool and undo work on it unchanged. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, h = S3.h;
  PE.kindsExt.push("qmask");
  SX.addIcons({ "t-qmask": '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="12" cy="12" r="4" stroke-dasharray="2.2 1.8"/>' });
  function qlayer(d) { d = d || ED.doc; if (!d) return null; for (var i = 0; i < d.layers.length; i++) if (d.layers[i].kind === "qmask") return d.layers[i]; return null; }
  SX.quickMaskLayer = qlayer;
  SX.inQuickMask = function () { return !!qlayer(); };

  SX.toggleQuickMask = function () {
    if (!SX.need()) return;
    var d = ED.doc, Q = qlayer();
    if (!Q) {
      var prev = d.active;
      Q = PE.newLayer("qmask", { name: "Quick mask" }); Q.canvas = null; Q.parent = null; Q.qprev = prev;
      var mc = d.sel ? PE.maskFromSel(d) : PE.whiteMask(d);
      ED.meta("Quick mask", function () { Q.mask = mc; Q.maskOn = true; d.layers.push(Q); d.active = Q.id; d.sel = null; });
      ED.maskEdit = true; ED.emit("layers"); ED.emit("tool");
      if (["brush", "eraser", "gradient", "bucket"].indexOf(ED.tool) < 0) ED.setTool("brush");
      S3.toast("Quick mask: paint black to mask (red), white to select. Press Q to turn it into a selection.");
      return;
    }
    var m = maskToSel(d, Q), back = PE.findLayer(d, Q.qprev) ? Q.qprev : null;
    ED.meta("Exit quick mask", function () {
      d.layers = d.layers.filter(function (L) { return L !== Q; });
      d.sel = PE.makeSel(d, m); d.active = back || (d.layers[d.layers.length - 1] || {}).id;
    });
    ED.maskEdit = false; ED.emit("layers"); ED.emit("tool");
  };
  function maskToSel(d, Q) {
    var c = PE.mk(d.w, d.h), x = PE.cx2(c); x.drawImage(Q.mask.canvas, Q.mask.x, Q.mask.y);
    var px = x.getImageData(0, 0, d.w, d.h).data, m = new Uint8Array(d.w * d.h);
    for (var i = 0; i < m.length; i++) m[i] = px[i * 4 + 3];
    return m;
  }

  // it draws nothing into the picture; the red film is painted on the overlay
  SX.drawExt.qmask = function () {};
  PE.surfaceExt.qmask = function (L, doc) { return { canvas: L.mask ? L.mask.canvas : PE.mk(1, 1), x: L.mask ? L.mask.x : 0, y: L.mask ? L.mask.y : 0 }; };
  PE.vboxExt.qmask = function () { var d = ED.doc; return { x: 0, y: 0, w: d.w, h: d.h, rot: 0, fx: false, fy: false }; };
  PE.xfExt.qmask = function () {};
  var film = null;
  ED.on("overlay", function (o) {
    var d = ED.doc, Q = qlayer(d); if (!Q || !Q.mask) return;
    var cv = o.c.canvas, mask = (ED.live.maskOver && ED.live.maskOver[Q.id]) || Q.mask;
    if (!film) film = PE.mk(cv.width, cv.height);
    if (film.width !== cv.width || film.height !== cv.height) { film.width = cv.width; film.height = cv.height; }
    var f = PE.cx2(film); f.setTransform(1, 0, 0, 1, 0, 0); f.globalCompositeOperation = "source-over"; f.clearRect(0, 0, film.width, film.height);
    var k = ED.zoom * o.dpr; f.setTransform(k, 0, 0, k, ED.panX * o.dpr, ED.panY * o.dpr);
    f.fillStyle = "rgba(255,30,50,0.5)"; f.fillRect(0, 0, d.w, d.h);
    f.globalCompositeOperation = "destination-out"; f.imageSmoothingEnabled = ED.zoom < 2; f.drawImage(mask.canvas, mask.x, mask.y);
    o.c.save(); o.c.setTransform(1, 0, 0, 1, 0, 0); o.c.drawImage(film, 0, 0); o.c.restore();
  });
  // painting goes to the quick mask; layer commands wait until it is closed
  var ed0 = PE.editableExt;
  PE.editableExt = function (L, need) {
    if (ed0 && !ed0(L, need)) return false;
    if (L.kind === "qmask" && !ED.maskEdit) { ED.maskEdit = true; ED.emit("layers"); }
    return true;
  };
  ["dupExt", "removeExt", "mergeExt", "moveExt"].forEach(function (k) {
    var f = PE[k];
    PE[k] = function (a) { if (a && a.kind === "qmask") { S3.toast("Leave quick mask first (press Q)", "error"); return true; } return f ? f.apply(this, arguments) : false; };
  });
  var rast = ED.rasterize;
  ED.rasterize = function (L) { if (L && L.kind === "qmask") return L; return rast.apply(this, arguments); };
  // a project saved in quick mask mode opens with its selection restored
  ED.on("changed", function (why) {
    var d = ED.doc, Q = qlayer(d); if (!Q) { syncBtn(); return; }
    if (why === "open") { d.sel = Q.mask ? PE.makeSel(d, maskToSel(d, Q)) : null; d.layers = d.layers.filter(function (L) { return L !== Q; }); d.active = (d.layers[d.layers.length - 1] || {}).id; ED.maskEdit = false; ED.changed(); }
    syncBtn();
  });
  SX.props.qmask = function (P) {
    var w = ED.ui.w;
    P.appendChild(h("div", { "class": "pe-phead" }, [w.svg("t-qmask"), h("b", { text: "Quick mask" }), h("span", { "class": "faint", text: "Selection being edited" })]));
    P.appendChild(h("p", { "class": "faint pe-p", text: "Red shows what is not selected. Paint black to mask, white to select, grey for partial. Brush, eraser, gradient, fill and paint bucket all work. Press Q (or the button) to finish." }));
    P.appendChild(h("div", { "class": "pe-prow" }, [w.btn("Back to selection (Q)", SX.toggleQuickMask, "primary")]));
  };
  var btn = null;
  function syncBtn() { if (btn) { var on = SX.inQuickMask(); btn.setAttribute("aria-pressed", String(on)); btn.classList.toggle("on", on); } }
  document.addEventListener("DOMContentLoaded", function () {
    var box = S3.$("#tools"); if (!box) return;
    btn = h("button", { type: "button", "class": "pe-tool pe-qmbtn", title: "Quick mask mode (Q)", "aria-label": "Quick mask mode", "aria-pressed": "false", onclick: function () { if (ED.doc) SX.toggleQuickMask(); } }, [ED.ui.w.svg("t-qmask")]);
    box.appendChild(btn);
  });
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== "q" && e.key !== "Q") || !ED.doc) return false;
    e.preventDefault(); SX.toggleQuickMask(); return true;
  });
  SX.menu("Select", [["Quick mask mode", "Q", function () { SX.toggleQuickMask(); }, SX.has]], "Refine selection…");

  SX.tests.push(async function (ok) {
    var bg = PE.rasterFromCanvas(SX.solid(40, 20, "#ffffff"), "bg"), d = SX.scratch(40, 20, [bg]);
    d.sel = PE.makeSel(d, window.PIX.rectMask(40, 20, 0, 0, 20, 20));
    SX.toggleQuickMask(); var Q = qlayer(d);
    ok(Q && !d.sel && d.active === Q.id && ED.maskEdit, "Q turns the selection into a quick mask");
    var o = ED.o.brush, keep = Object.assign({}, o), tool = ED.tool; ED.tool = "brush"; o.size = 8; o.hard = 1; o.op = 1; d.fg = "#ffffff";
    var ev = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false };
    ED.TOOLS.brush.down({ x: 30, y: 10 }, ev); ED.TOOLS.brush.up({ x: 30, y: 10 }, ev);
    ok(SX.px(bg.canvas, 30, 10).join() === "255,255,255,255", "painting changes the mask, not the picture");
    ok(SX.px(PE.flatten(d), 5, 5).join() === "255,255,255,255", "the quick mask never shows in the picture or exports");
    SX.toggleQuickMask();
    ok(!qlayer(d) && d.sel && d.sel.m[10 * 40 + 30] === 255 && d.sel.m[10 * 40 + 5] === 255 && d.sel.m[10 * 40 + 25] === 0 && d.active === bg.id, "Q again: painted area is now selected");
    ED.undo(); ok(qlayer(d) && !d.sel, "undo returns to quick mask");
    ED.undo(); ok(SX.px(qlayer(d).mask.canvas, 30, 10)[3] === 0, "undo the stroke");
    ED.undo(); ok(!qlayer(d) && d.sel && d.sel.b.w === 20, "undo entering");
    Object.assign(o, keep); ED.tool = tool; ED.maskEdit = false;
  });
})();
