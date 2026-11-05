import type { CurrentCue, InspectorElement, InspectorFrame, PreparedProject } from "../src/index.js"
import { worldPoint } from "../src/pipeline/inspect.js"
import { DESIGN_PIXELS_PER_UNIT as U } from "../src/shared/geometry.js"
import { curveSvg, easeFields, easeLabel } from "./inspector-ease.js"
import type { ArcInfo } from "../src/pipeline/timeline.js"

const mark = (value: number, digits = 2) => value.toFixed(digits)
const text = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
const tag = (value: string, css = "") => '<span class="tag ' + css + '">' + text(value) + "</span>"
const header = (id: string, kind: string) =>
  '<h3><span class="title-id">' + text(id) + '</span>' + tag(kind) + "</h3>"
const kv = (key: string, value: string) => "<dt>" + text(key) + "</dt><dd>" + value + "</dd>"
const dl = (rows: string) => '<dl class="kv">' + rows + "</dl>"
const xy = (p: readonly number[], digits = 2) => p.map(v => mark(v, digits)).join(", ")
const coordinates = (point: { u: readonly number[]; px: readonly number[] }) =>
  "(" + xy(point.u, 4) + ") u<br>(" + xy(point.px, 2) + ") px"
const table = (rows: string) => '<table class="cmp"><thead><tr><th>字段</th><th>声明</th><th>解算</th></tr></thead><tbody>' + rows + "</tbody></table>"
const row = (key: string, declared: string, value: string, diff = false) =>
  '<tr class="' + (diff ? "diff" : "") + '"><td>' + text(key) + "</td><td>" + declared + "</td><td>" + value + "</td></tr>"

export interface EditView {
  enabled: boolean
  issue?: { path: string; message: string; value: string }
}

function input(edit: EditView, path: string, value: unknown, label: string, placeholder = "") {
  if (!edit.enabled) return text(value === undefined ? placeholder : value)
  const issue = edit.issue?.path === path ? edit.issue : undefined
  return '<input class="field mono" data-field="' + text(path) + '" aria-label="' + text(label) +
    '" value="' + text(issue?.value ?? value ?? "") + '" placeholder="' + text(placeholder) +
    '" aria-invalid="' + Boolean(issue) + '">' +
    (issue ? '<span class="field-error" role="alert">' + text(issue.message) + '</span>' : "")
}

function current(cue: CurrentCue | undefined) {
  if (!cue) return ""
  return tag(cue.at, cue.running ? "cue" : "") + " p=" + mark(cue.p, 3)
}

const ARC_PROPS = ["target.x", "target.y", "position.x", "position.y", "approach.x", "approach.y", "x", "y"]
/** docs/02: heavy scenes have thousands of cues per target — the panel lists the ones nearest the playhead only. */
const NEAR_CUES = 16
type Compiled = PreparedProject["tracks"][number][number]
const compiledOf = new WeakMap<PreparedProject, Map<number, Compiled>>()
const compiled = (project: PreparedProject) => {
  let m = compiledOf.get(project)
  if (!m) { m = new Map(project.tracks.flat().map(c => [c.index, c] as const)); compiledOf.set(project, m) }
  return m
}
function editCues(project: PreparedProject, id: string, edit: EditView, focus?: ReadonlySet<number>, time = 0) {
  const byIndex = compiled(project)
  let rows = project.document.cues.map((cue, i) => ({ cue, i })).filter(({ cue, i }) => cue.target === id && (!focus?.size || focus.has(i)))
  if (!rows.length) return ""
  const total = rows.length
  if (!focus?.size && total > NEAR_CUES) {
    const dist = (i: number) => { const c = byIndex.get(i); if (!c) return Infinity; return time < c.start ? c.start - time : time > c.start + c.duration ? time - c.start - c.duration : 0 }
    rows = rows.map(r => ({ r, d: dist(r.i) })).sort((a, b) => a.d - b.d || a.r.i - b.r.i).slice(0, NEAR_CUES).map(x => x.r).sort((a, b) => a.i - b.i)
  }
  const note = rows.length < total ? '<div class="src" data-cue-near>共 ' + total + " 个节点，只列当前时刻附近 " + rows.length + " 个（拖时间轴会跟着换）</div>" : ""
  // Inspect mode: every cue with its ease numbers and curve. Edit mode: also the to / duration / bezier inputs.
  return '<div class="eyebrow">节点声明 · 缓动</div>' + note + rows.map(({ cue, i }) => '<div class="cue-card">' +
    tag(cue.at, "cue") + " " + text(cue.property) + " → " +
    (!("to" in cue) ? text("path") : typeof cue.to === "number" ? input(edit, "cues." + i + ".to", cue.to, cue.at + " 目标值") : text(cue.to)) +
    " · " + input(edit, "cues." + i + ".duration", cue.duration, cue.at + " 时长") + " s" +
    (ARC_PROPS.includes(cue.property) ? " · arc " + input(edit, "cues." + i + ".arc", "arc" in cue ? cue.arc : undefined, cue.at + " 弧线", "默认") : "") +
    (edit.enabled ? easeFields(cue, i) : "ease" in cue || "to" in cue && typeof cue.to === "number"
      ? '<div class="ease-edit">' + curveSvg("ease" in cue ? cue.ease : undefined, cue.duration, 72) +
        '<div class="src">' + easeLabel("ease" in cue ? cue.ease : undefined) + "</div></div>" : "") +
    arcLine(byIndex.get(i)?.arcInfo) + "</div>").join("")
}

