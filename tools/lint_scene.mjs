// docs/02：逐帧采样轨迹检查（lintScene）。用法：npm run lint:scene [-- 场景名…] [--json] [--detail]
// 对 playground/*.scene.json（配同名 -timing.json）逐个检查，打印汇总；有未报备的警告时退出码 1（--warn-only 时仍为 0）。
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { lintScene, lintSummary } from "../dist/index.js"
const args = process.argv.slice(2), flags = new Set(args.filter(a => a.startsWith("--"))), names = args.filter(a => !a.startsWith("--"))
const dir = new URL("../playground/", import.meta.url)
const scenes = (names.length ? names : readdirSync(dir).filter(f => f.endsWith(".scene.json")).map(f => f.slice(0, -11))).sort()
let bad = 0; const all = {}
for (const name of scenes) {
  const doc = JSON.parse(readFileSync(new URL(name + ".scene.json", dir), "utf8"))
  const tf = new URL(name + "-timing.json", dir)
  const anchors = existsSync(tf) ? JSON.parse(readFileSync(tf, "utf8")) : {}
  const list = lintScene(doc, anchors); all[name] = list
  const w = list.filter(x => x.level === "warning"); if (w.length) bad++
  if (flags.has("--json")) continue
  console.log((w.length ? "✖ " : "✔ ") + name.padEnd(16) + lintSummary(list))
  if (flags.has("--detail") || names.length) for (const x of list.slice(0, flags.has("--detail") ? Infinity : 12))
    console.log("    " + (x.level === "warning" ? "⚠" : "·") + " " + x.target + "." + x.property + "  " + x.keyCount + " 个关键帧 · 最密一段 " + x.runKeys + " 个 " +
      x.start.toFixed(2) + "–" + x.end.toFixed(2) + " s · 平均帧距 " + x.meanGap.toFixed(3) + " s" + (x.reason ? " · 原因：" + x.reason : ""))
}
if (flags.has("--json")) console.log(JSON.stringify(all, null, 1))
else console.log("\n" + scenes.length + " 个场景，" + bad + " 个有未报备的逐帧轨迹。逐帧不是错误：请 AI / 人判断——能从原工程读到关键帧的就改写，确需逐帧的写 bakedReason。")
process.exit(bad && !flags.has("--warn-only") ? 1 : 0)
