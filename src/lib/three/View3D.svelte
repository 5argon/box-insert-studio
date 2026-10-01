<script lang="ts">
  import type { Solved } from '../../core/layout';
  import { buildScene } from '../../core/scene';
  import type { Project } from '../../core/types';
  import { studio, type ViewStyle } from '../state.svelte';
  import { isDark } from '../theme.svelte';
  import type { Preset, TrayStyle } from './meshes';
  import Viewer3D from './Viewer3D.svelte';
  import { trayColors } from '../trayColors';
  import CompSquare from '../CompSquare.svelte';
  import LayerIcon from '../LayerIcon.svelte';
  import { layerColor } from '../../core/defaults';

  let { project, solved }: { project: Project; solved: Solved } = $props();

  const v = studio.view3d;
  const model = $derived(buildScene(project, solved, trayColors));
  let hoverKey = $state<string | null>(null);
  let viewer: Viewer3D | undefined = $state();

  /** Hidden layers and trays disappear; highlighted (or hovered) trays are solid; the rest use the chosen style. */
  const styleOf = $derived.by(() => {
    const highlighted = new Set(v.highlighted);
    const hiddenTrays = new Set(v.hiddenTrays);
    const hiddenLayers = new Set(v.hiddenLayers);
    const style = v.style;
    const hover = hoverKey;
    return (key: string, layerId: string): TrayStyle =>
      hiddenLayers.has(layerId) || hiddenTrays.has(key) ? 'hidden' : key === hover || highlighted.has(key) ? 'solid' : style;
  });

  function toggle(list: string[], key: string) {
    const i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1);
    else list.push(key);
  }

  const STYLES: { value: ViewStyle; name: string }[] = [
    { value: 'wire', name: 'Wireframe' },
    { value: 'glass', name: 'See-through' },
    { value: 'solid', name: 'Solid' },
  ];
  const PRESETS: { value: Preset; name: string }[] = [
    { value: 'iso', name: '3/4' },
    { value: 'top', name: 'Top' },
    { value: 'front', name: 'Front' },
    { value: 'side', name: 'Side' },
  ];

  /** Compartments with simulated items (a stacked box's pair counts once). */
  const simulated = $derived(new Set(model.trays.flatMap((t) => t.items.map((r) => r.compartmentId))).size);

  const layersTopFirst = $derived([...model.layers].reverse());
  const multiLayer = $derived(model.layers.length > 1);
  const layerIndex = (id: string) => model.layers.findIndex((l) => l.id === id);

  /** Compartments in a tray; the upper box of a stack shows the ones of the box below it. */
  function compartmentsOf(trayId: string) {
    const tray = solved.trays.find((t) => t.id === trayId);
    const source = tray?.copyOf ?? trayId;
    return solved.compartments.filter((c) => c.trayId === source);
  }
</script>

