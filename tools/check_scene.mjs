// 场景硬校验入口：用法 node tools/check_scene.mjs <场景名...>
// 对每个 playground/<name>.scene.json + <name>-timing.json 执行：
//   1. parseProject + compileTimeline（严格 schema、锚点、缓动、双节点相机规则）
//   2. 逐帧 resolveProject（全时间轴 30fps + 所有锚点边界：区域越界、相机 maxOvershoot、最大倾角 maxTilt、文本测量估算防撞框）
//   3. lintScene（0 未报备逐帧轨迹警告）
//   4. qualityScan 画面质量警告：屏幕实测字号 < 13 px（--min-font 改阈值）、文字 / 卡片被取景框边缘裁切
// 选项：--strict 质量警告也算失败（退出码 1）；--min-font <px>；--fps <n> 采样帧率（默认 30）
import { readFileSync } from "node:fs"
import { parseProject, compileTimeline, lintScene, lintSummary, parseTiming, qualityScan } from "../dist/index.js"
import { DESIGN_PIXELS_PER_UNIT, pixels } from "../dist/pipeline/definition.js"
import { resolveProject } from "../dist/pipeline/resolve.js"
import { checkTimes, atTime } from "../dist/pipeline/render.js"

function estimateMeasurement(doc) {
  const m = new Map()
  const regions = new Map(doc.regions.map(r => [r.id, r]))
  const groups = new Map(doc.elements.filter(e => e.kind === "group").map(e => [e.id, e]))
  const sizeOf = (id, axis) => {
    if (id === "screen") return axis === "width" ? doc.canvas.width : doc.canvas.height
    const r = regions.get(id)
    if (r) return r[axis] * DESIGN_PIXELS_PER_UNIT
    const g = groups.get(id)
    return g ? pixels(g.layout[axis], sizeOf(g.layout.region, axis)) : (axis === "width" ? doc.canvas.width : doc.canvas.height)
  }
  for (const e of doc.elements) {
    if (e.kind === "image") m.set(e.id, { width: 64, height: 64, src: e.src })
    else if (e.kind === "text") {
      const fs = e.fontSize * DESIGN_PIXELS_PER_UNIT
      const lh = fs * (e.lineHeight ?? 1.2)
      const lines = String(e.text || " ").split("\n")
      const linePx = s => [...s].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? fs * 0.88 : fs * 0.48), 0)
      const containerW = sizeOf(e.layout.region, "width"), containerH = sizeOf(e.layout.region, "height")
      const w = e.layout.width !== undefined ? pixels(e.layout.width, containerW) : Math.min(containerW * 0.95, Math.max(1, ...lines.map(linePx)))
      const h = e.layout.height !== undefined ? pixels(e.layout.height, containerH) : Math.max(1, lines.length * lh)
      m.set(e.id, { width: w, height: h })
    }
  }
  return m
}

const argv = process.argv.slice(2)
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const strict = argv.includes("--strict")
const minFontPx = Number(flag("--min-font") ?? 13), fps = Number(flag("--fps") ?? 30)
const valueFlags = new Set(["--min-font", "--fps"])
const names = argv.filter((a, i) => !a.startsWith("--") && !valueFlags.has(argv[i - 1]))
if (!names.length) {
  console.error("用法: node tools/check_scene.mjs <场景名...>")
  process.exit(2)
}
const dir = new URL("../playground/", import.meta.url)
let failed = 0
for (const name of names) {
  try {
    const rawDoc = JSON.parse(readFileSync(new URL(name + ".scene.json", dir), "utf8"))
    const rawTiming = JSON.parse(readFileSync(new URL(name + "-timing.json", dir), "utf8"))
    const doc = parseProject(rawDoc)
    const { anchors } = parseTiming(rawTiming) // 忽略 segments 等非数字键
    const tl = compileTimeline(doc, anchors)
    const times = checkTimes(tl.boundaries, fps)
    const measured = estimateMeasurement(doc)
    resolveProject(doc, measured)
    const frames = []
    for (const t of times) {
      const r = atTime(t, () => resolveProject(doc, measured, tl.stateAt(t)))
      if (Math.abs(t * fps - Math.round(t * fps)) < 1e-6) frames.push({ time: t, scene: r.scene, boxes: r.boxes })
    }
    const warnings = lintScene(doc, anchors).filter(w => w.level === "warning")
    const quality = qualityScan(doc, frames, { minFontPx })
    if (warnings.length) {
      failed++
      console.error(`✖ ${name}: ${lintSummary(warnings)}`)
      for (const w of warnings) console.error(`    ⚠ ${w.target}.${w.property}: ${w.keyCount} keys (${w.start.toFixed(2)}–${w.end.toFixed(2)}s)`)
    }
    if (quality.length) {
      if (strict) failed++
      const bad = strict ? console.error : console.warn
      bad(`${strict ? "✖" : "⚠"} ${name}: 画面质量警告 ${quality.length} 条（字号过小 ${quality.filter(q => q.kind === "small-text").length} · 边缘裁切 ${quality.filter(q => q.kind === "edge-clip").length}）`)
      for (const q of quality.slice(0, 40)) bad(`    ⚠ ${q.message}`)
      if (quality.length > 40) bad(`    … 另有 ${quality.length - 40} 条`)
    }
    if (!warnings.length) {
      const endSec = times[times.length - 1] ?? 0
      console.log(`✔ ${name}: 解算通过（${doc.elements.length} 元素, ${doc.cues.length} 节点, ${endSec.toFixed(1)}s, 0 逐帧警告, ${quality.length} 质量警告） -> http://127.0.0.1:5311/playground/inspector.html?doc=${name}`)
    }
  } catch (e) {
    failed++
    console.error(`✖ ${name}: ${(e && e.message) || e}`)
  }
}
process.exit(failed ? 1 : 0)
