<script lang="ts">
  import { layerColor } from '../core/defaults';
  import type { Compartment, Solved } from '../core/layout';
  import { panelUse, sheetSummary, type CutList, type CutPlan, type PieceGroup } from '../core/pieces';
  import type { Project } from '../core/types';
  import CompSquare from './CompSquare.svelte';
  import LayerIcon from './LayerIcon.svelte';
  import { studio } from './state.svelte';

  let { project, solved, cut, plan, layerId }: { project: Project; solved: Solved; cut: CutList; plan: CutPlan; layerId: string } = $props();

  const total = $derived(cut.groups.reduce((a, g) => a + g.pieces.length, 0));
  const stripWidths = $derived(new Set(cut.groups.filter((g) => g.kind === 'strip').map((g) => g.height)).size);
  const multi = $derived(project.layers.length > 1);
  const here = $derived(cut.groups.filter((g) => g.pieces.some((p) => p.layerId === layerId)));
  const elsewhere = $derived(cut.groups.filter((g) => !g.pieces.some((p) => p.layerId === layerId)));

  const trayById = $derived(new Map(solved.trays.map((t) => [t.id, t])));
  const compById = $derived(new Map(solved.compartments.map((c) => [c.id, c])));

  /**
   * Where a group's pieces go: the compartment square for pieces of a removable box, otherwise
   * the layer's icon.
   */
  function owners(g: PieceGroup): ({ kind: 'box'; c: Compartment } | { kind: 'layer'; index: number; name: string })[] {
    const out = new Map<string, { kind: 'box'; c: Compartment } | { kind: 'layer'; index: number; name: string }>();
    for (const p of g.pieces) {
      const tray = trayById.get(p.trayId);
      const well = tray?.wellId ? compById.get(tray.wellId) : undefined;
      if (well) out.set(well.id, { kind: 'box', c: well });
      else {
        const index = project.layers.findIndex((l) => l.id === p.layerId);
        out.set(p.layerId, { kind: 'layer', index, name: project.layers[index]?.name ?? '' });
      }
    }
    return [...out.values()];
  }

  const tip = (g: PieceGroup) =>
    g.kind === 'base'
      ? `${g.pieces.length} × ${g.length} × ${g.height} mm ${panelUse(g)}${g.thickness !== project.material.thickness ? `, from ${g.thickness} mm sheet` : ''}`
      : `${g.pieces.length} piece${g.pieces.length === 1 ? '' : 's'}, ${g.length} mm long and ${g.height} mm tall${g.notches.length ? ', notched' : ''}. Hover to find them in the layout.`;
</script>

{#snippet chip(g: PieceGroup, other: boolean)}
  <button
    class="chip"
    class:other
    class:hot={studio.hoverGroup === g.number}
    onmouseenter={() => (studio.hoverGroup = g.number)}
    onmouseleave={() => (studio.hoverGroup = null)}
    onfocus={() => (studio.hoverGroup = g.number)}
    onblur={() => (studio.hoverGroup = null)}
    data-tip={tip(g)}
  >
    {#if other}
      <span class="owners">
        {#each owners(g) as o (o.kind === 'box' ? o.c.id : `l${o.index}`)}
          {#if o.kind === 'box'}<CompSquare c={o.c} size="sm" />{:else}<LayerIcon color={layerColor(o.index)} size={12} />{/if}
        {/each}
      </span>
    {/if}
    <span class="num">#{g.number}</span>
    <span class="qty">×{g.pieces.length}</span>
    <span class="size">{g.length}×{g.height}</span>
    {#if g.kind === 'base'}<span class="tag" class:own={g.thickness !== project.material.thickness}
        >{panelUse(g)}{g.thickness !== project.material.thickness ? ` ${g.thickness} mm` : ''}</span
      >{/if}
    {#if g.notches.length}<span class="tag notch">notch</span>{/if}
  </button>
{/snippet}

<div class="bar">
  <div class="summary">
    <h2>Cut list</h2>
    <span><b>{total}</b> pieces in <b>{cut.groups.length}</b> cut sizes · {stripWidths} strip width{stripWidths === 1 ? '' : 's'} · {sheetSummary(project, plan)} ({Math.round(plan.efficiency * 100)}% used)</span
    >
    <label class="toggle"><input type="checkbox" bind:checked={studio.showNumbers} /> Show piece numbers</label>
  </div>
  <div class="body">
    {#if multi}<div class="group-head">This layer</div>{/if}
    <div class="chips">
      {#each here as g (g.key)}
        {@render chip(g, false)}
      {/each}
    </div>
    {#if multi && elsewhere.length}
      <div class="group-head">Other layers only <span class="muted">· marked with where they go</span></div>
      <div class="chips">
        {#each elsewhere as g (g.key)}
          {@render chip(g, true)}
        {/each}
      </div>
    {/if}
    {#if cut.hints.length || plan.issues.length}
      <div class="hints">
        {#each [...plan.issues, ...cut.hints] as h, i (i)}
          <div class="issue {h.level}">{h.message}</div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  /* Fixed height (set by the parent grid row) with its own scrolling, so chips and hints
     coming and going never resize the canvas above. */
  .bar {
    border-top: 1px solid var(--line);
    background: var(--panel);
    padding: 10px 14px 0;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
    padding-bottom: 10px;
  }
  .summary {
    display: flex;
    gap: 6px;
    align-items: baseline;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .toggle {
    margin-left: auto;
    display: flex;
    gap: 4px;
    align-items: center;
    color: var(--muted);
    font-size: 12px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .chip {
    display: inline-flex;
    gap: 5px;
    align-items: baseline;
    padding: 2px 8px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .chip.other {
    border-style: dashed;
  }
  .owners {
    display: inline-flex;
    gap: 2px;
    align-items: center;
    align-self: center;
  }
  .summary h2 {
    margin: 0;
  }
  .group-head {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 6px 0 4px;
  }
  .group-head .muted {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }
  .chip.hot {
    border-color: var(--accent);
    background: var(--accent-soft);
    opacity: 1;
  }
  .num {
    font-weight: 700;
  }
  .qty {
    color: var(--muted);
  }
  .tag {
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
  }
  .tag.notch {
    color: var(--warn);
  }
  .tag.own {
    color: var(--accent);
    font-weight: 600;
  }
  .hints {
    margin-top: 4px;
  }
</style>
