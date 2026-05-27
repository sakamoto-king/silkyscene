/**
 * 演示文稿实例。
 * 
 * Presentation 管理元素生命周期、场景编排与演示状态。
 * 不负责布局计算或容器尺寸监听，由应用层控制容器样式。
 */
export class Presentation {
    /**
     * @param {Object} options
     * @param {HTMLElement|string} options.container - 挂载容器元素或选择器
     * @param {string} [options.background="#000"] - 背景颜色
     */
    constructor(options) {
        if (!options || !options.container) {
            throw new Error("Presentation 需要提供有效的容器元素或选择器")
        }

        // 支持传递 HTMLElement 或选择器字符串
        if (typeof options.container === "string") {
            this.container = document.querySelector(options.container)
            if (!this.container) {
                throw new Error(`未找到与选择器 "${options.container}" 匹配的元素`)
            }
        } else if (options.container instanceof HTMLElement) {
            this.container = options.container
        } else {
            throw new Error("container 必须是 HTMLElement 或选择器字符串")
        }

        // 渲染根容器
        this.content = document.createElement("div")

        // 背景颜色
        this.background = options.background || "#000"

        // 元素池
        this.elements = []

        // 场景列表
        this.scenes = []

        // 当前活跃的场景
        this.currentScene = null
    }

    /**
     * 初始化容器与画布样式
     */
    initContainerStyle() {
        this.container.style.position = this.container.style.position || "relative"
        this.container.style.overflow = "hidden"

        Object.assign(this.content.style, {
            backgroundColor: this.background,
            width: "100%",
            height: "100%",
            position: "relative",
            overflow: "hidden",
        })
    }

    /**
     * 挂载演示文稿到容器
     */
    mount() {
        console.log("Presentation 已挂载到容器", this.container)

        this.initContainerStyle()

        if (!this.content.parentNode) {
            this.container.appendChild(this.content)
        }
    }

    /**
     * 卸载演示文稿，释放资源
     */
    unmount() {
        this.currentScene = null
        if (this.content.parentNode) {
            this.content.parentNode.removeChild(this.content)
        }
    }

    /**
     * 添加元素到演示
     * @param {BaseElement} element
     */
    addElement(element) {
        if (!element || typeof element.id === "undefined") {
            throw new Error("元素必须是有效的 BaseElement 实例，且包含 id")
        }
        this.elements.push(element)
    }

    /**
     * 移除演示中的元素
     * @param {BaseElement} element
     */
    removeElement(element) {
        const index = this.elements.indexOf(element)
        if (index !== -1) {
            this.elements.splice(index, 1)
        }
    }

    /**
     * 添加场景
     * @param {Scene} scene
     */
    addScene(scene) {
        if (!scene || typeof scene.name === "undefined") {
            throw new Error("场景必须是有效的 Scene 实例")
        }
        this.scenes.push(scene)
    }

    /**
     * 切换到指定场景，触发布局计算与动画
     * @param {Scene} scene
     */
    setScene(scene) {
        if (this.scenes.indexOf(scene) === -1) {
            throw new Error("指定的场景不属于此演示")
        }
        this.currentScene = scene
        // 触发布局计算：Renderer 应该在此时读取新场景状态并计算布局
        // 具体的动画插值与渲染在 Renderer 层实现
        this.onSceneChanged(scene)
    }

    /**
     * 场景变化回调
     * 应用层或 Renderer 可以在此处理布局计算与动画启动
     * @param {Scene} scene
     */
    onSceneChanged(scene) {
        // 钩子方法，单独实现或通过事件系统扩展
    }
}