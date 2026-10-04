import { describe, expect, it } from 'vitest';
import { setStacked } from './edit';
import { doomExample } from './fixtures';
import { solveProject } from './layout';
import { buildCutList, planCuts } from './pieces';
import { designProblems } from './problems';

describe('design problems', () => {
  it('include compartment errors, which drop pieces from the cut list without them', () => {
    const p = doomExample();
    const g = solveProject(p).compartments.find((c) => c.label === 'G')!;
    setStacked(g.node, true);
    p.layers[0].height = 20;
    const s = solveProject(p);
    // The boxes in G cannot be built, so none of their pieces reach the cut list...
    expect(s.trays.filter((t) => t.wellId === g.id)).toEqual([]);
    const problems = designProblems(s, planCuts(p, buildCutList(s, p.precision)));
    // ...and the problem list says so, naming the compartment.
    expect(problems).toContainEqual(expect.objectContaining({ level: 'error', where: 'Compartment G', message: expect.stringMatching(/^Too shallow for two stacked boxes/) }));
  });

  it('are empty for a design that builds as shown', () => {
    const p = doomExample();
    const s = solveProject(p);
    expect(designProblems(s, planCuts(p, buildCutList(s, p.precision))).filter((i) => i.level === 'error')).toEqual([]);
  });
});
