# 早期设计归档

这里是 SilkyScene 重构前的设计文档：旧版运行时（Scene / Presentation API、两帧渲染、SceneIO 导入导出）以及当时关于「为什么动画都应基于 transform」「与 PPT / AE 的模型差异」「与 Remotion 分工」的思考。

它们记录了项目从「可演示」走向「画布优先 + 确定性运动引擎」的思路演变，**不构成现行契约**：坐标、字段与 API 以 [`docs/01`–`06`](../README.md) 和 `parseProject` 报错为准（旧文档多为 Y 向下、0–100% 的旧坐标习惯）。

| 文档 | 主题 |
| --- | --- |
| [为什么所有动画都应该基于 transform 实现](./为什么所有动画都应该基于%20transform%20实现.md) | 动画只消费确定几何 |
| [两帧渲染机制](./两帧渲染机制.md) | 旧版状态切换的渲染时序 |
| [运行时对象与状态模型](./运行时对象与状态模型.md) | 旧版 Presentation / Scene / Element 模型 |
| [基础图元 RenderSpec 与 Resolve 规范](./基础图元RenderSpec与Resolve规范.md) | 解算结果的早期定义 |
| [ShapeElement 设计与矩形实现](./ShapeElement设计与矩形实现.md)、[LineElement 与 ArrowElement 设计](./LineElement与ArrowElement设计.md) | 早期图元 |
| [SceneIO 使用指南](./SceneIO使用指南.md) | 旧版导入导出协议 |
| [场景入场语法糖提案](./场景入场语法糖提案.md) | 入场动画的写法提案 |
| [Scene v2 思维模型与实现路线](./scene-v2-思维模型与实现路线.md) | 重构方向 |
| [SilkyScene 与 PPT 和 AE 的模型差异](./SilkyScene与PPT和AE的模型差异.md) | 产品定位 |
| [与 Remotion 的分工（讨论稿）](./与Remotion的分工-讨论稿.md) | 视频导出的早期设想 |
