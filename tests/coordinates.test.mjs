import assert from "node:assert/strict"
import test from "node:test"
import { parseProject, regionRect } from "../dist/index.js"
import { cameraMatrix, resolveProject } from "../dist/pipeline/resolve.js"
import { projectPoint } from "../dist/shared/cameraGeometry.js"
import { migrateSceneV0ToV1 } from "../tools/migrate_scene_v0_to_v1.mjs"

const old = {
  format: "silkyscene@0",
  canvas: { width: 1920, height: 1080, background: "#fff" },
  regions: [{ id: "main", x: 0, y: 0, width: 1920 / 1080, height: 1 }],
  elements: [
    { id: "corner", kind: "rect", fill: "#111", layout: {
      region: "main", x: "5%", y: "8%", width: "30%", height: "30%", anchor: [0, 0],
    } },
    { id: "middle", kind: "rect", fill: "#222", layout: {
      region: "main", x: 960 / 1080, y: 0.5, width: 0.1, height: 0.1, anchor: [0.5, 0.5],
    } },
    { id: "wire", kind: "line", from: { element: "corner", at: [1, 0.5] },
      to: { element: "middle", at: [0, 0.5] }, color: "#333", width: 0.01 },
  ],
  camera: { projection: "orthographic", target: { x: 960 / 1080, y: -0.5, z: 0 },
    yaw: { rad: Math.PI / 2, cycles: 0 }, pitch: { rad: -Math.PI / 2, cycles: 0 },
    roll: { rad: 0.2, cycles: 2 }, distance: 1, focal: 1, zoom: 1 },
  cues: [
    { target: "camera", at: "pan", property: "target.x", to: 1, duration: 1 },
    { target: "camera", at: "pan", property: "target.y", to: -0.4, duration: 1 },
  ],
}

test("migration preserves layout, ports, target cues, and a nonzero roll", () => {
  const before = structuredClone(old)
  const doc = parseProject(migrateSceneV0ToV1(old))
  assert.deepEqual(old, before)
  assert.deepEqual(regionRect(doc.regions[0]), { x: 0, y: 0, width: 1920, height: 1080 })
  assert.deepEqual(doc.elements[0].layout, {
    region: "main", x: "-45%", y: "42%", width: "30%", height: "30%", anchor: [-1, 1],
  })
  assert.deepEqual(doc.elements[1].layout.anchor, [0, 0])
  assert.deepEqual([doc.elements[2].from.at, doc.elements[2].to.at], [[1, 0], [-1, 0]])
  assert.deepEqual(doc.camera.target, { x: 0, y: 0, z: 0 })
  assert.deepEqual(doc.camera.roll, { rad: -0.2, cycles: -2 })
  assert.deepEqual(doc.cues.map(cue => cue.to), [1 - 960 / 1080, -0.4 + 0.5])
  const { boxes, scene } = resolveProject(doc, new Map())
  const near = (actual, expected) => actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 0.001))
  near(Object.values(boxes.get("corner")), [96, 86.4, 576, 324])
  near(Object.values(boxes.get("middle")), [906, 486, 108, 108])
  const { x1, y1, x2, y2 } = scene.primitives[2]
  near([x1, y1, x2, y2], [672, 248.4, 906, 540])
  const a = Math.cos(0.2), b = Math.sin(0.2)
  const expected = [a, b, -b, a, 960 - a * 960 + b * 540, 540 - b * 960 - a * 540]
  scene.camera.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9))
  assert.ok(projectPoint(scene.camera, [1060, 540])[1] > 540)
  doc.camera.roll.rad = 0.2
  assert.ok(projectPoint(cameraMatrix(doc.camera), [1060, 540])[1] < 540)
})

test("parser reports v0 and rejects invalid centered coordinates", () => {
  assert.throws(() => parseProject(old), /silkyscene@0.*migrate_scene_v0_to_v1/)
  assert.throws(() => migrateSceneV0ToV1(migrateSceneV0ToV1(old)), /只接受 silkyscene@0/)
  const invalid = [
    [doc => { doc.elements[0].layout.anchor = [1.01, 0] }, /anchor.*\[-1, 1\]/],
    [doc => { doc.elements[2].from.at = [0, -1.01] }, /端点 at.*\[-1, 1\]/],
    [doc => { doc.regions[0].x = Infinity }, /中心位置/],
    [doc => { doc.regions[0].width = 0 }, /区域尺寸/],
  ]
  for (const [mutate, message] of invalid) {
    const doc = migrateSceneV0ToV1(old)
    mutate(doc)
    assert.throws(() => parseProject(doc), message)
  }
})
