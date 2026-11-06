// 样片 3《节点协作 · 跨层微交互》约 14.5 s：光标弧线飞入 → 点击确认按钮（组按压回弹）→ 斜纹阻塞卡解锁 →
// 三张结构化结果卡（同一组对象）从源卡飞出 → 动态空对象带动贝塞尔连线实时跟随 → 断链与重连。
import { createSceneBuilder } from "../../dist/index.js"
import { C, E, F, SHADOW, SHADOW_SM, keyer, px } from "./theme.mjs"

export function canvasHandoff() {
  const b = createSceneBuilder({ background: "radial-gradient(110% 80% at 30% 30%, #FFFFFF 0%, #F5F6F8 60%, #EDF0F4 100%)" })
  const k = keyer(b)
  b.region("world", { x: 0, y: 0, width: 6, height: 3.6 })
  const SRC = [-0.55, 0.02]
  b.camera({ zoom: 1.25, target: { x: SRC[0], y: SRC[1], z: 0 }, arc: 0.1 })
  b.dots("grid", { in: "world", w: 4, h: 2.4 }, { spacing: px(28), radius: px(1.4), color: "rgba(15,23,42,0.10)", ignoreMask: true })

  // 连线（画在卡片下面）：源卡 → 空对象 hub → 三张结果卡
  const OUT = [["res-a", 0.27], ["res-b", 0.0], ["res-c", -0.27]]
  b.null("hub", { in: "world", x: SRC[0] + 0.28, y: SRC[1] })
  b.line("l-src", ["src-card", [1, 0]], ["hub", [0, 0]], { color: C.blue, width: px(3), cap: "round", opacity: 0 })
  for (const [id] of OUT) b.line("l-" + id, ["hub", [0, 0]], [id + "-card", [-1, 0]], { color: C.blue, width: px(3), cap: "round", curve: "horizontal", trim: 0, opacity: 0 })
  b.rect("hub-dot", { in: "world", x: SRC[0] + 0.28, y: SRC[1], w: 0.022, h: 0.022 }, { fill: C.surface, stroke: C.blue, strokeWidth: px(3), radius: 0.011, opacity: 0 })

  // 源卡：斜纹阻塞层 + 状态 + 确认按钮（按钮是一个组，整体按压回弹）
  b.group("src", { in: "world", x: SRC[0], y: SRC[1], w: 0.56, h: 0.4 })
  b.rect("src-card", { in: "src", w: "100%", h: "100%" }, { fill: C.surface, stroke: C.line, strokeWidth: px(1.5), radius: 0.018, shadow: SHADOW })
  b.rect("src-block", { in: "src", w: "100%", h: "100%" }, { fill: "rgba(255,247,237,0.85)", stroke: C.amber, strokeWidth: px(2), strokeStyle: "dashed", radius: 0.018,
    stripes: { angle: 45, color1: "rgba(217,119,6,0.13)", color2: "rgba(217,119,6,0)", size: px(10), size2: px(10) } })
  b.text("src-kicker", { in: "src", x: -0.24, y: 0.15, anchor: [-1, 0] }, "HANDOFF · 素材交接", { fontSize: 0.018, fontFamily: F.mono, color: C.muted, align: "left" })
  b.text("src-title", { in: "src", x: -0.24, y: 0.1, anchor: [-1, 0] }, "季度汇报素材包", { fontSize: 0.03, fontFamily: F.display, weight: 700, color: C.ink, align: "left" })
  b.text("src-chip", { in: "src", x: 0.24, y: 0.15, anchor: [1, 0] }, "等待确认", { fontSize: 0.02, fontFamily: F.ui, weight: 600, color: C.amber, align: "center",
    background: C.amberSoft, padding: [0.01, 0.005] })
  ;[0.035, -0.005, -0.045].forEach((y, i) => b.rect("src-line" + i, { in: "src", x: -0.24, y, anchor: [-1, 0], w: [0.42, 0.34, 0.38][i], h: 0.016 }, { fill: C.sunken, radius: 0.008 }))
  b.group("btn", { in: "src", x: 0, y: -0.125, w: 0.48, h: 0.074 })
  b.rect("btn-bg", { in: "btn", w: "100%", h: "100%" }, { fill: C.ink, radius: 0.037, shadow: SHADOW_SM })
  b.text("btn-label", { in: "btn" }, "确认交接", { fontSize: 0.026, fontFamily: F.ui, weight: 600, color: C.surface })

  // 三张结果卡：从源卡里飞出（同一组对象：缩放 + 弧线位移 + 淡入）
  const RES = { "res-a": ["素材清单", "128 张图 · 6 段视频"], "res-b": ["镜头分配", "12 段 · 已排好"], "res-c": ["发布排期", "周一 10:00"] }
  for (const [id, y] of OUT) {
    b.group(id, { in: "world", x: SRC[0], y: SRC[1], w: 0.46, h: 0.19 }, { opacity: 0, scaleX: 0.6, scaleY: 0.6, arc: 0.12 })
    b.rect(id + "-card", { in: id, w: "100%", h: "100%" }, { fill: C.surface, stroke: C.line, strokeWidth: px(1.5), radius: 0.016, shadow: SHADOW_SM })
    b.rect(id + "-accent", { in: id, x: "-50%", anchor: [-1, 0], w: px(6), h: "60%" }, { fill: C.blue, radius: px(3) })
    b.text(id + "-title", { in: id, x: -0.19, y: 0.045, anchor: [-1, 0] }, RES[id][0], { fontSize: 0.02, fontFamily: F.ui, color: C.muted, align: "left" })
    b.text(id + "-value", { in: id, x: -0.19, y: -0.02, anchor: [-1, 0] }, RES[id][1], { fontSize: 0.03, fontFamily: F.display, weight: 700, color: C.ink, align: "left" })
    void y
  }
  b.text("res-c-chip", { in: "res-c", x: 0.2, y: 0.045, anchor: [1, 0] }, "上游已变更", { fontSize: 0.02, fontFamily: F.ui, weight: 600, color: C.surface,
    background: C.amber, padding: [0.01, 0.005], opacity: 0 })
  // 光标：世界层自由物体，沿弧线飞入
  b.path("cursor", { in: "world", x: 0.25, y: -0.55, anchor: [-1, 1], w: 0.032, h: 0.046 }, "M0 0 L0 22 L6 16.5 L10 26 L14 24.3 L10 15 L17.5 15 Z", [18, 26],
    { fill: C.ink, stroke: C.surface, strokeWidth: px(2), arc: 0.28, arcSide: "right" })

  b.text("brand", { in: "screen", x: -0.83, y: 0.455, anchor: [-1, 1] }, "SilkyScene · 节点协作", { fontSize: 0.018, fontFamily: F.mono, color: C.muted, align: "left" })
  b.group("hud", { in: "screen", y: -0.43, w: 1.12, h: 0.066 })
  b.rect("hud-bar", { in: "hud", w: "100%", h: "100%" }, { fill: "rgba(15,23,42,0.88)", radius: 0.033 })
  b.text("hud-step", { in: "hud", x: -0.525, anchor: [-1, 0] }, "01 / 04", { fontSize: 0.018, fontFamily: F.mono, color: "#93C5FD", align: "left" })
  b.text("hud-line", { in: "hud", x: 0.035 }, "素材没就绪，交接卡在这一步", { fontSize: 0.024, fontFamily: F.ui, weight: 500, color: "#F8FAFC" })

  // ── 1 · 等待确认 → 光标飞入（0–2.4）──
  b.segment("s1", 0, 2.4, "素材没就绪，交接卡在这一步。").step("blocked", 2.3, "交接被卡住")
  k(0, "camera", "zoom", 2.4, 1.22, { ease: E.SOFT, interpolation: "log" })
  k(0.5, "cursor", "x", 1.5, SRC[0] + 0.06, { ease: E.IN_OUT }); k(0.5, "cursor", "y", 1.5, SRC[1] - 0.115, { ease: E.IN_OUT })
  // ── 2 · 点击确认：按压 → 回弹 → 解锁（2.4–6）──
  b.segment("s2", 2.4, 6, "点一下确认：按钮按压回弹，阻塞解锁，结果卡从源卡里长出来。").step("confirm", 5.9, "确认后结果卡长出来")
  k(2.4, "hud-step", "text", 0, "02 / 04"); k(2.4, "hud-line", "text", 0, "一次点击：按压回弹 → 解锁 → 结果卡从源卡里长出来")
  k(2.5, "btn", "scale", 0.12, 0.92, { ease: E.PRESS }); k(2.5, "cursor", "scale", 0.12, 0.88, { ease: E.PRESS })
  k(2.62, "btn", "scale", 0.7, 1, { ease: E.SPRING }); k(2.62, "cursor", "scale", 0.5, 1, { ease: E.SPRING })
  k(2.55, "btn-bg", "fill", 0.3, C.blue)
  k(2.75, "btn-label", "text", 0, "已确认 · 正在交接")
  k(2.9, "src-block", "opacity", 0.6, 0, { ease: E.OUT })
  k(2.9, "src-chip", "text", 0, "已确认"); k(2.9, "src-chip", "color", 0.4, C.green); k(2.9, "src-chip", "background", 0.4, C.greenSoft)
  k(3.1, "cursor", "x", 1.2, SRC[0] + 0.5, { ease: E.IN_OUT }); k(3.1, "cursor", "y", 1.2, SRC[1] - 0.6, { ease: E.IN_OUT }); k(3.1, "cursor", "opacity", 0.9, 0)
  k(3.2, "camera", "target.x", 2.4, 0.02, { ease: E.IN_OUT }); k(3.2, "camera", "zoom", 2.4, 0.9, { ease: E.IN_OUT, interpolation: "log" })
  OUT.forEach(([id, y], i) => {
    const t = 3.8 + i * 0.15
    k(t, id, "opacity", 0.5, 1, { ease: E.OUT })
    k(t, id, "x", 1.5, 0.6, { ease: E.IN_OUT }); k(t, id, "y", 1.5, y, { ease: E.IN_OUT }); k(t, id, "scale", 1.5, 1, { ease: E.IN_OUT })
  })
  k(4.6, "l-src", "opacity", 0.4, 1); k(4.6, "hub-dot", "opacity", 0.4, 1)
  OUT.forEach(([id], i) => { k(5.0 + i * 0.1, "l-" + id, "opacity", 0, 1); k(5.0 + i * 0.1, "l-" + id, "trim", 0.8, 1, { ease: E.OUT }) })
  // ── 3 · 空对象带动连线实时跟随（6–9.4）──
  b.segment("s3", 6, 9.4, "连线挂在空对象上：节点一动，所有连线实时跟随。").step("linked", 9.3, "连线跟着节点走")
  k(6, "hud-step", "text", 0, "03 / 04"); k(6, "hud-line", "text", 0, "连线挂在空对象上：节点一动，所有连线实时跟随")
  for (const id of ["hub", "hub-dot"]) { k(6.2, id, "x", 1.4, 0.0, { ease: E.IN_OUT, arc: 0.35, arcSide: "left" }); k(6.2, id, "y", 1.4, 0.16, { ease: E.IN_OUT, arc: 0.35, arcSide: "left" }) }
  for (const id of ["hub", "hub-dot"]) { k(7.8, id, "x", 1.2, 0.04, { ease: E.IN_OUT }); k(7.8, id, "y", 1.2, 0.0, { ease: E.IN_OUT }) }
  k(6, "camera", "zoom", 3.4, 0.93, { ease: E.SOFT, interpolation: "log" })
  // ── 4 · 断链与重连（9.4–14.5）──
  b.segment("s4", 9.4, 14.5, "上游一变，下游自动断开；确认后重新接上。").step("rewire", 14.5, "断链与重连")
  k(9.4, "hud-step", "text", 0, "04 / 04"); k(9.4, "hud-line", "text", 0, "上游一变，下游自动断开；确认后重新接上")
  k(9.5, "camera", "target.x", 1.6, 0.3, { ease: E.IN_OUT }); k(9.5, "camera", "target.y", 1.6, -0.06, { ease: E.IN_OUT })
  k(9.5, "src", "opacity", 0.4, 0); k(9.5, "l-src", "opacity", 0.4, 0)
  k(13.3, "src", "opacity", 0.6, 1); k(13.3, "l-src", "opacity", 0.6, 1)
  k(9.5, "camera", "zoom", 1.6, 1.0, { ease: E.IN_OUT, interpolation: "log" })
  k(9.9, "l-res-c", "connected", 0, false)
  k(9.9, "res-c-card", "strokeColor", 0.3, C.amber)
  k(9.9, "res-c", "x", 0.8, 0.68, { ease: E.OUT })
  k(9.9, "res-c-chip", "opacity", 0.4, 1, { ease: E.OUT })
  k(11.0, "l-res-c", "trim", 0, 0); k(11.0, "l-res-c", "connected", 0, true)
  k(11.0, "l-res-c", "trim", 0.8, 1, { ease: E.OUT })
  k(11.0, "res-c-chip", "text", 0, "已重连"); k(11.0, "res-c-chip", "background", 0.4, C.blue)
  k(11.3, "res-c-card", "strokeColor", 0.4, C.blueLine)
  k(11.9, "camera", "target.x", 2.0, 0.06, { ease: E.IN_OUT }); k(11.9, "camera", "target.y", 2.0, 0.0, { ease: E.IN_OUT })
  k(11.9, "camera", "zoom", 2.0, 0.92, { ease: E.IN_OUT, interpolation: "log" })
  k(13.9, "camera", "zoom", 0.6, 0.915, { ease: E.SOFT, interpolation: "log" })
  return b.build()
}
