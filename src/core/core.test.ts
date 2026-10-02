import { describe, expect, it } from 'vitest';
import { trayInstructions } from './assembly';
import { labelFor, migrateProject, newLayer, newSection } from './defaults';
import { blankProject, doomExample } from './fixtures';
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
    const p = doomExample();
    p.layers.forEach((l) => clearNotches(l.root));
    expect(summary(p, 1)).toEqual(['1× 285x285', '2× 285x28', '3× 275x28', '1× 167x28', '6× 103x28', '1× 45x28', '3× 28x28']);
  });

  it('accounts for board thickness in every compartment', () => {
    const p = doomExample();
    const s = solveProject(p);
    const top = s.layers[1];
    const widths = top.compartments.filter((c) => c.rect.y < 50).map((c) => c.rect.w);
    // 49 + 5 + 49 in the left column, then the 167 mm tile compartment.
    expect(widths).toEqual([49, 49, 167]);
    for (const c of s.compartments) expect(c.rect.w).toBeGreaterThan(0);
  });

  it('builds walls on the base or around it', () => {
    const p = doomExample();
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
    const p = doomExample();
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
    const p = doomExample();
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
    const p = doomExample();
    const s = solveProject(p);
    const a = s.compartments.find((c) => c.label === 'A')!;
    const back = s.pieces.find((x) => x.id === a.bounds.back)!;
    expect(back.role).toBe('back wall');
    expect(back.notches).toHaveLength(2);
    expect(back.notches[0].center).toBeCloseTo(a.rect.x + a.rect.w / 2 - back.start, 6);
    expect(back.notches[0].width).toBe(30);
  });

  it('flags layers taller than the box', () => {
    const p = doomExample();
    p.layers[0].height = 80;
    expect(solveProject(p).issues.some((i) => i.level === 'error')).toBe(true);
  });
});

describe('cut list', () => {
  it('groups mirror-image notched pieces together', () => {
    const p = doomExample();
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
    const p = doomExample();
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
    const p = doomExample();
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
    const p = doomExample();
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
    const p = doomExample();
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
    const p = doomExample();
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
    const p = doomExample();
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
    const p = doomExample();
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
    expect(steps[steps.length - 1].text).toMatch(/^Drop the box into compartment G/);
  });
});

describe('new project', () => {
  it('starts with one empty tray and keeps box and material settings', () => {
    const from = doomExample();
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
    expect(planCuts({ ...p, material: { ...p.material, layout: 'fewest' } }, buildCutList(s, p.precision)).sheets).toHaveLength(1);
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
    const p = doomExample();
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
    expect(steps[steps.length - 1].strong).toBe('Make a second, identical box.');
    expect(steps[steps.length - 1].text).toMatch(/^Stack both in compartment G/);
  });
});

