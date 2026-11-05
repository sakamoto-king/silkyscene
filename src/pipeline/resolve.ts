import { DEFAULT_CURVE_MAX, DEFAULT_CURVE_MIN, DEFAULT_CURVE_RATIO, DESIGN_PIXELS_PER_UNIT as u, pixels, SCREEN } from "./definition.js"
import type { Camera, ElementDefinition, LineLayer, Port, ProjectDocument, Region } from "./definition.js"
import type { Measurement } from "./measure.js"
import type { FrameState } from "./timeline.js"
import type { Matrix, ResolvedPrimitive, ResolvedScene } from "../render/primitives.js"
import type { ResolvedRect } from "../shared/geometry.js"
import { boxPointOffset, DESIGN_HEIGHT, DESIGN_WIDTH, worldToDesignPx } from "../shared/geometry.js"
import { planeHomography, projectHomography } from "../shared/cameraGeometry.js"
import type { Homography, View3DState } from "../shared/cameraGeometry.js"

export interface ResolvedLayout {
  scene: ResolvedScene
  boxes: ReadonlyMap<string, ResolvedRect>
}

export function cameraMatrix(camera: Camera, zoom = camera.zoom): readonly [number, number, number, number, number, number] {
  const a = Math.cos(camera.roll.rad) * zoom
  const b = Math.sin(-camera.roll.rad) * zoom
  const [x, y] = worldToDesignPx([camera.target.x, camera.target.y])
  const [cx, cy] = worldToDesignPx([0, 0])
  return [a, b, -b, a, cx - a * x + b * y, cy - b * x - a * y]
}

export function regionRect(region: Region): ResolvedRect {
  const [cx, cy] = worldToDesignPx([region.x, region.y])
  const width = region.width * u, height = region.height * u
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const multiply = ([a, b, c, d, e, f]: Matrix, [A, B, C, D, E, F]: Matrix): Matrix =>
  [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f]
const scaleAbout = (sx: number, sy: number, ox: number, oy: number): Matrix => [sx, 0, 0, sy, ox - sx * ox, oy - sy * oy]
/** docs/02: rotate (deg, clockwise on screen) then scale, both about (ox, oy): T·R·S·T⁻¹. */
const rotateScaleAbout = (deg: number, sx: number, sy: number, ox: number, oy: number): Matrix => {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r)
  const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy
  return [a, b, cc, d, ox - a * ox - cc * oy, oy - b * ox - d * oy]
}
const apply = ([a, b, c, d, e, f]: Matrix, x: number, y: number) => [a * x + c * y + e, b * x + d * y + f] as const
const invert = ([a, b, c, d, e, f]: Matrix): Matrix => {
  const k = a * d - b * c
  return [d / k, -b / k, -c / k, a / k, (c * f - d * e) / k, (b * e - a * f) / k]
}
/** Least exceptions: both ends on one layer → that layer; under + world → world; anything with screen → screen. */
export function defaultLineLayer(a: LineLayer, b: LineLayer): LineLayer {
  return a === b ? a : a === "screen" || b === "screen" ? "screen" : "world"
}
const isIdentity = (m: Matrix) => m.every((v, i) => v === IDENTITY[i])

/** docs/02: an axis-aligned clip box in layer px (after the clipping group's own matrix), rounded by r px. */
interface ClipBox { x0: number; y0: number; x1: number; y1: number; r: number }
interface Container { rect: ResolvedRect; layer: "world" | "screen"; opacity: number; matrix: Matrix; z: number; clip?: ClipBox | undefined }
const axisAligned = (m: Matrix) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9
/** The group box through its matrix (must be axis-aligned), intersected with the clip it already sits in. */
function clipOf(rect: ResolvedRect, m: Matrix, radius: number, outer: ClipBox | undefined, id: string): ClipBox {
  if (!axisAligned(m)) throw new Error(id + " 是 clip: true 的组，但它（或上级组）带旋转；裁切只支持未旋转的组")
  const [ax, ay] = apply(m, rect.x, rect.y), [bx, by] = apply(m, rect.x + rect.width, rect.y + rect.height)
  const own = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by), r: radius * Math.sqrt(Math.abs(m[0] * m[3])) }
  if (!outer) return own
  return { x0: Math.max(own.x0, outer.x0), y0: Math.max(own.y0, outer.y0), x1: Math.min(own.x1, outer.x1), y1: Math.min(own.y1, outer.y1),
    r: own.x0 >= outer.x0 && own.y0 >= outer.y0 && own.x1 <= outer.x1 && own.y1 <= outer.y1 ? own.r : Math.max(own.r, outer.r) }
}
/** A layer-px clip box back in an element's own pre-transform px (its matrix must not rotate). */
function localClip(c: ClipBox, m: Matrix, id: string) {
  if (!axisAligned(m)) throw new Error(id + " 在 clip: true 的组里，但它自己带旋转；裁切只支持未旋转的子元素")
  const inv = invert(m), [ax, ay] = apply(inv, c.x0, c.y0), [bx, by] = apply(inv, c.x1, c.y1)
  const k = Math.sqrt(Math.abs(inv[0] * inv[3]))
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.max(0, Math.abs(bx - ax)), height: Math.max(0, Math.abs(by - ay)), radius: c.r * k }
}