/** Declared arc at each level (cue / element / project) and what the timeline resolved, for free x/y moves. */
function arcLine(a: ArcInfo | undefined) {
  if (!a) return ""
  const d = a.declared, v = (x: number | undefined) => x === undefined ? "—" : String(x)
  return '<div class="src" data-arc-info>弧线 声明 cue ' + v(d.cue) + " · 元素 " + v(d.element) + " · 项目 " + v(d.project) +
    " · side " + text(d.side ?? "auto") + "<br>解算 arc " + mark(a.arc, 3) + " · " + text(a.side) +
    (a.offset ? " · 中点偏移 " + mark(a.offset * 1080, 1) + " px" : "") + (a.reason ? " · " + text(a.reason) : "") + "</div>"
}

type CameraMove = InspectorFrame["camera"]["moves"][number]
const NEAR_MOVES = 8
function nearMoves(moves: readonly CameraMove[], time: number) {
  if (moves.length <= NEAR_MOVES) return [...moves]
  const d = (m: CameraMove) => time < m.look.start ? m.look.start - time : time > m.frame.end ? time - m.frame.end : 0
  return [...moves].sort((a, b) => d(a) - d(b)).slice(0, NEAR_MOVES).sort((a, b) => a.look.start - b.look.start)
}
/** One camera move: declared vs resolved arc / lag, and a two-row timeline showing the look and framing windows. */
function lagLine(m: CameraMove, time: number) {
  const d = m.declared, v = (x: unknown) => x === undefined ? "—" : String(x)
  const s = m.look.start, span = m.frame.end - s || 1, pct = (t: number) => ((t - s) / span * 100).toFixed(2) + "%"
  const row = (a: number, b: number, color: string, label: string) => '<div style="position:relative;height:9px;margin:2px 0;background:var(--line, #E5E5E3)">' +
    '<i style="position:absolute;left:' + pct(a) + ";width:calc(" + pct(b) + " - " + pct(a) + ");top:0;bottom:0;background:" + color +
    ';outline:1px solid var(--camera)" title="' + label + '"></i></div>'
  const nowMark = time >= s && time <= m.frame.end ? '<i style="position:absolute;left:' + pct(time) + ';top:-2px;bottom:-2px;width:1px;background:var(--camera)"></i>' : ""
  return '<div style="margin-bottom:8px" data-cam-move="' + s + '">' + tag(s.toFixed(2) + " s", "cue") +
    " 弧 声明 cue " + v(d.arc.cue) + " · 摄像机 " + v(d.arc.camera) + " · 项目 " + v(d.arc.project) + " → 解算 " + mark(m.arc, 3) + " · " + text(m.side) +
    "<br>lag 声明 cue " + v(d.lag.cue) + " · 摄像机 " + v(d.lag.camera) + " → 解算 " + mark(m.lag, 3) + " s（" + mark(m.lagFrames, 1) + " 帧）" +
    " · 中点偏移 " + mark(m.frame.offset * 1080, 1) + " px" +
    '<div style="position:relative">' + row(m.look.start, m.look.end, "var(--look)", "目标点") +
    row(m.frame.start, m.frame.end, "var(--camera-soft, #ccc)", "取景") + nowMark + "</div>" +
    '<span class="src">上：目标点 ' + m.look.start.toFixed(2) + "–" + m.look.end.toFixed(2) + " s · 下：取景 " +
    m.frame.start.toFixed(2) + "–" + m.frame.end.toFixed(2) + " s</span></div>"
}

