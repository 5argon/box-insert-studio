<script lang="ts">
  import { sizeOwner } from '../core/edit';
  import { mm } from '../core/geom';
  import { fitItems } from '../core/items';
  import { padLimit, type Compartment, type Solved } from '../core/layout';
  import {
    MIXED,
    setArrows,
    setEmptyAboveAll,
    setItemFields,
    setLidAll,
    setLowSides,
    setNotchSides,
    setPads,
    setSimulation,
    setSizes,
    setStackedAll,
    shared,
    simulatable,
    wells,
    type Shared,
  } from '../core/multi';
  import { hasLow, hasNotch } from '../core/notches';
  import type { Dir, ItemSpec, Layer, Project, Side } from '../core/types';
  import CompSquare from './CompSquare.svelte';
  import NumberField from './NumberField.svelte';
  import { select } from './state.svelte';

  /**
   * Several compartments edited together. Each field shows the value they share, or "—" (a dashed
   * button, an indeterminate box) where they differ; changing it sets every one that can take it.
   */
  let { project, layer, solved, compartments: comps }: { project: Project; layer: Layer; solved: Solved; compartments: Compartment[] } = $props();

  const SIDES: Side[] = ['back', 'front', 'left', 'right'];
  const ARROWS: { side: Side; glyph: string }[] = [
    { side: 'back', glyph: '↑' },
    { side: 'front', glyph: '↓' },
    { side: 'left', glyph: '←' },
    { side: 'right', glyph: '→' },
  ];
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  /** A shared value for a field, the first one as a stand-in when they differ. */
  const valueOf = <T,>(v: Shared<T> | undefined, fallback: T): T => (v === undefined || v === MIXED ? fallback : v);
  const round2 = (v: number) => Math.round(v * 100) / 100;

  // Inside size
  const axes: { dir: Dir; label: string; key: 'w' | 'h' }[] = [
    { dir: 'row', label: 'Width', key: 'w' },
    { dir: 'column', label: 'Depth', key: 'h' },
  ];
  const sizable = (dir: Dir) => comps.every((c) => sizeOwner(project, layer, c, dir));
  const size = (key: 'w' | 'h') => shared(comps.map((c) => round2(c.rect[key])));

  // Item direction and simulation
  const arrow = $derived(shared(comps.map((c) => c.node.arrow ?? null)));
  const canSimulate = $derived(simulatable(comps).length === comps.length);
  const simOn = $derived(shared(comps.map((c) => !!c.node.items?.on)));
  const items = $derived(comps.map((c) => c.node.items).filter((i): i is ItemSpec => !!i?.on));
  const item = <K extends keyof ItemSpec>(key: K) => shared(items.map((i) => i[key]));

  // Sides
  const notchOn = (side: Side) => shared(comps.map((c) => hasNotch(solved, c, side)));
  const lowOn = (side: Side) => shared(comps.map((c) => hasLow(solved, c, side)));

  // Raised floor
  const pads = $derived(shared(comps.map((c) => c.pad)));
  const padMax = $derived(Math.min(...comps.map((c) => padLimit(project, c))));

  // Removable boxes
  const boxes = $derived(wells(comps));
  const allWells = $derived(boxes.length === comps.length);
  const stacked = $derived(shared(boxes.map((c) => !!c.node.insert?.stacked)));
  const emptyAbove = $derived(shared(boxes.map((c) => !!c.node.insert?.emptyAbove)));
  const lid = $derived(shared(boxes.map((c) => !!c.node.insert?.lid)));
</script>

