import { DESIGN_HEIGHT, DESIGN_PIXELS_PER_UNIT, DESIGN_WIDTH } from "../shared/geometry.js"
import { isEase } from "./easing.js"
import { parseColor } from "../shared/color.js"
import type { Ease } from "./easing.js"
export { DESIGN_PIXELS_PER_UNIT }
export type { Ease }

/** Reserved container id: the 1920 × 1080 frame itself, center (0, 0), not moved by the camera. */
export const SCREEN = "screen"

export type Length = number | `${number}%`
export type Point = readonly [number, number]
export type TextAlign = "left" | "center" | "right"

export interface Region {
  id: string
  /** Region center in world units, relative to the canvas center. Y points up. */
  x: number
  y: number
  width: number
  height: number
}

export interface Layout {
  /** A region id, a group id, or "screen". */
  region: string
  /** Offset right and up from the region center, in u or % of the full axis. */
  x: Length
  y: Length
  /** The point on the element box attached to x/y, center (0, 0), range [-1, 1]. */
  anchor: Point
  width?: Length
  height?: Length
}

interface BoxElement {
  id: string
  layout: Layout
  opacity?: number
  /** Visual scale around the layout anchor; does not change layout. */
  scaleX?: number
  scaleY?: number
  /** docs/02: visual rotation in degrees, clockwise on screen (CSS rotate), around origin; does not change layout. */
  rotate?: number
  /** Scale origin on the box, center-zero [-1, 1]; defaults to layout.anchor (AE: anchor point vs position). */
  origin?: Point
  /** World elements only: draw outside canvas.worldMask (backgrounds such as dots). Always painted below masked ones. */
  ignoreMask?: boolean
  /** Motion role (docs/03): "free" objects travel on arcs, "bound" ones belong to a box and only slide. Default by kind. */
  motion?: MotionRole
  /** Default arc for this element's x/y cues, as a fraction of the travel distance (free only). */
  arc?: number
  arcSide?: ArcSide
  /** docs/04 (camera 3D experiment): depth in u, + toward the viewer. Adds up through groups. Ignored without camera.view3d. */
  z?: number
  /** docs/02: hard-edged wipe, 0 = hidden, 1 = whole box (default). Drawable boxes only (not group / null). */
  reveal?: number
  /** Edge the wipe grows from. Default "left". */
  revealFrom?: RevealFrom
  /** docs/02: why this element's tracks must stay frame-dense (physics, hand-drawn path…); silences lintScene for it. */
  bakedReason?: string
}
export type RevealFrom = "left" | "right" | "top" | "bottom"
/** docs/02: border style of rect / text strokes. */
export type StrokeStyleName = "solid" | "dashed"

export type MotionRole = "free" | "bound"
/** "auto" bends away from the container center; left / right are relative to the travel direction. */
export type ArcSide = "auto" | "left" | "right"
export type LineLayer = "under" | "world" | "screen"
/** Default arc of a free x/y move when neither the cue, the element nor the project sets one. */
export const DEFAULT_ARC = 0.15
/** Text and dots belong to a box (bound); everything else that can move is a free object. */
export function motionOf(element: ElementDefinition): MotionRole {
  if (element.kind === "line") return "bound"
  return element.motion ?? (element.kind === "text" || element.kind === "dots" ? "bound" : "free")
}

/** All lengths in u (1 u = 1080 design px). */
export interface Shadow { x: number; y: number; blur: number; spread?: number; color: string }
export type LineCap = "round" | "butt" | "square"

export type ElementDefinition =
  | (BoxElement & { kind: "rect"; fill: string; stroke?: string; strokeWidth?: number; strokeStyle?: StrokeStyleName; radius?: number; shadow?: Shadow
      /** docs/02: static diagonal stripes over the fill (CSS repeating-linear-gradient). */
      stripes?: Stripes })
  | (BoxElement & { kind: "text"; text: string; fontSize: number; color: string; align: TextAlign; weight?: number;
      fontFamily?: string; lineHeight?: number; letterSpacing?: number; padding?: Point; background?: string;
      stroke?: string; strokeWidth?: number; strokeStyle?: StrokeStyleName; bind?: "camera.zoom%"
      /** docs/02: box-shadow of the text box (same fields as rect.shadow). */
      shadow?: Shadow })
  | (BoxElement & { kind: "image"; src: string; fit: "contain" | "cover"
      /** docs/02: corner radius in u (border-radius); ≥ half the side gives a circle. */
      radius?: number })
  | (BoxElement & { kind: "path"; d: string; viewBox: Point; fill?: string; stroke?: string; strokeWidth?: number
      /** docs/02: drawn fraction of the stroke along the path length, 0..1 (default 1). */
      trim?: number })
  | (BoxElement & { kind: "dots"; spacing: number; radius: number; color: string })
  | (BoxElement & { kind: "group"
      /** docs/02: clip every descendant to the group's own box (overflow: hidden); radius in u rounds the clip corners. */
      clip?: boolean; radius?: number })
  /** Null object: a point with no picture, for line ends, motion targets and inspector reference marks. */
  | (BoxElement & { kind: "null" })
  | { id: string; kind: "line"; from: Port; to: Port; color: string; width: number; opacity?: number; connected?: boolean;
      /** The layer the line is drawn on; ends on other layers are projected into it. Default: see docs/03. */
      layer?: LineLayer;
      cap?: LineCap; dash?: Point
      /** docs/02: drawn fraction from `from` toward `to`, 0..1 (default 1). */
      trim?: number
      /** docs/02: width (and dash) in screen px — a world / under line keeps the same thickness at every camera zoom. */
      screenWidth?: boolean
      /** docs/02: draw a port-to-port cubic Bézier instead of a straight segment. "horizontal": control points leave
       *  `from` to the right and enter `to` from the left by h = clamp(dx · curveRatio, curveMin, curveMax) (dx = to.x − from.x,
       *  layer px); "vertical" is the same on the downward screen axis. Absent = straight line (unchanged). */
      curve?: LineCurve
      /** Default 0.5. */
      curveRatio?: number
      /** u, defaults DEFAULT_CURVE_MIN / DEFAULT_CURVE_MAX (33 / 240 design px). */
      curveMin?: number
      curveMax?: number
      bakedReason?: string }
