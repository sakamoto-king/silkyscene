// docs/02：旋转（rotate 元素字段 + 节点）、边框颜色渐变（strokeColor）、图片圆角（image.radius）。
import assert from "node:assert/strict"
import test from "node:test"
import { compileTimeline, parseProject } from "../dist/index.js"
import { resolveProject } from "../dist/pipeline/resolve.js"

const base = (elements, cues = []) => ({
  format: "silkyscene@1", canvas: { width: 1920, height: 1080, background: "#fff" },
  regions: [{ id: "main", x: 0, y: 0, width: 1, height: 1 }], elements, cues,
  camera: { projection: "orthographic", target: { x: 0, y: 0, z: 0 }, yaw: { rad: Math.PI / 2, cycles: 0 },
    pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 }, distance: 10, focal: 1, zoom: 1 } })
const box = (extra = {}) => ({ id: "a", kind: "rect", fill: "#000000", layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.1, height: 0.1 }, ...extra })
const run = (doc, t, anchors = { k: 0 }) => { const d = parseProject(doc), tl = compileTimeline(d, new Map(Object.entries(anchors))); return resolveProject(d, new Map(), tl.stateAt(t)).scene }
const prim = (scene, id) => scene.primitives.find(p => p.id === id)
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, a + " vs " + b))

test("rotate 0 keeps the identity (no transform); 90° turns around the anchor", () => {
  assert.equal(prim(run(base([box({ rotate: 0 })]), 0), "a").transform, undefined)
  const m = prim(run(base([box({ rotate: 90 })]), 0), "a").transform
  const [a, b, c, d, e, f] = m, ap = (x, y) => [a * x + c * y + e, b * x + d * y + f]
  near(ap(960, 540), [960, 540])               // anchor = centre stays put
  near(ap(1060, 540), [960, 640])              // +x on screen → +y on screen (clockwise)
})

test("rotate cue tweens degrees and composes with scale", () => {
  const doc = base([box({ scaleX: 2, scaleY: 2 })], [{ at: "k", target: "a", property: "rotate", to: 90, duration: 1 }])
  const [a, b, c, d] = prim(run(doc, 0.5), "a").transform
  near([a, b, c, d], [2 * Math.cos(Math.PI / 4), 2 * Math.sin(Math.PI / 4), -2 * Math.sin(Math.PI / 4), 2 * Math.cos(Math.PI / 4)])
  assert.throws(() => parseProject(base([box({ rotate: "x" })])))
})

test("strokeColor tweens a rect border; needs a declared stroke", () => {
  const doc = base([box({ stroke: "#000000", strokeWidth: 0.002 })], [{ at: "k", target: "a", property: "strokeColor", to: "#ffffff", duration: 1 }])
  assert.equal(prim(run(doc, 0), "a").stroke.color, "#000000")
  assert.equal(prim(run(doc, 1), "a").stroke.color, "#ffffff")
  assert.notEqual(prim(run(doc, 0.5), "a").stroke.color, "#000000")
  assert.throws(() => parseProject(base([box()], [{ at: "k", target: "a", property: "strokeColor", to: "#fff", duration: 1 }])))
})

test("image radius is passed in px", () => {
  const img = { id: "i", kind: "image", src: "x.png", fit: "cover", radius: 0.01, layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.1, height: 0.1 } }
  const d = parseProject(base([img]))
  const sc = resolveProject(d, new Map([["i", { width: 10, height: 10, src: "x.png" }]])).scene
  assert.ok(prim(sc, "i").radius > 0)
})

test("text shadow is passed in px like rect shadow", () => {
  const t = { id: "t", kind: "text", text: "a", fontSize: 0.02, color: "#000", align: "left", shadow: { x: 0, y: 0.01, blur: 0.02, color: "rgba(0,0,0,0.1)" },
    layout: { region: "main", x: 0, y: 0, anchor: [0, 0] } }
  const d = parseProject(base([t]))
  const sc = resolveProject(d, new Map([["t", { width: 10, height: 10 }]])).scene
  assert.ok(Math.abs(prim(sc, "t").shadow.y - 10.8) < 1e-9)
  assert.throws(() => parseProject(base([{ ...t, shadow: { x: 0 } }])))
})
