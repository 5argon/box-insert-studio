/**
 * Foam board solver: turns each layer's layout tree into trays, compartments and the physical
 * pieces (base, walls, dividers) with their cut sizes. Board thickness is part of every size:
 * dividers take up space between compartments, short walls fit between the full-length walls,
 * and walls standing on the base are one thickness shorter than the tray.
 */
import { labelFor } from './defaults';
import { inset, type Rect } from './geom';
import type { ChildSize, Dir, Join, Layer, LayoutNode, Mm, Project, SectionNode, Side, SplitNode } from './types';

export interface Issue {
  level: 'error' | 'warn';
  message: string;
}

export interface Notch {
  /** Centre along the piece, from its start (left or back end). */
  center: Mm;
  width: Mm;
  depth: Mm;
}

export type PieceKind = 'base' | 'wall' | 'divider';

export interface PieceInst {
  id: string;
  kind: PieceKind;
  /** 0 for trays in the layer, 1 for removable boxes inside a compartment. */
  depth: 0 | 1;
  layerId: string;
  trayId: string;
  /** Cut size. Base: width × depth. Walls and dividers: length × height. */
  length: Mm;
  height: Mm;
  /** Top-view footprint, for drawing. */
  footprint: Rect;
  /** Direction the length runs in the box. */
  axis: 'x' | 'y';
  /** Box coordinate where the piece starts along its axis. */
  start: Mm;
  notches: Notch[];
  /** Glue order inside its tray. */
  order: number;
  role: 'base' | 'back wall' | 'front wall' | 'left wall' | 'right wall' | 'divider';
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
  /** Total height including the base. */
  height: Mm;
  wallHeight: Mm;
  /** For a box inside a compartment: that compartment's id and the tray it sits in. */
  wellId?: string;
  parentTrayId?: string;
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
  /** Usable height from this compartment's floor to the top of the walls around it. */
  height: Mm;
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
}

/** Where a tray is being built: its total height, and whether it is a box inside a compartment. */
interface TrayCtx {
  height: Mm;
  depth: 0 | 1;
  wellId?: string;
  parentTrayId?: string;
}

