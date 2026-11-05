/** docs/02: CSS colors that can be tweened. RGBA channels: r, g, b 0..255, a 0..1. */
export type Rgba = readonly [number, number, number, number]

const NAMED: Record<string, Rgba> = { transparent: [0, 0, 0, 0], black: [0, 0, 0, 1], white: [255, 255, 255, 1] }

/** #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba() and transparent / black / white. Anything else: undefined. */
export function parseColor(value: string): Rgba | undefined {
  const s = value.trim().toLowerCase()
  if (Object.hasOwn(NAMED, s)) return NAMED[s]
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
  if (m) {
    let h = m[1]!
    if (h.length <= 4) h = [...h].map(c => c + c).join("")
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s)
  if (m) {
    const c = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] as const
    if (c.slice(0, 3).every(v => v <= 255) && c[3] <= 1) return c
  }
  return undefined
}

/**
 * Straight sRGB mix with premultiplied alpha, so a fade from "transparent" does not darken through black.
 * e = 0 / 1 return the inputs verbatim (an untouched frame keeps its exact CSS string).
 */
export function mixColor(from: string, to: string, e: number): string {
  if (e <= 0) return from
  if (e >= 1) return to
  const a = parseColor(from), b = parseColor(to)
  if (!a || !b) return e < 0.5 ? from : to
  const alpha = a[3] + (b[3] - a[3]) * e
  const ch = (i: number) => alpha === 0 ? 0 : (a[i]! * a[3] + (b[i]! * b[3] - a[i]! * a[3]) * e) / alpha
  const r = (v: number) => Math.round(v * 1000) / 1000
  return "rgba(" + r(ch(0)) + "," + r(ch(1)) + "," + r(ch(2)) + "," + r(alpha) + ")"
}
