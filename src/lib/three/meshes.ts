/**
 * Turns the renderer-independent scene into three.js objects. World axes: X = box x (right),
 * Y = box z (up), Z = box y (toward the front).
 */
import * as THREE from 'three';
import type { Block, SceneModel } from '../../core/scene';

export type TrayStyle = 'wire' | 'glass' | 'solid' | 'hidden';

/** Camera presets: three-quarter, straight down, from the front, from the right. */
export type Preset = 'iso' | 'top' | 'front' | 'side';

export interface TrayObjects {
  key: string;
  layerId: string;
  group: THREE.Group;
  fills: THREE.Mesh[];
  lines: THREE.LineSegments[];
  materials: { line: THREE.LineBasicMaterial; glass: THREE.MeshStandardMaterial; solid: THREE.MeshStandardMaterial };
}

export interface SceneObjects {
  root: THREE.Group;
  outer: THREE.LineSegments;
  trays: TrayObjects[];
}

/** Side profile of a wall or divider (length × height) with its U-notches cut from the top edge. */
function profile(length: number, height: number, notches: Block['notches']): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(length, 0);
  shape.lineTo(length, height);
  for (const n of [...notches].sort((a, b) => b.center - a.center)) {
    const r = Math.min(n.width / 2, n.depth);
    const cy = height - (n.depth - r);
    shape.lineTo(n.center + r, height);
    shape.lineTo(n.center + r, cy);
    shape.absarc(n.center, cy, r, 0, Math.PI, true);
    shape.lineTo(n.center - r, height);
  }
  shape.lineTo(0, height);
  shape.closePath();
  return shape;
}

/** Geometry already placed in world coordinates. */
function pieceGeometry(b: Block): THREE.BufferGeometry {
  if (b.kind === 'base' || !b.notches.length) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    g.translate(b.x + b.w / 2, b.z + b.h / 2, b.y + b.d / 2);
    return g;
  }
  const along = b.axis === 'x';
  const length = along ? b.w : b.d;
  const thick = along ? b.d : b.w;
  const g = new THREE.ExtrudeGeometry(profile(length, b.h, b.notches), { depth: thick, bevelEnabled: false, curveSegments: 12 });
  if (along) {
    g.translate(b.x, b.z, b.y);
  } else {
    // Profile runs along world Z and the thickness along X: (u, v, t) → (−t, v, u), then shift by the thickness.
    g.rotateY(-Math.PI / 2);
    g.translate(b.x + b.w, b.z, b.y);
  }
  return g;
}

export function buildObjects(model: SceneModel): SceneObjects {
  const root = new THREE.Group();
  const { w, d, h } = model.box;
  root.position.set(-w / 2, 0, -d / 2);

  const outerGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
  outerGeo.translate(w / 2, h / 2, d / 2);
  const outer = new THREE.LineSegments(outerGeo, new THREE.LineDashedMaterial({ color: 0x8a8378, dashSize: 4, gapSize: 3 }));
  outer.computeLineDistances();
  root.add(outer);

  // A small arrow on the floor pointing to the front of the box.
  const arrow = new THREE.BufferGeometry();
  arrow.setAttribute('position', new THREE.Float32BufferAttribute([w / 2 - 9, 0, d + 8, w / 2, 0, d + 20, w / 2 + 9, 0, d + 8], 3));
  root.add(new THREE.Mesh(arrow, new THREE.MeshBasicMaterial({ color: 0x8a8378, side: THREE.DoubleSide })));

  const trays = model.trays.map((t): TrayObjects => {
    const group = new THREE.Group();
    const color = new THREE.Color(t.color);
    const materials = {
      line: new THREE.LineBasicMaterial({ color }),
      glass: new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
      solid: new THREE.MeshStandardMaterial({
        color: color.clone().lerp(new THREE.Color(0xffffff), 0.45),
        roughness: 0.9,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    };
    const fills: THREE.Mesh[] = [];
    const lines: THREE.LineSegments[] = [];
    for (const b of t.blocks) {
      const geo = pieceGeometry(b);
      const fill = new THREE.Mesh(geo, materials.solid);
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), materials.line);
      fills.push(fill);
      lines.push(line);
      group.add(fill, line);
    }
    root.add(group);
    return { key: t.key, layerId: t.layerId, group, fills, lines, materials };
  });

  return { root, outer, trays };
}

export function applyStyle(t: TrayObjects, style: TrayStyle) {
  t.group.visible = style !== 'hidden';
  for (const f of t.fills) {
    f.visible = style === 'glass' || style === 'solid';
    f.material = style === 'glass' ? t.materials.glass : t.materials.solid;
    f.renderOrder = style === 'glass' ? 1 : 0;
  }
}

export function disposeObjects(objects: SceneObjects) {
  objects.root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      const m = o.material;
      (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    }
  });
  objects.root.removeFromParent();
}
