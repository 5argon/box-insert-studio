import { mm } from './geom';
import type { PieceInst, Solved, Tray } from './layout';
import { materialLabel, twoMaterials, type CutList } from './pieces';
import type { MaterialKind, Mm, Project } from './types';

/** A detail of a step that is easy to miss, shown with a bold label in the diagram's colour. */
export interface StepNote {
  kind: 'lowered';
  label: string;
  text: string;
}

export interface Step {
  /** A sentence to stand out, printed in bold before `text`. */
  strong?: string;
  /** Material to call out when a step places a base, lid or individual divider. */
  material?: MaterialKind;
  text: string;
  groups: number[];
  /** Ids of the pieces this step puts in place, to point them out on the tray's diagram. */
  pieces: string[];
  /** Where a divider goes: how far it stands from the inner face of the wall it is nearer to. */
  measure?: { wall: 'left' | 'right' | 'back' | 'front'; distance: Mm };
  notes: StepNote[];
}

function list(labels: string[]): string {
  if (labels.length <= 4) return labels.join(', ');
  return `${labels.slice(0, 3).join(', ')} … ${labels[labels.length - 1]}`;
}

function refs(pieces: PieceInst[], cut: CutList): string {
  const nums = pieces.map((p) => cut.groupOf.get(p.id)!.number);
  return nums.every((n) => n === nums[0]) ? `#${nums[0]} ×${nums.length}` : nums.map((n) => `#${n}`).join(' and ');
}

const notchCount = (n: number) => `with ${n} finger ${n === 1 ? 'notch' : 'notches'} already cut`;

/**
 * Which of the pieces sharing a number goes here: a reminder beside a wall or divider that its
 * finger notches were cut before assembly, or that it is one of those left plain.
 */
function notched(p: PieceInst, cut: CutList): string {
  const shapes = notchedShapes(p, cut);
  if (!p.notches.length) return shapes.length ? ' (one without finger notches)' : '';
  // Several notched shapes under one number are told apart as the cutting instructions number them.
  const shape = shapes.length > 1 ? `shape ${shapes.findIndex((s) => s.pieces.includes(p)) + 1}, ` : '';
  return ` (${shape}${notchCount(p.notches.length)})`;
}

/** The notched shapes among the pieces sharing this piece's number. */
const notchedShapes = (p: PieceInst, cut: CutList) => cut.groupOf.get(p.id)!.shapes.filter((s) => s.notches.length);

