import assert from "node:assert/strict"
import test from "node:test"
import fs from "node:fs"
import { createDeckController, deckKeyAction, deckSteps, parseTiming } from "../dist/index.js"

const steps = [{ id: "a", at: 0 }, { id: "b", at: 2 }, { id: "c", at: 5 }]
const run = (deck, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) deck.tick(dt) }

test("步点来源：steps 优先，其次 segments 起点，最后锚点；自然结束追加「结束」步", () => {
  const anchors = new Map([["x", 1], ["y", 3]])
  assert.deepEqual(deckSteps({ anchors, steps: [{ id: "s2", at: 4 }, { id: "s1", at: 0, title: "开场" }] }).map(s => s.at), [0, 4])
  assert.deepEqual(deckSteps({ anchors, segments: [{ name: "p1", start: 0, end: 2, text: "一" }, { name: "p2", start: 2, end: 5 }] }, 6),
    [{ id: "p1", at: 0, title: "一" }, { id: "p2", at: 2 }, { id: "end", at: 6, title: "结束" }])
  assert.deepEqual(deckSteps({ anchors }).map(s => s.at), [0, 1, 3])
  const t = parseTiming({ a: 0, steps: [{ id: "z", at: 3 }, { at: 1, title: "t" }, { at: "bad" }] })
  assert.deepEqual(t.steps, [{ id: "step2", at: 1, title: "t" }, { id: "z", at: 3 }])
  assert.equal(t.anchors.size, 1)
})

test("next：1× 正放到下一个停靠点并精确停住；停住后不再走", () => {
  const deck = createDeckController(steps)
  assert.equal(deck.state.time, 0)
  deck.next(); assert.equal(deck.state.target, 1)
  run(deck, 1); assert.ok(Math.abs(deck.state.time - 1) < 0.02); assert.ok(deck.moving)
  run(deck, 1.5); assert.equal(deck.state.time, 2); assert.equal(deck.state.index, 1); assert.equal(deck.moving, false)
  run(deck, 3); assert.equal(deck.state.time, 2)
})

test("过渡中再按 next：先跳到目标停靠点，再继续下一步", () => {
  const deck = createDeckController(steps)
  deck.next(); run(deck, 0.5)
  deck.next(); assert.equal(deck.state.index, 1); assert.equal(deck.state.target, 2); assert.equal(deck.state.time, 2)
  run(deck, 3.2); assert.equal(deck.state.time, 5); assert.equal(deck.moving, false)
  deck.next(); assert.equal(deck.state.time, 5) // 最后一步再按不动
})

test("prev：同速倒放回上一个停靠点；倒放途中再按继续往回", () => {
  const deck = createDeckController(steps, { start: 2 })
  assert.equal(deck.state.time, 5)
  deck.prev(); assert.equal(deck.state.target, 1)
  run(deck, 1.5); assert.ok(Math.abs(deck.state.time - 3.5) < 0.02)
  deck.prev(); assert.equal(deck.state.time, 2); assert.equal(deck.state.target, 0)
  run(deck, 2.5); assert.equal(deck.state.time, 0); assert.equal(deck.state.index, 0)
  deck.prev(); assert.equal(deck.state.time, 0)
})

test("正放途中按 prev：从当前时间倒放回出发的停靠点", () => {
  const deck = createDeckController(steps)
  deck.next(); run(deck, 1)
  deck.prev(); assert.equal(deck.state.target, 0)
  run(deck, 1.2); assert.equal(deck.state.time, 0)
})

test("goto 直接跳；subscribe 收到每次变化；键位映射", () => {
  const deck = createDeckController(steps), seen = []
  const off = deck.subscribe(s => seen.push(s.time))
  deck.goto(2); assert.equal(deck.state.time, 5); deck.goto(99); assert.equal(deck.state.index, 2)
  off(); deck.goto(0); assert.deepEqual(seen, [5, 5])
  assert.equal(deckKeyAction(" "), "next"); assert.equal(deckKeyAction(" ", true), "prev")
  for (const k of ["ArrowRight", "ArrowDown", "PageDown"]) assert.equal(deckKeyAction(k), "next")
  for (const k of ["ArrowLeft", "ArrowUp", "PageUp"]) assert.equal(deckKeyAction(k), "prev")
  assert.deepEqual(deckKeyAction("3"), { goto: 2 }); assert.equal(deckKeyAction("f"), "fullscreen"); assert.equal(deckKeyAction("H"), "toggleHud")
  assert.equal(deckKeyAction("x"), undefined)
  assert.throws(() => createDeckController([]), /至少需要一个步点/)
})

test("四支官方样片都写了演示停靠拍", () => {
  for (const name of ["spatial-stage", "topology-flow", "scale-matrix", "canvas-handoff"]) {
    const t = parseTiming(JSON.parse(fs.readFileSync(new URL("../playground/" + name + "-timing.json", import.meta.url), "utf8")))
    assert.ok(t.steps.length >= 4, name); assert.ok(t.segments.length >= 4, name)
    assert.ok(t.steps.every(s => s.title), name)
  }
})

test("present 页面：键盘 / 触摸 / 全屏 / 隐藏提示条都接上，并走 renderAt", () => {
  const ts = fs.readFileSync(new URL("../playground/present.ts", import.meta.url), "utf8")
  for (const needle of ["createDeckController(", "deckKeyAction(", "deckSteps(", "prepared.renderAt(", "requestAnimationFrame(loop)", "touchend", "requestFullscreen", "toggleHud"]) assert.ok(ts.includes(needle), needle)
  const html = fs.readFileSync(new URL("../playground/inspector.html", import.meta.url), "utf8")
  assert.match(html, /现场演示 ↗/)
})
