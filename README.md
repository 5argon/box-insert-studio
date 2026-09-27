# Box Insert Studio

Design foam board inserts for board game boxes: lay out compartments, and get the cut list,
a cutting plan for your sheets, and glue-by-glue assembly steps. Everything runs in the browser.

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
   order. Per compartment: inside size, finger notches per side, and optionally a removable box
   standing inside it (one box with dividers, or separate boxes; compartments inside are labelled
   G1, G2, …). Per divider split: glued dividers or separate lift-out trays, and how much lower
   the dividers stand.
2. **Cut list & assembly**: grouped cut list, a cutting plan per sheet (bases, then strips of
   one height chopped into lengths), per-tray assembly steps with a numbered diagram, and a
   true-size notch template. Print or save as PDF; export the cut list as CSV.

Projects autosave in the browser; **Save** / **Open** use `.insert.json` files.

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
  shortened to match. Boxes go one level deep.

## Code layout

- `src/core/` (framework-free, deterministic)
  - `layout.ts`: layers → trays, compartments and pieces with cut sizes and notches.
  - `pieces.ts`: grouping, near-miss hints, strip-based cutting plan onto sheets.
  - `pack.ts`: MaxRects packing with rotation.
  - `assembly.ts`: glue order and divider positions per tray.
  - `edit.ts`: layout tree edits (split, remove, drag with snapping, lock, trays vs dividers).
- `src/lib/`: Svelte 5 UI.

## Deploying

Every push to `main` runs the tests, builds, and publishes `dist/` to GitHub Pages
(`.github/workflows/deploy.yml`). In the repository settings, Pages must use "GitHub Actions"
as its source.

## License

Copyright (c) 2026 Sirawat Pitaksarit. Licensed under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/):
you may use, adapt and share it, including commercially, as long as you give credit. See `LICENSE`.

## Not done yet

- Undo.
- Per-compartment notch sizes; slide-in or angled card dividers, curved token scoops, lids.
- Mixed tray heights within one layer.
- Cutting plan packs strips greedily; it does not yet try mixing strip heights to save a sheet.
