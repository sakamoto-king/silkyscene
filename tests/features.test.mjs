import assert from "node:assert/strict"
import test from "node:test"
import { compileTimeline, parseProject } from "../dist/index.js"
import { resolveProject } from "../dist/pipeline/resolve.js"
import { pathSampler } from "../dist/pipeline/timeline.js"

const U = 1080
const base = (elements, cues = [], extra = {}) => ({
  format: "silkyscene@1", canvas: { width: 1920, height: 1080, background: "#fff", ...extra },
  regions: [{ id: "main", x: 0, y: 0, width: 1, height: 1 }], elements, cues,
  camera: { projection: "orthographic", target: { x: 0, y: 0, z: 0 }, yaw: { rad: Math.PI / 2, cycles: 0 },
    pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 }, distance: 10, focal: 1, zoom: 1 } })
const card = { id: "card", kind: "group", layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.5, height: 0.5 } }
const child = { id: "dot", kind: "rect", fill: "#000", layout: { region: "card", x: "-50%", y: "50%", anchor: [-1, 1], width: "10%", height: "10%" } }
const near = (a, b, eps = 1e-9) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, a + " vs " + b))
const run = (doc, anchors, t, measured = new Map()) => {
  const d = parseProject(doc), tl = compileTimeline(d, new Map(Object.entries(anchors)))
  return resolveProject(d, measured, tl.stateAt(t))
}

test("schema rejects bad new fields strictly", () => {
  const bad = [
    base([{ ...card, layout: { ...card.layout, width: undefined } }]),
    base([card, child], [{ at: "a", target: "dot", property: "x", to: 0.1, duration: 1 }]),            // unit kind differs from "%"
    base([card], [{ at: "a", target: "card", property: "opacity", to: 1, duration: 1, ease: { type: "cubicBezier", x1: 1.2, y1: 0, x2: 0, y2: 1 } }]),
    base([card], [{ at: "a", target: "card", property: "opacity", to: 1, duration: 1, ease: { type: "spring", stiffness: 0, damping: 1, mass: 1 } }]),
    base([card], [{ at: "a", target: "card", property: "motionPath", duration: 1, path: { curve: "cubic", points: [[0, 0], [1, 1]] } }]),
    base([{ id: "d", kind: "dots", spacing: 0.01, radius: 0.006, color: "#000", layout: card.layout }]),
    base([card], [], { worldMask: { stops: [{ at: "10%", alpha: 1 }, { at: "-10%", alpha: 0 }] } }),
    base([{ id: "l", kind: "rect", fill: "#000", layout: { ...child.layout, region: "nope" } }]),
  ]
  for (const doc of bad) assert.throws(() => parseProject(doc))
  assert.doesNotThrow(() => parseProject(base([card, child], [
    { at: "a", target: "card", property: "y", to: 0.05, duration: 1, ease: { type: "cubicBezier", x1: 0.3, y1: 0, x2: 0, y2: 1 } },
    { at: "a", target: "dot", property: "scale", to: 2, duration: 1, ease: { type: "steps", count: 3, position: "end" } }],
    { worldMask: { stops: [{ at: "-50%", alpha: 0 }, { at: "50%", alpha: 1 }] } })))
})

test("a group cue moves, fades and scales every child through the same resolve", () => {
  const doc = base([card, child], [
    { at: "a", target: "card", property: "y", to: 0.1, duration: 1 },
    { at: "a", target: "card", property: "opacity", to: 0.5, duration: 1 },
    { at: "b", target: "card", property: "scale", to: 2, duration: 0 }])
  const before = run(doc, { a: 0, b: 5 }, 0), after = run(doc, { a: 0, b: 5 }, 1)
  near(Object.values(before.boxes.get("dot")), [960 - 270, 540 - 270, 54, 54])
  near(Object.values(after.boxes.get("dot")), [960 - 270, 540 - 270 - 0.1 * U, 54, 54])
  assert.equal(after.scene.primitives[1].opacity, 0.5)
  const scaled = run(doc, { a: 0, b: 5 }, 5).scene.primitives[1]
  near(scaled.transform, [2, 0, 0, 2, -960, -(540 - 0.1 * U)])   // about the group's anchor (its center)
})

test("width cue grows a bar from its anchor, scaleX does the same visually", () => {
  const bar = { id: "bar", kind: "rect", fill: "#000", layout: { region: "main", x: "-50%", y: 0, anchor: [-1, 0], width: "1%", height: 0.01 } }
  const doc = base([bar], [{ at: "a", target: "bar", property: "width", to: "100%", duration: 2, ease: "ease-in-out" }])
  near(Object.values(run(doc, { a: 0 }, 1).boxes.get("bar")), [420, 540 - 5.4, 1080 * 0.505, 10.8], 1e-6)
  const growBar = { ...bar, layout: { ...bar.layout, width: "100%" }, scaleX: 0 }
  const s = run(base([growBar], [{ at: "a", target: "bar", property: "scaleX", to: 1, duration: 1 }]), { a: 0 }, 0.5)
  near(s.scene.primitives[0].transform, [0.5, 0, 0, 1, 210, 0])
})

