/**
 * 面基准坐标系数学库（World Origin Projection Method）
 * 严格对齐 PRD-FR-04-03 §2 规范：
 * - 面原点 O_face 为世界原点 (0, 0, 0) 在该平面的正交投影
 * - 法向轴 W 为平面的单位外法向 n，孔腔钻入方向为 -W
 * - 正交轴向 (U, V, W) 严格满足右手定则 U × V = W
 */

import { computeTemplateFaces, type BaseBodyConfig } from './types'

export interface FaceBasis {
  id: string
  origin: [number, number, number]
  u: [number, number, number]
  v: [number, number, number]
  w: [number, number, number]
}

/**
 * 根据平面单位法向量严格计算正交右手坐标基底 (U, V, W)，满足：
 * 1. |U| = 1, |V| = 1, |W| = 1
 * 2. U · V = 0, U · W = 0, V · W = 0
 * 3. U × V = W (严格右手定则)
 * 4. 对于倾斜面/倒角斜面，U 沿等高水平线（切线），V 沿斜面爬升正方向（V_z > 0）
 */
export function computeOrthonormalPlaneBasis(normal: [number, number, number]): {
  u: [number, number, number]
  v: [number, number, number]
  w: [number, number, number]
} {
  let [nx, ny, nz] = normal
  const len = Math.hypot(nx, ny, nz)
  if (len > 1e-9) {
    nx /= len
    ny /= len
    nz /= len
  } else {
    nx = 0
    ny = 0
    nz = 1
  }
  const w: [number, number, number] = [nx, ny, nz]

  // 1. 若法向非常接近顶面或底面 (+Z / -Z)
  if (Math.abs(nz) > 0.999) {
    const sign = Math.sign(nz) || 1
    return {
      u: [1, 0, 0],
      v: sign > 0 ? [0, 1, 0] : [0, -1, 0],
      w
    }
  }

  // 2. 对于侧面与任意斜面，选取全局参考向上矢量 up = [0, 0, 1]
  // 面内水平切线方向 u = normalize(up × w) = [-ny, nx, 0]
  let ux = -ny
  let uy = nx
  let uz = 0
  const ulen = Math.hypot(ux, uy)
  if (ulen > 1e-6) {
    ux /= ulen
    uy /= ulen
  } else {
    ux = 1
    uy = 0
  }
  const u: [number, number, number] = [ux, uy, uz]

  // 3. 纵向轴 v = w × u，确保 u × v = w
  const vx = ny * uz - nz * uy
  const vy = nz * ux - nx * uz
  const vz = nx * uy - ny * ux

  const vlen = Math.hypot(vx, vy, vz)
  const v: [number, number, number] =
    vlen > 1e-6 ? [vx / vlen, vy / vlen, vz / vlen] : [0, 1, 0]

  return { u, v, w }
}

/**
 * 根据基体配置与面 ID 计算面基准坐标系（World Origin Projection Method）
 * 严格覆盖长方体、L型、T型凹槽台阶面以及 STEP 导入面
 */
