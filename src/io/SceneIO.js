import { deepMerge } from "../utils/deepMerge.js"
import { Presentation } from "../core/Presentation.js"
import { Scene } from "../core/Scene.js"
import { createElementByType } from "../elements/createElementByType.js"

/**
 * 场景工程导入导出（源码 JSON 形态）。
 *
 * SceneIO 负责将 Presentation 序列化为可读的 JSON 源码格式，以及从 JSON 还原 Presentation。
 * 主要用于场景工程的持久化、版本控制、跨项目迁移等场景。
 */
export class SceneIO {
    /**
     * 导出源码 JSON。
     *
     * 将 Presentation 及其所有元素、场景、状态序列化为源码 JSON 格式。
     * 导出的 JSON 可直接存储、传输或版本控制。
     *
     * @param {Presentation} presentation - 待导出的演示实例
     * @returns {Object} 源码 JSON 对象
     */
    static exportSource(presentation) {
        if (!presentation || !Array.isArray(presentation.elements) || !Array.isArray(presentation.scenes)) {
            throw new Error("exportSource 需要有效的 Presentation 实例")
        }

        // 建立元素 ID 到符号引用的映射（如 e1, e2, e3...）
        // 用于在 JSON 中使用简短的引用代替长 ID
        const elementRefs = new Map()
        const idToRef = new Map()
        const elements = presentation.elements.map((element, index) => {
            const ref = `e${index + 1}`
            elementRefs.set(ref, element)
            idToRef.set(element.id, ref)
            return {
                ref,
                type: element.type,
                options: this.serializeElementOptions(element),
            }
        })

        // 序列化所有场景
        const scenes = presentation.scenes.map((scene) => {
            const states = {}
            const removed = []

            // 遍历所有元素，收集状态和元数据
            for (const element of presentation.elements) {
                const ref = idToRef.get(element.id)
                const state = scene.getState(element)
                const meta = scene.getStateMeta(element)

                // 仅序列化有状态或元数据的元素
                if (state || (meta && Object.keys(meta).length > 0)) {
                    states[ref] = {
                        state: state ? this.cloneObject(state) : {},
                        meta: this.serializeStateMeta(meta, idToRef),
                    }
                }

                // 记录被标记为移除的元素
                if (scene.isStateRemoved(element)) {
                    removed.push(ref)
                }
            }

            return {
                name: scene.name,
                transition: scene.getTransition(),
                states,
                removed,
            }
        })

        // 返回完整的源码 JSON 结构
        return {
            schemaVersion: "2.0.0-alpha",
            kind: "@silkysite/scene-source",
            presentation: {
                options: this.serializePresentationOptions(presentation),
            },
            elements,
            scenes,
        }
    }

    /**
     * 从源码 JSON 导入并创建 Presentation。
     *
     * 根据 exportSource 导出的 JSON 结构，还原完整的 Presentation 实例。
     * 会自动重建所有元素、场景、状态及父子绑定关系。
     *
     * @param {HTMLElement|string} container - 演示容器（DOM 元素或选择器）
     * @param {Object} source - 源码 JSON 对象
     * @returns {Presentation} 还原的演示实例
     */
    static importSource(container, source) {
        if (!source || typeof source !== "object") {
            throw new Error("importSource 需要有效的源码对象")
        }

        // 提取演示配置
        const presentationOptions =
            source.presentation && source.presentation.options
                ? this.cloneObject(source.presentation.options)
                : {}

        const presentation = new Presentation(container, presentationOptions)
        const refToElement = new Map() // 符号引用到元素实例的映射

        // 还原所有元素
        const elements = Array.isArray(source.elements) ? source.elements : []
        for (const item of elements) {
            const ref = String(item && item.ref ? item.ref : "").trim()
            const type = String(item && item.type ? item.type : "").trim()
            const options = this.cloneObject((item && item.options) || {})

            if (!ref || !type) {
                continue
            }

            const element = this.createElementByType(type, options)
            if (!element) {
                continue
            }

            presentation.addElement(element)
            refToElement.set(ref, element)
        }

        // 还原所有场景及其状态
        const scenes = Array.isArray(source.scenes) ? source.scenes : []
        for (const sceneData of scenes) {
            const sceneName = String(sceneData && sceneData.name ? sceneData.name : "").trim() || "scene"
            const scene = new Scene(sceneName, {
                transition: this.cloneObject((sceneData && sceneData.transition) || null),
            })

            // 还原元素状态
            const stateEntries = sceneData && sceneData.states ? sceneData.states : {}
            for (const ref of Object.keys(stateEntries)) {
                const element = refToElement.get(ref)
                if (!element) {
                    continue
                }

                const entry = stateEntries[ref] || {}
                const state = this.cloneObject(entry.state || {})
                const options = this.deserializeStateMeta(entry.meta, refToElement)
                scene.setState(element, state, options)
            }

            // 还原移除标记
            const removed = Array.isArray(sceneData && sceneData.removed)
                ? sceneData.removed
                : []
            for (const ref of removed) {
                const element = refToElement.get(ref)
                if (!element) {
                    continue
                }
                scene.removeState(element)
            }

            presentation.addScene(scene)
        }

        return presentation
    }

