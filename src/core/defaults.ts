import type { Layer, LayoutNode, Project, SectionNode, Side, SheetSpec, SplitChild, SplitNode, Dir } from './types';

export const SHEET_PRESETS: SheetSpec[] = [
  { preset: 'A2', width: 420, height: 594 },
  { preset: 'A3', width: 297, height: 420 },
  { preset: 'A1', width: 594, height: 841 },
  { preset: '50 × 70 cm', width: 500, height: 700 },
  { preset: '60 × 90 cm', width: 600, height: 900 },
  { preset: '20 × 30 in', width: 508, height: 762 },
];

export const THICKNESS_PRESETS = [3, 5, 10];

/** Compartment colours, indexed by label order. Hues spaced so neighbours differ. */
export const SECTION_HUES = [205, 28, 140, 330, 262, 55, 180, 0, 95, 300, 230, 15];

export function sectionColor(index: number, lightness = 88): string {
  return `hsl(${SECTION_HUES[index % SECTION_HUES.length]} 70% ${lightness}%)`;
}

export function sectionInk(index: number): string {
  return `hsl(${SECTION_HUES[index % SECTION_HUES.length]} 60% 30%)`;
}

/** A, B, …, Z, AA, AB, … */
export function labelFor(index: number): string {
  let s = '';
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}${idCounter}`;
}

export function newSection(notches: Side[] = []): SectionNode {
  return { kind: 'section', id: newId('s'), notches: [...notches] };
}

export function newLayer(name: string, height: number, root: LayoutNode = newSection()): Layer {
  return { id: newId('l'), name, height, root };
}

const fixed = (mm: number, node: LayoutNode): SplitChild => ({ size: { mode: 'fixed', mm }, node });
const flex = (node: LayoutNode, weight = 1): SplitChild => ({ size: { mode: 'flex', weight }, node });
const split = (dir: Dir, children: SplitChild[], join: SplitNode['join'] = 'divider'): SplitNode => ({
  kind: 'split',
  id: newId('p'),
  dir,
  join,
  lower: 0,
  children,
});
const pair = () => split('row', [flex(newSection()), flex(newSection())]);
/** A compartment holding one removable box with a divider, notched in front to lift it out. */
const boxed = (): SectionNode => ({ ...newSection(['front']), insert: { root: pair() } });

/** Modelled on a published 5 mm foam insert for DOOM (2016): a 56 mm bottom tray and a 33 mm top tray. */
export function defaultProject(): Project {
  const bottom = split('column', [
    fixed(
      168,
      split('row', [
        fixed(59, newSection(['back', 'front'])),
        fixed(65, newSection(['back', 'front'])),
        fixed(35, newSection()),
        flex(split('column', [fixed(70, newSection()), flex(newSection())])),
      ]),
    ),
    flex(split('row', [flex(newSection()), fixed(141, boxed())])),
  ]);
  const top = split('row', [
    fixed(
      103,
      split('column', [
        fixed(45, pair()),
        fixed(28, newSection()),
        fixed(28, newSection()),
        fixed(28, pair()),
        fixed(28, pair()),
        fixed(28, pair()),
        flex(newSection()),
      ]),
    ),
    flex(split('column', [flex(newSection(['left'])), fixed(30, newSection())])),
  ]);
  return {
    version: 2,
    name: 'DOOM-style insert',
    box: { width: 286, depth: 286, height: 96 },
    foam: { thickness: 5, sheet: { ...SHEET_PRESETS[0] }, trim: 5, kerf: 0.5 },
    precision: 0.5,
    clearance: 1,
    base: 'under',
    fullWalls: 'x',
    notch: { width: 30, depth: 15 },
    layers: [newLayer('Bottom tray', 56, bottom), newLayer('Top tray', 33, top)],
  };
}
