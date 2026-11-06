// docs/02：曲线连线（curve）、组缩放 + 裁切（group clip）、rect 斜纹（stripes）、逐帧轨迹检查（lintScene）、检查器缓存，
// 以及 dom-kit 的缩放组（transform: scale → group scale，字跟着缩）和 repeating-linear-gradient 解析。
import assert from "node:assert/strict"
import test from "node:test"
import { compileTimeline, inspectFrame, lintScene, lintSummary, parseProject, prepareProject, BAKED_MESSAGE } from "../dist/index.js"
import { curveControls, resolveProject, trimCubic } from "../dist/pipeline/resolve.js"

const cam = (zoom = 1) => ({ projection: "orthographic", target: { x: 0, y: 0, z: 0 }, yaw: { rad: Math.PI / 2, cycles: 0 },
  pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 }, distance: 10, focal: 1, zoom })
const base = (elements, cues = []) => ({ format: "silkyscene@1", canvas: { width: 1920, height: 1080, background: "#fff" },
  regions: [{ id: "main", x: 0, y: 0, width: 1, height: 1 }], elements, cues, camera: cam() })
const nul = (id, x, y = 0) => ({ id, kind: "null", layout: { region: "main", x, y, anchor: [0, 0] } })
const anchors = new Map([["k", 0]])
const run = (doc, t = 0, a = anchors) => { const d = parseProject(doc), tl = compileTimeline(d, a); return resolveProject(d, new Map(), tl.stateAt(t)).scene }
const prim = (scene, id) => scene.primitives.find(p => p.id === id)
const line = extra => ({ id: "l", kind: "line", from: { element: "a", at: [0, 0] }, to: { element: "b", at: [0, 0] }, color: "#000000", width: 2 / 1080, ...extra })
const nums = d => d.match(/-?[\d.e+-]+/g).map(Number)

test("curveControls: h = clamp(dx · 0.5, 33, 240) px", () => {
  assert.deepEqual(curveControls([0, 0], [200, 50], "horizontal"), [[0, 0], [100, 0], [100, 50], [200, 50]])
  assert.deepEqual(curveControls([0, 0], [40, 50], "horizontal")[1], [33, 0])          // 下限 33
  assert.deepEqual(curveControls([0, 0], [1000, 0], "horizontal")[1], [240, 0])       // 上限 240
  assert.deepEqual(curveControls([0, 0], [-300, 0], "horizontal")[1], [33, 0])        // 反向：仍是 33（max(33, …)）
  assert.deepEqual(curveControls([0, 0], [10, 200], "vertical"), [[0, 0], [0, 100], [10, 100], [10, 200]])
})

test("curved line resolves to path data; straight line is unchanged", () => {
  const els = extra => [nul("a", -0.1, 0.05), nul("b", 0.1, -0.05), line(extra)]
  const straight = prim(run(base(els({}))), "l"), curved = prim(run(base(els({ curve: "horizontal" }))), "l")
  assert.equal(straight.d, undefined)
  for (const k of ["x1", "y1", "x2", "y2"]) assert.equal(curved[k], straight[k])
  const v = nums(curved.d)
  assert.equal(v.length, 8)
  const h = Math.max(33, Math.min(240, (straight.x2 - straight.x1) * 0.5))
  assert.ok(Math.abs(v[0] - straight.x1) < 1e-6 && Math.abs(v[2] - (straight.x1 + h)) < 1e-6 && Math.abs(v[3] - straight.y1) < 1e-6)
  assert.ok(Math.abs(v[4] - (straight.x2 - h)) < 1e-6 && Math.abs(v[6] - straight.x2) < 1e-6 && Math.abs(v[7] - straight.y2) < 1e-6)
  // dash / screenWidth / color / opacity carry over to the curve as for a straight line
  const styled = prim(run(base(els({ curve: "horizontal", dash: [14 / 1080, 10 / 1080], screenWidth: true, color: "#F08A24", opacity: 0.5 }))), "l")
  assert.deepEqual(styled.stroke.dash.map(x => +x.toFixed(6)), [14, 10]); assert.equal(styled.stroke.color, "#F08A24"); assert.equal(styled.opacity, 0.5)
})

