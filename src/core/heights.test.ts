import { describe, expect, it } from 'vitest';
import { setEmptyAbove, setInsertLid, setInsertSharedLid, setJoin, setPad, setSecondaryThickness, setInsertLidSecondary, setStacked } from './edit';
import { doomExample } from './fixtures';
import { insertHeights, solveProject } from './layout';
import type { Project, SplitNode } from './types';

/** Every combination the inspector can describe must match the boxes the solver builds. */
describe('removable box heights', () => {
  const cases: [string, (p: Project, g: ReturnType<typeof solveProject>['compartments'][number]) => void][] = [
    ['single', () => {}],
    ['stacked', (_, g) => setStacked(g.node, true)],
    ['empty above', (_, g) => (setStacked(g.node, true), setEmptyAbove(g.node, true))],
    ['lid', (_, g) => setInsertLid(g.node, true)],
    ['stacked with a lid', (_, g) => (setStacked(g.node, true), setInsertLid(g.node, true))],
    ['secondary lid, raised floor', (p, g) => (setSecondaryThickness(p, 3), setInsertLid(g.node, true), setInsertLidSecondary(g.node, true), setPad(g.node, 1))],
    ['shared lid over separate boxes', (p, g) => {
      setInsertLid(g.node, true);
      setInsertSharedLid(g.node, true);
      const layer = p.layers[0];
      setJoin(layer, g.node.insert!.root as SplitNode, 'trays', p.material.thickness);
    }],
  ];

  for (const [name, edit] of cases) {
    it(name, () => {
      const p = doomExample();
      edit(p, solveProject(p).compartments.find((c) => c.label === 'G')!);
      const s = solveProject(p);
      const g = s.compartments.find((c) => c.label === 'G')!;
      const h = insertHeights(p, g.node, g.fullHeight, g.padHeight);
      const lower = s.trays.filter((t) => t.wellId === g.id && !t.copyOf);
      expect(lower.length).toBeGreaterThan(0);
      for (const t of lower) {
        expect(t.height - t.lid).toBeCloseTo(h.body, 6);
        expect(t.wallHeight).toBeCloseTo(h.wall, 6);
        expect(t.base).toBe(h.base);
      }
      for (const c of s.compartments.filter((x) => x.wellId === g.id)) expect(c.fullHeight).toBeCloseTo(h.inside, 6);
    });
  }
});

describe('box heights on the rounding step', () => {
  it('never lets a stacked pair stand proud when half the depth lands between steps', async () => {
    const { buildCutList } = await import('./pieces');
    const p = doomExample();
    p.layers[0]!.height = 56.5; // 51.5 mm above the floor: half is 25.75
    const g = solveProject(p).compartments.find((c) => c.label === 'G')!;
    setStacked(g.node, true);
    const s = solveProject(p);
    const cut = buildCutList(s, p.precision);
    const well = s.compartments.find((c) => c.label === 'G')!;
    const box = s.trays.find((t) => t.wellId === well.id && !t.copyOf)!;
    expect(box.height).toBe(25.5);
    // As cut: two boxes of rounded walls on their floors fit within the well.
    const wall = s.pieces.find((x) => x.trayId === box.id && x.kind === 'wall')!;
    const cutWall = cut.groupOf.get(wall.id)!.height;
    expect(2 * (cutWall + box.base)).toBeLessThanOrEqual(well.fullHeight + 1e-9);
  });

  it('keeps a notch above the floor on walls wrapped around a thicker base', async () => {
    const { setLayerBaseSecondary, setSecondaryThickness } = await import('./edit');
    const p = doomExample();
    p.base = 'inside';
    p.material.thickness = 3;
    setSecondaryThickness(p, 5);
    setLayerBaseSecondary(p, true);
    p.notch = { width: 30, depth: 100 };
    const s = solveProject(p);
    const tray = s.trays.find((t) => t.depth === 0)!;
    const walls = s.pieces.filter((x) => x.trayId === tray.id && x.kind === 'wall' && x.notches.length);
    expect(walls.length).toBeGreaterThan(0);
    for (const w of walls) for (const n of w.notches) expect(w.height - n.depth).toBeGreaterThanOrEqual(tray.base + w.thickness - 1e-9);
  });
});
