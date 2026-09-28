<script lang="ts" module>
  /** Tray colours for the session: a tray keeps its colour while other trays come and go. */
  const trayColors = new Map<string, number>();
</script>

<script lang="ts">
  import type { Solved } from '../../core/layout';
  import { buildScene } from '../../core/scene';
  import type { Project } from '../../core/types';
  import { studio, type ViewStyle } from '../state.svelte';
  import type { Preset, TrayStyle } from './meshes';
  import Viewer3D from './Viewer3D.svelte';

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

  const layersTopFirst = $derived([...model.layers].reverse());
</script>

<div class="view3d" class:full={!v.panel}>
  <div class="stage">
    <Viewer3D bind:this={viewer} {model} {styleOf} outer={v.outer} ortho={v.ortho} />
    <div class="hint">Drag to rotate · scroll or pinch to zoom</div>
    {#if !v.panel}
      <button class="small show-tools" onclick={() => (v.panel = true)}>Show tools</button>
    {/if}
  </div>

  {#if v.panel}
    <aside class="panel">
      <div class="panel-section head">
        <h2>3D view</h2>
        <button class="small" onclick={() => (v.panel = false)} title="Hide this panel and show the model in full">Hide tools</button>
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
        <div class="row gap">
          {#each STYLES as s (s.value)}
            <button class="small" class:on={v.style === s.value} onclick={() => (v.style = s.value)}>{s.name}</button>
          {/each}
        </div>
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
            <button class="eye" onclick={() => toggle(v.hiddenLayers, layer.id)} aria-label="{layerHidden ? 'Show' : 'Hide'} {layer.name}" title={layerHidden ? 'Show layer' : 'Hide layer'}>
              {layerHidden ? '◌' : '●'}
            </button>
            <b>{layer.name}</b>
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
              <label class="pick" title="Highlight: draw this tray solid">
                <input type="checkbox" checked={v.highlighted.includes(t.key)} onchange={() => toggle(v.highlighted, t.key)} />
                <span class="swatch" style:background={t.color}></span>
                <span class="name">{t.label}</span>
                <span class="muted detail">{t.detail}</span>
              </label>
              <button class="eye" onclick={() => toggle(v.hiddenTrays, t.key)} aria-label="{hidden ? 'Show' : 'Hide'} {t.label}" title={hidden ? 'Show' : 'Hide'}>
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
  .detail {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
