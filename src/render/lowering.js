/**
 * Lowering（Element -> PrimitiveRenderSpec RenderTree）。
 *
 * 口径：
 * - Lowering 逻辑尽量下沉到各 Element 内部：Element.lowerToPrimitives(...)。
 * - Renderer 不理解 Arrow/Image/Text 等业务 Element 结构；它只消费基础图元树。
 * - 本模块只负责聚合与校验（确保输出只包含基础图元 kind）。
 */

import { PrimitiveKind } from "./primitives.js"

const ALLOWED_KINDS = new Set(Object.values(PrimitiveKind))

function assertPrimitiveNode(node) {
    if (!node || typeof node !== "object") {
        throw new Error("Lowering: primitive 节点不能为空")
    }

    if (!node.nodeId) {
        throw new Error("Lowering: primitive.nodeId 不能为空")
    }

    if (!ALLOWED_KINDS.has(node.kind)) {
        throw new Error(`Lowering: 输出包含非法 kind: ${String(node.kind)}`)
    }

    if (node.children != null && !Array.isArray(node.children)) {
        throw new Error("Lowering: primitive.children 必须是数组")
    }

    if (Array.isArray(node.children)) {
        for (const child of node.children) {
            assertPrimitiveNode(child)
        }
    }
}

/**
 * Lower 单个 Element。
 * @param {any} element
 * @param {Object|null} renderableState
 * @param {Object|null} meta
 * @param {Object} context
 * @returns {Object|null}
 */
export function lowerElement(element, renderableState, meta, context = {}) {
    if (!element || typeof element.lowerToPrimitives !== "function") {
        throw new Error("Lowering: element.lowerToPrimitives 不存在")
    }

    const tree = element.lowerToPrimitives(renderableState, meta, context)
    if (tree == null) {
        return null
    }

    assertPrimitiveNode(tree)
    return tree
}

/**
 * Lower 一个场景快照：聚合成“forest”。
 * 说明：返回数组，而不是强行塞一个 root group；root 的存在与否属于 Renderer/Backend 选择。
 *
 * @param {Array<any>} elements
 * @param {Map<string, Object>} renderableStatesById
 * @param {Map<string, Object>} metaById
 * @param {Object} context
 * @returns {Array<Object>} primitive trees
 */
export function lowerSnapshotForest(elements, renderableStatesById, metaById, context = {}) {
    const list = []

    for (const element of elements || []) {
        const state = renderableStatesById ? (renderableStatesById.get(element.id) || null) : null
        const meta = metaById ? (metaById.get(element.id) || null) : null

        if (!state || state.visible === false) {
            continue
        }

        const tree = lowerElement(element, state, meta, context)
        if (tree) {
            list.push(tree)
        }
    }

    return list
}

export const __testing = {
    assertPrimitiveNode,
}
