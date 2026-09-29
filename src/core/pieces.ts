/**
 * Cut list: groups identical pieces, suggests merging near-identical ones, and plans the cutting
 * the way sheet material is cut in bulk: walls and dividers of one height come from strips of that
 * width, bases are cut as rectangles, and everything is packed onto sheets.
 */
import { roundTo } from './geom';
import type { Issue, Low, Notch, PieceInst, Solved } from './layout';
import { pack } from './pack';
import type { Mm, Project } from './types';

export interface PieceGroup {
  number: number;
  kind: 'base' | 'strip';
  /** Base: width × depth (width ≥ depth). Strip piece: length × height. */
  length: Mm;
  height: Mm;
  /** Sheet thickness: bases can come from a different sheet than everything else. */
  thickness: Mm;
  /** Notches measured from the end that the assembly steps call the start. */
  notches: Notch[];
  /** Lowered stretches, measured from the same end as the notches. */
  lows: Low[];
  pieces: PieceInst[];
  key: string;
}

/** What a group of flat rectangles is used as: "base", "pad" or "base, pad". Empty for strips. */
export function panelUse(g: PieceGroup): string {
  if (g.kind !== 'base') return '';
  return [...new Set(g.pieces.map((p) => p.kind))].sort().join(', ');
}

export interface CutList {
  groups: PieceGroup[];
  groupOf: Map<string, PieceGroup>;
  /** True when the piece is used flipped end-for-end relative to its group's notch positions. */
  flipped: Set<string>;
  hints: Issue[];
}

const r1 = (v: number) => roundTo(v, 0.5);

function notchKey(notches: Notch[]): string {
  return notches.map((n) => `${r1(n.center)}:${r1(n.width)}:${r1(n.depth)}:${r1(n.bottom)}`).join(',');
}

