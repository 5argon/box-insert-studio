import type { Layer, LayoutNode, Mm, Project, SectionNode, Side, SheetSpec } from './types';

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

/** What the New dialog asks for: the box, the material, and the one layer to start with. */
export interface NewProjectSpec {
  box: { width: Mm; depth: Mm; height: Mm };
  thickness: Mm;
  sheet: SheetSpec;
  layerHeight: Mm;
  /** Each layer's base from its own sheet, when set. */
  baseThickness?: Mm;
}

/** Clearance for a new design: 1 mm on each side, so trays drop in without jamming. */
export const NEW_CLEARANCE = 2;

/** What the app starts with before anything is set up. */
export const STARTER_SPEC: NewProjectSpec = {
  box: { width: 280, depth: 280, height: 70 },
  thickness: 5,
  sheet: { ...SHEET_PRESETS.find((s) => s.preset === 'A2')! },
  layerHeight: 60,
};

/**
 * A new design: one empty layer in the given box. Finger notches start as wide and as deep as a
 * quarter of the layer height, with a flat bottom half the opening.
 */
export function newProject(spec: NewProjectSpec): Project {
  const notch = spec.layerHeight / 4;
  return {
    version: 2,
    name: 'Untitled insert',
    readme: '',
    box: { ...spec.box },
    material: {
      thickness: spec.thickness,
      ...(spec.baseThickness !== undefined ? { baseThickness: spec.baseThickness } : {}),
      sheet: { ...spec.sheet },
      trim: 5,
      kerf: 0.5,
    },
    precision: 0.5,
    clearance: NEW_CLEARANCE,
    base: 'under',
    fullWalls: 'x',
    notch: { width: notch, depth: notch, bottom: 50 },
    layers: [newLayer('Layer 1', spec.layerHeight)],
  };
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
