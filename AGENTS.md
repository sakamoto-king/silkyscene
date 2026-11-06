# AGENTS.md · SilkyScene 场景硬性手册

给 AI Agent / 编码代理：根据讲稿或汇报提纲，生成一段**可检查、可现场演示、可导出视频**的场景。用 `createSceneBuilder` 写生成脚本，产出 `silkyscene@1` JSON，用下方命令自检。细节见 [`docs/01`–`06`](./docs/README.md)；冲突时以本手册 + `parseProject` 报错为准。

> **双模合一 = 现场步进演示 `present.html` + 确定性视频导出 `player.html` / `export:mp4`。** 你交付的每个场景都必须同时满足两种用法：写好演示停靠点（`steps`），并能逐帧导出。

## 1. 坐标与单位（硬契约）

- `format: "silkyscene@1"`（旧 `@0` 先跑 `node tools/migrate_scene_v0_to_v1.mjs`）
- 画布中心 `(0,0)`；+X 右，+Y **上**；默认 1920×1080；**`1 u = 1080 px`**（`px(n) = n / 1080`）
- 百分比相对所属容器整轴；**边缘为 `±50%`**（不是 0–100）
- `layout.anchor` 与连线端点 `at`：框内中心坐标 **`[-1, 1]`**（`[-1,1]` 左上，`[0,0]` 中心，`[1,-1]` 右下）
- 区域、组、元素 ID **全局唯一**；`camera`、`screen` 是保留名；未文档化字段一律报错

## 2. 交付物

1. 生成脚本 `playground/examples/<name>.mjs`（用 `createSceneBuilder`，见 §3）
2. `playground/<name>.scene.json` + `playground/<name>-timing.json`（由脚本写出；timing 含锚点秒数、`segments` 讲稿段、`steps` 演示停靠点）
3. 打开方式（`npm run dev` 起在 `127.0.0.1:5311`）：
   - 检查器 `http://127.0.0.1:5311/playground/inspector.html?doc=<name>`
   - 现场演示 `http://127.0.0.1:5311/playground/present.html?doc=<name>`
   - 导出 `npm run export:mp4 -- <name>` → `_storage/exports/<name>.mp4`

参考样片：`spatial-stage`（暗色 3D 空间舞台、四层 Z 轴景深、双节点透视俯冲 / 侧倾 / 环绕归正）、`topology-flow`（双节点透视推镜、曲线连线、1→3→1 依赖图）、`scale-matrix`（对数 zoom 大跨度拉远、组整体缩放）、`canvas-handoff`（光标弧线、按压回弹、空对象驱动连线、断链重连）。生成脚本在 `playground/examples/`。

## 3. 用构建器写，不要手写 JSON

```js
import { createSceneBuilder, px } from "../../dist/index.js"
const b = createSceneBuilder({ background: "#FAFAF8" })
b.region("world", { x: 0, y: 0, width: 6, height: 3.4 })
b.group("card", { in: "world", x: 0.5, w: 0.6, h: 0.3 }, { opacity: 0 })
b.rect("card-bg", { in: "card", w: "100%", h: "100%" }, { fill: "#FFFFFF", radius: px(16) })
b.text("card-t", { in: "card" }, "要点", { fontSize: px(40), weight: 700, fontFamily: "Noto Sans SC, sans-serif" })
b.cue("t00.40", 0.4, "card", "opacity", 0.5, 1, { ease: { type: "cubicBezier", x1: 0.22, y1: 1, x2: 0.36, y2: 1 } })
b.segment("s1", 0, 3, "这一段讲稿").step("intro", 1, "这一页的标题")
const { scene, timing } = b.build()   // 严格校验 + 编译；有错立即抛出
```

- `place = { in, x, y, w, h, anchor }`，`in` 是区域、组或 `"screen"`。
- `cue(at, time, target, property, duration, to, opts)`：同时登记锚点和节点。**同名锚点必须同一时刻**（不同会抛错）；同一拍的节点共用一个锚点名（如 `t08.00`），检查器里拖一个锚点整拍平移。
- ID 重名、保留名、字段拼错、单位不一致都会在脚本运行时报出来——先让脚本跑通。

## 4. 图元与层级

| kind | 用途 / 要点 |
| --- | --- |
| `rect` | 底、卡、按钮框；`radius`、`shadow`、`stroke`/`strokeStyle`/`strokeWidth`、`stripes` 斜纹；`fill` 可写 CSS 渐变（静态，不能再写 fill 节点） |
| `text` | 自动测量；默认 `motion:"bound"`；`lineHeight`、`letterSpacing`、`padding` + `background` 做胶囊标签 |
| `group` | 子元素 `in` 指向组；**整体 `scale` 连带子文字同缩**；`clip:true` 裁切 |
| `line` | 端点挂元素或 `null`；`curve:"horizontal"\|"vertical"` 贝塞尔；`trim` 生长；`connected` 断开 / 重连；`width` 用 `px(2)`–`px(3)` |
| `path` | SVG `d` + `viewBox`；`trim` 描出 |
| `image` | `fit: contain\|cover`；`radius` |
| `dots` | 点阵底（配 `ignoreMask:true` 进 under 层） |
| `null` | 空对象（无尺寸、不出画）；做线端、分叉点、跟组走的挂点 |

