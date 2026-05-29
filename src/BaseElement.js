let ELEMENT_ID_COUNTER = 0
const ELEMENT_ID_SEED = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

function createElementId() {
    ELEMENT_ID_COUNTER += 1
    return `elem_${ELEMENT_ID_SEED}_${ELEMENT_ID_COUNTER.toString(36)}`
}

/**
 * 元素基类。
 *
 * 所有可渲染对象的基础类，定义运行时布局对象的核心结构。
 * Element 是独立的空间对象数据表示，不包含 DOM 操作逻辑。
 */
export class BaseElement {
    /**
     * @param {Object} options
     * @param {string} [options.name] - 元素名称
     * @param {string} [options.type="element"] - 元素类型
     */
    constructor(options = {}) {
        // 第一层：基础信息
        Object.defineProperty(this, "id", {
            value: createElementId(),
            writable: false,
            configurable: false,
            enumerable: true,
        })
        this.name = options.name || ""
        this.type = options.type || "element"
        this.visible = options.visible !== undefined ? options.visible : true
        this.locked = options.locked || false

        // 第二层：层级结构
        this.parent = null
        this.children = []

        // 第三层：布局数据（用户定义）
        // mode: "relative" | "absolute" | "flex" 等
        // left/top/width/height：可以是像素、百分比或 "auto"
        // anchorX/anchorY：0-1 范围，旋转与缩放的锚点
        this.layout = options.layout || {
            mode: "relative",
            left: 0,
            top: 0,
            width: "auto",
            height: "auto",
            anchorX: 0,
            anchorY: 0,
        }

        // 第四层：变换数据
        // 与平台无关，支持 Canvas、SVG、WebGL 等多平台使用
        this.transform = options.transform || {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
        }

        // 第五层：视觉属性
        this.opacity = options.opacity !== undefined ? options.opacity : 1
        this.zIndex = options.zIndex || 0
        this.blendMode = options.blendMode || "normal"

        // 第六层：计算结果（由 Renderer 赋值）
        // Element 本身只包含声明式布局与变换数据
        // 最终的绝对坐标由 Renderer 计算后存放在此
        this.computed = {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        }

        // 第七层：运行时状态
        // dirty 标志用于驱动增量计算与渲染
        this.dirty = true
    }

    /**
     * 将子元素添加到当前元素
     * @param {BaseElement} child
     */
    addChild(child) {
        if (!child || !(child instanceof BaseElement)) {
            throw new Error("只能添加 BaseElement 实例作为子元素")
        }
        if (child.parent) {
            child.parent.removeChild(child)
        }
        child.parent = this
        this.children.push(child)
        this.markDirty()
    }

    /**
     * 从当前元素移除子元素
     * @param {BaseElement} child
     */
    removeChild(child) {
        const index = this.children.indexOf(child)
        if (index !== -1) {
            this.children.splice(index, 1)
            child.parent = null
            this.markDirty()
        }
    }

    /**
     * 标记元素及其父级为脏状态，触发重新计算
     */
    markDirty() {
        this.dirty = true
        if (this.parent) {
            this.parent.markDirty()
        }
    }
}
