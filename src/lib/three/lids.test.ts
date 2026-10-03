import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { setInsert, setInsertLid, setInsertLidSecondary, setLidNotchSide, setSecondaryThickness, setStacked } from '../../core/edit';
import { blankProject } from '../../core/fixtures';
import { solveProject } from '../../core/layout';
import { buildScene } from '../../core/scene';
import type { SectionNode } from '../../core/types';
import { exportMeshes } from './meshes';

describe('lid meshes', () => {
  it('cuts every selected edge through the sheet with correct volume and stacked placement for V, slanted and slot shapes', () => {
    for (const bottom of [0, 50, 100]) {
      for (const thickness of [3, 5]) {
        const project = blankProject();
        const layer = project.layers[0]!;
        const host = layer.root as SectionNode;
        project.box.width = 130;
        project.box.depth = 170;
        setInsert(layer, host.id, true);
        setInsertLid(host, true);
        setStacked(host, true);
        setSecondaryThickness(project, thickness);
        setInsertLidSecondary(host, true);
        for (const side of ['back', 'front', 'left', 'right'] as const) setLidNotchSide(host, side, true);
        host.insert!.lidNotchSize = { width: 20, depth: 8, bottom };
        const model = buildScene(project, solveProject(project));
        const group = exportMeshes(model, (b) => b.id);
        group.updateMatrixWorld(true);
        try {
          const lids = model.trays.flatMap((t) => t.blocks).filter((b) => b.kind === 'lid');
          expect(lids).toHaveLength(1);
          expect(lids[0]!.z + thickness).toBe(layer.height);
          for (const lid of lids) {
            const mesh = group.getObjectByName(lid.id) as THREE.Mesh;
            const cast = (x: number, y: number) => new THREE.Raycaster(new THREE.Vector3(lid.x + x, lid.z + lid.h + 10, lid.y + y), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
            const centre = cast(lid.w / 2, lid.d / 2);
            expect(centre.length).toBeGreaterThan(0);
            for (const hit of centre) expect(hit.distance).toBeCloseTo(10);
            for (const notch of lid.lidNotches!) {
              const [x, y] = notch.side === 'back' ? [notch.center, notch.depth / 2]
                : notch.side === 'front' ? [notch.center, lid.d - notch.depth / 2]
                : notch.side === 'left' ? [notch.depth / 2, notch.center]
                : [lid.w - notch.depth / 2, notch.center];
              expect(cast(x, y)).toEqual([]);
            }
            const position = mesh.geometry.getAttribute('position');
            const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
            let volume = 0;
            for (let i = 0; i < position.count; i += 3) {
              a.fromBufferAttribute(position, i);
              b.fromBufferAttribute(position, i + 1);
              c.fromBufferAttribute(position, i + 2);
              volume += a.dot(b.cross(c)) / 6;
            }
            const notchArea = 8 * (20 + 20 * bottom / 100) / 2;
            expect(Math.abs(volume)).toBeCloseTo((lid.w * lid.d - 4 * notchArea) * thickness, 1);
            mesh.geometry.computeBoundingBox();
            expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(lid.z);
            expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(lid.z + thickness);
          }
        } finally {
          group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
        }
      }
    }
  });
});
