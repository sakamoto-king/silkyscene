import assert from "node:assert/strict"
import test from "node:test"
import { createSceneBuilder, parseProject, compileTimeline, px } from "../dist/index.js"

const tiny = () => {
  const b = createSceneBuilder({ background: "#FAFAF8" })
  b.region("main", { x: 0, y: 0, width: 16 / 9, height: 1 })
  b.rect("card", { in: "main", w: 0.6, h: 0.3 }, { fill: "#FFFFFF", radius: 0.02 })
  b.group("box", { in: "main", w: 0.6, h: 0.3 })
  b.text("title", { in: "box" }, "Hello", { fontSize: 0.04, opacity: 0 })
  return b
}

test("createSceneBuilder 产出标准 silkyscene@1 JSON（与手写等价）+ 时间表", () => {
  const b = tiny()
  b.cue("title-in", 0.4, "title", "opacity", 0.5, 1, { ease: "ease-out" })
  b.segment("s1", 0, 2, "开场").step("open", 0, "开场")
  const { scene, timing } = b.build()
  assert.equal(scene.format, "silkyscene@1")
  assert.deepEqual(scene.canvas, { width: 1920, height: 1080, background: "#FAFAF8" })
  assert.deepEqual(scene.elements[0], { id: "card", kind: "rect", layout: { region: "main", x: 0, y: 0, anchor: [0, 0], width: 0.6, height: 0.3 }, fill: "#FFFFFF", radius: 0.02 })
  assert.deepEqual(scene.elements[2].layout, { region: "box", x: 0, y: 0, anchor: [0, 0] })
  assert.equal(scene.elements[2].align, "center"); assert.equal(scene.elements[2].color, "#0C0C0C")
  assert.deepEqual(scene.cues, [{ at: "title-in", target: "title", property: "opacity", duration: 0.5, to: 1, ease: "ease-out" }])
  assert.deepEqual(timing, { "title-in": 0.4, segments: [{ name: "s1", start: 0, end: 2, text: "开场" }], steps: [{ id: "open", at: 0, title: "开场" }] })
  // round-trips through the strict parser and the timeline compiler
  assert.doesNotThrow(() => compileTimeline(parseProject(JSON.parse(JSON.stringify(scene))), new Map([["title-in", 0.4]])))
  assert.equal(px(54), 0.05)
})

test("锚点防冲突：同名锚点只能同一时刻；重名 ID 立即报错", () => {
  const b = tiny()
  b.cue("beat", 1, "title", "opacity", 0.3, 1)
  assert.doesNotThrow(() => b.cue("beat", 1, "card", "opacity", 0.3, 0.5))
  assert.throws(() => b.cue("beat", 1.2, "card", "opacity", 0.3, 1), /锚点「beat」已登记为 1 s/)
  assert.throws(() => b.rect("card", { in: "main", w: 0.1, h: 0.1 }, { fill: "#000" }), /重复/)
  assert.throws(() => b.region("screen", { x: 0, y: 0, width: 1, height: 1 }), /重复/)
})

test("build() 跑严格校验：拼错字段 / 无效节点在生成脚本里就报出来", () => {
  const b = tiny()
  b.rect("bad", { in: "main", w: 0.1, h: 0.1 }, { fill: "#000", radus: 0.01 })
  assert.throws(() => b.build(), /未知字段：radus/)
  const c = tiny()
  c.cue("x", 0, "title", "arc", 1, 1)
  assert.throws(() => c.build(), /节点属性或值无效/)
})

test("相机与线、空对象、motionPath 选项照原样写入", () => {
  const b = tiny()
  b.null("hub", { in: "main", x: 0.3 })
  b.line("wire", ["card", [1, 0]], ["hub", [0, 0]], { curve: "horizontal", width: px(3) })
  b.camera({ zoom: 1.2, view3d: { distance: 2 }, position: { x: 0, y: 0, z: 2 } })
  b.cue("pan", 0, "camera", "position.x", 1, 0.2, { ease: "sine-in-out" })
  b.cue("pan", 0, "hub", "motionPath", 1, undefined, { path: { curve: "linear", points: [[0.3, 0], [0.4, 0.1]] } })
  const { scene } = b.build()
  assert.equal(scene.camera.zoom, 1.2); assert.equal(scene.camera.projection, "orthographic")
  assert.deepEqual(scene.elements.find(e => e.id === "wire").from, { element: "card", at: [1, 0] })
  assert.equal("to" in scene.cues[1], false)
})
