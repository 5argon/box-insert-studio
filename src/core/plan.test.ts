/**
 * The cutting plan is what material gets bought from, so every packing is checked end to end:
 * every piece cut exactly once at its size, nothing overlapping or closer than the kerf, nothing in
 * the trimmed edge, one material per sheet, and any piece left out named by an error.
 */
import { describe, expect, it } from 'vitest';
import { migrateProject, SHEET_PRESETS } from './defaults';
import { setConstruction, setInsertLid, setInsertSharedLid, setJoin, setLayerBaseSecondary, setSecondaryThickness, setStacked } from './edit';
import { blankProject, doomExample } from './fixtures';
import { roundTo } from './geom';
import { solveProject } from './layout';
import { buildCutList, planCuts, sheetSteps, type CutList, type CutPlan, type SheetItem } from './pieces';
import type { CutLayout, Project, SplitNode } from './types';
// Every design in examples/, whatever it is called: they are working files and change, so they are
// only held to rules, never to their exact pieces.
const exampleTexts = import.meta.glob('../../examples/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const examples: [string, () => Project][] = Object.entries(exampleTexts).map(([path, text]) => [path.split('/').pop()!, () => migrateProject(JSON.parse(text))!]);

const LAYOUTS: CutLayout[] = ['strips', 'fewest', 'guillotine'];
const EPS = 1e-6;

/** The reference design with its bases and lids on a 3 mm secondary material. */
function withSecondary(): Project {
  const p = doomExample();
  setSecondaryThickness(p, 3);
  setLayerBaseSecondary(p, true);
  return p;
}

function withPacking(p: Project, layout: CutLayout): Project {
  return { ...p, material: { ...p.material, layout, secondaryLayout: layout } };
}

/** Each cut of a strip as it lies on the sheet. */
function segments(p: Project, item: SheetItem) {
  const s = item.strip!;
  let offset = 0;
  return s.cuts.map((c) => {
    const seg = item.along === 'x' ? { x: item.x + offset, y: item.y, w: c.length, h: item.h } : { x: item.x, y: item.y + offset, w: item.w, h: c.length };
    offset += c.length + p.material.kerf;
    return { ...seg, group: c.group };
  });
}

/** Everything wrong with a plan; pieces left out are fine only when an error names them. */
function planProblems(p: Project, cut: CutList, plan: CutPlan): string[] {
  const out: string[] = [];
  const { kerf, trim } = p.material;
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
        for (const seg of segments(p, it)) rects.push({ ...seg, what: `#${seg.group}` });
      }
    }
    // Each sheet against its own size: the materials can come in different sheets.
    const expected = s.material === 'secondary' ? (p.material.secondarySheet ?? p.material.sheet) : p.material.sheet;
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
    if (plan.sheets.filter((s) => s.material === c.material).length !== c.sheets) out.push(`${c.material} sheet count is wrong`);
  }
  const area = plan.sheets.flatMap((s) => s.items).reduce((a, it) => a + (it.kind === 'base' ? it.w * it.h : it.strip!.cuts.reduce((l, c) => l + c.length, 0) * it.strip!.height), 0);
  const sheetArea = plan.sheets.reduce((a, s) => a + s.sheet.width * s.sheet.height, 0);
  if (plan.sheets.length && Math.abs(plan.efficiency - area / sheetArea) > 1e-9) out.push(`efficiency ${plan.efficiency} is not the pieces' share`);
  return out;
}

function check(p: Project) {
  const cut = buildCutList(solveProject(p), p.precision);
  const plan = planCuts(p, cut);
  return { cut, plan, problems: planProblems(p, cut, plan) };
}

