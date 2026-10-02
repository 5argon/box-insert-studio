import { describe, expect, it } from 'vitest';
import { trayInstructions } from './assembly';
import { groupCutPatterns } from './cutting';
import { migrateProject } from './defaults';
import { setInsert, setInsertLid, setInsertLidSecondary, setLidNotchSide, setSecondaryThickness, setStacked, splitSection } from './edit';
import { blankProject } from './fixtures';
import { solveProject, type PieceInst } from './layout';
import { LID_NOTCH_DEFAULT, lidNotchPoints, lidOutline, rotateLidNotches, solveLidNotches } from './lidNotches';
import { buildCutList, panelUse, planCuts } from './pieces';
import { buildScene } from './scene';
import type { SectionNode, Side, SplitNode } from './types';

const SIDES: Side[] = ['back', 'front', 'left', 'right'];

function boxed() {
  const project = blankProject();
  const layer = project.layers[0]!;
  const host = layer.root as SectionNode;
  setInsert(layer, host.id, true);
  setInsertLid(host, true);
  return { project, layer, host };
}

function area(points: [number, number][]) {
  return Math.abs(points.reduce((sum, [x, y], i) => {
    const next = points[(i + 1) % points.length]!;
    return sum + x * next[1] - y * next[0];
  }, 0)) / 2;
}

