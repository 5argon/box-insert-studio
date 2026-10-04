<script lang="ts">
  import { canUseTrays, distributeEqually, insertHost, lockChild, offStep, roundParts, sectionIds, setDividerSecondary, setJoin } from '../core/edit';
  import { dividerMaterial, dividerThickness, type SolvedLayer, type SolvedSplit } from '../core/layout';
  import { materialLabel } from '../core/pieces';
  import type { Layer, Project } from '../core/types';
  import { maxDividerLower } from '../core/multi';
  import LockButton from './LockButton.svelte';
  import NumberField from './NumberField.svelte';

  let { project, layer, solvedLayer, split, dividerIndex }: { project: Project; layer: Layer; solvedLayer: SolvedLayer; split: SolvedSplit; dividerIndex?: number } = $props();

  const node = $derived(split.node);
  const labelOf = $derived(new Map(solvedLayer.compartments.map((c) => [c.id, c.label])));
  const trays = $derived(node.join === 'trays');
  const traysAllowed = $derived(canUseTrays(layer.root, node.id));
  /** Inside a removable box, "trays" are separate boxes within the host compartment. */
  const host = $derived(insertHost(layer.root, node.id));
  const hostLabel = $derived(host ? solvedLayer.compartments.find((c) => c.id === host.id)?.label : undefined);
  const unit = $derived(host ? 'box' : 'tray');
  const units = $derived(host ? 'boxes' : 'trays');
  /** Parts whose size is off the rounding step that cut sizes use, e.g. after distributing equally. */
  const step = $derived(project.precision);
  const partLabel = (i: number) =>
    sectionIds(node.children[i].node)
      .map((id) => labelOf.get(id))
      .join(' ');
  /** Two decimals, as the size fields show: one would hide how far off a size is. */
  const mm2 = (v: number) => String(Number(v.toFixed(2)));
  const off = $derived(split.childSizes.flatMap((v, i) => (offStep(v, step) ? [i] : [])));
  const offSizes = $derived([...new Set(off.map((i) => mm2(split.childSizes[i])))]);
  /** Dividers keep at least 5 mm: inside a box, of the box's own inside height. */
  const maxLower = $derived(maxDividerLower(project, layer, solvedLayer, node.id));
</script>

<div class="panel-section">
  <div class="title">
    {node.dir === 'row' ? 'Vertical' : 'Horizontal'}
    {trays ? `${unit} split` : 'dividers'}{host ? ` inside the box in ${hostLabel}` : ''}
  </div>
  <div class="row join">
    <button class="small" class:on={!trays} onclick={() => setJoin(layer, node, 'divider', project.material.thickness)}>
      {host ? 'One box with dividers' : 'Glued dividers'}
    </button>
    <button class="small" class:on={trays} disabled={!traysAllowed} onclick={() => setJoin(layer, node, 'trays', project.material.thickness)}>
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

{#if !trays}
  <div class="panel-section">
    <h2>Divider materials</h2>
    {#if project.material.secondaryThickness !== undefined}
      {#each node.children.slice(0, -1) as child, i (child.node.id)}
        <div class="divider-material" class:current={dividerIndex === i}>
          <div class="divider-name">Between {partLabel(i)} and {partLabel(i + 1)}{dividerIndex === i ? ' · selected' : ''}</div>
          <label class="check">
            <input
              type="checkbox"
              checked={!!child.secondaryDivider}
              aria-label="Use secondary material for divider between {partLabel(i)} and {partLabel(i + 1)}"
              onchange={(e) => setDividerSecondary(node, i, e.currentTarget.checked)}
            />
            Use secondary material
          </label>
          <p class="hint">{materialLabel(dividerMaterial(project, node, i), dividerThickness(project, node, i))}</p>
        </div>
      {/each}
      <p class="hint">Each divider uses its selected thickness. Flexible compartments share the space left; locked sizes stay fixed.</p>
    {:else}
      <p class="hint">Enable Secondary Material in Material to choose it for individual dividers.</p>
    {/if}
  </div>
{/if}

<div class="panel-section">
  <h2>Parts</h2>
  {#each node.children as child, i (child.node.id)}
    <div class="part" class:off={off.includes(i)}>
      <NumberField
        label={partLabel(i)}
        value={split.childSizes[i]}
        min={5}
        hint={off.includes(i) ? `Not a multiple of the ${mm2(step)} mm rounding step` : ''}
        onchange={(v) => lockChild(node, i, v, split.childSizes)}
      />
      <LockButton split={node} index={i} sizes={split.childSizes} />
    </div>
  {/each}
  {#if off.length}
    <div class="issue warn off-step">
      <p>
        {off.length === node.children.length ? 'Every part is' : `${off.map(partLabel).join(', ')} ${off.length === 1 ? 'is' : 'are'}`}
        {offSizes.join(' and ')} mm, off the {mm2(step)} mm step that cut sizes are rounded to (Material, Round sizes to). Pieces sized from {off.length === 1
          ? 'it'
          : 'them'} can come out up to {mm2(step / 2)} mm off.
      </p>
      <button class="small" onclick={() => roundParts(node, split.childSizes, step)} data-tip="Lock each part to the nearest step; one part takes what is left"
        >Round to {mm2(step)} mm steps</button
      >
    </div>
  {/if}
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
  .divider-material {
    padding: 6px 8px;
    margin-bottom: 6px;
    border-left: 3px solid var(--line);
  }
  .divider-material.current {
    border-left-color: var(--accent);
    background: var(--accent-soft);
  }
  .divider-name {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
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
  .part.off :global(.label) {
    color: var(--warn);
  }
  .off-step p {
    margin: 0 0 6px;
  }
</style>
