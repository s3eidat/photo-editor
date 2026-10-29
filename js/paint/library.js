/* Photo Editor paint lane: export and import your paint library (brush presets with their tips, patterns,
   gradients, swatches) as one .s3paint file (zip + JSON + PNG), to move it to another browser or device.
   Everything in an opened file is checked before use. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, K = ED.ui.kit, h = S3.h;
  var LIM = { tips: 500, presets: 1000, patterns: 300, gradients: 500, swatches: 5000, tipSide: 2500, patSide: 1024, bytes: 300e6 };

  function grayCanvas(t) { return t.canvas; }      // tips are white with alpha = paint: stored as PNG as they are
  PP.exportLibrary = function () {
    var meta = { format: "s3paint", version: 1, presets: [], tips: [], patterns: [], gradients: [], swatches: [] }, files = [], jobs = [], n = 0;
    PP.presets().filter(function (p) { return !p.builtin; }).forEach(function (p) { meta.presets.push({ name: p.name, s: p.s }); });
    Object.keys(PP.tips).forEach(function (id) {
      var t = PP.tips[id]; if (t.builtin || id.charAt(0) === "_") return;
      var src = "tips/" + (n++) + ".png", rec = { id: id, name: t.name, src: src }; meta.tips.push(rec);
      jobs.push(PE.pngOf(grayCanvas(t)).then(function (e) { files.push({ name: src, data: e.bytes, crc: e.crc }); }));
    });
    PP.patternList().filter(function (p) { return !p.builtin; }).forEach(function (p, i) {
      var src = "patterns/" + i + ".png"; meta.patterns.push({ name: p.name, src: src });
      jobs.push(PE.pngOf(p.canvas).then(function (e) { files.push({ name: src, data: e.bytes, crc: e.crc }); }));
    });
    PP.gradients().filter(function (g) { return g.id.indexOf("b:") !== 0; }).forEach(function (g) { meta.gradients.push(PE.clone(g)); });
    return PP.swatches().then(function (sw) {
      meta.swatches = sw.slice();
      return Promise.all(jobs);
    }).then(function () {
      files.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      return PE.zipWrite([{ name: "paint.json", data: JSON.stringify(meta) }].concat(files));
    });
  };
  function arr(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }
  function str(v, n, d) { return typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, n) : d; }
  PP.importLibrary = function (u8, opt) {
    opt = opt || {};
    if (u8.length > LIM.bytes) return Promise.reject(new Error("That file is too large for a paint library"));
    var entries;
    try { entries = PE.zipEntries(u8); } catch (e) { return Promise.reject(new Error("This is not a paint library (.s3paint) file")); }
    var by = {};
    entries.forEach(function (e) { if (/^(paint\.json|tips\/\d{1,4}\.png|patterns\/\d{1,4}\.png)$/.test(e.name) && !by[e.name]) by[e.name] = e; });
    if (!by["paint.json"]) return Promise.reject(new Error("This is not a paint library (no paint.json)"));
    return PE.zipRead(u8, by["paint.json"], 8e6).then(function (b) {
      var m;
      try { m = JSON.parse(new TextDecoder().decode(b)); } catch (e) { throw new Error("This paint library is damaged (bad JSON)"); }
      if (!m || m.format !== "s3paint" || typeof m !== "object") throw new Error("This is not a paint library");
      if (+m.version > 1) throw new Error("This library was made by a newer version of Photo Editor");
      function png(src, maxSide) {
        var e = typeof src === "string" ? by[src] : null; if (!e) return Promise.resolve(null);
        return PE.zipRead(u8, e, 40e6).then(function (bytes) {
          var s = PE.pngSize(bytes); if (!s || s.w < 1 || s.h < 1 || s.w > maxSide || s.h > maxSide) return null;
          return PE.bytesToCanvas(bytes).then(function (c) { return c.width === s.w && c.height === s.h ? c : null; });
        }).catch(function () { return null; });
      }
      var map = {}, count = { brushes: 0, patterns: 0, gradients: 0, swatches: 0 };
      var tips = arr(m.tips, LIM.tips).reduce(function (p, t) {
        return p.then(function () {
          return png(t && t.src, LIM.tipSide).then(function (c) {
            if (!c) return;
            var d = PE.getData(c).data, g = new Uint8Array(c.width * c.height); for (var i = 0; i < g.length; i++) g[i] = d[i * 4 + 3];
            map[str(t.id, 60, "")] = PP.importTip(str(t.name, 60, "Tip"), c.width, c.height, g);
          });
        });
      }, Promise.resolve());
      return tips.then(function () {
        arr(m.presets, LIM.presets).forEach(function (p) {
          if (!p || typeof p.s !== "object" || !p.s) return;
          var s = Object.assign({}, p.s); if (typeof s.tip === "string" && s.tip) s.tip = map[s.tip] || (PP.tips[s.tip] && PP.tips[s.tip].builtin ? s.tip : "");
          PP.addPreset(str(p.name, 60, "Brush"), s); count.brushes++;
        });
        return arr(m.patterns, LIM.patterns).reduce(function (p, t) { return p.then(function () { return png(t && t.src, LIM.patSide).then(function (c) { if (c) { PP.addPattern(c, str(t.name, 60, "Pattern")); count.patterns++; } }); }); }, Promise.resolve());
      }).then(function () {
        arr(m.gradients, LIM.gradients).forEach(function (g) { if (PP.addGradient(g)) count.gradients++; });
        if (opt.noSwatches) return count;
        return PP.addSwatches(arr(m.swatches, LIM.swatches)).then(function (n) { count.swatches = n; return count; });
      });
    });
  };
  var file = null;
  function pick() {
    if (!file) {
      file = h("input", { type: "file", accept: ".s3paint", hidden: true }); document.body.appendChild(file);
      file.addEventListener("change", function () {
        var f = file.files[0]; file.value = ""; if (!f) return;
        ED.working(f.arrayBuffer().then(function (ab) { return PP.importLibrary(new Uint8Array(ab)); }), "Importing…").then(function (c) {
          S3.toast("Imported " + c.brushes + " brushes, " + c.patterns + " patterns, " + c.gradients + " gradients, " + c.swatches + " swatches");
        }).catch(function (e) { S3.toast(e.message, "error"); });
      });
    }
    file.click();
  }
  PP.menu("Edit", ["-", ["Export paint library…", "", function () {
    ED.working(PP.exportLibrary(), "Exporting…").then(function (blob) { S3.download(blob, "paint-library.s3paint", "application/zip"); S3.toast("Saved paint-library.s3paint (" + S3.fmtBytes(blob.size) + ")"); }).catch(function (e) { S3.toast(e.message, "error"); });
  }], ["Import paint library…", "", pick]]);
  void K;

  PP.test("paint library file", async function (ok) {
    var g = new Uint8Array(16 * 8); for (var i = 0; i < g.length; i++) g[i] = i % 16 < 8 ? 255 : 40;
    var tid = PP.importTip("Lib tip", 16, 8, g), pr = PP.addPreset("Lib brush", { tip: tid, size: 33, spacing: 40, scatter: 20 });
    var pc = PE.mk(4, 4); PE.cx2(pc).fillStyle = "#336699"; PE.cx2(pc).fillRect(0, 0, 4, 4); var pat = PP.addPattern(pc, "Lib pattern");
    var gr = PP.addGradient({ name: "Lib grad", kind: "solid", stops: [{ p: 0, c: "#ff0000" }, { p: 1, c: "fg" }], alpha: [{ p: 0, a: 1 }, { p: 1, a: 0.5 }] });
    var blob = await PP.exportLibrary(), u8 = new Uint8Array(await blob.arrayBuffer());
    var before = PP.presets().length, c = await PP.importLibrary(u8, { noSwatches: true });
    var got = PP.presets().filter(function (p) { return p.name === "Lib brush"; });
    ok(c.brushes >= 1 && got.length === 2 && got[1].s.size === 33 && got[1].s.tip && got[1].s.tip !== tid && PP.tips[got[1].s.tip].w === 16, "brushes come back with their own tips");
    var t2 = PP.tips[got[1].s.tip], a = PE.getData(t2.canvas).data; ok(a[3] === 255 && a[15 * 4 + 3] === 40, "tip pixels are exact");
    ok(PP.patternList().filter(function (p) { return p.name === "Lib pattern"; }).length === 2 && PP.gradients().filter(function (x) { return x.name === "Lib grad"; }).length === 2, "patterns and gradients come back");
    var threw = false; try { await PP.importLibrary(new TextEncoder().encode("nope")); } catch (e) { threw = true; } ok(threw, "rejects other files");
    var bad = await PE.zipWrite([{ name: "paint.json", data: JSON.stringify({ format: "s3paint", version: 1, presets: [{ name: "x", s: { count: 1e9, size: 1e7, tip: "../evil" } }] }) }]).arrayBuffer();
    await PP.importLibrary(new Uint8Array(bad), { noSwatches: true }); var x = PP.presets().filter(function (p) { return p.name === "x"; })[0];
    ok(x && x.s.count === 16 && x.s.size === 1000 && x.s.tip === "", "imported settings are clamped");
    void before; void pr; void pat; void gr;
    // tidy up the test entries
    PP.presets().filter(function (p) { return p.name === "Lib brush" || p.name === "x"; }).forEach(function (p) { PP.deletePreset(p); });
    Object.keys(PP.tips).forEach(function (id) { if (PP.tips[id].name === "Lib tip") { delete PP.tips[id]; PP.lib.del(id).catch(function () {}); } });
    PP.patternList().filter(function (p) { return p.name === "Lib pattern"; }).forEach(function (p) { PP.removePattern(p.id); });
    PP.gradients().filter(function (q) { return q.name === "Lib grad"; }).forEach(function (q) { PP.removeGradient(q.id); });
    PP.setPattern("pt:checks");
  });
})();
