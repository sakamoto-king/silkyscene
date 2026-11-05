import type { Matrix, ResolvedPrimitive, ResolvedScene } from "./primitives.js"
import { styleText } from "./textStyles.js"

/** rect.fill / canvas.background may be a CSS gradient string (static); plain colors keep using background-color. */
const isGradientFill = (v: string | undefined) => typeof v === "string" && /^\s*(?:repeating-)?(?:linear|radial|conic)-gradient\(/.test(v)

const svg = "http://www.w3.org/2000/svg"
const mounted = new WeakMap<HTMLElement, HybridRenderHandle>()

export interface HybridRenderHandle {
  update(scene: ResolvedScene): void
  dispose(): void
}

function position(element: HTMLElement, x: number, y: number, width?: number, height?: number) {
  Object.assign(element.style, { left: x + "px", top: y + "px",
    width: width === undefined ? "" : width + "px", height: height === undefined ? "" : height + "px" })
}

const css = (m: Matrix) => "matrix(" + m.join(",") + ")"

/**
 * docs/04: CSS matrix3d for a layer-px → screen-px homography H, with transform-origin at the element's own top-left
 * (box). M = translate(−box) · H · translate(box), normalised so its w at the element origin is 1 (> 0 is checked in resolve).
 */
function css3d(H: readonly number[], bx: number, by: number) {
  const r = (i: number) => [H[3 * i]!, H[3 * i + 1]!, H[3 * i]! * bx + H[3 * i + 1]! * by + H[3 * i + 2]!]
  const [r0, r1, r2] = [r(0), r(1), r(2)]
  const m = [r0.map((v, k) => v - bx * r2[k]!), r1.map((v, k) => v - by * r2[k]!), r2]
  const w = m[2]![2]!
  const n = m.map(row => row.map(v => v / w))
  return "matrix3d(" + [n[0]![0], n[1]![0], 0, n[2]![0], n[0]![1], n[1]![1], 0, n[2]![1], 0, 0, 1, 0, n[0]![2], n[1]![2], 0, n[2]![2]].join(",") + ")"
}

/** docs/02: structural equality of two resolved primitives (plain data: numbers, strings, arrays, objects). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  return true
}
/** docs/02: rounded rectangle as CSS path() data, in the element's border-box px. */
function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2))
  if (!k) return "M" + x + " " + y + "H" + (x + w) + "V" + (y + h) + "H" + x + "Z"
  return "M" + (x + k) + " " + y + "H" + (x + w - k) + "A" + k + " " + k + " 0 0 1 " + (x + w) + " " + (y + k) + "V" + (y + h - k) +
    "A" + k + " " + k + " 0 0 1 " + (x + w - k) + " " + (y + h) + "H" + (x + k) + "A" + k + " " + k + " 0 0 1 " + x + " " + (y + h - k) +
    "V" + (y + k) + "A" + k + " " + k + " 0 0 1 " + (x + k) + " " + y + "Z"
}
/** docs/02 reveal and docs/02 group clip as one clip-path (old inset() form when there is no group clip). */
function clipPath(p: Exclude<ResolvedPrimitive, { kind: "line" }>): string {
  const rv = p.reveal, c = p.clip
  if (!c) {
    const hide = rv ? (1 - rv.amount) * 100 + "%" : ""
    return !rv ? "" : "inset(" + (rv.from === "bottom" ? hide : "0") + " " + (rv.from === "left" ? hide : "0") + " " +
      (rv.from === "top" ? hide : "0") + " " + (rv.from === "right" ? hide : "0") + ")"
  }
  const bx = p.kind === "text" ? p.x : p.rect.x, by = p.kind === "text" ? p.y : p.rect.y
  const bw = p.kind === "text" ? p.width ?? 0 : p.rect.width, bh = p.kind === "text" ? p.height ?? 0 : p.rect.height
  let x0 = c.x - bx, y0 = c.y - by, x1 = x0 + c.width, y1 = y0 + c.height
  if (rv) {
    const k = 1 - rv.amount
    if (rv.from === "left") x1 = Math.min(x1, bw * rv.amount); if (rv.from === "right") x0 = Math.max(x0, bw * k)
    if (rv.from === "top") y1 = Math.min(y1, bh * rv.amount); if (rv.from === "bottom") y0 = Math.max(y0, bh * k)
  }
  return "path('" + roundedRect(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0), c.radius) + "')"
}

