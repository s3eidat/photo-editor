/* Selection lane: Select › Focus area…. Finds the sharp, in-focus parts of the picture (local detail against a
   noise floor) with a live overlay; "In-focus range" widens or narrows what counts as sharp. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, h = S3.h;
  var MAXP = 900, FA = null;
  SX.openFocusArea = function () {
    if (!SX.need() || FA) return;
    ED.cancelModes();
    var d = ED.doc, k = Math.min(1, MAXP / Math.max(d.w, d.h)), c = PE.flatten(d, { scale: k, bg: "#ffffff" }), im = PE.getData(c), s = S3.store("pe-focus") || {};
    FA = { W: c.width, H: c.height, img: { data: im.data, width: c.width, height: c.height }, range: +s.range || 50, noise: +s.noise || 10, sel: d.sel, result: null, prev: null, busy: false, again: false };
    d.sel = null; build(); run();
  };
  function run() {
    if (!FA) return;
    if (FA.busy) { FA.again = true; return; }
    FA.busy = true; FA.again = false; var job = FA;
    SX.work("focusArea", [job.img, job.range, job.noise]).then(function (m) {
      if (FA !== job) return; job.result = m;
      var c = job.prev || PE.mk(job.W, job.H), x = PE.cx2(c), id = x.createImageData(job.W, job.H);
      for (var i = 0; i < m.length; i++) { id.data[i * 4] = 255; id.data[i * 4 + 1] = 40; id.data[i * 4 + 2] = 60; id.data[i * 4 + 3] = (255 - m[i]) * 0.6; }
      x.putImageData(id, 0, 0); job.prev = c; ED.renderOvl();
    }).catch(function (e) { S3.toast(e.message, "error"); }).then(function () { job.busy = false; if (FA === job && job.again) run(); });
  }
  var soon = S3.debounce(run, 80);
  ED.on("overlay", function (o) { if (FA && FA.prev && ED.doc) o.docPath(o.c, function (c) { c.imageSmoothingEnabled = true; c.drawImage(FA.prev, 0, 0, ED.doc.w, ED.doc.h); }); });
  function build() {
    var w = ED.ui.w, box = h("div", { "class": "pe-float pe-fxpanel pe-rmpanel", role: "dialog", "aria-label": "Focus area" }), body = h("div", { "class": "pe-fbody" });
    function save() { S3.store("pe-focus", { range: FA.range, noise: FA.noise }); }
    body.appendChild(h("p", { "class": "faint pe-p", text: "Selects the sharp parts of the photo (the subject in focus) and leaves soft backgrounds out." }));
    body.appendChild(w.range("In-focus range", FA.range, 0, 100, 1, function (v) { FA.range = v; save(); soon(); }));
    body.appendChild(w.range("Image noise level", FA.noise, 0, 100, 1, function (v) { FA.noise = v; save(); soon(); }));
    box.appendChild(h("div", { "class": "row between pe-fhead" }, [h("b", { text: "Focus area" })]));
    box.appendChild(body);
    box.appendChild(h("div", { "class": "row pe-ffoot" }, [h("span", { "class": "grow" }), w.btn("Cancel", function () { close(false); }, "ghost"), w.btn("OK", function () { close(true); }, "primary")]));
    S3.$("#stage").appendChild(box); FA.box = box;
  }
  function close(ok) {
    var f = FA; if (!f) return;
    var d = ED.doc; FA = null; f.box.remove(); d.sel = f.sel; ED.renderOvl();
    if (!ok || !f.result) { ED.changed(); return; }
    var m = SX.scaleMask(f.result, f.W, f.H, d.w, d.h);
    if (!PE.makeSel(d, m)) { S3.toast("Nothing looked sharp enough: raise the in-focus range", "error"); ED.changed(); return; }
    ED.setSelection(m, "new", "Focus area");
  }
  SX.closeFocusArea = close;
  ED.on("changed", function (why) { if (FA && why === "open") { var f = FA; FA = null; f.box.remove(); } });
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (!FA) return false;
    if (e.key === "Escape") { e.preventDefault(); close(false); return true; }
    if (e.key === "Enter" && !ED.isTyping(e)) { e.preventDefault(); close(true); return true; }
    return false;
  });
  SX.menu("Select", [["Focus area…", "", function () { SX.openFocusArea(); }, SX.has]], "Colour range…");

  SX.tests.push(async function (ok) {
    // left half: fine checker (sharp); right half: flat (soft)
    var W = 120, H = 60, img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { var i = (y * W + x) * 4, v = x < 60 ? (((x >> 1) + (y >> 1)) & 1 ? 230 : 30) : 128 + Math.round(Math.sin(x / 9) * 6); img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    var m = window.PIXS.focusArea(img, 50, 10);
    ok(m[30 * W + 20] === 255 && m[30 * W + 100] === 0, "focus area keeps the sharp half, drops the soft half");
  });
})();
