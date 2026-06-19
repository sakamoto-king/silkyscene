/**
 * SceneGeometry（场景几何查询 / 纯计算预测）。
 *
 * 设计目标：
 * - 不依赖 DOM，可对“任意指定场景（即使未渲染）”预测元素最终坐标。
 * - 默认返回包含 transform 后的 AABB（轴对齐包围盒），并附带 OBB 四角点（便于更精确的连线/包围）。
 * - 提供 1-9 九宫格取点与按画布百分比的偏移能力。
 *
 * 重要限制：
 * - 若元素在声明中使用了 width/height:"auto"，在快照编译阶段会被编译成 0%，
 *   因此纯预测模式无法得到真实尺寸（需后续 measure 模式增强）。
 */

import { parseMotionOffset } from "../utils/size.js"

function clampNumber(value, fallback = 0) {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
}

function parsePercentOrNumber(value, total) {
    if (value == null) return 0

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0
    }

    if (typeof value === "string") {
        const text = value.trim()
        if (!text || text === "auto") return 0

        if (text.endsWith("%")) {
            const ratio = Number.parseFloat(text.slice(0, -1))
            return Number.isFinite(ratio) ? (ratio / 100) * total : 0
        }

        const numeric = Number(text)
        return Number.isFinite(numeric) ? numeric : 0
    }

    return 0
}

function sizeBaseOf(containerWidth, containerHeight) {
    return Math.max(1, Math.min(containerWidth || 0, containerHeight || 0))
}

function percentText(ratio) {
    return `${(ratio * 100)
        .toFixed(4)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*?)0+$/, "$1")}%`
}

function toPercentX(px, containerWidth) {
    const w = Math.max(1, Number(containerWidth) || 0)
    return percentText(px / w)
}

function toPercentY(px, containerHeight) {
    const h = Math.max(1, Number(containerHeight) || 0)
    return percentText(px / h)
}

function parseCanvasOffsetX(dx, containerWidth) {
    if (dx == null) return 0
    if (typeof dx === "number") return Number.isFinite(dx) ? dx : 0
    if (typeof dx === "string") {
        const text = dx.trim()
        if (text.endsWith("%")) {
            const ratio = Number.parseFloat(text.slice(0, -1))
            return Number.isFinite(ratio) ? (ratio / 100) * (Number(containerWidth) || 0) : 0
        }
        const numeric = Number(text)
        return Number.isFinite(numeric) ? numeric : 0
    }
    return 0
}

function parseCanvasOffsetY(dy, containerHeight) {
    if (dy == null) return 0
    if (typeof dy === "number") return Number.isFinite(dy) ? dy : 0
    if (typeof dy === "string") {
        const text = dy.trim()
        if (text.endsWith("%")) {
            const ratio = Number.parseFloat(text.slice(0, -1))
            return Number.isFinite(ratio) ? (ratio / 100) * (Number(containerHeight) || 0) : 0
        }
        const numeric = Number(text)
        return Number.isFinite(numeric) ? numeric : 0
    }
    return 0
}

function applyTransformToPoint(point, transform) {
    const x = point.x
    const y = point.y

    const scaleX = clampNumber(transform.scaleX, 1)
    const scaleY = clampNumber(transform.scaleY, 1)
    const rotation = clampNumber(transform.rotation, 0)

    // 与 Renderer 的 transform 顺序对齐：translate3d(...) rotate(...) scale(...)
    // 对点的效果：先 scale → rotate → translate。
    const sx = x * scaleX
    const sy = y * scaleY

    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)

    const rx = sx * cos - sy * sin
    const ry = sx * sin + sy * cos

    return {
        x: rx + clampNumber(transform.translateX, 0),
        y: ry + clampNumber(transform.translateY, 0),
    }
}

function aabbFromCorners(corners) {
    const xs = [corners.tl.x, corners.tr.x, corners.bl.x, corners.br.x]
    const ys = [corners.tl.y, corners.tr.y, corners.bl.y, corners.br.y]
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    return {
        x: minX,
        y: minY,
        width: Math.max(0, maxX - minX),
        height: Math.max(0, maxY - minY),
    }
}

