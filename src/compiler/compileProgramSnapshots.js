import { deepMerge } from "../utils/deepMerge.js"
import { compileSceneLayouts, buildRenderableState } from "./compileSceneLayouts.js"

/**
 * compileProgramSnapshots（预编译场景快照）。
 *
 * 本模块把 Presentation/Scene 的“声明式输入”（Scene.setState/removeState + meta）
 * 编译成 Renderer 可直接消费的“静态快照”：
 * - resolvedStates：跨场景继承后的最终 state（应用 tombstone/removeState）
 * - meta：跨场景继承后的最终 meta（delay/entrance/exit/parent/flow 等）
 * - compiledLayouts：把 parent 绑定与 flow 布局编译成 absolute 布局
 * - renderableStates：resolvedStates + compiledLayouts（作为渲染最终输入）
 *
 * 关键语义（与系统既定规则一致）：
 * - 未声明元素 state：继承上一场景最终态
 * - removeState/isStateRemoved：写入 tombstone，阻断继承（同时移除 meta）
 * - setState：覆盖继承结果（增量 deepMerge）
 */

/**
 * @typedef {Object} CompiledSceneSnapshot
 * @property {Map<string, Object>} resolvedStatesById
 * @property {Map<string, Object>} renderableStatesById
 * @property {Map<string, Object>} metaById
 * @property {Map<string, Object>} compiledLayoutsById
 */

/**
 * 编译整个 Presentation 的场景快照：resolved state/meta + compiled layout + renderable state。
 * 规则与历史实现保持一致：
 * - 未声明元素 state：继承上一场景最终态
 * - removeState/isStateRemoved：tombstone 阻断继承
 * - setState：覆盖（增量合并）
 *
 * @param {Array<any>} scenes
 * @param {Array<any>} elements
 * @returns {{snapshots: Array<CompiledSceneSnapshot>, sceneIndexByScene: Map<any, number>, sceneStateVersionSnapshot: WeakMap<any, number>}}
 */
export function compileProgramSnapshots(scenes, elements) {
    const sceneIndexByScene = new Map()
    const sceneStateVersionSnapshot = new WeakMap()

    const snapshots = []

    let previousResolvedStates = new Map()
    let previousResolvedMeta = new Map()

    for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
        const scene = scenes[sceneIndex]
        sceneIndexByScene.set(scene, sceneIndex)

        const resolvedStates = new Map()
        const resolvedMeta = new Map()

        for (const [elementId, prevState] of previousResolvedStates.entries()) {
            resolvedStates.set(elementId, deepMerge({}, prevState))
        }

        for (const [elementId, prevMeta] of previousResolvedMeta.entries()) {
            resolvedMeta.set(elementId, deepMerge({}, prevMeta))
        }

        for (const element of elements) {
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

            const inheritedState = resolvedStates.get(elementId) || {}
            resolvedStates.set(elementId, deepMerge(inheritedState, explicitState))

            const explicitMeta = scene.getStateMeta(element)
            const previousMeta = resolvedMeta.get(elementId) || {}
            resolvedMeta.set(elementId, deepMerge(previousMeta, explicitMeta || {}))
        }

        const compiledLayoutsById = compileSceneLayouts(elements, resolvedStates, resolvedMeta)

        const renderableStatesById = new Map()
        for (const [elementId, state] of resolvedStates.entries()) {
            const layout = compiledLayoutsById.get(elementId) || null
            renderableStatesById.set(elementId, buildRenderableState(state, layout))
        }

        snapshots.push({
            resolvedStatesById: resolvedStates,
            renderableStatesById,
            metaById: resolvedMeta,
            compiledLayoutsById,
        })

        previousResolvedStates = resolvedStates
        previousResolvedMeta = resolvedMeta

        const stateVersion =
            scene && typeof scene.getStateVersion === "function" ? scene.getStateVersion() : 0
        sceneStateVersionSnapshot.set(scene, stateVersion)
    }

    return {
        snapshots,
        sceneIndexByScene,
        sceneStateVersionSnapshot,
    }
}
