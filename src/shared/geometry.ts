/** A concrete canvas size after the host has been measured. */
export interface CanvasSize {
  width: number
  height: number
}

/** Deterministic geometry produced by the Resolve stage. */
export interface ResolvedRect {
  x: number
  y: number
  width: number
  height: number
}

export const DESIGN_PIXELS_PER_UNIT = 1080
export const DESIGN_WIDTH = 1920
export const DESIGN_HEIGHT = 1080

/** Convert between center-origin world units and unprojected design pixels. */
export function worldToDesignPx([x, y]: readonly [number, number]): readonly [number, number] {
  return [DESIGN_WIDTH / 2 + x * DESIGN_PIXELS_PER_UNIT, DESIGN_HEIGHT / 2 - y * DESIGN_PIXELS_PER_UNIT]
}

export function designPxToWorld([x, y]: readonly [number, number]): readonly [number, number] {
  return [(x - DESIGN_WIDTH / 2) / DESIGN_PIXELS_PER_UNIT, (DESIGN_HEIGHT / 2 - y) / DESIGN_PIXELS_PER_UNIT]
}

/** A box-relative point in [-1, 1], expressed as top-left pixel offsets. */
export function boxPointOffset([x, y]: readonly [number, number], width: number, height: number) {
  return [(1 + x) / 2 * width, (1 - y) / 2 * height] as const
}