export function getBaseFaceBasis(
  faceId: string,
  dimensions: [number, number, number],
  baseBody?: Partial<BaseBodyConfig>
): FaceBasis {
  const [sx, sy, sz] = dimensions
  const fid = (faceId || '').toLowerCase()
  const template = baseBody?.template || 'box'
  const extraParams = baseBody?.extraParams || {}

  // 1. 若 baseBody.faces 中显式定义了该面并且包含完整几何信息 (如 STEP 导入面或带自定义原点的面)
  if (baseBody?.faces) {
    const matched = baseBody.faces.find((f) => f.id.toLowerCase() === fid)
    if (matched) {
      if (matched.origin && matched.u && matched.v) {
        const w = matched.normal
        return {
          id: faceId,
          origin: [matched.origin[0], matched.origin[1], matched.origin[2]],
          u: [matched.u[0], matched.u[1], matched.u[2]],
          v: [matched.v[0], matched.v[1], matched.v[2]],
          w: [w[0], w[1], w[2]]
        }
      }
    }
  }

  // 2. 从模板面集合自动匹配（支持 box、l-shape、t-shape、cross-shape 等所有模板）
  const templateFaces = computeTemplateFaces(template, dimensions, extraParams)
  const matchedFromTemplate = templateFaces.find((f) => f.id.toLowerCase() === fid)
  if (matchedFromTemplate?.origin && matchedFromTemplate.u && matchedFromTemplate.v) {
    return {
      id: faceId,
      origin: [matchedFromTemplate.origin[0], matchedFromTemplate.origin[1], matchedFromTemplate.origin[2]],
      u: [matchedFromTemplate.u[0], matchedFromTemplate.u[1], matchedFromTemplate.u[2]],
      v: [matchedFromTemplate.v[0], matchedFromTemplate.v[1], matchedFromTemplate.v[2]],
      w: [matchedFromTemplate.normal[0], matchedFromTemplate.normal[1], matchedFromTemplate.normal[2]]
    }
  }

  // 4. 标准长方体与通用正交投影面
  if (fid.includes('top') || fid === '+z') {
    return {
      id: faceId,
      origin: [0, 0, sz],
      u: [1, 0, 0],
      v: [0, 1, 0],
      w: [0, 0, 1]
    }
  }

  if (fid.includes('bot') || fid === '-z') {
    return {
      id: faceId,
      origin: [0, 0, 0],
      u: [1, 0, 0],
      v: [0, -1, 0],
      w: [0, 0, -1]
    }
  }

  if (fid.includes('front') || fid === '-y') {
    return {
      id: faceId,
      origin: [0, 0, 0],
      u: [1, 0, 0],
      v: [0, 0, 1],
      w: [0, -1, 0]
    }
  }

  if (fid.includes('back') || fid === '+y') {
    return {
      id: faceId,
      origin: [0, sy, 0],
      u: [-1, 0, 0],
      v: [0, 0, 1],
      w: [0, 1, 0]
    }
  }

  if (fid.includes('left') || fid === '-x') {
    return {
      id: faceId,
      origin: [0, 0, 0],
      u: [0, -1, 0],
      v: [0, 0, 1],
      w: [-1, 0, 0]
    }
  }

  if (fid.includes('right') || fid === '+x') {
    return {
      id: faceId,
      origin: [sx, 0, 0],
      u: [0, 1, 0],
      v: [0, 0, 1],
      w: [1, 0, 0]
    }
  }

  // 5. 若是 STEP 或自定义面，但在 baseBody.faces 中有法向
  if (baseBody?.faces) {
    const matched = baseBody.faces.find((f) => f.id.toLowerCase() === fid)
    if (matched) {
      const computed = computeOrthonormalPlaneBasis(matched.normal)
      let u: [number, number, number] = computed.u
      let v: [number, number, number] = computed.v
      if (
        matched.u &&
        matched.v &&
        Math.abs(matched.u[0] * matched.normal[0] + matched.u[1] * matched.normal[1] + matched.u[2] * matched.normal[2]) < 0.05 &&
        Math.abs(matched.v[0] * matched.normal[0] + matched.v[1] * matched.normal[1] + matched.v[2] * matched.normal[2]) < 0.05 &&
        Math.abs(matched.u[0] * matched.v[0] + matched.u[1] * matched.v[1] + matched.u[2] * matched.v[2]) < 0.05
      ) {
        u = [matched.u[0], matched.u[1], matched.u[2]]
        v = [matched.v[0], matched.v[1], matched.v[2]]
      }

      const origin: [number, number, number] = matched.origin
        ? [matched.origin[0], matched.origin[1], matched.origin[2]]
        : matched.centerPoint
          ? [matched.centerPoint[0], matched.centerPoint[1], matched.centerPoint[2]]
          : [0, 0, 0]

      return {
        id: faceId,
        origin,
        u,
        v,
        w: computed.w
      }
    }
  }

  return {
    id: faceId,
    origin: [0, 0, sz],
    u: [1, 0, 0],
    v: [0, 1, 0],
    w: [0, 0, 1]
  }
}

/**
 * 保持向后兼容的长方体面基准坐标系函数（内部调用全功能 getBaseFaceBasis）
 */