describe('shared notches', () => {
  it('shows a divider notch from both sides and removes it from either side', async () => {
    const { hasNotch, notchSharedWith, toggleNotch } = await import('./notches');
    const p = doomExample();
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
    const p = doomExample();
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
    const old = JSON.parse(JSON.stringify(doomExample()));
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
    const p = doomExample();
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

  it('draws layer trays grey, and keeps box colours distinct and stable when another box is added', async () => {
    const { buildScene, LAYER_TRAY_COLOR } = await import('./scene');
    const p = doomExample();
    const colors = new Map<string, number>();
    const before = new Map(buildScene(p, solveProject(p), colors).trays.map((t) => [t.key, t.color]));
    const g = solveProject(p).compartments.find((c) => c.label === 'G')!;
    setStacked(g.node, true);
    const after = buildScene(p, solveProject(p), colors).trays;
    for (const t of after) if (before.has(t.key)) expect(t.color).toBe(before.get(t.key));
    expect(after.filter((t) => t.depth === 0).every((t) => t.color === LAYER_TRAY_COLOR)).toBe(true);
    const boxes = after.filter((t) => t.depth === 1);
    expect(boxes.length).toBeGreaterThan(1);
    expect(new Set([...boxes.map((t) => t.color), LAYER_TRAY_COLOR]).size).toBe(boxes.length + 1);
  });

  it('gives trays keys that survive unrelated edits', async () => {
    const { buildScene } = await import('./scene');
    const p = doomExample();
    const before = buildScene(p, solveProject(p)).trays.map((t) => t.key);
    p.box.width = 300;
    p.layers[0].height = 50;
    expect(buildScene(p, solveProject(p)).trays.map((t) => t.key)).toEqual(before);
  });
});

describe('raised floors', () => {
  async function padded(layers: number, label = 'S') {
    const { setPad } = await import('./edit');
    const p = doomExample();
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
    const p0 = doomExample();
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
    const p = doomExample();
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
    const p = doomExample();
    const a = solveProject(p).compartments.find((c) => c.label === 'A')!;
    a.node.notchSize = { width: 20, depth: 10 };
    const s = solveProject(p);
    const A = s.compartments.find((c) => c.label === 'A')!;
    const back = s.pieces.find((x) => x.id === A.bounds.back)!;
    const mine = back.notches.find((n) => Math.abs(n.center - (A.rect.x + A.rect.w / 2 - back.start)) < 1e-6)!;
    expect(mine).toMatchObject({ width: 20, depth: 10, custom: true });
    const front = s.pieces.find((piece) => piece.id === A.bounds.front)!;
    expect(front.notches.some((notch) => notch.width === 20 && notch.depth === 10 && notch.custom)).toBe(true);
    // B's notch on the same wall keeps the project size.
    const others = back.notches.filter((n) => n !== mine);
    expect(others.every((n) => n.width === p.notch.width && !n.custom)).toBe(true);
    const before = buildCutList(solveProject(doomExample()), p.precision).groups.length;
    expect(buildCutList(s, p.precision).groups.length).toBeGreaterThanOrEqual(before);
  });

  it('uses the custom size and shape only on the selected notched sides', () => {
    const p = blankProject();
    const section = solveProject(p).compartments[0]!.node;
    section.notches = ['back', 'front', 'left', 'right'];
    section.notchSize = { width: 20, depth: 8, bottom: 25, sides: ['back', 'right'] };
    const saved = migrateProject(JSON.parse(JSON.stringify(p)))!;
    const s = solveProject(saved);
    const c = s.compartments[0]!;
    for (const side of section.notches) {
      const piece = s.pieces.find((piece) => piece.id === c.bounds[side])!;
      expect(piece.notches).toHaveLength(1);
      const notch = piece.notches[0]!;
      if (side === 'back' || side === 'right') expect(notch).toMatchObject({ width: 20, depth: 8, bottom: 5, custom: true });
      else {
        expect(notch).toMatchObject({ width: p.notch.width, depth: p.notch.depth, bottom: p.notch.width / 2 });
        expect(notch.custom).toBeUndefined();
      }
    }
    // A front/back pair no longer shares a cut group when only one side is overridden.
    const cut = buildCutList(s, p.precision);
    expect(cut.groupOf.get(c.bounds.back)).not.toBe(cut.groupOf.get(c.bounds.front));
  });

  it('switches individual sides back to the default, including older overrides with no side selection', async () => {
    const { setNotchOverrideSide } = await import('./edit');
    const p = blankProject();
    const section = solveProject(p).compartments[0]!.node;
    section.notches = ['back', 'front'];
    section.notchSize = { width: 20, depth: 8, bottom: 25 };
    setNotchOverrideSide(section, 'front', false);
    expect(section.notchSize.sides).toEqual(['back']);
    let s = solveProject(p);
    let c = s.compartments[0]!;
    expect(s.pieces.find((piece) => piece.id === c.bounds.back)!.notches[0]!.custom).toBe(true);
    expect(s.pieces.find((piece) => piece.id === c.bounds.front)!.notches[0]!.custom).toBeUndefined();
    setNotchOverrideSide(section, 'back', false);
    expect(section.notchSize.sides).toEqual([]);
    s = solveProject(p);
    expect(s.pieces.flatMap((piece) => piece.notches).every((notch) => notch.width === p.notch.width && !notch.custom)).toBe(true);
    // An added notch uses the project settings until its side is selected explicitly.
    section.notches.push('left');
    setNotchOverrideSide(section, 'front', true);
    setNotchOverrideSide(section, 'front', true);
    expect(section.notchSize.sides).toEqual(['front']);
    s = solveProject(p);
    c = s.compartments[0]!;
    expect(s.pieces.find((piece) => piece.id === c.bounds.front)!.notches[0]!.custom).toBe(true);
    expect(s.pieces.find((piece) => piece.id === c.bounds.left)!.notches[0]!.custom).toBeUndefined();
  });

  it('keeps selected divider overrides shared with the neighbouring compartment', async () => {
    const { hasNotch, notchSharedWith, toggleNotch } = await import('./notches');
    const p = blankProject();
    const layer = p.layers[0]!;
    splitSection(layer, layer.root.id, 'row', 5);
    let s = solveProject(p);
    const left = s.compartments[0]!;
    left.node.notches = ['right', 'back'];
    left.node.notchSize = { width: 20, depth: 8, sides: ['right'] };
    s = solveProject(p);
    const right = s.compartments[1]!;
    expect(hasNotch(s, right, 'left')).toBe(true);
    expect(notchSharedWith(s, right, 'left')).toEqual([left.label]);
    const divider = s.pieces.find((piece) => piece.id === right.bounds.left)!;
    expect(divider.notches[0]).toMatchObject({ width: 20, depth: 8, custom: true });
    const back = s.pieces.find((piece) => piece.id === left.bounds.back)!;
    expect(back.notches[0]!.custom).toBeUndefined();
    toggleNotch(s, right, 'left');
    expect(hasNotch(solveProject(p), solveProject(p).compartments[1]!, 'left')).toBe(false);
  });

  it('copies only the selected custom notches to the upper box of a stack', () => {
    const p = doomExample();
    const host = solveProject(p).compartments.find((c) => c.node.insert)!;
    setStacked(host.node, true);
    const inner = solveProject(p).compartments.find((c) => c.wellId === host.id)!;
    inner.node.notches = ['back', 'front'];
    inner.node.notchSize = { width: 18, depth: 7, bottom: 0, sides: ['front'] };
    const s = solveProject(p);
    const c = s.compartments.find((c) => c.id === inner.id)!;
    const lower = s.trays.find((tray) => tray.id === c.trayId)!;
    const upper = s.trays.find((tray) => tray.copyOf === lower.id)!;
    const cut = buildCutList(s, p.precision);
    for (const side of inner.node.notches) {
      const piece = s.pieces.find((piece) => piece.id === c.bounds[side])!;
      const twin = s.pieces.find((twin) => twin.trayId === upper.id && twin.order === piece.order)!;
      expect(twin.notches).toEqual(piece.notches);
      expect(cut.groupOf.get(twin.id)).toBe(cut.groupOf.get(piece.id));
      expect(piece.notches[0]!.custom).toBe(side === 'front' ? true : undefined);
    }
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

describe('card direction arrow placement', () => {
  it('sits beside the letter when there is room, above it in narrow tall slots', async () => {
    const { labelLayout } = await import('../lib/itemArrow');
    const wide = labelLayout({ x: 0, y: 0, w: 100, h: 60 }, 20, 1, true);
    expect(wide.size).toBe(20);
    expect(wide.arrow!.x).toBeGreaterThan(wide.letterX);
    expect(wide.arrow!.y).toBeCloseTo(30 - 20 * 0.12, 6);
    const narrow = labelLayout({ x: 0, y: 0, w: 24, h: 120 }, 20, 2, true);
    expect(narrow.arrow!.x).toBeCloseTo(narrow.letterX, 6);
    expect(narrow.arrow!.y).toBeLessThan(60 - narrow.size * 0.12);
    const none = labelLayout({ x: 0, y: 0, w: 100, h: 60 }, 20, 1, false);
    expect(none.arrow).toBeUndefined();
    expect(none.letterX).toBe(50);
  });
});

describe('item simulation', () => {
  it('counts items standing in a row along the arrow, leaving the free space', async () => {
    const { fitItems } = await import('./items');
    const c = { rect: { x: 0, y: 0, w: 70, h: 100 }, height: 90 };
    const cards = fitItems(c, 'front', { on: true, shape: 'box', width: 66, height: 91, thickness: 0.6, spare: 10 });
    expect(cards.along).toBe(100);
    expect(cards.count).toBe(150);
    expect(cards.used).toBeCloseTo(90, 6);
    expect(cards.left).toBeCloseTo(10, 6);
    expect(cards.warnings).toEqual(['The items stand 1 mm above the walls (the slot is 90 mm deep).']);
    const discs = fitItems(c, 'right', { on: true, shape: 'cylinder', width: 25, height: 999, thickness: 3, spare: 0 });
    expect(discs.along).toBe(70);
    expect(discs.count).toBe(23);
    expect(discs.faceH).toBe(25);
    expect(discs.warnings).toEqual([]);
    expect(fitItems(c, 'back', { on: true, shape: 'box', width: 80, height: 10, thickness: 5, spare: 120 }).warnings).toEqual([
      'The items are 10 mm wider than the slot (70 mm).',
      'The free space is longer than the slot.',
    ]);
  });
});

describe('item simulation in 3D', () => {
  it('stands items from the arrow tail toward its head, centred across, on the raised floor, clear of every piece', async () => {
    const { buildScene, overlap } = await import('./scene');
    const { setPad } = await import('./edit');
    const p = doomExample();
    const T = p.material.thickness;
    const a0 = solveProject(p).compartments.find((c) => c.label === 'A')!;
    setPad(a0.node, 2);
    const a1 = solveProject(p).compartments.find((c) => c.label === 'A')!;
    a0.node.arrow = 'front';
    a0.node.items = { on: true, shape: 'box', width: a1.rect.w - 4, height: a1.height - 5, thickness: 0.6125, spare: 10 };
    let s = solveProject(p);
    const a = s.compartments.find((c) => c.label === 'A')!;
    let model = buildScene(p, s);
    const tray = model.trays.find((t) => t.id === a.trayId)!;
    const row = tray.items.find((r) => r.compartmentId === a.id)!;
    expect(row.fits).toBe(true);
    expect(row.axis).toBe('y');
    expect(row.items).toHaveLength(Math.floor((a.rect.h - 10) / 0.6125));
    expect(row.items[0].y).toBeCloseTo(a.rect.y, 6);
    const last = row.items[row.items.length - 1];
    expect(last.y + last.d).toBeLessThanOrEqual(a.rect.y + a.rect.h - 10 + 1e-6);
    expect(row.items[0].x + row.items[0].w / 2).toBeCloseTo(a.rect.x + a.rect.w / 2, 6);
    expect(row.items[0].z).toBeCloseTo(T + 2 * T, 6);
    const blocks = model.trays.flatMap((t) => t.blocks);
    for (const it of row.items) for (const b of blocks) expect(overlap(it as never, b)).toBeLessThan(1e-6);

    // Pointing back: the row starts at the front.
    a.node.arrow = 'back';
    model = buildScene(p, solveProject(p));
    const back = model.trays.flatMap((t) => t.items).find((r) => r.compartmentId === a.id)!;
    expect(back.items[0].y + back.items[0].d).toBeCloseTo(a.rect.y + a.rect.h, 6);

    // Switched off, or with no arrow: nothing to draw.
    a.node.items!.on = false;
    s = solveProject(p);
    expect(buildScene(p, s).trays.flatMap((t) => t.items)).toEqual([]);
  });

  it('fills both boxes of a stack and skips a compartment that holds a box', async () => {
    const { buildScene } = await import('./scene');
    const p = doomExample();
    const g = solveProject(p).compartments.find((c) => c.label === 'G')!;
    setStacked(g.node, true);
    const g1 = solveProject(p).compartments.find((c) => c.label === 'G1')!;
    g1.node.arrow = 'right';
    g1.node.items = { on: true, shape: 'cylinder', width: 10, height: 0, thickness: 3, spare: 0 };
    g.node.arrow = 'left';
    g.node.items = { on: true, shape: 'box', width: 10, height: 10, thickness: 1, spare: 0 };
    const s = solveProject(p);
    const rows = buildScene(p, s).trays.flatMap((t) => t.items.map((r) => ({ tray: t, r })));
    expect(rows.map((x) => x.r.compartmentId)).toEqual([g1.id, g1.id]);
    const [lower, upper] = rows.sort((x, y) => x.tray.level - y.tray.level);
    const box = s.trays.find((t) => t.wellId === g.id && !t.copyOf)!;
    expect(upper.r.items[0].z - lower.r.items[0].z).toBeCloseTo(box.height, 6);
    expect(lower.r.items[0].h).toBe(10);
    expect(lower.r.items[0].x).toBeCloseTo(s.compartments.find((c) => c.id === g1.id)!.rect.x, 6);
  });
});

describe('separate construction', () => {
  it('makes every top-level compartment its own tray and back, leaving removable boxes alone', async () => {
    const { setConstruction, splitJoin } = await import('./edit');
    const p = doomExample();
    const before = solveProject(p);
    const boxDividers = (s: ReturnType<typeof solveProject>) => s.pieces.filter((x) => x.depth === 1 && x.kind === 'divider').length;
    setConstruction(p, 'separate');
    expect(p.construction).toBe('separate');
    const s = solveProject(p);
    expect(s.compartments.map((c) => c.label)).toEqual(before.compartments.map((c) => c.label));
    expect(s.trays.filter((t) => t.depth === 0)).toHaveLength(s.compartments.filter((c) => c.depth === 0).length);
    expect(s.pieces.filter((x) => x.depth === 0 && x.kind === 'divider')).toEqual([]);
    expect(boxDividers(s)).toBe(boxDividers(before));
    expect(boxDividers(s)).toBeGreaterThan(0);

    // A compartment keeps its inside size where it was locked: the tray's outside grows by its walls.
    const lockedBefore = before.compartments.find((c) => c.label === 'A')!;
    expect(s.compartments.find((c) => c.label === 'A')!.rect.w).toBeCloseTo(lockedBefore.rect.w, 6);

    // New splits at the top level make another tray; inside a removable box they stay dividers.
    const a = s.compartments.find((c) => c.label === 'A')!;
    const layer = p.layers.find((l) => l.id === a.layerId)!;
    expect(splitJoin(p, layer, a.id)).toBe('trays');
    splitSection(layer, a.id, 'column', p.clearance, 'trays');
    expect(solveProject(p).trays.filter((t) => t.depth === 0)).toHaveLength(s.trays.filter((t) => t.depth === 0).length + 1);
    const g1 = s.compartments.find((c) => c.label === 'G1')!;
    expect(splitJoin(p, layer, g1.id)).toBe('divider');
    expect(splitJoin({ ...p, construction: undefined }, layer, a.id)).toBe('divider');

    setConstruction(p, 'glued');
    expect(p.construction).toBeUndefined();
    const back = solveProject(p);
    expect(back.trays.filter((t) => t.depth === 0)).toHaveLength(p.layers.length);
    expect(back.compartments.find((c) => c.label === 'B')!.rect.w).toBeCloseTo(before.compartments.find((c) => c.label === 'B')!.rect.w, 6);
  });

  it('places every separate tray and the boxes inside them without overlaps', async () => {
    const { setConstruction } = await import('./edit');
    const { buildScene, overlap } = await import('./scene');
    const p = doomExample();
    setConstruction(p, 'separate');
    const s = solveProject(p);
    const blocks = buildScene(p, s).trays.flatMap((t) => t.blocks);
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i], blocks[j])).toBeLessThan(1e-6);
    for (const b of blocks) {
      expect(b.x).toBeGreaterThanOrEqual(-1e-6);
      expect(b.x + b.w).toBeLessThanOrEqual(p.box.width + 1e-6);
      expect(b.y + b.d).toBeLessThanOrEqual(p.box.depth + 1e-6);
    }
  });
});

describe('secondary material', () => {
  async function thinBase() {
    const { setLayerBaseSecondary, setSecondaryThickness } = await import('./edit');
    const p = doomExample();
    const before = solveProject(p);
    const heights = p.layers.map((l) => l.height);
    setSecondaryThickness(p, 3);
    setLayerBaseSecondary(p, true);
    return { p, before, heights, s: solveProject(p), setLayerBaseSecondary, setSecondaryThickness };
  }

  it('migrates saved base thickness without changing heights or removable boxes', () => {
    const old = JSON.parse(JSON.stringify(doomExample()));
    old.material.baseThickness = 3;
    old.layers.forEach((layer: { height: number }) => layer.height -= 2);
    const heights = old.layers.map((layer: { height: number }) => layer.height);
    const p = migrateProject(old)!;
    expect(p.material.secondaryThickness).toBe(3);
    expect(p.secondaryBase).toBe(true);
    expect('baseThickness' in p.material).toBe(false);
    expect(p.layers.map((l) => l.height)).toEqual(heights);
    const s = solveProject(p);
    expect(s.trays.filter((t) => t.depth === 0).every((t) => t.base === 3)).toBe(true);
    expect(s.trays.filter((t) => t.depth === 1).every((t) => t.base === 5)).toBe(true);
    expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('makes material available without applying it and falls back when it is disabled', async () => {
    const { setSecondaryThickness, setLayerBaseSecondary, setInsertBaseSecondary } = await import('./edit');
    const p = doomExample();
    const original = solveProject(p);
    const heights = p.layers.map((l) => l.height);
    setSecondaryThickness(p, 3);
    expect(solveProject(p)).toEqual(original);
    const host = original.compartments.find((c) => c.node.insert)!;
    setLayerBaseSecondary(p, true);
    setInsertBaseSecondary(host.node, true);
    const before = solveProject(p);
    setSecondaryThickness(p, 2);
    expect(p.layers.map((l) => l.height)).toEqual(heights.map((h) => h - 3));
    const after = solveProject(p);
    for (const c of after.compartments) {
      const previous = before.compartments.find((x) => x.id === c.id)!;
      expect(c.height).toBeCloseTo(previous.height + (c.depth === 1 ? 1 : 0), 6);
    }
    setSecondaryThickness(p, undefined);
    const restored = solveProject(p);
    expect(p.layers.map((l) => l.height)).toEqual(heights);
    expect(restored.pieces.every((piece) => piece.material === 'primary' && piece.thickness === 5)).toBe(true);
    for (const c of restored.compartments) expect(c.height).toBe(original.compartments.find((x) => x.id === c.id)!.height);
    // Material choices remain available when the secondary material is enabled again.
    setSecondaryThickness(p, 3);
    expect(solveProject(p).pieces.some((piece) => piece.depth === 1 && piece.material === 'secondary')).toBe(true);
  });

  it('gives full-height, stacked and half-height boxes more space while keeping their total heights and 3D placement', async () => {
    const { setSecondaryThickness, setInsertBaseSecondary, setEmptyAbove, setPad, setConstruction } = await import('./edit');
    const { buildScene, overlap } = await import('./scene');
    for (const construction of ['glued', 'separate'] as const) {
      for (const base of ['under', 'inside'] as const) {
        for (const mode of ['single', 'multiple'] as const) {
          for (const stack of ['full', 'pair', 'empty'] as const) {
            const p = doomExample();
            p.base = base;
            setConstruction(p, construction);
            setSecondaryThickness(p, 3);
            const host = solveProject(p).compartments.find((c) => c.node.insert)!;
            setPad(host.node, 1);
            setStacked(host.node, stack !== 'full');
            setEmptyAbove(host.node, stack === 'empty');
            const root = host.node.insert!.root;
            if (root.kind !== 'split') throw new Error('Expected divided removable box');
            setJoin(p.layers[0], root, mode === 'multiple' ? 'trays' : 'divider', 5);
            const before = solveProject(p);
            setInsertBaseSecondary(host.node, true);
            const s = solveProject(p);
            expect(s.headroom).toBe(before.headroom);
            expect(s.compartments.flatMap((c) => c.issues).filter((i) => i.level === 'error')).toEqual([]);
            const boxes = s.trays.filter((t) => t.depth === 1);
            expect(boxes).toHaveLength((mode === 'multiple' ? 2 : 1) * (stack === 'pair' ? 2 : 1));
            for (const box of boxes) {
              const previous = before.trays.find((t) => t.id === box.id)!;
              expect(box.height).toBe(previous.height);
              expect(box.base).toBe(3);
              expect(box.wallHeight).toBe(previous.wallHeight + (base === 'under' ? 2 : 0));
            }
            for (const c of s.compartments.filter((c) => c.depth === 1)) expect(c.height).toBe(before.compartments.find((x) => x.id === c.id)!.height + 2);
            expect(s.pieces.filter((piece) => piece.material === 'secondary').every((piece) => piece.kind === 'base' && piece.depth === 1 && piece.thickness === 3)).toBe(true);
            expect(s.pieces.filter((piece) => piece.kind !== 'base').every((piece) => piece.material === 'primary' && piece.thickness === 5)).toBe(true);
            const scene = buildScene(p, s);
            const blocks = scene.trays.flatMap((t) => t.blocks);
            for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i], blocks[j])).toBeLessThan(1e-6);
            const boxTop = Math.max(...scene.trays.filter((t) => t.depth === 1).flatMap((t) => t.blocks.map((b) => b.z + b.h)));
            const well = s.compartments.find((c) => c.id === host.id)!;
            expect(boxTop).toBeCloseTo(p.layers[0].height - (stack === 'empty' ? well.height / 2 : 0), 6);
            const cut = buildCutList(s, p.precision);
            expect(trayInstructions(p, s, cut, boxes[0]!)[0]!.text).toContain('secondary material (3 mm)');
          }
        }
      }
    }
  });

  it('uses thinner box bases for minimum height and raised-floor limits', async () => {
    const { setSecondaryThickness, setInsertBaseSecondary, setPad } = await import('./edit');
    const { maxPad } = await import('./layout');
    const p = blankProject();
    const layer = p.layers[0];
    layer.height = 21;
    setInsert(layer, layer.root.id, true);
    const host = solveProject(p).compartments[0]!.node;
    setStacked(host, true);
    setSecondaryThickness(p, 3);
    setInsertBaseSecondary(host, true);
    let s = solveProject(p);
    expect(s.trays.filter((t) => t.depth === 1)).toHaveLength(2);
    expect(s.compartments.filter((c) => c.depth === 1).every((c) => c.height === 5)).toBe(true);
    setInsertBaseSecondary(host, false);
    s = solveProject(p);
    expect(s.trays.filter((t) => t.depth === 1)).toHaveLength(0);
    expect(s.compartments[0]!.issues[0]!.message).toContain('at least 25 mm tall');
    setInsertBaseSecondary(host, true);
    layer.height = 26;
    setPad(host, 1);
    s = solveProject(p);
    expect(maxPad(s.compartments[0]!.fullHeight, 5, 2, 3)).toBe(1);
    expect(s.trays.filter((t) => t.depth === 1)).toHaveLength(2);
    expect(s.compartments.flatMap((c) => c.issues).filter((i) => i.level === 'error')).toEqual([]);
    setPad(host, 2);
    s = solveProject(p);
    expect(s.trays.filter((t) => t.depth === 1)).toHaveLength(0);
    expect(s.compartments[0]!.issues[0]!.message).toContain('Remove 1 layer');
  });

  it('keeps primary and secondary pieces and cutting sheets distinct even at the same thickness', async () => {
    const { setSecondaryThickness, setInsertBaseSecondary } = await import('./edit');
    const p = blankProject();
    const layer = p.layers[0];
    splitSection(layer, layer.root.id, 'row', 5);
    const hosts = solveProject(p).compartments;
    hosts.forEach((host) => setInsert(layer, host.id, true));
    setSecondaryThickness(p, 5);
    setInsertBaseSecondary(hosts[0]!.node, true);
    const s = solveProject(p);
    const bases = s.pieces.filter((piece) => piece.depth === 1 && piece.kind === 'base');
    expect(bases).toHaveLength(2);
    expect(bases[0]!.length).toBe(bases[1]!.length);
    const cut = buildCutList(s, p.precision);
    expect(cut.groupOf.get(bases[0]!.id)).not.toBe(cut.groupOf.get(bases[1]!.id));
    for (const layout of ['fewest', 'guillotine', 'strips'] as const) {
      const plan = planCuts({ ...p, material: { ...p.material, layout } }, cut);
      expect(plan.counts.map((c) => c.material)).toEqual(['secondary', 'primary']);
      for (const sheet of plan.sheets) for (const item of sheet.items) {
        const groups = item.group ? [item.group] : item.strip!.cuts.map((part) => cut.groups.find((g) => g.number === part.group)!);
        expect(groups.every((g) => g.material === sheet.material && g.thickness === sheet.thickness)).toBe(true);
      }
    }
  });

  it('cuts only the layer bases from the other thickness, and moves layer heights so compartments keep their depth', async () => {
    const { p, before, heights, s, setLayerBaseSecondary } = await thinBase();
    const T = p.material.thickness;
    expect(p.layers.map((l) => l.height)).toEqual(heights.map((h) => h - 2));
    expect(s.headroom).toBeCloseTo(before.headroom + 2 * p.layers.length, 6);
    for (const c of s.compartments) expect(c.height).toBeCloseTo(before.compartments.find((x) => x.id === c.id)!.height, 6);
    const bases = s.pieces.filter((x) => x.kind === 'base');
    expect(bases.filter((x) => x.depth === 0).every((x) => x.thickness === 3)).toBe(true);
    expect(bases.filter((x) => x.depth === 1).every((x) => x.thickness === T)).toBe(true);
    expect(s.pieces.filter((x) => x.kind !== 'base').every((x) => x.thickness === T)).toBe(true);
    // Walls on the base are one base shorter than the layer; the tray's dividers too.
    for (const t of s.trays.filter((x) => x.depth === 0)) {
      const layer = p.layers.find((l) => l.id === t.layerId)!;
      expect(t.base).toBe(3);
      expect(t.wallHeight).toBeCloseTo(layer.height - 3, 6);
    }
    setLayerBaseSecondary(p, false);
    expect(p.secondaryBase).toBeUndefined();
    expect(p.material.secondaryThickness).toBe(3);
    expect(p.layers.map((l) => l.height)).toEqual(heights);
  });

  it('lists and plans the bases on their own sheets, and says so in the assembly steps', async () => {
    const { p, s } = await thinBase();
    const { sheetSummary } = await import('./pieces');
    const cut = buildCutList(s, p.precision);
    const thin = cut.groups.filter((g) => g.thickness === 3);
    expect(thin.length).toBeGreaterThan(0);
    expect(thin.every((g) => g.kind === 'base' && g.pieces.every((x) => x.kind === 'base' && x.depth === 0))).toBe(true);
    // Numbered first, so they read as one block.
    expect(thin.map((g) => g.number)).toEqual(thin.map((_, i) => i + 1));
    const plan = planCuts(p, cut);
    expect(plan.counts.map((c) => c.thickness)).toEqual([3, 5]);
    for (const sheet of plan.sheets) {
      for (const item of sheet.items) {
        const t = item.group?.thickness ?? cut.groups.find((g) => g.number === item.strip!.cuts[0].group)!.thickness;
        expect(t).toBe(sheet.thickness);
      }
    }
    expect(sheetSummary(p, plan)).toMatch(/^\d+ × 3 mm secondary \+ \d+ × 5 mm primary A2 sheets$/);
    const tray = s.trays.find((t) => t.depth === 0)!;
    expect(trayInstructions(p, s, cut, tray)[0].text).toContain('cut from secondary material (3 mm)');
    const box = s.trays.find((t) => t.depth === 1)!;
    expect(trayInstructions(p, s, cut, box)[0].text).toBe(`Start with base #${cut.groupOf.get(s.pieces.find((x) => x.trayId === box.id && x.kind === 'base')!.id)!.number}, cut from primary material (5 mm).`);
  });

  it('stacks everything in 3D without overlaps, walls standing on the thinner base', async () => {
    const { p } = await thinBase();
    const { setPad, setConstruction } = await import('./edit');
    const { buildScene, overlap } = await import('./scene');
    const g = solveProject(p).compartments.find((c) => c.label === 'G')!;
    setPad(g.node, 1);
    setStacked(g.node, true);
    for (const construction of ['glued', 'separate'] as const) {
      for (const base of ['under', 'inside'] as const) {
        setConstruction(p, construction);
        p.base = base;
        const s = solveProject(p);
        const model = buildScene(p, s);
        const blocks = model.trays.flatMap((t) => t.blocks);
        for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i], blocks[j])).toBeLessThan(1e-6);
        // Each tray's tallest piece reaches exactly the top of its layer.
        let z = 0;
        for (const layer of p.layers) {
          const top = Math.max(...model.trays.filter((t) => t.layerId === layer.id && t.depth === 0).flatMap((t) => t.blocks.map((b) => b.z + b.h)));
          expect(top).toBeCloseTo(z + layer.height, 6);
          z += layer.height;
        }
        const baseBlocks = model.trays.filter((t) => t.depth === 0).flatMap((t) => t.blocks.filter((b) => b.kind === 'base'));
        expect(baseBlocks.every((b) => b.h === 3)).toBe(true);
      }
    }
  });
});

