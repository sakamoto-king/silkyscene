/**
 * @deprecated
 * 这是旧版 DOM 渲染路径（Renderer/Layout）。仅用于兼容现有运行逻辑。
 */

import { Layout } from "./Layout.js"
import { parseMotionOffset, parsePercentSize } from "../utils/size.js"

/**
 * Renderer（渲染执行器）。
 *
 * Renderer 的核心定位：
 * - 只负责“执行渲染计划”，把状态写到 DOM（style/transform/opacity），并稳定触发 CSS transition。
 * - 不负责“推导语义”（方向、delay 镜像、from/to 解析等），这些应由 Presentation 生成并下发。
 *
 * 职责
 * - 管理 Element ↔ DOM 的映射（WeakMap），创建/复用/移除节点。
 * - 消费 Presentation 下发的切场景计划（transitionPlan），按计划写入 delay/from/to。
 * - 执行两帧入场机制（Phase 1 → reflow → Phase 2），避免动画被浏览器合并吞掉。
 * - 调用 Layout.resolve 进行百分比到像素的换算，最终通过 transform 更新 DOM。
 *
 * 不做的事
 * - 不决定场景导航方向（forward/backward）。
 * - 不做 delay 取值来源选择、不做 backward 镜像。
 * - 不修改 Element 本体的数据结构（不把 DOM 引用塞进 Element）。
 *
 * 关键不变量
 * - onSceneChanged 必须是“确定性的单次执行”：一次切场景只做一次计划执行，不做隐式循环。
 * - 两帧机制只用于“入场元素”（本次首次出现且有 fromState），避免对普通元素引入多帧抖动。
 *
 * 失败模式（常见症状）
 * - 若 contentRect 未准备好（宽高=0），Layout.resolve 会把百分比坐标解算成 (0,0)，表现为“首次从左上飘入”。
 * - 若同一帧内连续写入 fromState/toState，浏览器可能合并变更导致入场动画不触发。
 * - 若元素节点首次创建时已带 transition 样式，紧接着写入 transform/layout，浏览器可能从默认值补间到目标值，
 *   产生“首次从左上角运动/闪动”的错觉（尤其是 ImageElement 内部 base/highlight/window 子节点）。
 *
 * 预热（Prewarm）机制
 * - 在展示当前场景时，Renderer 会预先创建并写入“前后若干场景（默认各 3）将出现的元素节点”。
 * - 预热阶段强制：opacity=0、pointerEvents=none、禁用所有 transition（含 image 子节点）。
 * - 当元素进入“本次切换的 transitionPlan”时，再启用 transition 并按 plan 执行动画。
 *
 * 性能注意
 * - 强制 reflow（读取 offsetHeight/getBoundingClientRect）会阻塞布局流水线，只能在必要时使用。
 * - ensureElementNode 会引起 DOM 增长，应只对本次需要渲染的元素调用。
 */
