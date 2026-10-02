import { mm, notchCorners } from './geom';
import type { Mm, NotchSize, Side } from './types';

/** Independent defaults for lid cutouts; never read from the project's wall notch shape. */
export const LID_NOTCH_DEFAULT: Readonly<NotchSize> = { width: 30, depth: 15, bottom: 50 };

export interface LidNotch {
  side: Side;
  /** Distance along the edge from its left or back end. */
  center: Mm;
  width: Mm;
  /** Distance inward, perpendicular to the selected edge, in the plane of the lid. */
  depth: Mm;
  bottom: Mm;
}

const SIDES: Side[] = ['back', 'right', 'front', 'left'];
const OPPOSITE: Record<Side, Side> = { back: 'front', front: 'back', left: 'right', right: 'left' };

/** Fit cutouts within the lid, keeping a small bridge between cuts from neighbouring edges. */
export function solveLidNotches(width: Mm, height: Mm, sides: Side[], size: NotchSize = LID_NOTCH_DEFAULT) {
  const selected = SIDES.filter((side) => sides.includes(side));
  const opening = (side: Side) => Math.max(0, Math.min(size.width, (side === 'back' || side === 'front' ? width : height) - 4));
  const notches: LidNotch[] = [];
  const warnings: string[] = [];
  for (const side of selected) {
    const horizontal = side === 'back' || side === 'front';
    const along = horizontal ? width : height;
    const across = horizontal ? height : width;
    let maxDepth = selected.includes(OPPOSITE[side]) ? (across - 4) / 2 : across - 4;
    for (const adjacent of selected.filter((edge) => edge !== side && edge !== OPPOSITE[side])) {
      maxDepth = Math.min(maxDepth, (across - opening(adjacent)) / 2 - 2);
    }
    const w = opening(side);
    const depth = Math.max(0, Math.min(size.depth, maxDepth));
    if (w < 5 || depth < 2) {
      warnings.push(`No room for a finger notch on the ${side} of the lid.`);
      continue;
    }
    notches.push({ side, center: along / 2, width: w, depth, bottom: w * Math.max(0, Math.min(100, size.bottom ?? 50)) / 100 });
    if (w < size.width || depth < size.depth) warnings.push(`Lid ${side} notch reduced to ${mm(w)} × ${mm(depth)} mm to fit the lid.`);
  }
  return { notches, warnings };
}

/** Cutout corners in lid coordinates, with x rightward and y toward the front. */
export function lidNotchPoints(width: Mm, height: Mm, notch: LidNotch): [number, number][] {
  return notchCorners(notch.center, notch.width, notch.depth, notch.bottom).map(([along, inward]) => {
    switch (notch.side) {
      case 'back': return [along, inward];
      case 'front': return [along, height - inward];
      case 'left': return [inward, along];
      case 'right': return [width - inward, along];
    }
  });
}

/** Clockwise perimeter for the flat lid, including the cuts through its edges. */
export function lidOutline(width: Mm, height: Mm, notches: LidNotch[] = []): [number, number][] {
  const points: [number, number][] = [[0, 0]];
  for (const side of SIDES) {
    const notch = notches.find((n) => n.side === side);
    if (notch) {
      const corners = lidNotchPoints(width, height, notch);
      points.push(...(side === 'front' || side === 'left' ? corners.reverse() : corners));
    }
    if (side === 'back') points.push([width, 0]);
    else if (side === 'right') points.push([width, height]);
    else if (side === 'front') points.push([0, height]);
  }
  return points.filter((p, i) => !i || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1]);
}

export function polygonPath(points: [number, number][], x = 0, y = 0): string {
  return points.map(([px, py], i) => `${i ? 'L' : 'M'}${px + x} ${py + y}`).join(' ') + ' Z';
}

/** Rotate a flat piece clockwise, swapping its width and depth while preserving its edge cuts. */
export function rotateLidNotches(notches: LidNotch[], height: Mm): LidNotch[] {
  return notches.map((n) => {
    switch (n.side) {
      case 'back': return { ...n, side: 'right' };
      case 'right': return { ...n, side: 'front', center: height - n.center };
      case 'front': return { ...n, side: 'left' };
      case 'left': return { ...n, side: 'back', center: height - n.center };
    }
  });
}

/** Describe the cut on the assembled lid, independent of rotations used to pack the sheet. */
export function lidNotchText(n: LidNotch): string {
  return `${n.side}: ${mm(n.width)} mm along the edge × ${mm(n.depth)} mm inward, ${mm(n.bottom)} mm flat bottom, centred ${mm(n.center)} mm from the ${n.side === 'front' || n.side === 'back' ? 'left' : 'back'} end`;
}
