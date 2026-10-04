/**
 * Cut list: groups identical pieces, suggests merging near-identical ones, and plans the cutting
 * the way sheet material is cut in bulk: walls and dividers of one height come from strips of that
 * width, bases are cut as rectangles, and everything is packed onto sheets.
 */
import { mm, roundTo } from './geom';
import { rotateLidNotches, type LidNotch } from './lidNotches';
import type { Issue, Low, Notch, PieceInst, Solved } from './layout';
import { pack, packGuillotine } from './pack';
import type { CutLayout, MaterialKind, Mm, Project, SheetSpec } from './types';

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

/** The sheet a material is cut from: the secondary's own size when it has one. */
export function sheetFor(project: Project, material: MaterialKind): SheetSpec {
  return (material === 'secondary' ? project.material.secondarySheet : undefined) ?? project.material.sheet;
}

/** "A3", or the dimensions of a custom sheet. */
export function sheetName(sheet: SheetSpec): string {
  return sheet.preset === 'Custom' ? `${mm(sheet.width)} × ${mm(sheet.height)} mm` : sheet.preset;
}

const sameSize = (a: SheetSpec, b: SheetSpec) => a.width === b.width && a.height === b.height;

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
  /** In order along the strip. `turned`: the piece lies across, its height along the strip. */
  cuts: { group: number; length: Mm; turned?: boolean }[];
  used: Mm;
}

export interface SheetItem {
  kind: 'base' | 'strip';
  group?: PieceGroup;
  strip?: Strip;
  /** Strips: the sheet axis their length runs along. */
  along?: 'x' | 'y';
  /**
   * Strips packing: the full-length strip (band) this item is cut from, numbered from 0 across the
   * sheet, and that strip's width. A piece narrower than its band is trimmed after the crosscut.
   */
  band?: { index: number; width: Mm; across: Mm };
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
  /** Its size: each material can come in its own sheet size. */
  sheet: SheetSpec;
  items: SheetItem[];
}

