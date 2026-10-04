<script lang="ts">
  import { groupCutPatterns, type CutPattern, type DetailCut } from '../core/cutting';
  import { mm } from '../core/geom';
  import { polygonPath } from '../core/lidNotches';
  import { materialLabel, type PieceGroup } from '../core/pieces';

  let { group, kind = 'notch' }: { group: PieceGroup; kind?: DetailCut } = $props();
  const patterns = $derived(groupCutPatterns(group, kind));
  const unit = $derived(Math.max(group.length / 240, group.height / 120));
  // Scale both axes equally so the detail retains the actual cut's proportions and slants.
  function detail(pattern: CutPattern): [number, number][] {
    const xs = pattern.points.map((p) => p.x);
    const ys = pattern.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const scale = Math.min(110 / (maxX - minX), 60 / (maxY - minY));
    const edge = pattern.points[0];
    if (pattern.edge === 'left' || pattern.edge === 'right') {
      const x = pattern.edge === 'left' ? 12 : 208;
      return pattern.points.map((p) => [x + (p.x - edge.x) * scale, 70 + (p.y - (minY + maxY) / 2) * scale]);
    }
    const y = pattern.edge === 'top' ? 30 : 110;
    return pattern.points.map((p) => [110 + (p.x - (minX + maxX) / 2) * scale, y + (p.y - edge.y) * scale]);
  }
  /**
   * Where a cut's number goes: inside the piece beside the cut's opening, just past its far end and
   * near its own edge, so cuts on opposite edges of a thin piece never put their numbers together.
   */
  function badgeAt(pattern: CutPattern) {
    const [a, , , d] = pattern.points;
    const r = 5 * unit;
    const off = r + unit;
    const keep = (v: number, size: number) => Math.min(size - r, Math.max(r, v));
    const across = pattern.edge === 'top' || pattern.edge === 'bottom';
    const [lo, hi] = across ? [Math.min(a!.x, d!.x), Math.max(a!.x, d!.x)] : [Math.min(a!.y, d!.y), Math.max(a!.y, d!.y)];
    const length = across ? group.length : group.height;
    const along = keep(hi + off <= length - r ? hi + off : lo - off, length);
    if (across) return { x: along, y: keep(pattern.edge === 'top' ? off : group.height - off, group.height) };
    return { x: keep(pattern.edge === 'left' ? off : group.length - off, group.length), y: along };
  }
  function labelPosition(pattern: CutPattern, corners: [number, number][], i: number) {
    const [x, y] = corners[i];
    const outer = i === 0 || i === 3;
    if (pattern.edge === 'left') return { x: x + (outer ? -7 : 10), y: y + 4, anchor: outer ? 'end' : 'start' };
    if (pattern.edge === 'right') return { x: x + (outer ? 7 : -10), y: y + 4, anchor: outer ? 'start' : 'end' };
    const span = outer ? corners[3][0] - corners[0][0] : corners[2][0] - corners[1][0];
    const narrow = span < 20 && (outer || pattern.bottom !== 0);
    const offset = narrow ? (i === 0 || i === 1 ? -4 : 4) : 0;
    return { x: x + offset, y: y + ((pattern.edge === 'top') === outer ? -9 : 15), anchor: narrow ? (offset < 0 ? 'end' : 'start') : 'middle' };
  }
</script>

