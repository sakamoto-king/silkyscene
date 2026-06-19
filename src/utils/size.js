/**
 * 尺寸解析工具（第一版）。
 *
 * 约束：尺寸字段只接受百分比字符串，例如 "2.4%"。
 * 基准：presentation.content 的短边 min(width, height)。
 */

/**
 * 判断是否为合法百分比字符串。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPercentString(value) {
    if (typeof value !== "string") {
        return false
    }

    const trimmed = value.trim()
    if (!trimmed.endsWith("%")) {
        return false
    }

    const numeric = Number(trimmed.slice(0, -1))
    return Number.isFinite(numeric) && numeric >= 0
}

/**
 * 判断是否为合法带符号百分比字符串。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSignedPercentString(value) {
    if (typeof value !== "string") {
        return false
    }

    const trimmed = value.trim()
    if (!trimmed.endsWith("%")) {
        return false
    }

    const numeric = Number(trimmed.slice(0, -1))
    return Number.isFinite(numeric)
}

/**
 * 将百分比尺寸解析为像素。
 * @param {unknown} value - 仅允许百分比字符串
 * @param {number} sizeBase - 尺寸基准（短边）
 * @param {string} fieldName - 字段名（用于错误信息）
 * @returns {number}
 */
export function parsePercentSize(value, sizeBase, fieldName) {
    if (!isPercentString(value)) {
        throw new Error(`${fieldName} 仅支持百分比字符串（例如 \"2.4%\"），不再支持 px 或裸数字`) 
    }

    const ratio = Number(String(value).trim().slice(0, -1))
    return sizeBase * ratio / 100
}

/**
 * 将百分比偏移解析为像素。用于 transform.x/y、entrance/exit distance。
 * 为兼容已有 transform 调用，number 仍按像素处理。
 * @param {unknown} value
 * @param {number} sizeBase
 * @param {string} fieldName
 * @returns {number}
 */
export function parseMotionOffset(value, sizeBase, fieldName) {
    if (value == null) {
        return 0
    }

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0
    }

    if (isSignedPercentString(value)) {
        const ratio = Number(String(value).trim().slice(0, -1))
        return sizeBase * ratio / 100
    }

    throw new Error(`${fieldName} 仅支持百分比字符串或 number，字符串必须形如 \"4%\"`)
}

/**
 * 校验 entrance/exit distance。
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string|null}
 */
export function normalizeDistancePercent(value, fieldName) {
    if (value == null) {
        return null
    }

    if (!isPercentString(value)) {
        throw new Error(`${fieldName} 仅支持百分比字符串（例如 \"4%\"）`)
    }

    return String(value).trim()
}
