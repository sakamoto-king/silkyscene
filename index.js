/** 场景引擎导出入口。 */

export { Presentation } from "./src/core/Presentation.js" // 演示文稿：管理元素生命周期、场景编排与状态切换
export { Scene } from "./src/core/Scene.js" // 场景：保存元素状态快照的纯容器
export { BaseElement } from "./src/core/BaseElement.js" // 基类：所有元素的数据基础，独立的空间对象
export { TextElement } from "./src/elements/TextElement.js" // 文本元素：继承 BaseElement，包含文本语义
export { ImageElement } from "./src/elements/ImageElement.js" // 图片元素：继承 BaseElement，包含图像语义
export { ShapeElement } from "./src/elements/ShapeElement.js" // 图形元素：继承 BaseElement，包含形状语义
export { LineElement } from "./src/elements/LineElement.js" // 直线元素：两点定义、纯 DOM 渲染
export { ArrowElement } from "./src/elements/ArrowElement.js" // 箭头元素：父 + 三子线组合渲染
export { Renderer } from "./src/legacy/Renderer.js" // 渲染器：计算布局、驱动插值、输出渲染结果
export { Layout } from "./src/legacy/Layout.js" // 布局引擎：将相对布局描述转换为绝对坐标
export { SceneIO } from "./src/io/SceneIO.js" // 工程导入导出：源码 JSON 形态
export { SceneGeometry } from "./src/geometry/SceneGeometry.js" // 场景几何查询：纯计算预测 + 九宫格点位