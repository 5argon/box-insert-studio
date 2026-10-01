/**
 * The insert as a Wavefront OBJ file, for CAD, 3D printing or rendering: one object per piece,
 * named after its tray, cut-list number and role, e.g. "Tray_1_piece_6_back_wall".
 */
import * as THREE from 'three';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import type { Solved } from '../../core/layout';
import type { CutList } from '../../core/pieces';
import { buildScene } from '../../core/scene';
import type { Project } from '../../core/types';
import { exportMeshes } from './meshes';

const clean = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function insertObj(project: Project, solved: Solved, cut: CutList): string {
  const model = buildScene(project, solved);
  const role = new Map(solved.pieces.map((p) => [p.id, p.role]));
  const group = exportMeshes(model, (b, t) => clean(`${t.label} piece ${cut.groupOf.get(b.id)?.number ?? 0} ${role.get(b.id) ?? b.kind}`));
  group.updateMatrixWorld(true);
  const body = new OBJExporter().parse(group);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  return `# ${project.name}, exported from Box Insert Studio\n# Units: millimetres. Y is up; the origin is the back-left corner of the box floor.\n${body}`;
}
