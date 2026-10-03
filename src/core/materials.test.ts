import { describe, expect, it } from 'vitest';
import { trayInstructions } from './assembly';
import { migrateProject } from './defaults';
import { addSibling, removeSection, setCutLayout, setDividerSecondary, setEmptyAbove, setInsertBaseSecondary, setJoin, setLayerBaseSecondary, setPad, setSecondaryThickness, setStacked, splitSection } from './edit';
import { blankProject, doomExample } from './fixtures';
import { solveProject, type Solved } from './layout';
import { buildCutList, cutPacking, planCuts, type CutPlan } from './pieces';
import { buildScene, overlap } from './scene';
import type { Dir, MaterialKind, Project, SplitNode } from './types';

function threeParts(dir: Dir = 'row') {
  const project = blankProject();
  const layer = project.layers[0]!;
  const second = splitSection(layer, layer.root.id, dir, 5)!;
  splitSection(layer, second, dir, 5);
  setSecondaryThickness(project, 3);
  return { project, layer, split: layer.root as SplitNode };
}

function noOverlaps(project: Project, solved: Solved) {
  const scene = buildScene(project, solved);
  const blocks = scene.trays.flatMap((t) => t.blocks);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i]!, blocks[j]!)).toBeLessThan(1e-6);
  }
  return scene;
}

