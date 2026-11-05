import { easeFunction, easeNumbers } from "../src/index.js"
import type { Cue, Ease } from "../src/index.js"

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString()

/** A small curve plot: x = time progress, y = eased value. Bezier handles are drawn when the ease is a bezier. */
export function curveSvg(ease: Ease | undefined, duration: number, size = 96) {
  const pad = 14, w = size, h = size, f = easeFunction(ease, duration || 1)
  const pts = Array.from({ length: 65 }, (_, i) => i / 64).map(p => [p, f(p)] as const)
  const lo = Math.min(0, ...pts.map(p => p[1])), hi = Math.max(1, ...pts.map(p => p[1]))
  const X = (x: number) => pad + x * (w - 2 * pad), Y = (y: number) => h - pad - (y - lo) / (hi - lo) * (h - 2 * pad)
  const n = easeNumbers(ease)
  const handles = n.bezier ? '<path class="h" d="M' + X(0) + "," + Y(0) + " L" + X(n.bezier[0]) + "," + Y(n.bezier[1]) +
    " M" + X(1) + "," + Y(1) + " L" + X(n.bezier[2]) + "," + Y(n.bezier[3]) + '"/>' +
    '<circle class="k" cx="' + X(n.bezier[0]) + '" cy="' + Y(n.bezier[1]) + '" r="3"/><circle class="k" cx="' +
    X(n.bezier[2]) + '" cy="' + Y(n.bezier[3]) + '" r="3"/>' : ""
  return '<svg class="ease-curve" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' +
    '<rect class="b" x="' + X(0) + '" y="' + Y(1) + '" width="' + (X(1) - X(0)) + '" height="' + (Y(0) - Y(1)) + '"/>' +
    handles + '<polyline class="c" points="' + pts.map(([x, y]) => X(x).toFixed(1) + "," + Y(y).toFixed(1)).join(" ") + '"/></svg>'
}

/** Text form of the ease numbers, e.g. "cubic-bezier(0.3, 0, 0, 1)". */
export function easeLabel(ease: Ease | undefined) {
  const n = easeNumbers(ease)
  if (n.bezier) return (typeof ease === "string" ? ease + " = " : "") + (n.exact ? "" : "≈ ") +
    "cubic-bezier(" + n.bezier.map(f3).join(", ") + ")"
  return n.label + " " + JSON.stringify(n.params)
}

/** Editable x1, y1, x2, y2 for a cue; named eases are shown with their numbers and become cubicBezier on edit. */
export function easeFields(cue: Cue, index: number) {
  if (!("ease" in cue) && !("to" in cue && typeof cue.to === "number") && cue.property !== "motionPath" &&
    !["x", "y", "width", "height"].includes(cue.property)) return ""
  const ease = "ease" in cue ? cue.ease : undefined
  const n = easeNumbers(ease)
  const values = n.bezier ?? [0, 0, 1, 1]
  return '<div class="ease-edit">' + curveSvg(ease, cue.duration) + '<div class="ease-nums">' +
    ["x1", "y1", "x2", "y2"].map((k, i) => '<label>' + k + '<input class="field mono" data-field="cues.' + index +
      ".ease." + k + '" value="' + f3(values[i]!) + '"' + (n.bezier ? "" : " disabled") + "></label>").join("") +
    '<div class="src">' + easeLabel(ease) + '</div><button class="btn" data-copy-cue="' + index + '">复制节点 JSON</button></div></div>'
}
