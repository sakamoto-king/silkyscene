// docs/02：连线/路径描出（trim）、颜色节点（fill / color / background）、硬边扫过（reveal）、虚线边框（strokeStyle）。
import assert from "node:assert/strict"
import test from "node:test"
import { compileTimeline, parseProject } from "../dist/index.js"
import { resolveProject } from "../dist/pipeline/resolve.js"
import { mixColor, parseColor } from "../dist/shared/color.js"

const base = (elements, cues = []) => ({
  format: "silkyscene@1", canvas: { width: 1920, height: 1080, background: "#fff" },
  regions: [{ id: "main", x: 0, y: 0, width: 1, height: 1 }], elements, cues,
  camera: { projection: "orthographic", target: { x: 0, y: 0, z: 0 }, yaw: { rad: Math.PI / 2, cycles: 0 },
    pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 }, distance: 10, focal: 1, zoom: 1 } })
const box = (id, x, extra = {}) => ({ id, kind: "rect", fill: "#000000", layout: { region: "main", x, y: 0, anchor: [0, 0], width: 0.1, height: 0.1 }, ...extra })
const nul = (id, x) => ({ id, kind: "null", layout: { region: "main", x, y: 0, anchor: [0, 0] } })
const line = { id: "l", kind: "line", from: { element: "a", at: [0, 0] }, to: { element: "b", at: [0, 0] }, color: "#000000", width: 0.002, trim: 0 }
const run = (doc, anchors, t) => { const d = parseProject(doc), tl = compileTimeline(d, new Map(Object.entries(anchors))); return resolveProject(d, new Map(), tl.stateAt(t)).scene }
const prim = (scene, id) => scene.primitives.find(p => p.id === id)

test("trim draws a line from its from-end; 1 keeps the exact old endpoint", () => {
  const doc = base([nul("a", -0.2), nul("b", 0.2), line], [{ at: "k", target: "l", property: "trim", to: 1, duration: 1 }])
  const at = t => prim(run(doc, { k: 0 }, t), "l")
  const end = at(2), start = at(0), half = at(0.5)
  assert.equal(start.x2, start.x1)
  assert.ok(Math.abs(half.x2 - (half.x1 + end.x2) / 2) < 1e-9)
  const plain = prim(run(base([nul("a", -0.2), nul("b", 0.2), { ...line, trim: undefined }]), {}, 0), "l")
  assert.deepEqual([end.x1, end.y1, end.x2, end.y2], [plain.x1, plain.y1, plain.x2, plain.y2])
})

test("path trim is passed to the renderer only while < 1", () => {
  const path = { id: "p", kind: "path", d: "M0 0 L10 0", viewBox: [10, 10], stroke: "#000", strokeWidth: 0.002, trim: 0,
    layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.1, height: 0.1 } }
  const doc = base([path], [{ at: "k", target: "p", property: "trim", to: 1, duration: 1 }])
  assert.equal(prim(run(doc, { k: 0 }, 0.25), "p").trim, 0.25)
  assert.equal(prim(run(doc, { k: 0 }, 1), "p").trim, undefined)
})

test("color cues tween fill / text color / background; ends are verbatim", () => {
  assert.deepEqual(parseColor("#0C0C0C"), [12, 12, 12, 1])
  assert.deepEqual(parseColor("rgba(12,12,12,0.08)"), [12, 12, 12, 0.08])
  assert.equal(parseColor("hotpink"), undefined)
  assert.equal(mixColor("#000000", "#ffffff", 0.5), "rgba(127.5,127.5,127.5,1)")
  assert.equal(mixColor("transparent", "#ff0000", 0.5), "rgba(255,0,0,0.5)")   // 不经过黑色
  const doc = base([box("r", 0)], [{ at: "k", target: "r", property: "fill", to: "#FFFFFF", duration: 1 }])
  assert.equal(prim(run(doc, { k: 0 }, 0), "r").fill, "#000000")
  assert.equal(prim(run(doc, { k: 0 }, 0.5), "r").fill, "rgba(127.5,127.5,127.5,1)")
  assert.equal(prim(run(doc, { k: 0 }, 1), "r").fill, "#FFFFFF")
  const hard = base([box("r", 0)], [{ at: "k", target: "r", property: "fill", to: "#E5FE3C", duration: 0 }])
  assert.equal(prim(run(hard, { k: 1 }, 0.99), "r").fill, "#000000")
  assert.equal(prim(run(hard, { k: 1 }, 1), "r").fill, "#E5FE3C")
  const lineDoc = base([nul("a", -0.2), nul("b", 0.2), { ...line, trim: undefined }], [{ at: "k", target: "l", property: "color", to: "#d64436", duration: 0 }])
  assert.equal(prim(run(lineDoc, { k: 0 }, 0), "l").stroke.color, "#d64436")
})

test("reveal clips from the chosen edge; groups, bad colors and wrong kinds are rejected", () => {
  const doc = base([box("r", 0, { reveal: 0, revealFrom: "left" })], [{ at: "k", target: "r", property: "reveal", to: 1, duration: 1 }])
  assert.deepEqual(prim(run(doc, { k: 0 }, 0.5), "r").reveal, { amount: 0.5, from: "left" })
  assert.equal(prim(run(doc, { k: 0 }, 1), "r").reveal, undefined)
  const g = { id: "g", kind: "group", layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.2, height: 0.2 } }
  assert.throws(() => parseProject(base([{ ...g, reveal: 0 }])), /不能 reveal/)
  assert.throws(() => parseProject(base([box("r", 0)], [{ at: "k", target: "r", property: "fill", to: "hotpink", duration: 1 }])), /颜色节点/)
  assert.throws(() => parseProject(base([box("r", 0)], [{ at: "k", target: "r", property: "background", to: "#fff", duration: 1 }])), /节点属性或值无效/)
  assert.throws(() => parseProject(base([box("r", 0)], [{ at: "k", target: "r", property: "trim", to: 1, duration: 1 }])), /节点属性或值无效/)
})

test("strokeStyle dashed reaches the rect stroke", () => {
  const s = run(base([box("r", 0, { stroke: "#000", strokeWidth: 0.002, strokeStyle: "dashed" })]), {}, 0)
  assert.equal(prim(s, "r").stroke.style, "dashed")
  assert.throws(() => parseProject(base([box("r", 0, { strokeStyle: "dotted" })])), /strokeStyle/)
})
