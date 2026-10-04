<script lang="ts">
  import NumberInput from './NumberInput.svelte';

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
    decimals = 2,
    mixed = false,
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
    decimals?: number;
    /** Several things selected whose values differ: shown as "—", typing sets them all. */
    mixed?: boolean;
  } = $props();
</script>

<label class="field" data-tip={hint || undefined}>
  <span class="label">{label}</span>
  <NumberInput {value} {onchange} {step} {min} {max} {disabled} {decimals} {mixed} />
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
  .unit {
    color: var(--muted);
    font-size: 12px;
  }
</style>
