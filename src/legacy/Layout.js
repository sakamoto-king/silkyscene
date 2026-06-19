/**
 * @deprecated
 * 这是旧版 DOM 渲染路径（Renderer/Layout）的布局解算器，仅用于兼容现有运行逻辑。
 */

/**
 * Layout（布局解算器 / 纯计算）。
 *
 * Layout 的核心定位：
 * - 将“相对布局描述（百分比/auto）”解算为“绝对像素坐标”，供 Renderer 输出到 DOM。
 * - 自身保持纯计算：不触碰 DOM、不持有缓存、不做动画插值。
 *
 * 职责
 * - 解析 left/top/width/height 等布局字段（百分比 → 像素）。
 * - 处理最小必要的布局解算规则（本文件当前为最小实现）。
 *
 * 不做的事
 * - 不做动画插值（由 Renderer/CSS transition 负责）。
 * - 不写 DOM 样式（由 Renderer 负责）。
 * - 不负责容器尺寸准备（由 Presentation.ensureContentRectReady 兜底）。
 *
 * 失败模式（常见症状）
 * - containerWidth/Height 为 0 时，百分比换算退化为 0，导致 (0,0) 或尺寸为 0。
 *
 * 性能注意
 * - 本模块本身无副作用；性能瓶颈通常来自调用方触发的 reflow 或遍历规模。
 */
export class Layout {
    /**
     * 解析 Element 的布局，计算绝对坐标
     * @param {BaseElement} element - 元素，包含 layout、parent、computed
     * @param {Object} sceneState - 该元素在当前 Scene 中的状态覆盖
     * @returns {Object} 计算后的 { x, y, width, height }
     */
    static resolve(element, sceneState, context = {}) {
        const mergedLayout =
            (context && context.layout) ||
            {
                ...(element.layout || {}),
                ...((sceneState && sceneState.layout) || {}),
            }

        const containerWidth = Number(context.containerWidth || 0)
        const containerHeight = Number(context.containerHeight || 0)

        const x = Layout.toPixels(mergedLayout.left, containerWidth)
        const y = Layout.toPixels(mergedLayout.top, containerHeight)

        return {
            x,
            y,
            width: Layout.toPixels(mergedLayout.width, containerWidth),
            height: Layout.toPixels(mergedLayout.height, containerHeight),
        }
    }

    /**
     * 将百分比或数值转换为像素。
     * @param {number|string} value
     * @param {number} total
     * @returns {number}
     */
    static toPixels(value, total) {
        if (typeof value === "number") {
            return value
        }

        if (typeof value === "string") {
            const text = value.trim()

            if (!text || text === "auto") {
                return 0
            }

            if (text.endsWith("%")) {
                const percent = Number.parseFloat(text)
                if (Number.isFinite(percent)) {
                    return (percent / 100) * total
                }
            }

            const numeric = Number(text)
            if (Number.isFinite(numeric)) {
                return numeric
            }
        }

        return 0
    }
}