describe('lowered sides', () => {
  /** Two identical layers, each split into a left and a right compartment. */
  function twoByTwo() {
    const p = blankProject();
    p.layers = [newLayer('Bottom', 34), newLayer('Top', 34)];
    for (const layer of p.layers) splitSection(layer, layer.root.id, 'row', p.material.thickness);
    const s = solveProject(p);
    const pair = (i: number) => s.compartments.filter((c) => c.layerId === p.layers[i].id).sort((a, b) => a.rect.x - b.rect.x);
    return { p, s, pair };
  }

  it('lowers a divider along its whole length to a rounded share of the depth, shared with the compartment across', async () => {
    const { hasLow, lowSharedWith, toggleLow } = await import('./notches');
    const { p, s, pair } = twoByTwo();
    const [left, right] = pair(0);
    toggleLow(s, left, 'right');
    const s2 = solveProject(p);
    const divider = s2.pieces.find((x) => x.kind === 'divider' && x.layerId === p.layers[0].id)!;
    // 34 mm layer, 5 mm base: 29 mm deep; 75% is 21.75, rounded to the 0.5 mm step.
    expect(divider.height).toBe(22);
    expect(divider.cut).toBe(7);
    expect(divider.lows).toEqual([]);
    const r2 = s2.compartments.find((c) => c.id === right.id)!;
    expect(hasLow(s2, r2, 'left')).toBe(true);
    expect(lowSharedWith(s2, r2, 'left')).toEqual([left.label]);
    // Raising it from the other side takes the lowering away.
    toggleLow(s2, r2, 'left');
    expect(left.node.lowered).toBeUndefined();
    expect(solveProject(p).pieces.find((x) => x.id === divider.id)!.height).toBe(29);
  });

  it('cuts a step into a wall beside the compartment only, and groups mirror images as one cut size', async () => {
    const { p, pair } = twoByTwo();
    pair(0)[0].node.lowered = ['back'];
    pair(1)[1].node.lowered = ['back'];
    const s = solveProject(p);
    const backs = s.pieces.filter((x) => x.role === 'back wall');
    for (const [i, wall] of backs.entries()) {
      const c = pair(i)[i];
      expect(wall.lows).toHaveLength(1);
      expect(wall.lows[0].from).toBeCloseTo(c.rect.x - wall.start, 6);
      expect(wall.lows[0].to).toBeCloseTo(c.rect.x + c.rect.w - wall.start, 6);
      expect(wall.height - wall.lows[0].depth).toBe(22);
    }
    const cut = buildCutList(s, p.precision);
    const g = cut.groupOf.get(backs[0].id)!;
    expect(cut.groupOf.get(backs[1].id)).toBe(g);
    expect(g.pieces).toHaveLength(2);
    expect(g.lows).toHaveLength(1);
    // Front walls stay plain and full height.
    expect(s.pieces.filter((x) => x.role === 'front wall').every((x) => !x.lows.length && x.height === 29)).toBe(true);
    const tray = s.trays.find((t) => t.layerId === p.layers[0].id)!;
    // Edge cutting is completed before the walls are glued.
    expect(trayInstructions(p, s, cut, tray)[1].notes).toEqual([]);
    const { groupCutPatterns } = await import('./cutting');
    const marking = groupCutPatterns(g, 'lowered')[0]!;
    expect(marking.points[1]!.inward).toBe(7);
    expect(marking.points[2]!.inward).toBe(7);
  });

  it('never notches a lowered stretch', async () => {
    const { hasNotch } = await import('./notches');
    const { p, pair } = twoByTwo();
    const left = pair(0)[0];
    left.node.lowered = ['back'];
    left.node.notches = ['back'];
    const s = solveProject(p);
    const c = s.compartments.find((x) => x.id === left.id)!;
    expect(hasNotch(s, c, 'back')).toBe(false);
    expect(s.pieces.find((x) => x.role === 'back wall' && x.layerId === p.layers[0].id)!.notches).toEqual([]);
    expect(c.issues.map((i) => i.message)).toContain('The back side is lowered there, so it gets no finger notch.');
  });

  it('builds lowered pieces in 3D without overlaps', async () => {
    const { buildScene, overlap } = await import('./scene');
    const p = doomExample();
    for (const c of solveProject(p).compartments) if (!c.node.notches.length) c.node.lowered = ['left', 'front'];
    const s = solveProject(p);
    expect(s.pieces.some((x) => x.lows.length)).toBe(true);
    expect(s.pieces.some((x) => x.cut)).toBe(true);
    const blocks = buildScene(p, s).trays.flatMap((t) => t.blocks);
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i], blocks[j])).toBeLessThan(1e-6);
    expect(planCuts(p, buildCutList(s, p.precision)).issues).toEqual([]);
  });
});

