<script lang="ts">
  /**
   * A number input that never fights the user while typing: in-range values apply live, anything
   * else (empty, "2" on the way to "286", "1.") is left alone until Enter or blur, which clamps
   * and commits. Escape restores the current value. The text is not rewritten while focused.
   */
  let {
    value,
    onchange,
    step = 0.5,
    min = -Infinity,
    max = Infinity,
    disabled = false,
    label = '',
    decimals = 2,
  }: {
    value: number;
    onchange: (v: number) => void;
    step?: number;
    min?: number;
    max?: number;
    disabled?: boolean;
    label?: string;
    /** Values are kept to this many decimal places. */
    decimals?: number;
  } = $props();

  let el: HTMLInputElement;
  const round = (v: number) => Number(v.toFixed(decimals));
  const format = (v: number) => String(round(v));

  $effect(() => {
    const text = format(value);
    if (el && document.activeElement !== el) el.value = text;
  });

  function input() {
    const v = round(el.valueAsNumber);
    if (Number.isFinite(v) && v >= min && v <= max && v !== value) onchange(v);
  }

  function commit() {
    const v = el.valueAsNumber;
    const next = Number.isFinite(v) ? round(Math.min(max, Math.max(min, v))) : value;
    if (next !== value) onchange(next);
    el.value = format(next);
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Enter') el.blur();
    else if (e.key === 'Escape') {
      el.value = format(value);
      el.blur();
    }
  }
</script>

<input
  bind:this={el}
  type="number"
  {step}
  min={Number.isFinite(min) ? min : undefined}
  max={Number.isFinite(max) ? max : undefined}
  {disabled}
  aria-label={label || undefined}
  oninput={input}
  onblur={commit}
  onkeydown={keydown}
/>

<style>
  input {
    width: 100%;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
