# SilkyScene

Scene-based motion presentation engine for the web.
基于场景的 Web 动效演示引擎。

---

## Why SilkyScene? / 为什么做 SilkyScene？

As a motion designer, After Effects user, and programming enthusiast, I've always been obsessed with spatial continuity in presentations.

作为一名动效设计师 + After Effects 用户 + 编程爱好者，我一直对演示中的空间连续性有着近乎偏执的追求。

When building animations in PowerPoint, I often relied heavily on Morph transitions and page-to-page object continuity to create smoother storytelling and cinematic motion.

在 PowerPoint 中制作动画时，我大量依赖"平滑"切换和跨页对象连续性来实现更流畅的叙事与电影感动效。

But over time, I realized something frustrating:

但随着时间推移，我意识到一个令人沮丧的问题：

**In traditional slide-based tools, animated objects don't truly persist between slides.**

**在传统幻灯片工具中，动画对象并不能真正跨页持续存在。**

To animate a single element, you often need to duplicate it across multiple pages, manually adjust positions, and maintain consistency yourself. This workflow becomes increasingly difficult as projects grow.

要为一个元素制作动画，往往需要在多个页面中复制它，手动调整位置，并自行维护一致性。随着项目规模增长，这种工作流程变得越来越难以维护。

SilkyScene started as an attempt to rethink presentations from a scene-based perspective rather than a slide-based one.

SilkyScene 最初是一次尝试——从**场景视角**而非幻灯片视角重新思考演示文稿。

Instead of treating presentations as isolated pages, SilkyScene explores the idea of:

与其将演示视为孤立的页面集合，SilkyScene 探索的是：

- persistent objects / **持久化对象**
- spatial continuity / **空间连续性**
- timeline-driven transitions / **时间轴驱动的过渡**
- motion-oriented storytelling / **以动效为核心的叙事**
- scene graphs for presentations / **演示场景图**

I want to break out of the HTML PPT paradigm and explore a motion-native presentation runtime for the web.

我想跳出 HTML PPT 的框架，探索一种面向 Web 的、以动效为原生范式的演示运行时。

---

## Vision / 愿景

SilkyScene is currently an experimental project exploring:

SilkyScene 目前是一个实验性项目，正在探索以下方向：

- Scene systems / 场景系统
- Motion transitions / 动效过渡
- Timeline control / 时间轴控制
- Camera movement / 镜头运动
- Persistent objects / 持久化对象
- Web-based presentation runtime / 基于 Web 的演示运行时

In the future, it may evolve into a full presentation engine, or remain a proof-of-concept. Either way, I hope it sparks new thinking about what presentations can be.

未来它可能发展成为一个完整的演示引擎，也可能只是一个概念验证项目。无论如何，我希望它能激发人们对演示新可能性的思考。

---

## Installation / 安装

```bash
npm install @silkysite/scene
```

---

## v2.0 Breaking Changes / v2.0 重大变更

**⚠️ v2.0.0-alpha introduces breaking changes for improved developer experience.**

**⚠️ v2.0.0-alpha 引入了重大变更，旨在提升开发体验。**

### 1. Incremental State Writing / 增量状态写入

`scene.setState()` now **merges state by default** instead of replacing it entirely.

`scene.setState()` 现在默认**增量合并状态**，而非完全替换。

```javascript
// v1.x - Full state replacement (old behavior)
scene1.setState(element, { layout: {...}, opacity: 1, text: {...} })
scene2.setState(element, { layout: {...}, opacity: 1, text: {...} }) // All duplicated!

// v2.0 - Incremental state (new behavior)
scene1.setState(element, { layout: {...}, opacity: 1, text: {...} })
scene2.setState(element, { text: { color: "red" } }) // Only write what changes!
// Scene2 inherits layout and opacity from scene1
```

**If you need full replacement**, use `scene.replaceState()`:

**如需完全替换**，使用 `scene.replaceState()`：

```javascript
scene.replaceState(element, { opacity: 0 }) // Clears all previous state
```

### 2. Default Layout Mode Changed / 默认布局模式变更

Default `layout.mode` changed from `"relative"` to `"absolute"`.

默认 `layout.mode` 从 `"relative"` 改为 `"absolute"`。

```javascript
// v1.x - Must specify mode every time
setState(element, { layout: { mode: "absolute", left: "10%", ... }})

// v2.0 - Absolute is default
setState(element, { layout: { left: "10%", top: "20%" }}) // mode defaults to "absolute"
```

