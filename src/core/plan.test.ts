/**
 * The cutting plan is what material gets bought from, so every packing is checked end to end:
 * every piece cut exactly once at its size, nothing overlapping or closer than the kerf, nothing in
 * the trimmed edge, one material per sheet, and any piece left out named by an error.
 */
import { describe, expect, it } from 'vitest';
import { defaultCutSetup, migrateProject, SHEET_PRESETS } from './defaults';
import { setConstruction, setInsert, setInsertBaseSecondary, setInsertLid, setInsertSharedLid, setJoin, setLayerBaseSecondary, setPad, setSecondaryThickness, setStacked } from './edit';
import { blankProject, doomExample, testSetup } from './fixtures';
import { roundTo, type Rect } from './geom';
import { solveProject } from './layout';
import { buildCutList, planCuts, sheetSteps, type CutList, type CutPlan, type SheetItem, type SheetStep, type StepPart } from './pieces';
import type { CutAlong, CutLayout, CutSetup, Project, SectionNode, SplitNode } from './types';
// Every design in examples/, whatever it is called: they are working files and change, so they are
// only held to rules, never to their exact pieces.
const exampleTexts = import.meta.glob('../../examples/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const examples: [string, () => Project][] = Object.entries(exampleTexts).map(([path, text]) => [path.split('/').pop()!, () => migrateProject(JSON.parse(text))!]);

const LAYOUTS: CutLayout[] = ['strips', 'fewest', 'guillotine'];
const EPS = 1e-6;

/** The reference design with secondary bases, and two stacked separate boxes under a shared lid in G. */
function withStackedBoxes(): Project {
  const p = doomExample();
  setSecondaryThickness(p, 3);
  setLayerBaseSecondary(p, true);
  const g = solveProject(p).compartments.find((c) => c.label === 'G')!;
  setStacked(g.node, true);
  setInsertLid(g.node, true);
  setInsertSharedLid(g.node, true);
  setJoin(p.layers[0]!, g.node.insert!.root as SplitNode, 'trays', p.material.thickness);
  return p;
}

/**
 * One compartment with a raised floor and a removable box that fits it exactly: the floor's layer
 * and the box's base are one cut size, used by both the tray and the box.
 */
function boxOnRaisedFloor(): Project {
  const p = blankProject();
  p.clearance = 0;
  const layer = p.layers[0]!;
  setInsert(layer, layer.root.id, true);
  setPad(layer.root as SectionNode, 1);
  return p;
}

/** The reference design with its bases and lids on a 3 mm secondary material. */
function withSecondary(): Project {
  const p = doomExample();
  setSecondaryThickness(p, 3);
  setLayerBaseSecondary(p, true);
  return p;
}

/** A design and the sheets it is planned on: the test sheets, but for what `setup` changes. */
type Planned = { p: Project; setup: CutSetup };
const on = (p: Project, setup: Partial<CutSetup> = {}): Planned => ({ p, setup: { ...testSetup(), ...setup } });

function withPacking(d: Planned, layout: CutLayout, cutAlong: CutAlong = 'short'): Planned {
  return { p: d.p, setup: { ...d.setup, layout, secondaryLayout: layout, cutAlong } };
}

/** The longest of the cuts a sheet's steps show. */
function longestCut(steps: SheetStep[]): number {
  return Math.max(0, ...steps.flatMap((step) => lines(step).flat().flatMap((part) => part.cuts ?? [])).map((c) => Math.abs(c.x2 - c.x1) + Math.abs(c.y2 - c.y1)));
}

/** Each cut of a strip as it lies on the sheet. */
function segments(setup: CutSetup, item: SheetItem) {
  const s = item.strip!;
  let offset = 0;
  return s.cuts.map((c) => {
    const seg = item.along === 'x' ? { x: item.x + offset, y: item.y, w: c.length, h: item.h } : { x: item.x, y: item.y + offset, w: item.w, h: c.length };
    offset += c.length + setup.kerf;
    return { ...seg, group: c.group };
  });
}

/** A cutting step's own line and the lines under it. */
const lines = (step: SheetStep): StepPart[][] => [step.parts, ...(step.then ?? []).flatMap(lines)];
/** A cutting step as it reads. */
const text = (step: SheetStep) => lines(step).map((line) => line.map((part) => part.text).join('')).join(' ');

/** Everything wrong with a plan; pieces left out are fine only when an error names them. */
function planProblems(setup: CutSetup, cut: CutList, plan: CutPlan): string[] {
  const out: string[] = [];
  const { kerf, trim } = setup;
  const counts = new Map<number, number>();
  const byNumber = new Map(cut.groups.map((g) => [g.number, g]));
  for (const s of plan.sheets) {
    if (!s.items.length) out.push(`sheet ${s.index} is empty`);
    const rects: { x: number; y: number; w: number; h: number; what: string }[] = [];
    for (const it of s.items) {
      if (it.kind === 'base') {
        const g = it.group!;
        counts.set(g.number, (counts.get(g.number) ?? 0) + 1);
        const fits = (Math.abs(it.w - g.length) < EPS && Math.abs(it.h - g.height) < EPS) || (Math.abs(it.w - g.height) < EPS && Math.abs(it.h - g.length) < EPS);
        if (!fits) out.push(`#${g.number} drawn ${it.w}×${it.h}, cut ${g.length}×${g.height}`);
        if (g.material !== s.material || g.thickness !== s.thickness) out.push(`#${g.number} on a ${s.material} sheet`);
        rects.push({ ...it, what: `#${g.number}` });
      } else {
        const st = it.strip!;
        for (const c of st.cuts) {
          const g = byNumber.get(c.group)!;
          counts.set(g.number, (counts.get(g.number) ?? 0) + 1);
          // A turned piece lies across its strip: its height runs along the strip.
          const [len, ht] = c.turned ? [g.height, g.length] : [g.length, g.height];
          if (Math.abs(c.length - len) > EPS || Math.abs(st.height - ht) > EPS) out.push(`#${g.number} cut ${c.length}×${st.height}, should be ${g.length}×${g.height}`);
          if (g.material !== s.material || g.thickness !== s.thickness) out.push(`#${g.number} on a ${s.material} sheet`);
        }
        for (const seg of segments(setup, it)) rects.push({ ...seg, what: `#${seg.group}` });
      }
    }
    // Each sheet against its own size: the materials can come in different sheets.
    const expected = (s.boxes ? setup.boxSheet : undefined) ?? (s.material === 'secondary' ? (setup.secondarySheet ?? setup.sheet) : setup.sheet);
    if (s.sheet.width !== expected.width || s.sheet.height !== expected.height) out.push(`sheet ${s.index} is ${s.sheet.width}×${s.sheet.height}, its material comes in ${expected.width}×${expected.height}`);
    for (const r of rects) {
      if (r.x < trim - EPS || r.y < trim - EPS || r.x + r.w > s.sheet.width - trim + EPS || r.y + r.h > s.sheet.height - trim + EPS) out.push(`${r.what} in the trimmed edge`);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const apart = a.x + a.w + kerf <= b.x + EPS || b.x + b.w + kerf <= a.x + EPS || a.y + a.h + kerf <= b.y + EPS || b.y + b.h + kerf <= a.y + EPS;
        if (!apart) out.push(`${a.what} and ${b.what} closer than the kerf on sheet ${s.index}`);
      }
    }
  }
  const errors = plan.issues.filter((i) => i.level === 'error').map((i) => i.message).join(' | ');
  for (const g of cut.groups) {
    const n = counts.get(g.number) ?? 0;
    if (n > g.pieces.length) out.push(`#${g.number} cut ${n} times for ${g.pieces.length} pieces`);
    if (n < g.pieces.length && !new RegExp(`#${g.number}\\b`).test(errors)) out.push(`#${g.number} placed ${n} of ${g.pieces.length} with no error naming it`);
  }
  for (const c of plan.counts) {
    if (plan.sheets.filter((s) => s.material === c.material && !!s.boxes === !!c.boxes).length !== c.sheets) out.push(`${c.material} sheet count is wrong`);
  }
  const area = plan.sheets.flatMap((s) => s.items).reduce((a, it) => a + (it.kind === 'base' ? it.w * it.h : it.strip!.cuts.reduce((l, c) => l + c.length, 0) * it.strip!.height), 0);
  const sheetArea = plan.sheets.reduce((a, s) => a + s.sheet.width * s.sheet.height, 0);
  if (plan.sheets.length && Math.abs(plan.efficiency - area / sheetArea) > 1e-9) out.push(`efficiency ${plan.efficiency} is not the pieces' share`);
  return out;
}

