/** Drawing helpers for the dimension lines on the report's diagrams. */

export type Point = [number, number];

export const linePath = (a: Point, b: Point) => `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`;

/** A dimension line: arrowheads of size `head` at both ends, smaller on a short line so they stay apart. */
export function dimensionArrow(a: Point, b: Point, head = 5): string {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const [dx, dy] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const h = Math.min(head, length / 3);
  const tip = ([x, y]: Point, s: number) => `M${x + s * h * (dx - dy * 0.44)} ${y + s * h * (dy + dx * 0.44)} L${x} ${y} L${x + s * h * (dx + dy * 0.44)} ${y + s * h * (dy - dx * 0.44)}`;
  return `${linePath(a, b)} ${tip(a, 1)} ${tip(b, -1)}`;
}
