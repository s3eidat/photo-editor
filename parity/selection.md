# Lane: selection

| Feature | Status | Notes |
|---|---|---|
| Modify: border, smooth | done | Select › Border… / Smooth…. Border is a band straddling the edge from an exact distance transform (anti-aliased); smooth is a majority filter (removes specks, rounds corners). Worker: `js/select/worker.js`. |
| All 27 blend modes | done | Normal, dissolve, darken group (darken, multiply, colour burn, linear burn, darker colour), lighten group (lighten, screen, colour dodge, linear dodge (add), lighter colour), contrast group (overlay, soft/hard/vivid/linear/pin light, hard mix), difference, exclusion, subtract, divide, hue, saturation, colour, luminosity. 16 run natively on the canvas; 11 in JS (`PIX.blendRegion`, byte lookup tables). Grouped menu, Shift+Alt+letter shortcuts, Shift +/− steps through modes (when a non-painting tool is active). Self-test checks every mode in the compositor against the per-pixel maths. |
| Fill opacity | done | "Fill" slider under Opacity; equals opacity until layer styles exist (styles stay at full strength). Saved in projects, undoable. The "special 8" fill behaviour of some modes is not replicated. |
| Grow, similar | done | Select › Grow / Similar use the Magic wand tolerance and "All layers" setting; colours are matched against every colour already selected (binned 64 levels/channel, max-channel distance like the wand). |

## Hooks this lane added to shared files
All marked `// lane:selection` (or `<!-- lane:selection -->`).
- `index.html`: script tags for `js/select/*` and `js/layers/*`, after `ui.js`, before `app.js`.
- `js/ui.js`: `ED.ui.MENUS`, `ED.ui.TOOLS`, `ED.ui.w` (option/dialog widgets) exposed so lanes can add menu items, tools and dialogs.
- `js/core.js`: `PE.drawHook` (lane compositor, returns false to keep the original loop), `PE.snapExt` / `PE.restoreExt` (extra layer fields in undo snapshots), `PE.kindsExt`, `PE.parseExt`, `PE.saveExt`, `PE.openExt` (extra layer kinds/fields in .s3photo files; layers also keep their id as `uid`).
- `js/ui.js`: `ED.ui.keys` — array of key handlers `f(e) -> true if handled`, run before the built-in shortcuts.
- Self-test: `PE.sx.tests` (array of `async (ok, near) => {}`) runs after the app's own `S3_SELFTEST`; no change to `app.js`.
