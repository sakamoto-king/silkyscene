/**
 * 渲染器。
 *
 * 负责协调布局计算、变换插值、DOM 更新。
 * 在场景切换时驱动 Layout 重算，在帧循环中驱动动画插值。
 * 
 * 职责：
 * - 在场景切换时读取新状态、调用 Layout 计算、标记 dirty
 * - 在帧循环中执行插值计算
 * - 通过 transform 样式更新 DOM（不使用 left/top）
 * - 管理 Element 与 DOM 的映射（WeakMap 等）
 * 
 * 不做的事：
 * - 不修改 Element 本体的 layout、transform 等属性
 * - 不存储 DOM 引用在 Element 中
 * - 不进行复杂的动画曲线（仅线性插值或简单三次贝塞尔）
 */
export class Renderer {
    constructor() {
        // 维护 Element 到 DOM 的映射（不暴露给 Element）
        this.elementToDOM = new WeakMap()
    }

    /**
     * 场景切换时调用，触发布局计算与状态更新
     * @param {Presentation} presentation - 演示实例
     * @param {Scene} newScene - 新场景
     */
    onSceneChanged(presentation, newScene) {
        // 应用层实现：遍历所有 Element，调用 Layout.resolve，更新 computed
        for (const element of presentation.elements) {
            const sceneState = newScene.getState(element)
            // const computed = Layout.resolve(element, sceneState)
            // element.computed = computed
            // 标记需要渲染
            element.dirty = true
        }
    }

    /**
     * 帧循环中调用，执行插值与 DOM 更新
     * @param {BaseElement} element - 元素
     * @param {number} progress - 动画进度 [0, 1]
     */
    updateFrame(element, progress) {
        // 应用层实现：基于 progress 插值 transform，更新 DOM
        // 示例：
        // const el = this.elementToDOM.get(element)
        // if (el && element.computed) {
        //   const x = element.computed.x
        //   const y = element.computed.y
        //   el.style.transform = `translate3d(${x}px, ${y}px, 0)`
        // }
    }
}