export type LineCurve = "horizontal" | "vertical"
/** docs/02: curve handle h = max(33, min(240, dx · 0.5)) world px. */
export const DEFAULT_CURVE_RATIO = 0.5
export const DEFAULT_CURVE_MIN = 33 / 1080
export const DEFAULT_CURVE_MAX = 240 / 1080
/** docs/02: rect stripes. angle in CSS degrees (default 45), size = band width in u, color1 first. */
/** A CSS gradient fill (rect.fill / canvas.background): linear-, radial- or repeating-*-gradient(...). Static: not tweenable. */
export function isGradient(value: unknown): value is string {
  return typeof value === "string" && /^\s*(?:repeating-)?(?:linear|radial|conic)-gradient\(.*\)\s*$/s.test(value)
}
export interface Stripes { angle?: number; color1: string; color2: string; size: number; size2?: number }

export interface Port {
  element: string
  /** Same center-origin box coordinates as Layout.anchor. */
  at: Point
}

export interface Camera {
  projection: "orthographic"
  target: { x: number; y: number; z: number }
  yaw: { rad: number; cycles: number }
  pitch: { rad: number; cycles: number }
  /** Positive rotates the camera clockwise and the rendered picture counterclockwise. */
  roll: { rad: number; cycles: number }
  distance: number
  focal: number
  zoom: number
  /** Camera-level defaults for target.x/y moves (docs/04); cue values win, then these, then project motion. */
  arc?: number
  /** "auto" for the camera bends upward (crane / jib habit); left / right are relative to the travel direction. */
  arcSide?: ArcSide
  /** Seconds the framing (pan) trails the look target; default DEFAULT_CAMERA_LAG. */
  lag?: number
  /** Ease of the trailing framing; defaults to the cue's own ease. */
  followEase?: Ease
  /** Largest extra screen px the arc may push the frame beyond the regions' union (vs the straight path). */
  maxOvershoot?: number
  /** docs/04 experiment: opt-in perspective camera. Absent = the 2D camera path, unchanged. */
  view3d?: View3D
  /** docs/04: camera body start position, u (needs view3d). Default: above the target at z = target.z + view3d.distance. */
  position?: { x: number; y: number; z: number }
  /** docs/04: optional second additive plane control (u, default 0) so approach-to-target can overlap with position.*. */
  approach?: { x: number; y: number }
  /** docs/02: why the camera tracks must stay frame-dense; silences lintScene for the camera. */
  bakedReason?: string
}
/** docs/04: perspective view on top of the 2D camera. Lengths in u, angles in degrees. */
export interface View3D {
  /** Pivot-to-camera distance (focal length) in u: plane z = 0 keeps its 2D size; smaller = stronger perspective. */
  distance: number
  /** Extra camera height in u above the pivot (default 0); > 0 makes everything smaller like a real rise. */
  height?: number
  /** Degrees; > 0: camera moves to world −Y and looks up the plane (the top of the picture recedes). */
  pitch?: number
  /** Degrees; > 0: camera moves to world +X and looks left (the left of the picture recedes). */
  yaw?: number
  /** Limit for |pitch| and |yaw| at every checked time, degrees (default DEFAULT_MAX_TILT, at most 80). */
  maxTilt?: number
}
export const DEFAULT_MAX_TILT = 35
/** Legacy explicit tilt (docs/04, not recommended); cannot be mixed with position.* (docs/04). */
export type View3DProperty = "view3d.pitch" | "view3d.yaw" | "view3d.height"
/** docs/04: camera body plane position track, u. Height / pitch / yaw are derived, never written. */
export type PositionProperty = "position.x" | "position.y" | "position.z" | "approach.x" | "approach.y" | "target.z"
/** Default lag of the camera framing behind its look target, in seconds (docs/04). */
export const DEFAULT_CAMERA_LAG = 0
/** Default limit for arc-induced overshoot of the frame beyond the world regions, in design px. */
export const DEFAULT_MAX_OVERSHOOT = 48

