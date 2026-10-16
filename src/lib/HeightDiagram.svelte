<script lang="ts">
  import { mm } from '../core/geom';
  import { layerBaseThickness, type Solved } from '../core/layout';
  import type { Project } from '../core/types';
  import { dimensionArrow } from './dimension';

  /**
   * A side view of the box's edge, to scale: every layer's base and outer wall (or the dividers
   * running out to the box, where it has none), measured up the box's height, the edited layer's
   * walls, and the headroom left above the layers.
   */
  let { project, solved, layerId, width = 176, height = 150 }: { project: Project; solved: Solved; layerId: string; width?: number; height?: number } = $props();

  /** Box side and floor, drawn this thick. */
  const SHELL = 4;
  /** Where the box's inside starts, right of the box's own dimension. */
  const LEFT = 22;
  /** Where the section is cut off, and the edited layer's dimension line. */
  const CUT = 84;
  const COL = 96;
  const TOP = 8;
  const BOTTOM = $derived(height - 6 - SHELL);

  const total = $derived(project.layers.reduce((a, l) => a + l.height, 0));
  const scale = $derived((BOTTOM - TOP) / Math.max(project.box.height, total, 1));
  const y = (z: number) => BOTTOM - z * scale;
  /** Horizontal mm to pixels at the same scale, never too thin to see. */
  const across = (mm: number, min = 0) => Math.max(min, mm * scale);

  const layers = $derived.by(() => {
    let z = 0;
    return project.layers.map((layer, i) => {
      const sl = solved.layers[i]!;
      const base = layerBaseThickness(project, layer);
      const walls = sl.pieces.some((p) => p.depth === 0 && p.kind === 'wall');
      const dividers = sl.pieces.some((p) => p.depth === 0 && p.kind === 'divider');
      const out = { id: layer.id, z, height: layer.height, base, walls, dividers };
      z += layer.height;
      return out;
    });
  });

  const gap = $derived(LEFT + across(project.clearance / 2));
  const wallW = $derived(across(project.material.thickness, 2));

  /** What stands at the box's edge in the edited layer, and from where to where. */
  const current = $derived(layers.find((l) => l.id === layerId) ?? layers[layers.length - 1]!);
  const standing = $derived.by(() => {
    const l = current;
    const onBase = !l.walls || project.base === 'under';
    return { name: l.walls ? 'Walls' : 'Dividers', from: l.z + (onBase ? l.base : 0), to: l.z + l.height };
  });
  const headroom = $derived(project.box.height - total);

  /**
   * Label centres for the edited layer's walls and the headroom, beside their dimension lines,
   * pushed apart where those are too short to keep the labels clear of each other.
   */
  const LABEL = 30;
  const labels = $derived.by(() => {
    const wall = (y(standing.from) + y(standing.to)) / 2;
    const room = (y(total) + y(project.box.height)) / 2;
    let [a, b] = [Math.min(room, wall), Math.max(room, wall)];
    if (b - a < LABEL) {
      const mid = (a + b) / 2;
      [a, b] = [mid - LABEL / 2, mid + LABEL / 2];
    }
    const shift = Math.max(0, TOP + LABEL / 2 - a) - Math.max(0, b - (height - LABEL / 2));
    [a, b] = [a + shift, b + shift];
    return room <= wall ? { room: a, wall: b } : { room: b, wall: a };
  });

  const arrow = (from: number, to: number, x: number) => (Math.abs(y(from) - y(to)) > 1 ? dimensionArrow([x, y(from)], [x, y(to)], 4) : '');
  const boxMid = $derived((y(0) + y(project.box.height)) / 2);
  const boxText = $derived(`Box ${mm(project.box.height)} mm`);
</script>

