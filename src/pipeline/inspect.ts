import type { ProjectDocument } from "./definition.js"
import type { prepareProject } from "./render.js"
import type { ResolvedScene } from "../render/primitives.js"
import { boxPointOffset, designPxToWorld, worldToDesignPx, DESIGN_PIXELS_PER_UNIT as u } from "../shared/geometry.js"
import { inversePoint, measureMotion, planeHomography } from "../shared/cameraGeometry.js"
import type { Coordinate, Matrix2D } from "../shared/cameraGeometry.js"
import { regionRect } from "./resolve.js"
import type { ArcInfo } from "./timeline.js"
import { easeNumbers } from "./easing.js"
import type { Ease } from "./easing.js"
import { SCREEN } from "./definition.js"
export { regionRect }

export type PreparedProject = Awaited<ReturnType<typeof prepareProject>>

export function worldPoint(px: Coordinate) {
  return { px, u: designPxToWorld(px) }
}

export function cameraCorners(matrix: Matrix2D, width: number, height: number) {
  const corners: Coordinate[] = [[0, 0], [width, 0], [width, height], [0, height]]
  return corners.map(corner => worldPoint(inversePoint(matrix, corner)))
}

export function cameraSample(scene: ResolvedScene, previous?: ResolvedScene) {
  if (!scene.camera) throw new Error("当前画面没有相机矩阵")
  const pivot: Coordinate = [scene.canvas.width / 2, scene.canvas.height / 2]
  return measureMotion(scene.camera, previous?.camera, pivot, { x: 0, y: 0 })
}

/**
 * Per-project data that does not change from frame to frame (docs/02 inspector performance): declarations, region members,
 * each element's x / y arc cues, the camera move paths and the camera body paths. Keyed by the prepared object, so an edit
 * (which makes a new prepared project) recomputes it.
 */
type Static = { declarations: Map<string, ProjectDocument["elements"][number]>; members: Map<string, string[]>
  arcCues: Map<string, { start: number; duration: number; property: string; arcInfo: ArcInfo }[]>
  moves?: Map<number, ReturnType<typeof cameraMovePaths>>; body?: ReturnType<typeof bodyStatic> | null
  resolved: Map<number, { scene: ResolvedScene; boxes: ReadonlyMap<string, { x: number; y: number; width: number; height: number }> }> }
const statics = new WeakMap<object, Static>()
function staticOf(prepared: PreparedProject): Static {
  let st = statics.get(prepared)
  if (st) return st
  const members = new Map<string, string[]>()
  for (const e of prepared.document.elements) if (e.kind !== "line") members.set(e.layout.region, [...members.get(e.layout.region) ?? [], e.id])
  const arcCues = new Map<string, { start: number; duration: number; property: string; arcInfo: ArcInfo }[]>()
  for (const cue of (prepared.tracks ?? []).flat()) {
    const a = (cue as { arcInfo?: ArcInfo }).arcInfo
    if (!a || (cue.property !== "x" && cue.property !== "y")) continue
    // One arc per (start, duration) of a target — the x and y cue of one move share it (first one wins, as before).
    const list = arcCues.get(cue.target) ?? (arcCues.set(cue.target, []), arcCues.get(cue.target)!)
    if (!list.some(b => b.start === cue.start && b.duration === cue.duration)) list.push({ start: cue.start, duration: cue.duration, property: cue.property, arcInfo: a })
  }
  st = { declarations: new Map(prepared.document.elements.map(e => [e.id, e])), members, arcCues, resolved: new Map() }
  statics.set(prepared, st)
  return st
}

