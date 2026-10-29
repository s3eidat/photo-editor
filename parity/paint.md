# Lane: paint

Code: `js/paint/*.js` (+ `js/paint/paint.css`). Hooks in shared files are marked `lane:paint`
(`index.html` script/style tags, `js/ui.js` tool/menu/options/kit exposure, `js/editor.js` overlay + cursor hooks).
Known-answer checks: `js/paint/tests.js` (run by `S3_SELFTEST` after the core checks).

| Feature | Status | Notes |
|---|---|---|
| Brush engine: spacing, flow, smoothing (pulled string + catch-up) | done | `engine.js`; brush, eraser, clone and healing run on it |
| Shape dynamics: size / angle / roundness jitter and controls | done | controls: pen pressure, tilt, fade, direction, initial direction, pen rotation |
| Scattering (count, count jitter, both axes) | done | |
| Colour dynamics (fg/bg mix, hue / saturation / brightness jitter, purity, per tip) | done | |
| Transfer (opacity / flow jitter + controls) | done | per-dab alpha under the stroke opacity cap |
| Pen pressure and tilt (Pointer Events, coalesced events) | done | pressure → size on by default for pens; mouse and touch paint at full size |
| Build-up (airbrush) | done | |
| Texture, dual tip | done | texture needs a pattern (patterns panel); per-tip texture |
| Symmetry painting | done | vertical, horizontal, dual axis, diagonal, radial, mandala; adjustable centre |
| Masks take the foreground's grey | done | grey paints a partial mask (was black/white only) |
| Brush settings dialog (F5) | done | live preview stroke drawn by the engine |
| Full colour picker | done | field + slider on any of H, S, B, R, G, B, L, a, b; HSB / RGB / Lab / CMYK / hex fields, only web colours, new vs current; opens from the tool bar's colour chips |
| Swatches panel | done | Paint panel › Swatches: recent colours, click / Ctrl+click / Alt+click, add, import .aco (RGB, HSB, CMYK, Lab, grey) and .gpl, export .gpl / .aco |
| Fill with surroundings | done | Edit › Fill with surroundings… (Shift+Alt+Backspace): multi-scale PatchMatch + voting in a worker (`pworker.js`), expand, quality, edge colour blending, output to a new layer; big holes are solved at a lower resolution |
| Spot healing brush | done | J (grouped with the healing brush): content-aware (fill engine + tone blend) or proximity match (best nearby patch judged on the stroke's ring, then healed) |
| Dodge / burn / sponge | done | O group; shadows / midtones / highlights, protect tones, exposure; sponge saturate / desaturate with vibrance; Alt swaps dodge ⇄ burn; one stroke does not compound (coverage model); dodge / burn also work on masks |
