import { deckSteps, documentField, inspectFrame, lintScene, lintSummary, parseTiming, prepareProject, renderHybridScene, sceneDuration, timingAnchors } from "../src/index.js"
import type { HybridRenderHandle, InspectorFrame, PreparedProject } from "../src/index.js"
import { cameraPanel, elementPanel } from "./inspector-panels.js"
import type { EditView } from "./inspector-panels.js"
import { worldOverview } from "./inspector-world.js"
import { connectLayout } from "./inspector-layout.js"
import { easeLabel } from "./inspector-ease.js"

const params = new URL(location.href).searchParams
/** 官方样片（默认打开第 1 支）；其它任意 ?doc=<name> 也能打开，总帧数按最后一个节点推算。 */
const EXAMPLES: Record<string, { label: string; select: string }> = {
  "topology-flow": { label: "清单到拓扑 · 依赖重排", select: "root" },
  "scale-matrix": { label: "微距到全局 · 尺度矩阵", select: "matrix" },
  "canvas-handoff": { label: "节点协作 · 跨层微交互", select: "btn" },
}
const rawDoc = params.get("doc")?.trim() || "topology-flow"
if (!/^[a-zA-Z0-9_.-]+$/.test(rawDoc)) throw new Error("?doc= 只接受文件名（字母数字 _ - .）")
const config = { name: rawDoc, label: EXAMPLES[rawDoc]?.label ?? rawDoc, select: EXAMPLES[rawDoc]?.select ?? "camera" }
/** 跳转按钮：时间表里的演示步点（steps → segments → 锚点），载入后填充。 */
let keys: (readonly [string, number])[] = []
const fps = 30
let last = Math.max(30, Math.round(Number(params.get("dur") || 24) * fps))
const projectUrl = new URL("./" + config.name + ".scene.json", import.meta.url)
const timingUrl = new URL("./" + config.name + "-timing.json", import.meta.url)
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const initialFrame = Number(params.get("frame") ?? 0)
let frame = Number.isFinite(initialFrame) ? Math.max(0, Math.round(initialFrame)) : 0
let selected = params.get("select") ?? config.select
let prepared: PreparedProject
let timing: ReadonlyMap<string, number>
/** Non-anchor keys of the timing file (e.g. the narration `segments` array), kept so「导出时间表」does not drop them. */
let timingExtra: Record<string, unknown> = {}
let snapshot: InspectorFrame | undefined
let pip: HybridRenderHandle | undefined
let edit: EditView = { enabled: false }
let editVersion = 0
let anim: number | undefined
/** v03 editor: picked cue indices (timeline), and the drag in progress. */
let picked = new Set<number>()
type Meta = { groups?: string[][]; ungrouped?: string[] }
const meta = (): Meta => { const d = prepared.document as { editor?: Meta }; return d.editor ??= {} }
const rows = new Map<string, HTMLElement>()
const view = worldOverview(document.querySelector<SVGSVGElement>("#world")!, el("coord"), el("zoomLabel"), select)
const mode = () => ({ baseUrl: projectUrl.href, anchors: timing })

