/**
 * Resolve（相对值解算）。
 *
 * 目标：把所有 Definition 中的相对值（%、anchor、以及 Path 指令中的百分比坐标等）
 * 在 Resolve 阶段解算为绝对化的 Resolved 数据。
 *
 * 约束：
 * - Backend 只能接收 Resolved 数据；不得看到 "%"、"auto" 等相对值。
 * - 本模块保持纯计算：不触碰 DOM。
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

function resolveAnchor(layout) {
    return {
        anchorX: clampNumber(layout.anchorX, 0),
        anchorY: clampNumber(layout.anchorY, 0),
    }
}

/**
 * 解算 layoutDefinition（绝对百分比）到像素 rect。
 *
 * 注意：parent/flow/constraint 等“语义布局”应在更上游编译为绝对 layoutDefinition；
 * Resolve 阶段只负责把百分比/数值换算成像素，并应用 anchor。
 */
export function resolveRect(layoutDefinition, containerWidth, containerHeight) {
    const layout = layoutDefinition || {}

    const leftPx = parsePercentOrNumber(layout.left, containerWidth)
    const topPx = parsePercentOrNumber(layout.top, containerHeight)
    const widthPx = parsePercentOrNumber(layout.width, containerWidth)
    const heightPx = parsePercentOrNumber(layout.height, containerHeight)

    const { anchorX, anchorY } = resolveAnchor(layout)

    const x = leftPx - widthPx * anchorX
    const y = topPx - heightPx * anchorY

    return {
        x,
        y,
        width: widthPx,
        height: heightPx,
        anchorX,
        anchorY,
        anchorPoint: { x: leftPx, y: topPx },
    }
}

/**
 * 解算 transformDefinition。
 * - 语义对齐 Renderer：translate3d(...) rotate(...) scale(...)
 * - transform.x/y 的单位语义通过 parseMotionOffset 对齐（短边基准）。
 */
export function resolveTransform(transformDefinition, rect, containerWidth, containerHeight) {
    const t = transformDefinition || {}

    const sizeBase = sizeBaseOf(containerWidth, containerHeight)
    const translateX = (rect && rect.x ? rect.x : 0) + parseMotionOffset(t.x, sizeBase, "transform.x")
    const translateY = (rect && rect.y ? rect.y : 0) + parseMotionOffset(t.y, sizeBase, "transform.y")

    const scaleX = clampNumber(t.scaleX, 1)
    const scaleY = clampNumber(t.scaleY, 1)
    const rotation = clampNumber(t.rotation, 0)

    return {
        translateX,
        translateY,
        scaleX,
        scaleY,
        rotation,
    }
}

function resolveLocalX(value, width) {
    return parsePercentOrNumber(value, width)
}

function resolveLocalY(value, height) {
    return parsePercentOrNumber(value, height)
}

function resolveLocalR(value, width, height) {
    return parsePercentOrNumber(value, Math.max(1, Math.min(width || 0, height || 0)))
}

/**
 * 将 Path.commands 中的百分比坐标解算为本地 px。
 * @param {Array<Object>} commands
 * @param {number} width - resolvedRect.width
 * @param {number} height - resolvedRect.height
 * @returns {Array<Object>} resolvedCommands（仅包含 number）
 */
export function resolvePathCommands(commands, width, height) {
    const list = Array.isArray(commands) ? commands : []

    return list.map((cmd) => {
        if (!cmd || typeof cmd !== "object") {
            throw new Error("Path.commands 中存在非法指令")
        }

        switch (cmd.type) {
            case "moveTo":
            case "lineTo":
                return {
                    type: cmd.type,
                    x: resolveLocalX(cmd.x, width),
                    y: resolveLocalY(cmd.y, height),
                }
            case "bezierCurveTo":
                return {
                    type: cmd.type,
                    cp1x: resolveLocalX(cmd.cp1x, width),
                    cp1y: resolveLocalY(cmd.cp1y, height),
                    cp2x: resolveLocalX(cmd.cp2x, width),
                    cp2y: resolveLocalY(cmd.cp2y, height),
                    x: resolveLocalX(cmd.x, width),
                    y: resolveLocalY(cmd.y, height),
                }
            case "quadraticCurveTo":
                return {
                    type: cmd.type,
                    cpx: resolveLocalX(cmd.cpx, width),
                    cpy: resolveLocalY(cmd.cpy, height),
                    x: resolveLocalX(cmd.x, width),
                    y: resolveLocalY(cmd.y, height),
                }
            case "arc":
                return {
                    type: cmd.type,
                    cx: resolveLocalX(cmd.cx, width),
                    cy: resolveLocalY(cmd.cy, height),
                    r: resolveLocalR(cmd.r, width, height),
                    startAngle: clampNumber(cmd.startAngle, 0),
                    endAngle: clampNumber(cmd.endAngle, 0),
                    counterclockwise: Boolean(cmd.counterclockwise),
                }
            case "closePath":
                return { type: "closePath" }
            default:
                throw new Error(`未知 Path 指令类型: ${String(cmd.type)}`)
        }
    })
}
