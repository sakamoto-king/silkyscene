/**
 * 现场演示页：/playground/present.html?doc=<name>[&step=<n>]
 *
 * 同一份场景文档，按时间表的停靠拍（steps → segments → 锚点）一步步播放：
 *   空格 / → / ↓ / PageDown / 点击画面 = 下一步（1× 正放到下一个停靠点停住；过渡中再按 = 先跳到目标再继续）
 *   ← / ↑ / PageUp = 上一步（1× 倒放回上一个停靠点）   1–9 跳步   Home / End   F 全屏   H 隐藏控制条   触摸左右滑动翻页
 * 画面每帧都走 prepared.renderAt(t)，与检查器、播放页、MP4 导出逐像素同源。
 */
import { createDeckController, deckKeyAction, deckSteps, parseTiming, prepareProject, renderHybridScene, sceneDuration } from "../src/index.js"
import type { DeckController, DeckState, HybridRenderHandle } from "../src/index.js"

declare global { interface Window { __silkyDeck?: DeckController & { ready: Promise<void> } } }

const params = new URL(location.href).searchParams
const slug = params.get("doc")?.trim() || "spatial-stage"
if (!/^[\w.-]+$/.test(slug)) throw new Error("?doc= 只接受文件名（字母数字 _ - .）")
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const stage = $("stage"), hud = $("deck-hud"), bar = $("progress").firstElementChild as HTMLElement

async function loadJson(url: URL, optional: boolean): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok || /text\/html/.test(res.headers.get("content-type") ?? "")) {
    if (optional) return {}
    throw new Error("无法读取 " + url.pathname + "（HTTP " + res.status + "）")
  }
  return JSON.parse(await res.text()) as unknown
}
function fit() {
  const scale = Math.min(innerWidth / 1920, innerHeight / 1080)
  stage.style.width = Math.round(1920 * scale) + "px"
  stage.style.height = Math.round(1080 * scale) + "px"
}

async function start() {
  const sceneUrl = new URL("./" + slug + ".scene.json", location.href)
  const [raw, rawTiming] = await Promise.all([loadJson(sceneUrl, false), loadJson(new URL("./" + slug + "-timing.json", location.href), true)])
  const timing = parseTiming(rawTiming)
  const prepared = await prepareProject(raw, { baseUrl: sceneUrl.href, anchors: timing.anchors })
  await document.fonts.ready
  const duration = sceneDuration(prepared.document, timing.anchors, timing.segments)
  const steps = deckSteps(timing, duration)
  // 自动追加的「结束」步不计入页码（它只负责把最后一拍放完）
  const autoEnd = steps.length > 1 && steps[steps.length - 1]!.id === "end" && !(timing.steps ?? []).some(s => s.id === "end")
  const content = autoEnd ? steps.length - 1 : steps.length
  const first = Math.max(0, Math.min(steps.length - 1, Number(params.get("step") ?? 1) - 1 || 0))
  const deck = createDeckController(steps, { start: first })
  document.title = "SilkyScene · " + slug + " · 现场演示"
  // 场景画布底色同步到页面，避免深色样片四周露白边
  const bg = (prepared.document.canvas as { background?: string }).background
  if (typeof bg === "string" && bg.trim()) {
    document.documentElement.style.background = bg
    document.body.style.background = bg
  }
  fit(); addEventListener("resize", fit)

  let handle: HybridRenderHandle | undefined
  const paint = (t: number) => {
    const scene = prepared.renderAt(Math.max(0, Math.min(duration, t)))
    if (handle) handle.update(scene); else handle = renderHybridScene(stage, scene)
    stage.dataset.time = t.toFixed(4)
  }
  // HUD
  const dots = $("deck-dots")
  steps.forEach((s, i) => {
    const b = document.createElement("button"); b.type = "button"; b.title = String(i + 1).padStart(2, "0") + " · " + (s.title ?? s.id)
    b.addEventListener("click", e => { e.stopPropagation(); deck.goto(i) }); dots.append(b)
  })
  const show = (s: DeckState) => {
    const shown = s.target ?? s.index
    $("deck-count").textContent = (shown < content ? String(shown + 1).padStart(2, "0") : "■") + " / " + String(content).padStart(2, "0")
    $("deck-title").textContent = steps[shown]!.title ?? steps[shown]!.id
    dots.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-current", String(i === shown)))
    bar.style.width = (duration > 0 ? s.time / duration * 100 : 0).toFixed(2) + "%"
    document.documentElement.dataset.step = String(s.index)
    document.documentElement.dataset.moving = String(s.target !== undefined)
  }
  deck.subscribe(s => { paint(s.time); show(s) })
  paint(deck.state.time); show(deck.state)

  // 60fps 播放循环：只在过渡中推进，停靠时不重绘
  let last = performance.now()
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now
    if (deck.moving) deck.tick(dt)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  // 控制条自动隐去：鼠标静止 2.5 s 后淡出，H 完全隐藏
  let idle: number | undefined, hidden = false
  const wake = () => {
    if (hidden) return
    hud.classList.remove("faded"); document.body.classList.remove("idle")
    clearTimeout(idle); idle = window.setTimeout(() => { hud.classList.add("faded"); document.body.classList.add("idle") }, 2500)
  }
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.() }
  const act = (a: ReturnType<typeof deckKeyAction>) => {
    if (!a) return false
    if (a === "next") deck.next(); else if (a === "prev") deck.prev()
    else if (a === "first") deck.goto(0); else if (a === "last") deck.goto(steps.length - 1)
    else if (a === "fullscreen") fullscreen()
    else if (a === "toggleHud") { hidden = !hidden; hud.classList.toggle("hidden", hidden); $("progress").style.display = hidden ? "none" : "" }
    else deck.goto(a.goto)
    return true
  }
  addEventListener("keydown", e => { if (e.metaKey || e.ctrlKey || e.altKey) return; if (act(deckKeyAction(e.key, e.shiftKey))) { e.preventDefault(); wake() } })
  addEventListener("mousemove", wake)
  stage.addEventListener("click", () => { deck.next(); wake() })
  $("deck-prev").addEventListener("click", () => deck.prev())
  $("deck-next").addEventListener("click", () => deck.next())
  $("deck-full").addEventListener("click", fullscreen)
  let touchX: number | undefined
  stage.addEventListener("touchstart", e => { touchX = e.touches[0]?.clientX }, { passive: true })
  stage.addEventListener("touchend", e => {
    const x = e.changedTouches[0]?.clientX
    if (touchX !== undefined && x !== undefined && Math.abs(x - touchX) > 40) { if (x < touchX) deck.next(); else deck.prev() }
    touchX = undefined
  })
  wake()
  document.documentElement.dataset.ready = "true"
  return deck
}

const ready = start()
ready.then(deck => { window.__silkyDeck = Object.assign(deck, { ready: Promise.resolve() }) }).catch(error => {
  const box = $("present-error"); box.hidden = false
  box.textContent = "SilkyScene 演示页出错：" + (error instanceof Error ? error.message : String(error))
  document.documentElement.dataset.ready = "error"
})
