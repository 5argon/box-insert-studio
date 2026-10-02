<script lang="ts">
  import type { Solved } from '../core/layout';
  import { buildScene } from '../core/scene';
  import type { CutList } from '../core/pieces';
  import type { Project } from '../core/types';
  import { mm } from '../core/geom';
  import LayoutCanvas from './LayoutCanvas.svelte';
  import { trayColors } from './trayColors';

  let { project, solved, cut }: { project: Project; solved: Solved; cut: CutList } = $props();
  const model = $derived(buildScene(project, solved, trayColors));
</script>

<section class="overview" aria-label="Design overview">
  <h2>Design overview</h2>
  <div class="views">
    {#each solved.layers as solvedLayer, i (solvedLayer.layer.id)}
      <figure>
        <div class="plan">
          <LayoutCanvas {project} layer={solvedLayer.layer} solved={solvedLayer} {cut} readonly selected={null} hoverGroup={null} showNumbers={false} onselect={() => {}} />
        </div>
        <figcaption><b>{i + 1}. {solvedLayer.layer.name}</b> · {mm(solvedLayer.layer.height)} mm</figcaption>
      </figure>
    {/each}
    <figure>
      {#await import('./three/Thumbnail3D.svelte')}
        <div class="loading">Rendering 3D view…</div>
      {:then { default: Thumbnail3D }}
        <Thumbnail3D {model} dark={false} width={320} height={240} />
      {/await}
      <figcaption><b>Whole insert · 3D view</b></figcaption>
    </figure>
  </div>
  <p class="legend">Overhead plans show compartment letters with FRONT at the bottom. Diagonal stripes mark lids, spanning each box or the whole group according to its lid coverage. ² marks two stacked boxes; * marks a raised floor.</p>
</section>

<style>
  h2 {
    color: var(--text);
    font-size: 15px;
    text-transform: none;
    letter-spacing: 0;
    margin: 22px 0 8px;
    border-bottom: 1px solid var(--line);
    padding-bottom: 4px;
  }
  .views {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
    gap: 16px;
    align-items: start;
  }
  figure {
    margin: 0;
    min-width: 0;
    break-inside: avoid;
  }
  .plan {
    width: 100%;
    aspect-ratio: 1;
  }
  .loading {
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 4 / 3;
    color: var(--muted);
  }
  figcaption {
    margin-top: 6px;
    color: var(--muted);
    font-size: 11.5px;
  }
  .legend {
    color: var(--muted);
    font-size: 11.5px;
    margin: 10px 0 0;
  }
  @media print {
    .plan {
      max-height: 75mm;
    }
  }
</style>