export class Renderer {
    constructor() {
        // 维护 Element 到 DOM 的映射（不暴露给 Element）
        this.elementToDOM = new WeakMap()
        this.nodes = new Set()
        this.presentation = null
        this.imageDecodeCache = new Map()

        // 预热窗口：以当前场景为中心，向前/向后各预创建 N 张场景的元素节点。
        this.PREWARM_BEHIND = 3
        this.PREWARM_AHEAD = 3

        // 首屏仅首次启动延迟播放（用于彻底规避首图首帧补间）。
        this.hasPlayedInitialSceneAnimation = false
        this.sceneChangeToken = 0
        this.initialDelayTimer = null
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
        // Renderer 只做“执行”，不做“语义推导”。
        // 语义推导（方向、delay 镜像、from/to 解析）应由 Presentation 生成 transitionPlan。
        const transitionPlan = transitionContext && transitionContext.transitionPlan

        // 约束：Renderer 不再提供 legacy 语义推导。
        // 若缺少 plan，说明调用链绕过了 Presentation.setScene/onSceneChanged 的兜底逻辑。
        if (!transitionPlan) {
            throw new Error(
                "Renderer.onSceneChanged 需要 transitionPlan：请通过 Presentation.setScene() 触发切场景，或在 Presentation.onSceneChanged(...) 的 transitionContext 中提供 transitionPlan"
            )
        }

        // === 执行流程概览（plan 模式）===
        // 参考机制文档：docs/两帧渲染机制.md
        //
        // Step 1：遍历 plan.items，对每个元素执行一次“本次切换需要的写入”（delay / from / to）。
        //   - 意义：把语义层计算出的结果稳定写入 DOM，确保 transitionDelay/from/to 在同一次切换中一致。
        // Step 2：对“入场元素”触发两帧机制：
        //   Phase 1（同步）：禁用过渡 + 写 fromState（把起始态真正提交到渲染树）
        //   reflow（同步）：强制浏览器记录 Phase 1 样式
        //   Phase 2（rAF）：恢复过渡 + 写 toState（触发 CSS transition）
        const enteringItems = []

        // 用于避免“延迟 Phase2”跨场景误触发。
        this.sceneChangeToken += 1
        const sceneToken = this.sceneChangeToken
        if (this.initialDelayTimer) {
            clearTimeout(this.initialDelayTimer)
            this.initialDelayTimer = null
        }

        // prewarm 不能影响本次切换涉及的元素（尤其是离场元素），否则会造成“整场瞬消”。
        const protectedIds = new Set()
        for (const item of transitionPlan.items) {
            if (item && item.hasRenderableState) {
                protectedIds.add(item.elementId)
            }
        }

        for (const item of transitionPlan.items) {
            const element = item.element
            let node = this.elementToDOM.get(element)

            if (!item.hasRenderableState) {
                if (node) {
                    node.style.opacity = "0"
                    node.style.pointerEvents = "none"
                }
                continue
            }

            // 仅对“本次需要渲染”的元素确保节点存在，避免无谓 DOM 增长。
            if (!node) {
                node = this.ensureElementNode(presentation, element, presentation.content)
            }

            // delay：由 plan 提供最终值；Renderer 不再计算方向与镜像。
            node.style.setProperty(
                `--silkyscene-transition-delay-${item.elementId}`,
                `${item.finalDelay}ms`
            )

            if (item.isEntering) {
                // === 入场元素：Phase 1（同步）先到 fromState，禁用过渡 ===
                // 注意：此处必须“完全禁用 transition”后再写 fromState（含 image 子节点），
                // 否则节点首次创建时可能从默认值 (0,0) 补间到目标值，产生首帧跳变。
                this.applyElementState(presentation, element, item.fromState, {
                    disableTransitions: true,
                })
                enteringItems.push({ element, toState: item.toState })
            } else {
                // === 普通元素（含位移、出场）：直接应用 toState，CSS 过渡自动触发 ===
                // 仅当元素进入本次 plan 才启用 transition；预热阶段可能禁用了 transition。
                this.enableTransitionsForElement(presentation, element)
                this.applyElementState(presentation, element, item.toState)
            }
        }

        // 切到新场景后，立即预热邻近场景元素节点（前后各 N）。
        // 注意：只预热“当前不可见”的元素，避免覆盖当前画面。
        const toIndex = presentation && presentation.program
            ? presentation.program.getSceneIndex(newScene)
            : -1
        if (toIndex >= 0) {
            this.prewarmAroundScene(presentation, toIndex, protectedIds)
        }

        if (enteringItems.length === 0) {
            return
        }

        // 强制 reflow，确保浏览器已记录 fromState
        void presentation.content.offsetHeight

        const runPhase2 = () => {
            // === Phase 2（下一帧）：恢复过渡，动画到 toState ===
            requestAnimationFrame(() => {
                if (sceneToken !== this.sceneChangeToken) {
                    return
                }

                for (const { element, toState } of enteringItems) {
                    // Phase 1 禁用了 transition，这里统一恢复后再写入 toState。
                    this.enableTransitionsForElement(presentation, element)
                    this.setElementTransitionDuration(
                        presentation,
                        element,
                        "var(--silkyscene-transition-duration, 800ms)"
                    )
                    this.applyElementState(presentation, element, toState)
                }
            })
        }

        // 首次启动：等待一小段时间再播放首页入场动画（只触发一次）。
        if (!previousScene && this.hasPlayedInitialSceneAnimation === false) {
            this.hasPlayedInitialSceneAnimation = true
            this.initialDelayTimer = setTimeout(runPhase2, 500)
            return
        }

        runPhase2()
    }

