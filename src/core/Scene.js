import { deepMerge } from "../utils/deepMerge.js"
import { normalizeDistancePercent } from "../utils/size.js"

/**
 * Scene（状态输入表）。
 *
 * Scene 的核心定位：
 * - 保存“某一时刻各元素应如何表现”的状态快照（state）与语义元数据（meta）。
 * - 提供 tombstone（removeState/removeStates）以显式阻断跨场景继承。
 * - 提供 delayPattern 语法糖（auto/数组）以生成可继承的 meta.delay。
 *
 * 职责
 * - 写入状态：setState（默认增量合并）、replaceState（全量替换）、setStates（批量且顺序稳定）。
 * - 写入语义：stateMeta（entrance/exit/parent/delay 等）。
 * - 写入移除标记：removedStateIds（tombstone）。
 *
 * 不做的事
 * - 不计算跨场景继承（由 compiler 在编译阶段负责）。
 * - 不解析切场景方向、不做倒放语义（由 compiler/transitionResolver 与切换计划生成器负责）。
 * - 不触碰 DOM。
 *
 * 关键不变量
 * - removeState/removeStates 必须写入 tombstone：缺失 tombstone 会导致元素继续继承上一场景最终态。
 * - delayPattern:'auto' 必须严格依赖 setState 调用顺序；因此 setStates 采用数组以保证顺序稳定。
 */
export class Scene {
    /**
     * @param {string} name - 场景名称
     */
    constructor(name, options = {}) {
        this.name = name

        // 元素状态存储
        // 键为元素 ID，值为该元素在当前场景的状态
        this.states = {}

        // 元素状态元数据
        // 键为元素 ID，值为 setState 的附加语义配置（如 entrance）
        this.stateMeta = {}

        // 元素显式移除标记（tombstone）
        // 被标记的元素不会继承上一场景最终态
        this.removedStateIds = new Set()

        // 元素 ID 列表，用于快速迭代顺序
        this.elementIds = []

        // 场景级切换动画配置（仅在“切换到本场景”时生效）
        // 支持字段：duration(ms)、easing(css timing-function)
        this.transition = this.normalizeTransition(options.transition)

        // 场景状态版本号（仅用于状态继承缓存失效判断）
        this.stateVersion = 0
        // 延迟模式配置（语法糖）
        // 'auto' 表示按 setState 调用顺序自动递增，数组表示显式指定元素顺序
        this.delayPattern = null
        // 延迟间隔（毫秒）
        this.delayInterval = 100
        // 延迟顺序映射（元素 ID -> delay 值）
        this.delayOrderMap = null
        // auto 模式下的计数器
        this.autoDelayCounter = 0
    }

    /**
     * 设置当前场景的切换动画配置。
     * 配置含义：切换到该场景时的动画配置。
     * @param {Object|null} transition
     * @returns {Scene}
     */
    setTransition(transition) {
        this.transition = this.normalizeTransition(transition)
        return this
    }

    /**
     * 设置延迟模式（语法糖）。
     * @param {string|Array} pattern - 'auto' 或元素数组 [element1, element2, [element3, element4], element5]
     * @param {Object} options - 配置选项
     * @param {number} [options.interval=100] - 延迟间隔（毫秒）
     * @returns {Scene}
     */
    setDelayPattern(pattern, options = {}) {
        this.delayPattern = pattern
        this.delayInterval = options.interval ?? 100
        this.autoDelayCounter = 0

        if (pattern === 'auto') {
            // auto 模式：按 setState 调用顺序自动递增
            this.delayOrderMap = null
        } else if (Array.isArray(pattern)) {
            // 数组模式：将嵌套数组展平为延迟映射
            this.delayOrderMap = this.computeDelayMap(pattern, this.delayInterval)
        } else {
            console.warn(`[Scene] Invalid delay pattern, expected 'auto' or array, got:`, pattern)
            this.delayPattern = null
            this.delayOrderMap = null
        }

        return this
    }

