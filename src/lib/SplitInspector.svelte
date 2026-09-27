<script lang="ts">
  import { canUseTrays, distributeEqually, insertHost, lockChild, sectionIds, setJoin } from '../core/edit';
  import type { SolvedLayer, SolvedSplit } from '../core/layout';
  import type { Layer, Project } from '../core/types';
  import LockButton from './LockButton.svelte';
  import NumberField from './NumberField.svelte';

  let { project, layer, solvedLayer, split }: { project: Project; layer: Layer; solvedLayer: SolvedLayer; split: SolvedSplit } = $props();

  const node = $derived(split.node);
  const labelOf = $derived(new Map(solvedLayer.compartments.map((c) => [c.id, c.label])));
  const trays = $derived(node.join === 'trays');
  const traysAllowed = $derived(canUseTrays(layer.root, node.id));
  /** Inside a removable box, "trays" are separate boxes and the height is one thickness less. */
  const host = $derived(insertHost(layer.root, node.id));
  const hostLabel = $derived(host ? solvedLayer.compartments.find((c) => c.id === host.id)?.label : undefined);
  const unit = $derived(host ? 'box' : 'tray');
  const units = $derived(host ? 'boxes' : 'trays');
  const maxLower = $derived(layer.height - project.foam.thickness * (host ? 2 : 1) - 5);
</script>

<div class="panel-section">
  <div class="title">
    {node.dir === 'row' ? 'Vertical' : 'Horizontal'}
    {trays ? `${unit} split` : 'dividers'}{host ? ` inside the box in ${hostLabel}` : ''}
  </div>
  <div class="row join">
    <button class="small" class:on={!trays} onclick={() => setJoin(layer, node, 'divider', project.foam.thickness)}>
      {host ? 'One box with dividers' : 'Glued dividers'}
    </button>
    <button class="small" class:on={trays} disabled={!traysAllowed} onclick={() => setJoin(layer, node, 'trays', project.foam.thickness)}>
      Separate {units}
    </button>
  </div>
  <p class="hint">
    {#if trays}
      Each part is its own lift-out {unit} with a base and four walls; sizes below are {unit} outsides.
    {:else if traysAllowed}
      One glued {unit}; sizes below are compartment insides. Switch to separate {units} to lift parts out on their own.
    {:else}
      This split is inside a {unit}, so it can only be dividers. Separate {units} must split the whole {host ? 'box area' : 'layer'} (or another
      split of separate {units}).
    {/if}
  </p>
  {#if !trays}
    <NumberField
      label="Lower dividers by"
      value={node.lower}
      min={0}
      max={Math.max(0, maxLower)}
      onchange={(v) => (node.lower = v)}
      hint="Shorter dividers are easier to reach over; a new height is a new strip width to cut"
    />
  {/if}
  <button onclick={() => distributeEqually(node)}>Distribute equally</button>
</div>

<div class="panel-section">
  <h2>Parts</h2>
  {#each node.children as child, i (child.node.id)}
    <div class="part">
      <NumberField
        label={sectionIds(child.node)
          .map((id) => labelOf.get(id))
          .join(' ')}
        value={split.childSizes[i]}
        min={5}
        onchange={(v) => lockChild(node, i, v, split.childSizes)}
      />
      <LockButton split={node} index={i} sizes={split.childSizes} />
    </div>
  {/each}
  <p class="hint">Locked parts keep their size; flex parts share what is left. Click to switch. One part always stays flex to fill the space.</p>
</div>

<style>
  .title {
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 8px;
  }
  .join {
    margin-bottom: 4px;
  }
  .part {
    display: grid;
    grid-template-columns: 1fr 58px;
    gap: 6px;
    align-items: center;
  }
  .hint {
    margin: 4px 0 8px;
  }
</style>
