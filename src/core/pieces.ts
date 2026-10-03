/**
 * Cut list: groups identical pieces, suggests merging near-identical ones, and plans the cutting
 * the way sheet material is cut in bulk: walls and dividers of one height come from strips of that
 * width, bases are cut as rectangles, and everything is packed onto sheets.
 */
import { mm, roundTo } from './geom';
import { rotateLidNotches, type LidNotch } from './lidNotches';
import type { Issue, Low, Notch, PieceInst, Solved } from './layout';
import { pack, packGuillotine } from './pack';
import type { CutLayout, MaterialKind, Mm, Project } from './types';

/** Sheet packing choices, in the order they are offered. */
export const CUT_LAYOUTS: { value: CutLayout; name: string; detail: string }[] = [
  {
    value: 'strips',
    name: 'Strips across the sheet',
    detail: 'Cut the sheet into full-length strips first, then cut each strip into lengths; trim a piece where it is narrower than its strip.',
  },
  { value: 'fewest', name: 'Fewest sheets', detail: 'Pieces fill any free space, either way round. Some cuts stop partway across the sheet.' },
  {
    value: 'guillotine',
    name: 'Edge-to-edge cuts',
    detail: 'Every cut runs all the way across the piece of sheet in hand, so a straightedge or saw fence always reaches end to end.',
  },
];

/** Each material independently defaults to strips across the sheet. */
export function cutPacking(project: Project, material: MaterialKind): CutLayout {
  return (material === 'secondary' ? project.material.secondaryLayout : project.material.layout) ?? 'strips';
}

/** A material label shared by the cut list, cutting plan and assembly instructions. */
export function materialLabel(material: MaterialKind, thickness: Mm): string {
  return `${material === 'secondary' ? 'Secondary' : 'Primary'} material (${mm(thickness)} mm)`;
}

export interface PieceGroup {
  number: number;
  kind: 'base' | 'strip';
  /** Flat panel: width × depth (width ≥ depth). Strip piece: length × height. */
  length: Mm;
  height: Mm;
  /** Thickness of the material selected for these pieces. */
  thickness: Mm;
  material: MaterialKind;
  /** Notches measured from the end that the assembly steps call the start. */
  notches: Notch[];
  /** Edge cuts on flat lids, in this group's orientation (long edge across). */
  lidNotches?: LidNotch[];
  /** Lowered stretches, measured from the same end as the notches. */
  lows: Low[];
  pieces: PieceInst[];
  key: string;
}

/** Uses of a group of flat rectangles: bases, lids and/or pads. Empty for strips. */
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

/** A lid can be turned around, or rotated a quarter turn when square, to share a cut pattern. */
function canonicalLid(notches: LidNotch[], width: Mm, height: Mm) {
  let rotated = notches;
  let best: { key: string; notches: LidNotch[] } | undefined;
  for (let i = 0; i < 4; i++) {
    if (width >= height) {
      const sorted = [...rotated].sort((a, b) => a.side.localeCompare(b.side));
      const key = sorted.map((n) => `${n.side}:${r1(n.center)}:${r1(n.width)}:${r1(n.depth)}:${r1(n.bottom)}`).join(',');
      if (!best || key < best.key) best = { key, notches: sorted };
    }
    rotated = rotateLidNotches(rotated, height);
    [width, height] = [height, width];
  }
  return best!;
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
    let lidNotches: LidNotch[] | undefined;
    let lows: Low[] = [];
    let flip = false;
    const flat = p.kind === 'base' || p.kind === 'lid' || p.kind === 'pad';
    if (flat) {
      length = Math.max(L, H);
      height = Math.min(L, H);
      key = `base:${p.material}:${p.thickness}:${length}x${height}`;
      if (p.lidNotches?.length) {
        const shape = canonicalLid(p.lidNotches, p.length, p.height);
        lidNotches = shape.notches;
        key += `|lid:${shape.key}`;
      }
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
      key = `strip:${p.material}:${p.thickness}:${L}x${H}|${notchKey(notches)}|${lowKey(lows)}`;
    }
    let g = map.get(key);
    if (!g) {
      g = { number: 0, kind: flat ? 'base' : 'strip', length, height, thickness: p.thickness, material: p.material, notches, lows, pieces: [], key };
      if (lidNotches) g.lidNotches = lidNotches;
      map.set(key, g);
    }
    g.pieces.push(p);
    groupOf.set(p.id, g);
    if (flip) flipped.add(p.id);
  }

  const groups = [...map.values()].sort((a, b) => {
    if (a.material !== b.material) return a.material === 'secondary' ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'base' ? -1 : 1;
    // Panels from one sheet thickness stay together.
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
      if (a.material !== b.material || a.thickness !== b.thickness || a.notches.length || b.notches.length || a.lows.length || b.lows.length) continue;
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
  /** Strips: the sheet axis their length runs along. */
  along?: 'x' | 'y';
  /** Sheet coordinates of the item's rectangle as placed. */
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
}

export interface PlanSheet {
  index: number;
  /** Material and thickness of this cutting sheet. */
  thickness: Mm;
  material: MaterialKind;
  items: SheetItem[];
}

export interface CutPlan {
  /** Grouped by material, in cut-list order. */
  sheets: PlanSheet[];
  /** How many sheets of each material. */
  counts: { material: MaterialKind; thickness: Mm; sheets: number }[];
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
        s = { id: `${cut.groups[0]?.material ?? 'primary'}:${h}-${mine.length + 1}`, height: h, cuts: [], used: -kerf };
        mine.push(s);
      }
      s.cuts.push(it);
      s.used += kerf + it.length;
    }
    strips.push(...mine);
  }
  return strips;
}

