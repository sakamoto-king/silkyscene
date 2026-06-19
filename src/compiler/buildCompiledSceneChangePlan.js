import { resolveElementTransitionFromSnapshots } from "./transitionResolver.js"

/**
 * buildCompiledSceneChangePlan（基于快照生成切场景执行计划）。
 *
 * 该计划是 Renderer 的唯一输入之一：Renderer 不再推导“方向/倒放/延迟镜像”等语义，
 * 只负责按 plan 执行（创建/复用节点、写样式、两帧入场、触发 reflow/rAF）。
 *
 * 数据来源：CompiledProgram.snapshots（预编译快照）。因此生成 plan 时不会访问 DOM，
 * 也不会调用 Presentation 的任何“实时计算”方法。
 */

/**
 * @typedef {Object} SceneChangePlanItem
 * @property {any} element
 * @property {string} elementId
 * @property {Object|null} fromState
 * @property {Object|null} toState
 * @property {Object|null} fromMeta
 * @property {Object|null} toMeta
 * @property {boolean} hasRenderableState
 * @property {boolean} wasInPreviousScene
 * @property {boolean} isEntering
 * @property {number} rawDelay
 * @property {number} finalDelay
 */

/**
 * @typedef {Object} SceneChangePlan
 * @property {"forward"|"backward"} direction
 * @property {number} maxDelay
 * @property {Array<SceneChangePlanItem>} items
 */

/**
 * 基于预编译快照生成一次切场景执行计划。
 *
 * delay 规则：
 * - rawDelay 的来源按“本次切换元素存在在哪一侧”选择：to 优先，否则 from。
 * - backward 需要镜像：finalDelay = maxDelay - rawDelay。
 *
 * @param {any} program - CompiledProgram
 * @param {number|null} fromIndex
 * @param {number} toIndex
 * @param {"forward"|"backward"} direction
 * @returns {SceneChangePlan}
 */
export function buildCompiledSceneChangePlan(program, fromIndex, toIndex, direction) {
    const items = []
    let maxDelay = 0

    const fromSnapshot = fromIndex == null ? null : program.getSnapshotByIndex(fromIndex)
    const toSnapshot = program.getSnapshotByIndex(toIndex)

    for (const element of program.elements) {
        const elementId = element.id

        const rawFromState = fromSnapshot ? fromSnapshot.renderableStatesById.get(elementId) || null : null
        const rawToState = toSnapshot ? toSnapshot.renderableStatesById.get(elementId) || null : null
        const fromMeta = fromSnapshot ? fromSnapshot.metaById.get(elementId) || null : null
        const toMeta = toSnapshot ? toSnapshot.metaById.get(elementId) || null : null

        const transition = resolveElementTransitionFromSnapshots(
            rawFromState,
            rawToState,
            fromMeta,
            toMeta,
            direction
        )

        const fromState = transition.fromState
        const toState = transition.toState

        const hasRenderableState = Boolean(fromState || toState)

        const fromDelay = transition.meta?.fromMeta?.delay ?? 0
        const toDelay = transition.meta?.toMeta?.delay ?? 0

        const rawDelay = rawToState ? toDelay : rawFromState ? fromDelay : 0
        if (hasRenderableState && rawDelay > maxDelay) {
            maxDelay = rawDelay
        }

        const wasInPreviousScene = Boolean(rawFromState)

        items.push({
            element,
            elementId,
            fromState,
            toState,
            fromMeta: transition.meta?.fromMeta ?? null,
            toMeta: transition.meta?.toMeta ?? null,
            hasRenderableState,
            wasInPreviousScene,
            isEntering: Boolean(fromState && !wasInPreviousScene),
            rawDelay,
            finalDelay: 0,
        })
    }

    for (const item of items) {
        item.finalDelay = direction === "backward" ? maxDelay - item.rawDelay : item.rawDelay
    }

    return {
        direction,
        maxDelay,
        items,
    }
}
