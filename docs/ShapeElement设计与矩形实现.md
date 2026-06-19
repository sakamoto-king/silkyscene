## ShapeElement 与矩形 / Circle 实现

本文档定义基于 `ShapeElement` 的第一版图形能力。矩形通过 `shapeType: "rect"` 表达，圆形继续通过 `shapeType: "circle"` 表达；不新增独立的 `RectangleElement`、`CircleElement` 或 `ellipse` 语义。

### 总体约束

1. 仅使用 DOM，不使用 SVG/Canvas。
2. 图形尺寸字段统一使用百分比字符串。
3. 尺寸基准为容器短边：`min(contentWidth, contentHeight)`。
4. 第一版只支持：填充、描边、描边宽度、圆角。
5. `circle` 在宽高相等时显示为正圆；在宽高不等时允许自然显示为椭圆外观，但语义仍然保持 `circle`。

### ShapeElement

`ShapeElement` 是通用图形元素，当前重点支持 `shapeType: "rect"` 与 `shapeType: "circle"`：

- `shapeType`：图形类型，第一版重点支持 `rect`
- `fill`：填充颜色
- `stroke`：描边颜色
- `strokeWidth`：描边宽度（百分比）
- `cornerRadius`：圆角半径（百分比）

说明：

- `rect` 使用 `cornerRadius` 作为显式圆角控制。
- `circle` 会忽略 `cornerRadius`，直接使用最大圆角策略。
- `circle` 不额外引入 `radiusX/radiusY`；外观由 `layout.width/height` 决定。

### 矩形渲染方式

矩形使用绝对定位 div 渲染：

1. 由 `Layout.resolve()` 计算 `x/y/width/height`
2. 写入 `width/height`
3. 使用 `background-color` 表示填充色
4. 使用 `border` 表示描边
5. 使用 `border-radius` 表示圆角
6. 使用 `transform` 负责位移、旋转、缩放

### Circle 渲染方式

circle 与 rect 共用同一个绝对定位 div：

1. 同样通过 `Layout.resolve()` 求得 `x/y/width/height`
2. 同样通过 `background-color`、`border` 表示填充和描边
3. 不再读取 `cornerRadius`，而是直接使用 `border-radius: 50%`
4. 当宽高相等时得到正圆；宽高不等时自然得到椭圆外观
5. 位移、旋转、缩放仍然统一走 `transform`

### 场景状态写法

推荐将图形样式状态挂在 `shape` 字段下：

```js
scene.setState(cardRect, {
  opacity: 1,
  transform: {
    x: "18%",
    y: "6%",
    rotation: 0.18,
    scaleX: 1.18,
    scaleY: 1.18,
  },
  shape: {
    fill: "#6638a6",
    stroke: "#f2c3ff",
    strokeWidth: "0.45%",
    cornerRadius: "2.4%",
  },
})
```

### 与场景继承的关系

rect、circle 和文本、线段、箭头使用同一套场景最终态缓存：

- 未声明时继承上一场景最终态
- `removeState()` 会阻断继承
- `entrance/exit` 可直接复用现有方向动画

### Demo 建议

推荐至少演示以下四类动画：

1. 位移
2. 旋转
3. 颜色变化
4. 缩放

对于 rect，可额外展示圆角变化；对于 circle，可额外展示描边粗细变化，以及通过改变宽高呈现椭圆外观。
