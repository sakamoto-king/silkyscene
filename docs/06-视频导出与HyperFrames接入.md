# 06 · 视频导出与 HyperFrames 接入

> **双模合一 = 现场步进演示 `present.html` + 确定性视频导出 `player.html` / `export:mp4`。** 本文讲后一半。

SilkyScene 的每一帧都是 `prepared.renderAt(t)` 的纯函数结果，不依赖浏览器实时定时器。导出 MP4 就是「逐帧 seek → 截图 → 喂给 ffmpeg」。

## 1. 一行命令

```bash
npm run export:mp4 -- topology-flow                         # → _storage/exports/topology-flow.mp4
npm run export:mp4 -- topology-flow --duration 6            # 先出 6 秒短样
npm run export:mp4 -- weekly --audio voice.wav --crf 16     # 合成口播音轨
node tools/export_mp4.mjs --scene /path/foo.scene.json --out /path/foo.mp4
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `<doc>` | — | `playground/<doc>.scene.json` + 可选 `<doc>-timing.json` |
| `--scene` / `--timing` | — | 任意路径的场景 / 时间表（Vite `/@fs/` 提供，素材相对路径照常解析） |
| `--out` | `_storage/exports/<doc>.mp4` | `_storage/` 不入库 |
| `--fps` `--width` `--height` | 30 · 1920 · 1080 | 画布按视口等比居中；宽高须为偶数 |
| `--start` `--duration` | 0 · 自然时长 | 自然时长 = max(节点结束, 讲稿段 end, 锚点) |
| `--crf` `--preset` | 18 · medium | libx264，yuv420p，bt709，`+faststart` |
| `--audio` | — | AAC 192k，与场景 0 s 对齐，随 `--start` 偏移，按视频帧数截断 |
| `--format` `--quality` | png · 95 | 截图编码；jpeg 更快但有损 |
| `--browser` / `SILKY_BROWSER` | 自动找 Chrome → Edge | 也可指向 `chrome-headless-shell` |
| `--ffmpeg` / `FFMPEG_PATH` | PATH 上的 ffmpeg | |
| `--base-url` | 内置 Vite | 复用已在跑的服务（如 `http://127.0.0.1:5311`） |

终端实时打印帧数、百分比、捕获速度和剩余时间，结束时给出路径、分辨率、帧数、时长、体积与实时倍率。

## 2. 管道（零新增依赖）

1. **服务**：用仓库已有的 `vite` 在随机空闲端口起临时服务（`hmr: false`），结束即关闭，不碰已在跑的 dev server。
2. **浏览器**：直接启动本机 Chrome / Edge（`--headless=new --remote-debugging-port=0`，临时 profile），用 Node ≥ 22 自带的 `WebSocket` 说原生 CDP——不装 Playwright / Puppeteer。
3. **逐帧**：`__silkyPlayer.seek(t)`（同步 `renderAt(t)` + 更新 DOM，等图片解码与两个 `requestAnimationFrame`）→ `Page.captureScreenshot`（DPR 1）。
4. **编码**：截图直接写入 `ffmpeg -f image2pipe … -c:v libx264 -pix_fmt yuv420p`，带背压，磁盘上不落临时帧。
5. **清理**：关浏览器 → 结束子进程 → 删临时 profile → 关 Vite；Ctrl+C 同样清理。

## 3. 帧播放页 `playground/player.html`

纯 `100vw × 100vh` 舞台，画布按视口等比居中，字体与检查器同源（`_storage/inspector-fonts`）。

- `?doc=<name>`（默认 `topology-flow`），或 `?scene=<url>&timing=<url>`；`&fps=30`、`&duration=8`、`&t=2.5` / `&frame=75`。
- `window.__silkyPlayer = { ready, duration, fps, totalFrames, width, height, time, seek(t), seekFrame(i) }`：`seek` 返回 Promise，画面涂装完毕后解析。
- **HyperFrames 0.8.x 协议**：`window.__hf = { duration, fps, width, height, seek(t) }` + `window.__hfWaitForSeekCompletion()` + `window.__renderReady = true`，舞台根节点带 `data-composition-id="silkyscene"` 与 `data-width / height / duration`。HyperFrames 的捕获会话可以直接把这一页当作合成页：`createCaptureSession("<vite>/playground/player.html?doc=topology-flow", …)`。
- 出错时页面显示红条，`<html data-ready="error">`，`ready` 被拒绝，导出脚本带上页面报错退出。

## 4. 为什么能逐帧一致

- 时间轴求值是 `t → 声明状态` 的纯函数；接管规则在编译期展开，不依赖播放历史。
- 文字所有变体（`text` 节点、`bind`）在准备阶段测量完毕，导出时不会因字体晚到而跳动。
- 现场演示页、检查器、帧播放页都调用同一个 `prepared.renderAt(t)`：彩排时看到的，就是导出的。
