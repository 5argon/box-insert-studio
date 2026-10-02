import { notchCorners } from './geom';
import { lidNotchPoints } from './lidNotches';
import type { PieceGroup } from './pieces';
import type { Side } from './types';

export type CutEdge = 'top' | 'bottom' | 'left' | 'right';
export type DetailCut = 'notch' | 'lowered';

export interface CutMark {
  label: 'A' | 'B' | 'C' | 'D';
  /** Coordinates in the cut-list rectangle: rightward and down from its top-left corner. */
  x: number;
  y: number;
  /** Distances along the selected edge and inward from it. */
  along: number;
  inward: number;
}

export interface CutPattern {
  name: string;
  edge: CutEdge;
  reference: 'left' | 'top';
  width: number;
  bottom: number;
  points: CutMark[];
  steps: string[];
}

const EDGES: Record<Side, CutEdge> = { back: 'top', front: 'bottom', left: 'left', right: 'right' };
// Marking positions can be quarter millimetres even when the opening is rounded to 0.5 mm.
const distance = (v: number) => String(Math.round(v * 1000) / 1000);

function pattern(group: PieceGroup, name: string, side: Side, center: number, width: number, depth: number, bottom: number): CutPattern {
  const edge = EDGES[side];
  const reference = side === 'back' || side === 'front' ? 'left' : 'top';
  const local = notchCorners(center, width, depth, bottom);
  const positions = lidNotchPoints(group.length, group.height, { side, center, width, depth, bottom });
  const labels = ['A', 'B', 'C', 'D'] as const;
  const points = local.map(([along, inward], i): CutMark => ({ label: labels[i]!, x: positions[i]![0], y: positions[i]![1], along, inward }));
  const [a, b, c, d] = points;
  const at = (p: CutMark) => `${distance(p.along)} mm from the ${reference} edge and ${distance(p.inward)} mm from the ${edge} edge`;
  const tip = bottom === 0;
  return {
    name, edge, reference, width, bottom, points,
    steps: [
      `On the ${edge} edge, mark A ${distance(a.along)} mm and D ${distance(d.along)} mm from the ${reference} edge.`,
      tip
        ? `Inside the piece, B and C share one mark: ${at(b)}.`
        : `Inside the piece, mark B ${at(b)}; mark C ${at(c)}.`,
      `Draw straight lines ${tip ? 'A → B and C → D (B and C meet)' : 'A → B, B → C and C → D'}. Cut along these lines through the sheet and remove the waste between them and the ${edge} edge.`,
    ],
  };
}

/** One marking pattern per actual cut, shared by all identical pieces in a cut-list group. */
export function groupCutPatterns(group: PieceGroup, kind: DetailCut = 'notch'): CutPattern[] {
  if (kind === 'lowered') {
    return group.lows.map((low, i) => pattern(group, `Lowered stretch ${i + 1}`, 'back', (low.from + low.to) / 2, low.to - low.from, low.depth, low.to - low.from));
  }
  return [
    ...group.notches.map((n, i) => pattern(group, `Notch ${i + 1}`, 'back', n.center, n.width, n.depth, n.bottom)),
    ...(group.lidNotches ?? []).map((n, i) => pattern(group, `Notch ${i + 1}`, n.side, n.center, n.width, n.depth, n.bottom)),
  ];
}