    /**
     * 预热指定场景索引附近（前后各 N 张）的元素节点。
     *
     * 行为：
     * - 仅对“将出现但当前场景不可见”的元素创建节点并写入一次稳定样式；
     * - 强制禁用 transition，并覆盖 opacity=0/pointerEvents=none。
     *
     * 目的：避免元素首次创建时从默认样式补间到目标样式，出现从左上角飘入/闪动。
     *
     * @param {Presentation} presentation
     * @param {number} centerIndex
     */
    prewarmAroundScene(presentation, centerIndex, protectedIds = null) {
        if (!presentation || !presentation.program) {
            return
        }

        const snapshots = presentation.program.snapshots || []
        if (!Array.isArray(snapshots) || snapshots.length === 0) {
            return
        }

        const centerSnapshot = presentation.program.getSnapshotByIndex(centerIndex)
        if (!centerSnapshot) {
            return
        }

        const start = Math.max(0, centerIndex - this.PREWARM_BEHIND)
        const end = Math.min(snapshots.length - 1, centerIndex + this.PREWARM_AHEAD)

        const candidateIds = new Set()
        for (let i = start; i <= end; i += 1) {
            const snapshot = presentation.program.getSnapshotByIndex(i)
            if (!snapshot) {
                continue
            }
            for (const elementId of snapshot.renderableStatesById.keys()) {
                candidateIds.add(elementId)
            }
        }

        const currentVisibleIds = new Set(centerSnapshot.renderableStatesById.keys())

        const elementById = new Map(
            (presentation.program.elements || []).map((element) => [element.id, element])
        )

        const protectedSet = protectedIds instanceof Set
            ? protectedIds
            : new Set(Array.isArray(protectedIds) ? protectedIds : [])

        for (const elementId of candidateIds) {
            if (protectedSet.has(elementId)) {
                continue
            }
            if (currentVisibleIds.has(elementId)) {
                continue
            }

            const element = elementById.get(elementId)
            if (!element) {
                continue
            }

            // 找到“距离当前最近”的那个出现该元素的快照，用于预热写入。
            let bestIndex = null
            let bestDistance = Infinity
            for (let i = start; i <= end; i += 1) {
                const snapshot = presentation.program.getSnapshotByIndex(i)
                if (!snapshot) {
                    continue
                }
                if (!snapshot.renderableStatesById.has(elementId)) {
                    continue
                }

                const distance = Math.abs(i - centerIndex)
                if (distance < bestDistance) {
                    bestDistance = distance
                    bestIndex = i
                }
            }

            if (bestIndex == null) {
                continue
            }

            const bestSnapshot = presentation.program.getSnapshotByIndex(bestIndex)
            const prewarmState = bestSnapshot
                ? (bestSnapshot.renderableStatesById.get(elementId) || null)
                : null

            // 预热阶段禁用所有 transition，避免首次写入样式触发补间。
            // 注意：applyElementState 内会 ensureElementNode/ensureImageLayerNodes，
            // 因此必须在 applyElementState 过程中就带上 disableTransitions。
            this.applyElementState(presentation, element, prewarmState, {
                disableTransitions: true,
            })

            const node = this.elementToDOM.get(element)
            if (node) {
                node.style.opacity = "0"
                node.style.pointerEvents = "none"
            }
        }
    }

    /**
     * 禁用某个元素节点（含子节点）的 transition。
     * @param {HTMLElement} node
     * @param {string} elementType
     */
    disableTransitionsForElement(node, elementType) {
        if (!node) {
            return
        }

        node.style.transitionProperty = "none"
        node.style.transitionDuration = "0ms"
        node.style.transitionTimingFunction = "linear"
        node.style.transitionDelay = "0ms"

        if (elementType === "image") {
            const layers = this.ensureImageLayerNodes(node, { disableTransitions: true })
            this.disableTransitionsForImageLayers(layers)
        }
    }

    /**
     * 启用某个元素节点（含子节点）的 transition。
     * @param {Presentation} presentation
     * @param {BaseElement} element
     */
    enableTransitionsForElement(presentation, element) {
        if (!element) {
            return
        }

        const node = this.elementToDOM.get(element)
        if (!node) {
            return
        }

        node.style.transitionProperty = "transform, opacity, background-color, color, width, height, border-radius, border-width"
        node.style.transitionDuration = "var(--silkyscene-transition-duration, 800ms)"
        node.style.transitionTimingFunction = "var(--silkyscene-transition-easing, ease)"
        node.style.transitionDelay = `var(--silkyscene-transition-delay-${element.id}, 0ms)`

        if (element.type === "image") {
            const layers = this.ensureImageLayerNodes(node)
            this.enableTransitionsForImageLayers(layers)
        }
    }

