import { compileProgramSnapshots } from "./compileProgramSnapshots.js"
import { buildCompiledSceneChangePlan } from "./buildCompiledSceneChangePlan.js"

/**
 * CompiledProgram（运行时预编译产物管理器）。
 *
 * 设计目标：
 * - 把“切换场景时的实时演算”前移到 start/ensureCompiled 阶段。
 * - 生成并缓存：
 *   1) 每个场景的编译快照（resolvedStates/meta + compiledLayouts + renderableStates）
 *   2) 相邻场景（i→i+1、i→i-1）的切换执行计划（SceneChangePlan）
 * - 切换时只需要：按索引读取 plan → 交给 Renderer 执行。
 *
 * 失效策略：
 * - dirty：由 Presentation 在 elements/scenes 结构变化时显式标记。
 * - outdated：场景/元素数量变化，或 Scene.getStateVersion() 变化。
 *   该策略保证“运行中改 Scene 状态”时，下次 ensureCompiled 会自动重新编译。
 */
export class CompiledProgram {
    /**
     * @param {any} presentation - Presentation 实例（作为输入源：scenes/elements）
     */
    constructor(presentation) {
        this.presentation = presentation

        this.scenes = []
        this.elements = []

        this.snapshots = []
        this.sceneIndexByScene = new Map()

        this.forwardPlans = []
        this.backwardPlans = []

        this.dirty = true
        this.sceneStateVersionSnapshot = new WeakMap()
        this.cachedSceneCount = 0
        this.cachedElementCount = 0
    }

    markDirty() {
        this.dirty = true
    }

    syncInputsFromPresentation() {
        this.scenes = this.presentation.scenes
        this.elements = this.presentation.elements
    }

    isOutdated() {
        if (this.dirty) {
            return true
        }

        if (this.cachedSceneCount !== this.presentation.scenes.length) {
            return true
        }

        if (this.cachedElementCount !== this.presentation.elements.length) {
            return true
        }

        for (const scene of this.presentation.scenes) {
            const currentVersion =
                scene && typeof scene.getStateVersion === "function" ? scene.getStateVersion() : 0
            const snapshotVersion = this.sceneStateVersionSnapshot.get(scene)
            if (snapshotVersion !== currentVersion) {
                return true
            }
        }

        return false
    }

    ensureCompiled() {
        if (!this.isOutdated()) {
            return
        }

        this.compileAll()
    }

    compileAll() {
        this.syncInputsFromPresentation()

        const result = compileProgramSnapshots(this.scenes, this.elements)
        this.snapshots = result.snapshots
        this.sceneIndexByScene = result.sceneIndexByScene
        this.sceneStateVersionSnapshot = result.sceneStateVersionSnapshot

        this.buildAdjacentPlans()

        this.cachedSceneCount = this.scenes.length
        this.cachedElementCount = this.elements.length
        this.dirty = false
    }

    buildAdjacentPlans() {
        const n = this.scenes.length
        this.forwardPlans = new Array(Math.max(0, n - 1))
        this.backwardPlans = new Array(Math.max(0, n - 1))

        for (let i = 0; i < n - 1; i += 1) {
            this.forwardPlans[i] = buildCompiledSceneChangePlan(this, i, i + 1, "forward")
        }

        for (let i = 1; i < n; i += 1) {
            this.backwardPlans[i - 1] = buildCompiledSceneChangePlan(this, i, i - 1, "backward")
        }
    }

    getSceneIndex(scene) {
        if (!scene) {
            return -1
        }
        const index = this.sceneIndexByScene.get(scene)
        return Number.isInteger(index) ? index : -1
    }

    getSnapshotByIndex(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.snapshots.length) {
            return null
        }
        return this.snapshots[index]
    }

    getAdjacentPlan(fromIndex, toIndex) {
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
            return null
        }

        if (toIndex === fromIndex + 1) {
            return this.forwardPlans[fromIndex] || null
        }

        if (toIndex === fromIndex - 1) {
            return this.backwardPlans[fromIndex - 1] || null
        }

        return null
    }

    buildPlan(fromIndex, toIndex, direction) {
        if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= this.scenes.length) {
            throw new Error("buildPlan: toIndex 无效")
        }

        const d = direction || (fromIndex != null && fromIndex > toIndex ? "backward" : "forward")
        return buildCompiledSceneChangePlan(this, fromIndex == null ? null : fromIndex, toIndex, d)
    }
}
