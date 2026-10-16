import { describe, expect, it } from 'vitest';
import { trayInstructions } from './assembly';
import { migrateProject, newLayer } from './defaults';
import { setConstruction, setNoBase, setNoOuterWalls, splitSection } from './edit';
import { blankProject, doomExample } from './fixtures';
import { baseThickness, solveProject, type Solved } from './layout';
import { buildCutList } from './pieces';
import { buildScene, overlap } from './scene';
import type { Project } from './types';

const exampleTexts = import.meta.glob('../../examples/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const examples = Object.values(exampleTexts).map((text) => () => migrateProject(JSON.parse(text))!);

/** One layer split into three columns, the middle one split again back to front. */
function grid(): Project {
  const p = blankProject();
  const layer = p.layers[0]!;
  const T = p.material.thickness;
  const right = splitSection(layer, layer.root.id, 'row', T)!;
  splitSection(layer, right, 'row', T);
  const middle = solveProject(p).compartments.sort((a, b) => a.rect.x - b.rect.x)[1]!;
  splitSection(layer, middle.node.id, 'column', T);
  return p;
}

function steps(p: Project, solved: Solved, trayIndex = 0) {
  return trayInstructions(p, solved, buildCutList(solved, p.precision), solved.trays[trayIndex]!);
}

function noOverlaps(p: Project) {
  const blocks = buildScene(p, solveProject(p)).trays.flatMap((t) => t.blocks);
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i]!, blocks[j]!)).toBeLessThan(1e-6);
}

describe('no base', () => {
  it('leaves the base out of the bottom layer only, keeping its compartments as deep', () => {
    const p = grid();
    p.layers.push(newLayer('Top', 10));
    const B = baseThickness(p);
    const before = solveProject(p);
    setNoBase(p, true);
    const after = solveProject(p);
    const [bottom, top] = p.layers;
    expect(after.pieces.filter((x) => x.kind === 'base').map((x) => x.layerId)).toEqual([top!.id]);
    expect(after.headroom).toBeCloseTo(before.headroom + B);
    expect(after.compartments.map((c) => c.fullHeight)).toEqual(before.compartments.map((c) => c.fullHeight));
    expect(after.trays.find((t) => t.layerId === bottom!.id)!.base).toBe(0);
    noOverlaps(p);

    setNoBase(p, false);
    expect(p.layers[0]!.height).toBe(bottom!.height);
    expect(solveProject(p).headroom).toBeCloseTo(before.headroom);
  });

  it('builds a tray from its walls when there is no base', () => {
    const p = grid();
    setNoBase(p, true);
    const s = steps(p, solveProject(p));
    expect(s[0]!.strong).toBe('This tray has no base.');
    expect(s[1]!.text).toMatch(/^Stand the back and front walls .* upright, facing each other\.$/);
    expect(s[2]!.text).toMatch(/^Glue the left and right walls .* between them\.$/);
    expect(s.slice(3).every((x) => x.text.startsWith('Glue divider') && x.measure?.from.endsWith('wall'))).toBe(true);
  });
});

