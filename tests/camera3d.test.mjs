// docs/04：相机 3D 实验（opt-in）
import assert from "node:assert/strict"
import test from "node:test"
import fs from "node:fs"
import { compileTimeline, parseProject } from "../dist/index.js"
import { cameraMatrix, resolveProject } from "../dist/pipeline/resolve.js"
import { planeHomography, projectHomography, projectPinhole, measureMotion } from "../dist/shared/cameraGeometry.js"

const base = (cam = {}, elements = [], cues = []) => ({
  format: "silkyscene@1", canvas: { width: 1920, height: 1080, background: "#fff" },
  regions: [{ id: "main", x: 0, y: 0, width: 4, height: 2 }], elements, cues,
  camera: { projection: "orthographic", target: { x: 0, y: 0, z: 0 }, yaw: { rad: Math.PI / 2, cycles: 0 },
    pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 }, distance: 10, focal: 1, zoom: 1, arc: 0, lag: 0, ...cam } })
const box = (id, o = {}) => ({ id, kind: "rect", fill: "#000", layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.2, height: 0.2 }, ...o })
const tl = (doc, anchors = { a: 0 }) => compileTimeline(parseProject(doc), new Map(Object.entries(anchors)))
const PIVOT = [960, 540]

test("view3d 字段严格校验：拼错、越界、未声明就写节点都报错", () => {
  assert.throws(() => parseProject(base({ view3d: { distance: 3, pich: 5 } })), /未知字段：pich/)
  assert.throws(() => parseProject(base({ view3d: { distance: 0.1 } })), /distance/)
  assert.throws(() => parseProject(base({ view3d: { distance: 3, pitch: 40 } })), /maxTilt（35°）/)
  assert.doesNotThrow(() => parseProject(base({ view3d: { distance: 3, pitch: 40, maxTilt: 45 } })))
  assert.throws(() => parseProject(base({ view3d: { distance: 3, maxTilt: 90 } })), /maxTilt/)
  assert.throws(() => parseProject(base({ view3d: { distance: 3, height: -3 } })), /height/)
  assert.throws(() => parseProject(base({}, [box("b", { z: "1" })])), /z 须为/)
  assert.throws(() => parseProject(base({}, [], [{ at: "a", target: "camera", property: "view3d.pitch", to: 5, duration: 1 }])), /先声明 camera.view3d/)
  assert.throws(() => parseProject(base({ view3d: { distance: 3 } }, [box("b")], [{ at: "a", target: "b", property: "view3d.pitch", to: 5, duration: 1 }])), /只能写在相机/)
})

test("planeHomography 与直接写出的针孔投影逐点一致（误差 < 1e-9），且 tilt/height/z 全 0 时等于 2D 矩阵", () => {
  const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7)
  for (let k = 0; k < 400; k++) {
    const zoom = 0.5 + rnd(), roll = (rnd() - 0.5) * 0.6, F = [(rnd() - 0.5) * 4000, (rnd() - 0.5) * 3000]
    const M = cameraMatrix({ target: { x: 0, y: 0 }, roll: { rad: roll } }, zoom)
    const c2 = [M[0], M[1], M[2], M[3], PIVOT[0] - M[0] * F[0] - M[2] * F[1], PIVOT[1] - M[1] * F[0] - M[3] * F[1]]
    const view = { distance: 1500 + rnd() * 4000, height: (rnd() - 0.3) * 800, pitch: (rnd() - 0.5) * 1.2, yaw: (rnd() - 0.5) * 1.2 }
    const z = (rnd() - 0.5) * 600, H = planeHomography(c2, F, PIVOT, view, z)
    const p = [F[0] + (rnd() - 0.5) * 1500, F[1] + (rnd() - 0.5) * 900]
    const a = projectHomography(H, p), b = projectPinhole(c2, F, PIVOT, view, [p[0], p[1], z])
    assert.ok(Math.abs(a.w - b.w) < 1e-9 * view.distance)
    assert.ok(Math.hypot(a.point[0] - b.point[0], a.point[1] - b.point[1]) < 1e-9, a.point + " vs " + b.point)
    const flat = planeHomography(c2, F, PIVOT, { distance: view.distance, height: 0, pitch: 0, yaw: 0 }, 0)
    const q = projectHomography(flat, p), r = [c2[0] * p[0] + c2[2] * p[1] + c2[4], c2[1] * p[0] + c2[3] * p[1] + c2[5]]
    assert.ok(Math.hypot(q.point[0] - r[0], q.point[1] - r[1]) < 1e-9)
  }
})

