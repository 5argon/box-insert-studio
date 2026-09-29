<script lang="ts">
  import { mm } from '../core/geom';
  import { NOTCH_BOTTOM_DEFAULT } from '../core/layout';
  import { notchSlant } from '../core/notches';
  import type { NotchSize } from '../core/types';
  import NumberField from './NumberField.svelte';

  /** Width, depth and flat bottom of a slanted finger notch, edited in place. */
  let { size }: { size: NotchSize } = $props();

  const share = $derived(size.bottom ?? NOTCH_BOTTOM_DEFAULT);
  const bottom = $derived((size.width * share) / 100);
  const slant = $derived(notchSlant(size.width, size.depth, bottom));
</script>

<NumberField
  label="Width"
  value={size.width}
  min={5}
  hint="Opening at the top edge"
  onchange={(v) => (size.width = v)}
/>
<NumberField label="Depth" value={size.depth} min={2} hint="From the top edge down to the flat bottom" onchange={(v) => (size.depth = v)} />
<NumberField
  label="Flat bottom"
  unit="%"
  value={share}
  min={0}
  max={100}
  step={5}
  decimals={0}
  hint="Width of the flat bottom as a share of the opening: 0 is a V, 100 a straight-sided slot"
  onchange={(v) => (size.bottom = v)}
/>
<p class="hint readout">
  {mm(bottom)} mm flat bottom; the sides slant at {Math.round(slant)}° from level.
</p>

<style>
  .readout {
    margin: 2px 0 4px;
  }
</style>
