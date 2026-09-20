import { describe, it, expect } from 'vitest'
import type { CavityInstance } from '../../types'
import { createTestCavity } from './testUtils'
import { runDesignAnalysis } from '../analysisEngine'
import { DEFAULT_CHECK_CONFIG, type AnalysisStamp } from '../contracts'

const testStamp: AnalysisStamp = {
  sessionId: 'test-session',
  requestId: 'req-1',
  projectId: 'proj-1',
  schemeId: 'scheme-1',
  modelRevision: 42,
  configRevision: 3,
  resourceRevision: 1,
  ruleSetVersion: '1.0.0',
  geometryPolicyVersion: '1.0.0'
}

describe('Design Analysis Engine (FR-04-15 Master Pipeline)', () => {
  it('returns neutral empty state (0 issues, 0 observations) on an empty or clean block', () => {
    const res = runDesignAnalysis([], [100, 100, 100], { template: 'box' }, DEFAULT_CHECK_CONFIG, testStamp)
    expect(res.issues.length).toBe(0)
    expect(res.observations.length).toBe(0)
    expect(res.evaluated).toBe(0)
  })

  it('orchestrates end-to-end checks and preserves AnalysisStamp on all issues', () => {
    // 创建两个靠得很近的孔 (轴线距离 12mm，直径 10mm，壁厚仅 2mm < 3mm)
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'cav-1',
      templateId: 'cav1',
      name: '油孔 A',
      faceId: 'top',
      u: 30,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 50 }]
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'cav-2',
      templateId: 'cav1',
      name: '油孔 B',
      faceId: 'top',
      u: 42,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 50 }]
    })

    const res = runDesignAnalysis(
      [cav1, cav2],
      [100, 100, 100],
      { template: 'box' },
      DEFAULT_CHECK_CONFIG,
      testStamp
    )

    expect(res.issues.length).toBeGreaterThan(0)
    for (const issue of res.issues) {
      expect(issue.stamp).toEqual(testStamp)
      expect(['error', 'warning']).toContain(issue.severity)
    }

    const clr001 = res.issues.find((i) => i.ruleId === 'CLR-001')
    expect(clr001).toBeDefined()
    expect(clr001?.severity).toBe('error')
  })

  it('respects ruleEnabled configuration to disable specific checks', () => {
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'cav-1',
      templateId: 'cav1',
      name: '油孔 A',
      faceId: 'top',
      u: 30,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 50 }]
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'cav-2',
      templateId: 'cav1',
      name: '油孔 B',
      faceId: 'top',
      u: 42,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 50 }]
    })

    // 禁用 CLR-001
    const configDisabled = {
      ...DEFAULT_CHECK_CONFIG,
      ruleEnabled: {
        ...DEFAULT_CHECK_CONFIG.ruleEnabled,
        'CLR-001': false
      }
    }

    const res = runDesignAnalysis(
      [cav1, cav2],
      [100, 100, 100],
      { template: 'box' },
      configDisabled,
      testStamp
    )

    const clr001 = res.issues.find((i) => i.ruleId === 'CLR-001')
    expect(clr001).toBeUndefined()
  })

  it('honors cavity override thresholds', () => {
    // 间距 14mm，壁厚 4mm。全局阈值为 3mm (无告警)。
    // 但为 cav-override 设置更严苛的壁厚阈值 5mm，应触发告警。
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'cav-override',
      templateId: 'cav1',
      name: '高压孔',
      faceId: 'top',
      u: 30,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 50 }]
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'cav-normal',
      templateId: 'cav1',
      name: '常规孔',
      faceId: 'top',
      u: 44,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 50 }]
    })

    const configWithOverride = {
      ...DEFAULT_CHECK_CONFIG,
      cavityOverrides: {
        'cav-override': {
          minHoleToHoleWall: { value: 5, unit: 'mm' as const }
        }
      }
    }

    const res = runDesignAnalysis(
      [cav1, cav2],
      [100, 100, 100],
      { template: 'box' },
      configWithOverride,
      testStamp
    )

    const clr001 = res.issues.find((i) => i.ruleId === 'CLR-001')
    expect(clr001).toBeDefined()
    expect(clr001?.requirements[0].value).toBe(5)
  })
})
