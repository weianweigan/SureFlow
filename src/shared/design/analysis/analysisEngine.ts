/**
 * 设计检查总执行引擎 (Design Analysis Engine)
 * 编排执行全部 18 项检查规则，产出 CheckIssue 与 CheckObservation
 * 严格对齐 PRD-FR-04-15
 */

import type { CavityInstance } from '../types'
import type {
  CheckConfig,
  CheckIssue,
  CheckObservation,
  AnalysisStamp,
  ComponentModelBinding
} from './contracts'
import {
  buildAnalyzedCavityGeometry,
  evaluateHoleToHoleWallThickness,
  evaluateHoleToOuterWallThickness,
  type CavityAnalyzedGeometry
} from './geometry/wallThickness'
import { evaluateCavityBreakthrough } from './geometry/breakthrough'
import {
  evaluateToolPathObstruction,
  evaluateSlantedOrEdgeEntrance,
  evaluateDepthDiameterRatio,
  evaluateCrossDrillingInterruption
} from './geometry/machiningChecks'
import {
  evaluateInvalidDesignGeometry,
  evaluateDuplicateCavities
} from './geometry/geometrySanity'
import {
  evaluateOutlineChecks,
  evaluateComponentChecks
} from './geometry/componentChecks'
import { evaluateHydraulicFlowRules } from './flowGraph/flowGraphBuilder'

export interface AnalysisRunResult {
  issues: CheckIssue[]
  observations: CheckObservation[]
  evaluated: number
  skipped: number
  failed: number
}

/**
 * 执行全量或增量设计检查
 */
export function runDesignAnalysis(
  cavities: CavityInstance[],
  dimensions: [number, number, number],
  baseBody: any,
  config: CheckConfig,
  stamp: AnalysisStamp,
  componentBindings?: ComponentModelBinding[]
): AnalysisRunResult {
  const issues: CheckIssue[] = []
  const observations: CheckObservation[] = []
  let evaluated = 0
  let skipped = 0

  const isRuleEnabled = (ruleId: string) => config.ruleEnabled[ruleId] !== false

  // 1. GEO-003: 检查已确认无效设计几何
  const { issues: invalidIssues, invalidCavityIds } = evaluateInvalidDesignGeometry(
    cavities,
    dimensions,
    stamp
  )
  if (isRuleEnabled('GEO-003')) {
    issues.push(...invalidIssues)
  }
  evaluated += cavities.length

  // 2. GEO-002: 重复孔检查
  if (isRuleEnabled('GEO-002')) {
    const dupIssues = evaluateDuplicateCavities(cavities, invalidCavityIds, stamp)
    issues.push(...dupIssues)
  }

  // 过滤有效且未抑制的孔腔
  const activeCavities = cavities.filter(
    (c) => !c.suppressed && !invalidCavityIds.has(c.instanceId)
  )

  // 构建拓扑几何
  const analyzedCavities: CavityAnalyzedGeometry[] = activeCavities.map((c) =>
    buildAnalyzedCavityGeometry(c, dimensions, baseBody)
  )

  // 3. GEO-001: 异常穿破与承接豁免检查
  const cavityExemptFaces = new Map<string, string[]>()
  if (isRuleEnabled('GEO-001')) {
    for (const cavGeom of analyzedCavities) {
      const { issues: breakIssues, exemptFaceIds } = evaluateCavityBreakthrough(
        cavGeom,
        analyzedCavities,
        dimensions,
        baseBody,
        stamp
      )
      issues.push(...breakIssues)
      cavityExemptFaces.set(cavGeom.cavity.instanceId, exemptFaceIds)
    }
  }

  // 4. CLR-001: 孔间壁厚检查
  if (isRuleEnabled('CLR-001')) {
    for (let i = 0; i < analyzedCavities.length; i++) {
      for (let j = i + 1; j < analyzedCavities.length; j++) {
        const { issues: clr1Issues, observations: clr1Obs } = evaluateHoleToHoleWallThickness(
          analyzedCavities[i],
          analyzedCavities[j],
          config,
          stamp
        )
        issues.push(...clr1Issues)
        observations.push(...clr1Obs)
      }
    }
  }

  // 5. CLR-002: 孔到外表面壁厚检查
  if (isRuleEnabled('CLR-002')) {
    for (const cavGeom of analyzedCavities) {
      const exempt = cavityExemptFaces.get(cavGeom.cavity.instanceId) || []
      const { issues: clr2Issues, observations: clr2Obs } = evaluateHoleToOuterWallThickness(
        cavGeom,
        dimensions,
        baseBody,
        config,
        stamp,
        exempt
      )
      issues.push(...clr2Issues)
      observations.push(...clr2Obs)
    }
  }

  // 6. 流道截面与水力图检查 (FLOW-001 ~ FLOW-004)
  const flowRulesActive =
    isRuleEnabled('FLOW-001') ||
    isRuleEnabled('FLOW-002') ||
    isRuleEnabled('FLOW-003') ||
    isRuleEnabled('FLOW-004')

  if (flowRulesActive) {
    const { issues: flowIssues, observations: flowObs } = evaluateHydraulicFlowRules(
      analyzedCavities,
      config,
      stamp
    )
    for (const issue of flowIssues) {
      if (isRuleEnabled(issue.ruleId)) {
        issues.push(issue)
      }
    }
    observations.push(...flowObs)
  }

  // 7. 加工风险预检 (MFG-001 ~ MFG-004)
  for (const cavGeom of analyzedCavities) {
    if (isRuleEnabled('MFG-001')) {
      issues.push(...evaluateToolPathObstruction(cavGeom, dimensions, baseBody, stamp))
    }
    if (isRuleEnabled('MFG-002')) {
      issues.push(...evaluateSlantedOrEdgeEntrance(cavGeom, dimensions, baseBody, stamp))
    }
    if (isRuleEnabled('MFG-003')) {
      issues.push(...evaluateDepthDiameterRatio(cavGeom, config, stamp))
    }
  }

  if (isRuleEnabled('MFG-004')) {
    for (let i = 0; i < analyzedCavities.length; i++) {
      for (let j = i + 1; j < analyzedCavities.length; j++) {
        issues.push(
          ...evaluateCrossDrillingInterruption(
            analyzedCavities[i],
            analyzedCavities[j],
            stamp
          )
        )
      }
    }
  }

  // 8. 二维安装轮廓检查 (OUT-001, OUT-002)
  if (isRuleEnabled('OUT-001') || isRuleEnabled('OUT-002')) {
    const outIssues = evaluateOutlineChecks(analyzedCavities, config, stamp)
    for (const issue of outIssues) {
      if (isRuleEnabled(issue.ruleId)) {
        issues.push(issue)
      }
    }
  }

  // 9. 三维元件干涉与净距检查 (CMP-001, CMP-002, CMP-003)
  if (isRuleEnabled('CMP-001') || isRuleEnabled('CMP-002') || isRuleEnabled('CMP-003')) {
    const cmpIssues = evaluateComponentChecks(analyzedCavities, componentBindings, config, stamp)
    for (const issue of cmpIssues) {
      if (isRuleEnabled(issue.ruleId)) {
        issues.push(issue)
      }
    }
  }

  // 稳定排序：错误在前，警告在后，同一级别按 stableKey 字母序排列 (PRD §4 FR-04-15-058)
  issues.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'error' ? -1 : 1
    }
    return a.stableKey.localeCompare(b.stableKey)
  })

  return {
    issues,
    observations,
    evaluated,
    skipped,
    failed: 0
  }
}
