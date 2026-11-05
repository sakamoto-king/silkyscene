import assert from "node:assert/strict"
import test from "node:test"
import { cubicBezier, easeFunction, easeNumbers, NAMED_BEZIER } from "../dist/index.js"

// Reference: the CSS Easing spec's definition, solved independently by plain bisection on x(t) (200 steps).
function reference(x1, y1, x2, y2, p) {
  const B = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3
  let lo = 0, hi = 1
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (B(m, x1, x2) < p) lo = m; else hi = m }
  return B((lo + hi) / 2, y1, y2)
}
const curves = [[0.3, 0, 0, 1], [0.7, 0, 0.3, 1], [0.25, 0.1, 0.25, 1], [0.42, 0, 1, 1], [0, 0, 0.58, 1],
  [0.34, 1.56, 0.64, 1], [0.68, -0.6, 0.32, 1.6], [0, 0, 1, 1], [0.9, 0, 0.1, 1], [0.01, 0.99, 0.99, 0.01]]
const ps = Array.from({ length: 101 }, (_, i) => i / 100).concat([1e-6, 0.123456, 0.999999])

test("cubic-bezier matches the CSS definition within 1e-6 and hits 0/1 exactly", () => {
  for (const c of curves) {
    const f = cubicBezier(...c)
    assert.equal(f(0), 0); assert.equal(f(1), 1)
    for (const p of ps) assert.ok(Math.abs(f(p) - reference(...c, p)) < 1e-6, c + " @ " + p)
  }
})

test("CSS ease(0.5) has the well-known value", () => {
  assert.ok(Math.abs(cubicBezier(...NAMED_BEZIER.ease)(0.5) - 0.8024033877399112) < 1e-6)
})

test("named presets map to their CSS numbers; sine-in-out stays exact cosine", () => {
  assert.deepEqual(easeNumbers("ease-out").bezier, [0, 0, 0.58, 1])
  assert.equal(easeNumbers("sine-in-out").exact, false)
  const sine = easeFunction("sine-in-out", 1)
  assert.equal(sine(0.25), (1 - Math.cos(Math.PI / 4)) / 2)
  assert.deepEqual(easeNumbers({ type: "cubicBezier", x1: 0.3, y1: 0, x2: 0, y2: 1 }).bezier, [0.3, 0, 0, 1])
})

test("overshooting y produces values outside 0..1", () => {
  const f = easeFunction({ type: "cubicBezier", x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 }, 1)
  assert.ok(Math.max(...ps.map(f)) > 1.05)
})

test("spring ends exactly at 1, overshoots when underdamped, not when overdamped", () => {
  const under = easeFunction({ type: "spring", stiffness: 170, damping: 10, mass: 1 }, 1)
  const over = easeFunction({ type: "spring", stiffness: 100, damping: 40, mass: 1 }, 1)
  assert.equal(under(0), 0); assert.equal(under(1), 1); assert.equal(over(1), 1)
  assert.ok(Math.max(...ps.slice(1, -3).map(under)) > 1)
  assert.ok(ps.slice(0, 100).every(p => over(p) <= 1))
})

test("steps follow CSS jump-start / jump-end", () => {
  const end = easeFunction({ type: "steps", count: 4, position: "end" }, 1)
  const start = easeFunction({ type: "steps", count: 4, position: "start" }, 1)
  assert.deepEqual([0.1, 0.3, 0.6, 0.9].map(end), [0, 0.25, 0.5, 0.75])
  assert.deepEqual([0.1, 0.3, 0.6, 0.9].map(start), [0.25, 0.5, 0.75, 1])
  assert.equal(end(1), 1); assert.equal(end(0), 0)
  // Chromium: element.animate(..., { easing: "steps(4, start)", fill: "both" }) at currentTime 0 reads 0.25.
  assert.equal(start(0), 0.25); assert.equal(start(0.25), 0.5); assert.equal(start(1), 1)
})

test("cubic-bezier stays exact near a flat x(t): (1,0,0,1) around its midpoint singularity", () => {
  // x(t) = 0.5 + 4(t - 0.5)^3 and y(t) = t²(3 - 2t) for this curve, so the exact answer is closed-form.
  const f = cubicBezier(1, 0, 0, 1)
  const exact = p => { const t = 0.5 + Math.cbrt((p - 0.5) / 4); return t * t * (3 - 2 * t) }
  for (const d of [9e-13, -9e-13, 1e-10, 1e-8, 1e-6, 1e-4, 1e-2, 0.2, -0.3, 0.49])
    assert.ok(Math.abs(f(0.5 + d) - exact(0.5 + d)) < 1e-6, "p = 0.5 + " + d + ": " + f(0.5 + d) + " vs " + exact(0.5 + d))
})

test("ease names are own keys only, spring needs damping > 0, ease objects reject unknown fields", async () => {
  const { parseProject } = await import("../dist/index.js")
  const doc = ease => ({ format: "silkyscene@1", canvas: { width: 1920, height: 1080, background: "#fff" },
    regions: [{ id: "main", x: 0, y: 0, width: 1, height: 1 }],
    elements: [{ id: "r", kind: "rect", fill: "#000", layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.1, height: 0.1 } }],
    camera: { projection: "orthographic", target: { x: 0, y: 0, z: 0 }, yaw: { rad: Math.PI / 2, cycles: 0 },
      pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 }, distance: 10, focal: 1, zoom: 1 },
    cues: [{ at: "a", target: "r", property: "opacity", to: 0, duration: 1, ease }] })
  for (const bad of ["constructor", "toString", "__proto__", { type: "spring", stiffness: 100, damping: 0, mass: 1 },
    { type: "cubicBezier", x1: 0, y1: 0, x2: 1, y2: 1, extra: 1 }]) assert.throws(() => parseProject(doc(bad)), String(bad))
  assert.doesNotThrow(() => parseProject(doc({ type: "spring", stiffness: 100, damping: 0.01, mass: 1 })))
})
