import { deepMerge } from "./utils/deepMerge.js"
import { normalizeDistancePercent } from "./utils/size.js"

/**
 * 场景。
 *
 * 一个场景保存一段时间内各元素的状态快照（布局、变换、视觉属性等）。
 * Scene 不管理元素本体，而是管理元素在当前场景的状态。
 * Renderer 将使用 Element + SceneState 计算最终的画面。
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
        this.states[element.id] = state
        this.stateMeta[element.id] = this.normalizeStateMeta(options)
        this.removedStateIds.delete(element.id)
        if (!this.elementIds.includes(element.id)) {
            this.elementIds.push(element.id)
        }
        this.stateVersion += 1
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
     * 规范化状态元数据，确保运行时可以稳定消费。
     * @param {Object} options
     * @returns {Object}
     */
    normalizeStateMeta(options) {
        const meta = {}
        const entrance = this.normalizeEntrance(options.entrance)
        if (entrance) {
            meta.entrance = entrance
        }
        const exit = this.normalizeExit(options.exit)
        if (exit) {
            meta.exit = exit
        }
        return meta
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