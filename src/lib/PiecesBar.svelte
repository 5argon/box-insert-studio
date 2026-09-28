<script lang="ts">
  import { panelUse, type CutList, type CutPlan } from '../core/pieces';
  import type { Project } from '../core/types';
  import { studio } from './state.svelte';

  let { project, cut, plan, layerId }: { project: Project; cut: CutList; plan: CutPlan; layerId: string } = $props();

  const total = $derived(cut.groups.reduce((a, g) => a + g.pieces.length, 0));
  const stripWidths = $derived(new Set(cut.groups.filter((g) => g.kind === 'strip').map((g) => g.height)).size);
</script>

<div class="bar">
  <div class="summary">
    <b>{total}</b> pieces in <b>{cut.groups.length}</b> cut sizes · {stripWidths} strip width{stripWidths === 1 ? '' : 's'} ·
    <b>{plan.sheets.length}</b>
    {project.material.sheet.preset} sheet{plan.sheets.length === 1 ? '' : 's'} ({Math.round(plan.efficiency * 100)}% used)
    <label class="toggle"><input type="checkbox" bind:checked={studio.showNumbers} /> Show piece numbers</label>
  </div>
  <div class="body">
    <div class="chips">
      {#each cut.groups as g (g.key)}
        {@const here = g.pieces.filter((p) => p.layerId === layerId).length}
        <button
          class="chip"
          class:dim={here === 0}
          class:hot={studio.hoverGroup === g.number}
          onmouseenter={() => (studio.hoverGroup = g.number)}
          onmouseleave={() => (studio.hoverGroup = null)}
          onfocus={() => (studio.hoverGroup = g.number)}
          onblur={() => (studio.hoverGroup = null)}
          title={g.kind === 'base' ? `${g.pieces.length} × ${g.length} × ${g.height}: ${panelUse(g)}` : `${g.pieces.length} pieces ${g.length} long, ${g.height} tall${g.notches.length ? ', notched' : ''}`}
        >
          <span class="num">#{g.number}</span>
          <span class="qty">×{g.pieces.length}</span>
          <span class="size">{g.length}×{g.height}</span>
          {#if g.kind === 'base'}<span class="tag">{panelUse(g)}</span>{/if}
          {#if g.notches.length}<span class="tag notch">notch</span>{/if}
        </button>
      {/each}
    </div>
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
  .chip.dim {
    opacity: 0.5;
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
    color: #a26400;
  }
  .hints {
    margin-top: 4px;
  }
</style>
