/* Vector lane: Image › Smart resize… — seam carving. Narrows or widens (and shortens or heightens) the current pixel
   layer by removing or doubling its least noticeable paths of pixels, so people and objects keep their shape.
   The selection can be protected, as can skin tones. Seams are found on a reduced copy in the worker; the full-size
   pixels are then removed or doubled along them. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, UI = VX.ui, h = S3.h;

  function protectFor(L, useSel) {
    var d = ED.doc; if (!useSel || !d.sel) return null;
    return PE.selFor(d, { x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height });
  }
  VX.smartResizeDialog = function () {
    if (!ED.doc || ED.busyCheck()) return;
    var L = ED.layer(); if (!ED.editable(L, "pixels")) return;
    if (ED.maskEdit) { S3.toast("Smart resize changes layer pixels: click the layer thumbnail first", "error"); return; }
    var d = ED.doc, W = L.canvas.width, H = L.canvas.height, w = ED.ui.w, st = { w: W, h: H, sel: !!d.sel, skin: false, canvas: L.x <= 0 && L.y <= 0 && L.x + W >= d.w && L.y + H >= d.h && d.layers.length === 1 };
    var wi = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: String(W) }), hi = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: String(H) });
    var wp = h("input", { type: "number", "class": "input", min: "10", max: "200", value: "100" }), hp = h("input", { type: "number", "class": "input", min: "10", max: "200", value: "100" });
    function sync(from) {
      if (from === "w") wp.value = Math.round(+wi.value / W * 1000) / 10; if (from === "h") hp.value = Math.round(+hi.value / H * 1000) / 10;
      if (from === "wp") wi.value = Math.max(1, Math.round(W * +wp.value / 100)); if (from === "hp") hi.value = Math.max(1, Math.round(H * +hp.value / 100));
      st.w = PE.clamp(Math.round(+wi.value) || W, 1, Math.min(PE.LIM.side, W * 2)); st.h = PE.clamp(Math.round(+hi.value) || H, 1, Math.min(PE.LIM.side, H * 2)); schedule();
    }
    wi.addEventListener("input", function () { sync("w"); }); hi.addEventListener("input", function () { sync("h"); });
    wp.addEventListener("input", function () { sync("wp"); }); hp.addEventListener("input", function () { sync("hp"); });
    // preview on a small copy
    var pk = Math.min(1, 320 / Math.max(W, H)), pw = Math.max(2, Math.round(W * pk)), ph = Math.max(2, Math.round(H * pk)), small = PE.mk(pw, ph), sx = PE.cx2(small);
    sx.imageSmoothingQuality = "high"; sx.drawImage(L.canvas, 0, 0, pw, ph);
    var sImg = sx.getImageData(0, 0, pw, ph), sProt = protectFor(L, true), sProtSmall = null;
    if (sProt) { sProtSmall = new Uint8Array(pw * ph); for (var y = 0; y < ph; y++) for (var x = 0; x < pw; x++) sProtSmall[y * pw + x] = sProt[Math.min(H - 1, Math.floor(y / pk)) * W + Math.min(W - 1, Math.floor(x / pk))]; }
    var pv = h("canvas", { "class": "pe-vcarve", width: String(Math.round(pw * 2)), height: String(ph), "aria-label": "Preview" }), info = h("p", { "class": "faint pe-p mono" });
    var busy = false, again = false;
    function run() {
      if (busy) { again = true; return; }
      busy = true; again = false;
      var tw = Math.max(2, Math.round(st.w * pk)), th = Math.max(2, Math.round(st.h * pk));
      VX.work("carve", [{ data: new Uint8ClampedArray(sImg.data), width: pw, height: ph }, st.sel ? sProtSmall : null, tw, th, st.skin, 400]).then(function (r) {
        var c = PE.cx2(pv); pv.width = Math.max(pw, tw); pv.height = Math.max(ph, th);
        c.clearRect(0, 0, pv.width, pv.height); c.putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer || r.data), r.width, r.height), 0, 0);
        info.textContent = W + " × " + H + " → " + st.w + " × " + st.h + " px";
      }).catch(function (e) { info.textContent = e.message; }).then(function () { busy = false; if (again) run(); });
    }
    var schedule = S3.debounce(run, 120);
    var selChk = w.check("Protect the selection", st.sel, function (v) { st.sel = v; schedule(); });
    if (!d.sel) selChk.querySelector("input").disabled = true;
    var body = h("div", { "class": "stack" }, [
      h("p", { "class": "faint pe-p", text: "Removes or doubles the least noticeable lines of pixels, so subjects keep their shape. Now " + W + " × " + H + " px." }),
      h("div", { "class": "pe-custom" }, [w.field("Width (px)", wi), w.field("%", wp), w.field("Height (px)", hi), w.field("%", hp)]),
      selChk, w.check("Protect skin tones", false, function (v) { st.skin = v; schedule(); }),
      w.check("Resize the canvas to match", st.canvas, function (v) { st.canvas = v; }), pv, info]);
    var go = w.btn("Resize", function () {
      dlg.close();
      if (st.w === W && st.h === H) return;
      var img = PE.getData(L.canvas), canvasToo = st.canvas;
      ED.working(VX.work("carve", [{ data: img.data, width: W, height: H }, st.sel ? protectFor(L, true) : null, st.w, st.h, st.skin, 1200]), "Smart resize…").then(function (r) {
        var cv = VX.toCanvas(r);
        try { if (canvasToo) PE.checkSize(r.width, r.height, "The canvas"); } catch (e) { S3.toast(e.message, "error"); return; }
        ED.meta("Smart resize", function () {
          L.canvas = cv;
          if (canvasToo) { d.w = r.width; d.h = r.height; d.sel = null; L.x = 0; L.y = 0; }
        });
        if (canvasToo) ED.fit();
      }).catch(function (e) { S3.toast(e.message, "error"); });
    }, "primary");
    var dlg = w.modal("Smart resize", body, [h("span", { "class": "grow" }), go], true);
    run();
  };
  UI.menu("Image", [["Smart resize…", "Ctrl+Shift+Alt+C", function () { if (ED.ui.w.need()) VX.smartResizeDialog(); }, function () { return !!ED.doc; }]], "Canvas size…");
  UI.keys.push(function (e) { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.altKey && e.key.toLowerCase() === "c") { if (ED.ui.w.need()) VX.smartResizeDialog(); return true; } return false; });
})();
