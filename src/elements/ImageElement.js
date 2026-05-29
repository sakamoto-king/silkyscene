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
     * @param {string} [options.alt=""] - 图片替代文本
     * @param {number} [options.cropX=0] - 裁切 X 偏移
     * @param {number} [options.cropY=0] - 裁切 Y 偏移
     * @param {number} [options.cropWidth=null] - 裁切宽度
     * @param {number} [options.cropHeight=null] - 裁切高度
     *
     * Scene 子状态扩展（通过 scene.setState 的 state.image 提供）：
     * - image.crop: { scale, offsetX, offsetY }
    * - image.highlight: { stage, progress, opacity, x, y, width, height, radius }
     * - image.filter: { dimBrightness }
     */
    constructor(options = {}) {
        super(options)
        this.type = "image"
        
        // 图片特定属性
        this.src = options.src || ""
        this.alt = options.alt || ""
        this.fit = options.fit || "cover"
        this.cropX = options.cropX || 0
        this.cropY = options.cropY || 0
        this.cropWidth = options.cropWidth || null
        this.cropHeight = options.cropHeight || null
    }
}
