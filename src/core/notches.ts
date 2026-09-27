import { notchesFacing, type Compartment, type Solved } from './layout';
import type { Side } from './types';

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