interface CueTiming {
  at: string
  target: string
  duration: number
  /** docs/02: this cue is part of an intentionally frame-dense track; the reason is shown instead of a lint warning. */
  bakedReason?: string
}

export type NumericProperty = "opacity" | "zoom" | "target.x" | "target.y" | "scaleX" | "scaleY" | "scale" | "rotate" | "trim" | "reveal" | View3DProperty | PositionProperty
/** docs/02: tweenable colors. fill: rect / path; color: text / line; background: text. docs/02: strokeColor: border of rect / text, stroke of path. */
export type ColorProperty = "fill" | "color" | "background" | "strokeColor"
export type LayoutProperty = "x" | "y" | "width" | "height"
/** Path points are layout x/y values in u, relative to the container center, Y up. */
export interface MotionPath { curve: "linear" | "quadratic" | "cubic"; points: Point[] }

export type Cue = CueTiming & (
  | { property: NumericProperty; to: number; ease?: Ease; interpolation?: "log"
      /** Camera only: arc / arcSide / followEase on target.x/y; lag on target.x/y (pan) or zoom. */
      arc?: number; arcSide?: ArcSide; lag?: number; followEase?: Ease }
  | { property: LayoutProperty; to: Length; ease?: Ease; arc?: number; arcSide?: ArcSide }
  | { property: "motionPath"; path: MotionPath; ease?: Ease }
  | { property: "text"; to: string }
  | { property: ColorProperty; to: string; ease?: Ease }
  | { property: "stroke"; to: string; duration: 0 }
  | { property: "connected"; to: boolean; duration: 0 }
)

/** Screen-space alpha ramp over the world layer. at: center-zero % of frame height, Y up (±50% = edges). */
export interface WorldMask { stops: { at: `${number}%`; alpha: number }[] }

export interface ProjectDocument {
  format: "silkyscene@1"
  canvas: { width: typeof DESIGN_WIDTH; height: typeof DESIGN_HEIGHT; background: string; worldMask?: WorldMask }
  regions: Region[]
  elements: ElementDefinition[]
  camera: Camera
  cues: Cue[]
  /** Project-wide motion defaults (docs/03). */
  motion?: { arc?: number; arcSide?: ArcSide }
  /** docs/04 editor only: keyframe binding groups (anchor ids that drag together). Never read by the solver. */
  editor?: EditorMeta
}
export interface EditorMeta {
  /** Explicit groups: each is a list of cue anchor ids (cue.at) that move together when dragged in the inspector. */
  groups?: string[][]
  /** Anchors taken out of the automatic grouping (same camera move / same element x·y move). */
  ungrouped?: string[]
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}
function positive(value: unknown): value is number {
  return number(value) && value > 0
}
function label(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}
function ratio(value: unknown): value is number {
  return number(value) && value >= 0 && value <= 1
}
function point(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 &&
    value.every(axis => number(axis) && axis >= -1 && axis <= 1)
}
function length(value: unknown): value is Length {
  return number(value) || (typeof value === "string" && /^-?\d+(?:\.\d+)?%$/.test(value) &&
    Number.isFinite(Number(value.slice(0, -1))))
}
function dimension(value: unknown): boolean {
  return length(value) && (typeof value === "number" ? value : Number(value.slice(0, -1))) > 0
}
function angle(value: unknown): value is { rad: number; cycles: number } {
  return object(value) && number(value.rad) && value.rad >= -Math.PI && value.rad <= Math.PI &&
    Number.isSafeInteger(value.cycles)
}
function port(value: unknown): value is Port {
  return object(value) && label(value.element) && point(value.at)
}

/** Strict schema: any field not listed for this object is an error, so typos (e.g. "container" for layout.region) fail loudly. */
function only(value: Record<string, unknown>, keys: readonly string[], where: string) {
  const extra = Object.keys(value).filter(key => !keys.includes(key))
  require(extra.length === 0, where + " 有未知字段：" + extra.join(", "))
}
const shadowOk = (sh: unknown) => sh === undefined || (object(sh) && Object.keys(sh).every(k => ["x", "y", "blur", "spread", "color"].includes(k)) &&
  number(sh.x) && number(sh.y) && number(sh.blur) && (sh.blur as number) >= 0 && (sh.spread === undefined || number(sh.spread)) && label(sh.color))
const BOX_KEYS = ["id", "kind", "layout", "opacity", "scaleX", "scaleY", "rotate", "origin", "ignoreMask", "motion", "arc", "arcSide", "z", "reveal", "revealFrom", "bakedReason"]
const VIEW3D_PROPS = ["view3d.pitch", "view3d.yaw", "view3d.height"]
const arcValue = (v: unknown) => v === undefined || (number(v) && v >= 0 && v <= 1)
const arcSide = (v: unknown) => v === undefined || v === "auto" || v === "left" || v === "right"
const KIND_KEYS: Record<string, readonly string[]> = {
  rect: ["fill", "stroke", "strokeWidth", "strokeStyle", "radius", "shadow", "stripes"],
  text: ["text", "fontSize", "color", "align", "weight", "fontFamily", "lineHeight", "letterSpacing", "padding",
    "background", "stroke", "strokeWidth", "strokeStyle", "bind", "shadow"],
  image: ["src", "fit", "radius"], path: ["d", "viewBox", "fill", "stroke", "strokeWidth", "trim"], dots: ["spacing", "radius", "color"], group: ["clip", "radius"], null: [],
}
const EASE_KEYS: Record<string, readonly string[]> = {
  cubicBezier: ["type", "x1", "y1", "x2", "y2"], spring: ["type", "stiffness", "damping", "mass"], steps: ["type", "count", "position"],
}

