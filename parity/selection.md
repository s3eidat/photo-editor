# Lane: selection

| Feature | Status | Notes |
|---|---|---|
| Modify: border, smooth | done | Select › Border… / Smooth…. Border is a band straddling the edge from an exact distance transform (anti-aliased); smooth is a majority filter (removes specks, rounds corners). Worker: `js/select/worker.js`. |
| Grow, similar | done | Select › Grow / Similar use the Magic wand tolerance and "All layers" setting; colours are matched against every colour already selected (binned 64 levels/channel, max-channel distance like the wand). |

## Hooks this lane added to shared files
All marked `// lane:selection` (or `<!-- lane:selection -->`).
- `index.html`: script tags for `js/select/*` and `js/layers/*`, after `ui.js`, before `app.js`.
- `js/ui.js`: `ED.ui.MENUS`, `ED.ui.TOOLS`, `ED.ui.w` (option/dialog widgets) exposed so lanes can add menu items, tools and dialogs.
- Self-test: `PE.sx.tests` (array of `async (ok, near) => {}`) runs after the app's own `S3_SELFTEST`; no change to `app.js`.