test("screen elements ignore the camera; padded text box is measured text plus padding", () => {
  const label = { id: "hud", kind: "text", text: "100%", fontSize: 0.02, color: "#000", align: "left",
    padding: [0.01, 0.005], layout: { region: "screen", x: "50%", y: "50%", anchor: [1, 1] } }
  const doc = base([label])
  doc.camera.zoom = 2
  const r = run(doc, {}, 0, new Map([["hud", { width: 40, height: 26 }]]))
  near(Object.values(r.boxes.get("hud")), [1920 - 40 - 21.6, 0, 40 + 21.6, 26 + 10.8])
  assert.equal(r.scene.primitives[0].layer, "screen")
})

test("zoom-bound text follows the camera zoom", () => {
  const z = { id: "z", kind: "text", text: "", bind: "camera.zoom%", fontSize: 0.02, color: "#000", align: "right",
    layout: { region: "screen", x: 0, y: 0, anchor: [0, 0], width: 0.1, height: 0.04 } }
  const doc = base([z], [{ at: "a", target: "camera", property: "zoom", to: 0.889, duration: 1 }])
  assert.equal(run(doc, { a: 0 }, 1, new Map([["z", { width: 50, height: 30 }]])).scene.primitives[0].text, "89%")
})

test("motionPath moves at constant speed along the path, eased in time", () => {
  const at = pathSampler({ curve: "linear", points: [[0, 0], [1, 0], [1, 1]] })
  near(at(0.25), [0.5, 0]); near(at(0.75), [1, 0.5]); near(at(1), [1, 1])
  const q = pathSampler({ curve: "quadratic", points: [[0, 0], [0.5, 1], [1, 0]] })
  near(q(0.5), [0.5, 0.5], 1e-9)
  const cur = { id: "cur", kind: "rect", fill: "#000", layout: { region: "main", x: 0, y: 0, anchor: [-1, 1], width: 0.02, height: 0.02 } }
  const doc = base([cur], [{ at: "a", target: "cur", property: "motionPath", duration: 1, ease: "ease-in",
    path: { curve: "linear", points: [[0, 0], [0.2, 0]] } }])
  assert.ok(run(doc, { a: 0 }, 0.5).boxes.get("cur").x - 960 < 0.1 * U)   // ease-in is behind linear halfway
  near([run(doc, { a: 0 }, 1).boxes.get("cur").x], [960 + 0.2 * U])
})

test("a long pan can dip its zoom: camera tracks are independent, so zoom can use two cues inside one pan", () => {
  const doc = base([], [
    { at: "a", target: "camera", property: "target.x", to: 1, duration: 4, ease: { type: "cubicBezier", x1: 0.7, y1: 0, x2: 0.3, y2: 1 }, arc: 0, lag: 0 },
    { at: "a", target: "camera", property: "zoom", to: 0.7, duration: 2, ease: "sine-in-out", interpolation: "log" },
    { at: "m", target: "camera", property: "zoom", to: 1, duration: 2, ease: "sine-in-out", interpolation: "log" }])
  const tl = compileTimeline(parseProject(doc), new Map([["a", 0], ["m", 2]]))
  near([tl.stateAt(2).camera.zoom, tl.stateAt(2).camera.x, tl.stateAt(4).camera.zoom], [0.7, 0.5, 1])
})

test("worldMask becomes top-down screen stops", () => {
  const doc = base([], [], { worldMask: { stops: [{ at: "-50%", alpha: 0 }, { at: "40%", alpha: 1 }, { at: "50%", alpha: 0 }] } })
  near(run(doc, {}, 0).scene.worldMask.flat(), [0, 0, 0.1, 1, 1, 0])
})

// ---- 复审 F01 / F03 / F05 / F06 回归 ----
import { prepareProject } from "../dist/index.js"
const rect = (id, layout = {}) => ({ id, kind: "rect", fill: "#000", layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.1, height: 0.1, ...layout } })

test("F01: prepare checks every frame, not only cue start/end, and names the time", async () => {
  const detour = base([rect("r")], [{ at: "a", target: "r", property: "motionPath", duration: 1,
    path: { curve: "linear", points: [[0, 0], [0.75, 0], [0, 0]] } }])
  await assert.rejects(prepareProject(detour, { baseUrl: "http://x/", anchors: new Map([["a", 0]]) }), /s：r 超出所属区域/)
})

test("F01: a zoom ease that overshoots to <= 0 is a clear error at prepare, log interpolation stays positive", async () => {
  const zoom = extra => base([rect("r")], [{ at: "a", target: "camera", property: "zoom", to: 2, duration: 1,
    ease: { type: "cubicBezier", x1: 0.3, y1: -1.5, x2: 0.7, y2: -1.5 }, ...extra }])
  await assert.rejects(prepareProject(zoom({}), { baseUrl: "http://x/", anchors: new Map([["a", 0]]) }), /相机 zoom .*须为正数/)
  const ok = await prepareProject(zoom({ interpolation: "log" }), { baseUrl: "http://x/", anchors: new Map([["a", 0]]) })
  assert.ok(ok.renderAt(0.5).camera[0] > 0)
})

