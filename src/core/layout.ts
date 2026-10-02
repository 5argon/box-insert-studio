/**
 * Insert solver: turns each layer's layout tree into trays, compartments and the physical
 * pieces (base, walls, dividers) with their cut sizes. Board thickness is part of every size:
 * dividers take up space between compartments, short walls fit between the full-length walls,
 * and walls standing on the base are one thickness shorter than the tray.
 */
import { labelFor } from './defaults';
import { inset, roundTo, type Rect } from './geom';
import { solveLidNotches, type LidNotch } from './lidNotches';
import type { ChildSize, Dir, Join, Layer, LayoutNode, MaterialKind, Mm, NotchSize, Project, SectionNode, Side, SplitNode } from './types';

export interface Issue {
  level: 'error' | 'warn';
  message: string;
  /** The tray affected by a piece-specific warning, when known. */
  trayId?: string;
}

/** A lowered stretch of a wall or divider's top edge, from its start (left or back end). */
export interface Low {
  from: Mm;
  to: Mm;
  /** How much is cut off the top. */
  depth: Mm;
}

/** Height of a lowered side, in percent of its compartment's depth, when the project sets none. */
export const LOWERED_DEFAULT = 75;

/** A finger notch's flat bottom, in percent of its opening, when the project sets none. */
export const NOTCH_BOTTOM_DEFAULT = 50;

export interface Notch {
  /** Centre along the piece, from its start (left or back end). */
  center: Mm;
  /** Opening at the top edge. */
  width: Mm;
  depth: Mm;
  /** Width of the flat bottom; straight slants join it to the opening. */
  bottom: Mm;
  /** Sized by a compartment's own notch setting rather than the project's. */
  custom?: boolean;
}

export type PieceKind = 'base' | 'lid' | 'wall' | 'divider' | 'pad';

export interface PieceInst {
  id: string;
  kind: PieceKind;
  /** Belongs to the upper box of a stacked pair; same place and shape as its twin below. */
  copy: boolean;
  /** 0 for trays in the layer, 1 for removable boxes inside a compartment. */
  depth: 0 | 1;
  layerId: string;
  trayId: string;
  /** Cut size. Flat panels: width × depth. Walls and dividers: length × height. */
  length: Mm;
  height: Mm;
  /** Sheet thickness it is cut from. */
  thickness: Mm;
  material: MaterialKind;
  /** Top-view footprint, for drawing. */
  footprint: Rect;
  /** Direction the length runs in the box. */
  axis: 'x' | 'y';
  /** Box coordinate where the piece starts along its axis. */
  start: Mm;
  notches: Notch[];
  /** Finger cutouts through the flat lid, measured in its own x/y plane. */
  lidNotches?: LidNotch[];
  /** A shared lid covering every separate box in this host compartment. */
  sharedLidFor?: string;
  /** Which compartment side asked for each notch, and the stretch of the piece it covers. */
  notchFrom: { compartmentId: string; side: Side; from: Mm; to: Mm }[];
  /** Lowered stretches of the top edge. Empty when the whole piece is lowered: see `cut`. */
  lows: Low[];
  /** Which compartment side asked for each lowered stretch, even when it became `cut`. */
  lowFrom: { compartmentId: string; side: Side; from: Mm; to: Mm }[];
  /** Lowered along its whole length: this much shorter than it would be, already taken off `height`. */
  cut?: Mm;
  /** Glue order inside its tray. */
  order: number;
  role: 'base' | 'lid' | 'back wall' | 'front wall' | 'left wall' | 'right wall' | 'divider' | 'pad';
  /** Pads: the compartment raised, and this layer's place in the stack (0 at the bottom). */
  padFor?: string;
  padLevel?: number;
  splitId?: string;
  barIndex?: number;
  lower?: Mm;
  /** Compartment labels before (left/back) and after (right/front) a divider. */
  sides?: [string[], string[]];
}

export interface Tray {
  id: string;
  number: number;
  layerId: string;
  outer: Rect;
  inner: Rect;
  compartments: string[];
  depth: 0 | 1;
  /** Total height including the base and any lid. */
  height: Mm;
  wallHeight: Mm;
  /** Thickness of its base. */
  base: Mm;
  /** Thickness of its own lid, or zero for an open box or a box beneath a shared lid. */
  lid: Mm;
  /** For a box inside a compartment: that compartment's id and the tray it sits in. */
  wellId?: string;
  parentTrayId?: string;
  /** The layout node this tray was built from; stable while the layout is edited. */
  nodeId: string;
  /** Part of a stack of two identical boxes. */
  stacked: boolean;
  /** A half-height box whose upper twin was left out: the space above it stays empty. */
  emptyAbove?: boolean;
  /** For the upper box of a stack: the tray id of the identical box below it. */
  copyOf?: string;
}