// ===== docs/02 performance shell =====
/** Timeline filter: camera tracks only (default) / camera + selected element / every track. */
type TlMode = "camera" | "selected" | "all"
const PANELS_KEY = "silkyscene.inspector.panels.v1", TL_KEY = "silkyscene.inspector.timeline.v1"
const store = <T>(key: string): Record<string, T> => { try { return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, T> } catch { return {} } }
const keep = <T>(key: string, value: T) => { try { const all = store<T>(key); all[config.name] = value; localStorage.setItem(key, JSON.stringify(all)) } catch { /* private mode */ } }
let tlMode: TlMode = (v => v === "selected" || v === "all" ? v : "camera")(params.get("tracks") ?? store<string>(TL_KEY)[config.name])
const panels = { left: true, right: true }
/** Heavy scene: more than 200 elements or 2000 nodes (cues). Side panels start closed unless the user chose otherwise. */
const isHeavy = () => prepared.document.elements.length > 200 || prepared.document.cues.length > 2000
/** Right panel refresh while playing: about 10 fps. */
const PANEL_EVERY_MS = 100
let panelAt = -Infinity, treeAt = -Infinity, panelsDirty = true, treeDirty = true
function applyPanels() {
  const app = document.querySelector<HTMLElement>(".app")!
  app.dataset.left = panels.left ? "on" : "off"
  app.dataset.right = panels.right ? "on" : "off"
  el("toggleLeft").setAttribute("aria-pressed", String(panels.left))
  el("toggleRight").setAttribute("aria-pressed", String(panels.right))
  el("focusCanvas").textContent = panels.left || panels.right ? "专注画布" : "展开两栏"
  panelsDirty = treeDirty = true
}
function initPanels() {
  const all = params.get("panels"), l = params.get("left"), r = params.get("right"), saved = store<{ left: boolean; right: boolean }>(PANELS_KEY)[config.name]
  if (all === "0" || all === "1") panels.left = panels.right = all === "1"
  else if (saved) { panels.left = !!saved.left; panels.right = !!saved.right }
  else if (isHeavy()) { panels.left = panels.right = false; el("heavyNote").hidden = false }
  if (l === "0" || l === "1") panels.left = l === "1"
  if (r === "0" || r === "1") panels.right = r === "1"
  applyPanels()
}
function setPanels(left: boolean, right: boolean) {
  panels.left = left; panels.right = right
  keep(PANELS_KEY, { left, right })
  el("heavyNote").hidden = true
  applyPanels()
  show()
}
function lintBadge() {
  const list = lintScene(prepared.document, timing), warn = list.filter(w => w.level === "warning").length
  const badge = el<HTMLButtonElement>("lintBadge"), pop = el("lintPop")
  badge.hidden = list.length === 0
  badge.textContent = warn ? "⚠ 逐帧轨迹警告 (" + warn + ")" : "逐帧轨迹已报备 (" + list.length + ")"
  badge.title = lintSummary(list) + " · 点开查看明细"
  const esc = (v: unknown) => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!)
  pop.innerHTML = "<h4>" + esc(lintSummary(list)) + "</h4><p class=\"src\">" + esc(list[0]?.message ?? "") +
    "。规则：≥6 个关键帧且相邻间隔都 ≤0.07 s，或 ≥25 个关键帧且间隔中位数 ≤0.1 s。npm run lint:scene 可在命令行查看。</p>" +
    "<table><thead><tr><th>对象.属性</th><th>关键帧</th><th>时间段 s</th><th>间隔中位</th><th>状态</th><th></th></tr></thead><tbody>" +
    list.map(w => "<tr class=\"" + (w.level === "reported" ? "rep" : "") + "\"><td>" + esc((w.target === "camera" ? "摄像机" : w.target) + "." + w.property) + "</td><td>" + w.keyCount +
      (w.runKeys !== w.keyCount ? "（连续 " + w.runKeys + "）" : "") + "</td><td>" + w.start.toFixed(2) + "–" + w.end.toFixed(2) + "</td><td>" + w.medianGap.toFixed(3) +
      "</td><td>" + (w.level === "reported" ? "已报备：" + esc(w.reason ?? "") : "警告") + "</td><td><button class=\"go\" type=\"button\" data-lint-target=\"" + esc(w.target) +
      "\" data-lint-at=\"" + w.start + "\">定位</button></td></tr>").join("") + "</tbody></table>"
}

function solve(message: string, state: "ok" | "error" | "busy" = "ok") {
  const element = el("solveStatus")
  element.className = "pill " + (state === "ok" ? "ok" : "note")
  element.dataset.state = state
  element.lastElementChild!.textContent = message
}

function choose(id: string) {
  if (id === "camera" || prepared.document.elements.some(e => e.id === id) ||
    prepared.document.regions.some(r => "region:" + r.id === id)) return id
  return "camera"
}

function select(id: string) {
  if (!prepared) return
  const before = selected
  selected = choose(id)
  if (tlMode === "selected" && before !== selected) buildTimeline()
  panelsDirty = treeDirty = true
  show()
}