type View3DInfo = InspectorFrame["camera"]["view3d"]
type Derived = { pitch: number; yaw: number; sight: number; eye: { x: number; y: number; z: number }; target: readonly number[] }
/** docs/04: two written nodes and what is derived from them. */
function derivedRows(r: Derived) {
  return '<div data-cam3d-derived="">' + tag("双节点 · docs/04", "ok") +
    "<br>声明 摄像机 x/y/z " + mark(r.eye.x, 3) + " / " + mark(r.eye.y, 3) + " / " + mark(r.eye.z, 3) + " u" +
    "<br>声明 目标点 x/y/z " + r.target.map(v => mark(v, 3)).join(" / ") + " u" +
    "<br>俯仰（推导） " + mark(r.pitch, 2) + "° · 偏转（推导） " + mark(r.yaw, 2) + "° · 距离（推导） " + mark(r.sight, 3) + " u</div>"
}
/** docs/04: declared vs resolved 3D view, perspective scale and each element's projected scale. */
function view3dRows(v: View3DInfo) {
  if (!v) return '<span class="src">未声明 camera.view3d：2D 摄像机</span>'
  const d = v.declared as { distance: number; height?: number; pitch?: number; yaw?: number; maxTilt?: number }
  const r = v.resolved, opt = (n: number | undefined) => n === undefined ? "—" : String(n)
  return '<div data-cam3d-panel="' + (v.flat ? "flat" : "3d") + '">' + tag(v.flat ? "本帧正对 · 走 2D 路径" : "本帧透视", v.flat ? "ok" : "cue") +
    "<br>声明 distance " + d.distance + " u · height " + opt(d.height) + " · pitch " + opt(d.pitch) + "° · yaw " + opt(d.yaw) + "° · maxTilt " + opt(d.maxTilt ?? 35) + "°" +
    ((r as { derived?: boolean }).derived ? derivedRows(r as unknown as Derived) : "") +
    "<br>解算 height " + mark(r.height, 3) + " u · pitch " + mark(r.pitch, 2) + "° · yaw " + mark(r.yaw, 2) + "°" +
    (v.flat ? "" : "<br>摄像机高度 " + mark(v.eye.z / 1080, 3) + " u · z=0 平面透视缩放 " + mark(v.perspectiveScale ?? 1, 4) +
      '<div style="margin-top:4px">' + (v.elements ?? []).filter(e => e.z !== 0).map(e => text(e.id) + " z " + mark(e.z, 2) + " → ×" + mark(e.scale, 3)).join("<br>") + "</div>") +
    "</div>"
}

