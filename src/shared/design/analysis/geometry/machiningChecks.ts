/**
 * 加工风险预检算法 (MFG-001 ~ MFG-004)
 * 严格对齐 PRD-FR-04-15 §7.4
 */

import type { CavityAnalyzedGeometry } from './wallThickness'
import { getFacesForTemplate, type BaseFaceDefinition } from '../../types'
import { add, mul, sub, dot, norm, unit, type Vec3 } from '../../cavityGeometry'
import type { CheckIssue, AnalysisStamp, EntityRef, CheckConfig, Measure } from '../contracts'
import { RULE_DEFINITIONS } from '../ruleRegistry'

/**
 * 评估 MFG-001: 进刀通路阻挡
 * 检测刀具从基体外部沿孔轴进入正常入口前，是否会与基体的其他突出结构碰撞
 */
export function evaluateToolPathObstruction(
  cavity: CavityAnalyzedGeometry,
  dimensions: [number, number, number],
  baseBody: any,
  stamp: AnalysisStamp
): CheckIssue[] {
  const issues: CheckIssue[] = []
  if (baseBody?.template !== 'l-shape' && baseBody?.template !== 't-shape') {
    // 纯凸多面体长方体，外部沿轴进入孔口不会被基体自身阻挡
    return issues
  }

  const entrance = cavity.mouth
  const drillDir = cavity.axisDir // 钻入方向 (指向工件内部)
  const approachDir = mul(drillDir, -1) // 沿进刀反向向外探查

  const [sx, sy, sz] = dimensions
  const extraParams = baseBody.extraParams || {}

  // 沿 approachDir 从入口向外步进延伸探查 (延伸最大尺寸)
  const maxReach = Math.max(sx, sy, sz)
  const stepSize = 5
  for (let d = 5; d <= maxReach; d += stepSize) {
    const probePoint = add(entrance, mul(approachDir, d))

    // 检查 probePoint 是否落在基体未切除的材料内部
    let isInsideBase = false
    if (baseBody.template === 'l-shape') {
      const cutX = extraParams.cutX ?? sx * 0.4
      const cutZ = extraParams.cutZ ?? sz * 0.5
      // L型材料域：在 [0, sx] x [0, sy] x [0, sz] 内，且不在凹槽 [sx - cutX, sx] x [0, sy] x [sz - cutZ, sz] 内
      const inBox =
        probePoint[0] >= 0 && probePoint[0] <= sx &&
        probePoint[1] >= 0 && probePoint[1] <= sy &&
        probePoint[2] >= 0 && probePoint[2] <= sz
      const inCutout =
        probePoint[0] >= sx - cutX && probePoint[0] <= sx &&
        probePoint[1] >= 0 && probePoint[1] <= sy &&
        probePoint[2] >= sz - cutZ && probePoint[2] <= sz

      if (inBox && !inCutout) {
        isInsideBase = true
      }
    }

    if (isInsideBase) {
      const refCavity: EntityRef = { kind: 'cavity', instanceId: cavity.cavity.instanceId }
      issues.push({
        id: `issue-MFG-001-${cavity.cavity.instanceId}`,
        stableKey: `MFG-001:${cavity.cavity.instanceId}`,
        ruleId: 'MFG-001',
        ruleVersion: RULE_DEFINITIONS['MFG-001'].version,
        stamp,
        severity: 'warning',
        messageKey: 'tool_path_obstructed',
        messageArgs: {
          hole: cavity.cavity.subHoleName || cavity.cavity.name,
          dist: d.toFixed(1)
        },
        measurements: [
          {
            name: '阻挡位置距入口距离',
            value: Number(d.toFixed(1)),
            unit: 'mm'
          }
        ],
        requirements: [],
        precision: 'brep',
        evidence: {
          refs: [refCavity],
          points: [probePoint, entrance],
          lines: [[entrance, probePoint]]
        },
        remediation: RULE_DEFINITIONS['MFG-001'].remediationTemplate
      })
      break
    }
  }

  return issues
}

/**
 * 评估 MFG-002: 斜面或边缘钻入风险
 * 检测孔口中心与面法向的夹角（倾斜引孔）或孔口周边圆环跨越基体边界/棱边
 */
