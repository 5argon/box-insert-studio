import { newSection } from './defaults';
import { roundTo } from './geom';
import { baseThickness } from './layout';
import type { CutLayout, Dir, Join, Layer, LayoutNode, MaterialKind, Mm, Project, SectionNode, SheetSpec, Side, SplitNode } from './types';

export const MIN_REGION = 5;

/** Direct children, including the root of a compartment's removable insert. */
function childNodes(node: LayoutNode): LayoutNode[] {
  if (node.kind === 'split') return node.children.map((c) => c.node);
  return node.insert ? [node.insert.root] : [];
}

export function findNode(root: LayoutNode, id: string): LayoutNode | undefined {
  if (root.id === id) return root;
  for (const c of childNodes(root)) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return undefined;
}

/** The split directly containing the node (none for a layer root or an insert root). */
export function findParent(root: LayoutNode, id: string): { split: SplitNode; index: number } | undefined {
  if (root.kind === 'split') {
    const index = root.children.findIndex((c) => c.node.id === id);
    if (index >= 0) return { split: root, index };
  }
  for (const c of childNodes(root)) {
    const f = findParent(c, id);
    if (f) return f;
  }
  return undefined;
}

export function findSection(root: LayoutNode, id: string): SectionNode | undefined {
  const n = findNode(root, id);
  return n?.kind === 'section' ? n : undefined;
}

export function findSplit(root: LayoutNode, id: string): SplitNode | undefined {
  const n = findNode(root, id);
  return n?.kind === 'split' ? n : undefined;
}

