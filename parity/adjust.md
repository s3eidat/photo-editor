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
