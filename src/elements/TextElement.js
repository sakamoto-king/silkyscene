/**
 * 文本元素。
 *
 * 用于标题、段落、标签等文本内容的渲染与状态切换。
 */
import { BaseElement } from "../BaseElement.js"

export class TextElement extends BaseElement {
    /**
     * @param {Object} options
     * @param {string} [options.text=""] - 文本内容
     * @param {number} [options.fontSize=16] - 字体大小
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
        this.fontSize = options.fontSize || 16
        this.fontFamily = options.fontFamily || "Arial"
        this.color = options.color || "#000"
        this.textAlign = options.textAlign || "left"
        this.lineHeight = options.lineHeight || 1.5
    }
}
