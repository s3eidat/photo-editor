/* Adjust lane: on-canvas handles for the live panels (blur gallery band / ellipse / pins, centres of radial
   blur, spin blur, lens flare and lighting). A transparent canvas over the stage draws the guides; dragging a handle
   updates the panel's settings (st.set), which re-runs the preview. Wheel zoom still reaches the stage. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, AUI = PE.adjUI, h = S3.h;
  var HIT = 11;

  AUI.handles = function (st, make) {
    var stage = ED.stage, c = h("canvas", { "class": "pe-ahandles", "aria-hidden": "true" }), x = c.getContext("2d"), model = make(st), drag = null, raf = 0, lastKey = "", dpr = 1;
    stage.appendChild(c);
    function size() {
      var r = stage.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
      var W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; c.style.width = r.width + "px"; c.style.height = r.height + "px"; }
    }
    var api = {
      st: st, p: st.p, r: st.t.r,
      // layer-percent <-> document coordinates
      toDoc: function (px, py) { return { x: st.t.r.x + px / 100 * st.t.r.w, y: st.t.r.y + py / 100 * st.t.r.h }; },
      toPct: function (dx, dy) { return { x: (dx - st.t.r.x) / st.t.r.w * 100, y: (dy - st.t.r.y) / st.t.r.h * 100 }; },
      scr: function (dx, dy) { return ED.toScr(dx, dy); },
      zoom: function () { return ED.zoom; }
    };
    function paint() {
      raf = requestAnimationFrame(paint);
      var key = [ED.zoom, ED.panX, ED.panY, stage.clientWidth, stage.clientHeight, JSON.stringify(st.p), drag ? 1 : 0].join("|");
      if (key === lastKey) return;
      lastKey = key; size();
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, c.width, c.height);
      x.lineWidth = 1.5; x.strokeStyle = "rgba(255,255,255,.95)"; x.fillStyle = "rgba(255,255,255,.95)"; x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 3;
      if (model.draw && ED.doc) {     // guides stay inside the document
        var a0 = ED.toScr(0, 0), a1 = ED.toScr(ED.doc.w, ED.doc.h);
        x.save(); x.beginPath(); x.rect(a0.x, a0.y, a1.x - a0.x, a1.y - a0.y); x.clip(); model.draw(x, api); x.restore();
      }
      (model.handles || []).forEach(function (hd) { var q = hd.at(api); dot(x, q.x, q.y, hd.big ? 7 : 5, hd === (drag && drag.h)); });
    }
    function dot(ctx, sx, sy, r, on) { ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fillStyle = on ? "#3dd6d0" : "#fff"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.stroke(); }
    function local(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function hit(s) {
      var best = null, bd = HIT;
      (model.handles || []).forEach(function (hd) { var q = hd.at(api), dd = Math.hypot(q.x - s.x, q.y - s.y); if (dd <= bd) { bd = dd; best = hd; } });
      return best;
    }
    c.addEventListener("pointerdown", function (e) {
      var s = local(e), hd = hit(s);
      if (!hd && model.click) { var d0 = ED.toDoc(s.x, s.y); if (model.click(api, d0, e) !== false) { e.stopPropagation(); e.preventDefault(); } return; }
      if (!hd) return;
      e.stopPropagation(); e.preventDefault();
      drag = { h: hd }; try { c.setPointerCapture(e.pointerId); } catch (er) { /* fine */ }
    });
    c.addEventListener("pointermove", function (e) {
      var s = local(e);
      if (!drag) { c.style.cursor = hit(s) ? "grab" : model.click ? "copy" : ""; return; }
      c.style.cursor = "grabbing";
      var d0 = ED.toDoc(s.x, s.y); drag.h.move(api, d0, e);
    });
    function up() { if (drag) { drag = null; lastKey = ""; } }
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    c.addEventListener("dblclick", function (e) { var s = local(e), hd = hit(s); if (hd && hd.dbl) { e.stopPropagation(); hd.dbl(api); } });
    paint();
    AUI.onPanelClose(function () { cancelAnimationFrame(raf); c.remove(); });
    return api;
  };

  // ---------- models ----------
  function clampPct(v) { return Math.max(-50, Math.min(150, v)); }
  // A movable point stored as percentages in p[kx], p[ky].
  function centre(kx, ky, big) {
    return { big: big, at: function (a) { var d = a.toDoc(a.p[kx], a.p[ky]); return a.scr(d.x, d.y); },
      move: function (a, d) { var q = a.toPct(d.x, d.y); a.st.set(kx, Math.round(clampPct(q.x) * 10) / 10); a.st.set(ky, Math.round(clampPct(q.y) * 10) / 10); } };
  }
  function line(ctx, p0, p1, dash) { ctx.save(); if (dash) ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.restore(); }
  function ellipse(ctx, c0, rx, ry, rot, dash) { ctx.save(); if (dash) ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.ellipse(c0.x, c0.y, Math.max(1, rx), Math.max(1, ry), rot, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  var H = AUI.H = {};
  H.point = function (kx, ky) { return function () { return { handles: [centre(kx, ky, true)], draw: function (ctx, a) { var d = a.toDoc(a.p[kx], a.p[ky]), s = a.scr(d.x, d.y); line(ctx, { x: s.x - 14, y: s.y }, { x: s.x + 14, y: s.y }); line(ctx, { x: s.x, y: s.y - 14 }, { x: s.x, y: s.y + 14 }); } }; }; };
  // tilt-shift: centre line through (cx, cy) at `angle`; solid lines = sharp band (focus), dashed = end of the fade.
  H.tilt = function () {
    function geo(a) {
      var p = a.p, c0 = a.toDoc(p.cx, p.cy), ang = (p.angle || 0) * Math.PI / 180, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux, hh = a.r.h;
      return { c: c0, ux: ux, uy: uy, nx: nx, ny: ny, f: p.focus / 100 * hh, t: (p.focus + p.transition) / 100 * hh, L: Math.hypot(a.r.w, a.r.h) };
    }
    function at(g, off, along) { return { x: g.c.x + g.nx * off + g.ux * along, y: g.c.y + g.ny * off + g.uy * along }; }
    return {
      draw: function (ctx, a) {
        var g = geo(a), S = function (q) { return a.scr(q.x, q.y); };
        line(ctx, S(at(g, 0, -g.L)), S(at(g, 0, g.L)));
        [g.f, -g.f].forEach(function (o) { line(ctx, S(at(g, o, -g.L)), S(at(g, o, g.L))); });
        [g.t, -g.t].forEach(function (o) { line(ctx, S(at(g, o, -g.L)), S(at(g, o, g.L)), true); });
      },
      handles: [centre("cx", "cy", true),
        { at: function (a) { var g = geo(a), q = at(g, 0, Math.min(a.r.w, a.r.h) * 0.25); return a.scr(q.x, q.y); },
          move: function (a, d) { var g = geo(a), ang = Math.atan2(d.y - g.c.y, d.x - g.c.x) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180; a.st.set("angle", Math.round(ang)); } },
        { at: function (a) { var g = geo(a), q = at(g, g.f, 0); return a.scr(q.x, q.y); },
          move: function (a, d) { var g = geo(a), off = Math.abs((d.x - g.c.x) * g.nx + (d.y - g.c.y) * g.ny); a.st.set("focus", Math.max(0, Math.min(100, Math.round(off / a.r.h * 1000) / 10))); } },
        { at: function (a) { var g = geo(a), q = at(g, g.t, 0); return a.scr(q.x, q.y); },
          move: function (a, d) { var g = geo(a), off = Math.abs((d.x - g.c.x) * g.nx + (d.y - g.c.y) * g.ny); a.st.set("transition", Math.max(1, Math.min(100, Math.round((off - g.f) / a.r.h * 1000) / 10))); } }]
    };
  };
  // iris: ellipse with width / height handles on its axes, a rotation knob, and the dashed inner "sharp" ellipse.
  H.iris = function () {
    function geo(a) { var p = a.p, c0 = a.toDoc(p.cx, p.cy), rot = (p.rotation || 0) * Math.PI / 180; return { c: c0, rx: p.rx / 100 * a.r.w, ry: p.ry / 100 * a.r.h, rot: rot, cr: Math.cos(rot), sr: Math.sin(rot), sh: (p.sharp || 0) / 100 }; }
    function pt(g, u, v) { return { x: g.c.x + u * g.cr - v * g.sr, y: g.c.y + u * g.sr + v * g.cr }; }
    function local(g, d) { var dx = d.x - g.c.x, dy = d.y - g.c.y; return { u: dx * g.cr + dy * g.sr, v: -dx * g.sr + dy * g.cr }; }
    return {
      draw: function (ctx, a) { var g = geo(a), s = a.scr(g.c.x, g.c.y), z = a.zoom(); ellipse(ctx, s, g.rx * z, g.ry * z, g.rot); ellipse(ctx, s, g.rx * g.sh * z, g.ry * g.sh * z, g.rot, true); },
      handles: [centre("cx", "cy", true),
        { at: function (a) { var g = geo(a), q = pt(g, g.rx, 0); return a.scr(q.x, q.y); }, move: function (a, d) { var g = geo(a), l = local(g, d); a.st.set("rx", Math.max(1, Math.min(150, Math.round(Math.abs(l.u) / a.r.w * 1000) / 10))); } },
        { at: function (a) { var g = geo(a), q = pt(g, 0, g.ry); return a.scr(q.x, q.y); }, move: function (a, d) { var g = geo(a), l = local(g, d); a.st.set("ry", Math.max(1, Math.min(150, Math.round(Math.abs(l.v) / a.r.h * 1000) / 10))); } },
        { at: function (a) { var g = geo(a), q = pt(g, g.rx * 0.7071 + 14 / a.zoom(), -g.ry * 0.7071 - 14 / a.zoom()); return a.scr(q.x, q.y); },
          move: function (a, d) { var g = geo(a), ang = Math.atan2(d.y - g.c.y, d.x - g.c.x) + Math.atan2(g.ry, g.rx); a.st.set("rotation", Math.round(((ang * 180 / Math.PI + 540) % 360) - 180)); } },
        { at: function (a) { var g = geo(a), q = pt(g, g.rx * g.sh, 0); return a.scr(q.x, q.y); }, move: function (a, d) { var g = geo(a), l = local(g, d); a.st.set("sharp", Math.max(0, Math.min(99, Math.round(Math.abs(l.u) / Math.max(1, g.rx) * 100)))); } }]
    };
  };
  // field blur: each pin draggable; click empty space to add a pin, double-click a pin to remove it.
  H.field = function (st) {
    var model = {
      handles: [],
      draw: function (ctx, a) {
        sync(a);
        ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "left";
        a.p.pins.forEach(function (pin) { var d = a.toDoc(pin[0], pin[1]), s = a.scr(d.x, d.y); ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = "#fff"; ctx.fillText(Math.round(pin[2]) + " px", s.x + 16, s.y + 4); });
      },
      click: function (a, d) {
        if (a.p.pins.length >= 32) return false;
        var q = a.toPct(d.x, d.y); a.p.pins.push([Math.round(q.x), Math.round(q.y), 15]); if (st.redrawPins) st.redrawPins(); st.schedule();
      }
    };
    function sync() {
      model.handles = st.p.pins.map(function (pin, i) {
        return { big: true, at: function (a) { var d = a.toDoc(pin[0], pin[1]); return a.scr(d.x, d.y); },
          move: function (a, d) { var q = a.toPct(d.x, d.y); pin[0] = Math.round(clampPct(q.x)); pin[1] = Math.round(clampPct(q.y)); if (st.redrawPins) st.redrawPins(); st.schedule(); },
          dbl: function () { if (st.p.pins.length > 1) { st.p.pins.splice(i, 1); if (st.redrawPins) st.redrawPins(); st.schedule(); } } };
      });
    }
    sync();
    return model;
  };
  // a centre plus a radius ring (spin blur: size as % of width; lighting: spread).
  H.ring = function (kx, ky, kr, ofW) {
    return function () {
      function rad(a) { return a.p[kr] / 100 * (ofW ? a.r.w : Math.max(a.r.w, a.r.h)); }
      return {
        draw: function (ctx, a) { var d = a.toDoc(a.p[kx], a.p[ky]), s = a.scr(d.x, d.y), z = a.zoom(), ry = kr === "size" && a.p.aspect ? a.p.aspect / 100 : 1; ellipse(ctx, s, rad(a) * z, rad(a) * z * ry, 0, true); },
        handles: [centre(kx, ky, true), { at: function (a) { var d = a.toDoc(a.p[kx], a.p[ky]); return a.scr(d.x + rad(a), d.y); },
          move: function (a, d) { var c0 = a.toDoc(a.p[kx], a.p[ky]), base = ofW ? a.r.w : Math.max(a.r.w, a.r.h); a.st.set(kr, Math.max(1, Math.min(200, Math.round(Math.abs(d.x - c0.x) / base * 1000) / 10))); } }]
      };
    };
  };
})();
