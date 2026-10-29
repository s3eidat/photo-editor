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