test("透视方向：pitch > 0 上部变远变小；yaw > 0 左侧变远；z > 0 变大并有视差", () => {
  const c2 = [1, 0, 0, 1, 0, 0], F = [960, 540], view = (o) => ({ distance: 3240, height: 0, pitch: 0, yaw: 0, ...o })
  const w = (v, p) => projectHomography(planeHomography(c2, F, PIVOT, v, 0), p).w
  assert.ok(w(view({ pitch: 0.1 }), [960, 100]) > w(view({ pitch: 0.1 }), [960, 900]))
  assert.ok(w(view({ yaw: 0.1 }), [100, 540]) > w(view({ yaw: 0.1 }), [1800, 540]))
  const near = projectHomography(planeHomography(c2, F, PIVOT, view({}), 324), [1460, 540]).point
  assert.ok(near[0] > 1460 + 50)   // D/(D−z) = 3240/2916 = 1.111 → 960 + 500·1.111
  assert.ok(Math.abs(near[0] - (960 + 500 * 3240 / 2916)) < 1e-9)
})

test("回归：没有 view3d，或 view3d 全 0，场景与 2D 完全一致（逐字段）", () => {
  const els = [box("b"), box("c", { layout: { region: "main", x: 0.5, y: 0.2, anchor: [0, 0], width: 0.2, height: 0.2 } }),
    { id: "l", kind: "line", from: { element: "b", at: [1, 0] }, to: { element: "c", at: [-1, 0] }, color: "#000", width: 0.002 }]
  const cues = [{ at: "a", target: "camera", property: "target.x", to: 0.4, duration: 1 }, { at: "a", target: "camera", property: "zoom", to: 1.3, duration: 1 }]
  const plain = parseProject(base({}, els, cues)), zero = parseProject(base({ view3d: { distance: 3, height: 0, pitch: 0, yaw: 0 } }, els, cues))
  const tp = compileTimeline(plain, new Map([["a", 0]])), tz = compileTimeline(zero, new Map([["a", 0]]))
  for (let f = 0; f <= 30; f++) {
    const a = resolveProject(plain, new Map(), tp.stateAt(f / 30)).scene, { view3d, ...b } = resolveProject(zero, new Map(), tz.stateAt(f / 30)).scene
    assert.equal(view3d.flat, true)
    assert.deepEqual(b, a)
    assert.deepEqual(tz.cameraAt(f / 30), tp.cameraAt(f / 30))
  }
})

test("3D 帧：世界元素带 transform3d、连线端点已投影到屏幕；相机 2D 矩阵（2D 口径）不变", () => {
  const els = [box("b", { z: 0.1 }), box("c", { layout: { region: "main", x: 0.5, y: 0, anchor: [0, 0], width: 0.2, height: 0.2 } }),
    { id: "l", kind: "line", from: { element: "b", at: [0, 0] }, to: { element: "c", at: [0, 0] }, color: "#000", width: 0.002 }]
  const doc = parseProject(base({ view3d: { distance: 3, pitch: 10 } }, els)), t = compileTimeline(doc, new Map([["a", 0]]))
  const { scene } = resolveProject(doc, new Map(), t.stateAt(0))
  assert.equal(scene.view3d.flat, false)
  const b = scene.primitives.find(p => p.id === "b"), l = scene.primitives.find(p => p.id === "l")
  assert.equal(b.transform3d.length, 9); assert.ok(l.screen3d)
  // b sits at the framing centre, raised z = 0.1 u: with pitch 10° it is off the sight line, so it must match the direct pinhole.
  const H = b.transform3d, got = projectHomography(H, [960, 540])
  const ref = projectPinhole(scene.camera, [960, 540], PIVOT, { distance: 3240, height: 0, pitch: Math.PI / 18, yaw: 0 }, [960, 540, 108])
  assert.ok(Math.hypot(got.point[0] - ref.point[0], got.point[1] - ref.point[1]) < 1e-9)
  assert.ok(got.point[1] < 540)   // raised toward the camera, which sits on the −Y side: it slides up the picture
  assert.deepEqual(scene.camera, t.cameraAt(0))
  const m = measureMotion(scene.camera, undefined, PIVOT, { x: 0, y: 0 })
  assert.equal(m.zoom, 1)
})

test("prepare 硬检查：tilt 超上限、相机落到平面以下、元素到相机身后都报错并带时间", () => {
  const over = base({ view3d: { distance: 3, maxTilt: 20 } }, [box("b")], [{ at: "a", target: "camera", property: "view3d.pitch", to: 20, duration: 1, ease: { type: "cubicBezier", x1: 0.3, y1: 0, x2: 0.3, y2: 1.6 } }])
  assert.throws(() => tl(over).stateAt(0.7), /view3d\.pitch 在 0\.700 s.*maxTilt ±20°/)
  const low = base({ view3d: { distance: 1 } }, [box("b")], [{ at: "a", target: "camera", property: "view3d.height", to: -1, duration: 1 }])
  assert.throws(() => tl(low).stateAt(1), /1\.000 s.*distance \+ height ≤ 0/)
  const behind = parseProject(base({ view3d: { distance: 1 } }, [box("b", { z: 1.2 })]))
  assert.throws(() => resolveProject(behind, new Map(), compileTimeline(behind, new Map([["a", 0]])).stateAt(0)), /b 在 3D 相机下.*w = -?\d/)
})

