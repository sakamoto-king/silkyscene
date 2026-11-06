import type { ProjectDocument } from "./definition.js"
import { DESIGN_PIXELS_PER_UNIT as u } from "./definition.js"
import type { Matrix, ResolvedScene } from "../render/primitives.js"
import type { ResolvedRect } from "../shared/geometry.js"
import { DESIGN_HEIGHT, DESIGN_WIDTH } from "../shared/geometry.js"

/**
 * 画面质量扫描（check_scene 的机检警告）：在采样帧上把元素投到 1920 × 1080 屏幕，找出两类常见事故。
 *  - `small-text`：可见文字（实际不透明度 > minOpacity）在屏幕上的字号 < minFontPx；
 *  - `edge-clip`：不透明度 > 0.5、未标 ignoreMask 的文字或卡片（屏幕面积 ≤ 画面 35%）被取景框边缘切掉一部分。
 * 同一元素持续超过 minDuration 秒才算一次问题（飞入 / 缩放入场的瞬间不报），结果按元素与时间段合并。
 * 只读：不改变任何渲染结果。
 */
export interface QualityIssue {
  kind: "small-text" | "edge-clip"
  id: string
  start: number
  end: number
  /** small-text：最小屏幕字号 px；edge-clip：最大被裁比例 0..1。 */
  worst: number
  message: string
}
export interface QualityOptions {
  minFontPx?: number
  minOpacity?: number
  minDuration?: number
  /** 卡片面积上限（占画面比例）：更大的矩形视为背景，不查裁边。默认 0.35。 */
  cardAreaRatio?: number
}
export interface QualityFrame { time: number; scene: ResolvedScene; boxes: ReadonlyMap<string, ResolvedRect> }

const apply2 = ([a, b, c, d, e, f]: Matrix, x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f]
const mul = ([a, b, c, d, e, f]: Matrix, [A, B, C, D, E, F]: Matrix): Matrix =>
  [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f]
const applyH = (h: readonly number[], x: number, y: number): [number, number] => {
  const w = h[6]! * x + h[7]! * y + h[8]!
  return [(h[0]! * x + h[1]! * y + h[2]!) / w, (h[3]! * x + h[4]! * y + h[5]!) / w]
}
const area = (q: readonly (readonly [number, number])[]) =>
  Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % q.length]!; return s + p[0] * n[1] - n[0] * p[1] }, 0)) / 2

/** Screen corners of a layer-px box for one primitive (2D camera, screen layer, or 3D homography). */
export function screenQuad(scene: ResolvedScene, p: { layer?: string; transform?: Matrix; transform3d?: readonly number[] }, r: ResolvedRect) {
  const pts: [number, number][] = [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]]
  const perspective = scene.view3d !== undefined && !scene.view3d.flat
  if (perspective && p.transform3d && p.layer !== "screen") return pts.map(([x, y]) => applyH(p.transform3d!, x, y))
  const own = p.transform ?? [1, 0, 0, 1, 0, 0] as Matrix
  const m = p.layer === "screen" || !scene.camera ? own : mul(scene.camera, own)
  return pts.map(([x, y]) => apply2(m, x, y))
}

export function qualityScan(project: ProjectDocument, frames: readonly QualityFrame[], options: QualityOptions = {}): QualityIssue[] {
  const minFont = options.minFontPx ?? 13, minOp = options.minOpacity ?? 0.2, minDur = options.minDuration ?? 0.25
  const cardMax = (options.cardAreaRatio ?? 0.35) * DESIGN_WIDTH * DESIGN_HEIGHT
  const defs = new Map(project.elements.map(e => [e.id, e]))
  type Run = { kind: QualityIssue["kind"]; id: string; start: number; end: number; worst: number }
  const open = new Map<string, Run>(), done: Run[] = []
  const frameGap = frames.length > 1 ? frames[1]!.time - frames[0]!.time : 1 / 30
  const hit = (kind: Run["kind"], id: string, t: number, v: number, worse: (a: number, b: number) => number) => {
    const k = kind + "\u0000" + id, r = open.get(k)
    if (r && t - r.end <= frameGap * 1.5 + 1e-6) { r.end = t; r.worst = worse(r.worst, v) }
    else { if (r) done.push(r); open.set(k, { kind, id, start: t, end: t, worst: v }) }
  }
  for (const { time, scene, boxes } of frames) {
    for (const p of scene.primitives) {
      if (p.kind !== "text" && p.kind !== "rect") continue
      const def = defs.get(p.id)
      if (!def || def.kind === "line") continue
      const op = p.opacity ?? 1
      if (op <= minOp || p.reveal) continue
      const box = boxes.get(p.id)
      if (!box || box.width <= 0 || box.height <= 0) continue
      const quad = screenQuad(scene, p, box), scale = Math.sqrt(area(quad) / (box.width * box.height))
      if (p.kind === "text" && def.kind === "text" && p.text.trim()) {
        const px = def.fontSize * u * scale
        if (px < minFont) hit("small-text", p.id, time, px, Math.min)
      }
      if (op <= 0.5 || def.ignoreMask || p.clip) continue
      const scr = area(quad)
      if (p.kind === "rect" && scr > cardMax) continue
      const xs = quad.map(q => q[0]), ys = quad.map(q => q[1])
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
      const w = x1 - x0, h = y1 - y0
      if (w <= 0 || h <= 0) continue
      const iw = Math.max(0, Math.min(x1, DESIGN_WIDTH) - Math.max(x0, 0)), ih = Math.max(0, Math.min(y1, DESIGN_HEIGHT) - Math.max(y0, 0))
      const cut = 1 - (iw * ih) / (w * h)
      // Fully off-frame is "not in shot" (fine); partly cut by more than 2 % is a cropped card / text.
      if (cut > 0.02 && cut < 0.999) hit("edge-clip", p.id, time, cut, Math.max)
    }
  }
  done.push(...open.values())
  return done.filter(r => r.end - r.start + frameGap >= minDur - 1e-6)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .map(r => ({ ...r, message: r.kind === "small-text"
      ? r.id + " 在 " + r.start.toFixed(2) + "–" + r.end.toFixed(2) + " s 屏幕字号仅 " + r.worst.toFixed(1) + " px（< " + minFont + " px，成片看不清）"
      : r.id + " 在 " + r.start.toFixed(2) + "–" + r.end.toFixed(2) + " s 被取景框边缘裁掉 " + Math.round(r.worst * 100) + "%（压边 / 出画）" }))
}