test("curve trim follows arc length (stroke-dashoffset on the original path)", () => {
  const q = [[0, 0], [100, 0], [100, 100], [200, 100]]
  const len = c => { let L = 0, p = c[0]; for (let i = 1; i <= 400; i++) { const t = i / 400, s = 1 - t
    const x = s ** 3 * c[0][0] + 3 * s * s * t * c[1][0] + 3 * s * t * t * c[2][0] + t ** 3 * c[3][0], y = s ** 3 * c[0][1] + 3 * s * s * t * c[1][1] + 3 * s * t * t * c[2][1] + t ** 3 * c[3][1]
    L += Math.hypot(x - p[0], y - p[1]); p = [x, y] } return L }
  const half = trimCubic(q, 0.5)
  assert.ok(Math.abs(len(half) / len(q) - 0.5) < 0.01)
  assert.ok(Math.abs(half[3][0] - 100) < 0.5 && Math.abs(half[3][1] - 50) < 0.5)      // 对称 S 形：一半在正中
  assert.deepEqual(trimCubic(q, 1), q)
  const doc = base([nul("a", -0.1, 0.05), nul("b", 0.1, -0.05), line({ curve: "horizontal", trim: 0.25 })])
  const l = prim(run(doc), "l"), full = prim(run(base([nul("a", -0.1, 0.05), nul("b", 0.1, -0.05), line({ curve: "horizontal" })])), "l")
  assert.ok(nums(l.d)[6] < nums(full.d)[6])
})

test("curve validation", () => {
  assert.throws(() => parseProject(base([nul("a", 0), nul("b", 0.1), line({ curve: "bezier" })])), /curve/)
  assert.throws(() => parseProject(base([nul("a", 0), nul("b", 0.1), line({ curveRatio: 0.3 })])), /curve/)
  assert.throws(() => parseProject(base([nul("a", 0), nul("b", 0.1), line({ curve: "horizontal", curveMin: 0.5, curveMax: 0.1 })])), /curveMin/)
})

test("group clip gives descendants the group's box; rotated clip and radius without clip are rejected", () => {
  const group = extra => ({ id: "g", kind: "group", layout: { region: "main", x: -0.2, y: 0.1, anchor: [-1, 1], width: 0.4, height: 0.2 }, ...extra })
  const child = { id: "c", kind: "rect", fill: "#000000", layout: { region: "g", x: 0, y: 0, anchor: [0, 0], width: 0.3, height: 0.1 } }
  const s = run(base([group({ clip: true, radius: 0.01 }), child]))
  const c = prim(s, "c")
  assert.ok(c.clip, "clip on child")
  assert.ok(Math.abs(c.clip.width - 0.4 * 1080) < 1e-6 && Math.abs(c.clip.height - 0.2 * 1080) < 1e-6 && Math.abs(c.clip.radius - 0.01 * 1080) < 1e-6)
  assert.equal(prim(run(base([group({}), child])), "c").clip, undefined)
  assert.throws(() => parseProject(base([group({ radius: 0.01 }), child])), /radius/)
  assert.throws(() => run(base([group({ clip: true, rotate: 10 }), child])), /旋转|rotat/)
})

test("group scale cascades to children (contents follow the box)", () => {
  const g = { id: "g", kind: "group", scaleX: 0.5, scaleY: 0.5, origin: [0, 0], layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.4, height: 0.2 } }
  const t = { id: "t", kind: "rect", fill: "#000000", layout: { region: "g", x: 0, y: 0, anchor: [0, 0], width: 0.1, height: 0.04 } }
  const p = prim(run(base([g, t])), "t")
  assert.ok(p.transform, "child carries the group transform")
  assert.ok(Math.abs(p.transform[0] - 0.5) < 1e-9 && Math.abs(p.transform[3] - 0.5) < 1e-9)
})

test("rect stripes resolve to px; bad stripes are rejected", () => {
  const r = { id: "r", kind: "rect", fill: "transparent", stripes: { color1: "#F4F3EF", color2: "#EFEEEA", size: 12 / 1080 }, layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.2, height: 0.1 } }
  const p = prim(run(base([r])), "r")
  assert.deepEqual({ ...p.stripes, size: +p.stripes.size.toFixed(6), size2: +p.stripes.size2.toFixed(6) }, { angle: 45, color1: "#F4F3EF", color2: "#EFEEEA", size: 12, size2: 12 })
  assert.throws(() => parseProject(base([{ ...r, stripes: { color1: "#F4F3EF", size: 0.01 } }])))
  assert.throws(() => parseProject(base([{ ...r, stripes: { ...r.stripes, wobble: 1 } }])))
})

