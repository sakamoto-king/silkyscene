# 基础图元 RenderSpec 与 Resolve 规范（运行时零高级元素）

本文档是引擎“彻底重做”阶段的细节规范，用于约束：

- 运行时渲染层（Renderer/Backend）只接收少量稳定的基础图元（Primitive）
- 所有 Definition 中的相对值必须在 Resolve 阶段解算为绝对化后的 Resolved 数据
- Backend 只消费 Resolved 数据，不得看到 `%`、`auto`、`parent`、`flow`、`constraint`、Path 百分比坐标等相对表达

## 1. 分层与职责

### 1.1 Definition（声明层）
Definition 是可序列化、可离线编译的纯数据。Element 只能输出 Definition，不得依赖：

- 容器尺寸（containerWidth/containerHeight）
- 父级已解析布局状态（parent resolved rect）
- 渲染上下文/DOM/运行时对象

Definition 允许表达：

- 百分比（例如 `"10%"`）
- 结构引用（例如 parent/flow/constraint）
- Path 指令中的百分比坐标

### 1.1.1 Lowering 责任（Element 内下沉）

Lowering 口径：**尽量下沉到各 Element 内部**。

- 每个 Element 提供 `lowerToPrimitives(renderableState, meta, context)`：输出仅包含基础图元 kind 的 RenderTree。
- Renderer 不再理解 Arrow/Image/Text 等业务 Element 的结构，只把 Element 当黑盒调用该接口。
- Lowering 输出允许是 Definition（包含 `%` 等相对值）；这些相对值必须在 Resolve 阶段全部解算。

#### ArrowElement 的临时表达

Arrow 需要由端点与箭头尺寸推导两翼几何。为保持 Renderer 不理解 Arrow，本期允许 Arrow lowering 输出 `Path` 的参数化描述：

- `Path.props.commands`：直接给出 commands（用于 shaft）
- `Path.props.builtin = "arrowHead"`：用于 headA/headB；Resolve 阶段把 builtin 展开为真实 `commands`，并确保 commands 全为 number

注意：这是过渡期表达；最终目标仍是 Backend 只见到已解算 commands 的纯 Path。

### 1.2 Resolve（解算层）
Resolve 的输入：

- Lowering 之后的 RenderTree（仅基础图元）
- 每个节点的 Layout/Transform Definition
- 容器尺寸 + 过渡计划（from/to）

Resolve 的输出：

- `ResolvedRect`：像素 `x/y/width/height`（应用 anchor 后）
- `ResolvedTransform`：绝对化的 translate/scale/rotation（数值）
- `ResolvedProps`：已绝对化的图元 props（例如 Path.commands 全部变为 number）
- `ResolvedStyle`：opacity/zIndex/duration/delay/easing 等

### 1.3 Execution（执行层）
Renderer 统一控制：

- 两帧机制（Phase1 禁用 transition 写 from；reflow；Phase2 启用 transition 写 to）
- prewarm
- diff/patch 调用

Backend 只做：

- 将基础图元（已 Resolved）映射到具体后端（DOM/SVG/Canvas/WebGL）
- diff/patch（基于 nodeId/kind）

## 2. 运行时基础图元集合（Primitive Kinds）

运行时只允许以下 kind：

- `Group`：组合容器，不直接绘制
- `Text`
- `Image`
- `Shape`
- `Path`
- `Video`

高级元素（Chart/Table/Markdown 等）必须在编译阶段 Lowering 成上述图元组合。

## 3. RenderTree 结构约束

每个节点：

- `nodeId`：稳定、可预测（用于 DOM 复用、过渡匹配、缓存 key）
- `kind`：上述基础图元之一
- `props`：可序列化纯数据
- `children`：仅 Group 可包含 children

> nodeId 生成规则：推荐 `高级元素id + 语义子键`（例：`table:{id}/cell:r3c2`），局部变更只影响局部节点。

## 4. Resolve 规则（必须全部解算）

### 4.1 百分比（%）
- Layout 的 `left/top/width/height` 百分比相对容器宽/高
- Path 指令坐标百分比相对“节点本地宽/高”（见 5）

### 4.2 anchor
- `left/top` 代表 anchor point，最终像素左上角为：

$$
X = left - width \cdot anchorX \\
Y = top - height \cdot anchorY
$$

### 4.3 parent/flow/constraint
这些属于“语义布局”，必须在更上游编译为绝对 layoutDefinition（百分比形式）。
Resolve 阶段不再做语义布局推导，只做百分比→像素与 anchor/transform 解算。

### 4.4 transform.x/y 的单位语义
- `transform.x/y` 通过 `parseMotionOffset` 解算
- 基准为画布短边（`min(containerWidth, containerHeight)`）
- transform 顺序固定：`translate -> rotate -> scale`

## 5. Path 图元规范（几何指令）

### 5.1 坐标系
- commands 使用 **节点本地坐标系 local space**：原点为该节点 `ResolvedRect` 左上角
- commands 的 `number` 表示 local px
- commands 的 `"%"` 表示相对 local width/height（x/长度对 width；y/长度对 height；半径对 `min(width,height)`）

### 5.2 指令列表（Definition 形态）

- `moveTo`: `{ type: "moveTo", x, y }`
- `lineTo`: `{ type: "lineTo", x, y }`
- `bezierCurveTo`: `{ type: "bezierCurveTo", cp1x, cp1y, cp2x, cp2y, x, y }`
- `quadraticCurveTo`: `{ type: "quadraticCurveTo", cpx, cpy, x, y }`
- `arc`: `{ type: "arc", cx, cy, r, startAngle, endAngle, counterclockwise? }`
- `closePath`: `{ type: "closePath" }`

### 5.3 Resolve 输出
Resolve 后的 `commands` 必须全部为 number（px 或 angle）。Backend 不允许再做单位换算。

## 6. Video 图元规范

- Compiler：允许生成 Video 图元节点
- DomBackend：本期允许 no-op 或最小实现（例如占位节点），但必须：
  - 不崩溃
  - nodeId 稳定映射
  - 过渡/样式与其他节点同等处理

## 7. 参考实现（Resolve 工具）

- Resolve 工具函数在：`packages/@silkysite/scene/src/render/resolve.js`

> 后续 Renderer/Backend 重构应以该工具为唯一口径，确保“所有相对值在 Resolve 阶段解算完成”。
