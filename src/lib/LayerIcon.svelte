<script lang="ts">
  /** Three stacked lines standing for a layer, in the layer's colour. */
  let { color = 'currentColor', size = 12 }: { color?: string; size?: number } = $props();
</script>

<svg class="layer-icon" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
  <rect x="1" y="2" width="10" height="1.8" rx="0.9" style:fill={color} />
  <rect x="1" y="5.1" width="10" height="1.8" rx="0.9" style:fill={color} />
  <rect x="1" y="8.2" width="10" height="1.8" rx="0.9" style:fill={color} />
</svg>

<style>
  .layer-icon {
    display: inline-block;
    vertical-align: -1px;
    flex: none;
  }
</style>
