# Lane: adjust

Code: `js/adjust/*.js` (maths in `amath.js`, `tone.js`, …; UI in `ui.js`; checks in `tests.js`).
Hooks in shared files are marked `// lane:adjust`: `PIX.adjust` dispatches to `PIX.EXT`, the worker imports the
maths files, `openAdjust` calls `spec.ui`, `ED.adjKit` exposes the UI widgets, `S3_SELFTEST` runs `PE.adjustTests`.

| Feature | Status | Notes |
|---|---|---|
| Auto tone / auto contrast / auto colour | done | Image menu, Ctrl+Shift+L / Ctrl+Alt+Shift+L / Ctrl+Shift+B; 0.1% clip; auto colour neutralises midtones per channel |
| Shadows / highlights | done | Image menu; amount / tonal width / radius for each, colour, midtone contrast; edge-aware (guided filter) neighbourhood so no halos |
| Fade last filter / adjustment | done | Edit › Fade… (Ctrl+Shift+F) right after any adjustment or filter: opacity + 16 blend modes, live preview, limited to the selection used then; one more history step |
