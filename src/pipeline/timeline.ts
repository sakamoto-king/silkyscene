import { DEFAULT_ARC, DEFAULT_CAMERA_LAG, DEFAULT_MAX_OVERSHOOT, DEFAULT_MAX_TILT, motionOf } from "./definition.js"
import { mixColor } from "../shared/color.js"
import type { ArcSide, Cue, LayoutProperty, Length, MotionPath, ProjectDocument } from "./definition.js"
import { cameraMatrix } from "./resolve.js"
import { DESIGN_PIXELS_PER_UNIT, DESIGN_WIDTH } from "../shared/geometry.js"
import { easeFunction } from "./easing.js"
import { deriveView } from "../shared/cameraGeometry.js"
import type { Ease } from "./easing.js"

/** How a free x/y move bends: declared values at each level and the resolved quadratic (container u, Y up). */
export interface ArcInfo {
  declared: { cue: number | undefined; element: number | undefined; project: number | undefined; side: ArcSide | undefined }
  arc: number; side: "left" | "right" | "none"; reason?: string
  from?: readonly [number, number]; to?: readonly [number, number]; control?: readonly [number, number]
  /** Distance of the curve midpoint from the straight chord, in u (= arc × travel distance). */
  offset?: number
}
/** Camera pan move (docs/04): the look target runs first, the framing trails it by lag on the same kind of arc. */
export interface CameraMoveInfo {
  declared: { arc: { cue: number | undefined; camera: number | undefined; project: number | undefined }
    side: ArcSide | undefined; lag: { cue: number | undefined; camera: number | undefined }; followEase: Ease | undefined }
  arc: number; side: "left" | "right" | "none"; lag: number; reason?: string
  /** Look target window [start, end] and framing window, in seconds. */
  look: { start: number; end: number; from: readonly [number, number]; to: readonly [number, number]; offset: number }
  frame: { start: number; end: number; from: readonly [number, number]; to: readonly [number, number]; offset: number }
}
/** docs/04: one camera body move (position.x/y), independent of the target. Plane u, Y up. */
export interface PositionMoveInfo { start: number; end: number; from: readonly [number, number]; to: readonly [number, number]
  arc: number; side: "left" | "right" | "none"; offset: number; reason?: string }
type CamState = CameraMoveInfo & { ease?: Ease | undefined; at?: (t: number, layer: "look" | "frame") => [number, number] }
type ArcState = ArcInfo & { ease?: Ease | undefined; bend?: [number, number] }
type MoveCue = Extract<Cue, { property: LayoutProperty }> & { property: "x" | "y" }
export type CompiledCue = Cue & { index: number; start: number; from: number | string | boolean; arcInfo?: ArcInfo | undefined
  cameraMove?: CameraMoveInfo | undefined; positionMove?: PositionMoveInfo | undefined; zoomLag?: { declared: number | undefined; lag: number } | undefined }
export type CurrentCue = CompiledCue & { p: number; running: boolean }

/** Animated values for one element at one time. Only channels with cues are present. */
export interface ElementState {
  opacity?: number; scaleX?: number; scaleY?: number
  x?: Length; y?: Length; width?: Length; height?: Length
  text?: string; stroke?: string; connected?: boolean
  /** docs/02 */
  trim?: number; reveal?: number; fill?: string; color?: string; background?: string
  /** docs/02 */
  rotate?: number; strokeColor?: string
}
export interface FrameState { camera: { x: number; y: number; zoom: number; look: { x: number; y: number }
  /** docs/04: present only when camera.view3d is declared. Lengths u, angles degrees. */
  view3d?: { distance: number; height: number; pitch: number; yaw: number
    /** docs/04: true when pitch / yaw / height were derived from the camera body position and the target. */
    derived?: boolean; eye?: { x: number; y: number; z: number }; sight?: number
    frame?: readonly [number, number]; target?: readonly [number, number, number] } }; elements: Map<string, ElementState> }

type Value = number | string | boolean
type Track = { start: number; at(time: number): Value }[]
const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" })

function latest(track: Track | undefined, time: number, initial: Value): Value {
  if (track) for (let i = track.length - 1; i >= 0; i--) if (track[i]!.start <= time) return track[i]!.at(time)
  return initial
}
function progress(time: number, start: number, duration: number) {
  return duration === 0 || time >= start + duration ? 1 : Math.max(0, (time - start) / duration)
}
/** Lengths keep their unit: numbers stay u, "n%" stays a percentage of the container axis. */
const amount = (v: Value) => typeof v === "string" ? Number(v.slice(0, -1)) : v as number
const sameUnit = (v: number, like: Value): Value => typeof like === "string" ? v + "%" : v

function tween(start: number, duration: number, from: Value, to: Value, ease: Ease | undefined, log = false) {
  const f = easeFunction(ease, duration), a = amount(from), b = amount(to)
  return { start, at(time: number): Value {
    const p = progress(time, start, duration)
    if (p === 1) return to
    const e = f(p)
    if (e === 0) return from
    return sameUnit(log ? Math.exp(Math.log(a) * (1 - e) + Math.log(b) * e) : a + (b - a) * e, to)
  } }
}

