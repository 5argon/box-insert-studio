<script lang="ts">
  import { findSplit, sectionIds } from '../core/edit';
  import { dividerMaterial, dividerThickness, type SolvedLayer } from '../core/layout';
  import { MIXED, maxDividerLower, setDividersLower, setDividersSecondary, shared, type DividerPick } from '../core/multi';
  import { materialLabel } from '../core/pieces';
  import type { Layer, Project } from '../core/types';
  import NumberField from './NumberField.svelte';
  import { select } from './state.svelte';

  /** Several dividers edited together; a value that differs between them shows as "—". */
  let { project, layer, solvedLayer, picks }: { project: Project; layer: Layer; solvedLayer: SolvedLayer; picks: DividerPick[] } = $props();

  const labelOf = $derived(new Map(solvedLayer.compartments.map((c) => [c.id, c.label])));
  const splitOf = (p: DividerPick) => findSplit(layer.root, p.splitId);
  /** Only glued dividers have a material and height; gaps between separate trays have neither. */
  const dividers = $derived(picks.filter((p) => splitOf(p)?.join === 'divider'));
  const name = (p: DividerPick) => {
    const split = splitOf(p)!;
    const side = (i: number) => sectionIds(split.children[i]!.node).map((id) => labelOf.get(id)).join(' ');
    return `${side(p.index)} | ${side(p.index + 1)}`;
  };

  const secondary = $derived(project.material.secondaryThickness !== undefined);
  const useSecondary = $derived(shared(dividers.map((p) => dividerMaterial(project, splitOf(p)!, p.index) === 'secondary')));
  const lower = $derived(shared(dividers.map((p) => splitOf(p)!.lower)));
  const maxLower = $derived(Math.min(...dividers.map((p) => maxDividerLower(project, layer, solvedLayer, p.splitId))));
</script>

<div class="panel-section head">
  <div class="title">{picks.length} dividers</div>
  <ul class="names">
    {#each picks as p (`${p.splitId}:${p.index}`)}
      <li>
        <button class="link" onclick={() => select({ kind: 'split', id: p.splitId, index: p.index })} data-tip="Select only this divider">{name(p)}</button>
        {#if splitOf(p)?.join !== 'divider'}<span class="hint">gap between trays</span>{/if}
      </li>
    {/each}
  </ul>
  <button class="link clear" onclick={() => select(null)}>Clear selection</button>
  <p class="hint">Cmd or Ctrl-click to add or remove dividers. A field shown as “—” differs between them; changing it sets them all.</p>
</div>

{#if dividers.length}
  <div class="panel-section">
    <h2>Material</h2>
    {#if secondary}
      <label class="check">
        <input
          type="checkbox"
          checked={useSecondary === true}
          indeterminate={useSecondary === MIXED}
          onchange={() => setDividersSecondary(layer, dividers, useSecondary !== true)}
        />
        Use secondary material
      </label>
      <p class="hint">
        {useSecondary === MIXED
          ? 'Some use the secondary material.'
          : materialLabel(dividerMaterial(project, splitOf(dividers[0]!)!, dividers[0]!.index), dividerThickness(project, splitOf(dividers[0]!)!, dividers[0]!.index))}
      </p>
    {:else}
      <p class="hint">Enable Secondary material under Material to cut dividers from it.</p>
    {/if}
  </div>

  <div class="panel-section">
    <h2>Height</h2>
    <NumberField
      label="Lower by"
      value={lower === MIXED || lower === undefined ? 0 : lower}
      mixed={lower === MIXED}
      min={0}
      hint="How far below the walls; applies to every divider in the selected dividers' rows"
      onchange={(v) => setDividersLower(project, layer, solvedLayer, dividers, v)}
    />
    <p class="hint">Up to {Math.round(maxLower * 10) / 10} mm for all of them. A row of dividers is lowered together, including any not selected.</p>
  </div>
{:else}
  <div class="panel-section">
    <p class="hint">These are gaps between separate trays: there is nothing to edit together.</p>
  </div>
{/if}

<style>
  .title {
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 6px;
  }
  .names {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .names li {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .link {
    border: none;
    padding: 0;
    color: var(--accent);
    background: none;
    font-size: 12.5px;
  }
  .clear {
    margin-top: 6px;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .hint {
    margin: 6px 0 0;
  }
</style>
