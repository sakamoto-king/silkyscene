/**
 * 箭头元素（纯 DOM 组合元素）。
 *
 * 箭头由父容器 + 3 条子线段构成：主干、上斜线、下斜线。
 * 该结构用于验证组合元素/嵌套渲染链路。
 */
import { LineElement } from "./LineElement.js"

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

        this.addChild(this.shaft)
        this.addChild(this.headA)
        this.addChild(this.headB)
    }
}
