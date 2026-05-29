import { deepMerge } from "./utils/deepMerge.js"
import { Renderer } from "./Renderer.js"

/**
 * 演示文稿实例。
 * 
 * Presentation 管理元素生命周期、场景编排与演示状态。
 * 不负责布局计算或容器尺寸监听，由应用层控制容器样式。
 */
export class Presentation {

    // 默认配置
    static DEFAULT_CONFIG = {
        container: {
            position: "relative",
            overflow: "hidden",
            backgroundColor: "#333",
            width: "100vw",
            height: "100vh",
        },
        content: {
            backgroundColor: "#000",
            position: "absolute",
            overflow: "hidden",
        },
        aspectRatio: null,
        sceneTransition: {
            duration: 800,
            easing: "ease",
        },
        navigation: {
            loop: false,
        },
    }

    /**
     * @param {HTMLElement|string} container - 挂载容器元素或选择器（必填）
     * @param {Object} [options] - 可选配置
     * @param {Object} [options.container] - 容器样式配置
     * @param {Object} [options.content] - 内容样式配置
     * @param {Array<number>} [options.aspectRatio] - 两位数组 [w, h]，任一位为 0 时跟随父容器宽高
     */
    constructor(container, options = {}) {
        // 校验并规范化容器参数
        if (!container) {
            throw new Error("Presentation(container, options) 中 container 为必填参数")
        } else {
            this.container = this.normalizeContainer(container)
        }

        // 合并配置，规范化比例参数
        this.options = deepMerge(Presentation.DEFAULT_CONFIG, options)
        // 规范化比例参数
        this.aspectRatio = this.normalizeAspectRatio(this.options.aspectRatio)
        this.defaultSceneTransition = this.normalizeSceneTransitionConfig(this.options.sceneTransition)
        this.navigation = this.normalizeNavigationConfig(this.options.navigation)


        // 渲染根容器
        this.content = document.createElement("div")

        // 尺寸监听器
        this.resizeObserver = null
        this.onWindowResize = null

        // 元素池
        this.elements = []

        // 场景列表
        this.scenes = []

        // 当前活跃的场景
        this.currentScene = null

        // 当前生效的场景切换配置
        this.currentSceneTransition = deepMerge({}, this.defaultSceneTransition)

        // 默认渲染器
        this.renderer = null
    }

    /**
     * 规范化容器参数，支持直接传入 HTMLElement 或选择器字符串
     * @param {HTMLElement|string} container
     * @returns {HTMLElement}
     */
    normalizeContainer(container) {
        // 支持传递 HTMLElement 或选择器字符串
        switch (typeof container) {
            case "string": {
                const el = document.querySelector(container)
                if (!el) {
                    throw new Error(`未找到匹配的容器元素: ${container}`)
                }
                return el
            }
            case "object": {
                if (container instanceof HTMLElement) {
                    return container
                } else {
                    throw new Error("container 参数必须是 HTMLElement 实例或有效的选择器字符串")
                }
            }
            default:
                throw new Error("container 参数必须是 HTMLElement 实例或有效的选择器字符串")
        }
    }

    /**
     * 初始化容器与画布样式
     */
    initContainerStyle() {
        Object.assign(this.container.style, this.options.container)
        Object.assign(this.content.style, this.options.content)
    }

    /**
     * 规范化并校验比例参数。
     * @param {Array<number>|null} aspectRatio
     * @returns {Array<number>|null}
     */
    normalizeAspectRatio(aspectRatio) {
        if (aspectRatio == null) {
            return null
        }

        if (!Array.isArray(aspectRatio) || aspectRatio.length !== 2) {
            throw new Error("aspectRatio 必须是 [w, h] 两位数组")
        }

        const widthRatio = Number(aspectRatio[0])
        const heightRatio = Number(aspectRatio[1])
        const isInvalid =
            !Number.isFinite(widthRatio) ||
            !Number.isFinite(heightRatio) ||
            widthRatio < 0 ||
            heightRatio < 0

        if (isInvalid) {
            throw new Error("aspectRatio 的宽高必须是非负数")
        }

        return [widthRatio, heightRatio]
    }

