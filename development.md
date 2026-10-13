# Development

How to run Box Insert Studio on your own machine and keep working on it. For what the app does
and how to use it, see [README.md](README.md).

## Running it

Needs Node.js (the deploy workflow uses 24).

```bash
npm install
npm run dev      # editor at http://localhost:5173, reloads as you edit
npm test         # solver, cut list, cutting plan and assembly tests
npm run check    # svelte-check + TypeScript
npm run build    # production build into dist/
npm run preview  # serve that build locally
```

## Tests

The tests use a reference design modelled on a published 5 mm foam insert for DOOM (2016)
(`src/core/fixtures.ts`); its top tray reproduces that insert's cut list.

Every design in `examples/` is also planned with every packing and checked by rule
(`src/core/plan.test.ts`): each piece cut once at its size, nothing overlapping or in the trimmed
edge. A design added to that folder is picked up without touching the tests.

## Code layout

- `src/core/` (framework-free, deterministic)
  - `types.ts`: `Project` is the design, saved in `.insert.json` files; `CutSetup` is the
    builder's sheets and packing, kept per browser and never saved with a design.
  - `defaults.ts`: presets, new projects, and bringing older saved files up to date.
  - `layout.ts`: layers → trays, compartments and pieces with cut sizes and notches.
  - `pieces.ts`: grouping, near-miss hints, strip-based cutting plan onto sheets.
  - `pack.ts`: MaxRects packing with rotation.
  - `assembly.ts`: glue order and divider positions per tray.
  - `problems.ts`: every problem in a design in one list, for the error count and the report.
  - `edit.ts`: layout tree edits (split, remove, drag with snapping, lock, trays vs dividers).
  - `history.ts`: undo/redo over project snapshots, merging drags and typing into single steps.
  - `scene.ts`: 3D placement of every piece, renderer-independent; tests use it to check that no
    two pieces overlap.
  - `boxPresets.ts`: game box sizes offered by the New dialog; where each came from is in
    `docs/box-dimension-sources.md`.
- `src/lib/`: Svelte 5 UI.
  - `state.svelte.ts`: the open project and the cut setup, and their autosave in the browser.
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
