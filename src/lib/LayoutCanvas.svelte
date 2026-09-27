<script lang="ts">
  import { sectionColor, sectionInk } from '../core/defaults';
  import { dragBar, findSplit, sectionIds } from '../core/edit';
  import { mm } from '../core/geom';
  import type { Bar, PieceInst, SolvedLayer } from '../core/layout';
  import type { CutList } from '../core/pieces';
  import type { Layer, Project } from '../core/types';
  import type { Selection } from './state.svelte';

  let {
    project,
    layer,
    solved,
    cut,
    selected,
    hoverGroup,
    showNumbers,
    onselect,
  }: {
    project: Project;
    layer: Layer;
    solved: SolvedLayer;
    cut: CutList;
    selected: Selection;
    hoverGroup: number | null;
    showNumbers: boolean;
    onselect: (s: Selection) => void;
  } = $props();

  let svg: SVGSVGElement;
  /** Rendered size of the canvas, so dimension text can stay about 12 px on screen. */
  let viewPx = $state({ w: 800, h: 600 });
  $effect(() => {
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) viewPx = { w: r.width, h: r.height };
    });
    ro.observe(svg);
    return () => ro.disconnect();
  });
  const pxPerMm = $derived(Math.min(viewPx.w / (project.box.width * 1.2), viewPx.h / (project.box.depth * 1.25)));
  /** Dimension text size in mm, chosen so it renders at roughly 12 px. */
  const fs = $derived(Math.max(3, Math.min(12, 12 / pxPerMm)));
  const padStart = $derived(fs * 4.4);
  const padEnd = $derived(fs * 1.4);
  const tierOuter = $derived(-fs * 3.1);
  const tierInner = $derived(-fs * 1.3);
  const W = $derived(project.box.width);
  const D = $derived(project.box.depth);

  let drag: { bar: Bar; start: number; sizes: number[]; targets: number[] } | null = null;

  function toMm(e: PointerEvent) {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  /** Sizes already used along the same axis, so a dragged bar can snap to them. */
  function snapTargets(bar: Bar): number[] {
    const out = new Set<number>();
    if (bar.join === 'divider') {
      const split = findSplit(layer.root, bar.splitId);
      const moving = new Set(split ? [...sectionIds(split.children[bar.index].node), ...sectionIds(split.children[bar.index + 1].node)] : []);
      for (const c of solved.compartments) {
        if (!moving.has(c.id)) out.add(Math.round((bar.dir === 'row' ? c.rect.w : c.rect.h) * 10) / 10);
      }
    } else {
      for (const t of solved.trays) out.add(Math.round((bar.dir === 'row' ? t.outer.w : t.outer.h) * 10) / 10);
    }
    for (const s of solved.splits) {
      if (s.node.dir !== bar.dir || s.node.join !== bar.join) continue;
      s.childSizes.forEach((v, i) => {
        if (s.id === bar.splitId && (i === bar.index || i === bar.index + 1)) return;
        out.add(Math.round(v * 10) / 10);
      });
    }
    return [...out];
  }

  function barDown(e: PointerEvent, bar: Bar) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const split = solved.splits.find((s) => s.id === bar.splitId);
    if (!split) return;
    const p = toMm(e);
    drag = { bar, start: bar.dir === 'row' ? p.x : p.y, sizes: [...split.childSizes], targets: snapTargets(bar) };
    onselect({ kind: 'split', id: bar.splitId });
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const p = toMm(e);
    const split = findSplit(layer.root, drag.bar.splitId);
    if (split) dragBar(split, drag.bar.index, drag.sizes, (drag.bar.dir === 'row' ? p.x : p.y) - drag.start, drag.targets);
  }

  function up() {
    drag = null;
  }

  const selectedSplit = $derived(selected?.kind === 'split' ? selected.id : null);

  interface Span {
    from: number;
    to: number;
    label: string;
  }

  /**
   * Inner row of dimensions: the selected compartment's width and depth, or every part of the
   * selected split along its axis (compartment insides for dividers, tray outsides for trays).
   */
  const guides = $derived.by((): { x: Span[]; y: Span[] } => {
    if (selected?.kind === 'section') {
      const c = solved.compartments.find((x) => x.id === selected.id);
      if (!c) return { x: [], y: [] };
      return {
        x: [{ from: c.rect.x, to: c.rect.x + c.rect.w, label: mm(c.rect.w) }],
        y: [{ from: c.rect.y, to: c.rect.y + c.rect.h, label: mm(c.rect.h) }],
      };
    }
    if (selected?.kind === 'split') {
      const sp = solved.splits.find((x) => x.id === selected.id);
      if (!sp) return { x: [], y: [] };
      const row = sp.node.dir === 'row';
      const trays = sp.node.join === 'trays';
      const c = project.clearance;
      let cursor = row ? sp.rect.x : sp.rect.y;
      const spans = sp.childSizes.map((size) => {
        const from = trays ? cursor + c / 2 : cursor;
        cursor += trays ? size + c : size + project.material.thickness;
        return { from, to: from + size, label: mm(size) };
      });
      return row ? { x: spans, y: [] } : { x: [], y: spans };
    }
    return { x: [], y: [] };
  });
  const labelSize = (w: number, h: number) => Math.max(5, Math.min(30, Math.min(w, h) * 0.34));

  /** Largest font size (mm) up to `wanted` at which `text` fits `width` with a little margin. */
  const fitText = (text: string, width: number, wanted: number) => Math.min(wanted, (width - 2) / (text.length * 0.6));
  /** Text smaller than this many screen pixels is hidden rather than squeezed. */
  const readable = (size: number) => size * pxPerMm >= 7;

  function pieceFill(p: PieceInst): string {
    const g = cut.groupOf.get(p.id)?.number;
    if (hoverGroup !== null && g === hoverGroup) return 'var(--accent)';
    if (p.kind === 'divider' && p.splitId === selectedSplit) return '#6d8fd6';
    if (p.depth === 1) return '#6a6258';
    return '#3f3b35';
  }

  // The upper box of a stack sits exactly over the lower one; draw one of them.
  const strips = $derived(solved.pieces.filter((p) => p.kind !== 'base' && !p.copy));
  const bases = $derived(solved.pieces.filter((p) => p.kind === 'base' && !p.copy));
