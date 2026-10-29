# Lane: adjust

Code: `js/adjust/*.js` (maths in `amath.js`, `tone.js`, …; UI in `ui.js`; checks in `tests.js`).
Hooks in shared files are marked `// lane:adjust`: `PIX.adjust` dispatches to `PIX.EXT`, the worker imports the
maths files, `openAdjust` calls `spec.ui`, `ED.adjKit` exposes the UI widgets, `S3_SELFTEST` runs `PE.adjustTests`.

| Feature | Status | Notes |
|---|---|---|
| Auto tone / auto contrast / auto colour | done | Image menu, Ctrl+Shift+L / Ctrl+Alt+Shift+L / Ctrl+Shift+B; 0.1% clip; auto colour neutralises midtones per channel |
| Shadows / highlights | done | Image menu; amount / tonal width / radius for each, colour, midtone contrast; edge-aware (guided filter) neighbourhood so no halos |
| Fade last filter / adjustment | done | Edit › Fade… (Ctrl+Shift+F) right after any adjustment or filter: opacity + 16 blend modes, live preview, limited to the selection used then; one more history step |
| Photo filter | done | Image › More adjustments; 14 colour presets (own names/colours) or any colour, density, preserve luminosity |
| Desaturate options | done | Image › More adjustments › Desaturate…: Rec. 601 / Rec. 709 luminosity, average, lightness, brightest / darkest channel, single channel; amount (the one-click Desaturate stays) |
| Posterize | done | Image › More adjustments; 2–64 levels per channel |
| Equalize | done | Image › More adjustments; one table for R, G, B from their combined histogram (keeps hues); with a selection: selected area only, or the whole layer from the selection's histogram |
| Gradient map | done | Image › More adjustments; foreground→background or 8 own presets, stop editor (2–6 colour stops with positions), reverse, dither |
| Channel mixer | done | Image › More adjustments; per output channel R/G/B % + constant, monochrome, total readout, 7 presets (own) |
| Selective colour | done | Image › More adjustments; reds, yellows, greens, cyans, blues, magentas, whites, neutrals, blacks × cyan / magenta / yellow / black, relative or absolute |
| Develop panel (raw-style) | done | Filter › Develop… (Ctrl+Shift+A). White balance temp/tint, exposure, contrast, highlights, shadows (edge-aware local), whites, blacks, texture, clarity, dehaze, vibrance, saturation; 4-region tone curve; colour mixer (8 hue bands × hue/sat/lum); colour grading wheels (shadows/mid/highlights/global, blending, balance); sharpening (amount/radius/detail/masking); noise reduction (luminance/colour); lens distortion, colour fringe (R/C, B/Y), vignette (amount/midpoint/roundness/feather); grain (amount/size/roughness); 9 built-in looks + user presets (this browser). Point tone curve: use Image › Curves |
| Fast previews | done | This lane's panels preview big layers at ~screen size (≥1.5 MP) in the worker, drawn scaled on the GPU; OK renders the exact full-size result. Develop on 12 MP: ~0.6 s per preview, ~5 s final |
| Motion blur, radial blur (spin / zoom, centre, quality) | done | Filter › Blur; uniform "comb" of taps in two passes (≈√L + √L taps per pixel instead of L), alpha-correct |
| Surface blur, smart blur (normal / edges only / overlay edges) | done | Filter › Blur; edge-preserving guided filter (per channel / luminance-guided) |
| Reduce noise, dust & scratches, median, despeckle | done | Filter › Noise; median is a sliding-histogram (O(r) per pixel); dust & scratches only replaces pixels beyond the threshold; despeckle keeps edges |
| High pass, minimum, maximum (squareness / roundness) | done | Filter › Other; min/max use van Herk/Gil-Werman running min/max (O(1) per pixel) |
| Colour lookup (.cube 3D / 1D LUT import) | done | Image › More adjustments › Colour lookup…: load any .cube (3D up to 129³ or 1D, DOMAIN_MIN/MAX), trilinear, amount; 11 built-in looks generated in code (own names); files stay on the device for this session |
| Replace colour | done | Image › More adjustments; pick / add (Shift keeps picking) colours on the canvas, Lab-distance fuzziness, hue / saturation / lightness, show selected area |
| Match colour | done | Image › More adjustments; source = any layer (optionally its selection), mean/std transfer in CIE Lab, luminance, colour intensity, fade, neutralise |
| HDR toning (single image) | done | Image › More adjustments; log-luminance base/detail split (edge-aware or soft), strength, radius, detail, gamma, exposure, shadow, highlight, vibrance, saturation, 5 presets |
| Emboss, find edges, glowing edges, solarize, trace contour | done | Filter › Stylize; emboss angle / height / amount (+ keep colours), glowing edges width / brightness / smoothness, trace contour level + upper/lower |
| Oil paint | done | Filter › Stylize; Kuwahara smoothing + strokes along the local edge direction (structure tensor) + relief light: stylisation, cleanliness, brush scale, bristle detail, light angle, shine |
| Wind, diffuse, tiles (extra stylize) | done | Filter › Stylize; wind / blast / stagger both ways, diffuse normal / darken / lighten / along edges, tiles with 4 fills |
| Offset, ripple, twirl, spherize (normal / H / V), pinch, wave (generators, wavelength, amplitude, scale, sine / triangle / square, randomise), zigzag (3 styles), polar coordinates (both ways), shear (3-point curve), displace (map from any layer, stretch / tile) | done | Filter › Distort; inverse-mapped, bilinear, alpha-aware; undefined areas wrap / repeat / transparent where it applies |
| Clouds, difference clouds, fibers | done | Filter › Render; fractal value noise between foreground and background colours, cloud size, randomise; laid out in full-size pixels so previews match |
| Lens flare | done | Filter › Render; zoom / prime / wide movie lens, brightness, centre (sliders or click on the image) — glow, rays, halo, ghosts (own design) |
| Lighting effects | done | Filter › Render; one spot / point / infinite light, colour, intensity, position (or click), height, spread, focus, ambience, gloss, metallic, bump from brightness (Phong). Several lights at once: not yet |
| Colour halftone, halftone pattern (dots / circles / lines) | done | Filter › Pixelate; CMY + K screens at four angles, antialiased dots; pattern in foreground/background colours |
| Mosaic, crystallize, pointillize, mezzotint (10 types), facet, fragment | done | Filter › Pixelate; mosaic = the editor's own Pixelate; crystallize/pointillize on a jittered-grid Voronoi |
| Lens blur (depth from mask) | done | Filter › Blur; depth from the layer mask, the selection or brightness (or none), focal distance, invert; iris circle / 3–8 blades, rotation, blade curvature; highlight bloom (brightness, threshold); noise; mip-mapped gather that keeps sharp foreground from bleeding |
| Tilt-shift, iris blur, field blur | done | Filter › Blur; tilt-shift band (position, angle, sharp band, fade, one/both sides), iris ellipse (centre, size, rotation, sharp area), field blur pins added by clicking; light bokeh; on-canvas handles: click-to-place only (no drag handles) |
| Filter gallery (artistic / sketch set, made fresh) | done | Filter › Filter gallery…: thumbnail picker + settings for 15 effects (watercolour, pencil sketch, coloured pencil, charcoal, ink outlines, poster edges, cut-out, dry brush, glossy wrap, comic, neon glow, stained glass, canvas texture, graphic pen, spatter); one effect per pass (stack by applying again; Fade works after) |
| Smart sharpen, sharpen more, sharpen edges, shake reduction | done | Filter › Sharpen; smart sharpen removes gaussian / lens / motion blur on luminance (no colour fringes), reduce noise, shadow/highlight fade; shake reduction = Richardson–Lucy deconvolution with a straight blur trace (length, angle, iterations, smoothing) |
| Average, blur, blur more, box blur, shape blur (8 shapes), spin blur | done | Filter › Blur |
| Custom 5×5 kernel, HSB / HSL | done | Filter › Other |