export interface Compartment {
  id: string;
  label: string;
  /** Colour index; compartments inside a box share their well's. */
  index: number;
  layerId: string;
  trayId: string;
  depth: 0 | 1;
  /** Set on compartments inside a removable box: the compartment the box stands in. */
  wellId?: string;
  /** Usable height: from the top of any raised floor to the top of the walls around it. */
  height: Mm;
  /** From the compartment's floor to the top of the walls, before any raised floor. */
  fullHeight: Mm;
  /** Layers of raised floor, and how much they raise it. */
  pad: number;
  padHeight: Mm;
  /** Inside a stacked pair of boxes: the same compartment exists in both. */
  stacked: boolean;
  rect: Rect;
  node: SectionNode;
  /** Piece id forming each side. */
  bounds: Record<Side, string>;
  issues: Issue[];
}

export interface Bar {
  splitId: string;
  index: number;
  dir: Dir;
  join: Join;
  /** Centre of the divider (or of the gap between trays), x for rows and y for columns. */
  pos: Mm;
  thickness: Mm;
  from: Mm;
  to: Mm;
}

export interface SolvedSplit {
  id: string;
  node: SplitNode;
  rect: Rect;
  /** Allocated sizes: compartment insides for dividers, tray outsides for trays. */
  childSizes: Mm[];
}

export interface SolvedLayer {
  layer: Layer;
  trays: Tray[];
  compartments: Compartment[];
  pieces: PieceInst[];
  bars: Bar[];
  splits: SolvedSplit[];
  issues: Issue[];
  wallHeight: Mm;
}

export interface Solved {
  layers: SolvedLayer[];
  compartments: Compartment[];
  trays: Tray[];
  pieces: PieceInst[];
  issues: Issue[];
  headroom: Mm;
}

export const SIDES: Side[] = ['back', 'front', 'left', 'right'];

/** Whether this side uses the compartment's own notch settings. */
export function usesNotchOverride(section: SectionNode, side: Side): boolean {
  return !!section.notchSize && (section.notchSize.sides === undefined || section.notchSize.sides.includes(side));
}

/** A removable box needs at least this much height inside it. */
export const MIN_BOX_INSIDE = 5;

/** Thickness of the base under each layer's trays. */
export function baseThickness(project: Project): Mm {
  return materialThickness(project, project.secondaryBase);
}

/** Thickness for a part that can opt into the secondary material. */
export function materialThickness(project: Project, secondary = false): Mm {
  return secondary ? (project.material.secondaryThickness ?? project.material.thickness) : project.material.thickness;
}

/** Material selected for one divider, with primary material as the fallback. */
export function dividerMaterial(project: Project, split: SplitNode, index: number): MaterialKind {
  return split.children[index]?.secondaryDivider && project.material.secondaryThickness !== undefined ? 'secondary' : 'primary';
}

export function dividerThickness(project: Project, split: SplitNode, index: number): Mm {
  return materialThickness(project, dividerMaterial(project, split, index) === 'secondary');
}

/** Thickness of a removable box's base, falling back when the second material is off. */
export function insertBaseThickness(project: Project, section: SectionNode): Mm {
  return materialThickness(project, section.insert?.secondaryBase);
}

/** Thickness reserved for a removable box's lid, or zero when it has none. */
export function insertLidThickness(project: Project, section: SectionNode): Mm {
  return section.insert?.lid ? materialThickness(project, section.insert.secondaryLid) : 0;
}

/** A shared cover applies only while this insert makes separate boxes with a lid enabled. */
export function usesSharedLid(section: SectionNode): boolean {
  const insert = section.insert;
  return !!(insert?.lid && insert.sharedLid && insert.root.kind === 'split' && insert.root.join === 'trays');
}

/** Lid allowance per box: a stacked group shares one cover across both equal-height bodies. */
export function insertLidAllowance(project: Project, section: SectionNode): Mm {
  const lid = insertLidThickness(project, section);
  return usesSharedLid(section) && section.insert?.stacked && !section.insert.emptyAbove ? lid / 2 : lid;
}

/** Most raised-floor layers that leave usable height, including bases and lids of boxes above. */
export function maxPad(fullHeight: Mm, thickness: Mm, boxes = 0, boxBase = thickness, boxLid = 0): number {
  if (thickness <= 0) return 0;
  if (boxes) return Math.max(0, Math.floor((fullHeight - boxes * (boxBase + boxLid + MIN_BOX_INSIDE)) / thickness + 1e-9));
  return Math.max(0, Math.ceil(fullHeight / thickness - 1e-9) - 1);
}