function color(value: unknown): boolean { return value === undefined || label(value) }
function optionalPositive(value: unknown): boolean { return value === undefined || positive(value) }
function lengthKind(value: Length | undefined) { return typeof value === "string" ? "%" : typeof value === "number" ? "u" : undefined }
const pointCount = { linear: (n: number) => n >= 2, quadratic: (n: number) => n >= 3 && n % 2 === 1,
  cubic: (n: number) => n >= 4 && (n - 1) % 3 === 0 }

function parseElement(element: Record<string, unknown>, containers: ReadonlySet<string>) {
  const id = element.id as string
  require(element.opacity === undefined || ratio(element.opacity), id + " 的透明度无效")
  if (element.kind === "line") {
    only(element, ["id", "kind", "from", "to", "color", "width", "opacity", "connected", "cap", "dash", "layer", "trim", "screenWidth",
      "curve", "curveRatio", "curveMin", "curveMax", "bakedReason"], id)
    require(element.curve === undefined || element.curve === "horizontal" || element.curve === "vertical", id + " 的 curve 须为 horizontal 或 vertical（不写 = 直线）")
    require(element.curve !== undefined || (element.curveRatio === undefined && element.curveMin === undefined && element.curveMax === undefined),
      id + " 没写 curve，不能单独写 curveRatio / curveMin / curveMax")
    require(element.curveRatio === undefined || positive(element.curveRatio), id + " 的 curveRatio 须为正数")
    require([element.curveMin, element.curveMax].every(v => v === undefined || (number(v) && v >= 0)), id + " 的 curveMin / curveMax 须为 ≥ 0 的 u")
    require(((element.curveMin as number | undefined) ?? DEFAULT_CURVE_MIN) <= ((element.curveMax as number | undefined) ?? DEFAULT_CURVE_MAX), id + " 的 curveMin 不能大于 curveMax")
    require(element.bakedReason === undefined || label(element.bakedReason), id + " 的 bakedReason 须为非空说明")
    require(element.screenWidth === undefined || typeof element.screenWidth === "boolean", id + " 的 screenWidth 须为 true / false")
    require(element.trim === undefined || ratio(element.trim), id + " 的 trim 须为 0..1")
    require(element.layer === undefined || element.layer === "under" || element.layer === "world" || element.layer === "screen",
      id + " 的 layer 须为 under、world 或 screen")
    require(port(element.from) && port(element.to), id + " 的连线端点 at 须为中心坐标 [-1, 1]，并指向元素")
    require(label(element.color) && positive(element.width) &&
      (element.connected === undefined || typeof element.connected === "boolean") &&
      (element.cap === undefined || element.cap === "round" || element.cap === "butt" || element.cap === "square") &&
      (element.dash === undefined || (Array.isArray(element.dash) && element.dash.length === 2 && element.dash.every(positive))),
      id + " 的连线定义无效")
    return
  }
  require(typeof element.kind === "string" && Object.hasOwn(KIND_KEYS, element.kind), id + " 的元素类型不受支持")
  only(element, [...BOX_KEYS, ...KIND_KEYS[element.kind]!], id)
  const l = element.layout
  require(object(l), id + " 缺少 layout")
  only(l, ["region", "x", "y", "anchor", "width", "height"], id + ".layout")
  require(label(l.region) && containers.has(l.region) && length(l.x) && length(l.y) &&
    (l.width === undefined || dimension(l.width)) &&
    (l.height === undefined || dimension(l.height)), id + " 的布局约束无效（容器须为区域、在前面声明的组或 screen）")
  require(point(l.anchor), id + " 的 anchor 须为中心坐标 [-1, 1]")
  require([element.scaleX, element.scaleY].every(v => v === undefined || (number(v) && v >= 0)), id + " 的缩放须为非负数")
  require(element.rotate === undefined || number(element.rotate), id + " 的 rotate 须为角度数（度）")
  require(element.origin === undefined || point(element.origin), id + " 的 origin 须为中心坐标 [-1, 1]")
  require(element.ignoreMask === undefined || typeof element.ignoreMask === "boolean", id + " 的 ignoreMask 须为布尔值")
  require(element.motion === undefined || element.motion === "free" || element.motion === "bound", id + " 的 motion 须为 free 或 bound")
  require(element.z === undefined || (number(element.z) && Math.abs(element.z) <= 10), id + " 的 z 须为 -10..10 的数（u）")
  require(arcValue(element.arc) && arcSide(element.arcSide), id + " 的 arc 须为 0..1，arcSide 须为 auto、left 或 right")
  require(motionOf(element as unknown as ElementDefinition) === "free" || (element.arc === undefined && element.arcSide === undefined),
    id + " 是 bound 元素（框内文字、按钮、标签），不能设置 arc / arcSide")
  require(element.reveal === undefined || ratio(element.reveal), id + " 的 reveal 须为 0..1")
  require(element.revealFrom === undefined || ["left", "right", "top", "bottom"].includes(element.revealFrom as string), id + " 的 revealFrom 须为 left、right、top 或 bottom")
  require((element.reveal === undefined && element.revealFrom === undefined) || (element.kind !== "group" && element.kind !== "null"),
    id + " 是组或空对象，不能 reveal（组的子元素不在组的画面里，请对子元素分别写 reveal）")
  require(element.strokeStyle === undefined || element.strokeStyle === "solid" || element.strokeStyle === "dashed", id + " 的 strokeStyle 须为 solid 或 dashed")
  require(element.bakedReason === undefined || label(element.bakedReason), id + " 的 bakedReason 须为非空说明")
  const sized = dimension(l.width) && dimension(l.height)
  if (element.kind === "rect") {
    const sh = element.shadow
    require(sized && label(element.fill) && color(element.stroke) && optionalPositive(element.strokeWidth) &&
      (element.radius === undefined || (number(element.radius) && element.radius >= 0)) &&
      shadowOk(sh), id + " 的矩形定义无效")
    const st = element.stripes
    if (st !== undefined) {
      require(object(st), id + " 的 stripes 须为 { angle?, color1, color2, size, size2? }")
      only(st, ["angle", "color1", "color2", "size", "size2"], id + ".stripes")
      require((st.angle === undefined || number(st.angle)) && label(st.color1) && label(st.color2) && positive(st.size) && optionalPositive(st.size2),
        id + " 的 stripes 无效（color1 / color2 为颜色，size / size2 为正的 u，angle 为度数）")
    }
  } else if (element.kind === "text") {
    require(typeof element.text === "string" && positive(element.fontSize) && label(element.color) &&
      (element.align === "left" || element.align === "center" || element.align === "right") &&
      (element.fontFamily === undefined || label(element.fontFamily)) &&
      (element.weight === undefined || (number(element.weight) && element.weight >= 100 && element.weight <= 900)) &&
      optionalPositive(element.lineHeight) && (element.letterSpacing === undefined || number(element.letterSpacing)) &&
      (element.padding === undefined || (Array.isArray(element.padding) && element.padding.length === 2 &&
        element.padding.every(v => number(v) && v >= 0))) &&
      color(element.background) && color(element.stroke) && optionalPositive(element.strokeWidth) &&
      (element.bind === undefined || element.bind === "camera.zoom%") && shadowOk(element.shadow),
      id + " 的文字定义无效")
  } else if (element.kind === "image") {
    require(label(element.src) && (l.width !== undefined || l.height !== undefined) &&
      (element.fit === "contain" || element.fit === "cover") &&
      (element.radius === undefined || (number(element.radius) && element.radius >= 0)), id + " 的图片定义无效")
  } else if (element.kind === "path") {
    require(sized && typeof element.d === "string" && /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]+$/.test(element.d) &&
      Array.isArray(element.viewBox) && element.viewBox.length === 2 && element.viewBox.every(positive) &&
      color(element.fill) && color(element.stroke) && optionalPositive(element.strokeWidth) &&
      (element.trim === undefined || ratio(element.trim)), id + " 的路径定义无效")
  } else if (element.kind === "dots") {
    require(sized && positive(element.spacing) && positive(element.radius) && label(element.color) &&
      (element.radius as number) * 2 <= (element.spacing as number), id + " 的点阵定义无效（半径 × 2 不能超过间距）")
  } else if (element.kind === "group") {
    require(sized, id + " 的组须声明宽和高")
    require(element.clip === undefined || typeof element.clip === "boolean", id + " 的 clip 须为 true / false")
    require(element.radius === undefined || (element.clip === true && number(element.radius) && element.radius >= 0), id + " 的 radius 只用于 clip: true 的组，须为 ≥ 0 的 u")
  } else if (element.kind === "null") {
    require(l.width === undefined && l.height === undefined, id + " 是空对象，只有位置，不能声明宽高")
  } else throw new Error(id + " 的元素类型不受支持")
}

