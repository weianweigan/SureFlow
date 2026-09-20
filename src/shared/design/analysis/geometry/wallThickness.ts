/**
 * 残余壁厚检查算法 (CLR-001 孔间壁厚 / CLR-002 孔到外表面壁厚)
 * 严格对齐 PRD-FR-04-15 §7.1
 */

import type { CavityInstance, BaseFaceDefinition } from '../../types'
import {
  profileBands,
  cavityAxis,
  add,
  mul,
  sub,
  dot,
  norm,
  unit,
  type ProfileBand,
  type Vec3
} from '../../cavityGeometry'
import { getFacesForTemplate } from '../../types'
import type { Step } from '../../../cavity/types'
import {
  type CheckIssue,
  type CheckObservation,
  type CheckConfig,
  type AnalysisStamp,
  type EntityRef,
  resolveWallThicknessThreshold
} from '../contracts'
import { RULE_DEFINITIONS } from '../ruleRegistry'

export interface CavitySegment3D {
  p0: Vec3
  p1: Vec3
  r0: number
  r1: number
  z0: number
  z1: number
  stepIndex: number
}

export interface CavityAnalyzedGeometry {
  cavity: CavityInstance
  mouth: Vec3
  axisDir: Vec3
  totalDepth: number
  segments: CavitySegment3D[]
  isStructural: boolean
}

/** 默认回退台阶 */
const DEFAULT_STEPS: Step[] = [
  { type: 'straight', diameter: 10, length: 20 },
  { type: 'tapered', diameter: 6, length: 15, angle: 118 }
]

/**
 * 提取孔腔精确 3D 台阶几何
 */
export function buildAnalyzedCavityGeometry(
  cavity: CavityInstance,
  dimensions: [number, number, number],
  baseBody?: any,
  resolveSteps?: (templateId: string) => Step[] | undefined
): CavityAnalyzedGeometry {
  const { mouth, direction: axisDir } = cavityAxis(cavity, dimensions, baseBody)
  const steps =
    cavity.steps && cavity.steps.length > 0
      ? cavity.steps
      : resolveSteps?.(cavity.templateId) || DEFAULT_STEPS

  const bands: ProfileBand[] = profileBands(steps)
  const segments: CavitySegment3D[] = []

  let currentZ = 0
  for (const b of bands) {
    const p0: Vec3 = add(mouth, mul(axisDir, currentZ))
    const nextZ = currentZ + b.length
    const p1: Vec3 = add(mouth, mul(axisDir, nextZ))
    segments.push({
      p0,
      p1,
      r0: b.r0,
      r1: b.r1,
      z0: currentZ,
      z1: nextZ,
      stepIndex: b.index
    })
    currentZ = nextZ
  }

  const name = `${cavity.subHoleName || ''} ${cavity.name}`.toLowerCase()
  const isStructural =
    cavity.cavityType === 'bolt-hole' ||
    cavity.cavityType === 'locating-pin-hole' ||
    name.includes('bolt') ||
    name.includes('screw') ||
    name.includes('pin') ||
    name.includes('螺栓') ||
    name.includes('螺钉') ||
    name.includes('定位销')

  return {
    cavity,
    mouth,
    axisDir,
    totalDepth: currentZ,
    segments,
    isStructural
  }
}

/**
 * 求解三维空间中两线段间的最近点对及参数 (s, t)
 */
export function segmentSegmentClosestPoints(
  p0: Vec3,
  p1: Vec3,
  q0: Vec3,
  q1: Vec3
): { ptA: Vec3; ptB: Vec3; s: number; t: number; dist: number } {
  const u = sub(p1, p0)
  const v = sub(q1, q0)
  const w = sub(p0, q0)

  const a = dot(u, u)
  const b = dot(u, v)
  const c = dot(v, v)
  const d = dot(u, w)
  const e = dot(v, w)

  const D = a * c - b * b
  let sN = 0,
    sD = D,
    tN = 0,
    tD = D

  if (D < 1e-8) {
    sN = 0
    sD = 1
    tN = e
    tD = c
  } else {
    sN = b * e - c * d
    tN = a * e - b * d
    if (sN < 0) {
      sN = 0
      tN = e
      tD = c
    } else if (sN > sD) {
      sN = sD
      tN = e + b
      tD = c
    }
  }

  if (tN < 0) {
    tN = 0
    if (-d < 0) sN = 0
    else if (-d > a) sN = sD
    else {
      sN = -d
      sD = a
    }
  } else if (tN > tD) {
    tN = tD
    if (-d + b < 0) sN = 0
    else if (-d + b > a) sN = sD
    else {
      sN = -d + b
      sD = a
    }
  }

  const s = Math.abs(sN) < 1e-8 ? 0 : sN / sD
  const t = Math.abs(tN) < 1e-8 ? 0 : tN / tD

  const ptA = add(p0, mul(u, s))
  const ptB = add(q0, mul(v, t))
  const dist = norm(sub(ptA, ptB))

  return { ptA, ptB, s, t, dist }
}