export function allocate(total: Mm, sizes: ChildSize[]): { sizes: Mm[]; issue?: string } {
  const fixed = sizes.reduce((a, s) => a + (s.mode === 'fixed' ? s.mm : 0), 0);
  const weights = sizes.reduce((a, s) => a + (s.mode === 'flex' ? s.weight : 0), 0);
  const flexSpace = total - fixed;
  if (weights <= 0) {
    // Everything locked: the last child absorbs the difference so the layout still fills the space.
    const out = sizes.map((s) => (s.mode === 'fixed' ? s.mm : 0));
    out[out.length - 1] += flexSpace;
    const issue = Math.abs(flexSpace) > 0.05 ? `All sizes are locked; the last one was stretched by ${flexSpace.toFixed(1)} mm.` : undefined;
    return { sizes: out, issue };
  }
  const out = sizes.map((s) => (s.mode === 'fixed' ? s.mm : (flexSpace * s.weight) / weights));
  const issue = flexSpace < -0.05 ? `Locked sizes are ${(-flexSpace).toFixed(1)} mm more than the space available.` : undefined;
  return { sizes: out, issue };
}

interface RawCompartment {
  node: SectionNode;
  rect: Rect;
  bounds: Record<Side, string>;
  trayId: string;
  depth: 0 | 1;
  wellId?: string;
  height: Mm;
  stacked: boolean;
}

/** Where a tray is being built: its total height, and whether it is a box inside a compartment. */
interface TrayCtx {
  height: Mm;
  /** Thickness selected for this tray's base. */
  base: Mm;
  secondaryBase?: boolean;
  lid?: Mm;
  secondaryLid?: boolean;
  lidNotches?: Side[];
  lidNotchSize?: NotchSize;
  depth: 0 | 1;
  wellId?: string;
  parentTrayId?: string;
  stacked?: boolean;
  /** Half height with nothing stacked on top. */
  emptyAbove?: boolean;
  /**
   * Building the upper box of a stack: its pieces are made, but compartments, bars, splits and
   * issues were already recorded by the identical box below.
   */
  copy?: boolean;
}

type PieceInput = Omit<PieceInst, 'id' | 'order' | 'layerId' | 'trayId' | 'thickness' | 'material' | 'notches' | 'notchFrom' | 'lows' | 'lowFrom' | 'depth' | 'copy'> & { material?: MaterialKind };

