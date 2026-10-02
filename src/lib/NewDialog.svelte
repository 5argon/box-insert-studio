<script lang="ts">
  import { BOX_PRESETS } from '../core/boxPresets';
  import { NEW_CLEARANCE, newProject, SECONDARY_THICKNESS_PRESETS, SHEET_PRESETS, STARTER_SPEC, THICKNESS_PRESETS, type NewProjectSpec } from '../core/defaults';
  import { mm } from '../core/geom';
  import type { Project } from '../core/types';
  import NumberField from './NumberField.svelte';
  import NumberInput from './NumberInput.svelte';

  /**
   * Starts a design from what matters most: the box's inside, the sheet material, and the first
   * layer. Everything else starts from sensible values and is changed later in the side panel.
   */
  let { current, oncreate }: { current: Project; oncreate: (p: Project) => void } = $props();

  let dialog: HTMLDialogElement;
  // Filled from the current design each time the dialog opens.
  let spec = $state<NewProjectSpec>(structuredClone(STARTER_SPEC));
  let secondary = $state(false);
  let secondaryThickness = $state(3);
  let secondaryBase = $state(false);
  /** False on first run, when there is nothing to lose. */
  let replacing = $state(true);

  /** Start from the current design's box and material, so a second insert for the same game is quick. */
  function fromProject(p: Project): NewProjectSpec {
    return {
      box: { ...p.box },
      thickness: p.material.thickness,
      sheet: { ...p.material.sheet },
      layerHeight: p.layers.length === 1 ? p.layers[0].height : Math.max(10, p.box.height - 10),
    };
  }

  export function open(opts: { replacing?: boolean } = {}) {
    spec = fromProject(current);
    secondary = current.material.secondaryThickness !== undefined;
    secondaryThickness = current.material.secondaryThickness ?? SECONDARY_THICKNESS_PRESETS.filter((t) => t < current.material.thickness).pop() ?? current.material.thickness;
    secondaryBase = !!current.secondaryBase;
    replacing = opts.replacing ?? true;
    dialog.showModal();
  }

  const preset = $derived(BOX_PRESETS.find((b) => b.width === spec.box.width && b.depth === spec.box.depth && b.height === spec.box.height));
  function choosePreset(name: string) {
    const b = BOX_PRESETS.find((x) => x.name === name);
    if (b) spec.box = { width: b.width, depth: b.depth, height: b.height };
  }

  function chooseSheet(name: string) {
    const p = SHEET_PRESETS.find((x) => x.preset === name);
    spec.sheet = p ? { ...p } : { ...spec.sheet, preset: 'Custom' };
  }

  const base = $derived(secondary && secondaryBase ? secondaryThickness : spec.thickness);
  const headroom = $derived(spec.box.height - spec.layerHeight);
  const problem = $derived(
    headroom < 0
      ? 'The layer is taller than the box.'
      : spec.layerHeight - base < 5
        ? 'The layer is too shallow for its base.'
        : Math.min(spec.box.width, spec.box.depth) < 20
          ? 'The box is too small.'
          : '',
  );

  function create() {
    if (problem) return;
    oncreate(newProject({ ...$state.snapshot(spec), ...(secondary ? { secondaryThickness, secondaryBase } : {}) }));
    dialog.close();
  }
</script>

