// docs/03：空对象、连线 layer、motion 角色与默认弧线
import assert from "node:assert/strict"
import test from "node:test"
import { compileTimeline, cubicBezier, parseProject } from "../dist/index.js"
import { resolveProject } from "../dist/pipeline/resolve.js"

const U = 1080
const base = (elements, cues = [], extra = {}) => ({
  format: "silkyscene@1", canvas: { width: 1920, height: 1080, background: "#fff" },
  regions: [{ id: "main", x: 0, y: 0, width: 1.6, height: 1 }], elements, cues, ...extra,
  camera: { projection: "orthographic", target: { x: 0, y: 0, z: 0 }, yaw: { rad: Math.PI / 2, cycles: 0 },
    pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 }, distance: 10, focal: 1, zoom: 1 } })
const rect = (id, x = 0, y = 0, o = {}) => ({ id, kind: "rect", fill: "#000", layout: { region: "main", x, y, anchor: [0, 0], width: 0.02, height: 0.02 }, ...o })
const nul = (id, x = 0, y = 0, region = "main", o = {}) => ({ id, kind: "null", layout: { region, x, y, anchor: [0, 0] }, ...o })
const line = (id, a, b, o = {}) => ({ id, kind: "line", from: { element: a, at: [0, 0] }, to: { element: b, at: [0, 0] }, color: "#000", width: 0.002, ...o })
const tl = (doc, anchors = { a: 0 }) => { const d = parseProject(doc); return { d, t: compileTimeline(d, new Map(Object.entries(anchors))) } }
const pos = (t, id, time) => { const s = t.stateAt(time).elements.get(id); return [s.x, s.y] }
const near = (a, b, eps = 1e-12) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, a + " vs " + b))

test("null object: a point with no size, any layer, animatable, rejects width/height", () => {
  const doc = base([nul("n", 0.1, 0.2), nul("h", 0, 0, "screen"), nul("u", 0, 0, "main", { ignoreMask: true })],
    [{ at: "a", target: "n", property: "x", to: 0.3, duration: 1, arc: 0 }, { at: "a", target: "n", property: "scale", to: 2, duration: 1 }])
  const { d, t } = tl(doc), r = resolveProject(d, new Map(), t.stateAt(1))
  near(Object.values(r.boxes.get("n")), [960 + 0.3 * U, 540 - 0.2 * U, 0, 0])
  assert.equal(r.scene.primitives[0].kind, "null")
  assert.equal(r.scene.primitives[1].layer, "screen")
  assert.equal(r.scene.primitives[2].ignoreMask, true)
  assert.throws(() => parseProject(base([{ ...nul("n"), layout: { ...nul("n").layout, width: 0.1 } }])), /空对象/)
  assert.throws(() => parseProject(base([nul("n")], [{ at: "a", target: "n", property: "width", to: 0.1, duration: 1 }])))
})

test("line layer: default by least exceptions, explicit layer projects each end from its own layer", () => {
  const cam = [{ at: "a", target: "camera", property: "target.x", to: 0.1, duration: 0 }]
  const els = [nul("w", 0, 0), nul("s", 0, 0, "screen"), nul("u", 0, 0, "main", { ignoreMask: true })]
  const run = extra => { const { d, t } = tl(base([...els, ...extra], cam)); return resolveProject(d, new Map(), t.stateAt(1)).scene.primitives }
  const [ww, wu, ws] = run([line("ww", "w", "w"), line("wu", "w", "u"), line("ws", "w", "s")]).slice(3)
  assert.equal(ww.layer, undefined); assert.equal(wu.layer, undefined); assert.equal(wu.ignoreMask, undefined)
  assert.equal(ws.layer, "screen"); near([ws.x1, ws.y1, ws.x2, ws.y2], [960 - 0.1 * U, 540, 960, 540], 1e-9)
  // Explicit world: the screen end is projected back into world pixels, so on screen it still lands on (960, 540).
  const [l] = run([line("l", "w", "s", { layer: "world" })]).slice(3)
  assert.equal(l.layer, undefined); near([l.x1, l.y1, l.x2, l.y2], [960, 540, 960 + 0.1 * U, 540], 1e-9)
  const [under] = run([line("l", "w", "w", { layer: "under" })]).slice(3)
  assert.equal(under.ignoreMask, true)
  assert.throws(() => parseProject(base([...els, line("l", "w", "s", { layer: "top" })])))
})

