import * as THREE from 'three'

/**
 * 步进吸附计算（默认开启工程吸附，按住 Shift 时临时解除）
 *
 * @param value 原始浮点坐标或角度值
 * @param step 吸附步进大小（如 1.0mm, 5.0mm, 90.0°）
 * @param bypass 是否解除吸附（例如用户按住 Shift 键）
 * @returns 吸附或微调后的数值
 */
export function snapValue(value: number, step: number = 1.0, bypass: boolean = false): number {
  if (bypass) {
    // 连续微调时保留 2 位小数，避免浮点数无限精度的视觉杂乱
    return Math.round(value * 100) / 100
  }
  if (step <= 0) return value
  const snapped = Math.round(value / step) * step
  // 消除 -0 以及浮点精度误差（如 0.30000000000000004）
  return Object.is(snapped, -0) ? 0 : Number(snapped.toFixed(4))
}

/**
 * 计算三维物体在当前相机下的恒定屏幕像素缩放比例（Screen-Space Pixel Invariance）
 *
 * @param camera 当前 Three.js 相机 (正交或透视)
 * @param worldPos 目标物体的世界坐标中心
 * @param targetPixels 希望在屏幕上保持的固定像素大小（默认 60px）
 * @param canonicalModelSize 内部模型几何的基准尺寸（若内部几何已经按像素设计，则传入与 targetPixels 相同或 1.0）
 * @param viewportHeight 参考视口高度（默认 800px）
 * @returns 用于 scale.set(s, s, s) 的缩放系数
 */
export function computeScreenPixelScale(
  camera: THREE.Camera,
  worldPos: THREE.Vector3 | [number, number, number],
  targetPixels: number = 60,
  canonicalModelSize: number = 1.0,
  viewportHeight: number = 800
): number {
  const ratio = canonicalModelSize > 0 ? targetPixels / canonicalModelSize : 1.0

  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const orthoCam = camera as THREE.OrthographicCamera
    // 正交相机下尺寸: Pixel = WorldSize * scale * zoom => scale = (Pixels / WorldSize) / zoom
    const zoom = Math.max(orthoCam.zoom || 1, 0.0001)
    return ratio / zoom
  }

  // 透视相机下依据视距与视场角计算
  const perspCam = camera as THREE.PerspectiveCamera
  const posVec = Array.isArray(worldPos)
    ? new THREE.Vector3(...worldPos)
    : worldPos
  const dist = Math.max(perspCam.position.distanceTo(posVec), 0.1)
  const fovRad = THREE.MathUtils.degToRad(perspCam.fov || 45)
  return (2 * dist * Math.tan(fovRad / 2) * ratio) / viewportHeight
}

export interface Cavity2DPoint {
  id: string
  x: number
  y: number
  radius?: number
}

export interface NearestNeighborEdge {
  fromId: string
  toId: string
  distance: number
  clearance?: number
}

/**
 * 计算多孔之间的最近邻单向链状拓扑（用于 G-12 多选 3 个及以上孔腔时的链状尺寸连线，彻底杜绝蜘蛛网）
 *
 * @param points 各孔腔在宿主面上的 (x, y) 局部坐标
 * @returns 排序后的链状相连边列表
 */
