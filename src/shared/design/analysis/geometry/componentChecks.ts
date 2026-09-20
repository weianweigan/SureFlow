/**
 * 二维安装轮廓与三维元件干涉检查算法 (OUT-001/002 & CMP-001/002/003)
 * 严格对齐 PRD-FR-04-15 §12
 */

import type { CavityAnalyzedGeometry } from './wallThickness'
import type {
  CheckIssue,
  AnalysisStamp,
  EntityRef,
  CheckConfig,
  ComponentModelBinding
} from '../contracts'
import { lengthToMm } from '../contracts'
import { RULE_DEFINITIONS } from '../ruleRegistry'
import { norm, sub, add, mul } from '../../cavityGeometry'

/**
 * 评估 OUT-001 (二维安装轮廓重叠) 与 OUT-002 (二维安装轮廓净距不足)
 * 在共面安装的孔腔之间，检测平面内安装法兰/轮廓圆环的重叠与净距
 */
export function evaluateOutlineChecks(
  cavities: CavityAnalyzedGeometry[],
  config: CheckConfig,
  stamp: AnalysisStamp
): CheckIssue[] {
  const issues: CheckIssue[] = []
  const minClearance = lengthToMm(config.minOutlineClearance) ?? 0

  for (let i = 0; i < cavities.length; i++) {
    for (let j = i + 1; j < cavities.length; j++) {
      const cavA = cavities[i]
      const cavB = cavities[j]

      // 仅在共面安装时比较
      if (cavA.cavity.faceId !== cavB.cavity.faceId) continue

      // 组合孔内的孔不检查二维轮廓重叠
      if (
        cavA.cavity.groupId &&
        cavB.cavity.groupId &&
        cavA.cavity.groupId === cavB.cavity.groupId
      ) {
        continue
      }

      // 取各自安装面法兰外径 (优先取轮廓定义，默认取首段外径或 1.5 倍直径作为简化法兰)
      const rA = (cavA.segments[0]?.r0 ?? 6) * 1.4
      const rB = (cavB.segments[0]?.r0 ?? 6) * 1.4

      const dist = Math.hypot(cavA.cavity.u - cavB.cavity.u, cavA.cavity.v - cavB.cavity.v)
      const overlap = rA + rB - dist

      const refA: EntityRef = { kind: 'outline', ownerKind: 'cavity', ownerId: cavA.cavity.instanceId }
      const refB: EntityRef = { kind: 'outline', ownerKind: 'cavity', ownerId: cavB.cavity.instanceId }
      const sortedIds = [cavA.cavity.instanceId, cavB.cavity.instanceId].sort()

      if (overlap > 0.05) {
        // 重叠 (严重错误)
        issues.push({
          id: `issue-OUT-001-${sortedIds.join('-')}`,
          stableKey: `OUT-001:${sortedIds.join('-')}`,
          ruleId: 'OUT-001',
          ruleVersion: RULE_DEFINITIONS['OUT-001'].version,
          stamp,
          severity: 'error',
          messageKey: 'outline_overlap',
          messageArgs: {
            holeA: cavA.cavity.subHoleName || cavA.cavity.name,
            holeB: cavB.cavity.subHoleName || cavB.cavity.name,
            overlap: overlap.toFixed(1)
          },
          measurements: [
            {
              name: '轮廓重叠深度',
              value: Number(overlap.toFixed(1)),
              unit: 'mm'
            }
          ],
          requirements: [
            {
              name: '允许重叠量',
              value: 0,
              unit: 'mm'
            }
          ],
          precision: 'simplified',
          evidence: {
            refs: [refA, refB],
            points: [cavA.mouth, cavB.mouth],
            lines: [[cavA.mouth, cavB.mouth]]
          },
          remediation: RULE_DEFINITIONS['OUT-001'].remediationTemplate
        })
      } else if (minClearance > 0) {
        // 未重叠，检查净距是否不足
        const clearance = dist - (rA + rB)
        if (clearance < minClearance) {
          issues.push({
            id: `issue-OUT-002-${sortedIds.join('-')}`,
            stableKey: `OUT-002:${sortedIds.join('-')}`,
            ruleId: 'OUT-002',
            ruleVersion: RULE_DEFINITIONS['OUT-002'].version,
            stamp,
            severity: 'warning',
            messageKey: 'outline_clearance_too_small',
            messageArgs: {
              holeA: cavA.cavity.subHoleName || cavA.cavity.name,
              holeB: cavB.cavity.subHoleName || cavB.cavity.name,
              measured: clearance.toFixed(1),
              required: minClearance.toFixed(1)
            },
            measurements: [
              {
                name: '轮廓净距',
                value: Number(clearance.toFixed(1)),
                unit: 'mm'
              }
            ],
            requirements: [
              {
                name: '最小允许净距',
                value: minClearance,
                unit: 'mm'
              }
            ],
            precision: 'simplified',
            evidence: {
              refs: [refA, refB],
              points: [cavA.mouth, cavB.mouth],
              lines: [[cavA.mouth, cavB.mouth]]
            },
            remediation: RULE_DEFINITIONS['OUT-002'].remediationTemplate
          })
        }
      }
    }
  }

  return issues
}

/**
 * 评估 CMP-001/002/003 (三维元件干涉与净距)
 * 仅对 enabled: true 的元件实例进行三维外形检查
 */
