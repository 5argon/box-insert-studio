<script lang="ts">
  import { isLastFlex, toggleLock } from '../core/edit';
  import type { Mm, SplitNode } from '../core/types';

  let { split, index, sizes }: { split: SplitNode; index: number; sizes: Mm[] } = $props();

  const locked = $derived(split.children[index].size.mode === 'fixed');
  const lastFlex = $derived(isLastFlex(split, index));
  const title = $derived(
    locked
      ? 'Locked: keeps this size when other things change. Click to make it flex.'
      : lastFlex
        ? 'The last flex part fills the leftover space, so it cannot be locked. Lock or unlock a sibling instead.'
        : `Flex: shares the leftover space. Click to lock it at ${Math.round(sizes[index] * 10) / 10} mm.`,
  );
</script>

<button class="small" class:on={locked} disabled={lastFlex} onclick={() => toggleLock(split, index, sizes)} {title} aria-pressed={locked}>
  {locked ? 'Locked' : 'Flex'}
</button>
