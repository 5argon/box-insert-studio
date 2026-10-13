/**
 * Cut list: groups identical pieces, suggests merging near-identical ones, and plans the cutting
 * the way sheet material is cut in bulk: walls and dividers of one height come from strips of that
 * width, bases are cut as rectangles, and everything is packed onto sheets.
 */
import { mm, roundTo, type Rect } from './geom';
import { rotateLidNotches, type LidNotch } from './lidNotches';
import type { Issue, Low, Notch, PieceInst, Solved } from './layout';
import { pack, packGuillotine, type PackItem, type PackResult } from './pack';
import type { CutAlong, CutLayout, CutSetup, MaterialKind, Mm, Project, SheetSpec } from './types';

/** Sheet packing choices, in the order they are offered. */
export const CUT_LAYOUTS: { value: CutLayout; name: string; detail: string }[] = [
  {
    value: 'strips',
    name: 'Strips across the sheet',
    detail: 'Cut the sheet into full-length strips first, then cut each strip into lengths; trim a piece where it is narrower than its strip.',
  },
  {
    value: 'guillotine',
    name: 'Edge-to-edge cuts',
    detail: 'Every cut runs all the way across the piece of sheet in hand, so a straightedge or saw fence always reaches end to end.',
  },
  { value: 'fewest', name: 'Fewest sheets', detail: 'Pieces fill any free space, either way round. Some cuts stop partway across the sheet.' },
];

/** The sheet edge the longest cuts can run along, in the order offered. */
export const CUT_ALONGS: { value: CutAlong; name: string; detail: string }[] = [
  { value: 'short', name: 'Short edge', detail: 'The longest cuts run across the sheet, so a ruler as long as its short edge reaches them wherever the pieces allow.' },
  { value: 'long', name: 'Long edge', detail: 'The longest cuts run the length of the sheet: fewer, longer cuts, for a ruler as long as the sheet.' },
];

/** Do the full-length strips of strips packing run along x, on a sheet this wide and tall? Fewest-sheets packing has no say in it. */
const stripsAlongX = (setup: CutSetup, w: Mm, h: Mm) => (setup.cutAlong === 'short' ? w < h : w >= h);

/** The sheet a material is cut from: the secondary's own size when it has one. */
export function sheetFor(setup: CutSetup, material: MaterialKind): SheetSpec {
  return (material === 'secondary' ? setup.secondarySheet : undefined) ?? setup.sheet;
}

/** "A3", or the dimensions of a custom sheet. */
export function sheetName(sheet: SheetSpec): string {
  return sheet.preset === 'Custom' ? `${mm(sheet.width)} × ${mm(sheet.height)} mm` : sheet.preset;
}

const sameSize = (a: SheetSpec, b: SheetSpec) => a.width === b.width && a.height === b.height;

/** Each material has its own packing. */
export function cutPacking(setup: CutSetup, material: MaterialKind): CutLayout {
  return material === 'secondary' ? setup.secondaryLayout : setup.layout;
}

/** Does the design have a secondary material? Without one there is no "primary" to tell apart. */
export const twoMaterials = (project: Project) => project.material.secondaryThickness !== undefined;

/**
 * A material label shared by the cut list, cutting plan and assembly instructions. `sole`: the
 * design's only material, named by its thickness alone.
 */
export function materialLabel(material: MaterialKind, thickness: Mm, sole = false): string {
  if (sole) return `${mm(thickness)} mm material`;
  return `${material === 'secondary' ? 'Secondary' : 'Primary'} material (${mm(thickness)} mm)`;
}

/**
 * The cuts made into some pieces of one size once they are cut out: one shape per distinct set of
 * finger notches, lid notches and lowered stretches. Pieces left as plain rectangles have none.
 */
export interface PieceShape {
  /** The size of the pieces, as their group's. */
  length: Mm;
  height: Mm;
  /** Notches measured from the end that the assembly steps call the start. */
  notches: Notch[];
  /** Edge cuts on flat lids, in the group's orientation (long edge across). */
  lidNotches?: LidNotch[];
  /** Lowered stretches, measured from the same end as the notches. */
  lows: Low[];
  pieces: PieceInst[];
  key: string;
}

