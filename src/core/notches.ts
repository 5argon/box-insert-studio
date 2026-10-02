import { lowsFacing, notchesFacing, type Compartment, type Solved } from './layout';
import type { Side } from './types';

/**
 * Corners of a slanted finger notch as [along the piece, down from the top edge]: top-left,
 * bottom-left, bottom-right, top-right. Three straight cuts: two slants and the flat bottom.
 */
export { notchCorners } from './geom';

/** The slants' angle from level, in degrees: what to set a square or protractor to. 90 is straight down. */
export function notchSlant(width: number, depth: number, bottom: number): number {
  const run = Math.max(0, (width - bottom) / 2);
  return (Math.atan2(depth, run) * 180) / Math.PI;
}

function pieceOn(solved: Solved, c: Compartment, side: Side) {
  return solved.pieces.find((p) => p.id === c.bounds[side]);
}

/** Is the wall or divider on this side notched where it faces the compartment? */
export function hasNotch(solved: Solved, c: Compartment, side: Side): boolean {
  const p = pieceOn(solved, c, side);
  return !!p && notchesFacing(p, c).length > 0;
}

/** Labels of other compartments whose notch shows on this side of `c`. */
export function notchSharedWith(solved: Solved, c: Compartment, side: Side): string[] {
  const p = pieceOn(solved, c, side);
  if (!p) return [];
  const ids = new Set(notchesFacing(p, c).map((n) => n.compartmentId).filter((id) => id !== c.id));
  return solved.compartments.filter((x) => ids.has(x.id)).map((x) => x.label);
}

/** Is the wall or divider on this side cut down where it faces the compartment? */
export function hasLow(solved: Solved, c: Compartment, side: Side): boolean {
  const p = pieceOn(solved, c, side);
  return !!p && lowsFacing(p, c).length > 0;
}

/** Labels of other compartments whose lowering shows on this side of `c`. */
export function lowSharedWith(solved: Solved, c: Compartment, side: Side): string[] {
  const p = pieceOn(solved, c, side);
  if (!p) return [];
  const ids = new Set(lowsFacing(p, c).map((l) => l.compartmentId).filter((id) => id !== c.id));
  return solved.compartments.filter((x) => ids.has(x.id)).map((x) => x.label);
}

/** Lower this side, or raise every lowering of that stretch again, whichever side asked for it. */
export function toggleLow(solved: Solved, c: Compartment, side: Side) {
  const p = pieceOn(solved, c, side);
  if (!p) return;
  const facing = lowsFacing(p, c);
  if (!facing.length) {
    // Assign a new array rather than push onto `??= []`: on reactive state that expression returns
    // the plain array, not the tracked one, so the push would go unseen.
    c.node.lowered = [...(c.node.lowered ?? []), side];
    return;
  }
  const byId = new Map(solved.compartments.map((x) => [x.id, x]));
  for (const l of facing) {
    const owner = byId.get(l.compartmentId)?.node;
    const i = owner?.lowered?.indexOf(l.side) ?? -1;
    if (owner?.lowered && i >= 0) {
      owner.lowered.splice(i, 1);
      if (!owner.lowered.length) delete owner.lowered;
    }
  }
}

/** Add a notch on this side, or remove every notch cut into that stretch, whichever side asked for it. */
export function toggleNotch(solved: Solved, c: Compartment, side: Side) {
  const p = pieceOn(solved, c, side);
  if (!p) return;
  const facing = notchesFacing(p, c);
  if (!facing.length) {
    c.node.notches.push(side);
    return;
  }
  const byId = new Map(solved.compartments.map((x) => [x.id, x]));
  for (const n of facing) {
    const owner = byId.get(n.compartmentId);
    if (!owner) continue;
    const i = owner.node.notches.indexOf(n.side);
    if (i >= 0) owner.node.notches.splice(i, 1);
  }
}