function makeRow(parent: HTMLElement, id: string, kind: string, glyph: string, label: string, z = "") {
  const row = document.createElement("div")
  row.className = "row"
  row.dataset.select = id
  row.tabIndex = 0
  row.setAttribute("role", "button")
  for (const [css, value] of [["z", z], ["kind k-" + kind, glyph], ["id", label], ["op", ""]] as const) {
    const cell = document.createElement("span")
    cell.className = css
    cell.textContent = value
    row.append(cell)
  }
  row.onclick = () => select(id)
  row.onkeydown = event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(id) }
  }
  parent.append(row)
  rows.set(id, row)
}
function buildTree() {
  const root = el("tree")
  const top = root.scrollTop
  root.replaceChildren()
  rows.clear()
  const group = (label: string) => {
    const g = document.createElement("div")
    g.className = "grp"
    const heading = document.createElement("div")
    heading.className = "eyebrow"
    heading.textContent = label
    g.append(heading)
    root.append(g)
    return g
  }
  makeRow(group("Camera"), "camera", "cam", "CAM", "camera")
  const regions = group("Regions · " + prepared.document.regions.length)
  for (const r of prepared.document.regions) makeRow(regions, "region:" + r.id, "region", "R", r.id)
  const entries = group("Elements · " + prepared.document.elements.length + " · 后→前")
  // Indent by group container only. Region names can equal element ids (e.g. poster), which must not enter the parent map.
  const parent = new Map(prepared.document.elements.map(e => {
    if (e.kind === "line") return [e.id, ""] as const
    const container = "container" in e.layout ? String(e.layout.container ?? "") : ""
    return [e.id, container] as const
  }))
  const regionOf = new Map(prepared.document.elements.map(e => [e.id, e.kind === "line" ? "" : e.layout.region]))
  const depth = (id: string, seen: Set<string> = new Set()): number => {
    if (seen.has(id)) return 0
    seen.add(id)
    const p = parent.get(id)
    return p && parent.has(p) ? 1 + depth(p, seen) : 0
  }
  prepared.document.elements.forEach((e, z) => {
    makeRow(entries, e.id, e.kind, { rect: "▭", text: "T", image: "▣", line: "╱", path: "✎", dots: "⁘", group: "▦", null: "✛" }[e.kind],
      (regionOf.get(e.id) === "screen" || parent.get(e.id) === "screen" ? "⎚ " : "") + e.id, String(z))
    rows.get(e.id)!.style.paddingLeft = 8 + depth(e.id) * 14 + "px"
  })
  root.scrollTop = top
}

/** Automatic binding key: one camera move (target family incl. zoom; body family incl. its z legs) or one element x·y move. */
function autoKey(i: number): string | null {
  const c = prepared.document.cues[i]!, start = timing.get(c.at) ?? 0, p = String(c.property)
  if (meta().ungrouped?.includes(c.at)) return null
  if (c.target === "camera") {
    if (p.startsWith("target.") || p === "zoom") return "T@" + start
    if (p.startsWith("approach.")) return "A@" + start
    if (p.startsWith("position.")) {
      // A z leg belongs to the x/y body move it falls inside.
      let host: number | undefined
      for (const d of prepared.document.cues) if (d.target === "camera" && (d.property === "position.x" || d.property === "position.y")) {
        const s = timing.get(d.at) ?? 0
        if (s <= start + 1e-9 && start < s + Math.max(d.duration, 1e-9) && (host === undefined || s > host)) host = s
      }
      return "P@" + (host ?? start)
    }
    return null
  }
  return p === "x" || p === "y" ? c.target + "@" + start : null
}
/** Anchors that move together with cue i: its explicit group, else its automatic group, else itself. */
function groupAnchors(i: number): Set<string> {
  const c = prepared.document.cues[i]!
  const explicit = meta().groups?.find(g => g.includes(c.at))
  if (explicit) return new Set(explicit)
  const k = autoKey(i)
  if (!k) return new Set([c.at])
  return new Set(prepared.document.cues.flatMap((d, j) => autoKey(j) === k ? [d.at] : []))
}
function cuesOfAnchors(anchors: Set<string>) {
  return new Set(prepared.document.cues.flatMap((d, j) => anchors.has(d.at) ? [j] : []))
}
function markPicked() {
  const anchors = new Set([...picked].map(i => prepared.document.cues[i]!.at))
  const group = new Set([...picked].flatMap(i => [...groupAnchors(i)]))
  document.querySelectorAll<HTMLElement>(".seg-cue").forEach(b => {
    b.classList.toggle("sel", anchors.has(b.dataset.at!)); b.classList.toggle("grp", group.has(b.dataset.at!) && !anchors.has(b.dataset.at!))
  })
  el("bindInfo").textContent = picked.size ? "已选 " + picked.size + " 个 · 同组 " + group.size + " 个锚点" : ""
}