<div class="view3d" class:full={!v.panel}>
  <div class="stage">
    <Viewer3D bind:this={viewer} {model} {styleOf} outer={v.outer} ortho={v.ortho} dark={isDark()} items={v.items} glass={v.glass} />
    <div class="hint">Drag to rotate · scroll or pinch to zoom</div>
    {#if !v.panel}
      <button class="small show-tools" onclick={() => (v.panel = true)}>Show tools</button>
    {/if}
  </div>

  {#if v.panel}
    <aside class="panel">
      <div class="panel-section head">
        <h2>3D view</h2>
        <button class="small" onclick={() => (v.panel = false)} data-tip="Hide this panel and show the model in full">Hide tools</button>
      </div>

      <div class="panel-section">
        <h2>Camera</h2>
        <div class="row">
          {#each PRESETS as p (p.value)}
            <button class="small" onclick={() => viewer?.preset(p.value)}>{p.name}</button>
          {/each}
        </div>
        <div class="row gap">
          <button class="small" class:on={!v.ortho} onclick={() => (v.ortho = false)}>Perspective</button>
          <button class="small" class:on={v.ortho} onclick={() => (v.ortho = true)}>Orthographic</button>
        </div>
        <p class="hint-text">Orthographic top view matches the layout editor exactly.</p>
      </div>

      <div class="panel-section">
        <h2>Style</h2>
        <label class="check"><input type="checkbox" bind:checked={v.outer} /> Game box outline</label>
        <label class="check" data-tip={simulated ? '' : 'Turn on item simulation for a compartment in the layout inspector'}>
          <input type="checkbox" bind:checked={v.items} disabled={!simulated} />
          Simulate items
        </label>
        <div class="row gap">
          {#each STYLES as s (s.value)}
            <button class="small" class:on={v.style === s.value} onclick={() => (v.style = s.value)}>{s.name}</button>
          {/each}
        </div>
        {#if v.style === 'glass'}
          <label class="slider">
            <span>Translucency</span>
            <input
              type="range"
              min="0.05"
              max="0.95"
              step="0.01"
              value={1 - v.glass}
              oninput={(e) => (v.glass = 1 - e.currentTarget.valueAsNumber)}
              aria-label="Translucency"
            />
            <span class="muted">{Math.round((1 - v.glass) * 100)}%</span>
          </label>
        {/if}
        <p class="hint-text">Trays you highlight below are solid; the rest use this style.</p>
      </div>

      <div class="panel-section">
        <div class="list-head">
          <h2>Trays</h2>
          <button class="link" onclick={() => (v.highlighted = [])} disabled={!v.highlighted.length}>Clear highlights</button>
          <button class="link" onclick={() => ((v.hiddenTrays = []), (v.hiddenLayers = []))} disabled={!v.hiddenTrays.length && !v.hiddenLayers.length}>
            Show all
          </button>
        </div>
        {#each layersTopFirst as layer (layer.id)}
          {@const layerHidden = v.hiddenLayers.includes(layer.id)}
          <div class="layer" class:off={layerHidden}>
            <button class="eye" onclick={() => toggle(v.hiddenLayers, layer.id)} aria-label="{layerHidden ? 'Show' : 'Hide'} {layer.name}" data-tip={layerHidden ? 'Show layer' : 'Hide layer'}>
              {layerHidden ? '◌' : '●'}
            </button>
            {#if multiLayer}<LayerIcon color={layerColor(layerIndex(layer.id))} size={13} />{/if}
            <b>{multiLayer ? layer.name : 'Layer'}</b>
            <span class="muted">{layer.height} mm</span>
          </div>
          {#each model.trays.filter((t) => t.layerId === layer.id) as t (t.key)}
            {@const hidden = v.hiddenTrays.includes(t.key)}
            <div
              class="tray"
              class:nested={t.depth === 1}
              class:off={hidden || layerHidden}
              onmouseenter={() => (hoverKey = t.key)}
              onmouseleave={() => (hoverKey = null)}
              role="listitem"
            >
              <label class="pick" data-tip="Highlight: draw this tray solid">
                <input type="checkbox" checked={v.highlighted.includes(t.key)} onchange={() => toggle(v.highlighted, t.key)} />
                <span class="swatch" style:background={t.color}></span>
                <span class="name">{t.label}</span>
                <span class="comps">
                  {#each compartmentsOf(t.id) as c (c.id)}
                    <CompSquare {c} size="sm" />
                  {/each}
                </span>
              </label>
              <button class="eye" onclick={() => toggle(v.hiddenTrays, t.key)} aria-label="{hidden ? 'Show' : 'Hide'} {t.label}" data-tip={hidden ? 'Show' : 'Hide'}>
                {hidden ? '◌' : '●'}
              </button>
            </div>
          {/each}
        {/each}
      </div>
    </aside>
  {/if}
</div>

<style>
  .view3d {
    display: grid;
    grid-template-columns: 1fr 320px;
    height: 100%;
    min-height: 0;
  }
  .view3d.full {
    grid-template-columns: 1fr;
  }
  .stage {
    position: relative;
    min-width: 0;
    min-height: 0;
    background: var(--bg);
  }
  .hint {
    position: absolute;
    left: 14px;
    bottom: 10px;
    font-size: 12px;
    color: var(--muted);
    pointer-events: none;
  }
  .show-tools {
    position: absolute;
    top: 12px;
    right: 12px;
  }
  .panel {
    background: var(--panel);
    border-left: 1px solid var(--line);
    overflow-y: auto;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .head h2 {
    margin: 0;
  }
  .gap {
    margin-top: 6px;
  }
  .hint-text {
    color: var(--muted);
    font-size: 12px;
    margin: 6px 0 0;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 8px;
  }
  .slider {
    display: grid;
    grid-template-columns: auto 1fr 36px;
    gap: 8px;
    align-items: center;
    margin-top: 10px;
  }
  .slider .muted {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .list-head {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }
  .list-head h2 {
    margin-right: auto;
  }
  .link {
    border: none;
    padding: 0;
    background: none;
    color: var(--accent);
    font-size: 12px;
  }
  .layer {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin: 10px 0 4px;
  }
  .tray {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border-radius: var(--radius);
  }
  .tray:hover {
    background: var(--accent-soft);
  }
  .tray.nested {
    margin-left: 18px;
  }
  .off {
    opacity: 0.45;
  }
  .pick {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    flex: none;
  }
  .name {
    white-space: nowrap;
  }
  .comps {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    min-width: 0;
  }
  .muted {
    color: var(--muted);
  }
  .eye {
    border: none;
    background: none;
    padding: 0 4px;
    color: var(--muted);
    font-size: 12px;
  }
</style>