/**
 * 点到三维有限线段的最短距离与最近点
 */
export function pointSegmentClosestPoint(
  p: Vec3,
  q0: Vec3,
  q1: Vec3
): { closest: Vec3; t: number; dist: number } {
  const v = sub(q1, q0)
  const lenSq = dot(v, v)
  if (lenSq < 1e-9) {
    return { closest: q0, t: 0, dist: norm(sub(p, q0)) }
  }
  let t = dot(sub(p, q0), v) / lenSq
  t = Math.max(0, Math.min(1, t))
  const closest = add(q0, mul(v, t))
  return { closest, t, dist: norm(sub(p, closest)) }
}

/**
 * 点到有限矩形/凸多边形平面的最近点与最短距离
 */
export function pointToFaceDistance(
  p: Vec3,
  face: BaseFaceDefinition,
  dimensions: [number, number, number]
): { closestPoint: Vec3; dist: number } {
  const normal = unit(face.normal as Vec3)
  const [sx, sy, sz] = dimensions

  // 默认根据 box 尺寸估计矩形范围，或利用 faceCenter
  // 点到无限平面的投影
  const planeOrigin: Vec3 = (face.origin as Vec3) || [0, 0, 0]
  const v = sub(p, planeOrigin)
  const distNormal = dot(v, normal)
  const projPoint = sub(p, mul(normal, distNormal))

  // 钳制到基体有限范围内 [0, sx] x [0, sy] x [0, sz]
  const clampedX = Math.max(0, Math.min(sx, projPoint[0]))
  const clampedY = Math.max(0, Math.min(sy, projPoint[1]))
  const clampedZ = Math.max(0, Math.min(sz, projPoint[2]))
  const closest: Vec3 = [clampedX, clampedY, clampedZ]

  return {
    closestPoint: closest,
    dist: norm(sub(p, closest))
  }
}

/**
 * 评估 CLR-001: 孔间残余壁厚不足
 */
