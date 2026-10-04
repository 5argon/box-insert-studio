import { describe, expect, it } from 'vitest';
import { setLowOverrideSide, splitSection } from './edit';
import { blankProject } from './fixtures';
import { roundTo } from './geom';
import { lowPercent, solveProject } from './layout';
import { newLayer } from './defaults';

/** One layer split into a left and a right compartment; the left one lowered at the back and right. */
function design() {
  const p = blankProject();
  p.layers = [newLayer('Only', 54)];
  const layer = p.layers[0]!;
  splitSection(layer, layer.root.id, 'row', p.material.thickness);
  const left = solveProject(p).compartments.sort((a, b) => a.rect.x - b.rect.x)[0]!;
  left.node.lowered = ['back', 'right'];
  return { p, left };
}

/** Height a lowered stretch leaves, from the piece on that side of the left compartment. */
function standing(p: ReturnType<typeof design>['p'], side: 'back' | 'right') {
  const s = solveProject(p);
  const c = s.compartments.sort((a, b) => a.rect.x - b.rect.x)[0]!;
  const piece = s.pieces.find((x) => x.id === c.bounds[side])!;
  const from = piece.lowFrom.find((l) => l.side === side)!;
  const low = piece.lows[0];
  return { top: low ? piece.height - low.depth : piece.height, custom: !!from.custom, depth: c.fullHeight };
}

describe('lowered side height', () => {
  it('follows the project setting', () => {
    const { p } = design();
    p.lowered = 60;
    const back = standing(p, 'back');
    expect(back.top).toBe(roundTo(0.6 * back.depth, p.precision));
    expect(back.custom).toBe(false);
  });

  it('can be overridden on chosen sides only, drawn as an override', () => {
    const { p, left } = design();
    left.node.lowerHeight = { percent: 40, sides: ['back'] };
    const back = standing(p, 'back');
    const right = standing(p, 'right');
    expect(back.top).toBe(roundTo(0.4 * back.depth, p.precision));
    expect(back.custom).toBe(true);
    expect(right.top).toBe(roundTo(0.75 * right.depth, p.precision));
    expect(right.custom).toBe(false);
    expect(lowPercent(p, left.node, 'right')).toBe(75);
    // Changing the project's height leaves the override alone.
    p.lowered = 50;
    expect(standing(p, 'back').top).toBe(roundTo(0.4 * back.depth, p.precision));
    expect(standing(p, 'right').top).toBe(roundTo(0.5 * right.depth, p.precision));
  });

  it('chooses sides like notch overrides: an unset choice covers every lowered side', () => {
    const { p, left } = design();
    left.node.lowerHeight = { percent: 40 };
    expect([standing(p, 'back').custom, standing(p, 'right').custom]).toEqual([true, true]);
    setLowOverrideSide(left.node, 'right', false);
    expect(left.node.lowerHeight.sides).toEqual(['back']);
    expect([standing(p, 'back').custom, standing(p, 'right').custom]).toEqual([true, false]);
    // A side that is not lowered cannot be chosen.
    setLowOverrideSide(left.node, 'front', true);
    expect(left.node.lowerHeight.sides).toEqual(['back']);
  });
});
