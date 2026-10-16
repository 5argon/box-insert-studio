<script lang="ts">
  import { addSibling, axisOwner, findParent, insertMode, removeSection, setCompartmentSize, sizeOwner, setEmptyAbove, setInsert, setInsertBaseSecondary, setInsertLid, setInsertLidSecondary, setInsertSharedLid, setJoin, setLidNotchSide, setLowOverrideSide, setNotchOverrideSide, setPad, setStacked, splitJoin, splitSection } from '../core/edit';
  import { LID_NOTCH_DEFAULT } from '../core/lidNotches';
  import { mm } from '../core/geom';
  import { DEFAULT_ITEMS, fitItems } from '../core/items';
  import { hasLow, hasNotch, lowSharedWith, notchSharedWith, toggleLow, toggleNotch } from '../core/notches';
  import { insertHeights, layerBaseThickness, insertLidAllowance, insertLidThickness, LOWERED_DEFAULT, NOTCH_BOTTOM_DEFAULT, padLimit, usesLowOverride, usesNotchOverride, usesSharedLid, type Compartment, type Solved, type SolvedLayer } from '../core/layout';
  import { roundTo } from '../core/geom';
  import type { CutList } from '../core/pieces';
  import type { Dir, Layer, Project, Side, SplitNode } from '../core/types';
  import CompLabel from './CompLabel.svelte';
  import CompSquare from './CompSquare.svelte';
  import LayerIcon from './LayerIcon.svelte';
  import { layerInfo } from './layers';
  import LockButton from './LockButton.svelte';
  import NotchFields from './NotchFields.svelte';
  import NumberField from './NumberField.svelte';
  import type { Selection } from './state.svelte';

  let {
    project,
    layer,
    solved,
    solvedLayer,
    cut,
    compartment: c,
    onselect,
  }: {
    project: Project;
    layer: Layer;
    solved: Solved;
    solvedLayer: SolvedLayer;
    cut: CutList;
    compartment: Compartment;
    onselect: (sel: Selection) => void;
  } = $props();

  const T = $derived(project.material.thickness);
  /** The layer's base, which can be thinner than everything else. */
  const B = $derived(layerBaseThickness(project, layer));
  const tray = $derived(solved.trays.find((t) => t.id === c.trayId));
  /** The compartment a box stands in: this one if it holds a box, or the one around this box. */
  const well = $derived(c.wellId ? solved.compartments.find((x) => x.id === c.wellId) : c.node.insert ? c : undefined);
  /** Heights from the solver's own calculation, for this box or the one this compartment would get. */
  const heights = $derived(insertHeights(project, (well ?? c).node, (well ?? c).fullHeight, (well ?? c).padHeight));
  const boxBase = $derived(heights.base);
  const hasLid = $derived(!!well?.node.insert?.lid);
  const boxLid = $derived(well ? insertLidThickness(project, well.node) : 0);
  const sharedLid = $derived(well ? usesSharedLid(well.node) : false);
  const lidAllowance = $derived(well ? insertLidAllowance(project, well.node) : 0);
  const boxes = $derived(well ? solved.trays.filter((t) => t.wellId === well.id && !t.copyOf) : []);
  const stacked = $derived(!!well?.node.insert?.stacked);
  /** A stacked pair with the top box left out: one half-height box, empty above. */
  const emptyAbove = $derived(stacked && !!well?.node.insert?.emptyAbove);
  const pair = $derived(stacked && !emptyAbove);
  const insertRoot = $derived(well?.node.insert?.root);
  const mode = $derived(well ? insertMode(well.node) : 'single');
  const parent = $derived(findParent(layer.root, c.id));
  const beside = $derived(parent?.split.join === 'trays' ? (c.depth === 1 ? 'box' : 'tray') : null);
  const axes: { dir: Dir; label: string; key: 'w' | 'h' }[] = [
    { dir: 'row', label: 'Width', key: 'w' },
    { dir: 'column', label: 'Depth', key: 'h' },
  ];

  const owners = $derived({ row: sizeOwner(project, layer, c, 'row'), column: sizeOwner(project, layer, c, 'column') });

  function sizesOf(splitId: string) {
    return solvedLayer.splits.find((x) => x.id === splitId)?.childSizes ?? [];
  }

  const setSize = (dir: Dir, value: number) => setCompartmentSize(project, layer, c.id, dir, value);

  /** Sizes other compartments already use (with how many use them); picking one keeps cut sizes shared. */
  function sizesInUse(key: 'w' | 'h'): { v: number; uses: number }[] {
    const own = Math.round(c.rect[key] * 2) / 2;
    const uses = new Map<number, number>();
    for (const o of solved.compartments) {
      if (o.id === c.id || o.node.insert) continue;
      for (const v of new Set([o.rect.w, o.rect.h].map((x) => Math.round(x * 2) / 2))) uses.set(v, (uses.get(v) ?? 0) + 1);
    }
    uses.delete(own);
    return [...uses.entries()]
      .filter(([v]) => v > 0 && Math.abs(v - own) <= Math.max(25, own * 0.4))
      .sort((a, b) => Math.abs(a[0] - own) - Math.abs(b[0] - own))
      .slice(0, 6)
      .sort((a, b) => a[0] - b[0])
      .map(([v, n]) => ({ v, uses: n }));
  }

  /** Splitting makes separate trays at the top level of a separate construction, else glued dividers. */
  const splitsTrays = $derived(splitJoin(project, layer, c.id) === 'trays');

  function split(dir: Dir) {
    const id = splitsTrays ? splitSection(layer, c.id, dir, project.clearance / 2, 'trays') : splitSection(layer, c.id, dir, T);
    if (id) onselect({ kind: 'section', id });
  }

  function addBeside() {
    const id = addSibling(layer, c.id, parent?.split.join === 'trays' ? project.clearance / 2 : T);
    if (id) onselect({ kind: 'section', id });
  }

  function remove() {
    const next = removeSection(layer, c.id);
    onselect(next ? { kind: 'section', id: next } : null);
  }

  function setMode(m: 'single' | 'multiple') {
    if (insertRoot?.kind === 'split') setJoin(layer, insertRoot, m === 'multiple' ? 'trays' : 'divider', T);
  }


  const SIDE_ORDER: Side[] = ['back', 'front', 'left', 'right'];
  const ARROWS: { side: Side; glyph: string }[] = [
    { side: 'back', glyph: '↑' },
    { side: 'front', glyph: '↓' },
    { side: 'left', glyph: '←' },
    { side: 'right', glyph: '→' },
  ];
  const pieceById = $derived(new Map(solved.pieces.map((p) => [p.id, p])));
  /** Each box's share of the height, lid included; a pair's bodies divide it beneath one top lid. */
  const boxHeight = $derived(heights.envelope);
  const boxBody = $derived(heights.body);
  /** Boxes standing on this compartment's floor: 0, 1, or 2 when stacked. */
  const boxesHere = $derived(c.node.insert && c.depth === 0 ? (c.node.insert.stacked ? 2 : 1) : 0);
  const padMax = $derived(padLimit(project, c));
  const li = $derived(layerInfo(project, layer.id));

  /** How the height adds up, every number with its unit. The layer is named only when there are several. */
  const breakdown = $derived.by(() => {
    const total = `${mm(layer.height)} mm${li.multi ? '' : ' tray'}`;
    const wellPad = well?.pad ? ` − ${mm(well.padHeight)} mm raised floor` : '';
    const pad = c.pad ? ` − ${c.pad} × ${mm(T)} mm raised floor` : '';
    const lid = boxLid ? pair ? ` − ${mm(lidAllowance)} mm share of the ${sharedLid ? 'shared' : 'top'} lid` : ` − ${mm(boxLid)} mm ${sharedLid ? 'shared lid' : 'lid'}` : '';
    // A tray standing on the box floor has no floor of its own to take off.
    const floor = (what: string) => (B ? ` − ${mm(B)} mm ${what}` : '');
    if (c.depth === 1 && c.stacked)
      return `In each box: (${total}${floor('tray floor')}${wellPad}) ÷ 2 = ${mm(boxHeight)} mm${lid} − ${mm(boxBase)} mm box floor${pad}`;
    if (c.depth === 1 && emptyAbove)
      return `(${total}${floor('tray floor')}${wellPad}) ÷ 2 = ${mm(boxHeight)} mm box${lid} − ${mm(boxBase)} mm box floor${pad}; the half above stays empty`;
    if (c.depth === 1) return `${total}${floor('tray floor')}${wellPad}${lid} − ${mm(boxBase)} mm box floor${pad}`;
    return `${total}${floor('floor')}${pad}`;
  });
  /** Sides whose divider stands lower than the walls, with how much lower. */
  const lowSides = $derived(
    SIDE_ORDER.flatMap((side) => {
      const p = pieceById.get(c.bounds[side]);
      return p?.kind === 'divider' && p.lower ? [`${side} ${mm(p.lower)} mm`] : [];
    }),
  );
  const boxWall = $derived(heights.wall);

  /** A lowered side stands this share of the compartment's depth above its floor. */
  const lowPct = $derived(project.lowered ?? LOWERED_DEFAULT);
  const lowTop = $derived(roundTo((lowPct / 100) * c.fullHeight, project.precision));
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

  /** Items standing in a row along the arrow; a compartment holding a box has no room for them. */
  const spec = $derived(c.node.arrow && !c.node.insert ? c.node.items : undefined);
  const fit = $derived(spec?.on && c.node.arrow ? fitItems(c, c.node.arrow, spec) : undefined);
  const noun = $derived(spec?.shape === 'cylinder' ? 'cylinders' : 'items');

  function simulate(on: boolean) {
    if (c.node.items) c.node.items.on = on;
    else if (on) c.node.items = { ...DEFAULT_ITEMS };
  }

  /** Thickness from a measured stack: many items are easier to measure than one. */
  let measuring = $state(false);
  let stack = $state({ length: 0, count: 10 });
  function fromStack(length: number, count: number) {
    stack = { length, count };
    if (spec && length > 0 && count >= 1) spec.thickness = Number((length / count).toFixed(4));
  }
