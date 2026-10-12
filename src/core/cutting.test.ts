import { describe, expect, it } from 'vitest';
import { shapeCutPatterns } from './cutting';
import { setInsert, setInsertLid, setLidNotchSide, setSecondaryThickness, setInsertLidSecondary, setStacked, splitSection } from './edit';
import { blankProject, doomExample } from './fixtures';
import { solveProject } from './layout';
import { lidNotchPoints } from './lidNotches';
import { buildCutList, type PieceShape } from './pieces';
import type { SectionNode } from './types';

const group = (overrides: Partial<PieceShape> = {}): PieceShape => ({
  length: 100, height: 40, notches: [], lows: [], pieces: [], key: 'example', ...overrides,
});

describe('notch cutting instructions', () => {
  it('marks two edge points and two interior points at exact fractional distances, then connects them without angles', () => {
    const [pattern] = shapeCutPatterns(group({ notches: [{ center: 50, width: 30, depth: 15, bottom: 7.5 }] }));
    expect(pattern!.points.map((p) => [p.label, p.x, p.y])).toEqual([
      ['A', 35, 0], ['B', 46.25, 15], ['C', 53.75, 15], ['D', 65, 0],
    ]);
    expect(pattern!.steps).toEqual([
      'On the top edge, mark A 35 mm from the left edge and D 35 mm from the right edge.',
      'Inside the piece, mark B 46.25 mm from the left edge and 15 mm from the top edge; mark C 46.25 mm from the right edge and 15 mm from the top edge.',
      'Draw straight lines A → B, B → C and C → D. Cut along these lines through the sheet and remove the waste between them and the top edge.',
    ]);
    expect(pattern!.steps.join(' ')).not.toMatch(/angle|degree|°/i);
  });

  it('measures each mark from the end of its edge it is nearer to, on its own', () => {
    const [near, middle, far] = shapeCutPatterns(group({ notches: [20, 50, 80].map((center) => ({ center, width: 30, depth: 15, bottom: 7.5 })) }));
    expect(near!.points.map((p) => p.from)).toEqual(['left', 'left', 'left', 'left']);
    expect(near!.steps[0]).toBe('On the top edge, mark A 5 mm and D 35 mm from the left edge.');
    // A cut across the middle is the same distance in from both ends.
    expect(middle!.points.map((p) => [p.from, p.along])).toEqual([['left', 35], ['left', 46.25], ['right', 46.25], ['right', 35]]);
    // The marks keep their letters and places; only the end they are measured from changes.
    expect(far!.points.map((p) => [p.label, p.x, p.y])).toEqual([['A', 65, 0], ['B', 76.25, 15], ['C', 83.75, 15], ['D', 95, 0]]);
    expect(far!.points.map((p) => [p.from, p.along])).toEqual([['right', 35], ['right', 23.75], ['right', 16.25], ['right', 5]]);
    expect(far!.steps.slice(0, 2)).toEqual([
      'On the top edge, mark A 35 mm and D 5 mm from the right edge.',
      'Inside the piece, mark B 23.75 mm from the right edge and 15 mm from the top edge; mark C 16.25 mm from the right edge and 15 mm from the top edge.',
    ]);
    const sides = shapeCutPatterns(group({ height: 80, lidNotches: [{ side: 'left', center: 45, width: 20, depth: 8, bottom: 10 }] }));
    expect(sides[0]!.points.map((p) => [p.from, p.along])).toEqual([['top', 35], ['top', 40], ['bottom', 30], ['bottom', 25]]);
    // A V's shared tip is one mark, measured once.
    const tip = shapeCutPatterns(group({ notches: [{ center: 60, width: 30, depth: 15, bottom: 0 }] }))[0]!;
    expect(tip.steps[1]).toBe('Inside the piece, B and C share one mark: 40 mm from the right edge and 15 mm from the top edge.');
  });

  it('measures lid cuts from the correct two edges in every orientation', () => {
    const lidNotches = (['back', 'front', 'left', 'right'] as const).map((side) => ({ side, center: 30, width: 20, depth: 8, bottom: 10 }));
    const patterns = shapeCutPatterns(group({ height: 80, lidNotches }));
    expect(patterns.map((p) => p.edge)).toEqual(['top', 'bottom', 'left', 'right']);
    expect(patterns.map((p) => [...new Set(p.points.map((point) => point.from))])).toEqual([['left'], ['left'], ['top'], ['top']]);
    for (const [i, pattern] of patterns.entries()) {
      expect(pattern.points.map((p) => [p.x, p.y])).toEqual(lidNotchPoints(100, 80, lidNotches[i]!));
      for (const point of pattern.points) {
        expect(point.from === 'left' ? point.x : point.y).toBe(point.along);
        const inward = pattern.edge === 'top' ? point.y : pattern.edge === 'bottom' ? 80 - point.y : pattern.edge === 'left' ? point.x : 100 - point.x;
        expect(inward).toBe(point.inward);
      }
      expect(pattern.steps[1]).toContain(`8 mm from the ${pattern.edge} edge`);
    }
  });

  it('handles V tips, square-sided slots and rectangular lowered stretches', () => {
    const v = shapeCutPatterns(group({ notches: [{ center: 50, width: 30, depth: 15, bottom: 0 }] }))[0]!;
    expect(v.points[1]).toMatchObject({ x: 50, y: 15 });
    expect(v.points[2]).toMatchObject({ x: 50, y: 15 });
    expect(v.steps[1]).toContain('B and C share one mark');
    expect(v.steps[2]).not.toContain('B → C');
    const slot = shapeCutPatterns(group({ notches: [{ center: 50, width: 30, depth: 15, bottom: 30 }] }))[0]!;
    expect(slot.points.map((p) => [p.x, p.y])).toEqual([[35, 0], [35, 15], [65, 15], [65, 0]]);
    const low = shapeCutPatterns(group({ lows: [{ from: 0, to: 60, depth: 10 }] }), 'lowered')[0]!;
    expect(low.name).toBe('Lowered stretch 1');
    expect(low.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [0, 10], [60, 10], [60, 0]]);
    expect(shapeCutPatterns(group())).toEqual([]);
  });

  it('uses the canonical grouped cuts for mirrored walls and rotated stacked lids, retaining every copy and local shape', () => {
    const project = doomExample();
    let solved = solveProject(project);
    let cut = buildCutList(solved, project.precision);
    for (const g of cut.groups.flatMap((g) => g.shapes).filter((g) => g.notches.length)) {
      const patterns = shapeCutPatterns(g);
      expect(patterns).toHaveLength(g.notches.length);
      for (const p of g.pieces) {
        for (const [i, n] of g.notches.entries()) {
          const actual = p.notches.find((original) => Math.abs((cut.flipped.has(p.id) ? p.length - original.center : original.center) - n.center) < 1e-6)!;
          expect(actual).toBeDefined();
          expect(patterns[i]!.points[1]!.inward).toBe(actual.depth);
          expect(patterns[i]!.points[2]!.x - patterns[i]!.points[1]!.x).toBeCloseTo(actual.bottom);
        }
      }
    }
    const lidProject = blankProject();
    const layer = lidProject.layers[0]!;
    const host = layer.root as SectionNode;
    setInsert(layer, host.id, true);
    setInsertLid(host, true);
    setSecondaryThickness(lidProject, 3);
    setInsertLidSecondary(host, true);
    setStacked(host, true);
    splitSection(layer, host.insert!.root.id, 'row', 5, 'trays');
    setLidNotchSide(host, 'front', true);
    setLidNotchSide(host, 'left', true);
    host.insert!.lidNotchSize = { width: 22, depth: 8, bottom: 25 };
    solved = solveProject(lidProject);
    cut = buildCutList(solved, lidProject.precision);
    const lids = cut.groups.flatMap((g) => g.shapes).filter((g) => g.lidNotches?.length);
    expect(lids).toHaveLength(1);
    expect(lids[0]!.pieces).toHaveLength(2);
    expect(cut.groupOf.get(lids[0]!.pieces[0]!.id)!.material).toBe('secondary');
    const patterns = shapeCutPatterns(lids[0]!);
    expect(patterns).toHaveLength(2);
    for (const [i, p] of patterns.entries()) {
      expect(p.bottom).toBe(5.5);
      expect(p.points[1]!.inward).toBe(8);
      expect(p.points.map((point) => [point.x, point.y])).toEqual(lidNotchPoints(lids[0]!.length, lids[0]!.height, lids[0]!.lidNotches![i]!));
    }
  });
});
