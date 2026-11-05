import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

function finite(value, field) {
  if (!Number.isFinite(value)) throw new Error(`${field} 须为有限数值`)
  return value
}

function centeredPoint(value, field) {
  if (!Array.isArray(value) || value.length !== 2 ||
      !value.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
    throw new Error(`${field} 须为旧格式的 [0, 1] 坐标对`)
  }
  return [2 * value[0] - 1, 1 - 2 * value[1]]
}

function centeredOffset(value, size, direction, field) {
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?%$/.test(value)) {
    const offset = direction * (finite(Number(value.slice(0, -1)), field) - 50)
    // Keep the decimal precision of the input and avoid exponent notation in % strings.
    const precision = (value.slice(0, -1).split(".")[1] ?? "").length
    return `${offset.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: Math.min(precision, 100) })}%`.replace(/^-0%$/, "0%")
  }
  return direction * (finite(value, field) - size / 2)
}

/** Convert a v0 scene without changing its time map, dimensions, or assets. */
export function migrateSceneV0ToV1(input) {
  if (input?.format !== "silkyscene@0") throw new Error("迁移脚本只接受 silkyscene@0")
  const document = structuredClone(input)
  const { canvas, regions, elements, camera, cues } = document
  if (canvas?.width !== 1920 || canvas.height !== 1080) throw new Error("旧版画幅须为 1920 × 1080")
  const halfWidth = canvas.width / (2 * canvas.height)
  const halfHeight = 0.5
  const byRegion = new Map()
  for (const region of regions) {
    const { id, x, y, width, height } = region
    if (finite(width, `${id}.width`) <= 0 || finite(height, `${id}.height`) <= 0 || byRegion.has(id)) {
      throw new Error(`区域 ${id} 的尺寸或 ID 无效`)
    }
    region.x = finite(x, `${id}.x`) + width / 2 - halfWidth
    region.y = finite(y, `${id}.y`) - height / 2 + halfHeight
    byRegion.set(id, region)
  }
  for (const element of elements) {
    const { id, layout } = element
    if (element.kind === "line") {
      element.from.at = centeredPoint(element.from.at, `${id}.from.at`)
      element.to.at = centeredPoint(element.to.at, `${id}.to.at`)
      continue
    }
    const region = byRegion.get(layout?.region)
    if (!region) throw new Error(`元素 ${id} 的所属区域无效`)
    layout.x = centeredOffset(layout.x, region.width, 1, `${id}.layout.x`)
    layout.y = centeredOffset(layout.y, region.height, -1, `${id}.layout.y`)
    layout.anchor = centeredPoint(layout.anchor, `${id}.layout.anchor`)
  }
  camera.target.x = finite(camera.target.x, "camera.target.x") - halfWidth
  camera.target.y = finite(camera.target.y, "camera.target.y") + halfHeight
  camera.roll.rad = -finite(camera.roll.rad, "camera.roll.rad")
  camera.roll.cycles = -finite(camera.roll.cycles, "camera.roll.cycles")
  for (const cue of cues) {
    if (cue.target !== "camera") continue
    if (cue.property === "target.x") cue.to = finite(cue.to, "cue.target.x") - halfWidth
    if (cue.property === "target.y") cue.to = finite(cue.to, "cue.target.y") + halfHeight
  }
  document.format = "silkyscene@1"
  return document
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [, , input, output, ...rest] = process.argv
    if (!input || !output || rest.length) {
      throw new Error("用法：node tools/migrate_scene_v0_to_v1.mjs <旧场景.json> <新场景.json>")
    }
    const source = JSON.parse((await readFile(input, "utf8")).replace(/^\uFEFF/, ""))
    const migrated = migrateSceneV0ToV1(source)
    await writeFile(output, JSON.stringify(migrated, null, 2) + "\n", { flag: "wx" })
  } catch (error) {
    console.error(error.code === "EEXIST" ? "目标文件已存在，请指定新文件名" : error.message)
    process.exitCode = 1
  }
}
