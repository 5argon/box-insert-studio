import { describe, expect, it } from 'vitest';
import { doomExample } from './fixtures';
import { padLimit, solveProject, type Solved } from './layout';
import {
  MIXED,
  maxDividerLower,
  setArrows,
  setDividersLower,
  setDividersSecondary,
  setItemFields,
  setLowSides,
  setNotchSides,
  setPads,
  setSimulation,
  setSizes,
  setStackedAll,
  shared,
} from './multi';
import { hasLow, hasNotch } from './notches';
import { setSecondaryThickness } from './edit';

const pick = (s: Solved, labels: string[]) => labels.map((l) => s.compartments.find((c) => c.label === l)!);

describe('shared values', () => {
  it('are the one value all share, MIXED when they differ, undefined with nothing selected', () => {
    expect(shared([3, 3, 3])).toBe(3);
    expect(shared([3, 4])).toBe(MIXED);
    expect(shared([])).toBeUndefined();
  });
});

describe('editing several compartments', () => {
  it('sets one item direction and simulation for all, keeping each one’s own item settings', () => {
    const p = doomExample();
    const [a, b, c] = pick(solveProject(p), ['A', 'B', 'C']);
    b!.node.arrow = 'left';
    b!.node.items = { on: false, shape: 'box', width: 70, height: 90, thickness: 0.6, spare: 5 };
    setArrows([a!, b!, c!], 'front');
    expect([a, b, c].map((x) => x!.node.arrow)).toEqual(['front', 'front', 'front']);
    setSimulation([a!, b!, c!], true);
    expect([a, b, c].every((x) => x!.node.items?.on)).toBe(true);
    expect(shared([a, b, c].map((x) => x!.node.items!.width))).toBe(MIXED);
    setItemFields([a!, b!, c!], { width: 63, thickness: 0.65 });
    expect(shared([a, b, c].map((x) => x!.node.items!.width))).toBe(63);
    expect(b!.node.items!.spare).toBe(5);
    setArrows([a!, b!, c!], undefined);
    expect([a, b, c].every((x) => x!.node.arrow === undefined)).toBe(true);
  });

  it('notches or clears one side of all, leaving a lowered side alone', () => {
    const p = doomExample();
    let s = solveProject(p);
    const sel = () => pick(s, ['A', 'B', 'C']);
    expect(shared(sel().map((c) => hasNotch(s, c, 'front')))).toBe(MIXED);
    setLowSides(s, [sel()[2]!], 'front', true);
    s = solveProject(p);
    setNotchSides(s, sel(), 'front', true);
    s = solveProject(p);
    expect(sel().map((c) => hasNotch(s, c, 'front'))).toEqual([true, true, false]);
    expect(hasLow(s, sel()[2]!, 'front')).toBe(true);
    setNotchSides(s, sel(), 'front', false);
    s = solveProject(p);
    expect(sel().map((c) => hasNotch(s, c, 'front'))).toEqual([false, false, false]);
  });

  it('raises floors by the same count, capped where a compartment takes fewer', () => {
    const p = doomExample();
    const s = solveProject(p);
    const sel = pick(s, ['A', 'G']);
    setPads(p, sel, 100);
    const after = solveProject(p);
    for (const c of pick(after, ['A', 'G'])) {
      expect(c.pad).toBeGreaterThan(0);
      expect(c.pad).toBeLessThanOrEqual(padLimit(p, c));
    }
    expect(after.compartments.flatMap((c) => c.issues).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('gives several compartments the same inside width', () => {
    const p = doomExample();
    const layer = p.layers[0]!;
    setSizes(p, layer, pick(solveProject(p), ['A', 'B', 'F']), 'row', 50);
    for (const c of pick(solveProject(p), ['A', 'B', 'F'])) expect(c.rect.w).toBeCloseTo(50, 6);
  });

  it('stacks the boxes of every selected well', () => {
    const p = doomExample();
    setStackedAll(pick(solveProject(p), ['G', 'A']), true);
    const s = solveProject(p);
    expect(s.trays.filter((t) => t.wellId === pick(s, ['G'])[0]!.id)).toHaveLength(2);
  });
});

describe('editing several dividers', () => {
  it('sets their material and lowers each split within its own limit', () => {
    const p = doomExample();
    setSecondaryThickness(p, 3);
    const layer = p.layers[1]!;
    const s = solveProject(p);
    const sl = s.layers[1]!;
    const bars = sl.bars.filter((b) => b.join === 'divider').slice(0, 3);
    const picks = bars.map((b) => ({ splitId: b.splitId, index: b.index }));
    setDividersSecondary(layer, picks, true);
    const after = solveProject(p).pieces.filter((x) => x.kind === 'divider' && picks.some((k) => k.splitId === x.splitId && k.index === x.barIndex));
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((x) => x.material === 'secondary' && x.thickness === 3)).toBe(true);
    setDividersLower(p, layer, sl, picks, 1000);
    for (const id of new Set(picks.map((k) => k.splitId))) {
      const split = sl.splits.find((x) => x.id === id)!.node;
      expect(split.lower).toBe(maxDividerLower(p, layer, sl, id));
    }
  });
});