type P2 = readonly [number, number]
/** docs/02: control points of a port-to-port curve (layer px): h = clamp(d · ratio, min, max) along the curve axis. */
export function curveControls(a: P2, b: P2, curve: "horizontal" | "vertical", ratio = DEFAULT_CURVE_RATIO,
  min = DEFAULT_CURVE_MIN * u, max = DEFAULT_CURVE_MAX * u): [P2, P2, P2, P2] {
  const horizontal = curve === "horizontal", d = horizontal ? b[0] - a[0] : b[1] - a[1]
  const h = Math.max(min, Math.min(max, d * ratio))
  return horizontal ? [a, [a[0] + h, a[1]], [b[0] - h, b[1]], b] : [a, [a[0], a[1] + h], [b[0], b[1] - h], b]
}
const bez = (q: readonly P2[], t: number): P2 => {
  const s = 1 - t, A = s * s * s, B = 3 * s * s * t, C = 3 * s * t * t, D = t * t * t
  return [A * q[0]![0] + B * q[1]![0] + C * q[2]![0] + D * q[3]![0], A * q[0]![1] + B * q[1]![1] + C * q[2]![1] + D * q[3]![1]]
}
/** The first `trim` of the curve by arc length (like stroke-dashoffset on the original path), as a new cubic. */
export function trimCubic(q: readonly [P2, P2, P2, P2], trim: number): [P2, P2, P2, P2] {
  if (trim >= 1) return [...q] as [P2, P2, P2, P2]
  const N = 96, L = [0]
  let prev = q[0]
  for (let i = 1; i <= N; i++) { const p = bez(q, i / N); L.push(L[i - 1]! + Math.hypot(p[0] - prev[0], p[1] - prev[1])); prev = p }
  const want = Math.max(0, trim) * L[N]!
  let i = 1
  while (i < N && L[i]! < want) i++
  const t = L[N]! === 0 ? 0 : (i - 1 + (want - L[i - 1]!) / Math.max(1e-12, L[i]! - L[i - 1]!)) / N
  const lerp = (p: P2, r: P2): P2 => [p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t]
  const p01 = lerp(q[0], q[1]), p12 = lerp(q[1], q[2]), p23 = lerp(q[2], q[3]), p012 = lerp(p01, p12), p123 = lerp(p12, p23)
  return [q[0], p01, p012, lerp(p012, p123)]
}
const pathD = (q: readonly P2[]) => "M" + q[0]![0] + "," + q[0]![1] + " C" + q.slice(1).map(p => p[0] + "," + p[1]).join(" ")

