import { deepMerge } from "../utils/deepMerge.js"
import { Renderer } from "../legacy/Renderer.js"
import { TextElement } from "../elements/TextElement.js"
import { createElementByType } from "../elements/createElementByType.js"
import { CompiledProgram } from "../compiler/CompiledProgram.js"
import { SceneGeometry } from "../geometry/SceneGeometry.js"

/**
 * Presentation（演示编排器 / 语义计划生成器）。
 *
 * Presentation 的核心定位：
 * - 管理 Element/Scene 生命周期与场景编排（start/stop、add/remove、setScene）。
 * - 维护运行时预编译产物（program）：场景快照（最终态 + meta + 编译布局）与相邻切换计划缓存。
 * - 切场景时只读取预编译 plan 并下发给 Renderer，避免在用户点击“切换”那一刻实时演算。
 *
 * 职责
 * - 容器与内容层（container/content）的初始化与样式写入（含场景切换动画参数的 CSS 变量）。
 * - 预编译触发：ensureProgramCompiled（快照 + 相邻计划缓存）。
 * - 切场景调度：根据 from/to 索引读取相邻 plan；非相邻跳转按需基于快照生成 plan。
 * - 交互绑定：键盘/触摸翻页（可配置）。
 *
 * 不做的事
 * - 不直接操作每个 Element 的 DOM 节点（由 Renderer 负责）。
 * - 不在这里做 Layout.resolve 的像素级换算（由 Renderer/布局系统负责）。
 *
 * 关键不变量
 * - resolved cache 的继承规则必须稳定：未声明→继承；removeState→阻断继承；setState→覆盖。
 * - transitionPlan 必须是纯数据描述（不含 DOM 引用），以便测试与复用。
 *
 * 失败模式（常见症状）
 * - 若 contentRect 未同步且宽高为 0，Renderer/Layout 的百分比换算会退化为 (0,0)。
 *   该问题在首次启动/首次显示时更易出现，因此 start/setScene 需要兜底 flush。
 *
 * 性能注意
 * - ensureContentRectReady 内部可能触发 layout flush（getBoundingClientRect）。应避免在高频循环中调用。
 * - rebuildResolvedSceneCache 会遍历 scenes × elements，属于相对重操作，应由 dirty 标记控制触发频率。
 */
export class Presentation {

