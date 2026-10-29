/* Selection lane: artboards. An artboard is a group with L.board = {x, y, w, h, bg}: it paints its background,
   shows only what is inside its rectangle, has its name drawn above it, moves with its contents, and can be
   exported on its own (Export artboards… gives one PNG per board in a zip). New boards are placed to the right
   of the others and the canvas grows to hold them. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, h = S3.h;
  SX.addIcons({ "t-board": '<path d="M7 3v4M17 3v4M7 17v4M17 17v4M3 7h4M17 7h4M3 17h4M17 17h4"/><rect x="7" y="7" width="10" height="10" rx="1"/>' });
  var PRESETS = [["Instagram post", 1080, 1080], ["Instagram portrait", 1080, 1350], ["Story", 1080, 1920], ["HD 1920 × 1080", 1920, 1080], ["Phone 390 × 844", 390, 844], ["Tablet 820 × 1180", 820, 1180], ["Desktop 1440 × 900", 1440, 900], ["A4 (300 dpi)", 2480, 3508]];
  function boards(d) { d = d || ED.doc; return d ? d.layers.filter(function (L) { return L.kind === "group" && L.board; }) : []; }
  SX.boards = boards;

  // ---------- drawing ----------
  var g0 = SX.drawExt.group;
  SX.drawExt.group = function (R, tgt, G) {
    if (!G.board || (R.opts.over && R.opts.over[G.id]) || (R.container && R.container(G))) return g0(R, tgt, G);
    var B = G.board, b = SX.buffer(R, "board", tgt.d + 1), c = b.c;
    if (B.bg) { c.save(); SX.setT(c, b, R.M); c.fillStyle = B.bg; c.fillRect(B.x, B.y, B.w, B.h); c.restore(); }
    SX.groupInto(R, b, G);
    c.save(); SX.setT(c, b, R.M); c.globalCompositeOperation = "destination-in"; c.fillStyle = "#000"; c.fillRect(B.x, B.y, B.w, B.h); c.restore();
    SX.compositeBuf(R, tgt, b, G.blend === "pass" ? "normal" : G.blend, G.opacity);
  };
  ED.on("overlay", function (o) {
    var d = ED.doc; if (!d) return;
    var list = boards(d); if (!list.length) return;
    var c = o.c; c.save(); c.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    c.font = "600 12px " + (getComputedStyle(document.body).fontFamily || "sans-serif"); c.textBaseline = "bottom";
    list.forEach(function (G) {
      var B = G.board, a = ED.toScr(B.x, B.y), z = ED.toScr(B.x + B.w, B.y + B.h), on = G === ED.layer();
      c.strokeStyle = on ? "#1b8cff" : "rgba(127,127,127,.7)"; c.lineWidth = on ? 1.5 : 1; c.strokeRect(a.x - 0.5, a.y - 0.5, z.x - a.x + 1, z.y - a.y + 1);
      c.fillStyle = on ? "#1b8cff" : getComputedStyle(document.documentElement).getPropertyValue("--text-2").trim() || "#777"; c.fillText(G.name, a.x, a.y - 4);
    });
    c.restore();
  });
  SX.kindIcon = (function (prev) { return function (L) { return L.board ? "t-board" : prev(L); }; })(SX.kindIcon);

  // ---------- geometry with the layer ----------
  function moveBoard(L, dx, dy) { L.board = Object.assign({}, L.board, { x: L.board.x + dx, y: L.board.y + dy }); }
  var shift0 = PE.shiftExt;
  PE.shiftExt = function (dr, dx, dy) { if (shift0) shift0(dr, dx, dy); var L = dr.L; if (!L.board) return; if (!dr._bd) dr._bd = L.board; L.board = Object.assign({}, dr._bd, { x: dr._bd.x + dx, y: dr._bd.y + dy }); };
  var mm0 = SX.moveMore; SX.moveMore = function (L, dx, dy) { if (mm0) mm0(L, dx, dy); if (L.board) moveBoard(L, dx, dy); };
  PE.offsetExt = (function (prev) { return function (L, dx, dy) { if (prev) prev(L, dx, dy); if (L.board) moveBoard(L, dx, dy); }; })(PE.offsetExt);
  PE.scaleExt = (function (prev) { return function (L, kx, ky) { if (prev) prev(L, kx, ky); if (L.board) { var B = L.board; L.board = Object.assign({}, B, { x: Math.round(B.x * kx), y: Math.round(B.y * ky), w: Math.max(1, Math.round(B.w * kx)), h: Math.max(1, Math.round(B.h * ky)) }); } }; })(PE.scaleExt);
  var xa0 = PE.xfAny;
  PE.xfAny = function (L, m, xf) { if (xa0) xa0(L, m, xf); if (L.board) { var r = PE.rectI(PE.mBounds(m, L.board)); L.board = Object.assign({}, L.board, { x: r.x, y: r.y, w: Math.max(1, r.w), h: Math.max(1, r.h) }); } };
  PE.vboxExt.group = (function (prev) { return function (G) { if (G.board) { var B = G.board; return { x: B.x, y: B.y, w: B.w, h: B.h, rot: 0, fx: false, fy: false }; } return prev(G); }; })(PE.vboxExt.group);

  // ---------- commands ----------
  function boardLayer(name, r, bg) { var G = PE.newLayer("group", { name: name, blend: "pass" }); G.canvas = null; G.open = true; G.parent = null; G.board = { x: r.x, y: r.y, w: r.w, h: r.h, bg: bg }; return G; }
  SX.newArtboard = function (w, hh, name, bg) {
    if (!SX.need()) return;
    var d = ED.doc, list = boards(d), x = 0, y = 0;
    if (list.length) { list.forEach(function (G) { x = Math.max(x, G.board.x + G.board.w + 100); }); y = list[0].board.y; }
    else if (d.layers.some(function (L) { return !SX.HELPER || !SX.HELPER[L.kind]; })) x = d.w + 100;
    var R = { x: 0, y: 0, w: Math.max(d.w, x + w), h: Math.max(d.h, y + hh) };
    try { PE.checkSize(R.w, R.h, "The canvas with this artboard"); } catch (e) { S3.toast(e.message, "error"); return; }
    var G = boardLayer(name || "Artboard " + (list.length + 1), { x: x, y: y, w: w, h: hh }, bg);
    ED.meta("New artboard", function () { if (R.w !== d.w || R.h !== d.h) ED.resizeCanvasTo(R, false, null); d.layers.push(G); d.active = G.id; ED.maskEdit = false; });
    ED.emit("layers"); ED.fit(true);
    return G;
  };
  // Picked layers (or everything) into an artboard sized to the document / their box.
  SX.artboardFromLayers = function () {
    if (!SX.need()) return;
    var d = ED.doc, picked = SX.pickedList().filter(function (L) { return !SX.HELPER || !SX.HELPER[L.kind]; });
    var all = picked.length > 1 || (picked.length === 1 && Object.keys(SX.picked).length) ? picked : SX.tree(d).roots.filter(function (L) { return !SX.HELPER || !SX.HELPER[L.kind]; }).reverse();
    if (!all.length) return;
    var box = null; all.forEach(function (L) { var b = SX.layerBounds ? SX.layerBounds(L) : null; box = PE.union(box, b); });
    var r = all.length === picked.length && picked.length > 1 && box ? PE.rectI(box) : { x: 0, y: 0, w: d.w, h: d.h };
    var G = boardLayer("Artboard " + (boards(d).length + 1), r, "");
    ED.meta("Artboard from layers", function () {
      d.layers.push(G); SX.groupsApi.place(d, G, all[0], "above");
      all.slice().reverse().forEach(function (L) { SX.groupsApi.place(d, L, G, "in-top"); });
      d.active = G.id; ED.maskEdit = false;
    });
    SX.picked = {}; ED.emit("layers");
  };
  SX.exportArtboards = function (scale) {
    var d = ED.doc, list = boards(d); if (!list.length) { S3.toast("There are no artboards", "error"); return; }
    var files = [], k = scale || 1, chain = Promise.resolve();
    list.forEach(function (G) {
      chain = chain.then(function () { return PE.toBlob(PE.flatten(d, { only: [G.id], rect: G.board, scale: k }), "image/png"); }).then(PE.blobBytes)
        .then(function (b) { files.push({ name: G.name.replace(/[\\\/:*?"<>|]+/g, "-") + (k !== 1 ? "@" + k + "x" : "") + ".png", data: b }); });
    });
    ED.working(chain.then(function () {
      if (files.length === 1) S3.download(new Blob([files[0].data], { type: "image/png" }), files[0].name, "image/png");
      else S3.download(S3.zip(files), String(d.name || "artboards").replace(/[\\\/:*?"<>|]+/g, "-") + "-artboards.zip", "application/zip");
      S3.done();
    }), "Exporting artboards…").catch(function (e) { S3.toast(e.message, "error"); });
  };
  function newDialog() {
    if (!SX.need()) return;
    var w = ED.ui.w, sel = PRESETS[0], bg = "#ffffff", name = h("input", { "class": "input", value: "Artboard " + (boards().length + 1), maxlength: "60" });
    var W = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: String(sel[1]) }), H = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: String(sel[2]) });
    var grid = h("div", { "class": "pe-presets" });
    PRESETS.forEach(function (p, i) { var b = h("button", { type: "button", "class": "pe-preset", "aria-pressed": String(i === 0) }, [h("b", { text: p[0] }), h("span", { "class": "faint", text: p[1] + " × " + p[2] })]); b.addEventListener("click", function () { S3.$$(".pe-preset", grid).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); W.value = p[1]; H.value = p[2]; }); grid.appendChild(b); });
    var body = h("div", { "class": "stack" }, [grid, h("div", { "class": "pe-custom" }, [w.field("Width", W), w.field("Height", H), w.field("Name", name)]),
      w.seg("Background", [["#ffffff", "White"], ["", "Transparent"], ["#000000", "Black"], ["bg", "Background colour"]], bg, function (v) { bg = v; }),
      h("p", { "class": "faint pe-p", text: "Each artboard shows only what is inside it and exports on its own. The canvas grows to fit new boards." })]);
    var dlg = w.modal("New artboard", body, [h("span", { "class": "grow" }), w.btn("Create", function () { dlg.close(); SX.newArtboard(Math.round(+W.value || 1080), Math.round(+H.value || 1080), name.value.trim().slice(0, 60), bg === "bg" ? ED.doc.bg : bg); }, "primary")], true);
  }

  // ---------- Properties ----------
  var pg0 = SX.props.group;
  SX.props.group = function (P, L) {
    if (!L.board) return pg0(P, L);
    var w = ED.ui.w, B = L.board, n = SX.groupsApi.descendants(L).length;
    P.appendChild(h("div", { "class": "pe-phead" }, [w.svg("t-board"), h("b", { text: L.name }), h("span", { "class": "faint", text: "Artboard" })]));
    function num(label, key, min) { var i = h("input", { type: "number", "class": "input", value: String(Math.round(B[key])) }); i.addEventListener("change", function () { var v = Math.round(+i.value); if (!isFinite(v)) return; v = Math.max(min, Math.min(PE.LIM.side * 2, v)); ED.meta("Artboard size", function () { var o = {}; o[key] = v; L.board = Object.assign({}, L.board, o); }); }); return h("label", { "class": "pe-pf" }, [h("span", { text: label }), i]); }
    P.appendChild(h("div", { "class": "pe-pgrid" }, [num("X", "x", -PE.LIM.side), num("Y", "y", -PE.LIM.side), num("W", "w", 1), num("H", "h", 1)]));
    var bgIn = h("input", { type: "color", value: B.bg || "#ffffff" }); bgIn.addEventListener("input", function () { SX.liveEdit(L, function () { L.board = Object.assign({}, L.board, { bg: bgIn.value }); }, "Artboard background"); });
    P.appendChild(h("div", { "class": "pe-prow" }, [h("label", { "class": "pe-pf pe-pcol" }, [h("span", { text: "Background" }), bgIn]), w.check("Transparent", !B.bg, function (v) { ED.meta("Artboard background", function () { L.board = Object.assign({}, L.board, { bg: v ? "" : bgIn.value }); }); })]));
    P.appendChild(h("p", { "class": "faint pe-p", text: n + " layer" + (n === 1 ? "" : "s") + " inside. Drag layers onto it in the Layers panel." }));
    P.appendChild(h("div", { "class": "pe-prow" }, [w.btn("Export this board", function () { ED.working(PE.toBlob(PE.flatten(ED.doc, { only: [L.id], rect: L.board }), "image/png")).then(function (b) { S3.download(b, L.name.replace(/[\\\/:*?"<>|]+/g, "-") + ".png", "image/png"); S3.done(); }); }, "ghost", "i-download"),
      w.btn("Ungroup", function () { SX.ungroup(L); }, "ghost")]));
  };

  SX.fields.board = {
    save: function (L) { return L.board ? PE.clone(L.board) : undefined; },
    parse: function (v, out) {
      if (out.kind !== "group" || !v || typeof v !== "object") return undefined;
      var n = function (x, a, b) { return Math.round(SX.num(x, a, b) || 0); };
      return { x: n(v.x, -1e5, 1e5), y: n(v.y, -1e5, 1e5), w: Math.max(1, n(v.w, 1, 3 * PE.LIM.side)), h: Math.max(1, n(v.h, 1, 3 * PE.LIM.side)), bg: v.bg === "" ? "" : PE.hex(v.bg, "") };
    }
  };
  SX.menu("Layer", ["-", ["New artboard…", "", newDialog, SX.has], ["Artboard from layers", "", SX.artboardFromLayers, SX.has], ["Export artboards (PNG)", "", function () { SX.exportArtboards(1); }, function () { return boards().length > 0; }], ["Export artboards at 2×", "", function () { SX.exportArtboards(2); }, function () { return boards().length > 0; }]], "Layer comps…");

  SX.tests.push(async function (ok) {
    var d = SX.scratch(100, 80, [PE.rasterFromCanvas(SX.solid(100, 80, "#ff0000"), "bg")]);
    SX.picked = {}; SX.artboardFromLayers();
    var A = boards(d)[0]; ok(A && A.board.w === 100 && d.layers[0].parent === A.id, "artboard from the layers");
    var B = SX.newArtboard(50, 40, "Small", "#00ff00");
    ok(d.w === 250 && B.board.x === 200 && B.board.y === 0, "new artboard to the right, canvas grows");
    var f = PE.flatten(d); ok(SX.px(f, 210, 10).join() === "0,255,0,255" && SX.px(f, 210, 60)[3] === 0 && SX.px(f, 150, 10)[3] === 0, "board background, clipped to its rectangle");
    var c = PE.rasterFromCanvas(SX.solid(250, 80, "#0000ff"), "wide"); c.parent = B.id; d.layers.splice(d.layers.indexOf(B), 0, c);
    f = PE.flatten(d); ok(SX.px(f, 210, 10)[2] === 255 && SX.px(f, 210, 60)[3] === 0, "members show only inside the board");
    ED.setActive(B.id); ED.nudge(5, 5); ok(B.board.x === 205 && c.x === 5, "moving a board moves its members");
    ED.undo(); var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer())); ok(boards(od).length === 2 && boards(od)[1].board.bg === "#00ff00", "artboards round-trip");
    ED.undo(); ok(d.w === 100 && boards(d).length === 1, "undo new artboard shrinks the canvas back");
  });
})();
