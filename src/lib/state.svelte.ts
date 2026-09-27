import { defaultProject } from '../core/defaults';
import type { Project } from '../core/types';

const KEY = 'box-insert-studio/foam-project';

export type Selection = { kind: 'section' | 'split'; id: string } | null;

function load(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p?.version === 2) return p as Project;
    }
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  return defaultProject();
}

const initial = load();

export const studio = $state({
  project: initial,
  layerId: initial.layers[initial.layers.length - 1]?.id ?? '',
  selected: null as Selection,
  view: 'layout' as 'layout' | 'report',
  /** Cut-list group number highlighted in the canvas. */
  hoverGroup: null as number | null,
  showNumbers: false,
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
