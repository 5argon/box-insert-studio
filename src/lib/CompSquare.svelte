<script lang="ts">
  import { sectionColor, sectionInk } from '../core/defaults';
  import type { Compartment } from '../core/layout';
  import CompLabel from './CompLabel.svelte';

  /** A compartment's colour square with its letter, in three sizes. */
  let { c, size = 'md' }: { c: Pick<Compartment, 'label' | 'stacked' | 'pad' | 'index'>; size?: 'sm' | 'md' | 'lg' } = $props();
</script>

<span class="sq {size}" style:background={sectionColor(c.index)} style:border-color={sectionInk(c.index)} style:color={sectionInk(c.index)}
  ><CompLabel {c} /></span
>

<style>
  .sq {
    display: inline-grid;
    place-items: center;
    border: 1.5px solid;
    border-radius: 5px;
    font-weight: 700;
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .sm {
    min-width: 18px;
    height: 16px;
    padding: 0 3px;
    font-size: 10px;
    border-width: 1px;
    border-radius: 3px;
  }
  .md {
    min-width: 26px;
    height: 22px;
    padding: 0 4px;
    font-size: 12px;
  }
  .lg {
    min-width: 34px;
    height: 34px;
    padding: 0 4px;
    font-size: 15px;
    border-radius: 6px;
  }
</style>