test("F03: motionPath takes over from the evaluated x/y at its trigger time", () => {
  const doc = base([rect("r")], [{ at: "a", target: "r", property: "x", to: 0.2, duration: 1 },
    { at: "b", target: "r", property: "motionPath", duration: 1, path: { curve: "linear", points: [[0, 0], [0, 0.2]] } }])
  const d = parseProject(doc), tl = compileTimeline(d, new Map([["a", 0], ["b", 0.5]]))
  assert.ok(Math.abs(tl.stateAt(0.5).elements.get("r").x - 0.1) < 1e-12)       // no jump back to the declared first point
  const end = tl.stateAt(1.5).elements.get("r"); assert.deepEqual([end.x, end.y], [0, 0.2])
})

test("F05: unknown fields and cue properties that do not apply to the target are rejected", () => {
  const bad = [
    base([{ ...rect("r"), container: "missing" }]),
    base([{ ...rect("r"), layout: { ...rect("r").layout, z: 1 } }]),
    base([rect("r")], [{ at: "a", target: "r", property: "zoom", to: 2, duration: 1 }]),
    base([rect("r")], [{ at: "a", target: "r", property: "target.x", to: 2, duration: 1 }]),
    base([rect("r")], [{ at: "a", target: "camera", property: "opacity", to: 0, duration: 1 }]),
    base([rect("r")], [{ at: "a", target: "r", property: "opacity", to: 0, duration: 1, path: { curve: "linear", points: [[0, 0], [1, 1]] } }]),
    { ...base([rect("r")]), extra: true },
  ]
  for (const doc of bad) assert.throws(() => parseProject(doc))
})

test("F06: a line between a screen element and a world element follows each end's own layer", () => {
  const doc = base([rect("s", { region: "screen" }), rect("w"),
    { id: "ln", kind: "line", from: { element: "s", at: [0, 0] }, to: { element: "w", at: [0, 0] }, color: "#000", width: 0.002 }],
    [{ at: "a", target: "camera", property: "target.x", to: 0.1, duration: 0 }])
  const ln = run(doc, { a: 0 }, 1).scene.primitives.find(p => p.id === "ln")
  assert.equal(ln.layer, "screen")
  near([ln.x1, ln.y1, ln.x2, ln.y2], [960, 540, 960 - 0.1 * U, 540])
})

test("F04: a text inside a shrinking group is re-checked at its narrowest width", async () => {
  const { narrowestTextWidths, checkTimes } = await import("../dist/pipeline/render.js")
  const g = { id: "g", kind: "group", layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.6, height: 0.5 } }
  const t = { id: "t", kind: "text", text: "x", fontSize: 0.025, color: "#000", align: "left",
    layout: { region: "g", x: 0, y: 0, anchor: [0, 0], width: "100%", height: 0.1 } }
  const d = parseProject(base([g, t], [{ at: "a", target: "g", property: "width", to: 0.22, duration: 1 }]))
  const tl = compileTimeline(d, new Map([["a", 0]]))
  const fits = new Map([["t", { width: 600, height: 60, textMetrics: new Map([["x", { width: 600, height: 60 }]]) }]])
  const narrow = narrowestTextWidths(d, fits, checkTimes(tl.boundaries, 30), tl.stateAt)
  assert.ok(Math.abs(narrow.get("t") - 0.22 * U) < 1e-9)
  // 108px fixed height: fine at the declared width, overflows once the narrow-width measurement (281px) is known.
  assert.doesNotThrow(() => resolveProject(d, fits, tl.stateAt(1)))
  const squeezed = new Map([["t", { ...fits.get("t"), narrowHeight: 281 }]])
  assert.throws(() => resolveProject(d, squeezed, tl.stateAt(1)), /超出固定高度/)
})

test("element id must not collide with a region id", () => {
  const doc = {
    format: "silkyscene@1",
    canvas: { width: 1920, height: 1080, background: "#fff" },
    regions: [{ id: "card", x: 0, y: 0, width: 1, height: 1 }],
    elements: [{
      id: "card", kind: "rect",
      layout: { region: "card", x: "0%", y: "0%", width: "50%", height: "50%", anchor: [0, 0] },
      fill: "#000",
    }],
    camera: {
      projection: "orthographic",
      target: { x: 0, y: 0, z: 0 },
      yaw: { rad: Math.PI / 2, cycles: 0 },
      pitch: { rad: -Math.PI / 2, cycles: 0 },
      roll: { rad: 0, cycles: 0 },
      distance: 10, focal: 1, zoom: 1,
    },
    cues: [],
  }
  assert.throws(() => parseProject(doc), /全局唯一|与已有名称冲突|重名/)
})