// ---------- lintScene ----------
const mover = (extra = {}) => ({ id: "m", kind: "rect", fill: "#000000", motion: "free", arc: 0, layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.1, height: 0.1 }, ...extra })
const dense = (n, gap, extra = {}) => { const cues = [], a = {}
  for (let i = 0; i < n; i++) { cues.push({ at: "d" + i, target: "m", property: "x", to: i / 1000, duration: gap, ...extra }); a["d" + i] = i * gap }
  return { cues, a } }

test("lintScene: normal keyframed motion → 0 warnings", () => {
  const cues = [{ at: "k0", target: "m", property: "x", to: 0.3, duration: 0.8, ease: { type: "cubicBezier", x1: 0.3, y1: 0, x2: 0, y2: 1 } },
    { at: "k1", target: "m", property: "x", to: 0, duration: 0.6 }, { at: "k2", target: "m", property: "opacity", to: 0, duration: 0.3 }]
  const doc = parseProject(base([mover()], cues))
  assert.deepEqual(lintScene(doc, { k0: 0, k1: 1.2, k2: 2 }), [])
  assert.equal(lintSummary([]), "逐帧轨迹：0 条警告")
})

test("lintScene: frame-dense cues without a reason → structured warning", () => {
  const { cues, a } = dense(8, 1 / 30)
  const w = lintScene(parseProject(base([mover()], cues)), a)
  assert.equal(w.length, 1)
  assert.equal(w[0].kind, "baked-trajectory"); assert.equal(w[0].level, "warning"); assert.equal(w[0].target, "m"); assert.equal(w[0].property, "x")
  assert.equal(w[0].rule, "run"); assert.equal(w[0].keyCount, 8); assert.ok(w[0].medianGap < 0.04)
  assert.equal(w[0].message, BAKED_MESSAGE)
  assert.match(lintSummary(w), /逐帧轨迹警告 1 条/)
  // density rule: 30 keys at 0.09 s (no 6-key run ≤ 0.07 s) still warns
  const d2 = dense(30, 0.09), w2 = lintScene(parseProject(base([mover()], d2.cues)), d2.a)
  assert.equal(w2.length, 1); assert.equal(w2[0].rule, "density")
  // 5 keys is not a run
  const d3 = dense(5, 1 / 30); assert.deepEqual(lintScene(parseProject(base([mover()], d3.cues)), d3.a), [])
})

test("lintScene: bakedReason (cue or element) turns the warning into reported", () => {
  const { cues, a } = dense(8, 1 / 30, { bakedReason: "此处是物理模拟，逐帧" })
  const w = lintScene(parseProject(base([mover()], cues)), a)
  assert.equal(w.length, 1); assert.equal(w[0].level, "reported"); assert.equal(w[0].reason, "此处是物理模拟，逐帧")
  const e = dense(8, 1 / 30), we = lintScene(parseProject(base([mover({ bakedReason: "手绘抖动，逐帧" })], e.cues)), e.a)
  assert.equal(we[0].level, "reported")
  assert.match(lintSummary(we), /已报备 1 条/)
  assert.throws(() => parseProject(base([mover({ bakedReason: "" })], e.cues)))
})

// ---------- inspector ----------
test("inspectFrame is stable across calls and arc points stay in the JSON", async () => {
  const cues = [{ at: "k", target: "m", property: "x", to: 0.3, duration: 1 }, { at: "k", target: "m", property: "y", to: 0.2, duration: 1, }]
  const doc = base([mover({ arc: 0.2 })], cues)
  const prepared = await prepareProject(doc, { anchors })
  const a = JSON.stringify(inspectFrame(prepared, 10, 30)), b = JSON.stringify(inspectFrame(prepared, 10, 30))
  assert.equal(a, b)
  const f = inspectFrame(prepared, 12, 30), arcs = f.elements.find(e => e.declaration.id === "m").arcs
  assert.ok(arcs.length >= 1 && arcs[0].points.length === 33)
  assert.ok(JSON.parse(JSON.stringify(f)).elements.find(e => e.declaration.id === "m").arcs[0].points.length === 33)
  assert.equal(typeof prepared.cameraAt, "function")
  assert.deepEqual(prepared.cameraAt(0.4), prepared.renderAt(0.4).camera)
})

// ---------- dom-kit ----------
