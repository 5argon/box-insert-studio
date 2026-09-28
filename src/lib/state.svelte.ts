import { defaultProject, migrateProject } from '../core/defaults';
import type { Project } from '../core/types';

const KEY = 'box-insert-studio/project-v2';
/** Where autosaves lived before the material setting; read once, then saved under KEY. */
const OLD_KEY = 'box-insert-studio/foam-project';

export type Selection = { kind: 'section' | 'split'; id: string } | null;

/** How trays that are not highlighted are drawn in the 3D view. */
export type ViewStyle = 'wire' | 'glass' | 'solid';

function load(): Project {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    const p = raw ? migrateProject(JSON.parse(raw)) : undefined;
    if (p) return p;
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  return defaultProject();
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
  selected: null as Selection,
  view: 'layout' as 'layout' | '3d' | 'report',
  /** 3D view settings: not part of the project, so not saved or undone. */
  view3d: {
    outer: true,
    style: 'wire' as ViewStyle,
    /** Tray keys drawn solid while the rest use `style`. */
    highlighted: [] as string[],
    hiddenTrays: [] as string[],
    hiddenLayers: [] as string[],
    panel: true,
    ortho: false,
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
  studio.selected = null;
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'insert';
