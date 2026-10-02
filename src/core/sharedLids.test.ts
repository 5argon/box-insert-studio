import { describe, expect, it } from 'vitest';
import { sharedLidInstructions, trayInstructions } from './assembly';
import { migrateProject } from './defaults';
import { setEmptyAbove, setInsert, setInsertBaseSecondary, setInsertLid, setInsertLidSecondary, setInsertSharedLid, setJoin, setLayerBaseSecondary, setLidNotchSide, setPad, setSecondaryThickness, setStacked, splitSection } from './edit';
import { blankProject } from './fixtures';
import { inset } from './geom';
import { insertLidAllowance, maxPad, solveProject, usesSharedLid, type Solved } from './layout';
import { buildCutList, planCuts } from './pieces';
import { buildScene, overlap } from './scene';
import type { Dir, Project, SectionNode, SplitNode } from './types';

function separateBoxes(dir: Dir = 'row') {
  const project = blankProject();
  const layer = project.layers[0]!;
  const host = layer.root as SectionNode;
  setInsert(layer, host.id, true);
  setInsertLid(host, true);
  splitSection(layer, host.insert!.root.id, dir, 5, 'trays');
  return { project, layer, host, root: host.insert!.root as SplitNode };
}

function noOverlap(project: Project, solved: Solved) {
  const model = buildScene(project, solved);
  const blocks = model.trays.flatMap((t) => t.blocks);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i]!, blocks[j]!)).toBeLessThan(1e-6);
  }
  expect(blocks).toHaveLength(solved.pieces.length);
  return model;
}