describe('lid edge notches', () => {
  it('measures width along each edge and depth perpendicular to it, with the same slanted shape on all four sides', () => {
    const { notches, warnings } = solveLidNotches(80, 120, SIDES, { width: 20, depth: 8, bottom: 50 });
    expect(warnings).toEqual([]);
    const points = (side: Side) => lidNotchPoints(80, 120, notches.find((n) => n.side === side)!);
    expect(points('back')).toEqual([[30, 0], [35, 8], [45, 8], [50, 0]]);
    expect(points('front')).toEqual([[30, 120], [35, 112], [45, 112], [50, 120]]);
    expect(points('left')).toEqual([[0, 50], [8, 55], [8, 65], [0, 70]]);
    expect(points('right')).toEqual([[80, 50], [72, 55], [72, 65], [80, 70]]);
    expect(area(lidOutline(80, 120, notches))).toBe(80 * 120 - 4 * 120);
    for (const bottom of [0, 100]) {
      const shape = solveLidNotches(80, 120, SIDES, { width: 20, depth: 8, bottom }).notches;
      expect(area(lidOutline(80, 120, shape))).toBe(9600 - 4 * 8 * (20 + 20 * bottom / 100) / 2);
    }
  });

  it('uses independent local lid shapes and preserves them through side toggles, global changes and saving', () => {
    const { project, layer, host } = boxed();
    splitSection(layer, host.id, 'row', 5);
    const other = (layer.root as SplitNode).children[1]!.node as SectionNode;
    setInsert(layer, other.id, true);
    setInsertLid(other, true);
    setLidNotchSide(host, 'front', true);
    setLidNotchSide(other, 'left', true);
    host.insert!.lidNotchSize = { width: 22, depth: 8, bottom: 25 };
    project.notch = { width: 70, depth: 30, bottom: 100 };
    host.notches = ['back'];
    const before = solveProject(project);
    const lids = before.pieces.filter((p) => p.kind === 'lid');
    expect(lids[0]!.lidNotches![0]).toMatchObject({ side: 'front', width: 22, depth: 8, bottom: 5.5 });
    expect(lids[1]!.lidNotches![0]).toMatchObject({ side: 'left', width: 30, depth: 15, bottom: 15 });
    project.notch = { width: 35, depth: 5, bottom: 0 };
    const after = solveProject(project);
    expect(after.pieces.filter((p) => p.kind === 'lid')).toEqual(lids);
    expect(after.pieces.find((p) => p.role === 'back wall')!.notches).not.toEqual(before.pieces.find((p) => p.role === 'back wall')!.notches);
    setLidNotchSide(host, 'front', false);
    expect(host.insert!.lidNotches).toBeUndefined();
    expect(host.insert!.lidNotchSize).toEqual({ width: 22, depth: 8, bottom: 25 });
    setLidNotchSide(host, 'front', true);
    setLidNotchSide(host, 'front', true);
    expect(host.insert!.lidNotches).toEqual(['front']);
    expect(solveProject(migrateProject(JSON.parse(JSON.stringify(project)))!)).toEqual(after);
    expect(LID_NOTCH_DEFAULT).toEqual({ width: 30, depth: 15, bottom: 50 });
    setLidNotchSide({ kind: 'section', id: 'no-insert', notches: [] }, 'front', true);
  });

  it('keeps stacked lid cutouts identical and independent of sheet thickness or vertical box height', () => {
    const { project, layer, host } = boxed();
    for (const side of SIDES) setLidNotchSide(host, side, true);
    host.insert!.lidNotchSize = { width: 24, depth: 9, bottom: 0 };
    setSecondaryThickness(project, 3);
    setInsertLidSecondary(host, true);
    setStacked(host, true);
    splitSection(layer, host.insert!.root.id, 'row', 5, 'trays');
    let solved = solveProject(project);
    const lids = solved.pieces.filter((p) => p.kind === 'lid');
    expect(lids).toHaveLength(4);
    for (const lid of lids) {
      expect(lid.lidNotches).toHaveLength(4);
      expect(lid.lidNotches!.every((n) => n.width === 24 && n.depth === 9 && n.bottom === 0)).toBe(true);
      if (lid.copy) {
        const tray = solved.trays.find((t) => t.id === lid.trayId)!;
        expect(lid.lidNotches).toEqual(lids.find((p) => p.trayId === tray.copyOf)!.lidNotches);
      }
    }
    setSecondaryThickness(project, 8);
    solved = solveProject(project);
    expect(solved.pieces.filter((p) => p.kind === 'lid').map((p) => p.lidNotches)).toEqual(lids.map((p) => p.lidNotches));
    const scene = buildScene(project, solved);
    expect(Math.max(...scene.trays.filter((t) => t.depth === 1).flatMap((t) => t.blocks.map((b) => b.z + b.h)))).toBe(layer.height);
    expect(scene.trays.flatMap((t) => t.blocks).filter((b) => b.kind === 'lid').every((b) => b.lidNotches?.length === 4 && b.h === 8)).toBe(true);
  });

  it('groups matching rotated lid patterns together while keeping plain panels and other notch shapes separate', () => {
    const { project, host } = boxed();
    const solved = solveProject(project);
    const lid = solved.pieces.find((p) => p.kind === 'lid')!;
    const shape = solveLidNotches(80, 120, ['front'], { width: 20, depth: 8, bottom: 50 }).notches;
    const panel = { ...lid, length: 80, height: 120, footprint: { x: 0, y: 0, w: 80, h: 120 } };
    const pieces: PieceInst[] = [
      { ...panel, id: 'plain-base', kind: 'base', role: 'base' },
      { ...panel, id: 'plain-lid' },
      { ...panel, id: 'front-lid', lidNotches: shape },
      { ...panel, id: 'back-lid', lidNotches: solveLidNotches(80, 120, ['back'], { width: 20, depth: 8, bottom: 50 }).notches },
      { ...panel, id: 'rotated-lid', length: 120, height: 80, lidNotches: rotateLidNotches(shape, 120) },
      { ...panel, id: 'side-lid', lidNotches: solveLidNotches(80, 120, ['left'], { width: 20, depth: 8, bottom: 50 }).notches },
      { ...panel, id: 'slot-lid', lidNotches: solveLidNotches(80, 120, ['front'], { width: 20, depth: 8, bottom: 100 }).notches },
    ];
    const cut = buildCutList({ ...solved, pieces }, project.precision);
    const group = cut.groupOf.get('front-lid')!;
    expect(group).toBe(cut.groupOf.get('back-lid'));
    expect(group).toBe(cut.groupOf.get('rotated-lid'));
    expect(group.pieces).toHaveLength(3);
    expect(panelUse(group)).toBe('lid');
    expect(group).not.toBe(cut.groupOf.get('plain-base'));
    expect(group).not.toBe(cut.groupOf.get('side-lid'));
    expect(group).not.toBe(cut.groupOf.get('slot-lid'));
    expect(cut.groupOf.get('plain-base')).toBe(cut.groupOf.get('plain-lid'));
    expect(area(lidOutline(group.length, group.height, group.lidNotches))).toBe(9600 - 120);
    for (const layout of ['strips', 'fewest', 'guillotine'] as const) {
      const plan = planCuts({ ...project, material: { ...project.material, layout } }, cut);
      expect(plan.issues).toEqual([]);
      expect(plan.sheets.flatMap((s) => s.items)).toHaveLength(pieces.length);
      for (const item of plan.sheets.flatMap((s) => s.items)) {
        const g = item.group!;
        const cuts = item.w === g.length ? g.lidNotches : rotateLidNotches(g.lidNotches ?? [], g.height);
        const expected = area(lidOutline(g.length, g.height, g.lidNotches));
        expect(area(lidOutline(item.w, item.h, cuts))).toBe(expected);
      }
    }
    // A square may rotate a quarter turn without changing its dimensions.
    const square = pieces.slice(2, 4).map((p, i) => ({ ...p, length: 80, height: 80, lidNotches: solveLidNotches(80, 80, [i ? 'left' : 'front'], { width: 20, depth: 8 }).notches }));
    expect(buildCutList({ ...solved, pieces: square }, 0.5).groups).toHaveLength(1);
    expect(host.insert!.lidNotches).toBeUndefined();
  });

  it('clips oversized cuts to keep a valid lid outline and reports edges that cannot fit', () => {
    const single = solveLidNotches(20, 30, ['left'], { width: 100, depth: 100, bottom: 100 });
    expect(single.notches[0]).toMatchObject({ width: 26, depth: 16, bottom: 26 });
    expect(single.warnings[0]).toContain('reduced');
    const all = solveLidNotches(40, 60, SIDES, { width: 30, depth: 100, bottom: 100 });
    expect(all.notches.every((n) => n.depth <= (n.side === 'left' || n.side === 'right' ? 3 : 13))).toBe(true);
    const outline = lidOutline(40, 60, all.notches);
    expect(area(outline)).toBeGreaterThan(0);
    expect(outline.every(([x, y]) => x >= 0 && x <= 40 && y >= 0 && y <= 60)).toBe(true);
    expect(solveLidNotches(6, 6, SIDES).notches).toEqual([]);
    expect(solveLidNotches(6, 6, SIDES).warnings).toHaveLength(4);
  });

  it('describes all local lid edge cuts before assembly and leaves lid placement free of cutting notes', () => {
    const { project, host } = boxed();
    for (const side of SIDES) setLidNotchSide(host, side, true);
    host.insert!.lidNotchSize = { width: 22, depth: 8, bottom: 25 };
    project.notch = { width: 60, depth: 20, bottom: 100 };
    const solved = solveProject(project);
    const cut = buildCutList(solved, project.precision);
    const tray = solved.trays.find((t) => t.depth === 1)!;
    const lidStep = trayInstructions(project, solved, cut, tray).find((s) => s.text.startsWith('Place lid'))!;
    expect(lidStep.notes).toEqual([]);
    const lid = solved.pieces.find((p) => p.kind === 'lid')!;
    const patterns = groupCutPatterns(cut.groupOf.get(lid.id)!);
    expect(patterns).toHaveLength(4);
    expect(patterns.map((p) => p.edge).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    for (const pattern of patterns) {
      expect(pattern.width).toBe(22);
      expect(pattern.bottom).toBe(5.5);
      expect(pattern.points[1]!.inward).toBe(8);
      expect(pattern.points[2]!.inward).toBe(8);
    }
    expect(trayInstructions(project, solved, cut, solved.trays[0]!).flatMap((s) => s.notes)).toEqual([]);
  });
});
