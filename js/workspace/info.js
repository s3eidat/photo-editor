/* Workspace (files lane): Info panel. The colour under the pointer (RGB, HSB, Lab, hex, simple CMYK, opacity), the
   pointer position in the ruler units, the size of the marquee / crop / transform being dragged, and the document size,
   resolution and print size. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, C = WS.color, h = S3.h;
  var I = WS.info = {}, rows = {}, last = null, raf = 0;
  var st = Object.assign({ mode: "hsb", all: true }, S3.store("pe-info") || {});

  I.sample = function (x, y) {      // [r,g,b,a] of the composite (or the current layer) at doc pixel x,y, or null
    var d = ED.doc; x = Math.floor(x); y = Math.floor(y);
    if (!d || x < 0 || y < 0 || x >= d.w || y >= d.h) return null;
    var o = { rect: { x: x, y: y, w: 1, h: 1 } }; if (!st.all && ED.layer()) o.only = [ED.layer().id];
    return Array.prototype.slice.call(PE.getData(PE.flatten(d, o)).data);
  };
  function set(k, v) { if (rows[k] && rows[k].textContent !== v) rows[k].textContent = v; }
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(v % 1 && Math.abs(v) < 1000 ? 1 : 0); }
  function paint() {
    raf = 0;
    var d = ED.doc;
    if (!d) { Object.keys(rows).forEach(function (k) { set(k, "—"); }); return; }
    var p = last, px = p ? I.sample(p.x, p.y) : null;
    if (px && px[3]) {
      var hsb = C.rgb2hsb(px[0], px[1], px[2]), lab = C.rgb2lab(px[0], px[1], px[2]), cm = C.rgb2cmyk(px[0], px[1], px[2]);
      set("rgb", "R " + px[0] + "  G " + px[1] + "  B " + px[2] + (px[3] < 255 ? "  α " + Math.round(px[3] / 2.55) + "%" : ""));
      set("alt", st.mode === "lab" ? "L " + f1(lab[0]) + "  a " + f1(lab[1]) + "  b " + f1(lab[2]) : st.mode === "cmyk" ? "C " + Math.round(cm[0]) + "  M " + Math.round(cm[1]) + "  Y " + Math.round(cm[2]) + "  K " + Math.round(cm[3]) : "H " + Math.round(hsb[0]) + "°  S " + Math.round(hsb[1]) + "%  B " + Math.round(hsb[2]) + "%");
      set("hex", PE.toHex(px[0], px[1], px[2]).toUpperCase());
      rows.sw.style.background = PE.toHex(px[0], px[1], px[2]); rows.sw.style.opacity = px[3] / 255;
    } else { set("rgb", p ? "Transparent" : "—"); set("alt", "—"); set("hex", "—"); rows.sw.style.background = "transparent"; }
    set("xy", p ? "X " + WS.fmt(p.x, null, "x") + "   Y " + WS.fmt(p.y, null, "y") : "—");
    // what is being dragged / transformed
    var dr = ED.drag, s = "";
    if (dr && dr.kind === "marquee" && dr.rect) s = "W " + WS.fmt(dr.rect.w, null, "x") + "   H " + WS.fmt(dr.rect.h, null, "y");
    else if (ED.crop) s = "Crop W " + WS.fmt(ED.crop.w, null, "x") + "   H " + WS.fmt(ED.crop.h, null, "y");
    else if (ED.xf) s = "W " + f1(ED.xf.sx * 100) + "%   H " + f1(ED.xf.sy * 100) + "%   ∠ " + f1(ED.xf.rot) + "°";
    else if (dr && (dr.kind === "move" || dr.kind === "float") && dr.L) s = "Moving " + (dr.kind === "float" ? "selection" : "layer");
    else if (WS.measure && WS.measure.line && ED.tool === "ruler") s = WS.measure.summary();
    else if (d.sel) s = "Selection W " + WS.fmt(d.sel.b.w, null, "x") + "   H " + WS.fmt(d.sel.b.h, null, "y");
    set("wh", s || "—");
    var dpi = WS.dpi(d);
    set("doc", d.w + " × " + d.h + " px · " + dpi + " ppi · " + (d.w / dpi).toFixed(2) + " × " + (d.h / dpi).toFixed(2) + " in");
  }
  function soon() { if (!raf) raf = requestAnimationFrame(paint); }
  I.panel = WS.panel({ id: "info", title: "Info", open: false,
    build: function (body) {
      function row(k, cls) { rows[k] = h("div", { "class": "ws-irow mono " + (cls || "") }); return rows[k]; }
      rows.sw = h("span", { "class": "ws-isw", "aria-hidden": "true" });
      var mode = h("select", { "class": "select", "aria-label": "Second colour readout" });
      [["hsb", "HSB"], ["lab", "Lab"], ["cmyk", "CMYK (simple)"]].forEach(function (o) { var e = h("option", { value: o[0], text: o[1] }); if (o[0] === st.mode) e.selected = true; mode.appendChild(e); });
      mode.addEventListener("change", function () { st.mode = mode.value; S3.store("pe-info", st); soon(); });
      var all = ED.ui.w.check("All layers", st.all, function (v) { st.all = v; S3.store("pe-info", st); soon(); });
      body.appendChild(h("div", { "class": "ws-icol" }, [rows.sw, h("div", { "class": "ws-ivals" }, [row("rgb"), row("alt"), row("hex", "faint")])]));
      body.appendChild(h("div", { "class": "ws-hsel" }, [mode, all]));
      body.appendChild(row("xy")); body.appendChild(row("wh")); body.appendChild(row("doc", "faint"));
    },
    update: function (why) { soon(); } });
  ED.on("view", function (a) { if (a && typeof a === "object") last = a; });
  document.addEventListener("DOMContentLoaded", function () { ED.stage.addEventListener("pointerleave", function () { last = null; if (I.panel.isOpen()) soon(); }); });

  PE.files.tests.push(async function (ok) {
    var keep = { doc: ED.doc }, d = PE.newDoc(10, 10, "i"), c = PE.mk(10, 10), x = PE.cx2(c); x.fillStyle = "#ff8000"; x.fillRect(0, 0, 5, 10); d.layers = [PE.rasterFromCanvas(PE.touch(c), "a")];
    ED.doc = d; var a = I.sample(2, 3), b = I.sample(8, 3), z = I.sample(-1, 0);
    ok(a && a.join() === "255,128,0,255" && b && b[3] === 0 && z === null, "info samples the composite");
    ED.doc = keep.doc;
  });
})();
