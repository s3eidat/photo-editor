/* Files lane: File › Print… (Ctrl+P). Paper size and orientation, scale to fit, print at the document's resolution or a
   custom scale, margins, centred or placed position, and printer's marks: corner crop marks, centre marks,
   registration targets and a label. The page is rendered here (up to 300 ppi) and handed to the browser's print
   dialog, which can also save a PDF. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, FX = PE.files, h = S3.h, W = ED.ui.w;
  var PRN = FX.print = {};
  var PAPERS = PRN.PAPERS = [["a4", "A4", 210, 297], ["letter", "US Letter", 215.9, 279.4], ["legal", "US Legal", 215.9, 355.6], ["a3", "A3", 297, 420], ["a5", "A5", 148, 210],
    ["tabloid", "Tabloid", 279.4, 431.8], ["4x6", "Photo 4 × 6 in", 101.6, 152.4], ["5x7", "Photo 5 × 7 in", 127, 177.8], ["8x10", "Photo 8 × 10 in", 203.2, 254]];
  var DEF = { paper: "a4", orient: "auto", fit: "fit", scale: 100, margin: 12, crop: true, center: false, reg: false, label: true, bleed: 0, pw: 210, ph: 297 };

  // page geometry in mm: {pw, ph, x, y, w, h (image box), dpi used for "document size"}
  PRN.layout = function (doc, o) {
    var pp = PAPERS.filter(function (p) { return p[0] === o.paper; })[0], pw = pp ? pp[2] : o.pw, ph = pp ? pp[3] : o.ph, ar = doc.w / doc.h;
    var land = o.orient === "landscape" || (o.orient === "auto" && ar > 1);
    if (land !== pw > ph) { var t = pw; pw = ph; ph = t; }
    var m = Math.max(0, o.margin), aw = pw - 2 * m, ah = ph - 2 * m, dpi = doc.dpi > 0 ? doc.dpi : 72, w, hh;
    if (o.fit === "fit") { var k = Math.min(aw / doc.w, ah / doc.h); w = doc.w * k; hh = doc.h * k; }
    else { var s = (o.fit === "doc" ? 1 : o.scale / 100) * 25.4 / dpi; w = doc.w * s; hh = doc.h * s; }
    return { pw: pw, ph: ph, x: (pw - w) / 2, y: (ph - hh) / 2, w: w, h: hh, ppi: doc.w / (w / 25.4) };
  };
  // Render the page at ppi into a canvas (white paper, image, marks)
  PRN.render = function (doc, o, ppi) {
    var L = PRN.layout(doc, o), k = ppi / 25.4, c = PE.mk(L.pw * k, L.ph * k), x = PE.cx2(c);
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    var img = PE.flatten(doc, { bg: "#ffffff", scale: Math.min(1, (L.w * k) / doc.w * 1.5) });
    x.imageSmoothingQuality = "high"; x.drawImage(img, L.x * k, L.y * k, L.w * k, L.h * k);
    var b = (o.bleed || 0), mk = 2.5, len = 6, X0 = (L.x - b) * k, Y0 = (L.y - b) * k, X1 = (L.x + L.w + b) * k, Y1 = (L.y + L.h + b) * k, off = mk * k, ln = len * k;
    x.strokeStyle = "#000"; x.lineWidth = Math.max(1, 0.1 * k);
    function line(a, b2, c2, d) { x.beginPath(); x.moveTo(a, b2); x.lineTo(c2, d); x.stroke(); }
    if (o.crop) {
      [[X0, Y0, -1, -1], [X1, Y0, 1, -1], [X0, Y1, -1, 1], [X1, Y1, 1, 1]].forEach(function (q) {
        line(q[0] + q[2] * off, q[1], q[0] + q[2] * (off + ln), q[1]);
        line(q[0], q[1] + q[3] * off, q[0], q[1] + q[3] * (off + ln));
      });
    }
    var cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2;
    if (o.center) { [[cx, Y0 - off, 0, -1], [cx, Y1 + off, 0, 1], [X0 - off, cy, -1, 0], [X1 + off, cy, 1, 0]].forEach(function (q) { line(q[0], q[1], q[0] + q[2] * ln, q[1] + q[3] * ln); line(q[0] + (q[3] ? -ln / 3 : q[2] * ln / 2), q[1] + (q[2] ? -ln / 3 : q[3] * ln / 2), q[0] + (q[3] ? ln / 3 : q[2] * ln / 2), q[1] + (q[2] ? ln / 3 : q[3] * ln / 2)); }); }
    if (o.reg) {
      var r = 2.2 * k;
      [[cx, Y0 - off - ln / 2 - r], [cx, Y1 + off + ln / 2 + r], [X0 - off - ln / 2 - r, cy], [X1 + off + ln / 2 + r, cy]].forEach(function (q) {
        if (q[0] < 0 || q[1] < 0 || q[0] > c.width || q[1] > c.height) return;
        x.beginPath(); x.arc(q[0], q[1], r, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.arc(q[0], q[1], r / 2, 0, Math.PI * 2); x.fill();
        line(q[0] - r * 1.5, q[1], q[0] + r * 1.5, q[1]); line(q[0], q[1] - r * 1.5, q[0], q[1] + r * 1.5);
      });
    }
    if (o.label) {
      x.fillStyle = "#000"; x.font = Math.round(2.6 * k) + "px sans-serif"; x.textBaseline = "bottom";
      var s = doc.name + "  ·  " + doc.w + " × " + doc.h + " px  ·  " + Math.round(L.ppi) + " ppi  ·  " + new Date().toLocaleDateString();
      x.fillText(s, Math.max(2 * k, X0), Math.max(4 * k, Y0 - off - ln - 1.5 * k));
    }
    return { canvas: c, layout: L };
  };
  function current() { var o = Object.assign({}, DEF, S3.store("pe-print") || {}); return o; }
  PRN.dialog = function () {
    if (!FX.need()) return; ED.flushProps();
    var d = ED.doc, o = current(), prev = h("canvas", { "class": "fx-pprev" }), info = h("p", { "class": "faint pe-p mono" });
    var scaleI = h("input", { type: "number", "class": "input", min: "1", max: "1000", step: "any", value: String(o.scale) }), mI = h("input", { type: "number", "class": "input", min: "0", max: "100", step: "any", value: String(o.margin) });
    var bI = h("input", { type: "number", "class": "input", min: "0", max: "20", step: "any", value: String(o.bleed) });
    var draw = S3.debounce(function () {
      var r = PRN.render(d, o, 28), c = r.canvas, L = r.layout, maxW = 300, maxH = 380, k = Math.min(maxW / c.width, maxH / c.height);
      prev.width = Math.round(c.width * k); prev.height = Math.round(c.height * k); var x = prev.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, prev.width, prev.height);
      info.textContent = "Paper " + L.pw.toFixed(1) + " × " + L.ph.toFixed(1) + " mm · image " + L.w.toFixed(1) + " × " + L.h.toFixed(1) + " mm · " + Math.round(L.ppi) + " ppi" + (L.ppi < 150 ? " (may look soft)" : "") +
        (L.x < 0 || L.y < 0 ? " · larger than the paper: it will be cut off" : "");
    }, 120);
    function set(k) { return function (v) { o[k] = v; scaleI.disabled = o.fit !== "scale"; draw(); }; }
    scaleI.addEventListener("input", function () { o.scale = PE.clamp(+scaleI.value || 100, 1, 1000); draw(); });
    mI.addEventListener("input", function () { o.margin = PE.clamp(+mI.value || 0, 0, 100); draw(); });
    bI.addEventListener("input", function () { o.bleed = PE.clamp(+bI.value || 0, 0, 20); draw(); });
    var right = h("div", { "class": "stack fx-pside" }, [
      W.select("Paper", PAPERS.map(function (p) { return [p[0], p[1]]; }), o.paper, set("paper")),
      W.seg("Orientation", [["auto", "Auto"], ["portrait", "Portrait"], ["landscape", "Landscape"]], o.orient, set("orient")),
      W.seg("Size", [["fit", "Fit to page"], ["doc", "Document size"], ["scale", "Scale"]], o.fit, set("fit")),
      h("div", { "class": "pe-custom" }, [W.field("Scale %", scaleI), W.field("Margin (mm)", mI), W.field("Bleed (mm)", bI)]),
      h("h3", { text: "Printer's marks" }),
      W.check("Corner crop marks", o.crop, set("crop")), W.check("Centre marks", o.center, set("center")), W.check("Registration marks", o.reg, set("reg")), W.check("Label (name, size, date)", o.label, set("label")),
      info]);
    scaleI.disabled = o.fit !== "scale";
    var body = h("div", { "class": "fx-print" }, [h("div", { "class": "fx-pbox" }, [prev]), right]);
    var go = W.btn("Print…", function () { S3.store("pe-print", o); dlg.close(); PRN.print(d, o); }, "primary");
    var dlg = W.modal("Print", body, [h("span", { "class": "faint", text: "Uses your browser's print dialog (it can also save a PDF)." }), h("span", { "class": "grow" }), W.btn("Cancel", function () { dlg.close(); }, "ghost"), go], true);
    draw();
  };
  PRN.print = function (d, o) {
    var L = PRN.layout(d, o), ppi = Math.min(300, Math.max(72, Math.sqrt(36e6 / (L.pw * L.ph / 645.16)))), r;
    try { r = PRN.render(d, o, ppi); } catch (e) { S3.toast(e.message, "error"); return; }
    ED.working(PE.toBlob(r.canvas, "image/png"), "Preparing the page…").then(function (b) {
      var url = URL.createObjectURL(b), old = document.getElementById("ws-print"), st = document.getElementById("ws-print-style");
      if (old) old.remove(); if (st) st.remove();
      var img = h("img", { id: "ws-print-img", alt: "", src: url }), wrap = h("div", { id: "ws-print" }, [img]);
      img.style.width = L.pw + "mm"; img.style.height = L.ph + "mm";
      var css = h("style", { id: "ws-print-style" }); css.textContent = "@page { size: " + L.pw.toFixed(2) + "mm " + L.ph.toFixed(2) + "mm; margin: 0; }";
      document.head.appendChild(css); document.body.appendChild(wrap);
      function done() { window.removeEventListener("afterprint", done); setTimeout(function () { wrap.remove(); css.remove(); URL.revokeObjectURL(url); }, 500); }
      window.addEventListener("afterprint", done);
      img.decode().catch(function () {}).then(function () { window.print(); });
    }).catch(function (e) { S3.toast(e.message, "error"); });
  };
  FX.menu("File", ["Print…", "Ctrl+P", PRN.dialog, FX.has], "Export layers to files…", true);
  document.addEventListener("DOMContentLoaded", function () { PE.ws.key(function (e) { return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p"; }, PRN.dialog); });

  FX.tests.push(async function (ok, near, px, solid) {
    var d = PE.newDoc(3000, 2000, "p"); d.dpi = 300; d.layers = [PE.rasterFromCanvas(solid(3000, 2000, "#ff0000"), "r")];
    var L = PRN.layout(d, Object.assign({}, DEF, { fit: "doc", orient: "auto" }));
    ok(near(L.w, 254, 1e-6) && near(L.h, 169.333, 1e-3) && L.pw > L.ph && near(L.x, (297 - 254) / 2, 1e-6), "print at document size (10 × 6.67 in on landscape A4)");
    var F = PRN.layout(d, Object.assign({}, DEF, { fit: "fit", margin: 10, paper: "letter", orient: "portrait" }));
    ok(near(F.w, 215.9 - 20, 1e-6) && F.pw < F.ph, "print fit to page");
    var r = PRN.render(d, Object.assign({}, DEF, { fit: "scale", scale: 50, crop: true }), 25.4);      // 1 px per mm
    var c = r.canvas, L2 = r.layout, ix = Math.round(L2.x - 2.5 - 3), dark = 255;
    for (var yy = Math.floor(L2.y) - 1; yy <= Math.ceil(L2.y) + 1; yy++) dark = Math.min(dark, px(c, ix, yy)[0]);
    ok(px(c, Math.round(L2.x + L2.w / 2), Math.round(L2.y + L2.h / 2))[1] === 0 && dark < 128 && px(c, ix, Math.round(L2.y) + 6)[0] === 255, "page has the image and crop marks");
  });
})();