/** Resolve the document at one frame state; with no state this is the declared picture. */
export function resolveProject(project: ProjectDocument, measured: ReadonlyMap<string, Measurement>,
  state?: FrameState, options: { skipTextHeight?: boolean } = {}): ResolvedLayout {
  const containers = new Map<string, Container>(project.regions.map(region =>
    [region.id, { rect: regionRect(region), layer: "world", opacity: 1, matrix: IDENTITY, z: 0 }]))
  containers.set(SCREEN, { rect: { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT }, layer: "screen", opacity: 1, matrix: IDENTITY, z: 0 })
  const boxes = new Map<string, ResolvedRect>()
  const owners = new Map<string, Container>()
  const drawnOn = new Map<string, LineLayer>()
  const primitives = new Map<string, ResolvedPrimitive>()
  const children = new Map<string, string[]>()
  const zoom = state?.camera.zoom ?? project.camera.zoom

  for (const element of project.elements) {
    if (element.kind === "line") continue
    const { id } = element
    const s = state?.elements.get(id) ?? {}
    const l = { ...element.layout, ...pick(s) }
    const parent = containers.get(l.region)!
    children.set(l.region, [...children.get(l.region) ?? [], id])
    const r = parent.rect
    const text = element.kind === "text"
      ? element.bind === "camera.zoom%" ? Math.round(zoom * 100) + "%" : s.text ?? element.text : undefined
    const m = measured.get(id)
    const current = text !== undefined ? m?.textMetrics?.get(text) ?? m : m
    const pad = element.kind === "text" && element.padding ? element.padding : [0, 0] as const
    // Auto-sized text boxes are border-box: measured text + padding + border on each side.
    const border = element.kind === "text" && element.stroke ? (element.strokeWidth ?? 0.002) * u : 0
    const padX = pad[0] * u, padY = pad[1] * u, edgeX = padX + border, edgeY = padY + border
    let width = l.width === undefined ? undefined : pixels(l.width, r.width)
    let height = l.height === undefined ? undefined : pixels(l.height, r.height)
    if ((element.kind === "text" || element.kind === "image") && !current) throw new Error(id + " 缺少素材测量")
    if (element.kind === "text" && current) {
      width ??= current.width + 2 * edgeX
      height ??= current.height + 2 * edgeY
      const squeezed = (m?.narrowHeight ?? 0) > current.height
      const tallest = squeezed ? m!.narrowHeight! : current.height
      if (!options.skipTextHeight && tallest + 2 * edgeY > height + 0.05) {
        throw new Error(id + (squeezed ? " 在时间线中被挤到最窄宽度时" : " 的") + "文字超出固定高度，请缩短内容或调整项目约束")
      }
    }
    if (element.kind === "image" && current) {
      width ??= height! * current.width / current.height
      height ??= width * current.height / current.width
    }
    if (element.kind === "null") width = height = 0   // a null object is a point: its anchor is the point itself
    else if (width === undefined || height === undefined || width <= 0 || height <= 0) throw new Error(id + " 的解算尺寸无效")
    if (width === undefined || height === undefined) throw new Error(id + " 的解算尺寸无效")
    const [ax, ay] = boxPointOffset(l.anchor, width, height)
    const x = r.width / 2 + pixels(l.x, r.width) - ax
    const y = r.height / 2 - pixels(l.y, r.height) - ay
    if (x < -0.05 || y < -0.05 || x + width > r.width + 0.05 || y + height > r.height + 0.05) {
      throw new Error(id + " 超出所属区域，请调整内容或布局约束")
    }
    const rect = { x: r.x + x, y: r.y + y, width, height }
    boxes.set(id, rect)
    const sx = s.scaleX ?? element.scaleX ?? 1, sy = s.scaleY ?? element.scaleY ?? 1
    const [ox, oy] = element.origin ? boxPointOffset(element.origin, width, height) : [ax, ay]
    const rot = s.rotate ?? element.rotate ?? 0
    const own = rot !== 0 ? rotateScaleAbout(rot, sx, sy, rect.x + ox, rect.y + oy)
      : sx === 1 && sy === 1 ? IDENTITY : scaleAbout(sx, sy, rect.x + ox, rect.y + oy)
    const matrix = multiply(parent.matrix, own)
    const opacity = (s.opacity ?? element.opacity ?? 1) * parent.opacity
    const clip = element.kind === "group" && element.clip ? clipOf(rect, matrix, (element.radius ?? 0) * u, parent.clip, id) : parent.clip
    const self: Container = { rect, layer: parent.layer, opacity, matrix, z: parent.z + (element.z ?? 0), clip }
    owners.set(id, self)
    drawnOn.set(id, parent.layer === "screen" ? "screen" : element.ignoreMask ? "under" : "world")
    const reveal = s.reveal ?? ("reveal" in element ? element.reveal : undefined) ?? 1
    const base = { id, opacity, ...(reveal < 1 ? { reveal: { amount: reveal, from: ("revealFrom" in element ? element.revealFrom : undefined) ?? "left" } } : {}),
      ...(parent.layer === "screen" ? { layer: "screen" as const } : {}),
      ...(element.ignoreMask && parent.layer === "world" ? { ignoreMask: true } : {}),
      ...(isIdentity(matrix) ? {} : { transform: matrix }),
      ...(parent.clip ? { clip: localClip(parent.clip, matrix, id) } : {}) }
    primitives.set(id, primitive(element, base, rect, text ?? "", padX, padY, m?.src ?? "", s))
    if (element.kind === "group") containers.set(id, self)
  }

  const camera = state ? cameraMatrix({ ...project.camera, target: { ...project.camera.target, x: state.camera.x, y: state.camera.y } }, zoom)
    : cameraMatrix(project.camera)
  // docs/04: opt-in perspective. A frame with pitch = yaw = height = 0 and every z = 0 takes the 2D path untouched.
  const v = state?.camera.view3d ?? (project.camera.view3d && !state ? { distance: project.camera.view3d.distance,
    height: project.camera.view3d.height ?? 0, pitch: project.camera.view3d.pitch ?? 0, yaw: project.camera.view3d.yaw ?? 0 } : undefined)
  // docs/04: derived views pivot on F (sight line ∩ plane z = 0); zoom stays an extra 2D factor after projection.
  const derivedFrame = v && "frame" in v ? v.frame : undefined
  const flat = !v || (v.pitch === 0 && v.yaw === 0 && v.height === 0 && (!derivedFrame || (derivedFrame[0] === state!.camera.x && derivedFrame[1] === state!.camera.y)) && [...owners.values()].every(o => o.layer === "screen" || o.z === 0))
  const view: View3DState | undefined = v && !flat ? { distance: v.distance * u, height: v.height * u,
    pitch: v.pitch * Math.PI / 180, yaw: v.yaw * Math.PI / 180 } : undefined
  const frameCenter = worldToDesignPx([state?.camera.x ?? project.camera.target.x, state?.camera.y ?? project.camera.target.y])
  const pivot = [DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2] as const
  const homographies = new Map<number, Homography>()
  const homography = (zU: number) => {
    let H = homographies.get(zU)
    if (!H) { H = planeHomography(camera, derivedFrame ? worldToDesignPx(derivedFrame) : frameCenter, pivot, view!, zU * u); homographies.set(zU, H) }
    return H
  }
  const projected3d: { id: string; z: number; scale: number; minW: number }[] = []
  if (view) for (const [id, o] of owners) {
    if (o.layer === "screen") continue
    const H = withAffine(homography(o.z), o.matrix), r = boxes.get(id)!
    let minW = Infinity
    for (const [x, y] of [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height],
      [r.x + r.width / 2, r.y + r.height / 2]] as const) minW = Math.min(minW, projectHomography(H, [x, y]).w)
    if (!(minW > 0)) throw new Error(id + " 在 3D 相机下有部分位于相机所在平面或身后（投影分母 w = " + minW.toFixed(1) +
      " px ≤ 0，透视缩放因子无效）；请减小 pitch / yaw、增大 view3d.distance 或减小该元素的 z")
    const c = projectHomography(H, [r.x + r.width / 2, r.y + r.height / 2])
    projected3d.push({ id, z: o.z, scale: view.distance / c.w, minW })
    const p = primitives.get(id)!
    primitives.set(id, { ...p, transform3d: H } as ResolvedPrimitive)
  }
  const locate = ({ element, at }: Port) => {
    const box = boxes.get(element)!
    const [dx, dy] = boxPointOffset(at, box.width, box.height)
    return apply(owners.get(element)!.matrix, box.x + dx, box.y + dy)
  }
  const ordered = project.elements.map((element): ResolvedPrimitive => {
    if (element.kind === "group") return { ...primitives.get(element.id)!, children: children.get(element.id) ?? [] } as ResolvedPrimitive
    if (element.kind !== "line") return primitives.get(element.id)!
    const s = state?.elements.get(element.id) ?? {}
    // The line is drawn on its own layer. Each end is projected from its element's layer into that one:
    // world/under → screen through the camera, screen → world/under through its inverse (docs/03).
    const ends = [element.from, element.to].map(port => ({ p: locate(port), layer: drawnOn.get(port.element)! }))
    const layer = element.layer ?? defaultLineLayer(ends[0]!.layer, ends[1]!.layer)
    const screenSide = (l: LineLayer) => l === "screen"
    const project = (e: typeof ends[number]) => screenSide(layer) === screenSide(e.layer) ? e.p
      : screenSide(layer) ? apply(camera, e.p[0], e.p[1]) : apply(invert(camera), e.p[0], e.p[1])
    const [x1, y1] = project(ends[0]!), [x2f, y2f] = project(ends[1]!)
    // docs/02: trim draws the line from 「from」 toward 「to」; 1 keeps the exact old endpoint.
    const trim = s.trim ?? element.trim ?? 1
    // docs/02: a curved line keeps both real ends (for the inspector) and draws the arc-length-trimmed Bézier as `d`.
    const cq = element.curve ? trimCubic(curveControls([x1, y1], [x2f, y2f], element.curve, element.curveRatio,
      element.curveMin === undefined ? undefined : element.curveMin * u, element.curveMax === undefined ? undefined : element.curveMax * u), trim) : undefined
    const x2 = cq ? cq[3][0] : trim === 1 ? x2f : x1 + (x2f - x1) * trim, y2 = cq ? cq[3][1] : trim === 1 ? y2f : y1 + (y2f - y1) * trim
    // 3D: both ends go straight to screen px through their own element's plane (a straight line stays straight).
    const toScreen = (port: Port, e: typeof ends[number]) => {
      if (e.layer === "screen") return e.p
      const q = projectHomography(homography(owners.get(port.element)!.z), e.p)
      if (!(q.w > 0)) throw new Error(element.id + " 的端点在 3D 相机身后（w ≤ 0）")
      return q.point
    }
    const s3raw = view ? [toScreen(element.from, ends[0]!), toScreen(element.to, ends[1]!)] : undefined
    const s3 = s3raw && trim !== 1 ? [s3raw[0]!, [s3raw[0]![0] + (s3raw[1]![0] - s3raw[0]![0]) * trim, s3raw[0]![1] + (s3raw[1]![1] - s3raw[0]![1]) * trim]] : s3raw
    // 3D curve: world-plane control points through their end's plane; with a screen end the curve is rebuilt in screen px.
    let d3: string | undefined
    if (cq && s3raw) {
      const full = curveControls([x1, y1], [x2f, y2f], element.curve!, element.curveRatio,
        element.curveMin === undefined ? undefined : element.curveMin * u, element.curveMax === undefined ? undefined : element.curveMax * u)
      const onPlane = ends.every(e => e.layer !== "screen") && layer !== "screen"
      const proj = (p: P2, port: Port) => projectHomography(homography(owners.get(port.element)!.z), p).point as P2
      const q3: [P2, P2, P2, P2] = onPlane ? [s3raw[0] as P2, proj(full[1], element.from), proj(full[2], element.to), s3raw[1] as P2]
        : curveControls(s3raw[0] as P2, s3raw[1] as P2, element.curve!, element.curveRatio)
      d3 = pathD(trimCubic(q3, trim))
    }
    // docs/02: screenWidth divides by the camera scale on world / under layers, so the drawn width is the declared screen px.
    const k = element.screenWidth && layer !== "screen" ? 1 / Math.sqrt(Math.abs(camera[0] * camera[3] - camera[1] * camera[2])) : 1
    return { id: element.id, kind: "line", x1, y1, x2, y2, ...(cq ? { d: pathD(cq) } : {}), ...(d3 ? { d3 } : {}),
      ...(s3 ? { screen3d: [s3[0]![0], s3[0]![1], s3[1]![0], s3[1]![1]] as const } : {}), opacity: s.opacity ?? element.opacity ?? 1,
      ...(layer === "screen" ? { layer } : layer === "under" ? { ignoreMask: true } : {}), connected: s.connected ?? element.connected ?? true,
      stroke: { color: s.color ?? s.stroke ?? element.color, width: element.width * u * k,
        ...(element.cap ? { cap: element.cap } : {}),
        ...(element.dash ? { dash: [element.dash[0] * u * k, element.dash[1] * u * k] as const } : {}) } }
  })
  const mask = project.canvas.worldMask?.stops.map(s => [0.5 - parseFloat(s.at) / 100, s.alpha] as const).reverse()
  const view3d = v ? { flat, declared: project.camera.view3d!, resolved: v,
    ...(view ? { perspectiveScale: view.distance / (view.distance + view.height), elements: projected3d } : {}) } : undefined
  return { boxes, scene: { canvas: project.canvas, background: project.canvas.background, camera, ...(view3d ? { view3d } : {}),
    ...(mask ? { worldMask: mask } : {}), primitives: ordered } }
}

