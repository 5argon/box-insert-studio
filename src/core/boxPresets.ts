/**
 * Interior size presets for the New dialog. Publisher exterior sizes are unsuitable for inserts.
 * Where only an insert-fit reference is available, label it explicitly rather than presenting
 * organizer dimensions as a measured box interior. Each entry links to its source.
 */
import type { Mm } from './types';

export interface BoxPreset {
  name: string;
  /** Left to right across the cover with its text upright. */
  width: Mm;
  /** Top to bottom along the upright cover. */
  depth: Mm;
  /** Box thickness, from the inside floor to the rim. */
  height: Mm;
  /** Where the inside dimensions come from. */
  source: string;
  /** Omitted for reported box interiors; insert-fit references are not box measurements. */
  dimensionBasis?: 'insert-fit';
  /** Source-specific limits or edition details shown in the dialog. */
  note?: string;
}

/**
 * Reported inside dimensions from insert makers or owners, plus explicitly marked fit references.
 * Editions and print runs can differ, so the dialog suggests measuring.
 * Research details: docs/box-dimension-sources.md.
 */
export const BOX_PRESETS: BoxPreset[] = [
  { name: '7 Wonders (2nd edition, insert-fit reference)', width: 287, depth: 287, height: 72, source: 'https://www.am-media.biz/prodotto/7-wonders-all-in-organizer/', dimensionBasis: 'insert-fit', note: 'Completed organizer size, not a measured box interior. Measure your box before designing; allow space above the trays for boards and rulebooks.' },
  { name: 'Ark Nova', width: 289, depth: 353, height: 67, source: 'https://www.etsy.com/listing/4468510515' },
  { name: 'Arkham Horror: The Card Game, Chapter 2 Core Set (2026)', width: 239, depth: 277, height: 74, source: 'Provided by the app author' },
  { name: 'Arkham Horror: The Card Game, Revised Core Set (2021)', width: 244, depth: 284, height: 75, source: 'https://boardgamegeek.com/thread/2782774/article/39124932' },
  { name: 'Carcassonne (base game, insert-fit reference)', width: 184, depth: 267, height: 65, source: 'https://www.kalkared.eu/en/insert-pro-carcassonne/', dimensionBasis: 'insert-fit', note: 'Maker\'s required interior size for its insert, not a measured box interior. The source covers the standard base-game and 20th Anniversary boxes, not the Big Box.' },
  { name: 'Cascadia', width: 230, depth: 230, height: 68, source: 'https://cults3d.com/en/3d-model/game/cascadia-and-landmarks-expansion-insert' },
  { name: 'Gloomhaven (1st edition, 2017)', width: 398, depth: 283, height: 186, source: 'https://boardgamegeek.com/thread/1817437/dimension-of-tuck-boxes-and-inner-box-dimension' },
  { name: 'Lost Ruins of Arnak', width: 359, depth: 249, height: 70, source: 'https://cults3d.com/en/3d-model/game/lost-ruins-of-arnak-insert-incorporating-the-leaders-missing-expedition-exp' },
  { name: 'Marvel Champions (Core Set, insert-fit reference)', width: 239, depth: 280, height: 71, source: 'https://thebrokentoken.com/products/champions-organizer', dimensionBasis: 'insert-fit', note: 'Assembled organizer size, oriented to match the portrait cover, not a measured box interior. This reference is for the original Core Set box, not a campaign expansion box; measure your box before designing.' },
  { name: 'Pandemic (Z-Man Games)', width: 212, depth: 293, height: 41.5, source: 'https://cults3d.com/en/3d-model/game/pandemic-on-the-brink-insert-for-the-z-man-games-edition' },
  { name: 'Patchwork (Lookout Spiele)', width: 194, depth: 194, height: 45, source: 'https://www.redesigninsert.com/en/products/redesign-insert-patchwork' },
  { name: 'Root (Leder Games, US)', width: 279, depth: 215, height: 68, source: 'https://www.printables.com/model/767646' },
  { name: 'Splendor (2nd edition, 2024)', width: 206, depth: 266, height: 63, source: 'https://www.etsy.com/listing/4456206638/insert-organizer-for-splendor-2nd' },
  { name: 'Spirit Island', width: 282, depth: 282, height: 74, source: 'https://www.printables.com/model/1296941' },
  { name: 'Ticket to Ride: Europe', width: 286, depth: 287, height: 67, source: 'https://www.mitroczech.cz/en/insert-jizdenky-prosim-evropa/' },
  { name: 'Wingspan', width: 286, depth: 286, height: 72, source: 'https://boardgamegeek.com/thread/2491522/article/35670811' },
  { name: 'XCOM', width: 286, depth: 286, height: 68, source: 'https://www.etsy.com/listing/4416860765' },
];
