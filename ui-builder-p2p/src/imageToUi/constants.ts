/** Canonical mobile artboard — all pixel math targets this width */
export const MOBILE_CANVAS_WIDTH_PX = 390;

/** iOS-style safe inset for hero stacks (status bar / notch guard) */
export const SAFE_AREA_TOP_PX = 60;

/** Max nodes before deterministic fallback (keeps Yjs + DnD snappy) */
export const SLICE_COMPLEXITY_NODE_BUDGET = 48;

/**
 * Autonomy merge threshold on the same scale as `estimateBitmapComplexity`.
 * `10` was far too low and forced almost every upload into fallback hero mode.
 */
export const AUTONOMY_COMPLEXITY_MERGE_THRESHOLD = 420;

/** Row gap / padding snap to whole pixels to avoid 1px drift */
export const PIXEL_SNAP = (n: number) => Math.round(n);