function buildTimeline() {
  const names = el("tnames"), lanes = el("tlanes")
  const ticks = document.createElement("div")
  ticks.className = "hd ticks"
  const head = document.createElement("div")
  head.className = "hd"
  head.textContent = "轨道 target.property"
  names.replaceChildren(head)
  lanes.replaceChildren(ticks)
  const at = (seconds: number) => seconds / (last / fps) * 100 + "%"
  for (let s = 0; s <= last / fps; s++) {
    const tick = document.createElement("span")
    tick.style.left = at(s)
    tick.textContent = s + "s"
    ticks.append(tick)
  }
  const shown = (t: typeof prepared.tracks[number]) => {
    const target = t[0]?.target
    return tlMode === "all" || target === "camera" || (tlMode === "selected" && target === selected)
  }
  const visible = prepared.tracks.filter(shown)
  const shownAnchors = new Set(visible.flatMap(t => t.map(c => c.at)))
  el("tlCount").textContent = visible.length + " / " + prepared.tracks.length + " 条轨道"
  el("tlMode").querySelectorAll<HTMLButtonElement>("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === tlMode)))
  // Event markers only for anchors of the tracks shown, and only when they stay readable (heavy scenes have thousands).
  const markers = [...timing].filter(([id]) => shownAnchors.has(id))
  if (markers.length <= 80) for (const [id, t] of markers) {
    const marker = document.createElement("button")
    marker.type = "button"
    marker.className = "ev"
    marker.style.left = at(t)
    marker.style.top = "-1px"
    marker.textContent = id
    marker.title = id + " @ " + t + "s"
    marker.dataset.event = id
    marker.onclick = () => seek(Math.round(t * fps))
    ticks.append(marker)
  }
  // docs/04: camera rows grouped — 目标点 x/y/z, 摄像机 x/y/z, then zoom and the rest.
  const CAM_ORDER = ["target.x", "target.y", "target.z", "position.x", "position.y", "position.z", "approach.x", "approach.y", "zoom"]
  const CAM_NAME: Record<string, string> = { "target.x": "目标点 x", "target.y": "目标点 y", "target.z": "目标点 z",
    "position.x": "摄像机 x", "position.y": "摄像机 y", "position.z": "摄像机 z",
    "approach.x": "靠拢目标 x", "approach.y": "靠拢目标 y", zoom: "缩放 zoom" }
  const rank = (t: typeof prepared.tracks[number]) => t[0]?.target !== "camera" ? 100 : (i => i < 0 ? 50 : i)(CAM_ORDER.indexOf(String(t[0]?.property)))
  const tracks = visible.sort((a, b) => rank(a) - rank(b))
  for (const track of tracks) {
    const first = track[0]
    if (!first) continue
    const title = document.createElement("div")
    const camName = first.target === "camera" ? CAM_NAME[String(first.property)] : undefined
    title.textContent = camName ? camName + " · " + first.property : first.target + "." + first.property
    title.title = title.textContent
    if (camName) title.dataset.camGroup = String(first.property).startsWith("position.") ? "camera" : String(first.property).startsWith("target.") ? "target" : "zoom"
    names.append(title)
    const lane = document.createElement("div")
    for (const cue of track) {
      const block = document.createElement("div")
      const instant = cue.duration === 0
      block.className = "seg-cue" + (cue.target === "camera" ? " cam" : "") + (instant ? " inst" : "") +
        ""
      block.style.left = at(cue.start)
      if (!instant) block.style.width = at(cue.duration)
      if (instant && cue.property === "stroke" && "to" in cue && typeof cue.to === "string") block.style.backgroundColor = cue.to
      block.title = cue.at + " → " + JSON.stringify("to" in cue ? cue.to : cue.path) + " · " + easeLabel("ease" in cue ? cue.ease : undefined)
      block.dataset.cue = String(cue.index)
      block.dataset.at = cue.at
      block.tabIndex = 0
      block.setAttribute("role", "button")
      block.setAttribute("aria-label", cue.target + " " + cue.property + " " + cue.at)
      block.onclick = event => {
        if (edit.enabled) {
          if (moved) return
          if (event.shiftKey) { const g = cuesOfAnchors(groupAnchors(cue.index)); const all = [...g].every(j => picked.has(j)); for (const j of g) { if (all) picked.delete(j); else picked.add(j) } }
          else picked = cuesOfAnchors(groupAnchors(cue.index))
          markPicked()
        }
        selected = choose(cue.target); seek(Math.round(cue.start * fps))
      }
      block.addEventListener("pointerdown", event => startDrag(event, cue.index, block))
      // Shift+click selects page text; dragging that selection would start native drag-and-drop and cancel the pointer.
      block.ondragstart = event => event.preventDefault()
      block.onkeydown = event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); block.click() }
      }
      lane.append(block)
    }
    lanes.append(lane)
  }
  const playhead = document.createElement("div")
  playhead.id = "ph"
  playhead.className = "playhead"
  lanes.append(playhead)
  markPicked()
}

