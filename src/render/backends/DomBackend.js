/**
 * DomBackend（最小 DOM/SVG 后端骨架）。
 *
 * 约束：
 * - 只识别 PrimitiveRenderSpec 的 kind（Group/Text/Image/Shape/Path/Video）。
 * - 只接收 Resolved 数据（绝对 px、已解算的 commands），不得自行解算 %。
 *
 * 本文件当前为骨架实现：
 * - Text/Image/Shape/Path 提供最小可渲染映射
 * - Video 允许 no-op（占位节点），但必须不 crash
 */

import { PrimitiveKind } from "../primitives.js"

function ensureElement(parent, key, create) {
    let node = parent.querySelector(`[data-node-id="${CSS.escape(key)}"]`)
    if (!node) {
        node = create()
        node.dataset.nodeId = key
        parent.appendChild(node)
    }
    return node
}

function toSvgPathD(commands) {
    const list = Array.isArray(commands) ? commands : []

    let d = ""
    let cx = 0
    let cy = 0
    let hasCurrentPoint = false

    const moveCurrent = (x, y) => {
        cx = x
        cy = y
        hasCurrentPoint = true
    }

    for (const cmd of list) {
        switch (cmd.type) {
            case "moveTo": {
                const x = Number(cmd.x) || 0
                const y = Number(cmd.y) || 0
                d += `M ${x} ${y} `
                moveCurrent(x, y)
                break
            }
            case "lineTo": {
                const x = Number(cmd.x) || 0
                const y = Number(cmd.y) || 0
                d += `L ${x} ${y} `
                moveCurrent(x, y)
                break
            }
            case "bezierCurveTo": {
                const cp1x = Number(cmd.cp1x) || 0
                const cp1y = Number(cmd.cp1y) || 0
                const cp2x = Number(cmd.cp2x) || 0
                const cp2y = Number(cmd.cp2y) || 0
                const x = Number(cmd.x) || 0
                const y = Number(cmd.y) || 0
                d += `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x} ${y} `
                moveCurrent(x, y)
                break
            }
            case "quadraticCurveTo": {
                const cpx = Number(cmd.cpx) || 0
                const cpy = Number(cmd.cpy) || 0
                const x = Number(cmd.x) || 0
                const y = Number(cmd.y) || 0
                d += `Q ${cpx} ${cpy} ${x} ${y} `
                moveCurrent(x, y)
                break
            }
            case "arc": {
                const centerX = Number(cmd.cx) || 0
                const centerY = Number(cmd.cy) || 0
                const r = Math.max(0, Number(cmd.r) || 0)
                const startAngle = Number(cmd.startAngle) || 0
                const endAngle = Number(cmd.endAngle) || 0
                const counterclockwise = Boolean(cmd.counterclockwise)

                const startX = centerX + r * Math.cos(startAngle)
                const startY = centerY + r * Math.sin(startAngle)
                const endX = centerX + r * Math.cos(endAngle)
                const endY = centerY + r * Math.sin(endAngle)

                // 若当前点不在弧起点，先移动到起点（保持输出确定性）。
                if (!hasCurrentPoint) {
                    d += `M ${startX} ${startY} `
                } else if (Math.abs(cx - startX) > 1e-6 || Math.abs(cy - startY) > 1e-6) {
                    d += `L ${startX} ${startY} `
                }

                // SVG A 命令需要：rx ry xAxisRotation largeArcFlag sweepFlag x y
                // 这里采用简单映射：
                // - largeArcFlag：|delta|>PI
                // - sweepFlag：与 canvas 的 anticlockwise 取反（在屏幕坐标系下通常对应）
                let delta = endAngle - startAngle
                while (delta <= -Math.PI * 2) delta += Math.PI * 2
                while (delta > Math.PI * 2) delta -= Math.PI * 2

                const largeArcFlag = Math.abs(delta) > Math.PI ? 1 : 0
                const sweepFlag = counterclockwise ? 0 : 1

                d += `A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${endX} ${endY} `
                moveCurrent(endX, endY)
                break
            }
            case "closePath": {
                d += "Z "
                break
            }
            default:
                throw new Error(`DomBackend: unknown path command: ${String(cmd.type)}`)
        }
    }

    return d.trim()
}

export class DomBackend {
    /**
     * @param {HTMLElement} root
     */
    constructor(root) {
        this.root = root

        /** @type {Map<string, HTMLElement|SVGElement>} */
        this.nodeCache = new Map()
    }

