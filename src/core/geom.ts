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

/** Round to a step, avoiding float noise such as 87.49999. */
export const roundTo = (v: number, step: number) => (step > 0 ? Math.round(Math.round(v / step) * step * 1000) / 1000 : v);

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 12.5 → "12.5", 12 → "12". */
export const mm = (v: number) => String(Math.round(v * 10) / 10);