<svg class="height" viewBox="0 0 {width} {height}" {width} {height} role="img" aria-label="Side view at the box edge: box {mm(project.box.height)} mm, {standing.name.toLowerCase()} {mm(standing.to - standing.from)} mm, headroom {mm(headroom)} mm">
  <!-- The box: its inside, side and floor, and its top where the lid closes. -->
  <rect x={LEFT} y={y(project.box.height)} width={CUT - LEFT} height={y(0) - y(project.box.height)} class="inside" />
  <rect x={LEFT - SHELL} y={y(project.box.height)} width={SHELL} height={y(0) - y(project.box.height) + SHELL} class="shell" />
  <rect x={LEFT - SHELL} y={y(0)} width={CUT - LEFT + SHELL} height={SHELL} class="shell" />
  <line x1={LEFT - SHELL} x2={CUT} y1={y(project.box.height)} y2={y(project.box.height)} class="lid" />

  {#each layers as l (l.id)}
    {@const on = l.id === current.id}
    {@const baseFrom = l.walls && project.base === 'inside' ? gap + wallW : gap}
    {#if l.base}
      <rect x={baseFrom} y={y(l.z + l.base)} width={CUT - baseFrom} height={y(l.z) - y(l.z + l.base)} class="base" class:on />
    {/if}
    {#if l.walls}
      {@const from = project.base === 'under' ? l.z + l.base : l.z}
      <rect x={gap} y={y(l.z + l.height)} width={wallW} height={y(from) - y(l.z + l.height)} class="wall" class:on />
    {:else if l.dividers}
      <!-- No wall here: the side of a divider running out to the box. -->
      <rect x={gap} y={y(l.z + l.height)} width={CUT - gap} height={y(l.z + l.base) - y(l.z + l.height)} class="divider" class:on />
    {/if}
  {/each}

  <!-- Extension lines out to the dimensions. -->
  {#each [standing.from, standing.to, total, project.box.height] as z, i (i)}
    <line x1={CUT + 2} x2={COL + 4} y1={y(z)} y2={y(z)} class="ext" />
  {/each}

  <path d={arrow(0, project.box.height, LEFT - SHELL - 8)} class="dim" />
  <g transform="translate({LEFT - SHELL - 8} {boxMid}) rotate(-90)">
    <rect x={-boxText.length * 3.2 - 3} y={-7} width={boxText.length * 6.4 + 6} height={14} rx={2} class="chip" />
    <text class="value" text-anchor="middle" dominant-baseline="central">{boxText}</text>
  </g>

  <path d={arrow(standing.from, standing.to, COL)} class="dim on" />
  <text x={COL + 7} y={labels.wall - 2} class="name">{standing.name}</text>
  <text x={COL + 7} y={labels.wall + 11} class="value on">{mm(standing.to - standing.from)} mm</text>

  <path d={arrow(total, project.box.height, COL)} class="dim" class:bad={headroom < 0} />
  <text x={COL + 7} y={labels.room - 2} class="name" class:bad={headroom < 0}>{headroom < 0 ? 'Too tall by' : 'Headroom'}</text>
  <text x={COL + 7} y={labels.room + 11} class="value" class:bad={headroom < 0}>{mm(Math.abs(headroom))} mm</text>
</svg>

<style>
  .height {
    display: block;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel) 85%, transparent);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  }
  .inside {
    fill: var(--canvas-box);
  }
  .shell {
    fill: var(--canvas-edge);
  }
  .lid {
    stroke: var(--canvas-edge);
    stroke-dasharray: 3 2;
  }
  .base {
    fill: var(--canvas-base);
  }
  .wall {
    fill: var(--piece-inner);
  }
  .divider {
    fill: var(--piece-inner);
    opacity: 0.35;
  }
  .base.on {
    fill: color-mix(in srgb, var(--accent) 45%, var(--canvas-base));
  }
  .wall.on,
  .divider.on {
    fill: var(--accent);
  }
  .ext {
    stroke: var(--line-strong);
    stroke-width: 0.75;
  }
  .dim {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1;
  }
  .dim.on {
    stroke: var(--accent);
  }
  .chip {
    fill: var(--panel);
  }
  text {
    font-size: 11px;
  }
  .name {
    fill: var(--muted);
  }
  .value {
    fill: var(--text);
    font-weight: 600;
  }
  .value.on {
    fill: var(--accent);
  }
  .dim.bad {
    stroke: var(--error);
  }
  .name.bad,
  .value.bad {
    fill: var(--error);
  }
</style>
