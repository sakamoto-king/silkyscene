import { DESIGN_PIXELS_PER_UNIT, pixels, SCREEN } from "./definition.js"
import type { ProjectDocument } from "./definition.js"
import { styleText } from "../render/textStyles.js"

export interface Measurement {
  width: number
  height: number
  /** Tallest variant at the narrowest width this fixed-width text reaches during the timeline (only when narrower). */
  narrowHeight?: number
  src?: string
  textMetrics?: ReadonlyMap<string, { width: number; height: number }>
}

function safeImageUrl(src: string, baseUrl: string): string {
  const url = new URL(src, baseUrl)
  if (url.protocol === "data:" && /^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(url.href)) return url.href
  if (url.origin === new URL(baseUrl).origin && (url.protocol === "http:" || url.protocol === "https:")) return url.href
  throw new Error("图片应来自项目目录，或通过小样选择本地图片")
}

/** Measure with the same text rules used by the DOM renderer. */
export async function measureProject(
  project: ProjectDocument, baseUrl: string, textVariants: ReadonlyMap<string, ReadonlySet<string>>,
  narrowest: ReadonlyMap<string, number> = new Map(),
): Promise<ReadonlyMap<string, Measurement>> {
  const regions = new Map(project.regions.map(region => [region.id, region]))
  const groups = new Map(project.elements.flatMap(e => e.kind === "group" ? [[e.id, e] as const] : []))
  /** Container width in design px: region, group (its declared width) or the screen frame. */
  const containerWidth = (id: string): number => {
    if (id === SCREEN) return project.canvas.width
    const region = regions.get(id)
    if (region) return region.width * DESIGN_PIXELS_PER_UNIT
    const group = groups.get(id)!
    return pixels(group.layout.width!, containerWidth(group.layout.region))
  }
  const entries = await Promise.all(project.elements.map(async element => {
    if (element.kind === "image") {
      const src = safeImageUrl(element.src, baseUrl)
      const image = new Image()
      image.src = src
      try { await image.decode() }
      catch { throw new Error(element.id + " 的图片无法读取") }
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error(element.id + " 的图片没有有效尺寸")
      return [element.id, { width: image.naturalWidth, height: image.naturalHeight, src }] as const
    }
    if (element.kind !== "text") return undefined
    const padX = ((element.padding?.[0] ?? 0) + (element.stroke ? element.strokeWidth ?? 0.002 : 0)) * DESIGN_PIXELS_PER_UNIT
    const declared = element.layout.width === undefined ? 0 : pixels(element.layout.width, containerWidth(element.layout.region))
    const squeezed = narrowest.get(element.id)
    const ruler = document.createElement("div")
    styleText(ruler, element.fontSize * DESIGN_PIXELS_PER_UNIT, element.align, element.weight, element.fontFamily,
      element.lineHeight, (element.letterSpacing ?? 0) * DESIGN_PIXELS_PER_UNIT)
    Object.assign(ruler.style, {
      position: "absolute", visibility: "hidden", pointerEvents: "none", left: "-100000px", top: "0",
      width: element.layout.width === undefined ? "max-content" : declared - 2 * padX + "px",
    })
    ruler.textContent = element.text || "\u00a0"
    document.body.append(ruler)
    try {
      const { fontWeight, fontSize, fontFamily } = getComputedStyle(ruler)
      const variants = new Set(element.bind ? Array.from({ length: 1000 }, (_, i) => i + "%") : [element.text, ...(textVariants.get(element.id) ?? [])])
      const glyphs = new Set<string>()
      for (const variant of variants) for (const char of variant) glyphs.add(char)
      try { await document.fonts.load(fontWeight + " " + fontSize + " " + fontFamily, [...glyphs].join("") || "\u00a0") }
      catch { throw new Error(element.id + " 的字体无法加载") }
      let width = 0, height = 0
      const textMetrics = new Map<string, { width: number; height: number }>()
      for (const text of variants) {
        ruler.textContent = text || "\u00a0"
        const rect = ruler.getBoundingClientRect()
        textMetrics.set(text, { width: rect.width, height: rect.height })
        width = Math.max(width, rect.width)
        height = Math.max(height, rect.height)
      }
      let narrowHeight: number | undefined
      if (squeezed !== undefined && squeezed < declared - 0.5) {
        ruler.style.width = squeezed - 2 * padX + "px"
        narrowHeight = 0
        for (const text of variants) { ruler.textContent = text || "\u00a0"; narrowHeight = Math.max(narrowHeight, ruler.getBoundingClientRect().height) }
      }
      return [element.id, { width, height, textMetrics, ...(narrowHeight !== undefined ? { narrowHeight } : {}) }] as const
    } finally { ruler.remove() }
  }))
  return new Map<string, Measurement>(entries.filter(entry => entry !== undefined))
}
