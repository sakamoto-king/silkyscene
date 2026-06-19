import { TextElement } from "./TextElement.js"
import { ImageElement } from "./ImageElement.js"
import { ShapeElement } from "./ShapeElement.js"
import { LineElement } from "./LineElement.js"
import { ArrowElement } from "./ArrowElement.js"

/**
 * 根据类型字符串创建元素实例。
 * 该方法用于在多个模块间复用（例如 SceneIO、Presentation 批量创建）。
 *
 * @param {string} type - 元素类型
 * @param {Object} options - 元素配置
 * @returns {import("../core/BaseElement.js").BaseElement|null}
 */
export function createElementByType(type, options) {
    switch (type) {
        case "text":
            return new TextElement(options)
        case "image":
            return new ImageElement(options)
        case "shape":
            return new ShapeElement(options)
        case "line":
            return new LineElement(options)
        case "arrow":
            return new ArrowElement(options)
        default:
            return null
    }
}