function solveLayer(project: Project, layer: Layer): SolvedLayer {
  const T = project.foam.thickness;
  const c = project.clearance;
  const wallHeight = project.base === 'under' ? layer.height - T : layer.height;
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
      if (issue) issues.push({ level: 'error', message: issue });
      splits.push({ id: node.id, node, rect: cell, childSizes: sizes });
      let cursor = horizontal ? cell.x : cell.y;
      node.children.forEach((ch, i) => {
        const size = sizes[i] + c;
        const r: Rect = horizontal ? { x: cursor, y: cell.y, w: size, h: cell.h } : { x: cell.x, y: cursor, w: cell.w, h: size };
        cursor += size;
        if (i < n - 1) {
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
    const trayWall = project.base === 'under' ? ctx.height - T : ctx.height;
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
      wellId: ctx.wellId,
      parentTrayId: ctx.parentTrayId,
    };
    trays.push(tray);
    if (inner.w <= 0 || inner.h <= 0) issues.push({ level: 'error', message: 'A tray is too small to hold anything.' });
    let order = 0;
    const add = (p: Omit<PieceInst, 'id' | 'order' | 'layerId' | 'trayId' | 'notches' | 'depth'>): PieceInst => {
      const piece: PieceInst = { ...p, id: `${tray.id}/${order}`, order, layerId: layer.id, trayId: tray.id, notches: [], depth: ctx.depth };
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
  }

  function inside(
    node: LayoutNode,
    rect: Rect,
    bounds: Record<Side, string>,
    tray: Tray,
    add: (p: Omit<PieceInst, 'id' | 'order' | 'layerId' | 'trayId' | 'notches' | 'depth'>) => PieceInst,
    ctx: TrayCtx,
  ) {
    if (node.kind === 'section') {
      raw.push({ node, rect, bounds, trayId: tray.id, depth: ctx.depth, wellId: ctx.wellId, height: ctx.height - T });
      if (!node.insert) return;
      if (ctx.depth === 1) {
        issues.push({ level: 'warn', message: 'A box inside a box is not supported; the inner one is ignored.' });
        return;
      }
      // The box stands on this tray's base, so it is one board thickness shorter and its top
      // sits flush with the walls around it.
      const height = ctx.height - T;
      if (height - T < 5) {
        issues.push({ level: 'error', message: `${layer.name} is too shallow for a box inside a compartment.` });
        return;
      }
      cellLevel(node.insert.root, rect, { height, depth: 1, wellId: node.id, parentTrayId: tray.id });
      return;
    }
    if (node.join === 'trays') {
      issues.push({ level: 'error', message: 'Separate trays can only divide trays, not the inside of a tray; treated as dividers.' });
    }
    const horizontal = node.dir === 'row';
    const n = node.children.length;
    const { sizes, issue } = allocate((horizontal ? rect.w : rect.h) - (n - 1) * T, node.children.map((ch) => ch.size));
    if (issue) issues.push({ level: 'error', message: issue });
    splits.push({ id: node.id, node, rect, childSizes: sizes });
    const dividerHeight = ctx.height - T - node.lower;
    if (dividerHeight < 5) issues.push({ level: 'error', message: `Lowered dividers would be only ${dividerHeight.toFixed(1)} mm tall.` });
    const childRects: Rect[] = [];
    const dividers: PieceInst[] = [];
    let cursor = horizontal ? rect.x : rect.y;
    for (let i = 0; i < n; i++) {
      childRects.push(horizontal ? { x: cursor, y: rect.y, w: sizes[i], h: rect.h } : { x: rect.x, y: cursor, w: rect.w, h: sizes[i] });
      cursor += sizes[i];
      if (i < n - 1) {
        const fp: Rect = horizontal ? { x: cursor, y: rect.y, w: T, h: rect.h } : { x: rect.x, y: cursor, w: rect.w, h: T };
        dividers.push(
          add({
            kind: 'divider',
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
        bars.push({
          splitId: node.id,
          index: i,
          dir: node.dir,
          join: 'divider',
          pos: cursor + T / 2,
          thickness: T,
          from: horizontal ? rect.y : rect.x,
          to: horizontal ? rect.y + rect.h : rect.x + rect.w,
        });
        cursor += T;
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

  cellLevel(layer.root, { x: 0, y: 0, w: project.box.width, h: project.box.depth }, { height: layer.height, depth: 0 });

  const compartments: Compartment[] = raw.map((r) => ({
    id: r.node.id,
    label: '',
    index: 0,
    layerId: layer.id,
    trayId: r.trayId,
    depth: r.depth,
    wellId: r.wellId,
    height: r.height,
    rect: r.rect,
    node: r.node,
    bounds: r.bounds,
    issues: [],
  }));
  return { layer, trays, compartments, pieces, bars, splits, issues, wallHeight };
}

const readingOrder = (a: Rect, b: Rect) => Math.round(a.y * 2) - Math.round(b.y * 2) || a.x - b.x;

function mergeNotches(notches: Notch[]): Notch[] {
  const sorted = [...notches].sort((a, b) => a.center - b.center);
  const out: { a: Mm; b: Mm; depth: Mm }[] = [];
  for (const n of sorted) {
    const a = n.center - n.width / 2;
    const b = n.center + n.width / 2;
    const last = out[out.length - 1];
    if (last && a <= last.b + 0.01) {
      last.b = Math.max(last.b, b);
      last.depth = Math.max(last.depth, n.depth);
    } else out.push({ a, b, depth: n.depth });
  }
  return out.map((o) => ({ center: (o.a + o.b) / 2, width: o.b - o.a, depth: o.depth }));
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
    sl.trays.sort((a, b) => a.depth - b.depth || (wellOrder.get(a.wellId ?? '') ?? 0) - (wellOrder.get(b.wellId ?? '') ?? 0) || readingOrder(a.outer, b.outer));
    for (const t of sl.trays) {
      trayNumber += 1;
      t.number = trayNumber;
      t.compartments = sl.compartments.filter((c) => c.trayId === t.id).map((c) => c.label);
    }
    for (const p of sl.pieces) {
      if (p.length <= 0 || p.height <= 0) sl.issues.push({ level: 'error', message: 'Some pieces have no size; a section is too small.' });
    }

    const byId = new Map(sl.pieces.map((p) => [p.id, p]));
    const T = project.foam.thickness;
    for (const c of sl.compartments) {
      const { w, h } = c.rect;
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
        const width = Math.min(project.notch.width, span - 4);
        const depth = Math.min(project.notch.depth, p.height - T);
        if (width < 5 || depth < 2) {
          c.issues.push({ level: 'warn', message: `No room for a finger notch on the ${side}.` });
          continue;
        }
        const center = (p.axis === 'x' ? c.rect.x + w / 2 : c.rect.y + h / 2) - p.start;
        p.notches.push({ center, width, depth });
      }
    }
    for (const p of sl.pieces) if (p.notches.length > 1) p.notches = mergeNotches(p.notches);
    for (const p of sl.pieces) p.sides?.forEach((s) => s.sort());
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
