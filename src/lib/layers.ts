import { layerColor } from '../core/defaults';
import type { Project } from '../core/types';

/** Name, colour and position of a layer; `multi` is false when the project has only one layer. */
export function layerInfo(project: Project, layerId: string) {
  const index = Math.max(0, project.layers.findIndex((l) => l.id === layerId));
  return { index, name: project.layers[index]?.name ?? '', color: layerColor(index), multi: project.layers.length > 1 };
}
