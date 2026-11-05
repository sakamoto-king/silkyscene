import type { CanvasSize, ResolvedRect } from "../shared/geometry.js"

export interface StrokeStyle {
  color: string
  width: number
  /** Line only. */
  cap?: "round" | "butt" | "square"
  dash?: readonly [number, number]
  /** docs/02: rect / text border style. */
  style?: "dashed"
}
export type Matrix = readonly [number, number, number, number, number, number]

interface ResolvedPrimitiveBase {
  id: string
  opacity?: number
  /** "screen" primitives ignore the camera. */
  layer?: "world" | "screen"
  /** World primitive drawn outside the world mask. */
  ignoreMask?: boolean
  /** Group and own scale, in the layer's design pixels; applied with origin (0, 0). */
  transform?: Matrix
  /** docs/04: full layer-px → screen-px homography (3 × 3 row-major, includes transform). Used only when scene.view3d is not flat. */
  transform3d?: readonly number[]
  /** docs/02: hard-edged wipe of the element's own box; absent = fully shown. */
  reveal?: { amount: number; from: "left" | "right" | "top" | "bottom" }
  /** docs/02: clip from the nearest clip: true group(s), in the primitive's own (pre-transform) layer px; radius px. */
  clip?: { x: number; y: number; width: number; height: number; radius: number }
}

export interface ResolvedRectPrimitive extends ResolvedPrimitiveBase {
  kind: "rect"
  rect: ResolvedRect
  fill: string
  radius?: number
  stroke?: StrokeStyle
  shadow?: { x: number; y: number; blur: number; spread: number; color: string }
  /** docs/02: px. */
  stripes?: { angle: number; color1: string; color2: string; size: number; size2: number }
}

export interface ResolvedTextPrimitive extends ResolvedPrimitiveBase {
  kind: "text"
  /** Top-left position in resolved canvas coordinates. */
  x: number
  y: number
  text: string
  fontSize: number
  fill: string
  fontFamily?: string
  fontWeight?: number
  width?: number
  height?: number
  align?: "left" | "center" | "right"
  lineHeight?: number
  letterSpacing?: number
  padding?: readonly [number, number]
  background?: string
  stroke?: StrokeStyle
  /** docs/02 */
  shadow?: { x: number; y: number; blur: number; spread: number; color: string }
}

export interface ResolvedLinePrimitive extends ResolvedPrimitiveBase {
  kind: "line"
  /** Endpoints in resolved canvas coordinates. */
  x1: number
  y1: number
  x2: number
  y2: number
  connected?: boolean
  /** docs/04: endpoints already projected to screen px (x1, y1, x2, y2), used when scene.view3d is not flat. */
  screen3d?: readonly [number, number, number, number]
  /** docs/02: curved line — SVG path data in layer px (already trimmed); absent = straight segment x1..x2. */
  d?: string
  /** docs/02: the same curve projected to screen px, used when scene.view3d is not flat. */
  d3?: string
  stroke: StrokeStyle
}

export interface ResolvedImagePrimitive extends ResolvedPrimitiveBase {
  kind: "image"
  rect: ResolvedRect
  src: string
  fit: "contain" | "cover"
  radius?: number
}

export interface ResolvedPathPrimitive extends ResolvedPrimitiveBase {
  kind: "path"
  rect: ResolvedRect
  d: string
  viewBox: readonly [number, number]
  /** docs/02: drawn fraction of the stroke (absent = 1). */
  trim?: number
  fill?: string
  stroke?: StrokeStyle
}

export interface ResolvedDotsPrimitive extends ResolvedPrimitiveBase {
  kind: "dots"
  rect: ResolvedRect
  spacing: number
  radius: number
  color: string
}

/** Groups draw nothing; they exist so the inspector can show the hierarchy. */
export interface ResolvedGroupPrimitive extends ResolvedPrimitiveBase {
  kind: "group"
  rect: ResolvedRect
  children: readonly string[]
}

/** Null objects draw nothing; the inspector marks them with a small cross. */
export interface ResolvedNullPrimitive extends ResolvedPrimitiveBase {
  kind: "null"
  rect: ResolvedRect
}

export type ResolvedPrimitive =
  | ResolvedNullPrimitive
  | ResolvedImagePrimitive
  | ResolvedRectPrimitive
  | ResolvedTextPrimitive
  | ResolvedLinePrimitive
  | ResolvedPathPrimitive
  | ResolvedDotsPrimitive
  | ResolvedGroupPrimitive

export interface ResolvedScene {
  canvas: CanvasSize
  background?: string
  camera?: readonly [number, number, number, number, number, number]
  /** docs/04 experiment. camera stays the 2D framing matrix (the 2D framing source); this adds the perspective on top. */
  view3d?: { flat: boolean; declared: object; resolved: { distance: number; height: number; pitch: number; yaw: number }
    perspectiveScale?: number; elements?: readonly { id: string; z: number; scale: number; minW: number }[] }
  /** Screen-space alpha stops over the world layer, from the top edge: [offset 0..1, alpha]. */
  worldMask?: readonly (readonly [number, number])[]
  primitives: readonly ResolvedPrimitive[]
}