/** Sheet counts, with each material identified when more than one is used. */
export function sheetSummary(project: Project, plan: CutPlan): string {
  const { preset } = project.material.sheet;
  const total = plan.sheets.length;
  if (plan.counts.length <= 1) return `${total} ${preset} sheet${total === 1 ? '' : 's'}`;
  return `${plan.counts.map((c) => `${c.sheets} × ${c.thickness} mm ${c.material}`).join(' + ')} ${preset} sheets`;
}

/** Each material is packed onto its own sheets, even when their thicknesses match. */
export function planCuts(project: Project, cut: CutList): CutPlan {
  const sheets: PlanSheet[] = [];
  const strips: Strip[] = [];
  const issues: Issue[] = [];
  const counts: CutPlan['counts'] = [];
  let usedArea = 0;
  const materials = [...new Set(cut.groups.map((g) => g.material))];
  if (!materials.length) materials.push('primary');
  for (const material of materials) {
    const groups = cut.groups.filter((g) => g.material === material);
    const thickness = groups[0]?.thickness ?? project.material.thickness;
    const part = planSheets(project, { ...cut, groups }, cutPacking(project, material));
    for (const s of part.sheets) sheets.push({ index: sheets.length, material, thickness, items: s.items });
    strips.push(...part.strips);
    issues.push(...part.issues);
    usedArea += part.usedArea;
    counts.push({ material, thickness, sheets: part.sheets.length });
  }
  const { width, height } = project.material.sheet;
  const efficiency = sheets.length ? usedArea / (sheets.length * width * height) : 0;
  return { sheets, counts, strips, issues, efficiency };
}

function planSheets(project: Project, cut: CutList, packing: CutLayout) {
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
      issues.push({ level: 'error', message: `${panelUse(b.g)} #${b.g.number} (${b.g.length} × ${b.g.height}) does not fit a ${sheet.preset} sheet.` });
      continue;
    }
    baseItems.push({ id: b.id, w: b.g.length, h: b.g.height });
  }

  if (packing === 'strips') return { ...planBands(project, fitting, bases.filter((b) => fitsSheet(b.g.length, b.g.height)), usableW, usableH), issues };
  const packer = packing === 'guillotine' ? packGuillotine : pack;

  // Long strips mean fewer cuts, but shorter ones fit the gaps beside the bases. Try full-length
  // strips, strips as long as the sheet's short side, and one piece per strip; keep the fewest sheets.
  let best: { strips: Strip[]; items: { id: string; w: Mm; h: Mm }[]; result: ReturnType<typeof pack> } | undefined;
  for (const limit of [maxLen, Math.min(usableW, usableH), 0]) {
    const strips = buildStrips(fitting, limit, kerf);
    const items = [...baseItems, ...strips.map((s) => ({ id: `s${s.id}`, w: s.used, h: s.height }))];
    const result = packer(items, usableW, usableH, kerf);
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
    sheets[pl.sheet].items.push({ kind: g ? 'base' : 'strip', group: g, strip: s, along: s ? (pl.rotated ? 'y' : 'x') : undefined, x: trim + pl.x, y: trim + pl.y, w, h });
    usedArea += it.w * it.h;
  }
  for (const id of result.unplaced) issues.push({ level: 'error', message: `Could not place ${id} on a sheet.` });
  return { sheets, strips, issues, usedArea };
}

