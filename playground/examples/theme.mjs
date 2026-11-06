// 官方样片共用的中性主题：石板灰墨色 + 工程蓝 / 青点睛，暖白纸底。所有长度单位为 u（1 u = 1080 设计像素）。
import { px } from "../../dist/index.js"
export { px }
export const C = {
  paper: "#FAFAF8", surface: "#FFFFFF", sunken: "#F1F3F6", line: "#DCE1E8", lineSoft: "#E8ECF1",
  ink: "#0F172A", ink2: "#334155", muted: "#64748B", faint: "#94A3B8",
  blue: "#2563EB", blueDeep: "#1D4ED8", cyan: "#0EA5E9", blueSoft: "#EFF6FF", blueLine: "#BFDBFE",
  amber: "#D97706", amberSoft: "#FFF7ED", green: "#059669", greenSoft: "#ECFDF5",
}
export const F = {
  display: "Host Grotesk, Noto Sans SC, sans-serif",
  ui: "Noto Sans SC, Instrument Sans, sans-serif",
  mono: "Geist Mono, ui-monospace, monospace",
}
const bz = (x1, y1, x2, y2) => ({ type: "cubicBezier", x1, y1, x2, y2 })
/** 缓动：OUT 出场落定，IN_OUT 移镜 / 重排，SOFT 轻推拉呼吸，PRESS 按压。 */
export const E = {
  OUT: bz(0.22, 1, 0.36, 1), IN_OUT: bz(0.65, 0, 0.35, 1), SOFT: bz(0.45, 0, 0.55, 1), PRESS: bz(0.4, 0, 1, 1),
  SPRING: { type: "spring", stiffness: 170, damping: 18, mass: 1 },
  SPRING_SOFT: { type: "spring", stiffness: 120, damping: 20, mass: 1 },
}
export const SHADOW = { x: 0, y: px(10), blur: px(32), spread: px(-6), color: "rgba(15,23,42,0.14)" }
export const SHADOW_SM = { x: 0, y: px(4), blur: px(14), spread: px(-2), color: "rgba(15,23,42,0.10)" }
/** 锚点命名：同一时刻的节点共享锚点 `t08.00`，检查器里拖一个锚点就整拍平移。 */
export function keyer(b) {
  return (t, target, property, duration, to, opts) => {
    const at = Math.round(t * 100) / 100 // 对齐到 10 ms，同名锚点必然同一时刻
    return b.cue("t" + at.toFixed(2).padStart(5, "0"), at, target, property, duration, to, opts)
  }
}
/** 水平贝塞尔连线（与 line.curve: "horizontal" 同一公式）的控制点，供 motionPath 让脉冲精确沿线走。 */
export function horizontalCurve(a, b, ratio = 0.5, min = px(33), max = px(240)) {
  const h = Math.max(min, Math.min(max, (b[0] - a[0]) * ratio))
  return [a, [a[0] + h, a[1]], [b[0] - h, b[1]], b]
}
