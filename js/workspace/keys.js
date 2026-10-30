/* Workspace (files lane): customizable keyboard shortcuts. Every menu command and tool is listed; click a row and press
   the new keys (Backspace clears, Esc cancels). Conflicts are shown and the other command loses that shortcut.
   The set can be exported to a .json file and imported again (validated). Custom keys win over the built-in ones;
   a built-in shortcut you moved away from does nothing any more. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, h = S3.h, W = ED.ui.w;
  var K = WS.keys = {};
  var MAP = S3.store("pe-keys") || {};        // id -> combo string ("" = none)
  function save() { S3.store("pe-keys", MAP); relabel(); }

  // ---------- combos ----------
  var NAMED = { " ": "Space", "ArrowLeft": "←", "ArrowRight": "→", "ArrowUp": "↑", "ArrowDown": "↓", "Escape": "Esc", "+": "=", "Delete": "Delete", "Backspace": "Backspace" };
  K.combo = function (e) {
    var k = e.key; if (!k || k === "Control" || k === "Shift" || k === "Alt" || k === "Meta" || k === "Dead" || k === "Unidentified") return null;
    if (e.code && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
    else if (e.code && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
    else k = NAMED[k] || (k.length === 1 ? k.toUpperCase() : k);
    if (k === "{") k = "["; if (k === "}") k = "]"; if (k === ":") k = ";"; if (k === "?" && !e.ctrlKey && !e.metaKey) return "?";
    return (e.ctrlKey || e.metaKey ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (e.shiftKey ? "Shift+" : "") + k;
  };
  // menu labels like "Ctrl+Shift+Alt+W" -> canonical "Ctrl+Alt+Shift+W"
  K.norm = function (s) {
    s = String(s || "").trim(); if (!s) return "";
    var parts = s.split("+"), key = parts.pop() || "+", mods = parts.map(function (p) { return p.toLowerCase(); });
    if (key === "" && s.slice(-1) === "+") key = "=";
    key = key.length === 1 ? key.toUpperCase() : key;
    return (mods.indexOf("ctrl") >= 0 ? "Ctrl+" : "") + (mods.indexOf("alt") >= 0 ? "Alt+" : "") + (mods.indexOf("shift") >= 0 ? "Shift+" : "") + key;
  };
  function strip(l) { return String(l).replace(/^[✓ ] /, ""); }

  // ---------- commands: every menu item (by path) and every tool ----------
  K.commands = function () {
    var out = [];
    ED.ui.MENUS.forEach(function (m) {
      if (m[0] === "Window") { (m[1] || []).forEach(function (it, i) { if (it !== "-" && i < 6) out.push(cmd(m[0], it)); }); return; }
      m[1].forEach(function (it) { if (it !== "-") out.push(cmd(m[0], it)); });
    });
    (ED.ui.TOOLS || []).forEach(function (t) { out.push({ id: "tool:" + t[0], label: "Tool › " + t[1], def: t[2], run: function () { ED.setTool(t[0]); }, item: null }); });
    return out;
  };
  function cmd(menu, it) {
    var label = strip(it[0]), def = it._def != null ? it._def : it[1];
    return { id: "menu:" + menu + "/" + label, label: menu + " › " + label, def: K.norm(def), run: function () { if (it[3] && !it[3]()) { S3.toast("“" + label + "” is not available right now"); return; } it[2](); }, item: it };
  }
  K.current = function (c) { return MAP[c.id] != null ? MAP[c.id] : c.def; };
  // show custom shortcuts in the menus
  function relabel() {
    ED.ui.MENUS.forEach(function (m) {
      if (m[0] === "Window") return;
      m[1].forEach(function (it) {
        if (it === "-") return; if (it._def == null) it._def = it[1] || "";
        var id = "menu:" + m[0] + "/" + strip(it[0]); it[1] = MAP[id] != null ? MAP[id] : it._def;
      });
    });
  }
  K.relabel = relabel;

  // ---------- dispatch (window capture: before the app's own handler) ----------
  window.addEventListener("keydown", function (e) {
    if (!Object.keys(MAP).length) return;
    if (document.querySelector(".s3-modal") || ED.isTyping(e) || ED.modal) return;
    var c = K.combo(e); if (!c) return;
    var list = K.commands(), hit = null, freed = false;
    for (var i = 0; i < list.length; i++) {
      var cur = K.current(list[i]);
      if (MAP[list[i].id] != null && cur === c) { hit = list[i]; break; }
      if (MAP[list[i].id] != null && list[i].def === c && MAP[list[i].id] !== c) freed = true;
    }
    if (hit) { e.preventDefault(); e.stopImmediatePropagation(); hit.run(); return; }
    if (freed) {
      // the built-in owner of these keys moved elsewhere; keep them free unless another default uses them
      var other = list.some(function (x) { return MAP[x.id] == null && x.def === c; });
      if (!other) { e.preventDefault(); e.stopImmediatePropagation(); }
    }
  }, true);

  // ---------- dialog ----------
  K.dialog = function () {
    var list = K.commands(), filter = h("input", { "class": "input", type: "search", placeholder: "Search commands", "aria-label": "Search commands" });
    var box = h("div", { "class": "ws-keys" }), recording = null;
    function draw() {
      var q = filter.value.trim().toLowerCase(); box.textContent = "";
      var used = {}; list.forEach(function (c) { var k = K.current(c); if (k) (used[k] = used[k] || []).push(c); });
      list.forEach(function (c) {
        if (q && c.label.toLowerCase().indexOf(q) < 0 && K.current(c).toLowerCase().indexOf(q) < 0) return;
        var k = K.current(c), clash = k && used[k].length > 1, mine = MAP[c.id] != null;
        var keyBtn = h("button", { type: "button", "class": "ws-kbtn mono" + (recording === c ? " rec" : "") + (clash ? " clash" : "") + (mine ? " mine" : ""), title: clash ? "Also used by: " + used[k].filter(function (x) { return x !== c; }).map(function (x) { return x.label; }).join(", ") : "Click, then press the new keys",
          text: recording === c ? "Press keys…" : (k || "—") });
        keyBtn.addEventListener("click", function () { recording = c; draw(); });
        var reset = mine ? h("button", { type: "button", "class": "btn ghost small", text: "Default", title: "Back to " + (c.def || "none") }) : null;
        if (reset) reset.addEventListener("click", function () { delete MAP[c.id]; save(); draw(); });
        box.appendChild(h("div", { "class": "ws-krow" }, [h("span", { "class": "ws-klab", text: c.label }), keyBtn, reset]));
      });
      var r = box.querySelector(".rec"); if (r) r.focus();
    }
    function onKey(e) {
      if (!recording) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); recording = null; draw(); return; }
      if (e.key === "Tab") return;
      var c = e.key === "Backspace" && !e.ctrlKey && !e.altKey && !e.shiftKey ? "" : K.combo(e);
      if (c == null) return;
      e.preventDefault(); e.stopPropagation();
      if (/^(Ctrl\+)?(Alt\+)?(Shift\+)?(Tab)$/.test(c)) return;
      // the other owner of these keys loses them
      if (c) list.forEach(function (x) { if (x !== recording && K.current(x) === c) MAP[x.id] = ""; });
      if (c === recording.def) delete MAP[recording.id]; else MAP[recording.id] = c;
      recording = null; save(); draw();
    }
    box.addEventListener("keydown", onKey, true);
    filter.addEventListener("input", draw);
    var file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
    file.addEventListener("change", function () {
      var f = file.files[0]; file.value = ""; if (!f) return;
      if (f.size > 200000) { S3.toast("That file is too large to be a shortcut set", "error"); return; }
      f.text().then(function (t) {
        var n = K.importJson(t, list); save(); draw(); S3.toast("Imported " + n + " shortcut" + (n === 1 ? "" : "s"));
      }).catch(function (e) { S3.toast(e.message, "error"); });
    });
    var body = h("div", { "class": "stack" }, [h("p", { "class": "faint pe-p", text: "Click a shortcut, then press the new keys. Backspace removes it, Esc cancels. Browser-reserved keys (like Ctrl+W, Ctrl+T, Ctrl+N) cannot be used." }), filter, box, file]);
    var dlg = W.modal("Keyboard shortcuts", body, [
      W.btn("Export…", function () { FX.download(new Blob([K.exportJson()], { type: "application/json" }), "photo-editor-shortcuts.json"); }, "ghost"),
      W.btn("Import…", function () { file.click(); }, "ghost"),
      W.btn("Reset all", function () { MAP = {}; save(); draw(); }, "ghost"), h("span", { "class": "grow" }), W.btn("Done", function () { dlg.close(); }, "primary")], true);
    draw();
  };
  K.exportJson = function () { return JSON.stringify({ format: "s3pe-shortcuts", version: 1, keys: MAP }, null, 1); };
  K.importJson = function (text, list) {
    var d; try { d = JSON.parse(text); } catch (e) { throw new Error("That is not a shortcut file (bad JSON)"); }
    if (!d || d.format !== "s3pe-shortcuts" || typeof d.keys !== "object" || Array.isArray(d.keys)) throw new Error("That is not a Photo Editor shortcut file");
    var ids = {}; (list || K.commands()).forEach(function (c) { ids[c.id] = 1; });
    var n = 0, next = {};
    Object.keys(d.keys).slice(0, 2000).forEach(function (id) {
      var v = d.keys[id]; if (!ids[id] || typeof v !== "string" || v.length > 40 || !(v === "" || /^(Ctrl\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|F\d{1,2}|Space|Esc|Enter|Delete|Backspace|Home|End|PageUp|PageDown|Insert|[←→↑↓]|[\[\];',./\\`=?-])$/.test(v))) return;
      next[id] = v; n++;
    });
    MAP = next; return n;
  };
  K.map = function () { return MAP; };
  K.setMap = function (m) { MAP = m || {}; relabel(); };

  // the old "?" list becomes the editor (menu item, toolbar button and the ? key)
  document.addEventListener("DOMContentLoaded", function () {
    relabel();
    ED.ui.MENUS.forEach(function (m) { if (m[0] === "View") m[1].forEach(function (it) { if (it !== "-" && strip(it[0]) === "Keyboard shortcuts") it[2] = K.dialog; }); });
    document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("#btnKeys")) { e.stopPropagation(); e.preventDefault(); K.dialog(); } }, true);
  });
  WS.key(function (e) { return e.key === "?" && !WS.ctrl(e); }, K.dialog, true);
  FX.menu("Edit", ["Keyboard shortcuts…", "Ctrl+Alt+Shift+K", K.dialog], "Preferences…");
  WS.key(function (e) { return WS.ctrl(e) && e.altKey && e.shiftKey && e.key.toLowerCase() === "k"; }, K.dialog, true);

  FX.tests.push(async function (ok) {
    ok(K.combo({ key: "n", code: "KeyN", ctrlKey: true, shiftKey: true }) === "Ctrl+Shift+N" && K.combo({ key: "[", code: "BracketLeft" }) === "[" && K.norm("Ctrl+Shift+Alt+W") === "Ctrl+Alt+Shift+W" && K.norm("Ctrl+=") === "Ctrl+=", "shortcut names");
    var keep = MAP, list = K.commands(), save0 = Object.assign({}, MAP);
    ok(list.some(function (c) { return c.id === "menu:File/Save as PSD…"; }) && list.some(function (c) { return c.id === "tool:brush" && c.def === "B"; }), "commands listed");
    var n = K.importJson(JSON.stringify({ format: "s3pe-shortcuts", version: 1, keys: { "tool:brush": "N", "menu:Nope/X": "Q", "tool:eraser": "<script>" } }), list);
    ok(n === 1 && MAP["tool:brush"] === "N" && !MAP["tool:eraser"], "shortcut import validated");
    var bad = false; try { K.importJson("{\"format\":\"x\"}"); } catch (e) { bad = true; } ok(bad, "foreign files rejected");
    // dispatch: N now picks the hand tool, H (no longer used by anything) does nothing
    MAP = { "tool:hand": "N" };
    var tool = ED.tool, docKeep = ED.doc; ED.doc = ED.doc || PE.newDoc(10, 10, "k");
    ED.tool = "move"; window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", bubbles: true }));
    var gotN = ED.tool === "hand"; ED.tool = "move";
    var other = K.commands().some(function (c) { return c.id !== "tool:hand" && c.def === "H"; });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "h", code: "KeyH", bubbles: true }));
    ok(gotN && (other || ED.tool === "move"), "custom key runs the command and frees the old one");
    MAP = save0; S3.store("pe-keys", MAP); relabel(); ED.tool = tool; ED.doc = docKeep; void keep;
  });
})();