export function getBoxFaceBasis(
  faceId: string,
  dimensions: [number, number, number],
  baseBody?: Partial<BaseBodyConfig>
): FaceBasis {
  return getBaseFaceBasis(faceId, dimensions, baseBody)
}

/**
 * 统一根据法向量与交点坐标推断所属基体面 ID
 * 支持长方体、L型、T型以及 STEP 自定义形状面
 */
export function detectBaseBodyFace(
  normal: { x: number; y: number; z: number },
  point?: { x: number; y: number; z: number },
  baseBody?: Partial<BaseBodyConfig> | [number, number, number],
  dimensionsFallback?: [number, number, number]
): string | null {
  let dims: [number, number, number] = [120, 100, 80]
  let body: Partial<BaseBodyConfig> | undefined

  if (Array.isArray(baseBody)) {
    dims = baseBody
  } else if (baseBody) {
    body = baseBody
    if (baseBody.dimensions) dims = baseBody.dimensions
  } else if (dimensionsFallback) {
    dims = dimensionsFallback
  }

  const [sx, , sz] = dims
  const px = point?.x ?? 0
  const py = point?.y ?? 0
  const pz = point?.z ?? 0

  const nx = normal.x
  const ny = normal.y
  const nz = normal.z

  const ax = Math.abs(nx)
  const ay = Math.abs(ny)
  const az = Math.abs(nz)

  const template = body?.template || 'box'
  const extraParams = body?.extraParams || {}

  // 1. 统一 B-Rep 实体面几何拓扑匹配（无论是 Box、L型、T型 还是 STEP，只要具有真实实体面定义）
  if (body?.faces && body.faces.length > 0 && (body.type === 'step' || body.faces.some((f) => f.origin !== undefined))) {
    let bestFaceId: string | null = null
    let minScore = Infinity

    for (const f of body.faces) {
      const [fnx, fny, fnz] = f.normal
      const dot = nx * fnx + ny * fny + nz * fnz
      if (dot > 0.7) {
        let planeDist = 0
        if (point) {
          const ref = f.origin || f.centerPoint
          if (ref) {
            planeDist = Math.abs((px - ref[0]) * fnx + (py - ref[1]) * fny + (pz - ref[2]) * fnz)
          }
        }
        if (planeDist < 15.0) {
          let centerDist = 0
          if (point && f.centerPoint) {
            centerDist = Math.hypot(px - f.centerPoint[0], py - f.centerPoint[1], pz - f.centerPoint[2])
          }
          const score = (1 - dot) * 10 + planeDist + centerDist * 0.001
          if (score < minScore) {
            minScore = score
            bestFaceId = f.id
          }
        }
      }
    }
    if (bestFaceId) return bestFaceId
  }

  // 2. L 型基体形状
  if (template === 'l-shape') {
    const cutX = extraParams.cutX ?? sx * 0.4
    const cutZ = extraParams.cutZ ?? sz * 0.5
    const stepSplitX = sx - cutX
    const stepSplitZ = sz - cutZ

    if (az >= ax && az >= ay && az > 0.3) {
      if (nz > 0) {
        // +Z 法向：区分主顶面与台阶顶面
        // 台阶顶面区域：X >= stepSplitX - 1.0, 且 Z 处于 stepSplitZ 附近 (Z < sz - 1.0)
        if (px >= stepSplitX - 1.0 && pz < sz - 1.0) {
          return 'top-step'
        }
        return 'top-main'
      }
      return 'bottom'
    }

    if (ay >= ax && ay >= az && ay > 0.3) {
      return ny > 0 ? 'back' : 'front-main'
    }

    if (ax >= ay && ax >= az && ax > 0.3) {
      if (nx > 0) {
        // +X 法向：区分阶梯竖面 (step-wall) 与右面 (right)
        // 阶梯竖面位置在 X ≈ stepSplitX, 且 Z >= stepSplitZ - 1.0
        if (px < sx - 1.0 && pz >= stepSplitZ - 1.0) {
          return 'step-wall'
        }
        return 'right'
      }
      return 'left'
    }
  }

  // 3. T 型基体形状
  if (template === 't-shape') {
    const cutX = extraParams.cutX ?? sx * 0.25
    const cutZ = extraParams.cutZ ?? sz * 0.5
    const leftSplitX = cutX
    const rightSplitX = sx - cutX

    if (az >= ax && az >= ay && az > 0.3) {
      if (nz > 0) {
        return 'top-flange'
      }
      // -Z 法向：区分翼缘左底面、翼缘右底面与腹板底面
      if (pz > 1.0) {
        if (px <= leftSplitX + 1.0) return 'flange-bottom-left'
        if (px >= rightSplitX - 1.0) return 'flange-bottom-right'
      }
      return 'bottom-web'
    }

    if (ay >= ax && ay >= az && ay > 0.3) {
      return ny > 0 ? 'back' : 'front'
    }

    if (ax >= ay && ax >= az && ax > 0.3) {
      if (nx < 0) {
        // -X 法向：区分翼缘左面与腹板左面
        if (px > 1.0 && pz <= cutZ + 1.0) return 'left-web'
        return 'left-flange'
      }
      // +X 法向：区分翼缘右面与腹板右面
      if (px < sx - 1.0 && pz <= cutZ + 1.0) return 'right-web'
      return 'right-flange'
    }
  }

  // 4. 十字型基体形状
  if (template === 'cross-shape') {
    const cutX = extraParams.cutX ?? sx * 0.25
    const cutZ = extraParams.cutZ ?? sz * 0.25

    if (az >= ax && az >= ay && az > 0.3) {
      if (nz > 0) {
        if (pz <= cutZ + 1.0) {
          if (px <= cutX + 1.0) return 'bot-left-up'
          if (px >= sx - cutX - 1.0) return 'bot-right-up'
        }
        return 'top-center'
      }
      if (pz >= sz - cutZ - 1.0) {
        if (px <= cutX + 1.0) return 'top-left-down'
        if (px >= sx - cutX - 1.0) return 'top-right-down'
      }
      return 'bottom-center'
    }

    if (ay >= ax && ay >= az && ay > 0.3) {
      return ny > 0 ? 'back' : 'front'
    }

    if (ax >= ay && ax >= az && ax > 0.3) {
      if (nx > 0) {
        if (px <= cutX + 1.0) {
          if (pz >= sz - cutZ - 1.0) return 'top-left-wall'
          if (pz <= cutZ + 1.0) return 'bot-left-wall'
        }
        return 'right-center'
      }
      if (px >= sx - cutX - 1.0) {
        if (pz >= sz - cutZ - 1.0) return 'top-right-wall'
        if (pz <= cutZ + 1.0) return 'bot-right-wall'
      }
      return 'left-center'
    }
  }

  // 5. 标准长方体判定（保底）
  if (az >= ax && az >= ay && az > 0.3) {
    return nz > 0 ? 'top' : 'bottom'
  }
  if (ay >= ax && ay >= az && ay > 0.3) {
    return ny > 0 ? 'back' : 'front'
  }
  if (ax >= ay && ax >= az && ax > 0.3) {
    return nx > 0 ? 'right' : 'left'
  }

  return null
}