层级：`world`（随相机，默认）/ `under`（`ignoreMask:true`，在遮罩下）/ `screen`（HUD，`in: "screen"`，不随相机）。

## 5. 版式硬规则

- **最小字号 ≥ 14 px**（屏幕实际字号 = `fontSize × 1080 × 相机 zoom × 组缩放`）。正文建议 ≥ 15 px，标题 ≥ 28 px。`check_scene` 低于 13 px 就警告，`--strict` 下算失败。
- **不出画、不撞字**：可见的文字和卡片不能被取景框边缘切掉一部分；推镜前先算好被推出画面的元素是完全出画还是隐藏。
- 文字留足框：固定宽的文字要能装下最长的文本变体。
- 配色克制：一个强调色（如工程蓝 `#2563EB`）+ 一个辅助色（如青 `#0EA5E9` 或琥珀 `#D97706` 表示阻塞 / 风险），其余用墨色与灰阶。

## 6. 运动规范

- **同元素移动，不做假交叉淡化**：A 处的卡要去 B 处，就让同一个元素 / 组移过去、变形过去（x / y / width / height / scale）；不要淡出一张再淡入另一张「长得一样」的卡。
- **自由物体**（rect / image / path / group / null 默认 `motion:"free"`）：位移默认走弧线；要直线写 `arc: 0`。
- **框内受限**（text / dots 默认 `bound`；按钮、标签也请显式 `motion:"bound"`）：只做水平**或**垂直平移 + 透明度；禁止 arc、motionPath、同刻双轴。
- 组整体动：改组，不要把同一节点复制到每个子元素。
- 沿连线走的点：用 `motionPath`（cubic），控制点与 `curve:"horizontal"` 同公式（样片 `horizontalCurve`）。
- 缓动优先 `cubicBezier` 数值；回弹用 spring；命名值只有 `linear / ease / ease-in / ease-out / ease-in-out / sine-in-out`。
- **严禁**用逐帧采样的密集关键帧冒充动画；确需逐帧必须写非空 `bakedReason`。

## 7. 镜头规范

- **一镜到底**：画面中心对准当前讲述的焦点；换段用推拉 / 横移，少切硬镜。
- **重叠运镜，不做硬停**：下一段移镜在上一段尾部就起步；不要等上一段完全停住再动。
- **停留拍要呼吸**：停住时保留轻微推拉（zoom ±1–3%）。
- **2D**：`target.x / y` + `zoom`（推拉用 `interpolation: "log"`）；`lag` 默认 0。
- **双节点透视**（需 `camera.view3d.distance`）：`P.xy = position.xy + approach.xy`。主移镜用 `position.*`（跟 60–80% 路程，与 `target.*` 同时起步）；`approach.*` 晚一点启动、与主移镜**时间重叠**、默认 `arc: 0`，把机位滑回目标点正上方（俯仰 / 偏转归 0）。**禁止**把「移过去」和「归回垂直」串在同一条 position 轨道上——交界处速度掉到 0，画面像卡了一下。

## 8. 演示停靠点（steps）

- 每个场景都要写 `b.step(id, at, title)`：**停靠点 = 这一页动画播完、画面落定的时刻**，标题描述停住时画面上的内容。
- 第一个停靠点放在开场动画落定之后（不要停在空白首帧）；最后一个放在场景结尾。
- 停靠点之间就是「按一次 → 播放一页」：每页 2–5 s 为宜，页内不要留长时间的空白等待。
- 现场演示：`→` 1× 正放到下一停靠点精确停住；过渡中再按先吸附再继续；`←` 同速平滑倒放；`F` 全屏、`H` 隐藏控制条、`1`–`9` 跳页。

## 9. timing.json

- 顶层只放「锚点名 → 有限数字秒」，外加保留键 `segments`（`{ name, start, end, text }`）与 `steps`（`{ id, at, title }`）。
- 读取一律用 `parseTiming(json)` / `timingAnchors(json)`，**禁止** `new Map(Object.entries(json))`。
- 改时间改 timing（或改生成脚本重新生成），不要把秒数写死进 scene。

## 10. 自检硬门槛（缺一不可）

```bash
npm run build
node playground/examples/<name>.mjs                    # 或 node playground/examples/gen_examples.mjs
node tools/check_scene.mjs --strict <name>            # 0 错误、0 逐帧警告、0 质量警告
npm test                                              # 不破坏既有能力
```

然后打开检查器和现场演示目视：构图稳定、文字无撞无裁切、运镜对准焦点且连续、停留有呼吸、每个停靠点停住的画面都是完整的一页。不通过就不要宣称「做完了」。

## 11. 常见禁令

- 不发明未文档化字段；不用 `@0` 坐标习惯（Y 向下、0–100% 边缘）
- 不让 ID 重名；不把 `screen` / `camera` 当普通 ID
- 不对 bound 元素写 arc / 斜向双轴运动
- 不做假交叉淡化；不用密集逐帧 key 代替关键帧 + 缓动
- 不把主移镜与归回垂直塞进同一条 `position` 轨道
- 不改 / 不提交 `_storage/`、字体二进制
