/**
 * Every problem in a design, in one list: the solver's, each compartment's and the cutting plan's.
 * Anything left out here is missing from the printout people buy material from, so the app's
 * error count and the report both read it from here.
 */
import type { Issue, Solved } from './layout';
import type { CutPlan } from './pieces';

export interface Problem extends Issue {
  /** Where it is, e.g. "Compartment G", when the issue belongs to one compartment. */
  where?: string;
}

export function designProblems(solved: Solved, plan: CutPlan): Problem[] {
  return [
    ...solved.issues,
    ...solved.layers.flatMap((l) => l.issues),
    ...solved.compartments.flatMap((c) => c.issues.map((i): Problem => ({ ...i, where: `Compartment ${c.label}` }))),
    ...plan.issues,
  ];
}
