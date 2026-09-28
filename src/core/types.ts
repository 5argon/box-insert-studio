/** All lengths are millimetres. Top view: x → right, y → toward the front of the box. */
export type Mm = number;

/** `row` lays children left→right (vertical bars), `column` back→front (horizontal bars). */
export type Dir = 'row' | 'column';

export type Side = 'left' | 'right' | 'back' | 'front';

export type ChildSize = { mode: 'flex'; weight: number } | { mode: 'fixed'; mm: Mm };

/**
 * `divider`: children are compartments separated by glued dividers; sizes are compartment insides.
 * `trays`: children become separate lift-out trays with their own base and walls; sizes are tray outsides.
 */
export type Join = 'divider' | 'trays';

export interface SplitChild {
  size: ChildSize;
  node: LayoutNode;
}

export interface SplitNode {
  kind: 'split';
  id: string;
  dir: Dir;
  join: Join;
  /** Dividers of this split stand this much lower than the walls, for finger access. */
  lower: Mm;
  children: SplitChild[];
}

export interface SectionNode {
  kind: 'section';
  id: string;
  /** Sides that get a finger notch cut into the wall or divider there. */
  notches: Side[];
  /** This compartment's notch size, instead of the project's. */
  notchSize?: { width: Mm; depth: Mm };
  /** An arrow drawn beside the letter: which way the items in this slot face. */
  arrow?: Side;
  /** Items to simulate standing in a row along the arrow, e.g. cards or tokens on edge. */
  items?: ItemSpec;
  /**
   * Removable box(es) standing in this compartment. The layout inside works like a layer:
   * a top-level `trays` split gives separate boxes, `divider` splits give one box with dividers.
   * Only one level deep: compartments inside an insert cannot have inserts of their own.
   */
  /** Layers of material glued on the floor to bring shallow contents up within reach. */
  pad?: number;
  insert?: {
    root: LayoutNode;
    /** Two identical boxes stacked, each half the height, each with its own floor. */
    stacked?: boolean;
  };
}

/**
 * One kind of item standing in a row along the compartment's arrow. A box is width (across the
 * arrow) × height (standing up) × thickness (along the arrow); a cylinder is a disc of diameter
 * `width` standing on edge, `thickness` along the arrow.
 */
export interface ItemSpec {
  on: boolean;
  shape: 'box' | 'cylinder';
  width: Mm;
  height: Mm;
  thickness: Mm;
  /** Space to leave free at the arrow's head, e.g. finger room. */
  spare: Mm;
}

export type LayoutNode = SplitNode | SectionNode;

export interface Layer {
  id: string;
  name: string;
  /** Total tray height including the base. */
  height: Mm;
  root: LayoutNode;
}

export interface SheetSpec {
  preset: string;
  width: Mm;
  height: Mm;
}

export interface Project {
  version: 2;
  name: string;
  /** Notes about the insert, in Markdown; printed at the top of the export. */
  readme?: string;
  box: { width: Mm; depth: Mm; height: Mm };
  /** The sheet material everything is cut from: foam board, MDF, greyboard… */
  material: {
    thickness: Mm;
    /**
     * The base of each layer's trays from thinner (or thicker) sheet, e.g. 3 mm under 5 mm walls.
     * Unset: the same as `thickness`. Floors of removable boxes and raised floors stay `thickness`.
     */
    baseThickness?: Mm;
    sheet: SheetSpec;
    /** Damaged edge trimmed off every side of a sheet before cutting. */
    trim: Mm;
    /** Material lost per cut. */
    kerf: Mm;
  };
  /** Piece sizes are rounded to this step, so near-identical pieces become one cut size. */
  precision: Mm;
  /** Total gap between a tray and its neighbours or the box. */
  clearance: Mm;
  /** `under`: walls stand on the base. `inside`: walls wrap around the base. */
  base: 'under' | 'inside';
  /** Which pair of outer walls runs the full length: `x` = back and front, `y` = left and right. */
  fullWalls: 'x' | 'y';
  /**
   * `glued` (the default): each layer is one tray and splits add glued dividers. `separate`: every
   * compartment is its own lift-out tray, as with separate boxes inside a removable box.
   */
  construction?: 'glued' | 'separate';
  notch: { width: Mm; depth: Mm };
  /** Bottom layer first. */
  layers: Layer[];
}
