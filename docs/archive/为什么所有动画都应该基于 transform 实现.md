SilkyScene 的设计目标包括支持大量元素同时运动、场景间的空间连续性、响应式布局与 Web 环境下的高性能动画。为此，SilkyScene 必须避免传统浏览器布局动画的性能瓶颈。

## 浏览器动画的性能成本

在浏览器中，不同 CSS 属性的动画成本差异显著。修改 `left、top、width、height、margin、padding` 等属性通常会触发完整的浏览器渲染流程：先计算布局，再重绘，最后合成。这三个阶段都较为耗时，在大量元素同时动画时，浏览器需要反复重新计算文档流，造成 layout thrashing，性能迅速下降。

相比之下，改动 `transform` 与 `opacity` 属性通常仅触发合成阶段（Composite），很多情况下可以直接由 GPU 处理。这意味着不需要重新布局或重新绘制，浏览器性能更稳定，更适合大量对象同时动画、更容易实现 60fps。

因此，SilkyScene 的所有运动都必须基于 transform 实现，而不是 left/top/width/height。

## SilkyScene 的设计分离

SilkyScene 将布局计算和动画渲染视为两个完全不同的阶段。

### 第一阶段：Layout Resolve

布局阶段将相对坐标描述转换为绝对坐标。例如，`{ left: "50%", centerY: true }` 根据父容器与自身尺寸最终被计算为 `{ x: 812, y: 320 }`。这个阶段支持复杂布局逻辑：响应式规则、父子关系、百分比解析、约束求解。

关键约束：布局仅在状态切换时计算，每一帧渲染不重新计算。

### 第二阶段：Animation Render

渲染阶段基于两个布局结果（fromComputed 与 toComputed）进行数值插值，最后通过 `transform: translate3d(...)` 输出。这个阶段只负责插值与即时渲染，不涉及复杂求解。

## 分离的优势

transform 动画相比 layout 动画有本质的性能优势：可同时运行大量动画、减少浏览器布局压力、避免 layout thrashing、容易实现 60fps。这个设计也为未来支持 Canvas、SVG、WebGL 等多渲染后端提供基础。

## 组件职责

**Renderer** 负责计算最终布局、生成 transform、处理插值、输出渲染指令。它接收 Element 的布局声明与 SceneState 的状态覆盖，计算 computed，驱动 DOM 或 Canvas 更新。Element 不应直接操作 DOM。

**Element** 是运行时空间对象，保存内容数据（文本、图片源、图形类型）、基础属性（ID、名称、可见性）、布局描述（相对坐标系）、变换数据（scaleX、scaleY、rotation）、视觉状态（opacity、zIndex、blendMode）。computed 是计算结果，由 Renderer 赋值，应用不应直接编辑。

**Scene** 不拥有 Element 实体。Element 属于 Presentation 整个生命周期，Scene 只描述 Element 的状态快照。通过 `scene.setState(title, { layout: { left: "50%" } })` 为某个元素设置该场景的状态，但 Element 本体保持独立。

## 禁止模式

每帧重新计算布局（错误：`requestAnimationFrame(() => calculateLayout())`）。正确做法是仅在状态变化时计算。

动画修改 left/top（错误：`element.style.left = x + "px"`）。正确做法是 `element.style.transform = translate3d(...)`。

Scene 直接持有 DOM（Scene 应该是纯状态对象）。

Scene 拥有 Element 实体（Presentation 拥有 Element，Scene 只保存状态）。

## 当前优先级

当前重点是建立 State-based Runtime Architecture，而不是 Timeline Editor、Keyframe System 或复杂动画曲线。

优先级顺序如下：

1. Presentation：元素池与生命周期
2. Scene State：状态管理
3. Layout Engine：布局求解
4. Renderer：渲染驱动
5. Transform Animation：插值

## 核心思想

可以把这套设计归结为一句话：布局只在状态切换时求解一次，运动只在两个已求解状态之间通过 transform 渲染。