/** The compartment whose removable insert contains the node, if any. */
export function insertHost(root: LayoutNode, id: string): SectionNode | undefined {
  const walk = (node: LayoutNode, host: SectionNode | undefined): SectionNode | undefined | null => {
    if (node.id === id) return host ?? null;
    if (node.kind === 'split') {
      for (const c of node.children) {
        const r = walk(c.node, host);
        if (r !== undefined) return r;
      }
    } else if (node.insert) {
      const r = walk(node.insert.root, node);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  return walk(root, undefined) ?? undefined;
}

type Step = { split: SplitNode; index: number };

/**
 * Splits from the node's layout root down to (not including) the node, with the child index taken
 * at each. Inside an insert the path starts at the insert's root: the well around it is fixed.
 */
export function findPath(root: LayoutNode, id: string): Step[] | undefined {
  const walk = (node: LayoutNode): { path: Step[]; reset: boolean } | undefined => {
    if (node.id === id) return { path: [], reset: false };
    if (node.kind === 'split') {
      for (let i = 0; i < node.children.length; i++) {
        const r = walk(node.children[i].node);
        if (r) return r.reset ? r : { path: [{ split: node, index: i }, ...r.path], reset: false };
      }
    } else if (node.insert) {
      const r = walk(node.insert.root);
      if (r) return { path: r.path, reset: true };
    }
    return undefined;
  };
  return walk(root)?.path;
}

/** The nearest split of direction `dir` whose child size sets this node's width (`row`) or depth (`column`). */
export function axisOwner(root: LayoutNode, id: string, dir: Dir): Step | undefined {
  const path = findPath(root, id);
  if (!path) return undefined;
  for (let i = path.length - 1; i >= 0; i--) if (path[i].split.dir === dir) return path[i];
  return undefined;
}

/** Compartment ids under a node; `deep` also includes compartments inside inserts. */
export function sectionIds(node: LayoutNode, deep = false): string[] {
  if (node.kind === 'split') return node.children.flatMap((c) => sectionIds(c.node, deep));
  return deep && node.insert ? [node.id, ...sectionIds(node.insert.root, true)] : [node.id];
}

function replaceNode(layer: Layer, id: string, next: LayoutNode) {
  if (layer.root.id === id) {
    layer.root = next;
    return;
  }
  const parent = findParent(layer.root, id);
  if (parent) {
    parent.split.children[parent.index].node = next;
    return;
  }
  const host = insertHost(layer.root, id);
  if (host?.insert && host.insert.root.id === id) host.insert.root = next;
}

/** Give a compartment a removable box inside, or take it away. Not allowed inside another insert. */
export function setInsert(layer: Layer, sectionId: string, on: boolean): boolean {
  const section = findSection(layer.root, sectionId);
  if (!section) return false;
  if (!on) {
    delete section.insert;
    return true;
  }
  if (insertHost(layer.root, sectionId)) return false;
  section.insert ??= { root: newSection() };
  return true;
}

/** Set the number of raised-floor layers in a compartment; 0 removes the raised floor. */
export function setPad(section: SectionNode, layers: number) {
  const n = Math.max(0, Math.floor(layers));
  if (n) section.pad = n;
  else delete section.pad;
}

/** Choose which of this compartment's notched sides use its own size and shape. */
export function setNotchOverrideSide(section: SectionNode, side: Side, override: boolean) {
  const size = section.notchSize;
  if (!size || !section.notches.includes(side)) return;
  // Saved overrides without a selection applied to every notch. Keep the other notched sides
  // selected when the user changes one of them for the first time.
  const sides = size.sides ?? section.notches;
  size.sides = override ? [...new Set([...sides, side])] : sides.filter((s) => s !== side);
}

/** Choose the material of one divider, rather than all the dividers in its split. */
export function setDividerSecondary(split: SplitNode, index: number, secondary: boolean) {
  if (split.join !== 'divider' || !Number.isInteger(index) || index < 0 || index >= split.children.length - 1) return;
  if (secondary) split.children[index]!.secondaryDivider = true;
  else delete split.children[index]!.secondaryDivider;
}

/** Stack two identical half-height boxes in the compartment, or go back to one full-height box. */
export function setStacked(section: SectionNode, stacked: boolean) {
  if (!section.insert) return;
  if (stacked) section.insert.stacked = true;
  else {
    delete section.insert.stacked;
    delete section.insert.emptyAbove;
  }
}

/** Of a stacked pair, leave out the top box so the space above the lower one stays empty. */
export function setEmptyAbove(section: SectionNode, empty: boolean) {
  if (!section.insert?.stacked) return;
  if (empty) section.insert.emptyAbove = true;
  else delete section.insert.emptyAbove;
}

/** `multiple` when the insert's top split makes separate boxes, `single` for one box. */
export function insertMode(section: SectionNode): 'single' | 'multiple' {
  const root = section.insert?.root;
  return root?.kind === 'split' && root.join === 'trays' ? 'multiple' : 'single';
}

/**
 * Add a divider through a compartment: `row` adds a vertical one (new compartment to the right),
 * `column` a horizontal one (new compartment in front). If the compartment already sits in a
 * divider split of the same direction, the new compartment joins it instead of nesting.
 * `gap` is the space the new divider takes, so locked sizes keep their total.
 */
export function splitSection(layer: Layer, sectionId: string, dir: Dir, gap: Mm, join: Join = 'divider'): string | undefined {
  const section = findSection(layer.root, sectionId);
  if (!section) return undefined;
  // Separate trays only where every split around the compartment is separate trays too.
  if (join === 'trays' && !findPath(layer.root, sectionId)?.every((p) => p.split.join === 'trays')) join = 'divider';
  const parent = findParent(layer.root, sectionId);
  if (parent && parent.split.dir === dir && parent.split.join === join) return addSibling(layer, sectionId, gap);
  const fresh = newSection();
  const split: SplitNode = {
    kind: 'split',
    id: `p-${fresh.id}`,
    dir,
    join,
    lower: 0,
    children: [
      { size: { mode: 'flex', weight: 1 }, node: section },
      { size: { mode: 'flex', weight: 1 }, node: fresh },
    ],
  };
  replaceNode(layer, sectionId, split);
  return fresh.id;
}

/**
 * Add a new compartment right after this one in its split, halving its space. In a split of
 * separate trays (or boxes) this adds another tray. `gap` is the space the new boundary takes.
 */
export function addSibling(layer: Layer, sectionId: string, gap: Mm): string | undefined {
  const parent = findParent(layer.root, sectionId);
  if (!parent) return undefined;
  const fresh = newSection();
  const child = parent.split.children[parent.index];
  // The old divider stays at the far side of the inserted compartment; the new one is primary.
  const secondaryDivider = child.secondaryDivider;
  delete child.secondaryDivider;
  const size = child.size.mode === 'flex' ? { mode: 'flex' as const, weight: child.size.weight / 2 } : { mode: 'fixed' as const, mm: Math.max(MIN_REGION, (child.size.mm - gap) / 2) };
  child.size = { ...size };
  parent.split.children.splice(parent.index + 1, 0, { size: { ...size }, node: fresh, ...(secondaryDivider ? { secondaryDivider: true } : {}) });
  return fresh.id;
}

/** Remove a compartment; its space goes to its siblings. Returns a neighbour to select. */
export function removeSection(layer: Layer, sectionId: string): string | undefined {
  const parent = findParent(layer.root, sectionId);
  if (!parent) {
    // The only compartment of an insert: removing it removes the box.
    const host = insertHost(layer.root, sectionId);
    if (host?.insert?.root.id === sectionId) {
      delete host.insert;
      return host.id;
    }
    return undefined;
  }
  const { split, index } = parent;
  // Removing a middle compartment removes the divider before it and keeps the one after it.
  if (index > 0) {
    const previous = split.children[index - 1]!;
    if (index < split.children.length - 1 && split.children[index]!.secondaryDivider) previous.secondaryDivider = true;
    else delete previous.secondaryDivider;
  }
  split.children.splice(index, 1);
  if (!split.children.some((c) => c.size.mode === 'flex')) split.children[split.children.length - 1].size = { mode: 'flex', weight: 1 };
  const neighbour = split.children[Math.min(index, split.children.length - 1)].node;
  if (split.children.length === 1) replaceNode(layer, split.id, split.children[0].node);
  return firstSection(neighbour)?.id;
}

export function firstSection(node: LayoutNode): SectionNode | undefined {
  if (node.kind === 'section') return node;
  return firstSection(node.children[0].node);
}

/** Separate trays are allowed only where every enclosing split is also separate trays. */
export function canUseTrays(root: LayoutNode, splitId: string): boolean {
  const path = findPath(root, splitId);
  return !!path && path.every((p) => p.split.join === 'trays');
}

/**
 * Locked sizes mean compartment insides for dividers but tray outsides for trays. Converting
 * keeps what the compartment holds: a tray is its inside plus a wall on each side.
 */
function convertLocked(split: SplitNode, delta: Mm) {
  for (const c of split.children) {
    if (c.size.mode === 'fixed') c.size = { mode: 'fixed', mm: Math.max(MIN_REGION, c.size.mm + delta) };
  }
}

function dividersBelow(node: LayoutNode, thickness: Mm) {
  if (node.kind !== 'split') return;
  if (node.join === 'trays') {
    node.join = 'divider';
    convertLocked(node, -2 * thickness);
  }
  node.children.forEach((c) => dividersBelow(c.node, thickness));
}

/** Switch a split between glued dividers and separate trays. Returns false if not allowed. */
export function setJoin(layer: Layer, split: SplitNode, join: Join, thickness: Mm): boolean {
  if (join === split.join) return true;
  if (join === 'trays' && !canUseTrays(layer.root, split.id)) return false;
  split.join = join;
  convertLocked(split, join === 'trays' ? 2 * thickness : -2 * thickness);
  if (join === 'divider') split.children.forEach((c) => dividersBelow(c.node, thickness));
  return true;
}

/** Splits of a layout outside any removable box, each before the splits inside it. */
function topSplits(node: LayoutNode): SplitNode[] {
  if (node.kind !== 'split') return [];
  return [node, ...node.children.flatMap((c) => topSplits(c.node))];
}

/**
 * Switch the whole project between one glued tray per layer and every compartment its own tray.
 * Splits inside removable boxes keep their own choice. Locked sizes convert as in `setJoin`.
 */
export function setConstruction(project: Project, mode: 'glued' | 'separate') {
  if (mode === 'separate') project.construction = 'separate';
  else delete project.construction;
  const join: Join = mode === 'separate' ? 'trays' : 'divider';
  for (const layer of project.layers) for (const split of topSplits(layer.root)) setJoin(layer, split, join, project.material.thickness);
}

/** What a new split of this compartment makes: separate trays at the top level of a separate construction. */
export function splitJoin(project: Project, layer: Layer, sectionId: string): Join {
  if (project.construction !== 'separate' || insertHost(layer.root, sectionId)) return 'divider';
  return findPath(layer.root, sectionId)?.every((p) => p.split.join === 'trays') ? 'trays' : 'divider';
}

/** Keep compartment depths when the material used for layer bases changes. */
function adjustLayerBases(project: Project, before: Mm) {
  const delta = baseThickness(project) - before;
  if (delta) for (const layer of project.layers) layer.height = Math.max(5, Math.round((layer.height + delta) * 100) / 100);
}

/** Configure the secondary thickness; removable-box heights continue to fit their wells. */
export function setSecondaryThickness(project: Project, next: Mm | undefined) {
  const before = baseThickness(project);
  if (next === undefined) delete project.material.secondaryThickness;
  else {
    project.material.secondaryThickness = next;
    project.material.secondaryLayout ??= 'strips';
  }
  adjustLayerBases(project, before);
}

/** Choose the material for all layer bases, preserving their compartment depths. */
export function setLayerBaseSecondary(project: Project, secondary: boolean) {
  const before = baseThickness(project);
  if (secondary) project.secondaryBase = true;
  else delete project.secondaryBase;
  adjustLayerBases(project, before);
}

/** Choose the base material for a removable box, including both boxes of a stacked pair. */
export function setInsertBaseSecondary(section: SectionNode, secondary: boolean) {
  if (!section.insert) return;
  if (secondary) section.insert.secondaryBase = true;
  else delete section.insert.secondaryBase;
}

/** Give every removable box a loose lid without changing its allocated height. */
export function setInsertLid(section: SectionNode, on: boolean) {
  if (!section.insert) return;
  if (on) section.insert.lid = true;
  else delete section.insert.lid;
}

/** Choose the lid material for a removable box, covering only the upper box in a stacked pair. */
export function setInsertLidSecondary(section: SectionNode, secondary: boolean) {
  if (!section.insert) return;
  if (secondary) section.insert.secondaryLid = true;
  else delete section.insert.secondaryLid;
}

/** Choose one lid over the group; remember the choice if the box layout temporarily changes. */
export function setInsertSharedLid(section: SectionNode, shared: boolean) {
  if (!section.insert) return;
  if (shared) section.insert.sharedLid = true;
  else delete section.insert.sharedLid;
}

/** Toggle one lid edge without changing any wall notches or the lid's local shape. */
export function setLidNotchSide(section: SectionNode, side: Side, on: boolean) {
  if (!section.insert) return;
  const sides = section.insert.lidNotches ?? [];
  const next = on ? [...new Set([...sides, side])] : sides.filter((s) => s !== side);
  if (next.length) section.insert.lidNotches = next;
  else delete section.insert.lidNotches;
}

/** Give the secondary material its own sheet size, or `undefined` to use the primary's. */
export function setSecondarySheet(project: Project, sheet: SheetSpec | undefined) {
  if (sheet) project.material.secondarySheet = { ...sheet };
  else delete project.material.secondarySheet;
}

/** Choose one material's packing without changing the other material's sheets. */
export function setCutLayout(project: Project, layout: CutLayout, material: MaterialKind = 'primary') {
  if (material === 'secondary') project.material.secondaryLayout = layout;
  else if (layout === 'strips') delete project.material.layout;
  else project.material.layout = layout;
}

/** Is a size off the project's rounding step (the step cut sizes are rounded to)? */
export function offStep(size: Mm, step: Mm): boolean {
  return step > 0 && Math.abs(size - roundTo(size, step)) > 0.005;
}

/**
 * Lock every part to the nearest step except one, which takes what is left: the last flexible
 * part, or the largest when all are locked. When the space being divided is itself on the step,
 * so is the remainder.
 */
export function roundParts(split: SplitNode, sizes: Mm[], step: Mm) {
  let absorber = split.children.map((c) => c.size.mode).lastIndexOf('flex');
  if (absorber < 0) absorber = sizes.indexOf(Math.max(...sizes));
  split.children.forEach((c, i) => {
    c.size = i === absorber ? { mode: 'flex', weight: 1 } : { mode: 'fixed', mm: Math.max(MIN_REGION, roundTo(sizes[i], step)) };
  });
}

export function distributeEqually(split: SplitNode) {
  for (const c of split.children) c.size = { mode: 'flex', weight: 1 };
}

/**
 * Give children new sizes while keeping locked ones locked. Flex weights are stored in mm,
 * so every other flex sibling keeps its current size.
 */
export function applySizes(split: SplitNode, sizes: Mm[]) {
  split.children.forEach((c, i) => {
    c.size = c.size.mode === 'fixed' ? { mode: 'fixed', mm: sizes[i] } : { mode: 'flex', weight: Math.max(sizes[i], 0.001) };
  });
}

/**
 * Move the bar between child `index` and `index + 1` by `delta` mm from `startSizes`.
 * Either neighbour snaps to a size in `targets` when within `snapDist`, so equal
 * compartments (and equal cut pieces) are easy to hit.
 */
export function dragBar(split: SplitNode, index: number, startSizes: Mm[], delta: Mm, targets: Mm[] = [], snapDist = 1.5, step = 0.5): Mm {
  const a = startSizes[index];
  const b = startSizes[index + 1];
  let d = Math.round(delta / step) * step;
  let best = snapDist;
  for (const t of targets) {
    const da = Math.abs(a + delta - t);
    const db = Math.abs(b - delta - t);
    if (da < best) {
      best = da;
      d = t - a;
    }
    if (db < best) {
      best = db;
      d = b - t;
    }
  }
  d = Math.max(MIN_REGION - a, Math.min(b - MIN_REGION, d));
  const sizes = [...startSizes];
  sizes[index] = a + d;
  sizes[index + 1] = b - d;
  applySizes(split, sizes);
  return sizes[index];
}

/**
 * Lock one child's size. If that leaves no flex sibling to absorb the change, the largest
 * other sibling becomes flex, so the layout still fills its space.
 */
export function lockChild(split: SplitNode, index: number, mm: Mm, currentSizes: Mm[] = []) {
  split.children[index].size = { mode: 'fixed', mm };
  if (split.children.some((c) => c.size.mode === 'flex')) return;
  let pick = -1;
  split.children.forEach((_, i) => {
    if (i !== index && (pick < 0 || (currentSizes[i] ?? 0) > (currentSizes[pick] ?? 0))) pick = i;
  });
  if (pick >= 0) {
    split.children[pick].size = { mode: 'flex', weight: 1 };
    const sizes = currentSizes.length ? currentSizes : split.children.map(() => 1);
    applySizes(split, sizes.map((v, i) => (i === index ? mm : v)));
  }
}

/** The only flex child can't be locked: something has to absorb the leftover space. */
export function isLastFlex(split: SplitNode, index: number): boolean {
  return split.children[index].size.mode === 'flex' && split.children.filter((c) => c.size.mode === 'flex').length === 1;
}

/** Lock at the current size, or unlock. */
export function toggleLock(split: SplitNode, index: number, currentSizes: Mm[]) {
  if (split.children[index].size.mode === 'fixed') unlockChild(split, index, currentSizes);
  else if (!isLastFlex(split, index)) lockChild(split, index, currentSizes[index], currentSizes);
}

export function unlockChild(split: SplitNode, index: number, currentSizes: Mm[]) {
  split.children[index].size = { mode: 'flex', weight: 1 };
  applySizes(split, currentSizes);
}
