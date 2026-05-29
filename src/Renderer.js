import { Layout } from "./Layout.js"

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
        this.nodes = new Set()
        this.presentation = null
    }

    /**
     * 绑定演示实例。
     * @param {Presentation} presentation
     */
    mount(presentation) {
        this.presentation = presentation
    }

    /**
     * 卸载并清理渲染节点。
     */
    unmount() {
        for (const node of this.nodes) {
            if (node.parentNode) {
                node.parentNode.removeChild(node)
            }
        }
        this.nodes.clear()
        this.elementToDOM = new WeakMap()
        this.presentation = null
    }

    /**
     * 移除某个元素对应的渲染节点。
     * @param {BaseElement} element
     */
    removeElement(element) {
        if (!element) {
            return
        }

        const node = this.elementToDOM.get(element)
        if (node && node.parentNode) {
            node.parentNode.removeChild(node)
        }
        if (node) {
            this.nodes.delete(node)
        }
    }

    /**
     * 场景切换时调用，触发布局计算与状态更新
     * @param {Presentation} presentation - 演示实例
     * @param {Scene} newScene - 新场景
     * @param {Scene|null} previousScene - 切换前场景
    * @param {Object|null} transitionContext - 包含目标场景动画配置等上下文
     */
    onSceneChanged(presentation, newScene, previousScene = null, transitionContext = null) {
        for (const element of presentation.elements) {
            const transition = presentation.resolveElementTransition(
                element,
                previousScene,
                newScene
            )
            this.applyElementState(presentation, element, transition.toState)
        }
    }

    /**
     * 创建或获取元素渲染节点。
     * @param {Presentation} presentation
     * @param {BaseElement} element
     * @returns {HTMLElement}
     */
    ensureElementNode(presentation, element) {
        const cachedNode = this.elementToDOM.get(element)
        if (cachedNode) {
            return cachedNode
        }

        const node = document.createElement("div")
        node.dataset.elementId = element.id
        node.style.position = "absolute"
        node.style.left = "0"
        node.style.top = "0"
        node.style.transformOrigin = "0 0"
        node.style.willChange = "transform, opacity"
        node.style.transitionProperty = "transform, opacity"
        node.style.transitionDuration = "var(--silkyscene-transition-duration, 800ms)"
        node.style.transitionTimingFunction = "var(--silkyscene-transition-easing, ease)"

        presentation.content.appendChild(node)
        this.elementToDOM.set(element, node)
        this.nodes.add(node)
        return node
    }

    /**
     * 应用元素状态到渲染节点。
     * @param {Presentation} presentation
     * @param {BaseElement} element
     * @param {Object|null} sceneState
     */
    applyElementState(presentation, element, sceneState) {
        const node = this.ensureElementNode(presentation, element)

        if (!sceneState || sceneState.visible === false) {
            node.style.opacity = "0"
            node.style.pointerEvents = "none"
            return
        }

        if (element.type === "text") {
            node.textContent = element.text || ""
            node.style.whiteSpace = "pre-wrap"
            node.style.fontSize = `${element.fontSize || 16}px`
            node.style.color = element.color || "#000"
            node.style.textAlign = element.textAlign || "left"
            node.style.lineHeight = String(element.lineHeight || 1.5)
            node.style.fontFamily = element.fontFamily || "Arial"
        }

        const layout = this.resolveLayout(sceneState, element)
        const computed = Layout.resolve(element, sceneState, {
            containerWidth: presentation.content.clientWidth,
            containerHeight: presentation.content.clientHeight,
            layout,
        })
        element.computed = computed

        const rect = node.getBoundingClientRect()
        const anchorX = Number(layout.anchorX || 0)
        const anchorY = Number(layout.anchorY || 0)

        const transformState = sceneState.transform || {}
        const translateX = computed.x - rect.width * anchorX + Number(transformState.x || 0)
        const translateY = computed.y - rect.height * anchorY + Number(transformState.y || 0)
        const scaleX = Number(transformState.scaleX || 1)
        const scaleY = Number(transformState.scaleY || 1)
        const rotation = Number(transformState.rotation || 0)

        node.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) rotate(${rotation}rad) scale(${scaleX}, ${scaleY})`
        node.style.opacity = `${sceneState.opacity ?? element.opacity ?? 1}`
        node.style.zIndex = `${sceneState.zIndex ?? element.zIndex ?? 0}`
        node.style.pointerEvents = "auto"
        element.dirty = false
    }

    /**
     * 合并布局配置。
     * @param {Object} sceneState
     * @param {BaseElement} element
     * @returns {{mode: string, left: number|string, top: number|string, anchorX: number, anchorY: number}}
     */
    resolveLayout(sceneState, element) {
        const baseLayout = element.layout || {}
        const stateLayout = (sceneState && sceneState.layout) || {}

        return {
            mode: stateLayout.mode || baseLayout.mode || "absolute",
            left: stateLayout.left ?? baseLayout.left ?? 0,
            top: stateLayout.top ?? baseLayout.top ?? 0,
            anchorX: stateLayout.anchorX ?? baseLayout.anchorX ?? 0,
            anchorY: stateLayout.anchorY ?? baseLayout.anchorY ?? 0,
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