describe('stacked box with the top left out', () => {
  it('builds only the lower half-height box and leaves the space above it empty', async () => {
    const { setEmptyAbove } = await import('./edit');
    const { buildScene, overlap } = await import('./scene');
    const p = doomExample();
    const g = solveProject(p).compartments.find((c) => c.label === 'G')!;
    setEmptyAbove(g.node, true);
    expect(g.node.insert!.emptyAbove).toBeUndefined();
    setStacked(g.node, true);
    const pair = solveProject(p);
    setEmptyAbove(g.node, true);
    const s = solveProject(p);
    const T = p.material.thickness;
    const H = p.layers[0].height;

    const boxes = s.trays.filter((t) => t.wellId === g.id);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].copyOf).toBeUndefined();
    expect(boxes[0].stacked).toBe(false);
    expect(boxes[0].emptyAbove).toBe(true);
    expect(boxes[0].height).toBe((H - T) / 2);
    // Same box as the lower one of the pair, and only half the pieces.
    const lowerOfPair = pair.trays.find((t) => t.wellId === g.id && !t.copyOf)!;
    const piecesOf = (sv: typeof s, id: string) => sv.pieces.filter((x) => x.trayId === id).map((x) => `${x.kind}:${x.length}x${x.height}`);
    expect(piecesOf(s, boxes[0].id)).toEqual(piecesOf(pair, lowerOfPair.id));
    expect(s.pieces.length).toBe(pair.pieces.length - piecesOf(pair, lowerOfPair.id).length);
    // Its compartments are in one box only: no ² and a half-height inside.
    const g1 = s.compartments.find((c) => c.label === 'G1')!;
    expect(g1.stacked).toBe(false);
    expect(g1.height).toBe((H - T) / 2 - T);

    const model = buildScene(p, s);
    const box = model.trays.find((t) => t.id === boxes[0].id)!;
    expect(box.label).toBe('Box in G, half height');
    expect(Math.max(...box.blocks.map((b) => b.z + b.h))).toBeCloseTo(T + (H - T) / 2, 6);
    const blocks = model.trays.flatMap((t) => t.blocks);
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i], blocks[j])).toBeLessThan(1e-6);

    const cut = buildCutList(s, p.precision);
    const steps = trayInstructions(p, s, cut, boxes[0]);
    expect(steps[steps.length - 1].text).toBe('Drop the box into compartment G. It is half as tall as the walls around it; the space above it stays empty.');

    // Unstacking clears it, so stacking again brings both boxes back.
    setStacked(g.node, false);
    expect(g.node.insert!.emptyAbove).toBeUndefined();
    setStacked(g.node, true);
    expect(solveProject(p).trays.filter((t) => t.wellId === g.id)).toHaveLength(2);
  });
});

