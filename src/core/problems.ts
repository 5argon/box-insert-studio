/**
 * Every problem in a design, in one list: the solver's, each compartment's and the cutting plan's.
 * Anything left out here is missing from the printout people buy material from, so the app's
 * error count and the report both read it from here.
 */
import { mm } from './geom';
import type { Issue, Solved } from './layout';
import type { CutPlan } from './pieces';
import type { Project } from './types';

export interface Problem extends Issue {
  /** Where it is, e.g. "Compartment G", when the issue belongs to one compartment. */
  where?: string;
}

/** A thickness the rounding step cannot express makes sizes derived from it round inconsistently. */
const offStep = (v: number, step: number) => step > 0 && Math.abs(v / step - Math.round(v / step)) > 1e-6;

/** Settings that make rounded cut sizes untrustworthy, however the design itself is laid out. */
function settingProblems(project: Project): Problem[] {
  const out: Problem[] = [];
  const step = project.precision;
  if (step > 0.5) {
    out.push({ level: 'warn', message: `Sizes are rounded to the nearest ${mm(step)} mm, so a piece can be cut up to ${mm(step / 2)} mm bigger than the space it fills. Use 0.5 mm or finer under Material, Round sizes to.` });
  }
  const boards: [string, number | undefined][] = [['Primary', project.material.thickness], ['Secondary', project.material.secondaryThickness]];
  for (const [name, t] of boards) {
    if (t === undefined || !offStep(t, step)) continue;
    out.push({
      level: 'warn',
      message: `${name} material is ${mm(t)} mm, not a multiple of the ${mm(step)} mm rounding step, so the rounded sizes of pieces that meet can disagree by up to ${mm(step)} mm. Set Round sizes to 0.1 mm.`,
    });
  }
  return out;
}

export function designProblems(project: Project, solved: Solved, plan: CutPlan): Problem[] {
  return [
    ...settingProblems(project),
    ...solved.issues,
    ...solved.layers.flatMap((l) => l.issues),
    ...solved.compartments.flatMap((c) => c.issues.map((i): Problem => ({ ...i, where: `Compartment ${c.label}` }))),
    ...plan.issues,
  ];
}
