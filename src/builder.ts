import { parseProject } from "./pipeline/definition.js"
import type { Camera, Cue, ElementDefinition, Length, Point, ProjectDocument, Region } from "./pipeline/definition.js"
import { compileTimeline } from "./pipeline/timeline.js"
import type { TimingSegment } from "./pipeline/timing.js"
import type { DeckStep } from "./presentation.js"

/**
 * createSceneBuilder：用几十行普通代码写出标准 `silkyscene@1` 场景 + 时间表。
 * 零魔法：每个方法只是往 JSON 里追加一条记录，build() 返回的 `scene` / `timing` 与手写 JSON 完全相同，
 * 并在返回前跑一遍 parseProject + compileTimeline，把字段拼错、锚点冲突、重名等问题在生成脚本里就报出来。
 *
 *   const b = createSceneBuilder({ background: "#F7F7F5" })
 *   b.region("main", { x: 0, y: 0, width: 16 / 9, height: 1 })
 *   b.rect("card", { in: "main", w: 0.6, h: 0.3 }, { fill: "#FFFFFF", radius: 0.02 })
 *   b.text("title", { in: "card" }, "Hello", { fontSize: 0.04, opacity: 0 })
 *   b.cue("title-in", 0.4, "title", "opacity", 0.5, 1, { ease: "sine-out" })
 *   const { scene, timing } = b.build()
 */

/** 1 u = 1080 design px. `px(48)` = 48 design px in u. */
export const px = (designPx: number) => designPx / 1080
/** Shorthand placement: container id, center-zero offset, box size and anchor (defaults: 0, 0, [0, 0]). */
export interface Place { in: string; x?: Length; y?: Length; w?: Length; h?: Length; anchor?: Point }
type Props<K extends ElementDefinition["kind"]> = Omit<Extract<ElementDefinition, { kind: K }>, "id" | "kind" | "layout">
type Opt<T> = Partial<T>
export interface CueOptions { ease?: unknown; arc?: number; arcSide?: "auto" | "left" | "right"; lag?: number; followEase?: unknown; interpolation?: "log"; bakedReason?: string; path?: unknown }
export interface SceneBuilderOptions {
  background?: string
  camera?: Partial<Camera>
  motion?: ProjectDocument["motion"]
  worldMask?: ProjectDocument["canvas"]["worldMask"]
}
export interface BuiltScene {
  scene: ProjectDocument
  timing: Record<string, number> & { segments?: TimingSegment[]; steps?: DeckStep[] }
}

const DEFAULT_CAMERA: Camera = {
  projection: "orthographic", target: { x: 0, y: 0, z: 0 },
  yaw: { rad: Math.PI / 2, cycles: 0 }, pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 },
  distance: 10, focal: 1, zoom: 1,
}
const layout = (p: Place) => ({ region: p.in, x: p.x ?? 0, y: p.y ?? 0, anchor: p.anchor ?? [0, 0] as Point,
  ...(p.w !== undefined ? { width: p.w } : {}), ...(p.h !== undefined ? { height: p.h } : {}) })
const round = (v: number) => Math.round(v * 1e6) / 1e6