const move = (o = {}, el = {}, extra = {}) => base([rect("r", -0.4, 0, el)], [
  { at: "a", target: "r", property: "x", to: 0.4, duration: 1, ...o }, { at: "a", target: "r", property: "y", to: 0, duration: 1, ...o }], extra)

test("free arc: curve midpoint offset is exactly arc × distance, start and end unchanged", () => {
  for (const arc of [0.15, 0.3, 1]) {
    const { t } = tl(move({ arc, arcSide: "left" }))
    const [x, y] = pos(t, "r", 0.5)
    assert.ok(Math.abs(x) < 1e-12); assert.ok(Math.abs(y - arc * 0.8) < 1e-12, arc + ": " + y)   // left of +x travel is +y
    near(pos(t, "r", 0), [-0.4, 0]); near(pos(t, "r", 1), [0.4, 0]); near(pos(t, "r", 2), [0.4, 0])
  }
  const { t } = tl(move({ arcSide: "right" })); assert.ok(Math.abs(pos(t, "r", 0.5)[1] + 0.15 * 0.8) < 1e-12)
  const info = t.tracks.flat().find(c => c.property === "x").arcInfo
  assert.equal(info.arc, 0.15); assert.equal(info.side, "right"); near(info.control, [0, -0.24])
})

test("arc: 0 is point-for-point the old straight tween; the default arc applies to free moves only", () => {
  const ease = { type: "cubicBezier", x1: 0.7, y1: 0, x2: 0.3, y2: 1 }
  const straight = tl(move({ arc: 0, ease })).t, project0 = tl(move({ ease }, {}, { motion: { arc: 0 } })).t
  const bound = tl(base([rect("r", -0.4, 0, { motion: "bound" })], [{ at: "a", target: "r", property: "x", to: 0.4, duration: 1, ease }])).t, curved = tl(move({ ease })).t
  const f = cubicBezier(0.7, 0, 0.3, 1)
  for (let i = 0; i <= 40; i++) {
    const time = i / 40, e = f(time)
    // The old tween, written out: from + (to − from)·ease, ends returned as declared.
    const old = time === 0 ? -0.4 : time === 1 ? 0.4 : -0.4 + (0.4 - -0.4) * e
    assert.deepEqual(pos(straight, "r", time), [old, 0])
    assert.deepEqual(pos(project0, "r", time), [old, 0]); assert.equal(pos(bound, "r", time)[0], old)
    assert.equal(pos(curved, "r", time)[0], pos(straight, "r", time)[0])   // the chord coordinate keeps the old ease timing
  }
  assert.ok(Math.abs(pos(curved, "r", 0.5)[1]) > 0.1)
})

test("auto side bends away from the container center; levels override cue > element > project", () => {
  const up = base([rect("r", -0.4, 0.2)], [{ at: "a", target: "r", property: "x", to: 0.4, duration: 1 }])   // chord above center
  assert.ok(pos(tl(up).t, "r", 0.5)[1] > 0.2)
  const down = base([rect("r", -0.4, -0.2)], [{ at: "a", target: "r", property: "x", to: 0.4, duration: 1 }])
  assert.ok(pos(tl(down).t, "r", 0.5)[1] < -0.2)
  const levels = (cue, el, proj) => tl(base([rect("r", -0.4, 0, el)], [{ at: "a", target: "r", property: "x", to: 0.4, duration: 1, ...cue }], { motion: proj })).t
  assert.ok(Math.abs(Math.abs(pos(levels({}, {}, { arc: 0.5 }), "r", 0.5)[1]) - 0.4) < 1e-12)
  assert.ok(Math.abs(Math.abs(pos(levels({}, { arc: 0.25 }, { arc: 0.5 }), "r", 0.5)[1]) - 0.2) < 1e-12)
  assert.ok(Math.abs(Math.abs(pos(levels({ arc: 0.1 }, { arc: 0.25 }, { arc: 0.5 }), "r", 0.5)[1]) - 0.08) < 1e-12)
})

