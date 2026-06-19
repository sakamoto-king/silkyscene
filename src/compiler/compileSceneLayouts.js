import { deepMerge } from "../utils/deepMerge.js"

/**
 * compileSceneLayouts（布局预编译）。
 *
 * 输入：已完成继承/覆盖/tombstone 的 resolved state/meta。
 * 输出：每个元素的 absolute 布局（left/top/width/height/anchorX/anchorY），统一使用百分比文本。
 *
 * 为什么要单独编译布局：
 * - parent 绑定、flow 布局属于“结构性语义”，不应在切场景瞬间实时演算。
 * - 编译后的布局可直接被 Renderer 做“百分比→像素”的最终换算。
 *
 * 当前支持能力：
 * 1) parent 绑定（子元素 left/top 视为相对父中心的偏移）
 * 2) flow(row/column + gap/align/justify) 对未显式定位子项做一次重排
 *
 * 重要限制：
 * - 若 child 的 state.layout 显式声明 left/top，则视为“手动定位”，flow 不再改写它。
 */

/**
 * 编译单个场景的绝对布局缓存。
 * 输出布局统一为 absolute 表达，运行时仅做百分比到像素转换。
 *
 * 当前支持：
 * 1) 场景级 parent 绑定
 * 2) parent.flow(row|column + gap + align + justify) 子项解算
 * 3) 绑定子项在绝对模式下相对父中心定位
 *
 * @param {Array<any>} elements
 * @param {Map<string, Object>} states - resolved state（已应用继承+remove+tombstone+显式覆盖）
 * @param {Map<string, Object>} meta - resolved meta
 * @returns {Map<string, Object>} elementId -> compiled absolute layout
 */
