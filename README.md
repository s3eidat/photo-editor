# Photo Editor

> A layered photo editor in your browser: layers and masks, selections, retouching, adjustments, text and export. Free, private, no ads, no sign-up, and it runs entirely on your device.

### ▶ [Open Photo Editor](https://s3eidat.github.io/photo-editor/)

![Photo Editor screenshot](screenshot.png)

A free, local-first alternative to image editors like Photoshop, for the everyday core: open a photo, fix it, add text, export.

## Features

- **Documents** from any image (PNG, JPG, WebP, GIF, BMP, AVIF; drop, paste or pick, several at once) or blank with **12 size presets** (social, HD/4K, A4/Letter at 300 dpi, photo prints) and a white, transparent or coloured background
- **Layers**: pixel, **live text** and **live shape** layers; add, duplicate, delete, drag to reorder, rename, hide, lock, opacity, **fill opacity** and **all 27 blend modes**; merge down, merge visible, flatten, layer via copy / cut, merge copy, stamp visible
- **Groups** (nested, collapsible, pass-through or isolated with their own opacity, blend and mask), **clipping masks**, **linked layers**, multi-select, **align and distribute**
- **Non-destructive layers**: **adjustment layers** (levels, curves, hue/saturation and every colour adjustment), **fill layers** (colour, gradient, pattern), **smart layers** (transform without quality loss) with editable **smart filters**
- **Layer styles**: drop shadow, inner shadow, outer and inner glow, bevel & emboss, satin, colour / gradient / pattern overlay and stroke, with copy / paste style
- **Vector masks**, **layer comps** and **artboards** (export each board as PNG)
- **Layer masks**: add (reveal all or from the selection), paint black to hide and white to reveal with any brush, gradient or fill, enable/disable, invert, apply, delete
- **Selections**: rectangle, ellipse, lasso, polygonal lasso and **magic wand** (tolerance, contiguous, all layers), with new / add / subtract / intersect (or Shift / Alt / Shift+Alt), select all, deselect, inverse, **feather**, expand, contract, border, smooth, grow, similar, select layer pixels, transform selection. Painting, fills, adjustments and filters stay inside the selection
- **Smart selections**: **select subject** and **remove background** (on-device AI), **select sky**, **quick selection** brush, **colour range**, **focus area**, a **refine selection** workspace (edge detection, refine-edge brush, smooth, feather, contrast, shift edge, decontaminate colours), **quick mask** mode and **saved selections** in a Channels panel
- **Move and free transform**: move a layer or the selected pixels (Alt to copy), scale, rotate and flip with handles or numbers; text and shapes stay editable after transforming
- **Crop** with ratios (1:1, 4:5, 3:2, 4:3, 16:9, 9:16, original) and rule-of-thirds guides, **canvas size** with anchor, **image size**, rotate 90°/180°, flip canvas
- **Brush and eraser** with size, hardness and opacity (one opacity per stroke, like the pros), straight lines with Shift; **gradient** (linear/radial, to transparent) and **paint bucket**; **eyedropper**
- **Clone stamp** and **healing brush** (copies texture from the source and matches the colour and brightness around the stroke)
- **Text** with any font installed on your device, bold, italic, alignment, line height, rotation and **Arabic / right-to-left** (auto-detected or forced)
- **Shapes**: rectangle (rounded corners), ellipse, triangle, star, arrow and line with fill and stroke
- **Adjustments** with live preview: brightness/contrast, **levels** (with auto), **curves** (RGB and per channel), exposure, **hue/saturation** (and colorize), vibrance, colour balance, black & white, invert, desaturate, threshold
- **Filters**: Gaussian blur, sharpen, **unsharp mask**, add noise, pixelate, vignette
- **History panel** with undo/redo and jump to any step. Steps store only the changed 64 px tiles and stay within a memory budget
- Zoom and pan (wheel, Space-drag, pinch), **keyboard shortcuts** close to industry conventions (press `?`)
- **Autosave** in this browser (IndexedDB) with a recent-projects list; **save and open `.s3photo` project files** (layers, masks, text and shapes stay editable). Opened files are checked field by field before use
- **Export PNG, JPG or WebP** with quality and scale, or **export just the selection**

## Limits

- Documents are limited to 8000 px a side and 40 megapixels (bigger images are scaled down when opened, with a message).
- 8-bit RGB only: no CMYK, 16-bit, RAW development or colour profiles. No PSD files.
- No generative AI (fill, sky replacement). Select subject / remove background use a small on-device model (U²-Net small, about 16 MB including the engine, downloaded once from this site, then offline); fine hair and glass need the refine tools.
- Fonts are the ones on your device; a project file opened on another device falls back if the font is missing.
- Free transform on a pixel layer is applied when you press Apply (pixels are resampled once).
- Some browsers reserve Ctrl+T, Ctrl+N and Ctrl+Shift+N; use the menu, the buttons, or the alternatives in the shortcut list.

## Privacy

Your photos never leave your device. There is no server, no account and no analytics.
The page ships with a strict Content-Security-Policy (`connect-src 'self'`), so the browser itself blocks
any attempt to send data anywhere. Projects are stored only in this browser until you save a file.

## Run it yourself

It's plain HTML, CSS and JavaScript with no build step and no libraries:

```bash
git clone https://github.com/s3eidat/photo-editor
cd photo-editor
python -m http.server 8000
```

Then open http://localhost:8000. Heavy pixel work runs in a Web Worker (`js/worker.js`).

## Support

If this saved you time, **[buy me a coffee ☕](https://s3eidat.github.io/coffee/)**. It keeps every tool free.

---

Part of **[S3eidat Tools](https://s3eidat.github.io/)**: 100+ free, private tools that run in your browser. MIT licensed.
