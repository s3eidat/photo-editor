/* Selection lane: smart layers and smart filters. A smart layer (kind "smart") keeps its original pixels
   (L.smart.src) plus a transform matrix (L.smart.m, source px -> document) and a list of filters; scaling,
   rotating, moving or cropping never resamples the source, and filters stay editable, can be hidden or removed. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, SX = PE.sx, h = S3.h;
  PE.kindsExt.push("smart");
  var QUICKF = { invert: "Invert", desaturate: "Desaturate", sharpen: "Sharpen" };
  function filterSpecs() {
    var out = [], A = ED.ADJ || {};
    Object.keys(A).forEach(function (k) { if (!A[k].custom) out.push([k, A[k].t]); });
    Object.keys(QUICKF).forEach(function (k) { out.push([k, QUICKF[k]]); });
    return out;
  }
  function ftitle(op) { return (ED.ADJ[op] && ED.ADJ[op].t) || QUICKF[op] || op; }
  function defaults(op) { var s = ED.ADJ[op], p = {}; if (s) { (s.c || []).forEach(function (c) { p[c.k] = c.def; }); (s.chk || []).forEach(function (c) { p[c[0]] = false; }); } return p; }

  // ---------- pixels ----------
  var CACHE = new WeakMap();
  function padFor(filters) { var p = 0; filters.forEach(function (f) { var r = +(f.p && f.p.radius) || 0; if (f.op === "blur" || f.op === "unsharp") p = Math.max(p, Math.ceil(r * 1.5) + 2); if (f.op === "sharpen") p = Math.max(p, 4); }); return Math.min(p, 600); }
  PE.surfaceExt.smart = function (L) {
    var S = L.smart; if (!S || !S.src) return { canvas: PE.mk(1, 1), x: 0, y: 0 };
    var fl = (S.filters || []).filter(function (f) { return f.on !== false; }), k1 = PE.ver(S.src) + ":" + S.src.width + "x" + S.src.height + ":" + S.m.join(","), k2 = k1 + JSON.stringify(fl), hit = CACHE.get(L) || {};
    if (hit.k2 === k2 && hit.out && hit.src === S.src) return hit.out;
    var baked = hit.k1 === k1 && hit.baked && hit.src === S.src ? hit.baked : null;
    if (!baked) { try { baked = PE.bake(S.src, 0, 0, S.m); } catch (e) { baked = { canvas: PE.mk(1, 1), x: 0, y: 0 }; } }
    var out = baked;
    if (fl.length) {
      var pad = padFor(fl), c = PE.mk(baked.canvas.width + 2 * pad, baked.canvas.height + 2 * pad), x = PE.cx2(c);
      x.drawImage(baked.canvas, pad, pad);
      var img = x.getImageData(0, 0, c.width, c.height), im = { data: img.data, width: c.width, height: c.height };
      fl.forEach(function (f) { try { PIX.adjust(im, f.op, f.p || {}); } catch (e) { /* unknown filter from a newer file */ } });
      x.putImageData(img, 0, 0);
      out = { canvas: PE.touch(c), x: baked.x - pad, y: baked.y - pad };
    }
    CACHE.set(L, { k1: k1, baked: baked, k2: k2, out: out, src: S.src });
    return out;
  };
  function decompose(m) { var sx = Math.hypot(m[0], m[1]), det = m[0] * m[3] - m[1] * m[2]; return { rot: Math.atan2(m[1], m[0]) * 180 / Math.PI, sx: sx, sy: sx ? det / sx : 0 }; }
  SX.smartInfo = decompose;
  PE.vboxExt.smart = function (L) {
    var S = L.smart, k = decompose(S.m), c = PE.mApply(S.m, S.src.width / 2, S.src.height / 2), w = S.src.width * k.sx, hh = S.src.height * Math.abs(k.sy);
    return { x: c.x - w / 2, y: c.y - hh / 2, w: w, h: hh, rot: k.rot, fx: false, fy: k.sy < 0 };
  };
  PE.xfExt.smart = function (L, m) { L.smart = Object.assign({}, L.smart, { m: PE.mMul(m, L.smart.m) }); };
  PE.offsetExt = (function (prev) { return function (L, dx, dy) { if (prev) prev(L, dx, dy); if (L.kind === "smart" && L.smart) { var m = L.smart.m.slice(); m[4] += dx; m[5] += dy; L.smart = Object.assign({}, L.smart, { m: m }); } }; })(PE.offsetExt);
  PE.scaleExt = (function (prev) { return function (L, kx, ky) { if (prev) prev(L, kx, ky); if (L.kind === "smart" && L.smart) L.smart = Object.assign({}, L.smart, { m: PE.mMul([kx, 0, 0, ky, 0, 0], L.smart.m) }); }; })(PE.scaleExt);
  // moving: the matrix carries the offset
  var shift0 = PE.shiftExt;
  PE.shiftExt = function (dr, dx, dy) {
    if (shift0) shift0(dr, dx, dy);
    var L = dr.L; if (L.kind !== "smart" || !L.smart) return;
    if (!dr._sm) dr._sm = L.smart.m.slice();
    var m = dr._sm.slice(); m[4] += dx; m[5] += dy; L.smart = Object.assign({}, L.smart, { m: m });
  };
  var more0 = SX.shiftMore;
  SX.shiftMore = function (k, o, dx, dy) { if (more0) more0(k, o, dx, dy); if (k.kind === "smart" && k.smart) { if (!o.sm) o.sm = k.smart.m.slice(); var m = o.sm.slice(); m[4] += dx; m[5] += dy; k.smart = Object.assign({}, k.smart, { m: m }); } };
  var mm0 = SX.moveMore;
  SX.moveMore = function (L, dx, dy) { if (mm0) mm0(L, dx, dy); if (L.kind === "smart" && L.smart) { var m = L.smart.m.slice(); m[4] += dx; m[5] += dy; L.smart = Object.assign({}, L.smart, { m: m }); } };
  var ed0 = PE.editableExt;
  PE.editableExt = function (L, need) {
    if (ed0 && !ed0(L, need)) return false;
    if (L.kind === "smart" && need === "pixels" && !(ED.maskEdit && L.mask)) { S3.toast("“" + L.name + "” is a smart layer: add filters in Properties (Smart filters) or rasterize it to paint", "error"); return false; }
    return true;
  };

  // ---------- converting ----------
  function cropped(c) { var b = PIX.alphaBounds(PE.getData(c)); if (!b) return null; var n = PE.mk(b.w, b.h); PE.cx2(n).drawImage(c, -b.x, -b.y); return { canvas: PE.touch(n), x: b.x, y: b.y }; }
  SX.toSmart = function () {
    if (!SX.need()) return;
    var d = ED.doc, list = SX.pickedList().filter(function (L) { return L.kind !== "adjust" && L.kind !== "qmask" && L.kind !== "channel"; });
    if (!list.length) return;
    if (list.length === 1 && list[0].kind === "smart") { S3.toast("That is already a smart layer"); return; }
    if (list.length === 1 && list[0].kind !== "group") {
      var L = list[0], s = PE.surface(L, d), cr = cropped(s.canvas);
      if (!cr) { S3.toast("This layer is empty", "error"); return; }
      ED.meta("Convert to smart layer", function () { L.kind = "smart"; L.smart = { src: cr.canvas, m: [1, 0, 0, 1, s.x + cr.x, s.y + cr.y], filters: [] }; L.canvas = null; L.text = null; L.shape = null; delete L.fillSpec; });
      ED.emit("layers"); return;
    }
    // several layers or a group: one smart layer from their combined pixels
    var ids = list.map(function (o) { return o.id; }), keep = list.map(function (o) { return { o: o, op: o.opacity, b: o.blend }; });
    var comp = PE.flatten(d, { only: ids }), cr2 = cropped(comp); void keep;
    if (!cr2) { S3.toast("Nothing to convert", "error"); return; }
    var t = SX.tree(d), gone = {}; list.forEach(function (o) { gone[o.id] = 1; if (o.kind === "group") SX.groupsApi.descendants(o, t).forEach(function (k) { gone[k.id] = 1; }); });
    var N = PE.newLayer("smart", { name: list[0].name }); N.canvas = null; N.parent = list[0].parent || null; N.smart = { src: cr2.canvas, m: [1, 0, 0, 1, cr2.x, cr2.y], filters: [] };
    ED.meta("Convert to smart layer", function () { var i = d.layers.indexOf(list[0]); d.layers[i] = N; d.layers = d.layers.filter(function (o) { return o === N || !gone[o.id]; }); d.active = N.id; ED.maskEdit = false; });
    SX.picked = {}; ED.emit("layers");
  };

  // ---------- Properties: transform info + smart filters ----------
  var pB = null, pT = 0;
  function edit(fn) { if (!pB) pB = PE.snap(ED.doc); fn(); ED.render(); clearTimeout(pT); pT = setTimeout(function () { var b = pB; pB = null; ED.push(PE.metaEntry("Smart filter", ED.doc, b)); }, 450); }
  function setFilters(L, fn) { var S = L.smart, f = PE.clone(S.filters || []); fn(f); L.smart = Object.assign({}, S, { filters: f }); }
  SX.props.smart = function (P, L) {
    var w = ED.ui.w, S = L.smart, k = decompose(S.m);
    P.appendChild(h("div", { "class": "pe-phead" }, [w.svg("t-smart"), h("b", { text: L.name }), h("span", { "class": "faint", text: "Smart layer" })]));
    P.appendChild(h("p", { "class": "faint pe-p", text: "Source " + S.src.width + " × " + S.src.height + " px, shown at " + Math.round(k.sx * 100) + "%" + (Math.abs(k.sy - k.sx) > 1e-3 ? " × " + Math.round(Math.abs(k.sy) * 100) + "%" : "") + (Math.abs(k.rot) > 0.05 ? ", rotated " + Math.round(k.rot * 10) / 10 + "°" : "") + ". Transforms never resample the source." }));
    P.appendChild(h("div", { "class": "pe-prow" }, [w.btn("Free transform", function () { ED.setTool("move"); ED.startTransform(); }, "ghost", "t-xf"),
      w.btn("Reset transform", function () { var c = PE.mApply(S.m, S.src.width / 2, S.src.height / 2); ED.meta("Reset transform", function () { L.smart = Object.assign({}, L.smart, { m: [1, 0, 0, 1, Math.round(c.x - S.src.width / 2), Math.round(c.y - S.src.height / 2)] }); }); }, "ghost"),
      w.btn("Rasterize", function () { ED.rasterize(L, true); }, "ghost")]));
    P.appendChild(h("div", { "class": "pe-prow" }, [w.btn("Replace contents…", function () { SX.pickSmartContents(L); }, "ghost", null, "Swap in another image: same place, transform and filters"),
      w.btn("Export contents", function () { SX.exportSmart(L); }, "ghost", null, "Save the source pixels as a PNG")]));
    P.appendChild(h("h3", { text: "Smart filters" }));
    var list = S.filters || [];
    if (!list.length) P.appendChild(h("p", { "class": "faint pe-p", text: "Filters added here stay editable: hide, change or remove them any time." }));
    list.forEach(function (f, i) {
      var spec = ED.ADJ[f.op], cb = h("input", { type: "checkbox", "aria-label": "Show " + ftitle(f.op) }); cb.checked = f.on !== false;
      cb.addEventListener("change", function () { ED.meta(cb.checked ? "Show smart filter" : "Hide smart filter", function () { setFilters(L, function (a) { a[i].on = cb.checked; }); }); });
      P.appendChild(h("div", { "class": "pe-fxhead open" }, [cb, h("span", { "class": "pe-fxname", text: ftitle(f.op) }),
        w.btn("", function () { ED.meta("Remove smart filter", function () { setFilters(L, function (a) { a.splice(i, 1); }); }); }, "ghost icon", "i-x", "Remove this filter")]));
      if (spec) {
        var sec = h("div", { "class": "pe-fxsec" });
        (spec.c || []).forEach(function (c) { sec.appendChild(w.range(c.label, f.p[c.k] == null ? c.def : f.p[c.k], c.min, c.max, c.step, function (v) { edit(function () { setFilters(L, function (a) { a[i].p[c.k] = v; }); }); }, c.fmt)); });
        (spec.chk || []).forEach(function (c) { sec.appendChild(w.check(c[1], !!f.p[c[0]], function (v) { edit(function () { setFilters(L, function (a) { a[i].p[c[0]] = v; }); }); })); });
        P.appendChild(sec);
      }
    });
    var add = h("select", { "class": "select", "aria-label": "Add a smart filter" }); add.appendChild(h("option", { value: "", text: "Add filter…" }));
    filterSpecs().forEach(function (s) { add.appendChild(h("option", { value: s[0], text: s[1] })); });
    add.addEventListener("change", function () { var op = add.value; if (!op) return; ED.meta("Add smart filter", function () { setFilters(L, function (a) { a.push({ op: op, p: defaults(op), on: true }); }); }); });
    P.appendChild(h("div", { "class": "pe-prow" }, [add]));
    SX.maskProps(P, L);
  };
  var meta0 = SX.metaMore;
  SX.metaMore = function (L, parts) { if (meta0) meta0(L, parts); if (L.kind === "smart") { var n = (L.smart.filters || []).length; parts.push("smart" + (n ? " · " + n + " filter" + (n > 1 ? "s" : "") : "")); } };
  SX.addIcons({ "t-smart": '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M14 20.5v-6.5h6.5"/><path d="M7.5 9.5 10 12l-2.5 2.5"/>' });

  // ---------- project files: the source rides in the layer's image slot ----------
  SX.fields.smart = {
    save: function (L, l, i, jobs, files) {
      if (L.kind !== "smart" || !L.smart) return undefined;
      l.src = "layers/" + i + ".png";
      jobs.push(PE.pngOf(L.smart.src).then(function (e) { files.push({ name: l.src, data: e.bytes, crc: e.crc }); }));
      return { m: L.smart.m.slice(), filters: PE.clone(L.smart.filters || []) };
    },
    parse: function (v, out, raw, i, ids) {
      if (out.kind !== "smart" || !v || typeof v !== "object" || !Array.isArray(v.m) || v.m.length !== 6) throw new Error("Layer " + (i + 1) + " has a bad smart layer");
      if (typeof raw.src !== "string" || !/^layers\/\d{1,3}\.png$/.test(raw.src) || ids[raw.src]) throw new Error("Layer " + (i + 1) + " has a bad image reference");
      ids[raw.src] = 1; out.src = raw.src;
      var m = v.m.map(function (x) { x = +x; return isFinite(x) ? Math.max(-1e5, Math.min(1e5, x)) : 0; });
      var filters = (Array.isArray(v.filters) ? v.filters : []).slice(0, 20).filter(function (f) { return f && typeof f.op === "string" && /^[A-Za-z]{1,30}$/.test(f.op); })
        .map(function (f) { var p = SX.cleanVal(f.p || {}, 0); return { op: f.op, p: p && !Array.isArray(p) ? p : {}, on: f.on !== false }; });
      return { m: m, filters: filters };
    },
    open: function (l, L, img, jobs) { L.smart = { src: PE.mk(1, 1), m: l.smart.m, filters: l.smart.filters }; jobs.push(img(l.src).then(function (c) { L.smart.src = c; L.canvas = null; })); }
  };
  // ---------- replace / export contents ----------
  // The new image fills the old source size (scaled to cover, centred), so the transform and filters still fit.
  SX.replaceSmart = function (L, img) {
    var S = L.smart, w = S.src.width, hh = S.src.height, c = PE.mk(w, hh), x = PE.cx2(c), k = Math.max(w / img.width, hh / img.height);
    x.imageSmoothingQuality = "high"; x.drawImage(img, (w - img.width * k) / 2, (hh - img.height * k) / 2, img.width * k, img.height * k);
    ED.meta("Replace contents", function () { L.smart = Object.assign({}, L.smart, { src: PE.touch(c) }); });
  };
  SX.pickSmartContents = function (L) {
    L = L || ED.layer(); if (!L || L.kind !== "smart") return;
    var inp = h("input", { type: "file", accept: "image/*", hidden: true });
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
      ED.working(PE.decodeImage(f), "Opening…").then(function (im) { SX.replaceSmart(L, im.canvas); S3.toast("Contents replaced: same place, transform and filters"); }).catch(function (e) { S3.toast(e.message, "error"); });
    });
    document.body.appendChild(inp); inp.click();
  };
  SX.exportSmart = function (L) {
    L = L || ED.layer(); if (!L || L.kind !== "smart") return;
    PE.toBlob(L.smart.src, "image/png").then(function (b) { S3.download(b, (L.name || "contents").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) + ".png"); }).catch(function (e) { S3.toast(e.message, "error"); });
  };
  function isSmart() { var L = ED.layer(); return !!(L && L.kind === "smart"); }
  SX.menu("Layer", [["Convert to smart layer", "", SX.toSmart, function () { var L = ED.layer(); return !!(L && L.kind !== "smart" && L.kind !== "adjust"); }]], "Rasterize layer");
  SX.menu("Layer", [["Replace smart layer contents…", "", function () { SX.pickSmartContents(); }, isSmart], ["Export smart layer contents", "", function () { SX.exportSmart(); }, isSmart]], "Convert to smart layer");

  SX.tests.push(async function (ok) {
    var a = PE.rasterFromCanvas(SX.solid(10, 10, "#ff0000"), "a", 5, 5), d = SX.scratch(30, 30, [a]); d.active = a.id;
    SX.toSmart(); var L = ED.layer(); ED.meta("Scale", function () { L.smart = Object.assign({}, L.smart, { m: [2, 0, 0, 2, 0, 0] }); });
    SX.replaceSmart(L, SX.solid(40, 20, "#0000ff"));
    var f = PE.flatten(d), px = SX.px(f, 10, 10), out = SX.px(f, 25, 25);
    ok(L.smart.src.width === 10 && px[2] === 255 && px[0] === 0 && out[3] === 0, "replace contents keeps the size and transform");
    ED.undo(); ok(SX.px(PE.flatten(d), 10, 10)[0] === 255, "replace contents undoes");
  });
  SX.tests.push(async function (ok, near) {
    var c = PE.mk(40, 40); PE.cx2(c).fillStyle = "#ff0000"; PE.cx2(c).fillRect(10, 10, 10, 10);
    var L = PE.rasterFromCanvas(PE.touch(c), "r"), d = SX.scratch(40, 40, [L]);
    SX.toSmart(); ok(L.kind === "smart" && L.smart.src.width === 10 && L.smart.m[4] === 10, "convert to smart layer keeps the source");
    var xf = { b: { x: 10, y: 10, w: 10, h: 10, r0: 0 }, sx: 0.2, sy: 0.2, rot: 0, tx: 0, ty: 0 };
    ED.meta("t", function () { ED.transformLayer(L, ED.xfMatrix(xf), xf); });
    xf = { b: PE.vbox(L), sx: 5, sy: 5, rot: 0, tx: 0, ty: 0 }; xf.b.r0 = 0;
    ED.meta("t2", function () { ED.transformLayer(L, ED.xfMatrix(xf), xf); });
    var f = PE.flatten(d); ok(SX.px(f, 11, 11).join() === "255,0,0,255" && SX.px(f, 19, 19)[0] === 255 && SX.px(f, 21, 21)[3] === 0, "shrink then grow back: no quality loss");
    ED.nudge(5, 0); ok(L.smart.m[4] === 15, "moving shifts the matrix");
    ED.meta("blur", function () { L.smart = Object.assign({}, L.smart, { filters: [{ op: "blur", p: { radius: 4 }, on: true }] }); });
    ok(SX.px(PE.flatten(d), 14, 15)[3] > 0 && SX.px(L.smart.src, 0, 0).join() === "255,0,0,255", "smart filter applies without touching the source");
    L.smart.filters[0].on = false; L.smart = Object.assign({}, L.smart); ok(SX.px(PE.flatten(d), 14, 15)[3] === 0, "hidden smart filter");
    L.smart.filters[0].on = true; L.smart = Object.assign({}, L.smart);
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer()));
    ok(od.layers[0].kind === "smart" && od.layers[0].smart.src.width === 10 && od.layers[0].smart.filters[0].op === "blur" && near(od.layers[0].smart.m[4], 15, 1e-9), "smart layers round-trip");
    ED.cancelModes(); ED.setActive(L.id); var keep = L.smart.m.slice(); ED.resizeCanvasTo({ x: 5, y: 0, w: 30, h: 40 }); ok(L.smart.m[4] === keep[4] - 5, "crop moves smart layers");
  });
})();
