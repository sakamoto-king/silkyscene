/**
 * PrimitiveRenderSpec（运行时基础图元规范）。
 *
 * 运行时只允许这些 kind：Group/Text/Image/Shape/Path/Video。
 * 高级元素必须在编译期 Lowering 为这些基础图元的组合。
 *
 * 注意：此文件只定义“可序列化的声明形态”；所有相对值必须在 Resolve 阶段解算。
 */

export const PrimitiveKind = Object.freeze({
    Group: "Group",
    Text: "Text",
    Image: "Image",
    Shape: "Shape",
    Path: "Path",
    Video: "Video",
})

export function group(nodeId, options = {}, children = []) {
    const {
        layout = null,
        transform = null,
        style = null,
        props = {},
    } = options || {}

    return {
        nodeId,
        kind: PrimitiveKind.Group,
        layout,
        transform,
        style,
        props: props || {},
        children: Array.isArray(children) ? children : [],
    }
}

export function text(nodeId, options = {}) {
    const {
        layout = null,
        transform = null,
        style = null,
        props = {},
    } = options || {}

    return {
        nodeId,
        kind: PrimitiveKind.Text,
        layout,
        transform,
        style,
        props: props || {},
    }
}

export function image(nodeId, options = {}) {
    const {
        layout = null,
        transform = null,
        style = null,
        props = {},
    } = options || {}

    return {
        nodeId,
        kind: PrimitiveKind.Image,
        layout,
        transform,
        style,
        props: props || {},
    }
}

export function shape(nodeId, options = {}) {
    const {
        layout = null,
        transform = null,
        style = null,
        props = {},
    } = options || {}

    return {
        nodeId,
        kind: PrimitiveKind.Shape,
        layout,
        transform,
        style,
        props: props || {},
    }
}

export function path(nodeId, options = {}) {
    const {
        layout = null,
        transform = null,
        style = null,
        props = {},
    } = options || {}

    return {
        nodeId,
        kind: PrimitiveKind.Path,
        layout,
        transform,
        style,
        props: props || {},
    }
}

export function video(nodeId, options = {}) {
    const {
        layout = null,
        transform = null,
        style = null,
        props = {},
    } = options || {}

    return {
        nodeId,
        kind: PrimitiveKind.Video,
        layout,
        transform,
        style,
        props: props || {},
    }
}