<div class="piece-cuts" data-group={group.number}>
  <div class="pattern-header">
    <div>
      <h3>#{group.number} ×{group.pieces.length} · {mm(group.length)} × {mm(group.height)} mm · <span class:secondary={group.material === 'secondary'}>{materialLabel(group.material, group.thickness)}</span></h3>
      <p>Lay each rectangle flat with its {mm(group.length)} mm edge across and its {mm(group.height)} mm edge down. {group.pieces.length === 1 ? 'Complete every cut below on this piece.' : `Repeat every cut below on all ${group.pieces.length} pieces.`}</p>
      <p class="muted">Top, bottom, left and right refer to this cutting diagram. Turn the finished piece to match its position in the assembly diagram.</p>
    </div>
    <svg viewBox="{-12 * unit} {-12 * unit} {group.length + 24 * unit} {group.height + 24 * unit}" class="piece-map" role="img" aria-label="Piece #{group.number} cutting orientation">
      <rect width={group.length} height={group.height} class="blank" style:stroke-width={unit} />
      <text x={group.length / 2} y={-5 * unit} font-size={8 * unit}>TOP</text>
      <text x={group.length / 2} y={group.height + 9 * unit} font-size={8 * unit}>BOTTOM</text>
      {#each patterns as pattern, i (i)}
        <path d={polygonPath(pattern.points.map((p) => [p.x, p.y]))} class="waste" class:lowered={kind === 'lowered'} style:stroke-width={unit * 0.6} />
      {/each}
      <!-- Each cut's number, as in its heading below, just inside the piece past the cut. -->
      {#each patterns as pattern, i (i)}
        {@const at = badgeAt(pattern)}
        <circle cx={at.x} cy={at.y} r={5 * unit} class="badge" class:lowered={kind === 'lowered'} />
        <text x={at.x} y={at.y} font-size={6.5 * unit} class="badge-text">{i + 1}</text>
      {/each}
    </svg>
  </div>
  {#each patterns as pattern, i (i)}
    {@const corners = detail(pattern)}
    <div class="cut-detail">
      <svg viewBox="-15 0 250 142" class="marking-diagram" role="img" aria-label="{pattern.name} on #{group.number}: marking points A, B, C and D on the {pattern.edge} edge">
        <rect x={12} y={30} width={196} height={80} class="blank" />
        <path d={polygonPath(corners)} class="waste" class:lowered={kind === 'lowered'} />
        <path d="M{corners[0][0]} {corners[0][1]} L{corners[1][0]} {corners[1][1]} L{corners[2][0]} {corners[2][1]} L{corners[3][0]} {corners[3][1]}" class="cut-line" />
        <text x={110} y={12} class="edge-label">{pattern.edge.toUpperCase()} EDGE · DETAIL</text>
        {#each corners as point, j (j)}
          {#if !(pattern.bottom === 0 && j === 2)}
            {@const label = labelPosition(pattern, corners, j)}
            <circle cx={point[0]} cy={point[1]} r={3} />
            <text x={label.x} y={label.y} style:text-anchor={label.anchor} class="point-label">{pattern.bottom === 0 && j === 1 ? 'B=C' : pattern.points[j].label}</text>
          {/if}
        {/each}
        <text x={110} y={139} class="scale-label">Proportions preserved · not full size</text>
      </svg>
      <div>
        <h4>{pattern.name} · {pattern.edge} edge</h4>
        <ol>
          {#each pattern.steps as step, j (j)}<li>{step}</li>{/each}
        </ol>
      </div>
    </div>
  {/each}
</div>

<style>
  .piece-cuts { margin: 14px 0 22px; }
  .pattern-header { display: grid; grid-template-columns: 1fr 220px; gap: 16px; align-items: start; break-inside: avoid; }
  h3 { font-size: 13px; margin: 0 0 6px; }
  h4 { font-size: 12.5px; margin: 0 0 5px; }
  p { margin: 3px 0; }
  .muted { color: var(--muted); font-size: 11.5px; }
  .secondary { color: #60418a; }
  .piece-map, .marking-diagram { width: 100%; height: auto; }
  .cut-detail { display: grid; grid-template-columns: 200px 1fr; gap: 16px; align-items: center; margin-top: 8px; break-inside: avoid; }
  ol { margin: 0; padding-left: 18px; }
  li { margin-bottom: 4px; }
  .blank { fill: #f7f5f0; stroke: #6f6a61; stroke-width: 0.8; }
  .waste { fill: #fff1c2; stroke: #a26400; stroke-width: 0.8; }
  .waste.lowered { fill: #e9e1f3; stroke: #6f4fb8; }
  .badge { fill: #a26400; }
  .badge.lowered { fill: #6f4fb8; }
  .badge-text { fill: #fff; font-weight: 700; dominant-baseline: central; }
  .cut-line { fill: none; stroke: #22201c; stroke-width: 1.5; }
  circle { fill: #22201c; }
  text { text-anchor: middle; fill: #6f6a61; font-family: inherit; }
  .point-label { fill: #22201c; font-weight: 700; font-size: 12px; }
  .edge-label { font-size: 9px; font-weight: 600; }
  .scale-label { font-size: 9px; }
  @media (max-width: 700px) {
    .pattern-header { grid-template-columns: 1fr; }
    .piece-map { max-width: 260px; }
    .cut-detail { grid-template-columns: 150px 1fr; gap: 10px; }
  }
</style>
