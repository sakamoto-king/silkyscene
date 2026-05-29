import { Layout } from "./Layout.js"
import { parseMotionOffset, parsePercentSize } from "./utils/size.js"

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
     * 场景切换时调用，触发布局计算与状态更新。
     *
     * 对于「入场元素」（本帧首次出现且有 fromState），采用两帧技术：
     *   Phase 1（同步）: 禁用过渡，立刻将元素设置到 fromState（不可见的起始位置）
     *   强制 reflow: 确保浏览器记录 fromState 样式
     *   Phase 2（rAF）: 恢复过渡，动画到 toState
     *
     * 对于其他元素（已在上一场景中存在或无动画），直接同步应用 toState，
     * CSS transition 自动从当前值补间到目标值。
     *
     * @param {Presentation} presentation - 演示实例
     * @param {Scene} newScene - 新场景
     * @param {Scene|null} previousScene - 切换前场景
     * @param {Object|null} transitionContext - 包含目标场景动画配置等上下文
     */
    onSceneChanged(presentation, newScene, previousScene = null, transitionContext = null) {
        // 计算导航方向
        const fromIndex = previousScene ? presentation.scenes.indexOf(previousScene) : -1
        const toIndex = presentation.scenes.indexOf(newScene)
        const direction = fromIndex <= toIndex ? "forward" : "backward"

        const enteringItems = []

        for (const element of presentation.elements) {
            const transition = presentation.resolveElementTransition(
                element,
                previousScene,
                newScene,
                direction
            )
            const wasInPreviousScene = Boolean(
                previousScene && presentation.getResolvedState(previousScene, element)
            )
            const isEntering = Boolean(transition.fromState && !wasInPreviousScene)

            if (isEntering) {
                // === 入场元素：Phase 1（同步）先到 fromState，禁用过渡 ===
                const node = this.ensureElementNode(presentation, element, presentation.content)
                node.style.transitionDuration = "0ms"
                this.applyElementState(presentation, element, transition.fromState)
                enteringItems.push({ element, toState: transition.toState })
            } else {
                // === 普通元素（含位移、出场）：直接应用 toState，CSS 过渡自动触发 ===
                this.applyElementState(presentation, element, transition.toState)
            }
        }

        if (enteringItems.length === 0) {
            return
        }

        // 强制 reflow，确保浏览器已记录 fromState
        void presentation.content.offsetHeight

        // === Phase 2（下一帧）：恢复过渡，动画到 toState ===
        requestAnimationFrame(() => {
            for (const { element, toState } of enteringItems) {
                const node = this.elementToDOM.get(element)
                if (node) {
                    node.style.transitionDuration = "var(--silkyscene-transition-duration, 800ms)"
                }
                this.applyElementState(presentation, element, toState)
            }
        })
    }

    /**
     * 创建或获取元素渲染节点。
     * @param {Presentation} presentation
     * @param {BaseElement} element
     * @returns {HTMLElement}
     */
    ensureElementNode(presentation, element, parentNode = presentation.content) {
        const cachedNode = this.elementToDOM.get(element)
        if (cachedNode) {
            if (parentNode && cachedNode.parentNode !== parentNode) {
                parentNode.appendChild(cachedNode)
            }
            return cachedNode
        }

        const node = document.createElement("div")
        node.dataset.elementId = element.id
        node.style.position = "absolute"
        node.style.left = "0"
        node.style.top = "0"
        node.style.transformOrigin = "0 0"
        node.style.willChange = "transform, opacity, background-color, color, width, height, border-radius, border-width"
        node.style.transitionProperty = "transform, opacity, background-color, color, width, height, border-radius, border-width"
        node.style.transitionDuration = "var(--silkyscene-transition-duration, 800ms)"
        node.style.transitionTimingFunction = "var(--silkyscene-transition-easing, ease)"

        parentNode.appendChild(node)
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
    applyElementState(presentation, element, sceneState, renderContext = {}) {
        const parentNode = renderContext.parentNode || presentation.content
        const containerWidth = renderContext.containerWidth ?? presentation.content.clientWidth
        const containerHeight = renderContext.containerHeight ?? presentation.content.clientHeight
        const node = this.ensureElementNode(presentation, element, parentNode)

        if (!sceneState || sceneState.visible === false) {
            node.style.opacity = "0"
            node.style.pointerEvents = "none"
            return
        }

        if (element.type === "text") {
            this.renderTextNode(node, element, sceneState, {
                containerWidth,
                containerHeight,
            })
            this.applyGenericNodeState(node, presentation, element, sceneState, {
                containerWidth,
                containerHeight,
            })
        } else if (element.type === "image") {
            this.renderImageNode(node, element)
            this.applyGenericNodeState(node, presentation, element, sceneState, {
                containerWidth,
                containerHeight,
            })
        } else if (element.type === "line") {
            this.renderLineNode(node, element, sceneState, {
                containerWidth,
                containerHeight,
            })
        } else if (element.type === "arrow") {
            this.renderArrowNode(node, element, sceneState, {
                containerWidth,
                containerHeight,
            })
        } else if (element.type === "shape") {
            this.renderShapeNode(node, presentation, element, sceneState, {
                containerWidth,
                containerHeight,
            })
        } else {
            node.textContent = ""
            this.applyGenericNodeState(node, presentation, element, sceneState, {
                containerWidth,
                containerHeight,
            })
        }

        node.style.opacity = `${sceneState.opacity ?? element.opacity ?? 1}`
        node.style.zIndex = `${sceneState.zIndex ?? element.zIndex ?? 0}`
        node.style.pointerEvents = "auto"

        this.renderElementChildren(presentation, element, node)
        element.dirty = false
    }

    /**
     * 渲染文本节点。
     */
    renderTextNode(node, element, sceneState, context) {
        node.textContent = element.text || ""
        node.style.whiteSpace = "pre-wrap"
        const sizeBase = this.getSizeBase(context.containerWidth, context.containerHeight)
        const textState = sceneState && sceneState.text ? sceneState.text : {}
        const fontSizeValue = textState.fontSize ?? sceneState.fontSize ?? element.fontSize ?? "2.2%"
        const fontSize = parsePercentSize(fontSizeValue, sizeBase, "TextElement.fontSize")
        node.style.fontSize = `${fontSize}px`
        node.style.color = textState.color || sceneState.color || element.color || "#000"
        node.style.textAlign = element.textAlign || "left"
        node.style.lineHeight = String(element.lineHeight || 1.5)
        node.style.fontFamily = element.fontFamily || "Arial"
    }

    /**
     * 渲染图片节点。
     */
    renderImageNode(node, element) {
        let img = node.firstElementChild
        if (!img || img.tagName !== "IMG") {
            node.textContent = ""
            img = document.createElement("img")
            img.style.display = "block"
            img.style.width = "100%"
            img.style.height = "100%"
            node.appendChild(img)
        }
        img.src = element.src || ""
        img.alt = element.alt || ""
        img.style.objectFit = element.objectFit || element.fit || "cover"
    }

    /**
     * 渲染线段节点（纯 DOM）。
     */
    renderLineNode(node, element, sceneState, context) {
        node.textContent = ""

        const geometry = this.resolveLineGeometry(element, sceneState, context)
        const transformState = sceneState.transform || {}

        node.style.transformOrigin = "0 50%"
        node.style.width = `${geometry.length}px`
        node.style.height = `${geometry.strokeWidth}px`
        node.style.backgroundColor = geometry.color
        node.style.borderRadius = `${geometry.cornerRadius}px`

        const sizeBase = this.getSizeBase(context.containerWidth, context.containerHeight)
        const tx = geometry.x1 + this.resolveTransformOffset(transformState.x, sizeBase, "transform.x")
        const ty = geometry.y1 - geometry.strokeWidth / 2 + this.resolveTransformOffset(transformState.y, sizeBase, "transform.y")
        const sx = Number(transformState.scaleX || 1)
        const sy = Number(transformState.scaleY || 1)
        const r = geometry.angle + Number(transformState.rotation || 0)
        node.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${r}rad) scale(${sx}, ${sy})`

        element.computed = {
            x: geometry.x1,
            y: geometry.y1,
            width: geometry.length,
            height: geometry.strokeWidth,
        }
    }

    /**
     * 渲染箭头节点（父节点 + 3 条子线）。
     */
    renderArrowNode(node, element, sceneState, context) {
        node.textContent = ""

        const geometry = this.resolveLineGeometry(element, sceneState, context)
        const transformState = sceneState.transform || {}
        const sizeBase = this.getSizeBase(context.containerWidth, context.containerHeight)
        const arrowState = sceneState.arrow || {}
        const arrowSize = parsePercentSize(
            arrowState.size ?? element.arrowSize ?? "2.8%",
            sizeBase,
            "ArrowElement.arrowSize"
        )
        const arrowWidth = parsePercentSize(
            arrowState.width ?? element.arrowWidth ?? "1.8%",
            sizeBase,
            "ArrowElement.arrowWidth"
        )
        const centerY = Math.max(geometry.strokeWidth, arrowWidth) / 2

        node.style.width = `${geometry.length}px`
        node.style.height = `${Math.max(geometry.strokeWidth, arrowWidth)}px`
        node.style.backgroundColor = "transparent"
        node.style.borderRadius = "0"
        node.style.transformOrigin = "0 50%"

        const tx = geometry.x1 + this.resolveTransformOffset(transformState.x, sizeBase, "transform.x")
        const ty = geometry.y1 - centerY + this.resolveTransformOffset(transformState.y, sizeBase, "transform.y")
        const sx = Number(transformState.scaleX || 1)
        const sy = Number(transformState.scaleY || 1)
        const r = geometry.angle + Number(transformState.rotation || 0)
        node.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${r}rad) scale(${sx}, ${sy})`

        if (element.children.length < 3) {
            return
        }

        const [shaft, headA, headB] = element.children
        const childSizeBase = this.getSizeBase(
            geometry.length,
            Math.max(geometry.strokeWidth, arrowWidth)
        )
        const strokeWidthPercent = `${(geometry.strokeWidth / childSizeBase) * 100}%`
        shaft.x1 = 0
        shaft.y1 = centerY
        shaft.x2 = geometry.length
        shaft.y2 = centerY
        shaft.strokeWidth = strokeWidthPercent
        shaft.color = geometry.color

        headA.x1 = geometry.length - arrowSize
        headA.y1 = centerY - arrowWidth / 2
        headA.x2 = geometry.length
        headA.y2 = centerY
        headA.strokeWidth = strokeWidthPercent
        headA.color = geometry.color

        headB.x1 = geometry.length - arrowSize
        headB.y1 = centerY + arrowWidth / 2
        headB.x2 = geometry.length
        headB.y2 = centerY
        headB.strokeWidth = strokeWidthPercent
        headB.color = geometry.color

        element.computed = {
            x: geometry.x1,
            y: geometry.y1,
            width: geometry.length,
            height: Math.max(geometry.strokeWidth, arrowWidth),
        }
    }

    /**
     * 渲染图形节点。
     */
    renderShapeNode(node, presentation, element, sceneState, context) {
        const shapeState = sceneState.shape || {}
        const shapeType = shapeState.shapeType || element.shapeType || "rect"

        if (shapeType === "circle") {
            this.renderRectangleNode(node, presentation, element, sceneState, context, true)
            return
        }

        this.renderRectangleNode(node, presentation, element, sceneState, context, false)
    }

    /**
     * 渲染矩形/圆形节点。
     */
    renderRectangleNode(node, presentation, element, sceneState, context, forceCircle = false) {
        node.textContent = ""

        const shapeState = sceneState.shape || {}
        const layout = this.resolveLayout(sceneState, element)
        const computed = Layout.resolve(element, sceneState, {
            containerWidth: context.containerWidth,
            containerHeight: context.containerHeight,
            layout,
        })
        element.computed = computed

        const sizeBase = this.getSizeBase(context.containerWidth, context.containerHeight)
        const strokeWidth = parsePercentSize(
            shapeState.strokeWidth ?? element.strokeWidth ?? "0.3%",
            sizeBase,
            "ShapeElement.strokeWidth"
        )
        const fill = String(shapeState.fill ?? element.fill ?? "#000")
        const stroke = String(shapeState.stroke ?? element.stroke ?? "none")
        const cornerRadiusValue = shapeState.cornerRadius ?? element.cornerRadius ?? "0%"
        const cornerRadius = forceCircle
            ? "50%"
            : `${parsePercentSize(cornerRadiusValue, sizeBase, "ShapeElement.cornerRadius")}px`

        node.style.width = `${computed.width}px`
        node.style.height = `${computed.height}px`
        node.style.boxSizing = "border-box"
        node.style.backgroundColor = fill
        node.style.borderStyle = stroke === "none" ? "none" : "solid"
        node.style.borderColor = stroke
        node.style.borderWidth = stroke === "none" ? "0px" : `${strokeWidth}px`
        node.style.borderRadius = cornerRadius

        const rect = node.getBoundingClientRect()
        const anchorX = Number(layout.anchorX || 0)
        const anchorY = Number(layout.anchorY || 0)
        const transformState = sceneState.transform || {}
        const translateX = computed.x - rect.width * anchorX + this.resolveTransformOffset(transformState.x, sizeBase, "transform.x")
        const translateY = computed.y - rect.height * anchorY + this.resolveTransformOffset(transformState.y, sizeBase, "transform.y")
        const scaleX = Number(transformState.scaleX || 1)
        const scaleY = Number(transformState.scaleY || 1)
        const rotation = Number(transformState.rotation || 0)

        node.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) rotate(${rotation}rad) scale(${scaleX}, ${scaleY})`
    }

    /**
     * 递归渲染子元素。
     */
    renderElementChildren(presentation, element, parentNode) {
        if (!element.children || !element.children.length) {
            return
        }

        const containerWidth = Number(element.computed && element.computed.width) || presentation.content.clientWidth
        const containerHeight = Number(element.computed && element.computed.height) || presentation.content.clientHeight

        for (const child of element.children) {
            const childState = this.buildChildIntrinsicState(child)
            this.applyElementState(presentation, child, childState, {
                parentNode,
                containerWidth,
                containerHeight,
            })
        }
    }

    /**
     * 为子元素构建内置状态（用于组合元素内部渲染）。
     */
    buildChildIntrinsicState(element) {
        return {
            layout: element.layout || {
                mode: "absolute",
                left: 0,
                top: 0,
                anchorX: 0,
                anchorY: 0,
            },
            transform: element.transform || {
                x: 0,
                y: 0,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
            },
            opacity: element.opacity ?? 1,
            zIndex: element.zIndex ?? 0,
            visible: element.visible !== false,
        }
    }

    /**
     * 应用通用布局 + 变换逻辑。
     */
    applyGenericNodeState(node, presentation, element, sceneState, context) {
        const layout = this.resolveLayout(sceneState, element)
        const computed = Layout.resolve(element, sceneState, {
            containerWidth: context.containerWidth,
            containerHeight: context.containerHeight,
            layout,
        })
        element.computed = computed

        const rect = node.getBoundingClientRect()
        const anchorX = Number(layout.anchorX || 0)
        const anchorY = Number(layout.anchorY || 0)

        const transformState = sceneState.transform || {}
        const sizeBase = this.getSizeBase(context.containerWidth, context.containerHeight)
        const translateX = computed.x - rect.width * anchorX + this.resolveTransformOffset(transformState.x, sizeBase, "transform.x")
        const translateY = computed.y - rect.height * anchorY + this.resolveTransformOffset(transformState.y, sizeBase, "transform.y")
        const scaleX = Number(transformState.scaleX || 1)
        const scaleY = Number(transformState.scaleY || 1)
        const rotation = Number(transformState.rotation || 0)

        node.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) rotate(${rotation}rad) scale(${scaleX}, ${scaleY})`
    }

    /**
     * 解析线段几何信息。
     */
    resolveLineGeometry(element, sceneState, context) {
        const lineState = sceneState.line || {}
        const x1 = this.parseCoordinate(lineState.x1 ?? element.x1 ?? 0, context.containerWidth)
        const y1 = this.parseCoordinate(lineState.y1 ?? element.y1 ?? 0, context.containerHeight)
        const x2 = this.parseCoordinate(lineState.x2 ?? element.x2 ?? 0, context.containerWidth)
        const y2 = this.parseCoordinate(lineState.y2 ?? element.y2 ?? 0, context.containerHeight)

        const dx = x2 - x1
        const dy = y2 - y1
        const length = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        const angle = Math.atan2(dy, dx)
        const sizeBase = this.getSizeBase(context.containerWidth, context.containerHeight)
        const strokeWidth = parsePercentSize(
            lineState.strokeWidth ?? element.strokeWidth ?? "0.5%",
            sizeBase,
            "LineElement.strokeWidth"
        )
        const color = String(lineState.color ?? element.color ?? "#ffffff")
        const cornerRadiusValue = lineState.cornerRadius ?? element.cornerRadius
        const cornerRadius =
            cornerRadiusValue == null
                ? strokeWidth / 2
                : parsePercentSize(cornerRadiusValue, sizeBase, "LineElement.cornerRadius")

        return {
            x1,
            y1,
            x2,
            y2,
            length,
            angle,
            strokeWidth,
            color,
            cornerRadius,
        }
    }

    /**
     * 将像素或百分比坐标转换为数值像素。
     */
    parseCoordinate(value, total) {
        if (typeof value === "string") {
            const trimmed = value.trim()
            if (trimmed.endsWith("%")) {
                const ratio = Number(trimmed.slice(0, -1))
                if (Number.isFinite(ratio)) {
                    return total * ratio / 100
                }
            }
            const parsed = Number(trimmed)
            return Number.isFinite(parsed) ? parsed : 0
        }

        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : 0
    }

    /**
     * 获取尺寸基准（容器短边）。
     */
    getSizeBase(containerWidth, containerHeight) {
        return Math.max(1, Math.min(containerWidth || 0, containerHeight || 0))
    }

    /**
     * 解析 transform 的位移偏移。
     */
    resolveTransformOffset(value, sizeBase, fieldName) {
        return parseMotionOffset(value, sizeBase, fieldName)
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
            width: stateLayout.width ?? baseLayout.width ?? "auto",
            height: stateLayout.height ?? baseLayout.height ?? "auto",
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
