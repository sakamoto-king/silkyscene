#!/usr/bin/env node
// docs/06：把任意 SilkyScene 场景确定性导出为 MP4。
//
//   npm run export:mp4 -- <doc> [选项]
//   node tools/export_mp4.mjs <doc> [选项]
//
// 管道：内置 Vite（随机空闲端口，不碰已在跑的 dev server）→ 本机 Chrome / Edge 无头实例（原生 CDP，零新增依赖）
//      → playground/player.html?doc=<doc> → 逐帧 __silkyPlayer.seek(t)（renderAt + 双 rAF）→ Page.captureScreenshot
//      → stdin 流式喂给 ffmpeg（image2pipe → libx264 yuv420p，可选 AAC 音轨）。磁盘上不落临时帧。
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { createServer as createNetServer } from "node:net"
import { once } from "node:events"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const HELP = `用法: npm run export:mp4 -- <doc> [选项]
       node tools/export_mp4.mjs <doc> [选项]

  <doc>                 playground/<doc>.scene.json（+ 可选 <doc>-timing.json）
  --scene <path>        改用任意路径的 .scene.json（timing 默认取同目录 <name>-timing.json）
  --timing <path>       显式指定时间表 JSON
  --out <file.mp4>      输出路径（默认 _storage/exports/<doc>.mp4）
  --fps <n>             帧率（默认 30）
  --width <px>          输出宽（默认 1920）     --height <px>   输出高（默认 1080）
  --start <sec>         起始秒（默认 0）        --duration <sec> 导出时长（默认场景自然时长 - start）
  --crf <n>             x264 质量（默认 18）     --preset <name> x264 preset（默认 medium）
  --audio <file>        合成 AAC 音轨（与场景 0s 对齐，按 --start 偏移）
  --format png|jpeg     截图格式（默认 png 无损；jpeg 更快）  --quality <1-100> jpeg 质量（默认 95）
  --browser <exe>       指定 Chrome / Edge / chrome-headless-shell（或环境变量 SILKY_BROWSER）
  --ffmpeg <exe>        指定 ffmpeg（或环境变量 FFMPEG_PATH）
  --base-url <url>      复用已在跑的服务器（如 http://127.0.0.1:5311），不再内置启动 Vite
  --headful             显示浏览器窗口（调试用）`

