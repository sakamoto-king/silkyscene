# SceneIO 使用指南

`SceneIO` 提供场景工程的导入导出能力，支持将 Presentation 序列化为 JSON 格式，用于持久化存储、版本控制或跨项目迁移。

---

## 核心概念

### 设计目标

- **源码形态**：导出为可读、可编辑的 JSON 源码格式
- **完整保真**：包含所有元素、场景、状态、元数据
- **跨项目迁移**：使用符号引用（如 `e1`, `e2`）代替运行时 ID
- **版本化支持**：包含 schema 版本号，便于未来扩展

### 适用场景

1. **持久化存储**：将演示工程保存到文件或数据库
2. **版本控制**：将 JSON 源码提交到 Git 等版本控制系统
3. **模板复用**：导出演示模板供其他项目使用
4. **云端同步**：在不同设备间同步演示工程
5. **协作编辑**：导出 JSON 供他人编辑后再导入

---

## API 参考

### `SceneIO.exportSource(presentation)`

导出演示工程为源码 JSON 对象。

**参数：**
- `presentation` (Presentation) - 待导出的演示实例

**返回：**
- `Object` - 源码 JSON 对象

**示例：**
```javascript
import { SceneIO } from "@silkysite/scene"

const json = SceneIO.exportSource(presentation)
console.log(JSON.stringify(json, null, 2))
```

### `SceneIO.importSource(container, source)`

从源码 JSON 还原演示工程。

**参数：**
- `container` (HTMLElement | string) - 演示容器（DOM 元素或选择器）
- `source` (Object) - 源码 JSON 对象

**返回：**
- `Presentation` - 还原的演示实例

**示例：**
```javascript
const presentation = SceneIO.importSource("#container", json)
presentation.bindRenderer().goToScene(0)
```

---

## 完整示例

### 基础导出导入

```javascript
import { Presentation, Scene, TextElement, ImageElement, SceneIO } from "@silkysite/scene"

// 创建演示
const presentation = new Presentation("#container", {
    aspectRatio: 16 / 9
})

// 添加元素
const title = new TextElement({
    name: "Title",
    text: "Hello SilkyScene",
    layout: { left: "50%", top: "20%" }
})

const image = new ImageElement({
    name: "Logo",
    src: "/logo.png",
    layout: { left: "50%", top: "50%", width: "30%" }
})

presentation.addElement(title)
presentation.addElement(image)

// 创建场景
const scene1 = new Scene("intro")
scene1.setState(title, { opacity: 0 })
scene1.setState(image, { opacity: 0, transform: { scale: 0.5 } })

const scene2 = new Scene("show")
scene2.setState(title, { opacity: 1 })
scene2.setState(image, { opacity: 1, transform: { scale: 1 } })

presentation.addScene(scene1)
presentation.addScene(scene2)

// 导出为 JSON
const json = SceneIO.exportSource(presentation)

// 保存到 localStorage
localStorage.setItem("myPresentation", JSON.stringify(json))

// 从 localStorage 恢复
const savedJson = JSON.parse(localStorage.getItem("myPresentation"))
const restored = SceneIO.importSource("#container", savedJson)

restored.mountContent().bindRenderer().goToScene(0)
```

### 保存到文件

```javascript
// 浏览器端下载为文件
const json = SceneIO.exportSource(presentation)
const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" })
const url = URL.createObjectURL(blob)
const a = document.createElement("a")
a.href = url
a.download = "presentation.json"
a.click()
URL.revokeObjectURL(url)
```

### 从文件加载

```javascript
// 读取文件
const fileInput = document.getElementById("fileInput")
fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0]
    const text = await file.text()
    const json = JSON.parse(text)
    
    const presentation = SceneIO.importSource("#container", json)
    presentation.bindRenderer().goToScene(0)
})
```

### 网络传输

```javascript
// 上传到服务器
const json = SceneIO.exportSource(presentation)
await fetch("/api/presentations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json)
})

// 从服务器加载
const response = await fetch("/api/presentations/123")
const json = await response.json()
const presentation = SceneIO.importSource("#container", json)
presentation.bindRenderer().goToScene(0)
```

