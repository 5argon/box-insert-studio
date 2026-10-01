/**
 * Test fixtures: a full reference design and an empty one built from it. Not part of the app.
 */
import { newId, newLayer, newSection, SHEET_PRESETS } from './defaults';
import type { Dir, LayoutNode, Project, SectionNode, SplitChild, SplitNode } from './types';

const fixed = (mm: number, node: LayoutNode): SplitChild => ({ size: { mode: 'fixed', mm }, node });
const flex = (node: LayoutNode, weight = 1): SplitChild => ({ size: { mode: 'flex', weight }, node });
const split = (dir: Dir, children: SplitChild[], join: SplitNode['join'] = 'divider'): SplitNode => ({
  kind: 'split',
  id: newId('p'),
  dir,
  join,
  lower: 0,
  children,
});
const pair = () => split('row', [flex(newSection()), flex(newSection())]);
/** A compartment holding one removable box with a divider, notched in front to lift it out. */
const boxed = (): SectionNode => ({ ...newSection(['front']), insert: { root: pair() } });

/** Modelled on a published 5 mm foam insert for DOOM (2016): a 56 mm bottom tray and a 33 mm top tray. */
export function doomExample(): Project {
  const bottom = split('column', [
    fixed(
      168,
      split('row', [
        fixed(59, newSection(['back', 'front'])),
        fixed(65, newSection(['back', 'front'])),
        fixed(35, newSection()),
        flex(split('column', [fixed(70, newSection()), flex(newSection())])),
      ]),
    ),
    flex(split('row', [flex(newSection()), fixed(141, boxed())])),
  ]);
  const top = split('row', [
    fixed(
      103,
      split('column', [
        fixed(45, pair()),
        fixed(28, newSection()),
        fixed(28, newSection()),
        fixed(28, pair()),
        fixed(28, pair()),
        fixed(28, pair()),
        flex(newSection()),
      ]),
    ),
    flex(split('column', [flex(newSection(['left'])), fixed(30, newSection())])),
  ]);
  return {
    version: 2,
    name: 'DOOM-style insert',
    readme: `Insert for **DOOM: The Board Game** (2016), after a published 5 mm foam board design.

## Where things go

| Tray | Holds |
| --- | --- |
| Bottom | Cards in **A** and **B** (finger notches front and back), tokens in the rest, dice in the lift-out box in **G** |
| Top | Map tiles in **J**, small tokens in the left column |

## Building tips

- The top tray sits on the bottom tray's walls; the board and rulebook go on top.
- Glue with thick PVA and pin the walls while it dries.
`,
    box: { width: 286, depth: 286, height: 96 },
    material: { thickness: 5, sheet: { ...SHEET_PRESETS.find((s) => s.preset === 'A2')! }, trim: 5, kerf: 0.5 },
    precision: 0.5,
    clearance: 1,
    base: 'under',
    fullWalls: 'x',
    notch: { width: 30, depth: 15 },
    layers: [newLayer('Bottom tray', 56, bottom), newLayer('Top tray', 33, top)],
  };
}

/**
 * An empty box: one tray layer with a single compartment. Box size and material, construction
 * and notch settings carry over from `from` when given, since a new design is usually for the
 * same kind of board and often the same box.
 */
export function blankProject(from?: Project): Project {
  const base = from ? structuredClone(from) : doomExample();
  const height = Math.max(10, base.box.height - 10);
  return { ...base, name: 'Untitled insert', readme: '', layers: [newLayer('Layer 1', height)] };
}

