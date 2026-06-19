/**
 * 直线元素（纯 DOM）。
 *
 * 使用两端点坐标定义线段，坐标可为像素值或百分比字符串（相对容器）。
 */
import { BaseElement } from "../core/BaseElement.js"
import { path } from "../render/primitives.js"

export class LineElement extends BaseElement {
    /**
     * @param {Object} options
     * @param {number|string} [options.x1=0] - 起点 X
     * @param {number|string} [options.y1=0] - 起点 Y
     * @param {number|string} [options.x2=0] - 终点 X
     * @param {number|string} [options.y2=0] - 终点 Y
     * @param {string} [options.strokeWidth="0.5%"] - 线宽（相对容器短边）
     * @param {string} [options.color="#fff"] - 线颜色
     * @param {string|null} [options.cornerRadius=null] - 线条圆角（相对容器短边），默认线宽一半
     */
    constructor(options = {}) {
        super(options)
        this.type = "line"

        this.x1 = options.x1 ?? 0
        this.y1 = options.y1 ?? 0
        this.x2 = options.x2 ?? 0
        this.y2 = options.y2 ?? 0
        this.strokeWidth = options.strokeWidth ?? "0.5%"
        this.color = options.color || "#fff"
        this.cornerRadius = options.cornerRadius ?? null
    }

    lowerToPrimitives(renderableState, meta, context = {}) {
        const state = renderableState || {}
        const lineState = (state && state.line) || {}

        const visible = state.visible !== false && this.visible !== false
        const opacityValue = state.opacity ?? this.opacity ?? 1
        const opacityNumber = Number(opacityValue)
        const opacity = visible ? opacityValue : 0
        const pointerEvents =
            visible && Number.isFinite(opacityNumber) && opacityNumber > 0 ? "auto" : "none"

        const x1 = lineState.x1 ?? this.x1 ?? 0
        const y1 = lineState.y1 ?? this.y1 ?? 0
        const x2 = lineState.x2 ?? this.x2 ?? 0
        const y2 = lineState.y2 ?? this.y2 ?? 0

        const strokeWidth = lineState.strokeWidth ?? this.strokeWidth ?? "0.5%"
        const stroke = lineState.color ?? this.color ?? "#fff"
        const cornerRadius = lineState.cornerRadius ?? this.cornerRadius ?? null

        return path(this.id, {
            // Line/Arrow 的端点语义是“相对容器坐标系”，与 layout 无关；固定占满容器。
            layout: {
                mode: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                anchorX: 0,
                anchorY: 0,
            },
            transform: state.transform ?? this.transform ?? null,
            style: {
                opacity,
                zIndex: state.zIndex ?? this.zIndex ?? 0,
                pointerEvents,
            },
            props: {
                fill: "none",
                stroke: String(stroke),
                strokeWidth,
                cornerRadius,
                commands: [
                    { type: "moveTo", x: x1, y: y1 },
                    { type: "lineTo", x: x2, y: y2 },
                ],
            },
        })
    }
}
