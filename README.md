# Box Insert Studio

Design inserts for board game boxes from sheet material (foam board, MDF, greyboard, …): lay out
compartments, and get the cut list, a cutting plan for your sheets, and glue-by-glue assembly steps.
Everything runs in the browser.

**Use it online: https://5argon.github.io/box-insert-studio/**

```bash
npm install
npm run dev      # editor at http://localhost:5173
npm test         # solver, cut list, cutting plan and assembly tests
npm run check    # svelte-check + TypeScript
```

The example project is modelled on a published 5 mm foam insert for DOOM (2016); its top tray
reproduces that insert's cut list.

## Workflow

1. **Layout**: set the box's inside size, clearance and layers (stacked trays, bottom first,
   with the space left above for the board and rulebook). Divide each layer with dividers:
   drag them, type sizes to lock them, or distribute equally. Compartments are lettered in reading
   order. Per compartment: inside size, finger notches per side, a raised floor (layers of the
   material stacked on the floor, marked with * on the letter), and optionally a removable box
   standing inside it (one box with dividers, or separate boxes; compartments inside are labelled
   G1, G2, …). Per divider split: glued dividers or separate lift-out trays, and how much lower
   the dividers stand. A small 3D preview in the corner shows the whole insert; click it for
   the 3D view.
2. **3D view**: the whole insert in 3D, view only. Drag to orbit around the box's centre (from
   straight down to level with the box, never underneath), scroll or pinch to zoom, or pick a
   preset (3/4, top, front, side), in perspective or orthographic. Show or hide the game box
   outline; draw trays as wireframe, see-through or solid; highlight trays to draw them solid
   while the rest stay wireframe in their colours; hide trays or whole layers. **Hide tools**
   shows the model on its own.
3. **Cut list & assembly**: grouped cut list, a cutting plan per sheet (bases, then strips of
   one height chopped into lengths), per-tray assembly steps with a numbered diagram, and a
   true-size notch template. Print or save as PDF; export the cut list as CSV.

Each project can have a **readme** in Markdown (Project → Add readme), printed as a Notes section
at the top of the export. Raw HTML in it is shown as text and unsafe links are dropped, so a
shared project file cannot run scripts.

Projects autosave in the browser; **Save** / **Open** use `.insert.json` files. **New** starts an
empty box with the same size and board settings; **Example** loads the DOOM insert.
**Undo** / **Redo** (⌘Z / ⇧⌘Z, or Ctrl+Z / Ctrl+Y) cover every change: each click is a step, and a
drag or a burst of typing counts as one. The theme follows the system's light or dark setting, or
pick one in the header; the printable report is always a white page.

## Encouraging shared cut sizes

- The bar under the canvas lists every cut size live: count, size, notches. Hovering one
  highlights those pieces.
- Pieces with the same cut are one size wherever they are, walls and dividers alike, and mirrored
  notch positions count as the same piece (flip it).
- Sizes are rounded to a step (0.5 mm default) so near-identical pieces merge; pieces a millimetre
  or two apart get a hint.
- Dragging a divider snaps to sizes other compartments already use, and each compartment offers
  "Reuse" chips for sizes in use. Locking a size hands the leftover to the largest sibling.

## Construction model

With board thickness T and tray height H (including the base):

- Walls on base: base = tray outside; walls are H − T tall. Base inside walls: base = tray outside
  − 2T; walls are H tall.
- One pair of outer walls runs the full length; the other pair is 2T shorter and fits between.
- Dividers stand on the base (H − T, minus any lowering) and butt against walls or the dividers
  placed before them, so each divider's length is the space between those.
- Separate trays each get their own base and walls, with the clearance between them.
- A removable box stands on its tray's base inside a compartment, with the clearance around it.
  It is H − T tall, so its top sits flush with the walls around it; its walls and dividers are
  shortened to match. Boxes go one level deep. Stacking splits that height exactly in half: two
  identical boxes, each (H − T) / 2 tall with its own floor, so each holds (H − T) / 2 − T.
- A raised floor of n layers stacks n pieces cut to the compartment's inside size (less the
  clearance), taking n·T from its height. Under a removable box it lifts the box, which gets
  n·T shorter so its top stays flush. A floor that no longer fits (say after switching to a
  thicker material) is reported as an error with how many layers to remove.

## Code layout

- `src/core/` (framework-free, deterministic)
  - `layout.ts`: layers → trays, compartments and pieces with cut sizes and notches.
  - `pieces.ts`: grouping, near-miss hints, strip-based cutting plan onto sheets.
  - `pack.ts`: MaxRects packing with rotation.
  - `assembly.ts`: glue order and divider positions per tray.
  - `edit.ts`: layout tree edits (split, remove, drag with snapping, lock, trays vs dividers).
  - `history.ts`: undo/redo over project snapshots, merging drags and typing into single steps.
  - `scene.ts`: 3D placement of every piece, renderer-independent; tests use it to check that no
    two pieces overlap.
- `src/lib/`: Svelte 5 UI.
  - `three/`: the 3D view and the layout's corner preview (three.js), loaded after the editor
    appears so it never slows the first load.

## Deploying

Every push to `main` runs the tests, builds, and publishes `dist/` to GitHub Pages
(`.github/workflows/deploy.yml`). In the repository settings, Pages must use "GitHub Actions"
as its source.

## License

Copyright (c) 2026 Sirawat Pitaksarit. Licensed under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/):
you may use, adapt and share it, including commercially, as long as you give credit. See `LICENSE`.

## Not done yet

- Per-compartment notch sizes; slide-in or angled card dividers, curved token scoops, lids.
- Mixed tray heights within one layer.
- 3D view extras: exploding layers apart, names on hover, coloured compartment floors, PNG export.
- Cutting plan packs strips greedily; it does not yet try mixing strip heights to save a sheet.