/**
 * 兼容旧版的长方体面检测函数（内部调用全功能 detectBaseBodyFace）
 */
export function detectBoxFace(
  normal: { x: number; y: number; z: number },
  point?: { x: number; y: number; z: number },
  dimensions?: [number, number, number],
  baseBody?: Partial<BaseBodyConfig>
): string | null {
  return detectBaseBodyFace(normal, point, baseBody || dimensions, dimensions)
}

/**
 * 局部面坐标 (u, v, depth) 转换为世界空间坐标
 */
export function localToWorldPoint(
  basis: FaceBasis,
  u: number,
  v: number,
  depth: number = 0
): [number, number, number] {
  const { origin, u: U, v: V, w: W } = basis
  return [
    origin[0] + u * U[0] + v * V[0] - depth * W[0],
    origin[1] + u * U[1] + v * V[1] - depth * W[1],
    origin[2] + u * U[2] + v * V[2] - depth * W[2]
  ]
}

/**
 * 世界坐标点投影到面基准坐标系，返回局部 (u, v)
 */
export function worldToLocalPoint(
  basis: FaceBasis,
  worldPos: [number, number, number]
): { u: number; v: number; distToPlane: number } {
  const { origin, u: U, v: V, w: W } = basis
  const dx = worldPos[0] - origin[0]
  const dy = worldPos[1] - origin[1]
  const dz = worldPos[2] - origin[2]

  const u = dx * U[0] + dy * U[1] + dz * U[2]
  const v = dx * V[0] + dy * V[1] + dz * V[2]
  const distToPlane = dx * W[0] + dy * W[1] + dz * W[2]

  return { u, v, distToPlane }
}

