/**
 * Turns the renderer-independent scene into three.js objects. World axes: X = box x (right),
 * Y = box z (up), Z = box y (toward the front).
 */
import * as THREE from 'three';
import { notchCorners } from '../../core/notches';
import type { Block, Box3, SceneItems, SceneModel } from '../../core/scene';

export type TrayStyle = 'wire' | 'glass' | 'solid' | 'hidden';

/** Camera presets: three-quarter, straight down, from the front, from the right. */
export type Preset = 'iso' | 'top' | 'front' | 'side';

export interface TrayObjects {
  key: string;
  layerId: string;
  group: THREE.Group;
  /** Simulated items, inside `group` so they hide with their tray; always drawn solid. */
  items: THREE.Group;
  fills: THREE.Mesh[];
  lines: THREE.LineSegments[];
  materials: { line: THREE.LineBasicMaterial; glass: THREE.MeshStandardMaterial; solid: THREE.MeshStandardMaterial };
}

export interface SceneObjects {
  root: THREE.Group;
  outer: THREE.LineSegments;
  trays: TrayObjects[];
}

/**
 * Side profile of a wall or divider (length × height): the top edge runs right to left, dipping
 * into each slanted notch and stepping down across each lowered stretch.
 */
function profile(length: number, height: number, notches: Block['notches'], lows: Block['lows']): THREE.Shape {
  const shape = new THREE.Shape();
  let last = { x: 0, y: 0 };
  // Skip repeated points: a lowered stretch that reaches an end would otherwise double a corner.
  const to = (x: number, y: number) => {
    if (Math.abs(x - last.x) < 1e-6 && Math.abs(y - last.y) < 1e-6) return;
    shape.lineTo(x, y);
    last = { x, y };
  };
  shape.moveTo(0, 0);
  to(length, 0);
  to(length, height);
  const features = [
    ...notches.map((n) => {
      // Right to left along the top edge: in at the right slant, across the bottom, out the left.
      const corners = notchCorners(n.center, n.width, n.depth, n.bottom).reverse();
      return {
        at: corners[0][0],
        draw: () => {
          for (const [x, down] of corners) to(x, height - down);
        },
      };
    }),
    ...lows.map((l) => ({
      at: l.to,
      draw: () => {
        to(l.to, height);
        to(l.to, height - l.depth);
        to(l.from, height - l.depth);
        to(l.from, height);
      },
    })),
  ].sort((a, b) => b.at - a.at);
  for (const f of features) f.draw();
  to(0, height);
  shape.closePath();
  return shape;
}

/** Geometry already placed in world coordinates. */
function pieceGeometry(b: Block): THREE.BufferGeometry {
  if (b.kind === 'base' || (!b.notches.length && !b.lows.length)) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    g.translate(b.x + b.w / 2, b.z + b.h / 2, b.y + b.d / 2);
    return g;
  }
  const along = b.axis === 'x';
  const length = along ? b.w : b.d;
  const thick = along ? b.d : b.w;
  const g = new THREE.ExtrudeGeometry(profile(length, b.h, b.notches, b.lows), { depth: thick, bevelEnabled: false, curveSegments: 12 });
  if (along) {
    g.translate(b.x, b.z, b.y);
  } else {
    // Profile runs along world Z and the thickness along X: (u, v, t) → (−t, v, u), then shift by the thickness.
    g.rotateY(-Math.PI / 2);
    g.translate(b.x + b.w, b.z, b.y);
  }
  return g;
}

/** Items thinner than this share one outline around the whole row; thicker ones get their own. */
const OUTLINE_EACH = 1.5;
/** Share of each item's thickness drawn, leaving a hairline gap so neighbours read as separate. */
const ITEM_FILL = 0.88;
const SEGMENTS = 32;

/** Edges of an axis-aligned box in world coordinates, as line-segment pairs. */
function boxEdges(out: number[], b: Box3) {
  const [x0, x1, y0, y1, z0, z1] = [b.x, b.x + b.w, b.z, b.z + b.h, b.y, b.y + b.d];
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  for (const i of e) out.push(...c[i]);
}

/** A disc's rim standing across the row at `at` along its axis, in world coordinates. */
function rim(out: number[], row: SceneItems, b: Box3, at: number) {
  const r = row.axis === 'x' ? b.d / 2 : b.w / 2;
  const cy = b.z + b.h / 2;
  const cc = row.axis === 'x' ? b.y + b.d / 2 : b.x + b.w / 2;
  const point = (a: number) => {
    const u = cc + r * Math.cos(a);
    const v = cy + r * Math.sin(a);
    return row.axis === 'x' ? [at, v, u] : [u, v, at];
  };
  for (let i = 0; i < SEGMENTS; i++) out.push(...point((i / SEGMENTS) * 2 * Math.PI), ...point(((i + 1) / SEGMENTS) * 2 * Math.PI));
}

