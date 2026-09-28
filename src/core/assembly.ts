import { mm } from './geom';
import type { PieceInst, Solved, Tray } from './layout';
import type { CutList } from './pieces';
import type { Project } from './types';

export interface Step {
  text: string;
  groups: number[];
}

function list(labels: string[]): string {
  if (labels.length <= 4) return labels.join(', ');
  return `${labels.slice(0, 3).join(', ')} … ${labels[labels.length - 1]}`;
}

function refs(pieces: PieceInst[], cut: CutList): string {
  const nums = pieces.map((p) => cut.groupOf.get(p.id)!.number);
  return nums.every((n) => n === nums[0]) ? `#${nums[0]} ×${nums.length}` : nums.map((n) => `#${n}`).join(' and ');
}

function notchText(p: PieceInst): string {
  if (!p.notches.length) return '';
  const end = p.axis === 'x' ? 'left' : 'back';
  const at = p.notches.map((n) => mm(n.center)).join(' and ');
  return ` Notch${p.notches.length > 1 ? 'es' : ''} centred ${at} mm from the ${end} end, open side up.`;
}

/** Glue order for one tray: base, full-length walls, short walls, then dividers from the outside in. */
export function trayInstructions(project: Project, solved: Solved, cut: CutList, tray: Tray): Step[] {
  const pieces = solved.pieces.filter((p) => p.trayId === tray.id).sort((a, b) => a.order - b.order);
  const num = (p: PieceInst) => cut.groupOf.get(p.id)!.number;
  const steps: Step[] = [];

  const base = pieces.find((p) => p.kind === 'base')!;
  // A base from another sheet is called out, so it is not cut from (or confused with) the main material.
  const T = project.material.thickness;
  const other = base.thickness !== T ? `, cut from the ${mm(base.thickness)} mm base sheet (not the ${mm(T)} mm used for the walls)` : '';
  steps.push({ text: `Start with base #${num(base)}${other}.`, groups: [num(base)] });

  const walls = pieces.filter((p) => p.kind === 'wall');
  const full = walls.slice(0, 2);
  const short = walls.slice(2);
  const fullNames = project.fullWalls === 'x' ? 'back and front' : 'left and right';
  const shortNames = project.fullWalls === 'x' ? 'left and right' : 'back and front';
  const where = project.base === 'under' ? 'on top of the base, flush with its edges' : 'around the edges of the base';
  steps.push({
    text: `Glue the ${fullNames} walls ${refs(full, cut)} ${where}.${full.map(notchText).join('')}`,
    groups: full.map(num),
  });
  steps.push({
    text: `Glue the ${shortNames} walls ${refs(short, cut)} between them.${short.map(notchText).join('')}`,
    groups: short.map(num),
  });

  for (const d of pieces.filter((p) => p.kind === 'divider')) {
    const vertical = d.axis === 'y';
    const offset = vertical ? d.footprint.x - tray.inner.x : d.footprint.y - tray.inner.y;
    const wall = vertical ? 'left' : 'back';
    const between = d.sides ? ` between ${list(d.sides[0])} and ${list(d.sides[1])}` : '';
    const lower = d.lower ? ` It stands ${mm(d.lower)} mm lower than the walls.` : '';
    steps.push({
      text: `Glue divider #${num(d)}${between}, ${mm(offset)} mm from the ${wall} wall.${lower}${notchText(d)}`,
      groups: [num(d)],
    });
  }
  // Raised floors go in once the compartment around them is built.
  const pads = pieces.filter((p) => p.kind === 'pad');
  for (const c of solved.compartments.filter((x) => pads.some((p) => p.padFor === x.id))) {
    const mine = pads.filter((p) => p.padFor === c.id);
    steps.push({
      text: `Glue ${refs(mine, cut)} flat into compartment ${c.label}, one on top of another, to raise its floor ${mm(mine.length * project.material.thickness)} mm.`,
      groups: mine.map(num),
    });
  }
  if (tray.depth === 1) {
    const well = solved.compartments.find((c) => c.id === tray.wellId)?.label ?? '?';
    steps.push({
      text: tray.stacked
        ? `Make a second, identical box. Once dry, stack both in compartment ${well}; the top one sits flush with the walls around it.`
        : `Once dry, drop the box into compartment ${well}; its top sits flush with the walls around it.`,
      groups: [],
    });
  }
  return steps;
}
