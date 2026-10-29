/* Selection lane: Channels panel, saved selections (alpha channels) and Select › Save / Load selection.
   An alpha channel is a hidden helper layer of kind "channel" whose mask holds the channel (white = selected),
   so it saves in projects, undoes, and can be painted like a mask. The panel also previews Red / Green / Blue. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, SX = PE.sx, h = S3.h;
  PE.kindsExt.push("channel");
  SX.addIcons({ "t-chan": '<circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="9" r="5.5"/><circle cx="12" cy="14.5" r="5.5"/>' });
  function chans(d) { d = d || ED.doc; return d ? d.layers.filter(function (L) { return L.kind === "channel"; }) : []; }
  SX.channels = chans;
  SX.drawExt.channel = function () {};
  PE.surfaceExt.channel = function (L) { return { canvas: L.mask ? L.mask.canvas : PE.mk(1, 1), x: L.mask ? L.mask.x : 0, y: L.mask ? L.mask.y : 0 }; };
  PE.vboxExt.channel = function () { var d = ED.doc; return { x: 0, y: 0, w: d.w, h: d.h, rot: 0, fx: false, fy: false }; };
  PE.xfExt.channel = function () {};
  var view = null;      // null = RGB, or "r" / "g" / "b" (preview of one colour channel)
  function selMask(d) { var c = PE.mk(d.w, d.h); if (d.sel) PE.cx2(c).drawImage(PE.selCanvas(d.sel), 0, 0); return c; }
  function maskArray(L, d) {
    var c = PE.mk(d.w, d.h), x = PE.cx2(c); x.drawImage(L.mask.canvas, L.mask.x, L.mask.y);
    var px = x.getImageData(0, 0, d.w, d.h).data, m = new Uint8Array(d.w * d.h); for (var i = 0; i < m.length; i++) m[i] = px[i * 4 + 3]; return m;
  }
  function nextName() { var d = ED.doc, n = 1; while (chans(d).some(function (L) { return L.name === "Alpha " + n; })) n++; return "Alpha " + n; }
  function newChannel(name, canvas) { var L = PE.newLayer("channel", { name: name || nextName() }); L.canvas = null; L.parent = null; L.mask = { canvas: PE.touch(canvas), x: 0, y: 0 }; L.maskOn = true; return L; }

  // ---------- commands ----------
  SX.saveSelection = function (target, op, name) {
    if (!SX.needSel()) return;
    var d = ED.doc, mc = selMask(d);
    if (!target) { var L = newChannel(name, mc); ED.meta("Save selection", function () { d.layers.unshift(L); }); ED.emit("layers"); return L; }
    var T = PE.findLayer(d, target); if (!T) return;
    var c = PE.mk(d.w, d.h), x = PE.cx2(c); x.drawImage(T.mask.canvas, T.mask.x, T.mask.y);
    if (op === "add") x.drawImage(mc, 0, 0);
    else if (op === "subtract") { x.globalCompositeOperation = "destination-out"; x.drawImage(mc, 0, 0); }
    else if (op === "intersect") { x.globalCompositeOperation = "destination-in"; x.drawImage(mc, 0, 0); }
    else { x.clearRect(0, 0, d.w, d.h); x.drawImage(mc, 0, 0); }
    ED.meta("Save selection", function () { T.mask = { canvas: PE.touch(c), x: 0, y: 0 }; });
    return T;
  };
  SX.loadSelection = function (id, op, invert) {
    if (!SX.need()) return;
    var d = ED.doc, L = PE.findLayer(d, id); if (!L || !L.mask) return;
    var m = maskArray(L, d); if (invert) m = PIX.invertMask(m);
    ED.setSelection(m, d.sel ? (op || "new") : "new", "Load selection");
  };
  SX.newBlankChannel = function () { if (!SX.need()) return; var d = ED.doc, L = newChannel(null, PE.mk(d.w, d.h)); ED.meta("New channel", function () { d.layers.unshift(L); }); editChannel(L); };
  SX.deleteChannel = function (L) { var d = ED.doc; if (!L) return; ED.meta("Delete channel", function () { d.layers = d.layers.filter(function (o) { return o !== L; }); if (d.active === L.id) d.active = (d.layers[d.layers.length - 1] || {}).id; }); ED.maskEdit = false; ED.emit("layers"); };
  function editChannel(L) { view = null; ED.setActive(L.id, true); ED.emit("layers"); render(); ED.renderOvl(); }
  // painting: an active channel takes brush / eraser / fill / gradient on its mask
  var ed0 = PE.editableExt;
  PE.editableExt = function (L, need) {
    if (ed0 && !ed0(L, need)) return false;
    if (L.kind === "channel" && !ED.maskEdit) { ED.maskEdit = true; ED.emit("layers"); }
    return true;
  };
  ["dupExt", "removeExt", "mergeExt", "moveExt"].forEach(function (k) {
    var f = PE[k];
    PE[k] = function (a) {
      if (a && a.kind === "channel") { if (k === "removeExt") { SX.deleteChannel(a); return true; } S3.toast("That is an alpha channel: use the Channels panel", "error"); return true; }
      return f ? f.apply(this, arguments) : false;
    };
  });
  var rast = ED.rasterize;
  ED.rasterize = function (L) { if (L && L.kind === "channel") return L; return rast.apply(this, arguments); };
  SX.props.channel = function (P, L) {
    var w = ED.ui.w;
    P.appendChild(h("div", { "class": "pe-phead" }, [w.svg("t-chan"), h("b", { text: L.name }), h("span", { "class": "faint", text: "Alpha channel" })]));
    P.appendChild(h("p", { "class": "faint pe-p", text: "A saved selection. Paint white to add, black to remove (red shows what is outside). Click a layer to go back to it." }));
    P.appendChild(h("div", { "class": "pe-prow" }, [w.btn("Load as selection", function () { SX.loadSelection(L.id); }, "primary"), w.btn("Delete", function () { SX.deleteChannel(L); }, "ghost")]));
  };

  // ---------- overlay: the active alpha channel as a red film, or a colour channel in grey ----------
  var film = null;
  function filmCanvas(o) { var cv = o.c.canvas; if (!film) film = PE.mk(cv.width, cv.height); if (film.width !== cv.width || film.height !== cv.height) { film.width = cv.width; film.height = cv.height; } var f = PE.cx2(film); f.setTransform(1, 0, 0, 1, 0, 0); f.globalCompositeOperation = "source-over"; f.clearRect(0, 0, film.width, film.height); return f; }
  var greyCache = { key: null, c: null };
  ED.on("overlay", function (o) {
    var d = ED.doc; if (!d) return;
    var L = ED.layer(), k = ED.zoom * o.dpr;
    if (L && L.kind === "channel" && L.mask) {
      var mask = (ED.live.maskOver && ED.live.maskOver[L.id]) || L.mask, f = filmCanvas(o);
      f.setTransform(k, 0, 0, k, ED.panX * o.dpr, ED.panY * o.dpr); f.fillStyle = "rgba(255,30,50,0.55)"; f.fillRect(0, 0, d.w, d.h);
      f.globalCompositeOperation = "destination-out"; f.drawImage(mask.canvas, mask.x, mask.y);
      o.c.save(); o.c.setTransform(1, 0, 0, 1, 0, 0); o.c.drawImage(film, 0, 0); o.c.restore();
      return;
    }
    if (view) {
      var key = view + ":" + ED.hist.pos + ":" + d.w + "x" + d.h + ":" + d.layers.length;
      if (greyCache.key !== key) {
        var s = Math.min(1, 2000 / Math.max(d.w, d.h)), src = PE.flatten(d, { scale: s, bg: "#ffffff" }), x = PE.cx2(src), im = x.getImageData(0, 0, src.width, src.height), p = im.data, ci = { r: 0, g: 1, b: 2 }[view];
        for (var i = 0; i < p.length; i += 4) { var v = p[i + ci]; p[i] = p[i + 1] = p[i + 2] = v; }
        x.putImageData(im, 0, 0); greyCache = { key: key, c: src };
      }
      o.docPath(o.c, function (c) { c.drawImage(greyCache.c, 0, 0, d.w, d.h); });
    }
  });

  // ---------- panel ----------
  var box = null;
  function render() {
    if (!box) return;
    box.textContent = "";
    var d = ED.doc;
    if (!d) { box.appendChild(h("p", { "class": "faint pe-p", text: "No document open." })); return; }
    var L0 = ED.layer();
    function row(label, thumbEl, on, click, extra) {
      var r = h("div", { "class": "pe-layer pe-chrow" + (on ? " on" : ""), tabindex: "0", role: "option", "aria-selected": String(!!on) }, [thumbEl, h("span", { "class": "pe-lmid" }, [h("span", { "class": "pe-lname", text: label })])].concat(extra || []));
      r.addEventListener("click", click); r.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); click(e); } });
      return r;
    }
    var comp = L0 && L0.kind === "channel" ? null : view;
    box.appendChild(row("RGB", h("span", { "class": "pe-kthumb pe-chkey", text: "RGB" }), !comp && !(L0 && L0.kind === "channel"), function () { view = null; if (L0 && L0.kind === "channel") { var top = d.layers.filter(function (o) { return o.kind !== "channel" && o.kind !== "qmask"; }).pop(); if (top) ED.setActive(top.id); } render(); ED.renderOvl(); }));
    [["r", "Red"], ["g", "Green"], ["b", "Blue"]].forEach(function (c) {
      box.appendChild(row(c[1], h("span", { "class": "pe-kthumb pe-chkey pe-ch-" + c[0], text: c[0].toUpperCase() }), comp === c[0], function () { view = view === c[0] ? null : c[0]; if (L0 && L0.kind === "channel") { var top = d.layers.filter(function (o) { return o.kind !== "channel" && o.kind !== "qmask"; }).pop(); if (top) ED.setActive(top.id); } render(); ED.renderOvl(); }));
    });
    chans(d).forEach(function (L) {
      var th = h("button", { type: "button", "class": "pe-tb", title: "Ctrl+click: load as selection (Shift adds, Alt subtracts)", "aria-label": "Channel thumbnail",
        onclick: function (e) { e.stopPropagation(); if (e.ctrlKey || e.metaKey) { SX.loadSelection(L.id, e.shiftKey && e.altKey ? "intersect" : e.shiftKey ? "add" : e.altKey ? "subtract" : "new"); return; } editChannel(L); } }, [SX.thumb(L, "mask")]);
      var del = h("button", { type: "button", "class": "pe-lbtn", title: "Delete channel", "aria-label": "Delete " + L.name, onclick: function (e) { e.stopPropagation(); SX.deleteChannel(L); } }, [ED.ui.w.svg("i-trash")]);
      var r = row(L.name, th, L === L0, function () { editChannel(L); }, [del]);
      var nm = r.querySelector(".pe-lname"); nm.title = "Double-click to rename";
      nm.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        var i = h("input", { "class": "input pe-rename", value: L.name, maxlength: "60", "aria-label": "Channel name" }); nm.replaceWith(i); i.focus(); i.select();
        var done = false; function end(save) { if (done) return; done = true; var v = i.value.trim().slice(0, 60); if (save && v && v !== L.name) ED.meta("Rename channel", function () { L.name = v; }); else render(); }
        i.addEventListener("keydown", function (ev) { ev.stopPropagation(); if (ev.key === "Enter") end(true); if (ev.key === "Escape") end(false); }); i.addEventListener("blur", function () { end(true); });
      });
      box.appendChild(r);
    });
  }
  SX.renderChannels = render;
  var renderSoon = S3.debounce(render, 120);
  ED.on("changed", function (why) { if (why === "open") view = null; renderSoon(); }); ED.on("layers", renderSoon);
  document.addEventListener("DOMContentLoaded", function () {
    var side = S3.$(".pe-side"), hist = side && side.lastElementChild; if (!side) return;
    var w = ED.ui.w, panel = h("details", { "class": "pe-panel pe-chpanel" });
    box = h("div", { "class": "pe-layers pe-chlist", role: "listbox", "aria-label": "Channels" });
    var foot = h("div", { "class": "pe-lfoot" }, [
      w.btn("", function () { var c = chans()[chans().length - 1]; var L = ED.layer(); if (L && L.kind === "channel") c = L; if (c) SX.loadSelection(c.id); else S3.toast("No saved selection yet", "error"); }, "ghost icon", "t-sadd", "Load channel as selection"),
      w.btn("", function () { SX.saveSelection(); }, "ghost icon", "t-mask", "Save selection as a channel"),
      w.btn("", SX.newBlankChannel, "ghost icon", "i-plus", "New (empty) channel to paint"),
      h("span", { "class": "grow" }),
      w.btn("", function () { var L = ED.layer(); if (L && L.kind === "channel") SX.deleteChannel(L); else S3.toast("Click an alpha channel first", "error"); }, "ghost icon", "i-trash", "Delete channel")]);
    panel.appendChild(h("summary", { text: "Channels" })); panel.appendChild(h("div", { "class": "pe-pbody" }, [box, foot]));
    side.insertBefore(panel, hist);
    render();
  });

  // ---------- dialogs ----------
  function saveDialog() {
    if (!SX.needSel()) return;
    var w = ED.ui.w, list = chans(), target = "", op = "replace", name = h("input", { "class": "input", value: nextName(), maxlength: "60" });
    var body = h("div", { "class": "stack" }, [w.select("Channel", [["", "New channel"]].concat(list.map(function (L) { return [L.id, L.name]; })), "", function (v) { target = v; }), w.field("Name (new)", name),
      w.seg("Operation", [["replace", "Replace"], ["add", "Add"], ["subtract", "Subtract"], ["intersect", "Intersect"]], op, function (v) { op = v; })]);
    var dlg = w.modal("Save selection", body, [h("span", { "class": "grow" }), w.btn("Save", function () { dlg.close(); SX.saveSelection(target || null, op, name.value.trim().slice(0, 60) || null); }, "primary")]);
  }
  function loadDialog() {
    var list = chans(); if (!SX.need()) return;
    if (!list.length) { S3.toast("No saved selections yet: use Select › Save selection first", "error"); return; }
    var w = ED.ui.w, id = list[list.length - 1].id, op = "new", inv = false;
    var body = h("div", { "class": "stack" }, [w.select("Channel", list.map(function (L) { return [L.id, L.name]; }), id, function (v) { id = v; }), w.check("Invert", false, function (v) { inv = v; }),
      ED.doc.sel ? w.seg("Operation", [["new", "New"], ["add", "Add"], ["subtract", "Subtract"], ["intersect", "Intersect"]], op, function (v) { op = v; }) : null]);
    var dlg = w.modal("Load selection", body, [h("span", { "class": "grow" }), w.btn("Load", function () { dlg.close(); SX.loadSelection(id, op, inv); }, "primary")]);
  }
  SX.menu("Select", ["-", ["Save selection…", "", saveDialog, SX.hasSel], ["Load selection…", "", loadDialog, function () { return chans().length > 0; }]]);

  SX.tests.push(async function (ok) {
    var d = SX.scratch(20, 10, [PE.rasterFromCanvas(SX.solid(20, 10, "#fff"), "bg")]);
    d.sel = PE.makeSel(d, PIX.rectMask(20, 10, 0, 0, 5, 10));
    var C = SX.saveSelection(); ok(C && C.kind === "channel" && chans(d).length === 1 && d.layers[0] === C, "save selection as a channel");
    d.sel = PE.makeSel(d, PIX.rectMask(20, 10, 10, 0, 5, 10)); SX.saveSelection(C.id, "add");
    ED.deselect(); SX.loadSelection(C.id); ok(d.sel && SX.count(d.sel.m) === 100 && d.sel.m[2] === 255 && d.sel.m[12] === 255 && d.sel.m[7] === 0, "add to channel, load it back");
    SX.loadSelection(C.id, "new", true); ok(d.sel.m[7] === 255 && d.sel.m[2] === 0, "load inverted");
    ok(SX.px(PE.flatten(d), 2, 2).join() === "255,255,255,255", "channels never show in the picture");
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer())); ok(chans(od).length === 1 && chans(od)[0].name === C.name, "channels round-trip");
    ED.jump(0); ok(chans(d).length === 0, "undo save selection");
  });
})();
