import { describe, expect, it } from 'vitest';
import { trayInstructions } from './assembly';
import { blankProject, defaultProject, labelFor, migrateProject, newLayer, newSection } from './defaults';
import { canUseTrays, distributeEqually, dragBar, insertMode, lockChild, removeSection, setInsert, setJoin, setStacked, splitSection } from './edit';
import { allocate, solveProject } from './layout';
import { pack } from './pack';
import { buildCutList, planCuts } from './pieces';
import type { LayoutNode, Project } from './types';

function clearNotches(n: LayoutNode) {
  if (n.kind === 'section') n.notches = [];
  else n.children.forEach((c) => clearNotches(c.node));
}

function summary(project: Project, layerIndex: number) {
  const solved = solveProject(project);
  const layerId = project.layers[layerIndex].id;
  const cut = buildCutList({ ...solved, pieces: solved.pieces.filter((p) => p.layerId === layerId) }, project.precision);
  return cut.groups.map((g) => `${g.pieces.length}× ${g.length}x${g.height}${g.notches.length ? '*' : ''}`);
}

describe('allocate', () => {
  it('gives locked sizes first and shares the rest by weight', () => {
    expect(allocate(100, [{ mode: 'fixed', mm: 40 }, { mode: 'flex', weight: 1 }, { mode: 'flex', weight: 2 }]).sizes).toEqual([40, 20, 40]);
  });
  it('flags locked sizes that overflow', () => {
    expect(allocate(50, [{ mode: 'fixed', mm: 60 }, { mode: 'flex', weight: 1 }]).issue).toMatch(/more than/);
  });
});

describe('labels', () => {
  it('counts past Z', () => {
    expect([0, 25, 26, 27].map(labelFor)).toEqual(['A', 'Z', 'AA', 'AB']);
  });
});

describe('foam solver', () => {
  it('reproduces the DOOM top tray cut list', () => {
    const p = defaultProject();
    p.layers.forEach((l) => clearNotches(l.root));
    expect(summary(p, 1)).toEqual(['1× 285x285', '2× 285x28', '3× 275x28', '1× 167x28', '6× 103x28', '1× 45x28', '3× 28x28']);
  });

  it('accounts for board thickness in every compartment', () => {
    const p = defaultProject();
    const s = solveProject(p);
    const top = s.layers[1];
    const widths = top.compartments.filter((c) => c.rect.y < 50).map((c) => c.rect.w);
    // 49 + 5 + 49 in the left column, then the 167 mm tile compartment.
    expect(widths).toEqual([49, 49, 167]);
    for (const c of s.compartments) expect(c.rect.w).toBeGreaterThan(0);
  });

  it('builds walls on the base or around it', () => {
    const p = defaultProject();
    p.layers = [newLayer('Only', 40)];
    expect(summary(p, 0)).toEqual(['1× 285x285', '2× 285x35', '2× 275x35']);
    p.base = 'inside';
    expect(summary(p, 0)).toEqual(['1× 275x275', '2× 285x40', '2× 275x40']);
    p.fullWalls = 'y';
    const s = solveProject(p);
    expect(s.pieces.find((x) => x.role === 'left wall')!.length).toBe(285);
    expect(s.pieces.find((x) => x.role === 'back wall')!.length).toBe(275);
  });

  it('makes separate trays with their own walls and a clearance gap', () => {
    const p = defaultProject();
    const layer = newLayer('Trays', 40);
    p.layers = [layer];
    splitSection(layer, layer.root.id, 'row', p.material.thickness);
    if (layer.root.kind !== 'split') throw new Error();
    expect(setJoin(layer, layer.root, 'trays', 5)).toBe(true);
    const s = solveProject(p);
    expect(s.trays).toHaveLength(2);
    expect(s.trays[0].outer.w).toBeCloseTo(142, 6);
    expect(s.trays[1].outer.x - (s.trays[0].outer.x + s.trays[0].outer.w)).toBeCloseTo(p.clearance, 6);
    expect(summary(p, 0)).toEqual(['2× 285x142', '4× 275x35', '4× 142x35']);
  });

  it('only allows separate trays where every enclosing split is separate trays', () => {
    const p = defaultProject();
    const bottom = p.layers[0];
    if (bottom.root.kind !== 'split') throw new Error();
    const inner = bottom.root.children[0].node;
    if (inner.kind !== 'split') throw new Error();
    expect(canUseTrays(bottom.root, inner.id)).toBe(false);
    expect(setJoin(bottom, inner, 'trays', 5)).toBe(false);
    expect(setJoin(bottom, bottom.root, 'trays', 5)).toBe(true);
    expect(canUseTrays(bottom.root, inner.id)).toBe(true);
    setJoin(bottom, inner, 'trays', 5);
    setJoin(bottom, bottom.root, 'divider', 5);
    expect(inner.join).toBe('divider');
  });

  it('cuts finger notches into the piece on each chosen side', () => {
    const p = defaultProject();
    const s = solveProject(p);
    const a = s.compartments.find((c) => c.label === 'A')!;
    const back = s.pieces.find((x) => x.id === a.bounds.back)!;
    expect(back.role).toBe('back wall');
    expect(back.notches).toHaveLength(2);
    expect(back.notches[0].center).toBeCloseTo(a.rect.x + a.rect.w / 2 - back.start, 6);
    expect(back.notches[0].width).toBe(30);
  });

  it('flags layers taller than the box', () => {
    const p = defaultProject();
    p.layers[0].height = 80;
    expect(solveProject(p).issues.some((i) => i.level === 'error')).toBe(true);
  });
});