export function evaluateSlantedOrEdgeEntrance(
  cavity: CavityAnalyzedGeometry,
  dimensions: [number, number, number],
  baseBody: any,
  stamp: AnalysisStamp
): CheckIssue[] {
  const issues: CheckIssue[] = []
  const faces = getFacesForTemplate(
    baseBody?.template || 'box',
    dimensions,
    baseBody?.extraParams
  )
  const hostFace = faces.find((f: BaseFaceDefinition) => f.id === cavity.cavity.faceId)
  if (!hostFace) return issues

  const faceNormal = unit(hostFace.normal as Vec3)
  const expectedDrillDir = mul(faceNormal, -1) // 正交钻入方向
  const actualDrillDir = unit(cavity.axisDir)

  // 1. 检查法向夹角
  const cosAngle = dot(expectedDrillDir, actualDrillDir)
  const angleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle)))
  const angleDeg = (angleRad * 180) / Math.PI

  // 倾角大于 5 度为斜面钻入风险
  const isSlanted = angleDeg > 5

  // 2. 检查孔口圆形是否跨越基体外边界
  const mouthRadius = cavity.segments[0]?.r0 ?? 5
  const mouthPos = cavity.mouth
  const [sx, sy, sz] = dimensions

  // 离边界距离：仅计算面切向方向（垂直于面法向），排除面法向自身所在的平面
  let distToEdge = Infinity
  const absNorm = [Math.abs(faceNormal[0]), Math.abs(faceNormal[1]), Math.abs(faceNormal[2])]

  // 若法向不是 X 轴，则 X 方向是该面的切向边界
  if (absNorm[0] < 0.8) {
    const dX = Math.min(mouthPos[0], sx - mouthPos[0])
    distToEdge = Math.min(distToEdge, dX)
  }
  // 若法向不是 Y 轴，则 Y 方向是该面的切向边界
  if (absNorm[1] < 0.8) {
    const dY = Math.min(mouthPos[1], sy - mouthPos[1])
    distToEdge = Math.min(distToEdge, dY)
  }
  // 若法向不是 Z 轴，则 Z 方向是该面的切向边界
  if (absNorm[2] < 0.8) {
    const dZ = Math.min(mouthPos[2], sz - mouthPos[2])
    distToEdge = Math.min(distToEdge, dZ)
  }

  const isCrossEdge = distToEdge < mouthRadius

  if (isSlanted || isCrossEdge) {
    const refCavity: EntityRef = { kind: 'cavity', instanceId: cavity.cavity.instanceId }
    const measurements: Measure[] = isSlanted
      ? [
          {
            name: '入口钻入偏角',
            value: Number(angleDeg.toFixed(1)),
            unit: 'deg',
            upperBound: 5
          }
        ]
      : [
          {
            name: '孔口离边距离',
            value: Number(distToEdge.toFixed(1)),
            unit: 'mm',
            lowerBound: mouthRadius
          }
        ]

    const requirements: Measure[] = isSlanted
      ? [
          {
            name: '允许最大偏角',
            value: 5,
            unit: 'deg',
            upperBound: 5
          }
        ]
      : [
          {
            name: '最小安全边距',
            value: Number(mouthRadius.toFixed(1)),
            unit: 'mm',
            lowerBound: mouthRadius
          }
        ]

    issues.push({
      id: `issue-MFG-002-${cavity.cavity.instanceId}`,
      stableKey: `MFG-002:${cavity.cavity.instanceId}`,
      ruleId: 'MFG-002',
      ruleVersion: RULE_DEFINITIONS['MFG-002'].version,
      stamp,
      severity: 'warning',
      messageKey: isCrossEdge ? 'cross_edge_drilling_risk' : 'slanted_drilling_risk',
      messageArgs: {
        hole: cavity.cavity.subHoleName || cavity.cavity.name,
        angle: angleDeg.toFixed(1),
        detail: isCrossEdge ? '孔口边缘跨越基体棱边' : `入口钻入夹角偏差 ${angleDeg.toFixed(1)}°`
      },
      measurements,
      requirements,
      precision: 'brep',
      evidence: {
        refs: [refCavity],
        points: [cavity.mouth],
        lines: [[cavity.mouth, add(cavity.mouth, mul(actualDrillDir, 20))]]
      },
      remediation: RULE_DEFINITIONS['MFG-002'].remediationTemplate
    })
  }

  return issues
}

/**
 * 评估 MFG-003: 深径比超限
 * L 为从入口到该段最深完整截面的累计到达深度，D 为直径，L/D 超过上限报警告
 */
