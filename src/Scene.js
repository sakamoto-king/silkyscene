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
    constructor(name) {
        this.name = name
        
        // 元素状态存储
        // 键为元素 ID，值为该元素在当前场景的状态
        this.states = {}
        
        // 元素 ID 列表，用于快速迭代顺序
        this.elementIds = []
    }

    /**
     * 为某个元素设置在当前场景的状态
     * @param {BaseElement} element - 元素实例
     * @param {Object} state - 状态对象 { layout, transform, opacity, visible, ... }
     */
    setState(element, state) {
        if (!element || !element.id) {
            throw new Error("元素必须有有效的 id")
        }
        this.states[element.id] = state
        if (!this.elementIds.includes(element.id)) {
            this.elementIds.push(element.id)
        }
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
     * 移除某个元素的状态
     * @param {BaseElement} element
     */
    removeState(element) {
        if (!element || !element.id) {
            return
        }
        delete this.states[element.id]
        this.elementIds = this.elementIds.filter(id => id !== element.id)
    }
}