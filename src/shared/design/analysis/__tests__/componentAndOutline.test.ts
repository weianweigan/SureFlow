import { describe, it, expect } from 'vitest'
import type { CavityInstance } from '../../types'
import { createTestCavity } from './testUtils'
import { buildAnalyzedCavityGeometry } from '../geometry/wallThickness'
import {
  evaluateInvalidDesignGeometry,
  evaluateDuplicateCavities
} from '../geometry/geometrySanity'
import {
  evaluateOutlineChecks,
  evaluateComponentChecks
} from '../geometry/componentChecks'
import { DEFAULT_CHECK_CONFIG, type AnalysisStamp, type ComponentModelBinding } from '../contracts'

const dummyStamp: AnalysisStamp = {
  sessionId: 's',
  requestId: 'r',
  projectId: 'p',
  schemeId: 'sc',
  modelRevision: 1,
  configRevision: 1,
  resourceRevision: 1,
  ruleSetVersion: '1.0.0',
  geometryPolicyVersion: '1.0.0'
}

describe('Geometry Sanity (GEO-002 & GEO-003)', () => {
  it('GEO-003: flags invalid geometry for negative dimensions and non-positive diameters', () => {
    const cavInvalid: CavityInstance = createTestCavity({
      instanceId: 'c-invalid',
      templateId: 'cav1',
      name: '非法孔',
      faceId: 'top',
      u: 20,
      v: NaN,
      steps: [{ type: 'straight', diameter: -5, length: 20 }]
    })

    const { issues, invalidCavityIds } = evaluateInvalidDesignGeometry(
      [cavInvalid],
      [-100, 100, 100],
      dummyStamp
    )

    // 应包含 1 个基体尺寸错误和 1 个孔几何错误
    expect(issues.length).toBe(2)
    expect(issues.some((i) => i.messageKey === 'invalid_base_dimension')).toBe(true)
    expect(issues.some((i) => i.messageKey === 'invalid_cavity_geometry')).toBe(true)
    expect(invalidCavityIds.has('c-invalid')).toBe(true)
  })

  it('GEO-002: detects duplicate cavities on the same face with matching parameters', () => {
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'dup-1',
      templateId: 'cav1',
      name: '孔 1',
      faceId: 'top',
      u: 30,
      v: 40,
      steps: [{ type: 'straight', diameter: 10, length: 25 }]
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'dup-2',
      templateId: 'cav1',
      name: '孔 2',
      faceId: 'top',
      u: 30,
      v: 40,
      steps: [{ type: 'straight', diameter: 10, length: 25 }]
    })

    const issues = evaluateDuplicateCavities([cav1, cav2], new Set(), dummyStamp)
    expect(issues.length).toBe(1)
    expect(issues[0].ruleId).toBe('GEO-002')
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].messageArgs.count).toBe(2)
  })
})

