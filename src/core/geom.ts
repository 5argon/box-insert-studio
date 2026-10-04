import type { Mm } from './types';

export interface Rect {
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
}

export function inset(r: Rect, d: Mm): Rect {
  return { x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d };
}

export const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

/** Snap float noise (87.49999999999999 → 87.5) before rounding, so equal sizes always round alike. */
const snap = (v: number) => Math.round(v * 1e6) / 1e6;

/** Round down to a step, so whatever is cut to it never comes out bigger than the space it fills. */
export const floorTo = (v: number, step: number) => (step > 0 ? Math.round(Math.floor(snap(snap(v) / step)) * step * 1000) / 1000 : v);

/** Round to the nearest step, halves up; equal sizes reached by different sums round the same. */
export const roundTo = (v: number, step: number) => (step > 0 ? Math.round(Math.round(snap(snap(v) / step)) * step * 1000) / 1000 : v);

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 12.5 → "12.5", 12 → "12". */
export const mm = (v: number) => String(Math.round(v * 10) / 10);

/** Four corners of a slanted notch, measured along an edge and inward from it. */
export function notchCorners(center: number, width: number, depth: number, bottom: number): [number, number][] {
  const top = width / 2;
  const flat = Math.min(bottom, width) / 2;
  return [[center - top, 0], [center - flat, depth], [center + flat, depth], [center + top, 0]];
}