    /**
     * 设置元素节点（含 image 子节点）的 transitionDuration。
     * 用于两帧入场机制：Phase1 强制 0ms，Phase2 恢复 var。
     * @param {Presentation} presentation
     * @param {BaseElement} element
     * @param {string} duration
     */
    setElementTransitionDuration(presentation, element, duration) {
        if (!element) {
            return
        }

        const node = this.elementToDOM.get(element)
        if (node) {
            node.style.transitionDuration = duration
        }

        if (element.type === "image" && node) {
            const layers = this.ensureImageLayerNodes(node)
            if (layers && layers.base) {
                layers.base.style.transitionDuration = duration
            }
            if (layers && layers.window) {
                layers.window.style.transitionDuration = duration
            }
            if (layers && layers.highlight) {
                layers.highlight.style.transitionDuration = duration
            }
        }
    }

    disableTransitionsForImageLayers(layers) {
        if (!layers) {
            return
        }

        const nodes = [layers.base, layers.window, layers.highlight]
        for (const n of nodes) {
            if (!n) {
                continue
            }
            n.style.transitionProperty = "none"
            n.style.transitionDuration = "0ms"
            n.style.transitionTimingFunction = "linear"
            n.style.transitionDelay = "0ms"
        }
    }

    enableTransitionsForImageLayers(layers) {
        if (!layers) {
            return
        }

        if (layers.base) {
            layers.base.style.transitionProperty = "transform, filter"
            layers.base.style.transitionDuration = "var(--silkyscene-transition-duration, 800ms)"
            layers.base.style.transitionTimingFunction = "var(--silkyscene-transition-easing, ease)"
            layers.base.style.transitionDelay = "0ms"
        }

        if (layers.window) {
            layers.window.style.transitionProperty = "left, top, width, height, border-radius, opacity"
            layers.window.style.transitionDuration = "var(--silkyscene-transition-duration, 800ms)"
            layers.window.style.transitionTimingFunction = "var(--silkyscene-transition-easing, ease)"
            layers.window.style.transitionDelay = "0ms"
        }

        if (layers.highlight) {
            layers.highlight.style.transitionProperty = "left, top, width, height, transform"
            layers.highlight.style.transitionDuration = "var(--silkyscene-transition-duration, 800ms)"
            layers.highlight.style.transitionTimingFunction = "var(--silkyscene-transition-easing, ease)"
            layers.highlight.style.transitionDelay = "0ms"
        }
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
        node.style.transitionDelay = `var(--silkyscene-transition-delay-${element.id}, 0ms)`

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

        if (renderContext && renderContext.disableTransitions === true) {
            this.disableTransitionsForElement(node, element.type)
        }

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
            this.applyGenericNodeState(node, presentation, element, sceneState, {
                containerWidth,
                containerHeight,
            })
            this.renderImageNode(node, element, sceneState, {
                containerWidth: Number(element.computed && element.computed.width) || 0,
                containerHeight: Number(element.computed && element.computed.height) || 0,
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

        const opacityValue = sceneState.opacity ?? element.opacity ?? 1
        node.style.opacity = `${opacityValue}`
        node.style.zIndex = `${sceneState.zIndex ?? element.zIndex ?? 0}`

        const opacityNumber = Number(opacityValue)
        node.style.pointerEvents = Number.isFinite(opacityNumber) && opacityNumber <= 0 ? "none" : "auto"
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
    renderImageNode(node, element, sceneState, context = {}) {
        const imageState = (sceneState && sceneState.image) || {}
        const cropState = this.resolveImageCropState(
            imageState.crop,
            context.containerWidth,
            context.containerHeight
        )
        const highlightRender = this.resolveImageHighlightRenderState(imageState.highlight, {
            containerWidth: context.containerWidth,
            containerHeight: context.containerHeight,
        })
        const dimBrightness = this.resolveImageDimBrightness(imageState.filter)
        const baseBrightness = this.resolveImageBaseBrightness(highlightRender, dimBrightness)
        const fit = imageState.fit || element.objectFit || element.fit || "cover"

        node.style.overflow = "hidden"
        node.style.backgroundColor = "transparent"

        const imageLayers = this.ensureImageLayerNodes(node)
        this.setImageNodeSource(imageLayers.base, element.src)
        imageLayers.base.alt = element.alt || ""
        imageLayers.base.style.objectFit = fit

        this.setImageNodeSource(imageLayers.highlight, element.src)
        imageLayers.highlight.alt = ""
        imageLayers.highlight.style.objectFit = fit

        this.applyImageCropToLayer(imageLayers.base, cropState)
        this.applyImageCropToLayer(imageLayers.highlight, cropState)

        imageLayers.base.style.filter = `brightness(${baseBrightness})`
        imageLayers.highlight.style.filter = "none"

        this.applyImageHighlightState(imageLayers.window, imageLayers.highlight, highlightRender, {
            containerWidth: context.containerWidth,
            containerHeight: context.containerHeight,
        })
    }

    /**
     * 确保图片节点结构：暗图层 + 高亮窗图层。
     */
    ensureImageLayerNodes(node) {
        const options = arguments.length > 1 ? arguments[1] : {}
        const disableTransitions = Boolean(options && options.disableTransitions)

        let base = node.querySelector(".silkyscene-image-base")
        if (!base || base.tagName !== "IMG") {
            node.textContent = ""
            base = document.createElement("img")
            base.className = "silkyscene-image-base"
            base.decoding = "async"
            base.style.position = "absolute"
            base.style.left = "0"
            base.style.top = "0"
            base.style.width = "100%"
            base.style.height = "100%"
            base.style.display = "block"
            base.style.transformOrigin = "50% 50%"
            base.style.willChange = "transform, filter"
            if (disableTransitions) {
                base.style.transitionProperty = "none"
                base.style.transitionDuration = "0ms"
                base.style.transitionTimingFunction = "linear"
            } else {
                base.style.transitionProperty = "transform, filter"
                base.style.transitionDuration = "var(--silkyscene-transition-duration, 800ms)"
                base.style.transitionTimingFunction = "var(--silkyscene-transition-easing, ease)"
            }
            node.appendChild(base)
        }

        let windowNode = node.querySelector(".silkyscene-image-highlight-window")
        if (!windowNode) {
            windowNode = document.createElement("div")
            windowNode.className = "silkyscene-image-highlight-window"
            windowNode.style.position = "absolute"
            windowNode.style.left = "0"
            windowNode.style.top = "0"
            windowNode.style.width = "0"
            windowNode.style.height = "0"
            windowNode.style.display = "none"
            windowNode.style.overflow = "hidden"
            windowNode.style.pointerEvents = "none"
            if (disableTransitions) {
                windowNode.style.transitionProperty = "none"
                windowNode.style.transitionDuration = "0ms"
                windowNode.style.transitionTimingFunction = "linear"
            } else {
                windowNode.style.transitionProperty = "left, top, width, height, border-radius, opacity"
                windowNode.style.transitionDuration = "var(--silkyscene-transition-duration, 800ms)"
                windowNode.style.transitionTimingFunction = "var(--silkyscene-transition-easing, ease)"
            }
            node.appendChild(windowNode)
        }

        let highlight = windowNode.querySelector(".silkyscene-image-highlight")
        if (!highlight || highlight.tagName !== "IMG") {
            windowNode.textContent = ""
            highlight = document.createElement("img")
            highlight.className = "silkyscene-image-highlight"
            highlight.decoding = "async"
            highlight.style.position = "absolute"
            highlight.style.left = "0"
            highlight.style.top = "0"
            highlight.style.width = "100%"
            highlight.style.height = "100%"
            highlight.style.display = "block"
            highlight.style.transformOrigin = "50% 50%"
            highlight.style.willChange = "left, top, width, height, transform"
            if (disableTransitions) {
                highlight.style.transitionProperty = "none"
                highlight.style.transitionDuration = "0ms"
                highlight.style.transitionTimingFunction = "linear"
            } else {
                highlight.style.transitionProperty = "left, top, width, height, transform"
                highlight.style.transitionDuration = "var(--silkyscene-transition-duration, 800ms)"
                highlight.style.transitionTimingFunction = "var(--silkyscene-transition-easing, ease)"
            }
            windowNode.appendChild(highlight)
        }

        return {
            base,
            window: windowNode,
            highlight,
        }
    }

    /**
     * 仅在源变化时更新图片 src，避免重复赋值触发无效开销。
     */
    setImageNodeSource(imageNode, src) {
        const nextSrc = String(src || "")
        const currentSrc = imageNode.dataset.silkysceneSrc || ""
        if (nextSrc === currentSrc) {
            return
        }

        imageNode.dataset.silkysceneSrc = nextSrc
        imageNode.src = nextSrc

        if (nextSrc) {
            this.predecodeImage(nextSrc)
        }
    }

    /**
     * 预解码图片并缓存结果，降低首次切页卡顿。
     */
    predecodeImage(src) {
        if (!src || this.imageDecodeCache.has(src)) {
            return this.imageDecodeCache.get(src)
        }

        const decodeTask = (async () => {
            try {
                const img = new Image()
                img.decoding = "async"
                img.src = src

                if (typeof img.decode === "function") {
                    await img.decode()
                } else {
                    await new Promise((resolve, reject) => {
                        img.onload = () => resolve(true)
                        img.onerror = () => reject(new Error("image decode failed"))
                    })
                }

                return true
            } catch {
                return false
            }
        })()

        this.imageDecodeCache.set(src, decodeTask)
        return decodeTask
    }

    /**
     * 解析图片裁剪状态并约束偏移，避免露出黑边。
     */
    resolveImageCropState(cropState = {}, containerWidth = 0, containerHeight = 0) {
        const width = Math.max(1, Number(containerWidth) || 0)
        const height = Math.max(1, Number(containerHeight) || 0)
        const rawScale = Number(cropState && cropState.scale)
        const scale = Number.isFinite(rawScale) ? Math.max(1, rawScale) : 1

        const requestedOffsetX = this.parseCoordinate(
            cropState && cropState.offsetX != null ? cropState.offsetX : 0,
            width
        )
        const requestedOffsetY = this.parseCoordinate(
            cropState && cropState.offsetY != null ? cropState.offsetY : 0,
            height
        )

        const maxOffsetX = (width * (scale - 1)) / 2
        const maxOffsetY = (height * (scale - 1)) / 2

        const offsetX = this.clamp(requestedOffsetX, -maxOffsetX, maxOffsetX)
        const offsetY = this.clamp(requestedOffsetY, -maxOffsetY, maxOffsetY)

        return {
            scale,
            offsetX,
            offsetY,
        }
    }

    /**
     * 将裁剪变换应用到图片图层。
     */
    applyImageCropToLayer(imageNode, cropState) {
        const scale = Number(cropState && cropState.scale) || 1
        const offsetX = Number(cropState && cropState.offsetX) || 0
        const offsetY = Number(cropState && cropState.offsetY) || 0
        imageNode.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`
    }

    /**
     * 解析暗化亮度参数。
     */
    resolveImageDimBrightness(filterState = {}) {
        const raw = Number(filterState && filterState.dimBrightness)
        if (!Number.isFinite(raw)) {
            return 1
        }
        return this.clamp(raw, 0, 1)
    }

    /**
     * 解析高亮渲染状态。
     */
    resolveImageHighlightRenderState(highlightState = {}, context = {}) {
        const containerWidth = Math.max(1, Number(context.containerWidth) || 0)
        const containerHeight = Math.max(1, Number(context.containerHeight) || 0)
        const sizeBase = this.getSizeBase(containerWidth, containerHeight)

        const stage = this.resolveHighlightStage(highlightState)
        const progress = this.resolveHighlightProgress(stage, highlightState)

        const requestedX = this.parseCoordinate(
            highlightState && highlightState.x != null ? highlightState.x : "0%",
            containerWidth
        )
        const requestedY = this.parseCoordinate(
            highlightState && highlightState.y != null ? highlightState.y : "0%",
            containerHeight
        )
        const requestedWidth = this.parseCoordinate(
            highlightState && highlightState.width != null ? highlightState.width : "100%",
            containerWidth
        )
        const requestedHeight = this.parseCoordinate(
            highlightState && highlightState.height != null ? highlightState.height : "100%",
            containerHeight
        )

        const targetX = this.clamp(requestedX, 0, containerWidth)
        const targetY = this.clamp(requestedY, 0, containerHeight)
        const targetWidth = this.clamp(requestedWidth, 0, containerWidth - targetX)
        const targetHeight = this.clamp(requestedHeight, 0, containerHeight - targetY)
        const radius = parsePercentSize(
            highlightState && highlightState.radius != null ? highlightState.radius : "0%",
            sizeBase,
            "ImageElement.highlight.radius"
        )

        const fullRect = {
            x: 0,
            y: 0,
            width: containerWidth,
            height: containerHeight,
        }
        const targetRect = {
            x: targetX,
            y: targetY,
            width: targetWidth,
            height: targetHeight,
        }

        let rect = targetRect
        let opacity = Number(highlightState && highlightState.opacity)
        if (!Number.isFinite(opacity)) {
            opacity = 1
        }
        opacity = this.clamp(opacity, 0, 1)

        if (stage === "hidden") {
            rect = fullRect
            opacity = 0
        } else if (stage === "entering") {
            rect = this.interpolateRect(fullRect, targetRect, progress)
        } else if (stage === "exiting") {
            rect = targetRect
            if (!(highlightState && Object.prototype.hasOwnProperty.call(highlightState, "opacity"))) {
                opacity = this.clamp(1 - progress, 0, 1)
            }
        }

        return {
            stage,
            progress,
            rect,
            radius: Math.max(0, radius),
            opacity,
        }
    }

    /**
     * 基于高亮阶段解析底图亮度。
     */
    resolveImageBaseBrightness(highlightRender, dimBrightness) {
        if (!highlightRender) {
            return 1
        }

        if (highlightRender.stage === "entering") {
            return this.lerp(1, dimBrightness, highlightRender.progress)
        }

        if (highlightRender.stage === "shown") {
            return dimBrightness
        }

        if (highlightRender.stage === "exiting") {
            return this.lerp(dimBrightness, 1, highlightRender.progress)
        }

        return 1
    }

    /**
     * 应用高亮窗状态（支持位置、尺寸与透明度动画）。
     */
    applyImageHighlightState(windowNode, highlightNode, highlightRender, context = {}) {
        const containerWidth = Math.max(1, Number(context.containerWidth) || 0)
        const containerHeight = Math.max(1, Number(context.containerHeight) || 0)

        if (!highlightRender) {
            windowNode.style.display = "none"
            return
        }

        windowNode.style.display = "block"
        windowNode.style.left = `${highlightRender.rect.x}px`
        windowNode.style.top = `${highlightRender.rect.y}px`
        windowNode.style.width = `${highlightRender.rect.width}px`
        windowNode.style.height = `${highlightRender.rect.height}px`
        windowNode.style.borderRadius = `${highlightRender.radius}px`
        windowNode.style.opacity = `${highlightRender.opacity}`

        // 高亮图层始终保持与底图一致的绝对尺寸与缩放基准，
        // 通过负偏移把同一内容坐标对齐到高亮窗口。
        highlightNode.style.width = `${containerWidth}px`
        highlightNode.style.height = `${containerHeight}px`
        highlightNode.style.left = `${-highlightRender.rect.x}px`
        highlightNode.style.top = `${-highlightRender.rect.y}px`
    }

    /**
     * 解析高亮阶段。
     */
    resolveHighlightStage(highlightState = {}) {
        const stage = typeof (highlightState && highlightState.stage) === "string"
            ? highlightState.stage.trim().toLowerCase()
            : ""

        if (stage === "hidden" || stage === "entering" || stage === "shown" || stage === "exiting") {
            return stage
        }

        if (highlightState && highlightState.enabled === true) {
            return "shown"
        }

        return "hidden"
    }

    /**
     * 解析高亮阶段进度。
     */
    resolveHighlightProgress(stage, highlightState = {}) {
        const raw = Number(highlightState && highlightState.progress)
        if (Number.isFinite(raw)) {
            return this.clamp(raw, 0, 1)
        }

        if (stage === "hidden") {
            return 0
        }

        return 1
    }

    /**
     * 线性插值矩形。
     */
    interpolateRect(fromRect, toRect, progress) {
        return {
            x: this.lerp(fromRect.x, toRect.x, progress),
            y: this.lerp(fromRect.y, toRect.y, progress),
            width: this.lerp(fromRect.width, toRect.width, progress),
            height: this.lerp(fromRect.height, toRect.height, progress),
        }
    }

    /**
     * 线性插值。
     */
    lerp(from, to, progress) {
        return from + (to - from) * progress
    }

    /**
     * 数值钳制。
     */
    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max)
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

        // ArrowElement 为复合渲染：内部包含 3 条线段（shaft/headA/headB）。
        // 该“复合结构”是渲染实现细节，不再依赖 BaseElement.children。
        const shaft = element && element.shaft
        const headA = element && element.headA
        const headB = element && element.headB
        if (!shaft || !headA || !headB) {
            node.textContent = ""
            return
        }

        node.style.position = "relative"
        const parts = this.ensureArrowSegmentNodes(node)
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

        const childContext = {
            containerWidth: geometry.length,
            containerHeight: Math.max(geometry.strokeWidth, arrowWidth),
        }
        // 复用 line 渲染逻辑：将 3 段线当作“在 arrow 节点内部坐标系中的 line 元素”渲染。
        this.renderLineNode(parts.shaft, shaft, {}, childContext)
        this.renderLineNode(parts.headA, headA, {}, childContext)
        this.renderLineNode(parts.headB, headB, {}, childContext)

        element.computed = {
            x: geometry.x1,
            y: geometry.y1,
            width: geometry.length,
            height: Math.max(geometry.strokeWidth, arrowWidth),
        }
    }

    /**
     * 确保箭头内部的 3 个线段节点存在，并返回它们。
     * @param {HTMLElement} node
     * @returns {{shaft: HTMLElement, headA: HTMLElement, headB: HTMLElement}}
     */
    ensureArrowSegmentNodes(node) {
        const children = Array.from(node.children || [])
        const hasThree = children.length === 3
        const matches =
            hasThree &&
            children[0].getAttribute("data-silkyscene-arrow-part") === "shaft" &&
            children[1].getAttribute("data-silkyscene-arrow-part") === "headA" &&
            children[2].getAttribute("data-silkyscene-arrow-part") === "headB"

        if (!matches) {
            node.textContent = ""

            const shaft = document.createElement("div")
            shaft.setAttribute("data-silkyscene-arrow-part", "shaft")

            const headA = document.createElement("div")
            headA.setAttribute("data-silkyscene-arrow-part", "headA")

            const headB = document.createElement("div")
            headB.setAttribute("data-silkyscene-arrow-part", "headB")

            node.appendChild(shaft)
            node.appendChild(headA)
            node.appendChild(headB)
        }

        const [shaftNode, headANode, headBNode] = Array.from(node.children || [])
        for (const child of [shaftNode, headANode, headBNode]) {
            if (child && child.style) {
                child.style.position = "absolute"
                child.style.left = "0"
                child.style.top = "0"
            }
        }

        return {
            shaft: shaftNode,
            headA: headANode,
            headB: headBNode,
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

        const anchorX = Number(layout.anchorX || 0)
        const anchorY = Number(layout.anchorY || 0)
        const clamp01 = (v) => {
            if (!Number.isFinite(v)) return 0
            return v < 0 ? 0 : (v > 1 ? 1 : v)
        }
        const ax = clamp01(anchorX)
        const ay = clamp01(anchorY)
        node.style.transformOrigin = `${ax * 100}% ${ay * 100}%`

        // 关键修复：不要用 getBoundingClientRect() 的宽高参与 anchor 位移计算。
        // boundingClientRect 会受上一帧/上一场景残留 transform（scale/rotate）影响，导致切回时漂移。
        // 优先使用 computed 宽高；若为 0（例如 auto 文本），回退到 offsetWidth/offsetHeight（不受 transform 影响）。
        const anchorWidth = (computed && computed.width > 0)
            ? computed.width
            : (node.offsetWidth || 0)
        const anchorHeight = (computed && computed.height > 0)
            ? computed.height
            : (node.offsetHeight || 0)

        const transformState = sceneState.transform || {}
        const translateX = computed.x - anchorWidth * ax + this.resolveTransformOffset(transformState.x, sizeBase, "transform.x")
        const translateY = computed.y - anchorHeight * ay + this.resolveTransformOffset(transformState.y, sizeBase, "transform.y")
        const scaleX = Number(transformState.scaleX || 1)
        const scaleY = Number(transformState.scaleY || 1)
        const rotation = Number(transformState.rotation || 0)

        node.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) rotate(${rotation}rad) scale(${scaleX}, ${scaleY})`
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

        if (computed.width > 0) {
            node.style.width = `${computed.width}px`
        }
        if (computed.height > 0) {
            node.style.height = `${computed.height}px`
        }

        const anchorX = Number(layout.anchorX || 0)
        const anchorY = Number(layout.anchorY || 0)
        const clamp01 = (v) => {
            if (!Number.isFinite(v)) return 0
            return v < 0 ? 0 : (v > 1 ? 1 : v)
        }
        const ax = clamp01(anchorX)
        const ay = clamp01(anchorY)
        node.style.transformOrigin = `${ax * 100}% ${ay * 100}%`

        // 关键修复：使用不受 transform 影响的尺寸来做 anchor 位移。
        const anchorWidth = (computed && computed.width > 0)
            ? computed.width
            : (node.offsetWidth || 0)
        const anchorHeight = (computed && computed.height > 0)
            ? computed.height
            : (node.offsetHeight || 0)

        const transformState = sceneState.transform || {}
        const sizeBase = this.getSizeBase(context.containerWidth, context.containerHeight)
        const translateX = computed.x - anchorWidth * ax + this.resolveTransformOffset(transformState.x, sizeBase, "transform.x")
        const translateY = computed.y - anchorHeight * ay + this.resolveTransformOffset(transformState.y, sizeBase, "transform.y")
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