<dialog bind:this={dialog} class="new" aria-label="New design">
  <form
    method="dialog"
    onsubmit={(e) => {
      e.preventDefault();
      create();
    }}
  >
    <header>
      <h2>New design</h2>
      <p class="hint">The box, the material and the first layer. Everything else can be changed later in the side panel.</p>
    </header>

    <section>
      <h3>Box inside</h3>
      <label class="field">
        <span>Preset</span>
        <select value={preset?.name ?? ''} onchange={(e) => choosePreset(e.currentTarget.value)} aria-label="Box preset">
          <option value="">Custom size</option>
          {#each BOX_PRESETS as b (b.name)}
            <option value={b.name}>{b.name} ({b.width} × {b.depth} × {b.height})</option>
          {/each}
        </select>
      </label>
      {#if preset}
        <p class="hint source">
          {preset.dimensionBasis === 'insert-fit' ? 'Insert-fit reference' : 'Inside dimensions'} from {preset.source}.
          {preset.note ?? ''} Editions and print runs can differ; measure your box to be sure.
        </p>
      {/if}
      <NumberField label="Width" value={spec.box.width} min={20} onchange={(v) => (spec.box.width = v)} />
      <NumberField label="Depth" value={spec.box.depth} min={20} onchange={(v) => (spec.box.depth = v)} />
      <NumberField label="Height" value={spec.box.height} min={5} onchange={(v) => (spec.box.height = v)} />
      <p class="hint">Width runs across the upright cover, depth runs top to bottom, and height is box thickness.</p>
      <p class="hint">Measured inside the box bottom. Trays get {NEW_CLEARANCE} mm of clearance ({NEW_CLEARANCE / 2} mm each side); change it later under Box inside.</p>
    </section>

    <section>
      <h3>Material</h3>
      <div class="field">
        <span>Thickness</span>
        <span class="row">
          {#each THICKNESS_PRESETS as t (t)}
            <button type="button" class="small" class:on={spec.thickness === t} onclick={() => (spec.thickness = t)}>{t}</button>
          {/each}
          <span class="thick"><NumberInput value={spec.thickness} min={1} max={20} label="Material thickness" onchange={(v) => (spec.thickness = v)} /></span>
          <span class="unit">mm</span>
        </span>
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={secondary} />
        Secondary Material
      </label>
      {#if secondary}
        <div class="field">
          <span>Secondary</span>
          <span class="row">
            {#each SECONDARY_THICKNESS_PRESETS as t (t)}
              <button type="button" class="small" class:on={secondaryThickness === t} onclick={() => (secondaryThickness = t)}>{t}</button>
            {/each}
            <span class="thick"><NumberInput value={secondaryThickness} min={0.5} max={20} label="Secondary material thickness" onchange={(v) => (secondaryThickness = v)} /></span>
            <span class="unit">mm</span>
          </span>
        </div>
        <p class="hint">Available for bases, removable-box lids and individual dividers, including dividers inside removable boxes. Each material gets its own cutting sheets.</p>
      {/if}
      <label class="field">
        <span>Sheet</span>
        <select value={spec.sheet.preset} onchange={(e) => chooseSheet(e.currentTarget.value)}>
          {#each SHEET_PRESETS as s (s.preset)}
            <option value={s.preset}>{s.preset} ({s.width} × {s.height})</option>
          {/each}
          <option value="Custom">Custom</option>
        </select>
      </label>
      {#if spec.sheet.preset === 'Custom'}
        <NumberField label="Sheet width" value={spec.sheet.width} min={50} onchange={(v) => (spec.sheet.width = v)} />
        <NumberField label="Sheet height" value={spec.sheet.height} min={50} onchange={(v) => (spec.sheet.height = v)} />
      {/if}
    </section>

    <section>
      <h3>Layer</h3>
      <NumberField
        label="Height"
        value={spec.layerHeight}
        min={5}
        hint="From the bottom of its base to the top of its walls"
        onchange={(v) => (spec.layerHeight = v)}
      />
      <p class="hint">Includes the {mm(base)} mm base. Finger notches start {mm(spec.layerHeight / 4)} mm wide and deep, a quarter of this height.</p>
      {#if secondary}
        <label class="check">
          <input type="checkbox" bind:checked={secondaryBase} />
          Use secondary material for base
        </label>
        <p class="hint">The base uses {secondaryBase ? 'secondary' : 'primary'} material ({mm(base)} mm); walls and dividers use primary material ({mm(spec.thickness)} mm).</p>
      {/if}
      <p class="headroom" class:bad={headroom < 0} data-tip="Space left above the layer, for the board and rulebook">
        Headroom: <b>{mm(headroom)} mm</b>
      </p>
    </section>

    <footer>
      {#if problem}
        <span class="problem">{problem}</span>
      {:else if replacing}
        <span class="hint">Replaces the current design; save it first to keep it.</span>
      {:else}
        <span></span>
      {/if}
      <button type="button" onclick={() => dialog.close()}>Cancel</button>
      <button type="submit" class="primary" disabled={!!problem}>Create</button>
    </footer>
  </form>
</dialog>

<style>
  .new {
    width: min(460px, 94vw);
    max-height: 92vh;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }
  .new::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }
  form {
    display: flex;
    flex-direction: column;
    max-height: 92vh;
  }
  header {
    padding: 14px 18px 10px;
    border-bottom: 1px solid var(--line);
  }
  header h2 {
    margin: 0 0 4px;
    font-size: 15px;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
  }
  header .hint {
    margin: 0;
  }
  section {
    padding: 12px 18px;
    border-bottom: 1px solid var(--line);
    overflow: auto;
  }
  h3 {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 0 0 8px;
  }
  .field {
    display: grid;
    grid-template-columns: 70px 1fr;
    align-items: center;
    gap: 6px;
    margin: 4px 0;
  }
  .thick {
    width: 64px;
  }
  .unit {
    color: var(--muted);
    font-size: 12px;
  }
  .hint {
    margin: 4px 0;
  }
  .source {
    margin-top: 0;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 8px 0 2px;
  }
  .headroom {
    margin: 10px 0 0;
  }
  .headroom.bad,
  .problem {
    color: var(--error);
  }
  footer {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px;
    align-items: center;
    padding: 12px 18px;
  }
  footer .hint,
  .problem {
    font-size: 12px;
  }
</style>