// v03: drag a keyframe block (edit mode) → every anchor in its group shifts by the same Δt, snapped to frames.
let moved = false
function startDrag(event: PointerEvent, index: number, block: HTMLElement) {
  if (!edit.enabled || event.button !== 0) return
  event.stopPropagation()
  moved = false
  const anchors = groupAnchors(index), lanes = el("tlanes"), width = lanes.getBoundingClientRect().width, x0 = event.clientX
  const blocks = [...document.querySelectorAll<HTMLElement>(".seg-cue")].filter(b => anchors.has(b.dataset.at!))
  block.setPointerCapture(event.pointerId)
  const dtOf = (x: number) => Math.round((x - x0) / width * last) / fps
  const move = (e: PointerEvent) => {
    if (Math.abs(e.clientX - x0) > 3) moved = true
    if (!moved) return
    const dt = dtOf(e.clientX)
    for (const b of blocks) b.style.transform = "translateX(" + dt * fps / last * width + "px)"
    el("bindInfo").textContent = "拖动 " + anchors.size + " 个锚点 Δ " + (dt >= 0 ? "+" : "") + dt.toFixed(3) + " s"
  }
  const up = (e: PointerEvent) => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up)
    if (!moved) return
    const dt = dtOf(e.clientX)
    for (const b of blocks) b.style.transform = ""
    setTimeout(() => { moved = false }, 0)
    if (dt !== 0) void retime(anchors, dt)
  }
  // Window listeners, not pointer capture: capture was lost mid-drag in Chrome when the group spans several rows.
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up)
}
async function retime(anchors: Set<string>, dt: number) {
  const before = timing
  const next = new Map(timing)
  for (const a of anchors) {
    const t = +((next.get(a) ?? 0) + dt).toFixed(4)
    if (t < 0) { solve("拖动后 " + a + " 会早于 0 s，已取消", "error"); return }
    next.set(a, t)
  }
  timing = next
  try {
    solve("正在重新解算", "busy")
    const doc = prepared.document
    prepared = await prepareProject(doc, mode())
    snapshot = undefined
    panelsDirty = treeDirty = true
    buildTimeline(); view.setProject(prepared, last, fps, false); lintBadge(); show()
    solve("解算成功 · 已平移 " + anchors.size + " 个锚点 " + (dt >= 0 ? "+" : "") + dt.toFixed(3) + " s（本地草稿，导出时间表保存）")
  } catch (error) {
    timing = before
    solve((error instanceof Error ? error.message : String(error)) + "（已撤回这次拖动）", "error")
  }
}
/** Cues that must share an edit with cue i: the other axis of the same x·y move (same start and duration). */
function partners(i: number) {
  const c = prepared.document.cues[i]!, s = timing.get(c.at), p = String(c.property)
  const pairs: Record<string, string> = { "target.x": "target.y", "target.y": "target.x", "position.x": "position.y", "position.y": "position.x", "approach.x": "approach.y", "approach.y": "approach.x", x: "y", y: "x" }
  const other = pairs[p]
  if (!other) return []
  return prepared.document.cues.flatMap((d, j) => j !== i && d.target === c.target && d.property === other && d.duration === c.duration && timing.get(d.at) === s ? [j] : [])
}