export function compileSceneLayouts(elements, states, meta) {
    const compiled = new Map()
    const elementById = new Map(elements.map((element) => [element.id, element]))
    const childrenByParent = new Map()

    for (const [elementId, stateMeta] of meta.entries()) {
        const parentBinding = stateMeta && stateMeta.parent
        if (!parentBinding || parentBinding.enabled === false) {
            continue
        }

        const parentId = parentBinding.targetId
        if (!parentId) {
            continue
        }

        if (!childrenByParent.has(parentId)) {
            childrenByParent.set(parentId, [])
        }
        childrenByParent.get(parentId).push(elementId)
    }

    const rootRect = {
        anchorXRatio: 0,
        anchorYRatio: 0,
        widthRatio: 1,
        heightRatio: 1,
        topLeftXRatio: 0,
        topLeftYRatio: 0,
    }

    const rectByElementId = new Map()

    const buildMergedLayout = (element, state) => {
        const elementLayout = (element && element.layout) || {}
        const stateLayout = (state && state.layout) || {}
        return {
            mode: stateLayout.mode || elementLayout.mode || "absolute",
            left: stateLayout.left ?? elementLayout.left ?? "0%",
            top: stateLayout.top ?? elementLayout.top ?? "0%",
            width: stateLayout.width ?? elementLayout.width ?? "auto",
            height: stateLayout.height ?? elementLayout.height ?? "auto",
            anchorX: stateLayout.anchorX ?? elementLayout.anchorX ?? 0,
            anchorY: stateLayout.anchorY ?? elementLayout.anchorY ?? 0,
            direction: stateLayout.direction ?? elementLayout.direction ?? "column",
            align: stateLayout.align ?? elementLayout.align ?? "start",
            justify: stateLayout.justify ?? elementLayout.justify ?? "start",
            gap: stateLayout.gap ?? elementLayout.gap ?? "0%",
        }
    }

    const ratioFromPercent = (value, fallbackRatio = 0) => {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value / 100
        }

        if (typeof value === "string") {
            const text = value.trim()
            if (!text || text === "auto") {
                return fallbackRatio
            }
            if (text.endsWith("%")) {
                const percent = Number.parseFloat(text)
                if (Number.isFinite(percent)) {
                    return percent / 100
                }
            }
            const numeric = Number(text)
            if (Number.isFinite(numeric)) {
                return numeric / 100
            }
        }

        return fallbackRatio
    }

    const percentText = (ratio) => `${(ratio * 100)
        .toFixed(4)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*?)0+$/, "$1")}%`

    const toCompiledLayout = (rect) => ({
        mode: "absolute",
        left: percentText(rect.anchorXRatio),
        top: percentText(rect.anchorYRatio),
        width: percentText(rect.widthRatio),
        height: percentText(rect.heightRatio),
        anchorX: rect.anchorX,
        anchorY: rect.anchorY,
    })

    const getRectByElementId = (elementId, stack = new Set()) => {
        if (rectByElementId.has(elementId)) {
            return rectByElementId.get(elementId)
        }

        if (stack.has(elementId)) {
            return null
        }

        const element = elementById.get(elementId)
        if (!element) {
            return null
        }

        const state = states.get(elementId)
        const layout = buildMergedLayout(element, state)
        const stateMeta = meta.get(elementId) || {}
        const parentBinding = stateMeta.parent

        let frameRect = rootRect
        if (parentBinding && parentBinding.enabled !== false && parentBinding.targetId) {
            stack.add(elementId)
            frameRect = getRectByElementId(parentBinding.targetId, stack) || rootRect
            stack.delete(elementId)
        }

        const parentWidth = frameRect.widthRatio
        const parentHeight = frameRect.heightRatio
        const parentCenterX = frameRect.anchorXRatio
        const parentCenterY = frameRect.anchorYRatio

        const widthRatio = ratioFromPercent(layout.width, 0) * parentWidth
        const heightRatio = ratioFromPercent(layout.height, 0) * parentHeight
        const anchorX = Number(layout.anchorX || 0)
        const anchorY = Number(layout.anchorY || 0)

        let anchorXRatio = ratioFromPercent(layout.left, 0)
        let anchorYRatio = ratioFromPercent(layout.top, 0)

        // parent 绑定下的绝对定位：left/top 作为相对父中心偏移。
        if (parentBinding && parentBinding.enabled !== false && parentBinding.targetId) {
            anchorXRatio = parentCenterX + anchorXRatio * parentWidth
            anchorYRatio = parentCenterY + anchorYRatio * parentHeight
        }

        const rect = {
            mode: layout.mode,
            direction: layout.direction,
            align: layout.align,
            justify: layout.justify,
            gap: layout.gap,
            anchorX,
            anchorY,
            widthRatio,
            heightRatio,
            anchorXRatio,
            anchorYRatio,
            topLeftXRatio: anchorXRatio - widthRatio * anchorX,
            topLeftYRatio: anchorYRatio - heightRatio * anchorY,
            hasExplicitPosition: Boolean(
                state &&
                state.layout &&
                (Object.prototype.hasOwnProperty.call(state.layout, "left") ||
                    Object.prototype.hasOwnProperty.call(state.layout, "top"))
            ),
        }

        rectByElementId.set(elementId, rect)
        return rect
    }

    for (const element of elements) {
        if (!states.has(element.id)) {
            continue
        }
        getRectByElementId(element.id)
    }

    // flow 容器对子项进行一次布局重排，输出绝对布局。
    for (const [parentId, childIds] of childrenByParent.entries()) {
        const parentRect = rectByElementId.get(parentId)
        if (!parentRect || parentRect.mode !== "flow") {
            continue
        }

        const direction = parentRect.direction === "row" ? "row" : "column"
        const gapRatio =
            ratioFromPercent(parentRect.gap, 0) *
            (direction === "row" ? parentRect.widthRatio : parentRect.heightRatio)
        const align = ["start", "center", "end"].includes(parentRect.align)
            ? parentRect.align
            : "start"
        const justify = ["start", "center", "end"].includes(parentRect.justify)
            ? parentRect.justify
            : "start"

        const flowChildren = childIds
            .map((id) => ({ id, rect: rectByElementId.get(id) }))
            .filter((item) => item.rect && !item.rect.hasExplicitPosition)

        if (!flowChildren.length) {
            continue
        }

        const totalMainSize =
            flowChildren.reduce((sum, item) => {
                return (
                    sum +
                    (direction === "row"
                        ? item.rect.widthRatio
                        : item.rect.heightRatio)
                )
            }, 0) +
            gapRatio * Math.max(0, flowChildren.length - 1)

        const parentMainSize =
            direction === "row" ? parentRect.widthRatio : parentRect.heightRatio
        const parentCrossSize =
            direction === "row" ? parentRect.heightRatio : parentRect.widthRatio

        let cursor = 0
        if (justify === "center") {
            cursor = (parentMainSize - totalMainSize) / 2
        } else if (justify === "end") {
            cursor = parentMainSize - totalMainSize
        }

        for (const item of flowChildren) {
            const childRect = item.rect
            const childMainSize =
                direction === "row" ? childRect.widthRatio : childRect.heightRatio
            const childCrossSize =
                direction === "row" ? childRect.heightRatio : childRect.widthRatio

            let crossStart = 0
            if (align === "center") {
                crossStart = (parentCrossSize - childCrossSize) / 2
            } else if (align === "end") {
                crossStart = parentCrossSize - childCrossSize
            }

            const mainStart = cursor
            const childTopLeftX =
                direction === "row"
                    ? parentRect.topLeftXRatio + mainStart
                    : parentRect.topLeftXRatio + crossStart
            const childTopLeftY =
                direction === "row"
                    ? parentRect.topLeftYRatio + crossStart
                    : parentRect.topLeftYRatio + mainStart

            childRect.topLeftXRatio = childTopLeftX
            childRect.topLeftYRatio = childTopLeftY
            childRect.anchorXRatio =
                childTopLeftX + childRect.widthRatio * childRect.anchorX
            childRect.anchorYRatio =
                childTopLeftY + childRect.heightRatio * childRect.anchorY

            cursor += childMainSize + gapRatio
        }
    }

    for (const [elementId, rect] of rectByElementId.entries()) {
        compiled.set(elementId, toCompiledLayout(rect))
    }

    return compiled
}

/**
 * 将 resolved state 应用 compiledLayout 覆盖，得到 renderable state。
 * @param {Object} resolvedState
 * @param {Object|null} compiledLayout
 * @returns {Object|null}
 */
export function buildRenderableState(resolvedState, compiledLayout) {
    if (!resolvedState) {
        return null
    }

    if (!compiledLayout) {
        return deepMerge({}, resolvedState)
    }

    const renderState = deepMerge({}, resolvedState)
    renderState.layout = deepMerge({}, compiledLayout)
    return renderState
}