describe('individual divider materials', () => {
  it('uses each divider thickness in row and column layouts, preserving locked sizes and sharing the reclaimed space', () => {
    for (const dir of ['row', 'column'] as const) {
      const { project, split } = threeParts(dir);
      split.children[0]!.size = { mode: 'fixed', mm: 60 };
      const before = solveProject(project);
      const oldSizes = before.layers[0]!.splits[0]!.childSizes;
      setDividerSecondary(split, 0, true);
      let solved = solveProject(project);
      let sizes = solved.layers[0]!.splits[0]!.childSizes;
      expect(sizes[0]).toBe(60);
      expect(sizes[1]).toBeCloseTo(oldSizes[1]! + 1, 6);
      expect(sizes[2]).toBeCloseTo(oldSizes[2]! + 1, 6);
      const dividers = solved.pieces.filter((p) => p.kind === 'divider');
      expect(dividers.map((p) => [p.material, p.thickness])).toEqual([['secondary', 3], ['primary', 5]]);
      expect(solved.layers[0]!.bars.map((b) => b.thickness)).toEqual([3, 5]);
      const axisSize = dir === 'row' ? 'w' : 'h';
      const start = dir === 'row' ? 'x' : 'y';
      for (const [i, divider] of dividers.entries()) {
        const left = solved.compartments[i]!;
        const right = solved.compartments[i + 1]!;
        expect(divider.footprint[axisSize]).toBe(divider.thickness);
        expect(divider.footprint[start]).toBeCloseTo(left.rect[start] + left.rect[axisSize], 6);
        expect(right.rect[start]).toBeCloseTo(divider.footprint[start] + divider.thickness, 6);
      }
      const tray = solved.trays[0]!;
      const last = solved.compartments[2]!;
      expect(last.rect[start] + last.rect[axisSize]).toBeCloseTo(tray.inner[start] + tray.inner[axisSize], 6);
      expect(solved.headroom).toBe(before.headroom);
      noOverlaps(project, solved);
      setDividerSecondary(split, 1, true);
      solved = solveProject(project);
      sizes = solved.layers[0]!.splits[0]!.childSizes;
      expect(sizes[1]).toBeCloseTo(oldSizes[1]! + 2, 6);
      setSecondaryThickness(project, 2);
      solved = solveProject(project);
      expect(solved.layers[0]!.splits[0]!.childSizes[1]).toBeCloseTo(oldSizes[1]! + 3, 6);
      noOverlaps(project, solved);
      setSecondaryThickness(project, undefined);
      solved = solveProject(project);
      expect(solved.layers[0]!.splits[0]!.childSizes).toEqual(oldSizes);
      expect(solved.pieces.every((p) => p.material === 'primary' && p.thickness === 5)).toBe(true);
      expect(split.children[0]!.secondaryDivider).toBe(true);
      setSecondaryThickness(project, 3);
      expect(solveProject(project).layers[0]!.bars.map((b) => b.thickness)).toEqual([3, 3]);
    }
  });

  it('preserves the surviving divider choices when compartments are inserted and removed', () => {
    const { project, layer, split } = threeParts();
    setDividerSecondary(split, 0, true);
    setDividerSecondary(split, 1, true);
    const originalIds = split.children.map((c) => c.node.id);
    const inserted = addSibling(layer, originalIds[0]!, 5)!;
    expect(solveProject(project).layers[0]!.bars.map((b) => b.thickness)).toEqual([5, 3, 3]);
    removeSection(layer, inserted);
    expect(split.children.map((c) => c.node.id)).toEqual(originalIds);
    expect(solveProject(project).layers[0]!.bars.map((b) => b.thickness)).toEqual([3, 3]);
    // The far divider survives a middle removal, so its material replaces the near one's.
    setDividerSecondary(split, 0, false);
    removeSection(layer, originalIds[1]!);
    expect(solveProject(project).layers[0]!.bars.map((b) => b.thickness)).toEqual([3]);
    removeSection(layer, originalIds[2]!);
    expect(layer.root.kind).toBe('section');
    expect(solveProject(project).pieces.some((p) => p.kind === 'divider')).toBe(false);

    const other = threeParts();
    setDividerSecondary(other.split, 0, true);
    removeSection(other.layer, other.split.children[1]!.node.id);
    expect(solveProject(other.project).layers[0]!.bars.map((b) => b.thickness)).toEqual([5]);
  });

  it('ignores divider choices for separate trays and restores them when switching back', () => {
    const { project, layer, split } = threeParts();
    setDividerSecondary(split, 0, true);
    const before = solveProject(project);
    setJoin(layer, split, 'trays', 5);
    const trays = solveProject(project);
    expect(trays.pieces.filter((p) => p.kind === 'divider')).toHaveLength(0);
    expect(trays.pieces.every((p) => p.material === 'primary' && p.thickness === 5)).toBe(true);
    setDividerSecondary(split, 1, true);
    expect(split.children[1]!.secondaryDivider).toBeUndefined();
    setJoin(layer, split, 'divider', 5);
    expect(solveProject(project)).toEqual(before);
  });

  it('builds mixed dividers inside full-height, stacked and separate removable boxes without overlaps', () => {
    for (const base of ['under', 'inside'] as const) {
      for (const stack of ['full', 'pair', 'empty'] as const) {
        for (const join of ['divider', 'trays'] as const) {
          const project = doomExample();
          project.base = base;
          setSecondaryThickness(project, 3);
          setLayerBaseSecondary(project, true);
          const layer = project.layers[0]!;
          const host = solveProject(project).compartments.find((c) => c.node.insert)!;
          setInsertBaseSecondary(host.node, true);
          setPad(host.node, 1);
          setStacked(host.node, stack !== 'full');
          setEmptyAbove(host.node, stack === 'empty');
          const root = host.node.insert!.root as SplitNode;
          const innerId = root.children[0]!.node.id;
          splitSection(layer, innerId, 'column', 5);
          const nested = root.children[0]!.node as SplitNode;
          setDividerSecondary(root, 0, true);
          setDividerSecondary(nested, 0, true);
          const inner = solveProject(project).compartments.find((c) => c.id === innerId)!;
          inner.node.notches = ['front'];
          inner.node.notchSize = { width: 18, depth: 7, sides: ['front'] };
          setJoin(layer, root, join, 5);
          const solved = solveProject(project);
          const dividers = solved.pieces.filter((p) => p.depth === 1 && p.kind === 'divider');
          const copies = stack === 'pair' ? 2 : 1;
          expect(dividers).toHaveLength((join === 'divider' ? 2 : 1) * copies);
          expect(dividers.every((p) => p.material === 'secondary' && p.thickness === 3)).toBe(true);
          expect(solved.pieces.filter((p) => p.kind === 'wall').every((p) => p.material === 'primary' && p.thickness === 5)).toBe(true);
          expect(solved.compartments.flatMap((c) => c.issues).filter((i) => i.level === 'error')).toEqual([]);
          const scene = noOverlaps(project, solved);
          for (const divider of dividers) {
            const block = scene.trays.flatMap((t) => t.blocks).find((b) => b.id === divider.id)!;
            expect(divider.axis === 'y' ? block.w : block.d).toBe(3);
            if (divider.splitId === nested.id) expect(divider.notches[0]).toMatchObject({ width: 18, depth: 7, custom: true });
            if (divider.copy) {
              const upper = solved.trays.find((t) => t.id === divider.trayId)!;
              const twin = solved.pieces.find((p) => p.trayId === upper.copyOf && p.order === divider.order)!;
              expect(divider.notches).toEqual(twin.notches);
              expect(divider.footprint).toEqual(twin.footprint);
            }
          }
          const well = solved.compartments.find((c) => c.id === host.id)!;
          const top = Math.max(...scene.trays.filter((t) => t.depth === 1).flatMap((t) => t.blocks.map((b) => b.z + b.h)));
          expect(top).toBeCloseTo(layer.height - (stack === 'empty' ? well.height / 2 : 0), 6);
          expect(solveProject(migrateProject(JSON.parse(JSON.stringify(project)))!)).toEqual(solved);
        }
      }
    }
  });

  it('keeps divider cut groups and strips on the correct material sheets and calls out the material in assembly', () => {
    for (const thickness of [3, 5, 8]) {
      const { project, split } = threeParts();
      setSecondaryThickness(project, thickness);
      setDividerSecondary(split, 0, true);
      const solved = solveProject(project);
      const dividers = solved.pieces.filter((p) => p.kind === 'divider');
      const cut = buildCutList(solved, project.precision);
      expect(cut.groupOf.get(dividers[0]!.id)).not.toBe(cut.groupOf.get(dividers[1]!.id));
      for (const layout of ['fewest', 'guillotine', 'strips'] as const) {
        const plan = planCuts({ ...project, material: { ...project.material, layout, secondaryLayout: layout } }, cut);
        expect(plan.issues).toEqual([]);
        expect(plan.counts.map((c) => c.material)).toEqual(['secondary', 'primary']);
        const placed = plan.sheets.flatMap((sheet) => sheet.items).reduce((n, item) => n + (item.kind === 'base' ? 1 : item.strip!.cuts.length), 0);
        expect(placed).toBe(solved.pieces.length);
        expect(new Set(plan.strips.map((s) => s.id)).size).toBe(plan.strips.length);
        for (const sheet of plan.sheets) for (const item of sheet.items) {
          const groups = item.group ? [item.group] : item.strip!.cuts.map((part) => cut.groups.find((g) => g.number === part.group)!);
          expect(groups.every((g) => g.material === sheet.material && g.thickness === sheet.thickness)).toBe(true);
        }
      }
      const steps = trayInstructions(project, solved, cut, solved.trays[0]!);
      const secondary = steps.find((s) => s.groups[0] === cut.groupOf.get(dividers[0]!.id)!.number)!;
      expect(secondary.material).toBe('secondary');
      expect(secondary.text).toContain(`using secondary material (${thickness} mm)`);
      const primary = steps.find((s) => s.text.startsWith(`Glue divider #${cut.groupOf.get(dividers[1]!.id)!.number}`))!;
      expect(primary.material).toBe('primary');
      expect(primary.text).toContain('using primary material (5 mm)');
    }
  });

  it('clips a notch using the selected divider thickness and keeps it shared across the divider', () => {
    const { project, split, layer } = threeParts();
    layer.height = 15;
    const left = solveProject(project).compartments[0]!;
    left.node.notches = ['right'];
    project.notch = { width: 20, depth: 10 };
    expect(solveProject(project).pieces.find((p) => p.kind === 'divider')!.notches[0]!.depth).toBe(5);
    setDividerSecondary(split, 0, true);
    const solved = solveProject(project);
    const divider = solved.pieces.find((p) => p.kind === 'divider')!;
    expect(divider.notches[0]!.depth).toBe(7);
    expect(solved.compartments[1]!.bounds.left).toBe(divider.id);
  });
});

