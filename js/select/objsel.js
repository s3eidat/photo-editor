/* Selection lane: Object selection tool. Drag a box around something: the on-device AI (the same model as
   Select › Subject) finds the main object inside the box, edges are snapped to the photo, and the result is
   added to / subtracted from / replaces the selection (Shift adds, Alt subtracts). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx;
  SX.addIcons({ "t-objsel": '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke-dasharray="3 2.4"/><circle cx="12" cy="9.5" r="2.4"/><path d="M8 17.5c.4-2.6 2-4 4-4s3.6 1.4 4 4"/>' });
  var saved = (S3.store("pe-opts") || {}).objsel;
  ED.o.objsel = Object.assign({ all: true }, saved && typeof saved === "object" ? saved : {});
  var tools = ED.ui.TOOLS, qi = tools.map(function (t) { return t[0]; }).indexOf("qsel");
  tools.splice(qi + 1, 0, ["objsel", "Object selection", "W"]);

  function modeOf(e) { return e.shiftKey && e.altKey ? "intersect" : e.shiftKey ? "add" : e.altKey ? "subtract" : ED.o.sel.mode; }
  // Mask (doc size) of the main object inside rect r.
  SX.objectMask = function (r, all) {
    var d = ED.doc, pad = Math.round(Math.max(r.w, r.h) * 0.08), R = PE.inter(PE.rectI({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }), { x: 0, y: 0, w: d.w, h: d.h });
    if (!R) return Promise.resolve(new Uint8Array(d.w * d.h));
    var L = ED.layer(), src = all || !L ? PE.flatten(d, { rect: R }) : PE.flatten(d, { rect: R, only: [L.id] });
    var k = Math.min(1, 1600 / Math.max(R.w, R.h)), W = Math.max(1, Math.round(R.w * k)), H = Math.max(1, Math.round(R.h * k));
    return SX.segment(src).then(function (raw) {
      var g = PE.mk(W, H), gx = PE.cx2(g); gx.fillStyle = "#fff"; gx.fillRect(0, 0, W, H); gx.drawImage(src, 0, 0, W, H);
      var gi = gx.getImageData(0, 0, W, H);
      return SX.work("subject", [raw, 320, 320, { data: gi.data, width: W, height: H }, 0.5, 0.16]);
    }).then(function (m) {
      var mm = W === R.w && H === R.h ? m : SX.scaleMask(m, W, H, R.w, R.h), out = new Uint8Array(d.w * d.h), x0 = r.x - pad / 2, y0 = r.y - pad / 2, x1 = r.x + r.w + pad / 2, y1 = r.y + r.h + pad / 2;
      for (var y = 0; y < R.h; y++) { var dy = y + R.y; if (dy < y0 || dy >= y1) continue; for (var x = 0; x < R.w; x++) { var dx = x + R.x; if (dx >= x0 && dx < x1) out[dy * d.w + dx] = mm[y * R.w + x]; } }
      return out;
    });
  };
  ED.TOOLS.objsel = {
    down: function (p, e) { if (ED.busyCheck()) return; ED.drag = { kind: "marquee", a: p, mode: modeOf(e), ellipse: false, center: false }; },
    move: function (p, e) { var dr = ED.drag; var dx = p.x - dr.a.x, dy = p.y - dr.a.y; dr.rect = { x: dx < 0 ? p.x : dr.a.x, y: dy < 0 ? p.y : dr.a.y, w: Math.abs(dx), h: Math.abs(dy) }; void e; },
    up: function () {
      var dr = ED.drag; ED.drag = null; ED.renderOvl();
      if (!dr || !dr.rect || dr.rect.w * ED.zoom < 6 || dr.rect.h * ED.zoom < 6) { S3.toast("Drag a box around the object you want"); return; }
      if (!SX.subjectModelLoaded()) S3.toast("The AI model (about 16 MB) downloads once from this site, then works offline. Nothing is uploaded.");
      ED.working(SX.objectMask(dr.rect, ED.o.objsel.all), "Finding the object…").then(function (m) {
        var d = ED.doc; if (!PE.makeSel(d, m)) { S3.toast("No clear object in that box. Try a tighter box, or the Quick selection tool.", "error"); return; }
        ED.setSelection(m, dr.mode, "Object selection");
      }).catch(function (err) { S3.toast(err.message, "error"); });
    }
  };
  (ED.ui.optsTail = ED.ui.optsTail || []).unshift(function (t, items) {
    if (t !== "objsel") return;
    var w = ED.ui.w;
    items.push(w.seg("", [["new", "New", "New selection", "t-snew"], ["add", "Add", "Add (Shift)", "t-sadd"], ["subtract", "Subtract", "Subtract (Alt)", "t-ssub"], ["intersect", "Intersect", "Intersect (Shift+Alt)", "t-sint"]], ED.o.sel.mode, function (v) { ED.o.sel.mode = v; ED.saveOpts(); }));
    items.push(w.check("All layers", ED.o.objsel.all, function (v) { ED.o.objsel.all = v; ED.saveOpts(); }));
    items.push(S3.h("span", { "class": "pe-hint", text: "Drag a box around an object: on-device AI selects it. Shift adds, Alt subtracts." }));
  });
  // W cycles wand -> quick selection -> object selection
  ED.ui.keys.unshift(function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== "w" && e.key !== "W") || !ED.doc) return false;
    var cyc = ["wand", "qsel", "objsel"], i = cyc.indexOf(ED.tool);
    e.preventDefault(); ED.setTool(cyc[(i + 1) % cyc.length]); return true;
  });

  SX.tests.push(async function (ok) {
    ok(ED.TOOLS.objsel && ED.ui.TOOLS.some(function (t) { return t[0] === "objsel"; }), "object selection tool registered");
    if (!SX.subjectModelLoaded()) return;     // the AI path itself is checked end to end when the model is loaded
  });
})();
