<script lang="ts">
  import { SECONDARY_THICKNESS_PRESETS, SHEET_PRESETS, THICKNESS_PRESETS, layerColor, newLayer } from '../core/defaults';
  import { setLayerBaseSecondary, setSecondarySheet, setSecondaryThickness, setConstruction, setCutLayout } from '../core/edit';
  import { cutPacking, CUT_LAYOUTS } from '../core/pieces';
  import type { CutLayout } from '../core/types';
  import { mm } from '../core/geom';
  import { baseThickness, LOWERED_DEFAULT, type Solved } from '../core/layout';
  import type { Project } from '../core/types';
  import LayerIcon from './LayerIcon.svelte';
  import NotchFields from './NotchFields.svelte';
  import NumberField from './NumberField.svelte';
  import NumberInput from './NumberInput.svelte';
  import ReadmeDialog from './ReadmeDialog.svelte';
  import { studio } from './state.svelte';

  let { project, solved }: { project: Project; solved: Solved } = $props();

  const T = $derived(project.material.thickness);
  const separate = $derived(project.construction === 'separate');
  const B = $derived(baseThickness(project));
  const secondary = $derived(project.material.secondaryThickness !== undefined);
  /** Starting value: the thickest preset thinner than the walls. */
  const thinner = $derived(SECONDARY_THICKNESS_PRESETS.filter((t) => t < T).pop() ?? T);
  let readme: ReadmeDialog | undefined = $state();
  /** First line of the readme, without Markdown marks, as a reminder of what it says. */
  const readmeTitle = $derived(
    (project.readme ?? '')
      .split('\n')
      .map((l) => l.replace(/^[#>\-*\s]+/, '').replace(/[*_`]/g, '').trim())
      .find((l) => l.length > 0) ?? '',
  );

  function chooseSheet(e: Event & { currentTarget: HTMLSelectElement }) {
    const p = SHEET_PRESETS.find((x) => x.preset === e.currentTarget.value);
    project.material.sheet = p ? { ...p } : { ...project.material.sheet, preset: 'Custom' };
  }

  /** The secondary material's own sheet, or the primary's when "Same as primary" is chosen. */
  function chooseSecondarySheet(e: Event & { currentTarget: HTMLSelectElement }) {
    const value = e.currentTarget.value;
    const p = SHEET_PRESETS.find((x) => x.preset === value);
    if (!value) setSecondarySheet(project, undefined);
    else setSecondarySheet(project, p ?? { ...(project.material.secondarySheet ?? project.material.sheet), preset: 'Custom' });
  }

  function chooseLayer(id: string) {
    if (studio.layerId === id) return;
    studio.layerId = id;
    studio.selection = [];
  }

  function addLayer() {
    const room = Math.max(10, Math.floor(solved.headroom));
    const layer = newLayer(`Layer ${project.layers.length + 1}`, Math.min(30, room));
    project.layers.push(layer);
    chooseLayer(layer.id);
  }

  function removeLayer(id: string) {
    if (project.layers.length <= 1) return;
    project.layers = project.layers.filter((l) => l.id !== id);
    if (studio.layerId === id) studio.layerId = project.layers[project.layers.length - 1].id;
    studio.selection = [];
  }
</script>

<div class="panel-section">
  <h2>Project</h2>
  <input class="name" bind:value={project.name} aria-label="Project name" />
  <div class="readme-row">
    <button class="small" onclick={() => readme?.open()} data-tip="Notes for this project in Markdown, printed at the top of the export">
      {readmeTitle ? 'Edit readme' : 'Add readme'}
    </button>
    {#if readmeTitle}<span class="hint readme-peek">{readmeTitle}</span>{/if}
  </div>
</div>
<ReadmeDialog bind:this={readme} {project} {solved} />

<div class="panel-section">
  <h2>Box inside</h2>
  <NumberField label="Width" value={project.box.width} min={20} onchange={(v) => (project.box.width = v)} />
  <NumberField label="Depth" value={project.box.depth} min={20} onchange={(v) => (project.box.depth = v)} />
  <NumberField label="Height" value={project.box.height} min={5} onchange={(v) => (project.box.height = v)} />
  <NumberField
    label="Clearance"
    value={project.clearance}
    min={0}
    step={0.5}
    hint="Total gap between a tray and the box or its neighbours, so it drops in without jamming"
    onchange={(v) => (project.clearance = v)}
  />
</div>

<div class="panel-section">
  <h2>Material</h2>
  <div class="field">
    <span>Thickness</span>
    <span class="row">
      {#each THICKNESS_PRESETS as t (t)}
        <button class="small" class:on={project.material.thickness === t} onclick={() => (project.material.thickness = t)}>{t}</button>
      {/each}
      <span class="thick"><NumberInput value={project.material.thickness} min={1} max={20} label="Material thickness" onchange={(v) => (project.material.thickness = v)} /></span>
    </span>
  </div>
  <label class="check" data-tip="Add another sheet thickness to use for bases, lids or individual dividers">
    <input type="checkbox" checked={secondary} onchange={(e) => setSecondaryThickness(project, e.currentTarget.checked ? thinner : undefined)} />
    Secondary material
  </label>
  {#if secondary}
    <div class="field">
      <span>Secondary</span>
      <span class="row">
        {#each SECONDARY_THICKNESS_PRESETS as t (t)}
          <button class="small" class:on={project.material.secondaryThickness === t} onclick={() => setSecondaryThickness(project, t)}>{t}</button>
        {/each}
        <span class="thick"><NumberInput value={project.material.secondaryThickness ?? T} min={0.5} max={20} label="Secondary material thickness" onchange={(v) => setSecondaryThickness(project, v)} /></span>
      </span>
    </div>
    <p class="hint">Choose where to use it in Layers, Removable box or Divider materials. Each material gets its own cutting sheets.</p>
  {/if}
  <label class="field">
    <span>Sheet{#if secondary}<small class="packing-material">Primary</small>{/if}</span>
    <select aria-label="Primary material sheet" value={project.material.sheet.preset} onchange={chooseSheet}>
      {#each SHEET_PRESETS as s (s.preset)}
        <option value={s.preset}>{s.preset} ({s.width} × {s.height})</option>
      {/each}
      <option value="Custom">Custom</option>
    </select>
  </label>
  {#if project.material.sheet.preset === 'Custom'}
    <NumberField label="Sheet width" value={project.material.sheet.width} min={50} onchange={(v) => (project.material.sheet.width = v)} />
    <NumberField label="Sheet height" value={project.material.sheet.height} min={50} onchange={(v) => (project.material.sheet.height = v)} />
  {/if}
  {#if secondary}
    {@const own = project.material.secondarySheet}
    <label class="field" data-tip="The secondary material's sheet size, when it comes in a different size from the primary, e.g. in bulk">
      <span>Sheet<small class="packing-material">Secondary</small></span>
      <select aria-label="Secondary material sheet" value={own?.preset ?? ''} onchange={chooseSecondarySheet}>
        <option value="">Same as primary</option>
        {#each SHEET_PRESETS as s (s.preset)}
          <option value={s.preset}>{s.preset} ({s.width} × {s.height})</option>
        {/each}
        <option value="Custom">Custom</option>
      </select>
    </label>
    {#if own?.preset === 'Custom'}
      <NumberField label="Secondary sheet width" value={own.width} min={50} onchange={(v) => (own.width = v)} />
      <NumberField label="Secondary sheet height" value={own.height} min={50} onchange={(v) => (own.height = v)} />
    {/if}
  {/if}
  <label class="field" data-tip="How primary material pieces are packed onto sheets. The cut list page compares each packing choice's sheet count.">
    <span>Packing{#if secondary}<small class="packing-material">Primary</small>{/if}</span>
    <select aria-label="Primary material packing" value={cutPacking(project, 'primary')} onchange={(e) => setCutLayout(project, e.currentTarget.value as CutLayout)}>
      {#each CUT_LAYOUTS as l (l.value)}
        <option value={l.value}>{l.name}</option>
      {/each}
    </select>
  </label>
  {#if secondary}
    <label class="field" data-tip="How secondary material pieces are packed onto their own sheets; independent of primary material packing.">
      <span>Packing<small class="packing-material">Secondary</small></span>
      <select aria-label="Secondary material packing" value={cutPacking(project, 'secondary')} onchange={(e) => setCutLayout(project, e.currentTarget.value as CutLayout, 'secondary')}>
        {#each CUT_LAYOUTS as l (l.value)}
          <option value={l.value}>{l.name}</option>
        {/each}
      </select>
    </label>
  {/if}
  <NumberField label="Edge trim" value={project.material.trim} min={0} hint="Unusable edge cut off each side of a sheet" onchange={(v) => (project.material.trim = v)} />
  <NumberField label="Kerf" value={project.material.kerf} min={0} step={0.1} hint="Material lost per cut" onchange={(v) => (project.material.kerf = v)} />
  <NumberField
    label="Round sizes to"
    value={project.precision}
    min={0.1}
    max={5}
    step={0.5}
    hint="Pieces within this step become one cut size"
    onchange={(v) => (project.precision = v)}
  />
</div>

<div class="panel-section">
  <h2>Layers</h2>
  {#if project.layers.length === 1}
    {@const only = project.layers[0]}
    <NumberField
      label="Height"
      value={only.height}
      min={5}
      hint="Height of the tray from the bottom of its base to the top of its walls"
      onchange={(v) => (only.height = v)}
    />
    <p class="hint">Includes the {mm(B)} mm base.</p>
  {:else}
    {#each project.layers as layer, i (layer.id)}
      {@const current = layer.id === studio.layerId}
      <div
        class="layer"
        class:current
        role="button"
        tabindex="0"
        aria-pressed={current}
        data-tip={current ? 'The layer being edited' : 'Click to edit this layer'}
        onclick={() => chooseLayer(layer.id)}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && chooseLayer(layer.id)}
      >
        <LayerIcon color={layerColor(i)} size={14} />
        <div class="name-wrap">
          <input bind:value={layer.name} aria-label="Layer name" onfocus={() => chooseLayer(layer.id)} />
          {#if i === 0}<span class="pos">Bottom</span>{:else if i === project.layers.length - 1}<span class="pos">Top</span>{/if}
        </div>
        <NumberInput value={layer.height} min={5} label="{layer.name} height" onchange={(v) => (layer.height = v)} />
        <span class="unit">mm</span>
        <button class="small" onclick={(e) => (e.stopPropagation(), removeLayer(layer.id))} aria-label="Remove {layer.name}" data-tip="Remove this layer">✕</button>
      </div>
    {/each}
    <p class="hint">Heights include each layer's {mm(B)} mm base.</p>
  {/if}
  {#if secondary}
    <label class="check layer-base" data-tip="Cut every layer's base from the secondary material">
      <input type="checkbox" checked={!!project.secondaryBase} onchange={(e) => setLayerBaseSecondary(project, e.currentTarget.checked)} />
      Use secondary material for bases
    </label>
    <p class="hint">
      Bases use {project.secondaryBase ? 'secondary' : 'primary'} material ({mm(B)} mm). Changing their thickness moves each layer's height by the difference,
      so compartments keep their depth and the headroom changes instead.
    </p>
  {/if}
  <button class="small add" onclick={addLayer}>Add layer on top</button>
  <p class="headroom" class:bad={solved.headroom < 0} data-tip="Space left above the trays, for the board and rulebook">
    {#if solved.headroom >= 0}
      Headroom: <b>{mm(solved.headroom)} mm</b>
    {:else}
      Headroom: <b>{mm(solved.headroom)} mm</b>, the trays are taller than the box
    {/if}
  </p>
</div>

<div class="panel-section">
  <h2>Construction</h2>
  <div class="choice">
    <span>Compartments</span>
    <div class="row">
      <button class="small" class:on={!separate} onclick={() => setConstruction(project, 'glued')} data-tip="Each layer is one tray; splitting a compartment adds a glued divider"
        >Glued tray</button
      >
      <button class="small" class:on={separate} onclick={() => setConstruction(project, 'separate')} data-tip="Every compartment is its own tray that lifts out on its own"
        >Separate trays</button
      >
    </div>
    <p class="hint">
      {#if separate}
        Every compartment is its own tray, {mm(project.clearance)} mm apart, so each lifts out on its own. They only fit back one way: the printout's Placement page
        shows it. A compartment can still hold a removable box.
      {:else}
        Each layer is one glued tray. You can still make any split separate trays.
      {/if}
    </p>
  </div>
  <div class="choice">
    <span>Base</span>
    <div class="row">
      <button class="small" class:on={project.base === 'under'} onclick={() => (project.base = 'under')}>Walls on base</button>
      <button class="small" class:on={project.base === 'inside'} onclick={() => (project.base = 'inside')}>Base inside walls</button>
    </div>
  </div>
  <div class="choice">
    <span>Full-length walls</span>
    <div class="row">
      <button class="small" class:on={project.fullWalls === 'x'} onclick={() => (project.fullWalls = 'x')}>Back &amp; front</button>
      <button class="small" class:on={project.fullWalls === 'y'} onclick={() => (project.fullWalls = 'y')}>Left &amp; right</button>
    </div>
  </div>
  <h2 class="sub">Finger notch</h2>
  <NotchFields size={project.notch} />
  <h2 class="sub">Lowered sides</h2>
  <NumberField
    label="Height"
    unit="%"
    value={project.lowered ?? LOWERED_DEFAULT}
    min={10}
    max={95}
    step={5}
    decimals={0}
    hint="How tall a lowered side stands, as a share of its compartment's depth"
    onchange={(v) => (project.lowered = v)}
  />
</div>

{#if solved.issues.length}
  <div class="panel-section">
    <h2>Problems</h2>
    {#each solved.issues as issue, i (i)}
      <div class="issue {issue.level}">{issue.message}</div>
    {/each}
  </div>
{/if}

<style>
  .name {
    width: 100%;
    font-weight: 600;
  }
  .readme-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
    min-width: 0;
  }
  .readme-row button {
    white-space: nowrap;
    flex: none;
  }
  .readme-peek {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .field {
    display: grid;
    grid-template-columns: 70px 1fr;
    align-items: center;
    gap: 6px;
    margin: 4px 0;
  }
  .thick {
    width: 56px;
  }
  .packing-material {
    display: block;
    color: var(--muted);
    font-size: 10px;
  }
  .layer-base {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 10px 0 2px;
  }

  .layer {
    display: grid;
    grid-template-columns: 14px 1fr 58px 22px 26px;
    gap: 6px;
    align-items: center;
    margin-bottom: 4px;
    padding: 4px 5px;
    border-radius: var(--radius);
    border: 1px solid transparent;
    cursor: pointer;
  }
  .layer:hover {
    border-color: var(--line-strong);
  }
  .layer.current {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .name-wrap {
    display: grid;
    min-width: 0;
  }
  .pos {
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: 1px;
  }
  .add {
    margin-top: 4px;
  }
  .headroom {
    margin: 10px 0 0;
  }
  .unit {
    color: var(--muted);
    font-size: 12px;
  }
  .choice {
    margin: 6px 0 10px;
  }
  .choice > span {
    display: block;
    margin-bottom: 4px;
  }
  .sub {
    margin-top: 12px;
  }
  .hint {
    margin: 6px 0 0;
  }
  .bad {
    color: var(--error);
  }
</style>
