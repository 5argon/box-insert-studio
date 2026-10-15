<script lang="ts">
  import { sharedLidInstructions, trayAssemblyPieces, trayInstructions, type Step } from '../core/assembly';
  import { NOTCH_BOTTOM_DEFAULT } from '../core/layout';
  import { lidNotchPoints, lidNotchText, lidOutline, polygonPath } from '../core/lidNotches';
  import { sectionColor, sectionInk, SHEET_PRESETS } from '../core/defaults';
  import { mm } from '../core/geom';
  import type { PieceInst, Solved, Tray } from '../core/layout';
  import { cutListText, cutPacking, CUT_ALONGS, CUT_LAYOUTS, materialLabel, panelUse, planCuts, sheetName, sheetSizes, sheetSteps, sheetSummary, twoMaterials, type CutList, type CutPlan, type PieceGroup, type PieceShape, type SheetItem, type SheetStep, type StepPart } from '../core/pieces';
  import { designProblems } from '../core/problems';
  import type { CutLayout, CutSetup, MaterialKind, Project } from '../core/types';
  import Markdown from './Markdown.svelte';
  import NumberField from './NumberField.svelte';
  import ReportOverview from './ReportOverview.svelte';
  import PieceCutting from './PieceCutting.svelte';
  import PieceRef from './PieceRef.svelte';
  import { PieceHighlight } from './highlight.svelte';
  import { dimensionArrow, type Point } from './dimension';
  import { ARROW_ANGLE, arrowPath, labelLayout } from './itemArrow';
  import { download, slug } from './state.svelte';

  let { project, setup = $bindable(), solved, cut: fullCut, plan: fullPlan }: { project: Project; setup: CutSetup; solved: Solved; cut: CutList; plan: CutPlan } = $props();

  /**
   * Cutting only some sizes for now, e.g. from an offcut: the sizes left unticked in the cut list
   * are left off the packing and the cutting below. Assembly still uses every piece. Starts with
   * every size ticked each time it is turned on.
   */
  let selecting = $state(false);
  let unselected = $state.raw(new Set<string>());
  function setSelecting(on: boolean) {
    selecting = on;
    unselected = new Set();
  }
  function setSelected(key: string, on: boolean) {
    const next = new Set(unselected);
    if (on) next.delete(key);
    else next.add(key);
    unselected = next;
  }
  const leftOut = $derived(selecting ? fullCut.groups.filter((g) => unselected.has(g.key)) : []);
  /** The header box: ticks every size, or unticks them all once every one is ticked. */
  function setAllSelected(on: boolean) {
    unselected = on ? new Set() : new Set(fullCut.groups.map((g) => g.key));
  }
  /** The pieces being cut now: every piece, or only the sizes ticked in the cut list. */
  const cut = $derived(leftOut.length ? { ...fullCut, groups: fullCut.groups.filter((g) => !unselected.has(g.key)) } : fullCut);
  const plan = $derived(leftOut.length ? planCuts(project, cut, setup) : fullPlan);

  const trayById = $derived(new Map(solved.trays.map((t) => [t.id, t])));
  const layerName = $derived(new Map(project.layers.map((l) => [l.id, l.name])));
  /** Layers are named only when there are several; with one, "Layer 1" means nothing to a builder. */
  const multiLayer = $derived(project.layers.length > 1);
  const inLayer = (id: string) => (multiLayer ? ` · ${layerName.get(id)}` : '');
  const total = $derived(fullCut.groups.reduce((a, g) => a + g.pieces.length, 0));
  /** Everything wrong or adjusted, so nobody buys material for a design that will not build as shown. */
  const problems = $derived(designProblems(project, solved, fullPlan));
  const errors = $derived(problems.filter((i) => i.level === 'error'));
  const warnings = $derived(problems.filter((i) => i.level === 'warn'));

  const wellLabel = (id?: string) => solved.compartments.find((c) => c.id === id)?.label ?? '?';
  const parentNumber = (id?: string) => (id ? trayById.get(id)?.number : undefined) ?? '?';

  function where(g: PieceGroup): string {
    const byTray = new Map<number, Map<string, number>>();
    const shared = new Map<string, number>();
    for (const p of g.pieces) {
      if (p.sharedLidFor) {
        shared.set(p.sharedLidFor, (shared.get(p.sharedLidFor) ?? 0) + 1);
        continue;
      }
      // The upper box of a stack is built like the one below it; count it there.
      const tray = trayById.get(p.trayId)!;
      const t = tray.copyOf ? trayById.get(tray.copyOf)!.number : tray.number;
      const kind = p.kind === 'lid' && tray.copyOf ? 'upper-box lid' : p.kind;
      const m = byTray.get(t) ?? new Map<string, number>();
      m.set(kind, (m.get(kind) ?? 0) + 1);
      byTray.set(t, m);
    }
    const uses = [...byTray.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, m]) => `Tray ${t}: ${[...m.entries()].map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}`);
    return [...uses, ...[...shared.entries()].map(([well, n]) => `Compartment ${wellLabel(well)}: ${n} shared lid${n === 1 ? '' : 's'} over all separate boxes`)].join('; ');
  }

  const assemblyTrays = $derived(solved.trays.filter((t) => !t.copyOf));
  function sharedLidAfter(t: Tray) {
    if (t.depth !== 1 || assemblyTrays.findLast((other) => other.wellId === t.wellId)?.id !== t.id) return undefined;
    return solved.pieces.find((p) => p.sharedLidFor === t.wellId);
  }

  /** A notch's flat bottom is named only when it differs from the project's usual share. */
  const flatNote = (n: { width: number; bottom: number }) =>
    Math.abs(n.bottom - (n.width * (project.notch.bottom ?? NOTCH_BOTTOM_DEFAULT)) / 100) > 0.05 ? ` (${mm(n.bottom)} flat)` : '';

  /** For the CSV: what is cut into some pieces of a size, and into how many of them. */
  function shapeText(g: PieceGroup): string {
    const cuts = (x: PieceShape) =>
      x.lidNotches?.length
        ? `lid notches, long edge across: ${x.lidNotches.map(lidNotchText).join('; ')}`
        : [...x.notches.map((n) => `${mm(n.width)}×${mm(n.depth)}${flatNote(n)} at ${mm(n.center)}`), ...x.lows.map((l) => `${mm(l.depth)} lower from ${mm(l.from)} to ${mm(l.to)}`)].join(', ') + ' mm';
    return g.shapes.map((x) => `${x.pieces.length} of ${g.pieces.length}: ${cuts(x)}`).join(' | ');
  }

  const notchGroups = $derived(cut.groups.filter((g) => g.shapes.some((x) => x.notches.length || x.lidNotches?.length)));
  const loweredGroups = $derived(cut.groups.filter((g) => g.shapes.some((x) => x.lows.length)));

  function segments(item: SheetItem) {
    const s = item.strip!;
    const horizontal = item.along ? item.along === 'x' : item.w >= item.h;
    let offset = 0;
    return s.cuts.map((c) => {
      const seg = horizontal ? { x: item.x + offset, y: item.y, w: c.length, h: item.h } : { x: item.x, y: item.y + offset, w: item.w, h: c.length };
      offset += c.length + setup.kerf;
      return { ...seg, group: c.group };
    });
  }

  /**
   * A piece number's size on a cutting sheet, in sheet millimetres. Every sheet is drawn 200 px
   * wide whatever its size, so the number is at most `px` on screen, smaller where the piece is.
   */
  function labelSize(sheetWidth: number, px: number, w: number, h: number, text: string) {
    return Math.min((px * (sheetWidth + 4)) / 200, h * 0.7, w / (0.75 * text.length));
  }

  /** Assembly diagrams are drawn 240 px wide, and no taller than this: a long box is scaled down to fit. */
  const DIAGRAM_MAX_HEIGHT = 320;
  /** One screen pixel on a tray's diagram, in millimetres. */
  const diagramPx = (t: Tray) => Math.max((t.outer.w + 24) / 240, (t.outer.h + 30) / DIAGRAM_MAX_HEIGHT);

  function trayView(t: Tray) {
    const pad = 12;
    return `${t.outer.x - pad} ${t.outer.y - pad} ${t.outer.w + 2 * pad} ${t.outer.h + 2 * pad + 6}`;
  }

  /**
   * Where each tray goes, per layer: needed whenever trays lift out separately, since they only
   * fit back one way. Skipped for a single glued tray, where the assembly diagram says it all.
   */
  const placement = $derived(project.layers.length > 1 || solved.trays.filter((t) => t.depth === 0).length > project.layers.length);
  const topTrays = (layerId: string) => solved.trays.filter((t) => t.layerId === layerId && t.depth === 0);
  const boxesIn = (layerId: string) => solved.trays.filter((t) => t.layerId === layerId && t.depth === 1 && !t.copyOf);
  const scale = $derived(Math.max(project.box.width, project.box.depth) / 100);

  /** Keep the chosen material visible throughout cutting and assembly. */
  const T = $derived(project.material.thickness);
  /** With one material only, nothing is called primary: it is named by its thickness. */
  const sole = $derived(!twoMaterials(project));
  const hasSecondary = $derived(fullCut.groups.some((g) => g.material === 'secondary'));
  const blocks = $derived([...new Set(fullCut.groups.map((g) => g.material))].map((material) => {
    const groups = fullCut.groups.filter((g) => g.material === material);
    return { material, thickness: groups[0]!.thickness, groups };
  }));
  const secondaryRefs = $derived(
    fullCut.groups
      .filter((g) => g.material === 'secondary')
      .map((g) => `#${g.number}`)
      .join(', '),
  );

  /** Compare packing choices using only that material's pieces, with separate counts and efficiency. */
  const packingMaterials = $derived<MaterialKind[]>(project.material.secondaryThickness !== undefined ? ['primary', 'secondary'] : ['primary']);
  const packings = $derived(packingMaterials.map((material) => {
    const packing = cutPacking(setup, material);
    const groups = cut.groups.filter((g) => g.material === material);
    return {
      material,
      thickness: material === 'secondary' ? project.material.secondaryThickness ?? T : T,
      value: packing,
      info: CUT_LAYOUTS.find((l) => l.value === packing) ?? CUT_LAYOUTS[0],
      alternatives: new Map(CUT_LAYOUTS.map((l) => [l.value, planCuts(project, { ...cut, groups }, { ...setup, [material === 'secondary' ? 'secondaryLayout' : 'layout']: l.value })])),
    };
  }));

  /** The cut size picked, and the one under the pointer: both stand out wherever the report shows them. */
  const highlight = new PieceHighlight();

  /** The cutting step under the pointer: its cuts are drawn on its sheet. */
  let pointed = $state.raw<{ sheet: number; part: StepPart }>();
  const showsCuts = $derived(packings.some((p) => p.value !== 'fewest'));

  /** Removable boxes can be cut from sheets of their own; offered when the design has any. */
  const hasBoxes = $derived(solved.trays.some((t) => t.depth === 1));
  const boxSheets = $derived(plan.sheets.some((s) => s.boxes));
  /** Assembly speaks of every piece, so it names the box sheets from the whole plan. */
  const boxSheetsAll = $derived(fullPlan.sheets.some((s) => s.boxes));

  /** Compare the edge the longest cuts run along, over the sheets of every material. */
  const along = $derived(setup.cutAlong);
  const alongs = $derived(CUT_ALONGS.map((a) => ({ ...a, plan: planCuts(project, cut, { ...setup, cutAlong: a.value }) })));

  /** Sheets of their own for removable boxes start out the size of the main sheet. */
  function setSeparateBoxes(on: boolean) {
    setup.separateBoxes = on;
    if (on) setup.boxSheet = { ...setup.sheet };
  }

  function chooseBoxSheet(name: string) {
    const p = SHEET_PRESETS.find((x) => x.preset === name);
    setup.boxSheet = p ? { ...p } : { ...(setup.boxSheet ?? setup.sheet), preset: 'Custom' };
  }

  function setPacking(material: MaterialKind, layout: CutLayout) {
    if (material === 'secondary') setup.secondaryLayout = layout;
    else setup.layout = layout;
  }

  function chooseSheet(name: string) {
    const p = SHEET_PRESETS.find((x) => x.preset === name);
    setup.sheet = p ? { ...p } : { ...setup.sheet, preset: 'Custom' };
  }

  /** The secondary material's own sheet, or the primary's when "Same as primary" is chosen. */
  function chooseSecondarySheet(name: string) {
    const p = SHEET_PRESETS.find((x) => x.preset === name);
    if (!name) delete setup.secondarySheet;
    else setup.secondarySheet = p ? { ...p } : { ...(setup.secondarySheet ?? setup.sheet), preset: 'Custom' };
  }

  /** The assembly step under the pointer, and the diagram it belongs to: its pieces stand out there. */
  let pointedStep = $state.raw<{ diagram: string; step: Step }>();

  /**
   * A divider's distance from a wall, drawn across its tray's diagram: an arrow from the wall's inner
   * face to the divider, and its length in millimetres beside it. `px` is one screen pixel there.
   */
  function measureArrow(t: Tray, p: PieceInst, measure: NonNullable<Step['measure']>, px: number) {
    const across = measure.wall === 'left' || measure.wall === 'right';
    const mid = across ? p.footprint.y + p.footprint.h / 2 : p.footprint.x + p.footprint.w / 2;
    const f = p.footprint;
    const ends: Record<typeof measure.wall, [Point, Point]> = {
      left: [[t.inner.x, mid], [f.x, mid]],
      right: [[t.inner.x + t.inner.w, mid], [f.x + f.w, mid]],
      back: [[mid, t.inner.y], [mid, f.y]],
      front: [[mid, t.inner.y + t.inner.h], [mid, f.y + f.h]],
    };
    const [a, b] = ends[measure.wall];
    const text = `${mm(measure.distance)} mm`;
    const size = 11 * px;
    const w = text.length * size * 0.62 + 10 * px;
    const h = size + 4 * px;
    // The number sits beside the arrow, clear of it: above one running across, right of one running
    // down, or on the other side where that would run off the diagram.
    const beside = across ? h / 2 + 5 * px : w / 2 + 5 * px;
    const fits = across ? a[1] - beside - h / 2 >= t.outer.y : a[0] + beside + w / 2 <= t.outer.x + t.outer.w;
    const x = across ? (a[0] + b[0]) / 2 : a[0] + (fits ? beside : -beside);
    const y = across ? a[1] - (fits ? beside : -beside) : (a[1] + b[1]) / 2;
    return { path: dimensionArrow(a, b, 6 * px), text, size, box: { x: x - w / 2, y: y - h / 2, w, h, r: 2 * px }, x, y };
  }

  /** Loads three.js on demand, like the 3D view, so the report stays light until it is asked for. */
  async function exportObj() {
    const { insertObjZip } = await import('./three/obj');
    download(`${slug(project.name)}-3d.zip`, insertObjZip(project, solved, fullCut), 'application/zip');
  }

  /** Whether the cut list was just copied, or could not be, to say so on its button for a moment. */
  let copied = $state<'done' | 'failed'>();
  async function copyCutList() {
    try {
      await navigator.clipboard.writeText(cutListText(fullCut));
      copied = 'done';
    } catch {
      copied = 'failed';
    }
    setTimeout(() => (copied = undefined), 2000);
  }

  function exportCsv() {
    const rows = [['#', 'Qty', 'Kind', 'Material', 'Thickness mm', 'Length mm', 'Height mm', 'Notches, lowered', 'Used in']];
    for (const g of fullCut.groups) rows.push([String(g.number), String(g.pieces.length), g.kind === 'base' ? panelUse(g) : 'strip', g.material, String(g.thickness), String(g.length), String(g.height), shapeText(g), where(g)]);
    const csv = rows.map((r) => r.map((c) => (/[",;]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    download(`${slug(project.name)}-cut-list.csv`, csv, 'text/csv');
  }

</script>

<!-- Text with every piece number in it, "#12", as a button that picks that cut size. -->
{#snippet refs(text: string)}
  {#each text.split(/(#\d+)/) as bit, i (i)}{#if i % 2}<PieceRef n={Number(bit.slice(1))} {highlight} />{:else}{bit}{/if}{/each}
{/snippet}

<!-- An assembly step: point at it to see its pieces on the diagram; the wall a distance is from in bold. -->
{#snippet assemblyStep(diagram: string, step: Step, lead: boolean)}
  {@const from = step.measure ? `from the ${step.measure.wall} wall` : undefined}
  {#snippet words()}{#if from}{#each step.text.split(from) as bit, i (i)}{#if i}<b>{from}</b>{/if}{@render refs(bit)}{/each}{:else}{@render refs(step.text)}{/if}{/snippet}
  {#snippet sentence()}{#if step.strong}<b class="strong">{@render refs(step.strong)}</b>{' '}{/if}{#if lead || step.material === 'secondary'}<b class:secondary-material={step.material === 'secondary'}>{@render words()}</b>{:else}{@render words()}{/if}{/snippet}
  {#if step.pieces.length}<span class="cut-step" role="presentation" onmouseenter={() => (pointedStep = { diagram, step })} onmouseleave={() => (pointedStep = undefined)}>{@render sentence()}</span>{:else}{@render sentence()}{/if}
  {#each step.notes as n, j (j)}
    <span class="step-note {n.kind}"><b>{@render refs(n.label)}:</b> {@render refs(n.text)}</span>
  {/each}
{/snippet}

{#snippet stepLine(sheet: number, parts: StepPart[])}
  {#each parts as part, i (i)}{#if part.cuts}<span class="cut-step" role="presentation" onmouseenter={() => (pointed = { sheet, part })} onmouseleave={() => (pointed = undefined)}>{@render refs(part.text)}</span>{:else}{@render refs(part.text)}{/if}{/each}
{/snippet}

{#snippet stepItem(sheet: number, step: SheetStep)}
  {@render stepLine(sheet, step.parts)}
  {#if step.then}
    <ul>
      {#each step.then as under, i (i)}
        <li>{@render stepItem(sheet, under)}</li>
      {/each}
    </ul>
  {/if}
{/snippet}

<!-- Everything wrong or adjusted: above the page on screen, and at the top of the printout. -->
{#snippet problemList()}
  {#if errors.length}
    <div class="issue error">
      <b>Fix before buying or cutting: the cut list below is incomplete or wrong.</b>
      <ul>
        {#each errors as e, i (i)}<li>{e.where ? `${e.where}: ` : ''}{@render refs(e.message)}</li>{/each}
      </ul>
    </div>
  {/if}
  {#if warnings.length}
    <div class="issue warn">
      <b>Check before cutting: the design was adjusted where it did not fit.</b>
      <ul>
        {#each warnings as w, i (i)}<li>{w.where ? `${w.where}: ` : ''}{@render refs(w.message)}</li>{/each}
      </ul>
    </div>
  {/if}
{/snippet}

<svelte:head>{@html `<style>@page { size: A4 portrait; margin: 12mm; }</style>`}</svelte:head>

<div class="scroll">
  <!-- What shapes the page below, and what is wrong with it: the app's, so outside the page and never printed as shown. -->
  <aside class="controls no-print" aria-label="Your sheets and packing">
    <div class="controls-head">
      <h2>Your sheets and packing</h2>
      <div class="actions">
        <button class="primary" onclick={() => window.print()}>Print / Save PDF</button>
        <button onclick={exportCsv}>Cut list CSV</button>
        <button onclick={exportObj} data-tip="The whole insert plus one model per tray and box, in millimetres">Download OBJ (zip)</button>
      </div>
    </div>
    <div class="packing-options">
      <div class="setup">
        <label class="field">
          <span>{sole ? 'Sheet' : 'Primary sheet'}</span>
          <select aria-label="Primary material sheet" value={setup.sheet.preset} onchange={(e) => chooseSheet(e.currentTarget.value)}>
            {#each SHEET_PRESETS as s (s.preset)}
              <option value={s.preset}>{s.preset} ({s.width} × {s.height})</option>
            {/each}
            <option value="Custom">Custom</option>
          </select>
        </label>
        {#if setup.sheet.preset === 'Custom'}
          <NumberField label="Sheet width" value={setup.sheet.width} min={50} onchange={(v) => (setup.sheet.width = v)} />
          <NumberField label="Sheet height" value={setup.sheet.height} min={50} onchange={(v) => (setup.sheet.height = v)} />
        {/if}
        {#if !sole}
          {@const own = setup.secondarySheet}
          <label class="field" data-tip="Sheet size for the secondary material">
            <span>Secondary sheet</span>
            <select aria-label="Secondary material sheet" value={own?.preset ?? ''} onchange={(e) => chooseSecondarySheet(e.currentTarget.value)}>
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
        <NumberField label="Edge trim" value={setup.trim} min={0} hint="Unusable edge cut off each side of a sheet" onchange={(v) => (setup.trim = v)} />
        <NumberField label="Kerf" value={setup.kerf} min={0} step={0.1} hint="Material lost per cut" onchange={(v) => (setup.kerf = v)} />
      </div>
      {#if hasBoxes}
        <label class="check" data-tip="Pack removable box pieces onto separate sheets">
          <input type="checkbox" checked={setup.separateBoxes} onchange={(e) => setSeparateBoxes(e.currentTarget.checked)} />
          Cut removable boxes from sheets of their own
        </label>
        {#if setup.separateBoxes}
          {@const own = setup.boxSheet ?? setup.sheet}
          <div class="setup">
            <label class="field" data-tip="Sheet size for the removable boxes">
              <span>Removable box sheet</span>
              <select aria-label="Removable box sheet" value={own.preset} onchange={(e) => chooseBoxSheet(e.currentTarget.value)}>
                {#each SHEET_PRESETS as s (s.preset)}
                  <option value={s.preset}>{s.preset} ({s.width} × {s.height})</option>
                {/each}
                <option value="Custom">Custom</option>
              </select>
            </label>
            {#if own.preset === 'Custom'}
              <NumberField label="Removable box sheet width" value={own.width} min={50} onchange={(v) => (setup.boxSheet = { ...own, width: v })} />
              <NumberField label="Removable box sheet height" value={own.height} min={50} onchange={(v) => (setup.boxSheet = { ...own, height: v })} />
            {/if}
          </div>
        {/if}
      {/if}
    </div>
    {#each packings as packing (packing.material)}
      <div class="packing-options" data-material={packing.material}>
        <h3>{sole ? '' : `${materialLabel(packing.material, packing.thickness)} · `}Packing</h3>
        <div class="packings no-print" role="group" aria-label="{packing.material === 'secondary' ? 'Secondary' : 'Primary'} material packing">
          {#each CUT_LAYOUTS as l (l.value)}
            {@const alt = packing.alternatives.get(l.value)!}
            <button class="packing" class:on={packing.value === l.value} aria-pressed={packing.value === l.value} onclick={() => setPacking(packing.material, l.value)}>
              <b>{l.name}</b>
              <span>{sheetSummary(alt)}, {Math.round(alt.efficiency * 100)}% used</span>
            </button>
          {/each}
        </div>
        <p class="muted small"><b>{packing.info.name}.</b> {packing.info.detail}</p>
      </div>
    {/each}
    {#if showsCuts}
      <div class="packing-options">
        <h3>Longest cuts along the sheet's</h3>
        <div class="packings no-print" role="group" aria-label="Edge the longest cuts run along">
          {#each alongs as a (a.value)}
            <button class="packing" class:on={along === a.value} aria-pressed={along === a.value} onclick={() => (setup.cutAlong = a.value)}>
              <b>{a.name}</b>
              <span>{sheetSummary(a.plan)}, {Math.round(a.plan.efficiency * 100)}% used</span>
            </button>
          {/each}
        </div>
        <p class="muted small"><b>{alongs.find((a) => a.value === along)!.name}.</b> {alongs.find((a) => a.value === along)!.detail}</p>
      </div>
    {/if}
    {@render problemList()}
  </aside>
  <article class="report">
    <header>
      <div>
        <h1>{project.name}</h1>
        <p class="facts">
          Box inside {project.box.width} × {project.box.depth} × {project.box.height} mm · {sole ? 'Material' : 'Primary material'} {mm(T)} mm{project.material.secondaryThickness !== undefined
            ? `, secondary material ${mm(project.material.secondaryThickness)} mm`
            : ''} ·
          {multiLayer ? project.layers.map((l) => `${l.name} ${l.height} mm`).join(', ') : `${project.layers[0]?.height} mm tall`} · {mm(solved.headroom)} mm headroom
        </p>
        <p class="facts">
          <b>{total}</b> pieces in <b>{fullCut.groups.length}</b> sizes from {sheetSummary(fullPlan)} ({sheetSizes(fullPlan)})
        </p>
      </div>
    </header>

    <div class="print-only">{@render problemList()}</div>

    <ReportOverview {project} {solved} cut={fullCut} />

    {#if project.readme?.trim()}
      <section class="notes">
        <h2>Notes</h2>
        <Markdown source={project.readme} />
      </section>
    {/if}

    {#if placement}
      <section>
        <h2>Placement</h2>
        <p class="muted small">
          {project.construction === 'separate' ? 'Every compartment lifts out on its own, so the trays only fit back this way. ' : ''}{multiLayer ? 'Put the layers in bottom first; each view looks' : 'The view looks'}
          down on the box with its front edge at the bottom.
        </p>
        <div class="placement">
          {#each project.layers as layer, li (layer.id)}
            <figure>
              <svg viewBox="-4 -4 {project.box.width + 8} {project.box.depth + 8 + 9 * scale}" class="tray-svg" role="img" aria-label="{layer.name} placement">
                <rect x={0} y={0} width={project.box.width} height={project.box.depth} class="box-edge" style:stroke-width={0.5 * scale} />
                {#each topTrays(layer.id) as t (t.id)}
                  <rect x={t.outer.x} y={t.outer.y} width={t.outer.w} height={t.outer.h} class="place-tray" style:stroke-width={0.6 * scale} />
                {/each}
                {#each boxesIn(layer.id) as b (b.id)}
                  <rect x={b.outer.x} y={b.outer.y} width={b.outer.w} height={b.outer.h} class="place-box" style:stroke-width={0.5 * scale} />
                {/each}
                {#each solved.compartments.filter((c) => c.layerId === layer.id) as c (c.id)}
                  <rect x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h} class="place-comp" style:stroke-width={0.3 * scale} />
                {/each}
                {#each solved.compartments.filter((c) => c.layerId === layer.id && !c.node.insert) as c (c.id)}
                  {@const size = Math.max(3, Math.min(6 * scale, Math.min(c.rect.w, c.rect.h) * 0.4))}
                  <text x={c.rect.x + c.rect.w / 2} y={c.rect.y + c.rect.h / 2} class="comp" style:fill={sectionInk(c.tint)} font-size={size}>{c.label}</text>
                {/each}
                {#each topTrays(layer.id) as t (t.id)}
                  {@const r = Math.max(2.5, Math.min(3.2 * scale, Math.min(t.outer.w, t.outer.h) * 0.16))}
                  <g transform="translate({t.outer.x + r + 1.5 * scale} {t.outer.y + r + 1.5 * scale})">
                    <circle r={r} class="place-num" />
                    <text class="place-num-text" font-size={r * 1.15}>{t.number}</text>
                  </g>
                {/each}
                <text x={project.box.width / 2} y={project.box.depth + 6 * scale} class="front" font-size={5 * scale}>FRONT</text>
              </svg>
              <figcaption>
                {#if multiLayer}<b>{li + 1}. {layer.name}</b>, {layer.height} mm:{/if}
                {multiLayer ? (topTrays(layer.id).length === 1 ? 'tray' : 'trays') : topTrays(layer.id).length === 1 ? 'Tray' : 'Trays'}
                {topTrays(layer.id)
                  .map((t) => t.number)
                  .join(', ')}{boxesIn(layer.id).length ? `, with ${boxesIn(layer.id).length === 1 ? 'box' : 'boxes'} ${boxesIn(layer.id).map((b) => b.number).join(', ')} inside` : ''}
              </figcaption>
            </figure>
          {/each}
        </div>
      </section>
    {/if}

    <section>
      <h2 class="with-action">
        Cut list
        <span class="cut-actions no-print">
          <label class="check small" data-tip="Untick sizes to leave them out of the cutting plan">
            <input type="checkbox" checked={selecting} onchange={(e) => setSelecting(e.currentTarget.checked)} />
            Select pieces
          </label>
          <button class="small" onclick={copyCutList} data-tip="As plain text, one size per line">
            {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Could not copy' : 'Copy sizes and quantities'}
          </button>
        </span>
      </h2>
      <table>
        <thead>
          <tr>{#if selecting}<th class="no-print"
              ><input
                type="checkbox"
                checked={leftOut.length === 0}
                indeterminate={leftOut.length > 0 && leftOut.length < fullCut.groups.length}
                onchange={(e) => setAllSelected(e.currentTarget.checked)}
                aria-label="Select all pieces"
              /></th
            >{/if}<th class="no-print"></th><th>#</th><th>Qty</th><th>Size (mm)</th><th>Used in</th></tr>
        </thead>
        {#each blocks as block (block.material)}
          <tbody class:own={block.material === 'secondary'}>
            <tr class="material"><th colspan={selecting ? 6 : 5}>From {materialLabel(block.material, block.thickness, sole)}</th></tr>
            {#each block.groups as g (g.key)}
              <tr class:picked={highlight.picked === g.number} class:pointed={highlight.pointed === g.number} class:left-out={selecting && unselected.has(g.key)}>
                {#if selecting}
                  <td class="no-print">
                    <input type="checkbox" checked={!unselected.has(g.key)} onchange={(e) => setSelected(g.key, e.currentTarget.checked)} aria-label="Cut #{g.number} now" />
                  </td>
                {/if}
                <td class="no-print">
                  <input type="radio" name="cut-list-pick" checked={highlight.picked === g.number} onclick={() => highlight.toggle(g.number)} aria-label="Highlight #{g.number} in the cutting plan" />
                </td>
                <td class="num"><PieceRef n={g.number} {highlight} /></td>
                <td class="qty">{g.pieces.length}</td>
                <td class="size">{mm(g.length)} × {mm(g.height)}{g.kind === 'base' ? ` ${panelUse(g)}` : ''}</td>
                <td class="muted">{where(g)}</td>
              </tr>
            {/each}
          </tbody>
        {/each}
      </table>
      <p class="muted small">Wall and divider sizes are length × height.</p>
    </section>

    <section>
      <h2>Cutting plan</h2>
      <div class="print-only">
        {#each packings as packing (packing.material)}
          <p class="muted small"><b>{sole ? '' : `${materialLabel(packing.material, packing.thickness)} · `}{packing.info.name}.</b> {packing.info.detail}</p>
        {/each}
        {#if showsCuts}
          <p class="muted small"><b>Longest cuts along the sheet's {along} edge.</b> {alongs.find((a) => a.value === along)!.detail}</p>
        {/if}
      </div>
      <p class="muted small">
        {#if setup.trim > 0}Trim {mm(setup.trim)} mm off each sheet edge first.{/if}
        {#if boxSheets}Keep pieces from the removable box sheets separate.{/if}
        {#if leftOut.length}<b>Left out: {@render refs(leftOut.map((g) => `#${g.number}`).join(', '))}.</b>{/if}
        Number each piece as you cut it{#if notchGroups.length || loweredGroups.length}, then make the notch and edge cuts below{/if}.
      </p>
      {#each plan.sheets as sheet (sheet.index)}
        {@const W = sheet.sheet.width}
        {@const H = sheet.sheet.height}
        {@const packingInfo = CUT_LAYOUTS.find((l) => l.value === cutPacking(setup, sheet.material)) ?? CUT_LAYOUTS[0]}
        <div class="sheet">
          <svg viewBox="-2 -2 {W + 4} {H + 4}" class="sheet-svg" role="img" aria-label="Sheet {sheet.index + 1} packing">
            <rect width={W} height={H} class="paper" />
            <rect x={setup.trim} y={setup.trim} width={W - 2 * setup.trim} height={H - 2 * setup.trim} class="trim" />
            {#each sheet.items as item, i (i)}
              {#if item.kind === 'base'}
                {@const n = item.group!.number}
                <rect
                  x={item.x}
                  y={item.y}
                  width={item.w}
                  height={item.h}
                  class="base"
                  class:secondary={sheet.material === 'secondary'}
                  class:picked={highlight.picked === n}
                  class:pointed={highlight.pointed === n}
                  role="presentation"
                  onmouseenter={() => (highlight.pointed = n)}
                  onmouseleave={() => (highlight.pointed = undefined)}
                  onclick={() => highlight.toggle(n)}
                />
                <text x={item.x + item.w / 2} y={item.y + item.h / 2} class="label" font-size={labelSize(W, 12, item.w, item.h, `#${item.group?.number}`)}>#{item.group?.number}</text>
              {:else}
                {#each segments(item) as seg, j (j)}
                  <rect
                    x={seg.x}
                    y={seg.y}
                    width={seg.w}
                    height={seg.h}
                    class="seg"
                    class:secondary={sheet.material === 'secondary'}
                    class:picked={highlight.picked === seg.group}
                    class:pointed={highlight.pointed === seg.group}
                    role="presentation"
                    onmouseenter={() => (highlight.pointed = seg.group)}
                    onmouseleave={() => (highlight.pointed = undefined)}
                    onclick={() => highlight.toggle(seg.group)}
                  />
                  <text x={seg.x + seg.w / 2} y={seg.y + seg.h / 2} class="label" font-size={labelSize(W, 9, seg.w, seg.h, `#${seg.group}`)}>#{seg.group}</text>
                {/each}
              {/if}
            {/each}
            {#if pointed?.sheet === sheet.index}
              {@const area = pointed.part.area}
              {#if area}<rect x={area.x} y={area.y} width={area.w} height={area.h} class="cut-area" />{/if}
              {#each pointed.part.cuts ?? [] as c, i (i)}
                <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} class="cut-line" />
              {/each}
            {/if}
          </svg>
          <div class="sheet-text">
            <h3>
              Sheet {sheet.index + 1} of {plan.sheets.length} · <span class:secondary-material={sheet.material === 'secondary'}>{materialLabel(sheet.material, sheet.thickness, sole)}</span>
              · {sheetName(sheet.sheet)}{sheet.boxes ? ' · for removable boxes' : ''}
            </h3>
            <p class="muted small">Packing: {packingInfo.name}{packingInfo.value === 'fewest' ? '' : `, longest cuts along the ${along} edge`}.</p>
            <ol>
              {#each sheetSteps(setup, sheet) as step, i (i)}
                <li>{@render stepItem(sheet.index, step)}</li>
              {/each}
            </ol>
          </div>
        </div>
      {/each}
    </section>

    {#if notchGroups.length}
      <section class="notch-cutting" aria-label="Finger notch cutting">
        <h2>Finger notch cutting</h2>
        <p>Cut these notches while the numbered pieces are still flat, before gluing. Mark the two points on the opening edge and the two points inside the piece, then join them with straight cuts. All distances below are in millimetres.</p>
        {#each notchGroups as group (group.key)}<PieceCutting {group} {highlight} {sole} />{/each}
      </section>
    {/if}
    {#if loweredGroups.length}
      <section class="lowered-cutting" aria-label="Lowered side cutting">
        <h2>Lowered side cutting</h2>
        <p>Cut these lowered stretches before gluing, using the same four-point marking method. A line on an existing outer edge needs no additional cut.</p>
        {#each loweredGroups as group (group.key)}<PieceCutting {group} kind="lowered" {highlight} {sole} />{/each}
      </section>
    {/if}

    <section>
      <h2>Assembly</h2>
      <p class="muted small">Use the finished pieces. Match their numbered positions and orientations to each diagram, keeping notched wall and divider edges facing up.{#if boxSheetsAll}{' '}Build the removable boxes from the pieces cut from their own sheets.{/if}</p>
      {#if hasSecondary}
        <p class="material-note">
          Pieces {@render refs(secondaryRefs)} use <b>{materialLabel('secondary', project.material.secondaryThickness ?? T)}</b>, cut from separate sheets.
          All remaining pieces use {materialLabel('primary', T)}.
        </p>
      {/if}
      {#each assemblyTrays as t (t.id)}
        {@const pieces = trayAssemblyPieces(solved, t)}
        {@const topLid = t.stacked ? pieces.find((p) => p.kind === 'lid') : undefined}
        {@const comps = solved.compartments.filter((c) => c.trayId === t.id)}
        {@const hot = pointedStep?.diagram === t.id ? pointedStep.step : undefined}
        <div class="tray">
          <h3>
            Tray {t.number}{t.stacked ? ' (make 2)' : ''}{inLayer(t.layerId)}{t.depth === 1
              ? ` · ${t.stacked ? 'two boxes stacked' : t.emptyAbove ? 'half-height box, empty above,' : 'box standing'} in ${wellLabel(t.wellId)} of tray ${parentNumber(t.parentTrayId)}`
              : ''} ·
            {mm(t.outer.w)} × {mm(t.outer.h)} × {mm(t.height)} mm{t.stacked ? ' per box body' : ''}{topLid ? ` · one ${mm(topLid.thickness)} mm lid on the upper box` : t.lid ? ` including ${mm(t.lid)} mm lid` : ''} · compartments {t.compartments.join(', ')}
          </h3>
          <div class="tray-body">
            <svg viewBox={trayView(t)} class="tray-svg" role="img" aria-label="Tray {t.number} top view">
              {#each pieces.filter((p) => p.kind === 'base') as b (b.id)}
                <rect x={b.footprint.x} y={b.footprint.y} width={b.footprint.w} height={b.footprint.h} class="tray-base" />
              {/each}
              {#each comps as c (c.id)}
                <rect x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h} style:fill={sectionColor(c.tint, 90)} />
                {@const label = `${c.label}${c.stacked ? '²' : ''}${c.pad ? '*' : ''}`}
                {@const place = labelLayout(c.rect, Math.max(5, Math.min(18, Math.min(c.rect.w, c.rect.h) * 0.3)), label.length, !!c.node.arrow)}
                {@const size = place.size}
                <text x={place.letterX} y={c.rect.y + c.rect.h / 2 - size * 0.12} class="comp" style:fill={sectionInk(c.tint)} font-size={size}>{label}</text>
                {#if place.arrow && c.node.arrow}
                  <path
                    d={arrowPath(place.arrow.len)}
                    transform="translate({place.arrow.x} {place.arrow.y}) rotate({ARROW_ANGLE[c.node.arrow]})"
                    class="item-arrow"
                    style:stroke={sectionInk(c.tint)}
                    style:stroke-width={Math.max(0.6, size * 0.09)}
                  />
                {/if}
              {/each}
              {#each pieces.filter((p) => p.kind === 'wall' || p.kind === 'divider') as p (p.id)}
                <rect x={p.footprint.x} y={p.footprint.y} width={p.footprint.w} height={p.footprint.h} class="tray-piece" class:hot={hot?.pieces.includes(p.id)} />
                {#each p.lowFrom as l, i (i)}
                  {#if p.axis === 'x'}
                    <rect x={p.start + l.from} y={p.footprint.y} width={l.to - l.from} height={p.footprint.h} class="tray-lowered" class:custom={l.custom} />
                  {:else}
                    <rect x={p.footprint.x} y={p.start + l.from} width={p.footprint.w} height={l.to - l.from} class="tray-lowered" class:custom={l.custom} />
                  {/if}
                {/each}
                {#each p.notches as n, i (i)}
                  {#if p.axis === 'x'}
                    <rect x={p.start + n.center - n.width / 2} y={p.footprint.y} width={n.width} height={p.footprint.h} class="tray-notch" class:custom={n.custom} />
                  {:else}
                    <rect x={p.footprint.x} y={p.start + n.center - n.width / 2} width={p.footprint.w} height={n.width} class="tray-notch" class:custom={n.custom} />
                  {/if}
                {/each}
              {/each}
              {#each pieces.filter((p) => (p.kind === 'base' || p.kind === 'pad') && hot?.pieces.includes(p.id)) as p (p.id)}
                <rect x={p.footprint.x} y={p.footprint.y} width={p.footprint.w} height={p.footprint.h} class="hot-panel" />
              {/each}
              {#each pieces.filter((p) => (p.kind === 'wall' || p.kind === 'divider') && (p.axis === 'x' ? p.footprint.w : p.footprint.h) > 12) as p (p.id)}
                {@const n = fullCut.groupOf.get(p.id)!.number}
                <g
                  transform="translate({p.footprint.x + p.footprint.w / 2} {p.footprint.y + p.footprint.h / 2})"
                  class="tag-mark"
                  role="presentation"
                  onmouseenter={() => (highlight.pointed = n)}
                  onmouseleave={() => (highlight.pointed = undefined)}
                  onclick={() => highlight.toggle(n)}
                >
                  <rect x={-5.5} y={-3} width={11} height={6} rx={1.5} class="tag" class:picked={highlight.picked === n} class:pointed={highlight.pointed === n} />
                  <text class="tag-text">{n}</text>
                </g>
              {/each}
              {#each pieces.filter((p) => p.kind === 'lid') as lid (lid.id)}
                <path d={polygonPath(lidOutline(lid.length, lid.height, lid.lidNotches), lid.footprint.x, lid.footprint.y)} class="tray-lid" class:hot={hot?.pieces.includes(lid.id)} />
                {#each lid.lidNotches ?? [] as notch (notch.side)}
                  <path d={polygonPath(lidNotchPoints(lid.length, lid.height, notch), lid.footprint.x, lid.footprint.y)} class="tray-lid-notch" />
                {/each}
                <text x={t.outer.x + t.outer.w / 2} y={t.outer.y - 5} class="front">{t.stacked ? 'TOP LID' : 'LID'} #{fullCut.groupOf.get(lid.id)?.number}</text>
              {/each}
              <text x={t.outer.x + t.outer.w / 2} y={t.outer.y + t.outer.h + 8} class="front">FRONT</text>
              {#if hot?.measure}
                {@const arrow = measureArrow(t, pieces.find((p) => p.id === hot.pieces[0])!, hot.measure, diagramPx(t))}
                <path d={arrow.path} class="measure" />
                <rect x={arrow.box.x} y={arrow.box.y} width={arrow.box.w} height={arrow.box.h} rx={arrow.box.r} class="measure-box" />
                <text x={arrow.x} y={arrow.y} font-size={arrow.size} class="measure-text">{arrow.text}</text>
              {/if}
            </svg>
            <ol class="steps">
              {#each trayInstructions(project, solved, fullCut, t) as step, i (i)}
                <li>{@render assemblyStep(t.id, step, i === 0)}</li>
              {/each}
            </ol>
          </div>
        </div>
        {@const sharedLid = sharedLidAfter(t)}
        {#if sharedLid}
          {@const well = solved.compartments.find((c) => c.id === sharedLid.sharedLidFor)!}
          {@const boxes = assemblyTrays.filter((box) => box.wellId === well.id)}
          {@const fp = sharedLid.footprint}
          <div class="tray shared-lid-assembly">
            <h3>Shared lid{inLayer(t.layerId)} · over all separate boxes in {well.label} · {mm(sharedLid.length)} × {mm(sharedLid.height)} × {mm(sharedLid.thickness)} mm</h3>
            <div class="tray-body">
              <svg viewBox="{fp.x - 12} {fp.y - 12} {fp.w + 24} {fp.h + 30}" class="tray-svg" role="img" aria-label="Shared lid over all separate boxes in {well.label}">
                {#each boxes as box (box.id)}
                  <rect x={box.outer.x} y={box.outer.y} width={box.outer.w} height={box.outer.h} class="tray-base" />
                {/each}
                {#each solved.compartments.filter((c) => c.wellId === well.id) as c (c.id)}
                  {@const size = Math.max(5, Math.min(18, Math.min(c.rect.w, c.rect.h) * 0.3))}
                  <rect x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h} style:fill={sectionColor(c.tint, 90)} />
                  <text x={c.rect.x + c.rect.w / 2} y={c.rect.y + c.rect.h / 2} class="comp" style:fill={sectionInk(c.tint)} font-size={size}>{c.label}{c.stacked ? '²' : ''}</text>
                {/each}
                <path d={polygonPath(lidOutline(sharedLid.length, sharedLid.height, sharedLid.lidNotches), fp.x, fp.y)} class="tray-lid" class:hot={pointedStep?.diagram === `lid:${well.id}`} />
                {#each sharedLid.lidNotches ?? [] as notch (notch.side)}
                  <path d={polygonPath(lidNotchPoints(sharedLid.length, sharedLid.height, notch), fp.x, fp.y)} class="tray-lid-notch" />
                {/each}
                <text x={fp.x + fp.w / 2} y={fp.y - 5} class="front">SHARED LID #{fullCut.groupOf.get(sharedLid.id)?.number}</text>
                <text x={fp.x + fp.w / 2} y={fp.y + fp.h + 8} class="front">FRONT</text>
              </svg>
              <ol class="steps">
                {#each sharedLidInstructions(project, solved, fullCut, sharedLid) as step, i (i)}
                  <li>{@render assemblyStep(`lid:${well.id}`, step, !!step.material)}</li>
                {/each}
              </ol>
            </div>
          </div>
        {/if}
      {/each}
    </section>

  </article>
</div>

<style>
  .scroll {
    overflow-y: auto;
    height: 100%;
  }
  .controls {
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    padding: 14px max(16px, calc((100% - 820px) / 2)) 16px;
  }
  .controls-head {
    display: flex;
    gap: 16px;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .controls-head h2 {
    margin: 0;
  }
  .controls > p {
    margin: 0 0 10px;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 6px 0 2px;
  }
  /* Piece numbers are drawn for the page's paper; here they take the theme's colours. */
  .controls :global(.ref:not(.pointed, .picked)) {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }
  .controls :global(.ref:is(.pointed, .picked)) {
    color: #22201c;
  }
  /* A printable page: always the light palette, whatever the app theme. */
  .report {
    color-scheme: light;
    --bg: #f4f2ee;
    --panel: #ffffff;
    --input: #ffffff;
    --line: #e2ded6;
    --line-strong: #c9c3b8;
    --text: #22201c;
    --muted: #6f6a61;
    --accent: #2f6fdb;
    --accent-soft: #e6eefc;
    --error: #c0392b;
    --error-soft: #fdecea;
    --warn: #a26400;
    --warn-soft: #fff4e0;
    --sec-sat: 70%;
    --sec-a: 0%;
    --sec-b: 1;
    --sec-ink: 30%;
    --canvas-box: #fbfaf7;
    --canvas-edge: #8a8378;
    --canvas-base: #cfc8bb;
    --canvas-base-inner: #e2dccf;
    --piece: #3f3b35;
    --piece-inner: #6a6258;
    --notch: #f2b233;
    --notch-custom: #1aa6b7;
    --lowered: #9b7fd4;
    color: var(--text);
    background: #fff;
    max-width: 820px;
    margin: 24px auto;
    padding: 28px 32px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
    font-size: 12.5px;
  }
  header {
    display: flex;
    gap: 16px;
    justify-content: space-between;
    align-items: flex-start;
  }
  h1 {
    font-size: 20px;
    margin: 0 0 4px;
  }
  .report h2 {
    font-size: 15px;
    color: var(--text);
    text-transform: none;
    letter-spacing: 0;
    margin: 22px 0 8px;
    border-bottom: 1px solid var(--line);
    padding-bottom: 4px;
  }
  .report h2.with-action {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  h2 button {
    font-weight: 400;
  }
  h3 {
    font-size: 13px;
    margin: 0 0 6px;
  }
  .facts {
    margin: 2px 0;
    color: var(--muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 4px 8px 4px 0;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  th {
    color: var(--muted);
    font-weight: 500;
    font-size: 11.5px;
  }
  .num {
    font-weight: 700;
  }
  .qty,
  .size {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 11.5px;
  }
  .sheet {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 16px;
    margin-bottom: 18px;
    break-inside: avoid;
  }
  .sheet-svg {
    width: 100%;
    height: auto;
  }
  /* Outlines are in screen pixels: sheets of every size are drawn the same width. */
  .paper,
  .trim,
  .base,
  .seg {
    vector-effect: non-scaling-stroke;
  }
  .paper {
    fill: #f7f5f0;
    stroke: #22201c;
    stroke-width: 1px;
  }
  .trim {
    fill: none;
    stroke: #b8b1a4;
    stroke-width: 0.8px;
    stroke-dasharray: 4 3;
  }
  .base {
    fill: #d9d2c3;
    stroke: #22201c;
    stroke-width: 0.8px;
  }
  .base.secondary {
    fill: #dfd6f1;
    stroke: #60418a;
  }
  .seg.secondary {
    fill: #dfd6f1;
    stroke: #60418a;
  }
  .base,
  .seg {
    cursor: pointer;
  }
  .base.pointed,
  .seg.pointed {
    fill: #ffe38a;
  }
  .base.picked,
  .seg.picked {
    fill: #ffd34d;
  }
  tr.pointed td {
    background: #fff9e3;
  }
  tr.picked td {
    background: #fff3c4;
  }
  .cut-actions {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .cut-actions .check {
    margin: 0;
    font-weight: 400;
    color: var(--text);
  }
  tr.left-out td:not(.no-print) {
    opacity: 0.4;
  }
  td input[type='checkbox'],
  th input[type='checkbox'] {
    margin: 1px 0 0;
    cursor: pointer;
  }
  td input[type='radio'] {
    margin: 1px 0 0;
    cursor: pointer;
  }
  .secondary-material {
    color: #60418a;
  }
  .seg {
    fill: #ece6da;
    stroke: #22201c;
    stroke-width: 0.6px;
  }
  .label {
    pointer-events: none;
    text-anchor: middle;
    dominant-baseline: central;
    font-weight: 700;
    fill: #22201c;
  }
  .cut-area,
  .cut-line {
    pointer-events: none;
  }
  .cut-area {
    fill: #e0452f;
    fill-opacity: 0.22;
  }
  .cut-line {
    stroke: #e0452f;
    stroke-width: 2.5px;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .cut-step {
    border-bottom: 1px dotted var(--line-strong);
    cursor: default;
  }
  .cut-step:hover {
    background: #fde3dc;
    border-bottom-color: #e0452f;
  }
  .sheet-text ol,
  .steps {
    margin: 0;
    padding-left: 18px;
  }
  .sheet-text li,
  .steps li {
    margin-bottom: 3px;
  }
  .sheet-text ul {
    margin: 3px 0 6px;
    padding-left: 16px;
  }
  .tray {
    margin-bottom: 20px;
    break-inside: avoid;
  }
  .tray-body {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 16px;
    align-items: start;
  }
  .tray-body .tray-svg {
    max-height: 320px;
  }
  .tray-svg {
    width: 100%;
    height: auto;
  }
  .tray-base {
    fill: #cfc8bb;
  }
  .tray-lid {
    fill: none;
    stroke: #6f6a61;
    stroke-width: 0.6;
    stroke-dasharray: 3 2;
  }
  .tray-lid-notch {
    fill: #f2b233;
    fill-opacity: 0.5;
    stroke: #a26400;
    stroke-width: 0.4;
  }
  .tray-piece {
    fill: #3f3b35;
  }
  /* The pieces of the assembly step under the pointer. */
  .tray-piece.hot {
    fill: #e0452f;
  }
  .hot-panel {
    fill: #e0452f;
    fill-opacity: 0.25;
    stroke: #e0452f;
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .tray-lid.hot {
    stroke: #e0452f;
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
  }
  .measure {
    fill: none;
    stroke: #e0452f;
    stroke-width: 2px;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .measure-box {
    fill: #fff;
    stroke: #e0452f;
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .measure-text {
    fill: #e0452f;
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }
  .tray-notch {
    fill: #f2b233;
  }
  .tray-lowered {
    fill: #9b7fd4;
  }
  .tray-lowered.custom {
    fill: #c2569b;
  }
  .tray-notch.custom {
    fill: #1aa6b7;
  }
  .item-arrow {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  tr.material th {
    text-align: left;
    font-size: 11.5px;
    padding-top: 10px;
    border-bottom: 1.5px solid #3f3b35;
  }
  tbody.own tr.material th {
    color: #2f6fdb;
    border-bottom-color: #2f6fdb;
  }
  .material-note {
    border-left: 3px solid #2f6fdb;
    padding: 4px 10px;
    font-size: 12px;
    background: #e6eefc;
  }
  .strong {
    background: #fff1c2;
    padding: 0 3px;
    border-radius: 3px;
  }
  .issue ul {
    margin: 4px 0 0;
    padding-left: 18px;
  }
  .step-note {
    display: block;
    margin: 2px 0 1px;
    padding: 1px 0 1px 7px;
    border-left: 3px solid;
  }
  .step-note.lowered {
    border-color: #9b7fd4;
  }
  .step-note.lowered b {
    color: #6f4fb8;
  }
  .packing-options {
    margin-bottom: 14px;
  }
  .setup {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 0 28px;
    margin: 4px 0 6px;
  }
  .setup .field {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 6px;
    margin: 4px 0;
  }
  .print-only {
    display: none;
  }
  .packings {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 4px 0 6px;
  }
  .packing {
    display: grid;
    gap: 1px;
    text-align: left;
    padding: 6px 10px;
  }
  .packing span {
    font-size: 11.5px;
    color: var(--muted);
  }
  .placement {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px 18px;
  }
  .placement figure {
    margin: 0;
    break-inside: avoid;
  }
  .placement figcaption {
    font-size: 11.5px;
    margin-top: 2px;
  }
  .box-edge {
    fill: #fbfaf7;
    stroke: #8a8378;
    stroke-dasharray: 3 2;
  }
  .place-tray {
    fill: #e2dccf;
    stroke: #3f3b35;
  }
  .place-comp {
    fill: none;
    stroke: #8a8378;
  }
  .place-box {
    fill: none;
    stroke: #3f3b35;
    stroke-dasharray: 2 1.5;
  }
  .place-num {
    fill: #3f3b35;
  }
  .place-num-text {
    fill: #fff;
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
  }
  .comp {
    text-anchor: middle;
    dominant-baseline: central;
    font-weight: 700;
  }
  .tag {
    fill: #fff;
    stroke: #3f3b35;
    stroke-width: 0.4;
  }
  .tag-mark {
    cursor: pointer;
  }
  .tag.pointed {
    fill: #ffe38a;
  }
  .tag.picked {
    fill: #ffd34d;
  }
  .tag-text {
    font-size: 4.2px;
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
    fill: #22201c;
  }
  .front {
    font-size: 5px;
    font-weight: 700;
    letter-spacing: 1px;
    text-anchor: middle;
    fill: #6f6a61;
  }

  @media print {
    .scroll {
      overflow: visible;
      height: auto;
    }
    .report {
      box-shadow: none;
      margin: 0;
      padding: 0;
      max-width: none;
    }
    .no-print {
      display: none;
    }
    .print-only {
      display: block;
    }
    .cut-step {
      border-bottom: none;
    }
  }
</style>
