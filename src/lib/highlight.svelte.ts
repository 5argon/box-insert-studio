/**
 * The cut size that stands out across the report, by its cut-list number: the one picked, which
 * stays until picked again, and the one under the pointer.
 */
export class PieceHighlight {
  picked = $state<number>();
  pointed = $state<number>();

  toggle = (n: number) => {
    this.picked = this.picked === n ? undefined : n;
  };
}
