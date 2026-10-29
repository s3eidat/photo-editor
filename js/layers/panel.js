/* Selection lane, Layers panel additions: grouped blend-mode menu with readable names, the Fill opacity slider,
   and blend-mode shortcuts (Shift+Alt+letter, Shift+plus/minus to step through modes). */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, SX = PE.sx, $ = S3.$, h = S3.h;

  function blendOptions(sel, withPass) {
    sel.textContent = "";
    if (withPass) sel.appendChild(h("option", { value: "pass", text: PIX.blendLabel("pass") }));
    PIX.BLEND_GROUPS.forEach(function (g) {
      var box = g[0] ? h("optgroup", { label: g[0] }) : sel;
      PIX.BLEND_LIST.slice(g[1], g[2]).forEach(function (m) { box.appendChild(h("option", { value: m[0], text: m[1] })); });
      if (box !== sel) sel.appendChild(box);
    });
  }
  SX.blendOptions = blendOptions;

  // ---------- Fill opacity slider (under Opacity) ----------
  var fillIn = null, fillOut = null, fB = null, fT = 0;
  function syncPanel() {
    var L = ED.layer(), sel = $("#layerBlend");
    if (sel) {
      var wantPass = !!(L && L.kind === "group");
      if (wantPass !== !!sel._pass || !sel._built) { blendOptions(sel, wantPass); sel._pass = wantPass; sel._built = true; }
      if (L) sel.value = L.blend;
    }
    if (!fillIn) return;
    var f = L ? SX.fillOf(L) : 1;
    fillIn.disabled = !L || L.kind === "group" || L.kind === "adjust";
    if (!fB) { fillIn.value = Math.round(f * 100); fillOut.textContent = Math.round(f * 100) + "%"; }
  }
  SX.syncPanel = syncPanel;
  document.addEventListener("DOMContentLoaded", function () {
    var op = $(".pe-lop"); if (!op) return;
    fillIn = h("input", { type: "range", id: "layerFill", min: "0", max: "100", step: "1", value: "100", "aria-label": "Fill opacity" });
    fillOut = h("output", { id: "layerFillOut", text: "100%" });
    var row = h("label", { "class": "pe-of pe-rng pe-lop pe-lfill", title: "Fill: the layer's own pixels, without its layer styles" }, [h("span", { text: "Fill" }), fillIn, fillOut]);
    op.parentNode.insertBefore(row, op.nextSibling);
    fillIn.addEventListener("input", function () {
      var L = ED.layer(); if (!L) return;
      if (!fB) fB = PE.snap(ED.doc);
      L.fillOp = +fillIn.value / 100; if (L.fillOp >= 1) delete L.fillOp;
      fillOut.textContent = fillIn.value + "%"; ED.render();
      clearTimeout(fT); fT = setTimeout(function () { var b = fB; fB = null; ED.push(PE.metaEntry("Fill opacity", ED.doc, b)); }, 400);
    });
    syncPanel();
    // Several picked layers: opacity, fill and blend mode change on all of them, in one undo step.
    var mB = null, mT = 0;
    function many() { var a = ED.layer(); return a && Object.keys(SX.picked).length ? SX.pickedList().filter(function (L) { return L.kind !== "qmask" && L.kind !== "channel"; }) : null; }
    function multi(input, label, set, live) {
      input.parentNode.addEventListener(live ? "input" : "change", function (e) {
        if (e.target !== input) return;
        var list = many(); if (!list || list.length < 2) return;
        e.stopPropagation();
        if (!live) { ED.meta(label, function () { list.forEach(function (L) { set(L, input.value); }); }); return; }
        if (!mB) mB = PE.snap(ED.doc);
        list.forEach(function (L) { set(L, input.value); }); ED.render();
        var out = input.parentNode.querySelector("output"); if (out) out.textContent = input.value + "%";
        clearTimeout(mT); mT = setTimeout(function () { var b = mB; mB = null; ED.push(PE.metaEntry(label, ED.doc, b)); }, 400);
      }, true);
    }
    multi($("#layerOp"), "Layer opacity", function (L, v) { L.opacity = +v / 100; }, true);
    multi(fillIn, "Fill opacity", function (L, v) { if (L.kind === "group" || L.kind === "adjust") return; L.fillOp = +v / 100; if (L.fillOp >= 1) delete L.fillOp; }, true);
    multi($("#layerBlend"), "Blend mode", function (L, v) { if (v === "pass" && L.kind !== "group") return; L.blend = v; }, false);
  });
  ED.on("changed", syncPanel); ED.on("layers", syncPanel);

  // ---------- shortcuts ----------
  var KEYS = { KeyI: "dissolve", KeyK: "darken", KeyM: "multiply", KeyB: "color-burn", KeyA: "linear-burn", KeyG: "lighten", KeyS: "screen", KeyD: "color-dodge",
    KeyW: "linear-dodge", KeyO: "overlay", KeyF: "soft-light", KeyH: "hard-light", KeyV: "vivid-light", KeyJ: "linear-light", KeyZ: "pin-light", KeyL: "hard-mix",
    KeyE: "difference", KeyX: "exclusion", KeyU: "hue", KeyT: "saturation", KeyC: "color", KeyY: "luminosity" };
  function paintTool() { var o = ED.o[ED.tool]; return !!(o && o.size != null); }   // painting tools keep these keys for their own modes
  function setBlend(L, m) { ED.meta("Blend mode", function () { L.blend = m; }); S3.toast("Blend mode: " + PIX.blendLabel(m)); }
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    var L = ED.layer(); if (!ED.doc || !L || paintTool() || e.ctrlKey || e.metaKey) return false;
    if (e.shiftKey && e.altKey && KEYS[e.code]) { e.preventDefault(); setBlend(L, KEYS[e.code]); return true; }
    if (e.shiftKey && !e.altKey && (e.key === "+" || e.key === "=" || e.key === "_" || e.key === "-")) {
      var list = (L.kind === "group" ? ["pass"] : []).concat(PE.BLENDS), i = list.indexOf(L.blend), dir = e.key === "+" || e.key === "=" ? 1 : -1;
      e.preventDefault(); setBlend(L, list[(i + dir + list.length) % list.length]); return true;
    }
    return false;
  });
})();