function check({ p, setup }: Planned) {
  const cut = buildCutList(solveProject(p), p.precision);
  const plan = planCuts(p, cut, setup);
  return { cut, plan, problems: planProblems(setup, cut, plan) };
}

const designs: [string, () => Planned][] = [
  ...examples.map(([name, design]): [string, () => Planned] => [`example ${name}`, () => on(design())]),
  ['the reference design', () => on(doomExample())],
  ['separate trays', () => {
    const p = doomExample();
    setConstruction(p, 'separate');
    return on(p);
  }],
  ['secondary bases and shared lids over stacked boxes', () => on(withStackedBoxes())],
  ['removable boxes on sheets of their own', () => on(withStackedBoxes(), { separateBoxes: true })],
  ['removable boxes on A3 sheets of their own', () => on(withStackedBoxes(), { separateBoxes: true, boxSheet: { ...SHEET_PRESETS.find((s) => s.preset === 'A3')! } })],
  ...examples.map(([name, design]): [string, () => Planned] => [`example ${name}, removable boxes on sheets of their own`, () => on(design(), { separateBoxes: true })]),
  ['secondary material on its own A2 sheets', () => on(withSecondary(), { secondarySheet: { ...SHEET_PRESETS.find((s) => s.preset === 'A2')! } })],
  ['walls taller than an A4 sheet is wide', () => {
    const p = blankProject();
    p.box = { width: 150, depth: 120, height: 230 };
    p.layers[0]!.height = 220;
    return on(p, { sheet: { ...SHEET_PRESETS.find((s) => s.preset === 'A4')! } });
  }],
  ['a narrow custom sheet', () => {
    const p = blankProject();
    p.box = { width: 110, depth: 300, height: 140 };
    p.layers[0]!.height = 130;
    return on(p, { sheet: { preset: 'Custom', width: 120, height: 600 } });
  }],
];

