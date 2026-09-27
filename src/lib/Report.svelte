<script lang="ts">
  import { trayInstructions } from '../core/assembly';
  import { sectionColor, sectionInk } from '../core/defaults';
  import { mm } from '../core/geom';
  import type { Solved, Tray } from '../core/layout';
  import type { CutList, CutPlan, PieceGroup, SheetItem } from '../core/pieces';
  import type { Project } from '../core/types';
  import { download, slug } from './state.svelte';

  let { project, solved, cut, plan }: { project: Project; solved: Solved; cut: CutList; plan: CutPlan } = $props();

  const trayById = $derived(new Map(solved.trays.map((t) => [t.id, t])));
  const layerName = $derived(new Map(project.layers.map((l) => [l.id, l.name])));
  const total = $derived(cut.groups.reduce((a, g) => a + g.pieces.length, 0));
  const errors = $derived([...solved.issues, ...solved.layers.flatMap((l) => l.issues), ...plan.issues].filter((i) => i.level === 'error'));

  const wellLabel = (id?: string) => solved.compartments.find((c) => c.id === id)?.label ?? '?';
  const parentNumber = (id?: string) => (id ? trayById.get(id)?.number : undefined) ?? '?';

  function where(g: PieceGroup): string {
    const byTray = new Map<number, Map<string, number>>();
    for (const p of g.pieces) {
      // The upper box of a stack is built like the one below it; count it there.
      const tray = trayById.get(p.trayId)!;
      const t = tray.copyOf ? trayById.get(tray.copyOf)!.number : tray.number;
      const kind = p.kind === 'divider' ? 'divider' : p.kind === 'wall' ? 'wall' : 'base';
      const m = byTray.get(t) ?? new Map<string, number>();
      m.set(kind, (m.get(kind) ?? 0) + 1);
      byTray.set(t, m);
    }
    return [...byTray.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, m]) => `Tray ${t}: ${[...m.entries()].map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}`)
      .join('; ');
  }

  function notchText(g: PieceGroup): string {
    if (!g.notches.length) return '';
    return `${g.notches.length} × ${mm(g.notches[0].width)}×${mm(g.notches[0].depth)} at ${g.notches.map((n) => mm(n.center)).join(', ')} mm`;
  }

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
    const horizontal = item.w >= item.h;
    let offset = 0;
    return s.cuts.map((c) => {
      const seg = horizontal ? { x: item.x + offset, y: item.y, w: c.length, h: item.h } : { x: item.x, y: item.y + offset, w: item.w, h: c.length };
      offset += c.length + project.foam.kerf;
      return { ...seg, group: c.group };
    });
  }

  function trayView(t: Tray) {
    const pad = 12;
    return `${t.outer.x - pad} ${t.outer.y - pad} ${t.outer.w + 2 * pad} ${t.outer.h + 2 * pad + 6}`;
  }

  function exportCsv() {
    const rows = [['#', 'Qty', 'Kind', 'Length mm', 'Height mm', 'Notches', 'Used in']];
    for (const g of cut.groups) rows.push([String(g.number), String(g.pieces.length), g.kind === 'base' ? 'base' : 'strip', String(g.length), String(g.height), notchText(g), where(g)]);
    const csv = rows.map((r) => r.map((c) => (/[",;]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    download(`${slug(project.name)}-cut-list.csv`, csv, 'text/csv');
  }

  const notchPath = $derived.by(() => {
    const w = project.notch.width;
    const d = project.notch.depth;
    const r = Math.min(w / 2, d);
    return `M1 1 L${1 + w / 2 - r} 1 L${1 + w / 2 - r} ${1 + d - r} A${r} ${r} 0 0 0 ${1 + w / 2 + r} ${1 + d - r} L${1 + w / 2 + r} 1 L${1 + w} 1`;
  });
</script>

<svelte:head>{@html `<style>@page { size: A4 portrait; margin: 12mm; }</style>`}</svelte:head>

<div class="scroll">
  <article class="report">
    <header>
      <div>
        <h1>{project.name}</h1>
        <p class="facts">
          Box inside {project.box.width} × {project.box.depth} × {project.box.height} mm · {project.foam.thickness} mm foam board ·
          {project.layers.map((l) => `${l.name} ${l.height} mm`).join(', ')} · {solved.headroom.toFixed(1)} mm left above
        </p>
        <p class="facts">
          <b>{total}</b> pieces in <b>{cut.groups.length}</b> sizes from <b>{plan.sheets.length}</b>
          {project.foam.sheet.preset} sheet{plan.sheets.length === 1 ? '' : 's'} ({project.foam.sheet.width} × {project.foam.sheet.height} mm)
        </p>
      </div>
      <div class="actions no-print">
        <button class="primary" onclick={() => window.print()}>Print / Save PDF</button>
        <button onclick={exportCsv}>Cut list CSV</button>
      </div>
    </header>

    {#each errors as e, i (i)}
      <div class="issue error">{e.message}</div>
    {/each}

    <section>
      <h2>Cut list</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Qty</th><th>Size (mm)</th><th>Notches</th><th>Used in</th></tr>
        </thead>
        <tbody>
          {#each cut.groups as g (g.key)}
            <tr>
              <td class="num">#{g.number}</td>
              <td class="qty">{g.pieces.length}</td>
              <td class="size">{mm(g.length)} × {mm(g.height)}{g.kind === 'base' ? ' base' : ''}</td>
              <td>{notchText(g)}</td>
              <td class="muted">{where(g)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="muted small">
        Wall and divider sizes are length × height. Notch positions are centres measured from one end; flip the piece if the other end fits.
      </p>
    </section>

    <section>
      <h2>Cutting plan</h2>
      <p class="muted small">
        Trim {project.foam.trim} mm off each sheet edge. Cut the bases, then cut each strip to its width across the sheet and chop it into the listed lengths.
      </p>
      {#each plan.sheets as sheet (sheet.index)}
        {@const W = project.foam.sheet.width}
        {@const H = project.foam.sheet.height}
        <div class="sheet">
          <svg viewBox="-2 -2 {W + 4} {H + 4}" class="sheet-svg" role="img" aria-label="Sheet {sheet.index + 1} layout">
            <rect width={W} height={H} class="paper" />
            <rect x={project.foam.trim} y={project.foam.trim} width={W - 2 * project.foam.trim} height={H - 2 * project.foam.trim} class="trim" />
            {#each sheet.items as item, i (i)}
              {#if item.kind === 'base'}
                <rect x={item.x} y={item.y} width={item.w} height={item.h} class="base" />
                <text x={item.x + item.w / 2} y={item.y + item.h / 2} class="label big">#{item.group?.number}</text>
              {:else}
                {#each segments(item) as seg, j (j)}
                  <rect x={seg.x} y={seg.y} width={seg.w} height={seg.h} class="seg" />
                  {#if Math.max(seg.w, seg.h) > 14}
                    <text x={seg.x + seg.w / 2} y={seg.y + seg.h / 2} class="label" font-size={Math.min(9, Math.min(seg.w, seg.h) * 0.55)}>#{seg.group}</text>
                  {/if}
                {/each}
              {/if}
            {/each}
          </svg>
          <div class="sheet-text">
            <h3>Sheet {sheet.index + 1} of {plan.sheets.length}</h3>
            <ol>
              {#each sheet.items as item, i (i)}
                <li>
                  {#if item.kind === 'base'}
                    Base #{item.group?.number}: {mm(item.group?.length ?? 0)} × {mm(item.group?.height ?? 0)} mm
                  {:else}
                    {stripText(item)}
                  {/if}
                </li>
              {/each}
            </ol>
          </div>
        </div>
      {/each}
    </section>

    <section>
      <h2>Assembly</h2>
      <p class="muted small">
        Glue with thick PVA along the whole edge; hold pieces with pins pushed in at opposite angles while it dries. Check each corner is square before
        the glue sets.
      </p>
      {#each solved.trays.filter((t) => !t.copyOf) as t (t.id)}
        {@const pieces = solved.pieces.filter((p) => p.trayId === t.id)}
        {@const comps = solved.compartments.filter((c) => c.trayId === t.id)}
        <div class="tray">
          <h3>
            Tray {t.number}{t.stacked ? ' (make 2)' : ''} · {layerName.get(t.layerId)}{t.depth === 1
              ? ` · ${t.stacked ? 'two boxes stacked' : 'box standing'} in ${wellLabel(t.wellId)} of tray ${parentNumber(t.parentTrayId)}`
              : ''} ·
            {mm(t.outer.w)} × {mm(t.outer.h)} × {mm(t.height)} mm · compartments {t.compartments.join(', ')}
          </h3>
          <div class="tray-body">
            <svg viewBox={trayView(t)} class="tray-svg" role="img" aria-label="Tray {t.number} top view">
              {#each pieces.filter((p) => p.kind === 'base') as b (b.id)}
                <rect x={b.footprint.x} y={b.footprint.y} width={b.footprint.w} height={b.footprint.h} class="tray-base" />
              {/each}
              {#each comps as c (c.id)}
                <rect x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h} fill={sectionColor(c.index, 90)} />
                <text x={c.rect.x + c.rect.w / 2} y={c.rect.y + c.rect.h / 2} class="comp" fill={sectionInk(c.index)} font-size={Math.max(5, Math.min(18, Math.min(c.rect.w, c.rect.h) * 0.3))}
                  >{c.label}</text
                >
              {/each}
              {#each pieces.filter((p) => p.kind !== 'base') as p (p.id)}
                <rect x={p.footprint.x} y={p.footprint.y} width={p.footprint.w} height={p.footprint.h} class="tray-piece" />
                {#each p.notches as n, i (i)}
                  {#if p.axis === 'x'}
                    <rect x={p.start + n.center - n.width / 2} y={p.footprint.y} width={n.width} height={p.footprint.h} class="tray-notch" />
                  {:else}
                    <rect x={p.footprint.x} y={p.start + n.center - n.width / 2} width={p.footprint.w} height={n.width} class="tray-notch" />
                  {/if}
                {/each}
              {/each}
              {#each pieces.filter((p) => p.kind !== 'base' && (p.axis === 'x' ? p.footprint.w : p.footprint.h) > 12) as p (p.id)}
                <g transform="translate({p.footprint.x + p.footprint.w / 2} {p.footprint.y + p.footprint.h / 2})">
                  <rect x={-5.5} y={-3} width={11} height={6} rx={1.5} class="tag" />
                  <text class="tag-text">{cut.groupOf.get(p.id)?.number}</text>
                </g>
              {/each}
              <text x={t.outer.x + t.outer.w / 2} y={t.outer.y + t.outer.h + 8} class="front">FRONT</text>
            </svg>
            <ol class="steps">
              {#each trayInstructions(project, solved, cut, t) as step, i (i)}
                <li>{step.text}</li>
              {/each}
            </ol>
          </div>
        </div>
      {/each}
    </section>

    <section class="template">
      <h2>Finger notch template</h2>
      <p class="muted small">Printed at 100% this is the real {project.notch.width} × {project.notch.depth} mm notch. Trace it at each notch mark, open side on the top edge.</p>
      <svg
        width="{project.notch.width + 2}mm"
        height="{project.notch.depth + 2}mm"
        viewBox="0 0 {project.notch.width + 2} {project.notch.depth + 2}"
        role="img"
        aria-label="Notch template"
      >
        <path d={notchPath} fill="none" stroke="#22201c" stroke-width="0.3" />
      </svg>
    </section>
  </article>
</div>

<style>
  .scroll {
    overflow-y: auto;
    height: 100%;
    padding: 24px 16px;
  }
  .report {
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
  .tray-piece {
    fill: #3f3b35;
  }
  .tray-notch {
    fill: #f2b233;
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
  .template svg {
    display: block;
    margin-top: 6px;
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