function solveLayer(project: Project, layer: Layer): SolvedLayer {
  const T = project.material.thickness;
  const c = project.clearance;
  const B = baseThickness(project);
  const wallHeight = project.base === 'under' ? layer.height - B : layer.height;
  const trays: Tray[] = [];
  const raw: RawCompartment[] = [];
  const pieces: PieceInst[] = [];
  const bars: Bar[] = [];
  const splits: SolvedSplit[] = [];
  const issues: Issue[] = [];

  function cellLevel(node: LayoutNode, cell: Rect, ctx: TrayCtx) {
    if (node.kind === 'split' && node.join === 'trays') {
      const horizontal = node.dir === 'row';
      const n = node.children.length;
      const { sizes, issue } = allocate((horizontal ? cell.w : cell.h) - n * c, node.children.map((ch) => ch.size));
      if (!ctx.copy) {
        if (issue) issues.push({ level: 'error', message: issue });
        splits.push({ id: node.id, node, rect: cell, childSizes: sizes });
      }
      let cursor = horizontal ? cell.x : cell.y;
      node.children.forEach((ch, i) => {
        const size = sizes[i] + c;
        const r: Rect = horizontal ? { x: cursor, y: cell.y, w: size, h: cell.h } : { x: cell.x, y: cursor, w: cell.w, h: size };
        cursor += size;
        if (i < n - 1 && !ctx.copy) {
          bars.push({
            splitId: node.id,
            index: i,
            dir: node.dir,
            join: 'trays',
            pos: cursor,
            thickness: c,
            from: horizontal ? cell.y : cell.x,
            to: horizontal ? cell.y + cell.h : cell.x + cell.w,
          });
        }
        cellLevel(ch.node, r, ctx);
      });
      return;
    }
    makeTray(node, cell, ctx);
  }

  function makeTray(node: LayoutNode, cell: Rect, ctx: TrayCtx) {
    const outer = inset(cell, c / 2);
    const inner = inset(outer, T);
    const lid = ctx.lid ?? 0;
    const bodyHeight = ctx.height - lid;
    const trayWall = project.base === 'under' ? bodyHeight - ctx.base : bodyHeight;
    const tray: Tray = {
      id: `${layer.id}/t${trays.length}`,
      number: 0,
      layerId: layer.id,
      outer,
      inner,
      compartments: [],
      depth: ctx.depth,
      height: ctx.height,
      wallHeight: trayWall,
      base: ctx.base,
      lid,
      wellId: ctx.wellId,
      parentTrayId: ctx.parentTrayId,
      nodeId: node.id,
      stacked: !!ctx.stacked,
      ...(ctx.emptyAbove ? { emptyAbove: true } : {}),
    };
    trays.push(tray);
    if ((inner.w <= 0 || inner.h <= 0) && !ctx.copy) issues.push({ level: 'error', message: 'A tray is too small to hold anything.' });
    let order = 0;
    const add = (p: PieceInput): PieceInst => {
      const material = p.material ?? (p.kind === 'base' && ctx.secondaryBase && project.material.secondaryThickness !== undefined ? 'secondary' : 'primary');
      const thickness = p.kind === 'base' ? ctx.base : materialThickness(project, material === 'secondary');
      const piece: PieceInst = { ...p, id: `${tray.id}/${order}`, order, layerId: layer.id, trayId: tray.id, thickness, material, notches: [], notchFrom: [], lows: [], lowFrom: [], depth: ctx.depth, copy: !!ctx.copy };
      order += 1;
      pieces.push(piece);
      return piece;
    };

    const b = project.base === 'under' ? outer : inner;
    add({ kind: 'base', role: 'base', length: b.w, height: b.h, footprint: b, axis: 'x', start: b.x });

    const fullX = project.fullWalls === 'x';
    const walls: Record<Side, Rect> = {
      back: fullX ? { x: outer.x, y: outer.y, w: outer.w, h: T } : { x: outer.x + T, y: outer.y, w: outer.w - 2 * T, h: T },
      front: fullX ? { x: outer.x, y: outer.y + outer.h - T, w: outer.w, h: T } : { x: outer.x + T, y: outer.y + outer.h - T, w: outer.w - 2 * T, h: T },
      left: fullX ? { x: outer.x, y: outer.y + T, w: T, h: outer.h - 2 * T } : { x: outer.x, y: outer.y, w: T, h: outer.h },
      right: fullX ? { x: outer.x + outer.w - T, y: outer.y + T, w: T, h: outer.h - 2 * T } : { x: outer.x + outer.w - T, y: outer.y, w: T, h: outer.h },
    };
    const wallOrder: Side[] = fullX ? ['back', 'front', 'left', 'right'] : ['left', 'right', 'back', 'front'];
    const bounds = {} as Record<Side, string>;
    for (const side of wallOrder) {
      const fp = walls[side];
      const alongX = side === 'back' || side === 'front';
      bounds[side] = add({
        kind: 'wall',
        role: `${side} wall`,
        length: alongX ? fp.w : fp.h,
        height: trayWall,
        footprint: fp,
        axis: alongX ? 'x' : 'y',
        start: alongX ? fp.x : fp.y,
      }).id;
    }
    inside(node, inner, bounds, tray, add, ctx);
    if (lid) {
      const cutouts = solveLidNotches(outer.w, outer.h, ctx.lidNotches ?? [], ctx.lidNotchSize);
      if (!ctx.copy) issues.push(...cutouts.warnings.map((message) => ({ level: 'warn' as const, message, trayId: tray.id })));
      add({
        kind: 'lid', role: 'lid', length: outer.w, height: outer.h, footprint: outer, axis: 'x', start: outer.x,
        material: ctx.secondaryLid && project.material.secondaryThickness !== undefined ? 'secondary' : 'primary',
        ...(cutouts.notches.length ? { lidNotches: cutouts.notches } : {}),
      });
    }
  }

  function inside(
    node: LayoutNode,
    rect: Rect,
    bounds: Record<Side, string>,
    tray: Tray,
    add: (p: PieceInput) => PieceInst,
    ctx: TrayCtx,
  ) {
    if (node.kind === 'section') {
      // A raised floor: layers cut to the inside size less the clearance, stacked on the floor.
      // Under a removable box it lifts the box, which gets shorter so its top stays flush.
      const pad = Math.max(0, Math.floor(node.pad ?? 0));
      for (let i = 0; i < pad; i++) {
        const fp: Rect = inset(rect, c / 2);
        add({ kind: 'pad', role: 'pad', length: fp.w, height: fp.h, footprint: fp, axis: 'x', start: fp.x, padFor: node.id, padLevel: i });
      }
      if (ctx.copy) return;
      raw.push({ node, rect, bounds, trayId: tray.id, depth: ctx.depth, wellId: ctx.wellId, height: ctx.height - (ctx.lid ?? 0) - ctx.base, stacked: !!ctx.stacked });
      if (!node.insert) return;
      if (ctx.depth === 1) {
        issues.push({ level: 'warn', message: 'A box inside a box is not supported; the inner one is ignored.' });
        return;
      }
      // The box stands on this tray's base and any raised floor, so it is that much shorter and its
      // top sits flush with the walls around it. A stack of two splits that height exactly in half;
      // leaving the top one out keeps the lower box at half height with the space above it empty.
      const half = !!node.insert.stacked;
      const emptyAbove = half && !!node.insert.emptyAbove;
      const stacked = half && !emptyAbove;
      const boxBase = insertBaseThickness(project, node);
      const boxLid = insertLidThickness(project, node);
      const shared = usesSharedLid(node);
      const allowance = insertLidAllowance(project, node);
      // A shared cover sits above the whole group; both stacked bodies share the space beneath it.
      const envelope = (ctx.height - ctx.base - pad * T) / (half ? 2 : 1);
      const height = envelope - (shared ? allowance : 0);
      // Too shallow: the compartment reports it (see solveProject) and no box is built.
      if (height - boxBase - (shared ? 0 : boxLid) < MIN_BOX_INSIDE) return;
      const box = { height, base: boxBase, secondaryBase: node.insert.secondaryBase, lid: shared ? 0 : boxLid, secondaryLid: node.insert.secondaryLid, lidNotches: node.insert.lidNotches, lidNotchSize: node.insert.lidNotchSize, depth: 1 as const, wellId: node.id, parentTrayId: tray.id, stacked, emptyAbove };
      const first = trays.length;
      cellLevel(node.insert.root, rect, box);
      let anchor = trays[first]!;
      if (stacked) {
        const upper = trays.length;
        cellLevel(node.insert.root, rect, { ...box, copy: true });
        for (let i = upper; i < trays.length; i++) trays[i].copyOf = trays[first + i - upper].id;
        anchor = trays[upper]!;
      }
      if (shared) {
        const footprint = inset(rect, c / 2);
        const cutouts = solveLidNotches(footprint.w, footprint.h, node.insert.lidNotches ?? [], node.insert.lidNotchSize);
        issues.push(...cutouts.warnings.map((message) => ({ level: 'warn' as const, message, trayId: anchor.id })));
        const order = pieces.filter((p) => p.trayId === anchor.id).reduce((n, p) => Math.max(n, p.order + 1), 0);
        pieces.push({
          id: `${anchor.id}/${order}`, kind: 'lid', role: 'lid', sharedLidFor: node.id,
          copy: false, depth: 1, layerId: layer.id, trayId: anchor.id, order,
          length: footprint.w, height: footprint.h, thickness: boxLid,
          material: node.insert.secondaryLid && project.material.secondaryThickness !== undefined ? 'secondary' : 'primary',
          footprint, axis: 'x', start: footprint.x, notches: [], notchFrom: [], lows: [], lowFrom: [],
          ...(cutouts.notches.length ? { lidNotches: cutouts.notches } : {}),
        });
      }
      return;
    }
    if (node.join === 'trays' && !ctx.copy) {
      issues.push({ level: 'error', message: 'Separate trays can only divide trays, not the inside of a tray; treated as dividers.' });
    }
    const horizontal = node.dir === 'row';
    const n = node.children.length;
    const gaps = node.children.slice(0, -1).map((_, i) => dividerThickness(project, node, i));
    const { sizes, issue } = allocate((horizontal ? rect.w : rect.h) - gaps.reduce((sum, gap) => sum + gap, 0), node.children.map((ch) => ch.size));
    if (!ctx.copy) {
      if (issue) issues.push({ level: 'error', message: issue });
      splits.push({ id: node.id, node, rect, childSizes: sizes });
    }
    const dividerHeight = ctx.height - (ctx.lid ?? 0) - ctx.base - node.lower;
    if (dividerHeight < 5 && !ctx.copy) issues.push({ level: 'error', message: `Lowered dividers would be only ${dividerHeight.toFixed(1)} mm tall.` });
    const childRects: Rect[] = [];
    const dividers: PieceInst[] = [];
    let cursor = horizontal ? rect.x : rect.y;
    for (let i = 0; i < n; i++) {
      childRects.push(horizontal ? { x: cursor, y: rect.y, w: sizes[i], h: rect.h } : { x: rect.x, y: cursor, w: rect.w, h: sizes[i] });
      cursor += sizes[i];
      if (i < n - 1) {
        const gap = gaps[i]!;
        const fp: Rect = horizontal ? { x: cursor, y: rect.y, w: gap, h: rect.h } : { x: rect.x, y: cursor, w: rect.w, h: gap };
        dividers.push(
          add({
            kind: 'divider',
            material: dividerMaterial(project, node, i),
            role: 'divider',
            length: horizontal ? rect.h : rect.w,
            height: dividerHeight,
            footprint: fp,
            axis: horizontal ? 'y' : 'x',
            start: horizontal ? rect.y : rect.x,
            splitId: node.id,
            barIndex: i,
            lower: node.lower,
          }),
        );
        if (!ctx.copy) bars.push({
          splitId: node.id,
          index: i,
          dir: node.dir,
          join: 'divider',
          pos: cursor + gap / 2,
          thickness: gap,
          from: horizontal ? rect.y : rect.x,
          to: horizontal ? rect.y + rect.h : rect.x + rect.w,
        });
        cursor += gap;
      }
    }
    node.children.forEach((ch, i) => {
      const b = { ...bounds };
      if (horizontal) {
        if (i > 0) b.left = dividers[i - 1].id;
        if (i < n - 1) b.right = dividers[i].id;
      } else {
        if (i > 0) b.back = dividers[i - 1].id;
        if (i < n - 1) b.front = dividers[i].id;
      }
      inside(ch.node, childRects[i], b, tray, add, ctx);
    });
  }

  cellLevel(layer.root, { x: 0, y: 0, w: project.box.width, h: project.box.depth }, { height: layer.height, base: B, secondaryBase: project.secondaryBase, depth: 0 });

  const compartments: Compartment[] = raw.map((r) => ({
    id: r.node.id,
    label: '',
    index: 0,
    layerId: layer.id,
    trayId: r.trayId,
    depth: r.depth,
    wellId: r.wellId,
    fullHeight: r.height,
    pad: Math.max(0, Math.floor(r.node.pad ?? 0)),
    padHeight: 0,
    height: r.height,
    stacked: r.stacked,
    rect: r.rect,
    node: r.node,
    bounds: r.bounds,
    issues: [],
  }));
  return { layer, trays, compartments, pieces, bars, splits, issues, wallHeight };
}

