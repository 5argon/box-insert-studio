/**
 * Inside dimensions of popular board game boxes, for the New dialog. Inside, not the outside a
 * publisher lists: an insert has to fit the space a ruler measures inside the box bottom. Each
 * entry names where the figure came from.
 */
import type { Mm } from './types';

export interface BoxPreset {
  name: string;
  width: Mm;
  depth: Mm;
  height: Mm;
  /** Where the inside dimensions come from. */
  source: string;
}

export const BOX_PRESETS: BoxPreset[] = [
  { name: 'Arkham Horror: The Card Game, Core Set (2026)', width: 239, depth: 277, height: 74, source: 'Provided by the app author' },
];
