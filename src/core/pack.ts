/**
 * Deterministic sheet packing: MaxRects (best short side fit) with 90° rotation, run with a few
 * item orders; the result using the fewest sheets wins, ties go to the earlier order.
 * Items may expose `holes` (empty areas inside their bounding box, e.g. the corners between
 * the arms of a tray net) that later, smaller items can use.
 */
import type { Rect } from './geom';
import type { Mm } from './types';

export interface PackItem {
  id: string;
  w: Mm;
  h: Mm;
  holes?: Rect[];
}

export interface Placement {
  id: string;
  sheet: number;
  x: Mm;
  y: Mm;
  /** Rotated 90° clockwise: local (px, py) → (x + h − py, y + px). */
  rotated: boolean;
}

export interface PackResult {
  sheetCount: number;
  placements: Placement[];
  unplaced: string[];
}

const EPS = 1e-6;

const contains = (a: Rect, b: Rect) => b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;

class Bin {
  free: Rect[];
  constructor(w: Mm, h: Mm) {
    this.free = [{ x: 0, y: 0, w, h }];
  }

  find(w: Mm, h: Mm, allowRotate: boolean) {
    let best: { x: Mm; y: Mm; rotated: boolean; s1: number; s2: number } | undefined;
    for (const rotated of allowRotate ? [false, true] : [false]) {
      const iw = rotated ? h : w;
      const ih = rotated ? w : h;
      for (const f of this.free) {
        if (iw > f.w + EPS || ih > f.h + EPS) continue;
        const dx = f.w - iw;
        const dy = f.h - ih;
        const s1 = Math.min(dx, dy);
        const s2 = Math.max(dx, dy);
        if (!best || s1 < best.s1 - EPS || (Math.abs(s1 - best.s1) <= EPS && (s2 < best.s2 - EPS || (Math.abs(s2 - best.s2) <= EPS && (f.y < best.y - EPS || (Math.abs(f.y - best.y) <= EPS && f.x < best.x - EPS)))))) {
          best = { x: f.x, y: f.y, rotated, s1, s2 };
        }
      }
    }
    return best;
  }

  occupy(r: Rect) {
    const next: Rect[] = [];
    for (const f of this.free) {
      if (!intersects(f, r)) {
        next.push(f);
        continue;
      }
      if (r.x > f.x + EPS) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w - EPS) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
      if (r.y > f.y + EPS) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h - EPS) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
    }
    this.free = prune(next);
  }

  addFree(r: Rect) {
    if (r.w > EPS && r.h > EPS) this.free = prune([...this.free, r]);
  }
}

function prune(rects: Rect[]): Rect[] {
  return rects.filter((r, i) => r.w > EPS && r.h > EPS && !rects.some((o, j) => j !== i && contains(o, r) && (!contains(r, o) || j < i)));
}

function rotateHole(h: Rect, itemH: Mm): Rect {
  return { x: itemH - (h.y + h.h), y: h.x, w: h.h, h: h.w };
}

function packOrdered(items: PackItem[], W: Mm, H: Mm, gap: Mm): PackResult {
  const bins: Bin[] = [];
  const placements: Placement[] = [];
  const unplaced: string[] = [];
  const BW = W + gap;
  const BH = H + gap;
  for (const item of items) {
    const iw = item.w + gap;
    const ih = item.h + gap;
    if (!((iw <= BW + EPS && ih <= BH + EPS) || (ih <= BW + EPS && iw <= BH + EPS))) {
      unplaced.push(item.id);
      continue;
    }
    let placed = false;
    for (let s = 0; s <= bins.length && !placed; s++) {
      if (s === bins.length) bins.push(new Bin(BW, BH));
      const bin = bins[s];
      const spot = bin.find(iw, ih, true);
      if (!spot) continue;
      const pw = spot.rotated ? ih : iw;
      const ph = spot.rotated ? iw : ih;
      bin.occupy({ x: spot.x, y: spot.y, w: pw, h: ph });
      for (const hole of item.holes ?? []) {
        const r = spot.rotated ? rotateHole(hole, item.h) : hole;
        bin.addFree({ x: spot.x + r.x + gap, y: spot.y + r.y + gap, w: r.w - gap, h: r.h - gap });
      }
      placements.push({ id: item.id, sheet: s, x: spot.x, y: spot.y, rotated: spot.rotated });
      placed = true;
    }
  }
  return { sheetCount: bins.length, placements, unplaced };
}

type Order = (a: PackItem, b: PackItem) => number;
const tie = (a: PackItem, b: PackItem) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ORDERS: Order[] = [
  (a, b) => b.w * b.h - a.w * a.h || tie(a, b),
  (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || tie(a, b),
  (a, b) => b.w + b.h - (a.w + a.h) || tie(a, b),
  (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h) || tie(a, b),
];

export function pack(items: PackItem[], sheetW: Mm, sheetH: Mm, gap: Mm): PackResult {
  let best: PackResult | undefined;
  for (const order of ORDERS) {
    const r = packOrdered([...items].sort(order), sheetW, sheetH, gap);
    if (!best || r.unplaced.length < best.unplaced.length || (r.unplaced.length === best.unplaced.length && r.sheetCount < best.sheetCount)) best = r;
  }
  return best ?? { sheetCount: 0, placements: [], unplaced: [] };
}
