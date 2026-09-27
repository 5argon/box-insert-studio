<script lang="ts">
  import { sectionColor, sectionInk } from '../core/defaults';
  import { addSibling, axisOwner, findParent, insertMode, lockChild, removeSection, setInsert, setJoin, setStacked, splitSection } from '../core/edit';
  import { mm } from '../core/geom';
  import type { Compartment, Solved, SolvedLayer } from '../core/layout';
  import type { CutList } from '../core/pieces';
  import type { Dir, Layer, Project, Side, SplitNode } from '../core/types';
  import LockButton from './LockButton.svelte';
  import NumberField from './NumberField.svelte';
  import type { Selection } from './state.svelte';

  let {
    project,
    layer,
    solved,
    solvedLayer,
    cut,
    compartment: c,
    onselect,
  }: {
    project: Project;
    layer: Layer;
    solved: Solved;
    solvedLayer: SolvedLayer;
    cut: CutList;
    compartment: Compartment;
    onselect: (sel: Selection) => void;
  } = $props();

  const T = $derived(project.foam.thickness);
  const tray = $derived(solved.trays.find((t) => t.id === c.trayId));
  /** The compartment a box stands in: this one if it holds a box, or the one around this box. */
  const well = $derived(c.wellId ? solved.compartments.find((x) => x.id === c.wellId) : c.node.insert ? c : undefined);
  const boxes = $derived(well ? solved.trays.filter((t) => t.wellId === well.id && !t.copyOf) : []);
  const stacked = $derived(!!well?.node.insert?.stacked);
  const insertRoot = $derived(well?.node.insert?.root);
  const mode = $derived(well ? insertMode(well.node) : 'single');
  const parent = $derived(findParent(layer.root, c.id));
  const beside = $derived(parent?.split.join === 'trays' ? (c.depth === 1 ? 'box' : 'tray') : null);
  const axes: { dir: Dir; label: string; key: 'w' | 'h' }[] = [
    { dir: 'row', label: 'Width', key: 'w' },
    { dir: 'column', label: 'Depth', key: 'h' },
  ];

  /**
   * The split whose part sets this compartment's size on an axis, and what to add to an inside size
   * to get that part's size: tray splits size tray outsides (two walls more). A compartment inside a
   * box with nothing splitting that axis falls back to its well: two box walls and the clearance more.
   */
  function ownerFor(dir: Dir): { split: SplitNode; index: number; extra: number } | undefined {
    const o = axisOwner(layer.root, c.id, dir);
    if (o) return { ...o, extra: o.split.join === 'trays' ? 2 * T : 0 };
    if (c.wellId) {
      const w = axisOwner(layer.root, c.wellId, dir);
      if (w) return { ...w, extra: 2 * T + project.clearance + (w.split.join === 'trays' ? 2 * T : 0) };
    }
    return undefined;
  }
  const owners = $derived({ row: ownerFor('row'), column: ownerFor('column') });

  function sizesOf(splitId: string) {
    return solvedLayer.splits.find((x) => x.id === splitId)?.childSizes ?? [];
  }

  function setSize(dir: Dir, value: number) {
    const o = owners[dir];
    if (o) lockChild(o.split, o.index, value + o.extra, sizesOf(o.split.id));
  }

  /** Sizes other compartments already use, rounded; picking one keeps cut sizes shared. */
  function sizesInUse(key: 'w' | 'h'): number[] {
    const own = Math.round(c.rect[key] * 2) / 2;
    const set = new Set<number>();
    for (const o of solved.compartments) {
      if (o.id === c.id || o.node.insert) continue;
      for (const v of [o.rect.w, o.rect.h]) set.add(Math.round(v * 2) / 2);
    }
    set.delete(own);
    return [...set].filter((v) => v > 0 && Math.abs(v - own) <= Math.max(25, own * 0.4)).sort((a, b) => Math.abs(a - own) - Math.abs(b - own)).slice(0, 6).sort((a, b) => a - b);
  }

  function split(dir: Dir) {
    const id = splitSection(layer, c.id, dir, T);
    if (id) onselect({ kind: 'section', id });
  }

  function addBeside() {
    const id = addSibling(layer, c.id, project.clearance);
    if (id) onselect({ kind: 'section', id });
  }

  function remove() {
    const next = removeSection(layer, c.id);
    onselect(next ? { kind: 'section', id: next } : null);
  }

  function setMode(m: 'single' | 'multiple') {
    if (insertRoot?.kind === 'split') setJoin(layer, insertRoot, m === 'multiple' ? 'trays' : 'divider', T);
  }

  function toggleNotch(side: Side) {
    const n = c.node.notches;
    const i = n.indexOf(side);
    if (i >= 0) n.splice(i, 1);
    else n.push(side);
  }

  const SIDE_ORDER: Side[] = ['back', 'front', 'left', 'right'];
  const pieceById = $derived(new Map(solved.pieces.map((p) => [p.id, p])));
  /** Height of one box: what is left above the tray floor, halved when two are stacked. */
  const boxHeight = $derived((layer.height - T) / (stacked ? 2 : 1));
  /** Sides whose divider stands lower than the walls, with how much lower. */
  const lowSides = $derived(
    SIDE_ORDER.flatMap((side) => {
      const p = pieceById.get(c.bounds[side]);
      return p?.kind === 'divider' && p.lower ? [`${side} ${mm(p.lower)} mm`] : [];
    }),
  );
  const boxWall = $derived(project.base === 'under' ? boxHeight - T : boxHeight);