export function buildNearestNeighborChain(points: Cavity2DPoint[]): NearestNeighborEdge[] {
  if (!points || points.length < 2) return []

  // 1. 如果刚好 2 个孔，直接连接一条边
  if (points.length === 2) {
    const [p1, p2] = points
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const clearance = dist - ((p1.radius || 0) + (p2.radius || 0))
    return [
      {
        fromId: p1.id,
        toId: p2.id,
        distance: Number(dist.toFixed(2)),
        clearance: Number(clearance.toFixed(2))
      }
    ]
  }

  // 2. 多孔情况：采用贪心最近邻链（从最左/最下端点开始，沿最近邻依次穿连）
  // 按照主轴（X 轴优先，随后 Y 轴）排序确定起始基准端点
  const unvisited = [...points]
  unvisited.sort((a, b) => a.x - b.x || a.y - b.y)

  const chain: Cavity2DPoint[] = [unvisited.shift()!]

  while (unvisited.length > 0) {
    const current = chain[chain.length - 1]
    let nearestIdx = 0
    let minDist = Infinity

    for (let i = 0; i < unvisited.length; i++) {
      const candidate = unvisited[i]
      const dist = Math.hypot(candidate.x - current.x, candidate.y - current.y)
      if (dist < minDist) {
        minDist = dist
        nearestIdx = i
      }
    }

    chain.push(unvisited.splice(nearestIdx, 1)[0])
  }

  // 构建相邻边
  const edges: NearestNeighborEdge[] = []
  for (let i = 0; i < chain.length - 1; i++) {
    const pA = chain[i]
    const pB = chain[i + 1]
    const dist = Math.hypot(pB.x - pA.x, pB.y - pA.y)
    const clearance = dist - ((pA.radius || 0) + (pB.radius || 0))
    edges.push({
      fromId: pA.id,
      toId: pB.id,
      distance: Number(dist.toFixed(2)),
      clearance: Number(clearance.toFixed(2))
    })
  }

  return edges
}

/**
 * 智能正交对齐检测（用于拖拽时探测当前坐标是否与目标集合在 X 或 Y 轴上进入捕捉容差）
 *
 * @param currentPos 当前孔坐标 { x, y }
 * @param targets 宿主面上其他参考孔集合
 * @param tolerance 捕捉容差（mm，在当前模型尺度下约相当于屏幕 ±2px 对应世界毫米）
 * @returns 命中的对齐导线坐标（如有）
 */
export function detectSmartAlignment(
  currentPos: { x: number; y: number },
  targets: Array<{ id: string; x: number; y: number }>,
  tolerance: number = 1.0
): {
  snapX?: { targetId: string; x: number }
  snapY?: { targetId: string; y: number }
} {
  let snapX: { targetId: string; x: number } | undefined
  let snapY: { targetId: string; y: number } | undefined

  let minDiffX = tolerance
  let minDiffY = tolerance

  for (const t of targets) {
    const dx = Math.abs(currentPos.x - t.x)
    if (dx <= minDiffX) {
      minDiffX = dx
      snapX = { targetId: t.id, x: t.x }
    }

    const dy = Math.abs(currentPos.y - t.y)
    if (dy <= minDiffY) {
      minDiffY = dy
      snapY = { targetId: t.id, y: t.y }
    }
  }

  return { snapX, snapY }
}

/**
 * 计算三维空间中两条有限线段之间的最短欧氏距离 (Dan Sunday 算法)
 */
export function distSegmentToSegment(
  p1: [number, number, number],
  p2: [number, number, number],
  q1: [number, number, number],
  q2: [number, number, number]
): number {
  const d1: [number, number, number] = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]
  const d2: [number, number, number] = [q2[0] - q1[0], q2[1] - q1[1], q2[2] - q1[2]]
  const r: [number, number, number] = [p1[0] - q1[0], p1[1] - q1[1], p1[2] - q1[2]]

  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2]
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2]
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2]

  const EPSILON = 1e-6
  let s = 0
  let t = 0

  if (a <= EPSILON && e <= EPSILON) {
    return Math.hypot(p1[0] - q1[0], p1[1] - q1[1], p1[2] - q1[2])
  }
  if (a <= EPSILON) {
    s = 0
    t = Math.max(0, Math.min(1, f / e))
  } else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2]
    if (e <= EPSILON) {
      t = 0
      s = Math.max(0, Math.min(1, -c / a))
    } else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]
      const denom = a * e - b * b

      if (Math.abs(denom) > EPSILON) {
        s = Math.max(0, Math.min(1, (b * f - c * e) / denom))
      } else {
        s = 0
      }

      t = (b * s + f) / e

      if (t < 0) {
        t = 0
        s = Math.max(0, Math.min(1, -c / a))
      } else if (t > 1) {
        t = 1
        s = Math.max(0, Math.min(1, (b - c) / a))
      }
    }
  }

  const c1: [number, number, number] = [p1[0] + s * d1[0], p1[1] + s * d1[1], p1[2] + s * d1[2]]
  const c2: [number, number, number] = [q1[0] + t * d2[0], q1[1] + t * d2[1], q1[2] + t * d2[2]]

  return Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2])
}