    /**
     * Patch 单个 primitive 节点（最小实现）。
     * @param {Object} primitive - PrimitiveRenderSpec node
     * @param {Object} resolved - { rect, transform, props, style }
     */
    patchNode(primitive, resolved) {
        if (!primitive || !primitive.nodeId) return

        const kind = primitive.kind
        const nodeId = primitive.nodeId

        if (kind === PrimitiveKind.Group) {
            const el = ensureElement(this.root, nodeId, () => {
                const div = document.createElement("div")
                div.style.position = "absolute"
                div.style.left = "0"
                div.style.top = "0"
                div.style.willChange = "transform, opacity"
                return div
            })
            this.applyCommon(el, resolved)
            return el
        }

        if (kind === PrimitiveKind.Text) {
            const el = ensureElement(this.root, nodeId, () => {
                const div = document.createElement("div")
                div.style.position = "absolute"
                div.style.left = "0"
                div.style.top = "0"
                div.style.whiteSpace = "pre-wrap"
                div.style.willChange = "transform, opacity"
                return div
            })
            this.applyCommon(el, resolved)
            const p = (resolved && resolved.props) || {}
            el.textContent = String(p.text ?? "")
            if (p.color) el.style.color = String(p.color)
            if (p.fontSize != null) el.style.fontSize = `${Number(p.fontSize) || 0}px`
            if (p.fontWeight != null) el.style.fontWeight = String(p.fontWeight)
            if (p.fontFamily) el.style.fontFamily = String(p.fontFamily)
            if (p.align) el.style.textAlign = String(p.align)
            return el
        }

        if (kind === PrimitiveKind.Image) {
            const el = ensureElement(this.root, nodeId, () => {
                const img = document.createElement("img")
                img.style.position = "absolute"
                img.style.left = "0"
                img.style.top = "0"
                img.style.willChange = "transform, opacity"
                img.decoding = "async"
                return img
            })
            this.applyCommon(el, resolved)
            const p = (resolved && resolved.props) || {}
            if (p.src) el.src = String(p.src)
            el.style.objectFit = p.fit ? String(p.fit) : "cover"
            return el
        }

        if (kind === PrimitiveKind.Shape) {
            const el = ensureElement(this.root, nodeId, () => {
                const div = document.createElement("div")
                div.style.position = "absolute"
                div.style.left = "0"
                div.style.top = "0"
                div.style.boxSizing = "border-box"
                div.style.willChange = "transform, opacity"
                return div
            })
            this.applyCommon(el, resolved)
            const p = (resolved && resolved.props) || {}
            if (p.fill) el.style.backgroundColor = String(p.fill)
            if (p.stroke) {
                el.style.borderStyle = p.stroke === "none" ? "none" : "solid"
                el.style.borderColor = String(p.stroke)
            }
            if (p.strokeWidth != null) {
                el.style.borderWidth = `${Number(p.strokeWidth) || 0}px`
            }
            if (p.shapeType === "circle") {
                el.style.borderRadius = "50%"
            } else if (p.shapeType === "roundedRect" && p.radius != null) {
                el.style.borderRadius = `${Number(p.radius) || 0}px`
            } else {
                el.style.borderRadius = "0px"
            }
            return el
        }

        if (kind === PrimitiveKind.Path) {
            const el = ensureElement(this.root, nodeId, () => {
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
                svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
                svg.style.position = "absolute"
                svg.style.left = "0"
                svg.style.top = "0"
                svg.style.overflow = "visible"

                const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
                path.dataset.role = "path"
                svg.appendChild(path)

                return svg
            })

            this.applyCommon(el, resolved)

            const path = el.querySelector("path[data-role='path']")
            const p = (resolved && resolved.props) || {}
            const commands = p.commands || []
            if (path) {
                path.setAttribute("d", toSvgPathD(commands))
                if (p.stroke) path.setAttribute("stroke", String(p.stroke))
                if (p.strokeWidth != null) path.setAttribute("stroke-width", String(Number(p.strokeWidth) || 0))
                if (p.fill) path.setAttribute("fill", String(p.fill))
                else path.setAttribute("fill", "none")
            }

            return el
        }

        if (kind === PrimitiveKind.Video) {
            // 本期允许 no-op：创建占位容器即可。
            const el = ensureElement(this.root, nodeId, () => {
                const div = document.createElement("div")
                div.style.position = "absolute"
                div.style.left = "0"
                div.style.top = "0"
                div.style.willChange = "transform, opacity"
                div.dataset.kind = "Video"
                return div
            })
            this.applyCommon(el, resolved)
            return el
        }

        throw new Error(`DomBackend: unknown primitive kind: ${String(kind)}`)
    }

    applyCommon(el, resolved) {
        const rect = resolved && resolved.rect
        if (rect) {
            if (rect.width > 0) el.style.width = `${rect.width}px`
            if (rect.height > 0) el.style.height = `${rect.height}px`

            // 与 legacy Renderer 语义对齐：anchor 同时决定定位与缩放/旋转中心。
            // 默认使用 0 0（左上角），避免浏览器默认 50% 50% 导致语义漂移。
            const clamp01 = (v) => {
                const n = Number(v)
                if (!Number.isFinite(n)) return 0
                return n < 0 ? 0 : (n > 1 ? 1 : n)
            }
            const ax = clamp01(rect.anchorX)
            const ay = clamp01(rect.anchorY)
            el.style.transformOrigin = `${ax * 100}% ${ay * 100}%`
        }

        const t = resolved && resolved.transform
        if (t) {
            el.style.transform = `translate3d(${t.translateX}px, ${t.translateY}px, 0) rotate(${t.rotation}rad) scale(${t.scaleX}, ${t.scaleY})`
        }

        const style = resolved && resolved.style
        if (style) {
            if (style.opacity != null) el.style.opacity = String(style.opacity)
            if (style.zIndex != null) el.style.zIndex = String(style.zIndex)
            if (style.pointerEvents != null) el.style.pointerEvents = String(style.pointerEvents)
        }
    }
}

export const __testing = {
    toSvgPathD,
}
