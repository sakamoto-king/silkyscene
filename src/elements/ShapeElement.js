/**
 * 图形元素。
 *
 * 用于矩形、圆形、箭头等基础图形的渲染，可继续扩展矢量形状。
 */
import { BaseElement } from "../core/BaseElement.js"
import { shape } from "../render/primitives.js"

export class ShapeElement extends BaseElement {
    /**
     * @param {Object} options
    * @param {string} [options.shapeType="rect"] - 形状类型 (rect|circle|path)
     * @param {string} [options.fill="#000"] - 填充颜色
     * @param {string} [options.stroke="none"] - 描边颜色
     * @param {string} [options.strokeWidth="0.3%"] - 描边宽度（相对容器短边）
    * @param {string} [options.cornerRadius="0%"] - 圆角半径（相对容器短边）；circle 会忽略此字段并自动使用最大圆角
     */
    constructor(options = {}) {
        super(options)
        this.type = "shape"

        // 图形特定属性
        this.shapeType = options.shapeType || "rect"
        this.fill = options.fill || "#000"
        this.stroke = options.stroke || "none"
        this.strokeWidth = options.strokeWidth || "0.3%"
        this.cornerRadius = options.cornerRadius || "0%"
    }

    lowerToPrimitives(renderableState, meta, context = {}) {
        const state = renderableState || {}
        const shapeState = (state && state.shape) || {}

        const visible = state.visible !== false && this.visible !== false
        const opacityValue = state.opacity ?? this.opacity ?? 1
        const opacityNumber = Number(opacityValue)
        const opacity = visible ? opacityValue : 0
        const pointerEvents =
            visible && Number.isFinite(opacityNumber) && opacityNumber > 0 ? "auto" : "none"

        const shapeType = shapeState.shapeType ?? this.shapeType ?? "rect"
        const fill = shapeState.fill ?? this.fill ?? "#000"
        const stroke = shapeState.stroke ?? this.stroke ?? "none"
        const strokeWidth = shapeState.strokeWidth ?? this.strokeWidth ?? "0.3%"

        return shape(this.id, {
            layout: state.layout ?? this.layout ?? null,
            transform: state.transform ?? this.transform ?? null,
            style: {
                opacity,
                zIndex: state.zIndex ?? this.zIndex ?? 0,
                pointerEvents,
            },
            props: {
                shapeType: String(shapeType),
                fill: String(fill),
                stroke: String(stroke),
                strokeWidth,
                radius: shapeState.cornerRadius ?? this.cornerRadius ?? "0%",
            },
        })
    }
}
