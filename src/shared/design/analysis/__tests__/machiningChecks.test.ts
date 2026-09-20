import { describe, it, expect } from 'vitest'
import type { CavityInstance } from '../../types'
import { createTestCavity } from './testUtils'
import { buildAnalyzedCavityGeometry } from '../geometry/wallThickness'
import {
  evaluateToolPathObstruction,
  evaluateSlantedOrEdgeEntrance,
  evaluateDepthDiameterRatio,
  evaluateCrossDrillingInterruption
} from '../geometry/machiningChecks'
import { DEFAULT_CHECK_CONFIG, type AnalysisStamp } from '../contracts'

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

describe('Machining Risk Checks (MFG-001 ~ MFG-004)', () => {
  it('MFG-001: detects tool approach path collision on L-shaped step', () => {
    // 在 L 型基体的凹台阶竖面内部向外钻，或在台阶顶面上打孔，上方若有突出实体则进刀阻挡
    // L 型基体: sx=100, sy=100, sz=100, cutX=40, cutZ=50
    // top-step 面在 z=50, 范围 x 在 [60, 100]
    // 若在 top-step 面孔轴倾斜指向未切除的凸台部分，探查进刀反向会穿入实体
    const cav: CavityInstance = createTestCavity({
      instanceId: 'l-blocked',
      templateId: 'c1',
      name: '阻挡孔',
      faceId: 'top-step',
      u: 10,
      v: 50,
      tiltAngle: 45, // 倾斜使进刀方向反向指向主凸台
      azimuth: 180,
      steps: [{ type: 'straight', diameter: 10, length: 30 }]
    })
    const geom = buildAnalyzedCavityGeometry(
      cav,
      [100, 100, 100],
      { template: 'l-shape', extraParams: { cutX: 40, cutZ: 50 } }
    )

    const issues = evaluateToolPathObstruction(
      geom,
      [100, 100, 100],
      { template: 'l-shape', extraParams: { cutX: 40, cutZ: 50 } },
      dummyStamp
    )
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues[0].ruleId).toBe('MFG-001')
    expect(issues[0].severity).toBe('warning')
  })

  it('MFG-002: detects slanted drilling angle and cross-edge hole mouth', () => {
    // 正常 0 度垂直孔（不应产生 MFG-002 警告）
    const normalCav: CavityInstance = createTestCavity({
      instanceId: 'normal',
      templateId: 'c1',
      name: '正常垂直孔',
      faceId: 'top',
      u: 50,
      v: 50,
      tiltAngle: 0,
      steps: [{ type: 'straight', diameter: 10, length: 30 }]
    })
    const normalGeom = buildAnalyzedCavityGeometry(normalCav, [100, 100, 100])
    const normalIssues = evaluateSlantedOrEdgeEntrance(
      normalGeom,
      [100, 100, 100],
      { template: 'box' },
      dummyStamp
    )
    expect(normalIssues.length).toBe(0)

    // 倾斜 15 度孔（应检出斜面钻入警告）
    const slantedCav: CavityInstance = createTestCavity({
      instanceId: 'slanted',
      templateId: 'c1',
      name: '斜孔',
      faceId: 'top',
      u: 50,
      v: 50,
      tiltAngle: 15,
      steps: [{ type: 'straight', diameter: 10, length: 30 }]
    })
    const geom = buildAnalyzedCavityGeometry(slantedCav, [100, 100, 100])
    const issues = evaluateSlantedOrEdgeEntrance(
      geom,
      [100, 100, 100],
      { template: 'box' },
      dummyStamp
    )
    expect(issues.length).toBe(1)
    expect(issues[0].ruleId).toBe('MFG-002')
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].messageArgs.angle).toBe('15.0')
    expect(issues[0].requirements[0].upperBound).toBe(5)

    // 边缘跨越孔（u=3，半径 5，跨越基体边缘）
    const edgeCav: CavityInstance = createTestCavity({
      instanceId: 'edge',
      templateId: 'c1',
      name: '边缘孔',
      faceId: 'top',
      u: 3,
      v: 50,
      tiltAngle: 0,
      steps: [{ type: 'straight', diameter: 10, length: 30 }]
    })
    const edgeGeom = buildAnalyzedCavityGeometry(edgeCav, [100, 100, 100])
    const edgeIssues = evaluateSlantedOrEdgeEntrance(
      edgeGeom,
      [100, 100, 100],
      { template: 'box' },
      dummyStamp
    )
    expect(edgeIssues.length).toBe(1)
    expect(edgeIssues[0].ruleId).toBe('MFG-002')
    expect(edgeIssues[0].messageKey).toBe('cross_edge_drilling_risk')
  })

  it('MFG-003: evaluates depth-to-diameter ratio with user threshold', () => {
    // 孔深 80，直径 5，L/D = 16
    const deepCav: CavityInstance = createTestCavity({
      instanceId: 'deep',
      templateId: 'c1',
      name: '细长深孔',
      faceId: 'top',
      u: 50,
      v: 50,
      steps: [{ type: 'straight', diameter: 5, length: 80 }]
    })
    const geom = buildAnalyzedCavityGeometry(deepCav, [100, 100, 100])

    // 未设上限时：静默跳过 (PRD §7.4)
    const emptyConfig = { ...DEFAULT_CHECK_CONFIG, maxDepthDiameterRatio: null }
    expect(evaluateDepthDiameterRatio(geom, emptyConfig, dummyStamp).length).toBe(0)

    // 上限 10 时：16 > 10，报警告
    const strictConfig = { ...DEFAULT_CHECK_CONFIG, maxDepthDiameterRatio: 10 }
    const issues = evaluateDepthDiameterRatio(geom, strictConfig, dummyStamp)
    expect(issues.length).toBe(1)
    expect(issues[0].ruleId).toBe('MFG-003')
    expect(issues[0].measurements[0].value).toBe(16)

    // 上限 20 时：16 <= 20，不报警告
    const looseConfig = { ...DEFAULT_CHECK_CONFIG, maxDepthDiameterRatio: 20 }
    expect(evaluateDepthDiameterRatio(geom, looseConfig, dummyStamp).length).toBe(0)
  })

  it('MFG-004: detects cross-drilling interrupted cutting risk', () => {
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'c1',
      templateId: 'cav-1',
      name: '主孔',
      faceId: 'top',
      u: 50,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 60 }]
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'c2',
      templateId: 'cav-2',
      name: '横跨孔',
      faceId: 'front',
      u: 50,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 60 }]
    })
    const geom1 = buildAnalyzedCavityGeometry(cav1, [100, 100, 100])
    const geom2 = buildAnalyzedCavityGeometry(cav2, [100, 100, 100])

    const issues = evaluateCrossDrillingInterruption(geom1, geom2, dummyStamp)
    expect(issues.length).toBe(1)
    expect(issues[0].ruleId).toBe('MFG-004')
    expect(issues[0].severity).toBe('warning')
  })
})