function draw(node: Element, p: ResolvedPrimitive, perspective: boolean): void {
  if (p.kind === "line" && p.d !== undefined) {
    // docs/02: curved line — one <path>; trim is already baked into d, so dash patterns keep working.
    for (const [key, value] of Object.entries({
      d: perspective && p.d3 ? p.d3 : p.d, fill: "none", stroke: p.stroke.color,
      "stroke-width": p.stroke.width, "stroke-linecap": p.stroke.cap ?? "round", opacity: p.opacity ?? 1,
      "stroke-dasharray": p.stroke.dash ? p.stroke.dash.join(" ") : "none",
      visibility: p.connected === false ? "hidden" : "visible",
    })) node.setAttribute(key, String(value))
    return
  }
  if (p.kind === "line") {
    const [x1, y1, x2, y2] = perspective && p.screen3d ? p.screen3d : [p.x1, p.y1, p.x2, p.y2]
    for (const [key, value] of Object.entries({
      x1, y1, x2, y2, stroke: p.stroke.color,
      "stroke-width": p.stroke.width, "stroke-linecap": p.stroke.cap ?? "round", opacity: p.opacity ?? 1,
      "stroke-dasharray": p.stroke.dash ? p.stroke.dash.join(" ") : "none",
      visibility: p.connected === false ? "hidden" : "visible",
    })) node.setAttribute(key, String(value))
    return
  }
  const element = node as HTMLElement
  element.style.opacity = String(p.opacity ?? 1)
  // docs/02: reveal clips the element's own border box from one edge (hard edge, no feather); docs/02 adds the group clip.
  element.style.clipPath = clipPath(p)
  // Transforms are expressed in layer pixels, so put the origin at the layer origin.
  const box = p.kind === "text" ? { x: p.x, y: p.y } : p.rect
  if (perspective && p.transform3d) Object.assign(element.style, { transform: css3d(p.transform3d, box.x, box.y), transformOrigin: "0px 0px" })
  else Object.assign(element.style, { transform: p.transform ? css(p.transform) : "",
    transformOrigin: -box.x + "px " + -box.y + "px" })
  if (p.kind === "rect") {
    const { x, y, width, height } = p.rect
    position(element, x, y, width, height)
    const s = p.shadow
    const gradient = isGradientFill(p.fill)
    Object.assign(element.style, { boxSizing: "border-box", backgroundColor: gradient ? "" : p.fill,
      borderRadius: (p.radius ?? 0) + "px",
      border: p.stroke ? p.stroke.width + "px " + (p.stroke.style ?? "solid") + " " + p.stroke.color : "",
      boxShadow: s ? [s.x, s.y, s.blur, s.spread].map(v => v + "px").join(" ") + " " + s.color : "" })
    // docs/02: static stripes (CSS repeating-linear-gradient), over the fill.
    const st = p.stripes
    const stripes = st ? "repeating-linear-gradient(" + st.angle + "deg, " + st.color1 + " 0px, " + st.color1 + " " + st.size + "px, " +
      st.color2 + " " + st.size + "px, " + st.color2 + " " + (st.size + st.size2) + "px)" : ""
    // A CSS gradient fill is painted as a background image, under the stripes.
    element.style.backgroundImage = [stripes, gradient ? p.fill : ""].filter(Boolean).join(", ")
  } else if (p.kind === "text") {
    position(element, p.x, p.y, p.width, p.height)
    if (p.width !== undefined) styleText(element, p.fontSize, p.align ?? "left", p.fontWeight, p.fontFamily, p.lineHeight, p.letterSpacing)
    else Object.assign(element.style, {
      fontFamily: p.fontFamily ?? "sans-serif", fontSize: p.fontSize + "px",
      fontWeight: String(p.fontWeight ?? 400), lineHeight: "1.15", whiteSpace: "pre",
    })
    Object.assign(element.style, { color: p.fill, padding: p.padding ? p.padding[1] + "px " + p.padding[0] + "px" : "",
      backgroundColor: p.background ?? "", border: p.stroke ? p.stroke.width + "px " + (p.stroke.style ?? "solid") + " " + p.stroke.color : "",
      boxShadow: p.shadow ? [p.shadow.x, p.shadow.y, p.shadow.blur, p.shadow.spread].map(v => v + "px").join(" ") + " " + p.shadow.color : "" })
    if (element.textContent !== p.text) element.textContent = p.text
  } else if (p.kind === "dots") {
    const { x, y, width, height } = p.rect, half = p.spacing / 2
    position(element, x, y, width, height)
    Object.assign(element.style, { backgroundSize: p.spacing + "px " + p.spacing + "px",
      backgroundImage: "radial-gradient(circle at " + half + "px " + half + "px, " + p.color + " " + p.radius + "px, transparent " +
        (p.radius + 0.5) + "px)" })
  } else if (p.kind === "path") {
    const { x, y, width, height } = p.rect
    position(element, x, y, width, height)
    const svgNode = element.firstElementChild ?? element.appendChild(document.createElementNS(svg, "svg"))
    const path = svgNode.firstElementChild ?? svgNode.appendChild(document.createElementNS(svg, "path"))
    for (const [k, v] of Object.entries({ viewBox: "0 0 " + p.viewBox.join(" "), width: "100%", height: "100%",
      preserveAspectRatio: "none", overflow: "visible" })) svgNode.setAttribute(k, v)
    // Stroke width is in design px; vector-effect keeps it independent of the viewBox scale.
    for (const [k, v] of Object.entries({ d: p.d, fill: p.fill ?? "none", stroke: p.stroke?.color ?? "none",
      "stroke-width": String(p.stroke?.width ?? 0), "vector-effect": "non-scaling-stroke" })) path.setAttribute(k, v)
    // docs/02: trim via a normalised path length (1) and a dash that shows the first trim of it.
    if (p.trim !== undefined) { path.setAttribute("pathLength", "1"); path.setAttribute("stroke-dasharray", p.trim + " 2") }
    else { path.removeAttribute("pathLength"); path.removeAttribute("stroke-dasharray") }
  } else if (p.kind === "group" || p.kind === "null") {
    position(element, p.rect.x, p.rect.y, p.rect.width, p.rect.height)
    element.style.pointerEvents = "none"
  } else {
    const img = element as HTMLImageElement
    const { x, y, width, height } = p.rect
    position(img, x, y, width, height)
    img.style.objectFit = p.fit
    img.style.borderRadius = p.radius ? p.radius + "px" : ""
    if (img.getAttribute("src") !== p.src) img.src = p.src
  }
}