/** Homography after the element's own 2D affine (group / own scale, layer px). */
function withAffine(H: Homography, [a, b, c, d, e, f]: Matrix): Homography {
  const row = (i: number) => [H[3 * i]! * a + H[3 * i + 1]! * b, H[3 * i]! * c + H[3 * i + 1]! * d, H[3 * i]! * e + H[3 * i + 1]! * f + H[3 * i + 2]!]
  return [...row(0), ...row(1), ...row(2)] as unknown as Homography
}

function pick(s: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }) {
  const out: Record<string, unknown> = {}
  for (const k of ["x", "y", "width", "height"] as const) if (s[k] !== undefined) out[k] = s[k]
  return out
}

function primitive(element: Exclude<ElementDefinition, { kind: "line" }>, base: { id: string; opacity: number },
  rect: ResolvedRect, text: string, padX: number, padY: number, src: string,
  s: { fill?: string; color?: string; background?: string; trim?: number; strokeColor?: string } = {}): ResolvedPrimitive {
  const dashed = "strokeStyle" in element && element.strokeStyle === "dashed"
  const stroke = (declared?: string, width?: number, color = declared && (s.strokeColor ?? declared)) => color ? { stroke: { color, width: (width ?? 0.002) * u, ...(dashed ? { style: "dashed" as const } : {}) } } : {}
  const shadow = (sh?: { x: number; y: number; blur: number; spread?: number; color: string }) => sh
    ? { shadow: { x: sh.x * u, y: sh.y * u, blur: sh.blur * u, spread: (sh.spread ?? 0) * u, color: sh.color } } : {}
  switch (element.kind) {
    case "rect": return { ...base, kind: "rect", rect, fill: s.fill ?? element.fill, ...stroke(element.stroke, element.strokeWidth),
      ...(element.radius ? { radius: element.radius * u } : {}), ...shadow(element.shadow),
      ...(element.stripes ? { stripes: { angle: element.stripes.angle ?? 45, color1: element.stripes.color1, color2: element.stripes.color2,
        size: element.stripes.size * u, size2: (element.stripes.size2 ?? element.stripes.size) * u } } : {}) }
    case "text": return { ...base, kind: "text", x: rect.x, y: rect.y, width: rect.width, height: rect.height, text,
      fontSize: element.fontSize * u, align: element.align, fill: s.color ?? element.color,
      ...(element.weight !== undefined ? { fontWeight: element.weight } : {}),
      ...(element.fontFamily !== undefined ? { fontFamily: element.fontFamily } : {}),
      ...(element.lineHeight !== undefined ? { lineHeight: element.lineHeight } : {}),
      ...(element.letterSpacing !== undefined ? { letterSpacing: element.letterSpacing * u } : {}),
      ...(padX || padY ? { padding: [padX, padY] as const } : {}),
      ...((s.background ?? element.background) ? { background: s.background ?? element.background } : {}), ...stroke(element.stroke, element.strokeWidth),
      ...shadow(element.shadow) }
    case "image": return { ...base, kind: "image", rect, src, fit: element.fit, ...(element.radius ? { radius: element.radius * u } : {}) }
    case "path": return { ...base, kind: "path", rect, d: element.d, viewBox: element.viewBox,
      ...((s.fill ?? element.fill) ? { fill: s.fill ?? element.fill } : {}), ...stroke(element.stroke, element.strokeWidth),
      ...((s.trim ?? element.trim ?? 1) < 1 ? { trim: s.trim ?? element.trim } : {}) }
    case "dots": return { ...base, kind: "dots", rect, spacing: element.spacing * u, radius: element.radius * u, color: element.color }
    case "group": return { ...base, kind: "group", rect, children: [] }
    case "null": return { ...base, kind: "null", rect }
  }
}