describe('material sheet packing', () => {
  it('packs each material independently in all combinations, including materials with equal thickness', () => {
    const choices = ['strips', 'fewest', 'guillotine'] as const;
    const sheetsFor = (plan: CutPlan, material: MaterialKind) => plan.sheets.filter((s) => s.material === material).map(({ index, ...sheet }) => sheet);
    for (const thickness of [3, 5]) {
      const { project, split } = threeParts();
      setSecondaryThickness(project, thickness);
      setLayerBaseSecondary(project, true);
      setDividerSecondary(split, 0, true);
      const solved = solveProject(project);
      const cut = buildCutList(solved, project.precision);
      const references = new Map(choices.map((choice) => [choice, planCuts({ ...project, material: { ...project.material, layout: choice, secondaryLayout: choice } }, cut)]));
      expect(sheetsFor(references.get('strips')!, 'secondary')).not.toEqual(sheetsFor(references.get('fewest')!, 'secondary'));
      for (const primary of choices) for (const secondary of choices) {
        setCutLayout(project, primary);
        setCutLayout(project, secondary, 'secondary');
        const mixed = planCuts(project, cut);
        expect(sheetsFor(mixed, 'primary')).toEqual(sheetsFor(references.get(primary)!, 'primary'));
        expect(sheetsFor(mixed, 'secondary')).toEqual(sheetsFor(references.get(secondary)!, 'secondary'));
        expect(mixed.issues).toEqual([]);
        const placed = mixed.sheets.flatMap((s) => s.items).reduce((n, item) => n + (item.kind === 'base' ? 1 : item.strip!.cuts.length), 0);
        expect(placed).toBe(solved.pieces.length);
        for (const sheet of mixed.sheets) for (const item of sheet.items) {
          const groups = item.group ? [item.group] : item.strip!.cuts.map((part) => cut.groups.find((g) => g.number === part.group)!);
          expect(groups.every((g) => g.material === sheet.material)).toBe(true);
        }
      }
    }
  });

  it('defaults new secondary material to strips and remembers its own preference across toggles and saving', () => {
    const project = blankProject();
    setCutLayout(project, 'fewest');
    setSecondaryThickness(project, 3);
    expect(cutPacking(project, 'primary')).toBe('fewest');
    expect(cutPacking(project, 'secondary')).toBe('strips');
    setCutLayout(project, 'guillotine', 'secondary');
    setSecondaryThickness(project, undefined);
    setSecondaryThickness(project, 5);
    expect(cutPacking(project, 'secondary')).toBe('guillotine');
    setCutLayout(project, 'strips', 'secondary');
    const saved = migrateProject(JSON.parse(JSON.stringify(project)))!;
    expect(cutPacking(saved, 'primary')).toBe('fewest');
    expect(cutPacking(saved, 'secondary')).toBe('strips');
    setCutLayout(saved, 'strips');
    expect(saved.material.layout).toBeUndefined();
    expect(cutPacking(saved, 'secondary')).toBe('strips');
  });

  it('preserves both materials’ packing when opening a design saved before the independent setting', () => {
    for (const layout of ['strips', 'fewest', 'guillotine'] as const) {
      const legacy = blankProject();
      legacy.material.secondaryThickness = 3;
      legacy.material.layout = layout;
      const loaded = migrateProject(JSON.parse(JSON.stringify(legacy)))!;
      expect(cutPacking(loaded, 'primary')).toBe(layout);
      expect(cutPacking(loaded, 'secondary')).toBe(layout);
      setCutLayout(loaded, 'strips', 'secondary');
      const reopened = migrateProject(JSON.parse(JSON.stringify(loaded)))!;
      expect(cutPacking(reopened, 'primary')).toBe(layout);
      expect(cutPacking(reopened, 'secondary')).toBe('strips');
    }
  });
});
