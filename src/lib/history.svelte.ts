import { History } from '../core/history';
import type { Project } from '../core/types';
import { studio } from './state.svelte';

const history = new History();

/** Reactive mirror of what the history can do, for the buttons. */
export const undoState = $state({ canUndo: false, canRedo: false });

function sync() {
  undoState.canUndo = history.canUndo;
  undoState.canRedo = history.canRedo;
}

export function recordProject(json: string) {
  history.record(json, performance.now());
  sync();
}

/** Call on each new gesture (a click, a drag start) so it becomes its own undo step. */
export function breakStep() {
  history.breakStep();
}

function apply(json: string) {
  const project = JSON.parse(json) as Project;
  studio.project = project;
  if (!project.layers.some((l) => l.id === studio.layerId)) studio.layerId = project.layers[project.layers.length - 1]?.id ?? '';
}

export function undo() {
  const state = history.undo();
  if (state) apply(state);
  sync();
}

export function redo() {
  const state = history.redo();
  if (state) apply(state);
  sync();
}