export function cameraPanel(node: HTMLElement, frame: InspectorFrame, project: PreparedProject, edit: EditView, focus?: ReadonlySet<number>) {
  const c = frame.camera
  const metrics = [["target.x (u)", c.target.u[0]], ["target.y (u)", c.target.u[1]], ["zoom", c.zoom]] as const
  const moving = c.cues.filter(cue => cue.running)
  const rows = kv("取景中心 · 设计像素", xy(c.target.px) + " px") +
    kv("取景框四角", c.corners.map(coordinates).join("<br>")) +
    (c.look ? kv("目标点 · 设计像素", xy(c.look.px) + " px · 与取景中心差 " +
      mark(Math.hypot(c.look.px[0] - c.target.px[0], c.look.px[1] - c.target.px[1]), 1) + " px") : "") +
    kv("弧线 · 延迟跟随", c.moves.length ? nearMoves(c.moves, frame.time).map(m => lagLine(m, frame.time)).join("") +
      (c.moves.length > NEAR_MOVES ? '<span class="src">共 ' + c.moves.length + " 段，只列当前时刻附近 " + NEAR_MOVES + " 段</span>" : "") : '<span class="src">无（arc 0 且 lag 0：旧直线摄像机）</span>') +
    kv("roll / dist / focal", xy([c.roll, c.distance, c.focal], 2)) +
    kv("3D 摄像机 · docs/04", view3dRows(c.view3d)) +
    kv("平移 Δ/帧", '<b class="num" data-pan="' + c.pan_px + '">' + mark(c.pan_px) + " px</b> " +
      tag((c.pan_px > 40 ? "> 40" : "≤ 40") + " 平移阈值", c.pan_px > 40 ? "bad" : "ok")) +
    kv("进行中节点", moving.length ? moving.map(cue =>
      '<div style="margin-bottom:6px">' + tag(cue.at, "cue") + " " + text(cue.property) + "<br>" +
      text(cue.from) + " → " + text("to" in cue ? cue.to : "path") + " · " + text(easeLabel("ease" in cue ? cue.ease : undefined)) +
      ("interpolation" in cue && cue.interpolation ? " · " + text(cue.interpolation) : "") +
      '<div class="bar"><i style="width:' + cue.p * 100 + '%"></i></div>p = ' + mark(cue.p, 3) + "</div>").join("") :
      '<span class="src">无（保持）</span>')
  node.innerHTML = '<h3><span class="eyebrow">Camera</span>' + tag("orthographic · 俯视") +
    '</h3><div class="metric">' + metrics.map(([name, value]) => '<div><div class="eyebrow">' + name +
      '</div><div class="big">' + mark(value, 4) + "</div></div>").join("") +
    '</div><div style="height:10px"></div><div class="eyebrow" style="margin-bottom:4px">矩阵 matrix(a,b,c,d,e,f) · 设计像素</div>' +
    '<div class="mat">' + c.matrix.map((value, i) => '<span title="' + value + '"><small>' +
      "abcdef"[i] + "</small>" + mark(value, i > 3 ? 2 : 4) + "</span>").join("") + "</div>" +
    dl(rows) + '<div class="src">平移口径：measureMotion · 同一摄像机中心 pivot</div>' + (focus?.size ? '<div class="src" data-cue-focus>只显示时间轴上选中的关键帧组（' + focus.size + " 个节点）；点空白处取消</div>" : "") + editCues(project, "camera", edit, focus, frame.time)
}

