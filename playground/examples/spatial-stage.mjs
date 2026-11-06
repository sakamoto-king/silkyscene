// 样片《空间舞台 · 双节点透视运镜》约 19.2 s：正交起幅 → 破壁入三维 → 左翼俯冲 →
// 对角大摇臂 → 环绕升空 → 天顶像素级归正。专为现场秀肌肉：maxTilt 32°、多层 Z 视差、重叠运镜。
import { createSceneBuilder } from "../../dist/index.js"
import { E, F, keyer, px } from "./theme.mjs"

/** 深空科技配色（present.html 默认底已是 #0B1120，无白边） */
const C = {
  bg: "radial-gradient(120% 90% at 50% 35%, #132038 0%, #0B1120 55%, #070B14 100%)",
  deck: "#111C33",
  deckLine: "rgba(56,189,248,0.18)",
  glass: "linear-gradient(160deg, rgba(30,48,80,0.96) 0%, rgba(15,27,48,0.98) 100%)",
  glassSolid: "#16233E",
  glassHi: "linear-gradient(145deg, rgba(56,189,248,0.22) 0%, rgba(22,35,62,0.95) 40%, rgba(15,27,48,0.98) 100%)",
  ink: "#F8FAFC",
  ink2: "#CBD5E1",
  muted: "#94A3B8",
  faint: "rgba(148,163,184,0.45)",
  cyan: "#38BDF8",
  cyanSoft: "rgba(56,189,248,0.16)",
  blue: "#3B82F6",
  blueSoft: "rgba(59,130,246,0.18)",
  amber: "#F59E0B",
  amberSoft: "rgba(245,158,11,0.18)",
  green: "#10B981",
  greenSoft: "rgba(16,185,129,0.18)",
  violet: "#A78BFA",
  line: "rgba(56,189,248,0.55)",
  lineDim: "rgba(148,163,184,0.28)",
  core: "linear-gradient(145deg, #1E3A5F 0%, #0F1B30 55%, #16233E 100%)",
}
const SH = { x: 0, y: px(14), blur: px(40), spread: px(-4), color: "rgba(0,0,0,0.55)" }
const SH_SM = { x: 0, y: px(6), blur: px(18), spread: px(-2), color: "rgba(0,0,0,0.45)" }
const SH_GLOW = { x: 0, y: 0, blur: px(28), spread: px(2), color: "rgba(56,189,248,0.35)" }