</script>

<div class="panel-section head">
  <span class="swatch" style:background={sectionColor(c.index)} style:border-color={sectionInk(c.index)}>{c.label}{c.stacked ? '²' : ''}</span>
  <div>
    <div class="title">Compartment {c.label}{c.stacked ? '² (in both stacked boxes)' : ''}</div>
    <div class="hint">
      {#if c.depth === 1}
        In the box inside {well?.label} · {mm(c.rect.w)} × {mm(c.rect.h)} × {mm(c.height)} mm inside
      {:else}
        Tray {tray?.number} · {layer.name} · {mm(c.rect.w)} × {mm(c.rect.h)} × {mm(c.height)} mm inside
      {/if}
    </div>
  </div>
</div>

<div class="panel-section">
  <div class="row">
    <button class="small" onclick={() => split('row')} title="Add a vertical divider through this compartment">Add │ divider</button>
    <button class="small" onclick={() => split('column')} title="Add a horizontal divider through this compartment">Add ─ divider</button>
    {#if beside}
      <button class="small" onclick={addBeside} title="Add another separate {beside} next to this one">Add {beside}</button>
    {/if}
    <button class="small" onclick={remove} disabled={layer.root.kind === 'section'}>Remove</button>
  </div>
  {#if c.depth === 1 && well}
    <button class="small link" onclick={() => onselect({ kind: 'section', id: well.id })}>Select {well.label}, the compartment this box stands in</button>
  {/if}
</div>

<div class="panel-section">
  <h2>Inside size</h2>
  {#each axes as a (a.dir)}
    {@const o = owners[a.dir]}
    <div class="sized">
      <NumberField label={a.label} value={c.rect[a.key]} min={5} disabled={!o} onchange={(v) => setSize(a.dir, v)} />
      {#if o}
        <LockButton split={o.split} index={o.index} sizes={sizesOf(o.split.id)} />
      {:else}
        <span></span>
      {/if}
    </div>
    {#if o}
      {@const used = sizesInUse(a.key)}
      {#if used.length}
        <div class="reuse">
          <span class="hint">Reuse</span>
          {#each used as v (v)}
            <button class="chip" onclick={() => setSize(a.dir, v)} title="Other compartments use {v} mm; matching makes shared cut sizes">{v}</button>
          {/each}
        </div>
      {/if}
    {/if}
  {/each}
  <div class="height">
    <span>Height</span>
    <b>{mm(c.height)} mm{c.stacked ? ' each' : ''}</b>
    <span class="hint">
      {#if c.depth === 1 && c.stacked}
        In each box: ({layer.name} {mm(layer.height)} − {mm(T)} tray floor) ÷ 2 = {mm(boxHeight)} per box, − {mm(T)} box floor
      {:else if c.depth === 1}
        {layer.name} {mm(layer.height)} − {mm(T)} tray floor − {mm(T)} box floor
      {:else}
        {layer.name} {mm(layer.height)} − {mm(T)} floor
      {/if}
    </span>
  </div>
  {#if lowSides.length}
    <p class="hint">Lowered dividers on the {lowSides.join(', ')}.</p>
  {/if}
  <p class="hint">
    Locked sizes stay put; flex ones share what is left, and one part in each row stays flex. Typing a size locks it.
    {#if c.depth === 1}Where nothing inside the box divides this direction, the size resizes {well?.label} to fit the box.{/if}
  </p>
</div>

<div class="panel-section">
  <h2>Removable box</h2>
  {#if !well}
    <p class="hint">
      Put a lift-out box in this compartment. It stands on the base, so it is {mm(boxHeight)} mm tall with {mm(boxWall)} mm walls and its top sits flush.
      You can then divide the inside.
    </p>
    <button class="small" onclick={() => setInsert(layer, c.id, true)} disabled={c.depth === 1}>Add a box inside</button>
  {:else}
    <div class="row">
      <button class="small" class:on={mode === 'single'} onclick={() => setMode('single')}>One box with dividers</button>
      <button class="small" class:on={mode === 'multiple'} onclick={() => setMode('multiple')} disabled={insertRoot?.kind !== 'split'}>Separate boxes</button>
    </div>
    <p class="hint">
      {#if insertRoot?.kind !== 'split'}
        Add a divider inside the box to choose between one box with a divider and separate boxes.
      {:else if mode === 'single'}
        Lifts out as one box; its inside is divided by glued dividers.
      {:else}
        Each part is its own box with four walls and {project.clearance} mm between them.
      {/if}
      {#if stacked}
        Stacked two high{boxes.length > 1 ? `, ${boxes.length} boxes on each level` : ''}: each box is {mm(boxHeight)} mm tall with {mm(boxWall)} mm walls and
        its own floor, {mm(boxHeight - T)} mm inside. Together they sit flush.
      {:else}
        {boxes.length === 1 ? 'The box is' : `${boxes.length} boxes,`} {mm(boxHeight)} mm tall with {mm(boxWall)} mm walls, {mm(boxHeight - T)} mm inside,
        standing on the base so the top sits flush.
      {/if}
    </p>
    <label class="check">
      <input type="checkbox" checked={stacked} onchange={(e) => setStacked(well.node, e.currentTarget.checked)} />
      Stack two boxes (each half the height)
    </label>
    <div class="row">
      {#each solved.compartments.filter((x) => x.wellId === well.id) as x (x.id)}
        <button class="chip" class:on={x.id === c.id} onclick={() => onselect({ kind: 'section', id: x.id })}>{x.label}{x.stacked ? '²' : ''}</button>
      {/each}
      {#if c.id === well.id}
        <button class="small" onclick={() => setInsert(layer, c.id, false)}>Remove box</button>
      {/if}
    </div>
  {/if}
</div>

<div class="panel-section">
  <h2>Finger notches</h2>
  <div class="notches">
    {#each SIDE_ORDER as side (side)}
      {@const p = pieceById.get(c.bounds[side])}
      <button class="small" class:on={c.node.notches.includes(side)} onclick={() => toggleNotch(side)}>
        {side[0].toUpperCase() + side.slice(1)}
        <span class="piece-ref">#{p ? cut.groupOf.get(p.id)?.number : '?'}</span>
      </button>
    {/each}
  </div>
  <p class="hint">
    A {project.notch.width} × {project.notch.depth} mm U-notch is cut into the wall or divider on that side, centred on this compartment.
    {#if c.node.insert}Notches here help lift the box out.{/if}
  </p>
  {#each c.issues as issue, i (i)}
    <div class="issue {issue.level}">{issue.message}</div>
  {/each}
</div>

<style>
  .head {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .swatch {
    width: 34px;
    height: 34px;
    border-radius: 6px;
    border: 1.5px solid;
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 16px;
    flex: none;
  }
  .title {
    font-weight: 600;
    font-size: 14px;
  }
  .sized {
    display: grid;
    grid-template-columns: 1fr 58px;
    gap: 6px;
    align-items: center;
  }
  .height {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 10px;
    align-items: baseline;
    margin: 6px 0 2px;
  }
  .height b {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .height .hint {
    grid-column: 1 / -1;
    margin: 0;
  }
  .reuse {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
    margin: 0 0 8px;
  }
  .chip {
    padding: 0 7px;
    font-size: 12px;
    border-radius: 10px;
    font-variant-numeric: tabular-nums;
  }
  .link {
    margin-top: 8px;
    border: none;
    padding: 0;
    color: var(--accent);
    background: none;
    text-align: left;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 4px 0 8px;
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .notches {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .piece-ref {
    color: var(--muted);
    font-size: 11px;
    margin-left: 4px;
  }
  .hint {
    margin: 6px 0 0;
  }
</style>
