import { mm } from './geom';
import type { PieceInst, Solved, Tray } from './layout';
import { materialLabel, type CutList } from './pieces';
import type { MaterialKind, Project } from './types';

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

  const base = pieces.find((p) => p.kind === 'base')!;
  steps.push({ text: `Start with base #${num(base)}, cut from ${materialLabel(base.material, base.thickness).toLowerCase()}.`, material: base.material, groups: [num(base)], notes: [] });

  const walls = pieces.filter((p) => p.kind === 'wall');
  const wallNotes = (ws: PieceInst[]) => ws.flatMap((p) => pieceNotes(p, `${cap(p.role)} #${num(p)}`));
  const full = walls.slice(0, 2);
  const short = walls.slice(2);
  const fullNames = project.fullWalls === 'x' ? 'back and front' : 'left and right';
  const shortNames = project.fullWalls === 'x' ? 'left and right' : 'back and front';
  const where = project.base === 'under' ? 'on top of the base, flush with its edges' : 'around the edges of the base';
  steps.push({
    text: `Glue the ${fullNames} walls ${refs(full, cut)} ${where}.`,
    groups: full.map(num),
    notes: wallNotes(full),
  });
  steps.push({
    text: `Glue the ${shortNames} walls ${refs(short, cut)} between them.`,
    groups: short.map(num),
    notes: wallNotes(short),
  });

  for (const d of pieces.filter((p) => p.kind === 'divider')) {
    const vertical = d.axis === 'y';
    const offset = vertical ? d.footprint.x - tray.inner.x : d.footprint.y - tray.inner.y;
    const wall = vertical ? 'left' : 'back';
    const between = d.sides ? ` between ${list(d.sides[0])} and ${list(d.sides[1])}` : '';
    steps.push({
      text: `Glue divider #${num(d)}${between}, ${mm(offset)} mm from the ${wall} wall, using ${materialLabel(d.material, d.thickness).toLowerCase()}.`,
      material: d.material,
      groups: [num(d)],
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
      notes: [],
    });
  }
  if (tray.depth === 1) {
    const lid = pieces.find((p) => p.kind === 'lid');
    if (lid && !tray.stacked) steps.push({
      text: `Place lid #${num(lid)}, cut from ${materialLabel(lid.material, lid.thickness).toLowerCase()}, loosely on top of the box walls. Keep it removable. The closed box is ${mm(tray.height)} mm tall.`,
      material: lid.material,
      groups: [num(lid)],
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
      notes: [],
      ...(tray.stacked ? { strong: 'Make a second, identical box body.' } : {}),
    });
    if (lid && tray.stacked) steps.push({
      text: `Place lid #${num(lid)}, cut from ${materialLabel(lid.material, lid.thickness).toLowerCase()}, loosely on the upper box only. Keep it removable. The closed stack is ${mm(2 * tray.height + lid.thickness)} mm tall; its top sits flush with the walls around it.`,
      material: lid.material,
      groups: [num(lid)],
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
      groups: [], notes: [],
    },
    {
      text: `Place shared lid #${number}, cut from ${materialLabel(lid.material, lid.thickness).toLowerCase()}, over the whole group. Keep it removable. ${boxes[0]?.emptyAbove ? 'The covered boxes fill the lower half; the space above stays empty.' : 'The lid’s top sits flush with the walls around the group.'}`,
      material: lid.material, groups: [number], notes: [],
    },
  ];
}
