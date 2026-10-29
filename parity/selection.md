# Lane: selection

| Feature | Status | Notes |
|---|---|---|
| Modify: border, smooth | done | Select › Border… / Smooth…. Border is a band straddling the edge from an exact distance transform (anti-aliased); smooth is a majority filter (removes specks, rounds corners). Worker: `js/select/worker.js`. |
| Select subject / remove background | done | Select › Subject (also a button on the selection tools' option bar) and Layer › Remove background (adds a layer mask). Same on-device AI as bg-remover: U²-Net small via ONNX Runtime Web, engine + model (~16 MB) fetched from this site on first use only, then cached (service worker) for offline. Mask predicted at 320 px, edges snapped with a guided filter at up to 1600 px, then scaled to the document. CSP gains `'wasm-unsafe-eval'` (WebAssembly compile only; JS eval stays blocked). |
| All 27 blend modes | done | Normal, dissolve, darken group (darken, multiply, colour burn, linear burn, darker colour), lighten group (lighten, screen, colour dodge, linear dodge (add), lighter colour), contrast group (overlay, soft/hard/vivid/linear/pin light, hard mix), difference, exclusion, subtract, divide, hue, saturation, colour, luminosity. 16 run natively on the canvas; 11 in JS (`PIX.blendRegion`, byte lookup tables). Grouped menu, Shift+Alt+letter shortcuts, Shift +/− steps through modes (when a non-painting tool is active). Self-test checks every mode in the compositor against the per-pixel maths. |
| Fill opacity | done | "Fill" slider under Opacity; equals opacity until layer styles exist (styles stay at full strength). Saved in projects, undoable. The "special 8" fill behaviour of some modes is not replicated. |
| Layer groups | done | Nested groups (kind `group`, members point to it with `parent`), collapse/expand, pass-through by default or any blend mode + opacity + group mask (isolated), Ctrl+G / Ctrl+Shift+G, New group button, drag layers in/out of groups, Ctrl+[ ] walks in and out of open groups, move / free transform / flip / hide / lock / duplicate / delete / merge with members. Multi-select in the panel (Ctrl/Cmd+click, Shift+click) for grouping, duplicating, deleting and merging. |
| Grow, similar | done | Select › Grow / Similar use the Magic wand tolerance and "All layers" setting; colours are matched against every colour already selected (binned 64 levels/channel, max-channel distance like the wand). |

## Hooks this lane added to shared files
All marked `// lane:selection` (or `<!-- lane:selection -->`).
- `index.html`: script tags for `js/select/*` and `js/layers/*`, after `ui.js`, before `app.js`.
- `js/ui.js`: `ED.ui.MENUS`, `ED.ui.TOOLS`, `ED.ui.w` (option/dialog widgets) exposed so lanes can add menu items, tools and dialogs.
- `js/core.js`: `PE.drawHook` (lane compositor, returns false to keep the original loop), `PE.snapExt` / `PE.restoreExt` (extra layer fields in undo snapshots), `PE.kindsExt`, `PE.parseExt`, `PE.saveExt`, `PE.openExt` (extra layer kinds/fields in .s3photo files; layers also keep their id as `uid`).
- `js/core.js`: `PE.surfaceExt[kind]`, `PE.vboxExt[kind]` (pixels / box of new layer kinds).
- `js/editor.js`: `PE.editableExt` (extra editing rules), `PE.shiftExt` (move members / linked layers), `PE.xfExt[kind]` (transform of new kinds).
- `js/ui.js`: `ED.ui.layersExt` (Layers panel as a tree), `ED.ui.propsExt` (Properties for new kinds), `PE.dupExt`, `PE.removeExt`, `PE.mergeExt`, `PE.moveExt` (layer operations that understand groups).
- `js/ui.js`: `ED.ui.optsTail` — array of `f(tool, items)` that append controls to the tool options bar.
- `index.html`: CSP `script-src 'self' 'wasm-unsafe-eval'`; vendored `lib/ort.*` (ONNX Runtime Web, MIT) and `models/u2netp/` (Apache-2.0), see `models/LICENSES.md`.
- `js/ui.js`: `ED.ui.keys` — array of key handlers `f(e) -> true if handled`, run before the built-in shortcuts.
- Self-test: `PE.sx.tests` (array of `async (ok, near) => {}`) runs after the app's own `S3_SELFTEST`; no change to `app.js`.
