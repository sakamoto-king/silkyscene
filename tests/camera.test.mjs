// docs/04：相机弧线与延迟跟随
import assert from "node:assert/strict"
import test from "node:test"
import { compileTimeline, inspectFrame, parseProject, prepareProject, projectCameraTrace } from "../dist/index.js"
import { cameraMatrix } from "../dist/pipeline/resolve.js"

const base = (cues = [], cam = {}, extra = {}) => ({
  format: "silkyscene@1", canvas: { width: 1920, height: 1080, background: "#fff" },
  regions: [{ id: "main", x: 0, y: 0, width: 4, height: 2 }], elements: [], cues, ...extra,
  camera: { projection: "orthographic", target: { x: 0, y: 0, z: 0 }, yaw: { rad: Math.PI / 2, cycles: 0 },
    pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 }, distance: 10, focal: 1, zoom: 1, ...cam } })
const pan = (x, y, d = 1, o = {}, at = "a") => [
  { at, target: "camera", property: "target.x", to: x, duration: d, ease: "sine-in-out", ...o },
  { at, target: "camera", property: "target.y", to: y, duration: d, ease: "sine-in-out", ...o }]
const tl = (doc, anchors = { a: 0 }) => compileTimeline(parseProject(doc), new Map(Object.entries(anchors)))
const near = (a, b, eps = 1e-12) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= eps, a + " vs " + b))
const cam = (t, time) => { const c = t.stateAt(time).camera; return [c.x, c.y] }
const look = (t, time) => { const c = t.stateAt(time).camera.look; return [c.x, c.y] }
const sine = p => -(Math.cos(Math.PI * p) - 1) / 2

test("camera default: look target arcs upward (crane habit), midpoint offset = arc × distance exactly", () => {
  const t = tl(base(pan(0.6, 0, 1)))
  const m = t.cameraMoves[0]
  assert.equal(m.arc, 0.15); assert.equal(m.side, "left"); assert.equal(m.lag, 0)
  // e = 0.5 at p = 0.5 for sine-in-out: chord midpoint (0.3, 0) plus offset 0.15·0.6 straight up.
  near(look(t, 0.5), [0.3, 0.15 * 0.6]); near(cam(t, 0.5), [0.3, 0.15 * 0.6])
  near(cam(t, 1), [0.6, 0]); near(cam(t, 0), [0, 0])
  // Moving left, "up" is the right-hand side of travel.
  assert.equal(tl(base(pan(-0.6, 0, 1))).cameraMoves[0].side, "right")
  assert.ok(look(tl(base(pan(-0.6, 0, 1))), 0.5)[1] > 0)
})

test("default lag is 0: look and framing share the same window when lag is undeclared", () => {
  const t = tl(base(pan(0.6, 0, 1)))
  const m = t.cameraMoves[0]
  assert.equal(m.lag, 0)
  near([m.look.start, m.look.end, m.frame.start, m.frame.end], [0, 1, 0, 1])
  near(look(t, 0.5), cam(t, 0.5))
})

test("arc:0 + lag:0 (cue, camera or project level) is point-for-point the old straight tween", () => {
  const old = p => [0.6 * sine(p), -0.2 * sine(p)]
  for (const doc of [base(pan(0.6, -0.2, 1, { arc: 0, lag: 0 })), base(pan(0.6, -0.2), { arc: 0, lag: 0 }),
    base(pan(0.6, -0.2), { lag: 0 }, { motion: { arc: 0 } })]) {
    const t = tl(doc)
    assert.equal(t.cameraMoves.length, 0)
    for (let k = 0; k <= 40; k++) { assert.deepEqual(cam(t, k / 30), cam(t, k / 30)); near(cam(t, k / 30), old(Math.min(1, k / 30)), 1e-15); near(look(t, k / 30), cam(t, k / 30), 0) }
  }
})

