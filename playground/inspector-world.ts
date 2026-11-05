import { cameraCorners, regionRect, renderHybridScene } from "../src/index.js"
import type { HybridRenderHandle, InspectorFrame, PreparedProject } from "../src/index.js"
import { worldPoint } from "../src/pipeline/inspect.js"
import { DESIGN_PIXELS_PER_UNIT as U, worldToDesignPx } from "../src/shared/geometry.js"
import type { ResolvedRect } from "../src/shared/geometry.js"
import { inversePoint } from "../src/shared/cameraGeometry.js"
import type { Coordinate } from "../src/shared/cameraGeometry.js"

const ns = "http://www.w3.org/2000/svg"
const [originX, originY] = worldToDesignPx([0, 0])
type Layer = "grid" | "regions" | "anchors" | "path" | "nulls" | "arcs" | "camArcs"

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: SVGElement) {
  const node = document.createElementNS(ns, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  parent.append(node)
  return node
}

function extent(rects: ResolvedRect[]): ResolvedRect {
  const x = Math.floor(Math.min(...rects.map(r => r.x)))
  const y = Math.floor(Math.min(...rects.map(r => r.y)))
  return { x, y, width: Math.ceil(Math.max(...rects.map(r => r.x + r.width))) - x,
    height: Math.ceil(Math.max(...rects.map(r => r.y + r.height))) - y }
}

export function worldOverview(
  world: SVGSVGElement, coordinate: HTMLElement, zoomLabel: HTMLElement, select: (id: string) => void,
) {
  const grid = svg("g", { "pointer-events": "none" }, world)
  const content = svg("foreignObject", { "pointer-events": "none" }, world)
  const root = document.createElementNS("http://www.w3.org/1999/xhtml", "div")
  content.append(root)
  // docs/02: static marks (regions, camera / body paths, route) are rebuilt only when the project, view, layers or selection
  // change; per-frame marks are a handful of nodes (selection box, anchor / null crosses as one path each, camera frame).
  const fixed = svg("g", { "pointer-events": "none", "data-marks": "static" }, world)
  const marks = svg("g", { "pointer-events": "none", "data-marks": "frame" }, world)
  const hits = svg("g", {}, world)
  const layers: Record<Layer, boolean> = { grid: true, regions: true, anchors: true, path: true, nulls: true, arcs: true, camArcs: true }
  let handle: HybridRenderHandle | undefined
  let box: ResolvedRect = { x: 0, y: 0, width: 1920, height: 1080 }
  let view = { ...box }
  let bounds = { ...box }
  let route: Coordinate[] = []
  let frame: InspectorFrame | undefined
  let selection = ""
  /** More than this many elements: element arcs are drawn for the selected element only. */
  const HEAVY_ELEMENTS = 200
  let heavy = false
  let fixedKey = ""
  let drag: { x: number; y: number; view: ResolvedRect; pointerId: number; moved: boolean; hitId?: string } | undefined
  const CLICK_PX = 4

  function screenPoint(event: MouseEvent): Coordinate {
    const ctm = world.getScreenCTM()
    if (!ctm) return [0, 0]
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
    return [point.x, point.y]
  }
  // docs/02: the stage width is read once per view change (setView), not per mark — a read after DOM writes forces layout.
  let worldWidth = 0
  const screenUnit = () => view.width / Math.max(worldWidth || (worldWidth = world.clientWidth), 1)

  function cross(parent: SVGElement, [x, y]: Coordinate, radius: number, color: string) {
    svg("path", { d: "M" + (x - radius) + " " + y + "h" + (2 * radius) +
      "M" + x + " " + (y - radius) + "v" + (2 * radius), fill: "none", stroke: color,
      "vector-effect": "non-scaling-stroke" }, parent)
  }

  function gridLines() {
    grid.replaceChildren()
    if (!layers.grid) return
    const sw = screenUnit()
    const defs = svg("defs", {}, grid)
    for (const [id, unit, color] of [
      ["fine-grid", U / 20, "var(--rule)"], ["major-grid", U / 2, "var(--grid-major)"],
    ] as const) {
      const pattern = svg("pattern", { id, x: originX, y: originY, width: unit, height: unit, patternUnits: "userSpaceOnUse" }, defs)
      svg("path", { d: "M" + unit + " 0H0V" + unit, stroke: color, fill: "none",
        "vector-effect": "non-scaling-stroke" }, pattern)
      svg("rect", { ...view, fill: "url(#" + id + ")" }, grid)
    }
    const font = { fill: "var(--muted)", "font-size": 10.5 * sw, "font-family": "var(--font-mono)" }
    const step = Math.max(1, Math.ceil(sw / 4)) * U / 2
    for (let x = originX + Math.ceil((view.x - originX) / step) * step; x < view.x + view.width; x += step) {
      svg("text", { ...font, x: x + 4 * sw, y: view.y + 14 * sw }, grid).textContent = worldPoint([x, originY]).u[0].toFixed(1) + "u"
    }
    for (let y = originY + Math.ceil((view.y - originY) / step) * step; y < view.y + view.height; y += step) {
      svg("text", { ...font, x: view.x + 4 * sw, y: y - 4 * sw }, grid).textContent = worldPoint([originX, y]).u[1].toFixed(1) + "u"
    }
  }

  /** Marks that do not depend on the frame: rebuilt on project / view / layer / selection change only. */
  function overlaysStatic() {
    const key = view.x + "," + view.y + "," + view.width + "|" + Object.values(layers).join("") + "|" + selection + "|" + (frame ? "1" : "0")
    if (key === fixedKey) return
    fixedKey = key
    fixed.replaceChildren()
    if (!frame) return
    const sw = screenUnit()
    for (const region of frame.regions) {
      if (layers.regions) {
        svg("rect", { ...region.rect, fill: "none", stroke: "var(--region)",
          "stroke-dasharray": "5 4", "vector-effect": "non-scaling-stroke" }, fixed)
        svg("text", { x: region.rect.x, y: region.rect.y - 5 * sw, fill: "var(--region)",
          "font-size": 11 * sw, "font-family": "var(--font-mono)", "font-weight": 700 }, fixed)
          .textContent = "region · " + region.declaration.id
      }
      if (selection === "region:" + region.declaration.id) {
        svg("rect", { ...region.rect, fill: "none", stroke: "var(--sel)", "stroke-width": 2,
          "vector-effect": "non-scaling-stroke" }, fixed)
      }
    }
    if (layers.path) {
      svg("polyline", { points: route.map(p => p.join(",")).join(" "), stroke: "var(--faint)", fill: "none",
        "stroke-dasharray": "2 3", "vector-effect": "non-scaling-stroke", "data-cam-route": "" }, fixed)
    }
    const camera = frame.camera
    // docs/04 camera moves: look target path (cyan over ink) and the trailing framing path (ink, dashed).
    if (layers.camArcs && !camera.body) {
      for (const m of camera.moves) {
        const pts = (p: readonly Coordinate[]) => p.map(q => q.join(",")).join(" ")
        svg("polyline", { points: pts(m.paths.look), fill: "none", stroke: "var(--camera)", "stroke-width": 5,
          opacity: 0.55, "vector-effect": "non-scaling-stroke" }, fixed)
        svg("polyline", { points: pts(m.paths.look), fill: "none", stroke: "var(--look)", "stroke-width": 3,
          "vector-effect": "non-scaling-stroke", "data-cam-look": m.look.start }, fixed)
        svg("polyline", { points: pts(m.paths.frame), fill: "none", stroke: "var(--camera)", "stroke-width": 1.6,
          "stroke-dasharray": "6 4", "vector-effect": "non-scaling-stroke", "data-cam-frame": m.frame.start }, fixed)
      }
    }
    // docs/04 v03: both body paths projected to the canvas plane, same width, solid; colour is the only difference.
    const body = camera.body
    if (body && layers.camArcs) {
      for (const m of body.targetMoves) svg("polyline", { points: m.path.map(q => q.join(",")).join(" "), fill: "none", stroke: "var(--look)",
        "stroke-width": 2.4, "vector-effect": "non-scaling-stroke", "data-cam-target-path": m.start }, fixed)
      for (const m of body.moves) svg("polyline", { points: m.path.map(q => q.join(",")).join(" "), fill: "none", stroke: "var(--camera)",
        "stroke-width": 2.4, "vector-effect": "non-scaling-stroke", "data-cam-body-path": m.start }, fixed)
    }
  }

  function overlays() {
    overlaysStatic()
    marks.replaceChildren()
    if (!frame) return
    const sw = screenUnit()
    // Anchor and null crosses of every element go into one path each (hundreds of elements stay two DOM nodes).
    let anchorsD = "", nullsD = "", arcsD = ""
    for (const { declaration, primitive, box, anchor, arcs } of frame.elements) {
      const on = declaration.id === selection
      if (primitive.kind === "line" && (primitive.connected === false || on)) {
        svg(primitive.d ? "path" : "line", { ...(primitive.d ? { d: primitive.d, fill: "none" } : { x1: primitive.x1, y1: primitive.y1, x2: primitive.x2, y2: primitive.y2 }),
          stroke: "var(--ink)", "stroke-dasharray": "6 6", "stroke-width": 2, opacity: 0.65,
          "vector-effect": "non-scaling-stroke" }, marks)
        if (primitive.connected === false) {
          svg("text", { x: (primitive.x1 + primitive.x2) / 2, y: (primitive.y1 + primitive.y2) / 2 - 6 * sw,
            fill: "var(--ink)", "font-size": 11 * sw, "text-anchor": "middle" }, marks).textContent = "断开"
        }
      }
      if (on && box) {
        svg("rect", { ...box, fill: "var(--sel-soft)", stroke: "var(--sel)", "stroke-width": 2,
          "vector-effect": "non-scaling-stroke" }, marks)
        for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
          svg("rect", { x: box.x + dx * box.width - 3.5 * sw, y: box.y + dy * box.height - 3.5 * sw,
            width: 7 * sw, height: 7 * sw, fill: "var(--panel)", stroke: "var(--sel)",
            "vector-effect": "non-scaling-stroke" }, marks)
        }
      }
      // Null objects: a small diagonal cross so they read differently from anchor marks.
      if (layers.nulls && primitive.kind === "null" && anchor) {
        const [x, y] = anchor.px, r = 6 * sw
        const d = "M" + (x - r) + " " + (y - r) + "L" + (x + r) + " " + (y + r) + "M" + (x + r) + " " + (y - r) + "L" + (x - r) + " " + (y + r)
        if (on) svg("path", { d, fill: "none", stroke: "var(--accent)", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", "data-null": declaration.id }, marks)
        else nullsD += d
      }
      // Arc moves: the resolved quadratic of every free x/y cue; the selected element's arcs are drawn solid.
      // Heavy scenes (> HEAVY_ELEMENTS) draw the selected element's arcs only.
      if (layers.arcs && declaration.kind !== "line" && (on || !heavy)) for (const a of arcs) {
        if (!a.points.length) continue
        if (on) svg("polyline", { points: a.points.map(p => p.join(",")).join(" "), fill: "none", stroke: "var(--accent)",
          "stroke-width": 2, opacity: 0.9, "vector-effect": "non-scaling-stroke", "data-arc": declaration.id }, marks)
        else arcsD += "M" + a.points.map(p => p.join(",")).join("L")
      }
      if (layers.anchors && anchor) {
        const [x, y] = anchor.px, r = 4 * sw
        if (on) cross(marks, anchor.px, r, "var(--accent)")
        else anchorsD += "M" + (x - r) + " " + y + "h" + (2 * r) + "M" + x + " " + (y - r) + "v" + (2 * r)
      }
    }
    if (arcsD) svg("path", { d: arcsD, fill: "none", stroke: "var(--accent)", "stroke-width": 1, opacity: 0.45, "stroke-dasharray": "4 3",
      "vector-effect": "non-scaling-stroke", "data-arc": "*" }, marks)
    if (nullsD) svg("path", { d: nullsD, fill: "none", stroke: "var(--ink)", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", "data-null": "*" }, marks)
    if (anchorsD) svg("path", { d: anchorsD, fill: "none", stroke: "var(--region)", "vector-effect": "non-scaling-stroke", "data-anchors": "" }, marks)
    const camera = frame.camera
    const labelPoint = (px: Coordinate, text: string, fill: string, kind: string) => {
      const [x, y] = px
      svg("text", { x: x + 10 * sw, y: y - 8 * sw, "font-size": 11 * sw, "font-weight": 700,
        "font-family": "var(--font-mono)", fill, stroke: "var(--panel)", "paint-order": "stroke",
        "stroke-width": 2 * sw, "data-cam-label": kind }, marks).textContent = text
    }
    // Current look / framing stay visible even when the path layer is off, so lag reads clearly.
    if (camera.look) {
      const [lx, ly] = camera.look.px
      svg("circle", { cx: lx, cy: ly, r: 7 * sw, fill: "var(--look)", stroke: "var(--camera)", "stroke-width": 1.5,
        "vector-effect": "non-scaling-stroke", "data-cam-look-point": "" }, marks)
      labelPoint(camera.look.px, "目标点", "var(--camera)", "look")
    }
    const corners = camera.corners.map(c => c.px)
    svg("polygon", { points: corners.map(p => p.join(",")).join(" "), fill: "var(--camera-soft)", stroke: "var(--camera)",
      "stroke-width": 2.2, "vector-effect": "non-scaling-stroke" }, marks)
    for (const [x, y] of corners) {
      svg("rect", { x: x - 3 * sw, y: y - 3 * sw, width: 6 * sw, height: 6 * sw,
        fill: "var(--camera-mark)", stroke: "var(--camera)", "vector-effect": "non-scaling-stroke" }, marks)
    }
    cross(marks, camera.target.px, 9 * sw, "var(--camera)")
    labelPoint(camera.target.px, "取景中心", "var(--camera)", "frame")
    // docs/04: footprint on z = 0, and the eye → framing-center sight line (not the look target).
    const v3 = camera.view3d
    // docs/04: camera body (written track) — its path and the current point, drawn even when the frame is flat.
    const body = camera.body
    if (body) {
      // docs/04 v03: one rule for both paths — projected to the canvas plane (x, y), same width, solid; colour is the only difference.
      // z never moves a path; it is written as text at the path's middle (peak) and end.
      const zText = (zs: number[]) => { const lo = Math.min(...zs), hi = Math.max(...zs); return hi - lo < 5e-4 ? "z " + lo.toFixed(2) + " u" : "z " + zs[0]!.toFixed(2) + "→峰 " + hi.toFixed(2) + "→" + zs[zs.length - 1]!.toFixed(2) + " u" }
      // Label only the move running now (or the last one started) to keep the view readable; every path is still drawn.
      const now = frame.time, latest = (ms: { start: number }[]) => Math.max(-1, ...ms.filter(m => m.start <= now + 1e-9).map(m => m.start))
      const tLatest = latest(body.targetMoves), bLatest = latest(body.moves)
      const pathRule = (pts: Coordinate[], _stroke: string, label: string, data: string, key: number) => {
        if (layers.camArcs) {
          const labelled = key === (data === "data-cam-target-path" ? tLatest : bLatest)
          // The path itself is a static mark (overlaysStatic); only the label of the move running now is per frame.
          const mid = pts[Math.floor(pts.length / 2)]!
          if (labelled) svg("text", { x: mid[0] + 8 * sw, y: mid[1] - 6 * sw, "font-size": 10 * sw, "font-family": "var(--font-mono)", fill: "var(--camera)",
            stroke: "var(--panel)", "paint-order": "stroke", "stroke-width": 2 * sw, "data-path-z": data }, marks).textContent = label
        }
      }
      for (const m of body.targetMoves) pathRule(m.path, "var(--look)", "目标点 " + zText(m.z), "data-cam-target-path", m.start)
      for (const m of body.moves) pathRule(m.path, "var(--camera)", "摄像机 " + zText(m.z), "data-cam-body-path", m.start)
      const lookPx = camera.look?.px ?? camera.target.px
      svg("line", { x1: body.px[0], y1: body.px[1], x2: lookPx[0], y2: lookPx[1], stroke: "var(--camera)",
        "stroke-width": 1.6, "vector-effect": "non-scaling-stroke", "data-cam3d-sight": "" }, marks)
      svg("rect", { x: body.px[0] - 7 * sw, y: body.px[1] - 7 * sw, width: 14 * sw, height: 14 * sw, fill: "var(--camera)",
        stroke: "var(--look)", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", "data-cam-body": "" }, marks)
      const r = v3?.resolved as { pitch: number; yaw: number; sight?: number } | undefined
      svg("text", { x: body.px[0] + 12 * sw, y: body.px[1] + 16 * sw, "font-size": 11 * sw, "font-weight": 700,
        "font-family": "var(--font-mono)", fill: "var(--camera)", stroke: "var(--panel)", "paint-order": "stroke", "stroke-width": 2 * sw, "data-cam-label": "body" }, marks)
        .textContent = "摄像机 · z " + body.z.toFixed(3) + " u" + (r ? " · 俯仰(推导) " + r.pitch.toFixed(1) + "° · 偏转(推导) " + r.yaw.toFixed(1) + "°" +
          (r.sight !== undefined ? " · 距离(推导) " + r.sight.toFixed(3) + " u" : "") : "")
    }
    if (v3 && !v3.flat) {
      svg("polygon", { points: v3.footprint.map(p => p.join(",")).join(" "), fill: "none", stroke: "var(--look)", "stroke-width": 3,
        "stroke-dasharray": "10 6", "vector-effect": "non-scaling-stroke", "data-cam3d-footprint": "" }, marks)
      if (!body) svg("line", { x1: v3.eye.px[0], y1: v3.eye.px[1], x2: camera.target.px[0], y2: camera.target.px[1], stroke: "var(--camera)",
        "stroke-width": 1.6, "vector-effect": "non-scaling-stroke", "data-cam3d-sight": "" }, marks)
      if (!body) svg("rect", { x: v3.eye.px[0] - 6 * sw, y: v3.eye.px[1] - 6 * sw, width: 12 * sw, height: 12 * sw, fill: "var(--look)",
        stroke: "var(--camera)", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", "data-cam3d-eye": "" }, marks)
      if (!body) svg("text", { x: v3.eye.px[0] + 10 * sw, y: v3.eye.px[1] + 4 * sw, "font-size": 11 * sw, "font-weight": 700,
        "font-family": "var(--font-mono)", fill: "var(--camera)", stroke: "var(--panel)", "paint-order": "stroke", "stroke-width": 2 * sw }, marks)
        .textContent = "摄像机 · z " + (v3.eye.z / 1080).toFixed(3) + " u · 俯仰 " + v3.resolved.pitch.toFixed(1) + "° · 偏转 " + v3.resolved.yaw.toFixed(1) + "°"
    }
    const [x, y] = corners[0]!
    svg("rect", { x, y: y - 20 * sw, width: 204 * sw, height: 18 * sw, fill: "var(--camera-mark)",
      stroke: "var(--camera)", "vector-effect": "non-scaling-stroke" }, marks)
    svg("text", { x: x + 6 * sw, y: y - 7 * sw, "font-size": 11 * sw, "font-weight": 700,
      "font-family": "var(--font-mono)", fill: "var(--camera)" }, marks).textContent =
      "CAMERA · zoom " + camera.zoom.toFixed(3) + " · roll " + camera.roll.toFixed(2)
    if (layers.grid) {
      svg("circle", { cx: originX, cy: originY, r: 3 * sw, fill: "var(--muted)",
        stroke: "var(--panel)", "data-world-origin": "" }, marks)
      svg("text", { x: originX + 6 * sw, y: originY - 6 * sw, fill: "var(--muted)",
        stroke: "var(--panel)", "paint-order": "stroke", "stroke-width": 2 * sw, "font-size": 10.5 * sw,
        "font-family": "var(--font-mono)" }, marks).textContent = "原点 (0,0) · Y 向上"
    }
  }

  function setView() {
    world.setAttribute("viewBox", [view.x, view.y, view.width, view.height].join(" "))
    worldWidth = world.clientWidth
    zoomLabel.textContent = Math.round(worldWidth / view.width * 100) + "%"
    gridLines()
    overlays()
  }

  function fit() {
    const aspect = Math.max(1, world.clientWidth) / Math.max(1, world.clientHeight)
    const w = Math.max(2200, bounds.width + 160, (bounds.height + 160) * aspect, 1240 * aspect)
    const h = w / aspect
    view = { x: bounds.x + (bounds.width - w) / 2, y: bounds.y + (bounds.height - h) / 2 - 20, width: w, height: h }
    setView()
  }
  function setProject(project: PreparedProject, last: number, fps: number, resetView: boolean) {
    heavy = project.document.elements.length > HEAVY_ELEMENTS
    fixedKey = ""
    const regions = project.document.regions.map(regionRect)
    const worldIds = new Set(project.scene.primitives.filter(p => p.layer !== "screen").map(p => p.id))
    box = extent([{ x: 0, y: 0, ...project.scene.canvas }, ...regions,
      ...[...project.boxes].filter(([id]) => worldIds.has(id)).map(([, b]) => b)])
    bounds = box
    const corners: ResolvedRect[] = []
    route = []
    for (let f = 0; f <= last; f += 3) {
      // docs/02: camera matrix only (cameraAt), not a full resolve of every element per sample.
      const cameraAt = (project as { cameraAt?: (t: number) => readonly [number, number, number, number, number, number] }).cameraAt
      const canvas = project.scene.canvas
      const camera = cameraAt ? cameraAt(f / fps) : project.renderAt(f / fps).camera
      if (!camera) continue
      route.push(inversePoint(camera, [canvas.width / 2, canvas.height / 2]))
      corners.push(...cameraCorners(camera, canvas.width, canvas.height).map(({ px: [x, y] }) => ({ x, y, width: 0, height: 0 })))
    }
    bounds = extent([bounds, ...corners])
    for (const [key, value] of Object.entries(box)) content.setAttribute(key, String(value))
    root.style.width = box.width + "px"
    hits.replaceChildren()
    for (const region of project.document.regions) {
      svg("rect", { ...regionRect(region), fill: "transparent", "data-select": "region:" + region.id }, hits)
    }
    for (const p of project.scene.primitives) {
      if (p.layer === "screen") continue
      const b = project.boxes.get(p.id)
      if (b) svg("rect", { ...b, fill: "transparent", "data-select": p.id }, hits)
      else if (p.kind === "line") svg("line", { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, stroke: "transparent",
        "stroke-width": 14, "vector-effect": "non-scaling-stroke", "data-select": p.id }, hits)
    }
    if (resetView) fit()
    else setView()
  }

  world.addEventListener("wheel", event => {
    event.preventDefault()
    const p = screenPoint(event)
    const factor = Math.max(160 / view.width, Math.min(60000 / view.width, event.deltaY > 0 ? 1.12 : 1 / 1.12))
    view = { x: p[0] - (p[0] - view.x) * factor, y: p[1] - (p[1] - view.y) * factor,
      width: view.width * factor, height: view.height * factor }
    setView()
  }, { passive: false })
  function clearNativeSelection() {
    const sel = window.getSelection()
    if (sel && sel.rangeCount) sel.removeAllRanges()
  }
  function endPan(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return
    const moved = drag.moved
    const hitId = drag.hitId
    drag = undefined
    world.classList.remove("panning")
    clearNativeSelection()
    if (!moved && hitId) select(hitId)
  }
  world.addEventListener("pointerdown", event => {
    if (event.button !== 0) return
    // Always pan on drag; click (small move) selects. Block native text selection.
    event.preventDefault()
    clearNativeSelection()
    const hit = (event.target as Element).closest("[data-select]")?.getAttribute("data-select")
    drag = { x: event.clientX, y: event.clientY, view: { ...view }, pointerId: event.pointerId, moved: false }
    if (hit) drag.hitId = hit
    world.classList.add("panning")
    world.setPointerCapture(event.pointerId)
  })
  world.addEventListener("pointermove", event => {
    if (drag && drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (!drag.moved && dx * dx + dy * dy >= CLICK_PX * CLICK_PX) drag.moved = true
      if (drag.moved) {
        const sw = screenUnit()
        view.x = drag.view.x - dx * sw
        view.y = drag.view.y - dy * sw
        setView()
        clearNativeSelection()
      }
    }
    const point = worldPoint(screenPoint(event))
    coordinate.textContent = "world " + point.u.map(v => Number(v.toFixed(3)).toFixed(3) + "u").join(", ") +
      " · " + point.px.map(Math.round).join(", ") + " px"
  })
  world.addEventListener("pointerup", endPan)
  world.addEventListener("pointercancel", endPan)
  world.addEventListener("lostpointercapture", () => {
    drag = undefined
    world.classList.remove("panning")
  })
  // Preserve world center when the stage size changes (panel resize); do not jump to fit.
  function onStageResize() {
    if (!world.clientWidth || !world.clientHeight) return
    const aspect = world.clientWidth / world.clientHeight
    const cx = view.x + view.width / 2
    const cy = view.y + view.height / 2
    const height = view.height
    const width = height * aspect
    view = { x: cx - width / 2, y: cy - height / 2, width, height }
    setView()
  }
  let firstResize = true
  const observer = new ResizeObserver(() => {
    if (firstResize) { firstResize = false; fit(); return }
    onStageResize()
  })
  observer.observe(world)
  return {
    setProject, fit,
    layer(key: Layer) { layers[key] = !layers[key]; setView(); return layers[key] },
    update(next: InspectorFrame, selected: string) {
      const frameChanged = next !== frame
      const selectionChanged = selected !== selection
      frame = next
      selection = selected
      if (frameChanged) {
        // The overview shows the world only: screen-layer HUD and the world mask belong to the camera picture.
        const { worldMask: _mask, view3d: _v3, ...world } = next.scene
        const scene = { ...world, canvas: { width: box.width, height: box.height }, background: "transparent",
          camera: [1, 0, 0, 1, -box.x, -box.y] as const, primitives: next.scene.primitives.filter(p => p.layer !== "screen") }
        if (handle) handle.update(scene)
        else handle = renderHybridScene(root, scene)
      }
      if (frameChanged || selectionChanged) overlays()
    },
  }
}
