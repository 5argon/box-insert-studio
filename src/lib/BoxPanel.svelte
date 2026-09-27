<script lang="ts">
  import { SHEET_PRESETS, THICKNESS_PRESETS, newLayer } from '../core/defaults';
  import type { Solved } from '../core/layout';
  import type { Project } from '../core/types';
  import NumberField from './NumberField.svelte';
  import NumberInput from './NumberInput.svelte';
  import { studio } from './state.svelte';

  let { project, solved }: { project: Project; solved: Solved } = $props();

  function chooseSheet(e: Event & { currentTarget: HTMLSelectElement }) {
    const p = SHEET_PRESETS.find((x) => x.preset === e.currentTarget.value);
    project.foam.sheet = p ? { ...p } : { ...project.foam.sheet, preset: 'Custom' };
  }

  function addLayer() {
    const room = Math.max(10, Math.floor(solved.headroom));
    const layer = newLayer(`Layer ${project.layers.length + 1}`, Math.min(30, room));
    project.layers.push(layer);
    studio.layerId = layer.id;
    studio.selected = null;
  }

  function removeLayer(id: string) {
    if (project.layers.length <= 1) return;
    project.layers = project.layers.filter((l) => l.id !== id);
    if (studio.layerId === id) studio.layerId = project.layers[project.layers.length - 1].id;
    studio.selected = null;
  }
</script>

<div class="panel-section">
  <h2>Project</h2>
  <input class="name" bind:value={project.name} aria-label="Project name" />
</div>

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
    hint="Total gap between a tray and the box or its neighbours"
    onchange={(v) => (project.clearance = v)}
  />
</div>

<div class="panel-section">
  <h2>Layers (bottom first)</h2>
  {#each project.layers as layer (layer.id)}
    <div class="layer" class:current={layer.id === studio.layerId}>
      <input bind:value={layer.name} aria-label="Layer name" onfocus={() => (studio.layerId = layer.id)} />
      <NumberInput value={layer.height} min={5} label="{layer.name} height" onchange={(v) => (layer.height = v)} />
      <span class="unit">mm</span>
      <button class="small" onclick={() => removeLayer(layer.id)} disabled={project.layers.length <= 1} aria-label="Remove {layer.name}">✕</button>
    </div>
  {/each}
  <button class="small" onclick={addLayer}>Add layer on top</button>
  <p class="hint" class:bad={solved.headroom < 0}>
    {#if solved.headroom >= 0}
      {solved.headroom.toFixed(1)} mm left above for the board and rulebook.
    {:else}
      Layers are {(-solved.headroom).toFixed(1)} mm taller than the box.
    {/if}
  </p>
</div>

<div class="panel-section">
  <h2>Foam board</h2>
  <label class="field">
    <span>Thickness</span>
    <span class="row">
      {#each THICKNESS_PRESETS as t (t)}
        <button class="small" class:on={project.foam.thickness === t} onclick={() => (project.foam.thickness = t)}>{t}</button>
      {/each}
      <span class="thick"><NumberInput value={project.foam.thickness} min={1} max={20} label="Foam thickness" onchange={(v) => (project.foam.thickness = v)} /></span>
    </span>
  </label>
  <label class="field">
    <span>Sheet</span>
    <select value={project.foam.sheet.preset} onchange={chooseSheet}>
      {#each SHEET_PRESETS as s (s.preset)}
        <option value={s.preset}>{s.preset} ({s.width} × {s.height})</option>
      {/each}
      <option value="Custom">Custom</option>
    </select>
  </label>
  {#if project.foam.sheet.preset === 'Custom'}
    <NumberField label="Sheet width" value={project.foam.sheet.width} min={50} onchange={(v) => (project.foam.sheet.width = v)} />
    <NumberField label="Sheet height" value={project.foam.sheet.height} min={50} onchange={(v) => (project.foam.sheet.height = v)} />
  {/if}
  <NumberField label="Edge trim" value={project.foam.trim} min={0} hint="Damaged edge cut off each side of a sheet" onchange={(v) => (project.foam.trim = v)} />
  <NumberField label="Kerf" value={project.foam.kerf} min={0} step={0.1} hint="Material lost per cut" onchange={(v) => (project.foam.kerf = v)} />
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
  <h2>Construction</h2>
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
  <NumberField label="Width" value={project.notch.width} min={5} onchange={(v) => (project.notch.width = v)} />
  <NumberField label="Depth" value={project.notch.depth} min={2} onchange={(v) => (project.notch.depth = v)} />
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
  .layer {
    display: grid;
    grid-template-columns: 1fr 64px 24px 28px;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
    padding: 3px;
    border-radius: var(--radius);
  }
  .layer.current {
    background: var(--accent-soft);
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