describe('slanted finger notch', () => {
  it('is an opening with straight slants down to a flat bottom half as wide', async () => {
    const { notchCorners, notchSlant } = await import('./notches');
    expect(notchSlant(30, 15, 30)).toBe(90);
    expect(notchSlant(30, 15, 0)).toBeCloseTo(45, 6);
    expect(notchCorners(50, 30, 15, 15)).toEqual([
      [35, 0],
      [42.5, 15],
      [57.5, 15],
      [65, 0],
    ]);
  });
});

describe('notch flat bottom setting', () => {
  it('keeps its share when a notch is narrowed, joins overlapping notches by their outer slants, and splits cut sizes', async () => {
    const p = blankProject();
    p.layers = [newLayer('Only', 40)];
    const layer = p.layers[0];
    splitSection(layer, layer.root.id, 'row', p.material.thickness);
    p.notch = { width: 30, depth: 10, bottom: 20 };
    let s = solveProject(p);
    const [left, right] = s.compartments.sort((a, b) => a.rect.x - b.rect.x);
    left.node.notches = ['back'];
    s = solveProject(p);
    const back = () => s.pieces.find((x) => x.role === 'back wall')!;
    expect(back().notches).toEqual([expect.objectContaining({ width: 30, depth: 10, bottom: 6 })]);

    // A narrow compartment narrows the notch; the bottom stays 20% of it.
    left.node.notchSize = { width: 400, depth: 10, bottom: 50 };
    s = solveProject(p);
    const n = back().notches[0];
    expect(n.bottom).toBeCloseTo(n.width / 2, 6);
    delete left.node.notchSize;

    // A divider notched from both sides where the notches only partly overlap: one notch, running
    // from the outer slant of one to the outer slant of the other, with one flat bottom between.
    splitSection(layer, right.id, 'column', p.material.thickness);
    p.notch = { width: 150, depth: 10, bottom: 20 };
    s = solveProject(p);
    const [l2, r1] = [s.compartments.find((c) => c.id === left.id)!, s.compartments.find((c) => c.id === right.id)!];
    l2.node.notches = ['right'];
    r1.node.notches = ['left'];
    s = solveProject(p);
    const divider = s.pieces.find((x) => x.kind === 'divider' && x.axis === 'y')!;
    expect(divider.notchFrom).toHaveLength(2);
    expect(divider.notches).toHaveLength(1);
    const merged = divider.notches[0];
    const outerRuns = divider.notchFrom.map((f) => ((f.to - f.from) * 0.8) / 2).reduce((x, y) => x + y, 0);
    expect(merged.width).toBeCloseTo(Math.max(...divider.notchFrom.map((f) => f.to)) - Math.min(...divider.notchFrom.map((f) => f.from)), 6);
    expect(merged.bottom).toBeCloseTo(merged.width - outerRuns, 6);
    l2.node.notches = ['back'];
    r1.node.notches = [];

    // Same notch but another flat bottom is another cut size.
    right.node.notches = [];
    p.notch = { width: 30, depth: 10 };
    const a = buildCutList(solveProject(p), p.precision).groups.map((g) => g.key);
    p.notch = { width: 30, depth: 10, bottom: 80 };
    const b = buildCutList(solveProject(p), p.precision).groups.map((g) => g.key);
    expect(a).not.toEqual(b);
  });
});