let treeSelected = ""
function setText(node: Element, text: string) { if (node.textContent !== text) node.textContent = text }
function updateTree(data: InspectorFrame) {
  if (treeSelected !== selected) {
    treeSelected = selected
    for (const [id, row] of rows) {
      row.classList.toggle("on", id === selected)
      row.setAttribute("aria-pressed", String(id === selected))
    }
  }
  const running = (cue: { running: boolean; start: number }) => cue.running || Math.abs(cue.start - data.time) < 1e-9
  rows.get("camera")?.classList.toggle("live", data.camera.cues.some(running))
  setText(rows.get("camera")!.querySelector(".op")!, data.camera.cues.some(running) ? "LIVE" : "")
  for (const { primitive, cues } of data.elements) {
    const row = rows.get(primitive.id)!
    const opacity = primitive.opacity ?? 1
    const disconnected = primitive.kind === "line" && primitive.connected === false
    row.classList.toggle("dim", opacity === 0 || disconnected)
    row.classList.toggle("live", cues.some(running))
    setText(row.querySelector(".op")!, disconnected ? "断开" : "α " + opacity.toFixed(2))
  }
}

function show() {
  if (!prepared) return
  const changed = snapshot?.frame !== frame
  if (changed) snapshot = inspectFrame(prepared, frame, fps)
  const data = snapshot!
  // docs/02: closed panels cost nothing per frame; open ones refresh at ~10 fps while playing, every time when paused.
  const now = performance.now(), playing = anim !== undefined
  if (panels.left && (treeDirty || !playing || now - treeAt >= PANEL_EVERY_MS)) { updateTree(data); treeAt = now; treeDirty = false }
  view.update(data, selected)
  if (!pip) pip = renderHybridScene(el("cam"), data.scene)
  else if (changed) pip.update(data.scene)
  if (panels.right && (panelsDirty || !playing || now - panelAt >= PANEL_EVERY_MS)) {
    cameraPanel(el("camSec"), data, prepared, edit, edit.enabled ? new Set([...picked].filter(i => prepared.document.cues[i]?.target === "camera")) : undefined)
    elementPanel(el("elSec"), data, prepared, selected, edit)
    panelAt = now; panelsDirty = false
  }
  el("clock").firstChild!.textContent = data.time.toFixed(2)
  el("frameNo").textContent = "F " + frame + " / " + last
  let step = 0
  keys.forEach(([, f], i) => { if (f <= frame) step = i })
  el("srcClock").textContent = keys.length ? "演示步 " + String(step + 1).padStart(2, "0") + " / " + String(keys.length).padStart(2, "0") : ""
  el("ph").style.left = frame / last * 100 + "%"
  document.querySelectorAll<HTMLButtonElement>("#keys button").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.f) === frame)))
  el("world").dataset.frame = String(frame)
}

function stop() {
  const was = anim !== undefined
  if (anim !== undefined) cancelAnimationFrame(anim)
  anim = undefined
  el("play").textContent = "播放"
  // Panels may be up to 100 ms stale after playing: refresh once on pause.
  if (was) { panelsDirty = treeDirty = true; show() }
}
function goto(next: number) {
  frame = Math.max(0, Math.min(last, next))
  show()
}
function seek(next: number) { stop(); goto(next) }

async function change(input: HTMLInputElement) {
  if (!edit.enabled) return
  stop()
  const path = input.dataset.field!, value = input.value
  const version = ++editVersion
  edit = { enabled: true }
  try {
    solve("正在重新解算", "busy")
    // v03: an ease or arc edit on one axis of an x·y move is applied to the other axis too (the solver requires them equal).
    let doc = documentField(prepared.document, path, value)
    const m = /^cues\.(\d+)\.((?:ease\.(?:x1|y1|x2|y2))|arc)$/.exec(path)
    if (m) for (const j of partners(Number(m[1]))) {
      if (m[2] !== "arc") (doc.cues[j] as { ease?: unknown }).ease = structuredClone((doc.cues[Number(m[1])] as { ease?: unknown }).ease)
      else doc = documentField(doc, "cues." + j + ".arc", value)
    }
    const next = await prepareProject(doc, mode())
    if (version !== editVersion) return
    prepared = next
    snapshot = undefined
    buildTree()
    buildTimeline()
    view.setProject(prepared, last, fps, false)
    lintBadge()
    panelsDirty = treeDirty = true
    treeSelected = ""
    show()
    solve("解算成功 · 本地草稿")
  } catch (error) {
    if (version !== editVersion) return
    const message = error instanceof Error ? error.message : String(error)
    edit = { enabled: true, issue: { path, value, message } }
    panelsDirty = true
    show()
    solve(message, "error")
  }
}

