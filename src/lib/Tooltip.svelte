<script lang="ts">
  import { onMount } from 'svelte';

  /**
   * One tooltip for the whole app. Any element with `data-tip="…"` gets it, shown quickly on
   * hover or keyboard focus (native `title` tooltips take about a second and are easy to miss).
   * Works on disabled buttons too, since it listens on the document.
   */
  const DELAY = 250;

  let text = $state('');
  let pos = $state({ x: 0, y: 0, above: false });
  let shown = $state(false);
  let current: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let box: HTMLDivElement | undefined = $state();

  function show(el: HTMLElement) {
    const tip = el.dataset.tip;
    if (!tip) return;
    text = tip;
    const r = el.getBoundingClientRect();
    const above = r.bottom + 60 > window.innerHeight;
    pos = { x: r.left + r.width / 2, y: above ? r.top - 6 : r.bottom + 6, above };
    shown = true;
  }

  function hide() {
    clearTimeout(timer);
    current = null;
    shown = false;
  }

  function enter(el: HTMLElement | null) {
    if (el === current) return;
    clearTimeout(timer);
    current = el;
    if (!el) {
      shown = false;
      return;
    }
    if (shown) show(el);
    else timer = setTimeout(() => current === el && show(el), DELAY);
  }

  onMount(() => {
    const over = (e: Event) => enter((e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null);
    document.addEventListener('pointerover', over);
    document.addEventListener('focusin', over);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', hide, true);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('focusin', over);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('keydown', hide, true);
    };
  });

  // Measure the bubble at its natural width, then keep it inside the window.
  let left = $state(0);
  $effect(() => {
    void text;
    const { x } = pos;
    if (!shown || !box) return;
    const w = box.offsetWidth;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
  });
</script>

{#if shown}
  <div
    bind:this={box}
    class="tip"
    class:above={pos.above}
    style:left="{left}px"
    style:top="{pos.y}px"
    role="tooltip"
  >
    {text}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 100;
    width: max-content;
    max-width: 280px;
    padding: 6px 9px;
    border-radius: 6px;
    background: var(--text);
    color: var(--panel);
    font-size: 12px;
    line-height: 1.35;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }
  .tip.above {
    transform: translateY(-100%);
  }
</style>