test("lag: look runs over [s, s+D−lag], framing over [s+lag, s+D]; both converge exactly at the end", () => {
  const t = tl(base(pan(0.6, 0, 1, { lag: 0.25 })))
  const m = t.cameraMoves[0]
  near([m.look.start, m.look.end, m.frame.start, m.frame.end], [0, 0.75, 0.25, 1])
  near(cam(t, 0.25), [0, 0]); near(look(t, 0.75), [0.6, 0])
  near(cam(t, 0.625), look(t, 0.375))            // same curve, shifted by lag (same ease, same window length)
  near(cam(t, 1), [0.6, 0], 0); near(look(t, 1), [0.6, 0], 0); near(cam(t, 3), [0.6, 0], 0)
  // lag is capped at D/2 so the framing always arrives inside the cue.
  assert.equal(tl(base(pan(0.6, 0, 0.4, { lag: 1 }))).cameraMoves[0].lag, 0.2)
  // followEase only changes the framing.
  const lin = tl(base(pan(0.6, 0, 1, { lag: 0.25, arc: 0, followEase: "linear" })))
  near(cam(lin, 0.625), [0.3, 0]); near(look(lin, 0.375), [0.3, 0])
})

test("zoom lag is independent and defaults to 0", () => {
  const z = (o) => tl(base([{ at: "a", target: "camera", property: "zoom", to: 2, duration: 1, ...o }]))
  assert.equal(z({}).stateAt(0.5).camera.zoom, 1.5)
  const t = z({ lag: 0.5 })
  assert.equal(t.stateAt(0.5).camera.zoom, 1); assert.equal(t.stateAt(0.75).camera.zoom, 1.5); assert.equal(t.stateAt(1).camera.zoom, 2)
  assert.throws(() => parseProject(base([{ at: "a", target: "camera", property: "zoom", to: 2, duration: 1, arc: 0.1 }])), /arc/)
  assert.throws(() => parseProject(base([], { lag: -1 })), /lag/)
})

test("cameraAt, inspectFrame, projectCameraTrace and renderAt agree on every frame (< 1e-9)", async () => {
  const doc = base([...pan(0.5, 0.2, 1.2), ...pan(-0.3, 0.1, 0.9, { arcSide: "right", lag: 0.3 }, "b"),
    { at: "a", target: "camera", property: "zoom", to: 1.3, duration: 1.2, lag: 0.2 }])
  const anchors = new Map([["a", 0], ["b", 1.4]])
  const prepared = await prepareProject(doc, { baseUrl: "http://x/", anchors })
  const t = compileTimeline(parseProject(doc), anchors), trace = projectCameraTrace(prepared, 75)
  for (let f = 0; f <= 75; f++) {
    const m = prepared.renderAt(f / 30).camera, a = t.cameraAt(f / 30), i = inspectFrame(prepared, f).camera.matrix
    for (let k = 0; k < 6; k++) for (const v of [a[k], i[k], trace.frames[f].camera.matrix[k]]) assert.ok(Math.abs(v - m[k]) < 1e-9)
  }
  const moves = inspectFrame(prepared, 10).camera.moves
  assert.equal(moves.length, 2); assert.equal(moves[0].paths.look.length, 33)
  near(moves[1].paths.frame[32], [-0.3 * 1080 + 960, 540 - 0.1 * 1080], 1e-6)
})

test("maxOvershoot: an arc that pushes the frame past the regions fails at prepare with its time; straight never checked", async () => {
  const tight = { regions: [{ id: "main", x: 0, y: 0, width: 1920 / 1080 + 0.6, height: 1 }] }
  const go = (o, cam = {}) => prepareProject(base(pan(0.6, 0, 1, o), cam, tight), { baseUrl: "http://x/", anchors: new Map([["a", 0]]) })
  await assert.rejects(go({ arc: 0.3 }), /s：相机弧线在 0\.\d{3} s 让取景框比直线多越出区域/)
  await go({ arc: 0.3 }, { maxOvershoot: 500 })
  await go({ arc: 0, lag: 0 })
  await go({ arc: 0.3, arcSide: "left" }, { maxOvershoot: 1e9 })
})

test("takeover: a new pan starts from where the framing and the look target actually are", () => {
  const t = tl(base([...pan(0.6, 0, 1), ...pan(0, 0.3, 1, {}, "b")]), { a: 0, b: 0.5 })
  const m = t.cameraMoves[1]
  near(m.frame.from, cam(t, 0.5)); near(m.look.from, look(t, 0.5))
  near(cam(t, 1.5), [0, 0.3], 0)
})
