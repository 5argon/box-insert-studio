import { describe, expect, it } from 'vitest';
import { trayInstructions } from './assembly';
import { migrateProject } from './defaults';
import { setEmptyAbove, setInsert, setInsertBaseSecondary, setInsertLid, setInsertLidSecondary, setJoin, setLayerBaseSecondary, setPad, setSecondaryThickness, setStacked, splitSection } from './edit';
import { blankProject } from './fixtures';
import { fitItems } from './items';
import { insertLidThickness, maxPad, solveProject, type Solved } from './layout';
import { buildCutList, panelUse, planCuts } from './pieces';
import { buildScene, overlap } from './scene';
import type { Project, SectionNode, SplitNode } from './types';

function boxed() {
  const project = blankProject();
  const layer = project.layers[0]!;
  const host = layer.root as SectionNode;
  setInsert(layer, host.id, true);
  return { project, layer, host };
}

function sceneWithoutOverlaps(project: Project, solved: Solved) {
  const scene = buildScene(project, solved);
  const blocks = scene.trays.flatMap((t) => t.blocks);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i]!, blocks[j]!)).toBeLessThan(1e-6);
  }
  return scene;
}

describe('removable-box lids', () => {
  it('keeps closed boxes flush for either base construction, wall direction, stack mode and separate-box layout', () => {
    for (const base of ['under', 'inside'] as const) {
      for (const fullWalls of ['x', 'y'] as const) {
        for (const stack of ['single', 'pair', 'empty'] as const) {
          for (const join of ['divider', 'trays'] as const) {
            const { project, layer, host } = boxed();
            project.base = base;
            project.fullWalls = fullWalls;
            setSecondaryThickness(project, 3);
            setLayerBaseSecondary(project, true);
            setInsertBaseSecondary(host, true);
            setPad(host, 1);
            setStacked(host, stack !== 'single');
            setEmptyAbove(host, stack === 'empty');
            splitSection(layer, host.insert!.root.id, 'row', 5);
            const root = host.insert!.root as SplitNode;
            const second = root.children[1]!.node as SectionNode;
            splitSection(layer, second.id, 'column', 5);
            setJoin(layer, root, join, 5);
            const before = solveProject(project);
            setInsertLid(host, true);
            for (const secondary of [false, true]) {
              setInsertLidSecondary(host, secondary);
              const solved = solveProject(project);
              const lidThickness = secondary ? 3 : 5;
              const boxes = solved.trays.filter((t) => t.depth === 1);
              const lids = solved.pieces.filter((p) => p.kind === 'lid');
              expect(lids).toHaveLength((join === 'trays' ? 2 : 1) * (stack === 'pair' ? 2 : 1));
              expect(boxes.map((t) => t.height)).toEqual(before.trays.filter((t) => t.depth === 1).map((t) => t.height));
              expect(lids.every((p) => p.thickness === lidThickness && p.material === (secondary ? 'secondary' : 'primary'))).toBe(true);
              expect(solved.compartments.flatMap((c) => c.issues).filter((i) => i.level === 'error')).toEqual([]);
              for (const box of boxes) {
                expect(box.wallHeight).toBeCloseTo(before.trays.find((t) => t.id === box.id)!.wallHeight - lidThickness);
                const lid = lids.find((p) => p.trayId === box.id)!;
                expect(lid.footprint).toEqual(box.outer);
                expect(lid.length).toBe(box.outer.w);
                expect(lid.height).toBe(box.outer.h);
              }
              for (const c of solved.compartments.filter((c) => c.depth === 1)) {
                expect(c.height).toBeCloseTo(before.compartments.find((old) => old.id === c.id)!.height - lidThickness);
              }
              const scene = sceneWithoutOverlaps(project, solved);
              const well = solved.compartments.find((c) => c.id === host.id)!;
              const top = Math.max(...scene.trays.filter((t) => t.depth === 1).flatMap((t) => t.blocks.map((b) => b.z + b.h)));
              expect(top).toBeCloseTo(layer.height - (stack === 'empty' ? well.height / 2 : 0));
              expect(solved.headroom).toBe(before.headroom);
            }
            setInsertLid(host, false);
            expect(solveProject(project)).toEqual(before);
          }
        }
      }
    }
  });

  it('reserves a lid on each stacked box, keeping raised floors and simulated contents below it', () => {
    const { project, layer, host } = boxed();
    setSecondaryThickness(project, 2);
    setLayerBaseSecondary(project, true);
    layer.height = 76;
    setPad(host, 1);
    setStacked(host, true);
    setInsertBaseSecondary(host, true);
    setInsertLid(host, true);
    setInsertLidSecondary(host, true);
    const inner = host.insert!.root as SectionNode;
    setPad(inner, 1);
    inner.arrow = 'front';
    inner.items = { on: true, shape: 'box', width: 20, height: 25.5, thickness: 5, spare: 10 };
    const solved = solveProject(project);
    const c = solved.compartments.find((c) => c.id === inner.id)!;
    // 76 − 2 mm layer base − 5 mm raised floor = 69 mm, split into 34.5 mm per closed box.
    // Each reserves 2 mm for the lid, 2 mm for the box base, and 5 mm for its inside raised floor.
    expect(c.height).toBe(25.5);
    expect(fitItems(c, inner.arrow, inner.items).warnings).toEqual([]);
    const scene = sceneWithoutOverlaps(project, solved);
    const boxes = scene.trays.filter((t) => t.depth === 1);
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      const lid = box.blocks.find((b) => b.kind === 'lid')!;
      for (const item of box.items.flatMap((row) => row.items)) expect(item.z + item.h).toBeCloseTo(lid.z);
    }
    const lowerLid = boxes[0]!.blocks.find((b) => b.kind === 'lid')!;
    const upperBase = boxes[1]!.blocks.find((b) => b.kind === 'base')!;
    expect(lowerLid.z + lowerLid.h).toBe(upperBase.z);
    expect(boxes[1]!.blocks.find((b) => b.kind === 'lid')!.z + 2).toBe(76);
    setInsertLidSecondary(host, false);
    const thicker = solveProject(project).compartments.find((c) => c.id === inner.id)!;
    expect(thicker.height).toBe(22.5);
    expect(fitItems(thicker, inner.arrow, inner.items).warnings[0]).toContain('3 mm above');
  });

  it('accounts for lids when limiting raised floors or rejecting shallow boxes', () => {
    const { project, layer, host } = boxed();
    layer.height = 33;
    setStacked(host, true);
    setInsertLid(host, true);
    let solved = solveProject(project);
    expect(solved.trays.filter((t) => t.depth === 1)).toEqual([]);
    expect(solved.compartments[0]!.issues[0]!.message).toContain('at least 35 mm tall');
    setSecondaryThickness(project, 3);
    setInsertLidSecondary(host, true);
    solved = solveProject(project);
    expect(solved.trays.filter((t) => t.depth === 1)).toHaveLength(2);
    expect(solved.compartments.filter((c) => c.depth === 1)[0]!.height).toBe(6);
    expect(maxPad(28, 5, 2, 5, 3)).toBe(0);
    layer.height = 45;
    expect(maxPad(40, 5, 2, 5, 5)).toBe(2);
    setInsertLidSecondary(host, false);
    setPad(host, 3);
    solved = solveProject(project);
    expect(solved.trays.filter((t) => t.depth === 1)).toEqual([]);
    expect(solved.compartments[0]!.issues[0]!.message).toContain('Remove 1 layer.');
    setPad(host, 2);
    solved = solveProject(project);
    expect(solved.trays.filter((t) => t.depth === 1)).toHaveLength(2);
    expect(solved.compartments.filter((c) => c.depth === 1)[0]!.height).toBe(5);
  });

  it('packs lids as flat panels on the selected material sheets and describes removable lids in assembly', () => {
    for (const base of ['under', 'inside'] as const) {
      const { project, host } = boxed();
      project.base = base;
      setSecondaryThickness(project, 3);
      setStacked(host, true);
      setInsertBaseSecondary(host, true);
      setInsertLid(host, true);
      setInsertLidSecondary(host, true);
      const solved = solveProject(project);
      const cut = buildCutList(solved, project.precision);
      const lids = solved.pieces.filter((p) => p.kind === 'lid');
      const group = cut.groupOf.get(lids[0]!.id)!;
      expect(group.kind).toBe('base');
      expect(group.material).toBe('secondary');
      expect(panelUse(group)).toBe(base === 'under' ? 'base, lid' : 'lid');
      expect(group.pieces).toHaveLength(base === 'under' ? 4 : 2);
      for (const layout of ['fewest', 'guillotine', 'strips'] as const) {
        const plan = planCuts({ ...project, material: { ...project.material, layout } }, cut);
        expect(plan.issues).toEqual([]);
        const placed = plan.sheets.flatMap((s) => s.items).reduce((n, i) => n + (i.kind === 'base' ? 1 : i.strip!.cuts.length), 0);
        expect(placed).toBe(solved.pieces.length);
        for (const sheet of plan.sheets) {
          for (const item of sheet.items.filter((i) => i.group === group)) {
            expect(item.kind).toBe('base');
            expect(sheet.material).toBe('secondary');
            expect(sheet.thickness).toBe(3);
          }
        }
      }
      const tray = solved.trays.find((t) => t.depth === 1 && !t.copyOf)!;
      const steps = trayInstructions(project, solved, cut, tray);
      const step = steps.find((s) => s.text.startsWith('Place lid'))!;
      expect(step.material).toBe('secondary');
      expect(step.groups).toEqual([group.number]);
      expect(step.text).toContain('secondary material (3 mm)');
      expect(step.text).toContain('Keep it removable.');
      expect(step.text).toContain(`${tray.height} mm tall`);
      expect(steps.at(-1)!.text).toContain('with their lids on');
    }
  });

  it('preserves lid choices in saved designs and falls back to primary thickness when secondary material is disabled', () => {
    const { project, host } = boxed();
    setSecondaryThickness(project, 3);
    setInsertLid(host, true);
    setInsertLidSecondary(host, true);
    const before = solveProject(project);
    expect(solveProject(migrateProject(JSON.parse(JSON.stringify(project)))!)).toEqual(before);
    expect(insertLidThickness(project, host)).toBe(3);
    setSecondaryThickness(project, undefined);
    let solved = solveProject(project);
    expect(insertLidThickness(project, host)).toBe(5);
    expect(solved.pieces.find((p) => p.kind === 'lid')).toMatchObject({ material: 'primary', thickness: 5 });
    expect(solved.trays.map((t) => t.height)).toEqual(before.trays.map((t) => t.height));
    setSecondaryThickness(project, 8);
    solved = solveProject(project);
    expect(solved.pieces.find((p) => p.kind === 'lid')).toMatchObject({ material: 'secondary', thickness: 8 });
    sceneWithoutOverlaps(project, solved);
    setInsertLid(host, false);
    expect(insertLidThickness(project, host)).toBe(0);
    expect(solveProject(project).pieces.some((p) => p.kind === 'lid')).toBe(false);
    // Keep the material preference when the user temporarily removes a lid.
    setInsertLid(host, true);
    expect(insertLidThickness(project, host)).toBe(8);
  });
});