    /**
     * 计算延迟映射（将嵌套数组展平为 Map<elementId, delay>）。
     * 嵌套数组表示同时开始，例如：
     * [a, b, [c, d], e] + interval=100 → a=0, b=100, c=200, d=200, e=300
     * @param {Array} pattern - 元素数组（可嵌套）
     * @param {number} interval - 延迟间隔
     * @returns {Map<string, number>}
     */
    computeDelayMap(pattern, interval) {
        const map = new Map()
        let currentDelay = 0

        const processItem = (item) => {
            if (Array.isArray(item)) {
                // 嵌套数组：所有元素共享当前 delay
                for (const subItem of item) {
                    processItem(subItem)
                }
            } else if (item && item.id) {
                // 单个元素
                map.set(item.id, currentDelay)
            } else {
                console.warn(`[Scene] Invalid element in delay pattern:`, item)
            }
        }

        for (const item of pattern) {
            processItem(item)
            // 处理完当前项后，delay 递增
            currentDelay += interval
        }

        return map
    }

    /**
     * 获取当前场景动画配置。
     * @returns {Object|null}
     */
    getTransition() {
        if (!this.transition) {
            return null
        }
        return deepMerge({}, this.transition)
    }

    /**
     * 为某个元素设置在当前场景的状态
     * @param {BaseElement} element - 元素实例
     * @param {Object} state - 状态对象 { layout, transform, opacity, visible, ... }
     * @param {Object} [options] - 语义扩展配置
     * @param {boolean|Object} [options.entrance] - 入场语法糖；true 表示启用默认规则
     */
    setState(element, state, options = {}) {
        if (!element || !element.id) {
            throw new Error("元素必须有有效的 id")
        }

        const normalizedState = this.normalizeStatePayload(state)
        const previousState = this.states[element.id] || {}
        const previousMeta = this.stateMeta[element.id] || {}
        this.states[element.id] = deepMerge(previousState, normalizedState)
        this.stateMeta[element.id] = deepMerge(
            previousMeta,
            this.normalizeStateMeta(element, options)
        )
        this.removedStateIds.delete(element.id)
        if (!this.elementIds.includes(element.id)) {
            this.elementIds.push(element.id)
        }
        this.stateVersion += 1
        return this
    }

    /**
     * 批量写入多个元素状态。
     * 采用数组 entries 以保证顺序稳定，从而与 delayPattern:'auto' 完全一致。
     *
     * @param {Array<{element: any, state: Object, options?: Object}>} entries
     * @param {Object} [commonOptions] - 作用于每条 entry 的公共 options（entry.options 优先）
     * @returns {Scene}
     */
    setStates(entries, commonOptions = {}) {
        if (!Array.isArray(entries)) {
            throw new Error("setStates(entries) 需要传入数组")
        }

        for (const entry of entries) {
            if (!entry || typeof entry !== "object") {
                throw new Error("setStates(entries) entries 中存在无效项")
            }
            const element = entry.element
            const state = entry.state
            const mergedOptions = deepMerge(
                deepMerge({}, commonOptions || {}),
                (entry.options && typeof entry.options === "object") ? entry.options : {}
            )
            this.setState(element, state, mergedOptions)
        }

        return this
    }

    /**
     * 全量替换某元素在当前场景的状态。
     * 与 setState 的默认增量语义不同，replaceState 会丢弃旧状态。
     * @param {BaseElement} element
     * @param {Object} state
     * @param {Object} [options]
     * @returns {Scene}
     */
    replaceState(element, state, options = {}) {
        if (!element || !element.id) {
            throw new Error("元素必须有有效的 id")
        }

        this.states[element.id] = this.normalizeStatePayload(state)
        this.stateMeta[element.id] = this.normalizeStateMeta(element, options)
        this.removedStateIds.delete(element.id)
        if (!this.elementIds.includes(element.id)) {
            this.elementIds.push(element.id)
        }
        this.stateVersion += 1
        return this
    }

    /**
     * 获取某个元素在当前场景的状态
     * @param {BaseElement} element
     * @returns {Object|null} 状态对象或 null
     */
    getState(element) {
        if (!element || !element.id) {
            return null
        }
        return this.states[element.id] || null
    }

    /**
     * 获取某个元素在当前场景的状态元数据
     * @param {BaseElement} element
     * @returns {Object|null}
     */
    getStateMeta(element) {
        if (!element || !element.id) {
            return null
        }
        return this.stateMeta[element.id] || null
    }