describe('cut list', () => {
  it('groups mirror-image notched pieces together', () => {
    const p = defaultProject();
    const layer = newLayer('Mirror', 40, newSection());
    p.layers = [layer];
    const second = splitSection(layer, layer.root.id, 'row', p.material.thickness)!;
    splitSection(layer, second, 'row', p.material.thickness);
    if (layer.root.kind !== 'split') throw new Error();
    distributeEqually(layer.root);
    const [l, , r] = layer.root.children.map((c) => c.node);
    if (l.kind !== 'section' || r.kind !== 'section') throw new Error();
    // A notch at the left end of the front wall and at the right end of the back wall mirror each other.
    l.notches = ['front'];
    r.notches = ['back'];
    const s = solveProject(p);
    const cut = buildCutList(s, p.precision);
    const back = s.pieces.find((x) => x.role === 'back wall')!;
    const front = s.pieces.find((x) => x.role === 'front wall')!;
    expect(back.notches[0].center).not.toBeCloseTo(front.notches[0].center, 3);
    expect(cut.groupOf.get(back.id)).toBe(cut.groupOf.get(front.id));
    expect(cut.flipped.has(back.id) !== cut.flipped.has(front.id)).toBe(true);
    // Two notches on one wall and one on the other are different pieces.
    r.notches = ['back', 'front'];
    const s2 = solveProject(p);
    const cut2 = buildCutList(s2, p.precision);
    const b2 = s2.pieces.find((x) => x.role === 'back wall')!;
    const f2 = s2.pieces.find((x) => x.role === 'front wall')!;
    expect(cut2.groupOf.get(b2.id)).not.toBe(cut2.groupOf.get(f2.id));
  });

  it('suggests merging pieces that differ by a millimetre or two', () => {
    const p = defaultProject();
    const layer = newLayer('Near', 40);
    p.layers = [layer];
    const right = splitSection(layer, layer.root.id, 'row', p.material.thickness)!;
    const below = splitSection(layer, right, 'column', p.material.thickness)!;
    splitSection(layer, below, 'column', p.material.thickness);
    if (layer.root.kind !== 'split') throw new Error();
    // Left column 136 wide with one divider, right column 134 wide with two: 136 vs 134 mm dividers.
    const leftId = layer.root.children[0].node.id;
    splitSection(layer, leftId, 'column', p.material.thickness);
    layer.root.children[0].size = { mode: 'fixed', mm: 136 };
    const cut = buildCutList(solveProject(p), p.precision);
    expect(cut.hints.some((h) => /equal lengths/.test(h.message))).toBe(true);
    layer.root.children[0].size = { mode: 'fixed', mm: 135 };
    const cut2 = buildCutList(solveProject(p), p.precision);
    expect(cut2.hints.some((h) => /equal lengths/.test(h.message))).toBe(false);
  });

  it('plans strips no longer than the sheet and accounts for every piece', () => {
    const p = defaultProject();
    const s = solveProject(p);
    const cut = buildCutList(s, p.precision);
    const plan = planCuts(p, cut);
    expect(plan.issues).toEqual([]);
    const maxLen = Math.max(p.material.sheet.width, p.material.sheet.height) - 2 * p.material.trim;
    for (const st of plan.strips) expect(st.used).toBeLessThanOrEqual(maxLen + 1e-6);
    const stripPieces = plan.strips.reduce((a, st) => a + st.cuts.length, 0);
    const bases = plan.sheets.flatMap((sh) => sh.items).filter((i) => i.kind === 'base').length;
    expect(stripPieces + bases).toBe(s.pieces.length);
    expect(planCuts(p, cut)).toEqual(plan);
  });

  it('reports bases that do not fit the sheet', () => {
    const p = defaultProject();
    p.material.sheet = { preset: 'A4', width: 210, height: 297 };
    const plan = planCuts(p, buildCutList(solveProject(p), p.precision));
    expect(plan.issues.some((i) => /does not fit/.test(i.message))).toBe(true);
  });
});

