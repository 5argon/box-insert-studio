<script lang="ts">
  import { distance, shapeCutPatterns, type CutPattern, type DetailCut } from '../core/cutting';
  import { mm } from '../core/geom';
  import { polygonPath } from '../core/lidNotches';
  import { materialLabel, type PieceGroup } from '../core/pieces';
  import PieceRef from './PieceRef.svelte';
  import { dimensionArrow as arrow, linePath as line, type Point } from './dimension';
  import type { PieceHighlight } from './highlight.svelte';

  let { group, kind = 'notch', highlight, sole }: { group: PieceGroup; kind?: DetailCut; highlight: PieceHighlight; sole: boolean } = $props();
  /** The shapes some of these pieces are cut to, each with its cuts of this kind, and the pieces none of them touch. */
  const versions = $derived(group.shapes.map((shape) => ({ shape, patterns: shapeCutPatterns(shape, kind) })).filter((v) => v.patterns.length));
  const rest = $derived(group.pieces.length - versions.reduce((n, v) => n + v.shape.pieces.length, 0));
  const pieces = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;
  const unit = $derived(Math.max(group.length / 240, group.height / 120));
  /** The step under the pointer, of which cut of which shape: its marks stand out on that cut's diagram. */
  let pointed = $state<{ version: number; pattern: number; step: number }>();
  /** The step that marks a point: A and D on the edge first, then B and C inside the piece. */
  const markStep = (j: number) => (j === 0 || j === 3 ? 0 : 1);

  /**
   * One cut drawn large: the cut itself in proportion, with a dimension line to each mark from the
   * end of the edge the steps measure it from. Those lines are not to scale: the cut is rarely that
   * near an end. Laid out along the cut's edge (`u`) and inward from it (`v`, negative outside the
   * piece), then turned to whichever edge the cut is on.
   */
  function detail(pattern: CutPattern) {
    const side = pattern.edge === 'left' || pattern.edge === 'right';
    const tip = pattern.bottom === 0;
    const blank = side ? { x: pattern.edge === 'left' ? 30 : 20, y: -2, w: 170, h: 140 } : { x: 12, y: pattern.edge === 'top' ? 30 : -10, w: 196, h: 104 };
    const edge = pattern.edge === 'top' ? blank.y : pattern.edge === 'bottom' ? blank.y + blank.h : pattern.edge === 'left' ? blank.x : blank.x + blank.w;
    /** The two ends of the cut's edge as drawn: where a mark is measured from, and which way the cut lies from there. */
    const ends = pattern.points.map((p) => {
      const past = p.from === 'right' || p.from === 'bottom';
      return { name: p.from, past, at: side ? (past ? blank.y + blank.h : blank.y) : past ? blank.x + blank.w : blank.x };
    });
    const at = (u: number, v: number): Point =>
      pattern.edge === 'top' ? [u, edge + v] : pattern.edge === 'bottom' ? [u, edge - v] : pattern.edge === 'left' ? [edge + v, u] : [edge - v, u];

    // Scale both axes equally so the detail retains the actual cut's proportions and slants.
    const along = pattern.points.map((p) => (side ? p.y : p.x));
    const lo = Math.min(...along);
    const hi = Math.max(...along);
    const scale = Math.min((side ? 60 : 110) / (hi - lo), (side ? 100 : 60) / Math.max(...pattern.points.map((p) => p.inward)));
    const centre = side ? blank.y + blank.h / 2 : 110;
    const u = along.map((a) => centre + (a - (lo + hi) / 2) * scale);
    const v = pattern.points.map((p) => p.inward * scale);
    const inner = v[1];
    // How far in B and C are goes past the cut: before it only when every mark is measured from the far end.
    const dir = ends.every((e) => e.past) ? -1 : 1;

    const marks = [0, 1, 2, 3]
      .filter((i) => !(tip && i === 2))
      .map((i) => {
        const outer = i === 0 || i === 3;
        const shared = tip && !outer;
        const from = ends[i].at;
        // Two marks measured from the same end: the nearer one has its dimension line nearer the cut.
        const nearer = shared || ends[3 - i].at !== from || Math.abs(u[i] - from) < Math.abs(u[3 - i] - from);
        const level = outer ? (nearer ? -15 : -30) : inner + (nearer ? 14 : 28);
        const out = outer ? -1 : 1;
        // Letters sit clear of the cut: A and B before it, C and D after; a shared tip away from the depth.
        const beside = shared ? -dir * 19 : i < 2 ? -9 : 9;
        return {
          step: markStep(i),
          letter: shared ? 'B=C' : pattern.points[i].label,
          dot: at(u[i], v[i]),
          label: at(u[i] + beside, outer ? -6.5 : v[i] + 5),
          dim: arrow(at(from, level), at(u[i], level)),
          reach: line(at(u[i], v[i]), at(u[i], level + out * 3)),
          number: at((from + u[i]) / 2, level + out * 6.5),
          distance: distance(pattern.points[i].along),
        };
      });

    const past = (dir < 0 ? Math.min(...u) : Math.max(...u)) + dir * 20;
    const depth = {
      dim: arrow(at(past, 0), at(past, inner)),
      reach: line(at((dir < 0 ? u[1] : u[2]) + dir * 17, inner), at(past + dir * 3, inner)),
      number: at(past + dir * 9, inner / 2),
      distance: distance(pattern.points[1].inward),
    };
    // Each end something is measured from, drawn heavy and named.
    const references = [...new Map(ends.map((e) => [e.name, e])).values()].map((e) => {
      const outside = e.past ? 8 : -8;
      return { name: e.name, line: line(at(e.at, -34), at(e.at, side ? blank.w : blank.h)), label: (side ? [blank.x + blank.w / 2, e.at + outside] : [e.at + outside, blank.y + blank.h / 2]) as Point };
    });
    return { side, blank, corners: u.map((x, i) => at(x, v[i])), marks, depth, references, height: side ? 198 : 186 };
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
</script>

<div class="piece-cuts" data-group={group.number}>
  {#each versions as { shape, patterns }, v (shape.key)}
  <div class="pattern-header">
    <div>
      {#if v === 0}
        <h3><PieceRef n={group.number} {highlight} /> ×{group.pieces.length} · {mm(group.length)} × {mm(group.height)} mm · <span class:secondary={group.material === 'secondary'}>{materialLabel(group.material, group.thickness, sole)}</span></h3>
        <p>Lay each rectangle flat with its {mm(group.length)} mm edge across and its {mm(group.height)} mm edge down.</p>
      {/if}
      <!-- How many of the pieces sharing this number get these cuts: the others are a different shape, or stay plain. -->
      {#if shape.pieces.length === group.pieces.length}
        <p>{group.pieces.length === 1 ? 'Complete every cut below on this piece.' : `Repeat every cut below on all ${group.pieces.length} pieces.`}</p>
      {:else}
        <p class="copies">
          {versions.length > 1 ? `Shape ${v + 1}: make` : 'Make'} the cuts below on {versions.length > 1 ? '' : 'only '}{shape.pieces.length} of the {pieces(group.pieces.length)}{#if versions.length === 1}; leave the other {rest} {kind === 'lowered' ? 'at full height' : 'without notches'}{/if}.
        </p>
      {/if}
      {#if v === 0}<p class="muted">Top, bottom, left and right refer to this cutting diagram. Turn the finished piece to match its position in the assembly diagram.</p>{/if}
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
      <!-- The step under the pointer, where it is on the piece: dots for its marks, lines for its cuts. -->
      {#if pointed?.version === v}
        {@const points = patterns[pointed.pattern].points}
        {#if pointed.step === 2}
          <path d="M{points.map((p) => `${p.x} ${p.y}`).join(' L')}" class="cut-line hot" style:stroke-width={2.4 * unit} />
        {:else}
          {#each points as p, j (j)}
            {#if markStep(j) === pointed.step}<circle cx={p.x} cy={p.y} r={3.5 * unit} class="hot-dot" />{/if}
          {/each}
        {/if}
      {/if}
    </svg>
  </div>
  {#each patterns as pattern, i (i)}
    {@const d = detail(pattern)}
    {@const step = pointed?.version === v && pointed.pattern === i ? pointed.step : undefined}
    {@const turn = (at: Point) => (d.side ? `rotate(-90 ${at[0]} ${at[1]})` : undefined)}
    {@const measured = d.side ? /(from the (?:top|bottom) edge)/ : /(from the (?:left|right) edge)/}
    <div class="cut-detail">
      <svg viewBox="-15 -30 250 {d.height}" class="marking-diagram" role="img" aria-label="{pattern.name} on #{group.number}: marking points A, B, C and D on the {pattern.edge} edge, each measured from the nearer end of that edge">
        <rect x={d.blank.x} y={d.blank.y} width={d.blank.w} height={d.blank.h} class="blank" />
        <path d={polygonPath(d.corners)} class="waste" class:lowered={kind === 'lowered'} />
        <path d="M{d.corners.map((c) => `${c[0]} ${c[1]}`).join(' L')}" class="cut-line" class:hot={step === 2} />
        <text x={110} y={-20} class="edge-label">{pattern.edge.toUpperCase()} EDGE · DETAIL</text>
        <!-- The ends of the edge that marks are measured from. -->
        {#each d.references as r (r.name)}
          <path d={r.line} class="reference" />
          <text x={r.label[0]} y={r.label[1]} transform={d.side ? undefined : `rotate(-90 ${r.label[0]} ${r.label[1]})`} class="reference-label">{r.name.toUpperCase()} EDGE</text>
        {/each}
        <g class="dim" class:hot={step === 1}>
          <path d={d.depth.reach} class="reach" />
          <path d={d.depth.dim} />
          <text x={d.depth.number[0]} y={d.depth.number[1]}>{d.depth.distance}</text>
        </g>
        {#each d.marks as mark (mark.letter)}
          <g class="dim mark" class:hot={step === mark.step}>
            <path d={mark.reach} class="reach" />
            <path d={mark.dim} />
            <text x={mark.number[0]} y={mark.number[1]} transform={turn(mark.number)}>{mark.distance}</text>
            <circle cx={mark.dot[0]} cy={mark.dot[1]} r={step === mark.step ? 4.5 : 3} />
            <text x={mark.label[0]} y={mark.label[1]} class="point-label">{mark.letter}</text>
          </g>
        {/each}
        <text x={110} y={d.height - 36} class="scale-label">Cut drawn in proportion · arrows not to scale</text>
      </svg>
      <div>
        <h4>{pattern.name} · {pattern.edge} edge</h4>
        <ol>
          {#each pattern.steps as text, j (j)}
            <li>
              <span class="mark-step" role="presentation" onmouseenter={() => (pointed = { version: v, pattern: i, step: j })} onmouseleave={() => (pointed = undefined)}
                >{#each text.split(measured) as bit, k (k)}{#if k % 2}<b>{bit}</b>{:else}{bit}{/if}{/each}</span
              >
            </li>
          {/each}
        </ol>
      </div>
    </div>
  {/each}
  {/each}
  {#if versions.length > 1 && rest > 0}
    <p class="copies">Leave the other {pieces(rest)} {kind === 'lowered' ? 'at full height' : 'without notches'}.</p>
  {/if}
</div>

<style>
  .piece-cuts { margin: 14px 0 22px; }
  .pattern-header { display: grid; grid-template-columns: 1fr 220px; gap: 16px; align-items: start; break-inside: avoid; }
  h3 { font-size: 13px; margin: 0 0 6px; }
  h4 { font-size: 12.5px; margin: 0 0 5px; }
  p { margin: 3px 0; }
  .muted { color: var(--muted); font-size: 11.5px; }
  /* Easy to miss: not every piece with this number is cut this way. */
  .copies { font-weight: 700; background: #fff1c2; padding: 2px 6px; border-radius: 3px; width: fit-content; }
  .pattern-header + .cut-detail { margin-top: 8px; }
  .cut-detail + .pattern-header { margin-top: 18px; }
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
  .point-label { fill: #22201c; font-weight: 700; font-size: 12px; dominant-baseline: central; }
  .reference { fill: none; stroke: #22201c; stroke-width: 1.8; }
  .reference-label { fill: #22201c; font-weight: 700; font-size: 9px; dominant-baseline: central; }
  .dim path { fill: none; stroke: #6f6a61; stroke-width: 0.8; }
  .dim .reach { stroke-dasharray: 2 2; stroke-width: 0.5; }
  .dim text { font-size: 11px; fill: #22201c; dominant-baseline: central; }
  /* What the step under the pointer marks or cuts. */
  .cut-line.hot { stroke: #e0452f; stroke-width: 3; }
  .dim.hot circle, .dim.hot text, .hot-dot { fill: #e0452f; }
  .dim.hot text { font-weight: 700; }
  .dim.hot path { stroke: #e0452f; }
  .mark-step { border-bottom: 1px dotted var(--line-strong); cursor: default; }
  .mark-step:hover { background: #fde3dc; border-bottom-color: #e0452f; }
  .edge-label { font-size: 9px; font-weight: 600; }
  .scale-label { font-size: 9px; }
  @media print {
    .mark-step { border-bottom: none; }
  }
  @media (max-width: 700px) {
    .pattern-header { grid-template-columns: 1fr; }
    .piece-map { max-width: 260px; }
    .cut-detail { grid-template-columns: 150px 1fr; gap: 10px; }
  }
</style>
