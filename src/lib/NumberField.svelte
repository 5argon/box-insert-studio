<script lang="ts">
  let {
    label,
    value,
    onchange,
    unit = 'mm',
    step = 0.5,
    min = -Infinity,
    max = Infinity,
    disabled = false,
    hint = '',
  }: {
    label: string;
    value: number;
    onchange: (v: number) => void;
    unit?: string;
    step?: number;
    min?: number;
    max?: number;
    disabled?: boolean;
    hint?: string;
  } = $props();

  function input(e: Event & { currentTarget: HTMLInputElement }) {
    const v = e.currentTarget.valueAsNumber;
    if (Number.isFinite(v)) onchange(Math.min(max, Math.max(min, v)));
  }
</script>

<label class="field" title={hint}>
  <span class="label">{label}</span>
  <input type="number" value={Number(value.toFixed(2))} {step} {min} {max} {disabled} oninput={input} />
  <span class="unit">{unit}</span>
</label>

<style>
  .field {
    display: grid;
    grid-template-columns: 1fr 84px 24px;
    align-items: center;
    gap: 6px;
    margin: 4px 0;
  }
  .label {
    color: var(--text);
  }
  input {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .unit {
    color: var(--muted);
    font-size: 12px;
  }
</style>