/** Every piece of one size from one material: one number, cut out alike whatever is cut into it later. */
export interface PieceGroup {
  number: number;
  kind: 'base' | 'strip';
  /** Flat panel: width × depth (width ≥ depth). Strip piece: length × height. */
  length: Mm;
  height: Mm;
  /** Thickness of the material selected for these pieces. */
  thickness: Mm;
  material: MaterialKind;
  /** What is then cut into some of them; the rest stay plain. */
  shapes: PieceShape[];
  pieces: PieceInst[];
  key: string;
}

/** The shape a piece is cut to after it is cut out, if it is not left plain. */
export function shapeOf(cut: CutList, piece: PieceInst): PieceShape | undefined {
  return cut.groupOf.get(piece.id)?.shapes.find((s) => s.pieces.includes(piece));
}

/**
 * The cut list as plain text, to paste elsewhere: each material's thickness first, then one line
 * per size with how many of it. A panel and a wall of one size are one line, being cut alike, and
 * the materials go by thickness alone: primary and secondary mean nothing outside the design.
 */
export function cutListText(cut: CutList): string {
  const blocks = new Map<MaterialKind, { thickness: Mm; sizes: Map<string, number> }>();
  for (const g of cut.groups) {
    const block = blocks.get(g.material) ?? { thickness: g.thickness, sizes: new Map<string, number>() };
    const size = `${mm(g.length)} × ${mm(g.height)} mm`;
    block.sizes.set(size, (block.sizes.get(size) ?? 0) + g.pieces.length);
    blocks.set(g.material, block);
  }
  return [...blocks.values()]
    .map((b) => [`Material thickness: ${mm(b.thickness)} mm`, ...[...b.sizes].map(([size, n]) => `${size}, ${n} ${n === 1 ? 'pc' : 'pcs'}`)].join('\n'))
    .join('\n\n');
}

/** Uses of a group of flat rectangles: bases, lids and/or pads. Empty for strips. */
export function panelUse(g: PieceGroup): string {
  if (g.kind !== 'base') return '';
  return [...new Set(g.pieces.map((p) => p.kind))].sort().join(', ');
}