describe('cutting plans', () => {
  for (const [name, design] of designs) {
    for (const layout of LAYOUTS) {
      it(`${name}, ${layout}`, () => {
        expect(check(withPacking(design(), layout, 'long')).problems).toEqual([]);
        expect(check(withPacking(design(), layout)).problems).toEqual([]);
      });
    }
  }

  it('turns a wall taller than the sheet is wide, instead of running it off the sheet', () => {
    for (const layout of LAYOUTS) {
      const { plan } = check(withPacking(designs.find(([n]) => n.startsWith('walls taller'))![1](), layout));
      expect(plan.issues).toEqual([]);
    }
  });

  it('names pieces that cannot fit, and still places the ones that fit turned', () => {
    for (const layout of LAYOUTS) {
      const { cut, plan } = check(withPacking(designs.find(([n]) => n === 'a narrow custom sheet')![1](), layout));
      const tooBig = cut.groups.filter((g) => Math.min(g.length, g.height) > 110);
      expect(tooBig.length).toBeGreaterThan(0);
      const errors = plan.issues.map((i) => i.message).join(' | ');
      for (const g of tooBig) expect(errors).toMatch(new RegExp(`#${g.number}\\b`));
      const placed = new Set(plan.sheets.flatMap((s) => s.items.flatMap((it) => (it.kind === 'base' ? [it.group!.number] : it.strip!.cuts.map((c) => c.group)))));
      for (const g of cut.groups.filter((x) => !tooBig.includes(x))) expect(placed.has(g.number)).toBe(true);
    }
  });

  it('describes strips packing strip by strip, its pieces listed under it, trimming what is narrower than its strip', () => {
    for (const [, design] of [...examples, ['reference', withSecondary] as const]) {
      for (const along of ['short', 'long'] as const) {
        const d = withPacking(on(design()), 'strips', along);
        const { plan, cut } = check(d);
        const steps = plan.sheets.flatMap((s) => sheetSteps(d.setup, s).map(text));
        const full = along === 'short' ? 'across the full width' : 'along the full length';
        expect(steps.every((s) => new RegExp(`^Strip \\d+: cut a [\\d.]+ mm wide strip ${full} of the sheet, then cut it into: .+\\.$`).test(s))).toBe(true);
        // Anything narrower than the strip it comes from says so, once each.
        const narrower = plan.sheets.flatMap((s) => s.items).filter((it) => it.band && it.band.across < it.band.width - 1e-6).length;
        expect(steps.join(' ').match(/trimmed to [\d.]+ mm wide/g)?.length ?? 0).toBe(narrower);
        // Every piece is in the text as often as it is cut, its size in mm.
        const mentions = steps.join(' ').match(/#\d+ [\d.]+( × [\d.]+)? mm( \(turned\))?( ×\d+)?/g) ?? [];
        expect(steps.join(' ').match(/#\d+/g)?.length).toBe(mentions.length);
        const total = mentions.reduce((n, m) => n + Number(m.match(/ ×(\d+)$/)?.[1] ?? 1), 0);
        expect(total).toBe(cut.groups.reduce((n, g) => n + g.pieces.length, 0));
      }
    }
  });

  it('runs the strips along the chosen edge of the sheet, the short one unless told otherwise', () => {
    for (const [, design] of [...examples, ['reference', withSecondary] as const]) {
      for (const along of ['short', 'long'] as const) {
        const d = withPacking(on(design()), 'strips', along);
        for (const s of check(d).plan.sheets) {
          const usable = [s.sheet.width, s.sheet.height].map((v) => v - 2 * d.setup.trim);
          const full = along === 'short' ? Math.min(...usable) : Math.max(...usable);
          // The cut that frees each strip from the sheet; the last strip may end at the sheet's edge.
          for (const step of sheetSteps(d.setup, s)) for (const c of step.parts[0]!.cuts!) expect(Math.abs(c.x2 - c.x1) + Math.abs(c.y2 - c.y1)).toBeCloseTo(full);
        }
      }
    }
    expect(defaultCutSetup().cutAlong).toBe('short');
  });

  it('keeps edge-to-edge cuts within the short edge of the sheet when asked to, where the long way needs longer ones', () => {
    const d = on(doomExample(), { sheet: { ...SHEET_PRESETS.find((s) => s.preset === '60 × 100 cm')! } });
    const longest = (along: CutAlong) => {
      const q = withPacking(d, 'guillotine', along);
      const { plan, problems } = check(q);
      expect(problems).toEqual([]);
      return { sheets: plan.sheets.length, cut: Math.max(...plan.sheets.map((s) => longestCut(sheetSteps(q.setup, s)))) };
    };
    const short = longest('short');
    const long = longest('long');
    expect(short.sheets).toBe(long.sheets);
    expect(short.cut).toBeLessThanOrEqual(600 - 2 * d.setup.trim + EPS);
    expect(long.cut).toBeGreaterThan(600);
  });

  it('shows the cuts of each step: straight, clear of every piece, and freeing the pieces it names', () => {
    for (const [, design] of [...examples, ['reference', withSecondary] as const]) {
      for (const layout of ['strips', 'guillotine'] as const) {
        const d = withPacking(on(design()), layout);
        const { plan } = check(d);
        for (const s of plan.sheets) {
          const pieces = s.items.flatMap<Rect>((it) => (it.kind === 'base' ? [it] : segments(d.setup, it)));
          const steps = sheetSteps(d.setup, s);
          const cuts = steps.flatMap((step) => lines(step).flat().flatMap((part) => part.cuts ?? []));
          for (const c of cuts) {
            expect(Math.abs(c.x1 - c.x2) < EPS || Math.abs(c.y1 - c.y2) < EPS).toBe(true);
            const through = pieces.some((r) => Math.max(c.x1, c.x2) > r.x + EPS && Math.min(c.x1, c.x2) < r.x + r.w - EPS && Math.max(c.y1, c.y2) > r.y + EPS && Math.min(c.y1, c.y2) < r.y + r.h - EPS);
            expect(through).toBe(false);
          }
          // Each piece has a cut, or the trimmed sheet's edge, along all four of its sides.
          const { trim, kerf } = d.setup;
          const along = (at: number, from: number, to: number, vertical: boolean) =>
            cuts.some((c) => {
              const [pos, a, b] = vertical ? [c.x1, c.y1, c.y2] : [c.y1, c.x1, c.x2];
              return Math.abs(vertical ? c.x1 - c.x2 : c.y1 - c.y2) < EPS && Math.abs(pos - at) <= kerf / 2 + EPS && Math.min(a, b) <= from + EPS && Math.max(a, b) >= to - EPS;
            });
          for (const r of pieces) {
            expect(r.x - trim < EPS || along(r.x - kerf / 2, r.y, r.y + r.h, true)).toBe(true);
            expect(s.sheet.width - trim - (r.x + r.w) < kerf + EPS || along(r.x + r.w + kerf / 2, r.y, r.y + r.h, true)).toBe(true);
            expect(r.y - trim < EPS || along(r.y - kerf / 2, r.x, r.x + r.w, false)).toBe(true);
            expect(s.sheet.height - trim - (r.y + r.h) < kerf + EPS || along(r.y + r.h + kerf / 2, r.x, r.x + r.w, false)).toBe(true);
          }
          // Edge-to-edge packing lists every strip and panel once, under the larger piece it is cut from.
          if (layout !== 'guillotine') continue;
          const under = (step: SheetStep): SheetStep[] => [step, ...(step.then ?? []).flatMap(under)];
          const all = steps.flatMap(under);
          expect(all.filter((step) => !step.then).length).toBe(s.items.length);
          const cutText = '(vertically|horizontally), [\\d.]+ mm from the (left|top)';
          for (const step of all.filter((x) => x.then)) {
            expect(text(step)).toMatch(new RegExp(`^Cut (the sheet|the remaining piece|it) ${cutText}, then cut up the (left|top) piece: `));
            expect(step.then!.length).toBeGreaterThan(1);
          }
          // Each step says what it is cut from: the sheet or larger piece first, then what remains of it.
          for (const [list, first] of [[steps, 'the sheet'] as const, ...all.filter((x) => x.then).map((x) => [x.then!, 'it'] as const)]) {
            list.forEach((step, i) => {
              const own = step.parts.map((part) => part.text).join('');
              const from = i ? 'the remaining piece' : first;
              expect(own).toMatch(new RegExp(`^(Cut ${from} ${cutText}(, and trim it to (size|[\\d.]+ mm wide))?|Trim ${from} to (size|[\\d.]+ mm wide)|${from[0]!.toUpperCase()}${from.slice(1)})(,| →) `));
            });
          }
        }
      }
    }
  });

  it('lists fewest-sheets packing without cuts to show', () => {
    const d = withPacking(on(doomExample()), 'fewest');
    const { plan } = check(d);
    expect(plan.sheets.flatMap((s) => sheetSteps(d.setup, s).flatMap(lines).flat()).some((part) => part.cuts)).toBe(false);
  });

  it('lists the cut list as text to order from: the material thickness, then each size once with how many', async () => {
    const { cutListText } = await import('./pieces');
    const p = withSecondary();
    const cut = buildCutList(solveProject(p), p.precision);
    const text = cutListText(cut);
    const blocks = text.split('\n\n').map((b) => b.split('\n'));
    expect(blocks.map((b) => b[0])).toEqual(['Material thickness: 3 mm', 'Material thickness: 5 mm']);
    expect(text).not.toMatch(/primary|secondary/i);
    const lines = blocks.flatMap((b) => b.slice(1));
    for (const line of lines) expect(line).toMatch(/^[\d.]+ × [\d.]+ mm, \d+ pcs?$/);
    for (const b of blocks) expect(new Set(b).size).toBe(b.length);
    // Every piece is counted once.
    expect(lines.reduce((n, l) => n + Number(l.match(/, (\d+) pcs?$/)![1]), 0)).toBe(cut.groups.reduce((n, g) => n + g.pieces.length, 0));
    expect(lines.some((l) => l.endsWith(', 1 pc'))).toBe(true);
    const one = doomExample();
    expect(cutListText(buildCutList(solveProject(one), one.precision)).split('\n')[0]).toBe('Material thickness: 5 mm');
  });

  it('cuts removable boxes from sheets of their own when asked, sharing none with the trays', async () => {
    const { sheetSummary } = await import('./pieces');
    /** How many of each cut size are on the sheets for boxes, or on the rest. */
    const placed = (plan: CutPlan, boxes: boolean) => {
      const n = new Map<number, number>();
      for (const s of plan.sheets.filter((x) => !!x.boxes === boxes)) {
        for (const it of s.items) for (const g of it.kind === 'base' ? [it.group!.number] : it.strip!.cuts.map((c) => c.group)) n.set(g, (n.get(g) ?? 0) + 1);
      }
      return n;
    };
    for (const design of [withStackedBoxes, boxOnRaisedFloor, doomExample, ...examples.map(([, d]) => d)]) {
      for (const layout of LAYOUTS) {
        const together = check(withPacking(on(design()), layout));
        expect(together.plan.sheets.some((s) => s.boxes)).toBe(false);
        const { cut, plan, problems } = check(withPacking(on(design(), { separateBoxes: true }), layout));
        expect(problems).toEqual([]);
        expect(plan.issues).toEqual(together.plan.issues);
        // Each kind of sheet holds exactly its own pieces of every size, including sizes both use.
        for (const boxes of [false, true]) {
          const want = new Map(cut.groups.map((g) => [g.number, g.pieces.filter((p) => (p.depth === 1) === boxes).length] as const).filter(([, n]) => n));
          expect(placed(plan, boxes)).toEqual(want);
        }
        // Sheets for boxes come after the rest, and no two strips share an id.
        const kinds = plan.sheets.map((s) => !!s.boxes);
        expect(kinds).toEqual([...kinds].sort((a, b) => Number(a) - Number(b)));
        expect(new Set(plan.strips.map((s) => s.id)).size).toBe(plan.strips.length);
        expect(plan.counts.filter((c) => c.boxes).reduce((n, c) => n + c.sheets, 0)).toBe(kinds.filter(Boolean).length);
      }
    }
    // A size cut for both a tray and a box keeps its number, with its pieces on both kinds of sheet.
    const both = check(on(boxOnRaisedFloor(), { separateBoxes: true }));
    const shared = both.cut.groups.filter((g) => new Set(g.pieces.map((p) => p.depth)).size === 2);
    expect(shared.length).toBeGreaterThan(0);
    for (const g of shared) for (const boxes of [false, true]) expect(placed(both.plan, boxes).get(g.number)).toBeGreaterThan(0);
    const apart = check(on(withStackedBoxes(), { separateBoxes: true })).plan;
    expect(sheetSummary(apart)).toMatch(/^\d+ × 3 mm secondary \+ \d+ × 5 mm primary A2 sheets \+ \d+ × 5 mm primary A2 sheets? for removable boxes$/);
    const one = check(on(doomExample(), { separateBoxes: true })).plan;
    expect(sheetSummary(one)).toMatch(/^\d+ A2 sheets? \+ \d+ A2 sheets? for removable boxes$/);
    // Those sheets can come in a size of their own, in both materials; the rest keep theirs.
    const a3 = { ...SHEET_PRESETS.find((s) => s.preset === 'A3')! };
    const p = withStackedBoxes();
    setInsertBaseSecondary(solveProject(p).compartments.find((c) => c.label === 'G')!.node, true);
    const sized = check(on(p, { separateBoxes: true, boxSheet: a3 })).plan;
    expect(new Set(sized.sheets.filter((s) => s.boxes).map((s) => s.material))).toEqual(new Set(['primary', 'secondary']));
    for (const s of sized.sheets) expect(s.sheet.preset).toBe(s.boxes ? 'A3' : 'A2');
    expect(sheetSummary(sized)).toMatch(/^\d+ × 3 mm secondary \+ \d+ × 5 mm primary A2 sheets \+ \d+ × 3 mm secondary \+ \d+ × 5 mm primary A3 sheets for removable boxes$/);
    // Unused while boxes share the other sheets.
    expect(check(on(p, { boxSheet: a3 })).plan).toEqual(check(on(p)).plan);
    // Without removable boxes there is nothing to set apart.
    const plain = blankProject();
    expect(check(on(plain, { separateBoxes: true })).plan).toEqual(check(on(plain)).plan);
  });

  it('buys each material in its own sheet size', async () => {
    const { sheetSummary, sheetSizes } = await import('./pieces');
    const p = withSecondary();
    const same = check(on(p)).plan;
    expect(sheetSummary(same)).toMatch(/^\d+ × 3 mm secondary \+ \d+ × 5 mm primary A2 sheets$/);
    expect(sheetSizes(same)).toBe('420 × 594 mm');
    const own = check(on(p, { secondarySheet: { ...SHEET_PRESETS.find((s) => s.preset === 'A3')! } })).plan;
    expect(own.sheets.filter((s) => s.material === 'secondary').every((s) => s.sheet.preset === 'A3')).toBe(true);
    expect(own.sheets.filter((s) => s.material === 'primary').every((s) => s.sheet.preset === 'A2')).toBe(true);
    expect(sheetSummary(own)).toMatch(/^\d+ × 3 mm secondary A3 \+ \d+ × 5 mm primary A2 sheets$/);
    expect(sheetSizes(own)).toBe('A3 297 × 420 mm, A2 420 × 594 mm');
    // A custom size is named by its dimensions.
    expect(sheetSummary(check(on(p, { secondarySheet: { preset: 'Custom', width: 600, height: 1000 } })).plan)).toMatch(/^\d+ × 3 mm secondary 600 × 1000 mm \+ \d+ × 5 mm primary A2 sheets$/);
  });

  it('rounds equal sizes alike, however they were added up', () => {
    expect(roundTo(48.74999999999999, 0.5)).toBe(49);
    expect(roundTo(48.75, 0.5)).toBe(49);
    expect(roundTo(0.35, 0.1)).toBe(0.4);
    expect(roundTo(87.49999999999999, 0.5)).toBe(87.5);
  });
});