export function inspectFrame(prepared: PreparedProject, frame: number, fps = 30) {
  if (!Number.isSafeInteger(frame) || frame < 0 || !Number.isFinite(fps) || fps <= 0) throw new Error("帧号无效")
  const time = frame / fps
  const st = staticOf(prepared)
  const resolveAt = (prepared as { resolveAt?: PreparedProject["resolveAt"] }).resolveAt
  // Stepping frame by frame needs this frame and the previous one: keep the last few resolves.
  const at = (t: number) => {
    let r = st.resolved.get(t)
    if (!r) {
      r = resolveAt ? resolveAt(t) : { scene: prepared.renderAt(t), boxes: prepared.boxes }
      st.resolved.set(t, r)
      if (st.resolved.size > 4) st.resolved.delete(st.resolved.keys().next().value!)
    }
    return r
  }
  const { scene, boxes } = at(time)
  const previous = frame ? at((frame - 1) / fps).scene : undefined
  const motion = cameraSample(scene, previous)
  const activeCues = prepared.cuesAt(time).map(cue => ({ ...cue, easing: "ease" in cue ? easeNumbers(cue.ease) : null }))
  const cuesByTarget = new Map<string, typeof activeCues>()
  for (const cue of activeCues) { const l = cuesByTarget.get(cue.target); if (l) l.push(cue); else cuesByTarget.set(cue.target, [cue]) }
  const regions = prepared.document.regions.map(region => ({
    declaration: region, rect: regionRect(region),
    elements: st.members.get(region.id) ?? [],
  }))
  const declarations = st.declarations
  // Containers: regions, groups (their resolved box at this frame) and the screen frame.
  const regionById = new Map([...regions.map(r => [r.declaration.id, r.rect] as const),
    [SCREEN, { x: 0, y: 0, width: scene.canvas.width, height: scene.canvas.height }] as const,
    ...prepared.document.elements.flatMap(e => e.kind === "group" && boxes.get(e.id) ? [[e.id, boxes.get(e.id)!] as const] : [])])
  const parentOf = (id: string) => { const d = declarations.get(id); return d && d.kind !== "line" ? d.layout.region : undefined }
  const depth = (id: string): number => { const p = parentOf(id); return p && declarations.get(p)?.kind === "group" ? 1 + depth(p) : 0 }
  const elements = scene.primitives.map((primitive, z) => {
    const declaration = declarations.get(primitive.id)!
    const box = boxes.get(primitive.id)
    const m = prepared.measurement.get(primitive.id)
    const currentText = primitive.kind === "text" ? m?.textMetrics?.get(primitive.text) : undefined
    const measurement = m ? { width: currentText?.width ?? m.width, height: currentText?.height ?? m.height } : null
    const region = declaration.kind === "line" ? undefined : regionById.get(declaration.layout.region)
    const offset = box && declaration.kind !== "line" ? boxPointOffset(declaration.layout.anchor, box.width, box.height) : null
    const anchor = box && offset ? worldPoint([box.x + offset[0], box.y + offset[1]]) : null
    const localPx: Coordinate | null = anchor && region
      ? [anchor.px[0] - (region.x + region.width / 2), region.y + region.height / 2 - anchor.px[1]] : null
    const local = localPx ? { u: [localPx[0] / u, localPx[1] / u] as Coordinate, px: localPx } : null
    // Arc moves of this element, sampled in the layer's design px from the container's current rect.
    const arcs = (st.arcCues.get(primitive.id) ?? []).flatMap(cue => {
      const a = cue.arcInfo
      if (!region) return []
      const toPx = ([x, y]: readonly [number, number]): Coordinate =>
        [region.x + region.width / 2 + x * u, region.y + region.height / 2 - y * u]
      const sample = () => a.from && a.to && a.control ? Array.from({ length: 33 }, (_, k) => {
        const t = k / 32, s = 1 - t
        return toPx([s * s * a.from![0] + 2 * s * t * a.control![0] + t * t * a.to![0], s * s * a.from![1] + 2 * s * t * a.control![1] + t * t * a.to![1]])
      }) : []
      // docs/02: sampled on first read (heavy scenes only draw the selected element's arcs); enumerable, so JSON keeps it.
      let points: Coordinate[] | undefined
      return [{ start: cue.start, duration: cue.duration, property: cue.property, ...a, get points() { return points ??= sample() } }]
    })
    return { z, declaration, primitive, box: box ?? null, anchor, local, measurement, arcs,
      parent: parentOf(primitive.id) ?? null, depth: depth(primitive.id), transform: primitive.transform ?? null,
      cues: cuesByTarget.get(primitive.id) ?? [] }
  })
  return {
    format: "silkyscene-inspector-frame@3", frame, fps, time, scene, regions, elements,
    camera: { ...motion, target: worldPoint([motion.world_x, motion.world_y]),
      corners: cameraCorners(motion.matrix, scene.canvas.width, scene.canvas.height),
      roll: prepared.document.camera.roll.rad + prepared.document.camera.roll.cycles * 2 * Math.PI,
      distance: prepared.document.camera.distance, focal: prepared.document.camera.focal,
      cues: cuesByTarget.get("camera") ?? [],
      // docs/04: the look target (runs first) and the framing (trails by lag); paths in world design px.
      look: lookPoint(prepared, time), moves: st.moves?.get(fps) ?? (st.moves = new Map([[fps, cameraMovePaths(prepared, fps)]])).get(fps)!,
      view3d: view3dInfo(scene, motion), body: bodyInfo(prepared, time, fps, st) },
  }
}

