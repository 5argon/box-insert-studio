/**
 * Undo/redo over serialized project states. Every change is recorded; a change that follows the
 * previous one quickly and without a step break (a drag in progress, a burst of typing) is merged
 * into the same undo step. Call `breakStep()` on each new user gesture, such as a click.
 */
export class History {
  private past: string[] = [];
  private future: string[] = [];
  private current: string | undefined;
  private lastAt = -Infinity;
  private pendingBreak = true;

  constructor(
    private readonly limit = 100,
    private readonly coalesceMs = 600,
  ) {}

  /** Record the latest state. Recording the state just restored by undo/redo is a no-op. */
  record(state: string, now: number) {
    if (this.current === undefined) {
      this.current = state;
      return;
    }
    if (state === this.current) return;
    const merge = !this.pendingBreak && now - this.lastAt < this.coalesceMs && this.past.length > 0;
    if (!merge) {
      this.past.push(this.current);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.current = state;
    this.lastAt = now;
    this.pendingBreak = false;
  }

  /** The next change starts a new undo step. */
  breakStep() {
    this.pendingBreak = true;
  }

  undo(): string | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(this.current!);
    this.current = prev;
    this.pendingBreak = true;
    return prev;
  }

  redo(): string | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(this.current!);
    this.current = next;
    this.pendingBreak = true;
    return next;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}
