/**
 * 3D placement of every piece, independent of any renderer. Box coordinates: x → right,
 * y → toward the front, z → up, origin at the back-left corner of the box floor.
 *
 * Heights: each layer starts where the layers below it end. Walls stand on the base (or around
 * it), dividers stand on the base. A removable box stands on its tray's base; the upper box of a
 * stack stands on the lower one.
 */
import type { Notch, PieceKind, Solved, Tray } from './layout';
import type { Mm, Project } from './types';

export interface Block {
  id: string;
  kind: PieceKind;
  /** Min corner. */
  x: Mm;
  y: Mm;
  z: Mm;
  /** Extent along x, y and z. */
  w: Mm;
  d: Mm;
  h: Mm;
  /** Walls and dividers: the direction their length runs. Notches are cut down from the top edge. */
  axis: 'x' | 'y';
  /** Centres measured from the piece's start (its left or back end). */
  notches: Notch[];
}

export interface SceneTray {
  /** Stable across edits: layer, source layout node and stack level. */
  key: string;
  id: string;
  number: number;
  label: string;
  detail: string;
  layerId: string;
  depth: 0 | 1;
  /** 0, or 1 for the upper box of a stack. */
  level: 0 | 1;
  color: string;
  blocks: Block[];
}

export interface SceneLayer {
  id: string;
  name: string;
  z: Mm;
  height: Mm;
}

export interface SceneModel {
  /** The game box's inside. */
  box: { w: Mm; d: Mm; h: Mm };
  layers: SceneLayer[];
  trays: SceneTray[];
}

const TRAY_HUES = [212, 18, 146, 280, 42, 330, 188, 96, 250, 0, 168, 60];

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Line colour for tray `index`; the same colour marks it in the viewer's tray list. */
export function trayColor(index: number, lightness = 45): string {
  return hslToHex(TRAY_HUES[index % TRAY_HUES.length], 68, lightness);
}

/**
 * `colors` remembers which hue each tray key got. Pass the same map on every build (the viewer
 * keeps one for the session) and a tray keeps its colour for as long as it exists; new trays
 * take a hue no current tray uses.
 */
export function buildScene(project: Project, solved: Solved, colors: Map<string, number> = new Map()): SceneModel {
  const T = project.material.thickness;
  const layers: SceneLayer[] = [];
  let z = 0;
  for (const l of project.layers) {
    layers.push({ id: l.id, name: l.name, z, height: l.height });
    z += l.height;
  }
  const layerZ = new Map(layers.map((l) => [l.id, l.z]));
  const trayById = new Map(solved.trays.map((t) => [t.id, t]));
  const labelOf = new Map(solved.compartments.map((c) => [c.id, c.label]));

  const padUnder = new Map(solved.compartments.map((c) => [c.id, c.padHeight]));

  /** Height of the tray's floor underside. A box stands on the tray's base and any raised floor. */
  function floorZ(t: Tray): Mm {
    const base = layerZ.get(t.layerId) ?? 0;
    if (t.depth === 0) return base;
    return base + T + (padUnder.get(t.wellId ?? '') ?? 0) + (t.copyOf ? t.height : 0);
  }

  const keyOf = (t: Tray) => `${t.layerId}:${t.nodeId}:${t.copyOf ? 1 : 0}`;
  const taken = new Set(solved.trays.map(keyOf).filter((k) => colors.has(k)).map((k) => colors.get(k)!));
  const hueFor = (key: string) => {
    const known = colors.get(key);
    if (known !== undefined) return known;
    let hash = 0;
    for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    let i = hash % TRAY_HUES.length;
    for (let n = 0; n < TRAY_HUES.length && taken.has(i); n++) i = (i + 1) % TRAY_HUES.length;
    taken.add(i);
    colors.set(key, i);
    return i;
  };

  const trays: SceneTray[] = solved.trays.map((t) => {
    const bottom = floorZ(t);
    const blocks: Block[] = solved.pieces
      .filter((p) => p.trayId === t.id)
      .map((p) => {
        const onBase = p.kind === 'divider' || (p.kind === 'wall' && project.base === 'under');
        // Raised-floor layers stack on the base, one thickness each.
        const pz = p.kind === 'base' ? bottom : p.kind === 'pad' ? bottom + T + (p.padLevel ?? 0) * T : bottom + (onBase ? T : 0);
        const h = p.kind === 'base' || p.kind === 'pad' ? T : p.height;
        return { id: p.id, kind: p.kind, x: p.footprint.x, y: p.footprint.y, z: pz, w: p.footprint.w, d: p.footprint.h, h, axis: p.axis, notches: p.notches };
      });
    const lower = t.copyOf ? trayById.get(t.copyOf) : undefined;
    const level: 0 | 1 = lower ? 1 : 0;
    const well = t.wellId ? labelOf.get(t.wellId) : undefined;
    const label =
      t.depth === 0 ? `Tray ${t.number}` : t.stacked ? `Box in ${well}, ${level ? 'upper' : 'lower'}` : `Box in ${well}`;
    const key = keyOf(t);
    return {
      key,
      id: t.id,
      number: t.number,
      label,
      detail: t.compartments.join(', '),
      layerId: t.layerId,
      depth: t.depth,
      level,
      color: trayColor(hueFor(key)),
      blocks,
    };
  });

  return { box: { w: project.box.width, d: project.box.depth, h: project.box.height }, layers, trays };
}

/** Overlapping volume of two blocks, ignoring notches. */
export function overlap(a: Block, b: Block): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
  const oz = Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z);
  return ox > 0 && oy > 0 && oz > 0 ? ox * oy * oz : 0;
}
