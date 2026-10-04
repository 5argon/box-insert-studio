<script lang="ts">
  import { mm } from '../core/geom';
  import type { Solved } from '../core/layout';
  import { buildCutList } from '../core/pieces';
  import { buildScene } from '../core/scene';
  import type { Project } from '../core/types';
  import LayoutCanvas from './LayoutCanvas.svelte';
  import { isDark } from './theme.svelte';
  import { trayColors } from './trayColors';

  /**
   * The project's Markdown readme, written beside the design it describes: the overhead plan of
   * each layer and a 3D view stay in view while the text scrolls, so compartments can be referred
   * to by letter as they are written about.
   */
  let { project, solved }: { project: Project; solved: Solved } = $props();
  let dialog: HTMLDialogElement;
  let text: HTMLTextAreaElement;
  /** The overview is drawn only while the dialog is open. */
  let shown = $state(false);

  const cut = $derived(shown ? buildCutList(solved, project.precision) : undefined);
  const model = $derived(shown ? buildScene(project, solved, trayColors) : undefined);
  const multi = $derived(solved.layers.length > 1);

  export function open() {
    shown = true;
    dialog.showModal();
    text.focus();
  }
</script>

<dialog bind:this={dialog} class="readme" aria-label="Project readme" onclose={() => (shown = false)}>
  <div class="top">
    <h2>Readme</h2>
    <span class="hint">Markdown: # headings, **bold**, - lists, | tables |, [links](https://…). Printed at the top of the cut list &amp; assembly export.</span>
    <button class="primary" onclick={() => dialog.close()}>Done</button>
  </div>
  <div class="body">
    <textarea
      bind:this={text}
      value={project.readme ?? ''}
      oninput={(e) => (project.readme = e.currentTarget.value)}
      placeholder={'# About this insert\n\nWhat goes where, which game version, anything to remember while building.'}
      spellcheck="true"
      aria-label="Readme in Markdown"
    ></textarea>
    <aside class="overview" aria-label="Design overview">
      {#if shown && cut && model}
        {#each solved.layers as solvedLayer, i (solvedLayer.layer.id)}
          <figure>
            <div class="plan">
              <LayoutCanvas {project} layer={solvedLayer.layer} solved={solvedLayer} {cut} readonly selection={[]} hoverGroup={null} showNumbers={false} onselect={() => {}} />
            </div>
            <figcaption>
              {#if multi}<b>{i + 1}. {solvedLayer.layer.name}</b> · {mm(solvedLayer.layer.height)} mm{:else}<b>Top view</b> · {mm(solvedLayer.layer.height)} mm tall{/if}
            </figcaption>
          </figure>
        {/each}
        <figure>
          {#await import('./three/Thumbnail3D.svelte')}
            <div class="loading">Rendering 3D view…</div>
          {:then { default: Thumbnail3D }}
            <Thumbnail3D {model} dark={isDark()} width={320} height={240} />
          {/await}
          <figcaption><b>Whole insert</b> · 3D view</figcaption>
        </figure>
      {/if}
    </aside>
  </div>
</dialog>

<style>
  .readme {
    width: min(1180px, 96vw);
    height: min(820px, 92vh);
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }
  .readme[open] {
    display: grid;
    grid-template-rows: auto 1fr;
  }
  .readme::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }
  .top {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }
  .top h2 {
    margin: 0;
  }
  .top .hint {
    flex: 1;
    font-size: 12px;
  }
  /* Two panes that scroll on their own: the plans stay put while the text scrolls. */
  .body {
    display: grid;
    grid-template-columns: 1fr 340px;
    min-height: 0;
  }
  textarea {
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--text);
    background: var(--input);
    border: none;
    border-radius: 0 0 0 10px;
    padding: 14px 16px;
    resize: none;
    outline: none;
    min-height: 0;
  }
  .overview {
    overflow-y: auto;
    padding: 12px 14px;
    border-left: 1px solid var(--line);
    min-height: 0;
  }
  figure {
    margin: 0 0 14px;
  }
  .plan {
    width: 100%;
    aspect-ratio: 1;
  }
  .loading {
    display: grid;
    place-items: center;
    aspect-ratio: 4 / 3;
    color: var(--muted);
  }
  figcaption {
    margin-top: 4px;
    color: var(--muted);
    font-size: 12px;
  }
  @media (max-width: 760px) {
    .body {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr 40%;
    }
    .overview {
      border-left: none;
      border-top: 1px solid var(--line);
    }
  }
</style>