describe('parts off the rounding step', () => {
  it('flags equal parts that miss the step, and rounds them with one part taking the rest', async () => {
    const { offStep, roundParts } = await import('./edit');
    const p = blankProject();
    p.layers = [newLayer('Only', 40)];
    const layer = p.layers[0];
    splitSection(layer, layer.root.id, 'row', p.material.thickness);
    const first = solveProject(p).compartments[0];
    splitSection(layer, first.id, 'row', p.material.thickness);
    const split = layer.root as Extract<LayoutNode, { kind: 'split' }>;
    distributeEqually(split);
    const sizes = () => solveProject(p).layers[0].splits.find((x) => x.id === split.id)!.childSizes;
    // 286 box less 1 mm clearance, 5 mm walls and two 5 mm dividers: 265 mm over three parts.
    expect(sizes().map((v) => Math.round(v * 100) / 100)).toEqual([88.33, 88.33, 88.33]);
    expect(sizes().every((v) => offStep(v, p.precision))).toBe(true);
    roundParts(split, sizes(), p.precision);
    expect(sizes()).toEqual([88.5, 88.5, 88]);
    expect(sizes().some((v) => offStep(v, p.precision))).toBe(false);
    expect(split.children.map((c) => c.size.mode)).toEqual(['fixed', 'fixed', 'flex']);
  });
});