function connect() {
  connectLayout(document.querySelector<HTMLElement>(".app")!)
  el("prev").onclick = () => seek(frame - 1)
  el("next").onclick = () => seek(frame + 1)
  el("play").onclick = () => {
    if (anim !== undefined) { stop(); return }
    if (frame === last) goto(0)
    const from = frame, start = performance.now()
    el("play").textContent = "暂停"
    const step = (now: number) => {
      const next = Math.min(last, from + Math.floor((now - start) * fps / 1000))
      if (next !== frame) goto(next)
      if (frame < last) anim = requestAnimationFrame(step)
      else stop()
    }
    anim = requestAnimationFrame(step)
  }
  const lanes = el("tlanes")
  let dragging: number | undefined
  const scrub = (event: PointerEvent) => {
    const box = lanes.getBoundingClientRect()
    seek(Math.round((event.clientX - box.left) / box.width * last))
  }
  lanes.addEventListener("pointerdown", event => {
    if (event.button !== 0 || (event.target as Element).closest(".ev, .seg-cue")) return
    dragging = event.pointerId
    lanes.setPointerCapture(event.pointerId)
    scrub(event)
  })
  lanes.addEventListener("pointermove", event => { if (dragging === event.pointerId) scrub(event) })
  lanes.addEventListener("lostpointercapture", () => { dragging = undefined })
  document.addEventListener("keydown", event => {
    if ((event.target as Element).closest("input,textarea,[contenteditable]")) return
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault()
      seek(frame + (event.key === "ArrowRight" ? 1 : -1))
    }
  })
  for (const [label, n] of keys) {
    const button = document.createElement("button")
    button.textContent = label
    button.dataset.f = String(n)
    button.onclick = () => seek(n)
    el("keys").append(button)
  }
  el("fit").onclick = () => view.fit()
  el("toggleLeft").onclick = () => setPanels(!panels.left, panels.right)
  el("toggleRight").onclick = () => setPanels(panels.left, !panels.right)
  el("focusCanvas").onclick = () => { const any = panels.left || panels.right; setPanels(!any, !any) }
  el("tlMode").querySelectorAll<HTMLButtonElement>("button").forEach(b => {
    b.onclick = () => { tlMode = b.dataset.m as TlMode; keep(TL_KEY, tlMode); buildTimeline(); show() }
  })
  el("lintBadge").onclick = () => { const pop = el("lintPop"); pop.hidden = !pop.hidden; el("lintBadge").setAttribute("aria-expanded", String(!pop.hidden)) }
  el("lintPop").addEventListener("click", event => {
    const b = (event.target as Element).closest<HTMLElement>("[data-lint-target]")
    if (!b) return
    selected = choose(b.dataset.lintTarget!)
    if (tlMode === "selected") buildTimeline()
    panelsDirty = treeDirty = true
    seek(Math.round(Number(b.dataset.lintAt) * fps))
  })
  el("layers").querySelectorAll<HTMLButtonElement>("button").forEach(b => {
    b.onclick = () => b.setAttribute("aria-pressed", String(view.layer(b.dataset.l as "grid" | "regions" | "anchors" | "path" | "nulls" | "arcs" | "camArcs")))
  })
  const setEdit = (enabled: boolean) => {
    stop()
    editVersion++
    edit = { enabled }
    document.querySelector<HTMLElement>(".app")!.dataset.edit = String(enabled)
    el("inspectMode").setAttribute("aria-pressed", String(!enabled))
    el("editMode").setAttribute("aria-pressed", String(enabled))
    solve("解算成功")
    panelsDirty = true
    show()
  }
  el("inspectMode").onclick = () => setEdit(false)
  el("editMode").onclick = () => setEdit(true)
  for (const id of ["camSec", "elSec"]) {
    el(id).addEventListener("click", async event => {
      const button = (event.target as Element).closest<HTMLElement>("[data-copy-cue]")
      if (!button) return
      const cue = prepared.document.cues[Number(button.dataset.copyCue)]
      try { await navigator.clipboard.writeText(JSON.stringify(cue, null, 2)); solve("节点 JSON 已复制") }
      catch { solve("浏览器未允许复制，请检查剪贴板权限", "error") }
    })
    el(id).addEventListener("change", event => {
      if (event.target instanceof HTMLInputElement && event.target.dataset.field) void change(event.target)
    })
    el(id).addEventListener("keydown", event => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.target.blur()
    })
  }
  el("copyFrame").onclick = async () => {
    if (!snapshot) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))
      if (!edit.issue) solve("本帧数据已复制")
    } catch { if (!edit.issue) solve("浏览器未允许复制，请检查剪贴板权限", "error") }
  }
  el("bindGroup").onclick = () => {
    if (picked.size < 2) { solve("请先用 Shift+点击选中至少两个关键帧", "error"); return }
    const anchors = [...new Set([...picked].map(i => prepared.document.cues[i]!.at))], m = meta()
    m.groups = [...(m.groups ?? []).map(g => g.filter(a => !anchors.includes(a))).filter(g => g.length > 1), anchors]
    m.ungrouped = (m.ungrouped ?? []).filter(a => !anchors.includes(a))
    markPicked(); solve("已绑定 " + anchors.length + " 个锚点为一组（写在场景文件 editor.groups，不影响解算）")
  }
  el("unbindGroup").onclick = () => {
    if (!picked.size) { solve("请先选中关键帧", "error"); return }
    const anchors = new Set([...picked].map(i => prepared.document.cues[i]!.at)), m = meta()
    m.groups = (m.groups ?? []).map(g => g.filter(a => !anchors.has(a))).filter(g => g.length > 1)
    m.ungrouped = [...new Set([...(m.ungrouped ?? []), ...anchors])]
    markPicked(); solve("已解除 " + anchors.size + " 个锚点的绑定（含自动绑定，记在 editor.ungrouped）")
  }
  el("tlanes").addEventListener("click", event => { if (edit.enabled && !(event.target as Element).closest(".seg-cue")) { picked.clear(); markPicked(); show() } })
  el("exportTiming").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...Object.fromEntries(timing), ...timingExtra }, null, 2)], { type: "application/json" }))
    const link = document.createElement("a"); link.href = url; link.download = config.name + ".edited-timing.json"
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
  el("exportDoc").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(prepared.document, null, 2)], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = config.name + ".edited.scene.json"
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
}

