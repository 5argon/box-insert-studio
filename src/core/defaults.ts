import type { Layer, LayoutNode, Project, SectionNode, Side, SheetSpec, SplitChild, SplitNode, Dir } from './types';

export const SHEET_PRESETS: SheetSpec[] = [
  { preset: 'A4', width: 210, height: 297 },
  { preset: 'A3', width: 297, height: 420 },
  { preset: 'A2', width: 420, height: 594 },
  { preset: 'A1', width: 594, height: 841 },
  { preset: 'Letter', width: 215.9, height: 279.4 },
  { preset: '50 × 70 cm', width: 500, height: 700 },
  { preset: '60 × 90 cm', width: 600, height: 900 },
  { preset: '20 × 30 in', width: 508, height: 762 },
];

export const THICKNESS_PRESETS = [3, 5, 10];

/** Layer colours, by position from the bottom; used with the layer icon when there are 2+ layers. */
const LAYER_COLORS = ['#7b6fd6', '#d9822b', '#2a9d8f', '#c44569', '#5a8f29', '#3d7cc9'];

export function layerColor(index: number): string {
  return LAYER_COLORS[index % LAYER_COLORS.length];
}

/** Compartment colours, indexed by label order. Hues spaced so neighbours differ. */
export const SECTION_HUES = [205, 28, 140, 330, 262, 55, 180, 0, 95, 300, 230, 15];

/**
 * Compartment fill. `lightness` is for the light theme; the dark theme maps it to a deep tint
 * through CSS variables (see app.css), so use it as a CSS value (style), not an SVG attribute.
 */
export function sectionColor(index: number, lightness = 88): string {
  return `hsl(${SECTION_HUES[index % SECTION_HUES.length]} var(--sec-sat, 70%) calc(var(--sec-a, 0%) + var(--sec-b, 1) * ${lightness}%))`;
}

/** Text and outline colour on a compartment fill: dark ink in light mode, light ink in dark mode. */
export function sectionInk(index: number): string {
  return `hsl(${SECTION_HUES[index % SECTION_HUES.length]} 60% var(--sec-ink, 30%))`;
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
    readme: `Insert for **DOOM: The Board Game** (2016), after a published 5 mm foam board design.

## Where things go

| Tray | Holds |
| --- | --- |
| Bottom | Cards in **A** and **B** (finger notches front and back), tokens in the rest, dice in the lift-out box in **G** |
| Top | Map tiles in **J**, small tokens in the left column |

## Building tips

- The top tray sits on the bottom tray's walls; the board and rulebook go on top.
- Glue with thick PVA and pin the walls while it dries.
`,
    box: { width: 286, depth: 286, height: 96 },
    material: { thickness: 5, sheet: { ...SHEET_PRESETS.find((s) => s.preset === 'A2')! }, trim: 5, kerf: 0.5 },
    precision: 0.5,
    clearance: 1,
    base: 'under',
    fullWalls: 'x',
    notch: { width: 30, depth: 15 },
    layers: [newLayer('Bottom tray', 56, bottom), newLayer('Top tray', 33, top)],
  };
}

/**
 * An empty box: one tray layer with a single compartment. Box size and material, construction
 * and notch settings carry over from `from` when given, since a new design is usually for the
 * same kind of board and often the same box.
 */
export function blankProject(from?: Project): Project {
  const base = from ? structuredClone(from) : defaultProject();
  const height = Math.max(10, base.box.height - 10);
  return { ...base, name: 'Untitled insert', readme: '', layers: [newLayer('Layer 1', height)] };
}

/**
 * Bring a saved project up to date. Projects from before the material setting kept it under
 * `foam`; some briefly had a material name, which is no longer used. Returns undefined for
 * anything that is not a project from this app.
 */
export function migrateProject(raw: unknown): Project | undefined {
  const p = raw as (Project & { foam?: Project['material'] }) | null;
  if (!p || p.version !== 2 || !Array.isArray(p.layers) || !p.box) return undefined;
  if (!p.material && p.foam) {
    p.material = { ...p.foam };
    delete p.foam;
  }
  if (!p.material) return undefined;
  delete (p.material as Project['material'] & { name?: string }).name;
  return p;
}
