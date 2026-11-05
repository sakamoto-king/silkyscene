import { parseProject } from "./definition.js"
import type { ProjectDocument } from "./definition.js"
import { measureProject } from "./measure.js"
import type { Measurement } from "./measure.js"
import { resolveProject } from "./resolve.js"
import { compileTimeline } from "./timeline.js"
import type { FrameState } from "./timeline.js"

/**
 * Times the prepare step checks: every cue start and end, plus every frame in between at `fps`.
 * Bounds can be crossed mid-cue (motionPath detours, eases with y outside [0, 1], springs), so start/end alone is not enough.
 */
export function checkTimes(boundaries: readonly number[], fps: number): number[] {
  const end = boundaries[boundaries.length - 1] ?? 0
  const frames = Array.from({ length: Math.floor(end * fps + 1e-9) + 1 }, (_, i) => i / fps)
  return [...new Set([...boundaries, ...frames])].sort((a, b) => a - b)
}

/** Run one evaluation and prefix any error with its time, so a mid-cue failure says when it happens. */
export function atTime<T>(time: number, run: () => T): T {
  try { return run() } catch (e) { throw new Error(time.toFixed(3) + " s：" + (e as Error).message) }
}

/** Narrowest resolved width of each fixed-width text over the checked times (a group or width cue can squeeze it). */
export function narrowestTextWidths(project: ProjectDocument, measured: ReadonlyMap<string, Measurement>,
  times: readonly number[], stateAt: (time: number) => FrameState): Map<string, number> {
  const texts = project.elements.filter(e => e.kind === "text" && e.layout.width !== undefined).map(e => e.id)
  const widths = new Map<string, number>()
  for (const time of times) {
    const { boxes } = atTime(time, () => resolveProject(project, measured, stateAt(time), { skipTextHeight: true }))
    for (const id of texts) widths.set(id, Math.min(widths.get(id) ?? Infinity, boxes.get(id)!.width))
  }
  return widths
}

/** Prepare a project once, then evaluate its picture at any time. Every frame goes through the same resolve. */
export async function prepareProject(input: unknown,
  options: { baseUrl: string; anchors: ReadonlyMap<string, number>; fps?: number }) {
  const document = parseProject(input)
  const timeline = compileTimeline(document, options.anchors)
  const times = checkTimes(timeline.boundaries, options.fps ?? 30)
  let measurement = await measureProject(document, options.baseUrl, timeline.textVariants)
  // Text measured at its declared width can wrap more once a parent group shrinks: re-measure at the narrowest width.
  const narrow = narrowestTextWidths(document, measurement, times, timeline.stateAt)
  measurement = await measureProject(document, options.baseUrl, timeline.textVariants, narrow)
  const resolved = resolveProject(document, measurement)
  const resolveAt = (time: number) => resolveProject(document, measurement, timeline.stateAt(time))
  // Fail at prepare time, not mid-playback.
  for (const time of times) atTime(time, () => resolveAt(time))
  return { ...resolved, document, measurement, tracks: timeline.tracks, cuesAt: timeline.cuesAt,
    cameraMoves: timeline.cameraMoves, lookAt: timeline.lookAt,
    /** docs/02: the 2D camera matrix alone (same as renderAt(t).camera) without resolving every element. */
    cameraAt: timeline.cameraAt,
    positionMoves: timeline.positionMoves, positionAt: timeline.positionAt, targetAt: timeline.targetAt,
    resolveAt, renderAt: (time: number) => resolveAt(time).scene }
}
