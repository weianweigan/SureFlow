/**
 * 几何合规与健康度检查算法 (GEO-002 重复孔 / GEO-003 无效几何)
 * 严格对齐 PRD-FR-04-15 §7.5
 */

import type { CavityInstance } from '../../types'
import type { CheckIssue, AnalysisStamp, EntityRef } from '../contracts'
import { RULE_DEFINITIONS } from '../ruleRegistry'

/**
 * 评估 GEO-003: 已确认无效设计几何
 * 检查是否存在非有限尺寸 (NaN/Infinity)、非正直径、非正深度等非法设计参数
 */
export function evaluateInvalidDesignGeometry(
  cavities: CavityInstance[],
  dimensions: [number, number, number],
  stamp: AnalysisStamp
): { issues: CheckIssue[]; invalidCavityIds: Set<string> } {
  const issues: CheckIssue[] = []
  const invalidCavityIds = new Set<string>()

  // 1. 检查基体尺寸
  for (let i = 0; i < 3; i++) {
    const dim = dimensions[i]
    if (!Number.isFinite(dim) || dim <= 0) {
      issues.push({
        id: `issue-GEO-003-base-dim-${i}`,
        stableKey: `GEO-003:base-dim:${i}`,
        ruleId: 'GEO-003',
        ruleVersion: RULE_DEFINITIONS['GEO-003'].version,
        stamp,
        severity: 'error',
        messageKey: 'invalid_base_dimension',
        messageArgs: {
          axis: ['Lx', 'Ly', 'Lz'][i],
          val: String(dim)
        },
        measurements: [],
        requirements: [],
        precision: 'brep',
        evidence: {
          refs: [{ kind: 'base-face', faceId: 'base' }]
        },
        remediation: '在基体属性面板中将尺寸修改为合法的正实数'
      })
    }
  }

  // 2. 检查各孔腔参数
  for (const cav of cavities) {
    if (cav.suppressed) continue

    const reasons: string[] = []
    if (!Number.isFinite(cav.u) || !Number.isFinite(cav.v)) {
      reasons.push(`坐标 (u: ${cav.u}, v: ${cav.v}) 包含非有限数`)
    }
    if (cav.depthOffset !== undefined && !Number.isFinite(cav.depthOffset)) {
      reasons.push(`深度偏移 ${cav.depthOffset} 非法`)
    }

    if (cav.steps && cav.steps.length > 0) {
      for (let sIdx = 0; sIdx < cav.steps.length; sIdx++) {
        const step = cav.steps[sIdx]
        if (!Number.isFinite(step.diameter) || step.diameter <= 0) {
          reasons.push(`台阶 #${sIdx + 1} 直径 ${step.diameter} 不是正数`)
        }
        if (step.length != null && (!Number.isFinite(step.length) || step.length < 0)) {
          reasons.push(`台阶 #${sIdx + 1} 长度 ${step.length} 非法`)
        }
      }
    }

    if (reasons.length > 0) {
      invalidCavityIds.add(cav.instanceId)
      const refCavity: EntityRef = { kind: 'cavity', instanceId: cav.instanceId }
      issues.push({
        id: `issue-GEO-003-${cav.instanceId}`,
        stableKey: `GEO-003:${cav.instanceId}`,
        ruleId: 'GEO-003',
        ruleVersion: RULE_DEFINITIONS['GEO-003'].version,
        stamp,
        severity: 'error',
        messageKey: 'invalid_cavity_geometry',
        messageArgs: {
          hole: cav.subHoleName || cav.name,
          details: reasons.join('; ')
        },
        measurements: [],
        requirements: [],
        precision: 'brep',
        evidence: {
          refs: [refCavity]
        },
        remediation: RULE_DEFINITIONS['GEO-003'].remediationTemplate
      })
    }
  }

  return { issues, invalidCavityIds }
}

/**
 * 评估 GEO-002: 重复孔
 * 检测完全具有相同安装面、(u, v) 坐标、倾角、方位角和台阶的重复孔
 */
export function evaluateDuplicateCavities(
  cavities: CavityInstance[],
  invalidIds: Set<string>,
  stamp: AnalysisStamp
): CheckIssue[] {
  const issues: CheckIssue[] = []
  const validCavities = cavities.filter((c) => !c.suppressed && !invalidIds.has(c.instanceId))

  const groups = new Map<string, CavityInstance[]>()

  for (const cav of validCavities) {
    const stepsFingerprint = (cav.steps || [])
      .map((s) => `${s.type}:${s.diameter}:${s.length ?? 0}:${(s as any).angle ?? 0}`)
      .join('|')
    const key = `${cav.faceId}|${cav.u.toFixed(2)}|${cav.v.toFixed(2)}|${(cav.tiltAngle ?? 0).toFixed(1)}|${(cav.azimuth ?? cav.rotation ?? 0).toFixed(1)}|${stepsFingerprint}`

    const list = groups.get(key) || []
    list.push(cav)
    groups.set(key, list)
  }

  for (const list of groups.values()) {
    if (list.length >= 2) {
      const ids = list.map((c) => c.instanceId).sort()
      const names = list.map((c) => c.subHoleName || c.name).join(', ')
      const refs: EntityRef[] = list.map((c) => ({ kind: 'cavity', instanceId: c.instanceId }))

      issues.push({
        id: `issue-GEO-002-${ids.join('-')}`,
        stableKey: `GEO-002:${ids.join('-')}`,
        ruleId: 'GEO-002',
        ruleVersion: RULE_DEFINITIONS['GEO-002'].version,
        stamp,
        severity: 'warning',
        messageKey: 'duplicate_cavities_detected',
        messageArgs: {
          holes: names,
          count: list.length
        },
        measurements: [],
        requirements: [],
        precision: 'brep',
        evidence: {
          refs
        },
        remediation: RULE_DEFINITIONS['GEO-002'].remediationTemplate
      })
    }
  }

  return issues
}
