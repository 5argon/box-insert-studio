<script lang="ts">
  /**
   * A number input that never fights the user while typing: in-range values apply live, anything
   * else (empty, "2" on the way to "286", "1.") is left alone until Enter or blur, which clamps
   * and commits. Escape restores the current value. The text is not rewritten while focused.
   * `mixed`: several things are being edited and their values differ; the field shows "—" and
   * whatever is typed applies to all of them.
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
    mixed = false,
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
    mixed?: boolean;
  } = $props();

  let el: HTMLInputElement;
  const round = (v: number) => Number(v.toFixed(decimals));
  const format = (v: number) => String(round(v));

  const shown = () => (mixed ? '' : format(value));
  /** Bumped on commit, so the text is re-read even when the value and `mixed` did not change. */
  let committed = $state(0);

  $effect(() => {
    void committed;
    const text = shown();
    if (el && document.activeElement !== el) el.value = text;
  });

  // A typed value equal to `value` still applies when mixed: some of the things differ from it.
  function input() {
    const v = round(el.valueAsNumber);
    if (Number.isFinite(v) && v >= min && v <= max && (mixed || v !== value)) onchange(v);
  }

  function commit() {
    const v = el.valueAsNumber;
    if (!Number.isFinite(v) && mixed) {
      el.value = '';
      return;
    }
    const next = Number.isFinite(v) ? round(Math.min(max, Math.max(min, v))) : value;
    if (next !== value || (mixed && Number.isFinite(v))) onchange(next);
    el.value = format(next);
    committed += 1;
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Enter') el.blur();
    else if (e.key === 'Escape') {
      el.value = shown();
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
  placeholder={mixed ? '—' : undefined}
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
