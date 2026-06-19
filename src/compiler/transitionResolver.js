import { deepMerge } from "../utils/deepMerge.js"

/**
 * transitionResolver（过渡语义解析器）。
 *
 * 输入：
 * - rawFromState/rawToState：来自“场景快照”的 renderable state（已含布局）。
 * - fromMeta/toMeta：来自“场景快照”的 meta（含 entrance/exit/delay 等）。
 * - direction：forward/backward。
 *
 * 输出：
 * - fromState/toState：本次切换用于动画执行的起始态/目标态。
 *
 * 设计原则：
 * - 只做语义层推导（entrance/exit 倒放、默认淡入），不触碰 DOM。
 * - 该模块不依赖 Presentation/Renderer，便于测试与复用。
 */

/**
 * 判断 meta.entrance 是否启用。
 * @param {Object|null} stateMeta
 * @returns {boolean}
 */
export function hasEnabledEntrance(stateMeta) {
    return Boolean(stateMeta && stateMeta.entrance && stateMeta.entrance.enabled)
}

/**
 * 判断 meta.exit 是否启用。
 * @param {Object|null} stateMeta
 * @returns {boolean}
 */
export function hasEnabledExit(stateMeta) {
    return Boolean(stateMeta && stateMeta.exit && stateMeta.exit.enabled)
}

/**
 * 当 overrides 未显式定义 opacity 时，补一个默认 opacity=0。
 * 目的：保证“入场/出场”至少有可见性变化（除非用户明确指定）。
 * @param {Object} overrides
 * @returns {Object}
 */
export function pickVisibleTransitionDefaults(overrides) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, "opacity")) {
        return {}
    }

    return {
        opacity: 0,
    }
}

/**
 * 将方向关键字（bottom/top/left/right）转成状态增量。
 * @param {"bottom"|"top"|"left"|"right"} keyword
 * @param {string|null} distance
 * @returns {Object}
 */
export function buildDirectionState(keyword, distance) {
    const d = distance || "4%"
    switch (keyword) {
        case "bottom":
            return { opacity: 0, transform: { y: d } }
        case "top":
            return { opacity: 0, transform: { y: -d } }
        case "left":
            return { opacity: 0, transform: { x: -d } }
        case "right":
            return { opacity: 0, transform: { x: d } }
        default:
            return {}
    }
}

/**
 * 从 entrance/exit 元数据构建动画覆盖状态。
 * - 支持字符串方向关键字：bottom/top/left/right
 * - 支持对象：直接 deepMerge 作为 overrides
 * @param {Object|null} animMeta
 * @param {"from"|"to"} key
 * @returns {Object}
 */
export function buildAnimationOverrides(animMeta, key) {
    const rawValue = animMeta ? animMeta[key] : null
    let overrides = {}

    if (rawValue == null) {
        overrides = {}
    } else if (typeof rawValue === "string") {
        overrides = buildDirectionState(rawValue, animMeta.distance)
    } else if (typeof rawValue === "object") {
        overrides = deepMerge({}, rawValue)
    }

    return deepMerge(overrides, pickVisibleTransitionDefaults(overrides))
}

/**
 * 基于快照的 rawFrom/rawTo + meta 解析本次切换的 from/to。
 * 语义保持与历史版本一致。
 *
 * 规则要点：
 * - forward：
 *   - 首次出现且启用 entrance：fromState = toState + entrance.from overrides
 *   - 首次出现但未启用 entrance：默认 fromState.opacity = 0（淡入）
 *   - 消失且启用 exit：toState = fromState + exit.to overrides
 * - backward：
 *   - 出现：倒放 exit（fromState = toState + exit.to overrides）
 *   - 消失：倒放 entrance（toState = fromState + entrance.from overrides）
 *
 * @param {Object|null} rawFromState
 * @param {Object|null} rawToState
 * @param {Object|null} fromMeta
 * @param {Object|null} toMeta
 * @param {"forward"|"backward"} [direction="forward"]
 * @returns {{fromState: Object|null, toState: Object|null, meta: {fromMeta: Object|null, toMeta: Object|null}}}
 */
export function resolveElementTransitionFromSnapshots(
    rawFromState,
    rawToState,
    fromMeta,
    toMeta,
    direction = "forward"
) {
    let fromState = rawFromState ? deepMerge({}, rawFromState) : null
    let toState = rawToState ? deepMerge({}, rawToState) : null

    if (direction === "forward") {
        // 正向入场：元素在 toScene 首次出现，且配置了 entrance
        if (!rawFromState && rawToState && hasEnabledEntrance(toMeta)) {
            const overrides = buildAnimationOverrides(toMeta.entrance, "from")
            fromState = deepMerge(deepMerge({}, rawToState), overrides)
        }

        // 全局默认入场：元素首次出现但未配置 entrance 时，默认从 opacity=0 淡入。
        if (!rawFromState && rawToState && !hasEnabledEntrance(toMeta)) {
            fromState = deepMerge(deepMerge({}, rawToState), { opacity: 0 })
        }

        // 正向出场：元素在 toScene 中不存在，且 fromScene 配置了 exit
        if (rawFromState && !rawToState && hasEnabledExit(fromMeta)) {
            const overrides = buildAnimationOverrides(fromMeta.exit, "to")
            toState = deepMerge(deepMerge({}, rawFromState), overrides)
        }
    } else {
        // 反向入场：从 exit 倒放入场（元素出现但 fromScene 无此元素）
        if (!rawFromState && rawToState && hasEnabledExit(toMeta)) {
            const overrides = buildAnimationOverrides(toMeta.exit, "to")
            fromState = deepMerge(deepMerge({}, rawToState), overrides)
        }

        // backward 默认入场：元素在 toScene 出现但未配置 exit 时，仍按“淡入”处理。
        // 目的：确保回退时也能触发两帧入场机制，避免瞬间闪现。
        if (!rawFromState && rawToState && !hasEnabledExit(toMeta)) {
            fromState = deepMerge(deepMerge({}, rawToState), { opacity: 0 })
        }

        // 反向出场：从 entrance 倒放出场（元素消失但 toScene 无此元素）
        if (rawFromState && !rawToState && hasEnabledEntrance(fromMeta)) {
            const overrides = buildAnimationOverrides(fromMeta.entrance, "from")
            toState = deepMerge(deepMerge({}, rawFromState), overrides)
        }

        // backward 默认出场：元素在 fromScene 存在但在 toScene 消失，且未配置 entrance 时，默认淡出。
        // 目的：避免回退时元素直接被置空而“整场瞬消”。
        if (rawFromState && !rawToState && !hasEnabledEntrance(fromMeta)) {
            toState = deepMerge(deepMerge({}, rawFromState), { opacity: 0 })
        }
    }

    return {
        fromState,
        toState,
        meta: {
            fromMeta: fromMeta || null,
            toMeta: toMeta || null,
        },
    }
}
