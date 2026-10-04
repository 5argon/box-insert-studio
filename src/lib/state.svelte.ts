import { migrateProject, newProject, STARTER_SPEC } from '../core/defaults';
import type { Project } from '../core/types';

const KEY = 'box-insert-studio/project-v2';
/** Where autosaves lived before the material setting; read once, then saved under KEY. */
const OLD_KEY = 'box-insert-studio/foam-project';

/** One selected thing: a compartment, or a split with the divider that was clicked. */
export type Pick = { kind: 'section'; id: string } | { kind: 'split'; id: string; index?: number };
export type Selection = Pick | null;

/** How trays that are not highlighted are drawn in the 3D view. */
export type ViewStyle = 'wire' | 'glass' | 'solid';

/** True when nothing was saved: the app opens the New dialog to set the design up. */
export let firstRun = false;

function load(): Project {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    const p = raw ? migrateProject(JSON.parse(raw)) : undefined;
    if (p) return p;
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  firstRun = true;
  return newProject(STARTER_SPEC);
}

const initial = load();

const PREVIEW_KEY = 'box-insert-studio/preview-collapsed';
function previewCollapsed(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

/** Collapse or expand the layout's corner 3D preview; remembered per browser. */
export function setPreviewCollapsed(collapsed: boolean) {
  studio.previewCollapsed = collapsed;
  try {
    if (collapsed) localStorage.setItem(PREVIEW_KEY, '1');
    else localStorage.removeItem(PREVIEW_KEY);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

export const studio = $state({
  project: initial,
  layerId: initial.layers[initial.layers.length - 1]?.id ?? '',
  /** Selected compartments, or selected dividers: never a mix. */
  selection: [] as Pick[],
  view: 'layout' as 'layout' | '3d' | 'report',
  /** 3D view settings: not part of the project, so not saved or undone. */
  view3d: {
    outer: true,
    style: 'glass' as ViewStyle,
    /** See-through style: how opaque the panels are, 0 to 1. */
    glass: 0.22,
    /** Tray keys drawn solid while the rest use `style`. */
    highlighted: [] as string[],
    hiddenTrays: [] as string[],
    hiddenLayers: [] as string[],
    panel: true,
    ortho: false,
    /** Draw the simulated items in compartments that have them. */
    items: true,
  },
  /** Cut-list group number highlighted in the canvas. */
  hoverGroup: null as number | null,
  showNumbers: false,
  previewCollapsed: previewCollapsed(),
});

export function persist(project: Project) {
  try {
    localStorage.setItem(KEY, JSON.stringify(project));
  } catch {
    // Storage blocked; the in-memory project still works.
  }
}

export function replaceProject(p: Project) {
  studio.project = p;
  studio.layerId = p.layers[p.layers.length - 1]?.id ?? '';
  studio.selection = [];
}

const samePick = (a: Pick, b: Pick) => a.kind === b.kind && a.id === b.id && (a.kind !== 'split' || b.kind !== 'split' || a.index === b.index);

/**
 * Select one thing, or nothing. With `add` (Cmd/Ctrl-click) it joins the selection, or leaves it if
 * already there; picking a different kind (a divider among compartments) starts a new selection.
 */
export function select(sel: Selection, add = false) {
  if (!add) {
    studio.selection = sel ? [sel] : [];
    return;
  }
  if (!sel) return;
  if (studio.selection.some((p) => p.kind !== sel.kind)) {
    studio.selection = [sel];
    return;
  }
  const at = studio.selection.findIndex((p) => samePick(p, sel));
  studio.selection = at >= 0 ? studio.selection.filter((_, i) => i !== at) : [...studio.selection, sel];
}

export function download(filename: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'insert';
