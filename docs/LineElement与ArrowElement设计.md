## LineElement 与 ArrowElement 设计

本文档定义纯 DOM 的直线与箭头元素方案，并约束第一版的响应式尺寸语义。

### 总体约束

1. 仅使用 DOM，不使用 SVG/Canvas。
2. 尺寸字段统一使用百分比字符串（相对容器短边）。
3. 场景切换动画由 CSS transition 驱动。

### LineElement

LineElement 通过两点坐标定义线段：

- `x1, y1, x2, y2`：坐标（可用数值或百分比坐标）
- `strokeWidth`：线宽（百分比）
- `cornerRadius`：圆角（百分比，可省略）
- `color`：线颜色

渲染策略：

1. 计算线段长度与角度。
2. 使用一个绝对定位 div 作为线体。
3. 通过 `translate3d + rotate + scale` 放置线段。

### ArrowElement

ArrowElement 继承 LineElement，采用组合结构：

- 父容器（arrow）
- 子线 `shaft`（主干）
- 子线 `headA/headB`（箭头两翼）

专用字段：

- `arrowSize`：箭头长度（百分比）
- `arrowWidth`：箭头宽度（百分比）

渲染时根据主线几何实时计算三条子线坐标。

### 场景状态扩展

Line/Arrow 推荐使用下列状态字段：

```js
scene.setState(flowArrow, {
  opacity: 1,
  transform: { x: "8%", y: "10%", rotation: 0.5 },
  line: {
    color: "#ffb84d",
    strokeWidth: "0.85%",
    cornerRadius: "0.4%",
  },
  arrow: {
    size: "4.6%",
    width: "2.7%",
  },
})
```

说明：

- `line.*` 对 LineElement 与 ArrowElement 都有效。
- `arrow.*` 仅对 ArrowElement 生效。
- 颜色过渡依赖 `background-color` 的 transition。

### 响应式尺寸基准

尺寸解析基准为容器短边：

`sizeBase = min(contentWidth, contentHeight)`

即便容器宽高比变化，线宽、字体、箭头头部尺寸都会保持相对视觉比例。
