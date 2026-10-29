# Lane: files

| Feature | Status | Notes |
|---|---|---|
| PSD open | done | File › Open (or drop) a `.psd`. Layers keep pixels, position, name, visibility, lock, opacity, blend mode, fill opacity and clipping (when the selection lane's model is present), layer masks (default colour, disabled flag) and vector masks (rasterised into the mask). Point and paragraph text stay editable when they use one style (font, size, colour, bold/italic, alignment, leading, rotation, flip; paragraph text is wrapped to its box); mixed-style, warped, vertical and on-path text keep their pixels. Live rectangles, rounded rectangles and ellipses stay editable shapes; other vector shapes keep their pixels. Groups are flattened into plain layers (folded visibility/opacity) until the selection lane's groups land, then they map 1:1. 8/16/32-bit, RGB, greyscale, indexed and bitmap files open (16/32-bit are converted to 8-bit). Resolution and guides are kept. A file with no layers opens its merged image; one with more than 100 layers opens merged with a message. Parsing runs in a worker (`js/files/psd-worker.js`). Checked against 70 sample files from the ag-psd test suite (not committed). |
| PSD save | done | File › Save as PSD…. Writes every layer with its pixels, masks, opacity, blend, visibility, lock, fill opacity, clipping; text layers as real text (font PostScript name, size, colour, faux bold/italic, leading, alignment, rotation) plus the rendered pixels; shapes as vector shape layers (path + fill + stroke; rectangles/ellipses also as live shapes); groups nested when present; merged image, resolution and guides. Our exact text/shape settings ride in XMP, so a round trip through this app is pixel-identical; they are only used while the file's own data still matches. Verified with an independent reader (psd-tools). |

Not supported (by the vendored parser, ag-psd 31.0.3): CMYK, Lab, multichannel and duotone colour modes (a clear message asks to convert to RGB first), PSB large-document files. Layer styles and adjustment layers are reported as left out until the selection/adjust lanes add them, then they get mapped.

## Hooks this lane added to shared files
All marked `// lane:files` (or `<!-- lane:files -->`); where the selection lane already added the same hook the line is identical, so merges are clean.
- `index.html`: script tags for `js/files/*` (and later `js/workspace/*`), before `app.js`; `.psd` in the open dialog's accept list.
- `js/ui.js`: `ED.ui.openExt(files, asLayers)` called from `openFiles` (extra file formats); same `ED.ui.MENUS` / `ED.ui.w` / `ED.ui.keys` line as the selection lane.
- Self-test: `PE.files.tests` (array of `async (ok, near, px, solid) => {}`) run after `S3_SELFTEST` by wrapping it; no change to `app.js`.

## Third-party code
- `lib/ag-psd.js`: ag-psd 31.0.3 browser bundle (MIT), minified, with pako, base64-js, buffer (MIT) and ieee754 (BSD-3). Licences in `lib/ag-psd.LICENSE`. Loaded only by the PSD worker (or lazily on this thread if workers are unavailable).
