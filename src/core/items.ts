/**
 * How many items fit standing in a row along a compartment's arrow. Items fill from the arrow's
 * tail toward its head, leaving the requested free space at the head.
 */
import type { Compartment } from './layout';
import type { ItemSpec, Mm, Side } from './types';

/** A sleeved standard card to start from. */
export const DEFAULT_ITEMS: ItemSpec = { on: true, shape: 'box', width: 66, height: 91, thickness: 0.6, spare: 10 };

export interface ItemFit {
  /** Slot length along the arrow, and its width across it. */
  along: Mm;
  across: Mm;
  /** Usable height of the slot. */
  up: Mm;
  /** The item's face: across the arrow and standing up. */
  faceW: Mm;
  faceH: Mm;
  count: number;
  /** Length the row of items takes, and what is left at the head. */
  used: Mm;
  left: Mm;
  warnings: string[];
}

export function fitItems(c: Pick<Compartment, 'rect' | 'height'>, arrow: Side, spec: ItemSpec): ItemFit {
  const alongY = arrow === 'back' || arrow === 'front';
  const along = alongY ? c.rect.h : c.rect.w;
  const across = alongY ? c.rect.w : c.rect.h;
  const up = c.height;
  const faceW = spec.width;
  const faceH = spec.shape === 'cylinder' ? spec.width : spec.height;
  const room = along - Math.max(0, spec.spare);
  const count = spec.thickness > 0 && room > 0 ? Math.floor(room / spec.thickness + 1e-9) : 0;
  const used = count * spec.thickness;
  const warnings: string[] = [];
  const name = spec.shape === 'cylinder' ? 'The discs' : 'The items';
  if (faceW > across + 1e-9) warnings.push(`${name} are ${round(faceW - across)} mm wider than the slot (${round(across)} mm).`);
  if (faceH > up + 1e-9) warnings.push(`${name} stand ${round(faceH - up)} mm above the walls (the slot is ${round(up)} mm deep).`);
  if (count === 0) warnings.push(spec.spare >= along ? 'The free space is longer than the slot.' : 'Not even one item fits.');
  return { along, across, up, faceW, faceH, count, used, left: along - used, warnings };
}

const round = (v: number) => Math.round(v * 10) / 10;