function parseCue(cue: Record<string, unknown>, element: ElementDefinition | undefined) {
  const p = cue.property, to = cue.to
  const box = element !== undefined && element.kind !== "line"
  const ease = cue.ease
  if (object(ease) && typeof ease.type === "string" && Object.hasOwn(EASE_KEYS, ease.type)) only(ease, EASE_KEYS[ease.type]!, "ease")
  if (object(cue.path)) only(cue.path, ["curve", "points"], "motionPath")
  if ((p === "motionPath") !== (cue.path !== undefined)) return false
  const eased = ease === undefined || isEase(ease)
  const plain = cue.ease === undefined && cue.interpolation === undefined
  if (cue.target === "camera") {
    require(cue.lag === undefined || (number(cue.lag) && cue.lag >= 0), "相机节点的 lag 须为 ≥ 0 的秒数")
    const pos = p === "position.x" || p === "position.y" || p === "position.z" || p === "approach.x" || p === "approach.y" || p === "target.z"
    require(!pos || (cue.lag === undefined && cue.followEase === undefined), "position.* 是独立的摄像机轨道，不用 lag / followEase；请直接把它的 at 写晚")
    require(cue.lag === undefined || p === "target.x" || p === "target.y" || p === "zoom" || VIEW3D_PROPS.includes(p as string),
      "lag 只能写在相机的 target.x / target.y / zoom / view3d.* 节点上")
    require((cue.arc === undefined && cue.arcSide === undefined && cue.followEase === undefined) || p === "target.x" || p === "target.y" || p === "position.x" || p === "position.y" || p === "approach.x" || p === "approach.y",
      "arc / arcSide 只能写在相机的 target.x / target.y / position.x / position.y / approach.x / approach.y 节点上")
    require(arcValue(cue.arc) && arcSide(cue.arcSide), "相机节点的 arc 须为 0..1，arcSide 须为 auto、left 或 right")
    require(cue.followEase === undefined || isEase(cue.followEase), "相机节点的 followEase 无效")
  } else if (cue.lag !== undefined || cue.followEase !== undefined) return false
  else if (cue.arc !== undefined || cue.arcSide !== undefined) {
    require(arcValue(cue.arc) && arcSide(cue.arcSide), "节点的 arc 须为 0..1，arcSide 须为 auto、left 或 right")
    require((p === "x" || p === "y") && box, "arc / arcSide 只能写在元素的 x / y 节点上")
    require(motionOf(element) === "free", element.id + " 是 bound 元素，只做水平或垂直平移，不能设置 arc")
    require(typeof element.layout.x === "number" && typeof element.layout.y === "number",
      element.id + " 的 x / y 用了百分比，弧线只支持 u 单位")
  }
  if (VIEW3D_PROPS.includes(p as string)) {
    require(cue.target === "camera", "view3d.* 只能写在相机节点上")
    return number(to) && eased && cue.interpolation === undefined
  }
  if (p === "position.x" || p === "position.y" || p === "position.z" || p === "approach.x" || p === "approach.y" || p === "target.z") {
    require(cue.target === "camera", "position.* 只能写在相机节点上")
    return number(to) && eased && cue.interpolation === undefined
  }
  if (p === "rotate") return box && number(to) && eased && cue.interpolation === undefined
  if (p === "trim") return (element?.kind === "line" || element?.kind === "path") && ratio(to) && eased && cue.interpolation === undefined
  if (p === "reveal") return box && element.kind !== "group" && element.kind !== "null" && ratio(to) && eased && cue.interpolation === undefined
  if (p === "fill" || p === "color" || p === "background" || p === "strokeColor") {
    const k = element?.kind
    require(!(p === "fill" && k === "rect" && isGradient((element as { fill?: unknown }).fill)),
      String(cue.target) + " 的 fill 是 CSS 渐变（静态），不能再写 fill 颜色节点；需要变色请叠一层纯色 rect 做透明度过渡")
    const ok = p === "fill" ? k === "rect" || k === "path" : p === "color" ? k === "text" || k === "line"
      : p === "strokeColor" ? (k === "rect" || k === "text" || k === "path") && label((element as { stroke?: unknown }).stroke) : k === "text"
    require(!ok || (typeof to === "string" && parseColor(to) !== undefined),
      "颜色节点的 to 须为 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() / transparent：" + String(cue.target) + " / " + p)
    return ok && eased && cue.interpolation === undefined
  }
  if (p === "opacity" || p === "zoom" || p === "target.x" || p === "target.y" ||
    p === "scaleX" || p === "scaleY" || p === "scale") {
    // Camera cues drive zoom / target only; element cues drive opacity and scale only.
    const valid = cue.target === "camera"
      ? p === "zoom" ? positive(to) : (p === "target.x" || p === "target.y") && number(to)
      : p === "opacity" ? element !== undefined && ratio(to)
        : (p === "scaleX" || p === "scaleY" || p === "scale") && box && number(to) && to >= 0
    return valid && eased && (cue.interpolation === undefined || (p === "zoom" && cue.interpolation === "log"))
  }
  if (p === "x" || p === "y" || p === "width" || p === "height") {
    if (!box || !length(to) || !eased || cue.interpolation !== undefined) return false
    const declared = element.layout[p]
    const resizable = element.kind === "rect" || element.kind === "group" || element.kind === "dots" || element.kind === "path" || element.kind === "image"
    return lengthKind(declared) === lengthKind(to as Length) && (p === "x" || p === "y" || (resizable && dimension(to)))
  }
  if (p === "motionPath") {
    const path = cue.path
    require(!box || motionOf(element) === "free", element!.id + " 是 bound 元素，不能沿路径运动")
    return box && to === undefined && eased && cue.interpolation === undefined && number(element.layout.x) &&
      number(element.layout.y) && object(path) && (path.curve === "linear" || path.curve === "quadratic" || path.curve === "cubic") &&
      Array.isArray(path.points) && pointCount[path.curve](path.points.length) &&
      path.points.every(q => Array.isArray(q) && q.length === 2 && q.every(number))
  }
  if (p === "text") return plain && element?.kind === "text" && element.bind === undefined && typeof to === "string" &&
    (element.layout.width === undefined) === (element.layout.height === undefined)
  return plain && element?.kind === "line" && cue.duration === 0 &&
    (p === "stroke" ? label(to) : p === "connected" && typeof to === "boolean")
}

