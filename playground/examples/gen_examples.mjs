// 生成官方样片：node playground/examples/gen_examples.mjs [名字…]（需先 npm run build）
// 输出 playground/<name>.scene.json + playground/<name>-timing.json；每支都用 createSceneBuilder 写成。
import { writeFileSync } from "node:fs"
import { topologyFlow } from "./topology-flow.mjs"
import { scaleMatrix } from "./scale-matrix.mjs"
import { canvasHandoff } from "./canvas-handoff.mjs"
import { spatialStage } from "./spatial-stage.mjs"

const ALL = {
  "spatial-stage": spatialStage,
  "topology-flow": topologyFlow,
  "scale-matrix": scaleMatrix,
  "canvas-handoff": canvasHandoff,
}
const pick = process.argv.slice(2)
for (const [name, make] of Object.entries(ALL)) {
  if (pick.length && !pick.includes(name)) continue
  const { scene, timing } = make()
  const dir = new URL("../", import.meta.url)
  writeFileSync(new URL(name + ".scene.json", dir), JSON.stringify(scene, null, 1) + "\n")
  writeFileSync(new URL(name + "-timing.json", dir), JSON.stringify(timing, null, 1) + "\n")
  console.log("✔ " + name + "：" + scene.elements.length + " 元素，" + scene.cues.length + " 节点")
}
