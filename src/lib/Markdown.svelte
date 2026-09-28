<script lang="ts">
  /** Renders a readme. The Markdown library loads on first use, keeping it out of the editor's first download. */
  let { source, empty = '' }: { source: string; empty?: string } = $props();

  let render: ((s: string) => string) | undefined = $state();
  import('../core/markdown').then((m) => (render = m.renderMarkdown));
  const html = $derived(render && source.trim() ? render(source) : '');
</script>

<div class="md">
  {#if source.trim()}
    {@html html}
  {:else if empty}
    <p class="empty">{empty}</p>
  {/if}
</div>

<style>
  .md {
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .md :global(h1),
  .md :global(h2),
  .md :global(h3),
  .md :global(h4) {
    color: var(--text);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 650;
    margin: 14px 0 6px;
    line-height: 1.25;
  }
  .md :global(h1) {
    font-size: 18px;
  }
  .md :global(h2) {
    font-size: 15px;
  }
  .md :global(h3) {
    font-size: 13.5px;
  }
  .md :global(h4) {
    font-size: 12.5px;
  }
  .md :global(> :first-child) {
    margin-top: 0;
  }
  .md :global(p) {
    margin: 6px 0;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 6px 0;
    padding-left: 22px;
  }
  .md :global(li) {
    margin: 2px 0;
  }
  .md :global(a) {
    color: var(--accent);
  }
  .md :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
    background: var(--accent-soft);
    padding: 1px 4px;
    border-radius: 4px;
  }
  .md :global(pre) {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px 10px;
    overflow-x: auto;
  }
  .md :global(pre code) {
    background: none;
    padding: 0;
  }
  .md :global(blockquote) {
    margin: 8px 0;
    padding: 2px 12px;
    border-left: 3px solid var(--line-strong);
    color: var(--muted);
  }
  .md :global(table) {
    border-collapse: collapse;
    margin: 8px 0;
  }
  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--line-strong);
    padding: 4px 8px;
    text-align: left;
    vertical-align: top;
  }
  .md :global(th) {
    background: var(--bg);
    font-weight: 600;
  }
  .md :global(img) {
    max-width: 100%;
  }
  .md :global(hr) {
    border: none;
    border-top: 1px solid var(--line);
    margin: 12px 0;
  }
  .empty {
    color: var(--muted);
    font-style: italic;
  }
  @media print {
    .md :global(table),
    .md :global(pre),
    .md :global(blockquote) {
      break-inside: avoid;
    }
  }
</style>