</script>

<svg
  bind:this={svg}
  class="canvas"
  viewBox="{-padStart} {-padStart} {W + padStart + padEnd} {D + padStart + fs * 2.4}"
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onpointerdown={() => onselect(null)}
  role="application"
  aria-label="Top view of {layer.name}"
>
  <rect x={0} y={0} width={W} height={D} class="box" />

  <!-- Trays of the layer first, then removable boxes standing in their compartments. -->
  {#each [0, 1] as depth (depth)}
    {#each bases.filter((b) => b.depth === depth) as b (b.id)}
      {@const hot = hoverGroup !== null && cut.groupOf.get(b.id)?.number === hoverGroup}
      <rect x={b.footprint.x} y={b.footprint.y} width={b.footprint.w} height={b.footprint.h} class="base" class:inner={depth === 1} class:hot />
    {/each}

    {#if depth === 1}
      {#each solved.trays.filter((t) => t.depth === 1 && !t.copyOf) as t (t.id)}
        <!-- Clicking a box's walls selects the compartment it stands in. -->
        <rect
          x={t.outer.x}
          y={t.outer.y}
          width={t.outer.w}
          height={t.outer.h}
          class="box-hit"
          onpointerdown={(e) => {
            e.stopPropagation();
            if (t.wellId) onselect({ kind: 'section', id: t.wellId });
          }}
          role="button"
          tabindex="-1"
        />
      {/each}
    {/if}

    {#each solved.compartments.filter((c) => c.depth === depth) as c (c.id)}
      {@const isSel = selected?.kind === 'section' && selected.id === c.id}
      {@const label = c.label + (c.stacked ? '²' : '')}
      {@const size = fitText(label, c.rect.w, labelSize(c.rect.w, c.rect.h))}
      {@const dimsText = `${mm(c.rect.w)} × ${mm(c.rect.h)}`}
      {@const dims = fitText(dimsText, c.rect.w, Math.max(3, Math.min(5, size * 0.3)))}
      <g
        class="compartment"
        onpointerdown={(e) => {
          e.stopPropagation();
          onselect({ kind: 'section', id: c.id });
        }}
        role="button"
        tabindex="-1"
      >
        <rect
          x={c.rect.x}
          y={c.rect.y}
          width={Math.max(0, c.rect.w)}
          height={Math.max(0, c.rect.h)}
          fill={sectionColor(c.index, depth === 1 ? 93 : 88)}
          class:sel={isSel}
          class:well={!!c.node.insert && depth === 0}
        />
        {#if size > 0}
          <text x={c.rect.x + c.rect.w / 2} y={c.rect.y + c.rect.h / 2 - size * 0.12} font-size={size} fill={sectionInk(c.index)} class="letter">{label}</text>
        {/if}
        {#if c.rect.h > 14 && readable(dims)}
          <text x={c.rect.x + c.rect.w / 2} y={c.rect.y + c.rect.h / 2 + size * 0.5} font-size={dims} fill={sectionInk(c.index)} class="dims">{dimsText}</text>
        {/if}
      </g>
    {/each}

    {#each strips.filter((p) => p.depth === depth) as p (p.id)}
      <rect x={p.footprint.x} y={p.footprint.y} width={Math.max(0, p.footprint.w)} height={Math.max(0, p.footprint.h)} fill={pieceFill(p)} class="piece" />
      {#each p.notches as n, i (i)}
        {#if p.axis === 'x'}
          <rect x={p.start + n.center - n.width / 2} y={p.footprint.y} width={n.width} height={p.footprint.h} class="notch" />
        {:else}
          <rect x={p.footprint.x} y={p.start + n.center - n.width / 2} width={p.footprint.w} height={n.width} class="notch" />
        {/if}
      {/each}
    {/each}
  {/each}

  {#if showNumbers}
    {#each strips as p (p.id)}
      {@const long = p.axis === 'x' ? p.footprint.w : p.footprint.h}
      {#if long > 14}
        <g transform="translate({p.footprint.x + p.footprint.w / 2} {p.footprint.y + p.footprint.h / 2}) rotate({p.axis === 'y' ? 90 : 0})">
          <rect x={-5} y={-2.6} width={10} height={5.2} rx={1.2} class="tag" />
          <text class="tag-text">{cut.groupOf.get(p.id)?.number}</text>
        </g>
      {/if}
    {/each}
  {/if}

  {#each solved.bars as bar (bar.splitId + ':' + bar.index)}
    {@const vertical = bar.dir === 'row'}
    {@const hit = Math.max(bar.thickness, 4)}
    <rect
      x={vertical ? bar.pos - hit / 2 : bar.from}
      y={vertical ? bar.from : bar.pos - hit / 2}
      width={vertical ? hit : bar.to - bar.from}
      height={vertical ? bar.to - bar.from : hit}
      class="hit"
      class:trays={bar.join === 'trays'}
      class:sel={selectedSplit === bar.splitId}
      style:cursor={vertical ? 'ew-resize' : 'ns-resize'}
      onpointerdown={(e) => barDown(e, bar)}
      role="separator"
      tabindex="-1"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
    />
  {/each}

  <!-- Dimensions: box inside size on the outer row, selection on the inner row. -->
  {#snippet hdim(from: number, to: number, y: number, label: string, strong: boolean)}
    <g class="dim" class:strong>
      <line x1={from} x2={to} y1={y} y2={y} />
      <line x1={from} x2={from} y1={y - fs * 0.45} y2={y + fs * 0.45} />
      <line x1={to} x2={to} y1={y - fs * 0.45} y2={y + fs * 0.45} />
      {#if to - from >= fs * 1.6}
        <text x={(from + to) / 2} y={y - fs * 0.3} font-size={fs}>{label}</text>
      {/if}
    </g>
  {/snippet}
  {#snippet vdim(from: number, to: number, x: number, label: string, strong: boolean)}
    <g class="dim" class:strong>
      <line x1={x} x2={x} y1={from} y2={to} />
      <line x1={x - fs * 0.45} x2={x + fs * 0.45} y1={from} y2={from} />
      <line x1={x - fs * 0.45} x2={x + fs * 0.45} y1={to} y2={to} />
      {#if to - from >= fs * 1.6}
        <text x={x - fs * 0.3} y={(from + to) / 2} font-size={fs} transform="rotate(-90 {x - fs * 0.3} {(from + to) / 2})">{label}</text>
      {/if}
    </g>
  {/snippet}

  {@render hdim(0, W, tierOuter, `${mm(W)} mm`, true)}
  {@render vdim(0, D, tierOuter, `${mm(D)} mm`, true)}
  {#each guides.x as g, i (i)}
    <line class="ext" x1={g.from} x2={g.from} y1={tierInner - fs * 0.45} y2={0} />
    <line class="ext" x1={g.to} x2={g.to} y1={tierInner - fs * 0.45} y2={0} />
    {@render hdim(g.from, g.to, tierInner, g.label, false)}
  {/each}
  {#each guides.y as g, i (i)}
    <line class="ext" y1={g.from} y2={g.from} x1={tierInner - fs * 0.45} x2={0} />
    <line class="ext" y1={g.to} y2={g.to} x1={tierInner - fs * 0.45} x2={0} />
    {@render vdim(g.from, g.to, tierInner, g.label, false)}
  {/each}

  <text x={W / 2} y={D + fs * 1.8} class="front" font-size={fs * 0.9}>FRONT</text>
</svg>

<style>
  .canvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    user-select: none;
  }
  .canvas :focus {
    outline: none;
  }
  .box {
    fill: #fbfaf7;
    stroke: #8a8378;
    stroke-width: 0.4;
    stroke-dasharray: 2 1.5;
  }
  .base {
    fill: #cfc8bb;
  }
  .base.inner {
    fill: #e2dccf;
  }
  .box-hit {
    fill: transparent;
    cursor: pointer;
  }
  .compartment rect.well {
    stroke: #8a8378;
    stroke-width: 0.3;
    stroke-dasharray: 1.5 1;
  }
  .base.hot {
    fill: var(--accent-soft);
    stroke: var(--accent);
    stroke-width: 1;
  }
  .compartment rect {
    cursor: pointer;
  }
  .compartment rect.sel {
    stroke: var(--accent);
    stroke-width: 1.2;
  }
  .piece {
    pointer-events: none;
  }
  .notch {
    fill: #f2b233;
    pointer-events: none;
  }
  .letter {
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }
  .dims {
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
  .tag {
    fill: #fff;
    stroke: #3f3b35;
    stroke-width: 0.3;
    pointer-events: none;
  }
  .tag-text {
    font-size: 3.6px;
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
    fill: #22201c;
    pointer-events: none;
  }
  .hit {
    fill: transparent;
  }
  .hit.trays {
    fill: rgba(0, 0, 0, 0.04);
  }
  .hit:hover,
  .hit.sel {
    fill: rgba(47, 111, 219, 0.28);
  }
  .dim line {
    stroke: var(--accent);
    stroke-width: 0.3;
  }
  .dim text {
    fill: var(--accent);
    text-anchor: middle;
    font-variant-numeric: tabular-nums;
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 1.2px;
    stroke-linejoin: round;
  }
  .dim.strong line {
    stroke: #6f6a61;
  }
  .dim.strong text {
    fill: #3f3b35;
    font-weight: 600;
  }
  .ext {
    stroke: var(--accent);
    stroke-width: 0.2;
    stroke-dasharray: 1 0.8;
    opacity: 0.7;
    pointer-events: none;
  }
  .dim {
    pointer-events: none;
  }
  .front {
    font-weight: 700;
    letter-spacing: 1px;
    text-anchor: middle;
    fill: #6f6a61;
  }
</style>
