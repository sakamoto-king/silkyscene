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

## License / 许可证

MIT