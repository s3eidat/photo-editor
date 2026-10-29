# Photo Editor → full desktop-photo-editor parity

Goal: every feature a pro uses in Adobe Photoshop, working in this browser app, free, private, offline.
**Feature parity, not a copy.** Write every line fresh. Never use Adobe's name in the UI, its logos, icons,
cursors, splash art, sample images, preset files or help text. Generic industry terms (Layers, Curves, Magic
Wand, Clone Stamp…) are fine; Adobe trademarks are not (say "Fill with surroundings", not "Content-Aware Fill";
"Smart layer", not "Smart Object"). Keyboard shortcuts may match the industry standard.

Five lanes work at the same time in separate cloud sessions. Each lane owns its own new files, so they
rarely touch the same lines. `features.csv`-style tracking lives in `parity/<lane>.md` (one per lane).

## Shared rules (all lanes)
- Read `README.md`, `app.js` and every file in `js/` before writing anything. Follow the existing patterns
  (tool registration, history/undo, workers, layer model, panels, shortcuts). Extend through hooks; don't rewrite.
- New code goes in **your lane's files** (below). In shared files (`js/editor.js`, `js/ui.js`, `js/core.js`,
  `index.html`, `app.css`, `app.js`) only add small, clearly marked hook lines (`// lane:<name>`), never reformat.
- Hard rules from the site: no network at all, no inline scripts, no `on*=` attributes, no eval, user input never
  into innerHTML unescaped. Libraries only vendored into `lib/` with their LICENSE (MIT/BSD/Apache), loaded
  with `<script src>`; WASM needs the `wasm-unsafe-eval` CSP variant (copy it from github.com/s3eidat/bg-remover).
- Heavy pixel work in Web Workers; keep the UI at 60 fps on a 4000×3000 image; memory-bounded history
  (every new action must undo/redo through the existing history system).
- Works on phones (390 px) without breaking desktop. Light and dark. Arabic UI strings where the app has them.
- Extend `window.S3_SELFTEST` with known-answer checks for your maths (blend modes, filters, path booleans…).
- Test before every push: `python3 -m http.server`, Playwright loads the page with no console errors,
  `await S3_SELFTEST()` is true, and your new feature runs end to end on a demo image.
- Commit small and often (`<lane>: <feature>`), `git pull --rebase` before every push, resolve conflicts by
  keeping both sides' hook lines. Never push a broken `main` — the live site updates within a minute.
- Update `parity/<lane>.md` as you go: feature, status (done / partial / skipped + why), notes.
- Stop at 2026-11-05 07:00 UTC.

## Lanes and the files they own

**selection** → `js/select/*.js`, `js/layers/*.js`
Quick selection brush, select subject / remove background (reuse the on-device model and code from
github.com/s3eidat/bg-remover), color range, focus area, select & mask workspace (radius, smooth, feather,
contrast, shift edge, decontaminate, refine-edge brush), grow, similar, modify (expand, contract, border,
smooth), transform selection, save/load selection as channels, quick mask mode, clipping masks, vector masks,
layer groups/folders (nested, collapse, group opacity/blend), all 27 blend modes + fill opacity, layer styles
(drop shadow, inner shadow, outer/inner glow, bevel & emboss, satin, color/gradient/pattern overlay, stroke;
copy/paste style), adjustment layers and fill layers (solid, gradient, pattern) non-destructive,
smart layers with non-destructive transforms and smart filters, linked layers, align/distribute,
stamp visible, layer comps, artboards, channels panel.

**paint** → `js/paint/*.js`
Brush engine: spacing, size/angle/roundness jitter, scattering, texture, dual brush, color dynamics,
transfer, smoothing, pen pressure and tilt (Pointer Events), brush presets panel, custom brush from selection,
import .abr sampled brushes. Pencil, mixer brush, history brush, color replacement, background eraser,
magic eraser, pattern stamp, dodge / burn / sponge, blur / sharpen / smudge tools, spot healing (no source),
patch tool, fill-with-surroundings (PatchMatch-style, in a worker), content-aware move, red-eye,
gradient editor (multi-stop, opacity stops, noise gradients, angle/reflected/diamond), patterns panel,
swatches panel, full color picker (HSB/RGB/Lab/hex, only-web-colors), symmetry painting.

**vector** → `js/vector/*.js`
Pen tool (bezier), freeform/curvature pen, add/delete/convert anchor, path & direct selection, paths panel
(save, stroke, fill, make selection, selection to path), shape tools (rect, rounded, ellipse, polygon/star,
line/arrow, custom shapes) as live vector layers with fill/stroke/dash, path operations (unite, subtract,
intersect, exclude), point text and paragraph text, character & paragraph panels (tracking, kerning, leading,
baseline, caps, faux bold/italic, indent, justification), text on a path, warp text, glyphs panel,
transform: skew, distort, perspective, warp mesh, puppet-style pin warp, perspective warp,
content-aware-style scale (seam carving), liquify (forward warp, reconstruct, smooth, twirl, pucker, bloat,
push left, freeze/thaw masks, face-aware off).

**adjust** → `js/adjust/*.js`
Adjustments: photo filter, channel mixer, gradient map, selective color, shadows/highlights, HDR toning,
match color, replace color, posterize, equalize, auto tone / contrast / color, color lookup (.cube 3D LUT
import), desaturate options. A "develop" panel (raw-style): white balance temp/tint, exposure, contrast,
highlights, shadows, whites, blacks, texture, clarity, dehaze, vibrance, saturation, tone curve, HSL / color
mixer, color grading (shadows/mids/highlights wheels), detail (sharpen, noise reduction), lens (vignette,
distortion, chromatic aberration), effects (grain), presets. Filters: filter gallery (artistic/sketch-style
set made fresh), oil paint, emboss, find edges, glowing edges, solarize, trace contour, motion blur, radial
blur, surface blur, smart blur, lens blur (depth from mask), tilt-shift / field / iris blur, median, despeckle,
dust & scratches, reduce noise, high pass, minimum/maximum, offset, ripple, twirl, spherize, pinch, wave,
zigzag, polar coordinates, shear, displace (map), clouds, difference clouds, fibers, lens flare, lighting
effects, halftone / color halftone, mosaic, crystallize, pointillize, mezzotint. Fade last filter.

**files** → `js/files/*.js`, `js/workspace/*.js`
PSD open and save with layers, masks, groups, text, blend modes, opacity (vendor `ag-psd`, MIT), TIFF
export, export-as dialog (format, quality, scale, metadata strip, size preview), export layers to files,
quick export, multiple open documents in tabs, rulers, guides (drag from rulers, new guide layout), grid,
snapping, smart guides, navigator, histogram, info panel (RGB/HSB/Lab under cursor, sizes), actions panel
(record, play, batch over many files with save-as), image modes preview (grayscale, duotone, indexed with
palette export), 8/16-bit note, soft-proof CMYK preview (simulated), image trim / reveal all, notes/count
tool, ruler/measure tool, workspace: dockable/collapsible panels, saved workspaces, customizable shortcuts
(editor + export/import), preferences (history steps, units, guides color), print with crop marks.

Skip (state why in parity file): 3D, video timeline, cloud documents/libraries, stock, generative AI fill
that needs a server, plugin marketplace, accounts.