describe('shared lids over separate boxes', () => {
  it('covers the entire group once and keeps every box body and divider flush below the cover', () => {
    for (const base of ['under', 'inside'] as const) {
      for (const dir of ['row', 'column'] as const) {
        for (const stack of ['single', 'pair', 'empty'] as const) {
          for (const secondary of [false, true]) {
            const { project, layer, host, root } = separateBoxes(dir);
            project.base = base;
            project.fullWalls = dir === 'row' ? 'x' : 'y';
            setSecondaryThickness(project, 3);
            setLayerBaseSecondary(project, true);
            setInsertBaseSecondary(host, true);
            layer.height = 76;
            setPad(host, 1);
            setStacked(host, stack !== 'single');
            setEmptyAbove(host, stack === 'empty');
            setInsertLidSecondary(host, secondary);
            const lidThickness = secondary ? 3 : 5;
            const firstChild = root.children[0]!.node as SectionNode;
            splitSection(layer, firstChild.id, dir === 'row' ? 'column' : 'row', 5);
            const nested = root.children[0]!.node as SplitNode;
            nested.children[0]!.secondaryDivider = true;
            // A second level of separate boxes makes an L-shaped arrangement, all under one cover.
            splitSection(layer, root.children[1]!.node.id, dir === 'row' ? 'column' : 'row', 5, 'trays');
            for (const side of ['front', 'left'] as const) setLidNotchSide(host, side, true);
            host.insert!.lidNotchSize = { width: 22, depth: 8, bottom: 25 };
            const individual = solveProject(project);
            setInsertSharedLid(host, true);
            const solved = solveProject(project);
            const boxes = solved.trays.filter((t) => t.depth === 1);
            const lids = solved.pieces.filter((p) => p.kind === 'lid');
            expect(lids).toHaveLength(1);
            expect(lids[0]).toMatchObject({ sharedLidFor: host.id, copy: false, material: secondary ? 'secondary' : 'primary', thickness: lidThickness });
            expect(lids[0]!.lidNotches).toHaveLength(2);
            const well = solved.compartments.find((c) => c.id === host.id)!;
            expect(lids[0]!.footprint).toEqual(inset(well.rect, project.clearance / 2));
            expect(boxes).toHaveLength(stack === 'pair' ? 6 : 3);
            const bodyHeight = stack === 'single' ? 68 - lidThickness : stack === 'pair' ? (68 - lidThickness) / 2 : 34 - lidThickness;
            for (const box of boxes) {
              expect(box.height).toBe(bodyHeight);
              expect(box.lid).toBe(0);
              expect(box.wallHeight).toBe(base === 'under' ? bodyHeight - 3 : bodyHeight);
              expect(solved.pieces.filter((p) => p.trayId === box.id && p.kind === 'divider').every((p) => p.height === bodyHeight - 3)).toBe(true);
            }
            for (const c of solved.compartments.filter((c) => c.depth === 1)) {
              expect(c.height).toBe(bodyHeight - 3);
              const before = individual.compartments.find((old) => old.id === c.id)!;
              expect(c.height - before.height).toBe(stack === 'pair' ? lidThickness / 2 : 0);
            }
            const model = noOverlap(project, solved);
            const cover = model.trays.find((t) => t.label === 'Shared lid in A')!;
            expect(cover.blocks).toHaveLength(1);
            expect(cover.blocks[0]!.z).toBe(stack === 'empty' ? 42 - lidThickness : 76 - lidThickness);
            expect(cover.blocks[0]!.z + cover.blocks[0]!.h).toBe(stack === 'empty' ? 42 : 76);
            expect(model.trays.filter((t) => !t.label.startsWith('Shared lid')).flatMap((t) => t.blocks).some((b) => b.kind === 'lid')).toBe(false);
            expect(solved.headroom).toBe(individual.headroom);
            expect(solved.compartments.flatMap((c) => c.issues).filter((i) => i.level === 'error')).toEqual([]);
          }
        }
      }
    }
  });

  it('reserves only one lid thickness for a stacked group when checking minimum height and raised floors', () => {
    const { project, layer, host } = separateBoxes();
    setStacked(host, true);
    layer.height = 30;
    expect(solveProject(project).trays.filter((t) => t.depth === 1)).toEqual([]);
    setInsertSharedLid(host, true);
    let solved = solveProject(project);
    expect(solved.trays.filter((t) => t.depth === 1)).toHaveLength(4);
    expect(solved.compartments.filter((c) => c.depth === 1).every((c) => c.height === 5)).toBe(true);
    expect(insertLidAllowance(project, host)).toBe(2.5);
    expect(maxPad(40, 5, 2, 5, insertLidAllowance(project, host))).toBe(3);
    layer.height = 45;
    setPad(host, 3);
    solved = solveProject(project);
    expect(solved.trays.filter((t) => t.depth === 1)).toHaveLength(4);
    noOverlap(project, solved);
    setPad(host, 4);
    solved = solveProject(project);
    expect(solved.trays.filter((t) => t.depth === 1)).toEqual([]);
    expect(solved.compartments[0]!.issues[0]!.message).toContain('Remove 1 layer.');
    setPad(host, 0);
    layer.height = 30;
    setEmptyAbove(host, true);
    expect(insertLidAllowance(project, host)).toBe(5);
    solved = solveProject(project);
    expect(solved.trays.filter((t) => t.depth === 1)).toEqual([]);
    expect(solved.compartments[0]!.issues[0]!.message).toContain('at least 35 mm tall');
  });

  it('remembers coverage while toggling lids or switching between separate boxes and one box', () => {
    const { project, layer, host, root } = separateBoxes();
    setInsertSharedLid(host, true);
    setLidNotchSide(host, 'front', true);
    host.insert!.lidNotchSize = { width: 21, depth: 7, bottom: 25 };
    const before = solveProject(project);
    expect(usesSharedLid(host)).toBe(true);
    expect(solveProject(migrateProject(JSON.parse(JSON.stringify(project)))!)).toEqual(before);
    setJoin(layer, root, 'divider', 5);
    expect(usesSharedLid(host)).toBe(false);
    let lids = solveProject(project).pieces.filter((p) => p.kind === 'lid');
    expect(lids).toHaveLength(1);
    expect(lids[0]!.sharedLidFor).toBeUndefined();
    setJoin(layer, root, 'trays', 5);
    expect(solveProject(project)).toEqual(before);
    setInsertLid(host, false);
    expect(usesSharedLid(host)).toBe(false);
    expect(solveProject(project).pieces.some((p) => p.kind === 'lid')).toBe(false);
    setInsertLid(host, true);
    expect(solveProject(project)).toEqual(before);
    setInsertSharedLid(host, false);
    lids = solveProject(project).pieces.filter((p) => p.kind === 'lid');
    expect(lids).toHaveLength(2);
    expect(lids.every((p) => !p.sharedLidFor && p.lidNotches?.length === 1)).toBe(true);
    expect(host.insert!.lidNotchSize).toEqual({ width: 21, depth: 7, bottom: 25 });
  });

  it('packs the single shared cover on its chosen material sheets and keeps its assembly after the boxes', () => {
    for (const thickness of [3, 5, 8]) {
      const { project, host } = separateBoxes();
      setSecondaryThickness(project, thickness);
      setInsertLidSecondary(host, true);
      setInsertSharedLid(host, true);
      setStacked(host, true);
      setLidNotchSide(host, 'front', true);
      const solved = solveProject(project);
      const lid = solved.pieces.find((p) => p.sharedLidFor)!;
      const cut = buildCutList(solved, project.precision);
      const group = cut.groupOf.get(lid.id)!;
      expect(group.kind).toBe('base');
      expect(group.pieces).toHaveLength(1);
      expect(group.material).toBe('secondary');
      for (const layout of ['strips', 'fewest', 'guillotine'] as const) {
        const plan = planCuts({ ...project, material: { ...project.material, layout } }, cut);
        expect(plan.issues).toEqual([]);
        expect(plan.sheets.flatMap((s) => s.items).reduce((n, i) => n + (i.kind === 'base' ? 1 : i.strip!.cuts.length), 0)).toBe(solved.pieces.length);
        const sheet = plan.sheets.find((s) => s.items.some((i) => i.group === group))!;
        expect(sheet.material).toBe('secondary');
        expect(sheet.thickness).toBe(thickness);
      }
      for (const box of solved.trays.filter((t) => t.depth === 1 && !t.copyOf)) {
        const steps = trayInstructions(project, solved, cut, box);
        expect(steps.some((s) => s.groups.includes(group.number))).toBe(false);
        expect(steps.some((s) => s.text.startsWith('Place lid'))).toBe(false);
        expect(steps.flatMap((s) => s.notes)).toEqual([]);
        expect(steps.at(-1)!.text).toContain('set them aside');
      }
      const steps = sharedLidInstructions(project, solved, cut, lid);
      expect(steps).toHaveLength(2);
      expect(steps[0]!.text).toContain('then stack each identical upper box');
      expect(steps[0]!.text).toContain('after all boxes are in place');
      expect(steps[1]!.text).toContain(`Place shared lid #${group.number}`);
      expect(steps[1]!.text).toContain(`secondary material (${thickness} mm)`);
      expect(steps[1]!.text).toContain('flush');
      expect(steps[1]!.notes).toEqual([]);
      expect(steps[1]!.groups).toEqual([group.number]);
    }
  });
});