/** Constant-speed point on a polyline / quadratic / cubic path, sampled once at compile time. */
export function pathSampler(path: MotionPath) {
  const pts = path.points, step = path.curve === "linear" ? 1 : path.curve === "quadratic" ? 2 : 3
  const bez = (s: readonly (readonly [number, number])[], t: number): [number, number] => {
    let q = s.map(p => [p[0], p[1]] as [number, number])
    while (q.length > 1) q = q.slice(1).map((p, i) => [q[i]![0] + (p[0] - q[i]![0]) * t, q[i]![1] + (p[1] - q[i]![1]) * t])
    return q[0]!
  }
  const samples: [number, number][] = [], lengths = [0]
  for (let i = 0; i + step < pts.length; i += step) {
    const seg = pts.slice(i, i + step + 1)
    for (let k = samples.length ? 1 : 0; k <= 64; k++) samples.push(bez(seg, k / 64))
  }
  for (let i = 1; i < samples.length; i++) {
    lengths.push(lengths[i - 1]! + Math.hypot(samples[i]![0] - samples[i - 1]![0], samples[i]![1] - samples[i - 1]![1]))
  }
  const total = lengths[lengths.length - 1]!
  return (p: number): [number, number] => {
    if (p <= 0 || total === 0) return samples[0]!
    if (p >= 1) return samples[samples.length - 1]!
    const d = p * total
    let i = 1
    while (lengths[i]! < d) i++
    const k = (d - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]!), a = samples[i - 1]!, b = samples[i]!
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
  }
}

function textTransition(cue: Extract<Cue, { property: "text" }>, start: number, from: string) {
  const graphemes = (text: string) => Array.from(segmenter.segment(text), item => item.segment)
  const a = graphemes(from), b = graphemes(cue.to)
  let shared = 0
  while (shared < b.length && a[shared] === b[shared]) shared++
  const states = [from]
  if (cue.duration === 0 || shared === b.length) states.push(cue.to)
  else for (let end = shared + 1; end <= b.length; end++) states.push(b.slice(0, end).join(""))
  return { start, states, duration: cue.duration, at(time: number) {
    const frame = Math.floor(progress(time, start, cue.duration) * (states.length - 1) + 1e-9)
    return states[Math.min(states.length - 1, frame)]!
  } }
}

