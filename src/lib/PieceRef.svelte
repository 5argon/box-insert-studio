<script lang="ts">
  import type { PieceHighlight } from './highlight.svelte';

  /** A piece number in the report's text: point at it to see that cut size wherever it appears, click to keep it, again to clear. */
  let { n, highlight }: { n: number; highlight: PieceHighlight } = $props();
  const point = () => (highlight.pointed = n);
  const leave = () => (highlight.pointed = undefined);
</script>

<button
  type="button"
  class="ref"
  class:picked={highlight.picked === n}
  class:pointed={highlight.pointed === n}
  aria-pressed={highlight.picked === n}
  onmouseenter={point}
  onmouseleave={leave}
  onfocus={point}
  onblur={leave}
  onclick={() => highlight.toggle(n)}>#{n}</button
>

<style>
  .ref {
    font: inherit;
    color: inherit;
    border: 0;
    border-radius: 3px;
    padding: 0 2px;
    background: #efeadf;
  }
  .ref.pointed {
    background: #ffe38a;
  }
  .ref.picked {
    background: #ffd34d;
  }
  @media print {
    .ref:not(.picked) {
      background: none;
      padding: 0;
    }
  }
</style>
