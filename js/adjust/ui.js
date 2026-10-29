/* Adjust lane UI: registers the extra adjustments and filters (js/adjust/*.js maths) with the editor's
   live-preview panel (ED.ADJ + spec.ui), adds their menu entries (with drill-down submenus) and shortcuts. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, h = S3.h, $ = S3.$;
  var AUI = PE.adjUI = {};
  function kit() { return ED.adjKit; }
  function has() { return !!ED.doc; }
  AUI.has = has;

  // ---------- registering adjustments (shown in the floating live-preview panel) ----------
  AUI.adj = function (op, spec) { ED.ADJ[op] = spec; return spec; };
  AUI.open = function (op) { ED.ui.openAdjust(op); };
  // One-click ops (no dialog): run in the worker, one history step.
  var QUICK_LABELS = {};
  AUI.quick = function (op, label, p) {
    var K = kit(), t = K.adjTarget(); if (!t) return Promise.resolve();
    QUICK_LABELS[label] = 1;
    return ED.working(PE.work("adjust", [t.img, op, p || {}, t.sel]), label + "…").then(function (res) { K.commitAdjusted(t, res, label); })
      .catch(function (e) { S3.toast(e.message, "error"); });
  };
  AUI.isFilterLabel = function (label) {
    if (QUICK_LABELS[label]) return true;
    var Q = kit().QUICK; for (var k in Q) if (Q[k] === label) return true;
    for (var op in ED.ADJ) if (ED.ADJ[op].t === label) return true;
    return false;
  };

  // ---------- menus ----------
  function menu(name) { var M = kit().MENUS; for (var i = 0; i < M.length; i++) if (M[i][0] === name) return M[i][1]; return null; }
  // Insert items into a menu before the item whose label starts with `before` (or at the end).
  AUI.addMenu = function (name, items, before) {
    var m = menu(name); if (!m) return;
    var at = m.length;
    if (before) for (var i = 0; i < m.length; i++) if (m[i] !== "-" && m[i][0].indexOf(before) === 0) { at = i; break; }
    m.splice.apply(m, [at, 0].concat(items));
  };
  // A drill-down submenu: the item opens a second list in place of the menu (works the same on phones).
  AUI.sub = function (menuName, label, items) {
    return [label + " ›", "", function () { openSub(menuName, label, items); }, has];
  };
  var subEl = null;
  function closeSub() { if (subEl) { subEl.remove(); subEl = null; document.removeEventListener("pointerdown", outside, true); } }
  function outside(e) { if (subEl && !subEl.contains(e.target)) closeSub(); }
  function openSub(menuName, label, items) {
    closeSub();
    var btn = S3.$$(".pe-mbtn").filter(function (b) { return b.textContent === menuName; })[0]; if (!btn) return;
    var pop = h("div", { "class": "pe-menu pe-asub", role: "menu", "aria-label": label });
    var back = h("button", { type: "button", role: "menuitem", "class": "pe-mi pe-aback" }, [h("span", { text: "‹ " + label })]);
    back.addEventListener("click", function () { closeSub(); btn.click(); });
    pop.appendChild(back); pop.appendChild(h("hr"));
    items.forEach(function (it) {
      if (it === "-") { pop.appendChild(h("hr")); return; }
      var item = h("button", { type: "button", role: "menuitem", "class": "pe-mi" }, [h("span", { text: it[0] }), it[1] ? h("kbd", { text: kit().K(it[1]) }) : null]);
      if (it[3] && !it[3]()) item.disabled = true;
      item.addEventListener("click", function () { closeSub(); it[2](); });
      pop.appendChild(item);
    });
    pop.addEventListener("keydown", function (e) {
      var list = S3.$$(".pe-mi:not([disabled])", pop), i = list.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); (list[i + 1] || list[0]).focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); (list[i - 1] || list[list.length - 1]).focus(); }
      if (e.key === "Escape" || e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); closeSub(); btn.focus(); }
    });
    btn.parentNode.appendChild(pop); subEl = pop;
    var f = pop.querySelector(".pe-mi:not([disabled]):not(.pe-aback)"); if (f) f.focus({ preventScroll: true });
    setTimeout(function () { document.addEventListener("pointerdown", outside, true); }, 0);
  }
  AUI.closeSub = closeSub;

  // ---------- shortcuts ----------
  // combo "Ctrl+Shift+L" -> handler. Checked before the editor's own keys (capture phase).
  var KEYS = [];
  AUI.key = function (combo, fn) {
    var parts = combo.toLowerCase().split("+"), key = parts.pop();
    KEYS.push({ ctrl: parts.indexOf("ctrl") >= 0, shift: parts.indexOf("shift") >= 0, alt: parts.indexOf("alt") >= 0, key: key, fn: fn });
  };
  AUI.panelKeys = null;     // set while one of this lane's own panels is open: function (e) -> handled
  document.addEventListener("keydown", function (e) {
    if (AUI.panelKeys) { AUI.panelKeys(e); return; }
    if (document.querySelector(".s3-modal") || ED.ui.floatState() || ED.isTyping(e) || !ED.doc) return;
    var c = e.ctrlKey || e.metaKey, k = (e.key || "").toLowerCase();
    for (var i = 0; i < KEYS.length; i++) {
      var K = KEYS[i];
      if (K.ctrl === c && K.shift === e.shiftKey && K.alt === e.altKey && (K.key === k || ("key" + K.key) === (e.code || "").toLowerCase())) {
        e.preventDefault(); e.stopPropagation(); K.fn(); return;
      }
    }
  }, true);

  // ---------- auto tone / contrast / colour ----------
  var AUTO = [["autoTone", "Auto tone", "Ctrl+Shift+L"], ["autoContrast", "Auto contrast", "Ctrl+Alt+Shift+L"], ["autoColor", "Auto colour", "Ctrl+Shift+B"]];
  AUI.addMenu("Image", AUTO.map(function (a) { return [a[1], a[2], function () { AUI.quick(a[0], a[1]); }, has]; }).concat(["-"]), "Vibrance");
  AUTO.forEach(function (a) { AUI.key(a[2], function () { AUI.quick(a[0], a[1]); }); });
})();