/** Walls glued in one step, each kind with its notch reminder. */
function wallRefs(walls: PieceInst[], cut: CutList): string {
  const nums = walls.map((p) => cut.groupOf.get(p.id)!.number);
  if (!nums.every((n) => n === nums[0]) || notchedShapes(walls[0], cut).length > 1) return walls.map((p, i) => `#${nums[i]}${notched(p, cut)}`).join(' and ');
  // One number, at most one notched shape: say how many of them are notched when they are not all alike.
  const counts = new Map<number, number>();
  for (const p of walls) counts.set(p.notches.length, (counts.get(p.notches.length) ?? 0) + 1);
  if (counts.size === 1) {
    // Plain walls that share their number with notched pieces are picked out too.
    if (!walls[0].notches.length) return `${refs(walls, cut)}${notched(walls[0], cut).replace('one', walls.length === 1 ? 'one' : walls.length === 2 ? 'both' : 'all')}`;
    return `${refs(walls, cut)} (${walls.length > 1 ? 'each ' : ''}${notchCount(walls[0].notches.length)})`;
  }
  const kinds = [...counts].sort((a, b) => b[0] - a[0]).map(([n, k]) => (n ? `${k} ${notchCount(n)}` : `${k} without`));
  return `${refs(walls, cut)} (${kinds.join(', ')})`;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Pieces shown for one body build, plus the upper-only lid when this tray represents a pair. */
export function trayAssemblyPieces(solved: Solved, tray: Tray): PieceInst[] {
  const upper = solved.trays.find((t) => t.copyOf === tray.id);
  return solved.pieces.filter((p) => !p.sharedLidFor && (p.trayId === tray.id || (p.trayId === upper?.id && p.kind === 'lid'))).sort((a, b) => a.order - b.order);
}

/**
 * Height reminders for already-cut walls and dividers. Cutting instructions appear before assembly.
 */
function pieceNotes(p: PieceInst, who = ''): StepNote[] {
  const notes: StepNote[] = [];
  const lead = who ? `${who}: ` : '';
  // Lowered end to end, or by the split's "lower dividers": a shorter piece.
  const drop = (p.lower ?? 0) + (p.cut ?? 0);
  if (drop) notes.push({ kind: 'lowered', label: 'Lowered', text: `${lead}stands ${mm(drop)} mm lower than the ${p.kind === 'wall' ? 'other walls' : 'walls'}.` });
  return notes;
}

/** Glue order for one tray: base, full-length walls, short walls, then dividers from the outside in. */
export function trayInstructions(project: Project, solved: Solved, cut: CutList, tray: Tray): Step[] {
  const pieces = trayAssemblyPieces(solved, tray);
  const num = (p: PieceInst) => cut.groupOf.get(p.id)!.number;
  const steps: Step[] = [];
  /** Which material a piece is from, said only when the design has two to choose between. */
  const of = (p: PieceInst, how: string, after = '') => (twoMaterials(project) ? `, ${how} ${materialLabel(p.material, p.thickness).toLowerCase()}${after}` : '');

  const base = pieces.find((p) => p.kind === 'base')!;
  steps.push({ text: `Start with base #${num(base)}${of(base, 'cut from')}.`, material: base.material, groups: [num(base)], pieces: [base.id], notes: [] });

  const walls = pieces.filter((p) => p.kind === 'wall');
  const wallNotes = (ws: PieceInst[]) => ws.flatMap((p) => pieceNotes(p, `${cap(p.role)} #${num(p)}`));
  const full = walls.slice(0, 2);
  const short = walls.slice(2);
  const fullNames = project.fullWalls === 'x' ? 'back and front' : 'left and right';
  const shortNames = project.fullWalls === 'x' ? 'left and right' : 'back and front';
  const where = project.base === 'under' ? 'on top of the base, flush with its edges' : 'around the edges of the base';
  steps.push({
    text: `Glue the ${fullNames} walls ${wallRefs(full, cut)} ${where}.`,
    groups: full.map(num),
    pieces: full.map((p) => p.id),
    notes: wallNotes(full),
  });
  steps.push({
    text: `Glue the ${shortNames} walls ${wallRefs(short, cut)} between them.`,
    groups: short.map(num),
    pieces: short.map((p) => p.id),
    notes: wallNotes(short),
  });

  for (const d of pieces.filter((p) => p.kind === 'divider')) {
    const vertical = d.axis === 'y';
    // Measured from the nearer of the two walls it stands between: a shorter distance to mark.
    const before = vertical ? d.footprint.x - tray.inner.x : d.footprint.y - tray.inner.y;
    const after = vertical ? tray.inner.x + tray.inner.w - (d.footprint.x + d.footprint.w) : tray.inner.y + tray.inner.h - (d.footprint.y + d.footprint.h);
    const near = before <= after + 1e-6;
    const offset = near ? before : after;
    const wall = vertical ? (near ? 'left' : 'right') : near ? 'back' : 'front';
    const between = d.sides ? ` between ${list(d.sides[0])} and ${list(d.sides[1])}` : '';
    steps.push({
      text: `Glue divider #${num(d)}${notched(d, cut)}${between}, ${mm(offset)} mm from the ${wall} wall${of(d, 'using')}.`,
      material: d.material,
      groups: [num(d)],
      pieces: [d.id],
      measure: { wall, distance: offset },
      notes: pieceNotes(d),
    });
  }
  // Raised floors go in once the compartment around them is built.
  const pads = pieces.filter((p) => p.kind === 'pad');
  for (const c of solved.compartments.filter((x) => pads.some((p) => p.padFor === x.id))) {
    const mine = pads.filter((p) => p.padFor === c.id);
    steps.push({
      text: `Glue ${refs(mine, cut)} flat into compartment ${c.label}, one on top of another, to raise its floor ${mm(mine.length * project.material.thickness)} mm.`,
      groups: mine.map(num),
      pieces: mine.map((p) => p.id),
      notes: [],
    });
  }
  if (tray.depth === 1) {
    const lid = pieces.find((p) => p.kind === 'lid');
    if (lid && !tray.stacked) steps.push({
      text: `Place lid #${num(lid)}${of(lid, 'cut from', ',')} loosely on top of the box walls. Keep it removable. The closed box is ${mm(tray.height)} mm tall.`,
      material: lid.material,
      groups: [num(lid)],
      pieces: [lid.id],
      notes: [],
    });
    const well = solved.compartments.find((c) => c.id === tray.wellId)?.label ?? '?';
    const shared = solved.pieces.find((p) => p.sharedLidFor === tray.wellId);
    steps.push({
      text: shared
        ? `Build ${tray.stacked ? 'both identical boxes' : 'this box'} separately and set ${tray.stacked ? 'them' : 'it'} aside for compartment ${well}. Position the complete group before fitting its shared lid.`
        : tray.stacked
        ? `Stack the upper box directly on the lower box in compartment ${well}. Its base covers the lower box${lid ? '; only the upper box needs a lid' : ', and the stack sits flush with the walls around it'}.`
        : tray.emptyAbove
          ? `Drop the box into compartment ${well}. It is half as tall as the walls around it; the space above it stays empty.`
          : `Drop the box${lid ? ' with its lid on' : ''} into compartment ${well}; its top sits flush with the walls around it.`,
      groups: [],
      pieces: [],
      notes: [],
      ...(tray.stacked ? { strong: 'Make a second, identical box body.' } : {}),
    });
    if (lid && tray.stacked) steps.push({
      text: `Place lid #${num(lid)}${of(lid, 'cut from', ',')} loosely on the upper box only. Keep it removable. The closed stack is ${mm(2 * tray.height + lid.thickness)} mm tall; its top sits flush with the walls around it.`,
      material: lid.material,
      groups: [num(lid)],
      pieces: [lid.id],
      notes: [],
    });
  }
  return steps;
}

/** Finish a group after all its separate boxes have been built, then fit their one shared cover. */
export function sharedLidInstructions(project: Project, solved: Solved, cut: CutList, lid: PieceInst): Step[] {
  const well = solved.compartments.find((c) => c.id === lid.sharedLidFor);
  if (!well) return [];
  const boxes = solved.trays.filter((t) => t.wellId === well.id && !t.copyOf);
  const refs = boxes.map((t) => t.number).join(', ');
  const number = cut.groupOf.get(lid.id)!.number;
  return [
    {
      text: `Put the separate boxes from trays ${refs} into compartment ${well.label} in the positions shown${boxes[0]?.stacked ? ', then stack each identical upper box directly on its lower box' : ''}. Fit the lid after all boxes are in place.`,
      groups: [], pieces: [], notes: [],
    },
    {
      text: `Place shared lid #${number}${twoMaterials(project) ? `, cut from ${materialLabel(lid.material, lid.thickness).toLowerCase()},` : ''} over the whole group. Keep it removable. ${boxes[0]?.emptyAbove ? 'The covered boxes fill the lower half; the space above stays empty.' : 'The lid’s top sits flush with the walls around the group.'}`,
      material: lid.material, groups: [number], pieces: [lid.id], notes: [],
    },
  ];
}
