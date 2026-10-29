/* Selection lane: Select › Colour range…. Pick colours on the canvas (Shift adds, Alt removes) or choose a preset
   range (reds … magentas, highlights, midtones, shadows, skin tones); fuzziness, localized range, invert.
   Live red-overlay preview at up to 1200 px; OK computes the full-size selection. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, h = S3.h;
  var MAXP = 1200, RC = null;
  var MODES = [["sampled", "Sampled colours"], ["reds", "Reds"], ["yellows", "Yellows"], ["greens", "Greens"], ["cyans", "Cyans"], ["blues", "Blues"], ["magentas", "Magentas"],
    ["highlights", "Highlights"], ["midtones", "Midtones"], ["shadows", "Shadows"], ["skin", "Skin tones"]];
  function store() { var s = S3.store("pe-crange") || {}; return { mode: MODES.some(function (m) { return m[0] === s.mode; }) ? s.mode : "sampled", fuzz: +s.fuzz || 40, local: !!s.local, range: +s.range || 30, invert: false, pick: "new", result: ["new", "add", "subtract", "intersect"].indexOf(s.result) >= 0 ? s.result : "new" }; }

  SX.openColorRange = function () {
    if (!SX.need() || RC) return;
    ED.cancelModes();
    var d = ED.doc, k = Math.min(1, MAXP / Math.max(d.w, d.h)), c = PE.flatten(d, { scale: k }), img = PE.getData(c);
    RC = { k: k, W: c.width, H: c.height, img: { data: img.data, width: c.width, height: c.height }, o: store(), samples: [], minus: [], prevTool: ED.tool, sel: d.sel, result: null, prev: null, busy: false, again: false };
    d.sel = null;
    build(); ED.setTool("crange"); recompute();
  };
  function opts(r, k) {
    var o = r.o, map = function (s) { return [s[0], s[1], s[2], s[3] * k, s[4] * k]; };
    return { mode: o.mode, fuzz: o.fuzz, range: o.local ? o.range * Math.max(ED.doc.w, ED.doc.h) / 100 * k : 0, invert: o.invert, samples: r.samples.map(map), minus: r.minus.map(map) };
  }
  function recompute() {
    if (!RC) return;
    if (RC.busy) { RC.again = true; return; }
    RC.busy = true; RC.again = false;
    var job = RC;
    SX.work("colorRange", [job.img, opts(job, job.k)]).then(function (m) { if (RC !== job) return; job.result = m; preview(); })
      .catch(function (e) { S3.toast(e.message, "error"); }).then(function () { job.busy = false; if (RC === job && job.again) recompute(); });
  }
  var soon = S3.debounce(recompute, 50);
  function preview() {
    var r = RC, a = r.result, c = r.prev && r.prev.width === r.W ? r.prev : PE.mk(r.W, r.H), x = PE.cx2(c), im = x.createImageData(r.W, r.H), o = im.data;
    for (var i = 0, j = 0; i < a.length; i++, j += 4) { o[j] = 255; o[j + 1] = 40; o[j + 2] = 60; o[j + 3] = (255 - a[i]) * 0.6; }
    x.putImageData(im, 0, 0); r.prev = c; ED.renderOvl();
    if (r.thumb) { var t = r.thumb.getContext("2d"), ti = t.createImageData(r.W, r.H); for (i = 0; i < a.length; i++) { ti.data[i * 4] = ti.data[i * 4 + 1] = ti.data[i * 4 + 2] = a[i]; ti.data[i * 4 + 3] = 255; } var tmp = PE.mk(r.W, r.H); PE.cx2(tmp).putImageData(ti, 0, 0); t.drawImage(tmp, 0, 0, r.thumb.width, r.thumb.height); }
  }
  ED.on("overlay", function (o) { if (RC && RC.prev && ED.doc) o.docPath(o.c, function (c) { c.imageSmoothingEnabled = true; c.drawImage(RC.prev, 0, 0, ED.doc.w, ED.doc.h); }); });
  ED.TOOLS.crange = {
    down: function (p, e) {
      if (!RC) return;
      var d = ED.doc, x = Math.floor(p.x), y = Math.floor(p.y); if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
      var px = PE.getData(PE.flatten(d, { rect: { x: x, y: y, w: 1, h: 1 } })).data, s = [px[0], px[1], px[2], x, y];
      var how = e.altKey ? "minus" : e.shiftKey ? "add" : RC.o.pick;
      if (RC.o.mode !== "sampled") { RC.o.mode = "sampled"; RC.box.remove(); build(); }
      if (how === "minus") RC.minus.push(s); else if (how === "add") RC.samples.push(s); else { RC.samples = [s]; RC.minus = []; }
      info(); recompute();
    }
  };
  function info() { if (!RC || !RC.info) return; RC.info.textContent = RC.samples.length ? RC.samples.length + " colour" + (RC.samples.length > 1 ? "s" : "") + " picked" + (RC.minus.length ? ", " + RC.minus.length + " removed" : "") + ". Shift+click adds, Alt+click removes." : "Click the photo to pick a colour. Shift+click adds more, Alt+click removes."; }
  function build() {
    var w = ED.ui.w, o = RC.o, box = h("div", { "class": "pe-float pe-fxpanel pe-rmpanel", role: "dialog", "aria-label": "Colour range" }), body = h("div", { "class": "pe-fbody" });
    function save() { S3.store("pe-crange", { mode: o.mode, fuzz: o.fuzz, local: o.local, range: o.range, result: o.result }); }
    body.appendChild(w.select("Select", MODES, o.mode, function (v) { o.mode = v; save(); RC.box.remove(); build(); recompute(); }));
    if (o.mode === "sampled") {
      body.appendChild(w.seg("Click", [["new", "Pick"], ["add", "Add +"], ["minus", "Remove −"]], o.pick, function (v) { o.pick = v; }));
      RC.info = h("p", { "class": "faint pe-p" }); body.appendChild(RC.info); info();
    }
    if (o.mode === "sampled" || o.mode === "skin") body.appendChild(w.range("Fuzziness", o.fuzz, 1, 200, 1, function (v) { o.fuzz = v; save(); soon(); }));
    if (o.mode === "sampled") {
      body.appendChild(w.check("Localized colour clusters", o.local, function (v) { o.local = v; save(); soon(); }));
      body.appendChild(w.range("Range", o.range, 1, 100, 1, function (v) { o.range = v; save(); soon(); }, function (v) { return v + "%"; }));
    }
    body.appendChild(w.check("Invert", o.invert, function (v) { o.invert = v; soon(); }));
    if (RC.sel) body.appendChild(w.seg("With the current selection", [["new", "Replace"], ["add", "Add"], ["subtract", "Subtract"], ["intersect", "Intersect"]], o.result, function (v) { o.result = v; save(); }));
    var th = h("canvas", { "class": "pe-crthumb", width: String(Math.round(RC.W / Math.max(RC.W, RC.H) * 240)), height: String(Math.round(RC.H / Math.max(RC.W, RC.H) * 240)), "aria-label": "Selection preview" });
    body.appendChild(th); RC.thumb = th;
    box.appendChild(h("div", { "class": "row between pe-fhead" }, [h("b", { text: "Colour range" })]));
    box.appendChild(body);
    box.appendChild(h("div", { "class": "row pe-ffoot" }, [h("span", { "class": "grow" }), w.btn("Cancel", function () { close(false); }, "ghost"), w.btn("OK", function () { close(true); }, "primary")]));
    S3.$("#stage").appendChild(box); RC.box = box;
    if (RC.result) preview();
  }
  function close(ok) {
    var r = RC; if (!r) return;
    var d = ED.doc; RC = null; r.box.remove(); d.sel = r.sel; ED.setTool(r.prevTool === "crange" ? "wand" : r.prevTool); ED.renderOvl();
    if (!ok) { ED.changed(); return; }
    var img = PE.getData(PE.flatten(d)), o = r.o;
    ED.working(SX.work("colorRange", [{ data: img.data, width: d.w, height: d.h }, opts(r, 1)]), "Selecting colours…").then(function (m) {
      if (!PE.makeSel(d, m) && o.result === "new") { S3.toast("No pixels matched (more than 50%): try a higher fuzziness", "error"); }
      ED.setSelection(m, d.sel ? o.result : "new", "Colour range");
    }).catch(function (e) { S3.toast(e.message, "error"); });
  }
  SX.closeColorRange = close;
  ED.on("tool", function () { if (RC && ["crange", "hand", "zoom"].indexOf(ED.tool) < 0) { ED.setTool("crange"); S3.toast("Finish Colour range first: OK or Cancel"); } });
  ED.on("changed", function (why) { if (RC && why === "open") { var r = RC; RC = null; r.box.remove(); } });
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (!RC) return false;
    if (e.key === "Escape") { e.preventDefault(); close(false); return true; }
    if (e.key === "Enter" && !ED.isTyping(e)) { e.preventDefault(); close(true); return true; }
    if (!(e.ctrlKey || e.metaKey) && /^[a-zA-Z]$/.test(e.key) && "hz".indexOf(e.key.toLowerCase()) < 0) { e.preventDefault(); return true; }
    return false;
  });
  ED.ui.TOOLS.push(["crange", "Pick colours (Colour range)", ""]);
  document.addEventListener("DOMContentLoaded", function () { var b = S3.$('.pe-tool[data-tool="crange"]'); if (b) b.hidden = true; });
  (ED.ui.optsTail = ED.ui.optsTail || []).push(function (t, items) { if (t === "crange") items.push(h("span", { "class": "pe-hint", text: "Click the photo to pick a colour; Shift+click adds, Alt+click removes. Space pans." })); });
  SX.menu("Select", [["Colour range…", "", function () { SX.openColorRange(); }, SX.has]], "Subject");

  SX.tests.push(async function (ok) {
    var P = window.PIXS, W = 6, img = { data: new Uint8ClampedArray([255, 0, 0, 255, 250, 10, 5, 255, 0, 0, 255, 255, 0, 200, 0, 255, 240, 240, 240, 255, 20, 20, 20, 255]), width: W, height: 1 };
    var s = P.colorRange(img, { mode: "sampled", samples: [[255, 0, 0, 0, 0]], fuzz: 40 }); ok(s[0] === 255 && s[1] === 255 && s[2] === 0 && s[3] === 0, "sampled colours with fuzziness");
    var rd = P.colorRange(img, { mode: "reds" }); ok(rd[0] > 200 && rd[2] === 0 && rd[4] === 0, "reds range skips greys and blues");
    var bl = P.colorRange(img, { mode: "blues" }); ok(bl[2] > 200 && bl[0] === 0, "blues range");
    var hi = P.colorRange(img, { mode: "highlights" }), sh = P.colorRange(img, { mode: "shadows" }); ok(hi[4] === 255 && hi[5] === 0 && sh[5] === 255 && sh[4] === 0, "highlights / shadows");
    var mn = P.colorRange(img, { mode: "sampled", samples: [[255, 0, 0, 0, 0]], minus: [[250, 10, 5, 1, 0]], fuzz: 40 }); ok(mn[1] < 50, "removed samples drop out");
    var inv = P.colorRange(img, { mode: "reds", invert: true }); ok(inv[2] === 255 && inv[0] < 55, "invert");
    var lc = P.colorRange({ data: new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]), width: 4, height: 1 }, { mode: "sampled", samples: [[255, 0, 0, 0, 0]], fuzz: 40, range: 2 }); ok(lc[0] === 255 && lc[3] === 0, "localized colour clusters");
  });
})();
