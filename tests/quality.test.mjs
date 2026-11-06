import assert from "node:assert/strict"
import test from "node:test"
import { compileTimeline, parseProject, qualityScan, isGradient } from "../dist/index.js"
import { resolveProject } from "../dist/pipeline/resolve.js"

const cam = (zoom = 1) => ({ projection: "orthographic", target: { x: 0, y: 0, z: 0 }, yaw: { rad: Math.PI / 2, cycles: 0 },
  pitch: { rad: -Math.PI / 2, cycles: 0 }, roll: { rad: 0, cycles: 0 }, distance: 10, focal: 1, zoom })
const doc = (elements, cues = [], zoom = 1, background = "#fff") => parseProject({ format: "silkyscene@1", canvas: { width: 1920, height: 1080, background },
  regions: [{ id: "w", x: 0, y: 0, width: 6, height: 3 }], elements, camera: cam(zoom), cues })
const text = (id, fontSize, extra = {}) => ({ id, kind: "text", text: "字", fontSize, color: "#000", align: "center", layout: { region: "w", x: 0, y: 0, anchor: [0, 0], width: 0.2, height: 0.1 }, ...extra })
const card = (id, x, extra = {}) => ({ id, kind: "rect", fill: "#fff", layout: { region: "w", x, y: 0, anchor: [0, 0], width: 0.3, height: 0.2 }, ...extra })
const frames = (d, anchors = new Map(), end = 1) => {
  const tl = compileTimeline(d, anchors), m = new Map(d.elements.filter(e => e.kind === "text").map(e => [e.id, { width: 200, height: 100 }]))
  return Array.from({ length: Math.round(end * 30) + 1 }, (_, i) => { const r = resolveProject(d, m, tl.stateAt(i / 30)); return { time: i / 30, scene: r.scene, boxes: r.boxes } })
}

test("small-text：屏幕字号 = fontSize × 相机 zoom × 组缩放，< 13 px 且持续 ≥ 0.25 s 才报", () => {
  const d = doc([text("t", 0.02)], [], 0.5) // 21.6 px × 0.5 = 10.8 px
  const q = qualityScan(d, frames(d))
  assert.equal(q.length, 1); assert.equal(q[0].kind, "small-text"); assert.ok(Math.abs(q[0].worst - 10.8) < 1e-6)
  assert.equal(qualityScan(doc([text("t", 0.02)], [], 1), frames(doc([text("t", 0.02)], [], 1))).length, 0)
  const faded = doc([text("t", 0.02, { opacity: 0.1 })], [], 0.5)
  assert.equal(qualityScan(faded, frames(faded)).length, 0) // 几乎不可见的文字不算
  assert.equal(qualityScan(d, frames(d), { minFontPx: 10 }).length, 0)
})

test("edge-clip：卡片被取景框切掉一部分才报；完全出画、背景大底、ignoreMask 不报", () => {
  const cut = doc([card("c", 0.85)]) // 半宽 0.889：卡片右半出画
  const q = qualityScan(cut, frames(cut))
  assert.equal(q.length, 1); assert.equal(q[0].kind, "edge-clip"); assert.ok(q[0].worst > 0.3 && q[0].worst < 0.7)
  for (const d of [doc([card("c", 1.5)]), doc([card("c", 0.85, { ignoreMask: true })]), doc([card("c", 0.85, { opacity: 0.4 })]),
    doc([{ ...card("bg", 0), layout: { region: "w", x: 0, y: 0, anchor: [0, 0], width: 2.5, height: 1.4 } }])]) assert.equal(qualityScan(d, frames(d)).length, 0)
})

test("edge-clip：飞入出画的瞬间（< 0.25 s）不报", () => {
  const d = doc([card("c", 1.2)], [{ at: "in", target: "c", property: "x", to: 0, duration: 0.2, ease: "linear", arc: 0 }])
  assert.equal(qualityScan(d, frames(d, new Map([["in", 0]]))).length, 0)
})

test("rect.fill / canvas.background 可写 CSS 渐变（静态）；渐变底不能再写 fill 颜色节点", () => {
  assert.ok(isGradient("linear-gradient(180deg, #fff 0%, #eee 100%)")); assert.ok(isGradient("radial-gradient(circle, #fff, #000)"))
  assert.equal(isGradient("#ffffff"), false)
  const g = "linear-gradient(90deg, #2563EB, #0EA5E9)"
  const d = doc([card("c", 0, { fill: g })], [], 1, "radial-gradient(#fff, #eee)")
  const r = resolveProject(d, new Map())
  assert.equal(r.scene.primitives[0].fill, g); assert.equal(r.scene.background, "radial-gradient(#fff, #eee)")
  assert.throws(() => doc([card("c", 0, { fill: g })], [{ at: "a", target: "c", property: "fill", to: "#000", duration: 1 }]), /CSS 渐变/)
})