### 3. Flow Layout Compilation / 流式布局编译

New natural language layout system with automatic compilation to absolute positions.

新增自然语言布局系统，自动编译为绝对定位。

```javascript
// Natural language layout (compiled at startup)
scene.setState(container, {
    layout: {
        mode: "absolute",
        left: "10%", top: "10%",
        width: "80%", height: "80%",
        flow: "row",      // or "column"
        gap: "2%",        // spacing between children
        align: "center",  // start | center | end
        justify: "start"  // start | center | end
    }
})

// Child elements automatically positioned within parent flow
```

### 4. Parent Binding / 父子绑定

Scene-level parent binding for dynamic layout relationships.

场景级父子绑定，支持动态布局关系。

```javascript
scene.setState(child, state, {
    parent: {
        enabled: true,
        targetId: parent.id
    }
})
// Child inherits parent's flow layout rules
```

### 5. Import/Export Support / 导入导出支持

New `SceneIO` API for serializing and deserializing presentations.

新增 `SceneIO` API，支持演示工程的序列化与反序列化。

```javascript
import { SceneIO } from "@silkysite/scene"

// Export presentation to JSON
const json = SceneIO.exportSource(presentation)

// Import from JSON
const restored = SceneIO.importSource(container, json)
```

See [Migration Guide](#migration-guide) for detailed upgrade instructions.

详见[迁移指南](#migration-guide)了解升级详情。

---

## Architecture / 架构速览

SilkyScene separates **semantic planning** from **render execution**.

SilkyScene 把“动画语义规划”和“渲染执行”拆成两层，避免语义与 DOM 逻辑耦在一起。

- **Scene**：State table / 状态输入表
  - Stores element states + metadata (entrance/exit/delayPattern/tombstone).
  - 只存“元素在该场景应如何表现”的状态与元数据，不持有 DOM。

- **Presentation**：Orchestrator / 编排器
  - Maintains resolved cache (inheritance + tombstone), resolves transition config.
  - On scene change, generates a **transitionPlan (SceneChangePlan)** and passes it to Renderer.
  - 切场景时会生成 `transitionPlan`（纯数据的“切场景执行计划”），把方向、from/to、delay 镜像等语义计算集中在这里。

- **Renderer**：Executor / 执行器
  - Consumes `transitionPlan` and writes DOM styles (delay/from/to).
  - Uses the two-frame entrance mechanism to reliably trigger CSS transitions.
  - 只负责按计划写 DOM，并执行两帧入场（见机制文档）。

If you only use `presentation.setScene(...)`, you normally don't need to care about `transitionPlan`.

如果你只通过 `presentation.setScene(...)` 切场景，通常不需要关心 `transitionPlan`；它主要用于引擎内部的“语义 → 执行”边界，或自定义渲染后端时的接入点。

Docs:
- `docs/运行时对象与状态模型.md`
- `docs/两帧渲染机制.md`
- `docs/架构演进/scene-v2-思维模型与实现路线.md`

---

## Quick Start / 快速开始

```javascript
import { Presentation, Scene, TextElement } from "@silkysite/scene"

const presentation = new Presentation("#container")

const title = new TextElement({
    text: "Hello SilkyScene",
    layout: { left: "50%", top: "50%" }
})
presentation.addElement(title)

const scene1 = new Scene("intro")
scene1.setState(title, { opacity: 0 })
presentation.addScene(scene1)

const scene2 = new Scene("show")
```
---

## Batch & Factories / 批量与模板

当场景较大时，重复的 `new ...`、`presentation.addElement(...)`、`scene.setState(...)` 会变得冗长。
v2 在保持原有 API 不变的前提下，提供了一组可选的“批量与模板”能力，用于减少样板代码。

### 1) 批量添加元素

```js
presentation.addElements([title, subtitle, box])
```

### 2) 批量创建并注册元素（支持 name 注册表）

```js
const registry = presentation.createElements([
  { type: "text", name: "title", options: { text: "Hello", fontSize: "8%" } },
  { type: "shape", name: "panel", options: { shapeType: "rect", fill: "#111" } },
])

// registry.byName.get("title") / registry.byName.get("panel")
```

### 3) 按 name 查找

```js
const title = presentation.getElementByName("title")
const allTitles = presentation.getElementByName("title", { multiple: true })
```

### 4) 批量写入状态（顺序稳定，兼容 delayPattern:'auto'）

```js
scene.setDelayPattern("auto", { interval: 100 })

scene.setStates([
  { element: title, state: { opacity: 1 } },
  { element: subtitle, state: { opacity: 1 } },
  { element: panel, state: { opacity: 1 } },
])
```

> 说明：`setStates` 使用数组 entries，保证写入顺序稳定；因此 auto delay 会严格按 entries 顺序递增。

### 5) “同款文字”工厂（样式模板）

```js
const Title = presentation.createTextFactory({
  fontSize: "8%",
  color: "#fff",
  textAlign: "center",
  lineHeight: 1.2,
})

const t1 = Title({ text: "封面标题" })
const t2 = Title({ text: "第二行标题", fontSize: "6%" }) // 允许覆写

```

默认情况下，工厂创建的元素会自动 `addElement` 注册（可传 `{ autoAdd: false }` 关闭）。

```
scene2.setState(title, { opacity: 1 }) // Inherits layout from scene1!
presentation.addScene(scene2)

presentation.mountContent().bindRenderer().goToScene(0)
```

---

## SceneIO - Import/Export / 场景导入导出

`SceneIO` provides source-level JSON serialization for presentations.

`SceneIO` 为演示工程提供源码级 JSON 序列化能力。

### Export / 导出

```javascript
import { SceneIO } from "@silkysite/scene"

const json = SceneIO.exportSource(presentation)
console.log(JSON.stringify(json, null, 2))

// Save to file or version control
localStorage.setItem("myPresentation", JSON.stringify(json))
```

### Import / 导入

```javascript
const json = JSON.parse(localStorage.getItem("myPresentation"))
const presentation = SceneIO.importSource("#container", json)

presentation.bindRenderer().goToScene(0)
```

### JSON Structure / JSON 结构

```json
{
  "schemaVersion": "2.0.0-alpha",
  "kind": "@silkysite/scene-source",
  "presentation": {
    "options": { ... }
  },
  "elements": [
    {
      "ref": "e1",
      "type": "text",
      "options": { "text": "Hello", ... }
    }
  ],
  "scenes": [
    {
      "name": "scene1",
      "transition": { "duration": 500 },
      "states": {
        "e1": {
          "state": { "opacity": 1 },
          "meta": { "entrance": true }
        }
      },
      "removed": []
    }
  ]
}
```

### Minimal Example / 最小可用示例

```javascript
import { Presentation, Scene, TextElement, SceneIO } from "@silkysite/scene"

// Create a simple presentation
const presentation = new Presentation("#container")

const text = new TextElement({ text: "Export Me" })
presentation.addElement(text)

const scene = new Scene("main")
scene.setState(text, {
    layout: { left: "50%", top: "50%" },
    opacity: 1
})
presentation.addScene(scene)

presentation.mountContent().bindRenderer().goToScene(0)

// Export to JSON
const json = SceneIO.exportSource(presentation)
console.log(json)

// Re-import in another project
const cloned = SceneIO.importSource("#another-container", json)
cloned.bindRenderer().goToScene(0)
```

---

## Migration Guide / 迁移指南

### From v1.x to v2.0 / 从 v1.x 迁移到 v2.0

1. **Review all `setState()` calls**  
   检查所有 `setState()` 调用
   - Remove redundant state declarations across scenes
   - 删除跨场景的冗余状态声明
   - Use `replaceState()` if you need full replacement
   - 如需完全替换，使用 `replaceState()`

2. **Update layout mode defaults**  
   更新布局模式默认值
   - Remove explicit `mode: "absolute"` declarations
   - 移除显式的 `mode: "absolute"` 声明
   - Add `mode: "relative"` if you relied on relative positioning
   - 若依赖相对定位，添加 `mode: "relative"`

3. **Test scene transitions**  
   测试场景切换
   - Verify state inheritance works as expected
   - 验证状态继承符合预期
   - Check for unintended state leakage
   - 检查意外的状态泄漏

---

## Docs / 文档

- `docs/运行时对象与状态模型.md`：对象模型、场景继承、响应式尺寸规范
- `docs/场景入场语法糖提案.md`：entrance/exit/direction 语义与 distance 规则
- `docs/两帧渲染机制.md`：入场动画两帧执行流程
- `docs/LineElement与ArrowElement设计.md`：纯 DOM 线段与组合箭头设计
- `docs/ShapeElement设计与矩形实现.md`：rect/circle 图形、描边、圆角与场景状态设计
- `docs/架构演进/scene-v2-思维模型与实现路线.md`：v2.0 架构设计文档

---

## License / 许可证

MIT