function pointFromAabbPos(aabb, pos) {
    const xLeft = aabb.x
    const xCenter = aabb.x + aabb.width / 2
    const xRight = aabb.x + aabb.width

    const yTop = aabb.y
    const yMiddle = aabb.y + aabb.height / 2
    const yBottom = aabb.y + aabb.height

    switch (Number(pos)) {
        case 1:
            return { x: xLeft, y: yTop }
        case 2:
            return { x: xCenter, y: yTop }
        case 3:
            return { x: xRight, y: yTop }
        case 4:
            return { x: xLeft, y: yMiddle }
        case 5:
            return { x: xCenter, y: yMiddle }
        case 6:
            return { x: xRight, y: yMiddle }
        case 7:
            return { x: xLeft, y: yBottom }
        case 8:
            return { x: xCenter, y: yBottom }
        case 9:
            return { x: xRight, y: yBottom }
        default:
            throw new Error("pos 仅支持 1-9（123/456/789 九宫格定位）")
    }
}

function pointFromObbCorner(corners, pos) {
    switch (Number(pos)) {
        case 1:
            return corners.tl
        case 3:
            return corners.tr
        case 7:
            return corners.bl
        case 9:
            return corners.br
        default:
            return null
    }
}

export class SceneGeometry {
    /**
     * @param {Object} options
     * @param {number} options.containerWidth
     * @param {number} options.containerHeight
     * @param {Map<string, any>} options.renderableStatesById - snapshot.renderableStatesById
     * @param {Map<string, any>} [options.elementsById] - elementId -> element（用于兜底 transform）
     * @param {boolean} [options.includeTransform=true]
     */
    constructor(options = {}) {
        this.containerWidth = Number(options.containerWidth || 0)
        this.containerHeight = Number(options.containerHeight || 0)
        this.renderableStatesById = options.renderableStatesById || new Map()
        this.elementsById = options.elementsById || new Map()
        this.includeTransform = options.includeTransform !== false

        this._cache = new Map()
    }

