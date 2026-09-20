import { describe, it, expect } from 'vitest'
import type { CavityInstance } from '../../types'
import { createTestCavity } from './testUtils'
import { buildAnalyzedCavityGeometry } from '../geometry/wallThickness'
import { evaluateCavityBreakthrough } from '../geometry/breakthrough'
import type { AnalysisStamp } from '../contracts'

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

describe('Breakthrough and Receiver Coverage (GEO-001)', () => {
  it('detects abnormal breakthrough when hole punches through bottom face without receiver', () => {
    // 基体高度 100，孔从 top 面打入，深度 120 (穿透 bottom 面 20mm)
    const throughHole: CavityInstance = createTestCavity({
      instanceId: 'deep-hole',
      templateId: 'cavity-1',
      name: '超深孔',
      faceId: 'top',
      u: 50,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 120 }]
    })
    const geom = buildAnalyzedCavityGeometry(throughHole, [100, 100, 100])

    const res = evaluateCavityBreakthrough(
      geom,
      [geom],
      [100, 100, 100],
      { template: 'box' },
      dummyStamp
    )

    // 应检测到 bottom 面穿出，且无承接孔覆盖
    expect(res.issues.length).toBe(1)
    expect(res.issues[0].ruleId).toBe('GEO-001')
    expect(res.issues[0].severity).toBe('error')
    expect(res.issues[0].messageArgs.face).toContain('底面')
  })

  it('exempts breakthrough when another valid cavity on that face covers the exit', () => {
    // 孔 1 从 top 面打到底面穿出
    const hole1: CavityInstance = createTestCavity({
      instanceId: 'hole-1',
      templateId: 'cavity-1',
      name: '主钻孔',
      faceId: 'top',
      u: 50,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 120 }]
    })
    // 孔 2 在 bottom 面对应位置 (u: 50, v: -50 对应世界坐标 x=50, y=50)，具有更大直径 16 的合法承接孔
    const hole2: CavityInstance = createTestCavity({
      instanceId: 'hole-2',
      templateId: 'cavity-plug',
      name: '堵头承接孔',
      faceId: 'bottom',
      u: 50,
      v: -50,
      steps: [{ type: 'straight', diameter: 16, length: 20 }]
    })

    const geom1 = buildAnalyzedCavityGeometry(hole1, [100, 100, 100])
    const geom2 = buildAnalyzedCavityGeometry(hole2, [100, 100, 100])

    const res = evaluateCavityBreakthrough(
      geom1,
      [geom1, geom2],
      [100, 100, 100],
      { template: 'box' },
      dummyStamp
    )

    // 孔 2 完整覆盖穿出口，不应产生 GEO-001 错误，并返回豁免面
    expect(res.issues.length).toBe(0)
    expect(res.exemptFaceIds).toContain('bottom')
  })
})