</script>

<div class="panel-section head">
  <div class="squares">
    {#if c.depth === 1 && well}
      <button class="square-link" onclick={() => onselect({ kind: 'section', id: well.id })} data-tip="Select {well.label}, the compartment this box stands in">
        <CompSquare c={well} size="lg" />
      </button>
      <span class="chev" aria-hidden="true">›</span>
    {/if}
    <CompSquare {c} size="lg" />
  </div>
  <div>
    <div class="title">Compartment <CompLabel {c} />{c.stacked ? ' (in both stacked boxes)' : ''}</div>
    <div class="hint sub">
      {#if c.depth === 1}In the box inside {well?.label}{:else}Tray {tray?.number}{/if}
      {#if li.multi}
        · <LayerIcon color={li.color} /> {li.name}
      {/if}
      · {mm(c.rect.w)} × {mm(c.rect.h)} × {mm(c.height)} mm inside
    </div>
  </div>
</div>

<div class="panel-section">
  <div class="row">
    {#if splitsTrays}
      <button class="small" onclick={() => split('row')} data-tip="Split into two separate trays, side by side">Split │</button>
      <button class="small" onclick={() => split('column')} data-tip="Split into two separate trays, one behind the other">Split ─</button>
    {:else}
      <button class="small" onclick={() => split('row')} data-tip="Split this compartment with a divider running front to back">Add │ divider</button>
      <button class="small" onclick={() => split('column')} data-tip="Split this compartment with a divider running left to right">Add ─ divider</button>
    {/if}
    {#if beside && !splitsTrays}
      <button class="small" onclick={addBeside} data-tip="Add another separate {beside} next to this one">Add {beside}</button>
    {/if}
    <button class="small" onclick={remove} disabled={layer.root.kind === 'section'} data-tip="Remove this compartment; its neighbours take its space">Remove</button>
  </div>
</div>

<div class="panel-section">
  <h2>Inside size</h2>
  {#each axes as a (a.dir)}
    {@const o = owners[a.dir]}
    <div class="sized">
      <NumberField
        label={a.label}
        value={c.rect[a.key]}
        min={5}
        disabled={!o}
        hint={c.depth === 1 && o && !axisOwner(layer.root, c.id, a.dir) ? `Nothing inside the box divides this way, so this resizes ${well?.label} to fit` : ''}
        onchange={(v) => setSize(a.dir, v)}
      />
      {#if o}
        <LockButton split={o.split} index={o.index} sizes={sizesOf(o.split.id)} />
      {:else}
        <span></span>
      {/if}
    </div>
    {#if o}
      {@const used = sizesInUse(a.key)}
      {#if used.length}
        <div class="reuse">
          <span class="hint">Reuse</span>
          {#each used as u (u.v)}
            <button class="chip" onclick={() => setSize(a.dir, u.v)} data-tip="Used by {u.uses} other compartment{u.uses === 1 ? '' : 's'}"
              >{u.v}&thinsp;<small>mm</small> <small class="uses">({u.uses})</small></button
            >
          {/each}
        </div>
      {/if}
    {/if}
  {/each}
  <div class="height">
    <span>Height</span>
    <b>{mm(c.height)} mm{c.stacked ? ' each' : ''}</b>
    <span class="hint">
      {#if li.multi}<LayerIcon color={li.color} /> {li.name}:{/if}
      {breakdown}
    </span>
  </div>
  {#if lowSides.length}
    <p class="hint">Lowered dividers on the {lowSides.join(', ')}.</p>
  {/if}
</div>

<div class="panel-section">
  <h2>Item direction</h2>
  <div class="arrows" role="group" aria-label="Item direction arrow">
    {#each ARROWS as a (a.side)}
      <button
        class="small"
        class:on={c.node.arrow === a.side}
        onclick={() => (c.node.arrow === a.side ? delete c.node.arrow : (c.node.arrow = a.side))}
        aria-label="Arrow toward the {a.side}"
        aria-pressed={c.node.arrow === a.side}
        data-tip={c.node.arrow === a.side ? 'Remove the arrow' : `Arrow toward the ${a.side}`}>{a.glyph}</button
      >
    {/each}
  </div>
  {#if c.node.arrow && c.node.insert}
    <p class="hint">This compartment holds a box; simulate items in the box's compartments instead.</p>
  {:else if c.node.arrow}
    <label class="check sim">
      <input type="checkbox" checked={!!spec?.on} onchange={(e) => simulate(e.currentTarget.checked)} />
      Simulate items
    </label>
    {#if spec?.on && fit}
      <div class="row shape" role="group" aria-label="Item shape">
        <button class="small" class:on={spec.shape === 'box'} onclick={() => (spec.shape = 'box')} data-tip="Cards, tiles, boards: flat boxes standing on edge">Box</button>
        <button class="small" class:on={spec.shape === 'cylinder'} onclick={() => (spec.shape = 'cylinder')} data-tip="Coin capsules, discs: round items standing on edge"
          >Cylinder</button
        >
      </div>
      <NumberField
        label={spec.shape === 'cylinder' ? 'Diameter' : 'Width'}
        value={spec.width}
        min={0.5}
        onchange={(v) => (spec.width = v)}
        hint="Across the arrow"
      />
      {#if spec.shape === 'box'}
        <NumberField label="Height" value={spec.height} min={0.5} onchange={(v) => (spec.height = v)} hint="Standing up from the floor" />
      {/if}
      <NumberField
        label="Thickness"
        value={spec.thickness}
        min={0.0001}
        step={0.01}
        decimals={4}
        onchange={(v) => (spec.thickness = v)}
        hint="Along the arrow: one {spec.shape === 'cylinder' ? 'capsule' : 'card'}'s thickness, up to 4 decimal places"
      />
      <button class="link" onclick={() => (measuring = !measuring)} aria-expanded={measuring}>{measuring ? 'Hide' : 'Measure a stack…'}</button>
      {#if measuring}
        <div class="measure">
          <NumberField label="Stack length" value={stack.length} min={0} step={0.1} onchange={(v) => fromStack(v, stack.count)} hint="Measure many items pressed together" />
          <NumberField label="Items in it" value={stack.count} min={1} step={1} decimals={0} unit="" onchange={(v) => fromStack(stack.length, v)} />
          <p class="hint">
            {#if stack.length > 0}{mm(stack.length)} mm ÷ {stack.count} = {Number((stack.length / stack.count).toFixed(4))} mm each, set as the thickness.
            {/if}
          </p>
        </div>
      {/if}
      <NumberField label="Free space" value={spec.spare} min={0} onchange={(v) => (spec.spare = v)} hint="Left empty at the arrow's head" />
      <div class="fit" class:bad={fit.warnings.length}>
        <div class="count">
          <b>{fit.count}</b>
          {noun} fit{c.stacked ? ` in each box, ${fit.count * 2} in both` : ''}
        </div>
        <div class="hint">
          {Number(fit.used.toFixed(2))} mm of the {mm(fit.along)} mm slot, {Number(fit.left.toFixed(2))} mm left at the head · {mm(fit.faceW)} × {mm(fit.faceH)} mm face
          in a {mm(fit.across)} × {mm(fit.up)} mm opening
        </div>
      </div>
      {#each fit.warnings as w (w)}
        <div class="issue warn">{w}</div>
      {/each}
    {/if}
  {/if}
</div>

<div class="panel-section">
  <h2>Raised floor</h2>
  <div class="stepper">
    <button class="small" onclick={() => setPad(c.node, c.pad - 1)} disabled={c.pad <= 0} aria-label="Remove a layer" data-tip="Remove a layer">−</button>
    <span><b>{c.pad}</b> layer{c.pad === 1 ? '' : 's'} of {mm(T)} mm</span>
    <button
      class="small"
      onclick={() => setPad(c.node, c.pad + 1)}
      disabled={c.pad + 1 > padMax}
      aria-label="Add a layer"
      data-tip={c.pad + 1 > padMax ? 'No room for another layer' : 'Add a layer'}>+</button
    >
  </div>
  <p class="hint">
    {#if c.pad && boxesHere}
      Floor raised {mm(c.padHeight)} mm; {boxesHere === 2 ? 'each box body' : 'box'} {mm(sharedLid || pair ? boxBody : boxHeight)} mm tall.
    {:else if c.pad}
      Floor raised {mm(c.padHeight)} mm, {mm(c.height)} mm deep.
    {:else}
      Up to {padMax} layer{padMax === 1 ? '' : 's'} fit.
    {/if}
  </p>
</div>

<div class="panel-section">
  <h2>Removable box</h2>
  {#if !well}
    <p class="hint">{mm(boxHeight)} mm tall, {mm(boxWall)} mm walls.</p>
    <button class="small add-box" onclick={() => setInsert(layer, c.id, true)} disabled={c.depth === 1} data-tip={c.depth === 1 ? 'A box cannot hold another box' : ''}
      >Add a box inside</button
    >
  {:else}
    <div class="row">
      <button class="small" class:on={mode === 'single'} onclick={() => setMode('single')}>One box with dividers</button>
      <button
        class="small"
        class:on={mode === 'multiple'}
        onclick={() => setMode('multiple')}
        disabled={insertRoot?.kind !== 'split'}
        data-tip={insertRoot?.kind !== 'split' ? 'Add a divider inside the box first' : 'Each part becomes its own box'}>Separate boxes</button
      >
    </div>
    {#if boxes.length === 0}
      {#each well.issues.filter((i) => i.level === 'error') as issue, i (i)}
        <div class="issue error">{issue.message}</div>
      {/each}
    {:else}
      <p class="hint">
        {boxes.length === 1 ? 'Box' : `${boxes.length} boxes`}{pair ? ' per level' : ''}: {mm(sharedLid || pair ? boxBody : boxHeight)} mm tall, {mm(boxBody - boxBase)} mm inside, {mm(boxWall)} mm walls.
        {#if emptyAbove}{mm(boxHeight)} mm above stays empty.{/if}
      </p>
    {/if}
    {#if project.material.secondaryThickness !== undefined}
      <label class="check" data-tip="Bases from the secondary material">
        <input type="checkbox" checked={!!well.node.insert?.secondaryBase} onchange={(e) => setInsertBaseSecondary(well.node, e.currentTarget.checked)} />
        Use secondary material for bases
      </label>
    {/if}
    <label class="check" data-tip="A loose lid on top; the box gets shorter to fit it">
      <input type="checkbox" checked={hasLid} onchange={(e) => setInsertLid(well.node, e.currentTarget.checked)} />
      Add a lid
    </label>
    {#if hasLid}
      {#if mode === 'multiple'}
        <div class="row" role="group" aria-label="Lid coverage">
          <button class="small" class:on={!sharedLid} aria-pressed={!sharedLid} onclick={() => setInsertSharedLid(well.node, false)}>Lid for each {pair ? 'upper box' : 'box'}</button>
          <button class="small" class:on={sharedLid} aria-pressed={sharedLid} onclick={() => setInsertSharedLid(well.node, true)}>One lid over all boxes</button>
        </div>
      {/if}
      {#if project.material.secondaryThickness !== undefined}
        <label class="check nested lid-material" data-tip="Lids from the secondary material">
          <input type="checkbox" checked={!!well.node.insert?.secondaryLid} onchange={(e) => setInsertLidSecondary(well.node, e.currentTarget.checked)} />
          Use secondary material for {sharedLid ? 'the lid' : 'lids'}
        </label>
      {/if}
      <p class="hint">{mm(boxLid)} mm lid{pair && !sharedLid ? ', on the upper box only' : ''}.</p>
      <div class="lid-notches">
        <h3>Lid finger notches</h3>
        <div class="notches" role="group" aria-label="Lid finger notch sides">
          {#each SIDE_ORDER as side (side)}
            {@const selected = !!well.node.insert?.lidNotches?.includes(side)}
            <button class="small" class:on={selected} aria-pressed={selected} aria-label="Lid {side} notch"
              onclick={() => setLidNotchSide(well.node, side, !selected)} data-tip="Cut a finger notch through the lid on its {side} edge">{cap(side)}</button>
          {/each}
        </div>
        <NotchFields size={well.node.insert?.lidNotchSize ?? LID_NOTCH_DEFAULT} plane="lid"
          onchange={(size) => { if (well.node.insert) well.node.insert.lidNotchSize = size; }} />
        {#each solvedLayer.issues.filter((i) => solved.trays.some((box) => box.wellId === well.id && box.id === i.trayId)) as issue, i (i)}
          <div class="issue {issue.level}">{issue.message}</div>
        {/each}
      </div>
    {/if}
    <label class="check">
      <input type="checkbox" checked={stacked} onchange={(e) => setStacked(well.node, e.currentTarget.checked)} />
      Stack two boxes ({hasLid && !emptyAbove ? 'two equal box bodies beneath one top lid' : 'each half the height'})
    </label>
    {#if stacked}
      <label class="check nested" data-tip="Build only the lower box; the space above it stays open for something else">
        <input type="checkbox" checked={emptyAbove} onchange={(e) => setEmptyAbove(well.node, e.currentTarget.checked)} />
        Leave out the top box (empty above)
      </label>
    {/if}
    <div class="row">
      {#each solved.compartments.filter((x) => x.wellId === well.id) as x (x.id)}
        <button class="square-link" class:on={x.id === c.id} onclick={() => onselect({ kind: 'section', id: x.id })} data-tip="Select {x.label}">
          <CompSquare c={x} />
        </button>
      {/each}
      {#if c.id === well.id}
        <button class="small" onclick={() => setInsert(layer, c.id, false)} data-tip="Take the box out; the compartment stays">Remove box</button>
      {/if}
    </div>
  {/if}
</div>

<div class="panel-section">
  <h2>Finger notches</h2>
  <div class="notches">
    {#each SIDE_ORDER as side (side)}
      {@const p = pieceById.get(c.bounds[side])}
      {@const notched = hasNotch(solved, c, side)}
      {@const blocked = !notched && hasLow(solved, c, side)}
      <button
        class="small"
        class:on={notched}
        disabled={blocked || !p}
        onclick={() => toggleNotch(solved, c, side)}
        data-tip={!p
          ? `No wall on the ${side}`
          : blocked
          ? `The ${side} side is lowered; a side cannot have a notch too`
          : `Cut a finger notch into the ${p?.kind === 'divider' ? 'divider' : 'wall'} on the ${side} (piece #${p ? cut.groupOf.get(p.id)?.number : '?'})`}
      >
        {cap(side)}
        {#if p}<span class="piece-ref">#{cut.groupOf.get(p.id)?.number}</span>{/if}
      </button>
    {/each}
  </div>
  {#each SIDE_ORDER as side (side)}
    {@const shared = notchSharedWith(solved, c, side)}
    {#if shared.length}
      <p class="hint shared">The {side} notch is shared with {shared.join(', ')}: it is cut through the divider between you.</p>
      {#if !c.node.notches.includes(side)}
        <div class="row">
          {#each solved.compartments.filter((x) => shared.includes(x.label)) as owner (owner.id)}
            <button class="small" onclick={() => onselect({ kind: 'section', id: owner.id })} data-tip="Select the compartment that sets this shared notch's size">
              Edit {owner.label}'s notch
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  {/each}
  <div class="notch-size">
    {#if c.node.notchSize}
      {@const size = c.node.notchSize}
      <div class="override-head">
        <span class="custom-mark" aria-hidden="true"></span>
        <span>Override size</span>
        <button class="small" onclick={() => delete c.node.notchSize} data-tip="Go back to the project's notch size">Use default</button>
      </div>
      <div class="notches override-sides" role="group" aria-label="Sides using the notch override">
        {#each SIDE_ORDER as side (side)}
          {@const own = c.node.notches.includes(side)}
          {@const selected = own && usesNotchOverride(c.node, side)}
          {@const shared = notchSharedWith(solved, c, side)}
          <button
            class="small"
            class:on={selected}
            aria-label="Override {side} notch"
            aria-pressed={selected}
            disabled={!own}
            onclick={() => setNotchOverrideSide(c.node, side, !selected)}
            data-tip={own
              ? `Use ${selected ? 'the project default' : 'the override size and shape'} for the ${side} notch`
              : shared.length
                ? `This notch is set by ${shared.join(', ')}; select that compartment to change its override`
                : `Add a ${side} notch above to override it`}
          >{cap(side)}</button>
        {/each}
      </div>
      <NotchFields {size} />
    {:else}
      <span class="hint"
        >{mm(project.notch.width)} × {mm(project.notch.depth)} mm, {project.notch.bottom ?? NOTCH_BOTTOM_DEFAULT}% flat bottom (default)</span
      >
      <button
        class="small"
        onclick={() => (c.node.notchSize = { ...project.notch, sides: [...c.node.notches] })}
        data-tip="Use a different size on some sides">Override</button
      >
    {/if}
  </div>
  {#each c.issues as issue, i (i)}
    <div class="issue {issue.level}">{issue.message}</div>
  {/each}
</div>

<div class="panel-section">
  <h2>Lowered sides</h2>
  <div class="notches">
    {#each SIDE_ORDER as side (side)}
      {@const p = pieceById.get(c.bounds[side])}
      {@const low = hasLow(solved, c, side)}
      {@const blocked = !low && hasNotch(solved, c, side)}
      <button
        class="small"
        class:on={low}
        disabled={blocked || !p}
        onclick={() => toggleLow(solved, c, side)}
        data-tip={!p
          ? `No wall on the ${side}`
          : blocked
          ? `The ${side} side has a finger notch; a side cannot be lowered too`
          : `Cut the ${p?.kind === 'divider' ? 'divider' : 'wall'} on the ${side} down beside this compartment (piece #${p ? cut.groupOf.get(p.id)?.number : '?'})`}
      >
        {cap(side)}
        {#if p}<span class="piece-ref">#{cut.groupOf.get(p.id)?.number}</span>{/if}
      </button>
    {/each}
  </div>
  {#each SIDE_ORDER as side (side)}
    {@const shared = lowSharedWith(solved, c, side)}
    {#if shared.length}
      <p class="hint shared">The {side} side is lowered for {shared.join(', ')}: the divider between you is cut down.</p>
    {/if}
  {/each}
  <div class="notch-size">
    {#if c.node.lowerHeight}
      {@const own = c.node.lowerHeight}
      <div class="override-head">
        <span class="custom-mark lowered-mark" aria-hidden="true"></span>
        <span>Override height</span>
        <button class="small" onclick={() => delete c.node.lowerHeight} data-tip="Go back to the project's lowered height">Use default</button>
      </div>
      <div class="notches override-sides" role="group" aria-label="Sides using the lowered height override">
        {#each SIDE_ORDER as side (side)}
          {@const lowered = !!c.node.lowered?.includes(side)}
          {@const selected = lowered && usesLowOverride(c.node, side)}
          <button
            class="small"
            class:on={selected}
            aria-label="Override {side} lowered height"
            aria-pressed={selected}
            disabled={!lowered}
            onclick={() => setLowOverrideSide(c.node, side, !selected)}
            data-tip={lowered
              ? `Use ${selected ? `the project's ${lowPct}%` : 'this compartment’s own height'} for the ${side} side`
              : lowSharedWith(solved, c, side).length
                ? `This side is lowered by ${lowSharedWith(solved, c, side).join(', ')}; select that compartment to change its height`
                : `Lower the ${side} side above to override it`}
          >{cap(side)}</button>
        {/each}
      </div>
      <NumberField
        label="Height"
        unit="%"
        value={own.percent}
        min={10}
        max={95}
        step={5}
        decimals={0}
        hint="Share of the compartment's depth"
        onchange={(v) => (own.percent = v)}
      />
      <p class="hint override-hint">
        {mm(roundTo((own.percent / 100) * c.fullHeight, project.precision))} mm above the floor.
      </p>
    {:else}
      <span class="hint">{lowPct}%, {mm(lowTop)} mm above the floor (default)</span>
      <button
        class="small"
        onclick={() => (c.node.lowerHeight = { percent: lowPct, sides: [...(c.node.lowered ?? [])] })}
        data-tip="Use a different height on some sides">Override</button
      >
    {/if}
  </div>
</div>

<style>
  .lid-notches {
    margin: 12px 0;
    padding-left: 8px;
    border-left: 2px solid var(--line-strong);
  }
  .lid-notches h3 {
    font-size: 12px;
    margin: 0 0 6px;
  }
  .head {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .squares {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }
  .chev {
    color: var(--muted);
    font-size: 16px;
  }
  .square-link {
    padding: 2px;
    border: 1.5px solid transparent;
    background: none;
    border-radius: 7px;
    line-height: 0;
  }
  .square-link:hover {
    border-color: var(--line-strong);
  }
  .square-link.on {
    border-color: var(--accent);
  }
  .sub {
    margin-top: 2px;
  }
  .uses {
    color: var(--muted);
  }
  .add-box {
    margin-top: 8px;
  }
  .title {
    font-weight: 600;
    font-size: 14px;
  }
  .sized {
    display: grid;
    grid-template-columns: 1fr 58px;
    gap: 6px;
    align-items: center;
  }
  .height {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 10px;
    align-items: baseline;
    margin: 6px 0 2px;
  }
  .height b {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .height .hint {
    grid-column: 1 / -1;
    margin: 0;
  }
  .reuse {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
    margin: 0 0 8px;
  }
  .chip {
    padding: 0 7px;
    font-size: 12px;
    border-radius: 10px;
    font-variant-numeric: tabular-nums;
  }
  .link {
    margin-top: 8px;
    border: none;
    padding: 0;
    color: var(--accent);
    background: none;
    text-align: left;
  }
  .arrows {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .arrows button {
    width: 30px;
    font-size: 14px;
    padding: 1px 0;
  }
  .sim {
    margin: 10px 0 4px;
  }
  .shape {
    margin: 4px 0 2px;
  }
  .measure {
    margin: 2px 0 6px;
    padding: 4px 8px 6px;
    border-left: 2px solid var(--line-strong);
  }
  .measure .hint {
    margin: 2px 0 0;
  }
  .fit {
    margin-top: 8px;
    padding: 6px 8px;
    border-radius: var(--radius);
    background: var(--accent-soft);
  }
  .fit.bad {
    background: var(--warn-soft);
  }
  .fit .count {
    font-size: 13px;
  }
  .fit .count b {
    font-size: 16px;
    font-variant-numeric: tabular-nums;
  }
  .fit .hint {
    margin: 2px 0 0;
  }
  .stepper {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .stepper button {
    width: 30px;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 4px 0 8px;
  }
  .check.nested {
    margin: -4px 0 8px 22px;
  }
  .check.lid-material {
    margin-top: 8px;
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .notch-size {
    margin: 8px 0 4px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    justify-content: space-between;
  }
  .notch-size :global(.field) {
    width: 100%;
  }
  .override-sides,
  .override-hint {
    width: 100%;
  }
  .override-head {
    display: flex;
    gap: 6px;
    align-items: center;
    width: 100%;
  }
  .override-head button {
    margin-left: auto;
  }
  .custom-mark.lowered-mark {
    background: var(--lowered-custom);
  }
  .custom-mark {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--notch-custom);
  }
  .shared {
    color: var(--warn);
  }
  .notches {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .piece-ref {
    color: var(--muted);
    font-size: 11px;
    margin-left: 4px;
  }
  .hint {
    margin: 6px 0 0;
  }
</style>
