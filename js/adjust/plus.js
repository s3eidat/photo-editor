/* Adjust lane: fuller Levels (per channel, black / grey / white eyedroppers, auto options, presets), Curves
   (eyedroppers, presets), Hue / Saturation (per colour range, range picker) and Black & white (presets, auto, tint).
   The editor's own simpler panels stay as they are; the Image menu and Ctrl+L / M / U / Alt+Shift+B open these. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, AUI = PE.adjUI, h = S3.h, A = PIX.A;
  function K() { return ED.adjKit; }
  function pickBtn(label, title, onPick) {
    var b = K().btn(label, function () { AUI.pick(onPick, b); }, "ghost small", null, title);
    b.setAttribute("aria-pressed", "false"); b.classList.add("pe-apick"); return b;
  }
  function sample(st, pt) {      // 3x3 average of the panel's source under a point -> [r, g, b] or null
    var im = st.t.img, x0 = Math.floor(pt.x - st.t.r.x), y0 = Math.floor(pt.y - st.t.r.y), s = [0, 0, 0], c = 0;
    for (var y = y0 - 1; y <= y0 + 1; y++) for (var x = x0 - 1; x <= x0 + 1; x++) { if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue; var j = (y * im.width + x) * 4; s[0] += im.data[j]; s[1] += im.data[j + 1]; s[2] += im.data[j + 2]; c++; }
    return c ? [s[0] / c, s[1] / c, s[2] / c] : null;
  }
  AUI.sample3 = sample;
  function replaceItem(menuName, label, fn) {
    var M = K().MENUS; M.forEach(function (m) { if (m[0] !== menuName) return; m[1].forEach(function (it) { if (it !== "-" && it[0] === label) it[2] = fn; }); });
  }

  // ---------- Levels ----------
  var LV_PRESETS = [["", "Presets…"], ["darker", "Darker", { rgb: [0, 0.7, 255, 0, 255] }], ["lighter", "Lighter", { rgb: [0, 1.4, 255, 0, 255] }], ["c1", "More contrast", { rgb: [20, 1, 235, 0, 255] }],
    ["c2", "Much more contrast", { rgb: [40, 1, 215, 0, 255] }], ["midB", "Brighter midtones", { rgb: [0, 1.25, 255, 0, 255] }], ["midD", "Darker midtones", { rgb: [0, 0.8, 255, 0, 255] }], ["fade", "Faded", { rgb: [0, 1, 255, 30, 230] }]];
  AUI.adj("levelsPlus", { t: "Levels", ui: function (el, st) {
    var p = st.p, ch = "rgb", rs = [], histBox = h("div"), algo = "color";
    ["rgb", "r", "g", "b"].forEach(function (c) { p[c] = [0, 1, 255, 0, 255]; });
    function hist() { histBox.textContent = ""; histBox.appendChild(K().histCanvas(st.src, ch === "rgb" ? "l" : ch, 256, 70)); }
    function sync() { rs.forEach(function (r, i) { r._set(p[ch][r._i]); }); }
    el.appendChild(K().select("", LV_PRESETS.map(function (x) { return [x[0], x[1]]; }), "", function (v) {
      var pr = LV_PRESETS.filter(function (x) { return x[0] === v; })[0]; if (!pr || !pr[2]) return;
      ["rgb", "r", "g", "b"].forEach(function (c) { p[c] = (pr[2][c] || [0, 1, 255, 0, 255]).slice(); }); sync(); st.schedule();
    }));
    el.appendChild(K().seg("Channel", [["rgb", "RGB"], ["r", "Red"], ["g", "Green"], ["b", "Blue"]], ch, function (v) { ch = v; hist(); sync(); }));
    el.appendChild(histBox);
    [[0, "Input black", 0, 253, 1], [1, "Midtones (gamma)", 0.1, 9.99, 0.01], [2, "Input white", 2, 255, 1], [3, "Output black", 0, 255, 1], [4, "Output white", 0, 255, 1]].forEach(function (d) {
      var r = K().range(d[1], p[ch][d[0]], d[2], d[3], d[4], function (v) {
        var a = p[ch]; a[d[0]] = v;
        if (a[2] <= a[0] + 1) { if (d[0] === 0) a[0] = a[2] - 2; else a[2] = a[0] + 2; sync(); }
        st.schedule();
      });
      r._i = d[0]; rs.push(r); el.appendChild(r);
    });
    // eyedroppers set the points per channel (and reset the master), like a desktop editor
    function setPoint(kind, c) {
      ["rgb"].forEach(function (m) { p[m] = [0, 1, 255, 0, 255]; });
      ["r", "g", "b"].forEach(function (k, i) {
        var a = p[k], v = c[i];
        if (kind === "black") a[0] = Math.min(Math.round(v), a[2] - 2);
        else if (kind === "white") a[2] = Math.max(Math.round(v), a[0] + 2);
        else { var t = (c[0] + c[1] + c[2]) / 3, x = (v - a[0]) / (a[2] - a[0]), y = (t - a[0]) / (a[2] - a[0]); a[1] = x > 0.01 && x < 0.99 && y > 0.01 && y < 0.99 ? A.clamp(Math.log(x) / Math.log(y), 0.1, 9.99) : 1; }
      });
      sync(); st.schedule();
    }
    el.appendChild(h("div", { "class": "row pe-arow" }, [
      pickBtn("Black point", "Click something that should be black", function (pt) { var c = sample(st, pt); if (c) setPoint("black", c); }),
      pickBtn("Grey point", "Click something that should be neutral grey", function (pt) { var c = sample(st, pt); if (c) setPoint("grey", c); }),
      pickBtn("White point", "Click something that should be white", function (pt) { var c = sample(st, pt); if (c) setPoint("white", c); })]));
    el.appendChild(h("div", { "class": "row pe-arow" }, [K().select("Auto", [["color", "Colour (neutral midtones)"], ["tone", "Each channel"], ["contrast", "All channels together"]], algo, function (v) { algo = v; }),
      K().btn("Auto", function () { var o = A.levelsAuto(st.src, null, algo, 0.1); ["rgb", "r", "g", "b"].forEach(function (c) { p[c] = o[c]; }); sync(); st.schedule(); }, "ghost")]));
    hist();
  } });

  // ---------- Curves ----------
  var CV_PRESETS = [["", "Presets…"], ["linear", "Linear", {}], ["medium", "Medium contrast", { rgb: [[0, 0], [64, 54], [192, 202], [255, 255]] }], ["strong", "Strong contrast", { rgb: [[0, 0], [64, 44], [192, 212], [255, 255]] }],
    ["lighter", "Lighter", { rgb: [[0, 0], [128, 160], [255, 255]] }], ["darker", "Darker", { rgb: [[0, 0], [128, 96], [255, 255]] }], ["negative", "Negative", { rgb: [[0, 255], [255, 0]] }],
    ["matte", "Matte (lifted blacks)", { rgb: [[0, 36], [70, 72], [190, 196], [255, 240]] }], ["cross", "Cross process", { r: [[0, 0], [70, 50], [190, 215], [255, 255]], g: [[0, 0], [70, 60], [190, 205], [255, 255]], b: [[0, 40], [255, 205]] }],
    ["warm", "Warm", { r: [[0, 0], [128, 142], [255, 255]], b: [[0, 0], [128, 112], [255, 255]] }], ["cool", "Cool", { r: [[0, 0], [128, 116], [255, 255]], b: [[0, 0], [128, 144], [255, 255]] }]];
  AUI.adj("curvesPlus", { t: "Curves", ui: function (el, st) {
    var p = st.p, ed = null, box = h("div", { "class": "stack pe-asecin" });
    ["rgb", "r", "g", "b"].forEach(function (c) { p[c] = [[0, 0], [255, 255]]; });
    el.appendChild(K().select("", CV_PRESETS.map(function (x) { return [x[0], x[1]]; }), "", function (v) {
      var pr = CV_PRESETS.filter(function (x) { return x[0] === v; })[0]; if (!pr || !pr[2]) return;
      ["rgb", "r", "g", "b"].forEach(function (c) { p[c] = JSON.parse(JSON.stringify(pr[2][c] || [[0, 0], [255, 255]])); }); draw(); st.schedule();
    }));
    el.appendChild(box);
    function draw() { box.textContent = ""; ed = AUI.curveEditor(box, p, function () { st.schedule(); }, st.src); }
    function setPts(kind, c) {
      ["r", "g", "b"].forEach(function (k, i) {
        var v = Math.round(c[i]), pts = p[k].filter(function (q) { return kind === "black" ? q[0] > v : kind === "white" ? q[0] < v : Math.abs(q[0] - v) > 3; });
        if (kind === "black") pts.unshift([Math.min(v, 250), 0]);
        else if (kind === "white") pts.push([Math.max(v, 5), 255]);
        else { pts.push([v, Math.round((c[0] + c[1] + c[2]) / 3)]); pts.sort(function (a, b) { return a[0] - b[0]; }); }
        p[k] = pts.length >= 2 ? pts : [[0, 0], [255, 255]];
      });
      draw(); st.schedule();
    }
    el.appendChild(h("div", { "class": "row pe-arow" }, [
      pickBtn("Black point", "Click something that should be black", function (pt) { var c = sample(st, pt); if (c) setPts("black", c); }),
      pickBtn("Grey point", "Click something that should be neutral grey", function (pt) { var c = sample(st, pt); if (c) setPts("grey", c); }),
      pickBtn("White point", "Click something that should be white", function (pt) { var c = sample(st, pt); if (c) setPts("white", c); })]));
    draw();
  } });

  // ---------- Hue / saturation per range ----------
  AUI.adj("hueSatPlus", { t: "Hue / Saturation", ui: function (el, st) {
    var p = st.p, which = -1, rs = [], rangeBox = h("div", { "class": "stack pe-asecin" }), colChk;
    p.master = [0, 0, 0]; p.colorize = null; p.ranges = A.HS_RANGES.map(function (r) { return [0, 0, 0, r[1] - 30, r[1], r[2], r[2] + 30]; });
    var keep = [35, 25, 0];
    function cur() { return p.colorize ? p.colorize : which < 0 ? p.master : p.ranges[which]; }
    function sync() {
      var c = cur(); rs[0]._set(c[0]); rs[1]._set(c[1]); rs[2]._set(c[2]);
      rangeBox.textContent = "";
      if (which >= 0 && !p.colorize) {
        var q = p.ranges[which];
        rangeBox.appendChild(K().range("Range: fades in from", (q[3] + 360) % 360, 0, 359, 1, function (v) { q[3] = v; st.schedule(); }, AUI.deg));
        rangeBox.appendChild(K().range("Range: full from", (q[4] + 360) % 360, 0, 359, 1, function (v) { q[4] = v; st.schedule(); }, AUI.deg));
        rangeBox.appendChild(K().range("Range: full to", (q[5] + 360) % 360, 0, 359, 1, function (v) { q[5] = v; st.schedule(); }, AUI.deg));
        rangeBox.appendChild(K().range("Range: fades out at", (q[6] + 360) % 360, 0, 359, 1, function (v) { q[6] = v; st.schedule(); }, AUI.deg));
      }
    }
    var sel = K().select("Edit", [["-1", "Master"]].concat(A.HS_RANGES.map(function (r, i) { return [String(i), r[0].charAt(0).toUpperCase() + r[0].slice(1)]; })), "-1", function (v) { which = +v; sync(); });
    el.appendChild(h("div", { "class": "row pe-arow" }, [sel, pickBtn("Pick range", "Click a colour in the image to edit its range", function (pt) {
      var c = sample(st, pt); if (!c) return; var hh = A.rgb2hsl(c[0], c[1], c[2])[0], best = 0, bd = 999;
      A.HS_RANGES.forEach(function (r, i) { var mid = (r[1] + (r[2] < r[1] ? r[2] + 360 : r[2])) / 2 % 360, dd = Math.min(Math.abs(hh - mid), 360 - Math.abs(hh - mid)); if (dd < bd) { bd = dd; best = i; } });
      which = best; p.ranges[best][3] = Math.round(hh - 45); p.ranges[best][4] = Math.round(hh - 15); p.ranges[best][5] = Math.round(hh + 15); p.ranges[best][6] = Math.round(hh + 45);
      sel.querySelector("select").value = String(best); sync();
    })]));
    [["Hue", -180, 180], ["Saturation", -100, 100], ["Lightness", -100, 100]].forEach(function (d, i) {
      var r = K().range(d[0], 0, d[1], d[2], 1, function (v) { var c = cur(); c[i] = v; if (p.colorize) keep[i] = v; st.schedule(); }); rs.push(r); el.appendChild(r);
    });
    el.appendChild(rangeBox);
    colChk = K().check("Colourise", false, function (v) { p.colorize = v ? keep.slice() : null; if (v) { rs[0].querySelector("input").min = "0"; rs[0].querySelector("input").max = "360"; rs[1].querySelector("input").min = "0"; } else { rs[0].querySelector("input").min = "-180"; rs[0].querySelector("input").max = "180"; rs[1].querySelector("input").min = "-100"; } sync(); st.schedule(); });
    el.appendChild(colChk);
    sync();
  } });

  // ---------- Black & white ----------
  var BW_PRESETS = [["", "Presets…"], ["default", "Default", PIX.BW_DEFAULT], ["red", "Red filter", { reds: 120, yellows: 110, greens: -10, cyans: -50, blues: -50, magentas: 120 }],
    ["yellow", "Yellow filter", { reds: 120, yellows: 110, greens: 40, cyans: -30, blues: 0, magentas: 70 }], ["green", "Green filter", { reds: 40, yellows: 110, greens: 120, cyans: 70, blues: 0, magentas: 0 }],
    ["blue", "Blue filter", { reds: 0, yellows: 0, greens: 20, cyans: 110, blues: 130, magentas: 110 }], ["ir", "Infrared look", { reds: -40, yellows: 235, greens: 145, cyans: -70, blues: -60, magentas: -45 }],
    ["hc", "High contrast", { reds: 120, yellows: 120, greens: -30, cyans: -60, blues: -60, magentas: 120 }], ["darker", "Darker", { reds: 20, yellows: 40, greens: 20, cyans: 40, blues: 0, magentas: 50 }],
    ["lighter", "Lighter", { reds: 60, yellows: 80, greens: 60, cyans: 80, blues: 40, magentas: 100 }], ["flat", "Neutral (equal)", { reds: 33, yellows: 66, greens: 33, cyans: 66, blues: 33, magentas: 66 }]];
  var BWK = ["reds", "yellows", "greens", "cyans", "blues", "magentas"];
  AUI.adj("bwPlus", { t: "Black & white", ui: function (el, st) {
    var p = st.p, rs = {};
    BWK.forEach(function (k) { p[k] = PIX.BW_DEFAULT[k]; }); p.tint = false; p.tintHue = 35; p.tintSat = 25;
    function set(o) { BWK.forEach(function (k) { if (o[k] != null) { p[k] = o[k]; rs[k]._set(o[k]); } }); st.schedule(); }
    el.appendChild(h("div", { "class": "row pe-arow" }, [K().select("", BW_PRESETS.map(function (x) { return [x[0], x[1]]; }), "", function (v) { var pr = BW_PRESETS.filter(function (x) { return x[0] === v; })[0]; if (pr && pr[2]) set(pr[2]); }),
      K().btn("Auto", function () { set(A.bwAuto(st.src, null)); }, "ghost", null, "Weights that keep the image's colours apart in grey")]));
    BWK.forEach(function (k) { rs[k] = K().range(k.charAt(0).toUpperCase() + k.slice(1), p[k], -200, 300, 1, function (v) { p[k] = v; st.schedule(); }, AUI.pc); el.appendChild(rs[k]); });
    el.appendChild(K().check("Tint", false, function (v) { p.tint = v; st.schedule(); }));
    el.appendChild(K().range("Tint hue", 35, 0, 360, 1, function (v) { p.tintHue = v; st.schedule(); }, AUI.deg));
    el.appendChild(K().range("Tint saturation", 25, 0, 100, 1, function (v) { p.tintSat = v; st.schedule(); }, AUI.pc));
  } });

  // ---------- Brightness / contrast ----------
  AUI.adj("brightnessPlus", { t: "Brightness / Contrast", c: [AUI.sl("b", "Brightness", -150, 150, 1, 0), AUI.sl("c", "Contrast", -50, 100, 1, 0)], chk: [["legacy", "Use the classic (linear) maths", false]],
    ui: function (el, st) {
      el.appendChild(K().btn("Auto", function () {
        var Hh = A.hists(st.src, null).l, tot = 0, acc = 0, med = 128, i; for (i = 0; i < 256; i++) tot += Hh[i];
        for (i = 0; i < 256; i++) { acc += Hh[i]; if (acc >= tot / 2) { med = i; break; } }
        var lo = A.clipLo(Hh, 0.005), hi = A.clipHi(Hh, 0.005);
        st.p.b = Math.round(A.clamp((118 - med) * 1.1, -100, 100)); st.p.c = Math.round(A.clamp((210 - (hi - lo)) / 2.5, -30, 60)); st.p.legacy = false;
        AUI.closePanel(false); AUI.openLive("brightnessPlus", { b: st.p.b, c: st.p.c });
      }, "ghost", null, "Suggested brightness and contrast for this image"));
    } });

  // menu items and shortcuts now open these panels
  replaceItem("Image", "Brightness / Contrast…", function () { AUI.open("brightnessPlus"); });
  replaceItem("Image", "Levels…", function () { AUI.open("levelsPlus"); });
  replaceItem("Image", "Curves…", function () { AUI.open("curvesPlus"); });
  replaceItem("Image", "Hue / Saturation…", function () { AUI.open("hueSatPlus"); });
  replaceItem("Image", "Black & white…", function () { AUI.open("bwPlus"); });
  AUI.key("Ctrl+L", function () { AUI.open("levelsPlus"); });
  AUI.key("Ctrl+M", function () { AUI.open("curvesPlus"); });
  AUI.key("Ctrl+U", function () { AUI.open("hueSatPlus"); });
  AUI.key("Ctrl+Alt+Shift+B", function () { AUI.open("bwPlus"); });
})();
