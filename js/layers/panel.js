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