export function compileTimeline(project: ProjectDocument, anchors: ReadonlyMap<string, number>) {
  const tracks = new Map<string, Track>()
  const textPlans = new Map<string, ReturnType<typeof textTransition>[]>()
  const elements = new Map(project.elements.map(element => [element.id, element]))
  const camera = project.camera
  const key = (target: string, channel: string) => target + "\u0000" + channel
  const initial = (target: string, channel: string): Value => {
    if (target === "camera") return channel === "zoom" ? camera.zoom : channel.startsWith("view3d.")
      ? (camera.view3d?.[channel.slice(7) as "pitch" | "yaw" | "height"] ?? 0)
      : channel === "target.z" ? camera.target.z
      : channel === "position.z" ? camera.position?.z ?? camera.target.z + (camera.view3d?.distance ?? 0)
      : channel.startsWith("position.") ? (channel.endsWith(".x") ? camera.position?.x ?? camera.target.x : camera.position?.y ?? camera.target.y)
      : channel.startsWith("approach.") ? (channel.endsWith(".x") ? camera.approach?.x ?? 0 : camera.approach?.y ?? 0)
      : channel.endsWith(".x") ? camera.target.x : camera.target.y
    const e = elements.get(target)!
    if (channel === "opacity") return e.opacity ?? 1
    if (channel === "trim") return "trim" in e ? e.trim ?? 1 : 1
    if (channel === "reveal") return "reveal" in e ? e.reveal ?? 1 : 1
    if (channel === "fill") return "fill" in e ? e.fill ?? "transparent" : "transparent"
    if (channel === "color") return "color" in e ? e.color : "transparent"
    if (channel === "rotate") return "rotate" in e ? e.rotate ?? 0 : 0
    if (channel === "strokeColor") return "stroke" in e ? e.stroke ?? "transparent" : "transparent"
    if (channel === "background") return "background" in e ? e.background ?? "transparent" : "transparent"
    if (e.kind === "line") return channel === "stroke" ? e.color : e.connected ?? true
    if (channel === "scaleX" || channel === "scaleY") return e[channel] ?? 1
    if (channel === "text" && e.kind === "text") return e.text
    return e.layout[channel as "x" | "y" | "width" | "height"]!
  }
  const add = (target: string, channel: string, step: Track[number]) => {
    const track = tracks.get(key(target, channel)) ?? []
    track.push(step)
    tracks.set(key(target, channel), track)
  }
  const now = (target: string, channel: string, time: number) =>
    latest(tracks.get(key(target, channel)), time, initial(target, channel))

  const cues = project.cues.map((cue, order) => {
    const time = anchors.get(cue.at)
    if (time === undefined || !Number.isFinite(time) || time < 0) throw new Error("节点锚点未解析：" + cue.at)
    return { cue: { ...cue }, time, order }
  }).sort((a, b) => a.time - b.time || a.order - b.order)

  const compiled = new Map<string, CompiledCue[]>()
  // Free x/y moves: one quadratic per (target, start, duration), shared by the x and the y cue of the same move.
  const arcs = new Map<string, ArcState>()
  const arcFor = (cue: MoveCue, time: number): ArcState => {
    const id = cue.target + "\u0000" + time + "\u0000" + cue.duration
    const cached = arcs.get(id)
    if (cached) {
      if (JSON.stringify(cached.ease ?? "linear") !== JSON.stringify(cue.ease ?? "linear"))
        throw new Error(cue.target + " 同一时刻的 x / y 节点 ease 不同，无法合成弧线；请统一 ease 或写 arc:0")
      return cached
    }
    const e = elements.get(cue.target)!
    const declared = { cue: cue.arc, element: "arc" in e ? e.arc : undefined, project: project.motion?.arc,
      side: cue.arcSide ?? ("arcSide" in e ? e.arcSide : undefined) ?? project.motion?.arcSide }
    const arc = declared.cue ?? declared.element ?? declared.project ?? DEFAULT_ARC
    const straight = (reason: string) => { const info: ArcState = { declared, arc: 0, side: "none" as const, reason, ease: cue.ease }; arcs.set(id, info); return info }
    const partner = cues.find(c => c.cue.target === cue.target && c.time === time && c.cue.duration === cue.duration &&
      c.cue.property === (cue.property === "x" ? "y" : "x"))?.cue as MoveCue | undefined
    if (motionOf(e) === "bound") {
      if (partner && cue.duration > 0) throw new Error(cue.target + " 是 bound 元素，只能水平或垂直平移；同一时刻的 x 和 y 节点请改为 motion:\"free\" 或分开")
      return straight("bound 元素只做直线平移")
    }
    if (arc === 0) return straight("arc = 0")
    if (cue.duration === 0) return straight("时长为 0")
    if (typeof now(cue.target, "x", time) !== "number" || typeof now(cue.target, "y", time) !== "number") return straight("百分比单位不生成弧线")
    const end = (axis: "x" | "y") => cue.property === axis ? cue.to as number
      : partner ? partner.to as number : now(cue.target, axis, time + cue.duration) as number
    const from = [now(cue.target, "x", time) as number, now(cue.target, "y", time) as number] as const
    const to = [end("x"), end("y")] as const
    const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy)
    if (length === 0) return straight("起点与终点重合")
    // Left of travel (counterclockwise, Y up). "auto" bends away from the container center: the side whose
    // normal points the same way as the chord midpoint; a midpoint exactly at the center falls back to left.
    const left = [-dy / length, dx / length] as const, mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] as const
    const side = declared.side === "left" || declared.side === "right" ? declared.side
      : left[0] * mid[0] + left[1] * mid[1] < -1e-12 ? "right" : "left"
    const n = side === "left" ? left : [-left[0], -left[1]] as const
    const offset = arc * length, bend: [number, number] = [n[0] * offset, n[1] * offset]
    const info: ArcState = { declared, arc, side, from, to, offset, ease: cue.ease, bend,
      control: [mid[0] + 2 * bend[0], mid[1] + 2 * bend[1]] as const }
    arcs.set(id, info)
    // A single-axis move still bends: the other axis gets the bulge added on top of whatever drives it.
    if (!partner) {
      const other = cue.property === "x" ? "y" : "x", axis = other === "x" ? 0 : 1, f = easeFunction(cue.ease, cue.duration)
      const before = [...tracks.get(key(cue.target, other)) ?? []]
      add(cue.target, other, { start: time, at: t => {
        const e = f(progress(t, time, cue.duration))
        return (latest(before, t, initial(cue.target, other)) as number) + 4 * e * (1 - e) * bend[axis]
      } })
    }
    return info
  }
  // Camera pan moves: "target.*" tracks are the framing (what the matrix uses), "look.*" the look target.
  const camMoves = new Map<string, CamState>()
  const cameraArcs: CamState[] = []
  type CamCue = { target: string; duration: number; property: "target.x" | "target.y"; to: number; ease?: Ease | undefined
    arc?: number | undefined; arcSide?: ArcSide | undefined; lag?: number | undefined; followEase?: Ease | undefined }
  const camFor = (cue: CamCue, time: number): CamState => {
    const id = time + "\u0000" + cue.duration
    const cached = camMoves.get(id)
    if (cached) {
      if (JSON.stringify(cached.ease ?? "linear") !== JSON.stringify(cue.ease ?? "linear"))
        throw new Error("相机同一时刻的 target.x / target.y 节点 ease 不同，无法合成弧线；请统一 ease 或写 arc:0、lag:0")
      return cached
    }
    const other = cue.property === "target.x" ? "target.y" : "target.x"
    const partner = cues.find(c => c.cue.target === "camera" && c.time === time && c.cue.duration === cue.duration &&
      c.cue.property === other)?.cue as CamCue | undefined
    const pick = <K extends "arc" | "arcSide" | "lag" | "followEase">(k: K) => cue[k] ?? partner?.[k]
    const declared = { arc: { cue: pick("arc"), camera: camera.arc, project: project.motion?.arc },
      side: pick("arcSide") ?? camera.arcSide ?? project.motion?.arcSide,
      lag: { cue: pick("lag"), camera: camera.lag }, followEase: pick("followEase") ?? camera.followEase }
    const arc = declared.arc.cue ?? declared.arc.camera ?? declared.arc.project ?? DEFAULT_ARC
    const lagWanted = declared.lag.cue ?? declared.lag.camera ?? DEFAULT_CAMERA_LAG
    // The framing must arrive inside the cue: lag is capped at half the duration so both layers keep ≥ D/2 to travel.
    const lag = Math.min(lagWanted, cue.duration / 2)
    const end = (layer: string, axis: "x" | "y") => cue.property === "target." + axis ? cue.to
      : partner ? partner.to : now("camera", layer + "." + axis, time + cue.duration) as number
    const point = (layer: string, t: number) => [now("camera", layer + ".x", t) as number, now("camera", layer + ".y", t) as number] as const
    const frameFrom = point("target", time), lookFrom = point("look", time)
    const frameTo = [end("target", "x"), end("target", "y")] as const, lookTo = [end("look", "x"), end("look", "y")] as const
    const dx = frameTo[0] - frameFrom[0], dy = frameTo[1] - frameFrom[1], length = Math.hypot(dx, dy)
    const base = { declared, arc, lag, ease: cue.ease,
      look: { start: time, end: time + cue.duration - lag, from: lookFrom, to: lookTo, offset: 0 },
      frame: { start: time + lag, end: time + cue.duration, from: frameFrom, to: frameTo, offset: 0 } }
    const straight = (reason: string): CamState => { const info = { ...base, arc: 0, lag: 0, side: "none" as const, reason,
      look: { ...base.look, end: time + cue.duration }, frame: { ...base.frame, start: time } }; camMoves.set(id, info); return info }
    if (cue.duration === 0) return straight("时长为 0")
    if (arc === 0 && lag === 0) return straight("arc = 0 且 lag = 0：旧直线行为")
    // Camera "auto" bends upward like a crane / jib boom; a purely vertical move has no up side and bends left.
    const leftOf = (ddx: number, ddy: number, l: number) => [-ddy / l, ddx / l] as const
    const ref = length > 0 ? leftOf(dx, dy, length) : [0, 0] as const
    const side = declared.side === "left" || declared.side === "right" ? declared.side : ref[1] < -1e-12 ? "right" : "left"
    const bendOf = (from: readonly [number, number], to: readonly [number, number]) => {
      const ddx = to[0] - from[0], ddy = to[1] - from[1], l = Math.hypot(ddx, ddy)
      if (l === 0) return [0, 0, 0] as const
      const n = leftOf(ddx, ddy, l), k = side === "left" ? 1 : -1
      return [n[0] * k * arc * l, n[1] * k * arc * l, arc * l] as const
    }
    const fb = bendOf(frameFrom, frameTo), lb = bendOf(lookFrom, lookTo)
    const fLook = easeFunction(cue.ease, cue.duration - lag), fFrame = easeFunction(declared.followEase ?? cue.ease, cue.duration - lag)
    const curve = (from: readonly [number, number], to: readonly [number, number], b: readonly [number, number, number], e: number, p: number): [number, number] =>
      p === 1 ? [to[0], to[1]] : e === 0 ? [from[0], from[1]]
        : [from[0] + (to[0] - from[0]) * e + 4 * e * (1 - e) * b[0], from[1] + (to[1] - from[1]) * e + 4 * e * (1 - e) * b[1]]
    const at = (t: number, layer: "look" | "frame") => {
      if (layer === "look") { const p = progress(t, time, cue.duration - lag); return curve(lookFrom, lookTo, lb, fLook(p), p) }
      const p = progress(t, time + lag, cue.duration - lag); return curve(frameFrom, frameTo, fb, fFrame(p), p)
    }
    const info: CamState = { ...base, side, at, look: { ...base.look, offset: lb[2] }, frame: { ...base.frame, offset: fb[2] } }
    camMoves.set(id, info)
    cameraArcs.push(info)
    // A single-axis camera move still bends: the other axis gets the bulge on top of whatever drives it.
    if (!partner) {
      const ax = other.endsWith("x") ? 0 : 1, otherAxis = other.slice(-1)
      for (const [layer, b] of [["target", fb], ["look", lb]] as const) {
        const before = [...tracks.get(key("camera", layer + "." + otherAxis)) ?? []]
        add("camera", layer + "." + otherAxis, { start: time, at: t => {
          const v = latest(before, t, initial("camera", layer + "." + otherAxis)) as number
          // Bulge only: the straight part of this axis comes from the existing track.
          const p = layer === "target" ? progress(t, time + lag, cue.duration - lag) : progress(t, time, cue.duration - lag)
          const e = (layer === "target" ? fFrame : fLook)(p)
          return p === 1 ? v : v + 4 * e * (1 - e) * b[ax]
        } })
      }
    }
    return info
  }
  // docs/04: camera body moves. Same quadratic bend as other arcs; auto bends upward like the target pan.
  const posMoves = new Map<string, PositionMoveInfo & { bend?: [number, number] }>()
  const positionMoves: PositionMoveInfo[] = []
  const hasPosition = camera.position !== undefined || camera.approach !== undefined || cues.some(c => c.cue.target === "camera" && (String(c.cue.property).startsWith("position.") || String(c.cue.property).startsWith("approach.") || c.cue.property === "target.z"))
  const posFor = (cue: Omit<CamCue, "property"> & { property: string }, time: number) => {
    const id = time + "\u0000" + cue.duration, cached = posMoves.get(id)
    if (cached) return cached
    const other = cue.property === "position.x" ? "position.y" : "position.x"
    const partner = cues.find(c => c.cue.target === "camera" && c.time === time && c.cue.duration === cue.duration && c.cue.property === other)?.cue as CamCue | undefined
    if (partner && JSON.stringify(partner.ease ?? "linear") !== JSON.stringify(cue.ease ?? "linear"))
      throw new Error("相机同一时刻的 position.x / position.y 节点 ease 不同，无法合成弧线；请统一 ease 或写 arc:0")
    const from = [now("camera", "position.x", time) as number, now("camera", "position.y", time) as number] as const
    const end = (axis: "x" | "y") => cue.property === "position." + axis ? cue.to : partner ? partner.to : now("camera", "position." + axis, time + cue.duration) as number
    const to = [end("x"), end("y")] as const
    const arc = cue.arc ?? partner?.arc ?? camera.arc ?? project.motion?.arc ?? DEFAULT_ARC
    const dx = to[0] - from[0], dy = to[1] - from[1], l = Math.hypot(dx, dy)
    const base = { start: time, end: time + cue.duration, from, to }
    let info: PositionMoveInfo & { bend?: [number, number] }
    if (!partner) info = { ...base, arc: 0, side: "none", offset: 0, reason: "单轴摄像机移动走直线（弧线需 x / y 同时写）" }
    else if (arc === 0 || l === 0 || cue.duration === 0) info = { ...base, arc: 0, side: "none", offset: 0, reason: arc === 0 ? "arc = 0" : "无位移或时长为 0" }
    else {
      const n = [-dy / l, dx / l] as const, sideW = cue.arcSide ?? partner.arcSide ?? camera.arcSide ?? project.motion?.arcSide
      const side = sideW === "left" || sideW === "right" ? sideW : n[1] < -1e-12 ? "right" : "left"
      const k = side === "left" ? 1 : -1
      info = { ...base, arc, side, offset: arc * l, bend: [n[0] * k * arc * l, n[1] * k * arc * l] }
      positionMoves.push(info)
    }
    posMoves.set(id, info)
    return info
  }
  const zoomLagOf = (cue: Cue) => Math.min((cue as { lag?: number }).lag ?? 0, cue.duration)

  for (const { cue, time, order } of cues) {
    const { target, duration } = cue
    let from: Value
    if (cue.property === "text") {
      from = now(target, "text", time)
      const plan = textTransition(cue, time, from as string)
      textPlans.set(target, [...textPlans.get(target) ?? [], plan])
      add(target, "text", plan)
    } else if (cue.property === "fill" || cue.property === "color" || cue.property === "background" || cue.property === "strokeColor") {
      // docs/02: color tween; duration 0 is a hard switch (the same rule as every other cue).
      from = now(target, cue.property, time)
      const a = from as string, b = cue.to, f = easeFunction(cue.ease, duration)
      add(target, cue.property, { start: time, at: t => { const p = progress(t, time, duration); return p === 1 ? b : mixColor(a, b, f(p)) } })
    } else if (cue.property === "stroke" || cue.property === "connected") {
      from = now(target, cue.property, time)
      add(target, cue.property, { start: time, at: () => cue.to })
    } else if (cue.property === "motionPath") {
      // Same takeover rule as every other property: the path starts from the evaluated x/y at the trigger time.
      const points = [[now(target, "x", time) as number, now(target, "y", time) as number] as const, ...cue.path.points.slice(1)]
      const at = pathSampler({ ...cue.path, points }), f = easeFunction(cue.ease, duration)
      from = "path[" + cue.path.points.length + "]"
      add(target, "x", { start: time, at: t => at(f(progress(t, time, duration)))[0] })
      add(target, "y", { start: time, at: t => at(f(progress(t, time, duration)))[1] })
    } else if ((cue.property === "x" || cue.property === "y") && elements.get(target)) {
      const info = arcFor(cue as MoveCue, time)
      from = now(target, cue.property, time)
      const line = tween(time, duration, from, cue.to, cue.ease)
      if (!info.bend) add(target, cue.property, line)
      else {
        // Quadratic through from → to with the control point at mid + 2·bend: B(e) = lerp(e) + 4e(1−e)·bend.
        const axis = cue.property === "x" ? 0 : 1, f = easeFunction(cue.ease, duration), bend = info.bend[axis]!
        add(target, cue.property, { start: time, at: t => {
          const e = f(progress(t, time, duration)), v = line.at(t)
          return e === 0 || e === 1 ? v : (v as number) + 4 * e * (1 - e) * bend
        } })
      }
      const { ease: _e, bend: _b, ...arcInfo } = info
      const id = key(target, cue.property)
      compiled.set(id, [...compiled.get(id) ?? [], { ...cue, start: time, index: order, from, arcInfo }])
      continue
    } else if (target === "camera" && (cue.property === "target.x" || cue.property === "target.y")) {
      const info = camFor(cue as unknown as CamCue, time), axis = cue.property.slice(-1), ax = axis === "x" ? 0 : 1
      from = now(target, cue.property, time)
      if (!info.at) {
        add(target, cue.property, tween(time, duration, from, cue.to, cue.ease))
        add(target, "look." + axis, tween(time, duration, now(target, "look." + axis, time), cue.to, cue.ease))
      } else {
        const at = info.at
        add(target, cue.property, { start: time, at: t => at(t, "frame")[ax] })
        add(target, "look." + axis, { start: time, at: t => at(t, "look")[ax] })
      }
      const { ease: _e, at: _a, ...cameraMove } = info
      const id = key(target, cue.property)
      compiled.set(id, [...compiled.get(id) ?? [], { ...cue, start: time, index: order, from, cameraMove }])
      continue
    } else if (target === "camera" && (cue.property === "approach.x" || cue.property === "approach.y")) {
      // docs/04: additive approach control on top of position.x/y; defaults to straight radial glide (arc: 0) unless cue.arc is set.
      const ax = cue.property === "approach.x" ? 0 : 1, other = ax === 0 ? "approach.y" : "approach.x"
      const partner = cues.find(c => c.cue.target === "camera" && c.time === time && c.cue.duration === duration && c.cue.property === other)?.cue as CamCue | undefined
      from = now(target, cue.property, time)
      const line = tween(time, duration, from, cue.to, cue.ease)
      const arc = cue.arc ?? partner?.arc ?? 0
      if (!partner || arc === 0 || duration === 0) add(target, cue.property, line)
      else {
        const fx = now("camera", "approach.x", time) as number, fy = now("camera", "approach.y", time) as number
        const tx2 = ax === 0 ? cue.to : partner.to, ty2 = ax === 1 ? cue.to : partner.to
        const dx = tx2 - fx, dy = ty2 - fy, l = Math.hypot(dx, dy)
        if (l === 0) add(target, cue.property, line)
        else {
          const n = [-dy / l, dx / l] as const, sideW = cue.arcSide ?? partner.arcSide ?? camera.arcSide ?? project.motion?.arcSide
          const k = (sideW === "left" || sideW === "right" ? sideW : n[1] < -1e-12 ? "right" : "left") === "left" ? 1 : -1
          const f = easeFunction(cue.ease, duration), b = (ax === 0 ? n[0] : n[1]) * k * arc * l
          add(target, cue.property, { start: time, at: t => { const e = f(progress(t, time, duration)), v = line.at(t) as number; return e === 0 || e === 1 ? v : v + 4 * e * (1 - e) * b } })
        }
      }
      const id = key(target, cue.property)
      compiled.set(id, [...compiled.get(id) ?? [], { ...cue, start: time, index: order, from }])
      continue
    } else if (target === "camera" && (cue.property === "position.x" || cue.property === "position.y")) {
      // docs/04: x / y of the body bend together in the plane; position.z and target.z are plain tweens.
      const info = posFor(cue as unknown as Omit<CamCue, "property"> & { property: string }, time), ax = cue.property === "position.x" ? 0 : 1
      from = now(target, cue.property, time)
      const line = tween(time, duration, from, cue.to, cue.ease)
      if (!info.bend) add(target, cue.property, line)
      else {
        const f = easeFunction(cue.ease, duration), b = info.bend[ax]!
        add(target, cue.property, { start: time, at: t => {
          const e = f(progress(t, time, duration)), v = line.at(t) as number
          return e === 0 || e === 1 ? v : v + 4 * e * (1 - e) * b
        } })
      }
      const { bend: _b, ...positionMove } = info
      const id = key(target, cue.property)
      compiled.set(id, [...compiled.get(id) ?? [], { ...cue, start: time, index: order, from, positionMove }])
      continue
    } else if (target === "camera" && (cue.property === "zoom" || cue.property.startsWith("view3d.")) && zoomLagOf(cue) > 0) {
      // docs/04: view3d.* channels reuse the zoom lag rule: the change runs in [s + lag, s + D].
      const lag = zoomLagOf(cue)
      from = now(target, cue.property, time + lag)
      add(target, cue.property, tween(time + lag, duration - lag, from, cue.to, cue.ease, "interpolation" in cue && cue.interpolation === "log"))
      const id = key(target, cue.property)
      compiled.set(id, [...compiled.get(id) ?? [], { ...cue, start: time, index: order, from,
        zoomLag: { declared: (cue as { lag?: number }).lag, lag } }])
      continue
    } else {
      const channels = cue.property === "scale" ? ["scaleX", "scaleY"] : [cue.property]
      from = now(target, channels[0]!, time)
      for (const channel of channels) add(target, channel, tween(time, duration, now(target, channel, time), cue.to,
        cue.ease, "interpolation" in cue && cue.interpolation === "log"))
    }
    const id = key(target, cue.property)
    compiled.set(id, [...compiled.get(id) ?? [], { ...cue, start: time, index: order, from }])
  }

  const textVariants = new Map<string, ReadonlySet<string>>()
  for (const [id, plans] of textPlans) {
    const variants = new Set<string>()
    for (const [i, plan] of plans.entries()) {
      const limit = plans[i + 1]?.start ?? Infinity
      const last = Math.floor(progress(limit, plan.start, plan.duration) * (plan.states.length - 1) + 1e-9)
      for (let k = 0; k <= last; k++) variants.add(plan.states[k]!)
    }
    textVariants.set(id, variants)
  }
  /** Every time a cue starts or ends: the prepare step resolves these to check region bounds. */
  const boundaries = [...new Set(cues.flatMap(({ cue, time }) => [time, time + cue.duration]))].sort((a, b) => a - b)

  // Arc-induced overshoot (docs/04): how far the frame pokes past the union of the regions, beyond what the
  // straight chord at the same progress would do, in design px. Straight moves are never checked (old behavior).
  const maxOvershoot = camera.maxOvershoot ?? DEFAULT_MAX_OVERSHOOT
  const world = project.regions.reduce((b, r) => [Math.min(b[0], r.x - r.width / 2), Math.min(b[1], r.y - r.height / 2),
    Math.max(b[2], r.x + r.width / 2), Math.max(b[3], r.y + r.height / 2)] as [number, number, number, number], [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number])
  const excess = (x: number, y: number, zoom: number) => {
    const c = Math.abs(Math.cos(camera.roll.rad)), s = Math.abs(Math.sin(camera.roll.rad))
    const w = DESIGN_WIDTH / DESIGN_PIXELS_PER_UNIT / 2 / zoom, h = 0.5 / zoom, hw = c * w + s * h, hh = s * w + c * h
    return Math.max(0, x + hw - world[2], world[0] - (x - hw), y + hh - world[3], world[1] - (y - hh)) * zoom * DESIGN_PIXELS_PER_UNIT
  }
  function overshootCheck(time: number, x: number, y: number, zoom: number) {
    if (!Number.isFinite(world[0])) return
    for (const m of cameraArcs) {
      if (time <= m.frame.start || time >= m.frame.end) continue
      const p = progress(time, m.frame.start, m.frame.end - m.frame.start)
      const e = easeFunction(m.declared.followEase ?? m.ease, m.frame.end - m.frame.start)(p)
      const sx = m.frame.from[0] + (m.frame.to[0] - m.frame.from[0]) * e, sy = m.frame.from[1] + (m.frame.to[1] - m.frame.from[1]) * e
      const extra = excess(x, y, zoom) - excess(sx, sy, zoom)
      if (extra > maxOvershoot) throw new Error("相机弧线在 " + time.toFixed(3) + " s 让取景框比直线多越出区域 " +
        extra.toFixed(1) + " px（上限 maxOvershoot = " + maxOvershoot + " px）；请减小 arc、换 arcSide 或调大 camera.maxOvershoot")
    }
  }

  function stateAt(time: number): FrameState {
    if (!Number.isFinite(time) || time < 0) throw new Error("预览时间无效")
    const states = new Map<string, ElementState>()
    for (const [k, track] of tracks) {
      const [target, channel] = k.split("\u0000") as [string, keyof ElementState]
      if (target === "camera") continue
      const state = states.get(target) ?? {}
      ;(state as Record<string, Value>)[channel] = latest(track, time, initial(target, channel))
      states.set(target, state)
    }
    const zoom = now("camera", "zoom", time) as number
    // An ease that overshoots below 0 (e.g. cubicBezier y < 0 on a linear zoom) would collapse the camera matrix.
    if (!(zoom > 0)) throw new Error("相机 zoom 在 " + time.toFixed(3) + " s 解算为 " + zoom + "，须为正数；请减小缓动过冲或改用 interpolation:\"log\"")
    const x = now("camera", "target.x", time) as number, y = now("camera", "target.y", time) as number
    overshootCheck(time, x, y, zoom)
    const v3 = camera.view3d
    let view3d: FrameState["camera"]["view3d"]
    if (v3 && hasPosition) {
      // docs/04: height, pitch and yaw are derived from the camera body position and the target, never written.
      const limit = v3.maxTilt ?? DEFAULT_MAX_TILT
      const P = [(now("camera", "position.x", time) as number) + (now("camera", "approach.x", time) as number),
        (now("camera", "position.y", time) as number) + (now("camera", "approach.y", time) as number),
        now("camera", "position.z", time) as number] as const
      const T = [x, y, now("camera", "target.z", time) as number] as const
      const d = deriveView(P, T, v3.distance)
      if (!d) throw new Error("摄像机在 " + time.toFixed(3) + " s 的高度 z " + P[2].toFixed(3) + " u 须大于 0 且高于目标点 z " + T[2].toFixed(3) + " u（正俯视相机只能从上往下看）")
      for (const [k, v] of [["俯仰", d.pitch], ["偏转", d.yaw]] as const) if (!(Math.abs(v) <= limit))
        throw new Error("相机" + k + "（由摄像机位置推导）在 " + time.toFixed(3) + " s 为 " + v.toFixed(2) + "°，超出 maxTilt ±" + limit +
          "°；摄像机与目标点平面偏移 " + Math.hypot(P[0] - x, P[1] - y).toFixed(3) + " u、高差 " + (P[2] - T[2]).toFixed(3) + " u。请缩短两条轨道的时间差、减小 arc、抬高摄像机或调大 camera.view3d.maxTilt")
      if (!(d.distance + d.height > 0)) throw new Error("摄像机在 " + time.toFixed(3) + " s 到画布平面的视线距离无效")
      view3d = { distance: d.distance, height: d.height, pitch: d.pitch, yaw: d.yaw, derived: true, eye: d.eye, sight: d.sight, frame: d.frame, target: T }
    } else if (v3) {
      const limit = v3.maxTilt ?? DEFAULT_MAX_TILT
      const [pitch, yaw, height] = (["pitch", "yaw", "height"] as const).map(k => now("camera", "view3d." + k, time) as number) as [number, number, number]
      for (const [k, v] of [["pitch", pitch], ["yaw", yaw]] as const) if (!(Math.abs(v) <= limit))
        throw new Error("相机 view3d." + k + " 在 " + time.toFixed(3) + " s 解算为 " + v.toFixed(2) + "°，超出 maxTilt ±" + limit + "°；请减小角度、缓动过冲或调大 camera.view3d.maxTilt")
      if (!(v3.distance + height > 0)) throw new Error("相机 view3d.height 在 " + time.toFixed(3) + " s 解算为 " + height.toFixed(3) +
        " u，相机落到画布平面或以下（distance + height ≤ 0）")
      view3d = { distance: v3.distance, height, pitch, yaw }
    }
    return { elements: states, camera: { x, y, zoom, ...(view3d ? { view3d } : {}),
      look: { x: now("camera", "look.x", time) as number, y: now("camera", "look.y", time) as number } } }
  }

  return {
    textVariants, boundaries, stateAt,
    tracks: [...compiled.values()],
    positionMoves: positionMoves as readonly PositionMoveInfo[],
    /** docs/04: target point x, y, z (u) at this time. */
    targetAt(time: number) { return [now("camera", "target.x", time) as number, now("camera", "target.y", time) as number, now("camera", "target.z", time) as number] as const },
    /** docs/04: camera body position x, y, z (u) at this time, or undefined when it simply follows the target. */
    positionAt(time: number) { return hasPosition ? [(now("camera", "position.x", time) as number) + (now("camera", "approach.x", time) as number), (now("camera", "position.y", time) as number) + (now("camera", "approach.y", time) as number), now("camera", "position.z", time) as number] as const : undefined },
    cameraMoves: cameraArcs.map(({ ease: _e, at: _a, ...m }) => m as CameraMoveInfo),
    lookAt(time: number) { return stateAt(time).camera.look },
    /** docs/04: resolved 3D view at this time (undefined without camera.view3d). */
    view3dAt(time: number) { return stateAt(time).camera.view3d },
    cameraAt(time: number) {
      const c = stateAt(time).camera
      return cameraMatrix({ ...camera, target: { ...camera.target, x: c.x, y: c.y } }, c.zoom)
    },
    cuesAt(time: number): CurrentCue[] {
      const result: CurrentCue[] = []
      for (const track of compiled.values()) {
        for (let i = track.length - 1; i >= 0; i--) {
          const cue = track[i]!
          if (cue.start > time) continue
          const p = progress(time, cue.start, cue.duration)
          result.push({ ...cue, p, running: cue.duration > 0 && p < 1 })
          break
        }
      }
      return result
    },
  }
}