---

## JSON 结构详解

### 顶层结构

```json
{
  "schemaVersion": "2.0.0-alpha",
  "kind": "@silkysite/scene-source",
  "presentation": { ... },
  "elements": [ ... ],
  "scenes": [ ... ]
}
```

**字段说明：**
- `schemaVersion`：格式版本号，用于向后兼容
- `kind`：标识符，固定为 `@silkysite/scene-source`
- `presentation`：演示全局配置
- `elements`：元素定义数组
- `scenes`：场景定义数组

### `presentation` 对象

```json
{
  "presentation": {
    "options": {
      "aspectRatio": 1.7777777777777777,
      "sceneTransition": { "duration": 500, "easing": "ease-in-out" },
      "navigation": { "keyboard": true },
      "preload": { "enabled": true }
    }
  }
}
```

### `elements` 数组

```json
{
  "elements": [
    {
      "ref": "e1",
      "type": "text",
      "options": {
        "name": "Title",
        "text": "Hello",
        "layout": { "mode": "absolute", "left": "50%", "top": "20%" },
        "opacity": 1,
        "zIndex": 1
      }
    },
    {
      "ref": "e2",
      "type": "image",
      "options": {
        "name": "Logo",
        "src": "/logo.png",
        "layout": { "mode": "absolute", "left": "50%", "top": "50%", "width": "30%" }
      }
    }
  ]
}
```

**字段说明：**
- `ref`：符号引用（如 `e1`, `e2`），用于在场景中引用元素
- `type`：元素类型（`text` | `image` | `shape` | `line` | `arrow`）
- `options`：元素配置（包含布局、样式、内容等所有属性）

### `scenes` 数组

```json
{
  "scenes": [
    {
      "name": "intro",
      "transition": { "duration": 800, "easing": "cubic-bezier(0.4, 0, 0.2, 1)" },
      "states": {
        "e1": {
          "state": { "opacity": 0 },
          "meta": { "entrance": { "enabled": true, "direction": "bottom", "distance": "10%" } }
        },
        "e2": {
          "state": { "opacity": 0, "transform": { "scale": 0.5 } },
          "meta": {}
        }
      },
      "removed": []
    },
    {
      "name": "show",
      "transition": null,
      "states": {
        "e1": {
          "state": { "opacity": 1 },
          "meta": {}
        },
        "e2": {
          "state": { "opacity": 1, "transform": { "scale": 1 } },
          "meta": {}
        }
      },
      "removed": []
    }
  ]
}
```

**字段说明：**
- `name`：场景名称
- `transition`：切换到该场景时的动画配置
- `states`：元素状态映射表（key 为 `ref`）
  - `state`：元素在当前场景的状态快照
  - `meta`：状态元数据（entrance、exit、parent 等）
- `removed`：在当前场景被移除的元素 ref 列表

---

## 进阶用法

### 父子绑定的序列化

```javascript
const container = new ShapeElement({
    name: "Container",
    layout: { left: "10%", top: "10%", width: "80%", height: "80%", flow: "row", gap: "2%" }
})

const child = new TextElement({ name: "Child", text: "I'm a child" })

presentation.addElement(container)
presentation.addElement(child)

const scene = new Scene("layout")
scene.setState(container, { opacity: 1 })
scene.setState(child, { opacity: 1 }, {
    parent: {
        enabled: true,
        targetId: container.id
    }
})

// 导出时，parent.targetId 会自动转换为 parent.targetRef
const json = SceneIO.exportSource(presentation)
console.log(json.scenes[0].states.e2.meta.parent)
// { enabled: true, targetRef: "e1" }

// 导入时，parent.targetRef 会自动还原为 parent.targetId
const restored = SceneIO.importSource("#container", json)
```

### 模板系统示例