/** docs/04: 3D view of this frame for the inspector — declared vs resolved, the eye position and the real footprint on z = 0. */
function view3dInfo(scene: ResolvedScene, motion: ReturnType<typeof cameraSample>) {
  const v = scene.view3d
  if (!v || !scene.camera) return null
  const r = v.resolved, D = r.distance * u, Dt = (r.distance + r.height) * u
  const p = r.pitch * Math.PI / 180, y = r.yaw * Math.PI / 180
  const rf = (r as { frame?: readonly [number, number] }).frame
  const frame: Coordinate = rf ? worldToDesignPx(rf) : [motion.world_x, motion.world_y]
  // Eye in world design px (Y down) plus its height above the plane, all px.
  const eye = { px: [frame[0] + Dt * Math.sin(y) * Math.cos(p), frame[1] + Dt * Math.sin(p)] as Coordinate,
    z: Dt * Math.cos(y) * Math.cos(p) }
  const pivot: Coordinate = [scene.canvas.width / 2, scene.canvas.height / 2]
  const H = planeHomography(scene.camera, frame, pivot, { distance: D, height: Dt - D, pitch: p, yaw: y }, 0)
  const inv = invert3(H)
  const footprint = ([[0, 0], [scene.canvas.width, 0], [scene.canvas.width, scene.canvas.height], [0, scene.canvas.height]] as const).map(([sx, sy]) => {
    const [i0, i1, i2, i3, i4, i5, i6, i7, i8] = inv as [number, number, number, number, number, number, number, number, number]
    const X = i0 * sx + i1 * sy + i2, Y = i3 * sx + i4 * sy + i5, W = i6 * sx + i7 * sy + i8
    return [X / W, Y / W] as Coordinate
  })
  return { ...v, eye, footprint, tiltDeg: Math.hypot(r.pitch, r.yaw) }
}
function invert3(m: readonly number[]) {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number]
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
}

/** docs/04: camera body (declared track) now and its moves sampled from the same track, world design px. */
function bodyInfo(prepared: PreparedProject, time: number, fps: number, st: Static) {
  const at = (prepared as { positionAt?: PreparedProject["positionAt"] }).positionAt
  const p = at?.(time)
  if (!at || !p) return null
  if (st.body === undefined) st.body = bodyStatic(prepared, at)
  const { moves, moveZ, targetMoves } = st.body!
  const tAt = (prepared as { targetAt?: PreparedProject["targetAt"] }).targetAt
  const target = tAt?.(time)
  return { ...worldPoint(worldToDesignPx([p[0], p[1]])), z: p[2], moves: moves.map((m, i) => ({ ...m, z: moveZ[i]! })), fps,
    targetMoves, targetZ: target ? target[2] : 0 }
}
/** The camera body / target move paths (33 samples each); they only depend on the project. */
function bodyStatic(prepared: PreparedProject, at: NonNullable<PreparedProject["positionAt"]>) {
  const rawSpans: { start: number; end: number }[] = []
  for (const track of prepared.tracks) for (const c of track) {
    if (c.target === "camera" && (c.property.startsWith("position.") || c.property.startsWith("approach.")) && c.duration > 0)
      rawSpans.push({ start: c.start, end: c.start + c.duration })
  }
  rawSpans.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: { start: number; end: number }[] = []
  for (const sp of rawSpans) {
    const last = merged[merged.length - 1]
    if (last && sp.start <= last.end + 1e-6) last.end = Math.max(last.end, sp.end)
    else merged.push({ ...sp })
  }
  const baseMoves = (prepared as { positionMoves?: PreparedProject["positionMoves"] }).positionMoves ?? []
  const spans = merged.length ? merged.map(sp => {
    const pm = baseMoves.find(m => m.start >= sp.start - 1e-6 && m.start <= sp.end + 1e-6)
    const f = at(sp.start)!, t = at(sp.end)!
    return { start: sp.start, end: sp.end, from: [f[0], f[1]] as const, to: [t[0], t[1]] as const,
      arc: pm?.arc ?? 0, side: pm?.side ?? ("none" as const), offset: pm?.offset ?? 0 }
  }) : baseMoves
  const N = 48
  const moves = spans.map(m => ({ ...m,
    path: Array.from({ length: N + 1 }, (_, k) => { const q = at(m.start + (m.end - m.start) * k / N)!; return worldToDesignPx([q[0], q[1]]) }) }))
  // Target moves sampled the same way (plane xy, z kept as numbers), so both paths share one projection.
  const tAt = (prepared as { targetAt?: PreparedProject["targetAt"] }).targetAt
  const seen = new Set<string>(), targetMoves: { start: number; end: number; path: Coordinate[]; z: number[] }[] = []
  for (const track of prepared.tracks) for (const c of track) {
    if (c.target !== "camera" || !(c.property === "target.x" || c.property === "target.y" || c.property === "target.z") || c.duration === 0) continue
    const k = c.start + "/" + c.duration
    if (seen.has(k) || !tAt) continue
    seen.add(k)
    const ts = Array.from({ length: 33 }, (_, i) => c.start + c.duration * i / 32)
    targetMoves.push({ start: c.start, end: c.start + c.duration, path: ts.map(t => { const q = tAt(t); return worldToDesignPx([q[0], q[1]]) }), z: ts.map(t => tAt(t)[2]) })
  }
  const moveZ = moves.map(m => Array.from({ length: N + 1 }, (_, k) => at(m.start + (m.end - m.start) * k / N)![2]))
  return { moves, moveZ, targetMoves }
}