/**
 * 计算孔腔在世界空间下的 4x4 变换矩阵 (列优先 Float32Array)
 * 孔腔自身局部坐标系约定：原点在孔口，Z 轴沿沉入方向 (-W)
 * 绕自身轴线旋转 θ 角（度）
 * 支持斜孔：tiltAngleDeg (相对法线夹角), azimuthDeg (安装面内偏斜朝向方位角)
 */
export function getCavityWorldMatrix(
  basis: FaceBasis,
  u: number,
  v: number,
  depthOffset: number = 0,
  rotationDeg: number = 0,
  tiltAngleDeg: number = 0,
  azimuthDeg: number = 0
): Float32Array {
  const worldMouth = localToWorldPoint(basis, u, v, depthOffset)
  const { u: U, v: V, w: W } = basis

  // 若无倾斜（正交直孔），保持传统高精度解析
  if (Math.abs(tiltAngleDeg) < 1e-4) {
    const rad = (rotationDeg * Math.PI) / 180
    const cosR = Math.cos(rad)
    const sinR = Math.sin(rad)

    const Ux = cosR * U[0] - sinR * V[0]
    const Uy = cosR * U[1] - sinR * V[1]
    const Uz = cosR * U[2] - sinR * V[2]

    const Vx = sinR * U[0] + cosR * V[0]
    const Vy = sinR * U[1] + cosR * V[1]
    const Vz = sinR * U[2] + cosR * V[2]

    const Zx = -W[0]
    const Zy = -W[1]
    const Zz = -W[2]

    return new Float32Array([
      Ux, Uy, Uz, 0,
      Vx, Vy, Vz, 0,
      Zx, Zy, Zz, 0,
      worldMouth[0], worldMouth[1], worldMouth[2], 1
    ])
  }

  // 斜孔空间姿态计算（两个角度定位）：
  // 1. 方位角 azimuthDeg (在面局部坐标系中自 +X(U) 起算的逆时针角度，决定偏斜朝向)
  // 2. 倾斜角 tiltAngleDeg (相对沉入方向 -W 的偏离倾角)
  const azRad = (azimuthDeg * Math.PI) / 180
  const tiltRad = (tiltAngleDeg * Math.PI) / 180
  const spinRad = (rotationDeg * Math.PI) / 180

  const cosAz = Math.cos(azRad)
  const sinAz = Math.sin(azRad)
  const cosT = Math.cos(tiltRad)
  const sinT = Math.sin(tiltRad)

  // 面内的偏斜方向单位矢量 e_az 与垂直面内矢量 e_perp
  const eAz = [
    cosAz * U[0] + sinAz * V[0],
    cosAz * U[1] + sinAz * V[1],
    cosAz * U[2] + sinAz * V[2]
  ]
  const ePerp = [
    -sinAz * U[0] + cosAz * V[0],
    -sinAz * U[1] + cosAz * V[1],
    -sinAz * U[2] + cosAz * V[2]
  ]

  // 孔轴深入方向 Z_hole: 沿 -W 倾斜 tiltRad 偏向 eAz
  const Zx = sinT * eAz[0] - cosT * W[0]
  const Zy = sinT * eAz[1] - cosT * W[1]
  const Zz = sinT * eAz[2] - cosT * W[2]

  // 孔口横截面正交轴向基向量
  const Xbx = cosT * eAz[0] + sinT * W[0]
  const Xby = cosT * eAz[1] + sinT * W[1]
  const Xbz = cosT * eAz[2] + sinT * W[2]

  const Ybx = ePerp[0]
  const Yby = ePerp[1]
  const Ybz = ePerp[2]

  // 绕孔轴自身叠加自转 spinRad
  const cosS = Math.cos(spinRad)
  const sinS = Math.sin(spinRad)

  const Ux = cosS * Xbx - sinS * Ybx
  const Uy = cosS * Xby - sinS * Yby
  const Uz = cosS * Xbz - sinS * Ybz

  const Vx = sinS * Xbx + cosS * Ybx
  const Vy = sinS * Xby + cosS * Yby
  const Vz = sinS * Xbz + cosS * Ybz

  return new Float32Array([
    Ux, Uy, Uz, 0,
    Vx, Vy, Vz, 0,
    Zx, Zy, Zz, 0,
    worldMouth[0], worldMouth[1], worldMouth[2], 1
  ])
}

