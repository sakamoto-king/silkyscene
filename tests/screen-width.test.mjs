// docs/02：连线 screenWidth（线宽按屏幕像素，不随相机缩放）、图片宽高节点（image 可 resize）。
import assert from "node:assert/strict"
import test from "node:test"
import { compileTimeline, parseProject } from "../dist/index.js"
import { resolveProject } from "../dist/pipeline/resolve.js"

const cam = zoom => ({ projection: "orthographic", target: { x: 0, y: 0, z: 0 }, yaw: { rad: Math.PI / 2, cycles: 0 },
  pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 }, distance: 10, focal: 1, zoom })
const base = (elements, cues = [], zoom = 1) => ({ format: "silkyscene@1", canvas: { width: 1920, height: 1080, background: "#fff" },
  regions: [{ id: "main", x: 0, y: 0, width: 1, height: 1 }], elements, cues, camera: cam(zoom) })
const nul = (id, x) => ({ id, kind: "null", layout: { region: "main", x, y: 0, anchor: [0, 0] } })
const run = (doc, t = 0) => { const d = parseProject(doc), tl = compileTimeline(d, new Map([["k", 0]]))
  return resolveProject(d, new Map([["i", { width: 10, height: 10, src: "x.png" }]]), tl.stateAt(t)).scene }
const prim = (scene, id) => scene.primitives.find(p => p.id === id)
const line = extra => ({ id: "l", kind: "line", from: { element: "a", at: [0, 0] }, to: { element: "b", at: [0, 0] }, color: "#000000", width: 2 / 1080, ...extra })

test("screenWidth keeps the drawn width in screen px at any zoom", () => {
  const w = (zoom, extra) => prim(run(base([nul("a", -0.1), nul("b", 0.1), line(extra)], [], zoom)), "l").stroke.width
  assert.ok(Math.abs(w(1, {}) - 2) < 1e-9)
  assert.ok(Math.abs(w(0.5, {}) - 2) < 1e-9)                 // 不写：世界层线宽 2 px，相机缩放后画面上 1 px
  assert.ok(Math.abs(w(0.5, { screenWidth: true }) - 4) < 1e-9)   // 世界层上 4 px × 0.5 = 屏幕 2 px
  assert.ok(Math.abs(w(2, { screenWidth: true, dash: [4 / 1080, 2 / 1080] }) - 1) < 1e-9)
  const d = prim(run(base([nul("a", -0.1), nul("b", 0.1), line({ screenWidth: true, dash: [4 / 1080, 2 / 1080] })], [], 2)), "l").stroke.dash
  assert.ok(Math.abs(d[0] - 2) < 1e-9 && Math.abs(d[1] - 1) < 1e-9)
  assert.throws(() => parseProject(base([nul("a", -0.1), nul("b", 0.1), line({ screenWidth: "yes" })])))
})

test("image width / height cues resize the box", () => {
  const img = { id: "i", kind: "image", src: "x.png", fit: "cover", layout: { region: "main", x: 0, y: 0, anchor: [-1, 1], width: 0.2, height: 0.1 } }
  const doc = base([img], [{ at: "k", target: "i", property: "width", to: 0.4, duration: 1 }, { at: "k", target: "i", property: "height", to: 0.3, duration: 1 }])
  const r1 = prim(run(doc, 1), "i").rect
  assert.ok(Math.abs(r1.width - 0.4 * 1080) < 1e-6 && Math.abs(r1.height - 0.3 * 1080) < 1e-6)
  const r0 = prim(run(doc, 0), "i").rect
  assert.ok(Math.abs(r0.x - r1.x) < 1e-6 && Math.abs(r0.y - r1.y) < 1e-6)   // 锚点左上，位置不动
})