function compareNotches(a: Notch[], b: Notch[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = r1(a[i].center) - r1(b[i].center) || r1(a[i].width) - r1(b[i].width) || r1(a[i].depth) - r1(b[i].depth) || r1(a[i].bottom) - r1(b[i].bottom);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function lowKey(lows: Low[]): string {
  return lows.map((l) => `${r1(l.from)}-${r1(l.to)}:${r1(l.depth)}`).join(',');
}

function compareLows(a: Low[], b: Low[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = r1(a[i].from) - r1(b[i].from) || r1(a[i].to) - r1(b[i].to) || r1(a[i].depth) - r1(b[i].depth);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function mirroredLows(lows: Low[], length: Mm): Low[] {
  return lows.map((l) => ({ from: length - l.to, to: length - l.from, depth: l.depth })).sort((a, b) => a.from - b.from);
}

function mirrored(notches: Notch[], length: Mm): Notch[] {
  return notches.map((n) => ({ ...n, center: length - n.center })).sort((a, b) => a.center - b.center);
}

export function buildCutList(solved: Solved, precision: Mm): CutList {
  const map = new Map<string, PieceGroup>();
  const groupOf = new Map<string, PieceGroup>();
  const flipped = new Set<string>();
  for (const p of solved.pieces) {
    const L = roundTo(p.length, precision);
    const H = roundTo(p.height, precision);
    let key: string;
    let length = L;
    let height = H;
    let notches: Notch[] = [];
    let lows: Low[] = [];
    let flip = false;
    if (p.kind === 'base' || p.kind === 'pad') {
      length = Math.max(L, H);
      height = Math.min(L, H);
      key = `base:${p.thickness}:${length}x${height}`;
    } else {
      const forward = [...p.notches].sort((a, b) => a.center - b.center);
      const back = mirrored(p.notches, p.length);
      const lowsForward = [...p.lows].sort((a, b) => a.from - b.from);
      const lowsBack = mirroredLows(p.lows, p.length);
      // Measure from whichever end puts the notches (then the lowered stretches) earliest, so
      // mirror images share one key.
      flip = (compareNotches(back, forward) || compareLows(lowsBack, lowsForward)) < 0;
      notches = flip ? back : forward;
      lows = flip ? lowsBack : lowsForward;
      key = `strip:${p.thickness}:${L}x${H}|${notchKey(notches)}|${lowKey(lows)}`;
    }
    let g = map.get(key);
    if (!g) {
      g = { number: 0, kind: p.kind === 'base' || p.kind === 'pad' ? 'base' : 'strip', length, height, thickness: p.thickness, notches, lows, pieces: [], key };
      map.set(key, g);
    }
    g.pieces.push(p);
    groupOf.set(p.id, g);
    if (flip) flipped.add(p.id);
  }

  const groups = [...map.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'base' ? -1 : 1;
    // Panels from one sheet thickness stay together, so a separate base material reads as its own block.
    if (a.kind === 'base') return a.thickness - b.thickness || b.length * b.height - a.length * a.height || (a.key < b.key ? -1 : 1);
    return b.height - a.height || b.length - a.length || a.notches.length - b.notches.length || (a.key < b.key ? -1 : 1);
  });
  groups.forEach((g, i) => (g.number = i + 1));

  const hints: Issue[] = [];
  const strips = groups.filter((g) => g.kind === 'strip');
  for (let i = 0; i < strips.length; i++) {
    for (let j = i + 1; j < strips.length; j++) {
      const a = strips[i];
      const b = strips[j];
      if (a.notches.length || b.notches.length || a.lows.length || b.lows.length) continue;
      const dL = Math.abs(a.length - b.length);
      const dH = Math.abs(a.height - b.height);
      if (dH < 0.01 && dL > 0.01 && dL <= 2) {
        hints.push({ level: 'warn', message: `#${a.number} and #${b.number} are ${a.length} and ${b.length} mm long; equal lengths would save a cut size.` });
      } else if (dL < 0.01 && dH > 0.01 && dH <= 2) {
        hints.push({ level: 'warn', message: `#${a.number} and #${b.number} are ${a.height} and ${b.height} mm tall; equal heights would save a cut size.` });
      }
    }
  }
  return { groups, groupOf, flipped, hints };
}

export interface Strip {
  id: string;
  height: Mm;
  cuts: { group: number; length: Mm }[];
  used: Mm;
}

export interface SheetItem {
  kind: 'base' | 'strip';
  group?: PieceGroup;
  strip?: Strip;
  /** Sheet coordinates of the item's rectangle as placed. */
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
}

export interface PlanSheet {
  index: number;
  /** Thickness of this sheet; the base material can differ from the rest. */
  thickness: Mm;
  items: SheetItem[];
}

export interface CutPlan {
  /** Grouped by thickness, in cut-list order. */
  sheets: PlanSheet[];
  /** How many sheets of each thickness. */
  counts: { thickness: Mm; sheets: number }[];
  strips: Strip[];
  issues: Issue[];
  /** Share of the sheets' area that ends up in pieces. */
  efficiency: number;
}

/** First-fit decreasing: pieces of one height go into strips no longer than `limit`. */
function buildStrips(cut: CutList, limit: Mm, kerf: Mm): Strip[] {
  const strips: Strip[] = [];
  const heights = [...new Set(cut.groups.filter((g) => g.kind === 'strip').map((g) => g.height))].sort((a, b) => b - a);
  for (const h of heights) {
    const items = cut.groups
      .filter((g) => g.kind === 'strip' && g.height === h)
      .flatMap((g) => g.pieces.map(() => ({ group: g.number, length: g.length })))
      .sort((a, b) => b.length - a.length || a.group - b.group);
    const mine: Strip[] = [];
    for (const it of items) {
      let s = mine.find((x) => x.used + kerf + it.length <= limit + 1e-6);
      if (!s) {
        s = { id: `${h}-${mine.length + 1}`, height: h, cuts: [], used: -kerf };
        mine.push(s);
      }
      s.cuts.push(it);
      s.used += kerf + it.length;
    }
    strips.push(...mine);
  }
  return strips;
}

/** Sheet thicknesses in the cut list, in the order its numbers run. */
export function thicknesses(project: Project, cut: CutList): Mm[] {
  const all = [...new Set(cut.groups.map((g) => g.thickness))];
  return all.length ? all : [project.material.thickness];
}

/** "2 A2 sheets", or per thickness when bases have their own: "1 × 3 mm + 2 × 5 mm A2 sheets". */
export function sheetSummary(project: Project, plan: CutPlan): string {
  const { preset } = project.material.sheet;
  const total = plan.sheets.length;
  if (plan.counts.length <= 1) return `${total} ${preset} sheet${total === 1 ? '' : 's'}`;
  return `${plan.counts.map((c) => `${c.sheets} × ${c.thickness} mm`).join(' + ')} ${preset} sheets`;
}

/** Each thickness is packed onto its own sheets: a 3 mm base cannot share a 5 mm sheet. */
export function planCuts(project: Project, cut: CutList): CutPlan {
  const sheets: PlanSheet[] = [];
  const strips: Strip[] = [];
  const issues: Issue[] = [];
  const counts: CutPlan['counts'] = [];
  let usedArea = 0;
  for (const thickness of thicknesses(project, cut)) {
    const part = planSheets(project, { ...cut, groups: cut.groups.filter((g) => g.thickness === thickness) });
    for (const s of part.sheets) sheets.push({ index: sheets.length, thickness, items: s.items });
    strips.push(...part.strips);
    issues.push(...part.issues);
    usedArea += part.usedArea;
    counts.push({ thickness, sheets: part.sheets.length });
  }
  const { width, height } = project.material.sheet;
  const efficiency = sheets.length ? usedArea / (sheets.length * width * height) : 0;
  return { sheets, counts, strips, issues, efficiency };
}

function planSheets(project: Project, cut: CutList) {
  const { sheet, trim, kerf } = project.material;
  const usableW = sheet.width - 2 * trim;
  const usableH = sheet.height - 2 * trim;
  const maxLen = Math.max(usableW, usableH);
  const issues: Issue[] = [];

  // Pieces that can never fit are reported once and left out of the plan.
  const fitting: CutList = {
    ...cut,
    groups: cut.groups.filter((g) => {
      if (g.kind !== 'strip' || g.length <= maxLen) return true;
      issues.push({ level: 'error', message: `#${g.number} is ${g.length} mm long, longer than a ${sheet.preset} sheet.` });
      return false;
    }),
  };

  const bases = cut.groups.filter((g) => g.kind === 'base').flatMap((g) => g.pieces.map((p, i) => ({ id: `b${g.number}-${i}`, g })));
  const fitsSheet = (w: Mm, h: Mm) => (w <= usableW && h <= usableH) || (h <= usableW && w <= usableH);
  const baseItems: { id: string; w: Mm; h: Mm }[] = [];
  for (const b of bases) {
    if (!fitsSheet(b.g.length, b.g.height)) {
      issues.push({ level: 'error', message: `Base #${b.g.number} (${b.g.length} × ${b.g.height}) does not fit a ${sheet.preset} sheet.` });
      continue;
    }
    baseItems.push({ id: b.id, w: b.g.length, h: b.g.height });
  }

  // Long strips mean fewer cuts, but shorter ones fit the gaps beside the bases. Try full-length
  // strips, strips as long as the sheet's short side, and one piece per strip; keep the fewest sheets.
  let best: { strips: Strip[]; items: { id: string; w: Mm; h: Mm }[]; result: ReturnType<typeof pack> } | undefined;
  for (const limit of [maxLen, Math.min(usableW, usableH), 0]) {
    const strips = buildStrips(fitting, limit, kerf);
    const items = [...baseItems, ...strips.map((s) => ({ id: `s${s.id}`, w: s.used, h: s.height }))];
    const result = pack(items, usableW, usableH, kerf);
    if (!best || result.unplaced.length < best.result.unplaced.length || (result.unplaced.length === best.result.unplaced.length && result.sheetCount < best.result.sheetCount)) {
      best = { strips, items, result };
    }
  }
  const { strips, items, result } = best!;

  const sheets = Array.from({ length: result.sheetCount }, (_, index) => ({ index, items: [] as SheetItem[] }));
  const baseById = new Map(bases.map((b) => [b.id, b.g]));
  const stripById = new Map(strips.map((s) => [`s${s.id}`, s]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  let usedArea = 0;
  for (const pl of result.placements) {
    const it = itemById.get(pl.id)!;
    const w = pl.rotated ? it.h : it.w;
    const h = pl.rotated ? it.w : it.h;
    const g = baseById.get(pl.id);
    const s = stripById.get(pl.id);
    sheets[pl.sheet].items.push({ kind: g ? 'base' : 'strip', group: g, strip: s, x: trim + pl.x, y: trim + pl.y, w, h });
    usedArea += it.w * it.h;
  }
  for (const id of result.unplaced) issues.push({ level: 'error', message: `Could not place ${id} on a sheet.` });
  return { sheets, strips, issues, usedArea };
}
