/* Photo Editor paint lane: tools that change the pixels under the tip, on the brush engine.
   Coverage tools (dodge, burn, sponge; later colour replacement and the background eraser) build up a stroke
   coverage and blend the original towards an effect, so going over the same spot in one stroke does not keep
   compounding. Running tools (blur, sharpen, smudge; later the mixer) change a working copy dab by dab.
   Both preview only the changed rectangle and commit through the core's tile diffs (undo / redo). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX, K = ED.ui.kit, RAD = Math.PI / 180, T = 64;

  PP.icons({
    "t-dodge": [["circle", { cx: "9", cy: "9", r: "5.5" }], "M13 13l7 7"],
    "t-burn": ["M5 13.5a5.5 5.5 0 0 0 11 0", "M5 13.5c0-1.2 2.5-2.2 5.5-2.2s5.5 1 5.5 2.2", "M10.5 11.3V3.5"],
    "t-sponge": ["M5 7.5c0-2 2-3.5 7-3.5s7 1.5 7 3.5v9c0 2-2 3.5-7 3.5s-7-1.5-7-3.5z", ["circle", { cx: "9.5", cy: "9.5", r: "1.2" }], ["circle", { cx: "14.5", cy: "12", r: "1.4" }], ["circle", { cx: "10", cy: "15", r: "1" }]],
    "t-blurtool": ["M12 3.5c3 4.2 6 7.3 6 10.5a6 6 0 0 1-12 0c0-3.2 3-6.3 6-10.5z"],
    "t-sharpentool": ["M12 3l5.5 15h-11z"],
    "t-smudge": ["M9 21v-6.5l-2.4-3.2a1.3 1.3 0 0 1 2-1.6L10 11V4.3a1.3 1.3 0 0 1 2.6 0V10V8.8a1.3 1.3 0 0 1 2.6 0v2.4-1a1.3 1.3 0 0 1 2.6 0V15c0 2.5-1 4-2.3 6"]
  });

  // ---------- dab iteration with the tip's falloff and the selection ----------
  // Calls fn(i, w) for every pixel of the dab with weight w in (0, 1]. Returns the dab rect (holder coords).
  function dabEach(st, x, y, d, ang, rnd, a, fn) {
    var r = Math.max(0.5, d / 2), x0 = Math.max(0, Math.floor(x - r)), y0 = Math.max(0, Math.floor(y - r)), x1 = Math.min(st.w - 1, Math.ceil(x + r)), y1 = Math.min(st.h - 1, Math.ceil(y + r));
    if (x1 < x0 || y1 < y0) return null;
    ensure(st, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    var hard = PE.clamp(st.o.hard, 0, 1), rh = r * hard, ca = Math.cos(-ang * RAD), sa = Math.sin(-ang * RAD), ry = Math.max(0.01, rnd), sel = st.sel, W = st.w;
    for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) {
      var ux = xx + 0.5 - x, uy = yy + 0.5 - y, vx = ux * ca - uy * sa, vy = (ux * sa + uy * ca) / ry, dd = Math.sqrt(vx * vx + vy * vy), w;
      if (hard >= 0.99) w = PE.clamp(r - dd + 0.5, 0, 1); else w = dd <= rh ? 1 : dd >= r ? 0 : (r - dd) / (r - rh);
      if (w <= 0) continue;
      w *= a;
      if (sel) { var sx = xx + st.ox, sy = yy + st.oy; w *= sx >= 0 && sy >= 0 && sx < sel.w && sy < sel.h ? sel.m[sy * sel.w + sx] / 255 : 0; if (w <= 0) continue; }
      fn(yy * W + xx, w);
    }
    var b = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    st.bbox = PE.union(st.bbox, b); st.dirty = PE.union(st.dirty, b);
    return b;
  }
  PP.dabEach = dabEach;

  // The working pixels are read lazily, 128 px tiles at a time, and the preview is written straight into the
  // layer; the original tiles make the undo step (and restore the layer if the stroke is cancelled).
  var LT = 128;
  function beginCommon(st, keepOrig) {
    var W = st.w, H = st.h;
    st.cv = st.holder.canvas; st.cx = PE.cx2(st.cv); st.sel = ED.doc.sel; st.dirty = null;
    st.img = new ImageData(W, H); st.orig = keepOrig ? new ImageData(W, H) : st.img;
    st.ltx = Math.ceil(W / LT); st.loaded = new Uint8Array(st.ltx * Math.ceil(H / LT));
  }
  function ensure(st, R) {
    var tx0 = Math.max(0, Math.floor(R.x / LT)), ty0 = Math.max(0, Math.floor(R.y / LT)), tx1 = Math.min(st.ltx - 1, Math.floor((R.x + R.w - 1) / LT)), ty1 = Math.min(Math.ceil(st.h / LT) - 1, Math.floor((R.y + R.h - 1) / LT));
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) {
      var k = ty * st.ltx + tx; if (st.loaded[k]) continue;
      st.loaded[k] = 1;
      var x = tx * LT, y = ty * LT, w = Math.min(LT, st.w - x), h = Math.min(LT, st.h - y), t = st.cx.getImageData(x, y, w, h).data;
      for (var j = 0; j < h; j++) {
        var row = t.subarray(j * w * 4, (j + 1) * w * 4), at = ((y + j) * st.w + x) * 4;
        st.img.data.set(row, at); if (st.orig !== st.img) st.orig.data.set(row, at);
      }
    }
  }
  PP.ensureTiles = ensure;
  function region(img, R) {      // copy of rect R of a full-size ImageData
    var out = new ImageData(R.w, R.h), W = img.width;
    for (var j = 0; j < R.h; j++) out.data.set(img.data.subarray(((R.y + j) * W + R.x) * 4, ((R.y + j) * W + R.x + R.w) * 4), j * R.w * 4);
    return out;
  }
  function clipR(st, r) { return r && PE.inter(PE.rectI(r), { x: 0, y: 0, w: st.w, h: st.h }); }
  // commit: write the final pixels of bb, then record only the changed tiles against the originals
  function finish(st, label, write) {
    var bb = clipR(st, st.bbox);
    ED.stroke = null;
    if (!bb) { ED.push(st.grow); ED.changed(); return; }
    ensure(st, bb); write(bb);
    var e = PE.tileEntry(label, st.cv, bb, region(st.orig, bb));
    PE.touch(st.cv); ED.push(PE.compound(label, [st.grow, e]));
  }
  function cancel(st) { var bb = clipR(st, st.bbox); if (bb) { ensure(st, bb); st.cx.putImageData(st.orig, 0, 0, bb.x, bb.y, bb.w, bb.h); PE.touch(st.cv); ED.render(); } }
  // ---------- coverage tools ----------
  function covTile(st, i, make) {
    var x = i % st.w, y = (i - x) / st.w, ti = Math.floor(y / T) * st.tx + Math.floor(x / T), t = st.cov[ti];
    if (!t && make) t = st.cov[ti] = new Float32Array(T * T);
    return t ? { t: t, j: (y % T) * T + (x % T) } : null;
  }
  function covGet(st, i) { var c = covTile(st, i, false); return c ? c.t[c.j] : 0; }
  // Render rect R of the result (orig blended towards the effect by coverage) into an ImageData.
  function covRender(st, R) {
    ensure(st, R);
    var out = new ImageData(R.w, R.h), o = out.data, s = st.img.data, W = st.w, k = st.strength, eff = st.spec.effect, px = [0, 0, 0, 0];
    for (var y = 0; y < R.h; y++) for (var x = 0; x < R.w; x++) {
      var i = (y + R.y) * W + x + R.x, q = i * 4, oq = (y * R.w + x) * 4, c = covGet(st, i) * k;
      if (c <= 0) { o[oq] = s[q]; o[oq + 1] = s[q + 1]; o[oq + 2] = s[q + 2]; o[oq + 3] = s[q + 3]; continue; }
      px[0] = s[q]; px[1] = s[q + 1]; px[2] = s[q + 2]; px[3] = s[q + 3];
      var e = eff(st, px, i);
      o[oq] = s[q] + (e[0] - s[q]) * c; o[oq + 1] = s[q + 1] + (e[1] - s[q + 1]) * c; o[oq + 2] = s[q + 2] + (e[2] - s[q + 2]) * c; o[oq + 3] = s[q + 3] + (e[3] - s[q + 3]) * c;
    }
    return out;
  }
  PP.covRender = covRender;
  function covTool(id, spec, defs) {
    spec.process = true; spec.mode = "cov";
    spec.begin = (function (inner) {
      return function (st, p, e) {
        beginCommon(st); st.tx = Math.ceil(st.w / T); st.cov = new Array(st.tx * Math.ceil(st.h / T)); st.strength = PE.clamp(st.o.op, 0, 1);
        return inner ? inner(st, p, e) : true;
      };
    })(spec.begin);
    spec.stamp = function (st, x, y, d, ang, rnd, flip, col, a) {
      var cond = spec.weight;
      if (spec.perDab) spec.perDab(st, x, y);
      dabEach(st, x, y, d, ang, rnd, a, function (i, w) {
        if (cond) { w *= cond(st, i); if (w <= 0) return; }
        var c = covTile(st, i, true); c.t[c.j] += w * (1 - c.t[c.j]);
      });
    };
    spec.preview = function (st) {
      var R = clipR(st, st.dirty); st.dirty = null;
      if (R) { st.cx.putImageData(covRender(st, R), R.x, R.y); PE.touch(st.cv); }
      return null;
    };
    spec.commit = function (st, label) { finish(st, label, function (bb) { st.cx.putImageData(covRender(st, bb), bb.x, bb.y); }); };
    spec.cancel = cancel;
    PP.engineTool(id, spec, Object.assign({ spacing: 15, sizeC: "off" }, defs || {}));
  }
  PP.covTool = covTool;
  // ---------- running tools ----------
  function runTool(id, spec, defs) {
    spec.process = true; spec.mode = "run";
    spec.begin = (function (inner) { return function (st, p, e) { beginCommon(st, true); st.strength = PE.clamp(st.o.op, 0, 1); return inner ? inner(st, p, e) : true; }; })(spec.begin);
    spec.preview = function (st) {
      var R = clipR(st, st.dirty); st.dirty = null;
      if (R) { st.cx.putImageData(st.img, 0, 0, R.x, R.y, R.w, R.h); PE.touch(st.cv); }
      return null;
    };
    spec.commit = function (st, label) { finish(st, label, function (bb) { st.cx.putImageData(st.img, 0, 0, bb.x, bb.y, bb.w, bb.h); }); };
    spec.cancel = cancel;
    PP.engineTool(id, spec, Object.assign({ sizeC: "off" }, defs || {}));
  }
  PP.runTool = runTool;

  // ---------- dodge / burn (tone maths in pmath) ----------
  function toneEffect(kind) {
    return function (st, px) {
      if (st.mask) { var v = PPX.tone(kind, st.o.range, px[3] / 255); return [255, 255, 255, v * 255]; }
      var o = PPX.toneRGB(kind, st.o.range, st.o.protect, px[0], px[1], px[2]); return [o[0], o[1], o[2], px[3]];
    };
  }
  covTool("dodge", { label: "Dodge", fill: "color", mask: "gray", effect: toneEffect("dodge") }, { range: "mid", protect: true, op: 0.5, hard: 0.3, size: 80 });
  covTool("burn", { label: "Burn", fill: "color", mask: "gray", effect: toneEffect("burn") }, { range: "mid", protect: true, op: 0.5, hard: 0.3, size: 80 });
  covTool("sponge", { label: "Sponge", fill: "color", mask: false, effect: function (st, px) { var o = PPX.sponge(st.o.smode, st.o.vib, px[0], px[1], px[2]); return [o[0], o[1], o[2], px[3]]; } },
    { smode: "desat", vib: true, op: 0.5, hard: 0.3, size: 80 });
  PP.addTool("dodge", "Dodge", "O", "bucket", ED.TOOLS.dodge);
  PP.addTool("burn", "Burn", "O", "dodge", ED.TOOLS.burn);
  PP.addTool("sponge", "Sponge", "O", "burn", ED.TOOLS.sponge);
  PP.group("O", ["dodge", "burn", "sponge"]);
  var RANGES = [["shadows", "Shadows"], ["mid", "Midtones"], ["highlights", "Highlights"]];
  ["dodge", "burn"].forEach(function (t) {
    PP.optsFor[t] = function (items) {
      var o = ED.o[t];
      return PP.brushBar(t, items, [K.select("Range", RANGES, o.range, function (v) { o.range = v; ED.saveOpts(); }), K.check("Protect tones", o.protect, function (v) { o.protect = v; ED.saveOpts(); })],
        (t === "dodge" ? "Brightens" : "Darkens") + " the tones you paint over. Release and paint again to build it up. Alt switches to " + (t === "dodge" ? "burn" : "dodge") + ".", { opLabel: "Exposure", noFlow: true, noSym: true });
    };
  });
  PP.optsFor.sponge = function (items) {
    var o = ED.o.sponge;
    return PP.brushBar("sponge", items, [K.seg("Mode", [["desat", "Desaturate"], ["sat", "Saturate"]], o.smode, function (v) { o.smode = v; ED.saveOpts(); }), K.check("Vibrance", o.vib, function (v) { o.vib = v; ED.saveOpts(); })],
      "Soaks up or adds colour where you paint.", { opLabel: "Flow", noFlow: true, noSym: true });
  };
  // Alt held at the start of a dodge stroke burns (and the other way round)
  ["dodge", "burn"].forEach(function (t) {
    var spec = PP.spec[t], inner = spec.begin;
    spec.begin = function (st, p, e) { if (e && e.altKey) st.spec = PP.spec[t === "dodge" ? "burn" : "dodge"]; return inner(st, p, e); };
  });

  PP.shortcut("Retouch tools", "O dodge / burn / sponge · J spot healing / healing (Shift+key cycles)");
})();