describe('edit', () => {
  it('flattens same-direction dividers and collapses on remove', () => {
    const layer = newLayer('x', 30);
    const first = layer.root.id;
    const second = splitSection(layer, first, 'row', 5)!;
    splitSection(layer, second, 'row', 5);
    expect(layer.root.kind === 'split' && layer.root.children.length).toBe(3);
    removeSection(layer, second);
    const next = removeSection(layer, first);
    expect(layer.root.kind).toBe('section');
    expect(next).toBe(layer.root.id);
  });

  it('keeps the layout filled when the last flex part gets locked', () => {
    const p = defaultProject();
    const bottom = p.layers[0];
    if (bottom.root.kind !== 'split') throw new Error();
    lockChild(bottom.root, 1, 101, [168, 102]);
    const s = solveProject(p);
    expect(s.layers[0].issues).toEqual([]);
    expect(s.layers[0].splits.find((x) => x.id === bottom.root.id)!.childSizes).toEqual([169, 101]);
  });

  it('snaps a dragged bar to a matching size', () => {
    const layer = newLayer('x', 30);
    splitSection(layer, layer.root.id, 'row', 5);
    if (layer.root.kind !== 'split') throw new Error();
    expect(dragBar(layer.root, 0, [100, 170], 11.2, [112])).toBe(112);
    expect(dragBar(layer.root, 0, [100, 170], 20.2, [112])).toBe(120);
  });
});

