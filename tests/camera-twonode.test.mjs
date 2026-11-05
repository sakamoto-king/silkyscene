// docs/04：传统 AE 双节点相机（目标点 x/y/z + 摄像机 x/y/z，俯仰/偏转/距离推导）
import assert from "node:assert/strict"
import test from "node:test"
import { compileTimeline, parseProject } from "../dist/index.js"
import { resolveProject } from "../dist/pipeline/resolve.js"
import { deriveView, projectPinhole } from "../dist/shared/cameraGeometry.js"

const base = (cam = {}, elements = [], cues = []) => ({
  format: "silkyscene@1", canvas: { width: 1920, height: 1080, background: "#fff" },
  regions: [{ id: "main", x: 0, y: 0, width: 4, height: 2 }], elements, cues,
  camera: { projection: "orthographic", target: { x: 0, y: 0, z: 0 }, yaw: { rad: Math.PI / 2, cycles: 0 },
    pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 }, distance: 10, focal: 1, zoom: 1, arc: 0, lag: 0, ...cam } })
const box = (id, o = {}) => ({ id, kind: "rect", fill: "#000", layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.2, height: 0.2 }, ...o })
const tl = (doc, anchors = { a: 0, b: 0.4 }) => compileTimeline(parseProject(doc), new Map(Object.entries(anchors)))
const pan = [{ at: "a", target: "camera", property: "target.x", to: 0.6, duration: 1, ease: "sine-in-out" },
  { at: "a", target: "camera", property: "target.y", to: 0.2, duration: 1, ease: "sine-in-out" },
  { at: "b", target: "camera", property: "position.x", to: 0.6, duration: 1, ease: "sine-in-out", arc: 0.3 },
  { at: "b", target: "camera", property: "position.y", to: 0.2, duration: 1, ease: "sine-in-out", arc: 0.3 },
  { at: "b", target: "camera", property: "position.z", to: 3.2, duration: 1, ease: "sine-in-out" }]
const V = { view3d: { distance: 3 }, position: { x: 0, y: 0, z: 3 } }

test("双节点字段严格校验：缺 view3d、缺 z、与显式 tilt 混写、多余字段、lag 都报错", () => {
  assert.throws(() => parseProject(base({ position: { x: 0, y: 0, z: 3 } })), /先声明 camera.view3d/)
  assert.throws(() => parseProject(base({ view3d: { distance: 3 }, position: { x: 0, y: 0 } })), /\{ x, y, z \}/)
  assert.throws(() => parseProject(base({ view3d: { distance: 3 }, position: { x: 0, y: 0, z: 3, pitch: 5 } })), /未知字段：pitch/)
  assert.throws(() => parseProject(base({ view3d: { distance: 3, pitch: 5 }, position: { x: 0, y: 0, z: 3 } })), /二选一/)
  assert.throws(() => parseProject(base(V, [], [{ at: "a", target: "camera", property: "view3d.yaw", to: 5, duration: 1 }])), /二选一.*view3d\.yaw/)
  assert.throws(() => parseProject(base(V, [], [{ at: "a", target: "camera", property: "position.x", to: 1, duration: 1, lag: 0.2 }])), /不用 lag/)
  assert.throws(() => parseProject(base(V, [box("b")], [{ at: "a", target: "b", property: "position.x", to: 1, duration: 1 }])), /只能写在相机/)
  assert.doesNotThrow(() => parseProject(base(V, [], pan)))
})

test("默认：摄像机在目标点正上方 z = distance 时，画面与 2D 逐字段一致", () => {
  const els = [box("b", { z: 0 })], cues = pan.slice(0, 2)
  const plain = parseProject(base({}, els, cues)), two = parseProject(base(V, els, [...cues,
    { at: "a", target: "camera", property: "position.x", to: 0.6, duration: 1, ease: "sine-in-out" },
    { at: "a", target: "camera", property: "position.y", to: 0.2, duration: 1, ease: "sine-in-out" }]))
  const tp = compileTimeline(plain, new Map([["a", 0]])), tt = compileTimeline(two, new Map([["a", 0]]))
  for (const f of [0, 9, 15, 30]) {
    const a = resolveProject(plain, new Map(), tp.stateAt(f / 30)).scene, { view3d, ...b } = resolveProject(two, new Map(), tt.stateAt(f / 30)).scene
    assert.equal(view3d.flat, true); assert.deepEqual(b, a)
  }
})