describe('cutting layouts', () => {
  type R = { x: number; y: number; w: number; h: number };
  /** Can these rectangles be separated by straight cuts that always run all the way across? */
  function guillotine(rects: R[]): boolean {
    if (rects.length <= 1) return true;
    for (const axis of ['x', 'y'] as const) {
      const lo = (r: R) => (axis === 'x' ? r.x : r.y);
      const hi = (r: R) => lo(r) + (axis === 'x' ? r.w : r.h);
      for (const r of rects) {
        const c = hi(r);
        const before = rects.filter((o) => hi(o) <= c + 1e-6);
        const after = rects.filter((o) => lo(o) >= c - 1e-6);
        if (before.length && after.length && before.length + after.length === rects.length) return guillotine(before) && guillotine(after);
      }
    }
    return false;
  }

  async function plans() {
    const { setLayerBaseSecondary, setSecondaryThickness, setConstruction } = await import('./edit');
    const designs: Project[] = [];
    designs.push(doomExample());
    const thin = doomExample();
    setSecondaryThickness(thin, 3);
    setLayerBaseSecondary(thin, true);
    designs.push(thin);
    const separate = doomExample();
    setConstruction(separate, 'separate');
    designs.push(separate);
    return designs;
  }

  it('places every piece once, inside the trimmed sheet, without overlaps, in every layout', async () => {
    for (const base of await plans()) {
      const s = solveProject(base);
      const cut = buildCutList(s, base.precision);
      const pieces = cut.groups.reduce((n, g) => n + g.pieces.length, 0);
      for (const layout of ['fewest', 'guillotine', 'strips'] as const) {
        const p = { ...base, material: { ...base.material, layout } };
        const plan = planCuts(p, cut);
        expect(plan.issues).toEqual([]);
        const placed = plan.sheets.flatMap((sh) => sh.items).reduce((n, it) => n + (it.kind === 'base' ? 1 : it.strip!.cuts.length), 0);
        expect(placed).toBe(pieces);
        const { width, height } = p.material.sheet;
        const t = p.material.trim;
        for (const sheet of plan.sheets) {
          for (const [i, a] of sheet.items.entries()) {
            expect(a.x).toBeGreaterThanOrEqual(t - 1e-6);
            expect(a.y).toBeGreaterThanOrEqual(t - 1e-6);
            expect(a.x + a.w).toBeLessThanOrEqual(width - t + 1e-6);
            expect(a.y + a.h).toBeLessThanOrEqual(height - t + 1e-6);
            for (const b of sheet.items.slice(i + 1)) {
              const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
              const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
              expect(ox > 1e-6 && oy > 1e-6).toBe(false);
            }
          }
        }
      }
    }
  });

  it('keeps every cut edge to edge in the guillotine and strip layouts, with all first cuts parallel for strips', async () => {
    for (const base of await plans()) {
      const cut = buildCutList(solveProject(base), base.precision);
      for (const layout of ['guillotine', 'strips'] as const) {
        const plan = planCuts({ ...base, material: { ...base.material, layout } }, cut);
        for (const sheet of plan.sheets) expect(guillotine(sheet.items)).toBe(true);
        if (layout !== 'strips') continue;
        // Bands run the sheet's long way: across it, any two pieces share a band start or don't overlap.
        const longX = base.material.sheet.width >= base.material.sheet.height;
        for (const sheet of plan.sheets) {
          const across = sheet.items.map((it) => (longX ? [it.y, it.y + it.h] : [it.x, it.x + it.w]));
          for (const [i, [a0, a1]] of across.entries()) {
            for (const [b0, b1] of across.slice(i + 1)) expect(Math.abs(a0 - b0) < 1e-6 || a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6).toBe(true);
          }
        }
      }
    }
  });

  it('offers strips first and uses it as the default while keeping other layouts selectable', async () => {
    const { CUT_LAYOUTS } = await import('./pieces');
    const { setCutLayout } = await import('./edit');
    const p = doomExample();
    const cut = buildCutList(solveProject(p), p.precision);
    expect(CUT_LAYOUTS[0]!.value).toBe('strips');
    expect(planCuts(p, cut)).toEqual(planCuts({ ...p, material: { ...p.material, layout: 'strips' } }, cut));
    setCutLayout(p, 'fewest');
    expect(p.material.layout).toBe('fewest');
    setCutLayout(p, 'strips');
    expect(p.material.layout).toBeUndefined();
  });
});