// ---------- args ----------
function parseArgs(argv) {
  const opts = { fps: 30, width: 1920, height: 1080, start: 0, crf: 18, preset: "medium", format: "png", quality: 95 }
  const flags = new Set(["headful", "help"])
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "-h" || a === "--help") { opts.help = true; continue }
    if (!a.startsWith("--")) { positional.push(a); continue }
    let [key, value] = a.slice(2).split(/=(.*)/s, 2)
    key = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (flags.has(key)) { opts[key] = true; continue }
    if (value === undefined) { value = argv[++i]; if (value === undefined) throw new Error("缺少参数值：" + a) }
    opts[key] = value
  }
  for (const k of ["fps", "width", "height", "start", "duration", "crf", "quality"]) {
    if (opts[k] === undefined) continue
    const n = Number(opts[k])
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${k} 需要非负数字，收到 ${opts[k]}`)
    opts[k] = n
  }
  if (!(opts.fps > 0) || !Number.isInteger(opts.fps)) throw new Error("--fps 需要正整数")
  if (opts.width % 2 || opts.height % 2 || !opts.width || !opts.height) throw new Error("--width / --height 需要正偶数（yuv420p）")
  if (opts.duration !== undefined && !(opts.duration > 0)) throw new Error("--duration 需要大于 0")
  if (!["png", "jpeg"].includes(opts.format)) throw new Error("--format 只支持 png / jpeg")
  opts.doc = positional[0]
  if (!opts.doc && !opts.scene) opts.help = true
  return opts
}

// ---------- locate tools ----------
function onPath(name) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue
    for (const ext of process.platform === "win32" ? [".exe", ".cmd", ""] : [""]) {
      const p = path.join(dir, name + ext)
      try { if (statSync(p).isFile()) return p } catch { /* next */ }
    }
  }
}
function findBrowser(explicit) {
  const given = explicit ?? process.env.SILKY_BROWSER ?? process.env.CHROME_PATH
  if (given) { if (!existsSync(given)) throw new Error("找不到指定浏览器：" + given); return given }
  const env = process.env, candidates = []
  if (process.platform === "win32") {
    for (const base of [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(path.join(base, "Google/Chrome/Application/chrome.exe"), path.join(base, "Microsoft/Edge/Application/msedge.exe"))
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
  } else {
    for (const n of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable"]) {
      const p = onPath(n); if (p) candidates.push(p)
    }
  }
  const hit = candidates.find(p => existsSync(p))
  if (!hit) throw new Error("没找到 Chrome / Edge，请用 --browser <exe> 或环境变量 SILKY_BROWSER 指定")
  return hit
}
function findFfmpeg(explicit) {
  const exe = explicit ?? process.env.FFMPEG_PATH ?? onPath("ffmpeg")
  if (!exe || spawnSync(exe, ["-version"], { stdio: "ignore" }).status !== 0) throw new Error("没找到可用的 ffmpeg，请安装或用 --ffmpeg <exe> 指定")
  return exe
}
const freePort = () => new Promise((resolve, reject) => {
  const srv = createNetServer().once("error", reject)
  srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)) })
})

// ---------- minimal CDP over the browser WebSocket (Node ≥ 22 global WebSocket) ----------
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.listeners = new Set()
    this.opened = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error("CDP WebSocket 连接失败：" + url)) })
    this.ws.onmessage = ev => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"))
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id); if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(p.method + ": " + msg.error.message)); else p.resolve(msg.result)
      } else for (const fn of this.listeners) fn(msg)
    }
    this.ws.onclose = () => { for (const p of this.pending.values()) p.reject(new Error("浏览器连接已关闭")); this.pending.clear() }
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
    })
  }
  on(fn) { this.listeners.add(fn) }
  close() { try { this.ws.close() } catch { /* already closed */ } }
}

async function launchBrowser(exe, { width, height, headful }) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "silky-export-"))
  const args = [headful ? "" : "--headless=new", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows", "--disable-features=Translate,MediaRouter", "--hide-scrollbars", "--mute-audio",
    "--force-color-profile=srgb", "--force-device-scale-factor=1", "--disable-gpu", `--window-size=${width},${height}`, "about:blank"].filter(Boolean)
  if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox")
  const child = spawn(exe, args, { stdio: ["ignore", "ignore", "pipe"] })
  let log = ""
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("浏览器 20s 内没有打开调试端口：\n" + log.slice(-2000))), 20000)
    child.stderr.on("data", chunk => {
      log += chunk
      const m = log.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) { clearTimeout(timer); resolve(m[1]) }
    })
    child.once("error", e => { clearTimeout(timer); reject(e) })
    child.once("exit", code => { clearTimeout(timer); reject(new Error("浏览器提前退出（" + code + "）：\n" + log.slice(-2000))) })
  })
  child.stderr.removeAllListeners("data")
  child.stderr.resume()
  return { child, wsUrl, profile }
}

// ---------- main ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) { console.log(HELP); return }
  const ffmpeg = findFfmpeg(opts.ffmpeg)
  const browserExe = findBrowser(opts.browser)

  // Scene location → URL path under the server root.
  let doc = opts.doc, query = new URLSearchParams()
  const fsAllow = [ROOT]
  const toUrlPath = file => {
    const abs = path.resolve(file)
    if (!existsSync(abs)) throw new Error("文件不存在：" + abs)
    const rel = path.relative(ROOT, abs)
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return "/" + rel.split(path.sep).join("/")
    fsAllow.push(path.dirname(abs))
    return "/@fs/" + abs.split(path.sep).join("/").replace(/^\/+/, "")
  }
  if (opts.scene) {
    doc ??= path.basename(opts.scene).replace(/\.scene\.json$|\.json$/, "")
    query.set("scene", toUrlPath(opts.scene))
    const sibling = path.resolve(opts.scene).replace(/\.scene\.json$/, "-timing.json")
    const timing = opts.timing ?? (existsSync(sibling) ? sibling : undefined)
    query.set("timing", timing ? toUrlPath(timing) : "about:blank")
  } else {
    if (!/^[\w.-]+$/.test(doc)) throw new Error("<doc> 只接受文件名；任意路径请用 --scene")
    if (!existsSync(path.join(ROOT, "playground", doc + ".scene.json"))) throw new Error("找不到 playground/" + doc + ".scene.json")
    query.set("doc", doc)
    if (opts.timing) query.set("timing", toUrlPath(opts.timing))
  }
  query.set("fps", String(opts.fps))
  const out = path.resolve(opts.out ?? path.join(ROOT, "_storage", "exports", doc + ".mp4"))
  mkdirSync(path.dirname(out), { recursive: true })
  if (opts.audio && !existsSync(opts.audio)) throw new Error("音频文件不存在：" + opts.audio)

  const cleanup = []
  const runCleanup = async () => { while (cleanup.length) { try { await cleanup.pop()() } catch { /* best effort */ } } }
  const onSignal = () => { console.error("\n已中断，正在清理…"); void runCleanup().then(() => process.exit(130)) }
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)
  try {
    let base = opts.baseUrl?.replace(/\/+$/, "")
    if (!base) {
      const { createServer } = await import("vite")
      const port = await freePort()
      const server = await createServer({
        root: ROOT, configFile: false, logLevel: "error", clearScreen: false, appType: "mpa",
        server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null, fs: { allow: fsAllow } },
      })
      await server.listen()
      cleanup.push(() => server.close())
      base = "http://127.0.0.1:" + port
    }
    const url = base + "/playground/player.html?" + query.toString()

    const browser = await launchBrowser(browserExe, opts)
    cleanup.push(async () => {
      if (browser.child.exitCode === null) { browser.child.kill(); await Promise.race([once(browser.child, "exit"), new Promise(r => setTimeout(r, 3000))]) }
      rmSync(browser.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    })
    const cdp = new Cdp(browser.wsUrl)
    await cdp.opened
    cleanup.push(async () => { await cdp.send("Browser.close").catch(() => undefined); cdp.close() })
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" })
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true })
    const page = (method, params) => cdp.send(method, params, sessionId)
    const pageErrors = []
    cdp.on(msg => {
      if (msg.sessionId !== sessionId) return
      if (msg.method === "Runtime.exceptionThrown") pageErrors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text)
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") pageErrors.push(msg.params.args.map(a => a.value ?? a.description).join(" "))
    })
    await page("Page.enable")
    await page("Runtime.enable")
    await page("Emulation.setDeviceMetricsOverride", { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false })
    await page("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 1 } })
    const evaluate = async expression => {
      const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value
    }
    console.log("▶ 打开 " + url)
    await page("Page.navigate", { url })
    const info = await evaluate(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 120000
      const poll = () => window.__silkyPlayer ? window.__silkyPlayer.ready.then(resolve, reject)
        : Date.now() > deadline ? reject(new Error("播放页 120s 内未就绪")) : setTimeout(poll, 50)
      poll()
    })`).catch(e => { throw new Error("播放页加载失败：" + e.message + (pageErrors.length ? "\n" + pageErrors.join("\n") : "")) })

    const start = opts.start
    const duration = opts.duration ?? Math.max(0, info.duration - start)
    const frames = Math.round(duration * opts.fps)
    if (frames < 1) throw new Error(`没有可导出的帧（场景时长 ${info.duration.toFixed(3)}s，start ${start}s）`)
    console.log(`▶ ${doc}: 画布 ${info.width}×${info.height} → 输出 ${opts.width}×${opts.height} @ ${opts.fps}fps，` +
      `${start.toFixed(2)}s 起 ${duration.toFixed(3)}s = ${frames} 帧（场景自然时长 ${info.duration.toFixed(3)}s，${info.anchors} 锚点 / ${info.segments} 台词段）`)

    const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(opts.fps),
      "-c:v", opts.format === "png" ? "png" : "mjpeg", "-i", "pipe:0"]
    if (opts.audio) args.push(...(start > 0 ? ["-ss", String(start)] : []), "-i", path.resolve(opts.audio))
    args.push("-frames:v", String(frames), "-r", String(opts.fps), "-fps_mode", "cfr",
      "-vf", `scale=${opts.width}:${opts.height}:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p`,
      "-c:v", "libx264", "-preset", opts.preset, "-crf", String(opts.crf), "-pix_fmt", "yuv420p",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv", "-movflags", "+faststart")
    if (opts.audio) args.push("-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "192k", "-t", String(frames / opts.fps))
    else args.push("-an")
    args.push(out)
    const encoder = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] })
    let ffErr = "", pipeError
    encoder.stderr.on("data", d => { ffErr += d })
    encoder.stdin.on("error", e => { pipeError = e })
    const encoded = once(encoder, "close")
    cleanup.push(() => { if (encoder.exitCode === null) { encoder.stdin.destroy(); encoder.kill() } })

    const shot = { format: opts.format, fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true,
      ...(opts.format === "jpeg" ? { quality: opts.quality } : {}) }
    const began = Date.now(), tty = process.stdout.isTTY
    let lastLog = 0
    for (let f = 0; f < frames; f++) {
      await evaluate(`window.__silkyPlayer.seek(${start + f / opts.fps})`)
      const { data } = await page("Page.captureScreenshot", shot)
      if (pipeError || encoder.exitCode !== null) throw new Error("ffmpeg 中途退出：" + (ffErr || pipeError?.message))
      if (!encoder.stdin.write(Buffer.from(data, "base64"))) await once(encoder.stdin, "drain")
      const now = Date.now()
      if (f === frames - 1 || now - lastLog > (tty ? 200 : 2000)) {
        lastLog = now
        const done = f + 1, speed = done / Math.max(0.001, (now - began) / 1000)
        const line = `  帧 ${String(done).padStart(String(frames).length)}/${frames}  ${(done / frames * 100).toFixed(1).padStart(5)}%  ` +
          `${speed.toFixed(1)} fps  剩余约 ${Math.ceil((frames - done) / speed)}s`
        if (tty) process.stdout.write("\r" + line.padEnd(70)); else console.log(line)
      }
    }
    if (tty) process.stdout.write("\n")
    encoder.stdin.end()
    const [code] = await encoded
    if (code !== 0) throw new Error("ffmpeg 编码失败（" + code + "）：" + ffErr)
    if (pageErrors.length) console.warn("⚠ 页面报错：\n  " + pageErrors.join("\n  "))
    const seconds = (Date.now() - began) / 1000
    const size = statSync(out).size
    console.log(`✔ 已导出 ${out}`)
    console.log(`  ${opts.width}×${opts.height} · ${opts.fps}fps · ${frames} 帧 · ${(frames / opts.fps).toFixed(3)}s · ` +
      `H.264 yuv420p crf ${opts.crf}${opts.audio ? " + AAC" : ""} · ${(size / 1048576).toFixed(2)} MB · ` +
      `用时 ${seconds.toFixed(1)}s（${(frames / seconds).toFixed(1)} fps，${(frames / opts.fps / seconds).toFixed(2)}× 实时）`)
  } finally {
    process.removeListener("SIGINT", onSignal)
    process.removeListener("SIGTERM", onSignal)
    await runCleanup()
  }
}

main().catch(error => {
  console.error("✖ " + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
})
