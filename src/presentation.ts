/**
 * 现场步进演示（present.html）：同一份场景 + 时间表，按「停靠拍」一步步播放。
 *
 * 时间表里的步点来源（优先级从高到低）：
 *   1. `steps: [{ id, at, title? }]`（显式停靠拍）；
 *   2. `segments` 每段的 start（口播段落即一页）；
 *   3. 所有锚点时间（去重排序）。
 * 场景自然结束时间若晚于最后一个步点，会追加一个「结束」步点，最后一下右键把尾巴播完。
 *
 * 控制器是纯逻辑（无 DOM / 定时器）：页面每帧调用 tick(dt)，用返回的 time 去 renderAt(time)。
 *  - next()：从当前时间以 1× 速度正放到下一个步点并停住；过渡中再按 = 先跳到目标步点，再继续下一步；
 *  - prev()：以 1× 速度倒放回上一个步点（倒放同速）；倒放途中再按同理；
 *  - goto(i)：直接跳到第 i 步（无过渡）。
 */
import type { TimingSegment } from "./pipeline/timing.js"

export interface DeckStep { id: string; at: number; title?: string }
export interface DeckState {
  /** 当前时间（秒）。 */
  time: number
  /** 已停靠或最近经过的步点序号。 */
  index: number
  /** 过渡中的目标步点；静止时为 undefined。 */
  target?: number
  steps: readonly DeckStep[]
}
const EPS = 1e-6

/** 从 parseTiming 的结果推出步点（见文件头的优先级）。 */
export function deckSteps(timing: { anchors: ReadonlyMap<string, number>; segments?: readonly TimingSegment[]; steps?: readonly DeckStep[] },
  duration = 0): DeckStep[] {
  let steps: DeckStep[]
  if (timing.steps?.length) steps = timing.steps.map(s => ({ ...s }))
  else if (timing.segments?.length) steps = timing.segments.map((s, i) => ({ id: s.name ?? "s" + (i + 1), at: s.start, ...(s.text ? { title: s.text } : {}) }))
  else steps = [...new Set([0, ...timing.anchors.values()].map(t => Math.round(t * 1e6) / 1e6))].map((at, i) => ({ id: "a" + i, at }))
  steps.sort((a, b) => a.at - b.at)
  steps = steps.filter((s, i) => i === 0 || s.at - steps[i - 1]!.at > 1e-3)
  if (!steps.length) steps = [{ id: "start", at: 0 }]
  if (duration > steps[steps.length - 1]!.at + 0.05) steps.push({ id: "end", at: duration, title: "结束" })
  return steps
}

export function createDeckController(steps: readonly DeckStep[], options: { start?: number; rate?: number } = {}) {
  if (!steps.length) throw new Error("createDeckController：至少需要一个步点")
  const rate = options.rate ?? 1
  let index = Math.max(0, Math.min(steps.length - 1, options.start ?? 0))
  let time = steps[index]!.at
  let target: number | undefined
  const listeners = new Set<(s: DeckState) => void>()
  const state = (): DeckState => ({ time, index, ...(target !== undefined ? { target } : {}), steps })
  const emit = () => { const s = state(); for (const f of listeners) f(s) }
  const settle = () => { if (target !== undefined) { index = target; time = steps[target]!.at; target = undefined } }
  const move = (to: number) => {
    to = Math.max(0, Math.min(steps.length - 1, to))
    if (Math.abs(steps[to]!.at - time) < EPS) { index = to; target = undefined } else target = to
    emit()
    return state()
  }
  const api = {
    get state() { return state() },
    get moving() { return target !== undefined },
    next() {
      if (target !== undefined && steps[target]!.at > time) settle()
      else if (target !== undefined) { target = undefined }
      const i = steps.findIndex(s => s.at > time + EPS)
      return i < 0 ? (emit(), state()) : move(i)
    },
    prev() {
      if (target !== undefined && steps[target]!.at < time) settle()
      else if (target !== undefined) { target = undefined }
      let i = -1
      for (let k = steps.length - 1; k >= 0; k--) if (steps[k]!.at < time - EPS) { i = k; break }
      return i < 0 ? (emit(), state()) : move(i)
    },
    goto(i: number) {
      target = undefined
      index = Math.max(0, Math.min(steps.length - 1, i)); time = steps[index]!.at
      emit(); return state()
    },
    /** 推进 dt 秒（墙钟），返回当前状态。到达目标步点时精确停在 steps[target].at。 */
    tick(dt: number) {
      if (target === undefined || !(dt > 0)) return state()
      const goal = steps[target]!.at, dir = Math.sign(goal - time)
      time += dir * dt * rate
      if ((dir > 0 && time >= goal - EPS) || (dir < 0 && time <= goal + EPS)) settle()
      else {
        // index = 最近经过的步点
        for (let k = steps.length - 1; k >= 0; k--) if (steps[k]!.at <= time + EPS) { index = k; break }
      }
      emit()
      return state()
    },
    subscribe(f: (s: DeckState) => void) { listeners.add(f); return () => { listeners.delete(f) } },
  }
  return api
}
export type DeckController = ReturnType<typeof createDeckController>

export type DeckAction = "next" | "prev" | "first" | "last" | "fullscreen" | "toggleHud" | { goto: number }
/** 键盘约定：空格 / → / ↓ / PageDown / Enter 下一步；← / ↑ / PageUp / Backspace 上一步；Home / End；1–9 跳步；F 全屏；H 隐藏提示条。 */
export function deckKeyAction(key: string, shift = false): DeckAction | undefined {
  if (key === " " || key === "Spacebar") return shift ? "prev" : "next"
  if (["ArrowRight", "ArrowDown", "PageDown", "Enter"].includes(key)) return "next"
  if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(key)) return "prev"
  if (key === "Home") return "first"
  if (key === "End") return "last"
  if (key === "f" || key === "F") return "fullscreen"
  if (key === "h" || key === "H") return "toggleHud"
  if (/^[1-9]$/.test(key)) return { goto: Number(key) - 1 }
  return undefined
}