```javascript
// 定义演示模板
const template = {
    schemaVersion: "2.0.0-alpha",
    kind: "@silkysite/scene-source",
    presentation: {
        options: { aspectRatio: 16 / 9 }
    },
    elements: [
        {
            ref: "e1",
            type: "text",
            options: {
                name: "Title",
                text: "{{TITLE}}",
                layout: { left: "50%", top: "30%" }
            }
        },
        {
            ref: "e2",
            type: "text",
            options: {
                name: "Subtitle",
                text: "{{SUBTITLE}}",
                layout: { left: "50%", top: "50%" }
            }
        }
    ],
    scenes: [
        {
            name: "main",
            states: {
                e1: { state: { opacity: 1 }, meta: {} },
                e2: { state: { opacity: 1 }, meta: {} }
            }
        }
    ]
}

// 使用模板创建演示
function createFromTemplate(data) {
    const json = JSON.parse(JSON.stringify(template))
    json.elements[0].options.text = data.title
    json.elements[1].options.text = data.subtitle
    return SceneIO.importSource("#container", json)
}

const presentation = createFromTemplate({
    title: "Welcome to SilkyScene",
    subtitle: "Scene-based motion engine"
})
```

---

## 注意事项

### 1. 运行时数据不会被导出

以下数据不包含在导出的 JSON 中：
- 已解析的元素尺寸（`resolvedRect`）
- 场景状态缓存（`resolvedCache`）
- 编译后的布局（`compiledSceneLayoutCache`）
- 渲染器实例（`renderer`）

这些数据会在 `importSource` 后重新计算。

### 2. 外部资源路径

图片等外部资源使用相对路径或绝对 URL：

```javascript
const image = new ImageElement({
    src: "/assets/logo.png"  // 确保路径在目标环境有效
})
```

### 3. 自定义元素类型

`SceneIO` 默认支持内置元素类型（text、image、shape、line、arrow）。  
如需支持自定义元素，需扩展 `createElementByType` 方法：

```javascript
class CustomSceneIO extends SceneIO {
    static createElementByType(type, options) {
        if (type === "custom") {
            return new CustomElement(options)
        }
        return super.createElementByType(type, options)
    }
}
```

---

## 最佳实践

### 1. 版本化管理

```javascript
// 在 JSON 中添加自定义版本信息
const json = SceneIO.exportSource(presentation)
json._meta = {
    version: "1.0.0",
    author: "Your Name",
    createdAt: new Date().toISOString()
}
```

### 2. 增量更新

```javascript
// 导出差异而非完整工程
function exportDelta(presentation, lastExport) {
    const current = SceneIO.exportSource(presentation)
    // 比较并只保存变化的场景
    return computeDiff(lastExport, current)
}
```

### 3. 压缩存储

```javascript
import pako from "pako"

// 压缩导出
const json = SceneIO.exportSource(presentation)
const compressed = pako.deflate(JSON.stringify(json))
const base64 = btoa(String.fromCharCode(...compressed))
localStorage.setItem("presentation", base64)

// 解压导入
const base64 = localStorage.getItem("presentation")
const compressed = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
const json = JSON.parse(pako.inflate(compressed, { to: "string" }))
const presentation = SceneIO.importSource("#container", json)
```

---

## 故障排查

### 导入失败

**问题**：`importSource` 抛出错误或元素丢失

**解决方案**：
1. 检查 JSON 格式是否正确
2. 确认 `schemaVersion` 与当前版本兼容
3. 验证所有 `ref` 引用是否有效
4. 检查容器选择器是否正确

### 状态不一致

**问题**：导入后场景状态与导出前不一致

**解决方案**：
1. 确保在导出前调用了 `mountContent()` 初始化元素
2. 检查外部资源路径是否有效
3. 验证父子绑定关系是否正确

### 性能问题

**问题**：大型演示工程导入/导出缓慢

**解决方案**：
1. 使用 Web Worker 在后台处理
2. 实现增量导出/导入
3. 使用二进制格式（如 MessagePack）代替 JSON

---

## 相关文档

- [运行时对象与状态模型](./运行时对象与状态模型.md)
- [场景入场语法糖提案](./场景入场语法糖提案.md)
- [Scene v2 思维模型与实现路线](./架构演进/scene-v2-思维模型与实现路线.md)