/**
 * Strips across the sheet: the sheet is cut into bands running its full length, then each band is
 * cut into lengths. Pieces go tallest first into the band that fits them most tightly (first fit
 * decreasing height); one narrower than its band is trimmed after the crosscut. Every cut runs edge
 * to edge, and all first cuts are parallel.
 */
function planBands(project: Project, cut: CutList, bases: { id: string; g: PieceGroup }[], usableW: Mm, usableH: Mm) {
  const { trim, kerf } = project.material;
  const EPS = 1e-6;
  const longX = usableW >= usableH;
  const L = Math.max(usableW, usableH);
  const S = Math.min(usableW, usableH);
  type Item = { kind: 'base' | 'piece'; g: PieceGroup; len: Mm; ht: Mm };
  const items: Item[] = [];
  // A base lies along the band when it can, so its short side sets the band's width.
  for (const b of bases) {
    const lies = b.g.length <= L + EPS && b.g.height <= S + EPS;
    items.push({ kind: 'base', g: b.g, len: lies ? b.g.length : b.g.height, ht: lies ? b.g.height : b.g.length });
  }
  for (const g of cut.groups) if (g.kind === 'strip') for (let i = 0; i < g.pieces.length; i++) items.push({ kind: 'piece', g, len: g.length, ht: g.height });
  items.sort((a, b) => b.ht - a.ht || b.len - a.len || a.g.number - b.g.number);

  type Band = { sheet: number; at: Mm; ht: Mm; used: Mm; items: Item[] };
  const bands: Band[] = [];
  /** How far across each sheet the bands reach. */
  const across: Mm[] = [];
  for (const it of items) {
    let band: Band | undefined;
    for (const b of bands) {
      if (b.ht + EPS < it.ht || b.used + (b.items.length ? kerf : 0) + it.len > L + EPS) continue;
      if (!band || b.ht < band.ht - EPS) band = b;
    }
    if (!band) {
      let s = across.findIndex((u) => u + kerf + it.ht <= S + EPS);
      if (s < 0) {
        s = across.length;
        across.push(-kerf);
      }
      band = { sheet: s, at: across[s] + kerf, ht: it.ht, used: 0, items: [] };
      across[s] += kerf + it.ht;
      bands.push(band);
    }
    band.used += (band.items.length ? kerf : 0) + it.len;
    band.items.push(it);
  }

  const sheets = Array.from({ length: across.length }, (_, index) => ({ index, items: [] as SheetItem[] }));
  const strips: Strip[] = [];
  let usedArea = 0;
  const rect = (along: Mm, at: Mm, len: Mm, ht: Mm) =>
    longX ? { x: trim + along, y: trim + at, w: len, h: ht } : { x: trim + at, y: trim + along, w: ht, h: len };
  bands.forEach((b, bi) => {
    let pos = 0;
    let run: Strip | undefined;
    let runStart = 0;
    // Consecutive pieces of one width share a strip; a base stands on its own.
    const flush = () => {
      if (!run) return;
      sheets[b.sheet].items.push({ kind: 'strip', strip: run, along: longX ? 'x' : 'y', ...rect(runStart, b.at, run.used, run.height) });
      strips.push(run);
      run = undefined;
    };
    b.items.forEach((it, k) => {
      if (k) pos += kerf;
      if (it.kind === 'base') {
        flush();
        sheets[b.sheet].items.push({ kind: 'base', group: it.g, ...rect(pos, b.at, it.len, it.ht) });
      } else {
        if (!run || run.height !== it.ht) {
          flush();
          run = { id: `${it.g.material}:band${bi}-${k}`, height: it.ht, cuts: [], used: -kerf };
          runStart = pos;
        }
        run.cuts.push({ group: it.g.number, length: it.len });
        run.used += kerf + it.len;
      }
      pos += it.len;
      usedArea += it.len * it.ht;
    });
    flush();
  });
  return { sheets, strips, usedArea };
}
