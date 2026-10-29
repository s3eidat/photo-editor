/* Photo Editor paint lane: the side panel with tabs (Swatches, Brushes, Patterns, Gradients) and the swatches.
   Swatches: click = foreground, Ctrl/Cmd+click = background, Alt+click = delete, + adds the foreground.
   Import .aco / .gpl palettes, export .gpl / .aco. Stored in this browser only. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX, K = ED.ui.kit, h = S3.h;

  // ---------- tabbed panel ----------
  var TABS = [], panel = null, bodyEl = null, tabBar = null;
  PP.panelTab = function (id, title, build, first) { var t = { id: id, title: title, build: build }; if (first) TABS.unshift(t); else TABS.push(t); if (panel) renderTabs(); };
  function current() { var t = S3.store("pe-ptab"); return TABS.some(function (x) { return x.id === t; }) ? t : TABS.length ? TABS[0].id : null; }
  function renderTabs() {
    tabBar.textContent = "";
    var cur = current();
    TABS.forEach(function (t) {
      var b = h("button", { type: "button", role: "tab", "class": "pp-tab", "aria-selected": String(t.id === cur), text: t.title });
      b.addEventListener("click", function () { S3.store("pe-ptab", t.id); renderTabs(); });
      tabBar.appendChild(b);
    });
    PP.refreshPanel();
  }
  PP.refreshPanel = function (only) {
    if (!bodyEl) return;
    var cur = current(); if (only && only !== cur) return;
    var t = TABS.filter(function (x) { return x.id === cur; })[0];
    bodyEl.textContent = ""; if (t) t.build(bodyEl);
  };
  PP.ready.push(function () {
    var side = document.querySelector(".pe-side"); if (!side) return;
    tabBar = h("div", { "class": "pp-tabs", role: "tablist" });
    bodyEl = h("div", { "class": "pp-pbody" });
    panel = h("details", { "class": "pe-panel pp-panel", open: S3.store("pe-ppanel") !== false }, [h("summary", { text: "Paint" }), tabBar, bodyEl]);
    panel.addEventListener("toggle", function () { S3.store("pe-ppanel", panel.open); });
    var lp = side.querySelector(".pe-lpanel");
    side.insertBefore(panel, lp || null);
    renderTabs();
  });

  // ---------- swatches ----------
  function defaults() {
    var out = [], i;
    for (i = 0; i <= 10; i++) { var v = Math.round(255 * (1 - i / 10)); out.push({ c: PE.toHex(v, v, v), n: i === 0 ? "White" : i === 10 ? "Black" : (100 - i * 10) + "% grey" }); }
    var hues = [0, 15, 30, 45, 60, 90, 120, 160, 180, 200, 220, 240, 270, 300, 330];
    [[100, 100], [60, 100], [100, 65], [35, 90], [100, 40]].forEach(function (sb) {
      hues.forEach(function (hh) { var c = PPX.hsb2rgb(hh, sb[0], sb[1]); out.push({ c: PE.toHex(c[0], c[1], c[2]), n: "" }); });
    });
    ["#f2d0b5", "#e0ac8a", "#c68863", "#8d5a3b", "#5a3825"].forEach(function (c) { out.push({ c: c, n: "Skin tone" }); });
    return out;
  }
  var SW = null;
  function load() {
    if (SW) return Promise.resolve(SW);
    return PP.lib.all("swatches").then(function (a) { SW = a[0] && Array.isArray(a[0].list) ? a[0].list : defaults(); return SW; }).catch(function () { SW = defaults(); return SW; });
  }
  function save() { return PP.lib.put({ id: "swatches", kind: "swatches", list: SW }).catch(function () {}); }
  function clean(list) {
    return list.filter(function (s) { return s && PE.hex(s.c, null); }).slice(0, 2000).map(function (s) { return { c: PE.hex(s.c, "#000000"), n: String(s.n || "").replace(/[\u0000-\u001f]/g, " ").slice(0, 60) }; });
  }
  PP.swatches = function () { return load(); };
  PP.addSwatch = function (hex, name) {
    return load().then(function () { SW.push({ c: PE.hex(hex, "#000000"), n: name || "" }); return save(); }).then(function () { PP.refreshPanel("swatches"); S3.toast("Added " + hex + " to the swatches"); });
  };
  var RECENT = (S3.store("pe-recent-colors") || []).filter(function (c) { return PE.hex(c, null); }).slice(0, 12);
  PP.recent = function (hex) { RECENT = [hex].concat(RECENT.filter(function (c) { return c !== hex; })).slice(0, 12); S3.store("pe-recent-colors", RECENT); PP.refreshPanel("swatches"); };
  ED.on("colors", function () { if (ED.doc) { var f = ED.doc.fg; if (RECENT[0] !== f) PP.recent(f); } });

  function chip(s, onClick, title) {
    var b = h("button", { type: "button", "class": "pp-sw", title: title, "aria-label": title });
    b.style.background = s.c;
    b.addEventListener("click", function (e) { onClick(e); });
    return b;
  }
  function setColor(c, bg) { if (!ED.doc) { S3.toast("Open a photo or make a new document first"); return; } if (bg) ED.doc.bg = c; else ED.doc.fg = c; ED.emit("colors"); ED.emit("tool"); }
  function buildSwatches(el) {
    var grid = h("div", { "class": "pp-swgrid", role: "list" }), rec = h("div", { "class": "pp-swrow" });
    el.appendChild(h("div", { "class": "pp-sub" }, [h("span", { "class": "faint", text: "Recent" })]));
    el.appendChild(rec);
    RECENT.forEach(function (c) { rec.appendChild(chip({ c: c }, function (e) { setColor(c, e.ctrlKey || e.metaKey); }, c)); });
    el.appendChild(grid);
    load().then(function () {
      SW.forEach(function (s, i) {
        grid.appendChild(chip(s, function (e) {
          if (e.altKey) { SW.splice(i, 1); save(); PP.refreshPanel("swatches"); return; }
          setColor(s.c, e.ctrlKey || e.metaKey);
        }, (s.n ? s.n + " " : "") + s.c + " — click: foreground, " + K.K("Ctrl") + "+click: background, Alt+click: delete"));
      });
      var add = h("button", { type: "button", "class": "pp-sw pp-swadd", title: "Add the foreground colour", "aria-label": "Add the foreground colour" }, [K.svg("i-plus")]);
      add.addEventListener("click", function () { if (ED.doc) PP.addSwatch(ED.doc.fg); });
      grid.appendChild(add);
    });
    var file = h("input", { type: "file", accept: ".aco,.gpl,.txt", hidden: true });
    file.addEventListener("change", function () {
      var f = file.files[0]; file.value = ""; if (!f) return;
      if (f.size > 4e6) { S3.toast("That file is too large for a palette", "error"); return; }
      f.arrayBuffer().then(function (ab) {
        var u8 = new Uint8Array(ab), list = /\.aco$/i.test(f.name) ? PP.readAco(u8) : PP.readGpl(new TextDecoder().decode(u8));
        list = clean(list);
        if (!list.length) throw new Error("No colours found in " + f.name);
        return load().then(function () { SW = SW.concat(list); return save(); }).then(function () { PP.refreshPanel("swatches"); S3.toast("Imported " + list.length + " colours"); });
      }).catch(function (e) { S3.toast(e.message, "error"); });
    });
    el.appendChild(h("div", { "class": "pp-acts" }, [file,
      K.btn("Import", function () { file.click(); }, "ghost", null, "Import an .aco or .gpl palette"),
      K.btn("Export", function () { load().then(function () { S3.download(PP.writeGpl(SW, "Photo Editor swatches"), "swatches.gpl", "text/plain"); }); }, "ghost", null, "Save the swatches as a .gpl palette"),
      K.btn(".aco", function () { load().then(function () { S3.download(PP.writeAco(SW), "swatches.aco", "application/octet-stream"); }); }, "ghost", null, "Save the swatches as an .aco palette"),
      K.btn("Reset", function () { SW = defaults(); save(); PP.refreshPanel("swatches"); }, "ghost", null, "Back to the default swatches")]));
  }
  PP.panelTab("swatches", "Swatches", buildSwatches);

  // ---------- palette files ----------
  // .aco: big-endian. Version 1 (and 2 with names): count, then [space, w, x, y, z] per colour.
  PP.readAco = function (u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), p = 0, out = [];
    function u16() { if (p + 2 > u8.length) throw new Error("This palette file is truncated"); var v = dv.getUint16(p); p += 2; return v; }
    function one(named) {
      var ver = u16(), n = u16(), list = [];
      if (ver !== 1 && ver !== 2) throw new Error("Not an .aco palette");
      if (n > 5000) throw new Error("Too many colours in this palette");
      for (var i = 0; i < n; i++) {
        var sp = u16(), w = u16(), x = u16(), y = u16(), z = u16(), rgb = null, name = "";
        void z;
        if (sp === 0) rgb = [w / 257, x / 257, y / 257];
        else if (sp === 1) rgb = PPX.hsb2rgb(w / 65535 * 360, x / 65535 * 100, y / 65535 * 100);
        else if (sp === 2) rgb = PPX.cmyk2rgb(100 - w / 655.35, 100 - x / 655.35, 100 - y / 655.35, 100 - z / 655.35);
        else if (sp === 7) rgb = PPX.lab2rgb(w / 100, dv.getInt16(p - 6) / 100, dv.getInt16(p - 4) / 100);
        else if (sp === 8) { var g = 255 * (1 - Math.min(w, 10000) / 10000); rgb = [g, g, g]; }
        if (named) {
          if (p + 4 > u8.length) throw new Error("This palette file is truncated");
          var len = dv.getUint32(p); p += 4; if (len > 512 || p + len * 2 > u8.length) throw new Error("This palette file is damaged");
          for (var k = 0; k < len; k++) { var cc = u16(); if (cc) name += String.fromCharCode(cc); }
        }
        if (rgb) list.push({ c: PE.toHex(rgb[0], rgb[1], rgb[2]), n: name });
      }
      return { ver: ver, list: list };
    }
    var a = one(false);
    if (p < u8.length - 4) { try { var b = one(true); if (b.ver === 2 && b.list.length) return b.list; } catch (e) { /* keep version 1 */ } }
    return a.list;
  };
  PP.writeAco = function (list) {
    var n = list.length, size = 4 + n * 10 + 4, i, k;
    list.forEach(function (s) { size += 10 + 4 + (Math.min(s.n.length, 200) + 1) * 2; });
    var dv = new DataView(new ArrayBuffer(size)), p = 0;
    function w16(v) { dv.setUint16(p, v); p += 2; }
    [1, 2].forEach(function (ver) {
      w16(ver); w16(n);
      for (i = 0; i < n; i++) {
        var c = PE.rgbOf(list[i].c); w16(0); w16(c[0] * 257); w16(c[1] * 257); w16(c[2] * 257); w16(0);
        if (ver === 2) { var nm = list[i].n.slice(0, 200); dv.setUint32(p, nm.length + 1); p += 4; for (k = 0; k < nm.length; k++) w16(nm.charCodeAt(k)); w16(0); }
      }
    });
    return new Uint8Array(dv.buffer);
  };
  PP.readGpl = function (text) {
    var lines = String(text).split(/\r?\n/), out = [];
    if (!/^GIMP Palette/.test(lines[0] || "")) {      // also accept plain lists of hex colours
      (String(text).match(/#?[0-9a-f]{6}\b/gi) || []).forEach(function (m) { out.push({ c: "#" + m.replace("#", "").toLowerCase(), n: "" }); });
      return out;
    }
    lines.slice(1).forEach(function (l) {
      var m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*(.*)$/.exec(l);
      if (m) out.push({ c: PE.toHex(+m[1], +m[2], +m[3]), n: m[4].trim() });
    });
    return out;
  };
  PP.writeGpl = function (list, name) {
    return "GIMP Palette\nName: " + name + "\nColumns: 16\n#\n" + list.map(function (s) { var c = PE.rgbOf(s.c); return [c[0], c[1], c[2]].map(function (v) { return ("  " + v).slice(-3); }).join(" ") + "\t" + (s.n || s.c); }).join("\n") + "\n";
  };
})();
