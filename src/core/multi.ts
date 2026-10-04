/**
 * Editing several compartments or dividers at once: whether a field holds one shared value or
 * differs between them (shown as "—"), and edits that apply one value to every one that can take
 * it. Each edit skips what it cannot apply to, e.g. a notch where a side is lowered.
 */
import { DEFAULT_ITEMS } from './items';
import { findSplit, insertHost, setCompartmentSize, setDividerSecondary, setEmptyAbove, setInsertLid, setPad, setStacked } from './edit';
import { hasLow, hasNotch, toggleLow, toggleNotch } from './notches';
import { baseThickness, insertHeights, padLimit, type Compartment, type Solved, type SolvedLayer } from './layout';
import type { Dir, ItemSpec, Layer, Mm, Project, Side } from './types';

/** A field whose selected things disagree. */
export const MIXED = Symbol('mixed');
export type Shared<T> = T | typeof MIXED;

/** The one value all share, MIXED when they differ, undefined when there is nothing to compare. */
export function shared<T>(values: T[], same: (a: T, b: T) => boolean = (a, b) => a === b): Shared<T> | undefined {
  if (!values.length) return undefined;
  return values.every((v) => same(v, values[0]!)) ? values[0]! : MIXED;
}

/** On for all, off for all, or MIXED. */
export const allOn = (flags: boolean[]): Shared<boolean> | undefined => shared(flags);

// ---- Compartments ----

/** Point every compartment's items the same way, or clear the direction with `undefined`. */
export function setArrows(comps: Compartment[], side: Side | undefined) {
  for (const c of comps) {
    if (side) c.node.arrow = side;
    else delete c.node.arrow;
  }
}

/** Compartments that can simulate items: they have a direction and hold no box. */
export const simulatable = (comps: Compartment[]) => comps.filter((c) => c.node.arrow && !c.node.insert);

/** Turn item simulation on or off; turning on keeps each compartment's own item settings. */
export function setSimulation(comps: Compartment[], on: boolean) {
  for (const c of simulatable(comps)) {
    if (c.node.items) c.node.items.on = on;
    else if (on) c.node.items = { ...DEFAULT_ITEMS };
  }
}

/** Give every simulating compartment the same item shape or size. */
export function setItemFields(comps: Compartment[], patch: Partial<Omit<ItemSpec, 'on'>>) {
  for (const c of simulatable(comps)) if (c.node.items?.on) Object.assign(c.node.items, patch);
}

/** Notch one side of every compartment, or none; a side that is lowered there cannot be notched. */
export function setNotchSides(solved: Solved, comps: Compartment[], side: Side, on: boolean) {
  for (const c of comps) {
    if (hasNotch(solved, c, side) === on || (on && hasLow(solved, c, side))) continue;
    toggleNotch(solved, c, side);
  }
}

/** Lower one side of every compartment, or none; a notched side cannot be lowered. */
export function setLowSides(solved: Solved, comps: Compartment[], side: Side, on: boolean) {
  for (const c of comps) {
    if (hasLow(solved, c, side) === on || (on && hasNotch(solved, c, side))) continue;
    toggleLow(solved, c, side);
  }
}

/** The same number of raised-floor layers everywhere, capped where a compartment takes fewer. */
export function setPads(project: Project, comps: Compartment[], layers: number) {
  for (const c of comps) setPad(c.node, Math.min(Math.max(0, Math.floor(layers)), padLimit(project, c)));
}

/** Compartments holding a removable box. */
export const wells = (comps: Compartment[]) => comps.filter((c) => c.node.insert && c.depth === 0);

export function setStackedAll(comps: Compartment[], on: boolean) {
  for (const c of wells(comps)) setStacked(c.node, on);
}

export function setEmptyAboveAll(comps: Compartment[], on: boolean) {
  for (const c of wells(comps)) if (c.node.insert?.stacked) setEmptyAbove(c.node, on);
}

export function setLidAll(comps: Compartment[], on: boolean) {
  for (const c of wells(comps)) setInsertLid(c.node, on);
}

/** The same inside width (`row`) or depth (`column`) for every compartment that can be sized. */
export function setSizes(project: Project, layer: Layer, comps: Compartment[], dir: Dir, value: Mm) {
  for (const c of comps) setCompartmentSize(project, layer, c.id, dir, value);
}

// ---- Dividers ----

/** One divider: the split it belongs to and its place among the split's dividers. */
export interface DividerPick {
  splitId: string;
  index: number;
}

/** Cut each picked divider from the secondary material, or the primary. */
export function setDividersSecondary(layer: Layer, picks: DividerPick[], secondary: boolean) {
  for (const p of picks) {
    const split = findSplit(layer.root, p.splitId);
    if (split) setDividerSecondary(split, p.index, secondary);
  }
}

/** How far a split's dividers can be lowered: at least 5 mm stays, inside a box of its own inside height. */
export function maxDividerLower(project: Project, layer: Layer, solvedLayer: SolvedLayer, splitId: string): Mm {
  const host = insertHost(layer.root, splitId);
  const well = host ? solvedLayer.compartments.find((c) => c.id === host.id) : undefined;
  const depth = host && well ? insertHeights(project, host, well.fullHeight, well.padHeight).inside : layer.height - baseThickness(project);
  return Math.max(0, depth - 5);
}

/** Lower every picked divider's split by the same amount, capped where a split allows less. */
export function setDividersLower(project: Project, layer: Layer, solvedLayer: SolvedLayer, picks: DividerPick[], lower: Mm) {
  for (const id of new Set(picks.map((p) => p.splitId))) {
    const split = findSplit(layer.root, id);
    if (split) split.lower = Math.min(Math.max(0, lower), maxDividerLower(project, layer, solvedLayer, id));
  }
}