const lookPoint = (prepared: PreparedProject, time: number) => {
  const lookAt = (prepared as { lookAt?: PreparedProject["lookAt"] }).lookAt
  if (!lookAt) return null
  const l = lookAt(time)
  return worldPoint(worldToDesignPx([l.x, l.y]))
}
/** Both paths of every camera arc / lag move: look sampled from the look track, framing from renderAt (the 2D framing source). */
export function cameraMovePaths(prepared: PreparedProject, fps = 30) {
  const moves = (prepared as { cameraMoves?: PreparedProject["cameraMoves"] }).cameraMoves ?? []
  return moves.map(m => {
    const sample = (start: number, end: number, f: (t: number) => Coordinate) =>
      Array.from({ length: 33 }, (_, k) => f(start + (end - start) * k / 32))
    const look = sample(m.look.start, m.look.end, t => { const l = prepared.lookAt(t); return worldToDesignPx([l.x, l.y]) })
    const frame = sample(m.frame.start, m.frame.end, t => { const c = cameraSample(prepared.renderAt(t)); return [c.world_x, c.world_y] })
    return { ...m, lagFrames: m.lag * fps, paths: { look, frame } }
  })
}

export type InspectorFrame = ReturnType<typeof inspectFrame>
export type InspectorElement = InspectorFrame["elements"][number]

/** Geometry-only trace for a SilkyScene document. Capture traces have separate provenance. */
export function projectCameraTrace(prepared: PreparedProject, lastFrame: number, fps = 30) {
  if (!Number.isSafeInteger(lastFrame) || lastFrame < 0 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error("trace 的帧范围无效")
  }
  let previous: ResolvedScene | undefined
  const frames = Array.from({ length: lastFrame + 1 }, (_, f) => {
    const t = f / fps
    const scene = prepared.renderAt(t)
    const camera = cameraSample(scene, previous)
    previous = scene
    return { f, t, camera }
  })
  return { format: "video-trace@2", space: "screen-px", pan_reference: { x: 0, y: 0 },
    source: { kind: "project-preview", evidence: "prepared_project", fps, duration: lastFrame / fps,
      total_frames: frames.length, includes_endpoint: true },
    coverage: { geometry: "camera", palette: "none", screenshots: "none" }, frames }
}

export function documentField<T extends ProjectDocument>(document: T, path: string, value: string): T {
  const allowed = /^(?:elements\.\d+\.(?:opacity|fontSize|layout\.(?:x|y|width|height|anchor\.[01]))|cues\.\d+\.(?:to|duration|arc|ease\.(?:x1|y1|x2|y2)))$/
  if (!allowed.test(path)) throw new Error("此字段不支持数值编辑")
  const next = structuredClone(document)
  const bezier = /^cues\.(\d+)\.ease\./.exec(path)
  if (bezier) {
    // Editing one number turns a named ease into the explicit cubicBezier it stands for.
    const cue = next.cues[Number(bezier[1])] as { ease?: Ease } | undefined
    if (!cue) throw new Error("节点不存在")
    const n = easeNumbers(cue.ease)
    if (!n.bezier) throw new Error("spring / steps 没有贝塞尔控制点")
    const [x1, y1, x2, y2] = n.bezier
    cue.ease = { type: "cubicBezier", x1, y1, x2, y2 }
  }
  const parts = path.split(".")
  const last = parts.pop()!
  let field = next as unknown as Record<string, unknown>
  for (const key of parts) field = field[key] as Record<string, unknown>
  if ((last === "to" || last === "fontSize") && typeof field[last] !== "number") {
    throw new Error("此字段不是数值")
  }
  const input = value.trim()
  if ((last === "width" || last === "height" || last === "arc") && input === "") delete field[last]
  else if (["x", "y", "width", "height"].includes(last) && /^-?\d+(?:\.\d+)?%$/.test(input)) field[last] = input
  else {
    const n = Number(input)
    if (!input || !Number.isFinite(n)) throw new Error("请输入有效数值")
    field[last] = n
  }
  return next
}