    /**
     * 移除某个元素的状态
     * @param {BaseElement} element
     */
    removeState(element) {
        if (!element || !element.id) {
            return
        }
        delete this.states[element.id]
        delete this.stateMeta[element.id]
        this.removedStateIds.add(element.id)
        this.elementIds = this.elementIds.filter(id => id !== element.id)
        this.stateVersion += 1
    }

    /**
     * 批量移除多个元素的状态（tombstone），用于显式阻断跨场景继承。
     * @param {Array} elements
     * @returns {Scene}
     */
    removeStates(elements) {
        if (!Array.isArray(elements)) {
            throw new Error("removeStates(elements) 需要传入数组")
        }

        for (const element of elements) {
            this.removeState(element)
        }

        return this
    }

    /**
     * 判断某元素在当前场景是否被显式移除（阻断继承）。
     * @param {BaseElement} element
     * @returns {boolean}
     */
    isStateRemoved(element) {
        if (!element || !element.id) {
            return false
        }

        return this.removedStateIds.has(element.id)
    }

    /**
     * 获取场景状态版本号。
     * @returns {number}
     */
    getStateVersion() {
        return this.stateVersion
    }

    /**
     * 规范化状态负载。
     * - 复制输入，避免外部对象被运行时意外共享。
     * - layout.mode 缺省时默认补 absolute，减少重复书写。
     * @param {Object} state
     * @returns {Object}
     */
    normalizeStatePayload(state) {
        if (!state || typeof state !== "object") {
            return {}
        }

        const normalized = deepMerge({}, state)
        if (
            normalized.layout &&
            typeof normalized.layout === "object" &&
            !Array.isArray(normalized.layout) &&
            !Object.prototype.hasOwnProperty.call(normalized.layout, "mode")
        ) {
            normalized.layout.mode = "absolute"
        }

        return normalized
    }

    /**
     * 规范化状态元数据，确保运行时可以稳定消费。
     * @param {BaseElement} element - 元素实例
     * @param {Object} options - 配置选项
     * @returns {Object}
     */
    normalizeStateMeta(element, options) {
        const meta = {}
        const entrance = this.normalizeEntrance(options.entrance)
        if (entrance) {
            meta.entrance = entrance
        }
        const exit = this.normalizeExit(options.exit)
        if (exit) {
            meta.exit = exit
        }

        const parent = this.normalizeParentBinding(options)
        if (parent) {
            meta.parent = parent
        }

        // 规范化 delay：优先级 显式 > 延迟模式 > 无
        let delay = null
        if (Object.prototype.hasOwnProperty.call(options, 'delay')) {
            // 显式指定 delay（优先级最高）
            delay = this.normalizeDelay(options.delay)
            // 即使显式指定，auto 模式下仍需递增 counter（保持顺序一致）
            if (this.delayPattern === 'auto') {
                this.autoDelayCounter += 1
            }
        } else if (this.delayPattern) {
            // 延迟模式自动分配
            if (this.delayPattern === 'auto') {
                // auto 模式：按 setState 调用顺序递增
                delay = this.autoDelayCounter * this.delayInterval
                this.autoDelayCounter += 1
            } else if (this.delayOrderMap && element && element.id) {
                // 数组模式：从映射中查找
                delay = this.delayOrderMap.get(element.id) ?? null
            }
        }

        if (delay !== null) {
            meta.delay = delay
        }

        return meta
    }

    /**
     * 规范化延迟时间（毫秒）。
     * @param {number|undefined} delay
     * @returns {number|null} 返回非负整数毫秒数，或 null（表示未配置）
     */
    normalizeDelay(delay) {
        if (delay == null) {
            return null
        }
        const d = Number(delay)
        if (!Number.isFinite(d) || d < 0) {
            console.warn(`[Scene] Invalid delay value "${delay}", expected non-negative number, fallback to 0`)
            return 0
        }
        return Math.round(d)
    }

