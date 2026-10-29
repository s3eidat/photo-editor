# Lane: vector

Files: `js/vector/*.js`, `js/vector/vector.css`. Hook lines in shared files are marked `// lane:vector`
(the key-handler and `ED.ui.MENUS/TOOLS/w` lines are byte-identical to the selection lane's, so merges stay clean).
Self-test: `js/vector/vtest.js` extends `window.S3_SELFTEST` (path booleans, curve maths, shape rendering, round trips).

| Feature | Status | Notes |
|---|---|---|
| Shape tools as live vector layers | done | Rectangle (corner radius), ellipse, triangle, polygon (3–100 sides), star (points + indent %), line with start/end arrowheads (width, length, concavity), arrow, 24 custom shapes drawn for this app. Fill colour / none / fill opacity; stroke colour, width, dash presets + custom dash pattern, inside / centre / outside alignment, caps, corners. All editable later in Properties; "Edit as path" turns a shape into a free path. Saved in .s3photo (fields whitelisted and clamped on open). |
