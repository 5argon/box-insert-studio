<script lang="ts">
  import { blankProject, defaultProject, migrateProject } from './core/defaults';
  import { solveProject } from './core/layout';
  import { buildCutList, planCuts } from './core/pieces';
  import type { Project } from './core/types';
  import BoxPanel from './lib/BoxPanel.svelte';
  import CompLabel from './lib/CompLabel.svelte';
  import LayoutCanvas from './lib/LayoutCanvas.svelte';
  import PiecesBar from './lib/PiecesBar.svelte';
  import Report from './lib/Report.svelte';
  import SectionInspector from './lib/SectionInspector.svelte';
  import SplitInspector from './lib/SplitInspector.svelte';
  import { breakStep, recordProject, redo, undo, undoState } from './lib/history.svelte';
  import { download, persist, replaceProject, slug, studio, type Selection } from './lib/state.svelte';

  const solved = $derived(solveProject(studio.project));
  const cut = $derived(buildCutList(solved, studio.project.precision));
  const plan = $derived(planCuts(studio.project, cut));

  $effect(() => {
    const snapshot = $state.snapshot(studio.project) as Project;
    const id = setTimeout(() => persist(snapshot), 300);
    return () => clearTimeout(id);
  });

  // Every change to the project goes into the undo history.
  $effect(() => {
    recordProject(JSON.stringify($state.snapshot(studio.project)));
  });

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const undoKeys = mac ? '⌘Z' : 'Ctrl+Z';
  const redoKeys = mac ? '⇧⌘Z' : 'Ctrl+Y';

  /** ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redo. Text fields keep their own undo. */
  function keydown(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const target = e.target as HTMLElement | null;
    const typing = target?.closest('textarea, select, [contenteditable="true"]') || (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type));
    if (typing) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      redo();
    }
  }

  const layer = $derived(studio.project.layers.find((l) => l.id === studio.layerId) ?? studio.project.layers[studio.project.layers.length - 1]);
  const solvedLayer = $derived(solved.layers.find((l) => l.layer.id === layer.id)!);
  const selectedCompartment = $derived(
    studio.selected?.kind === 'section' ? solvedLayer.compartments.find((c) => c.id === studio.selected?.id) : undefined,
  );
  const selectedSplit = $derived(studio.selected?.kind === 'split' ? solvedLayer.splits.find((s) => s.id === studio.selected?.id) : undefined);
  const errorCount = $derived(
    [...solved.issues, ...solved.layers.flatMap((l) => l.issues), ...plan.issues].filter((i) => i.level === 'error').length +
      solved.compartments.reduce((a, c) => a + c.issues.filter((i) => i.level === 'error').length, 0),
  );

  function select(sel: Selection) {
    studio.selected = sel;
  }

  function chooseLayer(id: string) {
    studio.layerId = id;
    studio.selected = null;
  }

  function newProject() {
    if (confirm('Start a new, empty insert for this box size? Unsaved changes will be lost.')) replaceProject(blankProject($state.snapshot(studio.project) as Project));
  }

  function loadExample() {
    if (confirm('Load the example DOOM insert? Unsaved changes will be lost.')) replaceProject(defaultProject());
  }

  function save() {
    download(`${slug(studio.project.name)}.insert.json`, JSON.stringify($state.snapshot(studio.project), null, 2), 'application/json');
  }

  async function open(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      const p = migrateProject(JSON.parse(await file.text()));
      if (!p) throw new Error('not a Box Insert Studio project');
      replaceProject(p);
    } catch (err) {
      alert(`Could not open ${file.name}: ${(err as Error).message}`);
    }
  }
</script>

<svelte:window onkeydown={keydown} onpointerdowncapture={breakStep} />

