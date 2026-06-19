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

        // 第二层：层级结构（已移除）
        // 约定：元素之间的“父子关系/参考系绑定”属于 Scene 的状态语义（stateMeta.parent），
        // 不应存储在 BaseElement 实例内部，避免数据源重复与状态不一致。

        // 第三层：布局数据（用户定义）
        // mode: "relative" | "absolute" | "flex" 等
        // left/top/width/height：可以是像素、百分比或 "auto"
        // anchorX/anchorY：0-1 范围，旋转与缩放的锚点
        this.layout = options.layout || {
            mode: "absolute",
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
     * Lowering：把“业务 Element”下沉为“基础图元树（PrimitiveRenderSpec RenderTree）”。
     *
     * 约束：
     * - 返回值只能包含 Primitive kind（Group/Text/Image/Shape/Path/Video）。
     * - 允许输出 Definition（包含 % 等相对值）；这些相对值必须在后续 Resolve 阶段解算。
     * - Renderer 不应理解具体 element.type，只应调用此接口并消费基础图元。
     *
     * @param {Object|null} renderableState - 编译后的渲染态（含 compiled layout 覆盖）
     * @param {Object|null} meta - 编译后的 meta（delay/entrance/parent/flow 等）
     * @param {Object} context
     * @returns {Object|null} PrimitiveRenderSpec node
     */
    lowerToPrimitives(renderableState, meta, context = {}) {
        throw new Error(
            `Element(${this.type || "element"}) 未实现 lowerToPrimitives；Renderer 不应再理解 element.type 分支`
        )
    }
}
