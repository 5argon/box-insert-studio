import type { Side } from '../core/types';

/** Rotation of an arrow that points right, so it points toward a side in the top view (back is up). */
export const ARROW_ANGLE: Record<Side, number> = { right: 0, front: 90, left: 180, back: -90 };

/** An open arrow pointing right, centred on the origin. */
export function arrowPath(length: number): string {
  const h = length / 2;
  const head = length * 0.32;
  return `M${-h} 0H${h}M${h - head} ${-head}L${h} 0L${h - head} ${head}`;
}

/** Largest font size up to `wanted` at which `chars` characters fit `width`. */
const fit = (chars: number, width: number, wanted: number) => Math.max(0, Math.min(wanted, (width - 2) / (chars * 0.6)));

/**
 * Where and how big to draw a compartment's letter and its arrow. At full size side by side
 * (centred together) if that fits; otherwise the arrow goes above the letter when there is height
 * for it; only as a last resort both shrink to share the width.
 */
export function labelLayout(rect: { x: number; y: number; w: number; h: number }, base: number, chars: number, hasArrow: boolean) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const side = (size: number) => {
    const letterW = chars * size * 0.62;
    const len = size * 0.75;
    const gap = size * 0.18;
    const left = cx - (letterW + gap + len) / 2;
    return { size, letterX: left + letterW / 2, arrow: { x: left + letterW + gap + len / 2, y: cy - size * 0.12, len } };
  };
  if (!hasArrow) return { size: fit(chars, rect.w, base), letterX: cx, arrow: undefined };
  if (chars * base * 0.62 + base * 0.93 <= rect.w - 4) return side(base);
  const size = fit(chars, rect.w, base);
  if (rect.h > size * 2.4) return { size, letterX: cx, arrow: { x: cx, y: cy - size * 0.12 - size * 0.9, len: Math.min(size * 0.75, rect.w - 4) } };
  return side(fit(chars + 1.5, rect.w, base));
}
