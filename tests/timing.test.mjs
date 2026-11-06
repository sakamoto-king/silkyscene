import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { compileTimeline, lintScene, parseProject, parseTiming, sceneDuration, timingAnchors } from '../dist/index.js'

const read = name => JSON.parse(fs.readFileSync(new URL('../playground/' + name, import.meta.url), 'utf8'))

test('timing.json with a narration segments array keeps only finite number anchors', () => {
  const raw = { intro: 0, pan: 5.5, bad: 'x', nan: null, inf: 1e999, nested: { a: 1 },
    segments: [{ name: 's1', start: 0, end: 5.5, text: '很多人每天列十几条待办' }, { name: 'broken', start: '0', end: 2 }, 3] }
  const { anchors, segments, ignored } = parseTiming(raw)
  assert.deepEqual([...anchors], [['intro', 0], ['pan', 5.5]])
  assert.ok([...anchors.values()].every(Number.isFinite))
  assert.deepEqual(segments, [{ name: 's1', start: 0, end: 5.5, text: '很多人每天列十几条待办' }])
  assert.deepEqual(ignored.sort(), ['bad', 'inf', 'nan', 'nested'])
  assert.deepEqual([...timingAnchors(raw)], [...anchors])
})

test('missing or malformed timing degrades to an empty table', () => {
  for (const raw of [undefined, null, 3, 'x', [], [1, 2]]) {
    const t = parseTiming(raw)
    assert.equal(t.anchors.size, 0); assert.equal(t.segments.length, 0)
  }
})

test('a real scene compiles and lints the same with or without a segments array', () => {
  const doc = parseProject(read('canvas-handoff.scene.json'))
  const plain = read('canvas-handoff-timing.json')
  const withSegments = { ...plain, segments: [{ name: 'all', start: 0, end: 8, text: '改提示词' }] }
  const a = parseTiming(plain), b = parseTiming(withSegments)
  assert.deepEqual([...a.anchors], [...b.anchors])
  const ta = compileTimeline(doc, a.anchors), tb = compileTimeline(doc, b.anchors)
  assert.deepEqual(ta.cameraAt(4), tb.cameraAt(4))
  assert.deepEqual(lintScene(doc, b.anchors), lintScene(doc, a.anchors))
  // The old Object.entries path would have put the array into the anchor map.
  assert.ok(Array.isArray(new Map(Object.entries(withSegments)).get('segments')))
})

test('sceneDuration takes the latest cue end, segment end or anchor', () => {
  const doc = parseProject(read('canvas-handoff.scene.json'))
  const { anchors } = parseTiming(read('canvas-handoff-timing.json'))
  const natural = sceneDuration(doc, anchors)
  assert.ok(Number.isFinite(natural) && natural >= 14 - 1e-9)
  assert.equal(sceneDuration(doc, anchors, [{ start: 0, end: 30 }]), 30)
  assert.equal(sceneDuration({ cues: [] }, new Map()), 0)
  assert.equal(sceneDuration({ cues: [{ at: 'a', duration: 1.5 }] }, new Map([['a', 2]])), 3.5)
})

test('the four official examples pass check_scene --strict (0 lint, 0 quality warnings)', () => {
  const r = spawnSync(process.execPath, ['tools/check_scene.mjs', '--strict', 'spatial-stage', 'topology-flow', 'scale-matrix', 'canvas-handoff'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  for (const name of ['spatial-stage', 'topology-flow', 'scale-matrix', 'canvas-handoff']) assert.match(r.stdout, new RegExp('✔ ' + name + '.*0 逐帧警告, 0 质量警告'))
})

test('player page exposes the __silkyPlayer and HyperFrames (__hf) frame protocol', () => {
  const ts = fs.readFileSync(new URL('../playground/player.ts', import.meta.url), 'utf8')
  for (const needle of ['window.__silkyPlayer', 'window.__hf =', 'window.__hfWaitForSeekCompletion', 'window.__renderReady = true', 'prepared.renderAt(t)', 'parseTiming(']) {
    assert.ok(ts.includes(needle), needle)
  }
  const html = fs.readFileSync(new URL('../playground/player.html', import.meta.url), 'utf8')
  assert.match(html, /data-composition-id/)
})

test('export_mp4 prints usage and rejects bad options without launching a browser', () => {
  const cwd = new URL('..', import.meta.url)
  const help = spawnSync(process.execPath, ['tools/export_mp4.mjs', '--help'], { cwd, encoding: 'utf8' })
  assert.equal(help.status, 0); assert.match(help.stdout, /export:mp4/)
  const bad = spawnSync(process.execPath, ['tools/export_mp4.mjs', 'topology-flow', '--width', '1919'], { cwd, encoding: 'utf8' })
  assert.equal(bad.status, 1); assert.match(bad.stderr, /偶数/)
})
