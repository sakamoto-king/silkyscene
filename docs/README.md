# SilkyScene 文档

当前有效的设计与能力说明。`parseProject` 严格校验：文档未列出的字段一律报错。坐标统一为 `silkyscene@1`（中心 0、Y 向上、1 u = 1080 px、百分比边缘 ±50%、anchor ∈ [-1, 1]）。

给 AI 编码代理直接开工的硬性手册见仓库根目录 [`AGENTS.md`](../AGENTS.md)。

> **双模合一 = 现场步进演示 `present.html` + 确定性视频导出 `player.html` / `export:mp4`。**

| 编号 | 文档 | 要点 |
| --- | --- | --- |
| 01 | [设计基线与项目愿景](./01-设计基线与项目愿景.md) | 确定的布局链路、坐标硬契约、项目文档是一等产品 |
| 02 | [混合渲染与图元规范](./02-混合渲染与图元规范.md) | DOM + SVG、world / under / screen、八种图元、节点与缓动、渐变、lintScene |
| 03 | [运动角色与空对象](./03-运动角色与空对象.md) | `null` 空对象、`motion: free | bound`、默认弧线、motionPath |
| 04 | [相机：弧线跟随与双节点透视](./04-相机-弧线跟随与双节点透视.md) | 2D 目标点 / 取景、lag、双节点 `position + approach` 重叠运镜 |
| 05 | [检查器、现场演示与场景构建](./05-检查器-现场演示与场景构建.md) | `createSceneBuilder`、`present.html` 步进演示、timing.json、`check_scene`、五分钟写一份现场汇报 |
| 06 | [视频导出与 HyperFrames 接入](./06-视频导出与HyperFrames接入.md) | `npm run export:mp4`、`player.html`、HyperFrames 协议 |

## 官方样片

| 名字 | 展示 |
| --- | --- |
| `topology-flow` | 清单 → 小票 → 1→3→1 依赖图；双节点透视推镜、曲线连线生长、斜纹阻塞、脉冲沿线汇聚 |
| `scale-matrix` | 从一个 3 s 单元拉远到整张时间矩阵；对数 zoom、组整体 spring 缩放、零重排 |
| `canvas-handoff` | 光标弧线飞入、组按压回弹、结果卡从源卡飞出、空对象驱动连线、断链与重连 |

生成脚本在 `playground/examples/`（`node playground/examples/gen_examples.mjs`），全部用 `createSceneBuilder` 写成。

## 归档

[`archive/`](./archive/README.md) 保存重构前（TypeScript 重写与 `silkyscene@1` 之前）的早期设计思考，仅作历史材料，不构成现行契约。
