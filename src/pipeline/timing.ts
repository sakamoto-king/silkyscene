/**
 * `<name>-timing.json` 的安全读取。
 *
 * 时间表是「锚点名 → 秒」的平铺对象，但口播工作流常在同一个文件里登记台词：
 * `{ "intro": 0, "pan": 5.5, "segments": [{ "name": "s1", "start": 0, "end": 5.5, "text": "…" }] }`。
 * 直接 `new Map(Object.entries(json))` 会把 `segments` 数组塞进 `Map<string, number>`，
 * 下游做 `Math.max` / 加减时得到 NaN。这里只收有限数字，台词段单独返回。
 */
export interface TimingSegment {
  name?: string
  start: number
  end: number
  text?: string
}

/** 现场演示停靠拍（present.html）：`steps: [{ id, at, title? }]`。 */
export interface TimingStep { id: string; at: number; title?: string }

export interface ParsedTiming {
  /** 只含有限数字的锚点表，可直接传给 prepareProject / compileTimeline / lintScene。 */
  anchors: Map<string, number>
  /** `segments` 数组里 start / end 都是有限数字的条目（按原顺序）。 */
  segments: TimingSegment[]
  /** `steps` 数组里 at 为有限数字的条目（按 at 排序）；没写时为空数组。 */
  steps: TimingStep[]
  /** 被忽略的非数字键（`segments` / `steps` 除外），便于工具给出提示。 */
  ignored: string[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** 解析时间表 JSON；`undefined` / `null` / 非对象都降级为空表。 */
export function parseTiming(raw: unknown): ParsedTiming {
  const anchors = new Map<string, number>(), segments: TimingSegment[] = [], steps: TimingStep[] = [], ignored: string[] = []
  if (!isRecord(raw)) return { anchors, segments, steps, ignored }
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) anchors.set(key, value)
    else if (key === "segments" && Array.isArray(value)) {
      for (const s of value) {
        if (isRecord(s) && typeof s.start === "number" && Number.isFinite(s.start) && typeof s.end === "number" && Number.isFinite(s.end))
          segments.push({ ...(typeof s.name === "string" ? { name: s.name } : {}), start: s.start, end: s.end, ...(typeof s.text === "string" ? { text: s.text } : {}) })
      }
    } else if (key === "steps" && Array.isArray(value)) {
      value.forEach((s, i) => {
        if (isRecord(s) && typeof s.at === "number" && Number.isFinite(s.at))
          steps.push({ id: typeof s.id === "string" ? s.id : "step" + (i + 1), at: s.at, ...(typeof s.title === "string" ? { title: s.title } : {}) })
      })
      steps.sort((a, b) => a.at - b.at)
    } else ignored.push(key)
  }
  return { anchors, segments, steps, ignored }
}

/** 只取锚点：`timingAnchors(json)` 等价于 `parseTiming(json).anchors`。 */
export function timingAnchors(raw: unknown): Map<string, number> {
  return parseTiming(raw).anchors
}

/**
 * 场景自然时长（秒）：所有节点 `锚点 + duration` 的最大值，与台词段 `end`、锚点本身取最大。
 * 用于播放页 / MP4 导出的默认时长；没有任何节点时返回 0。
 */
export function sceneDuration(project: { cues: readonly { at: string; duration: number }[] },
  anchors: ReadonlyMap<string, number>, segments: readonly TimingSegment[] = []): number {
  let end = 0
  for (const c of project.cues) {
    const t = anchors.get(c.at)
    if (t !== undefined && Number.isFinite(t)) end = Math.max(end, t + (Number.isFinite(c.duration) ? c.duration : 0))
  }
  for (const s of segments) end = Math.max(end, s.end)
  for (const t of anchors.values()) end = Math.max(end, t)
  return end
}