    /**
     * 规范化场景级 parent 绑定。
     * 使用 options.parent 声明，支持三种形态：
     * - string: 绑定到指定元素 id
     * - { id: string } 或 Element 对象: 绑定到指定元素
     * - null: 显式解绑，回到根容器参考系
     * @param {Object} options
     * @returns {{enabled: boolean, targetId: string|null}|null}
     */
    normalizeParentBinding(options) {
        if (!options || !Object.prototype.hasOwnProperty.call(options, "parent")) {
            return null
        }

        const rawParent = options.parent
        if (rawParent == null) {
            return {
                enabled: true,
                targetId: null,
            }
        }

        if (typeof rawParent === "string") {
            const targetId = rawParent.trim()
            if (!targetId) {
                return {
                    enabled: true,
                    targetId: null,
                }
            }

            return {
                enabled: true,
                targetId,
            }
        }

        if (rawParent && typeof rawParent === "object") {
            if (typeof rawParent.id === "string" && rawParent.id.trim()) {
                return {
                    enabled: rawParent.enabled !== false,
                    targetId: rawParent.id.trim(),
                }
            }

            if (typeof rawParent.targetId === "string" && rawParent.targetId.trim()) {
                return {
                    enabled: rawParent.enabled !== false,
                    targetId: rawParent.targetId.trim(),
                }
            }

            if (Object.prototype.hasOwnProperty.call(rawParent, "targetId") && rawParent.targetId == null) {
                return {
                    enabled: rawParent.enabled !== false,
                    targetId: null,
                }
            }
        }

        return null
    }

    /**
     * 规范化 entrance 语法糖。
     * - true: 仅启用默认规则（当前场景首次出现时，前态缺省则 opacity=0）
     * - object: 可通过 from 指定显式前态
     * @param {boolean|Object} entrance
     * @returns {Object|null}
     */
    normalizeEntrance(entrance) {
        if (!entrance) {
            return null
        }

        if (entrance === true) {
            return {
                enabled: true,
                from: null,
                distance: "4%",
            }
        }

        if (typeof entrance === "string") {
            return {
                enabled: true,
                from: entrance,
                distance: "4%",
            }
        }

        if (typeof entrance === "object") {
            const rawFrom = entrance.from
            let from = null
            if (typeof rawFrom === "string") {
                from = rawFrom
            } else if (rawFrom && typeof rawFrom === "object") {
                from = deepMerge({}, rawFrom)
            }
            const distance = normalizeDistancePercent(
                entrance.distance ?? "4%",
                "entrance.distance"
            )
            return {
                enabled: entrance.enabled !== false,
                from,
                distance,
            }
        }

        return null
    }

    /**
     * 规范化 exit 语法糖。
     * - true: 仅启用默认规则（opacity=0 淡出）
     * - "bottom"|"top"|"left"|"right": 指定离场方向关键字
     * - object: 可通过 to 指定显式目标态
     * @param {boolean|string|Object} exit
     * @returns {Object|null}
     */
    normalizeExit(exit) {
        if (!exit) {
            return null
        }

        if (exit === true) {
            return {
                enabled: true,
                to: null,
                distance: "4%",
            }
        }

        if (typeof exit === "string") {
            return {
                enabled: true,
                to: exit,
                distance: "4%",
            }
        }

        if (typeof exit === "object") {
            const rawTo = exit.to
            let to = null
            if (typeof rawTo === "string") {
                to = rawTo
            } else if (rawTo && typeof rawTo === "object") {
                to = deepMerge({}, rawTo)
            }
            const distance = normalizeDistancePercent(
                exit.distance ?? "4%",
                "exit.distance"
            )
            return {
                enabled: exit.enabled !== false,
                to,
                distance,
            }
        }

        return null
    }

    /**
     * 规范化场景级动画配置。
     * @param {Object|null} transition
     * @returns {Object|null}
     */
    normalizeTransition(transition) {
        if (!transition || typeof transition !== "object") {
            return null
        }

        const normalized = {}

        if (Object.prototype.hasOwnProperty.call(transition, "duration")) {
            const duration = Number(transition.duration)
            if (Number.isFinite(duration) && duration >= 0) {
                normalized.duration = duration
            }
        }

        if (Object.prototype.hasOwnProperty.call(transition, "easing")) {
            const easing = String(transition.easing || "").trim()
            if (easing) {
                normalized.easing = easing
            }
        }

        if (!Object.keys(normalized).length) {
            return null
        }

        return normalized
    }
}