export interface CutPlan {
  /** Grouped by material, in cut-list order. */
  sheets: PlanSheet[];
  /** How many sheets of each material, and their size. */
  counts: { material: MaterialKind; thickness: Mm; sheet: SheetSpec; sheets: number }[];
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

/** "#3 285, #8 102 ×2": a strip's cuts in order, repeats of one size counted. */
function cutsText(cuts: Strip['cuts']): string {
  const parts: string[] = [];
  for (let i = 0; i < cuts.length; ) {
    let j = i;
    while (j + 1 < cuts.length && cuts[j + 1].group === cuts[i].group && !!cuts[j + 1].turned === !!cuts[i].turned) j++;
    const n = j - i + 1;
    parts.push(`#${cuts[i].group} ${mm(cuts[i].length)}${cuts[i].turned ? ' (turned)' : ''}${n > 1 ? ` ×${n}` : ''}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/**
 * What to cut on one sheet, in order. With strips packing, each line is one full-length strip:
 * cut it at its width, then cut it into the listed pieces, trimming any that are narrower than the
 * strip. Other packings list each strip and panel where it sits.
 */
export function sheetSteps(sheet: PlanSheet): string[] {
  const panel = (item: SheetItem) => `${item.group ? panelUse(item.group) : 'panel'} #${item.group?.number} ${mm(item.group?.length ?? 0)} × ${mm(item.group?.height ?? 0)}`;
  if (!sheet.items.some((it) => it.band)) {
    return sheet.items.map((it) =>
      it.kind === 'base' ? `${cap(panel(it))} mm.` : `Strip ${mm(it.strip!.height)} mm wide, ${mm(it.strip!.used)} mm long → ${cutsText(it.strip!.cuts)}.`,
    );
  }
  const bands = new Map<number, SheetItem[]>();
  for (const it of sheet.items) bands.set(it.band!.index, [...(bands.get(it.band!.index) ?? []), it]);
  return [...bands.values()].map((items, k) => {
    const width = items[0].band!.width;
    const parts = items.map((it) => {
      // Anything narrower than its strip is trimmed to width after it is cut off.
      const trim = it.band!.across < width - 1e-6 ? `, trimmed to ${mm(it.band!.across)} mm wide` : '';
      return it.kind === 'base' ? `${panel(it)}${trim}` : `${cutsText(it.strip!.cuts)}${trim}`;
    });
    return `Strip ${k + 1}: cut a ${mm(width)} mm wide strip along the full length of the sheet, then cut it into ${parts.join('; then ')}.`;
  });
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * What to buy: "3 A3 sheets", "1 × 3 mm secondary + 3 × 5 mm primary A3 sheets", or, when the
 * materials come in different sizes, "1 × 3 mm secondary A2 + 3 × 5 mm primary A3 sheets".
 */
export function sheetSummary(project: Project, plan: CutPlan): string {
  const total = plan.sheets.length;
  const plural = (n: number) => `sheet${n === 1 ? '' : 's'}`;
  if (!plan.counts.length) return `${total} ${sheetName(project.material.sheet)} ${plural(total)}`;
  if (plan.counts.length === 1) return `${total} ${sheetName(plan.counts[0]!.sheet)} ${plural(total)}`;
  if (plan.counts.every((c) => sameSize(c.sheet, plan.counts[0]!.sheet))) {
    return `${plan.counts.map((c) => `${c.sheets} × ${c.thickness} mm ${c.material}`).join(' + ')} ${sheetName(plan.counts[0]!.sheet)} ${plural(total)}`;
  }
  return `${plan.counts.map((c) => `${c.sheets} × ${c.thickness} mm ${c.material} ${sheetName(c.sheet)}`).join(' + ')} ${plural(total)}`;
}

/** The distinct sheet sizes a plan uses, e.g. "297 × 420 mm" or "A3 297 × 420 mm, A2 420 × 594 mm". */
export function sheetSizes(plan: CutPlan): string {
  const sizes = plan.counts.map((c) => c.sheet).filter((s, i, all) => all.findIndex((o) => sameSize(o, s)) === i);
  if (sizes.length === 1) return `${mm(sizes[0]!.width)} × ${mm(sizes[0]!.height)} mm`;
  return sizes.map((s) => `${s.preset === 'Custom' ? '' : `${s.preset} `}${mm(s.width)} × ${mm(s.height)} mm`).join(', ');
}

/** Each material is packed onto its own sheets, even when their thicknesses match. */
export function planCuts(project: Project, cut: CutList): CutPlan {
  const sheets: PlanSheet[] = [];
  const strips: Strip[] = [];
  const issues: Issue[] = [];
  const counts: CutPlan['counts'] = [];
  let usedArea = 0;
  let sheetArea = 0;
  const materials = [...new Set(cut.groups.map((g) => g.material))];
  if (!materials.length) materials.push('primary');
  for (const material of materials) {
    const groups = cut.groups.filter((g) => g.material === material);
    const thickness = groups[0]?.thickness ?? project.material.thickness;
    const sheet = sheetFor(project, material);
    const part = planSheets(project, { ...cut, groups }, cutPacking(project, material), sheet);
    for (const s of part.sheets) sheets.push({ index: sheets.length, material, thickness, sheet, items: s.items });
    strips.push(...part.strips);
    issues.push(...part.issues);
    usedArea += part.usedArea;
    sheetArea += part.sheets.length * sheet.width * sheet.height;
    counts.push({ material, thickness, sheet, sheets: part.sheets.length });
  }
  const efficiency = sheetArea ? usedArea / sheetArea : 0;
  return { sheets, counts, strips, issues, efficiency };
}

function planSheets(project: Project, cut: CutList, packing: CutLayout, sheet: SheetSpec) {
  const { trim, kerf } = project.material;
  const usableW = sheet.width - 2 * trim;
  const usableH = sheet.height - 2 * trim;
  const maxLen = Math.max(usableW, usableH);
  const issues: Issue[] = [];

  // Pieces that can never fit, either way round, are reported once per cut size and left out.
  const fitsSheet = (w: Mm, h: Mm) => (w <= usableW + 1e-6 && h <= usableH + 1e-6) || (h <= usableW + 1e-6 && w <= usableH + 1e-6);
  const fits = (g: PieceGroup) => {
    if (fitsSheet(g.length, g.height)) return true;
    const what = g.kind === 'base' ? `${panelUse(g)} #${g.number}` : `#${g.number}`;
    issues.push({
      level: 'error',
      message: `${what} (${mm(g.length)} × ${mm(g.height)} mm${g.pieces.length > 1 ? `, ×${g.pieces.length}` : ''}) does not fit the usable ${mm(usableW)} × ${mm(usableH)} mm of a ${sheetName(sheet)} sheet after trimming.`,
    });
    return false;
  };
  const fitting: CutList = { ...cut, groups: cut.groups.filter(fits) };

  const bases = fitting.groups.filter((g) => g.kind === 'base').flatMap((g) => g.pieces.map((p, i) => ({ id: `b${g.number}-${i}`, g })));
  const baseItems = bases.map((b) => ({ id: b.id, w: b.g.length, h: b.g.height }));

  if (packing === 'strips') return { ...planBands(project, fitting, bases, usableW, usableH), issues };
  const packer = packing === 'guillotine' ? packGuillotine : pack;

  // Long strips mean fewer cuts, but shorter ones fit the gaps beside the bases. Try full-length
  // strips, strips as long as the sheet's short side, and one piece per strip; keep the fewest sheets.
  // A strip left out loses every piece in it, so compare tries by pieces left out, then sheets.
  let best: { strips: Strip[]; items: { id: string; w: Mm; h: Mm }[]; result: ReturnType<typeof pack>; lost: number } | undefined;
  for (const limit of [maxLen, Math.min(usableW, usableH), 0]) {
    const strips = buildStrips(fitting, limit, kerf);
    const items = [...baseItems, ...strips.map((s) => ({ id: `s${s.id}`, w: s.used, h: s.height }))];
    const result = packer(items, usableW, usableH, kerf);
    const cutsIn = new Map(strips.map((s) => [`s${s.id}`, s.cuts.length]));
    const lost = result.unplaced.reduce((n, id) => n + (cutsIn.get(id) ?? 1), 0);
    if (!best || lost < best.lost || (lost === best.lost && result.sheetCount < best.result.sheetCount)) best = { strips, items, result, lost };
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
    // Only the pieces count as used: the kerf between a strip's cuts is waste.
    usedArea += s ? s.cuts.reduce((a, c) => a + c.length, 0) * s.height : it.w * it.h;
  }
  if (result.unplaced.length) {
    const lostGroups = new Map<number, number>();
    for (const id of result.unplaced) {
      const s = stripById.get(id);
      for (const n of s ? s.cuts.map((c) => c.group) : [baseById.get(id)!.number]) lostGroups.set(n, (lostGroups.get(n) ?? 0) + 1);
    }
    const what = [...lostGroups].map(([n, k]) => `#${n}${k > 1 ? ` ×${k}` : ''}`).join(', ');
    issues.push({ level: 'error', message: `Could not place ${what} on a ${sheetName(sheet)} sheet; those pieces are missing from the plan.` });
  }
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
  type Item = { kind: 'base' | 'piece'; g: PieceGroup; len: Mm; ht: Mm; turned?: boolean };
  const items: Item[] = [];
  // A base lies along the band when it can, so its short side sets the band's width.
  for (const b of bases) {
    const lies = b.g.length <= L + EPS && b.g.height <= S + EPS;
    items.push({ kind: 'base', g: b.g, len: lies ? b.g.length : b.g.height, ht: lies ? b.g.height : b.g.length });
  }
  // A wall or divider taller than the sheet is wide is cut the other way round, when that fits.
  for (const g of cut.groups) {
    if (g.kind !== 'strip') continue;
    const lies = g.length <= L + EPS && g.height <= S + EPS;
    for (let i = 0; i < g.pieces.length; i++) items.push({ kind: 'piece', g, len: lies ? g.length : g.height, ht: lies ? g.height : g.length, ...(lies ? {} : { turned: true }) });
  }
  items.sort((a, b) => b.ht - a.ht || b.len - a.len || a.g.number - b.g.number);

  type Band = { sheet: number; index: number; at: Mm; ht: Mm; used: Mm; items: Item[] };
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
      band = { sheet: s, index: bands.filter((b) => b.sheet === s).length, at: across[s] + kerf, ht: it.ht, used: 0, items: [] };
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
      sheets[b.sheet].items.push({ kind: 'strip', strip: run, along: longX ? 'x' : 'y', band: { index: b.index, width: b.ht, across: run.height }, ...rect(runStart, b.at, run.used, run.height) });
      strips.push(run);
      run = undefined;
    };
    b.items.forEach((it, k) => {
      if (k) pos += kerf;
      if (it.kind === 'base') {
        flush();
        sheets[b.sheet].items.push({ kind: 'base', group: it.g, band: { index: b.index, width: b.ht, across: it.ht }, ...rect(pos, b.at, it.len, it.ht) });
      } else {
        if (!run || run.height !== it.ht) {
          flush();
          run = { id: `${it.g.material}:band${bi}-${k}`, height: it.ht, cuts: [], used: -kerf };
          runStart = pos;
        }
        run.cuts.push({ group: it.g.number, length: it.len, ...(it.turned ? { turned: true } : {}) });
        run.used += kerf + it.len;
      }
      pos += it.len;
      usedArea += it.len * it.ht;
    });
    flush();
  });
  return { sheets, strips, usedArea };
}
