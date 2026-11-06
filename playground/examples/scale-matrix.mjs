// 样片 2《微距到全局 · 尺度矩阵》约 16.5 s：从一个「3s 单元」特写（zoom 4.6）平滑拉远到整张 5 × 10 时间矩阵（zoom 0.78，约 6 倍跨度），
// 再让矩阵组整体 spring 同缩（文字与徽标一起缩，布局不重排）腾出位置给汇总对比条。
import { createSceneBuilder } from "../../dist/index.js"
import { C, E, F, SHADOW_SM, keyer, px } from "./theme.mjs"

export function scaleMatrix() {
  const b = createSceneBuilder({ background: "linear-gradient(180deg, #FBFBFA 0%, #F2F4F7 100%)" })
  const k = keyer(b)
  b.region("world", { x: 0, y: 0, width: 6, height: 3.6 })
  const COLS = 10, ROWS = ["A · 开场", "B · 问题", "C · 演示", "D · 对比", "E · 收尾"]
  const PATTERN = ["SSMMTMMSSM", "MSSMMTSSMM", "SMMMMTSMMS", "MMSSTMMSSM", "SMMTSSMMSS"]
  const FILL = { M: "#BFDBFE", S: "#E0F2FE", T: "#FED7AA" }
  const MG = { y: 0.06 }, cx = c => -0.455 + c * 0.13, cy = r => 0.225 - r * 0.13
  const HERO = { r: 2, c: 4 }, hx = cx(HERO.c), hy = MG.y + cy(HERO.r)
  b.camera({ zoom: 4.6, target: { x: hx, y: hy, z: 0 }, arc: 0.08 })

  b.group("matrix", { in: "world", y: MG.y, w: 1.6, h: 0.8 })
  b.rect("matrix-bg", { in: "matrix", w: "100%", h: "100%" }, { fill: C.surface, radius: 0.02, shadow: SHADOW_SM, stroke: C.lineSoft, strokeWidth: px(1.5), opacity: 0 })
  b.text("matrix-title", { in: "matrix", x: -0.76, y: 0.355, anchor: [-1, 0] }, "时间矩阵 · 5 个镜头 × 10 个单元 · 每格 3 秒", { fontSize: 0.024, fontFamily: F.ui, weight: 600, color: C.ink, align: "left", opacity: 0 })
  for (let c = 0; c < COLS; c++)
    b.text("col" + c, { in: "matrix", x: cx(c), y: 0.3 }, c * 3 + "s", { fontSize: 0.022, fontFamily: F.mono, color: C.muted, opacity: 0 })
  ROWS.forEach((label, r) => b.text("rowlabel" + r, { in: "matrix", x: -0.76, y: cy(r), anchor: [-1, 0] }, label, { fontSize: 0.026, fontFamily: F.ui, color: C.ink2, align: "left", opacity: 0 }))
  const cells = []
  ROWS.forEach((_, r) => { for (let c = 0; c < COLS; c++) {
    if (r === HERO.r && c === HERO.c) continue
    const id = "cell" + r + "-" + c
    b.rect(id, { in: "matrix", x: cx(c), y: cy(r), w: 0.11, h: 0.11 }, { fill: FILL[PATTERN[r][c]], radius: 0.012, opacity: 0 })
    cells.push({ id, r, c })
  } })
  // 主角单元：一个组（底 + 「3s」+ 刻度），整体 spring 回弹
  b.group("hero", { in: "matrix", x: cx(HERO.c), y: cy(HERO.r), w: 0.11, h: 0.11 }, { scaleX: 0.86, scaleY: 0.86 })
  b.rect("hero-cell", { in: "hero", w: "100%", h: "100%" }, { fill: C.blue, radius: 0.012, shadow: { x: 0, y: px(2), blur: px(8), spread: 0, color: "rgba(37,99,235,0.35)" } })
  b.text("hero-label", { in: "hero", y: 0.006 }, "3s", { fontSize: 0.04, fontFamily: F.display, weight: 700, color: C.surface })
  b.rect("hero-tick", { in: "hero", y: -0.03, w: 0.05, h: px(2) }, { fill: "rgba(255,255,255,0.6)" })
  b.text("hero-note", { in: "world", x: hx, y: hy - 0.072 }, "一个单元 · 3 秒", { fontSize: 0.011, fontFamily: F.mono, color: C.ink2, opacity: 0 })
  b.text("row-note", { in: "world", x: hx, y: hy + 0.105 }, "同一镜头 · 5 × 3s = 15s", { fontSize: 0.022, fontFamily: F.mono, color: C.blue, opacity: 0 })

  // 汇总对比条（矩阵同缩后出场）
  const BX = -0.42
  b.text("sum-a-label", { in: "world", x: -0.8, y: -0.29, anchor: [-1, 0] }, "逐帧手动 K 帧", { fontSize: 0.024, fontFamily: F.ui, color: C.ink2, align: "left", opacity: 0 })
  b.text("sum-b-label", { in: "world", x: -0.8, y: -0.39, anchor: [-1, 0] }, "场景文档 + 解算", { fontSize: 0.024, fontFamily: F.ui, weight: 600, color: C.ink, align: "left", opacity: 0 })
  b.rect("sum-a", { in: "world", x: BX, y: -0.29, anchor: [-1, 0], w: 0.01, h: 0.036 }, { fill: "#CBD5E1", radius: 0.018, opacity: 0 })
  b.rect("sum-b", { in: "world", x: BX, y: -0.39, anchor: [-1, 0], w: 0.01, h: 0.036 }, { fill: C.blue, radius: 0.018, opacity: 0 })
  b.text("sum-a-value", { in: "world", x: BX + 1.12 + 0.025, y: -0.29, anchor: [-1, 0] }, "42 min", { fontSize: 0.024, fontFamily: F.mono, color: C.muted, align: "left", opacity: 0 })
  b.text("sum-b-value", { in: "world", x: BX + 0.17 + 0.025, y: -0.39, anchor: [-1, 0] }, "6 min", { fontSize: 0.024, fontFamily: F.mono, weight: 600, color: C.blue, align: "left", opacity: 0 })

  b.text("brand", { in: "screen", x: -0.83, y: 0.455, anchor: [-1, 1] }, "SilkyScene · 尺度矩阵", { fontSize: 0.018, fontFamily: F.mono, color: C.muted, align: "left" })
  b.group("hud", { in: "screen", y: -0.43, w: 1.12, h: 0.066 })
  b.rect("hud-bar", { in: "hud", w: "100%", h: "100%" }, { fill: "rgba(15,23,42,0.88)", radius: 0.033 })
  b.text("hud-step", { in: "hud", x: -0.525, anchor: [-1, 0] }, "01 / 04", { fontSize: 0.018, fontFamily: F.mono, color: "#93C5FD", align: "left" })
  b.text("hud-line", { in: "hud", x: 0.035 }, "从一个 3 秒单元开始", { fontSize: 0.024, fontFamily: F.ui, weight: 500, color: "#F8FAFC" })

  // ── 1 · 微距（0–3.2）──
  b.segment("s1", 0, 3.2, "从一个 3 秒单元开始。").step("macro", 1.5, "一个 3 秒单元")
  k(0.2, "hero", "scale", 1.2, 1, { ease: E.SPRING })
  k(0.6, "hero-note", "opacity", 0.5, 1, { ease: E.OUT })
  k(0, "camera", "zoom", 3.2, 4.45, { ease: E.SOFT, interpolation: "log" })
  // ── 2 · 一个镜头（3.2–7）──
  b.segment("s2", 3.2, 7, "拉远：同一镜头里排着 5 个单元。").step("shot", 6.9, "同一镜头的 5 个单元")
  k(3.2, "hud-step", "text", 0, "02 / 04"); k(3.2, "hud-line", "text", 0, "拉远：同一镜头里排着 5 个单元")
  k(3.2, "hero-note", "opacity", 0.3, 0)
  k(3.2, "camera", "zoom", 2.2, 1.9, { ease: E.IN_OUT, interpolation: "log" })
  ;[3, 5, 2, 6].forEach((c, i) => k(5.0 + i * 0.12, "cell" + HERO.r + "-" + c, "opacity", 0.45, 1, { ease: E.OUT }))
  k(5.4, "row-note", "opacity", 0.5, 1, { ease: E.OUT })
  k(5.4, "camera", "zoom", 1.6, 1.86, { ease: E.SOFT, interpolation: "log" })
  // ── 3 · 整张矩阵（7–11）：目标点从主角单元滑到矩阵中心，zoom 1.86 → 0.86 ──
  b.segment("s3", 7, 11, "再拉远：整条片子是一张时间矩阵。").step("matrix", 10, "整条片子是一张矩阵")
  k(7, "hud-step", "text", 0, "03 / 04"); k(7, "hud-line", "text", 0, "再拉远：整条片子是一张时间矩阵")
  k(7, "row-note", "opacity", 0.4, 0)
  k(7, "camera", "zoom", 2.6, 0.86, { ease: E.IN_OUT, interpolation: "log" })
  k(7, "camera", "target.x", 2.6, 0, { ease: E.IN_OUT })
  k(7, "camera", "target.y", 2.6, MG.y, { ease: E.IN_OUT })
  for (const cell of cells) {
    if (cell.r === HERO.r && [2, 3, 5, 6].includes(cell.c)) continue
    const dist = Math.hypot(cell.c - HERO.c, (cell.r - HERO.r) * 1.6)
    k(8.3 + dist * 0.09, cell.id, "opacity", 0.4, 1, { ease: E.OUT })
  }
  k(8.8, "matrix-bg", "opacity", 0.6, 1, { ease: E.OUT })
  k(9.2, "matrix-title", "opacity", 0.5, 1)
  for (let c = 0; c < COLS; c++) k(9.2 + c * 0.03, "col" + c, "opacity", 0.4, 1)
  ROWS.forEach((_, r) => k(9.3 + r * 0.06, "rowlabel" + r, "opacity", 0.4, 1))
  // ── 4 · 整体同缩，腾位置给结论（11–16.5）──
  b.segment("s4", 11, 16.5, "整体同缩、零重排：同一份坐标，6 倍尺度跨度也不抖。").step("summary", 16.5, "整体同缩，给出结论")
  k(11, "hud-step", "text", 0, "04 / 04"); k(11, "hud-line", "text", 0, "整体同缩、零重排：同一份坐标，6 倍尺度也不抖")
  k(11, "matrix", "scale", 1.4, 0.86, { ease: E.SPRING_SOFT })
  k(11, "matrix", "y", 1.4, 0.13, { ease: E.IN_OUT, arc: 0 })
  k(11, "camera", "zoom", 1.6, 0.78, { ease: E.IN_OUT, interpolation: "log" })
  k(11, "camera", "target.y", 1.6, 0.02, { ease: E.IN_OUT })
  for (const id of ["sum-a-label", "sum-b-label", "sum-a", "sum-b"]) k(11.9, id, "opacity", 0.4, 1)
  k(12.1, "sum-a", "width", 1.3, 1.12, { ease: E.SPRING_SOFT })
  k(12.5, "sum-b", "width", 1.0, 0.17, { ease: E.SPRING })
  k(13.3, "sum-a-value", "opacity", 0.4, 1); k(13.5, "sum-b-value", "opacity", 0.4, 1)
  k(13.6, "hero", "scale", 0.9, 1.12, { ease: E.SPRING })
  k(12.6, "camera", "zoom", 3.9, 0.79, { ease: E.SOFT, interpolation: "log" })
  return b.build()
}
