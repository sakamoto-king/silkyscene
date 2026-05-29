function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]"
}

function cloneValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => cloneValue(item))
    }

    if (isPlainObject(value)) {
        const cloned = {}
        for (const key of Object.keys(value)) {
            cloned[key] = cloneValue(value[key])
        }
        return cloned
    }

    return value
}

/**
 * 深合并对象，返回全新对象，不修改入参。
 * 数组采用覆盖策略，不做按索引合并。
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
export function deepMerge(target = {}, source = {}) {
    const merged = cloneValue(target)

    if (!isPlainObject(source)) {
        return merged
    }

    for (const key of Object.keys(source)) {
        const sourceValue = source[key]
        const mergedValue = merged[key]

        if (isPlainObject(mergedValue) && isPlainObject(sourceValue)) {
            merged[key] = deepMerge(mergedValue, sourceValue)
            continue
        }

        merged[key] = cloneValue(sourceValue)
    }

    return merged
}