export function evaluateHoleToHoleWallThickness(
  cavityA: CavityAnalyzedGeometry,
  cavityB: CavityAnalyzedGeometry,
  config: CheckConfig,
  stamp: AnalysisStamp
): { issues: CheckIssue[]; observations: CheckObservation[] } {
  const issues: CheckIssue[] = []
  const observations: CheckObservation[] = []

  const refA: EntityRef = { kind: 'cavity', instanceId: cavityA.cavity.instanceId }
  const refB: EntityRef = { kind: 'cavity', instanceId: cavityB.cavity.instanceId }
  const threshold = resolveWallThicknessThreshold('CLR-001', refA, refB, config)

  // 检查两孔腔是否已经物理相交连通（已经连接的孔腔不需要检查间隙）
  // 检查是否相交/物理贯通
  let isConnected = false
  for (const segA of cavityA.segments) {
    const vAxisA = unit(sub(segA.p1, segA.p0))
    for (const segB of cavityB.segments) {
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

      const axialA = dot(dir as Vec3, vAxisA)
      const radVecA = sub(dir as Vec3, mul(vAxisA, axialA))
      const radLenA = norm(radVecA)
      const rEffA = rA * radLenA

      const dirBA = mul(dir as Vec3, -1)
      const axialB = dot(dirBA, vAxisB)
      const radVecB = sub(dirBA, mul(vAxisB, axialB))
      const radLenB = norm(radVecB)
      const rEffB = rB * radLenB

      const surfaceDist = dist - (rEffA + rEffB)
      if (surfaceDist <= 0.05) {
        isConnected = true
        break
      }
    }
    if (isConnected) break
  }

  if (isConnected) {
    return { issues: [], observations: [] }
  }

  let minPositiveWall: number = Infinity
  let bestPtA: Vec3 = [0, 0, 0]
  let bestPtB: Vec3 = [0, 0, 0]

  for (const segA of cavityA.segments) {
    const vAxisA = unit(sub(segA.p1, segA.p0))
    for (const segB of cavityB.segments) {
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

      const wallDist = dist - (rEffA + rEffB)

      if (wallDist > 0.05) {
        if (wallDist < minPositiveWall) {
          minPositiveWall = wallDist
          const radUnitA = radLenA > 1e-6 ? mul(radVecA, 1 / radLenA) : [0, 0, 0]
          const radUnitB = radLenB > 1e-6 ? mul(radVecB, 1 / radLenB) : [0, 0, 0]
          bestPtA = add(ptA, mul(radUnitA as Vec3, rA))
          bestPtB = add(ptB, mul(radUnitB as Vec3, rB))
        }
      }
    }
  }

  // 记录实测观察值
  if (Number.isFinite(minPositiveWall)) {
    observations.push({
      id: `obs-clr1-${cavityA.cavity.instanceId}-${cavityB.cavity.instanceId}`,
      stamp,
      ruleId: 'CLR-001',
      refs: [refA, refB],
      measurements: [
        {
          name: '孔间残余壁厚',
          value: Number(minPositiveWall.toFixed(2)),
          unit: 'mm'
        }
      ],
      evidence: {
        refs: [refA, refB],
        points: [bestPtA, bestPtB],
        lines: [[bestPtA, bestPtB]]
      }
    })

    // 判定是否超标：可靠壁厚 < 阈值，且大于数值容差 (0.05)
    if (minPositiveWall < threshold) {
      const sortedIds = [cavityA.cavity.instanceId, cavityB.cavity.instanceId].sort()
      issues.push({
        id: `issue-CLR-001-${sortedIds.join('-')}`,
        stableKey: `CLR-001:${sortedIds.join('-')}`,
        ruleId: 'CLR-001',
        ruleVersion: RULE_DEFINITIONS['CLR-001'].version,
        stamp,
        severity: 'error',
        messageKey: 'hole_to_hole_wall_too_thin',
        messageArgs: {
          holeA: cavityA.cavity.subHoleName || cavityA.cavity.name,
          holeB: cavityB.cavity.subHoleName || cavityB.cavity.name,
          measured: minPositiveWall.toFixed(2),
          required: threshold.toFixed(2)
        },
        measurements: [
          {
            name: '孔间残余壁厚',
            value: Number(minPositiveWall.toFixed(2)),
            unit: 'mm'
          }
        ],
        requirements: [
          {
            name: '最小允许壁厚',
            value: threshold,
            unit: 'mm'
          }
        ],
        precision: 'brep',
        evidence: {
          refs: [refA, refB],
          points: [bestPtA, bestPtB],
          lines: [[bestPtA, bestPtB]]
        },
        remediation: RULE_DEFINITIONS['CLR-001'].remediationTemplate
      })
    }
  }

  return { issues, observations }
}

/**
 * 评估 CLR-002: 孔到外表面壁厚不足
 */
