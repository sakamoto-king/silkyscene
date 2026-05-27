/**
 * 图形元素。
 *
 * 用于矩形、圆形、箭头等基础图形的渲染，可继续扩展矢量形状。
 */
import { BaseElement } from "../BaseElement.js"

export class ShapeElement extends BaseElement {
    /**
     * @param {Object} options
     * @param {string} [options.shapeType="rect"] - 形状类型 (rect|circle|path)
     * @param {string} [options.fill="#000"] - 填充颜色
     * @param {string} [options.stroke="none"] - 描边颜色
     * @param {number} [options.strokeWidth=1] - 描边宽度
     * @param {number} [options.cornerRadius=0] - 圆角半径
     */
    constructor(options = {}) {
        super(options)
        this.type = "shape"
        
        // 图形特定属性
        this.shapeType = options.shapeType || "rect"
        this.fill = options.fill || "#000"
        this.stroke = options.stroke || "none"
        this.strokeWidth = options.strokeWidth || 1
        this.cornerRadius = options.cornerRadius || 0
    }
}