describe('assembly', () => {
  it('glues base, full walls, short walls, then dividers outside-in', () => {
    const p = defaultProject();
    const s = solveProject(p);
    const cut = buildCutList(s, p.precision);
    const top = s.trays.find((t) => t.layerId === p.layers[1].id)!;
    const steps = trayInstructions(p, s, cut, top);
    expect(steps[0].text).toMatch(/^Start with base #1/);
    expect(steps[1].text).toMatch(/back and front walls #\d+ ×2 on top of the base/);
    expect(steps[2].text).toMatch(/left and right walls #\d+ ×2 between them/);
    expect(steps[3].text).toMatch(/^Glue divider #\d+ between .+, 103 mm from the left wall/);
    expect(steps).toHaveLength(3 + 12);
  });
});

describe('pack', () => {
  const items = [
    { id: 'a', w: 200, h: 150 },
    { id: 'b', w: 150, h: 200 },
    { id: 'c', w: 90, h: 90 },
    { id: 'd', w: 300, h: 100 },
  ];
  it('keeps pieces inside the sheet', () => {
    const r = pack(items, 410, 584, 1);
    expect(r.unplaced).toEqual([]);
    for (const pl of r.placements) {
      const it = items.find((i) => i.id === pl.id)!;
      expect(pl.x + (pl.rotated ? it.h : it.w)).toBeLessThanOrEqual(410 + 1e-6);
      expect(pl.y + (pl.rotated ? it.w : it.h)).toBeLessThanOrEqual(584 + 1e-6);
    }
  });
});

describe('switching to separate trays', () => {
  it('keeps locked compartments at their inside size', () => {
    const p = defaultProject();
    const top = p.layers[1];
    if (top.root.kind !== 'split') throw new Error();
    setJoin(top, top.root, 'trays', p.material.thickness);
    const s = solveProject(p);
    const trays = s.layers[1].trays;
    expect(trays).toHaveLength(2);
    expect(trays[0].inner.w).toBeCloseTo(103, 6);
    expect(s.layers[1].compartments.find((c) => c.label === 'H')!.rect.w).toBeCloseTo(49, 6);
    setJoin(top, top.root, 'divider', p.material.thickness);
    expect(top.root.children[0].size).toEqual({ mode: 'fixed', mm: 103 });
  });
});

describe('lock toggle', () => {
  it('locks a flex part at its current size, unlocks it again, and never locks the last flex part', async () => {
    const { toggleLock, isLastFlex } = await import('./edit');
    const layer = newLayer('x', 30);
    const b = splitSection(layer, layer.root.id, 'row', 5)!;
    splitSection(layer, b, 'row', 5);
    if (layer.root.kind !== 'split') throw new Error();
    const split = layer.root;
    toggleLock(split, 0, [90, 90, 85]);
    expect(split.children[0].size).toEqual({ mode: 'fixed', mm: 90 });
    toggleLock(split, 1, [90, 90, 85]);
    expect(isLastFlex(split, 2)).toBe(true);
    toggleLock(split, 2, [90, 90, 85]);
    expect(split.children[2].size.mode).toBe('flex');
    toggleLock(split, 0, [90, 90, 85]);
    expect(split.children[0].size.mode).toBe('flex');
  });
});

describe('boxes inside compartments', () => {
  function boxedProject() {
    const p = defaultProject();
    const s = solveProject(p);
    const g = s.compartments.find((c) => c.label === 'G')!;
    const box = s.trays.find((t) => t.wellId === g.id)!;
    return { p, s, g, box };
  }

  it('stands a box in the compartment with clearance, its top flush with the walls', () => {
    const { p, s, g, box } = boxedProject();
    const T = p.material.thickness;
    expect(box.depth).toBe(1);
    expect(box.outer.w).toBeCloseTo(g.rect.w - p.clearance, 6);
    expect(box.outer.h).toBeCloseTo(g.rect.h - p.clearance, 6);
    // Stands on the tray's base: total height is one thickness less, so base + box = layer height.
    expect(box.height + T).toBe(p.layers[0].height);
    expect(box.wallHeight).toBe(p.layers[0].height - 2 * T);
    const inner = s.pieces.filter((x) => x.trayId === box.id);
    expect(inner.find((x) => x.kind === 'base')!.length).toBeCloseTo(box.outer.w, 6);
    expect(inner.filter((x) => x.kind === 'wall').every((x) => x.height === 46)).toBe(true);
    expect(inner.filter((x) => x.kind === 'divider').map((x) => x.height)).toEqual([46]);
  });

  it('gives compartments inside a box one floor less height', () => {
    const { p, s } = boxedProject();
    const T = p.material.thickness;
    const H = p.layers[0].height;
    expect(s.compartments.find((c) => c.label === 'F')!.height).toBe(H - T);
    expect(s.compartments.find((c) => c.label === 'G1')!.height).toBe(H - 2 * T);
  });

  it('labels compartments inside a box after their well', () => {
    const { s, g } = boxedProject();
    const inner = s.compartments.filter((c) => c.wellId === g.id);
    expect(inner.map((c) => c.label)).toEqual(['G1', 'G2']);
    expect(inner.every((c) => c.index === g.index)).toBe(true);
    const i = s.compartments.indexOf(g);
    expect(s.compartments.slice(i + 1, i + 3)).toEqual(inner);
  });

  it('switches between one box with a divider and separate boxes', () => {
    const { p, g } = boxedProject();
    const layer = p.layers[0];
    const well = g.node;
    expect(insertMode(well)).toBe('single');
    const root = well.insert!.root;
    if (root.kind !== 'split') throw new Error();
    expect(setJoin(layer, root, 'trays', p.material.thickness)).toBe(true);
    expect(insertMode(well)).toBe('multiple');
    const s = solveProject(p);
    const boxes = s.trays.filter((t) => t.wellId === g.id);
    expect(boxes).toHaveLength(2);
    expect(s.pieces.filter((x) => boxes.some((b) => b.id === x.trayId) && x.kind === 'divider')).toHaveLength(0);
    expect(boxes[1].outer.x - (boxes[0].outer.x + boxes[0].outer.w)).toBeCloseTo(p.clearance, 6);
  });

  it('allows only one level of boxes and removes the box with its last compartment', () => {
    const { p, s, g } = boxedProject();
    const layer = p.layers[0];
    const g1 = s.compartments.find((c) => c.label === 'G1')!;
    expect(setInsert(layer, g1.id, true)).toBe(false);
    const g2 = s.compartments.find((c) => c.label === 'G2')!;
    removeSection(layer, g2.id);
    expect(g.node.insert!.root.kind).toBe('section');
    expect(removeSection(layer, g1.id)).toBe(g.id);
    expect(g.node.insert).toBeUndefined();
  });

  it('lists the box as its own tray in the assembly', () => {
    const { p, s, box } = boxedProject();
    const cut = buildCutList(s, p.precision);
    const steps = trayInstructions(p, s, cut, box);
    expect(steps[0].text).toMatch(/^Start with base/);
    expect(steps.some((st) => /Glue divider/.test(st.text))).toBe(true);
    expect(steps[steps.length - 1].text).toMatch(/drop the box into compartment G/);
  });
});

describe('new project', () => {
  it('starts with one empty tray and keeps box and material settings', () => {
    const from = defaultProject();
    from.material.thickness = 3;
    from.box.width = 300;
    const p = blankProject(from);
    expect(p.layers).toHaveLength(1);
    expect(p.layers[0].root.kind).toBe('section');
    expect(p.layers[0].height).toBe(from.box.height - 10);
    expect(p.material.thickness).toBe(3);
    expect(p.box.width).toBe(300);
    const s = solveProject(p);
    expect(s.compartments).toHaveLength(1);
    expect(s.issues).toEqual([]);
    // The original is untouched.
    expect(from.layers).toHaveLength(2);
    // One base and four walls fit one A2 sheet once strips may be shorter than the sheet.
    expect(planCuts(p, buildCutList(s, p.precision)).sheets).toHaveLength(1);
  });
});

describe('history', () => {
  it('undoes and redoes, clearing redo on a new change', async () => {
    const { History } = await import('./history');
    const h = new History();
    h.record('a', 0);
    h.breakStep();
    h.record('b', 1000);
    h.breakStep();
    h.record('c', 2000);
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe('b');
    // Recording the restored state changes nothing.
    h.record('b', 2100);
    expect(h.canRedo).toBe(true);
    h.breakStep();
    h.record('d', 3000);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('b');
  });

  it('merges a drag or a burst of typing into one step, but not separate clicks', async () => {
    const { History } = await import('./history');
    const h = new History();
    h.record('0', 0);
    h.breakStep();
    for (let i = 1; i <= 5; i++) h.record(String(i), 100 * i);
    expect(h.undo()).toBe('0');
    const k = new History();
    k.record('0', 0);
    k.breakStep();
    k.record('1', 100);
    k.breakStep();
    k.record('2', 200);
    expect(k.undo()).toBe('1');
  });

  it('starts a new step after a pause even without a click', async () => {
    const { History } = await import('./history');
    const h = new History();
    h.record('0', 0);
    h.record('1', 100);
    h.record('2', 5000);
    expect(h.undo()).toBe('1');
  });

  it('keeps at most the limit of steps', async () => {
    const { History } = await import('./history');
    const h = new History(3);
    h.record('0', 0);
    for (let i = 1; i <= 5; i++) {
      h.breakStep();
      h.record(String(i), i * 1000);
    }
    expect([h.undo(), h.undo(), h.undo(), h.undo()]).toEqual(['4', '3', '2', undefined]);
  });
});

describe('stacked boxes', () => {
  function stackedProject() {
    const p = defaultProject();
    const s0 = solveProject(p);
    const g = s0.compartments.find((c) => c.label === 'G')!;
    setStacked(g.node, true);
    return { p, g };
  }

  it('makes two identical half-height boxes, each with its own floor', () => {
    const { p, g } = stackedProject();
    const s = solveProject(p);
    const T = p.material.thickness;
    const H = p.layers[0].height;
    const boxes = s.trays.filter((t) => t.wellId === g.id);
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.height === (H - T) / 2)).toBe(true);
    expect(boxes[1].copyOf).toBe(boxes[0].id);
    expect(boxes[0].number).toBeLessThan(boxes[1].number);
    // Two boxes plus the tray floor fill the layer exactly.
    expect(2 * boxes[0].height + T).toBe(H);
    expect(s.compartments.find((c) => c.label === 'G1')!.height).toBe((H - T) / 2 - T);
    const pieces = (b: (typeof boxes)[number]) => s.pieces.filter((x) => x.trayId === b.id);
    expect(pieces(boxes[1]).length).toBe(pieces(boxes[0]).length);
    expect(pieces(boxes[1]).every((x) => x.copy)).toBe(true);
    expect(pieces(boxes[0]).filter((x) => x.kind === 'wall').every((x) => x.height === (H - T) / 2 - T)).toBe(true);
  });

  it('counts both boxes in the cut list and copies notches to the upper box', () => {
    const { p, g } = stackedProject();
    const s1 = solveProject(p);
    const g1 = s1.compartments.find((c) => c.label === 'G1')!;
    g1.node.notches = ['back'];
    const s = solveProject(p);
    const cut = buildCutList(s, p.precision);
    const bases = cut.groups.filter((x) => x.kind === 'base');
    expect(bases.find((b) => b.length === 140)!.pieces).toHaveLength(2);
    const notched = s.pieces.filter((x) => x.depth === 1 && x.notches.length);
    expect(notched).toHaveLength(2);
    expect(cut.groupOf.get(notched[0].id)).toBe(cut.groupOf.get(notched[1].id));
  });

  it('keeps the editor data single: one set of compartments and bars', () => {
    const { p } = stackedProject();
    const s = solveProject(p);
    const keys = s.layers[0].bars.map((b) => `${b.splitId}:${b.index}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(s.compartments.filter((c) => c.label.startsWith('G')).map((c) => c.label)).toEqual(['G', 'G1', 'G2']);
    expect(s.compartments.find((c) => c.label === 'G1')!.stacked).toBe(true);
  });

  it('tells the builder to make two and stack them', () => {
    const { p, g } = stackedProject();
    const s = solveProject(p);
    const cut = buildCutList(s, p.precision);
    const lower = s.trays.find((t) => t.wellId === g.id && !t.copyOf)!;
    const steps = trayInstructions(p, s, cut, lower);
    expect(steps[steps.length - 1].text).toMatch(/second, identical box.*stack both in compartment G/);
  });
});

describe('shared notches', () => {
  it('shows a divider notch from both sides and removes it from either side', async () => {
    const { hasNotch, notchSharedWith, toggleNotch } = await import('./notches');
    const p = defaultProject();
    const find = (s: ReturnType<typeof solveProject>, l: string) => s.compartments.find((c) => c.label === l)!;
    let s = solveProject(p);
    // D and E sit on top of each other in the bottom tray, sharing a horizontal divider.
    toggleNotch(s, find(s, 'D'), 'front');
    s = solveProject(p);
    expect(hasNotch(s, find(s, 'E'), 'back')).toBe(true);
    expect(notchSharedWith(s, find(s, 'E'), 'back')).toEqual(['D']);
    toggleNotch(s, find(s, 'E'), 'back');
    s = solveProject(p);
    expect(hasNotch(s, find(s, 'D'), 'front')).toBe(false);
    expect(find(s, 'D').node.notches).toEqual([]);
  });

  it('does not show a notch that is on another stretch of the same divider', async () => {
    const { hasNotch, toggleNotch } = await import('./notches');
    const p = defaultProject();
    const find = (s: ReturnType<typeof solveProject>, l: string) => s.compartments.find((c) => c.label === l)!;
    let s = solveProject(p);
    // A's front notch is on the long horizontal divider, far from G's stretch of it.
    expect(find(s, 'A').node.notches).toContain('front');
    expect(hasNotch(s, find(s, 'G'), 'back')).toBe(false);
    toggleNotch(s, find(s, 'G'), 'back');
    s = solveProject(p);
    expect(hasNotch(s, find(s, 'G'), 'back')).toBe(true);
    expect(hasNotch(s, find(s, 'A'), 'front')).toBe(true);
  });
});

describe('material', () => {
  it('migrates projects saved with the old foam setting', () => {
    const old = JSON.parse(JSON.stringify(defaultProject()));
    const sheet = old.material.sheet;
    old.foam = { thickness: 3, sheet, trim: 5, kerf: 0.5 };
    delete old.material;
    const p = migrateProject(old)!;
    expect(p.material).toEqual({ thickness: 3, sheet, trim: 5, kerf: 0.5 });
    expect('foam' in p).toBe(false);
    expect(solveProject(p).issues).toEqual([]);
  });

  it('rejects files that are not projects', () => {
    expect(migrateProject({ hello: 1 })).toBeUndefined();
    expect(migrateProject(null)).toBeUndefined();
  });
});

describe('3D scene', () => {
  async function scene(edit?: (p: Project, s: ReturnType<typeof solveProject>) => void) {
    const { buildScene, overlap } = await import('./scene');
    const p = defaultProject();
    if (edit) edit(p, solveProject(p));
    const s = solveProject(p);
    return { p, s, model: buildScene(p, s), overlap };
  }

  function expectNoOverlaps(model: Awaited<ReturnType<typeof scene>>['model'], overlap: (a: never, b: never) => number) {
    const blocks = model.trays.flatMap((t) => t.blocks);
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const v = overlap(blocks[i] as never, blocks[j] as never);
        if (v > 1e-6) throw new Error(`${blocks[i].id} overlaps ${blocks[j].id} by ${v} mm³`);
      }
    }
    for (const b of blocks) {
      expect(b.x).toBeGreaterThanOrEqual(-1e-6);
      expect(b.y).toBeGreaterThanOrEqual(-1e-6);
      expect(b.x + b.w).toBeLessThanOrEqual(model.box.w + 1e-6);
      expect(b.y + b.d).toBeLessThanOrEqual(model.box.d + 1e-6);
      expect(b.z + b.h).toBeLessThanOrEqual(model.layers.reduce((a, l) => a + l.height, 0) + 1e-6);
    }
  }

  it('places every piece without overlaps, walls on the base', async () => {
    const { model, overlap } = await scene();
    expectNoOverlaps(model, overlap);
  });

  it('places every piece without overlaps with the base inside the walls', async () => {
    const { model, overlap } = await scene((p) => (p.base = 'inside'));
    expectNoOverlaps(model, overlap);
  });

  it('places stacked boxes and separate trays without overlaps', async () => {
    const { model, overlap, p } = await scene((p, s) => {
      const g = s.compartments.find((c) => c.label === 'G')!;
      setStacked(g.node, true);
      const top = p.layers[1];
      if (top.root.kind === 'split') setJoin(top, top.root, 'trays', p.material.thickness);
    });
    expectNoOverlaps(model, overlap);
    // The upper box of the stack ends exactly at the layer's top.
    const upper = model.trays.find((t) => t.level === 1)!;
    const top = Math.max(...upper.blocks.map((b) => b.z + b.h));
    expect(top).toBeCloseTo(p.layers[0].height, 6);
    expect(model.trays.filter((t) => t.depth === 0 && t.layerId === p.layers[1].id)).toHaveLength(2);
  });

  it('keeps tray colours when another tray is added, and keeps them distinct', async () => {
    const { buildScene } = await import('./scene');
    const p = defaultProject();
    const colors = new Map<string, number>();
    const before = new Map(buildScene(p, solveProject(p), colors).trays.map((t) => [t.key, t.color]));
    const g = solveProject(p).compartments.find((c) => c.label === 'G')!;
    setStacked(g.node, true);
    const after = buildScene(p, solveProject(p), colors).trays;
    for (const t of after) if (before.has(t.key)) expect(t.color).toBe(before.get(t.key));
    expect(new Set(after.map((t) => t.color)).size).toBe(after.length);
  });

  it('gives trays keys that survive unrelated edits', async () => {
    const { buildScene } = await import('./scene');
    const p = defaultProject();
    const before = buildScene(p, solveProject(p)).trays.map((t) => t.key);
    p.box.width = 300;
    p.layers[0].height = 50;
    expect(buildScene(p, solveProject(p)).trays.map((t) => t.key)).toEqual(before);
  });
});

describe('raised floors', () => {
  async function padded(layers: number, label = 'S') {
    const { setPad } = await import('./edit');
    const p = defaultProject();
    const c0 = solveProject(p).compartments.find((c) => c.label === label)!;
    setPad(c0.node, layers);
    return p;
  }

  it('stacks pads cut to the inside size less clearance and reports the height left', async () => {
    const p = await padded(2);
    const s = solveProject(p);
    const c = s.compartments.find((x) => x.label === 'S')!;
    const T = p.material.thickness;
    expect(c.pad).toBe(2);
    expect(c.padHeight).toBe(2 * T);
    expect(c.fullHeight).toBe(p.layers[1].height - T);
    expect(c.height).toBe(c.fullHeight - 2 * T);
    const pads = s.pieces.filter((x) => x.kind === 'pad' && x.padFor === c.id);
    expect(pads).toHaveLength(2);
    expect(pads[0].length).toBeCloseTo(c.rect.w - p.clearance, 6);
    expect(pads[0].height).toBeCloseTo(c.rect.h - p.clearance, 6);
  });

  it('reports overpadding after the material gets thicker', async () => {
    const { maxPad } = await import('./layout');
    const p0 = defaultProject();
    const full = solveProject(p0).compartments.find((x) => x.label === 'S')!.fullHeight;
    const most = maxPad(full, p0.material.thickness);
    expect(most * p0.material.thickness).toBeLessThan(full);
    expect((most + 1) * p0.material.thickness).toBeGreaterThanOrEqual(full);
    const p = await padded(most);
    expect(solveProject(p).compartments.find((x) => x.label === 'S')!.issues).toEqual([]);
    p.material.thickness = 6;
    const c = solveProject(p).compartments.find((x) => x.label === 'S')!;
    const err = c.issues.find((i) => i.level === 'error');
    expect(err?.message).toMatch(/Raised floor .* taller than/);
    const remove = Number(/Remove (\d+) layer/.exec(err!.message)![1]);
    expect((c.pad - remove) * 6).toBeLessThan(c.fullHeight);
    expect((c.pad - remove + 1) * 6).toBeGreaterThanOrEqual(c.fullHeight);
  });

  it('shows pads stacked in 3D without overlapping anything', async () => {
    const { buildScene, overlap } = await import('./scene');
    const p = await padded(3);
    const s = solveProject(p);
    const model = buildScene(p, s);
    const T = p.material.thickness;
    const pads = model.trays.flatMap((t) => t.blocks).filter((b) => b.kind === 'pad');
    expect(pads.map((b) => b.z - p.layers[0].height).sort((a, b) => a - b)).toEqual([T, 2 * T, 3 * T]);
    const blocks = model.trays.flatMap((t) => t.blocks);
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i], blocks[j])).toBe(0);
  });

  it('lists pads in the cut list and assembly steps', async () => {
    const { panelUse } = await import('./pieces');
    const p = await padded(2);
    const s = solveProject(p);
    const cut = buildCutList(s, p.precision);
    const g = cut.groups.find((x) => x.pieces.some((q) => q.kind === 'pad'))!;
    expect(panelUse(g)).toBe('pad');
    expect(g.pieces).toHaveLength(2);
    const tray = s.trays.find((t) => t.layerId === p.layers[1].id)!;
    const steps = trayInstructions(p, s, cut, tray);
    expect(steps.some((st) => new RegExp(`#${g.number} ×2 flat into compartment S`).test(st.text))).toBe(true);
    expect(planCuts(p, cut).issues).toEqual([]);
  });

  it('lifts a removable box on a raised floor, shorter so its top stays flush', async () => {
    const { buildScene, overlap } = await import('./scene');
    const p = await padded(2, 'G');
    const s = solveProject(p);
    const T = p.material.thickness;
    const H = p.layers[0].height;
    const g = s.compartments.find((c) => c.label === 'G')!;
    expect(s.pieces.filter((x) => x.padFor === g.id)).toHaveLength(2);
    const box = s.trays.find((t) => t.wellId === g.id)!;
    expect(box.height).toBe(H - T - 2 * T);
    const model = buildScene(p, s);
    const blocks = model.trays.flatMap((t) => t.blocks);
    const boxTop = Math.max(...model.trays.find((t) => t.id === box.id)!.blocks.map((b) => b.z + b.h));
    expect(boxTop).toBeCloseTo(H, 6);
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i], blocks[j])).toBe(0);
  });

  it('keeps a stacked pair on a raised floor flush, and flags a floor that leaves the boxes too shallow', async () => {
    const { buildScene } = await import('./scene');
    const { maxPad } = await import('./layout');
    const p = await padded(1, 'G');
    const g0 = solveProject(p).compartments.find((c) => c.label === 'G')!;
    setStacked(g0.node, true);
    let s = solveProject(p);
    const T = p.material.thickness;
    const H = p.layers[0].height;
    const boxes = s.trays.filter((t) => t.wellId === g0.id);
    expect(boxes.map((b) => b.height)).toEqual([(H - 2 * T) / 2, (H - 2 * T) / 2]);
    const top = Math.max(...buildScene(p, s).trays.flatMap((t) => (t.level === 1 ? t.blocks : [])).map((b) => b.z + b.h));
    expect(top).toBeCloseTo(H, 6);
    const g = s.compartments.find((c) => c.label === 'G')!;
    const most = maxPad(g.fullHeight, T, 2);
    g.node.pad = most + 1;
    s = solveProject(p);
    const err = s.compartments.find((c) => c.label === 'G')!.issues.find((i) => i.level === 'error');
    expect(err?.message).toMatch(/too little height for the stacked boxes.*Remove 1 layer/);
  });
});