export function evaluateHoleToOuterWallThickness(
  cavity: CavityAnalyzedGeometry,
  dimensions: [number, number, number],
  baseBody: any,
  config: CheckConfig,
  stamp: AnalysisStamp,
  exemptFaceIds: string[] = []
): { issues: CheckIssue[]; observations: CheckObservation[] } {
  const issues: CheckIssue[] = []
  const observations: CheckObservation[] = []

  const faces = getFacesForTemplate(
    baseBody?.template || 'box',
    dimensions,
    baseBody?.extraParams
  )
  const refCavity: EntityRef = { kind: 'cavity', instanceId: cavity.cavity.instanceId }

  for (const face of faces) {
    // 排除入口面（包括大小写、模板前缀及孔口几何贴合该面）以及已豁免的面
    const fidA = face.id.toLowerCase()
    const fidB = (cavity.cavity.faceId || '').toLowerCase()
    const isSameId =
      fidA === fidB ||
      (fidA.startsWith('top') && fidB.startsWith('top')) ||
      (fidA.startsWith('bottom') && fidB.startsWith('bottom')) ||
      (fidA.startsWith('front') && fidB.startsWith('front')) ||
      (fidA.startsWith('back') && fidB.startsWith('back')) ||
      (fidA.startsWith('left') && fidB.startsWith('left')) ||
      (fidA.startsWith('right') && fidB.startsWith('right'))

    const mouthDistToFace = pointToFaceDistance(cavity.mouth, face, dimensions).dist
    const isMouthOnFace = mouthDistToFace < 0.05

    if (isSameId || isMouthOnFace || exemptFaceIds.includes(face.id)) {
      continue
    }

    const refFace: EntityRef = { kind: 'base-face', faceId: face.id }
    const threshold = resolveWallThicknessThreshold('CLR-002', refCavity, refFace, config)

    let minWall = Infinity
    let bestPtCav: Vec3 = [0, 0, 0]
    let bestPtFace: Vec3 = [0, 0, 0]

    for (const seg of cavity.segments) {
      const vAxis = unit(sub(seg.p1, seg.p0))

      // 在 seg 上取采样点 (包含端点及细分采样)
      const samples = [0, 0.25, 0.5, 0.75, 1]
      for (const t of samples) {
        const pt = add(seg.p0, mul(sub(seg.p1, seg.p0), t))
        const r = seg.r0 + t * (seg.r1 - seg.r0)
        const { closestPoint, dist } = pointToFaceDistance(pt, face, dimensions)
        const dir = dist > 1e-7 ? unit(sub(closestPoint, pt)) : [0, 0, 1]

        // 计算 dir 在垂直于孔轴平面的径向分量，消除轴向投影对壁厚和端点的错误偏移
        const axialDot = dot(dir as Vec3, vAxis)
        const radialVec = sub(dir as Vec3, mul(vAxis, axialDot))
        const radialLen = norm(radialVec)

        // 真实表面有效径向扩展
        const rEff = r * radialLen
        const wallDist = dist - rEff

        // 仅考虑正壁厚 (wallDist > 0.05，穿破由 GEO-001 负责)
        if (wallDist > 0.05 && wallDist < minWall) {
          minWall = wallDist
          const radialUnit = radialLen > 1e-6 ? mul(radialVec, 1 / radialLen) : [0, 0, 0]
          bestPtCav = add(pt, mul(radialUnit as Vec3, r))
          bestPtFace = closestPoint
        }
      }
    }

    if (Number.isFinite(minWall)) {
      observations.push({
        id: `obs-clr2-${cavity.cavity.instanceId}-${face.id}`,
        stamp,
        ruleId: 'CLR-002',
        refs: [refCavity, refFace],
        measurements: [
          {
            name: '孔到外表面壁厚',
            value: Number(minWall.toFixed(2)),
            unit: 'mm'
          }
        ],
        evidence: {
          refs: [refCavity, refFace],
          points: [bestPtCav, bestPtFace],
          lines: [[bestPtCav, bestPtFace]]
        }
      })

      if (minWall < threshold) {
        issues.push({
          id: `issue-CLR-002-${cavity.cavity.instanceId}-${face.id}`,
          stableKey: `CLR-002:${cavity.cavity.instanceId}:${face.id}`,
          ruleId: 'CLR-002',
          ruleVersion: RULE_DEFINITIONS['CLR-002'].version,
          stamp,
          severity: 'error',
          messageKey: 'hole_to_outer_wall_too_thin',
          messageArgs: {
            hole: cavity.cavity.subHoleName || cavity.cavity.name,
            face: face.name,
            measured: minWall.toFixed(2),
            required: threshold.toFixed(2)
          },
          measurements: [
            {
              name: '孔到外表面壁厚',
              value: Number(minWall.toFixed(2)),
              unit: 'mm'
            }
          ],
          requirements: [
            {
              name: '最小允许壁厚',
              value: threshold,
              unit: 'mm'
            }
          ],
          precision: 'brep',
          evidence: {
            refs: [refCavity, refFace],
            points: [bestPtCav, bestPtFace],
            lines: [[bestPtCav, bestPtFace]]
          },
          remediation: RULE_DEFINITIONS['CLR-002'].remediationTemplate
        })
      }
    }
  }

  return { issues, observations }
}
