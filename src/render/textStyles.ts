import type { TextAlign } from "../pipeline/definition.js"

const defaultFontFamily = '"Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif'

/** Shared by measure and render so both see the same line box. */
export function styleText(
  element: HTMLElement, fontSize: number, align: TextAlign, weight = 400, fontFamily = defaultFontFamily,
  lineHeight = 1.3, letterSpacing = 0,
): void {
  Object.assign(element.style, {
    fontFamily,
    fontSize: fontSize + "px",
    fontWeight: String(weight),
    lineHeight: String(lineHeight),
    letterSpacing: letterSpacing + "px",
    textAlign: align,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    boxSizing: "border-box",
  })
}
