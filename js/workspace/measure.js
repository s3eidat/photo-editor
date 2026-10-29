/* Workspace (files lane): Ruler, Note and Count tools (grouped with the eyedropper: press I to cycle).
   Ruler: drag to measure distance and angle (Shift = 45° steps), drag an end to adjust, Alt+drag from an end for a
   protractor; Straighten layer turns the current layer so the line is level. Note: click to pin a note, click a note to
   edit, drag to move; listed in the Notes panel; saved in projects and PSD files. Count: click to number things in
   colour groups, Alt+click removes, drag moves; saved in projects. Notes and counts are never part of exported images. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, h = S3.h, W = ED.ui.w;
  var MS = WS.measure = { line: null };
  var RAD = Math.PI / 180;

  // ---------- tool icons + registration ----------
  var ICONS = {
    ruler: '<path d="M3.5 15.5 15.5 3.5l5 5-12 12z"/><path d="m7 12 2 2M9.5 9.5l1.5 1.5M12 7l2 2M14.5 4.5 16 6"/>',
    note: '<path d="M5 3.5h10l4 4v13H5z"/><path d="M15 3.5v4h4M8 11h8M8 14.5h8M8 18h5"/>',
    count: '<circle cx="8" cy="8" r="3.5"/><circle cx="16.5" cy="16" r="3.5"/><path d="M7.4 7 8 6.4v3.2M15.3 15h2l-2 2.2h2.1"/>'
  };
  (function () {
    var sp = document.querySelector("body > svg"); if (!sp) return;
    Object.keys(ICONS).forEach(function (k) {
      var s = document.createElementNS("http://www.w3.org/2000/svg", "symbol"); s.setAttribute("id", "t-" + k); s.setAttribute("viewBox", "0 0 24 24");
      s.innerHTML = ICONS[k];      // constant markup defined above, never user input
      sp.appendChild(s);
    });
  })();
  var T = ED.ui.TOOLS, ei = T.findIndex(function (t) { return t[0] === "eyedropper"; });
  T.splice(ei + 1, 0, ["ruler", "Ruler (measure, straighten)", "I"], ["note", "Note", "I"], ["count", "Count", "I"]);
  var GROUP = ["eyedropper", "ruler", "note", "count"];
  WS.key(function (e) { return !WS.ctrl(e) && !e.altKey && e.key.toLowerCase() === "i" && GROUP.indexOf(ED.tool) >= 0; }, function (e) {
    var i = GROUP.indexOf(ED.tool); ED.setTool(GROUP[(i + (e.shiftKey ? GROUP.length - 1 : 1)) % GROUP.length]);
  });
  function scr(p) { return ED.toScr(p.x, p.y); }
  function near(p, q, px) { return q && Math.hypot(p.x - q.x, p.y - q.y) * ED.zoom <= (px || 8); }

  // ---------- ruler ----------
  MS.info = function (L) {
    L = L || MS.line; if (!L) return null;
    var dx = L.b.x - L.a.x, dy = L.b.y - L.a.y, len = Math.hypot(dx, dy), ang = -Math.atan2(dy, dx) / RAD, out = { x: L.a.x, y: L.a.y, w: dx, h: dy, len: len, angle: ang };
    if (L.c) { var a1 = Math.atan2(L.b.y - L.a.y, L.b.x - L.a.x), a2 = Math.atan2(L.c.y - L.a.y, L.c.x - L.a.x), d = Math.abs(a1 - a2) / RAD; out.prot = d > 180 ? 360 - d : d; out.len2 = Math.hypot(L.c.x - L.a.x, L.c.y - L.a.y); }
    return out;
  };
  MS.summary = function () {
    var i = MS.info(); if (!i) return "";
    return i.prot != null ? "Angle " + i.prot.toFixed(1) + "°   L1 " + WS.fmt(i.len, null, "x") + "   L2 " + WS.fmt(i.len2, null, "x") : "Length " + WS.fmt(i.len, null, "x") + "   Angle " + i.angle.toFixed(1) + "°   W " + WS.fmt(Math.abs(i.w), null, "x") + "   H " + WS.fmt(Math.abs(i.h), null, "y");
  };
  function snap45(a, p) { var ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(p.x - a.x, p.y - a.y); return { x: a.x + Math.cos(ang) * l, y: a.y + Math.sin(ang) * l }; }
  ED.TOOLS.ruler = {
    down: function (p, e) {
      var L = MS.line;
      if (L && e.altKey && (near(p, L.a) || near(p, L.b))) { if (near(p, L.b)) { var t = L.a; L.a = L.b; L.b = t; } L.c = { x: p.x, y: p.y }; ED.drag = { kind: "ruler", which: "c" }; return; }
      if (L && near(p, L.c)) { ED.drag = { kind: "ruler", which: "c" }; return; }
      if (L && near(p, L.b)) { ED.drag = { kind: "ruler", which: "b" }; return; }
      if (L && near(p, L.a)) { ED.drag = { kind: "ruler", which: "a" }; return; }
      MS.line = { a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y }, c: null }; ED.drag = { kind: "ruler", which: "b" };
    },
    move: function (p, e) {
      var L = MS.line, w = ED.drag.which, o = w === "a" ? L.b : L.a;
      L[w] = e.shiftKey ? snap45(o, p) : { x: p.x, y: p.y };
      ED.ui.buildOpts();
    },
    up: function () { ED.drag = null; var L = MS.line; if (L && !L.c && Math.hypot(L.b.x - L.a.x, L.b.y - L.a.y) * ED.zoom < 2) MS.line = null; ED.ui.buildOpts(); ED.renderOvl(); }
  };
  MS.straighten = function () {
    var i = MS.info(), L = ED.layer(); if (!i || !L) { S3.toast("Draw a line along something that should be level first"); return; }
    if (!ED.editable(L)) return;
    var a = i.angle; if (Math.abs(a) > 45) a = a > 0 ? a - 90 : a + 90;          // nearer to vertical: make it plumb
    var b = L.kind === "raster" ? (window.PIX.alphaBounds(PE.getData(L.canvas)) || { x: 0, y: 0, w: L.canvas.width, h: L.canvas.height }) : null;
    var c = b ? { x: L.x + b.x + b.w / 2, y: L.y + b.y + b.h / 2 } : { x: ED.doc.w / 2, y: ED.doc.h / 2 };
    var m = PE.mTRS({ cx: c.x, cy: c.y, rot: a });
    try { ED.meta("Straighten layer", function () { ED.transformLayer(L, m, null); }); } catch (err) { S3.toast(err.message, "error"); return; }
    MS.line = null; ED.ui.buildOpts(); ED.renderOvl();
  };

  // ---------- counts ----------
  var COLORS = ["#e5484d", "#3e63dd", "#30a46c", "#f5a524", "#8e4ec6", "#00a2c7", "#d6409f", "#6f6f6f"];
  function counts(d) { d = d || ED.doc; if (!d.countGroups || !d.countGroups.length) d.countGroups = [{ name: "Count group 1", color: COLORS[0], on: true }]; if (!d.counts) d.counts = []; return d; }
  MS.group = 0;
  function cHit(p) { var d = ED.doc, L = d.counts || []; for (var i = L.length - 1; i >= 0; i--) if (near(p, L[i], 9)) return i; return -1; }
  ED.TOOLS.count = {
    down: function (p, e) {
      var d = counts(), i = cHit(p);
      if (i >= 0 && e.altKey) { WS.edit("Delete count", "counts", function (dd) { dd.counts = dd.counts.filter(function (x, k) { return k !== i; }); }); ED.ui.buildOpts(); return; }
      if (i >= 0) { var before = PE.clone(d.counts); ED.drag = { kind: "count", i: i, before: before, moved: false }; return; }
      if (e.altKey) return;
      WS.edit("Count", "counts", function (dd) { dd.counts = (dd.counts || []).concat([{ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, g: MS.group }]); });
      ED.ui.buildOpts();
    },
    move: function (p) { var dr = ED.drag, d = ED.doc; d.counts[dr.i] = Object.assign({}, d.counts[dr.i], { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }); dr.moved = true; ED.renderOvl(); },
    up: function () { var dr = ED.drag; ED.drag = null; if (!dr || !dr.moved) return; var d = ED.doc, after = PE.clone(d.counts); d.counts = dr.before; WS.edit("Move count", "counts", function (dd) { dd.counts = after; }); }
  };

  // ---------- notes ----------
  function nHit(p) { var L = (ED.doc && ED.doc.notes) || []; for (var i = L.length - 1; i >= 0; i--) { var s = scr(L[i]), q = scr(p); if (q.x >= s.x - 2 && q.x <= s.x + 22 && q.y >= s.y - 2 && q.y <= s.y + 24) return i; } return -1; }
  MS.author = function () { return String(S3.store("pe-author") || (FX.exp && FX.exp.settings().artist) || "").slice(0, 80); };
  ED.TOOLS.note = {
    down: function (p) {
      var d = ED.doc, i = nHit(p);
      if (i >= 0) { ED.drag = { kind: "note", i: i, p0: p, n0: Object.assign({}, d.notes[i]), moved: false }; return; }
      var n = { x: Math.round(p.x), y: Math.round(p.y), text: "", author: MS.author(), color: "#f5c518", date: new Date().toISOString() };
      d.notes = (d.notes || []).concat([n]); ED.renderOvl();          // recorded in history once it has text
      MS.editNote(d.notes.length - 1, true);
    },
    move: function (p) { var dr = ED.drag, n = ED.doc.notes[dr.i]; if (!n) return; if (Math.hypot(p.x - dr.p0.x, p.y - dr.p0.y) * ED.zoom > 3) dr.moved = true; n.x = Math.round(dr.n0.x + p.x - dr.p0.x); n.y = Math.round(dr.n0.y + p.y - dr.p0.y); ED.renderOvl(); },
    up: function () {
      var dr = ED.drag; ED.drag = null; if (!dr) return; var d = ED.doc;
      if (!dr.moved) { MS.editNote(dr.i); return; }
      var to = { x: d.notes[dr.i].x, y: d.notes[dr.i].y }; d.notes[dr.i] = dr.n0;
      WS.edit("Move note", "notes", function (dd) { dd.notes = dd.notes.map(function (n, k) { return k === dr.i ? Object.assign({}, n, to) : n; }); });
    }
  };
  var pop = null;
  MS.editNote = function (i, fresh) {
    var d = ED.doc, n = d.notes[i]; if (!n) return;
    if (pop) pop.close();
    var ta = h("textarea", { "class": "textarea", rows: "5", dir: "auto", maxlength: "4000", "aria-label": "Note text" }); ta.value = n.text || "";
    var au = h("input", { "class": "input", maxlength: "80", dir: "auto", value: n.author || "", "aria-label": "Author" }), col = h("input", { type: "color", value: PE.hex(n.color, "#f5c518"), "aria-label": "Note colour" });
    var box = h("div", { "class": "ws-notepop", role: "dialog", "aria-label": "Note" }, [h("div", { "class": "row between" }, [h("b", { text: "Note " + (i + 1) }), h("span", { "class": "faint", text: n.date ? new Date(n.date).toLocaleString() : "" })]), ta,
      h("div", { "class": "pe-prow" }, [au, col]),
      h("div", { "class": "pe-prow" }, [W.btn("Delete", function () { close(); WS.edit("Delete note", "notes", function (dd) { dd.notes = dd.notes.filter(function (x, k) { return k !== i; }); }); }, "ghost", "i-trash"), h("span", { "class": "grow" }), W.btn("Done", function () { close(); }, "primary")])]);
    var s = scr(n), sr = ED.stage.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(sr.width - 290, s.x + 26)) + "px"; box.style.top = Math.max(8, Math.min(sr.height - 250, s.y)) + "px";
    ED.stage.appendChild(box); setTimeout(function () { ta.focus(); }, 0);
    ["pointerdown", "keydown", "wheel"].forEach(function (ev) { box.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    box.addEventListener("keydown", function (e) { if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); close(); } });
    var done = false;
    function close() {
      if (done) return; done = true; box.remove(); pop = null;
      var t = ta.value.slice(0, 4000), a = au.value.trim().slice(0, 80), c = col.value;
      if (a) S3.store("pe-author", a);
      if (!ED.doc.notes[i]) return;
      if (fresh) {
        ED.doc.notes = ED.doc.notes.filter(function (x, k) { return k !== i; });
        if (t.trim()) WS.edit("New note", "notes", function (dd) { dd.notes = dd.notes.concat([Object.assign({}, n, { text: t, author: a, color: c })]); }); else ED.renderOvl();
        if (NP.isOpen && NP.isOpen()) renderNotes();
        return;
      }
      if (t !== n.text || a !== n.author || c !== n.color) WS.edit("Edit note", "notes", function (dd) { dd.notes = dd.notes.map(function (x, k) { return k === i ? Object.assign({}, x, { text: t, author: a, color: c }) : x; }); });
      if (NP.isOpen && NP.isOpen()) renderNotes();
    }
    pop = { close: close };
  };

  // ---------- overlay ----------
  function label(c, x, y, s) { c.font = "11px " + (getComputedStyle(document.documentElement).getPropertyValue("--mono") || "monospace"); var w = c.measureText(s).width + 8; c.fillStyle = "rgba(0,0,0,.75)"; c.fillRect(x, y - 12, w, 16); c.fillStyle = "#fff"; c.fillText(s, x + 4, y); }
  (ED.ovlExt = ED.ovlExt || []).push(function (c) {
    var d = ED.doc; if (!d) return;
    // counts
    if (d.counts && d.counts.length) {
      var grp = d.countGroups || [], idx = {};
      d.counts.forEach(function (q) {
        var g = grp[q.g] || grp[0] || { color: COLORS[0], on: true }; if (g.on === false) return;
        idx[q.g] = (idx[q.g] || 0) + 1; var s = scr(q);
        c.fillStyle = g.color; c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, 4, 0, Math.PI * 2); c.fill(); c.stroke();
        c.font = "bold 12px sans-serif"; c.lineWidth = 3; c.strokeStyle = "rgba(255,255,255,.9)"; c.strokeText(String(idx[q.g]), s.x + 6, s.y - 5); c.fillText(String(idx[q.g]), s.x + 6, s.y - 5);
      });
    }
    // notes
    (d.notes || []).forEach(function (n) {
      var s = scr(n); c.fillStyle = PE.hex(n.color, "#f5c518"); c.strokeStyle = "rgba(0,0,0,.6)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + 15, s.y); c.lineTo(s.x + 20, s.y + 5); c.lineTo(s.x + 20, s.y + 22); c.lineTo(s.x, s.y + 22); c.closePath(); c.fill(); c.stroke();
      c.strokeStyle = "rgba(0,0,0,.45)"; c.beginPath(); c.moveTo(s.x + 4, s.y + 9); c.lineTo(s.x + 16, s.y + 9); c.moveTo(s.x + 4, s.y + 13); c.lineTo(s.x + 16, s.y + 13); c.moveTo(s.x + 4, s.y + 17); c.lineTo(s.x + 12, s.y + 17); c.stroke();
    });
    // ruler line
    var L = MS.line; if (!L) return;
    var a = scr(L.a), b = scr(L.b);
    function seg(p, q) { c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.lineWidth = 3; c.strokeStyle = "rgba(255,255,255,.9)"; c.stroke(); c.lineWidth = 1.2; c.strokeStyle = "#111"; c.stroke(); }
    function end(p) { c.lineWidth = 1.2; c.strokeStyle = "#111"; c.beginPath(); c.moveTo(p.x - 6, p.y); c.lineTo(p.x + 6, p.y); c.moveTo(p.x, p.y - 6); c.lineTo(p.x, p.y + 6); c.stroke(); }
    seg(a, b); end(a); end(b);
    if (L.c) { var cc = scr(L.c); seg(a, cc); end(cc); var r = 24, a1 = Math.atan2(b.y - a.y, b.x - a.x), a2 = Math.atan2(cc.y - a.y, cc.x - a.x); c.beginPath(); c.arc(a.x, a.y, r, a1, a2, ((a2 - a1 + 2 * Math.PI) % (2 * Math.PI)) > Math.PI); c.strokeStyle = "#111"; c.lineWidth = 1; c.stroke(); }
    var i = MS.info(); label(c, b.x + 10, b.y + 18, i.prot != null ? i.prot.toFixed(1) + "°" : WS.fmt(i.len, null, "x") + "  " + i.angle.toFixed(1) + "°");
  });

  // ---------- options bar ----------
  (ED.ui.optsTail = ED.ui.optsTail || []).push(function (t, items) {
    if (t === "ruler") {
      var i = MS.info();
      items.push(h("span", { "class": "pe-hint mono ws-rinfo", text: i ? MS.summary() : "Drag to measure. Shift: 45° steps. Alt+drag an end: protractor." }));
      if (i) items.push(W.btn("Straighten layer", MS.straighten, "", null, "Rotate the current layer so this line is level (or plumb)"), W.btn("Clear", function () { MS.line = null; ED.ui.buildOpts(); ED.renderOvl(); }, "ghost"));
    } else if (t === "count" && ED.doc) {
      var d = counts(), g = d.countGroups;
      if (MS.group >= g.length) MS.group = 0;
      var sel = W.select("Group", g.map(function (x, k) { return [String(k), x.name + " (" + d.counts.filter(function (q) { return q.g === k; }).length + ")"]; }), String(MS.group), function (v) { MS.group = +v; ED.ui.buildOpts(); });
      var col = h("input", { type: "color", "class": "ws-ccol", value: g[MS.group] ? g[MS.group].color : COLORS[0], "aria-label": "Group colour" });
      col.addEventListener("change", function () { var k = MS.group, v = col.value; WS.edit("Count group colour", "countGroups", function (dd) { dd.countGroups = dd.countGroups.map(function (x, j) { return j === k ? Object.assign({}, x, { color: v }) : x; }); }); });
      items.push(sel, col, W.btn("New group", function () { if (g.length >= 20) return; WS.edit("New count group", "countGroups", function (dd) { dd.countGroups = dd.countGroups.concat([{ name: "Count group " + (dd.countGroups.length + 1), color: COLORS[dd.countGroups.length % COLORS.length], on: true }]); }); MS.group = ED.doc.countGroups.length - 1; ED.ui.buildOpts(); }, "ghost"),
        W.btn("Clear", function () { var k = MS.group; WS.edit("Clear count", "counts", function (dd) { dd.counts = dd.counts.filter(function (q) { return q.g !== k; }); }); ED.ui.buildOpts(); }, "ghost"),
        h("span", { "class": "pe-hint", text: "Total " + d.counts.length + ". Click to count, Alt+click removes, drag moves." }));
    } else if (t === "note") {
      items.push(h("span", { "class": "pe-hint", text: "Click to add a note, click a note to edit it, drag to move. Notes are kept in projects and PSD files, never in exported images." }), W.btn("Notes panel", function () { WS.panels.show("notes", true); }, "ghost"));
    }
  });
  ED.on("changed", function () { if (ED.tool === "count") ED.ui.buildOpts(); });

  // ---------- notes panel ----------
  var listEl = null;
  function renderNotes() {
    if (!listEl) return; listEl.textContent = "";
    var d = ED.doc, L = (d && d.notes) || [];
    if (!L.length) { listEl.appendChild(h("p", { "class": "faint pe-p", text: d ? "No notes. Pick the Note tool (I) and click the image." : "No document." })); return; }
    L.forEach(function (n, i) {
      var row = h("button", { type: "button", "class": "ws-nrow" }, [h("span", { "class": "ws-ndot" }), h("span", { "class": "ws-ntext", dir: "auto", text: (n.text || "(empty)").replace(/\s+/g, " ").slice(0, 120) }), h("span", { "class": "faint", text: n.author || "" })]);
      row.firstChild.style.background = PE.hex(n.color, "#f5c518");
      row.addEventListener("click", function () { var s = ED.stage.getBoundingClientRect(); ED.fitted = null; ED.panX = s.width / 2 - n.x * ED.zoom; ED.panY = s.height / 2 - n.y * ED.zoom; ED.render(); ED.renderOvl(); ED.emit("view"); MS.editNote(i); });
      listEl.appendChild(row);
    });
  }
  var NP = WS.panel({ id: "notes", title: "Notes", open: true, shown: false, build: function (body) { listEl = h("div", { "class": "ws-nlist" }); body.appendChild(listEl); renderNotes(); }, update: function (why) { if (why !== "cursor" && why !== "view") renderNotes(); } });
  ED.on("ws", function (k) { if (k === "notes") renderNotes(); });

  // ---------- saved in projects ----------
  function cleanNotes(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 500).map(function (n) {
      if (!n || typeof n !== "object") return null; var x = WS.num(n.x, -1e5, 1e5), y = WS.num(n.y, -1e5, 1e5); if (x == null || y == null) return null;
      return { x: x, y: y, text: typeof n.text === "string" ? n.text.slice(0, 4000) : "", author: typeof n.author === "string" ? n.author.slice(0, 80) : "", color: PE.hex(n.color, "#f5c518"), date: typeof n.date === "string" && !isNaN(Date.parse(n.date)) ? n.date.slice(0, 40) : "" };
    }).filter(Boolean);
  }
  MS.cleanNotes = cleanNotes;
  WS.fields.notes = { save: function (d) { return d.notes && d.notes.length ? d.notes : undefined; }, open: function (raw, d) { var v = cleanNotes(raw); if (v.length) d.notes = v; } };
  WS.fields.counts = {
    save: function (d) { return d.counts && d.counts.length ? { groups: d.countGroups || [], items: d.counts } : undefined; },
    open: function (raw, d) {
      if (!raw || typeof raw !== "object") return;
      var g = (Array.isArray(raw.groups) ? raw.groups : []).slice(0, 20).map(function (x) { return { name: typeof (x && x.name) === "string" ? x.name.slice(0, 60) : "Count group", color: PE.hex(x && x.color, COLORS[0]), on: !(x && x.on === false) }; });
      var it = (Array.isArray(raw.items) ? raw.items : []).slice(0, 5000).map(function (q) { var x = WS.num(q && q.x, -1e5, 1e5), y = WS.num(q && q.y, -1e5, 1e5), gg = Math.round(WS.num(q && q.g, 0, Math.max(0, g.length - 1)) || 0); return x == null || y == null ? null : { x: x, y: y, g: gg }; }).filter(Boolean);
      if (it.length) { d.counts = it; d.countGroups = g.length ? g : null; counts(d); }
    }
  };
  ED.on("changed", function (why) { if (why === "open" || why === "switch") { MS.line = null; if (pop) pop.close(); } });

  FX.tests.push(async function (ok, near2) {
    var i = MS.info({ a: { x: 0, y: 0 }, b: { x: 30, y: -40 }, c: null }); ok(near2(i.len, 50, 1e-9) && near2(i.angle, 53.13, 0.01), "ruler length and angle");
    var p = MS.info({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 0, y: 10 } }); ok(near2(p.prot, 90, 1e-9), "protractor angle");
    var keep = { doc: ED.doc, hist: ED.hist }, d = PE.newDoc(200, 100, "m"); d.layers = [PE.rasterFromCanvas(PE.mk(200, 100), "b")]; ED.doc = d; ED.hist = new PE.History(1e8, 60);
    MS.group = 0; ED.TOOLS.count.down({ x: 10, y: 10 }, {}); ED.TOOLS.count.down({ x: 50, y: 20 }, {}); ok(d.counts.length === 2, "count adds markers");
    ED.TOOLS.count.down({ x: 10.5, y: 10 }, { altKey: true }); ok(d.counts.length === 1, "Alt+click removes a count");
    ED.undo(); ok(d.counts.length === 2, "counting is undoable");
    d.notes = [{ x: 5, y: 6, text: "Hello <b>", author: "A", color: "#ff0000", date: new Date().toISOString() }];
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer()));
    ok(od.notes && od.notes[0].text === "Hello <b>" && od.counts && od.counts.length === 2 && od.countGroups.length === 1, "notes and counts saved in projects");
    ok(cleanNotes([{ x: "a" }, { x: 1, y: 2, text: 5, color: "red" }, null]).length === 1 && cleanNotes([{ x: 1, y: 2, color: "red" }])[0].color === "#f5c518", "notes validated");
    // straighten: a raster bar tilted 30° comes back level
    var bar = PE.mk(120, 10), bx = PE.cx2(bar); bx.fillStyle = "#000"; bx.fillRect(0, 0, 120, 10);
    var L = PE.rasterFromCanvas(PE.touch(bar), "bar", 40, 45); d.layers = [L]; d.active = L.id;
    ED.transformLayer(L, PE.mTRS({ cx: 100, cy: 50, rot: -30 }), null);
    MS.line = { a: { x: 100 - 50 * Math.cos(30 * RAD), y: 50 + 50 * Math.sin(30 * RAD) }, b: { x: 100 + 50 * Math.cos(30 * RAD), y: 50 - 50 * Math.sin(30 * RAD) }, c: null };
    MS.straighten(); var ab = window.PIX.alphaBounds(PE.getData(L.canvas));
    ok(ab && ab.h < 20 && ab.w > 110, "straighten layer levels it (" + (ab && ab.w + "x" + ab.h) + ")");
    ED.doc = keep.doc; ED.hist = keep.hist;
  });
})();
