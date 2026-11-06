import type { ProjectDocument } from "./definition.js"

/**
 * docs/02: frame-dense ("baked") trajectory check.
 * A track (target × property) that is written as one key every frame or two is almost always a sampled copy of motion
 * that the source had as a few keys + eases. lintScene finds those runs so they can be rewritten from the source keyframes,
 * or — when they really must stay dense (physics, hand-drawn path, recorded data) — carry a `bakedReason`.
 * It never throws and never changes how a scene renders.
 */
export interface BakedTrajectoryWarning {
  kind: "baked-trajectory"
  /** "warning" = no reason given; "reported" = a bakedReason covers it (shown, not counted as a problem). */
  level: "warning" | "reported"
  target: string
  property: string
  /** Distinct key times in the track / in the densest run. */
  keyCount: number
  runKeys: number
  start: number
  end: number
  /** Mean / median gap between distinct key times of the run, seconds. */
  meanGap: number
  medianGap: number
  rule: "run" | "density"
  reason?: string
  message: string
}
export interface LintOptions {
  /** A run of at least this many keys whose consecutive gaps are all ≤ runGap counts as baked. Default 6 / 0.07 s. */
  runKeys?: number
  runGap?: number
  /** Or: at least this many keys overall with a median gap ≤ medianGap. Default 25 / 0.1 s. */
  totalKeys?: number
  medianGap?: number
}
export const BAKED_MESSAGE = "检测到疑似逐帧采样轨迹；请优先从原工程读取真实关键帧与缓动曲线，若确需逐帧请填写 bakedReason 说明原因"

const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 }

/** anchors: cue.at → seconds (the scene's -timing.json). Cues without a known anchor are skipped. */
export function lintScene(project: ProjectDocument, anchors: ReadonlyMap<string, number> | Record<string, number>, options: LintOptions = {}): BakedTrajectoryWarning[] {
  const runKeys = options.runKeys ?? 6, runGap = options.runGap ?? 0.07, totalKeys = options.totalKeys ?? 25, medGap = options.medianGap ?? 0.1
  const time = (at: string) => anchors instanceof Map ? anchors.get(at) : (anchors as Record<string, number>)[at]
  const reasonOf = new Map<string, string>()
  for (const e of project.elements) if (e.bakedReason) reasonOf.set(e.id, e.bakedReason)
  if (project.camera.bakedReason) reasonOf.set("camera", project.camera.bakedReason)
  const tracks = new Map<string, { target: string; property: string; times: number[]; reason?: string }>()
  for (const cue of project.cues) {
    const t = time(cue.at)
    if (t === undefined || !Number.isFinite(t)) continue
    const k = cue.target + "\u0000" + cue.property
    let tr = tracks.get(k)
    if (!tr) { tr = { target: cue.target, property: String(cue.property), times: [] }; tracks.set(k, tr) }
    tr.times.push(t)
    if (cue.bakedReason && !tr.reason) tr.reason = cue.bakedReason
  }
  const out: BakedTrajectoryWarning[] = []
  for (const tr of tracks.values()) {
    // Distinct key times: cues clipped to 0 by a time window, or x / y written at the same instant, are one key.
    const ts = [...new Set(tr.times.map(t => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b)
    if (ts.length < Math.min(runKeys, totalKeys)) continue
    const gaps = ts.slice(1).map((t, i) => t - ts[i]!)
    // Longest run of consecutive gaps ≤ runGap.
    let best = { from: 0, to: 0 }, from = 0
    for (let i = 0; i < gaps.length; i++) {
      if (gaps[i]! > runGap + 1e-9) { from = i + 1; continue }
      if (i + 1 - from > best.to - best.from) best = { from, to: i + 1 }
    }
    const runN = best.to - best.from + 1
    const byRun = runN >= runKeys, byDensity = ts.length >= totalKeys && median(gaps) <= medGap + 1e-9
    if (!byRun && !byDensity) continue
    const s = byRun ? ts[best.from]! : ts[0]!, e = byRun ? ts[best.to]! : ts[ts.length - 1]!
    const g = byRun ? gaps.slice(best.from, best.to) : gaps
    const reason = tr.reason ?? reasonOf.get(tr.target)
    out.push({ kind: "baked-trajectory", level: reason ? "reported" : "warning", target: tr.target, property: tr.property,
      keyCount: ts.length, runKeys: byRun ? runN : ts.length, start: s, end: e,
      meanGap: g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0, medianGap: median(g), rule: byRun ? "run" : "density",
      ...(reason ? { reason } : {}),
      message: reason ? "已报备逐帧：" + reason : BAKED_MESSAGE })
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "warning" ? -1 : 1) || b.keyCount - a.keyCount)
}

/** One-line Chinese summary of a lint result (CLI / inspector badge). */
export function lintSummary(list: readonly BakedTrajectoryWarning[]) {
  const w = list.filter(x => x.level === "warning"), r = list.length - w.length
  const targets = new Set(w.map(x => x.target)).size
  return w.length ? "⚠ 逐帧轨迹警告 " + w.length + " 条（" + targets + " 个对象）" + (r ? " · 已报备 " + r + " 条" : "")
    : r ? "逐帧轨迹：0 条警告 · 已报备 " + r + " 条" : "逐帧轨迹：0 条警告"
}