export type BoxViewPreset = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'

/**
 * 将任意格式的面 ID 映射为标准视角预设
 */
export function mapFaceIdToViewPreset(faceId?: string | null): BoxViewPreset | null {
  if (!faceId) return null
  const fid = faceId.toLowerCase()
  if (fid.includes('top') || fid === '+z') return 'top'
  if (fid.includes('bot') || fid === '-z') return 'bottom'
  if (fid.includes('front') || fid.includes('wall') || fid === '-y') return 'front'
  if (fid.includes('back') || fid === '+y') return 'back'
  if (fid.includes('left') || fid === '-x') return 'left'
  if (fid.includes('right') || fid === '+x') return 'right'
  return null
}

export interface Vector3Like {
  x: number
  y: number
  z: number
}

/**
 * 根据相机朝向和基体尺寸，智能推断当前观察的面 / 观察投影面积最大的面
 * @param cameraDirection 相机世界观察方向（视线前向向量，即从相机看向物体 target - cameraPos）
 * @param dimensions 长方体基体尺寸 [sx, sy, sz]
 */
export function determineObservedFacePreset(
  cameraDirection: Vector3Like,
  dimensions: [number, number, number]
): BoxViewPreset {
  const [sx, sy, sz] = dimensions
  const cLen = Math.hypot(cameraDirection.x, cameraDirection.y, cameraDirection.z) || 1
  // 视线逆向量（从物体指向相机），归一化
  const eye = {
    x: -cameraDirection.x / cLen,
    y: -cameraDirection.y / cLen,
    z: -cameraDirection.z / cLen
  }

  const faces: Array<{
    preset: BoxViewPreset
    normal: { x: number; y: number; z: number }
    area: number
  }> = [
    { preset: 'top', normal: { x: 0, y: 0, z: 1 }, area: sx * sy },
    { preset: 'bottom', normal: { x: 0, y: 0, z: -1 }, area: sx * sy },
    { preset: 'front', normal: { x: 0, y: -1, z: 0 }, area: sx * sz },
    { preset: 'back', normal: { x: 0, y: 1, z: 0 }, area: sx * sz },
    { preset: 'left', normal: { x: -1, y: 0, z: 0 }, area: sy * sz },
    { preset: 'right', normal: { x: 1, y: 0, z: 0 }, area: sy * sz }
  ]

  let mostDirectFace = faces[0]
  let maxCos = -Infinity

  let maxAreaFace = faces[0]
  let maxProjectedArea = -Infinity

  for (const f of faces) {
    const cosTheta = f.normal.x * eye.x + f.normal.y * eye.y + f.normal.z * eye.z
    if (cosTheta > maxCos) {
      maxCos = cosTheta
      mostDirectFace = f
    }

    if (cosTheta > 0.0001) {
      const projArea = f.area * cosTheta
      if (projArea > maxProjectedArea) {
        maxProjectedArea = projArea
        maxAreaFace = f
      }
    }
  }

  // 判定策略：
  // 1. 若相机对某个面的朝向非常明确 (cosTheta > 0.82，夹角约 < 35°)，直接优先正视该面；
  // 2. 否则处于倾斜/等轴侧/多面可见时，优先选择在屏幕上观察投影面积最大的面；
  // 3. 兜底返回正对度最高的面。
  if (maxCos > 0.82) {
    return mostDirectFace.preset
  }

  if (maxProjectedArea > 0) {
    return maxAreaFace.preset
  }

  return mostDirectFace.preset
}