<div class="panel-section head">
  <div class="title">{comps.length} compartments</div>
  <div class="row squares">
    {#each comps as c (c.id)}
      <button class="square-link" onclick={() => select({ kind: 'section', id: c.id })} data-tip="Select only {c.label}">
        <CompSquare {c} size="sm" />
      </button>
    {/each}
    <button class="link" onclick={() => select(null)}>Clear</button>
  </div>
  <p class="hint">Cmd or Ctrl-click to add or remove compartments. A field shown as “—” or with a dashed outline differs between them; changing it sets them all.</p>
</div>

<div class="panel-section">
  <h2>Inside size</h2>
  {#each axes as a (a.dir)}
    {@const v = size(a.key)}
    <NumberField
      label={a.label}
      value={valueOf(v, 0)}
      mixed={v === MIXED}
      min={5}
      disabled={!sizable(a.dir)}
      hint={sizable(a.dir) ? `Lock every selected compartment to this ${a.label.toLowerCase()}` : 'Some of these cannot be sized this way'}
      onchange={(value) => setSizes(project, layer, comps, a.dir, value)}
    />
  {/each}
</div>

<div class="panel-section">
  <h2>Item direction</h2>
  <div class="arrows" role="group" aria-label="Item direction arrow">
    {#each ARROWS as a (a.side)}
      {@const on = arrow === a.side}
      {@const some = arrow === MIXED && comps.some((c) => c.node.arrow === a.side)}
      <button
        class="small"
        class:on
        class:mixed={some}
        onclick={() => setArrows(comps, on ? undefined : a.side)}
        aria-label="Arrow toward the {a.side}"
        aria-pressed={on ? 'true' : some ? 'mixed' : 'false'}
        data-tip={on ? 'Remove the arrow from all' : some ? `Some point ${a.side}; point them all ${a.side}` : `Point them all toward the ${a.side}`}>{a.glyph}</button
      >
    {/each}
  </div>
  {#if canSimulate}
    <label class="check sim">
      <input type="checkbox" checked={simOn === true} indeterminate={simOn === MIXED} onchange={() => setSimulation(comps, simOn !== true)} />
      Simulate items
    </label>
    {#if simOn === true}
      {@const shape = item('shape')}
      <div class="row shape" role="group" aria-label="Item shape">
        {#each ['box', 'cylinder'] as const as s (s)}
          <button class="small" class:on={shape === s} class:mixed={shape === MIXED} onclick={() => setItemFields(comps, { shape: s })}>{cap(s)}</button>
        {/each}
      </div>
      <NumberField label={shape === 'cylinder' ? 'Diameter' : 'Width'} value={valueOf(item('width'), 0)} mixed={item('width') === MIXED} min={0.5} hint="Across the arrow" onchange={(v) => setItemFields(comps, { width: v })} />
      {#if shape !== 'cylinder'}
        <NumberField label="Height" value={valueOf(item('height'), 0)} mixed={item('height') === MIXED} min={0.5} hint="Standing up from the floor" onchange={(v) => setItemFields(comps, { height: v })} />
      {/if}
      <NumberField
        label="Thickness"
        value={valueOf(item('thickness'), 0)}
        mixed={item('thickness') === MIXED}
        min={0.0001}
        step={0.01}
        decimals={4}
        hint="Along the arrow, up to 4 decimal places"
        onchange={(v) => setItemFields(comps, { thickness: v })}
      />
      <NumberField label="Free space" value={valueOf(item('spare'), 0)} mixed={item('spare') === MIXED} min={0} hint="Left empty at the arrow's head" onchange={(v) => setItemFields(comps, { spare: v })} />
      <ul class="fits">
        {#each comps as c (c.id)}
          {@const fit = fitItems(c, c.node.arrow!, c.node.items!)}
          <li class:bad={fit.warnings.length}><CompSquare {c} size="sm" /> <b>{fit.count}</b> fit{c.stacked ? ' in each box' : ''}{fit.warnings.length ? ` · ${fit.warnings[0]}` : ''}</li>
        {/each}
      </ul>
    {/if}
  {:else if arrow !== null}
    <p class="hint">To simulate items together, give every selected compartment a direction; compartments holding a box simulate items in the box instead.</p>
  {/if}
</div>

<div class="panel-section">
  <h2>Raised floor</h2>
  <NumberField
    label="Layers"
    unit=""
    value={valueOf(pads, 0)}
    mixed={pads === MIXED}
    min={0}
    step={1}
    decimals={0}
    hint="Raised-floor layers in every selected compartment; each stops at what it can take"
    onchange={(v) => setPads(project, comps, v)}
  />
  <p class="hint">Up to {padMax} layer{padMax === 1 ? '' : 's'} fit in all of them; ones with more room can take more on their own.</p>
</div>

<div class="panel-section">
  <h2>Finger notches</h2>
  <div class="sides">
    {#each SIDES as side (side)}
      {@const state = notchOn(side)}
      <button
        class="small dash"
        class:on={state === true}
        class:mixed={state === MIXED}
        aria-pressed={state === true ? 'true' : state === MIXED ? 'mixed' : 'false'}
        onclick={() => setNotchSides(solved, comps, side, state !== true)}
        data-tip={state === true ? `Remove the ${side} notch from all` : `Notch the ${side} of all; a side lowered there is left alone`}>{cap(side)}</button
      >
    {/each}
  </div>
  <h2 class="sub">Lowered sides</h2>
  <div class="sides">
    {#each SIDES as side (side)}
      {@const state = lowOn(side)}
      <button
        class="small dash"
        class:on={state === true}
        class:mixed={state === MIXED}
        aria-pressed={state === true ? 'true' : state === MIXED ? 'mixed' : 'false'}
        onclick={() => setLowSides(solved, comps, side, state !== true)}
        data-tip={state === true ? `Raise the ${side} of all again` : `Lower the ${side} of all; a side notched there is left alone`}>{cap(side)}</button
      >
    {/each}
  </div>
</div>

{#if allWells}
  <div class="panel-section">
    <h2>Removable boxes</h2>
    <label class="check">
      <input type="checkbox" checked={stacked === true} indeterminate={stacked === MIXED} onchange={() => setStackedAll(comps, stacked !== true)} />
      Stack two boxes (each half the height)
    </label>
    {#if stacked === true}
      <label class="check nested">
        <input type="checkbox" checked={emptyAbove === true} indeterminate={emptyAbove === MIXED} onchange={() => setEmptyAboveAll(comps, emptyAbove !== true)} />
        Leave out the top box (empty above)
      </label>
    {/if}
    <label class="check">
      <input type="checkbox" checked={lid === true} indeterminate={lid === MIXED} onchange={() => setLidAll(comps, lid !== true)} />
      Lid
    </label>
    <p class="hint">Box layouts, materials and lid notches are set one compartment at a time.</p>
  </div>
{/if}

<style>
  .head .title {
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 6px;
  }
  .squares {
    gap: 2px;
  }
  .square-link {
    padding: 2px;
    border: 1.5px solid transparent;
    background: none;
    border-radius: 7px;
    line-height: 0;
  }
  .square-link:hover {
    border-color: var(--line-strong);
  }
  .link {
    border: none;
    padding: 0 0 0 6px;
    color: var(--accent);
    background: none;
    font-size: 12px;
  }
  .arrows {
    display: flex;
    gap: 6px;
  }
  .arrows button {
    width: 30px;
    font-size: 14px;
    padding: 1px 0;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 8px 0 4px;
  }
  .check.nested {
    margin-left: 22px;
  }
  .shape {
    margin: 4px 0 2px;
  }
  .sides {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .sub {
    margin-top: 12px;
  }
  .fits {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    font-size: 12px;
  }
  .fits li {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 2px 0;
  }
  .fits li.bad {
    color: var(--warn);
  }
  .hint {
    margin: 6px 0 0;
  }
</style>