    // 默认配置
    static DEFAULT_CONFIG = {
        container: {
            position: "relative",
            overflow: "hidden",
            backgroundColor: "#333",
            width: "100vw",
            height: "100dvh",
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
        preload: {
            enabled: true,
            readyThreshold: 1,
            minVisibleMs: 1400,
            showProgressBar: true,
            barHeight: 4,
            allowInteractionWhileLoading: true,
            sources: [],
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
        this.preload = this.normalizePreloadConfig(this.options.preload)


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

        // 运行时预编译产物（场景快照 + 相邻切换计划缓存）
        this.program = new CompiledProgram(this)

        // 图片预加载状态
        this.preloadTask = null
        this.preloadReady = false
        this.preloadStartedAt = 0
        this.preloadFailedSources = []
        this.preloadImageTaskCache = new Map()
        this.preloadBarHost = null
        this.preloadBarFill = null
        this.preloadBarLabel = null
        this.preloadBarHidden = false
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

        // === Step 1：准备 contentRect（含 layout flush 兜底）===
        // 做什么：同步内容层尺寸（contain 模式），并在启动时强制一次 layout flush。
        // 依赖：容器已挂载到 DOM（content 已 append 到 container）。
        // 意义：避免首帧 content 的 clientWidth/Height 仍为 0，导致百分比坐标被换算成 (0,0)。
        // 注意：getBoundingClientRect 会触发 layout flush，不应在高频路径滥用；这里仅在 start 做一次强制兜底。
        this.ensureContentRectReady({ forceFlush: true })

        // 在演示开始前统一预编译场景快照与相邻切换计划，切换时直接读取缓存。
        this.ensureProgramCompiled()

        this.ensureRenderer()

        if (this.preload.enabled) {
            this.startImagePreload()
        }

        // 初始化内容层动画配置，后续切场景时会按目标场景覆盖。
        this.applySceneTransitionStyle(this.currentSceneTransition)
        this.bindResizeObserver()

        if (this.navigation.keys.enabled) {
            this._bindKeyboardNavigation()
        }

        if (this.navigation.touch.enabled) {
            this._bindTouchNavigation()
        }
    }

    /**
     * 确保 contentRect 已同步且可用于百分比到像素的换算。
     *
     * 何时使用：
     * - start：首次启动时强制 flush 一次，保证后续切场景稳定。
     * - setScene：切换前兜底同步，若尺寸仍为 0 再 flush + 重算。
     *
     * 为什么要这样做：
     * - Layout/Renderer 在切场景时会读取 content 的宽高（clientWidth/Height）用于百分比换算。
     * - 若容器首次显示、刚被插入 DOM 或刚发生尺寸变化，某些浏览器/时序下可能短暂返回 0。
     * - 这会让百分比坐标被解算成 (0,0)，表现为“首次播放从左上飘入”。
     *
     * @param {Object} options
     * @param {boolean} [options.forceFlush=false] - 是否强制进行一次 layout flush
     */
    ensureContentRectReady(options = {}) {
        const forceFlush = Boolean(options && options.forceFlush)

        this.updateContentRect()

        const sizeInvalid = this.content.clientWidth <= 0 || this.content.clientHeight <= 0
        if (forceFlush || sizeInvalid) {
            // layout flush：确保浏览器提交了上面的样式写入。
            void this.content.getBoundingClientRect()
            this.updateContentRect()
        }
    }

    /**
     * 停止演示文稿，卸载并释放所有资源
     */
    stop() {
        this._unbindKeyboardNavigation()
        this._unbindTouchNavigation()
        this.unbindResizeObserver()
        this.unmountPreloadProgressBar()
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
        this.markProgramDirty()
    }

    /**
     * 批量添加元素到演示。
     * @param {Array} elements
     * @returns {Presentation}
     */
    addElements(elements) {
        if (!Array.isArray(elements)) {
            throw new Error("addElements(elements) 需要传入数组")
        }

        for (const element of elements) {
            this.addElement(element)
        }

        return this
    }

    /**
     * 批量创建并注册元素。
     *
     * @param {Array<{type: string, name?: string, options?: Object}>} specs
     * @param {Object} [options]
     * @param {boolean} [options.strictNameUnique=true] - name 重复时是否抛错
     * @param {string} [options.nameKey='name'] - specs 中 name 字段键名
     * @returns {{ elements: Array, byName: Map<string, any>, byId: Map<string, any> }}
     */
    createElements(specs, options = {}) {
        if (!Array.isArray(specs)) {
            throw new Error("createElements(specs) 需要传入数组")
        }

        const strictNameUnique = options.strictNameUnique !== false
        const nameKey = typeof options.nameKey === "string" && options.nameKey ? options.nameKey : "name"

        const elements = []
        const byName = new Map()
        const byId = new Map()

        for (const spec of specs) {
            if (!spec || typeof spec !== "object") {
                throw new Error("createElements(specs) specs 中存在无效项")
            }

            const type = spec.type
            const rawOptions = spec.options && typeof spec.options === "object" ? spec.options : {}
            const elementOptions = deepMerge({}, rawOptions)

            const declaredName = spec[nameKey] ?? spec.name
            if (declaredName != null) {
                elementOptions.name = declaredName
            }

            const element = createElementByType(type, elementOptions)
            if (!element) {
                throw new Error(`createElements: 不支持的元素类型: ${type}`)
            }

            this.addElement(element)
            elements.push(element)
            byId.set(element.id, element)

            const name = element && typeof element.name === "string" ? element.name : ""
            if (name) {
                if (strictNameUnique && byName.has(name)) {
                    throw new Error(`createElements: 元素 name 重复: ${name}`)
                }
                if (!byName.has(name)) {
                    byName.set(name, element)
                }
            }
        }

        return { elements, byName, byId }
    }

    /**
     * 通过元素 name 查找。
     * 默认扫描 elements（不维护全局索引，避免 remove/rename 导致索引过期）。
     * @param {string} name
     * @param {Object} [options]
     * @param {boolean} [options.multiple=false] - 是否返回所有匹配项
     * @param {boolean} [options.throwOnDuplicate=false] - multiple=false 且出现多个匹配时是否抛错
     * @returns {any|Array<any>|null}
     */
    getElementByName(name, options = {}) {
        const multiple = options && options.multiple === true
        const throwOnDuplicate = options && options.throwOnDuplicate === true

        const matches = []
        for (const element of this.elements) {
            if (element && element.name === name) {
                if (multiple) {
                    matches.push(element)
                } else {
                    if (!matches.length) {
                        matches.push(element)
                    } else if (throwOnDuplicate) {
                        throw new Error(`getElementByName: name 重复: ${name}`)
                    }
                }
            }
        }

        if (multiple) {
            return matches
        }

        return matches.length ? matches[0] : null
    }

    /**
     * 创建“同款文本”工厂函数。
     * @param {Object} [baseOptions]
     * @param {Object} [options]
     * @param {boolean} [options.autoAdd=true] - 是否自动 addElement
     * @param {string} [options.namePrefix] - 自动命名前缀（当未显式提供 name 时）
     * @returns {(overrideOptions?: Object) => TextElement}
     */
    createTextFactory(baseOptions = {}, options = {}) {
        const autoAdd = !(options && options.autoAdd === false)
        const namePrefix = options && typeof options.namePrefix === "string" ? options.namePrefix : ""
        let counter = 0

        return (overrideOptions = {}) => {
            const merged = deepMerge(deepMerge({}, baseOptions || {}), overrideOptions || {})
            if (namePrefix && !merged.name) {
                counter += 1
                merged.name = `${namePrefix}${counter}`
            }

            const element = new TextElement(merged)
            if (autoAdd) {
                this.addElement(element)
            }
            return element
        }
    }

    /**
     * 移除演示中的元素
     * @param {BaseElement} element
     */
    removeElement(element) {
        const index = this.elements.indexOf(element)
        if (index !== -1) {
            this.elements.splice(index, 1)
            this.markProgramDirty()
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
        this.markProgramDirty()
    }

    /**
     * 切换到指定场景，触发布局计算与动画
     * @param {Scene} scene
     */
    setScene(scene) {
        if (this.scenes.indexOf(scene) === -1) {
            throw new Error("指定的场景不属于此演示")
        }

        // === Step 1：切场景前兜底 contentRect ===
        // 做什么：同步 contentRect，必要时 flush。
        // 意义：避免切场景时 Layout.resolve 用 0 尺寸计算百分比坐标。
        this.ensureContentRectReady({ forceFlush: false })

        this.ensureProgramCompiled()
        const previousScene = this.currentScene
        const transitionConfig = this.resolveSceneTransitionConfig(scene)
        this.currentSceneTransition = transitionConfig

        // === Step 2：写入本次切场景的 transition 配置 ===
        // 做什么：把 duration/easing 写到 content.style 与 CSS 变量。
        // 意义：Renderer 子节点复用这份配置，确保整个场景切换的动画参数一致。
        this.applySceneTransitionStyle(transitionConfig)
        this.currentScene = scene
        this.ensureRenderer()

        // === Step 3：生成“切场景执行计划”（语义层）===
        // 做什么：根据 from/to 场景 + 方向，解析每个元素的 fromState/toState，并计算最终 delay。
        // 意义：把方向、delay 镜像等语义从 Renderer 移出，Renderer 只消费 plan 执行渲染。
        const toIndex = this.program.getSceneIndex(scene)
        const fromIndex = previousScene ? this.program.getSceneIndex(previousScene) : null
        const direction = fromIndex == null ? "forward" : (fromIndex <= toIndex ? "forward" : "backward")
        const transitionPlan =
            fromIndex != null
                ? (this.program.getAdjacentPlan(fromIndex, toIndex) || this.program.buildPlan(fromIndex, toIndex, direction))
                : this.program.buildPlan(null, toIndex, direction)

        // === Step 4：交给 Renderer 执行（执行层）===
        // Renderer 负责：节点创建/复用、写样式、两帧入场（Phase1/Phase2）、触发 reflow/rAF。
        this.onSceneChanged(scene, previousScene, {
            transition: transitionConfig,
            transitionPlan,
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

        const currentIndex = this.getCurrentSceneIndex() // 当前场景索引
        const isAtTail = currentIndex >= this.scenes.length - 1 // 是否已到最后一个场景

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

        const currentIndex = this.getCurrentSceneIndex() // 当前场景索引
        const isAtHead = currentIndex <= 0 // 是否已到第一个场景

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
        if (!this.renderer) {
            return
        }

        // 兜底：Renderer 只执行 plan，不再做语义推导。
        // 这允许应用层仅触发 onSceneChanged，而不必手动构造 transitionPlan。
        const context = (transitionContext && typeof transitionContext === "object")
            ? transitionContext
            : {}

        if (!context.transitionPlan) {
            this.ensureProgramCompiled()
            const toIndex = this.program.getSceneIndex(scene)
            const fromIndex = previousScene ? this.program.getSceneIndex(previousScene) : null
            const direction = fromIndex == null ? "forward" : (fromIndex <= toIndex ? "forward" : "backward")
            context.transitionPlan =
                fromIndex != null
                    ? (this.program.getAdjacentPlan(fromIndex, toIndex) || this.program.buildPlan(fromIndex, toIndex, direction))
                    : this.program.buildPlan(null, toIndex, direction)
        }

        this.renderer.onSceneChanged(this, scene, previousScene, context)
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
     * 规范化预加载配置。
     * @param {Object} config
     * @returns {{enabled:boolean,readyThreshold:number,minVisibleMs:number,showProgressBar:boolean,barHeight:number,allowInteractionWhileLoading:boolean,sources:string[]}}
     */
    normalizePreloadConfig(config) {
        const normalized = {
            enabled: true,
            readyThreshold: 1,
            minVisibleMs: 1400,
            showProgressBar: true,
            barHeight: 4,
            allowInteractionWhileLoading: true,
            sources: [],
        }

        if (!config || typeof config !== "object") {
            return normalized
        }

        normalized.enabled = config.enabled !== false
        normalized.showProgressBar = config.showProgressBar !== false
        normalized.allowInteractionWhileLoading = config.allowInteractionWhileLoading !== false

        const readyThreshold = Number(config.readyThreshold)
        if (Number.isFinite(readyThreshold)) {
            normalized.readyThreshold = Math.min(Math.max(readyThreshold, 0), 1)
        }

        const minVisibleMs = Number(config.minVisibleMs)
        if (Number.isFinite(minVisibleMs) && minVisibleMs >= 0) {
            normalized.minVisibleMs = minVisibleMs
        }

        const barHeight = Number(config.barHeight)
        if (Number.isFinite(barHeight) && barHeight >= 2) {
            normalized.barHeight = barHeight
        }

        if (Array.isArray(config.sources)) {
            normalized.sources = config.sources
                .map((item) => String(item || "").trim())
                .filter(Boolean)
        }

        return normalized
    }

    /**
     * 启动图片预加载流程（默认非阻塞）。
     */
    startImagePreload() {
        const allSources = this.collectPreloadImageSources()
        if (!allSources.length) {
            this.preloadReady = true
            return
        }

        this.preloadStartedAt = Date.now()
        this.preloadReady = false
        this.preloadBarHidden = false
        this.preloadFailedSources = []

        if (this.preload.showProgressBar) {
            this.mountPreloadProgressBar()
            this.updatePreloadProgressBar(0)
        }

        let loaded = 0
        let failed = 0
        const total = allSources.length

        const finalizeProgress = () => {
            const progress = total > 0 ? (loaded + failed) / total : 1
            this.updatePreloadProgressBar(progress)

            if (!this.preloadReady && progress >= this.preload.readyThreshold) {
                this.preloadReady = true
                this.scheduleHidePreloadProgressBar()
            }
        }

        this.preloadTask = Promise.all(
            allSources.map((src) =>
                this.preloadSingleImage(src).then((ok) => {
                    if (ok) {
                        loaded += 1
                    } else {
                        failed += 1
                        this.preloadFailedSources.push(src)
                    }
                    finalizeProgress()
                })
            )
        ).then(() => {
            if (!this.preloadReady) {
                this.preloadReady = true
                this.scheduleHidePreloadProgressBar()
            }

            if (this.preloadFailedSources.length) {
                console.warn(
                    `[silkyscene preload] ${this.preloadFailedSources.length}/${total} images failed and were skipped.`
                )
            }
        })
    }

    /**
     * 收集预加载图片资源：配置 sources + ImageElement.src。
     * @returns {string[]}
     */
    collectPreloadImageSources() {
        const sources = [...this.preload.sources]
        for (const element of this.elements) {
            if (element && element.type === "image" && element.src) {
                sources.push(String(element.src))
            }
        }
        return [...new Set(sources.filter(Boolean))]
    }

    /**
     * 单图预加载（带缓存）。
     * @param {string} src
     * @returns {Promise<boolean>}
     */
    preloadSingleImage(src) {
        if (!src) {
            return Promise.resolve(false)
        }

        if (this.preloadImageTaskCache.has(src)) {
            return this.preloadImageTaskCache.get(src)
        }

        const task = (async () => {
            try {
                if (this.renderer && typeof this.renderer.predecodeImage === "function") {
                    const ok = await this.renderer.predecodeImage(src)
                    return Boolean(ok)
                }

                const img = new Image()
                img.decoding = "async"
                img.src = src

                if (typeof img.decode === "function") {
                    await img.decode()
                    return true
                }

                await new Promise((resolve, reject) => {
                    img.onload = () => resolve(true)
                    img.onerror = () => reject(new Error("image load failed"))
                })
                return true
            } catch {
                return false
            }
        })()

        this.preloadImageTaskCache.set(src, task)
        return task
    }

    /**
     * 挂载顶部细条进度条。
     */
    mountPreloadProgressBar() {
        if (this.preloadBarHost || !this.preload.showProgressBar) {
            return
        }

        const host = document.createElement("div")
        host.style.position = "fixed"
        host.style.left = "0"
        host.style.top = "0"
        host.style.width = "100%"
        host.style.height = `${this.preload.barHeight}px`
        host.style.background = "rgba(148, 163, 184, 0.28)"
        host.style.zIndex = "99999"
        host.style.pointerEvents = "none"
        host.style.transition = "opacity 320ms ease"

        const fill = document.createElement("div")
        fill.style.width = "0%"
        fill.style.height = "100%"
        fill.style.background = "linear-gradient(90deg, #38bdf8 0%, #22d3ee 100%)"
        fill.style.boxShadow = "0 0 10px rgba(34, 211, 238, 0.7)"
        fill.style.transformOrigin = "left center"
        fill.style.transition = "width 220ms ease, background 280ms ease, box-shadow 280ms ease"
        host.appendChild(fill)

        const label = document.createElement("div")
        label.textContent = "0%"
        label.style.position = "fixed"
        label.style.right = "10px"
        label.style.top = "8px"
        label.style.padding = "2px 6px"
        label.style.borderRadius = "999px"
        label.style.fontSize = "10px"
        label.style.lineHeight = "1"
        label.style.fontWeight = "700"
        label.style.letterSpacing = "0.04em"
        label.style.color = "#c7f9ff"
        label.style.background = "rgba(2, 6, 23, 0.55)"
        label.style.border = "1px solid rgba(56, 189, 248, 0.4)"
        label.style.backdropFilter = "blur(2px)"
        label.style.zIndex = "100000"
        label.style.pointerEvents = "none"
        label.style.transition = "opacity 320ms ease, color 260ms ease, border-color 260ms ease"

        document.body.appendChild(host)
        document.body.appendChild(label)

        this.preloadBarHost = host
        this.preloadBarFill = fill
        this.preloadBarLabel = label
    }

    /**
     * 更新进度条。
     * @param {number} progress
     */
    updatePreloadProgressBar(progress) {
        if (!this.preloadBarHost || this.preloadBarHidden) {
            return
        }

        const p = Math.max(0, Math.min(1, Number(progress) || 0))
        this.preloadBarFill.style.width = `${(p * 100).toFixed(2)}%`
        this.preloadBarLabel.textContent = `${Math.round(p * 100)}%`

        if (p >= this.preload.readyThreshold) {
            this.preloadBarFill.style.background = "linear-gradient(90deg, #22c55e 0%, #4ade80 100%)"
            this.preloadBarFill.style.boxShadow = "0 0 10px rgba(74, 222, 128, 0.7)"
            this.preloadBarLabel.style.color = "#dcfce7"
            this.preloadBarLabel.style.borderColor = "rgba(74, 222, 128, 0.45)"
        }
    }

    /**
     * 到达阈值后按最短展示时长淡出进度条。
     */
    scheduleHidePreloadProgressBar() {
        if (!this.preloadBarHost || this.preloadBarHidden) {
            return
        }

        this.preloadBarHidden = true
        const elapsed = Date.now() - this.preloadStartedAt
        const waitMs = Math.max(0, this.preload.minVisibleMs - elapsed)

        setTimeout(() => {
            if (this.preloadBarHost) {
                this.preloadBarHost.style.opacity = "0"
            }
            if (this.preloadBarLabel) {
                this.preloadBarLabel.style.opacity = "0"
            }
        }, waitMs)

        setTimeout(() => {
            this.unmountPreloadProgressBar()
        }, waitMs + 360)
    }

    /**
     * 卸载进度条节点。
     */
    unmountPreloadProgressBar() {
        if (this.preloadBarHost && this.preloadBarHost.parentNode) {
            this.preloadBarHost.parentNode.removeChild(this.preloadBarHost)
        }
        if (this.preloadBarLabel && this.preloadBarLabel.parentNode) {
            this.preloadBarLabel.parentNode.removeChild(this.preloadBarLabel)
        }

        this.preloadBarHost = null
        this.preloadBarFill = null
        this.preloadBarLabel = null
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

        this.content.style.transitionProperty = "transform, opacity, background-color, color, width, height, border-radius, border-width"
        this.content.style.transitionDuration = `${transitionConfig.duration}ms`
        this.content.style.transitionTimingFunction = transitionConfig.easing

        // 同步为 CSS 变量，便于子节点动画样式复用。
        this.content.style.setProperty("--silkyscene-transition-duration", `${transitionConfig.duration}ms`)
        this.content.style.setProperty("--silkyscene-transition-easing", transitionConfig.easing)
    }

    /**
     * 标记 program 预编译产物失效。
     */
    markProgramDirty() {
        if (this.program) {
            this.program.markDirty()
        }
    }

    /**
     * 确保场景预编译产物可用。
     */
    ensureProgramCompiled() {
        if (!this.program) {
            this.program = new CompiledProgram(this)
        }

        this.program.ensureCompiled()
    }

    /**
     * 获取元素在指定场景的最终态（已应用继承与移除规则）。
     * @param {Scene|null} scene
     * @param {BaseElement} element
     * @returns {Object|null}
     */
    getResolvedState(scene, element) {
        if (!scene || !element || !element.id) {
            return null
        }

        this.ensureProgramCompiled()
        const index = this.program.getSceneIndex(scene)
        const snapshot = this.program.getSnapshotByIndex(index)
        if (!snapshot) {
            return null
        }

        const state = snapshot.resolvedStatesById.get(element.id)
        return state ? deepMerge({}, state) : null
    }

    /**
     * 获取可渲染状态（已应用布局编译缓存覆盖）。
     * @param {Scene|null} scene
     * @param {BaseElement} element
     * @returns {Object|null}
     */
    getRenderableState(scene, element) {
        if (!scene || !element || !element.id) {
            return null
        }

        this.ensureProgramCompiled()
        const index = this.program.getSceneIndex(scene)
        const snapshot = this.program.getSnapshotByIndex(index)
        if (!snapshot) {
            return null
        }

        const state = snapshot.renderableStatesById.get(element.id)
        return state ? deepMerge({}, state) : null
    }

    /**
     * 获取元素在指定场景的编译布局。
     * @param {Scene|null} scene
     * @param {BaseElement} element
     * @returns {Object|null}
     */
    getCompiledLayout(scene, element) {
        if (!scene || !element || !element.id) {
            return null
        }

        this.ensureProgramCompiled()
        const index = this.program.getSceneIndex(scene)
        const snapshot = this.program.getSnapshotByIndex(index)
        if (!snapshot) {
            return null
        }

        const layout = snapshot.compiledLayoutsById.get(element.id)
        return layout ? deepMerge({}, layout) : null
    }

    /**
     * 获取元素在指定场景的最终元数据（已应用继承与移除规则）。
     * @param {Scene|null} scene
     * @param {BaseElement} element
     * @returns {Object|null}
     */
    getResolvedMeta(scene, element) {
        if (!scene || !element || !element.id) {
            return null
        }

        this.ensureProgramCompiled()
        const index = this.program.getSceneIndex(scene)
        const snapshot = this.program.getSnapshotByIndex(index)
        if (!snapshot) {
            return null
        }

        const meta = snapshot.metaById.get(element.id)
        return meta ? deepMerge({}, meta) : null
    }

    /**
     * 将 scene 引用解析为 sceneIndex。
     * @param {number|string|any|null} sceneOrIndexOrName
     * @returns {number}
     */
    resolveSceneIndex(sceneOrIndexOrName) {
        if (sceneOrIndexOrName == null) {
            return this.currentScene ? this.program.getSceneIndex(this.currentScene) : -1
        }

        if (typeof sceneOrIndexOrName === "number") {
            const index = sceneOrIndexOrName
            return Number.isInteger(index) ? index : -1
        }

        if (typeof sceneOrIndexOrName === "string") {
            const name = sceneOrIndexOrName
            const scene = this.scenes.find((s) => s && s.name === name) || null
            return scene ? this.program.getSceneIndex(scene) : -1
        }

        // 尽量宽松地识别 Scene 实例：只要具备典型方法即可。
        const maybeScene = sceneOrIndexOrName
        if (maybeScene && typeof maybeScene.getState === "function" && typeof maybeScene.getStateMeta === "function") {
            return this.program.getSceneIndex(maybeScene)
        }

        return -1
    }

    /**
     * 获取指定场景的几何查询对象（纯计算预测，不依赖 DOM）。
     *
     * @param {number|string|any|null} sceneOrIndexOrName
     * @param {Object} [options]
     * @param {number} [options.containerWidth] - 画布宽（px）。用于“未渲染场景”的预测。
     * @param {number} [options.containerHeight] - 画布高（px）。用于“未渲染场景”的预测。
     * @param {boolean} [options.includeTransform=true]
     * @returns {SceneGeometry|null}
     */
    getSceneGeometry(sceneOrIndexOrName, options = {}) {
        this.ensureProgramCompiled()

        const index = this.resolveSceneIndex(sceneOrIndexOrName)
        const snapshot = this.program.getSnapshotByIndex(index)
        if (!snapshot) {
            return null
        }

        let containerWidth = Number(options.containerWidth || 0)
        let containerHeight = Number(options.containerHeight || 0)

        // 若调用方未显式提供尺寸，则尝试从当前 content 读取。
        if (!(containerWidth > 0 && containerHeight > 0)) {
            // 这里不强制 flush：几何预测 API 用于布局计算，调用方若依赖 DOM 尺寸，应在 start 后调用。
            containerWidth = Number(this.content && this.content.clientWidth) || 0
            containerHeight = Number(this.content && this.content.clientHeight) || 0
        }

        if (!(containerWidth > 0 && containerHeight > 0)) {
            throw new Error(
                "getSceneGeometry 需要有效的 containerWidth/containerHeight（用于未渲染场景预测），或确保 Presentation.start() 后再调用"
            )
        }

        const elementsById = new Map(this.elements.map((el) => [el.id, el]))

        return new SceneGeometry({
            containerWidth,
            containerHeight,
            renderableStatesById: snapshot.renderableStatesById,
            elementsById,
            includeTransform: options.includeTransform !== false,
        })
    }

    /**
     * 直接获取元素在指定场景的矩形信息。
     */
    getElementRect(sceneOrIndexOrName, elementOrId, options = {}) {
        const geometry = this.getSceneGeometry(sceneOrIndexOrName, options)
        if (!geometry) return null
        return geometry.getRect(elementOrId, options)
    }

    /**
     * 直接获取元素在指定场景的九宫格点位（含可选偏移）。
     */
    getElementPoint(sceneOrIndexOrName, elementOrId, pos, options = {}) {
        const geometry = this.getSceneGeometry(sceneOrIndexOrName, options)
        if (!geometry) return null
        return geometry.getPoint(elementOrId, pos, options)
    }
}