import { describe, expect, it } from 'vitest';
import { select, studio } from './state.svelte';

describe('selection', () => {
  it('replaces on a click, adds and removes on Cmd/Ctrl-click, and starts anew for another kind', () => {
    select({ kind: 'section', id: 'a' });
    expect(studio.selection).toEqual([{ kind: 'section', id: 'a' }]);
    select({ kind: 'section', id: 'b' }, true);
    select({ kind: 'section', id: 'c' }, true);
    expect(studio.selection.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    // Cmd/Ctrl-click a selected one again takes it out.
    select({ kind: 'section', id: 'b' }, true);
    expect(studio.selection.map((p) => p.id)).toEqual(['a', 'c']);
    // A divider among compartments starts a new selection.
    select({ kind: 'split', id: 's', index: 1 }, true);
    expect(studio.selection).toEqual([{ kind: 'split', id: 's', index: 1 }]);
    // Two dividers of one split are different picks.
    select({ kind: 'split', id: 's', index: 0 }, true);
    expect(studio.selection).toHaveLength(2);
    // Cmd/Ctrl-click on empty space keeps the selection; a plain click clears it.
    select(null, true);
    expect(studio.selection).toHaveLength(2);
    select(null);
    expect(studio.selection).toEqual([]);
  });
});