export function evaluateDepthDiameterRatio(
  cavity: CavityAnalyzedGeometry,
  config: CheckConfig,
  stamp: AnalysisStamp
): CheckIssue[] {
  const issues: CheckIssue[] = []
  const maxRatio = config.maxDepthDiameterRatio
  if (!maxRatio || maxRatio <= 0) {
    // 未设置深径比上限，静默跳过
    return issues
  }

  for (const seg of cavity.segments) {
    // 针对圆柱钻削段 (r0 === r1 且 r0 > 0)
    const diameter = 2 * seg.r0
    if (diameter <= 0.1) continue

    const cumulativeDepth = seg.z1 // 到达该段底部的完整深度
    const ratio = cumulativeDepth / diameter

    if (ratio > maxRatio) {
      const refCavity: EntityRef = { kind: 'cavity', instanceId: cavity.cavity.instanceId }
      issues.push({
        id: `issue-MFG-003-${cavity.cavity.instanceId}-${seg.stepIndex}`,
        stableKey: `MFG-003:${cavity.cavity.instanceId}:${seg.stepIndex}`,
        ruleId: 'MFG-003',
        ruleVersion: RULE_DEFINITIONS['MFG-003'].version,
        stamp,
        severity: 'warning',
        messageKey: 'depth_to_diameter_exceeded',
        messageArgs: {
          hole: cavity.cavity.subHoleName || cavity.cavity.name,
          ratio: ratio.toFixed(1),
          maxRatio: maxRatio.toFixed(1),
          depth: cumulativeDepth.toFixed(1),
          diameter: diameter.toFixed(1)
        },
        measurements: [
          {
            name: '实测深径比',
            value: Number(ratio.toFixed(1)),
            unit: 'ratio'
          },
          {
            name: '到达深度 L',
            value: Number(cumulativeDepth.toFixed(1)),
            unit: 'mm'
          },
          {
            name: '钻削直径 D',
            value: Number(diameter.toFixed(1)),
            unit: 'mm'
          }
        ],
        requirements: [
          {
            name: '允许深径比上限',
            value: maxRatio,
            unit: 'ratio'
          }
        ],
        precision: 'brep',
        evidence: {
          refs: [refCavity],
          points: [seg.p0, seg.p1],
          lines: [[seg.p0, seg.p1]]
        },
        remediation: RULE_DEFINITIONS['MFG-003'].remediationTemplate
      })
      // 只要该孔最深段报了超限，避免对每个小分段重复刷屏
      break
    }
  }

  return issues
}

/**
 * 评估 MFG-004: 交叉孔断续切削风险
 * 检查两孔相交切削可能导致的偏斜/断刀风险
 */
export function evaluateCrossDrillingInterruption(
  cavityA: CavityAnalyzedGeometry,
  cavityB: CavityAnalyzedGeometry,
  stamp: AnalysisStamp
): CheckIssue[] {
  const issues: CheckIssue[] = []

  // 判断两孔轴向夹角：同轴接续不报交叉切削
  const dirA = unit(cavityA.axisDir)
  const dirB = unit(cavityB.axisDir)
  const cosAngle = Math.abs(dot(dirA, dirB))
  if (cosAngle > 0.99) {
    // 接近平行同轴，豁免
    return issues
  }

  // 查找相交段
  for (const segA of cavityA.segments) {
    for (const segB of cavityB.segments) {
      // 轴线最短距离
      const vA = sub(segA.p1, segA.p0)
      const vB = sub(segB.p1, segB.p0)
      const w0 = sub(segA.p0, segB.p0)
      const a = dot(vA, vA), b = dot(vA, vB), c = dot(vB, vB), d = dot(vA, w0), e = dot(vB, w0)
      const denom = a * c - b * b
      if (denom < 1e-7) continue
      const s = Math.max(0, Math.min(1, (b * e - c * d) / denom))
      const t = Math.max(0, Math.min(1, (a * e - b * d) / denom))
      const ptA = add(segA.p0, mul(vA, s))
      const ptB = add(segB.p0, mul(vB, t))
      const dist = norm(sub(ptA, ptB))

      const rA = segA.r0 + s * (segA.r1 - segA.r0)
      const rB = segB.r0 + t * (segB.r1 - segB.r0)

      if (dist < rA + rB) {
        const sortedIds = [cavityA.cavity.instanceId, cavityB.cavity.instanceId].sort()
        const refA: EntityRef = { kind: 'cavity', instanceId: cavityA.cavity.instanceId }
        const refB: EntityRef = { kind: 'cavity', instanceId: cavityB.cavity.instanceId }

        issues.push({
          id: `issue-MFG-004-${sortedIds.join('-')}`,
          stableKey: `MFG-004:${sortedIds.join('-')}`,
          ruleId: 'MFG-004',
          ruleVersion: RULE_DEFINITIONS['MFG-004'].version,
          stamp,
          severity: 'warning',
          messageKey: 'cross_drilling_interrupted_cutting',
          messageArgs: {
            holeA: cavityA.cavity.subHoleName || cavityA.cavity.name,
            holeB: cavityB.cavity.subHoleName || cavityB.cavity.name
          },
          measurements: [],
          requirements: [],
          precision: 'brep',
          evidence: {
            refs: [refA, refB],
            points: [ptA, ptB],
            lines: [[ptA, ptB]]
          },
          remediation: RULE_DEFINITIONS['MFG-004'].remediationTemplate
        })
        return issues // 每对相交孔只报告一条
      }
    }
  }

  return issues
}
