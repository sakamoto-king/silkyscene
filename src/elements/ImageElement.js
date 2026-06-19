/**
 * 图片元素。
 *
 * 用于图片、插图、背景、图标等内容的渲染与缩放裁切。
 */
import { BaseElement } from "../core/BaseElement.js"
import { image } from "../render/primitives.js"

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

    lowerToPrimitives(renderableState, meta, context = {}) {
        const state = renderableState || {}
        const imageState = (state && state.image) || {}

        const visible = state.visible !== false && this.visible !== false
        const opacityValue = state.opacity ?? this.opacity ?? 1
        const opacityNumber = Number(opacityValue)
        const opacity = visible ? opacityValue : 0
        const pointerEvents =
            visible && Number.isFinite(opacityNumber) && opacityNumber > 0 ? "auto" : "none"

        const fit = imageState.fit ?? this.objectFit ?? this.fit ?? "cover"

        return image(this.id, {
            layout: state.layout ?? this.layout ?? null,
            transform: state.transform ?? this.transform ?? null,
            style: {
                opacity,
                zIndex: state.zIndex ?? this.zIndex ?? 0,
                pointerEvents,
            },
            props: {
                src: String(this.src || ""),
                alt: String(this.alt || ""),
                fit: String(fit),
                crop: imageState.crop ?? null,
                highlight: imageState.highlight ?? null,
                filter: imageState.filter ?? null,
            },
        })
    }
}
