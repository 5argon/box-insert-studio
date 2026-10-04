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
