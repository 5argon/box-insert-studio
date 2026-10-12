import { notchCorners } from './geom';
import { lidNotchPoints } from './lidNotches';
import type { PieceShape } from './pieces';
import type { Side } from './types';

export type CutEdge = 'top' | 'bottom' | 'left' | 'right';
export type DetailCut = 'notch' | 'lowered';

export interface CutMark {
  label: 'A' | 'B' | 'C' | 'D';
  /** Coordinates in the cut-list rectangle: rightward and down from its top-left corner. */
  x: number;
  y: number;
  /** The end of the selected edge this mark is nearer to, and how far along the edge it is from there. */
  from: CutEdge;
  along: number;
  /** How far in from the selected edge. */
  inward: number;
}

export interface CutPattern {
  name: string;
  edge: CutEdge;
  width: number;
  bottom: number;
  points: CutMark[];
  /** Always three: mark A and D on the edge, mark B and C inside the piece, then cut. */
  steps: string[];
}

const EDGES: Record<Side, CutEdge> = { back: 'top', front: 'bottom', left: 'left', right: 'right' };
// Marking positions can be quarter millimetres even when the opening is rounded to 0.5 mm.
export const distance = (v: number) => String(Math.round(v * 1000) / 1000);

function pattern(group: Pick<PieceShape, 'length' | 'height'>, name: string, side: Side, center: number, width: number, depth: number, bottom: number): CutPattern {
  const edge = EDGES[side];
  const across = side === 'back' || side === 'front';
  // Each mark is measured from the end of the edge it is nearer to: shorter distances to lay a ruler along.
  const length = across ? group.length : group.height;
  const [near, far]: [CutEdge, CutEdge] = across ? ['left', 'right'] : ['top', 'bottom'];
  const positions = lidNotchPoints(group.length, group.height, { side, center, width, depth, bottom });
  const labels = ['A', 'B', 'C', 'D'] as const;
  const points = notchCorners(center, width, depth, bottom).map(([along, inward], i): CutMark => {
    const past = along > length / 2;
    return { label: labels[i]!, x: positions[i]![0], y: positions[i]![1], from: past ? far : near, along: past ? length - along : along, inward };
  });
  const [a, b, c, d] = points;
  const along = (p: CutMark) => `${distance(p.along)} mm`;
  const from = (p: CutMark) => `from the ${p.from} edge`;
  const at = (p: CutMark) => `${along(p)} ${from(p)} and ${distance(p.inward)} mm from the ${edge} edge`;
  const tip = bottom === 0;
  return {
    name, edge, width, bottom, points,
    steps: [
      a.from === d.from ? `On the ${edge} edge, mark A ${along(a)} and D ${along(d)} ${from(a)}.` : `On the ${edge} edge, mark A ${along(a)} ${from(a)} and D ${along(d)} ${from(d)}.`,
      tip
        ? `Inside the piece, B and C share one mark: ${at(b)}.`
        : `Inside the piece, mark B ${at(b)}; mark C ${at(c)}.`,
      `Draw straight lines ${tip ? 'A → B and C → D (B and C meet)' : 'A → B, B → C and C → D'}. Cut along these lines through the sheet and remove the waste between them and the ${edge} edge.`,
    ],
  };
}

/** One marking pattern per actual cut, shared by all the pieces of one size cut to the same shape. */
export function shapeCutPatterns(group: PieceShape, kind: DetailCut = 'notch'): CutPattern[] {
  if (kind === 'lowered') {
    return group.lows.map((low, i) => pattern(group, `Lowered stretch ${i + 1}`, 'back', (low.from + low.to) / 2, low.to - low.from, low.depth, low.to - low.from));
  }
  return [
    ...group.notches.map((n, i) => pattern(group, `Notch ${i + 1}`, 'back', n.center, n.width, n.depth, n.bottom)),
    ...(group.lidNotches ?? []).map((n, i) => pattern(group, `Notch ${i + 1}`, n.side, n.center, n.width, n.depth, n.bottom)),
  ];
}