describe('box too shallow', () => {
  it('reports on the compartment instead of building a box, with the layer height needed', () => {
    const p = defaultProject();
    const g = solveProject(p).compartments.find((c) => c.label === 'G')!;
    p.layers[0].height = 12;
    let s = solveProject(p);
    expect(s.trays.some((t) => t.wellId === g.id)).toBe(false);
    const err = s.compartments.find((c) => c.label === 'G')!.issues.find((i) => i.level === 'error');
    expect(err?.message).toMatch(/Too shallow for a box: the layer needs to be at least 15 mm tall/);
    p.layers[0].height = 15;
    s = solveProject(p);
    expect(s.trays.some((t) => t.wellId === g.id)).toBe(true);
    expect(s.compartments.find((c) => c.label === 'G')!.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('notch size override', () => {
  it('cuts a compartment\'s notches at its own size and keeps them a separate cut', () => {
    const p = defaultProject();
    const a = solveProject(p).compartments.find((c) => c.label === 'A')!;
    a.node.notchSize = { width: 20, depth: 10 };
    const s = solveProject(p);
    const A = s.compartments.find((c) => c.label === 'A')!;
    const back = s.pieces.find((x) => x.id === A.bounds.back)!;
    const mine = back.notches.find((n) => Math.abs(n.center - (A.rect.x + A.rect.w / 2 - back.start)) < 1e-6)!;
    expect(mine).toMatchObject({ width: 20, depth: 10, custom: true });
    // B's notch on the same wall keeps the project size.
    const others = back.notches.filter((n) => n !== mine);
    expect(others.every((n) => n.width === p.notch.width && !n.custom)).toBe(true);
    const before = buildCutList(solveProject(defaultProject()), p.precision).groups.length;
    expect(buildCutList(s, p.precision).groups.length).toBeGreaterThanOrEqual(before);
  });
});

describe('readme markdown', () => {
  it('renders Markdown, including tables, and escapes raw HTML and unsafe links', async () => {
    const { renderMarkdown } = await import('./markdown');
    const html = renderMarkdown('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](https://example.com)');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/href="javascript:/);
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>');
  });
});
