/**
 * 主动间隙分析算法 (Active Clearance Analysis)
 * 严格对齐 PRD-FR-04-15 §9 (FR-04-15-063)
 */

import type { CavityAnalyzedGeometry } from './wallThickness'
import {
  segmentSegmentClosestPoints,
  pointToFaceDistance
} from './wallThickness'
import { getFacesForTemplate, type BaseFaceDefinition } from '../../types'
import { add, mul, sub, norm, unit, dot, type Vec3 } from '../../cavityGeometry'
import type {
  EntityRef,
  ActiveClearanceResult,
  ActiveClearanceRelation
} from '../contracts'

/**
 * 求解两孔腔实体之间的真实最短净距与关系
 */
export function computeHoleToHoleClearance(
  cavA: CavityAnalyzedGeometry,
  cavB: CavityAnalyzedGeometry
): {
  dist: number
  relation: ActiveClearanceRelation
  ptA: Vec3
  ptB: Vec3
} {
  let minDistance = Infinity
  let bestPtA: Vec3 = cavA.mouth
  let bestPtB: Vec3 = cavB.mouth
  let hasIntersection = false
  let isContaining = false

  for (const segA of cavA.segments) {
    const vAxisA = unit(sub(segA.p1, segA.p0))
    for (const segB of cavB.segments) {
      const vAxisB = unit(sub(segB.p1, segB.p0))
      const { ptA, ptB, s, t, dist } = segmentSegmentClosestPoints(
        segA.p0,
        segA.p1,
        segB.p0,
        segB.p1
      )
      const rA = segA.r0 + s * (segA.r1 - segA.r0)
      const rB = segB.r0 + t * (segB.r1 - segB.r0)

      const dir = dist > 1e-7 ? unit(sub(ptB, ptA)) : [1, 0, 0]

      // 计算 dir 相对孔 A 与孔 B 轴向的径向分量，消除轴向球形假想包络造成的误差
      const axialA = dot(dir as Vec3, vAxisA)
      const radVecA = sub(dir as Vec3, mul(vAxisA, axialA))
      const radLenA = norm(radVecA)
      const rEffA = rA * radLenA

      const dirBA = mul(dir as Vec3, -1)
      const axialB = dot(dirBA, vAxisB)
      const radVecB = sub(dirBA, mul(vAxisB, axialB))
      const radLenB = norm(radVecB)
      const rEffB = rB * radLenB

      // 包含检测：轴线平行/共线、轴距极小且一个半径完全大于另一个半径
      const isParallel = Math.abs(dot(vAxisA, vAxisB)) > 0.999
      if (isParallel && dist + Math.min(rA, rB) <= Math.max(rA, rB) - 1e-4) {
        isContaining = true
      }

      const surfaceDist = dist - (rEffA + rEffB)
      if (surfaceDist < -1e-4) {
        hasIntersection = true
      }

      if (surfaceDist < minDistance) {
        minDistance = surfaceDist
        const radUnitA = radLenA > 1e-6 ? mul(radVecA, 1 / radLenA) : [0, 0, 0]
        const radUnitB = radLenB > 1e-6 ? mul(radVecB, 1 / radLenB) : [0, 0, 0]
        bestPtA = add(ptA, mul(radUnitA as Vec3, rA))
        bestPtB = add(ptB, mul(radUnitB as Vec3, rB))
      }
    }
  }

  if (isContaining) {
    return {
      dist: 0,
      relation: 'containing',
      ptA: bestPtA,
      ptB: bestPtB
    }
  }

  if (hasIntersection) {
    return {
      dist: 0,
      relation: 'intersecting',
      ptA: bestPtA,
      ptB: bestPtB
    }
  }

  if (minDistance <= 1e-4) {
    return {
      dist: 0,
      relation: 'contacting',
      ptA: bestPtA,
      ptB: bestPtB
    }
  }

  return {
    dist: Math.max(0, minDistance),
    relation: 'separated',
    ptA: bestPtA,
    ptB: bestPtB
  }
}

