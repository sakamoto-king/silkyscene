## SilkyScene 与 PPT、After Effects 的模型差异

SilkyScene 是为高性能 Web 动画设计的框架。虽然在功能上它能支持类似 PPT 或 After Effects（AE）的演示编排能力，但在核心模型上有显著差异，理解这些差异有助于正确使用 SilkyScene。

### PPT 模型：页面拥有元素

PowerPoint 的核心思想是"页面"。每个页面是一个容器，页面上放着多个对象（文本框、图片、形状等）。即使你在多个页面中使用相同的图片，PPT 内部也是复制出深度各异的多份拷贝。页面与页面之间是相对独立的，切换页面时旧页面的元素会被移出视图。

```
Page 1: [Element A copy, Element B copy, Shape 1]
Page 2: [Element A copy (different instance), Element B copy (different instance), Shape 2]
```

### AE 模型：时间轴上的关键帧

After Effects 的核心是"时间轴"。每个元素在时间轴上有关键帧（keyframe），定义了该元素在不同时刻的属性值。AE 在时间轴流动中自动插值，生成中间帧。元素本身是唯一的，但它的属性（位置、大小、透明度等）随时间变化。

```
Timeline: 0s --- 1s --- 2s --- 3s
Element A: pos: (0,0) + scale: 1.0 | pos: (100,100) + scale: 0.5 | pos: (200,200) + scale: 0.3
```

### SilkyScene 模型：状态节点而非时间轴

SilkyScene 结合了两者的优点，但引入了新的概念。

**元素独立存在**。不像 PPT，SilkyScene 中一个 Element 对象只有一份实例，不会因为在多个 Scene 中出现就被复制。

**Scene 是状态节点，不是容器**。Scene 不"拥有"元素，而是记录元素在该时刻应该如何表现。一个 Element 可以在 Scene A 中显示为红色、Scene B 中显示为蓝色，但都引用的是同一个 Element 对象。

```
Element (singular): { id: "title", type: "text", text: "Hello" }

Scene 1 State: { title: { layout: { left: "50%", top: "50%" }, opacity: 1 } }
Scene 2 State: { title: { layout: { left: "10%", top: "10%" }, opacity: 0.5 } }

(Same Element, different states in different scenes)
```

**时间流由应用驱动，不是内置时间轴**。SilkyScene 没有全局的时间轴和自动插值。相反，应用层决定何时从 Scene 1 切到 Scene 2。切换时，Renderer 计算当前 Scene 对该 Element 的新状态，然后生成从旧状态到新状态的过渡动画（如果配置了过渡时长）。

```
User interaction or auto-play: setScene(scene2)
↓
Renderer: read old state from scene1, read new state from scene2
↓
Animation: interpolate over duration
↓
Update Element on each frame
```

### 对比总结

| 维度 | PPT | AE | SilkyScene |
|-----|-----|-----|----------|
| **元素管理** | 页面拥有（复制） | 全局唯一 | 全局唯一 |
| **状态定义** | 页面属性 | 关键帧 + 时间轴 | Scene 状态快照 |
| **时间控制** | 页面翻页 | 自动时间轴流 | 应用驱动切换 |
| **元素共享** | 不支持（复制） | 部分支持（嵌套comp）| 完全支持（Scene 共享） |
| **渲染优化** | 页面级 | 预渲染或实时 | Transform 级 |

### 何时使用 SilkyScene

SilkyScene 适合：

- **多场景演示**：同一批元素在多个状态间切换，避免复制
- **响应式动画**：元素布局根据容器响应式变化，而不是固定坐标
- **高并发动画**：大量元素同时运动，需要高性能 GPU 加速
- **多平台输出**：使用统一的元素定义与状态模型，支持 DOM、Canvas、WebGL 等不同后端
- **编程驱动**：通过代码精确控制演示流程，而不是依赖编辑器 UI

SilkyScene 不适合：

- **简单静态页面**：如果只是展示，用 HTML + CSS 足够
- **复杂嵌套动画曲线**：如果需要 AE 那样的复杂关键帧与曲线编辑，SilkyScene 不是首选
- **素材级合成**：如果需要视频、音频、滤镜等多媒体合成，应该用专业工具

### 设计哲学

SilkyScene 的哲学是：

> 元素是持久的、独立的图形对象。  
> Scene 是这些对象在某时刻的状态定义。  
> 演示流程由应用层驱动，而不是由内置引擎自动播放。  
> 渲染优化采用 transform，而不是重排或重绘。

这使得 SilkyScene 成为一个轻量级的、可组合的 Web 演示框架。