export interface CutList {
  groups: PieceGroup[];
  groupOf: Map<string, PieceGroup>;
  /** True when the piece is used flipped end-for-end relative to its shape's notch positions. */
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
    let shapeKey = '';
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
        shapeKey = `lid:${shape.key}`;
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
      key = `strip:${p.material}:${p.thickness}:${L}x${H}`;
      if (notches.length || lows.length) shapeKey = `${notchKey(notches)}|${lowKey(lows)}`;
    }
    let g = map.get(key);
    if (!g) {
      g = { number: 0, kind: flat ? 'base' : 'strip', length, height, thickness: p.thickness, material: p.material, shapes: [], pieces: [], key };
      map.set(key, g);
    }
    g.pieces.push(p);
    if (shapeKey) {
      let shape = g.shapes.find((s) => s.key === shapeKey);
      if (!shape) {
        shape = { length, height, notches, lows, pieces: [], key: shapeKey };
        if (lidNotches) shape.lidNotches = lidNotches;
        g.shapes.push(shape);
      }
      shape.pieces.push(p);
    }
    groupOf.set(p.id, g);
    if (flip) flipped.add(p.id);
  }

  const groups = [...map.values()].sort((a, b) => {
    if (a.material !== b.material) return a.material === 'secondary' ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'base' ? -1 : 1;
    // Panels from one sheet thickness stay together.
    if (a.kind === 'base') return a.thickness - b.thickness || b.length * b.height - a.length * a.height || (a.key < b.key ? -1 : 1);
    return b.height - a.height || b.length - a.length || (a.key < b.key ? -1 : 1);
  });
  groups.forEach((g, i) => {
    g.number = i + 1;
    g.shapes.sort((a, b) => a.notches.length - b.notches.length || (a.key < b.key ? -1 : 1));
  });

  const hints: Issue[] = [];
  const strips = groups.filter((g) => g.kind === 'strip');
  for (let i = 0; i < strips.length; i++) {
    for (let j = i + 1; j < strips.length; j++) {
      const a = strips[i];
      const b = strips[j];
      if (a.material !== b.material || a.thickness !== b.thickness || a.shapes.length || b.shapes.length) continue;
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
  /** Holds pieces of removable boxes only, when those are cut from sheets of their own. */
  boxes?: boolean;
  items: SheetItem[];
}

export interface CutPlan {
  /** Grouped by material, in cut-list order; sheets of their own for removable boxes come after the rest. */
  sheets: PlanSheet[];
  /** How many sheets of each material, and their size; `boxes`: those for removable boxes alone. */
  counts: { material: MaterialKind; thickness: Mm; sheet: SheetSpec; sheets: number; boxes?: boolean }[];
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

/** "#3 285 mm, #8 102 mm ×2": a strip's cuts in order, repeats of one size counted. */
function cutsText(cuts: Strip['cuts']): string {
  const parts: string[] = [];
  for (let i = 0; i < cuts.length; ) {
    let j = i;
    while (j + 1 < cuts.length && cuts[j + 1].group === cuts[i].group && !!cuts[j + 1].turned === !!cuts[i].turned) j++;
    const n = j - i + 1;
    parts.push(`#${cuts[i].group} ${mm(cuts[i].length)} mm${cuts[i].turned ? ' (turned)' : ''}${n > 1 ? ` ×${n}` : ''}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** A straight cut right across the piece of sheet in hand, in sheet coordinates. */
export interface CutLine {
  x1: Mm;
  y1: Mm;
  x2: Mm;
  y2: Mm;
}

/** A stretch of a cutting step's text. With `cuts` it is one action: make those cuts to get `area`. */
export interface StepPart {
  text: string;
  cuts?: CutLine[];
  area?: Rect;
}

/** One cutting step, with what its piece is then cut into listed under it. */
export interface SheetStep {
  parts: StepPart[];
  then?: SheetStep[];
}

/**
 * What to cut on one sheet, in order. With strips packing, each step is one full-length strip:
 * cut it at its width, then cut it into the pieces listed under it, trimming any that are narrower
 * than the strip. Edge-to-edge packing takes one cut at a time, vertical or horizontal as drawn,
 * each from what the step before left; a cut that frees several items lists cutting those up under
 * it. Both name the cuts of every action, so the plan can show them; fewest sheets only lists what
 * is on the sheet.
 */
export function sheetSteps(setup: CutSetup, sheet: PlanSheet): SheetStep[] {
  const { trim, kerf } = setup;
  if (sheet.items.some((it) => it.band)) return bandSteps(sheet, trim, kerf, stripsAlongX(setup, sheet.sheet.width, sheet.sheet.height));
  if (cutPacking(setup, sheet.material) !== 'guillotine') {
    return sheet.items.map((it) => ({
      parts: [{ text: it.kind === 'base' ? `${panelText(it)}.` : `Strip ${mm(it.strip!.height)} mm wide, ${mm(it.strip!.used)} mm long → ${cutsText(it.strip!.cuts)}.` }],
    }));
  }
  const usable = { x: trim, y: trim, w: sheet.sheet.width - 2 * trim, h: sheet.sheet.height - 2 * trim };
  return cutOrder(sheet.items, usable, kerf).map((o, i) => offcutStep(o, i ? 'the remaining piece' : 'the sheet', kerf));
}

/** An edge-to-edge step: the cut into `piece`, then what comes off it. */
function offcutStep(o: Offcut, piece: string, kerf: Mm): SheetStep {
  const side = o.cut?.axis === 'x' ? 'left' : 'top';
  const cut = o.cut && `Cut ${piece} ${o.cut.axis === 'x' ? 'vertically' : 'horizontally'}, ${mm(o.cut.at)} mm from the ${side}`;
  if ('then' in o) {
    const then = o.then.map((x, i) => offcutStep(x, i ? 'the remaining piece' : 'it', kerf));
    return { parts: [{ text: cut!, cuts: [o.cut.line], area: o.area }, { text: `, then cut up the ${side} piece:` }], then };
  }
  const it = o.item;
  const strip = it.strip;
  // The cut past a strip's last piece is one of its crosscuts; only trimming its width is told apart.
  const crosscut = (c: CutLine) => !!strip && (it.along === 'x' ? c.x1 === c.x2 : c.y1 === c.y2);
  const trims = o.trims.filter((c) => !crosscut(c));
  const to = strip ? `${mm(strip.height)} mm wide` : 'size';
  const text = cut ? `${cut}${trims.length ? `, and trim it to ${to}` : ''}` : trims.length ? `Trim ${piece} to ${to}` : cap(piece);
  const area = { x: it.x, y: it.y, w: it.w, h: it.h };
  const head: StepPart[] = [{ text, cuts: [...(o.cut ? [o.cut.line] : []), ...trims], area }, { text: ' → ' }];
  if (!strip) return { parts: [...head, { text: `${panelText(it)}.` }] };
  // Crosscuts between the strip's pieces; one piece that fills its strip needs none.
  const crosscuts = o.trims.filter(crosscut);
  let at = (it.along === 'x' ? it.x : it.y) - kerf / 2;
  for (const c of strip.cuts.slice(0, -1)) {
    at += c.length + kerf;
    crosscuts.push(it.along === 'x' ? { x1: at, y1: it.y, x2: at, y2: it.y + it.h } : { x1: it.x, y1: at, x2: it.x + it.w, y2: at });
  }
  return { parts: [...head, { text: cutsText(strip.cuts), ...(crosscuts.length ? { cuts: crosscuts, area } : {}) }, { text: '.' }] };
}

const panelText = (item: SheetItem) => cap(`${item.group ? panelUse(item.group) : 'panel'} #${item.group?.number} ${mm(item.group?.length ?? 0)} × ${mm(item.group?.height ?? 0)} mm`);

function bandSteps(sheet: PlanSheet, trim: Mm, kerf: Mm, longX: boolean): SheetStep[] {
  const EPS = 1e-6;
  const full = (longX ? sheet.sheet.width >= sheet.sheet.height : sheet.sheet.height >= sheet.sheet.width) ? 'along the full length' : 'across the full width';
  /** Far ends of the usable sheet, along the strips and across them. */
  const end = (longX ? sheet.sheet.width : sheet.sheet.height) - trim;
  const far = (longX ? sheet.sheet.height : sheet.sheet.width) - trim;
  const rect = (along: Mm, across: Mm, len: Mm, wid: Mm): Rect => (longX ? { x: along, y: across, w: len, h: wid } : { x: across, y: along, w: wid, h: len });
  const rip = (across: Mm, from: Mm, to: Mm): CutLine => (longX ? { x1: from, y1: across, x2: to, y2: across } : { x1: across, y1: from, x2: across, y2: to });
  const cross = (along: Mm, from: Mm, to: Mm): CutLine => (longX ? { x1: along, y1: from, x2: along, y2: to } : { x1: from, y1: along, x2: to, y2: along });

  const bands = new Map<number, SheetItem[]>();
  for (const it of sheet.items) bands.set(it.band!.index, [...(bands.get(it.band!.index) ?? []), it]);
  return [...bands.values()].map((items, k) => {
    const width = items[0].band!.width;
    const at = longX ? items[0].y : items[0].x;
    const strip: StepPart = {
      text: `Strip ${k + 1}: cut a ${mm(width)} mm wide strip ${full} of the sheet`,
      // The last strip can end at the sheet's edge, with nothing left to cut it from.
      cuts: at + width < far - EPS ? [rip(Math.min(at + width + kerf / 2, far), trim, end)] : [],
      area: rect(trim, at, end - trim, width),
    };
    const then = items.map((it): SheetStep => {
      const from = longX ? it.x : it.y;
      const len = longX ? it.w : it.h;
      const narrow = it.band!.across < width - EPS;
      const cuts: CutLine[] = [];
      // Cut it off the strip, unless it reaches the end; then trim what is narrower to width.
      if (from + len < end - EPS) cuts.push(cross(from + len + kerf / 2, at, at + width));
      if (narrow) cuts.push(rip(at + it.band!.across + kerf / 2, from, from + len));
      let pos = from - kerf / 2;
      for (const c of it.strip?.cuts.slice(0, -1) ?? []) {
        pos += c.length + kerf;
        cuts.push(cross(pos, at, at + it.band!.across));
      }
      const trimmed = narrow ? `, trimmed to ${mm(it.band!.across)} mm wide` : '';
      return { parts: [{ text: `${it.kind === 'base' ? panelText(it) : cutsText(it.strip!.cuts)}${trimmed}`, cuts, area: rect(from, at, len, it.band!.across) }, { text: '.' }] };
    });
    return { parts: [strip, { text: ', then cut it into:' }], then };
  });
}

/** A cut right across the piece in hand: its line, the axis it divides, and how far in it is made. */
type Cut = { line: CutLine; axis: 'x' | 'y'; at: Mm };
/**
 * What a cut frees from an edge-to-edge sheet: a strip or panel, with the cuts trimming the waste
 * around it, or a larger piece holding several. The last one needs no cut: it is what remains.
 */
type Offcut = { item: SheetItem; cut?: Cut; trims: CutLine[] } | { area: Rect; cut: Cut; then: Offcut[] };

/**
 * The order to cut an edge-to-edge layout in. Each cut runs right across the piece in hand, the
 * shorter way when it can, and takes one piece off the rest: a strip or panel, or a larger piece
 * that is then cut up the same way.
 */
function cutOrder(all: SheetItem[], usable: Rect, kerf: Mm): Offcut[] {
  const EPS = 1e-6;
  type Axis = 'x' | 'y';
  const hi = (o: Rect, axis: Axis) => o[axis] + (axis === 'x' ? o.w : o.h);
  const line = (r: Rect, axis: Axis, at: Mm): CutLine => (axis === 'x' ? { x1: at, y1: r.y, x2: at, y2: r.y + r.h } : { x1: r.x, y1: at, x2: r.x + r.w, y2: at });
  const span = (r: Rect, axis: Axis, from: Mm, to: Mm): Rect => (axis === 'x' ? { ...r, x: from, w: to - from } : { ...r, y: from, h: to - from });
  /** Lists what `items` are cut into, given the piece `r` they are on and the `cut` that freed it. */
  const walk = (items: SheetItem[], r: Rect, cut: Cut | undefined, out: Offcut[]) => {
    const axes: Axis[] = r.w >= r.h ? ['x', 'y'] : ['y', 'x'];
    for (const axis of axes) {
      for (const c of items.map((o) => hi(o, axis)).sort((a, b) => a - b)) {
        // A cut just past an item that goes through no other and leaves some on the far side.
        const before = items.filter((o) => hi(o, axis) <= c + EPS);
        if (before.length === items.length || items.some((o) => o[axis] < c - EPS && hi(o, axis) > c + EPS)) continue;
        const off = span(r, axis, r[axis], c);
        const freeing = { line: line(r, axis, c + kerf / 2), axis, at: c - r[axis] };
        if (before.length === 1) walk(before, off, freeing, out);
        else {
          const then: Offcut[] = [];
          walk(before, off, undefined, then);
          out.push({ area: off, cut: freeing, then });
        }
        walk(items.filter((o) => hi(o, axis) > c + EPS), span(r, axis, Math.min(c + kerf, hi(r, axis)), hi(r, axis)), undefined, out);
        return;
      }
    }
    // One item left on the piece: trim the waste off each side of it.
    const [item] = items;
    const trims: CutLine[] = [];
    for (const axis of items.length === 1 ? axes : []) {
      if (item[axis] > r[axis] + EPS) {
        trims.push(line(r, axis, item[axis] - kerf / 2));
        r = span(r, axis, item[axis], hi(r, axis));
      }
      if (hi(item, axis) < hi(r, axis) - EPS) {
        trims.push(line(r, axis, Math.min(hi(item, axis) + kerf / 2, hi(r, axis))));
        r = span(r, axis, r[axis], hi(item, axis));
      }
    }
    items.forEach((it, i) => out.push({ item: it, trims, ...(i ? {} : { cut }) }));
  };
  const out: Offcut[] = [];
  walk(all, usable, undefined, out);
  return out;
}

/** The longest cut it takes to free a piece and cut up what is on it. */
function longestOf(o: Offcut): Mm {
  const length = (c: CutLine) => Math.abs(c.x2 - c.x1) + Math.abs(c.y2 - c.y1);
  return Math.max(o.cut ? length(o.cut.line) : 0, ...('then' in o ? o.then.map(longestOf) : o.trims.map(length)));
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * What to buy: "3 A3 sheets", "1 × 3 mm secondary + 3 × 5 mm primary A3 sheets", or, when the
 * materials come in different sizes, "1 × 3 mm secondary A2 + 3 × 5 mm primary A3 sheets". Sheets
 * of their own for removable boxes are counted apart: "3 A3 sheets + 1 A3 sheet for removable boxes".
 */
export function sheetSummary(plan: CutPlan): string {
  const plural = (n: number) => `sheet${n === 1 ? '' : 's'}`;
  if (!plan.counts.length) return `${plan.sheets.length} ${plural(plan.sheets.length)}`;
  const named = new Set(plan.counts.map((c) => c.material)).size > 1;
  const list = (counts: CutPlan['counts']) => {
    const total = counts.reduce((n, c) => n + c.sheets, 0);
    if (!named) return `${total} ${sheetName(counts[0]!.sheet)} ${plural(total)}`;
    if (counts.every((c) => sameSize(c.sheet, counts[0]!.sheet))) {
      return `${counts.map((c) => `${c.sheets} × ${c.thickness} mm ${c.material}`).join(' + ')} ${sheetName(counts[0]!.sheet)} ${plural(total)}`;
    }
    return `${counts.map((c) => `${c.sheets} × ${c.thickness} mm ${c.material} ${sheetName(c.sheet)}`).join(' + ')} ${plural(total)}`;
  };
  const rest = plan.counts.filter((c) => !c.boxes);
  const boxes = plan.counts.filter((c) => c.boxes);
  return [...(rest.length ? [list(rest)] : []), ...(boxes.length ? [`${list(boxes)} for removable boxes`] : [])].join(' + ');
}

/** The distinct sheet sizes a plan uses, e.g. "297 × 420 mm" or "A3 297 × 420 mm, A2 420 × 594 mm". */
export function sheetSizes(plan: CutPlan): string {
  const sizes = plan.counts.map((c) => c.sheet).filter((s, i, all) => all.findIndex((o) => sameSize(o, s)) === i);
  if (sizes.length === 1) return `${mm(sizes[0]!.width)} × ${mm(sizes[0]!.height)} mm`;
  return sizes.map((s) => `${s.preset === 'Custom' ? '' : `${s.preset} `}${mm(s.width)} × ${mm(s.height)} mm`).join(', ');
}

/**
 * Each material is packed onto its own sheets, even when their thicknesses match. Removable boxes
 * get sheets of their own in each material when the setup asks: a cut size used by both a tray and
 * a box keeps its number, with as many of it on each kind of sheet as each needs.
 */
export function planCuts(project: Project, cut: CutList, setup: CutSetup): CutPlan {
  const sheets: PlanSheet[] = [];
  const strips: Strip[] = [];
  const issues: Issue[] = [];
  const counts: CutPlan['counts'] = [];
  let usedArea = 0;
  let sheetArea = 0;
  const materials = [...new Set(cut.groups.map((g) => g.material))];
  const stocks: { material: MaterialKind; boxes?: true; groups: PieceGroup[] }[] = [];
  for (const boxes of setup.separateBoxes ? [false, true] : [undefined]) {
    for (const material of materials) {
      let groups = cut.groups.filter((g) => g.material === material);
      if (boxes !== undefined) groups = groups.map((g) => ({ ...g, pieces: g.pieces.filter((p) => (p.depth === 1) === boxes) })).filter((g) => g.pieces.length);
      if (groups.length) stocks.push({ material, ...(boxes ? { boxes } : {}), groups });
    }
  }
  if (!stocks.length) stocks.push({ material: 'primary', groups: [] });
  for (const { material, boxes, groups } of stocks) {
    const thickness = groups[0]?.thickness ?? project.material.thickness;
    const sheet = sheetFor(setup, material);
    const part = planSheets(setup, { ...cut, groups }, cutPacking(setup, material), sheet);
    for (const s of part.sheets) sheets.push({ index: sheets.length, material, thickness, sheet, ...(boxes ? { boxes } : {}), items: s.items });
    // A material's two kinds of sheet number their strips alike; keep every strip's id its own.
    if (boxes) for (const s of part.strips) s.id = `boxes:${s.id}`;
    strips.push(...part.strips);
    issues.push(...part.issues);
    usedArea += part.usedArea;
    sheetArea += part.sheets.length * sheet.width * sheet.height;
    counts.push({ material, thickness, sheet, sheets: part.sheets.length, ...(boxes ? { boxes } : {}) });
  }
  const efficiency = sheetArea ? usedArea / sheetArea : 0;
  return { sheets, counts, strips, issues, efficiency };
}

function planSheets(setup: CutSetup, cut: CutList, packing: CutLayout, sheet: SheetSpec) {
  const { trim, kerf } = setup;
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

  if (packing === 'strips') return { ...planBands(setup, fitting, bases, usableW, usableH), issues };
  // Edge-to-edge cuts kept short: no strip longer than the sheet's short side, and among packings
  // using as few sheets, the one whose longest cut is shortest.
  const short = packing === 'guillotine' && setup.cutAlong === 'short';
  const usable = { x: trim, y: trim, w: usableW, h: usableH };
  const longestCut = (items: PackItem[], result: PackResult): Mm => {
    const size = new Map(items.map((i) => [i.id, i]));
    const sheets = Array.from({ length: result.sheetCount }, () => [] as SheetItem[]);
    for (const pl of result.placements) {
      const it = size.get(pl.id)!;
      sheets[pl.sheet].push({ kind: 'base', x: trim + pl.x, y: trim + pl.y, w: pl.rotated ? it.h : it.w, h: pl.rotated ? it.w : it.h });
    }
    return Math.max(0, ...sheets.flatMap((s) => cutOrder(s, usable, kerf).map(longestOf)));
  };

  // Long strips mean fewer cuts, but shorter ones fit the gaps beside the bases. Try full-length
  // strips, strips as long as the sheet's short side, and one piece per strip; keep the fewest sheets.
  // A strip left out loses every piece in it, so compare tries by pieces left out, then sheets.
  let best: { strips: Strip[]; items: PackItem[]; result: PackResult; lost: number; cost: Mm } | undefined;
  for (const limit of short ? [Math.min(usableW, usableH), 0] : [maxLen, Math.min(usableW, usableH), 0]) {
    const strips = buildStrips(fitting, limit, kerf);
    const items = [...baseItems, ...strips.map((s) => ({ id: `s${s.id}`, w: s.used, h: s.height }))];
    const result = packing !== 'guillotine' ? pack(items, usableW, usableH, kerf) : packGuillotine(items, usableW, usableH, kerf, short ? (r) => longestCut(items, r) : undefined);
    const cutsIn = new Map(strips.map((s) => [`s${s.id}`, s.cuts.length]));
    const lost = result.unplaced.reduce((n, id) => n + (cutsIn.get(id) ?? 1), 0);
    const cost = short ? longestCut(items, result) : 0;
    const same = best && lost === best.lost && result.sheetCount === best.result.sheetCount;
    if (!best || lost < best.lost || (lost === best.lost && result.sheetCount < best.result.sheetCount) || (same && cost < best.cost - 1e-6)) best = { strips, items, result, lost, cost };
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
 * Strips across the sheet: the sheet is cut into bands running right across it, along the edge
 * chosen for the longest cuts, then each band is cut into lengths. Pieces go tallest first into the
 * band that fits them most tightly (first fit decreasing height); one narrower than its band is
 * trimmed after the crosscut. Every cut runs edge to edge, and all first cuts are parallel.
 */
function planBands(setup: CutSetup, cut: CutList, bases: { id: string; g: PieceGroup }[], usableW: Mm, usableH: Mm) {
  const { trim, kerf } = setup;
  const EPS = 1e-6;
  const longX = stripsAlongX(setup, usableW, usableH);
  /** How long a band is, and how much room there is across the sheet for bands side by side. */
  const L = longX ? usableW : usableH;
  const S = longX ? usableH : usableW;
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