/**
 * 求解孔腔实体到有限基体外表面的真实净距与关系
 */
export function computeHoleToFaceClearance(
  cav: CavityAnalyzedGeometry,
  face: BaseFaceDefinition,
  dimensions: [number, number, number]
): {
  dist: number
  relation: ActiveClearanceRelation
  ptA: Vec3
  ptB: Vec3
} {
  let minDistance = Infinity
  let bestPtCav: Vec3 = cav.mouth
  let bestPtFace: Vec3 = (face.origin as Vec3) || [0, 0, 0]

  // 若孔的正常安装面就是该面，则孔口圆周接触该面（净距为 0，contacting）
  if (cav.cavity.faceId === face.id) {
    return {
      dist: 0,
      relation: 'contacting',
      ptA: cav.mouth,
      ptB: cav.mouth
    }
  }

  for (const seg of cav.segments) {
    const vAxis = unit(sub(seg.p1, seg.p0))

    const samples = [0, 0.25, 0.5, 0.75, 1]
    for (const t of samples) {
      const pt = add(seg.p0, mul(sub(seg.p1, seg.p0), t))
      const r = seg.r0 + t * (seg.r1 - seg.r0)
      const { closestPoint, dist } = pointToFaceDistance(pt, face, dimensions)
      const dir = dist > 1e-7 ? unit(sub(closestPoint, pt)) : [0, 0, 1]

      const axialDot = dot(dir as Vec3, vAxis)
      const radialVec = sub(dir as Vec3, mul(vAxis, axialDot))
      const radialLen = norm(radialVec)

      const rEff = r * radialLen
      const surfaceDist = dist - rEff

      if (surfaceDist < minDistance) {
        minDistance = surfaceDist
        const radialUnit = radialLen > 1e-6 ? mul(radialVec, 1 / radialLen) : [0, 0, 0]
        bestPtCav = add(pt, mul(radialUnit as Vec3, r))
        bestPtFace = closestPoint
      }
    }
  }

  if (minDistance < -1e-4) {
    return {
      dist: 0,
      relation: 'intersecting',
      ptA: bestPtCav,
      ptB: bestPtFace
    }
  }

  if (Math.abs(minDistance) <= 1e-4) {
    return {
      dist: 0,
      relation: 'contacting',
      ptA: bestPtCav,
      ptB: bestPtFace
    }
  }

  return {
    dist: Math.max(0, minDistance),
    relation: 'separated',
    ptA: bestPtCav,
    ptB: bestPtFace
  }
}

/**
 * 求解两个有限基体外表面之间的最短距离
 */
export function computeFaceToFaceClearance(
  faceA: BaseFaceDefinition,
  faceB: BaseFaceDefinition,
  dimensions: [number, number, number] = [100, 100, 100]
): {
  dist: number
  relation: ActiveClearanceRelation
  ptA: Vec3
  ptB: Vec3
} {
  // 如果未提供完整的 centerPoint，则通过模板面计算
  const faces = getFacesForTemplate('box', dimensions)
  const fA = faces.find((f) => f.id === faceA.id) || faceA
  const fB = faces.find((f) => f.id === faceB.id) || faceB

  const normA = unit(fA.normal as Vec3)
  const normB = unit(fB.normal as Vec3)

  // 平行相反面（如 top 与 bottom，front 与 back）
  const cos = dot(normA, normB)
  const centerA: Vec3 = (fA.centerPoint as Vec3) || (fA.origin as Vec3) || [0, 0, 0]
  const centerB: Vec3 = (fB.centerPoint as Vec3) || (fB.origin as Vec3) || [0, 0, 0]

  if (Math.abs(cos + 1) < 1e-4) {
    // 平行相对面
    const dist = Math.abs(dot(sub(centerA, centerB), normA))
    return {
      dist,
      relation: dist < 1e-4 ? 'contacting' : 'separated',
      ptA: centerA,
      ptB: sub(centerA, mul(normA, dist))
    }
  }

  // 相交相邻面（夹角 90 度，交界棱边接触）
  if (Math.abs(cos) < 1e-4) {
    return {
      dist: 0,
      relation: 'contacting',
      ptA: centerA,
      ptB: centerB
    }
  }

  const dist = norm(sub(centerA, centerB))
  return {
    dist,
    relation: dist < 1e-4 ? 'contacting' : 'separated',
    ptA: centerA,
    ptB: centerB
  }
}