const readingOrder = (a: Rect, b: Rect) => Math.round(a.y * 2) - Math.round(b.y * 2) || a.x - b.x;

/** Join lowered stretches that touch or overlap. */
function mergeLows(lows: Low[]): Low[] {
  const out: Low[] = [];
  for (const l of [...lows].sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && l.from <= last.to + 0.01) {
      last.to = Math.max(last.to, l.to);
      last.depth = Math.max(last.depth, l.depth);
    } else out.push({ ...l });
  }
  return out;
}

/** Overlapping notches become one: the outer slants of the two ends, one flat bottom between. */
function mergeNotches(notches: Notch[]): Notch[] {
  const sorted = [...notches].sort((a, b) => a.center - b.center);
  const out: { a: Mm; b: Mm; depth: Mm; custom: boolean; leftRun: Mm; rightRun: Mm }[] = [];
  for (const n of sorted) {
    const a = n.center - n.width / 2;
    const b = n.center + n.width / 2;
    const run = (n.width - n.bottom) / 2;
    const last = out[out.length - 1];
    if (last && a <= last.b + 0.01) {
      if (b > last.b) {
        last.b = b;
        last.rightRun = run;
      }
      last.depth = Math.max(last.depth, n.depth);
      last.custom ||= !!n.custom;
    } else out.push({ a, b, depth: n.depth, custom: !!n.custom, leftRun: run, rightRun: run });
  }
  return out.map((o) => ({
    center: (o.a + o.b) / 2,
    width: o.b - o.a,
    depth: o.depth,
    bottom: Math.max(0, o.b - o.a - o.leftRun - o.rightRun),
    ...(o.custom ? { custom: true } : {}),
  }));
}

