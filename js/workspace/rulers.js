/* Workspace (files lane): rulers along the top and left of the canvas (any unit, follows zoom and pan, shows the
   pointer position) and dragging new guides out of them. Click the corner square to change units. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, h = S3.h;
  var R = WS.rulers = {}, SZ = 20;
  var top, left, corner, cur = null;

  function steps(z) {     // major tick spacing in units: smallest "nice" value at least 60 screen px apart
    var u = WS.p.units, pxPerUnit = WS.fromUnit(1, u, "x") * z, nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
    if (u === "in" || u === "cm" || u === "pc") nice = [0.125, 0.25, 0.5].concat(nice); else if (u === "mm" || u === "pt") nice = [0.5].concat(nice); else if (u === "%") nice = [1, 2, 5, 10, 25, 50, 100];
    for (var i = 0; i < nice.length; i++) if (nice[i] * pxPerUnit >= 60) return nice[i];
    return nice[nice.length - 1];
  }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function paint(cv, axis) {
    var d = ED.doc, r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    var c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = css("--surface-2") || "#eee"; c.fillRect(0, 0, r.width, r.height);
    c.strokeStyle = css("--line-strong") || "#999"; c.fillStyle = css("--text-3") || "#666"; c.lineWidth = 1; c.font = "10px " + (css("--mono") || "monospace");
    c.beginPath(); if (axis === "x") { c.moveTo(0, SZ - 0.5); c.lineTo(r.width, SZ - 0.5); } else { c.moveTo(SZ - 0.5, 0); c.lineTo(SZ - 0.5, r.height); } c.stroke();
    if (!d) return;
    var z = ED.zoom, u = WS.p.units, step = steps(z), uPx = WS.fromUnit(1, u, axis) , len = axis === "x" ? r.width : r.height, off = axis === "x" ? ED.panX - SZ : ED.panY - SZ;
    var sub = step >= 10 ? 10 : step >= 2 ? (step % 5 === 0 ? 5 : 4) : 4, first = Math.floor((-off / z) / uPx / step) - 1, last = Math.ceil(((len - off) / z) / uPx / step) + 1;
    c.beginPath();
    for (var i = first; i <= last; i++) {
      for (var k = 0; k < sub; k++) {
        var v = (i + k / sub) * step, sp = off + v * uPx * z + 0.5, tick = k === 0 ? SZ : k === sub / 2 ? 7 : 4;
        if (sp < -2 || sp > len + 2) continue;
        if (axis === "x") { c.moveTo(sp, SZ); c.lineTo(sp, SZ - tick); } else { c.moveTo(SZ, sp); c.lineTo(SZ - tick, sp); }
        if (k === 0) {
          var lab = String(Math.round(v * 1000) / 1000);
          if (axis === "x") c.fillText(lab, sp + 3, 10);
          else { c.save(); c.translate(10, sp + 3); c.rotate(-Math.PI / 2); c.textAlign = "right"; c.fillText(lab, 0, 0); c.restore(); }
        }
      }
    }
    c.stroke();
    if (cur) {      // pointer position
      var p = axis === "x" ? cur.x * z + ED.panX - SZ : cur.y * z + ED.panY - SZ;
      c.strokeStyle = css("--accent") || "#08c"; c.beginPath();
      if (axis === "x") { c.moveTo(p + 0.5, 0); c.lineTo(p + 0.5, SZ); } else { c.moveTo(0, p + 0.5); c.lineTo(SZ, p + 0.5); }
      c.stroke();
    }
  }
  var raf = 0;
  R.render = function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; if (!top || top.hidden) return; paint(top, "x"); paint(left, "y"); corner.title = "Units: " + (WS.UNITS.filter(function (x) { return x[0] === WS.p.units; })[0] || ["", "Pixels"])[1] + " (click to change)"; corner.textContent = WS.p.units; }); };
  function show() {
    var on = !!(WS.p.rulers && ED.doc);
    [top, left, corner].forEach(function (el) { el.hidden = !on; });
    document.getElementById("stage").classList.toggle("ws-rulers", on);
    R.render();
  }
  R.show = show;

  // ---------- drag a guide out of a ruler ----------
  function dragFrom(axis, e) {
    if (!ED.doc || ED.modal) return;
    e.preventDefault(); e.stopPropagation();
    if (!WS.p.guides) WS.set("guides", true);
    var stage = document.getElementById("stage"), dir = axis === "x" ? "h" : "v";
    if (e.altKey) dir = dir === "h" ? "v" : "h";
    var g = { dir: dir, pos: 0 }, sr = stage.getBoundingClientRect();
    function at(ev) {
      var s = { x: ev.clientX - sr.left, y: ev.clientY - sr.top }, p = ED.toDoc(s.x, s.y), v = g.dir === "h" ? p.y : p.x;
      if (ev.shiftKey) { var u = WS.p.units, st = steps(ED.zoom) / 10, uv = WS.toUnit(v, u, g.dir === "h" ? "y" : "x"); v = WS.fromUnit(Math.round(uv / st) * st, u, g.dir === "h" ? "y" : "x"); }
      else if (WS.snap1) v = WS.snap1(v, g.dir === "h" ? "y" : "x");
      g.pos = Math.round(v * 1000) / 1000;
      g.out = g.dir === "h" ? s.y < SZ : s.x < SZ;
      WS.guides.dragging = g; ED.renderOvl(); R.render();
      ED.emit("view", { x: p.x, y: p.y });
    }
    function move(ev) { at(ev); }
    function up(ev) {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      WS.guides.dragging = null;
      if (ev.type === "pointerup") { at(ev); WS.guides.dragging = null; if (!g.out) WS.guides.add(g.dir, g.pos); }
      ED.renderOvl();
    }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    at(e);
  }

  R.init = function () {
    var stage = document.getElementById("stage");
    top = h("canvas", { "class": "ws-ruler ws-rx", "aria-hidden": "true", title: "Drag down to add a horizontal guide (Alt: vertical)" });
    left = h("canvas", { "class": "ws-ruler ws-ry", "aria-hidden": "true", title: "Drag right to add a vertical guide (Alt: horizontal)" });
    corner = h("button", { type: "button", "class": "ws-corner", "aria-label": "Ruler units" });
    stage.appendChild(top); stage.appendChild(left); stage.appendChild(corner);
    top.addEventListener("pointerdown", function (e) { dragFrom("x", e); });
    left.addEventListener("pointerdown", function (e) { dragFrom("y", e); });
    corner.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    corner.addEventListener("click", function (e) {
      e.stopPropagation();
      var i = WS.UNITS.map(function (x) { return x[0]; }).indexOf(WS.p.units); WS.set("units", WS.UNITS[(i + 1) % WS.UNITS.length][0]);
      S3.toast("Ruler units: " + WS.UNITS[(i + 1) % WS.UNITS.length][1]);
    });
    new ResizeObserver(R.render).observe(stage);
    ED.on("view", function (a) { if (a && typeof a === "object") cur = a; R.render(); });
    ED.on("changed", show); ED.on("ws", function () { show(); });
    stage.addEventListener("pointerleave", function () { cur = null; R.render(); });
    show();
  };
})();