/** Outlines for a row: each item when they are thick enough to tell apart, else the whole row. */
function itemLines(row: SceneItems): number[] {
  const out: number[] = [];
  const first = row.items[0];
  const last = row.items[row.items.length - 1];
  const lo = (b: Box3) => (row.axis === 'x' ? b.x : b.y);
  const size = (b: Box3) => (row.axis === 'x' ? b.w : b.d);
  const each = row.thickness >= OUTLINE_EACH;
  if (row.shape === 'box') {
    if (each) for (const b of row.items) boxEdges(out, shrink(row, b));
    else {
      const start = Math.min(lo(first), lo(last));
      const end = Math.max(lo(first) + size(first), lo(last) + size(last));
      boxEdges(out, row.axis === 'x' ? { ...first, x: start, w: end - start } : { ...first, y: start, d: end - start });
    }
    return out;
  }
  if (each) {
    for (const b of row.items) {
      const s = shrink(row, b);
      rim(out, row, s, lo(s));
      rim(out, row, s, lo(s) + size(s));
    }
    return out;
  }
  // A long thin roll: its two end rims joined along the top, bottom and sides.
  const start = Math.min(lo(first), lo(last));
  const end = Math.max(lo(first) + size(first), lo(last) + size(last));
  rim(out, row, first, start);
  rim(out, row, first, end);
  const r = (row.axis === 'x' ? first.d : first.w) / 2;
  const cy = first.z + first.h / 2;
  const cc = row.axis === 'x' ? first.y + first.d / 2 : first.x + first.w / 2;
  for (const [du, dv] of [[0, r], [0, -r], [r, 0], [-r, 0]]) {
    const at = (p: number) => (row.axis === 'x' ? [p, cy + dv, cc + du] : [cc + du, cy + dv, p]);
    out.push(...at(start), ...at(end));
  }
  return out;
}

/** The drawn part of an item: a little thinner along the row, centred where it stands. */
function shrink(row: SceneItems, b: Box3): Box3 {
  if (row.axis === 'x') return { ...b, x: b.x + (b.w * (1 - ITEM_FILL)) / 2, w: b.w * ITEM_FILL };
  return { ...b, y: b.y + (b.d * (1 - ITEM_FILL)) / 2, d: b.d * ITEM_FILL };
}

/** Item colours: card-like off-white, or a warm red for items that do not fit. */
function itemMaterials(dark: boolean) {
  const make = (fill: number, line: number) => ({
    fill: new THREE.MeshStandardMaterial({ color: fill, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    line: new THREE.LineBasicMaterial({ color: line }),
  });
  return { ok: make(0xf1ead8, dark ? 0xcfc3a6 : 0x7d6f55), bad: make(0xf2aaa3, dark ? 0xff9a8f : 0xb03a2e) };
}

function itemRow(row: SceneItems, mats: ReturnType<typeof itemMaterials>): THREE.Object3D[] {
  if (!row.items.length) return [];
  const m = row.fits ? mats.ok : mats.bad;
  const geo = row.shape === 'box' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.CylinderGeometry(0.5, 0.5, 1, SEGMENTS);
  // A cylinder's axis starts along world Y; lay it along the row: world X for box x, world Z for box y.
  if (row.shape === 'cylinder') {
    if (row.axis === 'x') geo.rotateZ(Math.PI / 2);
    else geo.rotateX(Math.PI / 2);
  }
  const mesh = new THREE.InstancedMesh(geo, m.fill, row.items.length);
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  row.items.forEach((item, i) => {
    const b = shrink(row, item);
    matrix.compose(new THREE.Vector3(b.x + b.w / 2, b.z + b.h / 2, b.y + b.d / 2), q, new THREE.Vector3(b.w, b.h, b.d));
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(itemLines(row), 3));
  return [mesh, new THREE.LineSegments(lineGeo, m.line)];
}

/** `dark`: lines are lightened to stand out on the dark background. */
export function buildObjects(model: SceneModel, dark = false): SceneObjects {
  const root = new THREE.Group();
  const { w, d, h } = model.box;
  root.position.set(-w / 2, 0, -d / 2);

  const outerGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
  outerGeo.translate(w / 2, h / 2, d / 2);
  const guide = dark ? 0x8f887d : 0x8a8378;
  const outer = new THREE.LineSegments(outerGeo, new THREE.LineDashedMaterial({ color: guide, dashSize: 4, gapSize: 3 }));
  outer.computeLineDistances();
  root.add(outer);

  // A small arrow on the floor pointing to the front of the box.
  const arrow = new THREE.BufferGeometry();
  arrow.setAttribute('position', new THREE.Float32BufferAttribute([w / 2 - 9, 0, d + 8, w / 2, 0, d + 20, w / 2 + 9, 0, d + 8], 3));
  root.add(new THREE.Mesh(arrow, new THREE.MeshBasicMaterial({ color: guide, side: THREE.DoubleSide })));

  const itemMats = itemMaterials(dark);
  const trays = model.trays.map((t): TrayObjects => {
    const group = new THREE.Group();
    const items = new THREE.Group();
    for (const row of t.items) items.add(...itemRow(row, itemMats));
    group.add(items);
    const color = new THREE.Color(t.color);
    const materials = {
      line: new THREE.LineBasicMaterial({ color: dark ? color.clone().lerp(new THREE.Color(0xffffff), 0.25) : color }),
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
    return { key: t.key, layerId: t.layerId, group, items, fills, lines, materials };
  });

  return { root, outer, trays };
}

export function applyStyle(t: TrayObjects, style: TrayStyle, items = true) {
  t.group.visible = style !== 'hidden';
  t.items.visible = items;
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