export function solveProject(project: Project): Solved {
  const layers = project.layers.map((l) => solveLayer(project, l));
  const issues: Issue[] = [];
  const total = project.layers.reduce((a, l) => a + l.height, 0);
  const headroom = project.box.height - total;
  if (headroom < 0) issues.push({ level: 'error', message: `Layers are ${(-headroom).toFixed(1)} mm taller than the box.` });

  let labelIndex = 0;
  let trayNumber = 0;
  for (const sl of layers) {
    // Letters in reading order; compartments inside a box take their well's letter plus a number.
    const top = sl.compartments.filter((c) => c.depth === 0).sort((a, b) => readingOrder(a.rect, b.rect));
    const ordered: Compartment[] = [];
    for (const c of top) {
      c.index = labelIndex;
      c.label = labelFor(labelIndex);
      labelIndex += 1;
      ordered.push(c);
      const inner = sl.compartments.filter((x) => x.wellId === c.id).sort((a, b) => readingOrder(a.rect, b.rect));
      inner.forEach((x, i) => {
        x.index = c.index;
        x.label = `${c.label}${i + 1}`;
        ordered.push(x);
      });
    }
    sl.compartments = ordered;
    const wellOrder = new Map(ordered.map((c, i) => [c.id, i]));
    sl.trays.sort(
      (a, b) =>
        a.depth - b.depth ||
        (wellOrder.get(a.wellId ?? '') ?? 0) - (wellOrder.get(b.wellId ?? '') ?? 0) ||
        Number(!!a.copyOf) - Number(!!b.copyOf) ||
        readingOrder(a.outer, b.outer),
    );
    for (const t of sl.trays) {
      trayNumber += 1;
      t.number = trayNumber;
      t.compartments = sl.compartments.filter((c) => c.trayId === (t.copyOf ?? t.id)).map((c) => c.label);
    }
    for (const p of sl.pieces) {
      if (p.length <= 0 || p.height <= 0) sl.issues.push({ level: 'error', message: 'Some pieces have no size; a section is too small.' });
    }

    const byId = new Map(sl.pieces.map((p) => [p.id, p]));
    const T = project.material.thickness;

    // Lowered sides first, so no notch is placed where a side is cut down. The lowered top edge
    // stands at a share of the compartment's depth above its floor, rounded like every cut size so
    // identical walls lowered the same way stay one cut size.
    const trayOf = new Map(sl.trays.map((t) => [t.id, t]));
    const share = (project.lowered ?? LOWERED_DEFAULT) / 100;
    for (const c of sl.compartments) {
      for (const side of c.node.lowered ?? []) {
        const p = byId.get(c.bounds[side]);
        if (!p) continue;
        // A wall wrapped around the base starts at the tray's bottom, one base below the floor.
        const below = p.kind === 'wall' && project.base === 'inside' ? (trayOf.get(p.trayId)?.base ?? 0) : 0;
        const top = roundTo(below + share * c.fullHeight, project.precision);
        const depth = p.height - top;
        if (depth < 1) {
          c.issues.push({ level: 'warn', message: `The ${side} side already stands no higher than ${Math.round(share * 100)}% of the compartment.` });
          continue;
        }
        const [a, b] = spanOn(p, c);
        const from = Math.max(0, a);
        const to = Math.min(p.length, b);
        p.lows.push({ from, to, depth });
        p.lowFrom.push({ compartmentId: c.id, side, from, to });
      }
    }
    for (const p of sl.pieces) {
      if (!p.lows.length) continue;
      const merged = mergeLows(p.lows);
      // Lowered end to end: simply a shorter piece, cut from a narrower strip.
      if (merged.length === 1 && merged[0].from <= 0.01 && merged[0].to >= p.length - 0.01) {
        p.cut = merged[0].depth;
        p.height -= merged[0].depth;
        p.lows = [];
      } else p.lows = merged;
    }

    for (const c of sl.compartments) {
      const { w, h } = c.rect;
      c.padHeight = c.pad * T;
      c.height = c.fullHeight - c.padHeight;
      // Height is shared as if two boxes stood here even when the top one is left out.
      const boxes = c.node.insert && c.depth === 0 ? (c.node.insert.stacked ? 2 : 1) : 0;
      const boxBase = insertBaseThickness(project, c.node);
      const boxLid = insertLidAllowance(project, c.node);
      const pair = boxes === 2 && !c.node.insert?.emptyAbove;
      if (boxes && (c.fullHeight / boxes - boxBase - boxLid) < MIN_BOX_INSIDE) {
        // Each box needs its floor, any lid and MIN_BOX_INSIDE; stacked boxes need that twice.
        const need = boxes * (boxBase + boxLid + MIN_BOX_INSIDE) + baseThickness(project);
        c.issues.push({
          level: 'error',
          message: `Too shallow for ${pair ? 'two stacked boxes' : boxes === 2 ? 'a half-height box' : 'a box'}: the layer needs to be at least ${need} mm tall${boxes === 2 ? ', or use one full-height box' : ''}.`,
        });
      } else if (c.pad && boxes && c.pad > maxPad(c.fullHeight, T, boxes, boxBase, boxLid)) {
        const remove = c.pad - maxPad(c.fullHeight, T, boxes, boxBase, boxLid);
        c.issues.push({
          level: 'error',
          message: `Raised floor of ${c.pad} × ${T} mm = ${c.padHeight} mm leaves too little height for the ${pair ? 'stacked boxes' : 'box'} on it. Remove ${remove} layer${remove === 1 ? '' : 's'}.`,
        });
      } else if (c.pad && c.height <= 0) {
        // Fewest layers to remove so something is left above the raised floor.
        const remove = Math.floor(-c.height / T + 1e-9) + 1;
        c.issues.push({
          level: 'error',
          message: `Raised floor of ${c.pad} × ${T} mm = ${c.padHeight} mm is ${c.height === 0 ? 'as tall as' : 'taller than'} the ${c.fullHeight} mm compartment. Remove ${remove} layer${remove === 1 ? '' : 's'}.`,
        });
      }
      if (w <= 0 || h <= 0) c.issues.push({ level: 'error', message: 'No space left for this compartment.' });
      else if (Math.min(w, h) < 10) c.issues.push({ level: 'warn', message: `Only ${Math.min(w, h).toFixed(1)} mm wide.` });
      for (const side of SIDES) {
        const p = byId.get(c.bounds[side]);
        if (!p) continue;
        if (p.kind === 'divider') {
          p.sides ??= [[], []];
          p.sides[side === 'right' || side === 'front' ? 0 : 1].push(c.label);
        }
        if (!c.node.notches.includes(side)) continue;
        const span = p.axis === 'x' ? w : h;
        const custom = usesNotchOverride(c.node, side);
        const size = custom ? c.node.notchSize! : project.notch;
        const width = Math.min(size.width, span - 4);
        const depth = Math.min(size.depth, p.height - p.thickness);
        if (width < 5 || depth < 2) {
          c.issues.push({ level: 'warn', message: `No room for a finger notch on the ${side}.` });
          continue;
        }
        const center = (p.axis === 'x' ? c.rect.x + w / 2 : c.rect.y + h / 2) - p.start;
        if (p.lowFrom.some((l) => l.from < center + width / 2 && center - width / 2 < l.to)) {
          c.issues.push({ level: 'warn', message: `The ${side} side is lowered there, so it gets no finger notch.` });
          continue;
        }
        // The bottom keeps its share of the opening, so a notch narrowed to fit keeps its shape.
        const bottom = (width * (size.bottom ?? NOTCH_BOTTOM_DEFAULT)) / 100;
        p.notches.push(custom ? { center, width, depth, bottom, custom: true } : { center, width, depth, bottom });
        p.notchFrom.push({ compartmentId: c.id, side, from: center - width / 2, to: center + width / 2 });
      }
    }
    for (const p of sl.pieces) if (p.notches.length > 1) p.notches = mergeNotches(p.notches);
    for (const p of sl.pieces) p.sides?.forEach((s) => s.sort());

    // The upper box of a stack is built in the same order as the one below: copy its notches.
    const copyOf = new Map(sl.trays.filter((t) => t.copyOf).map((t) => [t.id, t.copyOf!]));
    for (const p of sl.pieces) {
      const twin = copyOf.has(p.trayId) ? byId.get(`${copyOf.get(p.trayId)}/${p.order}`) : undefined;
      if (!twin) continue;
      p.notches = twin.notches.map((n) => ({ ...n }));
      p.lows = twin.lows.map((l) => ({ ...l }));
      p.height = twin.height;
      if (twin.cut) p.cut = twin.cut;
      p.sides = twin.sides?.map((x) => [...x]) as [string[], string[]] | undefined;
    }
  }

  return {
    layers,
    compartments: layers.flatMap((l) => l.compartments),
    trays: layers.flatMap((l) => l.trays),
    pieces: layers.flatMap((l) => l.pieces),
    issues,
    headroom,
  };
}

/** The stretch of a wall or divider (from its start) that borders a compartment. */
export function spanOn(p: PieceInst, c: Compartment): [Mm, Mm] {
  return p.axis === 'x' ? [c.rect.x - p.start, c.rect.x + c.rect.w - p.start] : [c.rect.y - p.start, c.rect.y + c.rect.h - p.start];
}

/**
 * The compartment sides whose notches cut into the stretch of this piece facing `c`. A notch goes
 * through the whole board, so a divider notched for one compartment is notched for the one
 * across it too.
 */
export function notchesFacing(p: PieceInst, c: Compartment): PieceInst['notchFrom'] {
  const [a, b] = spanOn(p, c);
  return p.notchFrom.filter((n) => n.from < b - 1e-6 && a < n.to - 1e-6);
}

/** The compartment sides whose lowering cuts down the stretch of this piece facing `c`. */
export function lowsFacing(p: PieceInst, c: Compartment): PieceInst['lowFrom'] {
  const [a, b] = spanOn(p, c);
  return p.lowFrom.filter((l) => l.from < b - 1e-6 && a < l.to - 1e-6);
}