/* ---------- Layers panel as a tree (replaces ui.js renderLayers through ED.ui.layersExt) ---------- */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, SX = PE.sx, $ = S3.$, h = S3.h;
  var svg = function (id) { return ED.ui.w.svg(id); };
  var K = function (s) { return ED.ui.w.K(s); };

  // icons this lane needs, added to the page's sprite
  var ICONS = {
    "t-folder": '<path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    "t-folderopen": '<path d="M3.5 17.5V6.5a2 2 0 0 1 2-2h4l2 2.2h6a2 2 0 0 1 2 2v1.8"/><path d="M3.5 17.5 6 11.2a1.6 1.6 0 0 1 1.5-1h13.2l-2.8 8.3H3.5z"/>',
    "t-clipmark": '<path d="M7 4v9.5a3 3 0 0 0 3 3h8"/><path d="m15 13.5 3 3-3 3"/>',
    "t-fx": '<path d="M5 19c2.5 0 3-2 3.6-5.5L10 5.8c.4-2 1.4-2.8 3-2.8"/><path d="M6.5 10h6"/><path d="m14 10 6 9M20 10l-6 9"/>',
    "t-link": '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    "t-filter": '<path d="M4 5h16l-6.2 7.4v5.4l-3.6 1.7v-7.1z"/>',
    "t-close": '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
    "t-adj": '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>'
  };
  SX.addIcons(ICONS);

  // ---------- thumbnails (cached per layer by content version) ----------
  var TH = new WeakMap(), checker = null;
  function checkTile() { if (!checker) { checker = PE.mk(8, 8); var x = PE.cx2(checker); x.fillStyle = "#fff"; x.fillRect(0, 0, 8, 8); x.fillStyle = "#ccc"; x.fillRect(0, 0, 4, 4); x.fillRect(4, 4, 4, 4); } return checker; }
  function thumb(L, which) {
    var d = ED.doc, src = which === "mask" ? L.mask : (L.kind === "group" || L.kind === "adjust" ? null : PE.surface(L, d));
    var c = h("canvas", { "class": "pe-thumb", width: "44", height: "34" }), x = c.getContext("2d");
    if (!src) return c;
    var key = which + ":" + PE.ver(src.canvas) + ":" + src.x + ":" + src.y + ":" + d.w + "x" + d.h, hit = TH.get(src.canvas);
    if (hit && hit.key === key) { x.drawImage(hit.c, 0, 0); return c; }
    x.fillStyle = which === "mask" ? "#000" : x.createPattern(checkTile(), "repeat"); x.fillRect(0, 0, 44, 34);
    var k = Math.min(44 / d.w, 34 / d.h), ox = (44 - d.w * k) / 2, oy = (34 - d.h * k) / 2;
    x.setTransform(k, 0, 0, k, ox, oy); x.drawImage(src.canvas, src.x, src.y); x.setTransform(1, 0, 0, 1, 0, 0);
    var keep = PE.mk(44, 34); PE.cx2(keep).drawImage(c, 0, 0); TH.set(src.canvas, { key: key, c: keep });
    return c;
  }
  SX.thumb = thumb;
  SX.kindIcon = function (L) { return L.kind === "group" ? (L.open === false ? "t-folder" : "t-folderopen") : L.kind === "adjust" ? "t-adj" : null; };

  // ---------- rows ----------
  var dragId = null;
  function render() {
    var list = $("#layerList"); list.textContent = "";
    var d = ED.doc;
    $("#layerBlend").disabled = $("#layerOp").disabled = !d;
    if (!d) { list.appendChild(h("p", { "class": "faint pe-p", text: "No document open." })); return; }
    var L0 = ED.layer();
    if (L0) { $("#layerOp").value = Math.round(L0.opacity * 100); $("#layerOpOut").textContent = Math.round(L0.opacity * 100) + "%"; }
    SX.syncPanel();
    var G = SX.groupsApi, t = G.tree(), F = SX.layerFilter, n = 0;
    function real(L) { return !(SX.HELPER && SX.HELPER[L.kind]) && L.kind !== "qmask" && L.kind !== "channel"; }
    syncFilter(d);
    if (F.on && (F.q || F.kind)) {         // filtered: a flat list of the matches, groups' contents included
      var q = F.q.toLowerCase();
      G.topFirst(t, false).forEach(function (r) { var L = r.L; if (real(L) && (!F.kind || L.kind === F.kind) && (!q || L.name.toLowerCase().indexOf(q) >= 0)) { list.appendChild(row(L, 0, L0, t)); n++; } });
      if (!n) list.appendChild(h("p", { "class": "faint pe-p", text: "No layers match the filter." }));
      return;
    }
    G.topFirst(t, true).forEach(function (r) { if (real(r.L)) list.appendChild(row(r.L, r.depth, L0, t)); });
  }
  // ---------- filter (name / kind) ----------
  var KINDS = { raster: "Pixel", text: "Text", shape: "Shape", adjust: "Adjustment", fill: "Fill", smart: "Smart layer", group: "Group" };
  SX.layerFilter = { on: false, q: "", kind: "" };
  var fRow = null, fKind = null, fBtn = null;
  function syncFilter(d) {
    if (!fRow) return;
    var F = SX.layerFilter, have = {};
    fRow.hidden = !F.on; if (fBtn) { fBtn.setAttribute("aria-pressed", String(F.on)); fBtn.classList.toggle("on", F.on && !!(F.q || F.kind)); }
    d.layers.forEach(function (L) { if (!(SX.HELPER && SX.HELPER[L.kind]) && L.kind !== "qmask" && L.kind !== "channel") have[L.kind] = 1; });
    var opts = [["", "All"]].concat(Object.keys(have).map(function (k) { return [k, KINDS[k] || k.charAt(0).toUpperCase() + k.slice(1)]; }));
    if (F.kind && !have[F.kind]) opts.push([F.kind, KINDS[F.kind] || F.kind]);
    var sig = opts.map(function (o) { return o[0]; }).join();
    if (fKind.dataset.sig !== sig) { fKind.textContent = ""; opts.forEach(function (o) { fKind.appendChild(h("option", { value: o[0], text: o[1] })); }); fKind.dataset.sig = sig; }
    fKind.value = F.kind;
  }
  SX.toggleLayerFilter = function (on) {
    var F = SX.layerFilter; F.on = on == null ? !F.on : !!on;
    if (!F.on) { F.q = ""; F.kind = ""; if (fRow) fRow.querySelector("input").value = ""; }
    render(); if (F.on && fRow) fRow.querySelector("input").focus();
  };
  document.addEventListener("DOMContentLoaded", function () {
    var list = $("#layerList"), foot = $(".pe-lfoot"); if (!list || !foot) return;
    var F = SX.layerFilter, q = h("input", { type: "search", "class": "input pe-lfq", placeholder: "Filter layers by name", "aria-label": "Filter layers by name", maxlength: "100", dir: "auto" });
    fKind = h("select", { "class": "select pe-lfk", "aria-label": "Filter layers by kind" });
    q.addEventListener("input", S3.debounce(function () { F.q = q.value.trim(); render(); }, 120));
    q.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Escape") SX.toggleLayerFilter(false); });
    fKind.addEventListener("change", function () { F.kind = fKind.value; render(); });
    fRow = h("div", { "class": "pe-lfilter", hidden: true }, [q, fKind, h("button", { type: "button", "class": "btn ghost icon small", title: "Close the filter", "aria-label": "Close the layer filter", onclick: function () { SX.toggleLayerFilter(false); } }, [svg("t-close")])]);
    list.parentNode.insertBefore(fRow, list);
    fBtn = h("button", { type: "button", "class": "btn ghost icon small", id: "lFilter", title: "Filter layers by name or kind", "aria-label": "Filter layers", "aria-pressed": "false", onclick: function () { SX.toggleLayerFilter(); } }, [svg("t-filter")]);
    foot.insertBefore(fBtn, foot.firstChild);
  });
  function meta(L) {
    var parts = [];
    if (L.kind === "group" && L.blend !== "pass") parts.push(PIX.blendLabel(L.blend));
    else if (L.kind !== "group" && L.blend !== "normal") parts.push(PIX.blendLabel(L.blend));
    if (L.opacity < 1) parts.push(Math.round(L.opacity * 100) + "%");
    if (L.fillOp != null && L.fillOp < 1) parts.push("fill " + Math.round(L.fillOp * 100) + "%");
    if (SX.metaMore) SX.metaMore(L, parts);
    return parts.length ? h("span", { "class": "pe-lmeta", text: parts.join(" · ") }) : null;
  }
  function row(L, depth, L0, t) {
    var d = ED.doc, on = L === L0, picked = !!SX.picked[L.id] && !on;
    var eye = h("button", { type: "button", "class": "pe-lbtn", title: L.visible ? "Hide layer" : "Show layer", "aria-label": (L.visible ? "Hide " : "Show ") + L.name,
      onclick: function (e) { e.stopPropagation(); ED.meta(L.visible ? "Hide layer" : "Show layer", function () { L.visible = !L.visible; }); } }, [svg(L.visible ? "t-eye" : "t-eyeoff")]);
    var ind = h("span", { "class": "pe-lind" }); ind.style.width = (depth * 14) + "px";
    var tog = null;
    if (L.kind === "group") tog = h("button", { type: "button", "class": "pe-ltog", "aria-expanded": String(L.open !== false), "aria-label": (L.open === false ? "Expand " : "Collapse ") + L.name, title: L.open === false ? "Show the group's layers" : "Hide the group's layers",
      onclick: function (e) { e.stopPropagation(); L.open = L.open === false; render(); } }, [h("span", { "aria-hidden": "true", text: L.open === false ? "▸" : "▾" })]);
    var clip = L.clip ? h("span", { "class": "pe-lclip", title: "Clipped to the layer below" }, [svg("t-clipmark")]) : null;
    var icon = SX.kindIcon(L), th = h("button", { type: "button", "class": "pe-tb" + (on && !ED.maskEdit ? " on" : ""), title: K("Layer (Ctrl+click: select its pixels)"), "aria-label": "Layer thumbnail",
      onclick: function (e) { e.stopPropagation(); if (e.ctrlKey || e.metaKey) { ED.selFromLayer(L); return; } pick(L, e, false); } }, [icon ? h("span", { "class": "pe-kthumb" }, [svg(icon)]) : thumb(L)]);
    var mth = L.mask ? h("button", { type: "button", "class": "pe-tb pe-mtb" + (on && ED.maskEdit ? " on" : "") + (L.maskOn ? "" : " off"), title: "Layer mask: click to paint on it (Shift+click turns it on/off)", "aria-label": "Mask thumbnail",
      onclick: function (e) { e.stopPropagation(); if (e.shiftKey) { ED.meta("Toggle mask", function () { L.maskOn = !L.maskOn; }); return; } ED.setActive(L.id, true); } }, [thumb(L, "mask")]) : null;
    var nm = h("span", { "class": "pe-lname", text: L.name, title: "Double-click to rename" });
    nm.addEventListener("dblclick", function (e) { e.stopPropagation(); rename(L, nm); });
    var badges = h("span", { "class": "pe-lbadges" });
    if (L.fx && SX.fxOn && SX.fxOn(L)) badges.appendChild(h("button", { type: "button", "class": "pe-lfx", title: "Layer style (double-click to edit)", "aria-label": "Layer style", onclick: function (e) { e.stopPropagation(); if (SX.openStyle) SX.openStyle(L); } }, [svg("t-fx")]));
    if (L.link) badges.appendChild(h("span", { "class": "pe-llink", title: "Linked: moves with its linked layers" }, [svg("t-link")]));
    var lock = h("button", { type: "button", "class": "pe-lbtn" + (L.locked ? " lk" : ""), title: L.locked ? "Unlock layer" : "Lock layer", "aria-label": (L.locked ? "Unlock " : "Lock ") + L.name,
      onclick: function (e) { e.stopPropagation(); ED.meta(L.locked ? "Unlock layer" : "Lock layer", function () { L.locked = !L.locked; }); } }, [svg(L.locked ? "t-lock" : "t-unlock")]);
    var rowEl = h("div", { "class": "pe-layer" + (on ? " on" : "") + (picked ? " pk" : "") + (L.visible ? "" : " off") + (L.kind === "group" ? " grp" : "") + (L.clip ? " clp" : "") + (isBase(L, t) ? " cbase" : ""), draggable: "true", tabindex: "0", role: "option",
      "aria-selected": String(on || picked), "aria-level": String(depth + 1), "data-id": L.id }, [eye, ind, tog, clip, th, mth, h("span", { "class": "pe-lmid" }, [nm, meta(L)]), badges, lock]);
    rowEl.addEventListener("click", function (e) { pick(L, e, ED.maskEdit && L === L0); });
    rowEl.addEventListener("dblclick", function (e) { if (e.target === nm || nm.contains(e.target)) return; if (SX.openStyle && L.kind !== "adjust") SX.openStyle(L); });
    rowEl.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); rowEl.click(); } if (L.kind === "group" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); L.open = e.key === "ArrowRight"; render(); var r = $('.pe-layer[data-id="' + L.id + '"]'); if (r) r.focus(); } });
    rowEl.addEventListener("dragstart", function (e) { dragId = L.id; rowEl.classList.add("drag"); try { e.dataTransfer.setData("text/plain", L.id); e.dataTransfer.effectAllowed = "move"; } catch (x) {} });
    rowEl.addEventListener("dragend", function () { dragId = null; rowEl.classList.remove("drag"); clearOver(); });
    rowEl.addEventListener("dragover", function (e) { if (!dragId) return; e.preventDefault(); clearOver(); rowEl.classList.add(where(e, rowEl, L)); });
    rowEl.addEventListener("dragleave", function () { rowEl.classList.remove("over", "under", "into"); });
    rowEl.addEventListener("drop", function (e) {
      if (!dragId) return; e.preventDefault(); e.stopPropagation();
      var from = PE.findLayer(d, dragId), w = where(e, rowEl, L); clearOver(); if (!from || from === L) return;
      if (from.kind === "group" && SX.groupsApi.isInside(L, from, SX.tree(d))) { S3.toast("A group cannot go inside itself", "error"); return; }
      ED.meta("Move layer", function () { SX.groupsApi.place(d, from, L, w === "into" ? "in-top" : w === "over" ? "above" : "below"); });
      ED.emit("layers");
    });
    return rowEl;
  }
  function isBase(L, t) { if (L.clip) return false; var sib = SX.groupsApi.siblings(L, t), n = sib[sib.indexOf(L) + 1]; return !!(n && n.clip); }
  function where(e, el, L) { var r = el.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; if (L.kind === "group" && y > 0.28 && y < 0.72) return "into"; return y < 0.5 ? "over" : "under"; }
  function clearOver() { S3.$$(".pe-layer.over, .pe-layer.under, .pe-layer.into").forEach(function (x) { x.classList.remove("over", "under", "into"); }); }
  // Click: make active. Ctrl/Cmd+click: add/remove from the picked set. Shift+click: pick the range.
  function pick(L, e, mask) {
    var d = ED.doc;
    if (e && (e.ctrlKey || e.metaKey)) {
      if (SX.picked[L.id] && L.id !== d.active) { delete SX.picked[L.id]; render(); return; }
      if (d.active) SX.picked[d.active] = 1;
      SX.picked[L.id] = 1; ED.setActive(L.id, false); return;
    }
    if (e && e.shiftKey && d.active) {
      var order = SX.groupsApi.topFirst(SX.tree(d), true).map(function (r) { return r.L.id; }), a = order.indexOf(d.active), b = order.indexOf(L.id);
      SX.picked = {}; for (var i = Math.min(a, b); i <= Math.max(a, b); i++) SX.picked[order[i]] = 1;
      ED.setActive(L.id, false); return;
    }
    SX.picked = {}; ED.setActive(L.id, mask);
  }
  SX.renameLayer = function (L) { var el = document.querySelector('#layerList .pe-layer[data-id="' + L.id + '"] .pe-lname'); if (el) rename(L, el); };
  SX.pickLayer = pick;
  function rename(L, el) {
    var i = h("input", { "class": "input pe-rename", value: L.name, maxlength: "100", dir: "auto", "aria-label": "Layer name" });
    el.replaceWith(i); i.focus(); i.select();
    var done = false;
    function end(save) { if (done) return; done = true; var v = i.value.trim().slice(0, 100); if (save && v && v !== L.name) ED.meta("Rename layer", function () { L.name = v; }); else render(); }
    i.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") end(true); if (e.key === "Escape") end(false); });
    i.addEventListener("blur", function () { end(true); });
  }
  SX.tests.push(async function (ok) {
    var a = PE.rasterFromCanvas(SX.solid(2, 2, "#ff0000"), "Red sky"), b = PE.rasterFromCanvas(SX.solid(2, 2, "#00ff00"), "Green"), d = SX.scratch(2, 2, [a, b]);
    function shown() { render(); return Array.prototype.map.call(document.querySelectorAll("#layerList .pe-lname"), function (e) { return e.textContent; }); }
    SX.layerFilter.on = true; SX.layerFilter.q = "sky"; var one = shown();
    SX.toggleLayerFilter(false); var all = shown();
    ok(one.join() === "Red sky" && all.length === d.layers.length, "layer filter shows matching names only, closing shows all");
  });
  ED.ui.layersExt = render;
  SX.renderPanel = render;

  // footer: new group button
  document.addEventListener("DOMContentLoaded", function () {
    var foot = $(".pe-lfoot"), nl = $("#lNew"); if (!foot || !nl) return;
    var b = h("button", { type: "button", "class": "btn ghost icon small", id: "lGroup", title: K("New group (Ctrl+G groups the selected layers)"), "aria-label": "New group", onclick: function () { if (Object.keys(SX.picked).length) SX.groupLayers(); else SX.newGroup(); } }, [svg("t-folder")]);
    foot.insertBefore(b, nl.nextSibling);
  });

  // ---------- Properties for kinds this lane adds ----------
  SX.props = SX.props || {};
  ED.ui.propsKind = function (P, L) {
    var f = SX.props[L.kind]; if (!f) return false;
    f(P, L); return true;
  };
  SX.maskProps = function (P, L) {     // the layer-mask block, for this lane's kinds
    if (!L.mask) return;
    var w = ED.ui.w;
    P.appendChild(h("h3", { text: "Layer mask" }));
    P.appendChild(h("p", { "class": "faint pe-p", text: ED.maskEdit ? "You are painting the mask: black hides, white reveals." : "Click the mask thumbnail in Layers to paint on it." }));
    P.appendChild(h("div", { "class": "pe-prow" }, [w.check("Enabled", L.maskOn, function (v) { ED.meta(v ? "Enable mask" : "Disable mask", function () { L.maskOn = v; }); }),
      w.btn("Invert", function () { ED.maskOp("invert"); }, "ghost"), w.btn("Delete", function () { ED.maskOp("delete"); }, "ghost")]));
  };
  SX.props.group = function (P, L) {
    var w = ED.ui.w, n = SX.groupsApi.descendants(L).length;
    P.appendChild(h("div", { "class": "pe-phead" }, [svg("t-folder"), h("b", { text: L.name }), h("span", { "class": "faint", text: "Group" })]));
    P.appendChild(h("p", { "class": "faint pe-p", text: n + " layer" + (n === 1 ? "" : "s") + " inside. " + (L.blend === "pass" ? "Pass through: members blend with what is below the group." : "Members are blended together first, then the group blends as one.") }));
    P.appendChild(h("div", { "class": "pe-prow" }, [w.btn("Ungroup", function () { SX.ungroup(L); }, "ghost"), w.btn("Merge group", function () { SX.mergeGroup(L); }, "ghost"),
      L.mask ? null : w.btn("Add mask", function () { ED.LOPS.addMask(!!ED.doc.sel); }, "ghost", "t-mask")]));
    SX.maskProps(P, L);
  };
})();