/**
 * 主动间隙分析主计算接口
 */
export function computeActiveClearance(
  objA: EntityRef,
  objB: EntityRef,
  allCavities: CavityAnalyzedGeometry[],
  dimensions: [number, number, number],
  baseBody: any
): ActiveClearanceResult {
  const faces = getFacesForTemplate(
    baseBody?.template || 'box',
    dimensions,
    baseBody?.extraParams
  )

  const findCavity = (ref: EntityRef) =>
    ref.kind === 'cavity'
      ? allCavities.find((c) => c.cavity.instanceId === ref.instanceId)
      : undefined

  const findFace = (ref: EntityRef) =>
    ref.kind === 'base-face' ? faces.find((f: BaseFaceDefinition) => f.id === ref.faceId) : undefined

  const cavA = findCavity(objA)
  const cavB = findCavity(objB)
  const faceA = findFace(objA)
  const faceB = findFace(objB)

  if (cavA && cavB) {
    const res = computeHoleToHoleClearance(cavA, cavB)
    return {
      dist: Number(res.dist.toFixed(2)),
      relation: res.relation,
      pointA: res.ptA,
      pointB: res.ptB,
      objectA: objA,
      objectB: objB,
      objectAName: cavA.cavity.subHoleName || cavA.cavity.name,
      objectBName: cavB.cavity.subHoleName || cavB.cavity.name,
      unit: 'mm'
    }
  }

  if (cavA && faceB) {
    const res = computeHoleToFaceClearance(cavA, faceB, dimensions)
    return {
      dist: Number(res.dist.toFixed(2)),
      relation: res.relation,
      pointA: res.ptA,
      pointB: res.ptB,
      objectA: objA,
      objectB: objB,
      objectAName: cavA.cavity.subHoleName || cavA.cavity.name,
      objectBName: faceB.name,
      unit: 'mm'
    }
  }

  if (faceA && cavB) {
    const res = computeHoleToFaceClearance(cavB, faceA, dimensions)
    return {
      dist: Number(res.dist.toFixed(2)),
      relation: res.relation,
      pointA: res.ptB,
      pointB: res.ptA,
      objectA: objA,
      objectB: objB,
      objectAName: faceA.name,
      objectBName: cavB.cavity.subHoleName || cavB.cavity.name,
      unit: 'mm'
    }
  }

  if (faceA && faceB) {
    const res = computeFaceToFaceClearance(faceA, faceB, dimensions)
    return {
      dist: Number(res.dist.toFixed(2)),
      relation: res.relation,
      pointA: res.ptA,
      pointB: res.ptB,
      objectA: objA,
      objectB: objB,
      objectAName: faceA.name,
      objectBName: faceB.name,
      unit: 'mm'
    }
  }

  // 默认兜底
  return {
    dist: 0,
    relation: 'separated',
    objectA: objA,
    objectB: objB,
    unit: 'mm'
  }
}

/**
 * 多选实体间隙批量计算接口 (支持孔腔与孔腔、孔腔与表面、表面与表面两两配对)
 */
export function computeMultipleActiveClearances(
  objects: EntityRef[],
  allCavities: CavityAnalyzedGeometry[],
  dimensions: [number, number, number],
  baseBody: any
): ActiveClearanceResult[] {
  if (!objects || objects.length < 2) return []

  const results: ActiveClearanceResult[] = []
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const res = computeActiveClearance(
        objects[i],
        objects[j],
        allCavities,
        dimensions,
        baseBody
      )
      results.push(res)
    }
  }

  return results
}