describe('assembly step notes', () => {
  it('keeps finger notch cutting out of the gluing steps', () => {
    const p = doomExample();
    const s = solveProject(p);
    const cut = buildCutList(s, p.precision);
    const tray = s.trays.find((t) => t.depth === 0 && t.layerId === p.layers[0].id)!;
    const steps = trayInstructions(p, s, cut, tray);
    const walls = steps[1];
    expect(walls.text).not.toMatch(/notch/i);
    expect(cut.groups.some((g) => g.notches.length)).toBe(true);
    expect(steps.flatMap((s) => s.notes)).toEqual([]);
  });
});

describe('new design', () => {
  it('starts with one empty layer, 2 mm clearance, and notches a quarter of the layer height', async () => {
    const { newProject, STARTER_SPEC } = await import('./defaults');
    const p = newProject({ ...STARTER_SPEC, box: { width: 239, depth: 277, height: 74 }, layerHeight: 66, secondaryThickness: 3, secondaryBase: true });
    expect(p.box).toEqual({ width: 239, depth: 277, height: 74 });
    expect(p.clearance).toBe(2);
    expect(p.layers).toHaveLength(1);
    expect(p.layers[0].height).toBe(66);
    expect(p.layers[0].root.kind).toBe('section');
    expect(p.notch).toEqual({ width: 16.5, depth: 16.5, bottom: 50 });
    expect(p.material.secondaryThickness).toBe(3);
    expect(p.secondaryBase).toBe(true);
    expect(newProject(STARTER_SPEC).material.secondaryThickness).toBeUndefined();
    const s = solveProject(p);
    expect(s.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(s.headroom).toBe(8);
  });
});
