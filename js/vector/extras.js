/* Vector lane extras: saved text styles (Character panel: save the current text's look, apply it to a layer or
   to the selected characters) and align / distribute for path components (path selection tool). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, VG = PE.VG, UI = VX.ui, h = S3.h;

  // ---------- text styles (kept in this browser) ----------
  var CHAR = VX.RUN_KEYS, PARA = ["lh", "align", "indL", "indR", "indF", "spB", "spA", "kern"];
  var STY = (S3.store("pe-tstyles") || []).filter(function (s) { return s && typeof s.name === "string" && s.c && typeof s.c === "object"; }).slice(0, 60);
  function save() { S3.store("pe-tstyles", STY); }
  function grab(T) { var c = {}, p = {}; CHAR.forEach(function (k) { if (T[k] !== undefined && T[k] !== null) c[k] = T[k]; }); PARA.forEach(function (k) { if (T[k] !== undefined) p[k] = T[k]; }); return { c: c, p: p }; }
  VX.applyTextStyle = function (st) {
    var L = ED.textL || ED.layer(); if (!L || L.kind !== "text") return;
    var r = VX.selRange && VX.selRange(L);
    if (r) { VX.setText("Apply text style (selection)", function (t) { Object.keys(st.c).forEach(function (k) { VX.setRange(t, r.a, r.b, k, st.c[k]); }); }); return; }
    VX.setText("Apply text style", function (t) {
      CHAR.forEach(function (k) { if (k in st.c) t[k] = st.c[k]; else if (k !== "font" && k !== "size" && k !== "color" && k !== "weight" && k !== "italic") delete t[k]; });
      Object.keys(st.p || {}).forEach(function (k) { if (!(k === "align" && !t.box && /justify/.test(st.p[k]))) t[k] = st.p[k]; });
      delete t.runs;
    });
  };
  UI.props(function (P, L) {
    if (!L || L.kind !== "text") return;
    var w = ED.ui.w, sel = h("select", { "class": "select", "aria-label": "Text styles" });
    sel.appendChild(h("option", { value: "", text: STY.length ? "Apply a saved style…" : "No saved styles yet" }));
    STY.forEach(function (s, i) { sel.appendChild(h("option", { value: String(i), text: s.name })); });
    sel.addEventListener("change", function () { var s = STY[+sel.value]; if (s) VX.applyTextStyle(s); sel.value = ""; });
    var add = w.btn("Save style", function () {
      var nm = h("input", { "class": "input", value: "Style " + (STY.length + 1), maxlength: "40", dir: "auto" });
      var go = w.btn("Save", function () { dlg.close(); var g = grab(L.text); STY.push({ name: nm.value.trim().slice(0, 40) || "Style", c: g.c, p: g.p }); if (STY.length > 60) STY.shift(); save(); ED.ui.buildProps(); }, "primary");
      var dlg = w.modal("Save text style", h("div", { "class": "stack" }, [w.field("Name", nm), h("p", { "class": "faint pe-p", text: "Saves this layer's font, size, colour, spacing and paragraph settings. Kept in this browser." })]), [h("span", { "class": "grow" }), go]);
    }, "ghost");
    var del = STY.length ? w.btn("", function () {
      var opts = STY.map(function (s, i) { return [String(i), s.name]; }), pick = "0";
      var go = w.btn("Delete", function () { dlg.close(); STY.splice(+pick, 1); save(); ED.ui.buildProps(); }, "primary");
      var dlg = w.modal("Delete text style", h("div", { "class": "stack" }, [w.select("Style", opts, "0", function (v) { pick = v; })]), [h("span", { "class": "grow" }), go]);
    }, "ghost icon", "i-trash", "Delete a saved style") : null;
    P.appendChild(h("h3", { text: "Text styles" }));
    P.appendChild(h("div", { "class": "pe-prow" }, [sel, add, del]));
  });

  // ---------- align / distribute path components ----------
  VX.alignComps = function (how) {
    var tg = VX.target(); if (!tg) return;
    var cs = tg.get(), idx = Object.keys(VX.vsel.comps).map(Number).filter(function (i) { return cs[i]; });
    if (idx.length < 2) { S3.toast("Select two or more path components (Shift+click with the path selection tool)", "error"); return; }
    var bs = idx.map(function (i) { return VG.bounds([cs[i]]); }), all = bs.reduce(function (u, b) { return PE.union(u, b); }, null);
    VX.editTarget(tg, how.indexOf("dist") === 0 ? "Distribute paths" : "Align paths", function (c2) {
      var mv = idx.map(function () { return { x: 0, y: 0 }; });
      if (how === "left") bs.forEach(function (b, k) { mv[k].x = all.x - b.x; });
      if (how === "hcenter") bs.forEach(function (b, k) { mv[k].x = all.x + all.w / 2 - b.x - b.w / 2; });
      if (how === "right") bs.forEach(function (b, k) { mv[k].x = all.x + all.w - b.x - b.w; });
      if (how === "top") bs.forEach(function (b, k) { mv[k].y = all.y - b.y; });
      if (how === "vcenter") bs.forEach(function (b, k) { mv[k].y = all.y + all.h / 2 - b.y - b.h / 2; });
      if (how === "bottom") bs.forEach(function (b, k) { mv[k].y = all.y + all.h - b.y - b.h; });
      if (how === "disth" || how === "distv") {
        var ax = how === "disth" ? "x" : "y", sz = ax === "x" ? "w" : "h", ord = idx.map(function (i, k) { return k; }).sort(function (a, b) { return bs[a][ax] + bs[a][sz] / 2 - bs[b][ax] - bs[b][sz] / 2; });
        var first = bs[ord[0]], last = bs[ord[ord.length - 1]], c0 = first[ax] + first[sz] / 2, c1 = last[ax] + last[sz] / 2;
        ord.forEach(function (k, n) { mv[k][ax] = c0 + (c1 - c0) * n / (ord.length - 1) - (bs[k][ax] + bs[k][sz] / 2); });
      }
      idx.forEach(function (i, k) { c2[i].pts.forEach(function (q) { q[0] += mv[k].x; q[2] += mv[k].x; q[4] += mv[k].x; q[1] += mv[k].y; q[3] += mv[k].y; q[5] += mv[k].y; }); });
    });
  };
  var ps0 = ED.ui.optsFor.psel;
  UI.opts("psel", function (items) {
    items = ps0 ? ps0(items) : items;
    var w = ED.ui.w, at = items.findIndex(function (x) { return x.classList && x.classList.contains("pe-hint"); });
    var al = w.select("Align", [["", "Align / distribute…"], ["left", "Left edges"], ["hcenter", "Horizontal centres"], ["right", "Right edges"], ["top", "Top edges"], ["vcenter", "Vertical centres"], ["bottom", "Bottom edges"], ["disth", "Distribute horizontally"], ["distv", "Distribute vertically"]], "", function (v) { if (v) VX.alignComps(v); ED.ui.buildOpts(); });
    items.splice(at < 0 ? items.length : at, 0, al);
    return items;
  });
})();
