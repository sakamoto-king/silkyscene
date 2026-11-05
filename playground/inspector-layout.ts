/** Panel resize handles for the inspector shell. Theme colors unchanged. */

export type LayoutSizes = { left: number; right: number; tl: number }

export const LAYOUT_DEFAULTS: LayoutSizes = { left: 248, right: 340, tl: 196 }
export const LAYOUT_MIN: LayoutSizes = { left: 160, right: 220, tl: 120 }
export const LAYOUT_MAX: LayoutSizes = { left: 480, right: 560, tl: 480 }
const STORAGE_KEY = "silkyscene.inspector.layout.v1"
const STEP = 8

function clamp(key: keyof LayoutSizes, value: number) {
  return Math.max(LAYOUT_MIN[key], Math.min(LAYOUT_MAX[key], Math.round(value)))
}

function readStored(): LayoutSizes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...LAYOUT_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<LayoutSizes>
    return {
      left: clamp("left", Number(parsed.left) || LAYOUT_DEFAULTS.left),
      right: clamp("right", Number(parsed.right) || LAYOUT_DEFAULTS.right),
      tl: clamp("tl", Number(parsed.tl) || LAYOUT_DEFAULTS.tl),
    }
  } catch {
    return { ...LAYOUT_DEFAULTS }
  }
}

function writeStored(sizes: LayoutSizes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes))
  } catch { /* private mode */ }
}

function apply(sizes: LayoutSizes) {
  const root = document.documentElement
  root.style.setProperty("--left-w", sizes.left + "px")
  root.style.setProperty("--right-w", sizes.right + "px")
  root.style.setProperty("--tl-h", sizes.tl + "px")
}

export function connectLayout(app: HTMLElement) {
  let sizes = readStored()
  apply(sizes)

  const leftHandle = app.querySelector<HTMLElement>("#rszLeft")!
  const rightHandle = app.querySelector<HTMLElement>("#rszRight")!
  const bottomHandle = app.querySelector<HTMLElement>("#rszBottom")!

  leftHandle.setAttribute("aria-valuenow", String(sizes.left))
  rightHandle.setAttribute("aria-valuenow", String(sizes.right))
  bottomHandle.setAttribute("aria-valuenow", String(sizes.tl))
  leftHandle.setAttribute("aria-valuemin", String(LAYOUT_MIN.left))
  leftHandle.setAttribute("aria-valuemax", String(LAYOUT_MAX.left))
  rightHandle.setAttribute("aria-valuemin", String(LAYOUT_MIN.right))
  rightHandle.setAttribute("aria-valuemax", String(LAYOUT_MAX.right))
  bottomHandle.setAttribute("aria-valuemin", String(LAYOUT_MIN.tl))
  bottomHandle.setAttribute("aria-valuemax", String(LAYOUT_MAX.tl))

  type Edge = "left" | "right" | "tl"
  let drag: { edge: Edge; start: number; base: number; pointerId: number } | undefined

  function setSize(edge: Edge, value: number) {
    sizes = { ...sizes, [edge]: clamp(edge, value) }
    apply(sizes)
    writeStored(sizes)
    const handle = edge === "left" ? leftHandle : edge === "right" ? rightHandle : bottomHandle
    handle.setAttribute("aria-valuenow", String(sizes[edge]))
  }

  function begin(edge: Edge, event: PointerEvent, handle: HTMLElement) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const start = edge === "tl" ? event.clientY : event.clientX
    drag = { edge, start, base: sizes[edge], pointerId: event.pointerId }
    handle.classList.add("on")
    document.body.classList.add("is-resizing")
    if (edge === "tl") document.body.classList.add("is-resizing-row")
    handle.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.edge === "left") setSize("left", drag.base + (event.clientX - drag.start))
    else if (drag.edge === "right") setSize("right", drag.base - (event.clientX - drag.start))
    else setSize("tl", drag.base - (event.clientY - drag.start))
  }

  function end(event: PointerEvent, handle: HTMLElement) {
    if (!drag || drag.pointerId !== event.pointerId) return
    drag = undefined
    handle.classList.remove("on")
    document.body.classList.remove("is-resizing", "is-resizing-row")
  }

  function wire(handle: HTMLElement, edge: Edge) {
    handle.addEventListener("pointerdown", event => begin(edge, event, handle))
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", event => end(event, handle))
    handle.addEventListener("pointercancel", event => end(event, handle))
    handle.addEventListener("lostpointercapture", () => {
      drag = undefined
      handle.classList.remove("on")
      document.body.classList.remove("is-resizing", "is-resizing-row")
    })
    handle.addEventListener("dblclick", event => {
      event.preventDefault()
      setSize(edge, LAYOUT_DEFAULTS[edge])
    })
    handle.addEventListener("keydown", event => {
      const vertical = edge === "tl"
      let delta = 0
      if (!vertical && event.key === "ArrowLeft") delta = edge === "left" ? -STEP : STEP
      if (!vertical && event.key === "ArrowRight") delta = edge === "left" ? STEP : -STEP
      if (vertical && event.key === "ArrowUp") delta = STEP
      if (vertical && event.key === "ArrowDown") delta = -STEP
      if (event.key === "Home") { event.preventDefault(); setSize(edge, LAYOUT_DEFAULTS[edge]); return }
      if (!delta) return
      event.preventDefault()
      setSize(edge, sizes[edge] + (event.shiftKey ? delta * 4 : delta))
    })
  }

  wire(leftHandle, "left")
  wire(rightHandle, "right")
  wire(bottomHandle, "tl")

  // Keep panels inside the window when it shrinks.
  const onWindow = () => {
    const maxLeft = Math.max(LAYOUT_MIN.left, Math.floor(window.innerWidth * 0.4))
    const maxRight = Math.max(LAYOUT_MIN.right, Math.floor(window.innerWidth * 0.4))
    const maxTl = Math.max(LAYOUT_MIN.tl, Math.floor(window.innerHeight * 0.55))
    let next = { ...sizes }
    if (next.left > maxLeft) next.left = maxLeft
    if (next.right > maxRight) next.right = maxRight
    if (next.tl > maxTl) next.tl = maxTl
    if (next.left !== sizes.left || next.right !== sizes.right || next.tl !== sizes.tl) {
      sizes = next
      apply(sizes)
      writeStored(sizes)
    }
  }
  window.addEventListener("resize", onWindow)
  onWindow()

  return {
    get sizes() { return { ...sizes } },
    reset() {
      sizes = { ...LAYOUT_DEFAULTS }
      apply(sizes)
      writeStored(sizes)
      leftHandle.setAttribute("aria-valuenow", String(sizes.left))
      rightHandle.setAttribute("aria-valuenow", String(sizes.right))
      bottomHandle.setAttribute("aria-valuenow", String(sizes.tl))
    },
  }
}
