/**
 * @silkysite/scene — canvas-first, deterministic motion scenes for the web.
 * One scene document drives three outputs: the inspector, live step-by-step presentation, and frame-exact MP4 export.
 */
export type { CanvasSize, ResolvedRect } from "./shared/geometry.js"
export type {
  ResolvedImagePrimitive,
  ResolvedLinePrimitive,
  ResolvedPrimitive,
  ResolvedRectPrimitive,
  ResolvedScene,
  ResolvedTextPrimitive,
  StrokeStyle,
} from "./render/primitives.js"
export type { HybridRenderHandle } from "./render/hybridRenderer.js"
export { renderHybridScene } from "./render/hybridRenderer.js"

export { parseProject, SCREEN } from "./pipeline/definition.js"
export { cubicBezier, easeFunction, easeNumbers, NAMED_BEZIER } from "./pipeline/easing.js"
export type { Ease } from "./pipeline/easing.js"
export type { ProjectDocument, ElementDefinition, Region, Layout, Cue } from "./pipeline/definition.js"
export { prepareProject } from "./pipeline/render.js"

export { cameraCorners, cameraMovePaths, cameraSample, documentField, inspectFrame, projectCameraTrace, regionRect } from "./pipeline/inspect.js"
export type { InspectorFrame, InspectorElement, PreparedProject } from "./pipeline/inspect.js"
export type { CompiledCue, CurrentCue, FrameState } from "./pipeline/timeline.js"
export { compileTimeline } from "./pipeline/timeline.js"
export { lintScene, lintSummary, BAKED_MESSAGE } from "./pipeline/lint.js"
export type { BakedTrajectoryWarning, LintOptions } from "./pipeline/lint.js"
export { parseTiming, sceneDuration, timingAnchors } from "./pipeline/timing.js"
export type { ParsedTiming, TimingSegment, TimingStep } from "./pipeline/timing.js"
export { qualityScan, screenQuad } from "./pipeline/quality.js"
export type { QualityFrame, QualityIssue, QualityOptions } from "./pipeline/quality.js"
export { isGradient } from "./pipeline/definition.js"
export { createSceneBuilder, px } from "./builder.js"
export type { BuiltScene, CueOptions, Place, SceneBuilder, SceneBuilderOptions } from "./builder.js"
export { createDeckController, deckKeyAction, deckSteps } from "./presentation.js"
export type { DeckAction, DeckController, DeckState, DeckStep } from "./presentation.js"