export function createSceneBuilder(options: SceneBuilderOptions = {}) {
  const regions: Region[] = [], elements: ElementDefinition[] = [], cues: Cue[] = []
  const anchors = new Map<string, number>(), segments: TimingSegment[] = [], steps: DeckStep[] = []
  const ids = new Set<string>(["camera", "screen"])
  let camera: Camera = { ...DEFAULT_CAMERA, ...options.camera } as Camera
  const claim = (id: string) => {
    if (ids.has(id)) throw new Error("createSceneBuilder：ID「" + id + "」重复（区域、元素、camera、screen 须全局唯一）")
    ids.add(id)
  }
  const add = (id: string, kind: ElementDefinition["kind"], place: Place, props: object) => {
    claim(id)
    elements.push({ id, kind, layout: layout(place), ...props } as unknown as ElementDefinition)
    return api
  }
  const api = {
    /** A world region: center x / y and size in u (canvas 1920 × 1080 = 16/9 × 1 u). */
    region(id: string, r: Omit<Region, "id">) { claim(id); regions.push({ id, ...r }); return api },
    rect(id: string, place: Place, props: Props<"rect">) { return add(id, "rect", place, props) },
    text(id: string, place: Place, text: string, props: Opt<Props<"text">> & { fontSize: number }) {
      return add(id, "text", place, { text, color: "#0C0C0C", align: "center", ...props })
    },
    group(id: string, place: Place, props: Opt<Props<"group">> = {}) { return add(id, "group", place, props) },
    path(id: string, place: Place, d: string, viewBox: Point, props: Opt<Props<"path">> = {}) { return add(id, "path", place, { d, viewBox, ...props }) },
    dots(id: string, place: Place, props: Props<"dots">) { return add(id, "dots", place, props) },
    image(id: string, place: Place, src: string, props: Opt<Props<"image">> = {}) { return add(id, "image", place, { src, fit: "contain", ...props }) },
    /** Null object: a point (no size) for line ends and motion targets. */
    null(id: string, place: Omit<Place, "w" | "h">, props: Opt<Props<"null">> = {}) { return add(id, "null", place, props) },
    /** A port-to-port line. Ends are [element id, center-zero box point]. */
    line(id: string, from: readonly [string, Point], to: readonly [string, Point],
      props: Opt<Omit<Extract<ElementDefinition, { kind: "line" }>, "id" | "kind" | "from" | "to">> = {}) {
      claim(id)
      elements.push({ id, kind: "line", from: { element: from[0], at: from[1] }, to: { element: to[0], at: to[1] },
        color: "#0C0C0C", width: 2, ...props } as ElementDefinition)
      return api
    },
    /** Merge camera fields (target / zoom / view3d / position / approach / arc …) over the orthographic default. */
    camera(patch: Partial<Camera>) { camera = { ...camera, ...patch } as Camera; return api },
    /** Register an anchor time. The same name may be reused only with the same time. */
    anchor(name: string, time: number) {
      if (!Number.isFinite(time) || time < 0) throw new Error("createSceneBuilder：锚点「" + name + "」的时间须为 ≥ 0 的秒数")
      const t = round(time), old = anchors.get(name)
      if (old !== undefined && old !== t) throw new Error("createSceneBuilder：锚点「" + name + "」已登记为 " + old + " s，不能再改成 " + t + " s（换个名字）")
      anchors.set(name, t)
      return api
    },
    /** One keyframe: at anchor `atName` (= `time` s) animate `target.property` to `to` over `duration` s. */
    cue(atName: string, time: number, target: string, property: string, duration: number, to?: unknown, opts: CueOptions = {}) {
      api.anchor(atName, time)
      cues.push({ at: atName, target, property, duration, ...(to !== undefined ? { to } : {}), ...opts } as unknown as Cue)
      return api
    },
    /** Narration line, stored in timing.segments (also the default presentation steps). */
    segment(name: string, start: number, end: number, text?: string) {
      segments.push({ name, start, end, ...(text !== undefined ? { text } : {}) }); return api
    },
    /** Presentation stop (present.html): playback pauses here until the presenter advances. */
    step(id: string, at: number, title?: string) { steps.push({ id, at, ...(title !== undefined ? { title } : {}) }); return api },
    build(): BuiltScene {
      const scene = {
        format: "silkyscene@1" as const,
        canvas: { width: 1920 as const, height: 1080 as const, background: options.background ?? "#FAFAF8", ...(options.worldMask ? { worldMask: options.worldMask } : {}) },
        regions, elements, camera, cues, ...(options.motion ? { motion: options.motion } : {}),
      } as ProjectDocument
      const doc = parseProject(JSON.parse(JSON.stringify(scene)))
      compileTimeline(doc, anchors)
      const timing = Object.fromEntries(anchors) as BuiltScene["timing"]
      if (segments.length) timing.segments = [...segments].sort((a, b) => a.start - b.start)
      if (steps.length) timing.steps = [...steps].sort((a, b) => a.at - b.at)
      return { scene: doc, timing }
    },
  }
  return api
}
export type SceneBuilder = ReturnType<typeof createSceneBuilder>
