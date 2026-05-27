/**
 * 图片元素。
 *
 * 用于图片、插图、背景、图标等内容的渲染与缩放裁切。
 */
import { BaseElement } from "../BaseElement.js"

export class ImageElement extends BaseElement {
    /**
     * @param {Object} options
     * @param {string} [options.src=""] - 图片源 URL
     * @param {string} [options.fit="cover"] - 缩放模式 (cover|contain|fill)
     * @param {number} [options.cropX=0] - 裁切 X 偏移
     * @param {number} [options.cropY=0] - 裁切 Y 偏移
     * @param {number} [options.cropWidth=null] - 裁切宽度
     * @param {number} [options.cropHeight=null] - 裁切高度
     */
    constructor(options = {}) {
        super(options)
        this.type = "image"
        
        // 图片特定属性
        this.src = options.src || ""
        this.fit = options.fit || "cover"
        this.cropX = options.cropX || 0
        this.cropY = options.cropY || 0
        this.cropWidth = options.cropWidth || null
        this.cropHeight = options.cropHeight || null
    }
}
