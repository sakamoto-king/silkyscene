/**
 * docs/06 帧播放页：全画幅、无 UI，确定性逐帧求值。
 *
 *   /playground/player.html?doc=topology-flow        读 ./topology-flow.scene.json + ./topology-flow-timing.json（可缺）
 *   ?scene=<url>&timing=<url>                          任意路径（export_mp4.mjs --scene 用 /@fs/ 绝对路径）
 *   &fps=30 &duration=8 &t=2.5 / &frame=75             默认帧率、时长覆盖、首帧
 *
 * 两套驱动协议同时挂在 window 上：
 *   window.__silkyPlayer = { ready, duration, fps, totalFrames, width, height, seek(t), seekFrame(i) }
 *     seek 返回 Promise：画面已更新、字体与图片已就绪、并过了两个 requestAnimationFrame。
 *   window.__hf = { duration, seek(t) } + window.__hfWaitForSeekCompletion() + window.__renderReady
 *     HyperFrames 0.8.x 捕获引擎的约定（pollHfReady 等 __hf.seek 与 duration > 0）。
 */
import { parseTiming, prepareProject, renderHybridScene, sceneDuration } from "../src/index.js"
import type { HybridRenderHandle } from "../src/index.js"

declare global {
  interface Window {
    __silkyPlayer?: SilkyPlayer
    __hf?: { duration: number; fps: number; width: number; height: number; seek(time: number, options?: unknown): void }
    __hfWaitForSeekCompletion?: () => Promise<void>
    __renderReady?: boolean
  }
}

export interface SilkyPlayer {
  ready: Promise<SilkyPlayerInfo>
  doc: string
  duration: number
  fps: number
  totalFrames: number
  width: number
  height: number
  time: number
  seek(time: number): Promise<number>
  seekFrame(frame: number): Promise<number>
}
export interface SilkyPlayerInfo { doc: string; duration: number; fps: number; totalFrames: number; width: number; height: number; anchors: number; segments: number }

const params = new URL(location.href).searchParams
const stage = document.getElementById("stage") as HTMLDivElement
const errorBox = document.getElementById("player-error") as HTMLParagraphElement
const slug = params.get("doc")?.trim() || "topology-flow"
if (!params.get("scene") && !/^[\w.-]+$/.test(slug)) throw new Error("?doc= 只接受文件名（字母数字 _ - .）")
const sceneUrl = new URL(params.get("scene") ?? "./" + slug + ".scene.json", location.href)
const timingUrl = new URL(params.get("timing") ?? (params.get("scene")
  ? sceneUrl.href.replace(/\.scene\.json(?=$|[?#])/, "-timing.json") : "./" + slug + "-timing.json"), location.href)
const positive = (v: string | null) => { const n = Number(v); return v !== null && Number.isFinite(n) && n > 0 ? n : undefined }

const raf = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
const twoFrames = async () => { await raf(); await raf() }

/** Optional timing file: missing (404), HTML fallback or broken JSON all degrade to `{}`. */
async function loadTiming(url: URL): Promise<unknown> {
  try {
    const res = await fetch(url)
    if (!res.ok || /text\/html/.test(res.headers.get("content-type") ?? "")) return {}
    return JSON.parse(await res.text()) as unknown
  } catch { return {} }
}

/** Every <img> in the stage decoded, so a captured frame never shows a half-loaded picture. */
async function imagesSettled() {
  const pending = [...stage.querySelectorAll("img")].filter(img => !img.complete)
  if (pending.length) await Promise.all(pending.map(img => img.decode().catch(() => undefined)))
}

function fit(width: number, height: number) {
  const scale = Math.min(innerWidth / width, innerHeight / height)
  stage.style.width = Math.round(width * scale) + "px"
  stage.style.height = Math.round(height * scale) + "px"
}

let resolveReady!: (info: SilkyPlayerInfo) => void, rejectReady!: (e: unknown) => void
const ready = new Promise<SilkyPlayerInfo>((res, rej) => { resolveReady = res; rejectReady = rej })
ready.catch(() => undefined) // surfaced through #player-error and data-ready="error"
let pendingSeek: Promise<unknown> = ready

const player: SilkyPlayer = {
  ready, doc: slug, duration: 0, fps: positive(params.get("fps")) ?? 30, totalFrames: 0, width: 0, height: 0, time: 0,
  seek: async () => { throw new Error("player not ready") },
  seekFrame: frame => player.seek(frame / player.fps),
}
window.__silkyPlayer = player

async function start() {
  const [sceneRes, rawTiming] = await Promise.all([fetch(sceneUrl), loadTiming(timingUrl)])
  if (!sceneRes.ok) throw new Error("无法读取场景文件：" + sceneUrl.pathname + "（HTTP " + sceneRes.status + "）")
  const { anchors, segments } = parseTiming(rawTiming)
  const prepared = await prepareProject(await sceneRes.json() as unknown, { baseUrl: sceneUrl.href, anchors, fps: player.fps })
  await document.fonts.ready
  const natural = sceneDuration(prepared.document, anchors, segments)
  player.duration = positive(params.get("duration")) ?? Math.max(1 / player.fps, natural)
  player.totalFrames = Math.max(1, Math.round(player.duration * player.fps))
  player.width = prepared.scene.canvas.width
  player.height = prepared.scene.canvas.height
  stage.dataset.width = String(player.width)
  stage.dataset.height = String(player.height)
  stage.dataset.duration = String(player.duration)
  fit(player.width, player.height)
  addEventListener("resize", () => fit(player.width, player.height))

  let handle: HybridRenderHandle | undefined
  /** Synchronous part: deterministic `renderAt(t)` → DOM. Clamped to [0, duration]. */
  const paint = (time: number) => {
    const t = Math.max(0, Math.min(player.duration, Number.isFinite(time) ? time : 0))
    const scene = prepared.renderAt(t)
    if (handle) handle.update(scene)
    else handle = renderHybridScene(stage, scene)
    player.time = t
    stage.dataset.time = t.toFixed(4)
    return t
  }
  const settle = async (t: number) => { await imagesSettled(); await twoFrames(); return t }
  player.seek = time => (pendingSeek = settle(paint(time)))
  // HyperFrames: seek is synchronous, completion is awaited through __hfWaitForSeekCompletion.
  window.__hf = { duration: player.duration, fps: player.fps, width: player.width, height: player.height, seek: time => { void player.seek(time) } }
  window.__hfWaitForSeekCompletion = async () => { await pendingSeek }

  const first = positive(params.get("t")) ?? (positive(params.get("frame")) ?? 0) / player.fps
  await player.seek(first)
  window.__renderReady = true
  document.documentElement.dataset.ready = "true"
  resolveReady({ doc: slug, duration: player.duration, fps: player.fps, totalFrames: player.totalFrames,
    width: player.width, height: player.height, anchors: anchors.size, segments: segments.length })
}

start().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  errorBox.hidden = false
  errorBox.textContent = "SilkyScene 播放页出错：" + message
  document.documentElement.dataset.ready = "error"
  rejectReady(error)
})