export function parseProject(value: unknown): ProjectDocument {
  require(object(value), "项目格式应为 silkyscene@1")
  only(value, ["format", "canvas", "regions", "elements", "camera", "cues", "motion", "editor"], "项目")
  const motion = value.motion
  require(motion === undefined || object(motion), "motion 须为对象")
  if (object(motion)) {
    only(motion, ["arc", "arcSide"], "motion")
    require(arcValue(motion.arc) && arcSide(motion.arcSide), "motion.arc 须为 0..1，arcSide 须为 auto、left 或 right")
  }
  require(value.format !== "silkyscene@0",
    "silkyscene@0 使用旧坐标，请先运行 node tools/migrate_scene_v0_to_v1.mjs <旧场景.json> <新场景.json>")
  require(value.format === "silkyscene@1", "项目格式应为 silkyscene@1")
  const { canvas, regions, elements, camera, cues } = value
  const ed = value.editor
  require(ed === undefined || (object(ed) && (ed.groups === undefined || (Array.isArray(ed.groups) && ed.groups.every(g => Array.isArray(g) && g.every(label)))) &&
    (ed.ungrouped === undefined || (Array.isArray(ed.ungrouped) && ed.ungrouped.every(label)))), "editor 须为 { groups?: string[][], ungrouped?: string[] }")
  if (object(ed)) only(ed, ["groups", "ungrouped"], "editor")
  require(object(canvas) && canvas.width === DESIGN_WIDTH && canvas.height === DESIGN_HEIGHT &&
    label(canvas.background), "画幅应为 1920 × 1080，且有背景颜色")
  only(canvas, ["width", "height", "background", "worldMask"], "canvas")
  const mask = canvas.worldMask
  require(mask === undefined || (object(mask) && Array.isArray(mask.stops) && mask.stops.length >= 2 &&
    mask.stops.every((s, i, all) => object(s) && length(s.at) && typeof s.at === "string" && ratio(s.alpha) &&
      Math.abs(parseFloat(s.at)) <= 50 && (i === 0 || parseFloat(s.at) > parseFloat((all[i - 1] as { at: string }).at)))),
    "worldMask 须有至少两个 stop，at 为 -50%..50% 的升序百分比，alpha 为 0..1")
  require(Array.isArray(regions) && Array.isArray(elements) && Array.isArray(cues), "缺少区域、元素或节点")
  // IDs are globally unique across regions, groups, elements, camera and screen.
  const namespace = new Set<string>(["camera", SCREEN])
  const containers = new Set<string>([SCREEN])
  for (const region of regions) {
    require(object(region), "区域格式无效")
    only(region, ["id", "x", "y", "width", "height"], "区域 " + String(region.id))
    require(label(region.id) && number(region.x) && number(region.y) &&
      positive(region.width) && positive(region.height), "区域尺寸、中心位置或 ID 无效")
    require(!namespace.has(region.id),
      "区域 ID「" + String(region.id) + "」与已有名称冲突（区域、组、元素、camera、screen 须全局唯一）")
    require([region.x, region.y, region.width, region.height].every(n => Number.isFinite(n * DESIGN_PIXELS_PER_UNIT)),
      "区域 " + region.id + " 的设计像素坐标或尺寸溢出")
    namespace.add(region.id)
    containers.add(region.id)
  }
  const ids = new Set<string>(["camera"])
  const boxes = new Set<string>()
  for (const element of elements) {
    require(object(element), "元素格式无效")
    require(label(element.id), "元素 ID 缺失")
    require(!namespace.has(element.id),
      "元素 ID「" + String(element.id) + "」与已有名称冲突（不能与区域、组、其他元素、camera、screen 重名）")
    namespace.add(element.id)
    ids.add(element.id)
    parseElement(element, containers)
    if (element.kind === "group") containers.add(element.id)
    if (element.kind !== "line") boxes.add(element.id)
  }
  for (const element of elements) {
    if (element.kind === "line") require(boxes.has(element.from.element) && boxes.has(element.to.element),
      element.id + " 的连线必须指向两个存在的元素")
  }
  require(object(camera), "缺少相机")
  only(camera, ["projection", "target", "yaw", "pitch", "roll", "distance", "focal", "zoom",
    "arc", "arcSide", "lag", "followEase", "maxOvershoot", "view3d", "position", "approach", "bakedReason"], "camera")
  require(camera.bakedReason === undefined || label(camera.bakedReason), "camera.bakedReason 须为非空说明")
  const v3 = camera.view3d
  require(v3 === undefined || object(v3), "camera.view3d 须为对象")
  if (object(v3)) {
    only(v3, ["distance", "height", "pitch", "yaw", "maxTilt"], "camera.view3d")
    require(positive(v3.distance) && v3.distance >= 0.5 && v3.distance <= 50, "camera.view3d.distance 须为 0.5..50 的 u")
    require(v3.height === undefined || (number(v3.height) && v3.height > -v3.distance), "camera.view3d.height 须为数，且大于 -distance")
    require(v3.maxTilt === undefined || (number(v3.maxTilt) && v3.maxTilt > 0 && v3.maxTilt <= 80), "camera.view3d.maxTilt 须为 0..80 度")
    const limit = (v3.maxTilt as number | undefined) ?? DEFAULT_MAX_TILT
    for (const k of ["pitch", "yaw"] as const) require(v3[k] === undefined || (number(v3[k]) && Math.abs(v3[k] as number) <= limit),
      "camera.view3d." + k + " 须为数，且绝对值不超过 maxTilt（" + limit + "°）")
  }
  const cp = camera.position
  require(cp === undefined || (object(cp) && number(cp.x) && number(cp.y) && number(cp.z) && cp.z > 0), "camera.position 须为 { x, y, z }（u，z > 0）")
  if (object(cp)) only(cp, ["x", "y", "z"], "camera.position（俯仰、偏转、距离由几何推导，不能写）")
  const ca = camera.approach
  require(ca === undefined || (object(ca) && number(ca.x) && number(ca.y)), "camera.approach 须为 { x, y }（u）")
  if (object(ca)) only(ca, ["x", "y"], "camera.approach")
  require(arcValue(camera.arc) && arcSide(camera.arcSide), "camera.arc 须为 0..1，arcSide 须为 auto、left 或 right")
  require(camera.lag === undefined || (number(camera.lag) && camera.lag >= 0), "camera.lag 须为 ≥ 0 的秒数")
  require(camera.followEase === undefined || isEase(camera.followEase), "camera.followEase 无效")
  require(camera.maxOvershoot === undefined || (number(camera.maxOvershoot) && camera.maxOvershoot >= 0), "camera.maxOvershoot 须为 ≥ 0 的像素数")
  require(camera.projection === "orthographic" && object(camera.target) &&
    number(camera.target.x) && number(camera.target.y) && number(camera.target.z) &&
    angle(camera.yaw) && camera.yaw.rad === Math.PI / 2 && camera.yaw.cycles === 0 &&
    angle(camera.pitch) && camera.pitch.rad === -Math.PI / 2 && camera.pitch.cycles === 0 &&
    angle(camera.roll) && positive(camera.distance) && positive(camera.focal) && positive(camera.zoom),
    "相机须为正俯视，且缩放、距离和焦距为正")
  const byId = new Map((elements as ElementDefinition[]).map(element => [element.id, element]))
  for (const cue of cues) {
    require(object(cue), "节点格式无效")
    only(cue, ["at", "target", "property", "duration", "to", "ease", "interpolation", "path", "arc", "arcSide", "lag", "followEase", "bakedReason"], "节点 " + String(cue.target))
    require(cue.bakedReason === undefined || label(cue.bakedReason), "节点 " + String(cue.at) + " 的 bakedReason 须为非空说明")
    require(label(cue.at) && label(cue.target) && ids.has(cue.target) &&
      number(cue.duration) && cue.duration >= 0, "节点目标、锚点或时长无效")
    require(parseCue(cue, byId.get(cue.target)), "节点属性或值无效：" + cue.target + " / " + String(cue.property))
    require(!VIEW3D_PROPS.includes(cue.property as string) || object(v3), "写 view3d.* 节点前须先声明 camera.view3d")
  }
  const posCue = (cues as Record<string, unknown>[]).find(c => c.target === "camera" && (String(c.property).startsWith("position.") || String(c.property).startsWith("approach.") || c.property === "target.z"))
  if (cp !== undefined || ca !== undefined || posCue) {
    require(object(v3), "写 camera.position / position.* / target.z 前须先声明 camera.view3d（至少 distance）")
    const legacy = (cues as Record<string, unknown>[]).find(c => c.target === "camera" && VIEW3D_PROPS.includes(c.property as string))
    const v = v3 as Record<string, unknown>
    require(!legacy && !v.pitch && !v.yaw && !v.height, "摄像机位置（position）与显式 view3d.pitch / yaw / height 只能二选一：" +
      "写了 position 时高度、俯仰、偏转由几何推导；请删掉 " + (legacy ? "view3d." + String(legacy.property).slice(7) + " 节点" : "camera.view3d 里的 pitch / yaw / height"))
  }
  return value as unknown as ProjectDocument
}

export function pixels(length: Length, axisInPixels: number): number {
  return typeof length === "number" ? length * DESIGN_PIXELS_PER_UNIT : Number(length.slice(0, -1)) / 100 * axisInPixels
}
