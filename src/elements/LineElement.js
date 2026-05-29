/**
 * 直线元素（纯 DOM）。
 *
 * 使用两端点坐标定义线段，坐标可为像素值或百分比字符串（相对容器）。
 */
import { BaseElement } from "../BaseElement.js"

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
}