    /**
     * 根据父容器尺寸同步内容框大小，比例模式采用 contain。
     */
    updateContentRect() {
        const parentWidth = this.container.clientWidth
        const parentHeight = this.container.clientHeight

        if (parentWidth <= 0 || parentHeight <= 0) {
            Object.assign(this.content.style, {
                width: "0px",
                height: "0px",
                left: "0px",
                top: "0px",
            })
            return
        }

        let contentWidth = parentWidth
        let contentHeight = parentHeight

        if (
            this.aspectRatio &&
            this.aspectRatio[0] > 0 &&
            this.aspectRatio[1] > 0
        ) {
            const ratio = this.aspectRatio[0] / this.aspectRatio[1]
            const parentRatio = parentWidth / parentHeight

            if (parentRatio > ratio) {
                contentHeight = parentHeight
                contentWidth = parentHeight * ratio
            } else {
                contentWidth = parentWidth
                contentHeight = parentWidth / ratio
            }
        }

        const offsetX = (parentWidth - contentWidth) / 2
        const offsetY = (parentHeight - contentHeight) / 2

        Object.assign(this.content.style, {
            width: `${contentWidth}px`,
            height: `${contentHeight}px`,
            left: `${offsetX}px`,
            top: `${offsetY}px`,
        })
    }

