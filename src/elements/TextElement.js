/**
 * 文本元素。
 *
 * 用于标题、段落、标签等文本内容的渲染与状态切换。
 */
import { BaseElement } from "../core/BaseElement.js"
import { text } from "../render/primitives.js"

export class TextElement extends BaseElement {
    /**
     * @param {Object} options
     * @param {string} [options.text=""] - 文本内容
        * @param {string} [options.fontSize="2.2%"] - 字体大小（相对容器短边）
     * @param {string} [options.fontFamily="Arial"] - 字体族
     * @param {string} [options.color="#000"] - 文本颜色
     * @param {string} [options.textAlign="left"] - 文本对齐方式
     * @param {number} [options.lineHeight=1.5] - 行高
     */
    constructor(options = {}) {
        super(options)
        this.type = "text"

        // 文本特定属性
        this.text = options.text || ""
        this.fontSize = options.fontSize || "2.2%"
        this.fontFamily = options.fontFamily || "Arial"
        this.color = options.color || "#000"
        this.textAlign = options.textAlign || "left"
        this.lineHeight = options.lineHeight || 1.5
    }

    lowerToPrimitives(renderableState, meta, context = {}) {
        const state = renderableState || {}
        const textState = (state && state.text) || {}

        const visible = state.visible !== false && this.visible !== false
        const opacityValue = state.opacity ?? this.opacity ?? 1
        const opacityNumber = Number(opacityValue)
        const opacity = visible ? opacityValue : 0
        const pointerEvents =
            visible && Number.isFinite(opacityNumber) && opacityNumber > 0 ? "auto" : "none"

        const fontSizeValue =
            textState.fontSize ?? state.fontSize ?? this.fontSize ?? "2.2%"
        const colorValue = textState.color ?? state.color ?? this.color ?? "#000"

        return text(this.id, {
            layout: state.layout ?? this.layout ?? null,
            transform: state.transform ?? this.transform ?? null,
            style: {
                opacity,
                zIndex: state.zIndex ?? this.zIndex ?? 0,
                pointerEvents,
            },
            props: {
                text: String(this.text || ""),
                fontSize: fontSizeValue,
                color: String(colorValue),
                textAlign: String(this.textAlign || "left"),
                lineHeight: Number(this.lineHeight || 1.5),
                fontFamily: String(this.fontFamily || "Arial"),
            },
        })
    }
}