    /**
     * 序列化 Presentation 配置。
     * @param {Presentation} presentation
     * @returns {Object}
     */
    static serializePresentationOptions(presentation) {
        return {
            container: this.cloneObject(presentation.options && presentation.options.container),
            content: this.cloneObject(presentation.options && presentation.options.content),
            aspectRatio: this.cloneObject(presentation.aspectRatio),
            sceneTransition: this.cloneObject(presentation.defaultSceneTransition),
            navigation: this.cloneObject(presentation.navigation),
            preload: this.cloneObject(presentation.preload),
        }
    }

    /**
     * 序列化元素配置。
     * 根据元素类型提取相应的属性字段。
     * @param {BaseElement} element
     * @returns {Object}
     */
    static serializeElementOptions(element) {
        const base = {
            name: element.name,
            visible: element.visible,
            locked: element.locked,
            layout: this.cloneObject(element.layout),
            transform: this.cloneObject(element.transform),
            opacity: element.opacity,
            zIndex: element.zIndex,
            blendMode: element.blendMode,
        }

        switch (element.type) {
            case "text":
                return {
                    ...base,
                    text: element.text,
                    fontSize: element.fontSize,
                    fontFamily: element.fontFamily,
                    color: element.color,
                    textAlign: element.textAlign,
                    lineHeight: element.lineHeight,
                }
            case "image":
                return {
                    ...base,
                    src: element.src,
                    alt: element.alt,
                    fit: element.fit,
                    cropX: element.cropX,
                    cropY: element.cropY,
                    cropWidth: element.cropWidth,
                    cropHeight: element.cropHeight,
                }
            case "shape":
                return {
                    ...base,
                    shapeType: element.shapeType,
                    fill: element.fill,
                    stroke: element.stroke,
                    strokeWidth: element.strokeWidth,
                    cornerRadius: element.cornerRadius,
                }
            case "line":
                return {
                    ...base,
                    x1: element.x1,
                    y1: element.y1,
                    x2: element.x2,
                    y2: element.y2,
                    strokeWidth: element.strokeWidth,
                    color: element.color,
                    cornerRadius: element.cornerRadius,
                }
            case "arrow":
                return {
                    ...base,
                    x1: element.x1,
                    y1: element.y1,
                    x2: element.x2,
                    y2: element.y2,
                    strokeWidth: element.strokeWidth,
                    color: element.color,
                    cornerRadius: element.cornerRadius,
                    arrowSize: element.arrowSize,
                    arrowWidth: element.arrowWidth,
                }
            default:
                return base
        }
    }

    /**
     * 序列化状态元数据（entrance/exit/parent 等）。
     * 将 parent 绑定中的 targetId 转换为 targetRef 以便跨项目迁移。
     * @param {Object} meta - 状态元数据
     * @param {Map} idToRef - ID 到引用的映射
     * @returns {Object}
     */
    static serializeStateMeta(meta, idToRef) {
        if (!meta || typeof meta !== "object") {
            return {}
        }

        const normalized = this.cloneObject(meta)
        // 将 parent.targetId 转换为 parent.targetRef
        if (normalized.parent && typeof normalized.parent === "object") {
            const targetId = normalized.parent.targetId
            if (typeof targetId === "string") {
                normalized.parent.targetRef = idToRef.get(targetId) || null
            }
            delete normalized.parent.targetId
        }

        return normalized
    }

    /**
     * 反序列化状态元数据。
     * 将 parent 绑定中的 targetRef 还原为 targetId。
     * @param {Object} meta - 状态元数据
     * @param {Map} refToElement - 引用到元素的映射
     * @returns {Object}
     */
    static deserializeStateMeta(meta, refToElement) {
        const options = {}
        if (!meta || typeof meta !== "object") {
            return options
        }

        if (meta.entrance) {
            options.entrance = this.cloneObject(meta.entrance)
        }
        if (meta.exit) {
            options.exit = this.cloneObject(meta.exit)
        }
        if (Object.prototype.hasOwnProperty.call(meta, "parent")) {
            const parentMeta = meta.parent
            if (parentMeta == null) {
                options.parent = null
            } else if (typeof parentMeta === "object") {
                const targetRef = typeof parentMeta.targetRef === "string" ? parentMeta.targetRef : ""
                const targetElement = targetRef ? refToElement.get(targetRef) : null
                options.parent = {
                    enabled: parentMeta.enabled !== false,
                    targetId: targetElement ? targetElement.id : null,
                }
            }
        }
        if (Object.prototype.hasOwnProperty.call(meta, "delay")) {
            options.delay = meta.delay
        }

        return options
    }

    /**
     * 根据类型字符串创建元素实例。
     * @param {string} type - 元素类型
     * @param {Object} options - 元素配置
     * @returns {BaseElement|null}
     */
    static createElementByType(type, options) {
        return createElementByType(type, options)
    }

    /**
     * 深度克隆对象（用于序列化/反序列化）。
     * @param {*} value
     * @returns {*}
     */
    static cloneObject(value) {
        if (value == null) {
            return value
        }

        if (Array.isArray(value)) {
            return value.map((item) => this.cloneObject(item))
        }

        if (typeof value === "object") {
            return deepMerge({}, value)
        }

        return value
    }
}
