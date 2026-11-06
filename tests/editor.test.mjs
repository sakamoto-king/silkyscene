// v03：检查器编辑元数据 editor.groups / ungrouped 与 arc 数值编辑
import assert from "node:assert/strict"
import test from "node:test"
import fs from "node:fs"
import { compileTimeline, parseProject, documentField, timingAnchors } from "../dist/index.js"

const P = new URL("../playground/", import.meta.url)
const load = n => [JSON.parse(fs.readFileSync(new URL(n + ".scene.json", P), "utf8")), timingAnchors(JSON.parse(fs.readFileSync(new URL(n + "-timing.json", P), "utf8")))]

test("editor 字段严格校验", () => {
  const [doc] = load("topology-flow")
  assert.doesNotThrow(() => parseProject({ ...doc, editor: { groups: [["a", "b"]], ungrouped: ["c"] } }))
  assert.throws(() => parseProject({ ...doc, editor: { groups: ["a"] } }), /editor/)
  assert.throws(() => parseProject({ ...doc, editor: { lock: true } }), /未知字段：lock/)
})

test("绑定只影响编辑：有无 editor.groups 解算逐帧相同", () => {
  const [doc, an] = load("topology-flow")
  const at = doc.cues.filter(c => c.target === "camera").map(c => c.at)
  const a = compileTimeline(parseProject(doc), an), b = compileTimeline(parseProject({ ...doc, editor: { groups: [at.slice(0, 5)], ungrouped: at.slice(5, 8) } }), an)
  for (let f = 0; f <= 615; f += 7) assert.deepEqual(b.stateAt(f / 30).camera, a.stateAt(f / 30).camera)
})

test("documentField 可改 arc，空值删除", () => {
  const [doc] = load("topology-flow")
  const i = doc.cues.findIndex(c => c.property === "position.x")
  assert.equal(documentField(doc, "cues." + i + ".arc", "0.2").cues[i].arc, 0.2)
  assert.equal("arc" in documentField(doc, "cues." + i + ".arc", "").cues[i], false)
})