const designs: [string, () => Project][] = [
  ...examples.map(([name, design]): [string, () => Project] => [`example ${name}`, design]),
  ['the reference design', doomExample],
  ['separate trays', () => {
    const p = doomExample();
    setConstruction(p, 'separate');
    return p;
  }],
  ['secondary bases and shared lids over stacked boxes', () => {
    const p = doomExample();
    setSecondaryThickness(p, 3);
    setLayerBaseSecondary(p, true);
    const g = solveProject(p).compartments.find((c) => c.label === 'G')!;
    setStacked(g.node, true);
    setInsertLid(g.node, true);
    setInsertSharedLid(g.node, true);
    setJoin(p.layers[0]!, g.node.insert!.root as SplitNode, 'trays', p.material.thickness);
    return p;
  }],
  ['secondary material on its own A2 sheets', () => {
    const p = withSecondary();
    p.material.secondarySheet = { ...SHEET_PRESETS.find((s) => s.preset === 'A2')! };
    return p;
  }],
  ['walls taller than an A4 sheet is wide', () => {
    const p = blankProject();
    p.material.sheet = { ...SHEET_PRESETS.find((s) => s.preset === 'A4')! };
    p.box = { width: 150, depth: 120, height: 230 };
    p.layers[0]!.height = 220;
    return p;
  }],
  ['a narrow custom sheet', () => {
    const p = blankProject();
    p.material.sheet = { preset: 'Custom', width: 120, height: 600 };
    p.box = { width: 110, depth: 300, height: 140 };
    p.layers[0]!.height = 130;
    return p;
  }],
];

describe('cutting plans', () => {
  for (const [name, design] of designs) {
    for (const layout of LAYOUTS) {
      it(`${name}, ${layout}`, () => {
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

  it('describes strips packing strip by strip, trimming what is narrower than its strip', () => {
    for (const [, design] of [...examples, ['reference', withSecondary] as const]) {
      const p = withPacking(design(), 'strips');
      const { plan, cut } = check(p);
      const steps = plan.sheets.flatMap((s) => sheetSteps(s));
      expect(steps.every((s) => /^Strip \d+: cut a [\d.]+ mm wide strip along the full length of the sheet, then cut it into .+\.$/.test(s))).toBe(true);
      // Anything narrower than the strip it comes from says so, once each.
      const narrower = plan.sheets.flatMap((s) => s.items).filter((it) => it.band && it.band.across < it.band.width - 1e-6).length;
      expect(steps.join(' ').match(/trimmed to [\d.]+ mm wide/g)?.length ?? 0).toBe(narrower);
      // Every piece is in the text as often as it is cut.
      const mentions = steps.join(' ').match(/#\d+ [\d.]+( × [\d.]+)?( \(turned\))?( ×\d+)?/g) ?? [];
      const total = mentions.reduce((n, m) => n + Number(m.match(/ ×(\d+)$/)?.[1] ?? 1), 0);
      expect(total).toBe(cut.groups.reduce((n, g) => n + g.pieces.length, 0));
    }
  });

  it('buys each material in its own sheet size', async () => {
    const { sheetSummary, sheetSizes } = await import('./pieces');
    const p = withSecondary();
    const same = check(p).plan;
    expect(sheetSummary(p, same)).toMatch(/^\d+ × 3 mm secondary \+ \d+ × 5 mm primary A2 sheets$/);
    expect(sheetSizes(same)).toBe('420 × 594 mm');
    p.material.secondarySheet = { ...SHEET_PRESETS.find((s) => s.preset === 'A3')! };
    const own = check(p).plan;
    expect(own.sheets.filter((s) => s.material === 'secondary').every((s) => s.sheet.preset === 'A3')).toBe(true);
    expect(own.sheets.filter((s) => s.material === 'primary').every((s) => s.sheet.preset === 'A2')).toBe(true);
    expect(sheetSummary(p, own)).toMatch(/^\d+ × 3 mm secondary A3 \+ \d+ × 5 mm primary A2 sheets$/);
    expect(sheetSizes(own)).toBe('A3 297 × 420 mm, A2 420 × 594 mm');
    // A custom size is named by its dimensions.
    p.material.secondarySheet = { preset: 'Custom', width: 600, height: 1000 };
    expect(sheetSummary(p, check(p).plan)).toMatch(/^\d+ × 3 mm secondary 600 × 1000 mm \+ \d+ × 5 mm primary A2 sheets$/);
  });

  it('rounds equal sizes alike, however they were added up', () => {
    expect(roundTo(48.74999999999999, 0.5)).toBe(49);
    expect(roundTo(48.75, 0.5)).toBe(49);
    expect(roundTo(0.35, 0.1)).toBe(0.4);
    expect(roundTo(87.49999999999999, 0.5)).toBe(87.5);
  });
});
