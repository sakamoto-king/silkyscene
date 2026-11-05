export type Matrix2D = readonly [number, number, number, number, number, number]
export type Coordinate = readonly [number, number]

export function projectPoint([a, b, c, d, x, y]: Matrix2D, [u, v]: Coordinate): Coordinate {
  return [a * u + c * v + x, b * u + d * v + y]
}

export function inversePoint([a, b, c, d, x, y]: Matrix2D, [u, v]: Coordinate): Coordinate {
  const det = a * d - b * c
  if (!Number.isFinite(det) || det === 0) throw new Error("Camera matrix is not invertible")
  return [(d * (u - x) - c * (v - y)) / det, (-b * (u - x) + a * (v - y)) / det]
}

export function measureMotion(matrix: Matrix2D, previous: Matrix2D | undefined, pivot: Coordinate,
  reference: { x: number; y: number }) {
  const [a, b, c, d] = matrix
  const zoom = Math.hypot(a, b)
  if (!Number.isFinite(zoom) || zoom <= 0 || Math.abs(a - d) > 0.001 || Math.abs(b + c) > 0.001) {
    throw new Error("Expected a uniform-scale rotation matrix")
  }
  const target = inversePoint(matrix, pivot)
  const refScreen = projectPoint(matrix, [reference.x, reference.y])
  const targetScreen = projectPoint(matrix, target)
  let pan = 0, rotation = 0, zoomRatio = 1
  if (previous) {
    const p = projectPoint(matrix, inversePoint(previous, pivot))
    pan = Math.hypot(p[0] - pivot[0], p[1] - pivot[1])
    const angle = Math.atan2(b, a) - Math.atan2(previous[1], previous[0])
    rotation = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)) * 180 / Math.PI)
    zoomRatio = zoom / Math.hypot(previous[0], previous[1])
  }
  return { world_x: target[0], world_y: target[1], zoom, pan_px: pan, rotate_deg: rotation,
    zoom_ratio: zoomRatio, matrix, ref_screen: refScreen, target_screen_control: targetScreen }
}

/**
 * docs/04 (AE two-node camera): camera body P = (x, y, z) and point of interest T = (x, y, z), all written, u, Y up,
 * z = height above / toward the viewer. Pitch / yaw / sight distance are derived. The pinhole pivot used by
 * planeHomography is F, where the sight line meets plane z = 0; height = |E − F| − D so that F sits at the screen pivot.
 */
export function deriveView(P: readonly [number, number, number], T: readonly [number, number, number], D: number) {
  const dx = P[0] - T[0], dy = P[1] - T[1], dz = P[2] - T[2], L = Math.hypot(dx, dy, dz)
  if (!(dz > 0) || !(P[2] > 0)) return null
  const nx = dx / L, ny = dy / L, nz = dz / L
  // Eye direction column of M = Ry(yaw)·Rx(pitch) is (sin y·cos p, −sin p, cos y·cos p).
  const pitch = Math.asin(-ny) * 180 / Math.PI, yaw = Math.atan2(nx, nz) * 180 / Math.PI
  const s = P[2] / nz // eye → plane z = 0 along the sight line
  return { distance: D, height: s - D, pitch: pitch === 0 ? 0 : pitch, yaw: yaw === 0 ? 0 : yaw,
    eye: { x: P[0], y: P[1], z: P[2] }, sight: L, frame: [P[0] - s * nx, P[1] - s * ny] as const }
}

// ---------- docs/04 相机 3D 实验（opt-in）。上面的 2D 函数签名与结果不变。 ----------

/** 3 × 3 homography, row-major: maps a layer design-px point (x, y, 1) on one plane to homogeneous screen px. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number]

/** Resolved 3D view at one time. Lengths in design px, angles in radians. */
export interface View3DState {
  /** Pivot-to-camera distance that keeps plane z = 0 at its 2D size (the focal length). */
  distance: number
  /** Extra camera height above the pivot; > 0 shrinks the picture like a real rise. */
  height: number
  /** > 0: camera moves to the world −Y side and looks up the plane (top of picture recedes). */
  pitch: number
  /** > 0: camera moves to the world +X side and looks left (left of picture recedes). */
  yaw: number
}

