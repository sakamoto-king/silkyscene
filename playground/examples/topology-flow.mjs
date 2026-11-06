// 样片 1《清单到拓扑 · 依赖重排》约 20.5 s：锯齿撕口清单 → 5 个核心条目（同一组对象）沿弧线飞出成 1 → 3 → 1 依赖图
// → 水平贝塞尔连线生长 → 双节点透视相机推向左侧根因 → 解锁后脉冲三路并行汇聚终点。
import { createSceneBuilder } from "../../dist/index.js"
import { C, E, F, SHADOW, SHADOW_SM, horizontalCurve, keyer, px } from "./theme.mjs"

export function topologyFlow() {
  const D = 1.8 // 双节点相机：摄像机离画面高度（u）
  const b = createSceneBuilder({ background: "radial-gradient(120% 90% at 50% 40%, #FFFFFF 0%, #F6F7F9 55%, #EEF1F5 100%)" })
  b.camera({ zoom: 1.12, arc: 0.1, view3d: { distance: D, maxTilt: 20 }, position: { x: 0, y: 0, z: D } })
  const k = keyer(b)
  b.region("world", { x: 0, y: 0, width: 6, height: 3.6 })

  // ── 清单纸：一个组，撕口用 path 锯齿，下层再垫一条错位的淡阴影锯齿 ──
  const W = 0.56, PAPER_H = 0.70
  b.group("receipt", { in: "world", y: -0.025, w: W, h: 0.73 }, { opacity: 0 })
  const teeth = 20, tw = 560 / teeth
  let d = "M0 0 H560"
  for (let i = teeth; i > 0; i--) d += " L" + (i * tw - tw / 2).toFixed(1) + " 18 L" + ((i - 1) * tw).toFixed(1) + " 0"
  d += " Z"
  b.path("paper-edge-shade", { in: "receipt", x: 0, y: -0.335 - px(4), anchor: [0, 1], w: W, h: 0.02 }, d, [560, 20], { fill: "rgba(15,23,42,0.07)" })
  b.rect("paper", { in: "receipt", y: 0.365, anchor: [0, 1], w: W, h: PAPER_H }, { fill: C.surface, shadow: SHADOW })
  b.path("paper-edge", { in: "receipt", x: 0, y: -0.335 + px(1), anchor: [0, 1], w: W, h: 0.02 }, d, [560, 20], { fill: C.surface })
  b.text("paper-kicker", { in: "receipt", x: -0.24, y: 0.32, anchor: [-1, 0] }, "TODAY · TO-DO", { fontSize: 0.018, fontFamily: F.mono, color: C.muted, align: "left", letterSpacing: 0.002 })
  b.text("paper-title", { in: "receipt", x: -0.24, y: 0.275, anchor: [-1, 0] }, "今天要做的 11 件事", { fontSize: 0.03, fontFamily: F.display, weight: 700, color: C.ink, align: "left" })
  b.rect("paper-rule", { in: "receipt", y: 0.242, w: 0.48, h: px(2) }, { fill: C.line })
  b.rect("paper-rule-2", { in: "receipt", y: -0.262, w: 0.48, h: px(2) }, { fill: C.line })
  b.text("paper-total", { in: "receipt", x: -0.24, y: -0.295, anchor: [-1, 0] }, "合计 11 项", { fontSize: 0.018, fontFamily: F.mono, color: C.muted, align: "left" })
  b.text("paper-state", { in: "receipt", x: 0.24, y: -0.295, anchor: [1, 0] }, "全部 · 待办", { fontSize: 0.018, fontFamily: F.mono, color: C.muted, align: "right" })

  const ROWS = ["回复客户邮件", "写接口文档", "订周五会议室", "设计稿评审", "整理周报", "更新依赖版本", "确定方案边界", "报销上月发票", "准备测试用例", "看两篇行业文章", "上线发布"]
  const rowY = i => 0.205 - i * 0.044 - 0.025 // 世界坐标（纸组起始中心 y = -0.025，落定 0.035）
  // 核心条目：行号 → 依赖图节点
  const CORE = { 6: { id: "root", n: "01", at: [-0.95, 0] }, 1: { id: "mid-a", n: "02", at: [0, 0.3] }, 3: { id: "mid-b", n: "03", at: [0, 0] },
    8: { id: "mid-c", n: "04", at: [0, -0.3] }, 10: { id: "end", n: "05", at: [0.95, 0] } }
  ROWS.forEach((label, i) => {
    if (CORE[i]) return
    const y = rowY(i) + 0.025
    b.rect("row" + i + "-box", { in: "receipt", x: -0.23, y, anchor: [-1, 0], w: 0.022, h: 0.022 }, { fill: C.surface, stroke: C.faint, strokeWidth: px(2), radius: px(4), opacity: 0 })
    b.text("row" + i, { in: "receipt", x: -0.17, y, anchor: [-1, 0] }, label, { fontSize: 0.024, fontFamily: F.ui, color: C.ink2, align: "left", opacity: 0 })
  })

  // 依赖连线（先声明，画在卡片下面），脉冲在连线之上、卡片之下
  const mids = ["mid-a", "mid-b", "mid-c"]
  for (const m of mids) {
    b.line("l-root-" + m, ["root-card", [1, 0]], [m + "-card", [-1, 0]], { color: C.faint, width: px(3), curve: "horizontal", trim: 0, opacity: 0, cap: "round" })
    b.line("l-" + m + "-end", [m + "-card", [1, 0]], ["end-card", [-1, 0]], { color: C.faint, width: px(3), curve: "horizontal", trim: 0, opacity: 0, cap: "round" })
  }
  const CW = 0.46 * 1.15 / 2 // 卡片可视半宽
  mids.forEach((m, i) => {
    const y = CORE[[1, 3, 8][i]].at[1]
    const s1 = horizontalCurve([-0.95 + CW, 0], [-CW, y]), s2 = horizontalCurve([CW, y], [0.95 - CW, 0])
    const points = [...s1, [-CW / 3, y], [CW / 3, y], [CW, y], ...s2.slice(1)]
    b.rect("pulse-" + m, { in: "world", x: -0.95 + CW, y: 0, w: 0.026, h: 0.026 }, { fill: C.blue, radius: 0.013, opacity: 0,
      shadow: { x: 0, y: 0, blur: px(18), spread: px(3), color: "rgba(37,99,235,0.45)" } })
    k(15.9 + i * 0.08, "pulse-" + m, "opacity", 0.15, 1)
    k(15.9 + i * 0.08, "pulse-" + m, "motionPath", 1.9, undefined, { path: { curve: "cubic", points }, ease: E.SOFT })
    k(17.75 + i * 0.08, "pulse-" + m, "opacity", 0.25, 0)
  })

  // 核心条目：每个都是一个组（底卡 + 高亮 + 勾选框 / 编号 + 文字），从清单行原位飞到依赖图
  Object.entries(CORE).forEach(([i, node]) => {
    const g = node.id, y = rowY(Number(i))
    b.group(g, { in: "world", x: 0, y, w: 0.5, h: 0.04 }, { arc: 0.22 })
    b.rect(g + "-card", { in: g, w: "100%", h: "100%" }, { fill: C.surface, stroke: C.line, strokeWidth: px(1.5), radius: 0.014, shadow: SHADOW_SM, opacity: 0 })
    if (g === "root") b.rect("root-block", { in: g, w: "100%", h: "100%" }, { fill: "rgba(255,247,237,0.92)", stroke: C.amber, strokeWidth: px(2), radius: 0.014, opacity: 0,
      stripes: { angle: 45, color1: "rgba(217,119,6,0.16)", color2: "rgba(217,119,6,0)", size: px(9), size2: px(9) } })
    b.rect(g + "-hl", { in: g, w: "100%", h: "100%" }, { fill: C.blueSoft, radius: px(6), opacity: 0 })
    b.rect(g + "-box", { in: g, x: "-46%", anchor: [-1, 0], w: 0.022, h: 0.022 }, { fill: C.surface, stroke: C.faint, strokeWidth: px(2), radius: px(4), opacity: 0 })
    b.rect(g + "-badge", { in: g, x: "-46%", anchor: [-1, 0], w: 0.036, h: 0.03 }, { fill: C.blueSoft, radius: px(6), opacity: 0 })
    b.text(g + "-no", { in: g, x: "-46%", anchor: [-1, 0], w: 0.036, h: 0.03 }, node.n, { fontSize: 0.02, fontFamily: F.mono, weight: 600, color: C.blue, opacity: 0 })
    b.text(g + "-label", { in: g, x: "-34%", anchor: [-1, 0] }, ROWS[i], { fontSize: 0.024, fontFamily: F.ui, weight: 500, color: C.ink2, align: "left", opacity: 0 })
  })

  // 注记与 HUD
  b.text("queue-note", { in: "world", x: 0.34, y: 0.02, anchor: [-1, 0] }, "11 项 · 一条直线排队", { fontSize: 0.022, fontFamily: F.mono, color: C.ink2, align: "left",
    background: C.surface, padding: [0.014, 0.008], stroke: C.line, strokeWidth: px(1.5), opacity: 0 })
  b.text("root-chip", { in: "world", x: -0.95, y: 0.15, anchor: [0, -1] }, "阻塞全局 · 3 件事在等它", { fontSize: 0.022, fontFamily: F.ui, weight: 600, color: C.surface, align: "center",
    background: C.amber, padding: [0.014, 0.007], opacity: 0 })
  b.text("end-chip", { in: "world", x: 0.95, y: 0.15, anchor: [0, -1] }, "自动顺流而下", { fontSize: 0.022, fontFamily: F.ui, weight: 600, color: C.surface, align: "center",
    background: C.blue, padding: [0.014, 0.007], opacity: 0 })
  b.text("brand", { in: "screen", x: -0.83, y: 0.455, anchor: [-1, 1] }, "SilkyScene · 清单到拓扑", { fontSize: 0.018, fontFamily: F.mono, color: C.muted, align: "left" })
  b.group("hud", { in: "screen", y: -0.43, w: 1.12, h: 0.066 }, { opacity: 0 })
  b.rect("hud-bar", { in: "hud", w: "100%", h: "100%" }, { fill: "rgba(15,23,42,0.88)", radius: 0.033 })
  b.text("hud-step", { in: "hud", x: -0.525, anchor: [-1, 0] }, "01 / 05", { fontSize: 0.018, fontFamily: F.mono, color: "#93C5FD", align: "left" })
  b.text("hud-line", { in: "hud", x: 0.035 }, "很多人每天列十几条待办，越列越焦虑", { fontSize: 0.024, fontFamily: F.ui, weight: 500, color: "#F8FAFC" })

  // ── 1 · 清单（0–4.5）──
  b.segment("s1", 0, 4.5, "很多人每天列十几条待办，越列越焦虑，总觉得是自己执行力不行。").step("list", 2.6, "清单越列越长")
  k(0, "camera", "zoom", 4.5, 1.05, { ease: E.SOFT, interpolation: "log" })
  k(0.1, "receipt", "opacity", 0.8, 1, { ease: E.OUT })
  k(0.1, "receipt", "y", 1.1, 0.035, { ease: E.OUT, arc: 0 })
  k(0.2, "hud", "opacity", 0.6, 1, { ease: E.OUT })
  ROWS.forEach((_, i) => {
    const t = 0.9 + i * 0.12
    if (CORE[i]) { const g = CORE[i].id; k(t, g + "-box", "opacity", 0.35, 1); k(t, g + "-label", "opacity", 0.35, 1) }
    else { k(t, "row" + i + "-box", "opacity", 0.35, 1); k(t, "row" + i, "opacity", 0.35, 1) }
  })
  // 核心条目的行位置跟着纸一起上来（纸 y: -0.06 → 0）
  for (const node of Object.values(CORE)) k(0.1, node.id, "y", 1.1, rowY(Number(Object.keys(CORE).find(i => CORE[i] === node))) + 0.06, { ease: E.OUT, arc: 0 })

  // ── 2 · 压成小票（4.5–8）──
  b.segment("s2", 4.5, 8, "其实问题不在你慢，在于你把一张「路线图」，压成了一张上下排队的「购物小票」。").step("receipt", 7.9, "路线图被压成小票")
  k(4.5, "camera", "zoom", 3.3, 1.11, { ease: E.SOFT, interpolation: "log" })
  k(4.5, "hud-step", "text", 0, "02 / 05"); k(4.5, "hud-line", "text", 0, "问题不在慢：一张「路线图」被压成了排队的「购物小票」")
  ROWS.forEach((_, i) => { if (!CORE[i]) { k(4.7, "row" + i, "opacity", 0.6, 0.38); k(4.7, "row" + i + "-box", "opacity", 0.6, 0.38) } })
  Object.values(CORE).forEach((n, j) => { k(4.8 + j * 0.1, n.id + "-hl", "opacity", 0.5, 1, { ease: E.OUT }); k(4.8 + j * 0.1, n.id + "-label", "color", 0.5, C.ink) })
  k(5.6, "queue-note", "opacity", 0.5, 1, { ease: E.OUT })
  k(5.6, "queue-note", "x", 0.6, 0.36, { ease: E.OUT })

  // ── 3 · 拉开镜头，重排成依赖图（8–11）──
  b.segment("s3", 8, 12.5, "只要把镜头拉开，按先后依赖重新连起来。").step("reflow", 12.45, "拉开镜头，按依赖重排")
  k(8, "hud-step", "text", 0, "03 / 05"); k(8, "hud-line", "text", 0, "把镜头拉开，按先后依赖重新连起来")
  k(8, "camera", "zoom", 2.5, 0.66, { ease: E.IN_OUT, interpolation: "log" })
  k(8, "receipt", "opacity", 0.9, 0, { ease: E.IN_OUT })
  k(8, "queue-note", "opacity", 0.4, 0)
  Object.values(CORE).forEach((n, j) => {
    const t = 8.1 + j * 0.12, g = n.id
    k(t, g, "x", 1.7, n.at[0], { ease: E.IN_OUT }); k(t, g, "y", 1.7, n.at[1], { ease: E.IN_OUT })
    k(t, g, "width", 1.7, 0.46, { ease: E.IN_OUT }); k(t, g, "height", 1.7, 0.12, { ease: E.IN_OUT })
    k(t, g, "scale", 1.7, 1.15, { ease: E.IN_OUT })
    k(t + 0.2, g + "-card", "opacity", 1.0, 1, { ease: E.OUT }); k(t + 0.2, g + "-hl", "opacity", 0.8, 0)
    k(t + 0.2, g + "-box", "opacity", 0.4, 0); k(t + 0.5, g + "-badge", "opacity", 0.6, 1); k(t + 0.5, g + "-no", "opacity", 0.6, 1)
  })
  // ── 连线生长（11–12.5）──
  k(11, "camera", "zoom", 1.5, 0.655, { ease: E.SOFT, interpolation: "log" })
  mids.forEach((m, i) => {
    k(11 + i * 0.1, "l-root-" + m, "opacity", 0, 1); k(11 + i * 0.1, "l-root-" + m, "trim", 0.8, 1, { ease: E.OUT })
    k(11.5 + i * 0.1, "l-" + m + "-end", "opacity", 0, 1); k(11.5 + i * 0.1, "l-" + m + "-end", "trim", 0.8, 1, { ease: E.OUT })
  })

  // ── 4 · 推向根因（12.5–15.5）：双节点相机，position 同步 75%，approach 重叠补完 25% 归回垂直 ──
  b.segment("s4", 12.5, 15.5, "你会发现这五件事里，真正卡住全局的只有最左边这一格。").step("root", 15.4, "真正卡住全局的一格")
  k(12.5, "hud-step", "text", 0, "04 / 05"); k(12.5, "hud-line", "text", 0, "真正卡住全局的，只有最左边这一格")
  k(12.5, "camera", "target.x", 2.5, -0.6, { ease: E.IN_OUT })
  k(12.5, "camera", "position.x", 2.5, -0.6 * 0.75, { ease: E.IN_OUT })
  k(13.3, "camera", "approach.x", 2.2, -0.6 * 0.25, { ease: E.IN_OUT, arc: 0 })
  k(12.5, "camera", "zoom", 2.6, 0.78, { ease: E.IN_OUT, interpolation: "log" })
  k(12.5, "camera", "position.z", 2.6, 1.62, { ease: E.SOFT })
  for (const g of [...mids, "end"]) k(12.5, g, "opacity", 0.5, 0.4)
  for (const l of mids.flatMap(m => ["l-root-" + m, "l-" + m + "-end"])) k(12.5, l, "opacity", 0.5, 0.45)
  k(13.4, "root-block", "opacity", 0.6, 1, { ease: E.OUT })
  k(13.6, "root-chip", "opacity", 0.5, 1, { ease: E.OUT }); k(13.6, "root-chip", "y", 0.6, 0.16, { ease: E.OUT })

  // ── 5 · 打通根因，脉冲三路并行汇聚（15.5–20.5）──
  b.segment("s5", 15.5, 20.5, "先打通这一个节点，后面四件事会自动顺流而下。").step("unlock", 20.5, "打通节点，顺流而下")
  k(15.5, "hud-step", "text", 0, "05 / 05"); k(15.5, "hud-line", "text", 0, "先打通这一个节点，后面四件事自动顺流而下")
  k(15.5, "root-block", "opacity", 0.5, 0)
  k(15.5, "root-card", "fill", 0.5, C.blue); k(15.5, "root-card", "strokeColor", 0.5, C.blue)
  k(15.5, "root-label", "color", 0.5, C.surface); k(15.5, "root-badge", "fill", 0.5, C.surface)
  k(15.5, "root-chip", "text", 0, "已打通 · 依赖放行"); k(15.5, "root-chip", "background", 0.5, C.blueDeep)
  k(15.8, "camera", "target.x", 2.8, 0, { ease: E.IN_OUT })
  k(15.8, "camera", "position.x", 2.8, 0, { ease: E.IN_OUT })
  k(16.6, "camera", "approach.x", 2.4, 0, { ease: E.IN_OUT, arc: 0 })
  k(15.8, "camera", "zoom", 2.8, 0.66, { ease: E.IN_OUT, interpolation: "log" })
  k(15.8, "camera", "position.z", 2.8, D, { ease: E.SOFT })
  for (const g of mids) k(16.9, g, "opacity", 0.5, 1)
  k(17.6, "end", "opacity", 0.4, 1)
  mids.forEach((m, i) => {
    k(15.9 + i * 0.08, "l-root-" + m, "opacity", 0.3, 1); k(15.9 + i * 0.08, "l-root-" + m, "color", 0.6, C.blue)
    k(16.55 + i * 0.08, m + "-card", "fill", 0.4, C.blueSoft); k(16.55 + i * 0.08, m + "-card", "strokeColor", 0.4, C.blueLine)
    k(16.9 + i * 0.08, "l-" + m + "-end", "opacity", 0.3, 1); k(16.9 + i * 0.08, "l-" + m + "-end", "color", 0.6, C.blue)
  })
  k(17.75, "end-card", "fill", 0.5, C.blue); k(17.75, "end-card", "strokeColor", 0.5, C.blue)
  k(17.75, "end-label", "color", 0.5, C.surface); k(17.75, "end-badge", "fill", 0.5, C.surface)
  k(17.9, "end-chip", "opacity", 0.5, 1, { ease: E.OUT }); k(17.9, "end-chip", "y", 0.6, 0.16, { ease: E.OUT })
  k(18.6, "camera", "zoom", 1.9, 0.675, { ease: E.SOFT, interpolation: "log" })
  k(20.0, "hud", "opacity", 0.5, 1)
  return b.build()
}