describe('2D Outline Checks (OUT-001 & OUT-002)', () => {
  it('OUT-001: flags outline overlap when two cavities are too close on the same face', () => {
    // 直径 10 -> r0=5 -> 法兰半径 7mm
    // 两个孔距离仅 8mm (小于 7 + 7 = 14mm)，产生 6mm 重叠
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'c1',
      templateId: 'cav1',
      name: '孔 1',
      faceId: 'top',
      u: 20,
      v: 20,
      steps: [{ type: 'straight', diameter: 10, length: 20 }]
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'c2',
      templateId: 'cav1',
      name: '孔 2',
      faceId: 'top',
      u: 28,
      v: 20,
      steps: [{ type: 'straight', diameter: 10, length: 20 }]
    })

    const g1 = buildAnalyzedCavityGeometry(cav1, [100, 100, 100])
    const g2 = buildAnalyzedCavityGeometry(cav2, [100, 100, 100])

    const issues = evaluateOutlineChecks([g1, g2], DEFAULT_CHECK_CONFIG, dummyStamp)
    expect(issues.length).toBe(1)
    expect(issues[0].ruleId).toBe('OUT-001')
    expect(issues[0].severity).toBe('error')

    // 组合孔内的孔（相同 groupId）不检查二维轮廓重叠
    const cavGroupA = { ...cav1, groupId: 'group-1' }
    const cavGroupB = { ...cav2, groupId: 'group-1' }
    const gGroupA = buildAnalyzedCavityGeometry(cavGroupA, [100, 100, 100])
    const gGroupB = buildAnalyzedCavityGeometry(cavGroupB, [100, 100, 100])
    const groupIssues = evaluateOutlineChecks([gGroupA, gGroupB], DEFAULT_CHECK_CONFIG, dummyStamp)
    expect(groupIssues.length).toBe(0)
  })

  it('OUT-002: flags insufficient clearance when outline clearance is below threshold', () => {
    // 间距 20mm，法兰半径 7mm + 7mm = 14mm，净距 6mm
    // 设置 minOutlineClearance = 8mm，则触发 OUT-002
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'c1',
      templateId: 'cav1',
      name: '孔 1',
      faceId: 'top',
      u: 20,
      v: 20,
      steps: [{ type: 'straight', diameter: 10, length: 20 }]
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'c2',
      templateId: 'cav1',
      name: '孔 2',
      faceId: 'top',
      u: 40,
      v: 20,
      steps: [{ type: 'straight', diameter: 10, length: 20 }]
    })

    const g1 = buildAnalyzedCavityGeometry(cav1, [100, 100, 100])
    const g2 = buildAnalyzedCavityGeometry(cav2, [100, 100, 100])

    const config = {
      ...DEFAULT_CHECK_CONFIG,
      minOutlineClearance: { value: 8, unit: 'mm' as const }
    }

    const issues = evaluateOutlineChecks([g1, g2], config, dummyStamp)
    expect(issues.length).toBe(1)
    expect(issues[0].ruleId).toBe('OUT-002')
    expect(issues[0].severity).toBe('warning')
  })
})

describe('3D Component Checks (CMP-001/002/003)', () => {
  it('CMP-001 & CMP-002: distinguishes real B-Rep interference from simplified envelope collision', () => {
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'v1',
      templateId: 'cav1',
      name: '阀 1',
      faceId: 'top',
      u: 30,
      v: 30,
      steps: [{ type: 'straight', diameter: 10, length: 20 }]
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'v2',
      templateId: 'cav1',
      name: '阀 2',
      faceId: 'top',
      u: 35,
      v: 30,
      steps: [{ type: 'straight', diameter: 10, length: 20 }]
    })

    const g1 = buildAnalyzedCavityGeometry(cav1, [100, 100, 100])
    const g2 = buildAnalyzedCavityGeometry(cav2, [100, 100, 100])

    // Case 1: 均有真实外部模型 -> CMP-001 (error)
    const bindingsReal: ComponentModelBinding[] = [
      {
        ownerKind: 'cavity',
        ownerId: 'v1',
        enabled: true,
        external: {
          format: 'step',
          path: '/models/v1.step',
          pathMode: 'project-relative',
          importPolicyVersion: '1.0.0'
        }
      },
      {
        ownerKind: 'cavity',
        ownerId: 'v2',
        enabled: true,
        external: {
          format: 'step',
          path: '/models/v2.step',
          pathMode: 'project-relative',
          importPolicyVersion: '1.0.0'
        }
      }
    ]

    const issuesReal = evaluateComponentChecks(
      [g1, g2],
      bindingsReal,
      DEFAULT_CHECK_CONFIG,
      dummyStamp
    )
    expect(issuesReal.length).toBe(1)
    expect(issuesReal[0].ruleId).toBe('CMP-001')
    expect(issuesReal[0].severity).toBe('error')

    // Case 2: 无外部真实模型 (参数化简化模型) -> CMP-002 (warning)
    const bindingsSimplified: ComponentModelBinding[] = [
      {
        ownerKind: 'cavity',
        ownerId: 'v1',
        enabled: true
      },
      {
        ownerKind: 'cavity',
        ownerId: 'v2',
        enabled: true
      }
    ]

    const issuesSimp = evaluateComponentChecks(
      [g1, g2],
      bindingsSimplified,
      DEFAULT_CHECK_CONFIG,
      dummyStamp
    )
    expect(issuesSimp.length).toBe(1)
    expect(issuesSimp[0].ruleId).toBe('CMP-002')
    expect(issuesSimp[0].severity).toBe('warning')
  })
})