/**
 * Camera basis M = Ry(yaw)·Rx(pitch) in Y-up world axes (x right, y up, z toward viewer). Columns: right, up, toward-camera.
 * Returned transposed (rows), i.e. Mᵀ, which maps world offsets into camera axes.
 */
export function viewRows(view: View3DState): readonly [readonly number[], readonly number[], readonly number[]] {
  const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch), cy = Math.cos(view.yaw), sy = Math.sin(view.yaw)
  // Rx(p) = [[1,0,0],[0,cp,-sp],[0,sp,cp]], Ry(y) = [[cy,0,sy],[0,1,0],[-sy,0,cy]], M = Ry·Rx
  const M = [[cy, sy * sp, sy * cp], [0, cp, -sp], [-sy, cy * sp, cy * cp]]
  return [[M[0]![0]!, M[1]![0]!, M[2]![0]!], [M[0]![1]!, M[1]![1]!, M[2]![1]!], [M[0]![2]!, M[1]![2]!, M[2]![2]!]]
}

/**
 * Plane z (design px, toward viewer) → screen, through the 2D camera (pivot at canvas centre) plus the 3D view.
 * camera2d is the unchanged 2D matrix; its linear part (zoom, roll) is applied after the pinhole projection.
 * frame is the framing centre in design px (what the pivot looks at on plane z = 0).
 */
export function planeHomography(camera2d: Matrix2D, frame: Coordinate, pivot: Coordinate, view: View3DState, z: number): Homography {
  const [a, b, c, d] = camera2d, [fx, fy] = frame, D = view.distance, Dt = view.distance + view.height
  const R = viewRows(view)
  // q' = Mᵀ · (x − fx, −(y − fy), z): row i = [m_i0, −m_i1, −m_i0·fx + m_i1·fy + m_i2·z]
  const A = R.map(m => [m[0]!, -m[1]!, -m[0]! * fx + m[1]! * fy + m[2]! * z])
  // Homogeneous camera picture (Y down): [D·q'x, −D·q'y, Dt − q'z]
  const G = [A[0]!.map(v => D * v), A[1]!.map(v => -D * v), A[2]!.map((v, k) => -v + (k === 2 ? Dt : 0))]
  const L = [[a, c, pivot[0]], [b, d, pivot[1]], [0, 0, 1]]
  const H = L.map(row => [0, 1, 2].map(k => row[0]! * G[0]![k]! + row[1]! * G[1]![k]! + row[2]! * G[2]![k]!))
  return [...H[0]!, ...H[1]!, ...H[2]!] as unknown as Homography
}

/** Project one layer point; w is the depth along the view axis (must be > 0), scale = distance / w. */
export function projectHomography(H: Homography, [x, y]: Coordinate): { point: Coordinate; w: number } {
  const X = H[0] * x + H[1] * y + H[2], Y = H[3] * x + H[4] * y + H[5], W = H[6] * x + H[7] * y + H[8]
  return { point: [X / W, Y / W], w: W }
}

/** Reference pinhole projection written directly (no matrices), used by the unit tests to cross-check planeHomography. */
export function projectPinhole(camera2d: Matrix2D, frame: Coordinate, pivot: Coordinate, view: View3DState,
  [x, y, z]: readonly [number, number, number]): { point: Coordinate; w: number } {
  const qx = x - frame[0], qy = -(y - frame[1]), qz = z
  // Undo yaw (about y) then pitch (about x): camera coords = Rx(−p)·Ry(−y)·q
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch)
  const ux = cy * qx - sy * qz, uz = sy * qx + cy * qz
  const vy = cp * qy + sp * uz, vz = -sp * qy + cp * uz
  const w = view.distance + view.height - vz, k = view.distance / w
  const sx = ux * k, syd = -vy * k
  const [a, b, c, d] = camera2d
  return { point: [a * sx + c * syd + pivot[0], b * sx + d * syd + pivot[1]], w }
}
