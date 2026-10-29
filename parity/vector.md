# Lane: vector

Files: `js/vector/*.js`, `js/vector/vector.css`. Hook lines in shared files are marked `// lane:vector`
(the key-handler and `ED.ui.MENUS/TOOLS/w` lines are byte-identical to the selection lane's, so merges stay clean).
Self-test: `js/vector/vtest.js` extends `window.S3_SELFTEST` (path booleans, curve maths, shape rendering, round trips).

| Feature | Status | Notes |
|---|---|---|
| Shape tools as live vector layers | done | Rectangle (corner radius), ellipse, triangle, polygon (3–100 sides), star (points + indent %), line with start/end arrowheads (width, length, concavity), arrow, 24 custom shapes drawn for this app. Fill colour / none / fill opacity; stroke colour, width, dash presets + custom dash pattern, inside / centre / outside alignment, caps, corners. All editable later in Properties; "Edit as path" turns a shape into a free path. Saved in .s3photo (fields whitelisted and clamped on open). |
| Pen tool (bezier) | done | Click = corner, drag = smooth handles (Alt breaks, Shift = 45°), click first anchor to close, Enter/Esc ends, Alt-click last anchor = cusp, click an open end to continue it, auto add/delete on the path, rubber band. "Shape" mode draws into a new or the current shape layer with New / Combine / Subtract / Intersect / Exclude; "Path" mode draws the work path. Every anchor is one undo step. |
| Curvature pen | done | Curve flows through each click (auto-smooth anchors); double-click / Alt-click toggles corner; drag a point to move it; click a segment to add one. |
| Freeform pen | done | Freehand drag, least-squares cubic fitting with a curve-fit tolerance (screen px); closes when it ends near its start. |
| Add / delete / convert anchor | done | Separate tools in the pen group (P, Shift+P cycles) and pen modifiers. Convert: click toggles smooth/corner, drag pulls handles, drag a handle breaks it. |
| Path selection / direct selection | done | (A, Shift+A.) Components: select (Shift adds), move, Alt-drag copy, delete, set combine mode, Merge (real boolean geometry). Anchors: click / marquee / Shift, drag anchors, handles (smooth stays smooth, Alt breaks), drag a curve to reshape it, Delete, arrow nudge. Clicking another shape layer's outline selects it. |
| Paths panel | done | Work path (italic), saved paths, the selected shape layer's outline. New, save work path / rename (double-click), duplicate, delete, select (the pen and selection tools then edit it). Fill path (colour, opacity), stroke path (brush / pencil / eraser tip, optional taper), load as selection (feather, anti-alias, new/add/subtract/intersect; Ctrl+Enter), make work path from selection (tolerance; traced and curve-fitted in a worker), path to shape layer. Alt-click the panel buttons for the option dialogs; also in Select and Edit menus. Saved with the project. |