function elementDetail(element: InspectorElement, edit: EditView) {
  const { declaration: d, primitive: p, box, local, anchor, cues, measurement, z } = element
  const ctl = (property: string) => current(cues.find(c => c.property === property))
  const prefix = "elements." + z
  const opacity = row("opacity", input(edit, prefix + ".opacity", d.opacity ?? 1, d.id + " opacity"),
    mark(p.opacity ?? 1, 3) + " " + ctl("opacity"), (p.opacity ?? 1) !== (d.opacity ?? 1))
  if (d.kind === "line" && p.kind === "line") {
    const port = (entry: typeof d.from) => text(entry.element) + " [" + xy(entry.at) + "]"
    return table(row("from", port(d.from), coordinates(worldPoint([p.x1, p.y1]))) +
      row("to", port(d.to), coordinates(worldPoint([p.x2, p.y2]))) +
      row("width", mark(d.width, 5) + " u", mark(p.stroke.width) + " px") +
      row("stroke", text(d.color), text(p.stroke.color) + " " + ctl("stroke"), p.stroke.color !== d.color) +
      opacity + row("connected", text(d.connected ?? true), tag(p.connected === false ? "断开" : "已连接",
        p.connected === false ? "bad" : "ok") + " " + ctl("connected"), (d.connected ?? true) !== (p.connected ?? true)))
  }
  if (d.kind === "line" || !box || !local || !anchor) return ""
  const l = d.layout
  const field = (key: "x" | "y" | "width" | "height") =>
    input(edit, prefix + ".layout." + key, l[key], d.id + " layout." + key, "由测量")
  const anchors = edit.enabled
    ? input(edit, prefix + ".layout.anchor.0", l.anchor[0], d.id + " anchor x") +
      input(edit, prefix + ".layout.anchor.1", l.anchor[1], d.id + " anchor y")
    : "[" + xy(l.anchor) + "]"
  let html = '<div class="eyebrow">Layout · 声明 vs 解算 (' + text(l.region) + ")</div>" + table(
    row("x", field("x"), mark(local.u[0], 4) + " u · " + mark(local.px[0]) + " px 区内", typeof l.x === "string") +
    row("y", field("y"), mark(local.u[1], 4) + " u · " + mark(local.px[1]) + " px 区内", typeof l.y === "string") +
    row("anchor", anchors, coordinates(anchor), l.anchor.some(Boolean)) +
    row("width", field("width"), mark(box.width) + " px · " + mark(box.width / U, 4) + " u", typeof l.width !== "number") +
    row("height", field("height"), mark(box.height) + " px · " + mark(box.height / U, 4) + " u", typeof l.height !== "number") +
    row("框中心", "—", coordinates(worldPoint([box.x + box.width / 2, box.y + box.height / 2]))) +
    row("框左上", "—", xy([box.x, box.y], 1) + " px") +
    row("父级 / 层级", text(l.region), "depth " + element.depth + (p.layer === "screen" ? " · screen 层" : " · world 层")) +
    row("scaleX / scaleY", xy([d.scaleX ?? 1, d.scaleY ?? 1], 3),
      element.transform ? "matrix(" + element.transform.map(v => mark(v, 3)).join(", ") + ")" : "无变换", Boolean(element.transform))) +
    '<div class="src">高亮项含百分比、锚点偏移或测量补齐。</div>' +
    '<div style="height:10px"></div><div class="eyebrow">State · 当前帧</div>' + table(opacity)
  let state = ""
  if (d.kind === "text" && p.kind === "text") {
    state += kv("text", '<span style="white-space:pre-wrap">' + text(p.text) + "</span> " + ctl("text"))
    state += kv("fontSize / weight", input(edit, prefix + ".fontSize", d.fontSize, d.id + " fontSize") +
      " u · " + mark(p.fontSize) + " px · " + text(p.fontWeight ?? 400) + " · " + text(p.align))
  }
  if (p.kind === "rect") state += kv("fill / stroke", text(p.fill) + " / " + text(p.stroke?.color ?? "无"))
  if (d.kind === "image" && p.kind === "image") state += kv("src / fit", text(d.src) + " · " + text(p.fit))
  if (measurement) state += kv(p.kind === "image" ? "naturalWidth/Height" : "测量", xy([measurement.width, measurement.height]) + " px")
  html += dl(state)
  return html
}

export function elementPanel(node: HTMLElement, frame: InspectorFrame, project: PreparedProject, selection: string, edit: EditView) {
  if (selection === "camera") {
    node.innerHTML = '<div class="src">已选中摄像机，见上方摄像机面板。</div>'
    return
  }
  const region = frame.regions.find(r => "region:" + r.declaration.id === selection)
  if (region) {
    const r = region.declaration, px = region.rect
    node.innerHTML = header(r.id, "region") + dl(kv("区域中心", coordinates(worldPoint([px.x + px.width / 2, px.y + px.height / 2]))) +
      kv("宽 × 高", xy([r.width, r.height], 4) + " u · " + xy([px.width, px.height]) + " px") +
      kv("框左上 · 设计像素", xy([px.x, px.y]) + " px") +
      kv("元素", region.elements.map(text).join("<br>")))
    return
  }
  const e = frame.elements.find(value => value.primitive.id === selection)
  if (!e) { node.textContent = "选择一个元素或区域"; return }
  node.innerHTML = header(e.declaration.id, e.declaration.kind + " · z " + e.z) +
    elementDetail(e, edit) + editCues(project, selection, edit, undefined, frame.time)
}