export function renderHybridScene(root: HTMLElement, scene: ResolvedScene): HybridRenderHandle {
  mounted.get(root)?.dispose()
  const surface = document.createElement("div")
  surface.dataset.sceneSurface = "true"
  const world = document.createElement("div")
  world.dataset.sceneWorld = "true"
  Object.assign(root.style, { position: "relative", overflow: "hidden" })
  Object.assign(surface.style, { position: "absolute", left: "0", top: "0", transformOrigin: "0 0" })
  Object.assign(world.style, { position: "absolute", inset: "0", transformOrigin: "0 0" })
  const screen = document.createElement("div")
  screen.dataset.sceneScreen = "true"
  Object.assign(screen.style, { position: "absolute", inset: "0" })
  // The mask lives on a wrapper in screen space, so it does not move with the camera.
  const masked = document.createElement("div")
  Object.assign(masked.style, { position: "absolute", inset: "0" })
  masked.append(world)
  const under = document.createElement("div")
  under.dataset.sceneUnmasked = "true"
  Object.assign(under.style, { position: "absolute", inset: "0", transformOrigin: "0 0" })
  surface.append(under, masked, screen)
  root.replaceChildren(surface)

  // `key` caches the last drawn primitive: an unchanged primitive is not re-styled (inspector playback with hundreds of elements).
  const nodes = new Map<string, { kind: string; node: Element; layer: Element; drawn?: ResolvedPrimitive; perspective?: boolean }>()
  let designWidth = scene.canvas.width
  let designHeight = scene.canvas.height
  let order: string[] = []
  const resize = () => { surface.style.transform = "scale(" + root.clientWidth / designWidth + ")" }
  const observer = new ResizeObserver(resize)
  observer.observe(root)

  const handle: HybridRenderHandle = {
    update(next) {
      if (mounted.get(root) !== handle) throw new Error("Scene renderer is disposed")
      if (designWidth !== next.canvas.width || designHeight !== next.canvas.height || !surface.style.width) {
        designWidth = next.canvas.width
        designHeight = next.canvas.height
        root.style.aspectRatio = designWidth + " / " + designHeight
        surface.style.width = designWidth + "px"
        surface.style.height = designHeight + "px"
        resize()
      }
      // docs/02: no resize() per update — reading clientWidth after DOM writes forced a layout every frame;
      // the ResizeObserver keeps the scale in step with the root size.
      const bg = next.background ?? "transparent"
      root.style.backgroundColor = isGradientFill(bg) ? "" : bg
      root.style.backgroundImage = isGradientFill(bg) ? bg : ""
      // docs/04: a non-flat 3D view bakes the camera into every world primitive, so the layers stay unmoved.
      const perspective = next.view3d !== undefined && !next.view3d.flat
      world.style.transform = under.style.transform = next.camera && !perspective ? "matrix(" + next.camera.join(",") + ")" : ""
      const mask = next.worldMask ? "linear-gradient(to bottom, " +
        next.worldMask.map(([at, alpha]) => "rgba(0,0,0," + alpha + ") " + at * 100 + "%").join(", ") + ")" : ""
      masked.style.setProperty("mask-image", mask)
      masked.style.setProperty("-webkit-mask-image", mask)
      const ids = new Set(next.primitives.map(p => p.id))
      let reorder = order.length !== next.primitives.length || next.primitives.some((p, i) => order[i] !== p.id + (p.layer ?? "") + (p.ignoreMask ? "~" : ""))
      for (const [id, value] of nodes) {
        if (!ids.has(id)) { value.layer.remove(); nodes.delete(id) }
      }
      for (const p of next.primitives) {
        let entry = nodes.get(p.id)
        const kind = p.kind === "line" && p.d !== undefined ? "curve" : p.kind
        if (entry?.kind !== kind) {
          entry?.layer.remove()
          const node = p.kind === "line" ? document.createElementNS(svg, kind === "curve" ? "path" : "line") :
            document.createElement(p.kind === "image" ? "img" : "div")
          node.setAttribute("data-primitive-id", p.id)
          node.setAttribute("data-renderer", p.kind === "line" ? "svg" : "dom")
          if (node instanceof HTMLElement) node.style.position = "absolute"
          if (node instanceof HTMLImageElement) { node.alt = ""; node.draggable = false }
          // An inline SVG occupies one slot in the same paint order as the DOM objects.
          let layer: Element = node
          if (p.kind === "line") {
            const viewport = document.createElementNS(svg, "svg")
            Object.assign(viewport.style, { position: "absolute", inset: "0", width: "100%", height: "100%",
              overflow: "visible", pointerEvents: "none" })
            viewport.append(node)
            layer = viewport
          }
          entry = { kind, node, layer }
          nodes.set(p.id, entry)
          reorder = true
        }
        // docs/02: unchanged primitive (deep-equal to the one drawn last) → no DOM writes.
        if (entry.perspective !== perspective || !same(entry.drawn, p)) { draw(entry.node, p, perspective); entry.drawn = p; entry.perspective = perspective }
      }
      if (reorder) {
        for (const p of next.primitives) (p.layer === "screen" ? screen : p.ignoreMask ? under : world).append(nodes.get(p.id)!.layer)
        order = next.primitives.map(p => p.id + (p.layer ?? "") + (p.ignoreMask ? "~" : ""))
      }
    },
    dispose() {
      observer.disconnect()
      if (mounted.get(root) === handle) { mounted.delete(root); surface.remove() }
    },
  }
  mounted.set(root, handle)
  handle.update(scene)
  return handle
}