describe('no outer walls', () => {
  it('runs the dividers out to the box, less the clearance', () => {
    const p = grid();
    setNoOuterWalls(p, true);
    const solved = solveProject(p);
    const c = p.clearance / 2;
    expect(solved.pieces.filter((x) => x.kind === 'wall')).toEqual([]);
    expect(solved.trays[0]!.open).toEqual(['back', 'front', 'left', 'right']);
    expect(solved.trays[0]!.inner).toEqual(solved.trays[0]!.outer);
    for (const d of solved.pieces.filter((x) => x.kind === 'divider' && x.axis === 'y')) {
      expect(d.start).toBeCloseTo(c);
      expect(d.length).toBeCloseTo(p.box.depth - 2 * c);
    }
    const s = steps(p, solved);
    expect(s[0]!.text).toMatch(/^Start with base/);
    expect(s.slice(1).every((x) => x.measure?.from.endsWith('edge of the base'))).toBe(true);
    noOverlaps(p);
  });

  it('gives the compartments by the box the room the walls took', () => {
    const p = grid();
    const before = solveProject(p).compartments.map((c) => c.rect.w * c.rect.h);
    setNoOuterWalls(p, true);
    const after = solveProject(p).compartments.map((c) => c.rect.w * c.rect.h);
    after.forEach((a, i) => expect(a).toBeGreaterThan(before[i]!));
  });

  it('keeps the walls between separate trays', () => {
    const p = grid();
    setConstruction(p, 'separate');
    setNoOuterWalls(p, true);
    const solved = solveProject(p);
    // The outer columns keep the wall facing the middle; the middle column's two trays meet the box on one side each.
    const walls = solved.trays.map((t) => solved.pieces.filter((x) => x.trayId === t.id && x.kind === 'wall').length).sort();
    expect(walls).toEqual([1, 1, 3, 3]);
    noOverlaps(p);
  });

  it('leaves removable boxes their walls', () => {
    const p = doomExample();
    setNoOuterWalls(p, true);
    const solved = solveProject(p);
    for (const t of solved.trays.filter((x) => x.depth === 1)) {
      expect(t.open).toBeUndefined();
      expect(solved.pieces.filter((x) => x.trayId === t.id && x.kind === 'wall')).toHaveLength(4);
    }
  });

  it('has no notch or lowered side where there is no wall', () => {
    const p = grid();
    setNoOuterWalls(p, true);
    const left = solveProject(p).compartments.sort((a, b) => a.rect.x - b.rect.x)[0]!;
    left.node.notches = ['left', 'right'];
    left.node.lowered = ['back'];
    const solved = solveProject(p);
    const c = solved.compartments.find((x) => x.id === left.id)!;
    expect(c.bounds.left).toBe('');
    expect(solved.pieces.filter((x) => x.notches.length)).toHaveLength(1);
    expect(solved.pieces.some((x) => x.lowFrom.length)).toBe(false);
  });
});

describe('no base and no outer walls', () => {
  it('stands the dividers in the box and glues the rest to them', () => {
    const p = grid();
    setNoBase(p, true);
    setNoOuterWalls(p, true);
    const solved = solveProject(p);
    expect(solved.pieces.every((x) => x.kind === 'divider')).toBe(true);
    const s = steps(p, solved);
    expect(s[0]!.strong).toBe('This tray has no base or walls.');
    const [a, b, c] = s.slice(1);
    // The two full-depth dividers meet only the box; the short one between them is glued to both.
    expect(a!.text).toMatch(/^Stand divider .* from the left side of the box\.$/);
    expect(b!.text).toMatch(/^Stand divider .* from the right side of the box\.$/);
    expect(c!.text).toMatch(/^Glue divider .* from the back side of the box\.$/);
    // Measured from the box itself: half the clearance further than from the tray's edge.
    const first = solved.pieces.find((x) => x.id === a!.pieces[0])!;
    expect(a!.measure!.distance).toBeCloseTo(first.footprint.x);
    expect(a!.measure!.edge).toBeCloseTo(0);
    noOverlaps(p);
  });

  it('warns when a tray would have nothing to build', () => {
    const p = blankProject();
    setNoBase(p, true);
    setNoOuterWalls(p, true);
    const solved = solveProject(p);
    expect(solved.pieces).toEqual([]);
    expect(solved.layers[0]!.issues.some((i) => i.message.includes('nothing to build'))).toBe(true);
  });

  it('builds every example without overlaps', () => {
    for (const design of examples) {
      for (const separate of [false, true]) {
        const p = design();
        if (separate) setConstruction(p, 'separate');
        setNoBase(p, true);
        setNoOuterWalls(p, true);
        noOverlaps(p);
        const solved = solveProject(p);
        const cut = buildCutList(solved, p.precision);
        for (const t of solved.trays) expect(() => trayInstructions(p, solved, cut, t)).not.toThrow();
      }
    }
  });
});
