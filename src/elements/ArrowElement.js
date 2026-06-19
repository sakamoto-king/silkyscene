/**
 * 箭头元素（纯 DOM 组合元素）。
 *
 * 箭头由父容器 + 3 条子线段构成：主干、上斜线、下斜线。
 * 该结构用于验证组合元素/嵌套渲染链路。
 */
import { LineElement } from "./LineElement.js"
import { group, path } from "../render/primitives.js"

export class ArrowElement extends LineElement {
    /**
     * @param {Object} options
     * @param {number|string} [options.x1=0] - 起点 X
     * @param {number|string} [options.y1=0] - 起点 Y
     * @param {number|string} [options.x2=0] - 终点 X
     * @param {number|string} [options.y2=0] - 终点 Y
     * @param {string} [options.strokeWidth="0.5%"] - 线宽（相对容器短边）
     * @param {string} [options.color="#fff"] - 颜色
     * @param {string} [options.arrowSize="2.8%"] - 箭头长度（相对容器短边）
     * @param {string} [options.arrowWidth="1.8%"] - 箭头宽度（相对容器短边）
     */
    constructor(options = {}) {
        super(options)
        this.type = "arrow"
        this.arrowSize = options.arrowSize ?? "2.8%"
        this.arrowWidth = options.arrowWidth ?? "1.8%"

        // 内部 3 段线：主干 + 箭头两翼
        this.shaft = new LineElement({ strokeWidth: this.strokeWidth, color: this.color })
        this.headA = new LineElement({ strokeWidth: this.strokeWidth, color: this.color })
        this.headB = new LineElement({ strokeWidth: this.strokeWidth, color: this.color })

        // 注意：内部三段线是 ArrowElement 的“渲染实现细节”，不是元素层级关系。
        // 元素之间的父子关系应由 Scene 的 stateMeta.parent 表达。
    }

    lowerToPrimitives(renderableState, meta, context = {}) {
        const state = renderableState || {}
        const lineState = (state && state.line) || {}
        const arrowState = (state && state.arrow) || {}

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

        const arrowSize = arrowState.size ?? this.arrowSize ?? "2.8%"
        const arrowWidth = arrowState.width ?? this.arrowWidth ?? "1.8%"

        const baseLayout = {
            mode: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            anchorX: 0,
            anchorY: 0,
        }

        return group(this.id, {
            layout: baseLayout,
            transform: state.transform ?? this.transform ?? null,
            style: {
                opacity,
                zIndex: state.zIndex ?? this.zIndex ?? 0,
                pointerEvents,
            },
            props: {
                // 便于调试/排查：保留原始语义输入（仍属于 Definition）。
                __arrow: {
                    x1,
                    y1,
                    x2,
                    y2,
                    strokeWidth,
                    stroke,
                    cornerRadius,
                    arrowSize,
                    arrowWidth,
                },
            },
        }, [
            // 主干：可以直接表达为 Path.commands
            path(`${this.id}/shaft`, {
                layout: baseLayout,
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
            }),

            // 两翼：需要依赖 (x1,y1,x2,y2)+(arrowSize,arrowWidth) 的几何推导。
            // 为保证 Renderer 不理解 ArrowElement，我们在这里输出“参数化 builtin”，
            // 后续由 Resolve 阶段统一展开为真实 commands（全为 number）。
            path(`${this.id}/headA`, {
                layout: baseLayout,
                props: {
                    fill: "none",
                    stroke: String(stroke),
                    strokeWidth,
                    cornerRadius,
                    builtin: "arrowHead",
                    part: "A",
                    x1,
                    y1,
                    x2,
                    y2,
                    arrowSize,
                    arrowWidth,
                },
            }),
            path(`${this.id}/headB`, {
                layout: baseLayout,
                props: {
                    fill: "none",
                    stroke: String(stroke),
                    strokeWidth,
                    cornerRadius,
                    builtin: "arrowHead",
                    part: "B",
                    x1,
                    y1,
                    x2,
                    y2,
                    arrowSize,
                    arrowWidth,
                },
            }),
        ])
    }
}