async function start() {
  const mmss = (t: number) => String(Math.floor(t / 60)).padStart(2, "0") + ":" + (t % 60).toFixed(1).padStart(4, "0")
  el("crumb").innerHTML = "检查器 · <b>" + config.name + ".scene.json</b>" + (config.label !== config.name ? " · " + config.label : "")
  el<HTMLAnchorElement>("present").href = "./present.html?doc=" + encodeURIComponent(config.name)
  const [source, anchors] = await Promise.all([fetch(projectUrl), fetch(timingUrl)])
  if (!source.ok || !anchors.ok) throw new Error("无法读取项目文档或时间表")
  // timing.json 可能同时登记台词 segments 数组：只收数字锚点，避免数组混进 Map<string, number>
  const rawTiming = await anchors.json() as unknown
  timing = timingAnchors(rawTiming)
  timingExtra = rawTiming && typeof rawTiming === "object" && !Array.isArray(rawTiming)
    ? Object.fromEntries(Object.entries(rawTiming).filter(([k]) => !timing.has(k))) : {}
  prepared = await prepareProject(await source.json(), mode())
  {
    const parsed = parseTiming(rawTiming)
    const end = sceneDuration(prepared.document, parsed.anchors, parsed.segments)
    keys = deckSteps(parsed, end).map((st, i) => [String(i + 1).padStart(2, "0") + " " + (st.title ?? st.id), Math.round(st.at * fps)] as const)
  }
  if (!params.get("dur")) {
    let endSec = 1
    for (const v of timing.values()) if (Number.isFinite(v)) endSec = Math.max(endSec, v)
    for (const c of prepared.document.cues) endSec = Math.max(endSec, (timing.get(c.at) ?? 0) + c.duration)
    last = Math.max(30, Math.ceil((endSec + 0.5) * fps))
    if (!params.get("frame")) frame = keys[0]?.[1] ?? 0
    el("crumb").innerHTML += " · 00:00.0–" + mmss(last / fps)
  }
  selected = choose(selected)
  initPanels()
  buildTree()
  buildTimeline()
  view.setProject(prepared, last, fps, true)
  lintBadge()
  connect()
  show()
  solve("解算成功")
}

void start().catch(error => solve(error instanceof Error ? error.message : String(error), "error"))
