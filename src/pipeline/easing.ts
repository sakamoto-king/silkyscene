/** Every cue ease is a pure function on p ∈ [0, 1] with f(1) = 1 exactly; f(0) = 0 except steps(n, start), which jumps at once like CSS. */
export type CubicBezier = { type: "cubicBezier"; x1: number; y1: number; x2: number; y2: number }
export type Spring = { type: "spring"; stiffness: number; damping: number; mass: number }
export type Steps = { type: "steps"; count: number; position: "start" | "end" }
export type NamedEase = "linear" | "sine-in-out" | "ease" | "ease-in" | "ease-out" | "ease-in-out"
export type Ease = NamedEase | CubicBezier | Spring | Steps

/** CSS named curves. sine-in-out stays the exact cosine for old documents; its CSS-style bezier is an approximation. */
export const NAMED_BEZIER: Record<NamedEase, readonly [number, number, number, number]> = {
  "linear": [0, 0, 1, 1], "ease": [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1], "sine-in-out": [0.37, 0, 0.63, 1],
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

export function isEase(value: unknown): value is Ease {
  if (typeof value === "string") return Object.hasOwn(NAMED_BEZIER, value)
  if (!object(value)) return false
  if (value.type === "cubicBezier") return [value.x1, value.y1, value.x2, value.y2].every(finite) &&
    (value.x1 as number) >= 0 && (value.x1 as number) <= 1 && (value.x2 as number) >= 0 && (value.x2 as number) <= 1
  if (value.type === "spring") return finite(value.stiffness) && value.stiffness > 0 && finite(value.mass) &&
    value.mass > 0 && finite(value.damping) && value.damping > 0
  if (value.type === "steps") return Number.isSafeInteger(value.count) && (value.count as number) > 0 &&
    (value.position === "start" || value.position === "end")
  return false
}

/**
 * CSS cubic-bezier on p ∈ [0, 1]: solve x(t) = p, then return y(t).
 * x(t) is monotonic, so [lo, hi] always brackets the root; Newton steps that leave the bracket fall back to bisection.
 * Stops on the parameter interval, not on the x residual: near a flat x(t) a tiny residual can still hide a large t error.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const x = (t: number) => ((ax * t + bx) * t + cx) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  const y = (t: number) => ((ay * t + by) * t + cy) * t
  return p => {
    if (p <= 0) return 0
    if (p >= 1) return 1
    let lo = 0, hi = 1, t = p
    for (let i = 0; i < 200 && hi - lo > 1e-15; i++) {
      const err = x(t) - p
      if (err === 0) break
      if (err < 0) lo = t; else hi = t
      const next = t - err / dx(t)
      t = next > lo && next < hi ? next : (lo + hi) / 2
    }
    return y(t)
  }
}

/** Damped spring from 0 to 1, starting at rest, sampled over the cue duration in seconds. */
function spring({ stiffness: k, damping: c, mass: m }: Spring, duration: number) {
  const w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m))
  return (p: number) => {
    if (p <= 0) return 0
    if (p >= 1) return 1
    const t = p * duration
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z)
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + z * w0 / wd * Math.sin(wd * t))
    }
    if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
    const s = Math.sqrt(z * z - 1), r1 = -w0 * (z - s), r2 = -w0 * (z + s)
    return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1)
  }
}

export function easeFunction(ease: Ease | undefined, duration: number): (p: number) => number {
  if (ease === undefined || ease === "linear") return p => Math.max(0, Math.min(1, p))
  if (ease === "sine-in-out") return p => p <= 0 ? 0 : p >= 1 ? 1 : (1 - Math.cos(Math.PI * p)) / 2
  if (typeof ease === "string") return cubicBezier(...NAMED_BEZIER[ease])
  if (ease.type === "cubicBezier") return cubicBezier(ease.x1, ease.y1, ease.x2, ease.y2)
  if (ease.type === "spring") return spring(ease, duration)
  const { count, position } = ease
  // CSS steps(): "start" jumps at p = 0 (steps(4, start)(0) = 0.25), "end" holds 0 until the first quarter.
  const jump = position === "start" ? 1 : 0
  return p => p >= 1 ? 1 : Math.min(count, Math.floor(Math.max(0, p) * count) + jump) / count
}

/** The numbers the inspector shows for a cue ease. */
export function easeNumbers(ease: Ease | undefined) {
  const e = ease ?? "linear"
  if (typeof e === "string") return { label: e, bezier: NAMED_BEZIER[e], exact: e !== "sine-in-out" }
  if (e.type === "cubicBezier") return { label: "cubicBezier", bezier: [e.x1, e.y1, e.x2, e.y2] as const, exact: true }
  return { label: e.type, bezier: undefined, exact: true, params: e }
}
