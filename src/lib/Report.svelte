<script lang="ts">
  import { sharedLidInstructions, trayAssemblyPieces, trayInstructions } from '../core/assembly';
  import { NOTCH_BOTTOM_DEFAULT } from '../core/layout';
  import { lidNotchPoints, lidNotchText, lidOutline, polygonPath } from '../core/lidNotches';
  import { sectionColor, sectionInk } from '../core/defaults';
  import { mm } from '../core/geom';
  import type { Solved, Tray } from '../core/layout';
  import { cutPacking, CUT_LAYOUTS, materialLabel, panelUse, planCuts, sheetSummary, type CutList, type CutPlan, type PieceGroup, type SheetItem } from '../core/pieces';
  import { setCutLayout } from '../core/edit';
  import { designProblems } from '../core/problems';
  import type { MaterialKind, Project } from '../core/types';
  import Markdown from './Markdown.svelte';
  import ReportOverview from './ReportOverview.svelte';
  import PieceCutting from './PieceCutting.svelte';
  import { ARROW_ANGLE, arrowPath, labelLayout } from './itemArrow';
  import { download, slug } from './state.svelte';

  let { project, solved, cut, plan }: { project: Project; solved: Solved; cut: CutList; plan: CutPlan } = $props();

  const trayById = $derived(new Map(solved.trays.map((t) => [t.id, t])));
  const layerName = $derived(new Map(project.layers.map((l) => [l.id, l.name])));
  const total = $derived(cut.groups.reduce((a, g) => a + g.pieces.length, 0));
  /** Everything wrong or adjusted, so nobody buys material for a design that will not build as shown. */
  const problems = $derived(designProblems(solved, plan));
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

  function notchText(g: PieceGroup): string {
    const parts = [
      ...g.notches.map((n) => `${mm(n.width)}×${mm(n.depth)}${flatNote(n)} at ${mm(n.center)}`),
      ...g.lows.map((l) => `${mm(l.depth)} lower from ${mm(l.from)} to ${mm(l.to)}`),
    ];
    if (g.lidNotches?.length) return `Cut orientation (long edge across): ${g.lidNotches.map(lidNotchText).join('; ')}`;
    return parts.length ? parts.join(', ') + ' mm' : '';
  }

  const notchGroups = $derived(cut.groups.filter((g) => g.notches.length || g.lidNotches?.length));
  const loweredGroups = $derived(cut.groups.filter((g) => g.lows.length));

  function stripText(item: SheetItem): string {
    const s = item.strip!;
    const parts: string[] = [];
    let i = 0;
    while (i < s.cuts.length) {
      let j = i;
      while (j + 1 < s.cuts.length && s.cuts[j + 1].group === s.cuts[i].group) j++;
      const n = j - i + 1;
      parts.push(`#${s.cuts[i].group} ${mm(s.cuts[i].length)}${n > 1 ? ` ×${n}` : ''}`);
      i = j + 1;
    }
    return `Strip ${mm(s.height)} mm wide, ${mm(s.used)} mm long → ${parts.join(', ')}`;
  }

  function segments(item: SheetItem) {
    const s = item.strip!;
    const horizontal = item.along ? item.along === 'x' : item.w >= item.h;
    let offset = 0;
    return s.cuts.map((c) => {
      const seg = horizontal ? { x: item.x + offset, y: item.y, w: c.length, h: item.h } : { x: item.x, y: item.y + offset, w: item.w, h: c.length };
      offset += c.length + project.material.kerf;
      return { ...seg, group: c.group };
    });
  }

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
  const hasSecondary = $derived(cut.groups.some((g) => g.material === 'secondary'));
  const blocks = $derived([...new Set(cut.groups.map((g) => g.material))].map((material) => {
    const groups = cut.groups.filter((g) => g.material === material);
    return { material, thickness: groups[0]!.thickness, groups };
  }));
  const secondaryRefs = $derived(
    cut.groups
      .filter((g) => g.material === 'secondary')
      .map((g) => `#${g.number}`)
      .join(', '),
  );

  /** Compare packing choices using only that material's pieces, with separate counts and efficiency. */
  const packingMaterials = $derived<MaterialKind[]>(project.material.secondaryThickness !== undefined ? ['primary', 'secondary'] : ['primary']);
  const packings = $derived(packingMaterials.map((material) => {
    const packing = cutPacking(project, material);
    const groups = cut.groups.filter((g) => g.material === material);
    return {
      material,
      thickness: material === 'secondary' ? project.material.secondaryThickness ?? T : T,
      value: packing,
      info: CUT_LAYOUTS.find((l) => l.value === packing) ?? CUT_LAYOUTS[0],
      alternatives: new Map(CUT_LAYOUTS.map((l) => [l.value, planCuts({
        ...project,
        material: { ...project.material, [material === 'secondary' ? 'secondaryLayout' : 'layout']: l.value },
      }, { ...cut, groups })])),
    };
  }));

  /** Loads three.js on demand, like the 3D view, so the report stays light until it is asked for. */
  async function exportObj() {
    const { insertObj } = await import('./three/obj');
    download(`${slug(project.name)}.obj`, insertObj(project, solved, cut), 'model/obj');
  }

  function exportCsv() {
    const rows = [['#', 'Qty', 'Kind', 'Material', 'Thickness mm', 'Length mm', 'Height mm', 'Notches, lowered', 'Used in']];
    for (const g of cut.groups) rows.push([String(g.number), String(g.pieces.length), g.kind === 'base' ? panelUse(g) : 'strip', g.material, String(g.thickness), String(g.length), String(g.height), notchText(g), where(g)]);
    const csv = rows.map((r) => r.map((c) => (/[",;]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    download(`${slug(project.name)}-cut-list.csv`, csv, 'text/csv');
  }

</script>

<svelte:head>{@html `<style>@page { size: A4 portrait; margin: 12mm; }</style>`}</svelte:head>

<div class="scroll">
  <article class="report">
    <header>
      <div>
        <h1>{project.name}</h1>
        <p class="facts">
          Box inside {project.box.width} × {project.box.depth} × {project.box.height} mm · Primary material {mm(T)} mm{project.material.secondaryThickness !== undefined
            ? `, secondary material ${mm(project.material.secondaryThickness)} mm`
            : ''} ·
          {project.layers.map((l) => `${l.name} ${l.height} mm`).join(', ')} · {mm(solved.headroom)} mm headroom
        </p>
        <p class="facts">
          <b>{total}</b> pieces in <b>{cut.groups.length}</b> sizes from {sheetSummary(project, plan)} ({project.material.sheet.width} × {project.material.sheet.height} mm)
        </p>
      </div>
      <div class="actions no-print">
        <button class="primary" onclick={() => window.print()}>Print / Save PDF</button>
        <button onclick={exportCsv}>Cut list CSV</button>
        <button onclick={exportObj} data-tip="Every piece as a 3D solid (OBJ, in millimetres), for CAD, 3D printing or rendering">Download OBJ</button>
      </div>
    </header>

    {#if errors.length}
      <div class="issue error">
        <b>Fix before buying or cutting: the cut list below is incomplete or wrong.</b>
        <ul>
          {#each errors as e, i (i)}<li>{e.where ? `${e.where}: ` : ''}{e.message}</li>{/each}
        </ul>
      </div>
    {/if}
    {#if warnings.length}
      <div class="issue warn">
        <b>Check before cutting: the design was adjusted where it did not fit.</b>
        <ul>
          {#each warnings as w, i (i)}<li>{w.where ? `${w.where}: ` : ''}{w.message}</li>{/each}
        </ul>
      </div>
    {/if}

    <ReportOverview {project} {solved} {cut} />

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
          {project.construction === 'separate' ? 'Every compartment lifts out on its own, so the trays only fit back this way. ' : ''}Put the layers in bottom first;
          each view looks down on the box with its front edge at the bottom.
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
                  <text x={c.rect.x + c.rect.w / 2} y={c.rect.y + c.rect.h / 2} class="comp" style:fill={sectionInk(c.index)} font-size={size}>{c.label}</text>
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
                <b>{li + 1}. {layer.name}</b>, {layer.height} mm: {topTrays(layer.id).length === 1 ? 'tray' : 'trays'}
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
      <h2>Cut list</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Qty</th><th>Size (mm)</th><th>Notches, lowered</th><th>Used in</th></tr>
        </thead>
        {#each blocks as block (block.material)}
          <tbody class:own={block.material === 'secondary'}>
            <tr class="material"><th colspan="5">From {materialLabel(block.material, block.thickness)}</th></tr>
            {#each block.groups as g (g.key)}
              <tr>
                <td class="num">#{g.number}</td>
                <td class="qty">{g.pieces.length}</td>
                <td class="size">{mm(g.length)} × {mm(g.height)}{g.kind === 'base' ? ` ${panelUse(g)}` : ''}</td>
                <td>{notchText(g)}</td>
                <td class="muted">{where(g)}</td>
              </tr>
            {/each}
          </tbody>
        {/each}
      </table>
      <p class="muted small">
        Wall and divider sizes are length × height. Notch positions are centres measured from one end; flip the piece if the other end fits.
      </p>
    </section>

    <section>
      <h2>Cutting plan</h2>
      {#each packings as packing (packing.material)}
        <div class="packing-options" data-material={packing.material}>
          <h3>{materialLabel(packing.material, packing.thickness)} · Packing</h3>
          <div class="packings no-print" role="group" aria-label="{packing.material === 'secondary' ? 'Secondary' : 'Primary'} material packing">
            {#each CUT_LAYOUTS as l (l.value)}
              {@const alt = packing.alternatives.get(l.value)!}
              <button class="packing" class:on={packing.value === l.value} aria-pressed={packing.value === l.value} onclick={() => setCutLayout(project, l.value, packing.material)}>
                <b>{l.name}</b>
                <span>{sheetSummary(project, alt)}, {Math.round(alt.efficiency * 100)}% used</span>
              </button>
            {/each}
          </div>
          <p class="muted small"><b>{packing.info.name}.</b> {packing.info.detail}</p>
        </div>
      {/each}
      <p class="muted small">
        Trim {project.material.trim} mm off each sheet edge first.
        Cut out and number the rectangular pieces first{#if notchGroups.length || loweredGroups.length}; complete the notch and edge cuts below before assembly{/if}.
      </p>
      {#each plan.sheets as sheet (sheet.index)}
        {@const W = project.material.sheet.width}
        {@const H = project.material.sheet.height}
        {@const packingInfo = CUT_LAYOUTS.find((l) => l.value === cutPacking(project, sheet.material)) ?? CUT_LAYOUTS[0]}
        <div class="sheet">
          <svg viewBox="-2 -2 {W + 4} {H + 4}" class="sheet-svg" role="img" aria-label="Sheet {sheet.index + 1} packing">
            <rect width={W} height={H} class="paper" />
            <rect x={project.material.trim} y={project.material.trim} width={W - 2 * project.material.trim} height={H - 2 * project.material.trim} class="trim" />
            {#each sheet.items as item, i (i)}
              {#if item.kind === 'base'}
                <rect x={item.x} y={item.y} width={item.w} height={item.h} class="base" class:secondary={sheet.material === 'secondary'} />
                <text x={item.x + item.w / 2} y={item.y + item.h / 2} class="label big">#{item.group?.number}</text>
              {:else}
                {#each segments(item) as seg, j (j)}
                  <rect x={seg.x} y={seg.y} width={seg.w} height={seg.h} class="seg" class:secondary={sheet.material === 'secondary'} />
                  {#if Math.max(seg.w, seg.h) > 14}
                    <text x={seg.x + seg.w / 2} y={seg.y + seg.h / 2} class="label" font-size={Math.min(9, Math.min(seg.w, seg.h) * 0.55)}>#{seg.group}</text>
                  {/if}
                {/each}
              {/if}
            {/each}
          </svg>
          <div class="sheet-text">
            <h3>Sheet {sheet.index + 1} of {plan.sheets.length} · <span class:secondary-material={sheet.material === 'secondary'}>{materialLabel(sheet.material, sheet.thickness)}</span></h3>
            <p class="muted small">Packing: {packingInfo.name}.</p>
            <ol>
              {#each sheet.items as item, i (i)}
                <li>
                  {#if item.kind === 'base'}
                    {item.group ? panelUse(item.group) : 'Panel'} #{item.group?.number}: {mm(item.group?.length ?? 0)} × {mm(item.group?.height ?? 0)} mm
                    · <b class:secondary-material={sheet.material === 'secondary'}>{materialLabel(sheet.material, sheet.thickness)}</b>
                  {:else}
                    {stripText(item)}
                    · <b class:secondary-material={sheet.material === 'secondary'}>{materialLabel(sheet.material, sheet.thickness)}</b>
                  {/if}
                </li>
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
        {#each notchGroups as group (group.key)}<PieceCutting {group} />{/each}
      </section>
    {/if}
    {#if loweredGroups.length}
      <section class="lowered-cutting" aria-label="Lowered edge cutting">
        <h2>Lowered edge cutting</h2>
        <p>Cut these lowered stretches before gluing, using the same four-point marking method. A line on an existing outer edge needs no additional cut.</p>
        {#each loweredGroups as group (group.key)}<PieceCutting {group} kind="lowered" />{/each}
      </section>
    {/if}

    <section>
      <h2>Assembly</h2>
      <p class="muted small">Use the finished pieces. Match their numbered positions and orientations to each diagram, keeping notched wall and divider edges facing up.</p>
      {#if hasSecondary}
        <p class="material-note">
          Pieces {secondaryRefs} use <b>{materialLabel('secondary', project.material.secondaryThickness ?? T)}</b>, cut from separate sheets.
          All remaining pieces use {materialLabel('primary', T)}.
        </p>
      {/if}
      {#each assemblyTrays as t (t.id)}
        {@const pieces = trayAssemblyPieces(solved, t)}
        {@const topLid = t.stacked ? pieces.find((p) => p.kind === 'lid') : undefined}
        {@const comps = solved.compartments.filter((c) => c.trayId === t.id)}
        <div class="tray">
          <h3>
            Tray {t.number}{t.stacked ? ' (make 2)' : ''} · {layerName.get(t.layerId)}{t.depth === 1
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
                <rect x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h} style:fill={sectionColor(c.index, 90)} />
                {@const label = `${c.label}${c.stacked ? '²' : ''}${c.pad ? '*' : ''}`}
                {@const place = labelLayout(c.rect, Math.max(5, Math.min(18, Math.min(c.rect.w, c.rect.h) * 0.3)), label.length, !!c.node.arrow)}
                {@const size = place.size}
                <text x={place.letterX} y={c.rect.y + c.rect.h / 2 - size * 0.12} class="comp" style:fill={sectionInk(c.index)} font-size={size}>{label}</text>
                {#if place.arrow && c.node.arrow}
                  <path
                    d={arrowPath(place.arrow.len)}
                    transform="translate({place.arrow.x} {place.arrow.y}) rotate({ARROW_ANGLE[c.node.arrow]})"
                    class="item-arrow"
                    style:stroke={sectionInk(c.index)}
                    style:stroke-width={Math.max(0.6, size * 0.09)}
                  />
                {/if}
              {/each}
              {#each pieces.filter((p) => p.kind === 'wall' || p.kind === 'divider') as p (p.id)}
                <rect x={p.footprint.x} y={p.footprint.y} width={p.footprint.w} height={p.footprint.h} class="tray-piece" />
                {#each p.lowFrom as l, i (i)}
                  {#if p.axis === 'x'}
                    <rect x={p.start + l.from} y={p.footprint.y} width={l.to - l.from} height={p.footprint.h} class="tray-lowered" />
                  {:else}
                    <rect x={p.footprint.x} y={p.start + l.from} width={p.footprint.w} height={l.to - l.from} class="tray-lowered" />
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
              {#each pieces.filter((p) => (p.kind === 'wall' || p.kind === 'divider') && (p.axis === 'x' ? p.footprint.w : p.footprint.h) > 12) as p (p.id)}
                <g transform="translate({p.footprint.x + p.footprint.w / 2} {p.footprint.y + p.footprint.h / 2})">
                  <rect x={-5.5} y={-3} width={11} height={6} rx={1.5} class="tag" />
                  <text class="tag-text">{cut.groupOf.get(p.id)?.number}</text>
                </g>
              {/each}
              {#each pieces.filter((p) => p.kind === 'lid') as lid (lid.id)}
                <path d={polygonPath(lidOutline(lid.length, lid.height, lid.lidNotches), lid.footprint.x, lid.footprint.y)} class="tray-lid" />
                {#each lid.lidNotches ?? [] as notch (notch.side)}
                  <path d={polygonPath(lidNotchPoints(lid.length, lid.height, notch), lid.footprint.x, lid.footprint.y)} class="tray-lid-notch" />
                {/each}
                <text x={t.outer.x + t.outer.w / 2} y={t.outer.y - 5} class="front">{t.stacked ? 'TOP LID' : 'LID'} #{cut.groupOf.get(lid.id)?.number}</text>
              {/each}
              <text x={t.outer.x + t.outer.w / 2} y={t.outer.y + t.outer.h + 8} class="front">FRONT</text>
            </svg>
            <ol class="steps">
              {#each trayInstructions(project, solved, cut, t) as step, i (i)}
                <li>
                  {#if step.strong}<b class="strong">{step.strong}</b>{/if}
                  {#if i === 0 || step.material === 'secondary'}
                    <b class:secondary-material={step.material === 'secondary'}>{step.text}</b>
                  {:else}
                    {step.text}
                  {/if}
                  {#each step.notes as n, j (j)}
                    <span class="step-note {n.kind}"><b>{n.label}:</b> {n.text}</span>
                  {/each}
                </li>
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
            <h3>Shared lid · {layerName.get(t.layerId)} · over all separate boxes in {well.label} · {mm(sharedLid.length)} × {mm(sharedLid.height)} × {mm(sharedLid.thickness)} mm</h3>
            <div class="tray-body">
              <svg viewBox="{fp.x - 12} {fp.y - 12} {fp.w + 24} {fp.h + 30}" class="tray-svg" role="img" aria-label="Shared lid over all separate boxes in {well.label}">
                {#each boxes as box (box.id)}
                  <rect x={box.outer.x} y={box.outer.y} width={box.outer.w} height={box.outer.h} class="tray-base" />
                {/each}
                {#each solved.compartments.filter((c) => c.wellId === well.id) as c (c.id)}
                  {@const size = Math.max(5, Math.min(18, Math.min(c.rect.w, c.rect.h) * 0.3))}
                  <rect x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h} style:fill={sectionColor(c.index, 90)} />
                  <text x={c.rect.x + c.rect.w / 2} y={c.rect.y + c.rect.h / 2} class="comp" style:fill={sectionInk(c.index)} font-size={size}>{c.label}{c.stacked ? '²' : ''}</text>
                {/each}
                <path d={polygonPath(lidOutline(sharedLid.length, sharedLid.height, sharedLid.lidNotches), fp.x, fp.y)} class="tray-lid" />
                {#each sharedLid.lidNotches ?? [] as notch (notch.side)}
                  <path d={polygonPath(lidNotchPoints(sharedLid.length, sharedLid.height, notch), fp.x, fp.y)} class="tray-lid-notch" />
                {/each}
                <text x={fp.x + fp.w / 2} y={fp.y - 5} class="front">SHARED LID #{cut.groupOf.get(sharedLid.id)?.number}</text>
                <text x={fp.x + fp.w / 2} y={fp.y + fp.h + 8} class="front">FRONT</text>
              </svg>
              <ol class="steps">
                {#each sharedLidInstructions(project, solved, cut, sharedLid) as step, i (i)}
                  <li>
                    {#if step.material}<b class:secondary-material={step.material === 'secondary'}>{step.text}</b>{:else}{step.text}{/if}
                    {#each step.notes as n, j (j)}
                      <span class="step-note {n.kind}"><b>{n.label}:</b> {n.text}</span>
                    {/each}
                  </li>
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
    padding: 24px 16px;
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
    margin: 0 auto;
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
    flex-direction: column;
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
  .paper {
    fill: #f7f5f0;
    stroke: #22201c;
    stroke-width: 1;
  }
  .trim {
    fill: none;
    stroke: #b8b1a4;
    stroke-width: 0.8;
    stroke-dasharray: 4 3;
  }
  .base {
    fill: #d9d2c3;
    stroke: #22201c;
    stroke-width: 0.8;
  }
  .base.secondary {
    fill: #dfd6f1;
    stroke: #60418a;
  }
  .seg.secondary {
    fill: #dfd6f1;
    stroke: #60418a;
  }
  .secondary-material {
    color: #60418a;
  }
  .seg {
    fill: #ece6da;
    stroke: #22201c;
    stroke-width: 0.6;
  }
  .label {
    text-anchor: middle;
    dominant-baseline: central;
    font-weight: 700;
    fill: #22201c;
  }
  .label.big {
    font-size: 26px;
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
  .tray-notch {
    fill: #f2b233;
  }
  .tray-lowered {
    fill: #9b7fd4;
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
      padding: 0;
      overflow: visible;
      height: auto;
    }
    .report {
      box-shadow: none;
      padding: 0;
      max-width: none;
    }
    .no-print {
      display: none;
    }
  }
</style>