test("view3d.* 节点沿用 zoom 的 lag：变化落在 [s+lag, s+D]", () => {
  const doc = base({ view3d: { distance: 3 } }, [], [{ at: "a", target: "camera", property: "view3d.yaw", to: 10, duration: 1, lag: 0.25 }])
  const t = tl(doc)
  assert.equal(t.view3dAt(0.25).yaw, 0); assert.ok(t.view3dAt(0.6).yaw > 0); assert.equal(t.view3dAt(1).yaw, 10)
})

test("官方样片 topology-flow：双节点相机能编译，推镜时倾斜在 2°–20° 之间，结束时归回垂直 0°", () => {
  const P = new URL("../playground/", import.meta.url)
  const doc = parseProject(JSON.parse(fs.readFileSync(new URL("topology-flow.scene.json", P), "utf8")))
  const { timingAnchors } = { timingAnchors: raw => new Map(Object.entries(raw).filter(([, v]) => typeof v === "number")) }
  const t = compileTimeline(doc, timingAnchors(JSON.parse(fs.readFileSync(new URL("topology-flow-timing.json", P), "utf8"))))
  let peak = 0
  for (let f = 0; f <= 615; f++) { const v = t.view3dAt(f / 30); peak = Math.max(peak, Math.abs(v.pitch), Math.abs(v.yaw)) }
  assert.ok(peak >= 2 && peak <= 20, "峰值 " + peak)
  const end = t.view3dAt(20.4)
  assert.ok(Math.abs(end.pitch) < 1e-6 && Math.abs(end.yaw) < 1e-6, "结尾应归回垂直")
})

test("同源：3D 下 renderAt / cameraAt / inspectFrame / projectCameraTrace 的相机矩阵逐帧一致，inspectFrame 的 3D 信息来自同一 scene", async () => {
  const { prepareProject, inspectFrame, projectCameraTrace } = await import("../dist/index.js")
  const cues = [{ at: "a", target: "camera", property: "target.x", to: 0.5, duration: 1, ease: "sine-in-out" },
    { at: "a", target: "camera", property: "view3d.yaw", to: 8, duration: 1, ease: "sine-in-out", lag: 0.2 },
    { at: "a", target: "camera", property: "view3d.height", to: 0.2, duration: 1 }]
  const doc = base({ view3d: { distance: 3 }, arc: 0.1, lag: 0.25 }, [box("b", { z: 0.05 })], cues)
  const anchors = new Map([["a", 0]])
  const prepared = await prepareProject(doc, { baseUrl: "http://x/", anchors })
  const t = compileTimeline(parseProject(doc), anchors), trace = projectCameraTrace(prepared, 45)
  let max = 0
  for (let f = 0; f <= 45; f++) {
    const s = prepared.renderAt(f / 30), a = t.cameraAt(f / 30), i = inspectFrame(prepared, f)
    for (let k = 0; k < 6; k++) max = Math.max(max, Math.abs(s.camera[k] - a[k]), Math.abs(i.camera.matrix[k] - a[k]), Math.abs(trace.frames[f].camera.matrix[k] - a[k]))
    if (f > 0 && f < 45) { assert.equal(i.camera.view3d.flat, false); assert.deepEqual(i.camera.view3d.resolved, t.view3dAt(f / 30)) }
  }
  assert.ok(max < 1e-9, "max " + max)
})

test("双控制点重叠：position.* 主移镜与 approach.* 靠拢目标可同时运行并线性相加，交界处速度不归零且终点精确垂直", () => {
  const cues = [
    { at: "pan", target: "camera", property: "target.x", to: 1, duration: 2, ease: "sine-in-out" },
    { at: "pan", target: "camera", property: "position.x", to: 0.72, duration: 2, ease: "sine-in-out" },
    { at: "app", target: "camera", property: "approach.x", to: 0.28, duration: 5, ease: { type: "cubicBezier", x1: 0.24, y1: 0, x2: 0.16, y2: 1 }, arc: 0 },
  ]
  const doc = base({ view3d: { distance: 2 }, position: { x: 0, y: 0, z: 2 } }, [], cues)
  const tl = compileTimeline(parseProject(doc), new Map([["pan", 0], ["app", 0.5]]))
  // 在主移镜结束瞬间 t = 2.0 s，靠拢控制仍在运动，摄像机总速度严格大于 0（无中途停顿）
  const pBefore = tl.positionAt(1.98)[0], pAt = tl.positionAt(2.0)[0], pAfter = tl.positionAt(2.02)[0]
  assert.ok(pAt > 0.75 && pAt < 0.90, "t=2.0s 位置 " + pAt)
  assert.ok((pAfter - pBefore) / 0.04 > 0.03, "t=2.0s 合成速度不能停顿")
  // 终点 t = 5.5 s 精确到达 0.72 + 0.28 = 1.00，偏转归 0°
  assert.ok(Math.abs(tl.positionAt(5.5)[0] - 1) < 1e-9)
  assert.ok(Math.abs(tl.view3dAt(5.5).yaw) < 1e-6)
})
