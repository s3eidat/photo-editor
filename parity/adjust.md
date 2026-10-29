# Lane: adjust

Code: `js/adjust/*.js` (maths in `amath.js`, `tone.js`, …; UI in `ui.js`; checks in `tests.js`).
Hooks in shared files are marked `// lane:adjust`: `PIX.adjust` dispatches to `PIX.EXT`, the worker imports the
maths files, `openAdjust` calls `spec.ui`, `ED.adjKit` exposes the UI widgets, `S3_SELFTEST` runs `PE.adjustTests`.

| Feature | Status | Notes |
|---|---|---|
| Auto tone / auto contrast / auto colour | done | Image menu, Ctrl+Shift+L / Ctrl+Alt+Shift+L / Ctrl+Shift+B; 0.1% clip; auto colour neutralises midtones per channel |
