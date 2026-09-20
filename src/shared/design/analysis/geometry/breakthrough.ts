/**
 * 异常穿破与承接分析算法 (GEO-001)
 * 严格对齐 PRD-FR-04-15 §7.2
 */

import type { CavityAnalyzedGeometry } from './wallThickness'
import { getFacesForTemplate, type BaseFaceDefinition } from '../../types'
import { add, mul, sub, dot, norm, unit, type Vec3 } from '../../cavityGeometry'
import type { CheckIssue, AnalysisStamp, EntityRef } from '../contracts'
import { RULE_DEFINITIONS } from '../ruleRegistry'

export interface BreakoutInfo {
  face: BaseFaceDefinition
  exitPoint: Vec3
  exitRadius: number
  uncoveredArea: number
  coveredByCavityId?: string
}

/**
 * 检查单个孔腔是否存在未被有效承接覆盖的异常穿出口
 */
export function evaluateCavityBreakthrough(
  sourceCavity: CavityAnalyzedGeometry,
  allCavities: CavityAnalyzedGeometry[],
  dimensions: [number, number, number],
  baseBody: any,
  stamp: AnalysisStamp
): { issues: CheckIssue[]; exemptFaceIds: string[] } {
  const issues: CheckIssue[] = []
  const exemptFaceIds: string[] = []

  const faces = getFacesForTemplate(
    baseBody?.template || 'box',
    dimensions,
    baseBody?.extraParams
  )
  const hostFaceId = sourceCavity.cavity.faceId

  for (const face of faces) {
    if (face.id === hostFaceId) continue // 排除孔自身的正常宿主安装入口

    const normal = unit(face.normal as Vec3)
    const planeOrigin: Vec3 = (face.origin as Vec3) || [0, 0, 0]

    // 检查孔腔最深端点或沿轴各段是否穿透该平面
    for (const seg of sourceCavity.segments) {
      // 检查 seg.p0 与 seg.p1 相对于平面的外法向投影
      const v0 = dot(sub(seg.p0, planeOrigin), normal)
      const v1 = dot(sub(seg.p1, planeOrigin), normal)

      // 只要该段穿过该外表面走向体外 (v0 <= 1e-4 且 v1 > 1e-4)
      if (v0 <= 1e-4 && v1 > 1e-4) {
        // 计算与平面的交点
        const denom = v1 - v0
        const t = Math.abs(denom) > 1e-9 ? Math.max(0, Math.min(1, -v0 / denom)) : 1
        const exitPoint = add(seg.p0, mul(sub(seg.p1, seg.p0), t))
        const exitRadius = seg.r0 + t * (seg.r1 - seg.r0)
        const totalBreakArea = Math.PI * exitRadius * exitRadius

        // 寻找位于该面上的有效承接孔 (Receiving Cavity)
        let maxCoveredArea = 0

        for (const candidate of allCavities) {
          if (candidate.cavity.instanceId === sourceCavity.cavity.instanceId) continue
          if (candidate.cavity.faceId !== face.id) continue
          if (candidate.cavity.suppressed) continue

          // 承接孔必须与源孔实际连通（轴线间距在半径和内）
          const mouthDist = norm(sub(candidate.mouth, exitPoint))
          const mouthRadius = candidate.segments[0]?.r0 ?? 5

          // 判定承接孔的开口是否覆盖源孔的穿出口
          // 若承接孔口完全包含穿出口：mouthDist + exitRadius <= mouthRadius + 0.1
          if (mouthDist + exitRadius <= mouthRadius + 0.1) {
            maxCoveredArea = totalBreakArea
            break
          } else if (mouthDist < mouthRadius + exitRadius) {
            // 部分重叠
            const d = mouthDist
            const r1 = exitRadius
            const r2 = mouthRadius
            if (d < r1 + r2) {
              const alpha = 2 * Math.acos(Math.max(-1, Math.min(1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))))
              const beta = 2 * Math.acos(Math.max(-1, Math.min(1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))))
              const overlap =
                0.5 * r1 * r1 * (alpha - Math.sin(alpha)) +
                0.5 * r2 * r2 * (beta - Math.sin(beta))
              if (overlap > maxCoveredArea) {
                maxCoveredArea = overlap
              }
            }
          }
        }

        const uncoveredArea = Math.max(0, totalBreakArea - maxCoveredArea)

        if (uncoveredArea > 0.05) {
          // 存在未完全覆盖的异常穿破
          const refCavity: EntityRef = { kind: 'cavity', instanceId: sourceCavity.cavity.instanceId }
          const refFace: EntityRef = { kind: 'base-face', faceId: face.id }

          issues.push({
            id: `issue-GEO-001-${sourceCavity.cavity.instanceId}-${face.id}`,
            stableKey: `GEO-001:${sourceCavity.cavity.instanceId}:${face.id}`,
            ruleId: 'GEO-001',
            ruleVersion: RULE_DEFINITIONS['GEO-001'].version,
            stamp,
            severity: 'error',
            messageKey: 'abnormal_breakthrough_without_receiver',
            messageArgs: {
              hole: sourceCavity.cavity.subHoleName || sourceCavity.cavity.name,
              face: face.name,
              uncoveredArea: uncoveredArea.toFixed(1)
            },
            measurements: [
              {
                name: '残余穿出面积',
                value: Number(uncoveredArea.toFixed(1)),
                unit: 'mm2'
              }
            ],
            requirements: [
              {
                name: '允许残余穿出面积',
                value: 0,
                unit: 'mm2'
              }
            ],
            precision: 'brep',
            evidence: {
              refs: [refCavity, refFace],
              points: [exitPoint],
              lines: [[exitPoint, add(exitPoint, mul(normal, 10))]]
            },
            remediation: RULE_DEFINITIONS['GEO-001'].remediationTemplate
          })
        } else {
          // 完整承接豁免
          exemptFaceIds.push(face.id)
        }
      }
    }
  }

  return { issues, exemptFaceIds }
}