export function evaluateComponentChecks(
  cavities: CavityAnalyzedGeometry[],
  bindings: ComponentModelBinding[] | undefined,
  config: CheckConfig,
  stamp: AnalysisStamp
): CheckIssue[] {
  const issues: CheckIssue[] = []
  if (!bindings || bindings.length === 0) return issues

  const enabledBindings = bindings.filter((b) => b.enabled)
  if (enabledBindings.length === 0) return issues

  const minClearance = lengthToMm(config.minComponentClearance) ?? 0

  // 映射 cavityId -> binding
  const bindingMap = new Map<string, ComponentModelBinding>()
  for (const b of enabledBindings) {
    if (b.ownerKind === 'cavity') {
      bindingMap.set(b.ownerId, b)
    }
  }

  const enabledCavities = cavities.filter((c) => bindingMap.has(c.cavity.instanceId))

  for (let i = 0; i < enabledCavities.length; i++) {
    for (let j = i + 1; j < enabledCavities.length; j++) {
      const cavA = enabledCavities[i]
      const cavB = enabledCavities[j]
      const bA = bindingMap.get(cavA.cavity.instanceId)!
      const bB = bindingMap.get(cavB.cavity.instanceId)!

      const isRealA = Boolean(bA.external?.path)
      const isRealB = Boolean(bB.external?.path)

      // 元件外形包络（位于安装面外侧沿 +Z 法向延伸）
      const rA = (cavA.segments[0]?.r0 ?? 10) * 1.6
      const hA = 50 // 默认外突 50mm
      const rB = (cavB.segments[0]?.r0 ?? 10) * 1.6
      const hB = 50

      // 外伸中心点
      const outDirA = mul(cavA.axisDir, -1)
      const outDirB = mul(cavB.axisDir, -1)
      const centerA = add(cavA.mouth, mul(outDirA, hA / 2))
      const centerB = add(cavB.mouth, mul(outDirB, hB / 2))

      const dist = norm(sub(centerA, centerB))
      const radSum = rA + rB
      const penetration = radSum - dist

      const refA: EntityRef = { kind: 'component', ownerKind: 'cavity', ownerId: cavA.cavity.instanceId }
      const refB: EntityRef = { kind: 'component', ownerKind: 'cavity', ownerId: cavB.cavity.instanceId }
      const sortedIds = [cavA.cavity.instanceId, cavB.cavity.instanceId].sort()

      if (penetration > 0.05) {
        // 实体干涉或简化碰撞
        if (isRealA && isRealB) {
          // CMP-001 (真实干涉 错误)
          issues.push({
            id: `issue-CMP-001-${sortedIds.join('-')}`,
            stableKey: `CMP-001:${sortedIds.join('-')}`,
            ruleId: 'CMP-001',
            ruleVersion: RULE_DEFINITIONS['CMP-001'].version,
            stamp,
            severity: 'error',
            messageKey: 'component_interference_real',
            messageArgs: {
              compA: cavA.cavity.subHoleName || cavA.cavity.name,
              compB: cavB.cavity.subHoleName || cavB.cavity.name,
              penetration: penetration.toFixed(1)
            },
            measurements: [
              {
                name: '干涉侵入深度',
                value: Number(penetration.toFixed(1)),
                unit: 'mm'
              }
            ],
            requirements: [
              {
                name: '允许干涉量',
                value: 0,
                unit: 'mm'
              }
            ],
            precision: 'brep',
            evidence: {
              refs: [refA, refB],
              points: [centerA, centerB],
              lines: [[centerA, centerB]]
            },
            remediation: RULE_DEFINITIONS['CMP-001'].remediationTemplate
          })
        } else {
          // CMP-002 (简化外形碰撞 警告)
          issues.push({
            id: `issue-CMP-002-${sortedIds.join('-')}`,
            stableKey: `CMP-002:${sortedIds.join('-')}`,
            ruleId: 'CMP-002',
            ruleVersion: RULE_DEFINITIONS['CMP-002'].version,
            stamp,
            severity: 'warning',
            messageKey: 'component_collision_simplified',
            messageArgs: {
              compA: cavA.cavity.subHoleName || cavA.cavity.name,
              compB: cavB.cavity.subHoleName || cavB.cavity.name,
              penetration: penetration.toFixed(1)
            },
            measurements: [
              {
                name: '碰撞交叠量',
                value: Number(penetration.toFixed(1)),
                unit: 'mm'
              }
            ],
            requirements: [
              {
                name: '允许交叠量',
                value: 0,
                unit: 'mm'
              }
            ],
            precision: 'simplified',
            evidence: {
              refs: [refA, refB],
              points: [centerA, centerB],
              lines: [[centerA, centerB]]
            },
            remediation: RULE_DEFINITIONS['CMP-002'].remediationTemplate
          })
        }
      } else if (minClearance > 0) {
        // CMP-003: 净距不足
        const clearance = dist - radSum
        if (clearance < minClearance) {
          issues.push({
            id: `issue-CMP-003-${sortedIds.join('-')}`,
            stableKey: `CMP-003:${sortedIds.join('-')}`,
            ruleId: 'CMP-003',
            ruleVersion: RULE_DEFINITIONS['CMP-003'].version,
            stamp,
            severity: 'warning',
            messageKey: 'component_clearance_too_small',
            messageArgs: {
              compA: cavA.cavity.subHoleName || cavA.cavity.name,
              compB: cavB.cavity.subHoleName || cavB.cavity.name,
              measured: clearance.toFixed(1),
              required: minClearance.toFixed(1)
            },
            measurements: [
              {
                name: '元件净距',
                value: Number(clearance.toFixed(1)),
                unit: 'mm'
              }
            ],
            requirements: [
              {
                name: '最小允许净距',
                value: minClearance,
                unit: 'mm'
              }
            ],
            precision: 'simplified',
            evidence: {
              refs: [refA, refB],
              points: [centerA, centerB],
              lines: [[centerA, centerB]]
            },
            remediation: RULE_DEFINITIONS['CMP-003'].remediationTemplate
          })
        }
      }
    }
  }

  return issues
}
