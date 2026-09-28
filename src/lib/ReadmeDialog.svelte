<script lang="ts">
  import type { Project } from '../core/types';

  let { project }: { project: Project } = $props();
  let dialog: HTMLDialogElement;
  let text: HTMLTextAreaElement;

  export function open() {
    dialog.showModal();
    text.focus();
  }
</script>

<dialog bind:this={dialog} class="readme" aria-label="Project readme">
  <div class="top">
    <h2>Readme</h2>
    <span class="hint">Markdown: # headings, **bold**, - lists, | tables |, [links](https://…). Printed at the top of the cut list &amp; assembly export.</span>
    <button class="primary" onclick={() => dialog.close()}>Done</button>
  </div>
  <textarea
    bind:this={text}
    value={project.readme ?? ''}
    oninput={(e) => (project.readme = e.currentTarget.value)}
    placeholder={'# About this insert\n\nWhat goes where, which game version, anything to remember while building.'}
    spellcheck="true"
    aria-label="Readme in Markdown"
  ></textarea>
</dialog>

<style>
  .readme {
    width: min(760px, 94vw);
    height: min(720px, 88vh);
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }
  .readme[open] {
    display: grid;
    grid-template-rows: auto 1fr;
  }
  .readme::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }
  .top {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }
  .top h2 {
    margin: 0;
  }
  .top .hint {
    flex: 1;
    font-size: 12px;
  }
  textarea {
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--text);
    background: var(--input);
    border: none;
    border-radius: 0 0 10px 10px;
    padding: 14px 16px;
    resize: none;
    outline: none;
    min-height: 0;
  }
</style>