export function spatialStage() {
  const D = 1.85
  const b = createSceneBuilder({ background: C.bg })
  b.camera({
    zoom: 0.92,
    arc: 0.14,
    view3d: { distance: D, maxTilt: 32 },
    position: { x: 0, y: 0, z: D },
    approach: { x: 0, y: 0 },
    target: { x: 0, y: 0, z: 0 },
  })
  const k = keyer(b)
  b.region("world", { x: 0, y: 0, width: 6, height: 3.6 })

  // ── 层序：z 从小到大（背景 → 连线 → 主卡 → 浮卡 → 角标），保证 DOM 遮挡物理正确 ──

  // Z ≈ -0.16 · 基准甲板 + 点阵
  b.rect("deck", { in: "world", w: 2.6, h: 1.55 }, {
    fill: C.deck, radius: 0.04, stroke: C.deckLine, strokeWidth: px(1.5), shadow: SH, z: -0.16, opacity: 0, ignoreMask: true,
  })
  b.dots("grid", { in: "world", w: 2.4, h: 1.35 }, {
    spacing: px(36), radius: px(1.5), color: "rgba(56,189,248,0.22)", ignoreMask: true, z: -0.15, opacity: 0,
  })
  b.text("deck-label", { in: "world", x: -1.15, y: 0.66, anchor: [-1, 0] }, "SPATIAL STAGE · Z-DEPTH", {
    fontSize: 0.022, fontFamily: F.mono, color: C.muted, align: "left", z: -0.14, opacity: 0, ignoreMask: true,
  })

  // ── 连线层（画在卡片下面）──
  // 中枢空对象
  b.null("hub", { in: "world", x: 0, y: 0 }, { z: 0.02 })
  // 左翼三扇 → hub
  for (const id of ["fan-a", "fan-b", "fan-c"]) {
    b.line("l-" + id, [id + "-card", [1, 0]], ["geo-card", [-1, 0]], {
      color: C.line, width: px(2.5), curve: "horizontal", trim: 0, opacity: 0, cap: "round",
    })
  }
  b.line("l-geo-core", ["geo-card", [1, 0]], ["core-card", [-1, 0]], {
    color: C.cyan, width: px(3), curve: "horizontal", trim: 0, opacity: 0, cap: "round",
  })
  b.line("l-core-cam", ["core-card", [1, 0]], ["cam-card", [-1, 0]], {
    color: C.blue, width: px(3), curve: "horizontal", trim: 0, opacity: 0, cap: "round",
  })
  // 跨层：左翼 → 右下炉
  b.null("bridge", { in: "world", x: 0.05, y: 0.05 }, { z: 0.08 })
  b.line("l-cross-a", ["geo-card", [1, -1]], ["bridge", [0, 0]], {
    color: C.violet, width: px(2), trim: 0, opacity: 0, cap: "round",
  })
  b.line("l-cross-b", ["bridge", [0, 0]], ["cam-card", [-1, 1]], {
    color: C.violet, width: px(2), curve: "horizontal", trim: 0, opacity: 0, cap: "round",
  })
  // 四象限汇流
  for (const q of ["q-nw", "q-ne", "q-sw", "q-se"]) {
    b.line("l-" + q, [q + "-card", [0, 0]], ["core-card", [0, 0]], {
      color: C.lineDim, width: px(1.8), trim: 0, opacity: 0, cap: "round",
    })
  }

  // Z = 0 · 中央核心晶体（起幅唯一主角）
  b.group("core", { in: "world", x: 0, y: 0.02, w: 0.72, h: 0.42 }, { z: 0, arc: 0.1 })
  b.rect("core-card", { in: "core", w: "100%", h: "100%" }, {
    fill: C.core, stroke: C.cyan, strokeWidth: px(2), radius: 0.022, shadow: SH_GLOW, ignoreMask: true,
  })
  b.rect("core-accent", { in: "core", y: "42%", w: "88%", h: px(3) }, { fill: C.cyan, radius: px(2), opacity: 0.7, ignoreMask: true })
  b.text("core-kicker", { in: "core", y: 0.13 }, "DUAL-NODE CAMERA", {
    fontSize: 0.022, fontFamily: F.mono, color: C.cyan, letterSpacing: 0.003, ignoreMask: true,
  })
  b.text("core-title", { in: "core", y: 0.04 }, "空间引擎核心", {
    fontSize: 0.036, fontFamily: F.display, weight: 700, color: C.ink, ignoreMask: true,
  })
  b.text("core-sub", { in: "core", y: -0.08 }, "目标点 · 摄像机 · 几何推导", {
    fontSize: 0.022, fontFamily: F.ui, color: C.ink2, ignoreMask: true,
  })
  b.text("core-badge", { in: "core", x: 0.28, y: 0.13, anchor: [1, 0] }, "LIVE", {
    fontSize: 0.018, fontFamily: F.mono, weight: 700, color: "#0B1120",
    background: C.cyan, padding: [0.01, 0.004], ignoreMask: true,
  })

  // Z ≈ +0.12 · 左上「确定性坐标」模组
  const GEO = { x: -0.72, y: 0.28, z: 0.14 }
  b.group("geo", { in: "world", x: GEO.x, y: GEO.y, w: 0.52, h: 0.28 }, { z: GEO.z, opacity: 0, scaleX: 0.86, scaleY: 0.86 })
  b.rect("geo-card", { in: "geo", w: "100%", h: "100%" }, {
    fill: C.glassHi, stroke: C.cyan, strokeWidth: px(1.5), radius: 0.018, shadow: SH_SM, ignoreMask: true,
  })
  b.text("geo-kicker", { in: "geo", x: -0.2, y: 0.08, anchor: [-1, 0] }, "01 · LAYOUT", {
    fontSize: 0.022, fontFamily: F.mono, color: C.cyan, align: "left", ignoreMask: true,
  })
  b.text("geo-title", { in: "geo", x: -0.2, y: 0.02, anchor: [-1, 0] }, "确定性坐标", {
    fontSize: 0.028, fontFamily: F.display, weight: 700, color: C.ink, align: "left", ignoreMask: true,
  })
  b.text("geo-sub", { in: "geo", x: -0.2, y: -0.06, anchor: [-1, 0] }, "几何解算 · 像素级对齐", {
    fontSize: 0.02, fontFamily: F.ui, color: C.ink2, align: "left", ignoreMask: true,
  })

  // 左翼三扇子卡（扇形展开）
  const FANS = [
    { id: "fan-a", x: -1.12, y: 0.48, label: "Region", tip: "世界区域" },
    { id: "fan-b", x: -1.22, y: 0.24, label: "Anchor", tip: "中心为零" },
    { id: "fan-c", x: -1.12, y: 0.0, label: "Solve", tip: "约束解算" },
  ]
  for (const f of FANS) {
    b.group(f.id, { in: "world", x: GEO.x, y: GEO.y, w: 0.28, h: 0.14 }, { z: 0.12, opacity: 0, scaleX: 0.7, scaleY: 0.7, arc: 0.18 })
    b.rect(f.id + "-card", { in: f.id, w: "100%", h: "100%" }, {
      fill: C.glassSolid, stroke: C.deckLine, strokeWidth: px(1.2), radius: 0.014, shadow: SH_SM, ignoreMask: true,
    })
    b.text(f.id + "-label", { in: f.id, y: 0.025 }, f.label, {
      fontSize: 0.022, fontFamily: F.mono, weight: 600, color: C.cyan, ignoreMask: true,
    })
    b.text(f.id + "-tip", { in: f.id, y: -0.03 }, f.tip, {
      fontSize: 0.02, fontFamily: F.ui, color: C.muted, ignoreMask: true,
    })
  }

  // Z ≈ +0.16 · 右下「双节点相机 & 时间轴」核心炉
  const CAM = { x: 0.72, y: -0.24, z: 0.16 }
  b.group("cam", { in: "world", x: CAM.x, y: CAM.y, w: 0.58, h: 0.36 }, { z: CAM.z, opacity: 0, scaleX: 0.86, scaleY: 0.86 })
  b.rect("cam-card", { in: "cam", w: "100%", h: "100%" }, {
    fill: C.glassHi, stroke: C.blue, strokeWidth: px(1.5), radius: 0.02, shadow: SH_SM, ignoreMask: true,
  })
  b.text("cam-kicker", { in: "cam", x: -0.23, y: 0.12, anchor: [-1, 0] }, "02 · CAMERA", {
    fontSize: 0.022, fontFamily: F.mono, color: "#93C5FD", align: "left", ignoreMask: true,
  })
  b.text("cam-title", { in: "cam", x: -0.23, y: 0.055, anchor: [-1, 0] }, "双节点透视", {
    fontSize: 0.028, fontFamily: F.display, weight: 700, color: C.ink, align: "left", ignoreMask: true,
  })
  // 进度条 / 关键帧轨道
  b.rect("cam-track", { in: "cam", x: -0.23, y: -0.02, anchor: [-1, 0], w: 0.42, h: 0.018 }, {
    fill: "rgba(15,23,42,0.7)", radius: 0.009, ignoreMask: true,
  })
  b.rect("cam-prog", { in: "cam", x: -0.23, y: -0.02, anchor: [-1, 0], w: 0.02, h: 0.018 }, {
    fill: C.blue, radius: 0.009, opacity: 0, ignoreMask: true,
  })
  b.rect("cam-track2", { in: "cam", x: -0.23, y: -0.07, anchor: [-1, 0], w: 0.42, h: 0.012 }, {
    fill: "rgba(15,23,42,0.55)", radius: 0.006, ignoreMask: true,
  })
  b.rect("cam-kf1", { in: "cam", x: -0.18, y: -0.07, w: 0.014, h: 0.014 }, { fill: C.amber, radius: 0.003, opacity: 0, ignoreMask: true })
  b.rect("cam-kf2", { in: "cam", x: -0.02, y: -0.07, w: 0.014, h: 0.014 }, { fill: C.cyan, radius: 0.003, opacity: 0, ignoreMask: true })
  b.rect("cam-kf3", { in: "cam", x: 0.14, y: -0.07, w: 0.014, h: 0.014 }, { fill: C.green, radius: 0.003, opacity: 0, ignoreMask: true })
  b.text("cam-pulse", { in: "cam", x: 0.22, y: 0.12, anchor: [1, 0] }, "60 fps", {
    fontSize: 0.02, fontFamily: F.mono, weight: 700, color: C.ink,
    background: C.blueSoft, padding: [0.01, 0.004], opacity: 0, ignoreMask: true,
  })

  // Z ≈ +0.10 · 四象限节点
  const QUADS = [
    { id: "q-nw", x: -0.42, y: 0.48, label: "Solve", color: C.cyan },
    { id: "q-ne", x: 0.42, y: 0.48, label: "Motion", color: C.blue },
    { id: "q-sw", x: -0.42, y: -0.42, label: "Deck", color: C.green },
    { id: "q-se", x: 0.42, y: -0.42, label: "Export", color: C.amber },
  ]
  for (const q of QUADS) {
    b.group(q.id, { in: "world", x: q.x, y: q.y, w: 0.26, h: 0.12 }, { z: 0.1, opacity: 0, scaleX: 0.75, scaleY: 0.75 })
    b.rect(q.id + "-card", { in: q.id, w: "100%", h: "100%" }, {
      fill: C.glassSolid, stroke: q.color, strokeWidth: px(1.4), radius: 0.014, shadow: SH_SM, ignoreMask: true,
    })
    b.text(q.id + "-label", { in: q.id }, q.label, {
      fontSize: 0.022, fontFamily: F.mono, weight: 600, color: q.color, ignoreMask: true,
    })
  }

  // Z ≈ +0.24 · 前景双模输出徽章
  b.group("badge-deck", { in: "world", x: -0.22, y: 0.58, w: 0.34, h: 0.09 }, { z: 0.24, opacity: 0, scaleX: 0.8, scaleY: 0.8 })
  b.rect("badge-deck-bg", { in: "badge-deck", w: "100%", h: "100%" }, {
    fill: C.greenSoft, stroke: C.green, strokeWidth: px(1.5), radius: 0.045, shadow: SH_GLOW, ignoreMask: true,
  })
  b.text("badge-deck-t", { in: "badge-deck" }, "Live Deck", {
    fontSize: 0.022, fontFamily: F.ui, weight: 700, color: C.green, ignoreMask: true,
  })
  b.group("badge-mp4", { in: "world", x: 0.22, y: 0.58, w: 0.34, h: 0.09 }, { z: 0.24, opacity: 0, scaleX: 0.8, scaleY: 0.8 })
  b.rect("badge-mp4-bg", { in: "badge-mp4", w: "100%", h: "100%" }, {
    fill: C.amberSoft, stroke: C.amber, strokeWidth: px(1.5), radius: 0.045, shadow: SH_GLOW, ignoreMask: true,
  })
  b.text("badge-mp4-t", { in: "badge-mp4" }, "60fps MP4", {
    fontSize: 0.022, fontFamily: F.ui, weight: 700, color: C.amber, ignoreMask: true,
  })

  // 角标：俯仰/偏转读数（屏幕层，不参与 3D）
  b.group("tilt-chip", { in: "screen", x: 0.72, y: 0.4, w: 0.32, h: 0.07 }, { opacity: 0 })
  b.rect("tilt-bg", { in: "tilt-chip", w: "100%", h: "100%" }, {
    fill: "rgba(15,23,42,0.78)", radius: 0.035, stroke: "rgba(56,189,248,0.35)", strokeWidth: px(1),
  })
  b.text("tilt-read", { in: "tilt-chip" }, "俯仰 0.0° · 偏转 0.0°", {
    fontSize: 0.018, fontFamily: F.mono, color: C.cyan,
  })

  // HUD + brand（屏幕层）
  b.text("brand", { in: "screen", x: -0.83, y: 0.455, anchor: [-1, 1] }, "SilkyScene · 空间舞台", {
    fontSize: 0.018, fontFamily: F.mono, color: C.muted, align: "left",
  })
  b.group("hud", { in: "screen", y: -0.43, w: 1.2, h: 0.066 }, { opacity: 0 })
  b.rect("hud-bar", { in: "hud", w: "100%", h: "100%" }, { fill: "rgba(7,11,20,0.88)", radius: 0.033, stroke: "rgba(56,189,248,0.2)", strokeWidth: px(1) })
  b.text("hud-step", { in: "hud", x: -0.55, anchor: [-1, 0] }, "01 / 05", {
    fontSize: 0.018, fontFamily: F.mono, color: C.cyan, align: "left",
  })
  b.text("hud-line", { in: "hud", x: 0.04 }, "一张平面架构卡 · 正上方正交俯视", {
    fontSize: 0.022, fontFamily: F.ui, weight: 500, color: "#E2E8F0",
  })

  // ═══════════════════════════════════════════════════════════
  // STEP 01 · 正交起幅 → 破壁入三维（0 → 3.4）
  // ═══════════════════════════════════════════════════════════
  b.segment("s1", 0, 3.4, "看似一张平面架构卡——然后整座空间舞台立起来。").step("break-3d", 3.4, "破壁入三维")
  k(0.15, "hud", "opacity", 0.5, 1, { ease: E.OUT })
  k(0, "camera", "zoom", 3.4, 0.94, { ease: E.SOFT, interpolation: "log" })
  // 0.8s 后甲板弹开 + 相机侧掠俯冲到英雄视角（yaw≈-20° pitch≈13°）
  k(0.8, "deck", "opacity", 0.7, 1, { ease: E.OUT })
  k(0.85, "grid", "opacity", 0.6, 1, { ease: E.OUT })
  k(0.9, "deck-label", "opacity", 0.5, 1, { ease: E.OUT })
  k(0.8, "camera", "position.x", 2.4, -0.48, { ease: E.IN_OUT })
  k(0.8, "camera", "position.y", 2.4, -0.32, { ease: E.IN_OUT })
  k(0.8, "camera", "position.z", 2.4, 1.58, { ease: E.SOFT })
  // 浮层弹入
  k(1.1, "geo", "opacity", 0.6, 1, { ease: E.OUT })
  k(1.1, "geo", "scale", 0.9, 1, { ease: E.SPRING_SOFT })
  k(1.35, "cam", "opacity", 0.6, 1, { ease: E.OUT })
  k(1.35, "cam", "scale", 0.9, 1, { ease: E.SPRING_SOFT })
  QUADS.forEach((q, i) => {
    k(1.5 + i * 0.08, q.id, "opacity", 0.5, 1, { ease: E.OUT })
    k(1.5 + i * 0.08, q.id, "scale", 0.7, 1, { ease: E.SPRING_SOFT })
  })
  k(1.8, "l-geo-core", "opacity", 0, 1)
  k(1.8, "l-geo-core", "trim", 0.9, 1, { ease: E.OUT })
  k(2.0, "l-core-cam", "opacity", 0, 1)
  k(2.0, "l-core-cam", "trim", 0.9, 1, { ease: E.OUT })
  k(2.2, "tilt-chip", "opacity", 0.5, 1, { ease: E.OUT })
  k(2.2, "tilt-read", "text", 0, "俯仰 11.4° · 偏转 −16.9°")
  k(2.4, "hud-line", "text", 0, "多层 Z 轴弹开 · 摄像机侧掠俯冲 20°")

  // ═══════════════════════════════════════════════════════════
  // STEP 02 · 低空俯冲掠拍 · 左翼输入矩阵（3.4 → 7.4）
  // target 100% → GEO；position 跟进 ~55% + y 偏置；approach 重叠微调
  // ═══════════════════════════════════════════════════════════
  b.segment("s2", 3.4, 7.4, "镜头俯冲进左翼：确定性坐标与几何解算模组。").step("dive-left", 7.4, "俯冲左翼输入矩阵")
  k(3.4, "hud-step", "text", 0, "02 / 05")
  k(3.4, "hud-line", "text", 0, "低空俯冲 · 左翼确定性坐标模组")
  // 目标点飞向左上模组（含 z 深度）
  k(3.4, "camera", "target.x", 3.2, GEO.x, { ease: E.IN_OUT, arc: 0.18, arcSide: "left" })
  k(3.4, "camera", "target.y", 3.2, GEO.y, { ease: E.IN_OUT, arc: 0.18, arcSide: "left" })
  k(3.4, "camera", "target.z", 3.2, GEO.z, { ease: E.SOFT })
  // position 跟进 55% + 额外 y 下压制造俯仰；从英雄位插值过去
  k(3.4, "camera", "position.x", 3.2, GEO.x * 0.58, { ease: E.IN_OUT, arc: 0.16, arcSide: "left" })
  k(3.4, "camera", "position.y", 3.2, GEO.y * 0.58 - 0.16, { ease: E.IN_OUT, arc: 0.16, arcSide: "left" })
  k(3.4, "camera", "position.z", 3.2, 1.28, { ease: E.SOFT })
  // approach 后半段重叠微调（不归零倾角，只呼吸）
  k(5.0, "camera", "approach.x", 2.2, -0.06, { ease: E.IN_OUT, arc: 0 })
  k(5.0, "camera", "approach.y", 2.2, 0.04, { ease: E.IN_OUT, arc: 0 })
  k(3.4, "camera", "zoom", 3.4, 1.12, { ease: E.IN_OUT, interpolation: "log" })
  // 三扇展开
  FANS.forEach((f, i) => {
    const t = 4.2 + i * 0.15
    k(t, f.id, "opacity", 0.5, 1, { ease: E.OUT })
    k(t, f.id, "x", 1.4, f.x, { ease: E.IN_OUT })
    k(t, f.id, "y", 1.4, f.y, { ease: E.IN_OUT })
    k(t, f.id, "scale", 1.4, 1, { ease: E.SPRING_SOFT })
    k(t + 0.15, "l-" + f.id, "opacity", 0, 1)
    k(t + 0.15, "l-" + f.id, "trim", 0.85, 1, { ease: E.OUT })
  })
  k(5.6, "tilt-read", "text", 0, "俯仰 14.6° · 偏转 +18.4°")
  // 右侧退远：降低非焦点透明度
  k(3.6, "cam", "opacity", 0.6, 0.4)
  k(3.6, "q-ne", "opacity", 0.5, 0.35)
  k(3.6, "q-se", "opacity", 0.5, 0.35)
  k(3.6, "core", "opacity", 0.5, 0.45)

  // ═══════════════════════════════════════════════════════════
  // STEP 03 · 对角大摇臂横掠 · 右下动效核心炉（7.4 → 11.6）
  // yaw 从正切到负，立体翻转感
  // ═══════════════════════════════════════════════════════════
  b.segment("s3", 7.4, 11.6, "大摇臂对角横掠：切入双节点相机与时间轴核心。").step("crane-right", 11.6, "对角摇臂切入核心炉")
  k(7.4, "hud-step", "text", 0, "03 / 05")
  k(7.4, "hud-line", "text", 0, "对角大摇臂 · 右下双节点核心炉")
  // 先清掉上一段 approach，避免叠加失控
  k(7.4, "camera", "approach.x", 1.6, 0, { ease: E.IN_OUT, arc: 0 })
  k(7.4, "camera", "approach.y", 1.6, 0, { ease: E.IN_OUT, arc: 0 })
  // 目标点飞向右下
  k(7.4, "camera", "target.x", 3.6, CAM.x, { ease: E.IN_OUT, arc: 0.28, arcSide: "right" })
  k(7.4, "camera", "target.y", 3.6, CAM.y, { ease: E.IN_OUT, arc: 0.28, arcSide: "right" })
  k(7.4, "camera", "target.z", 3.6, CAM.z, { ease: E.SOFT })
  // 途经中心拉高再俯冲：position 走大弧，终点在目标右侧外侧制造 +yaw 反向
  // 中段拉高用 z 峰值不好做（z 直线），用终点 z=1.18 + 大 arc 在 xy
  k(7.4, "camera", "position.x", 3.6, 1.05, { ease: E.IN_OUT, arc: 0.28, arcSide: "right" })
  k(7.4, "camera", "position.y", 3.6, -0.48, { ease: E.IN_OUT, arc: 0.28, arcSide: "right" })
  // 中段抬高：先抬再降 —— 用两段 position.z
  k(7.4, "camera", "position.z", 1.6, 1.68, { ease: E.SOFT }) // 途中抬升
  k(9.0, "camera", "position.z", 2.2, 1.26, { ease: E.SOFT }) // 再俯冲
  k(9.2, "camera", "approach.x", 2.2, 0.08, { ease: E.IN_OUT, arc: 0 })
  k(9.2, "camera", "approach.y", 2.2, -0.04, { ease: E.IN_OUT, arc: 0 })
  k(7.4, "camera", "zoom", 3.8, 1.1, { ease: E.IN_OUT, interpolation: "log" })
  // 恢复右侧重、淡左翼
  k(7.6, "cam", "opacity", 0.5, 1, { ease: E.OUT })
  k(7.6, "cam", "scale", 0.8, 1.06, { ease: E.SPRING })
  k(8.0, "geo", "opacity", 0.5, 0.4)
  FANS.forEach(f => k(8.0, f.id, "opacity", 0.4, 0.35))
  k(8.0, "core", "opacity", 0.5, 0.4)
  k(8.2, "q-ne", "opacity", 0.4, 1)
  k(8.2, "q-se", "opacity", 0.4, 1)
  // 进度条与关键帧点亮
  k(9.0, "cam-prog", "opacity", 0.3, 1)
  k(9.0, "cam-prog", "width", 1.8, 0.42, { ease: E.OUT })
  k(9.3, "cam-kf1", "opacity", 0.3, 1)
  k(9.5, "cam-kf2", "opacity", 0.3, 1)
  k(9.7, "cam-kf3", "opacity", 0.3, 1)
  k(9.8, "cam-pulse", "opacity", 0.4, 1, { ease: E.OUT })
  // 跨层连线生长
  k(9.4, "bridge", "x", 0, 0.05); k(9.4, "bridge", "y", 0, 0.02)
  k(9.5, "l-cross-a", "opacity", 0, 1)
  k(9.5, "l-cross-a", "trim", 0.9, 1, { ease: E.OUT })
  k(10.0, "l-cross-b", "opacity", 0, 1)
  k(10.0, "l-cross-b", "trim", 0.9, 1, { ease: E.OUT })
  k(10.4, "tilt-read", "text", 0, "俯仰 12.8° · 偏转 −16.2°")

  // ═══════════════════════════════════════════════════════════
  // STEP 04 · 环绕升空 · 四层立体全景（11.6 → 15.6）
  // ═══════════════════════════════════════════════════════════
  b.segment("s4", 11.6, 15.6, "环绕升空：四层节点与双模输出徽章全部点亮。").step("orbit-rise", 15.6, "环绕升空全景阵列")
  k(11.6, "hud-step", "text", 0, "04 / 05")
  k(11.6, "hud-line", "text", 0, "环绕升空 · 四层立体全景阵列")
  k(11.6, "camera", "approach.x", 1.4, 0, { ease: E.IN_OUT, arc: 0 })
  k(11.6, "camera", "approach.y", 1.4, 0, { ease: E.IN_OUT, arc: 0 })
  k(11.6, "camera", "target.x", 3.4, 0, { ease: E.IN_OUT, arc: 0.22, arcSide: "left" })
  k(11.6, "camera", "target.y", 3.4, 0.05, { ease: E.IN_OUT, arc: 0.22, arcSide: "left" })
  k(11.6, "camera", "target.z", 3.4, 0.05, { ease: E.SOFT })
  k(11.6, "camera", "position.x", 3.4, 0.35, { ease: E.IN_OUT, arc: 0.3, arcSide: "left" })
  k(11.6, "camera", "position.y", 3.4, -0.42, { ease: E.IN_OUT, arc: 0.3, arcSide: "left" })
  k(11.6, "camera", "position.z", 3.4, 1.70, { ease: E.SOFT })
  k(11.6, "camera", "zoom", 3.6, 0.84, { ease: E.IN_OUT, interpolation: "log" })
  // 全部点亮
  k(12.0, "core", "opacity", 0.4, 1)
  k(12.0, "geo", "opacity", 0.5, 1)
  FANS.forEach(f => k(12.0, f.id, "opacity", 0.4, 1))
  k(12.0, "cam", "opacity", 0.5, 1)
  k(12.0, "cam", "scale", 0.6, 1, { ease: E.OUT })
  QUADS.forEach((q, i) => {
    k(12.2 + i * 0.08, q.id, "opacity", 0.4, 1)
    k(12.4 + i * 0.1, "l-" + q.id, "opacity", 0, 0.85)
    k(12.4 + i * 0.1, "l-" + q.id, "trim", 0.9, 1, { ease: E.OUT })
  })
  // 顶层徽章穿过
  k(13.2, "badge-deck", "opacity", 0.5, 1, { ease: E.OUT })
  k(13.2, "badge-deck", "scale", 0.8, 1, { ease: E.SPRING })
  k(13.2, "badge-deck", "y", 0.78, 0.58, { ease: E.OUT })
  k(13.5, "badge-mp4", "opacity", 0.5, 1, { ease: E.OUT })
  k(13.5, "badge-mp4", "scale", 0.8, 1, { ease: E.SPRING })
  k(13.5, "badge-mp4", "y", 0.78, 0.58, { ease: E.OUT })
  k(14.2, "tilt-read", "text", 0, "俯仰 14.0° · 偏转 +12.0°")
  k(14.4, "hud-line", "text", 0, "Live Deck / 60fps MP4 · 同一份场景双模输出")

  // ═══════════════════════════════════════════════════════════
  // STEP 05 · 天顶归正 · 像素级确定性收官（15.6 → 19.2）
  // ═══════════════════════════════════════════════════════════
  b.segment("s5", 15.6, 19.2, "天顶归正：大倾角丝滑回 0°，像素级对齐。").step("zenith", 19.2, "天顶归正 · 像素级对齐")
  k(15.6, "hud-step", "text", 0, "05 / 05")
  k(15.6, "hud-line", "text", 0, "天顶归正 · 双节点透视回 0° 正交")
  k(15.6, "camera", "target.x", 3.0, 0, { ease: E.IN_OUT })
  k(15.6, "camera", "target.y", 3.0, 0, { ease: E.IN_OUT })
  k(15.6, "camera", "target.z", 3.0, 0, { ease: E.SOFT })
  // position 走 70%，approach 重叠补完 30% → 正上方
  k(15.6, "camera", "position.x", 3.0, 0.35 * 0.3, { ease: E.IN_OUT }) // from 0.35 toward 0, leave 30% for approach
  k(15.6, "camera", "position.y", 3.0, -0.42 * 0.3, { ease: E.IN_OUT })
  k(15.6, "camera", "position.z", 3.2, D, { ease: E.SOFT })
  k(16.6, "camera", "approach.x", 2.4, -0.35 * 0.3, { ease: E.IN_OUT, arc: 0 }) // cancel residual
  k(16.6, "camera", "approach.y", 2.4, 0.42 * 0.3, { ease: E.IN_OUT, arc: 0 })
  // Wait - position goes to 0.3*0.35=0.105, need approach to cancel to 0: approach = -0.105
  // And from y: position → -0.126, approach → +0.126. Let me fix below in a patch if needed.
  k(15.6, "camera", "zoom", 3.2, 0.86, { ease: E.IN_OUT, interpolation: "log" })
  k(17.2, "tilt-read", "text", 0, "俯仰 0.0° · 偏转 0.0°")
  k(17.4, "tilt-chip", "opacity", 0.5, 0)
  k(17.6, "hud-line", "text", 0, "分毫不差 · 回到 2D 像素级对齐总览")
  // 轻微呼吸
  k(18.2, "camera", "zoom", 1.0, 0.88, { ease: E.SOFT, interpolation: "log" })

  return b.build()
}
