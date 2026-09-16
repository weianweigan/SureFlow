/**
 * 面基准坐标系数学库（World Origin Projection Method）
 * 严格对齐 PRD-FR-04-03 §2 规范：
 * - 面原点 O_face 为世界原点 (0, 0, 0) 在该平面的正交投影
 * - 法向轴 W 为平面的单位外法向 n，孔腔钻入方向为 -W
 * - 正交轴向 (U, V, W) 严格满足右手定则 U × V = W
 */

export interface FaceBasis {
  id: string
  origin: [number, number, number]
  u: [number, number, number]
  v: [number, number, number]
  w: [number, number, number]
}

/**
 * 根据长方体尺寸与面 ID 计算标准面基准坐标系
 */
export function getBoxFaceBasis(
  faceId: string,
  dimensions: [number, number, number]
): FaceBasis {
  const [sx, sy, sz] = dimensions
  const fid = (faceId || '').toLowerCase()

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

  if (fid.includes('front') || fid.includes('wall') || fid === '-y') {
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

  return {
    id: faceId,
    origin: [0, 0, sz],
    u: [1, 0, 0],
    v: [0, 1, 0],
    w: [0, 0, 1]
  }
}

/**
 * 根据法向量与交点坐标推断所属的长方体基准面 ID
 */
export function detectBoxFace(
  normal: { x: number; y: number; z: number },
  _point?: { x: number; y: number; z: number },
  _dimensions?: [number, number, number]
): string | null {
  const ax = Math.abs(normal.x)
  const ay = Math.abs(normal.y)
  const az = Math.abs(normal.z)

  if (az >= ax && az >= ay && az > 0.3) {
    return normal.z > 0 ? 'top' : 'bottom'
  }
  if (ay >= ax && ay >= az && ay > 0.3) {
    return normal.y > 0 ? 'back' : 'front'
  }
  if (ax >= ay && ax >= az && ax > 0.3) {
    return normal.x > 0 ? 'right' : 'left'
  }
  return null
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