test("bound elements reject arc and motionPath; free x/y with % units reject arc; bad values rejected", () => {
  const txt = { id: "t", kind: "text", text: "a", fontSize: 0.02, color: "#000", align: "left", layout: { region: "main", x: 0, y: 0, anchor: [0, 0] } }
  assert.throws(() => parseProject(base([txt], [{ at: "a", target: "t", property: "y", to: 0.1, duration: 1, arc: 0.2 }])), /bound/)
  assert.throws(() => parseProject(base([{ ...txt, arc: 0.2 }])), /bound/)
  assert.throws(() => parseProject(base([txt], [{ at: "a", target: "t", property: "motionPath", duration: 1, path: { curve: "linear", points: [[0, 0], [0.1, 0]] } }])), /bound/)
  assert.doesNotThrow(() => parseProject(base([{ ...txt, motion: "free", arc: 0.2 }])))
  const pct = { ...rect("r"), layout: { ...rect("r").layout, x: "0%" } }
  assert.throws(() => parseProject(base([pct], [{ at: "a", target: "r", property: "x", to: "10%", duration: 1, arc: 0.2 }])), /百分比/)
  for (const bad of [{ arc: -0.1 }, { arc: 1.5 }, { arcSide: "up" }]) assert.throws(() => parseProject(move(bad)))
  assert.throws(() => parseProject(base([rect("r")], [{ at: "a", target: "r", property: "opacity", to: 0, duration: 1, arc: 0.1 }])))
  assert.throws(() => parseProject(move({}, { motion: "loose" })))
  assert.throws(() => tl(move({}, { motion: "bound" })), /只能水平或垂直/)   // a bound diagonal move
  assert.throws(() => parseProject(move({}, {}, { motion: { arc: 0.1, curve: 2 } })))
})

test("takeover: an arc starts from the evaluated state and a single-axis arc adds on top of the other axis", () => {
  // x is still moving (0 → 0.4 over 0..1) when a y move starts at 0.5: the y move bends sideways on top of x.
  const doc = base([rect("r", 0, 0)], [
    { at: "a", target: "r", property: "x", to: 0.4, duration: 1, arc: 0 },
    { at: "b", target: "r", property: "y", to: 0.3, duration: 0.5 },
    { at: "c", target: "r", property: "x", to: -0.2, duration: 1 },
    { at: "c", target: "r", property: "y", to: 0.1, duration: 1 }])
  const { t } = tl(doc, { a: 0, b: 0.5, c: 1.5 })
  near(pos(t, "r", 0.5), [0.2, 0]); near(pos(t, "r", 1), [0.4, 0.3]); near(pos(t, "r", 1.5), [0.4, 0.3])
  const mid = pos(t, "r", 0.75)   // x = 0.3 on its own track, plus the sideways bulge of the y move
  assert.ok(Math.abs(mid[0] - 0.3) > 1e-3)
  const info = t.tracks.flat().filter(c => c.property === "x").at(-1).arcInfo
  near(info.from, [0.4, 0.3]); near(info.to, [-0.2, 0.1]); near(pos(t, "r", 2.5), [-0.2, 0.1])
  assert.throws(() => tl(base([rect("r")], [{ at: "a", target: "r", property: "x", to: 0.1, duration: 1, ease: "ease-in" },
    { at: "a", target: "r", property: "y", to: 0.1, duration: 1 }])), /ease 不同/)
})
