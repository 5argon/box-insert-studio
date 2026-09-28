<script lang="ts">
  import type { Compartment } from '../core/layout';

  /** A compartment's letter, with ² when it sits in a stacked pair of boxes and * when its floor is raised. */
  let { c }: { c: Pick<Compartment, 'label' | 'stacked' | 'pad'> } = $props();
</script>

{c.label}{c.stacked ? '²' : ''}{#if c.pad > 0}<sup title="Raised floor">*</sup>{/if}

<style>
  sup {
    font-size: 0.7em;
    line-height: 0;
  }
</style>
