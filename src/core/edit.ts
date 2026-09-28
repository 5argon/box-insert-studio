import { newSection } from './defaults';
import type { Dir, Join, Layer, LayoutNode, Mm, SectionNode, SplitNode } from './types';

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

/** Stack two identical half-height boxes in the compartment, or go back to one full-height box. */
export function setStacked(section: SectionNode, stacked: boolean) {
  if (!section.insert) return;
  if (stacked) section.insert.stacked = true;
  else delete section.insert.stacked;
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
export function splitSection(layer: Layer, sectionId: string, dir: Dir, gap: Mm): string | undefined {
  const section = findSection(layer.root, sectionId);
  if (!section) return undefined;
  const parent = findParent(layer.root, sectionId);
  if (parent && parent.split.dir === dir && parent.split.join === 'divider') return addSibling(layer, sectionId, gap);
  const fresh = newSection();
  const split: SplitNode = {
    kind: 'split',
    id: `p-${fresh.id}`,
    dir,
    join: 'divider',
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
  const size = child.size.mode === 'flex' ? { mode: 'flex' as const, weight: child.size.weight / 2 } : { mode: 'fixed' as const, mm: Math.max(MIN_REGION, (child.size.mm - gap) / 2) };
  child.size = { ...size };
  parent.split.children.splice(parent.index + 1, 0, { size: { ...size }, node: fresh });
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
