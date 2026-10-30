/* Workspace (files lane): Navigator panel. A thumbnail of the whole image with the visible area outlined; drag or click
   in it to scroll, zoom with the slider, the buttons or the percentage field. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, h = S3.h;
  var thumb = null, cv, zr, zt, k = 1, thumbVer = "", W0 = 268, H0 = 170;

  function stageSize() { var r = ED.stage.getBoundingClientRect(); return { w: r.width, h: r.height }; }
  function rebuild() {
    var d = ED.doc; if (!d) { thumb = null; return; }
    k = Math.min(W0 / d.w, H0 / d.h, 1);
    thumb = PE.flatten(d, { scale: k });
  }
  function draw() {
    var d = ED.doc, dpr = Math.min(2, window.devicePixelRatio || 1), x = cv.getContext("2d");
    var w = d ? Math.max(1, Math.round(d.w * k)) : W0, hh = d ? Math.max(1, Math.round(d.h * k)) : 60;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); cv.style.width = w + "px"; cv.style.height = hh + "px";
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, hh);
    if (!d || !thumb) return;
    x.fillStyle = "#fff"; x.fillRect(0, 0, w, hh); x.fillStyle = "#d4d7dc";
    for (var yy = 0; yy < hh; yy += 6) for (var xx = (yy / 6) % 2 ? 6 : 0; xx < w; xx += 12) x.fillRect(xx, yy, 6, 6);
    x.drawImage(thumb, 0, 0, w, hh);
    var s = stageSize(), vx = -ED.panX / ED.zoom * k, vy = -ED.panY / ED.zoom * k, vw = s.w / ED.zoom * k, vh = s.h / ED.zoom * k;
    x.lineWidth = 2; x.strokeStyle = "#e5484d"; x.strokeRect(Math.round(vx) + 1, Math.round(vy) + 1, Math.round(vw) - 2, Math.round(vh) - 2);
    var pct = Math.round(ED.zoom * 1000) / 10;
    if (document.activeElement !== zt) zt.value = pct;
    zr.value = Math.round(Math.log(ED.zoom) / Math.LN2 * 100);
  }
  function centerAt(e) {
    var r = cv.getBoundingClientRect(), s = stageSize(), px = (e.clientX - r.left) / k, py = (e.clientY - r.top) / k;
    ED.fitted = null; ED.panX = s.w / 2 - px * ED.zoom; ED.panY = s.h / 2 - py * ED.zoom; ED.render(); ED.renderOvl(); ED.emit("view");
  }
  var soon = S3.debounce(function () { rebuild(); draw(); }, 200);
  var P = WS.panel({ id: "navigator", title: "Navigator", open: false,
    build: function (body) {
      cv = h("canvas", { "class": "ws-nav", "aria-label": "Navigator: drag to scroll the image" });
      cv.addEventListener("pointerdown", function (e) { if (!ED.doc) return; cv.setPointerCapture(e.pointerId); centerAt(e); cv._drag = true; });
      cv.addEventListener("pointermove", function (e) { if (cv._drag) centerAt(e); });
      cv.addEventListener("pointerup", function () { cv._drag = false; });
      zr = h("input", { type: "range", min: "-664", max: "500", step: "1", value: "0", "aria-label": "Zoom" });
      zr.addEventListener("input", function () { if (ED.doc) ED.zoomAt(Math.pow(2, +zr.value / 100)); });
      zt = h("input", { type: "number", "class": "input", min: "1", max: "3200", step: "any", "aria-label": "Zoom percent" });
      zt.addEventListener("change", function () { if (ED.doc && +zt.value > 0) ED.zoomAt(PE.clamp(+zt.value, 2, 3200) / 100); });
      var zo = ED.ui.w.btn("", function () { if (ED.doc) ED.zoomStep(-1); }, "ghost icon", "t-zout", "Zoom out"), zi = ED.ui.w.btn("", function () { if (ED.doc) ED.zoomStep(1); }, "ghost icon", "t-zin", "Zoom in");
      body.appendChild(h("div", { "class": "ws-navbox" }, [cv]));
      body.appendChild(h("div", { "class": "ws-navz" }, [zt, h("span", { "class": "faint", text: "%" }), zo, zr, zi]));
    },
    update: function (why) {
      if (why === "cursor") return;
      var d = ED.doc, v = d ? d.id + ":" + (ED.hist ? ED.hist.pos + ":" + ED.hist.list.length : "") + ":" + d.w + "x" + d.h : "";
      if (why !== "view" && why !== "tool") { if (v !== thumbVer || why === "open" || why === "init" || why === "layers") { thumbVer = v; soon(); } }
      draw();
    } });
  WS.navigator = { panel: P, rebuild: rebuild };
})();
