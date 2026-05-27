/**
 * 布局系统。
 *
 * 负责将 Element 的相对布局描述与 Scene 状态合并，
 * 计算绝对坐标并赋值到 Element.computed。
 * 
 * 职责：
 * - 解析百分比、相对单位、自动尺寸
 * - 处理父子尺寸约束与百分比继承
 * - 计算锚点影响下的实际坐标
 * 
 * 不做的事：
 * - 不处理动画插值（由 Renderer 负责）
 * - 不处理 DOM 更新（由 Renderer 负责）
 * - 不每帧运行（仅在状态切换时调用）
 */
export class Layout {
    /**
     * 解析 Element 的布局，计算绝对坐标
     * @param {BaseElement} element - 元素，包含 layout、parent、computed
     * @param {Object} sceneState - 该元素在当前 Scene 中的状态覆盖
     * @returns {Object} 计算后的 { x, y, width, height }
     */
    static resolve(element, sceneState) {
        // 当前为占位接口，由应用层实现或后续迭代补充
        // 返回格式示例：
        return {
            x: 0,
            y: 0,
            width: element.layout.width || 100,
            height: element.layout.height || 100,
        }
    }
}

