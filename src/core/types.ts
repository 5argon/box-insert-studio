/** All lengths are millimetres. Top view: x → right, y → toward the front of the box. */
export type Mm = number;
export type MaterialKind = 'primary' | 'secondary';

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
  /** Use secondary material for the divider after this child. Ignored for trays and the last child. */
  secondaryDivider?: boolean;
}

export interface SplitNode {
  kind: 'split';
  id: string;
  dir: Dir;
  join: Join;
  /** Dividers of this split stand this much lower than the walls, for finger access. */
  lower: Mm;
  /**
   * A letter kept for this split: its compartments are named after it, B1, B2, …, those of a
   * split inside it B2-1, B2-2, …, and no other compartment is lettered B. Not inside a box.
   */
  letter?: string;
  /**
   * A colour kept for this split, as a hue: its compartments take shades of it, and automatic
   * colours keep away from it where enough others are left. Not inside a box.
   */
  hue?: number;
  children: SplitChild[];
}

export interface SectionNode {
  kind: 'section';
  id: string;
  /** Sides that get a finger notch cut into the wall or divider there. */
  notches: Side[];
  /** This compartment's own notch size on selected sides, instead of the project's. */
  notchSize?: NotchSize & {
    /** Sides using the override. Unset preserves older designs by applying it to every notch. */
    sides?: Side[];
  };
  /** Sides whose wall or divider is cut down beside this compartment. Never also notched. */
  lowered?: Side[];
  /** This compartment's own lowered height on selected sides, instead of the project's `lowered`. */
  lowerHeight?: {
    /** Height of the lowered side, in percent of the compartment's depth. */
    percent: number;
    /** Sides using it. Unset applies it to every lowered side. */
    sides?: Side[];
  };
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
    /** Two identical box bodies divide the height beneath any top lid, each with its own floor. */
    stacked?: boolean;
    /** With `stacked`: build only the lower box and leave the half above it empty. */
    emptyAbove?: boolean;
    /** Cut the box bases from the secondary material when it is configured. */
    secondaryBase?: boolean;
    /** A loose lid rests on the box walls, on the upper box only when a pair is stacked. */
    lid?: boolean;
    /** With separate boxes, one lid covers the entire group instead of one lid per box. */
    sharedLid?: boolean;
    /** Cut the lids from the secondary material when it is configured. */
    secondaryLid?: boolean;
    /** Edges with finger notches cut through each lid, centred along the edge. */
    lidNotches?: Side[];
    /** This lid's own shape; independent of the project's wall notch settings. */
    lidNotchSize?: NotchSize;
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

/**
 * Sheet packing: `fewest` packs pieces anywhere (MaxRects) for the fewest sheets; `guillotine`
 * keeps every cut edge to edge; `strips` cuts the sheet into full-length strips first, then
 * crosses them.
 */
export type CutLayout = 'fewest' | 'guillotine' | 'strips';

/**
 * The sheet edge the longest cuts run along, for strips and edge-to-edge packing. `short` keeps
 * cuts within reach of a ruler no longer than the sheet's short edge; `long` makes fewer, longer cuts.
 */
export type CutAlong = 'short' | 'long';

/** A slanted finger notch: the opening at the top edge, how deep it goes, and its flat bottom. */
export interface NotchSize {
  width: Mm;
  depth: Mm;
  /** Flat bottom as a percentage of the opening; unset is 50. 0 is a V, 100 a straight-sided slot. */
  bottom?: number;
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

/**
 * The sheets a builder can buy and how they cut them. It is theirs rather than the design's: kept
 * per browser, never saved with a design, and unchanged by opening another one.
 */
export interface CutSetup {
  /** Sheet size for the primary material, and for the secondary unless it has its own. */
  sheet: SheetSpec;
  /** The secondary material's own sheet size, e.g. a bulk size of the thinner board. Unset: `sheet`. */
  secondarySheet?: SheetSpec;
  /** Damaged edge trimmed off every side of a sheet before cutting. */
  trim: Mm;
  /** Material lost per cut. */
  kerf: Mm;
  /** Packing for primary material sheets. */
  layout: CutLayout;
  /** Independent packing for secondary material sheets. */
  secondaryLayout: CutLayout;
  /** The edge the longest cuts run along, on sheets of both materials. */
  cutAlong: CutAlong;
  /**
   * Removable boxes are cut from sheets of their own, never sharing one with the trays: for making
   * them from another kind of board of the same thickness.
   */
  separateBoxes: boolean;
  /** With `separateBoxes`: the size of those sheets, in both materials. Unset: each material's own. */
  boxSheet?: SheetSpec;
}

export interface Project {
  version: 2;
  name: string;
  /** Notes about the insert, in Markdown; printed at the top of the export. */
  readme?: string;
  box: { width: Mm; depth: Mm; height: Mm };
  /** Primary sheet material and an optional secondary thickness: foam board, MDF, greyboard… */
  material: {
    thickness: Mm;
    /** Optional second sheet thickness, available for bases, lids and individual dividers. */
    secondaryThickness?: Mm;
  };
  /** Piece sizes are rounded to this step, so near-identical pieces become one cut size. */
  precision: Mm;
  /** Total gap between a tray and its neighbours or the box. */
  clearance: Mm;
  /** `under`: walls stand on the base. `inside`: walls wrap around the base. */
  base: 'under' | 'inside';
  /** The bottom layer's trays have no base and stand on the box floor. */
  noBase?: boolean;
  /**
   * Trays have no wall where they meet the box, e.g. to keep a clear box see-through: dividers run
   * out to the box instead. Walls between neighbouring trays and removable boxes are unchanged.
   */
  noOuterWalls?: boolean;
  /** Cut every layer's tray bases from the secondary material when it is configured. */
  secondaryBase?: boolean;
  /** Which pair of outer walls runs the full length: `x` = back and front, `y` = left and right. */
  fullWalls: 'x' | 'y';
  /**
   * `glued` (the default): each layer is one tray and splits add glued dividers. `separate`: every
   * compartment is its own lift-out tray, as with separate boxes inside a removable box.
   */
  construction?: 'glued' | 'separate';
  notch: NotchSize;
  /** How tall a lowered side stands, in percent of the compartment's depth. Unset: 75. */
  lowered?: number;
  /** Bottom layer first. */
  layers: Layer[];
}