    bindResizeObserver() {
        this.unbindResizeObserver()

        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => {
                this.updateContentRect()
            })
            this.resizeObserver.observe(this.container)
            return
        }

        this.onWindowResize = () => {
            this.updateContentRect()
        }
        window.addEventListener("resize", this.onWindowResize)
    }

    unbindResizeObserver() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect()
            this.resizeObserver = null
        }

        if (this.onWindowResize) {
            window.removeEventListener("resize", this.onWindowResize)
            this.onWindowResize = null
        }
    }

    /**
     * 启动演示文稿，挂载到容器并绑定交互
     */
    start() {
        this.initContainerStyle()

        if (!this.content.parentNode) {
            this.container.appendChild(this.content)
        }

        this.ensureRenderer()

        // 初始化内容层动画配置，后续切场景时会按目标场景覆盖。
        this.applySceneTransitionStyle(this.currentSceneTransition)

        this.updateContentRect()
        this.bindResizeObserver()

        if (this.navigation.keys.enabled) {
            this._bindKeyboardNavigation()
        }

        if (this.navigation.touch.enabled) {
            this._bindTouchNavigation()
        }
    }

    /**
     * 停止演示文稿，卸载并释放所有资源
     */
    stop() {
        this._unbindKeyboardNavigation()
        this._unbindTouchNavigation()
        this.unbindResizeObserver()
        this.currentScene = null
        if (this.renderer) {
            this.renderer.unmount()
        }
        if (this.content.parentNode) {
            this.content.parentNode.removeChild(this.content)
        }
    }

    /**
     * 判断当前焦点是否处于文字输入上下文（输入框、富文本等）。
     * @param {EventTarget} target
     * @returns {boolean}
     */
    _isTypingContext(target) {
        if (!target || !(target instanceof HTMLElement)) return false
        if (target.isContentEditable) return true
        const tagName = target.tagName.toLowerCase()
        return tagName === "input" || tagName === "textarea" || tagName === "select"
    }

    /**
     * 绑定键盘导航事件。
     * 下一页：ArrowRight、ArrowDown、PageDown、Enter、Space
     * 上一页：ArrowLeft、ArrowUp、PageUp
     */
    _bindKeyboardNavigation() {
        this._onKeydown = (event) => {
            if (this._isTypingContext(event.target)) return

            const NEXT_KEYS = ["ArrowRight", "ArrowDown", "PageDown", "Enter", " "]
            const PREV_KEYS = ["ArrowLeft", "ArrowUp", "PageUp"]

            if (NEXT_KEYS.includes(event.key)) {
                event.preventDefault()
                this.nextScene()
            } else if (PREV_KEYS.includes(event.key)) {
                event.preventDefault()
                this.prevScene()
            }
        }
        window.addEventListener("keydown", this._onKeydown)
    }

    /**
     * 解绑键盘导航事件。
     */
    _unbindKeyboardNavigation() {
        if (this._onKeydown) {
            window.removeEventListener("keydown", this._onKeydown)
            this._onKeydown = null
        }
    }

    /**
     * 绑定触摸滑动导航事件。
     * 左滑/上滑 → 下一页；右滑/下滑 → 上一页。
     */
    _bindTouchNavigation() {
        let startX = 0
        let startY = 0

        this._onTouchStart = (event) => {
            const touch = event.changedTouches[0]
            startX = touch.clientX
            startY = touch.clientY
        }

        this._onTouchEnd = (event) => {
            const touch = event.changedTouches[0]
            const deltaX = touch.clientX - startX
            const deltaY = touch.clientY - startY
            const absX = Math.abs(deltaX)
            const absY = Math.abs(deltaY)
            const threshold = this.navigation.touch.threshold

            if (absX < threshold && absY < threshold) return

            if (absX >= absY) {
                // 水平主轴：左滑下一页，右滑上一页
                deltaX < 0 ? this.nextScene() : this.prevScene()
            } else {
                // 垂直主轴：上滑下一页，下滑上一页
                deltaY < 0 ? this.nextScene() : this.prevScene()
            }
        }

        this.content.addEventListener("touchstart", this._onTouchStart, { passive: true })
        this.content.addEventListener("touchend", this._onTouchEnd, { passive: true })
    }

    /**
     * 解绑触摸滑动导航事件。
     */
    _unbindTouchNavigation() {
        if (this._onTouchStart) {
            this.content.removeEventListener("touchstart", this._onTouchStart)
            this._onTouchStart = null
        }
        if (this._onTouchEnd) {
            this.content.removeEventListener("touchend", this._onTouchEnd)
            this._onTouchEnd = null
        }
    }

    /**
     * 添加元素到演示
     * @param {BaseElement} element
     */
    addElement(element) {
        if (!element || !element.id) {
            throw new Error("元素必须是有效的 BaseElement 实例")
        }

        if (this.elements.some((item) => item.id === element.id)) {
            throw new Error(`元素 id 重复: ${element.id}`)
        }

        this.elements.push(element)
    }

    /**
     * 移除演示中的元素
     * @param {BaseElement} element
     */
    removeElement(element) {
        const index = this.elements.indexOf(element)
        if (index !== -1) {
            this.elements.splice(index, 1)
            if (this.renderer) {
                this.renderer.removeElement(element)
            }
        }
    }

    /**
     * 添加场景
     * @param {Scene} scene
     */
    addScene(scene) {
        if (!scene || typeof scene.name === "undefined") {
            throw new Error("场景必须是有效的 Scene 实例")
        }
        this.scenes.push(scene)
    }

    /**
     * 切换到指定场景，触发布局计算与动画
     * @param {Scene} scene
     */
    setScene(scene) {
        if (this.scenes.indexOf(scene) === -1) {
            throw new Error("指定的场景不属于此演示")
        }
        const previousScene = this.currentScene
        const transitionConfig = this.resolveSceneTransitionConfig(scene)
        this.currentSceneTransition = transitionConfig
        this.applySceneTransitionStyle(transitionConfig)
        this.currentScene = scene
        this.ensureRenderer()
        // 触发布局计算：Renderer 应该在此时读取新场景状态并计算布局
        // 具体的动画插值与渲染在 Renderer 层实现
        this.onSceneChanged(scene, previousScene, {
            transition: transitionConfig,
        })
    }

    /**
     * 设置场景索引。
     * @param {number} index
     * @returns {boolean} 是否切换成功
     */
    setSceneByIndex(index) {
        if (!Number.isInteger(index)) {
            return false
        }

        if (index < 0 || index >= this.scenes.length) {
            return false
        }

        this.setScene(this.scenes[index])
        return true
    }

    /**
     * 切换到下一场景。
     * @returns {boolean} 是否切换成功
     */
    nextScene() {
        if (!this.scenes.length) {
            return false
        }

        const currentIndex = this.getCurrentSceneIndex()
        const isAtTail = currentIndex >= this.scenes.length - 1

        if (isAtTail) {
            if (!this.navigation.loop) {
                return false
            }
            return this.setSceneByIndex(0)
        }

        return this.setSceneByIndex(currentIndex + 1)
    }

    /**
     * 切换到上一场景。
     * @returns {boolean} 是否切换成功
     */
    prevScene() {
        if (!this.scenes.length) {
            return false
        }

        const currentIndex = this.getCurrentSceneIndex()
        const isAtHead = currentIndex <= 0

        if (isAtHead) {
            if (!this.navigation.loop) {
                return false
            }
            return this.setSceneByIndex(this.scenes.length - 1)
        }

        return this.setSceneByIndex(currentIndex - 1)
    }

    /**
     * 当前场景索引。
     * @returns {number}
     */
    getCurrentSceneIndex() {
        if (!this.currentScene) {
            return 0
        }

        const index = this.scenes.indexOf(this.currentScene)
        return index >= 0 ? index : 0
    }

    /**
     * 场景总数。
     * @returns {number}
     */
    getSceneCount() {
        return this.scenes.length
    }

    /**
     * 场景变化回调
     * 应用层或 Renderer 可以在此处理布局计算与动画启动
     * @param {Scene} scene
     * @param {Scene|null} previousScene
     * @param {Object|null} transitionContext
     */
    onSceneChanged(scene, previousScene = null, transitionContext = null) {
        if (this.renderer) {
            this.renderer.onSceneChanged(this, scene, previousScene, transitionContext)
        }
    }

    /**
     * 确保默认渲染器已初始化。
     */
    ensureRenderer() {
        if (!this.renderer) {
            this.renderer = new Renderer()
        }

        this.renderer.mount(this)
    }

    /**
     * 规范化切场景动画配置。
     * @param {Object} config
     * @returns {{duration: number, easing: string}}
     */
    normalizeSceneTransitionConfig(config) {
        const normalized = {
            duration: 800,
            easing: "ease",
        }

        if (config && typeof config === "object") {
            const duration = Number(config.duration)
            if (Number.isFinite(duration) && duration >= 0) {
                normalized.duration = duration
            }

            const easing = String(config.easing || "").trim()
            if (easing) {
                normalized.easing = easing
            }
        }

        return normalized
    }

    /**
     * 规范化导航配置。
     * @param {Object} config
     * @returns {{loop: boolean, keys: {enabled: boolean}, touch: {enabled: boolean, threshold: number}}}
     */
    normalizeNavigationConfig(config) {
        const keysConfig = (config && config.keys) ? config.keys : {}
        const touchConfig = (config && config.touch) ? config.touch : {}
        return {
            loop: Boolean(config && config.loop),
            keys: {
                enabled: keysConfig.enabled !== false,
            },
            touch: {
                enabled: touchConfig.enabled !== false,
                threshold: Number(touchConfig.threshold) || 50,
            },
        }
    }

    /**
     * 解析切换到目标场景时的最终动画配置。
     * 优先级：目标 Scene 配置 > Presentation 全局默认。
     * @param {Scene} targetScene
     * @returns {{duration: number, easing: string}}
     */
    resolveSceneTransitionConfig(targetScene) {
        const sceneTransition =
            targetScene && typeof targetScene.getTransition === "function"
                ? targetScene.getTransition()
                : null

        return this.normalizeSceneTransitionConfig(
            deepMerge(this.defaultSceneTransition, sceneTransition || {})
        )
    }

    /**
     * 将当前切场景动画配置写入内容层样式。
     * @param {{duration: number, easing: string}} transitionConfig
     */
    applySceneTransitionStyle(transitionConfig) {
        if (!this.content || !transitionConfig) {
            return
        }

        this.content.style.transitionProperty = "transform, opacity"
        this.content.style.transitionDuration = `${transitionConfig.duration}ms`
        this.content.style.transitionTimingFunction = transitionConfig.easing

        // 同步为 CSS 变量，便于子节点动画样式复用。
        this.content.style.setProperty("--silkyscene-transition-duration", `${transitionConfig.duration}ms`)
        this.content.style.setProperty("--silkyscene-transition-easing", transitionConfig.easing)
    }

    /**
     * 解析某个元素在场景切换中的 from/to 状态。
     *
     * 根据导航方向和 entrance/exit 配置，计算元素的起始态与目标态，
     * 供 Renderer 驱动动画。fromState/toState 均以场景原始状态为基础，
     * 在其上叠加动画增量，保证布局信息始终包含在内。
     *
     * @param {BaseElement} element
     * @param {Scene|null} fromScene
     * @param {Scene} toScene
     * @param {"forward"|"backward"} direction - 导航方向
     * @returns {{fromState: Object|null, toState: Object|null, meta: Object}}
     */
    resolveElementTransition(element, fromScene, toScene, direction = "forward") {
        const rawFromState = fromScene ? fromScene.getState(element) : null
        const rawToState = toScene ? toScene.getState(element) : null
        const fromMeta = fromScene ? fromScene.getStateMeta(element) : null
        const toMeta = toScene ? toScene.getStateMeta(element) : null

        let fromState = rawFromState ? deepMerge({}, rawFromState) : null
        let toState = rawToState ? deepMerge({}, rawToState) : null

        if (direction === "forward") {
            // 正向入场：元素在 toScene 首次出现，且配置了 entrance
            if (!rawFromState && rawToState && this.hasEnabledEntrance(toMeta)) {
                const overrides = this._buildAnimationOverrides(toMeta.entrance, "from")
                fromState = deepMerge(deepMerge({}, rawToState), overrides)
            }
            // 正向出场：元素在 toScene 中不存在，且 fromScene 配置了 exit
            if (rawFromState && !rawToState && this.hasEnabledExit(fromMeta)) {
                const overrides = this._buildAnimationOverrides(fromMeta.exit, "to")
                toState = deepMerge(deepMerge({}, rawFromState), overrides)
            }
        } else {
            // 反向入场：从 exit 倒放入场（元素出现但 fromScene 无此元素）
            if (!rawFromState && rawToState && this.hasEnabledExit(toMeta)) {
                const overrides = this._buildAnimationOverrides(toMeta.exit, "to")
                fromState = deepMerge(deepMerge({}, rawToState), overrides)
            }
            // 反向出场：从 entrance 倒放出场（元素消失但 toScene 无此元素）
            if (rawFromState && !rawToState && this.hasEnabledEntrance(fromMeta)) {
                const overrides = this._buildAnimationOverrides(fromMeta.entrance, "from")
                toState = deepMerge(deepMerge({}, rawFromState), overrides)
            }
        }

        return {
            fromState,
            toState,
            meta: {
                fromMeta,
                toMeta,
            },
        }
    }

    /**
     * 从 entrance/exit 元数据构建动画覆盖状态（opacity + transform 增量）。
     * 结果用于叠加到场景原始状态上，不含布局信息。
     * @param {Object} animMeta - entrance 或 exit 对象 { from/to, distance }
     * @param {"from"|"to"} key
     * @returns {Object}
     */
    _buildAnimationOverrides(animMeta, key) {
        const rawValue = animMeta ? animMeta[key] : null
        let overrides = {}

        if (rawValue == null) {
            overrides = {}
        } else if (typeof rawValue === "string") {
            overrides = this.buildDirectionState(rawValue, animMeta.distance)
        } else if (typeof rawValue === "object") {
            overrides = deepMerge({}, rawValue)
        }

        return deepMerge(overrides, this.pickVisibleTransitionDefaults(overrides))
    }

    /**
     * 将方向关键字转换为动画状态增量。
     * x/y 值为叠加在布局位置上的像素偏移。
     * @param {"bottom"|"top"|"left"|"right"} keyword
     * @param {number|null} [distance] - 偏移距离（px），默认 40
     * @returns {Object}
     */
    buildDirectionState(keyword, distance) {
        const d = (distance != null && Number.isFinite(Number(distance))) ? Number(distance) : 40
        switch (keyword) {
            case "bottom": return { opacity: 0, transform: { y: d } }
            case "top":    return { opacity: 0, transform: { y: -d } }
            case "left":   return { opacity: 0, transform: { x: -d } }
            case "right":  return { opacity: 0, transform: { x: d } }
            default:       return {}
        }
    }

    /**
     * 判断 entrance 是否启用。
     * @param {Object|null} stateMeta
     * @returns {boolean}
     */
    hasEnabledEntrance(stateMeta) {
        return Boolean(stateMeta && stateMeta.entrance && stateMeta.entrance.enabled)
    }

    /**
     * 判断 exit 是否启用。
     * @param {Object|null} stateMeta
     * @returns {boolean}
     */
    hasEnabledExit(stateMeta) {
        return Boolean(stateMeta && stateMeta.exit && stateMeta.exit.enabled)
    }

    /**
     * 仅当覆盖状态未定义 opacity 时，补充默认 opacity=0。
     * @param {Object} overrides
     * @returns {Object}
     */
    pickVisibleTransitionDefaults(overrides) {
        if (
            overrides &&
            Object.prototype.hasOwnProperty.call(overrides, "opacity")
        ) {
            return {}
        }

        return {
            opacity: 0,
        }
    }
}