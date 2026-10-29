/* Selection lane: layer groups (folders). A group is a layer of kind "group" with no pixels; members point to it
   with `parent`. Groups nest, collapse in the Layers panel, have their own opacity, blend mode ("pass through" by
   default) and mask, and move / transform / hide / lock / duplicate / delete with their contents. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx;
  PE.kindsExt.push("group");

  // ---------- tree helpers ----------
  function T() { return SX.tree(ED.doc); }
  function parentOf(L, t) { return (t || T()).parentOf(L); }
  function siblings(L, t) { var p = t.parentOf(L); return p ? (t.kids[p.id] = t.kids[p.id] || []) : t.roots; }
  function descendants(G, t) { t = t || T(); var out = []; (t.kids[G.id] || []).forEach(function (k) { out.push(k); if (k.kind === "group") out = out.concat(descendants(k, t)); }); return out; }
  function isInside(L, G, t) { for (var p = t.parentOf(L); p; p = t.parentOf(p)) if (p === G) return true; return false; }
  // Write the tree back as the flat bottom-to-top list (each group's members directly below it).
  function serialize(t) {
    var out = [];
    (function emit(list) { list.forEach(function (L) { if (L.kind === "group") emit(t.kids[L.id] || []); out.push(L); }); })(t.roots);
    out.forEach(function (L) { var p = t.parentOf(L); L.parent = p ? p.id : null; });   // null = placed at the top level on purpose
    return out;
  }
  // Tree order top-first (what the panel shows), optionally skipping collapsed groups' members.
  function topFirst(t, openOnly) {
    var out = [];
    (function walk(list, depth) { for (var i = list.length - 1; i >= 0; i--) { var L = list[i]; out.push({ L: L, depth: depth }); if (L.kind === "group" && (!openOnly || L.open !== false)) walk(t.kids[L.id] || [], depth + 1); } })(t.roots, 0);
    return out;
  }
  // Move X next to ref ("above" / "below") or into group ref ("in-top" / "in-bottom"). Mutates doc.layers.
  function place(doc, X, ref, where) {
    var t = SX.tree(doc), from = siblings(X, t); from.splice(from.indexOf(X), 1);
    var list, i;
    if (where === "in-top" || where === "in-bottom") { list = t.kids[ref.id] = t.kids[ref.id] || []; i = where === "in-top" ? list.length : 0; X.parent = ref.id; }
    else { list = siblings(ref, t); i = list.indexOf(ref) + (where === "above" ? 1 : 0); var p = t.parentOf(ref); X.parent = p ? p.id : null; }
    list.splice(i, 0, X);
    t.parentOf = (function (byId) { return function (L) { var q = L.parent && byId[L.parent]; return q && q.kind === "group" ? q : null; }; })(t.byId);
    doc.layers = serialize(t);
  }
  SX.groupsApi = { tree: T, descendants: descendants, serialize: serialize, topFirst: topFirst, place: place, isInside: isInside, siblings: siblings };

  // ---------- picked layers (Ctrl/Shift+click in the panel); the active layer is always included ----------
  SX.picked = {};
  SX.pickedList = function () {
    var d = ED.doc; if (!d) return [];
    var t = T(), out = topFirst(t, false).map(function (r) { return r.L; }).filter(function (L) { return SX.picked[L.id] || L.id === d.active; });
    return out.filter(function (L) { return !out.some(function (G) { return G !== L && G.kind === "group" && isInside(L, G, t); }); });   // drop members of picked groups
  };
  ED.on("changed", function (why) { if (why === "open") SX.picked = {}; var d = ED.doc; if (!d) return; Object.keys(SX.picked).forEach(function (id) { if (!PE.findLayer(d, id)) delete SX.picked[id]; }); });

  function nextName(prefix) { var d = ED.doc, n = 1; while (d.layers.some(function (L) { return L.name === prefix + " " + n; })) n++; return prefix + " " + n; }
  function newGroupLayer(name) { var G = PE.newLayer("group", { name: name || nextName("Group"), blend: "pass" }); G.canvas = null; G.open = true; return G; }

  // ---------- commands ----------
  SX.groupLayers = function () {
    if (!SX.need()) return;
    var d = ED.doc, list = SX.pickedList(); if (!list.length) return;
    var top = list[0], G = newGroupLayer();
    ED.meta("Group layers", function () {
      d.layers.push(G); place(d, G, top, "above");
      list.slice().reverse().forEach(function (L) { place(d, L, G, "in-top"); });
      d.active = G.id; ED.maskEdit = false;
    });
    SX.picked = {}; ED.emit("layers");
  };
  SX.newGroup = function () {
    if (!SX.need()) return;
    var d = ED.doc, a = ED.layer(), G = newGroupLayer();
    ED.meta("New group", function () { d.layers.push(G); if (a) place(d, G, a, "above"); d.active = G.id; ED.maskEdit = false; });
    ED.emit("layers");
  };
  SX.ungroup = function (G) {
    G = G || ED.layer(); if (!SX.need() || !G) return;
    if (G.kind !== "group") { G = parentOf(G); if (!G) { S3.toast("That layer is not in a group", "error"); return; } }
    var d = ED.doc, t = T(), kids = (t.kids[G.id] || []).slice();
    ED.meta("Ungroup layers", function () {
      kids.forEach(function (k) { place(d, k, G, "below"); });
      d.layers = d.layers.filter(function (L) { return L !== G; });
      d.active = kids.length ? kids[kids.length - 1].id : (d.layers[d.layers.length - 1] || {}).id; ED.maskEdit = false;
    });
    ED.emit("layers");
  };
  // Duplicate (with members, new ids, " copy" on the top name).
  function cloneLayer(a) {
    var c = PE.newLayer(a.kind, { name: a.name, visible: a.visible, opacity: a.opacity, blend: a.blend, x: a.x, y: a.y, maskOn: a.maskOn, text: PE.clone(a.text), shape: PE.clone(a.shape), canvas: a.canvas ? PE.touch(PE.cloneCanvas(a.canvas)) : null });
    if (a.kind === "group") c.canvas = null;
    if (a.mask) c.mask = { canvas: PE.touch(PE.cloneCanvas(a.mask.canvas)), x: a.mask.x, y: a.mask.y };
    SX.KEYS.forEach(function (k) { if (a[k] !== undefined) c[k] = SX.keep(a[k]); });
    delete c.link;
    return c;
  }
  SX.cloneLayer = cloneLayer;
  PE.dupExt = function (a) {
    var d = ED.doc, t = T(), list = SX.pickedList();
    if (list.indexOf(a) < 0) list = [a];
    var made = [];
    ED.meta(list.length > 1 ? "Duplicate layers" : "Duplicate layer", function () {
      list.forEach(function (src) {
        var map = {}, top = cloneLayer(src); top.name = (src.name + " copy").slice(0, 100); map[src.id] = top.id; top.parent = src.parent;
        var members = src.kind === "group" ? descendants(src, t) : [], copies = members.map(function (m) { var c = cloneLayer(m); map[m.id] = c.id; return c; });
        copies.forEach(function (c, i) { c.parent = map[members[i].parent]; });
        d.layers = d.layers.concat(copies, [top]);
        place(d, top, src, "above");
        d.layers = serialize(SX.tree(d));
        made.push(top);
      });
      d.active = made[made.length - 1 - 0] ? made[0].id : d.active; ED.maskEdit = false;
    });
    SX.picked = {}; made.forEach(function (m) { SX.picked[m.id] = 1; }); ED.emit("layers");
    return true;
  };
  PE.removeExt = function (a) {
    var d = ED.doc, t = T(), list = SX.pickedList(); if (list.indexOf(a) < 0) list = [a];
    var gone = {}; list.forEach(function (L) { gone[L.id] = 1; if (L.kind === "group") descendants(L, t).forEach(function (k) { gone[k.id] = 1; }); });
    var left = d.layers.filter(function (L) { return !gone[L.id]; });
    if (!left.length) { S3.toast("A document needs at least one layer", "error"); return true; }
    var order = topFirst(t, false).map(function (r) { return r.L; }), i = order.indexOf(list[list.length - 1]), next = null;
    for (var k = i + 1; k < order.length && !next; k++) if (!gone[order[k].id]) next = order[k];
    for (k = i - 1; k >= 0 && !next; k--) if (!gone[order[k].id]) next = order[k];
    ED.meta(list.length > 1 || a.kind === "group" ? "Delete layers" : "Delete layer", function () { d.layers = left; d.active = (next || left[left.length - 1]).id; ED.maskEdit = false; });
    SX.picked = {}; ED.emit("layers");
    return true;
  };
  // Ctrl+] / Ctrl+[ : move within the tree, entering open groups and leaving at the ends.
  PE.moveExt = function (a, dir) {
    var d = ED.doc, t = T(), sib = siblings(a, t), i = sib.indexOf(a), p = t.parentOf(a), nb = sib[i + dir];
    if (!nb && !p) return true;
    ED.meta(dir > 0 ? "Bring forward" : "Send backward", function () {
      if (!nb) place(d, a, p, dir > 0 ? "above" : "below");
      else if (nb.kind === "group" && nb.open !== false) place(d, a, nb, dir > 0 ? "in-bottom" : "in-top");
      else place(d, a, nb, dir > 0 ? "above" : "below");
    });
    ED.emit("layers");
    return true;
  };
  // Merge: a group into one pixel layer; several picked layers into one; otherwise down into the layer below.
  function mergedLayer(list, name) {
    var d = ED.doc, saved = list.map(function (L) { return { L: L, o: L.opacity, b: L.blend, v: L.visible }; });
    var c = PE.flatten(d, { only: list.map(function (L) { return L.id; }) });
    void saved;
    return PE.rasterFromCanvas(PE.touch(c), name);
  }
  SX.mergeGroup = function (G) {
    var d = ED.doc, t = T(), members = descendants(G, t), keepO = G.opacity, keepB = G.blend;
    G.opacity = 1; G.blend = "pass";
    var c = PE.flatten(d, { only: [G.id] });
    G.opacity = keepO; G.blend = keepB;
    var M = PE.rasterFromCanvas(PE.touch(c), G.name);
    M.opacity = keepO; M.blend = keepB === "pass" ? "normal" : keepB; M.visible = G.visible; if (G.parent) M.parent = G.parent;
    var gone = {}; members.forEach(function (k) { gone[k.id] = 1; });
    ED.meta("Merge group", function () {
      var i = d.layers.indexOf(G); d.layers[i] = M;
      d.layers = d.layers.filter(function (L) { return !gone[L.id]; });
      d.active = M.id; ED.maskEdit = false;
    });
    ED.emit("layers");
  };
  PE.mergeExt = function (a) {
    var d = ED.doc, t = T(), list = SX.pickedList();
    if (a.kind === "group" && list.length < 2) { SX.mergeGroup(a); return true; }
    if (list.length > 1) {
      if (list.some(function (L) { return L.locked; })) { S3.toast("Unlock the layers to merge them", "error"); return true; }
      var M = mergedLayer(list, list[0].name), gone = {}; list.forEach(function (L) { gone[L.id] = 1; if (L.kind === "group") descendants(L, t).forEach(function (k) { gone[k.id] = 1; }); });
      if (list[0].parent) M.parent = list[0].parent;
      ED.meta("Merge layers", function () { var i = d.layers.indexOf(list[0]); d.layers[i] = M; d.layers = d.layers.filter(function (L) { return L === M || !gone[L.id]; }); d.active = M.id; ED.maskEdit = false; });
      SX.picked = {}; ED.emit("layers"); return true;
    }
    var sib = siblings(a, t), b = sib[sib.indexOf(a) - 1];
    if (!b) { S3.toast("There is no layer below to merge into", "error"); return true; }
    if (b.kind === "group") { S3.toast("The layer below is a group: merge the group first (select it, then Merge)", "error"); return true; }
    if (b.kind === "adjust") { S3.toast("Cannot merge into an adjustment layer", "error"); return true; }
    if (b.locked || a.locked) { S3.toast("Unlock both layers to merge them", "error"); return true; }
    var save = { o: b.opacity, bl: b.blend, f: b.fillOp, fx: b.fx };
    ED.meta("Merge down", function () {
      b.opacity = 1; b.blend = "normal";
      var c = PE.flatten(d, { only: [b.id, a.id] });
      b.opacity = save.o; b.blend = save.bl;
      b.kind = "raster"; b.text = null; b.shape = null; b.canvas = PE.touch(c); b.x = 0; b.y = 0; b.mask = null;
      ["fillOp", "fx", "adj", "fillSpec", "smart", "vmask"].forEach(function (k) { delete b[k]; });
      d.layers.splice(d.layers.indexOf(a), 1); d.active = b.id; ED.maskEdit = false;
    });
    ED.emit("layers");
    return true;
  };

  // ---------- editing rules ----------
  PE.editableExt = function (L, need) {
    var t = T();
    for (var p = t.parentOf(L); p; p = t.parentOf(p)) {
      if (p.locked) { S3.toast("“" + L.name + "” is in the locked group “" + p.name + "”", "error"); return false; }
      if (!p.visible) { S3.toast("“" + L.name + "” is in the hidden group “" + p.name + "”. Show the group to edit it.", "error"); return false; }
    }
    if (L.kind === "group" && need === "pixels" && !(ED.maskEdit && L.mask)) { S3.toast("“" + L.name + "” is a group: pick a layer inside it to paint or adjust", "error"); return false; }
    return true;
  };
  // Pixels of a group (members composited, group mask applied, without the group's own opacity / blend). Cached.
  var GC = new WeakMap();
  function sigOf(G, t) {
    return descendants(G, t).concat([G]).map(function (L) {
      return [L.id, L.kind, L.visible, L.opacity, L.blend, L.x, L.y, L.canvas ? PE.ver(L.canvas) : "", L.mask ? PE.ver(L.mask.canvas) + "@" + L.mask.x + "," + L.mask.y + L.maskOn : "", JSON.stringify(L.text || L.shape || ""), JSON.stringify(SX.KEYS.map(function (k) { return k === "smart" ? !!L[k] : L[k]; }))].join("|");
    }).join("\n");
  }
  PE.surfaceExt = PE.surfaceExt || {};
  PE.surfaceExt.group = function (G, doc) {
    var t = SX.tree(doc), sig = sigOf(G, t) + doc.w + "x" + doc.h, hit = GC.get(G);
    if (hit && hit.sig === sig) return hit.s;
    var c = PE.mk(doc.w, doc.h), x = PE.cx2(c);
    SX.renderInto(x, doc, function () { return t.kids[G.id] || []; }, {});
    if (G.mask && G.maskOn) { x.globalCompositeOperation = "destination-in"; x.drawImage(G.mask.canvas, G.mask.x, G.mask.y); x.globalCompositeOperation = "source-over"; }
    var s = { canvas: PE.touch(c), x: 0, y: 0 };
    GC.set(G, { sig: sig, s: s });
    return s;
  };
  PE.vboxExt = PE.vboxExt || {};
  PE.vboxExt.group = function (G) {
    var d = ED.doc, b = PE.PIX_bounds ? null : window.PIX.alphaBounds(PE.getData(PE.surface(G, d).canvas));
    return b ? { x: b.x, y: b.y, w: b.w, h: b.h, rot: 0, fx: false, fy: false } : { x: 0, y: 0, w: d.w, h: d.h, rot: 0, fx: false, fy: false };
  };
  // Free transform / flip of a group transforms its members (rotate/flip canvas already visits every layer itself).
  PE.xfExt = PE.xfExt || {};
  PE.xfExt.group = function (G, m, xf) {
    if (!SX.xfAll) return;
    var t = T();
    (t.kids[G.id] || []).forEach(function (k) {
      var b = k.kind === "text" || k.kind === "shape" ? PE.vbox(k) : null, straight = xf && !xf.rot && !(xf.b && xf.b.r0) && (!b || !b.rot);
      ED.transformLayer(k, m, straight && b ? { b: { x: b.x, y: b.y, w: b.w, h: b.h, r0: 0 }, sx: xf.sx, sy: xf.sy, rot: 0, tx: 0, ty: 0 } : null);
    });
  };
  ["applyTransform", "flipLayer"].forEach(function (fn) {
    var orig = ED[fn];
    ED[fn] = function () { SX.xfAll = true; try { return orig.apply(this, arguments); } finally { SX.xfAll = false; } };
  });
  // Moving a group moves its members.
  PE.shiftExt = function (dr, dx, dy) {
    var L = dr.L;
    if (L.kind !== "raster" && !L.text && !L.shape) { L.x = (dr.x || 0) + dx; L.y = (dr.y || 0) + dy; }   // lets the move register as a change
    if (L.kind !== "group") return;
    if (!dr._kids) dr._kids = descendants(L).map(function (k) { return { k: k, x: k.x, y: k.y, t: PE.clone(k.text), s: PE.clone(k.shape), mx: k.mask && k.mask.x, my: k.mask && k.mask.y }; });
    dr._kids.forEach(function (o) {
      var k = o.k;
      if (k.kind === "raster") { k.x = o.x + dx; k.y = o.y + dy; }
      if (k.text) { k.text.ax = o.t.ax + dx; k.text.ay = o.t.ay + dy; }
      if (k.shape) { k.shape.x = o.s.x + dx; k.shape.y = o.s.y + dy; }
      if (k.mask) { k.mask.x = o.mx + dx; k.mask.y = o.my + dy; }
      if (SX.shiftMore) SX.shiftMore(k, o, dx, dy);
    });
    L.x = (dr.x || 0) + dx; L.y = (dr.y || 0) + dy;
  };
  var rast = ED.rasterize;
  ED.rasterize = function (L, silent) { if (L && L.kind === "group") { SX.mergeGroup(L); return L; } return rast.apply(this, arguments); };

  // New layers join the group of the layer they are added above (or the open group that is selected).
  var add = ED.addLayer;
  ED.addLayer = function (L, label, above) {
    var a = above || ED.layer();
    if (a && L.parent === undefined) { if (a.kind === "group" && a.open !== false) L.parent = a.id; else if (a.parent) L.parent = a.parent; }
    return add.call(this, L, label, above);
  };
  var seen = {}, seenDoc = null;
  function adopt() {
    var d = ED.doc; if (!d) return;
    if (d !== seenDoc) { seenDoc = d; seen = {}; d.layers.forEach(function (L) { seen[L.id] = 1; }); return; }
    d.layers.forEach(function (L, i) {
      if (seen[L.id]) return; seen[L.id] = 1;
      var below = d.layers[i - 1], p = null;
      if (L.parent !== undefined || !below) return;
      if (below.kind === "group" && below.open !== false) p = below.id; else if (below.parent) p = below.parent;
      if (p && p !== L.id) L.parent = p;
    });
  }
  ED.on("layers", adopt); ED.on("changed", adopt);

  // ---------- project files ----------
  SX.fields.parent = { save: function (L) { return L.parent || undefined; }, parse: function (v) { return SX.idOk(v); } };
  SX.fields.open = { save: function (L) { return L.kind === "group" && L.open === false ? false : undefined; }, parse: function (v) { return v === false ? false : undefined; } };
  SX.parseFix = SX.parseFix || [];
  SX.parseFix.push(function (raw, out) { if (out.kind === "group" && raw.blend === "pass") out.blend = "pass"; });

  // ---------- menus + keys ----------
  function has() { return !!ED.doc; }
  function inGroup() { var L = ED.layer(); return !!(L && (L.kind === "group" || L.parent)); }
  SX.menu("Layer", [["New group", "", SX.newGroup, has], ["Group layers", "Ctrl+G", SX.groupLayers, has], ["Ungroup layers", "Ctrl+Shift+G", function () { SX.ungroup(); }, inGroup]], "Delete layer");
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (!(e.ctrlKey || e.metaKey) || !ED.doc || e.altKey || e.code !== "KeyG") return false;
    e.preventDefault(); if (e.shiftKey) SX.ungroup(); else SX.groupLayers(); return true;
  });

  SX.tests.push(async function (ok) {
    var red = PE.rasterFromCanvas(SX.solid(4, 2, "#ff0000"), "R"), blue = PE.rasterFromCanvas(SX.solid(2, 2, "#0000ff"), "B"), top = PE.rasterFromCanvas(SX.solid(1, 1, "#00ff00"), "G");
    var d = SX.scratch(4, 2, [red, blue, top]); d.active = blue.id; SX.picked = {}; SX.picked[red.id] = 1;
    SX.groupLayers();
    var G = d.layers.filter(function (L) { return L.kind === "group"; })[0];
    ok(G && red.parent === G.id && blue.parent === G.id && !top.parent && d.layers.indexOf(G) === 2 && d.layers[3] === top, "group layers keeps order and nests");
    G.opacity = 0.5; G.blend = "normal";
    var f = PE.flatten(d), p = SX.px(f, 3, 0);
    ok(p[0] === 255 && p[3] > 120 && p[3] < 136, "isolated group opacity");
    p = SX.px(f, 0, 0); ok(p[1] === 255, "layer above the group draws on top");
    G.blend = "pass"; G.opacity = 1; G.visible = false; ok(SX.px(PE.flatten(d), 3, 1)[3] === 0, "hidden group hides its members");
    G.visible = true;
    ED.setActive(G.id); ED.ui.w && PE.ed.LOPS.duplicate();
    var groups = d.layers.filter(function (L) { return L.kind === "group"; });
    ok(groups.length === 2 && d.layers.length === 7 && d.layers.filter(function (L) { return L.parent === groups[1].id || L.parent === groups[0].id; }).length === 4, "duplicate group copies members");
    ED.undo(); ok(d.layers.length === 4, "undo duplicate group");
    ED.setActive(G.id); ED.nudge(1, 0); ok(red.x === 1 && blue.x === 1, "moving a group moves its members");
    ED.undo(); ok(red.x === 0, "undo group move");
    ED.setActive(top.id); PE.moveExt(top, -1); ok(top.parent === G.id, "send backward enters an open group");
    PE.moveExt(top, 1); ok(!top.parent && d.layers[d.layers.length - 1] === top, "bring forward leaves it");
    ED.setActive(G.id); SX.ungroup(G); ok(!d.layers.some(function (L) { return L.kind === "group"; }) && !red.parent && d.layers.length === 3, "ungroup");
    ED.undo(); ok(red.parent === G.id, "undo ungroup");
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer())), og = od.layers.filter(function (L) { return L.kind === "group"; })[0];
    ok(og && og.blend === "pass" && od.layers.filter(function (L) { return L.parent === og.id; }).length === 2, "groups round-trip through projects");
    ED.setActive(G.id); SX.mergeGroup(G); ok(d.layers.length === 2 && d.layers[0].kind === "raster" && SX.px(d.layers[0].canvas, 3, 1)[0] === 255, "merge group");
    SX.picked = {};
  });
})();
