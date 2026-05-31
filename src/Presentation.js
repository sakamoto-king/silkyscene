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

        // 场景最终态缓存（resolved state/meta）
        this.resolvedSceneCache = new Map()
        this.resolvedCacheDirty = true
        this.cachedSceneCount = 0
        this.cachedElementCount = 0
        this.sceneStateVersionSnapshot = new WeakMap()

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

        // 在演示开始前统一预计算场景最终态，切换时直接读取缓存。
        this.ensureResolvedSceneCache()

        if (!this.content.parentNode) {
            this.container.appendChild(this.content)
        }

        this.ensureRenderer()

        if (this.preload.enabled) {
            this.startImagePreload()
        }

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
        this.markResolvedCacheDirty()
    }

    /**
     * 移除演示中的元素
     * @param {BaseElement} element
     */
    removeElement(element) {
        const index = this.elements.indexOf(element)
        if (index !== -1) {
            this.elements.splice(index, 1)
            this.markResolvedCacheDirty()
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
        this.markResolvedCacheDirty()
    }

    /**
     * 切换到指定场景，触发布局计算与动画
     * @param {Scene} scene
     */
    setScene(scene) {
        if (this.scenes.indexOf(scene) === -1) {
            throw new Error("指定的场景不属于此演示")
        }
        this.ensureResolvedSceneCache()
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
        const rawFromState = fromScene ? this.getResolvedState(fromScene, element) : null
        const rawToState = toScene ? this.getResolvedState(toScene, element) : null
        const fromMeta = fromScene ? this.getResolvedMeta(fromScene, element) : null
        const toMeta = toScene ? this.getResolvedMeta(toScene, element) : null

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
     * x/y 值为叠加在布局位置上的偏移，第一版使用百分比字符串（相对短边）。
     * @param {"bottom"|"top"|"left"|"right"} keyword
     * @param {string|null} [distance] - 偏移距离（百分比），默认 "4%"
     * @returns {Object}
     */
    buildDirectionState(keyword, distance) {
        const d = distance || "4%"
        switch (keyword) {
            case "bottom": return { opacity: 0, transform: { y: d } }
            case "top": return { opacity: 0, transform: { y: -d } }
            case "left": return { opacity: 0, transform: { x: -d } }
            case "right": return { opacity: 0, transform: { x: d } }
            default: return {}
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

    /**
     * 标记场景最终态缓存失效。
     */
    markResolvedCacheDirty() {
        this.resolvedCacheDirty = true
    }

    /**
     * 判断缓存是否过期。
     * 触发条件：元素数量/场景数量变更，或场景状态版本号变化。
     * @returns {boolean}
     */
    isResolvedCacheOutdated() {
        if (this.resolvedCacheDirty) {
            return true
        }

        if (this.cachedSceneCount !== this.scenes.length) {
            return true
        }

        if (this.cachedElementCount !== this.elements.length) {
            return true
        }

        for (const scene of this.scenes) {
            const currentVersion =
                scene && typeof scene.getStateVersion === "function"
                    ? scene.getStateVersion()
                    : 0
            const snapshotVersion = this.sceneStateVersionSnapshot.get(scene)
            if (snapshotVersion !== currentVersion) {
                return true
            }
        }

        return false
    }

    /**
     * 确保场景最终态缓存可用。
     */
    ensureResolvedSceneCache() {
        if (!this.isResolvedCacheOutdated()) {
            return
        }

        this.rebuildResolvedSceneCache()
    }

    /**
     * 重建场景最终态缓存。
     * 规则：
     * 1. 当前场景未声明元素时，继承上一场景最终态。
     * 2. Scene.removeState(element) 会写入显式移除标记，阻断继承。
     * 3. 当前场景 setState 会覆盖继承结果；meta 同步覆盖。
     */
    rebuildResolvedSceneCache() {
        const cache = new Map()
        let previousResolvedStates = new Map()
        let previousResolvedMeta = new Map()

        for (const scene of this.scenes) {
            const resolvedStates = new Map()
            const resolvedMeta = new Map()

            for (const [elementId, prevState] of previousResolvedStates.entries()) {
                resolvedStates.set(elementId, deepMerge({}, prevState))
            }

            for (const [elementId, prevMeta] of previousResolvedMeta.entries()) {
                resolvedMeta.set(elementId, deepMerge({}, prevMeta))
            }

            for (const element of this.elements) {
                const elementId = element.id
                const isRemoved =
                    scene && typeof scene.isStateRemoved === "function"
                        ? scene.isStateRemoved(element)
                        : false

                if (isRemoved) {
                    resolvedStates.delete(elementId)
                    resolvedMeta.delete(elementId)
                    continue
                }

                const explicitState = scene.getState(element)
                if (!explicitState) {
                    continue
                }

                resolvedStates.set(elementId, deepMerge({}, explicitState))

                const explicitMeta = scene.getStateMeta(element)
                resolvedMeta.set(elementId, deepMerge({}, explicitMeta || {}))
            }

            cache.set(scene, {
                states: resolvedStates,
                meta: resolvedMeta,
            })

            previousResolvedStates = resolvedStates
            previousResolvedMeta = resolvedMeta

            const stateVersion =
                scene && typeof scene.getStateVersion === "function"
                    ? scene.getStateVersion()
                    : 0
            this.sceneStateVersionSnapshot.set(scene, stateVersion)
        }

        this.resolvedSceneCache = cache
        this.cachedSceneCount = this.scenes.length
        this.cachedElementCount = this.elements.length
        this.resolvedCacheDirty = false
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

        this.ensureResolvedSceneCache()
        const sceneCache = this.resolvedSceneCache.get(scene)
        if (!sceneCache) {
            return null
        }

        const state = sceneCache.states.get(element.id)
        return state ? deepMerge({}, state) : null
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

        this.ensureResolvedSceneCache()
        const sceneCache = this.resolvedSceneCache.get(scene)
        if (!sceneCache) {
            return null
        }

        const meta = sceneCache.meta.get(element.id)
        return meta ? deepMerge({}, meta) : null
    }
}