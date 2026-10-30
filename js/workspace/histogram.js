/* Workspace (files lane): Histogram panel. Colours (R, G, B overlaid), luminosity or one channel, for the whole image
   or the current layer, inside the selection if there is one. Mean, standard deviation, median and pixel count;
   hover the graph for the level, count and percentile. Counted in the worker on a sample of at most ~1 MP. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, h = S3.h;
  var HG = WS.histogram = {};
  var st = Object.assign({ ch: "rgb", src: "image" }, S3.store("pe-histo") || {}), data = null, sampled = false, cv, stats, hover, token = 0, sig = "";

  // stats for one 256-bin histogram
  HG.stats = function (H) {
    var n = 0, s = 0, s2 = 0, i;
    for (i = 0; i < 256; i++) { n += H[i]; s += H[i] * i; s2 += H[i] * i * i; }
    if (!n) return { n: 0, mean: 0, sd: 0, median: 0 };
    var mean = s / n, acc = 0, med = 0;
    for (i = 0; i < 256; i++) { acc += H[i]; if (acc * 2 >= n) { med = i; break; } }
    return { n: n, mean: mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)), median: med };
  };
  function source() {
    var d = ED.doc, L = ED.layer(), sel = d.sel, r = sel ? sel.b : { x: 0, y: 0, w: d.w, h: d.h }, k = Math.min(1, Math.sqrt(1e6 / (r.w * r.h)));
    sampled = k < 1;
    var o = { rect: r, scale: k, selMask: !!sel };
    if (st.src === "layer" && L) o.only = [L.id];
    var c = PE.flatten(d, o), img = PE.getData(c);
    return { data: img.data, width: img.width, height: img.height };
  }
  function compute() {
    if (!ED.doc) { data = null; draw(); return; }
    var t = ++token, img;
    try { img = source(); } catch (e) { return; }
    PE.work("histogram", [img]).then(function (r) { if (t !== token) return; data = r; draw(); }).catch(function () {});
  }
  var soon = S3.debounce(compute, 350);
  function css(v, d) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d; }
  function draw() {
    var dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 256, H = 100, x = cv.getContext("2d");
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    if (!data) { stats.textContent = ED.doc ? "…" : ""; return; }
    function curve(Hh, color, mx) {
      x.fillStyle = color; x.beginPath(); x.moveTo(0, H);
      for (var i = 0; i < 256; i++) x.lineTo(i / 255 * W, H - Math.min(1, Hh[i] / mx) * (H - 2));
      x.lineTo(W, H); x.closePath(); x.fill();
    }
    function peak(list) { var all = []; list.forEach(function (Hh) { for (var i = 1; i < 255; i++) all.push(Hh[i]); }); all.sort(function (a, b) { return a - b; }); return Math.max(1, all[Math.floor(all.length * 0.995)] * 1.1); }
    if (st.ch === "rgb") {
      var mx = peak([data.r, data.g, data.b]);
      x.globalCompositeOperation = css("--bg", "#fff") && document.documentElement.getAttribute("data-theme") === "light" ? "multiply" : "screen";
      curve(data.r, "rgba(229,72,77,.9)", mx); curve(data.g, "rgba(48,164,108,.9)", mx); curve(data.b, "rgba(62,99,221,.9)", mx);
      x.globalCompositeOperation = "source-over";
    } else curve(data[st.ch], st.ch === "r" ? "#e5484d" : st.ch === "g" ? "#30a46c" : st.ch === "b" ? "#3e63dd" : css("--text-2", "#888"), peak([data[st.ch]]));
    var s = HG.stats(st.ch === "rgb" ? data.l : data[st.ch]);
    stats.textContent = "Mean " + s.mean.toFixed(2) + "   Std dev " + s.sd.toFixed(2) + "\nMedian " + s.median + "   Pixels " + s.n.toLocaleString() + (sampled ? " (sampled)" : "");
  }
  HG.panel = WS.panel({ id: "histogram", title: "Histogram", open: false,
    build: function (body) {
      cv = h("canvas", { "class": "ws-histo", "aria-label": "Histogram" });
      stats = h("pre", { "class": "ws-hstats mono" }); hover = h("div", { "class": "ws-hhover mono faint" });
      var chSel = h("select", { "class": "select", "aria-label": "Channel" }), srcSel = h("select", { "class": "select", "aria-label": "Source" });
      [["rgb", "Colours"], ["l", "Luminosity"], ["r", "Red"], ["g", "Green"], ["b", "Blue"]].forEach(function (o) { var e = h("option", { value: o[0], text: o[1] }); if (o[0] === st.ch) e.selected = true; chSel.appendChild(e); });
      [["image", "Entire image"], ["layer", "Selected layer"]].forEach(function (o) { var e = h("option", { value: o[0], text: o[1] }); if (o[0] === st.src) e.selected = true; srcSel.appendChild(e); });
      chSel.addEventListener("change", function () { st.ch = chSel.value; S3.store("pe-histo", st); draw(); });
      srcSel.addEventListener("change", function () { st.src = srcSel.value; S3.store("pe-histo", st); compute(); });
      cv.addEventListener("pointermove", function (e) {
        if (!data) return; var r = cv.getBoundingClientRect(), lv = PE.clamp(Math.round((e.clientX - r.left) / r.width * 255), 0, 255), Hh = st.ch === "rgb" ? data.l : data[st.ch], n = 0, below = 0;
        for (var i = 0; i < 256; i++) { n += Hh[i]; if (i <= lv) below += Hh[i]; }
        hover.textContent = "Level " + lv + "   Count " + Hh[lv].toLocaleString() + "   Percentile " + (n ? (below / n * 100).toFixed(2) : "0") + "%";
      });
      cv.addEventListener("pointerleave", function () { hover.textContent = ""; });
      body.appendChild(h("div", { "class": "ws-hsel" }, [chSel, srcSel]));
      body.appendChild(cv); body.appendChild(hover); body.appendChild(stats);
    },
    update: function (why) {
      if (why === "cursor" || why === "view") return;
      var d = ED.doc, s = d ? [d.id, ED.hist && ED.hist.pos, ED.hist && ED.hist.list.length, d.sel && d.sel.b.w, d.active, st.src].join(":") : "";
      if (s !== sig || why === "open" || why === "init") { sig = s; data = null; draw(); soon(); }
    } });
})();
window.PE.files.tests.push(async function (ok, near) {
  var H = new Uint32Array(256); H[10] = 2; H[20] = 2;
  var s = PE.ws.histogram.stats(H); ok(s.n === 4 && near(s.mean, 15, 1e-9) && near(s.sd, 5, 1e-9) && s.median === 10, "histogram stats");
});
