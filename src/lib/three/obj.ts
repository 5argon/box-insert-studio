/**
 * The insert as Wavefront OBJ, for CAD, 3D printing or rendering: one object per piece, named after
 * its tray, cut-list number and role, e.g. "Tray_1_piece_6_back_wall". Everything runs in the
 * browser: three.js builds the solids and its bundled fflate zips the files.
 */
import * as THREE from 'three';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js';
import type { Solved } from '../../core/layout';
import type { CutList } from '../../core/pieces';
import { buildScene, type SceneModel, type SceneTray } from '../../core/scene';
import type { Project } from '../../core/types';
import { exportMeshes } from './meshes';

const clean = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'insert';

const HEADER = '# Units: millimetres. Y is up; the origin is the back-left corner of the box floor.';
const TRAY_HEADER = "# Units: millimetres. Y is up; the origin is this tray's own back-left bottom corner.";

/** OBJ text for some of the model's trays; `toOrigin` moves them so their own corner is at 0, 0, 0. */
function objFor(model: SceneModel, solved: Solved, cut: CutList, trays: SceneTray[], toOrigin = false): string {
  const role = new Map(solved.pieces.map((p) => [p.id, p.role]));
  const group = exportMeshes(model, (b, t) => clean(`${t.label} piece ${cut.groupOf.get(b.id)?.number ?? 0} ${role.get(b.id) ?? b.kind}`), trays);
  if (toOrigin) {
    const min = new THREE.Box3().setFromObject(group).min;
    group.position.set(-min.x, -min.y, -min.z);
  }
  group.updateMatrixWorld(true);
  const body = new OBJExporter().parse(group);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  return body;
}

/** The whole insert in one file, as it sits in the box. */
export function insertObj(project: Project, solved: Solved, cut: CutList): string {
  const model = buildScene(project, solved);
  return `# ${project.name}, exported from Box Insert Studio\n${HEADER}\n${objFor(model, solved, cut, model.trays)}`;
}

/**
 * One file per tray: every tray, every removable box (both boxes of a stack) and every shared lid,
 * each moved to its own origin so it can be opened or printed on its own.
 */
export function trayObjs(project: Project, solved: Solved, cut: CutList): { name: string; text: string }[] {
  const model = buildScene(project, solved);
  const taken = new Set<string>();
  return [...model.trays]
    .sort((a, b) => a.number - b.number || a.level - b.level || a.label.localeCompare(b.label))
    .map((t) => {
      let name = `${String(t.number).padStart(2, '0')}-${fileSlug(t.label)}`;
      for (let n = 2; taken.has(name); n++) name = `${String(t.number).padStart(2, '0')}-${fileSlug(t.label)}-${n}`;
      taken.add(name);
      return { name: `${name}.obj`, text: `# ${t.label} of ${project.name}, exported from Box Insert Studio\n${TRAY_HEADER}\n${objFor(model, solved, cut, [t], true)}` };
    });
}

/** The complete model, a trays/ folder with one file per tray, and a note on reading them. */
export function insertObjZip(project: Project, solved: Solved, cut: CutList): Uint8Array<ArrayBuffer> {
  const base = fileSlug(project.name);
  const trays = trayObjs(project, solved, cut);
  const readme = [
    `${project.name}: 3D models exported from Box Insert Studio.`,
    '',
    `${base}.obj  The whole insert as it sits in the box. Origin: the back-left corner of the box floor.`,
    `trays/       One file per tray, removable box and shared lid (${trays.length} files), each with its own`,
    '             back-left bottom corner at the origin. Upper and lower boxes of a stack are separate files.',
    '',
    'Units are millimetres and Y is up. Every piece is a separate object named after its tray, its',
    'number in the cut list and its role. Importers that assume metres need a scale of 0.001.',
    '',
  ].join('\n');
  const files: Record<string, Uint8Array> = {
    [`${base}.obj`]: strToU8(insertObj(project, solved, cut)),
    'README.txt': strToU8(readme),
  };
  for (const t of trays) files[`trays/${t.name}`] = strToU8(t.text);
  // A copy on a plain ArrayBuffer, which is what Blob accepts.
  return new Uint8Array(zipSync(files, { level: 6 }));
}