<div class="app">
  <header class="no-print">
    <div class="brand">Box Insert Studio</div>
    <nav>
      <button class:on={studio.view === 'layout'} onclick={() => (studio.view = 'layout')}>1 · Layout</button>
      <button class:on={studio.view === '3d'} onclick={() => (studio.view = '3d')}>2 · 3D view</button>
      <button class:on={studio.view === 'report'} onclick={() => (studio.view = 'report')}>
        3 · Cut list &amp; assembly{errorCount ? ` (${errorCount} problem${errorCount === 1 ? '' : 's'})` : ''}
      </button>
    </nav>
    <div class="history">
      <button class="small" onclick={undo} disabled={!undoState.canUndo} title="Undo ({undoKeys})" aria-label="Undo">↶ Undo</button>
      <button class="small" onclick={redo} disabled={!undoState.canRedo} title="Redo ({redoKeys})" aria-label="Redo">↷ Redo</button>
    </div>
    <div class="file">
      <a class="credit" href="https://github.com/5argon/box-insert-studio" target="_blank" rel="noopener">Source · CC BY 4.0</a>
      <button class="small" onclick={newProject} title="Empty insert, keeping the box size and material settings">New</button>
      <button class="small" onclick={loadExample} title="The DOOM example insert">Example</button>
      <label class="small open">Open<input type="file" accept=".json,application/json" onchange={open} /></label>
      <button class="small" onclick={save}>Save</button>
    </div>
  </header>

  {#if studio.view === 'layout'}
    <div class="layout">
      <aside class="left">
        <BoxPanel project={studio.project} {solved} />
      </aside>
      <main class="stage">
        <div class="tabs">
          {#each [...studio.project.layers].reverse() as l (l.id)}
            <button class:on={l.id === layer.id} onclick={() => chooseLayer(l.id)}>{l.name} · {l.height} mm</button>
          {/each}
          <span class="hint">Top layer first. Walls {solvedLayer.wallHeight} mm, dividers {layer.height - studio.project.material.thickness} mm tall.</span>
        </div>
        <div class="canvas-wrap">
          <LayoutCanvas
            project={studio.project}
            {layer}
            solved={solvedLayer}
            {cut}
            selected={studio.selected}
            hoverGroup={studio.hoverGroup}
            showNumbers={studio.showNumbers}
            onselect={select}
          />
        </div>
        <PiecesBar project={studio.project} {cut} {plan} layerId={layer.id} />
      </main>
      <aside class="right">
        {#if selectedCompartment}
          {#key selectedCompartment.id}
            <SectionInspector project={studio.project} {layer} {solved} {solvedLayer} {cut} compartment={selectedCompartment} onselect={select} />
          {/key}
        {:else if selectedSplit}
          <SplitInspector project={studio.project} {layer} {solvedLayer} split={selectedSplit} />
        {:else}
          <div class="panel-section">
            <h2>{layer.name}</h2>
            <p class="hint">Click a compartment to size it, add dividers or finger notches. Click or drag a divider to resize; it snaps to sizes already in use.</p>
            {#each solvedLayer.issues as issue, i (i)}
              <div class="issue {issue.level}">{issue.message}</div>
            {/each}
            {#each solvedLayer.compartments as c (c.id)}
              {@const errs = c.issues.filter((i) => i.level === 'error').length}
              <button class="list-item" class:nested={c.depth === 1} onclick={() => select({ kind: 'section', id: c.id })}>
                <b><CompLabel {c} /></b>
                <span>{Math.round(c.rect.w * 10) / 10} × {Math.round(c.rect.h * 10) / 10} × {Math.round(c.height * 10) / 10} mm</span>
                {#if c.node.insert && c.depth === 0}<span class="hint">box inside</span>{/if}
                {#if c.node.notches.length}<span class="hint">notch</span>{/if}
                {#if errs}<span class="bad">{errs} problem{errs === 1 ? '' : 's'}</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
      </aside>
    </div>
  {:else if studio.view === '3d'}
    <!-- Loaded on first use, so three.js stays out of the editor's initial download. -->
    {#await import('./lib/three/View3D.svelte')}
      <p class="loading">Loading 3D view…</p>
    {:then { default: View3D }}
      <View3D project={studio.project} {solved} />
    {:catch err}
      <p class="loading">Could not load the 3D view: {err.message}</p>
    {/await}
  {:else}
    <Report project={studio.project} {solved} {cut} {plan} />
  {/if}
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: 48px 1fr;
    height: 100vh;
  }
  header {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 0 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .brand {
    font-weight: 700;
    font-size: 15px;
  }
  nav {
    display: flex;
    gap: 6px;
  }
  .history {
    display: flex;
    gap: 6px;
  }
  .file {
    margin-left: auto;
    display: flex;
    gap: 6px;
  }
  .credit {
    align-self: center;
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
    margin-right: 6px;
  }
  .credit:hover {
    color: var(--accent);
  }
  .open {
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    padding: 2px 7px;
    font-size: 12px;
    cursor: pointer;
    background: var(--panel);
  }
  .open input {
    display: none;
  }
  .layout {
    display: grid;
    grid-template-columns: 290px 1fr 330px;
    min-height: 0;
  }
  .left,
  .right {
    background: var(--panel);
    overflow-y: auto;
  }
  .left {
    border-right: 1px solid var(--line);
  }
  .right {
    border-left: 1px solid var(--line);
  }
  .stage {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) 190px;
  }
  .tabs {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 10px 14px 0;
    flex-wrap: wrap;
  }
  .tabs .hint {
    margin-left: 6px;
  }
  .canvas-wrap {
    min-height: 0;
    padding: 12px 16px;
  }
  .loading {
    margin: 40px;
    color: var(--muted);
  }
  .list-item {
    display: flex;
    gap: 10px;
    width: 100%;
    text-align: left;
    margin-top: 6px;
  }
  .list-item.nested {
    width: calc(100% - 18px);
    margin-left: 18px;
  }
  .bad {
    color: var(--error);
    margin-left: auto;
  }

  @media print {
    .app {
      display: block;
      height: auto;
    }
    .no-print {
      display: none;
    }
    :global(body) {
      background: #fff;
    }
  }
</style>