    /**
     * 获取元素几何信息。
     * @param {string|{id:string}} elementOrId
     * @param {Object} [options]
     * @param {"aabb"|"obb"} [options.box="aabb"]
     */
    getRect(elementOrId, options = {}) {
        const elementId = typeof elementOrId === "string" ? elementOrId : (elementOrId && elementOrId.id)
        if (!elementId) {
            throw new Error("getRect 需要 elementId")
        }

        const cacheKey = `${elementId}:${this.includeTransform ? "t" : "n"}`
        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey)
        }

        const renderState = this.renderableStatesById.get(elementId)
        if (!renderState) {
            return null
        }

        const element = this.elementsById.get(elementId) || null
        const layout = (renderState && renderState.layout) || {}

        const leftPx = parsePercentOrNumber(layout.left, this.containerWidth)
        const topPx = parsePercentOrNumber(layout.top, this.containerHeight)
        const widthPx = parsePercentOrNumber(layout.width, this.containerWidth)
        const heightPx = parsePercentOrNumber(layout.height, this.containerHeight)
        const anchorX = clampNumber(layout.anchorX, 0)
        const anchorY = clampNumber(layout.anchorY, 0)

        const topLeftX = leftPx - widthPx * anchorX
        const topLeftY = topPx - heightPx * anchorY

        const baseCorners = {
            tl: { x: topLeftX, y: topLeftY },
            tr: { x: topLeftX + widthPx, y: topLeftY },
            bl: { x: topLeftX, y: topLeftY + heightPx },
            br: { x: topLeftX + widthPx, y: topLeftY + heightPx },
        }

        const result = {
            elementId,
            aabb: { x: topLeftX, y: topLeftY, width: widthPx, height: heightPx },
            corners: baseCorners,
            flags: {
                autoSized: widthPx <= 0 || heightPx <= 0,
            },
        }

        if (this.includeTransform) {
            const transformState = (renderState && renderState.transform) || (element && element.transform) || {}
            const sizeBase = sizeBaseOf(this.containerWidth, this.containerHeight)
            const translateX = topLeftX + parseMotionOffset(transformState.x, sizeBase, "transform.x")
            const translateY = topLeftY + parseMotionOffset(transformState.y, sizeBase, "transform.y")

            const transform = {
                translateX,
                translateY,
                scaleX: transformState.scaleX ?? 1,
                scaleY: transformState.scaleY ?? 1,
                rotation: transformState.rotation ?? 0,
            }

            const local = {
                tl: { x: 0, y: 0 },
                tr: { x: widthPx, y: 0 },
                bl: { x: 0, y: heightPx },
                br: { x: widthPx, y: heightPx },
            }

            const corners = {
                tl: applyTransformToPoint(local.tl, transform),
                tr: applyTransformToPoint(local.tr, transform),
                bl: applyTransformToPoint(local.bl, transform),
                br: applyTransformToPoint(local.br, transform),
            }

            result.corners = corners
            result.aabb = aabbFromCorners(corners)
        }

        this._cache.set(cacheKey, result)
        return result
    }

    /**
     * 按 1-9 九宫格定位获取某元素的点位。
     * @param {string|{id:string}} elementOrId
     * @param {number} pos - 1..9（123/456/789）
     * @param {Object} [options]
     * @param {Object} [options.offset] - {dx, dy}，支持 "%"（相对画布宽/高）或 px number
     * @param {"aabb"|"obb"} [options.box="aabb"] - box=obb 时，1/3/7/9 会优先取旋转四角
     */
    getPoint(elementOrId, pos, options = {}) {
        const rect = this.getRect(elementOrId)
        if (!rect) return null

        const box = options.box || "aabb"

        let point = null
        if (box === "obb") {
            point = pointFromObbCorner(rect.corners, pos)
        }
        if (!point) {
            point = pointFromAabbPos(rect.aabb, pos)
        }

        const offset = options.offset || null
        if (offset) {
            point = {
                x: point.x + parseCanvasOffsetX(offset.dx, this.containerWidth),
                y: point.y + parseCanvasOffsetY(offset.dy, this.containerHeight),
            }
        }

        return {
            x: point.x,
            y: point.y,
            xPercent: toPercentX(point.x, this.containerWidth),
            yPercent: toPercentY(point.y, this.containerHeight),
        }
    }

    toPercentX(px) {
        return toPercentX(px, this.containerWidth)
    }

    toPercentY(px) {
        return toPercentY(px, this.containerHeight)
    }

    /**
     * 生成 Line/Arrow 的 state.line。
     *
     * @param {Object} options
     * @param {Object} options.from - { elementId, pos, offset } 或 { x, y }
     * @param {Object} options.to - { elementId, pos, offset } 或 { x, y }
     * @returns {{line:{x1:string,y1:string,x2:string,y2:string}}}
     */
    buildLineState(options = {}) {
        const from = options.from
        const to = options.to

        const p1 = from && from.elementId
            ? this.getPoint(from.elementId, from.pos || 5, { offset: from.offset, box: from.box || "aabb" })
            : from
        const p2 = to && to.elementId
            ? this.getPoint(to.elementId, to.pos || 5, { offset: to.offset, box: to.box || "aabb" })
            : to

        if (!p1 || !p2) {
            throw new Error("buildLineState 需要 from/to 点位")
        }

        const x1 = typeof p1.xPercent === "string" ? p1.xPercent : toPercentX(p1.x, this.containerWidth)
        const y1 = typeof p1.yPercent === "string" ? p1.yPercent : toPercentY(p1.y, this.containerHeight)
        const x2 = typeof p2.xPercent === "string" ? p2.xPercent : toPercentX(p2.x, this.containerWidth)
        const y2 = typeof p2.yPercent === "string" ? p2.yPercent : toPercentY(p2.y, this.containerHeight)

        return {
            line: { x1, y1, x2, y2 },
        }
    }

    /**
     * 用两个锚点生成“包围矩形”的 layout state（anchorX/Y 固定为 0）。
     *
     * @param {Object} options
     * @param {Object} options.topLeft - { elementId, pos, offset }
     * @param {Object} options.bottomRight - { elementId, pos, offset }
     * @returns {{layout:{mode:string,left:string,top:string,width:string,height:string,anchorX:number,anchorY:number}}}
     */
    buildRectLayoutFromAnchors(options = {}) {
        const tl = options.topLeft
        const br = options.bottomRight

        if (!tl || !br) {
            throw new Error("buildRectLayoutFromAnchors 需要 topLeft/bottomRight")
        }

        const p1 = this.getPoint(tl.elementId, tl.pos || 1, { offset: tl.offset, box: tl.box || "aabb" })
        const p2 = this.getPoint(br.elementId, br.pos || 9, { offset: br.offset, box: br.box || "aabb" })

        if (!p1 || !p2) {
            throw new Error("buildRectLayoutFromAnchors 无法获取锚点")
        }

        const leftPx = Math.min(p1.x, p2.x)
        const topPx = Math.min(p1.y, p2.y)
        const rightPx = Math.max(p1.x, p2.x)
        const bottomPx = Math.max(p1.y, p2.y)

        return {
            layout: {
                mode: "absolute",
                left: toPercentX(leftPx, this.containerWidth),
                top: toPercentY(topPx, this.containerHeight),
                width: toPercentX(Math.max(0, rightPx - leftPx), this.containerWidth),
                height: toPercentY(Math.max(0, bottomPx - topPx), this.containerHeight),
                anchorX: 0,
                anchorY: 0,
            },
        }
    }
}