test("目标点先动、摄像机后动：中途有推导倾斜，两者到位后回到 0", () => {
  const t = tl(base(V, [], pan))
  assert.ok(t.stateAt(0.3).camera.x > 0.05); assert.equal(t.positionAt(0.3)[0], 0)
  const mid = t.view3dAt(0.8); assert.ok(Math.abs(mid.yaw) > 1 && mid.derived)
  assert.ok(t.view3dAt(0.8).yaw < 0, "摄像机落在目标点左侧（−X）时偏转为负")
  const end = t.view3dAt(1.4); assert.equal(end.pitch, 0); assert.equal(end.yaw, 0); assert.equal(t.positionAt(1.4)[2], 3.2)
  assert.equal(t.positionMoves.length, 1); assert.equal(t.positionMoves[0].start, 0.4)
})

test("推导几何：目标点投影到画面中心，摄像机就在推导出的视线上（误差 < 1e-9）", () => {
  let max = 0
  for (let i = 0; i < 300; i++) {
    const r = k => (Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1
    const T = [r(1), r(2), r(3) * 0.3], P = [T[0] + r(4) * 0.8, T[1] + r(5) * 0.8, 1.5 + Math.abs(r(6)) * 3], D = 2 + Math.abs(r(7))
    const d = deriveView(P, T, D), u = 1080
    const view = { distance: D * u, height: d.height * u, pitch: d.pitch * Math.PI / 180, yaw: d.yaw * Math.PI / 180 }
    const F = [960 + d.frame[0] * u, 540 - d.frame[1] * u], cam = [1, 0, 0, 1, 0, 0]
    const q = projectPinhole(cam, F, [960, 540], view, [960 + T[0] * u, 540 - T[1] * u, T[2] * u])
    max = Math.max(max, Math.abs(q.point[0] - 960), Math.abs(q.point[1] - 540))
    // Eye = F + (D + h)·dir must equal P.
    const L = D + d.height, p = view.pitch, y = view.yaw
    max = Math.max(max, Math.abs(d.frame[0] + L * Math.sin(y) * Math.cos(p) - P[0]), Math.abs(d.frame[1] - L * Math.sin(p) - P[1]),
      Math.abs(L * Math.cos(y) * Math.cos(p) - P[2]), Math.abs(Math.hypot(P[0] - T[0], P[1] - T[1], P[2] - T[2]) - d.sight))
  }
  assert.ok(max < 1e-9, "max " + max)
})

test("推导倾斜超 maxTilt、摄像机低于目标点都报错且带时间", () => {
  const far = base({ view3d: { distance: 3, maxTilt: 10 }, position: { x: 0, y: 0, z: 1 } }, [], [{ at: "a", target: "camera", property: "target.x", to: 1, duration: 1 }])
  assert.throws(() => tl(far).stateAt(0.5), /偏转（由摄像机位置推导）在 0\.500 s.*maxTilt ±10°/)
  const low = base(V, [], [{ at: "a", target: "camera", property: "target.z", to: 3.5, duration: 1 }])
  assert.throws(() => tl(low).stateAt(1), /1\.000 s.*高于目标点/)
})

test("同源：双节点下 renderAt / cameraAt / inspectFrame / projectCameraTrace 的相机矩阵逐帧一致；检查器摄像机点 = 声明值", async () => {
  const { prepareProject, inspectFrame, projectCameraTrace } = await import("../dist/index.js")
  const doc = base({ ...V, arc: 0.1 }, [box("b", { z: 0.05 })], pan), anchors = new Map([["a", 0], ["b", 0.4]])
  const prepared = await prepareProject(doc, { baseUrl: "http://x/", anchors })
  const t = compileTimeline(parseProject(doc), anchors), trace = projectCameraTrace(prepared, 45)
  let max = 0
  for (let f = 0; f <= 45; f++) {
    const s = prepared.renderAt(f / 30), a = t.cameraAt(f / 30), i = inspectFrame(prepared, f)
    for (let k = 0; k < 6; k++) max = Math.max(max, Math.abs(s.camera[k] - a[k]), Math.abs(i.camera.matrix[k] - a[k]), Math.abs(trace.frames[f].camera.matrix[k] - a[k]))
    const p = t.positionAt(f / 30)
    max = Math.max(max, Math.abs(i.camera.body.u[0] - p[0]), Math.abs(i.camera.body.u[1] - p[1]), Math.abs(i.camera.body.z - p[2]))
    if (!i.camera.view3d.flat) max = Math.max(max, Math.abs(i.camera.view3d.eye.px[0] - i.camera.body.px[0]), Math.abs(i.camera.view3d.eye.px[1] - i.camera.body.px[1]))
  }
  assert.ok(max < 1e-9, "max " + max)
})