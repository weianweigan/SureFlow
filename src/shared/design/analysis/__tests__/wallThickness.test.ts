import { describe, it, expect } from 'vitest'
import type { CavityInstance } from '../../types'
import { createTestCavity } from './testUtils'
import { DEFAULT_CHECK_CONFIG, type AnalysisStamp } from '../contracts'
import {
  buildAnalyzedCavityGeometry,
  evaluateHoleToHoleWallThickness,
  evaluateHoleToOuterWallThickness
} from '../geometry/wallThickness'

const dummyStamp: AnalysisStamp = {
  sessionId: 'test-session',
  requestId: 'req-1',
  projectId: 'test-project',
  schemeId: 'scheme-1',
  modelRevision: 1,
  configRevision: 1,
  resourceRevision: 1,
  ruleSetVersion: '1.0.0',
  geometryPolicyVersion: '1.0.0'
}

describe('Wall Thickness Analysis (CLR-001 & CLR-002)', () => {
  it('CLR-001: correctly computes analytical residual wall thickness between separated parallel holes', () => {
    // 两个平行于 Z 轴的孔 (faceId: top)，中心在 [20, 20] 和 [20, 32]
    // 直径均为 8 (半径 4)
    // 轴线距离 = 12, 理论壁厚 = 12 - (4 + 4) = 4 mm
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'cav-1',
      templateId: 'cavity-m10',
      name: '孔 1',
      faceId: 'top',
      u: 20,
      v: 20,
      steps: [{ type: 'straight', diameter: 8, length: 40 }]
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'cav-2',
      templateId: 'cavity-m10',
      name: '孔 2',
      faceId: 'top',
      u: 20,
      v: 32,
      steps: [{ type: 'straight', diameter: 8, length: 40 }]
    })

    const geom1 = buildAnalyzedCavityGeometry(cav1, [100, 100, 100])
    const geom2 = buildAnalyzedCavityGeometry(cav2, [100, 100, 100])

    // 默认阈值 5mm：实测 4mm < 5mm，应报告 CLR-001 错误
    const res = evaluateHoleToHoleWallThickness(geom1, geom2, DEFAULT_CHECK_CONFIG, dummyStamp)
    expect(res.issues.length).toBe(1)
    expect(res.issues[0].ruleId).toBe('CLR-001')
    expect(res.issues[0].severity).toBe('error')
    expect(res.issues[0].measurements[0].value).toBe(4)

    // 若配置允许壁厚 3mm：4mm >= 3mm，不应报告错误
    const customConfig = {
      ...DEFAULT_CHECK_CONFIG,
      minHoleWall: { value: 3, unit: 'mm' as const }
    }
    const resPass = evaluateHoleToHoleWallThickness(geom1, geom2, customConfig, dummyStamp)
    expect(resPass.issues.length).toBe(0)
    // 但应在观察值中保留实测 4mm
    expect(resPass.observations.length).toBe(1)
    expect(resPass.observations[0].measurements[0].value).toBe(4)
  })

  it('CLR-001: handles intersecting holes without reporting zero-wall error on the intersection opening', () => {
    // 两个正交相交孔
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'cav-1',
      templateId: 'cavity-m10',
      name: '竖孔',
      faceId: 'top',
      u: 50,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 60 }]
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'cav-2',
      templateId: 'cavity-m10',
      name: '横孔',
      faceId: 'front',
      u: 50,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 60 }]
    })

    const geom1 = buildAnalyzedCavityGeometry(cav1, [100, 100, 100])
    const geom2 = buildAnalyzedCavityGeometry(cav2, [100, 100, 100])

    // 相交孔在交汇处物理穿透，CLR-001 不应对交汇开口报壁厚为0错误
    const res = evaluateHoleToHoleWallThickness(geom1, geom2, DEFAULT_CHECK_CONFIG, dummyStamp)
    expect(res.issues.length).toBe(0)
  })

  it('CLR-002: detects thin wall between cavity and finite exterior base faces', () => {
    // 位于 top 面中心靠近 left 面 (u: 6, v: 50)，直径 8 (半径 4)
    // 到 left 面 (x=0) 的距离: 6 - 4 = 2 mm
    // 默认阈值 5 mm -> 应报 CLR-002 错误
    const cav: CavityInstance = createTestCavity({
      instanceId: 'cav-near-wall',
      templateId: 'cavity-m10',
      name: '靠边孔',
      faceId: 'top',
      u: 6,
      v: 50,
      steps: [{ type: 'straight', diameter: 8, length: 30 }]
    })

    const geom = buildAnalyzedCavityGeometry(cav, [100, 100, 100])
    const res = evaluateHoleToOuterWallThickness(
      geom,
      [100, 100, 100],
      { template: 'box' },
      DEFAULT_CHECK_CONFIG,
      dummyStamp
    )

    // 应检测到离 left 面只有 2mm 的薄壁
    const leftIssue = res.issues.find((i) => i.stableKey.includes('left'))
    expect(leftIssue).toBeDefined()
    expect(leftIssue?.severity).toBe('error')
    expect(leftIssue?.measurements[0].value).toBe(2)
  })

  it('CLR-002: hole with drill point cone tip correctly measures from cone tip to bottom face', () => {
    // 位于 top 面中心 (u: 50, v: 50)，打入深 90mm 直孔 + 10mm 直径的 118° 钻尖 (tip 长度 ~3.004mm)
    // 锥顶实际深度约为 93.004mm，离 bottom 面 (y=0) 的净距约为 100 - 93.004 = 6.996mm
    // 证据线起始端点必须精确为锥尖，而不是沿轴线偏移或圆柱母线
    const cav: CavityInstance = createTestCavity({
      instanceId: 'cav-cone-tip',
      templateId: 'cavity-m10',
      name: '钻尖深孔',
      faceId: 'top',
      u: 50,
      v: 50,
      steps: [
        { type: 'straight', diameter: 10, length: 90 },
        { type: 'tapered', diameter: 10, length: null, angle: 118 }
      ]
    })

    const geom = buildAnalyzedCavityGeometry(cav, [100, 100, 100])
    const res = evaluateHoleToOuterWallThickness(
      geom,
      [100, 100, 100],
      { template: 'box' },
      DEFAULT_CHECK_CONFIG,
      dummyStamp
    )

    const bottomObs = res.observations.find((o) => o.refs.some((r) => r.kind === 'base-face' && r.faceId === 'bottom'))
    expect(bottomObs).toBeDefined()
    // 验证实测距离为 7.00mm (6.996 舍入到 2 位小数)
    expect(bottomObs?.measurements[0].value).toBe(7)
    // 验证端点最佳点正是锥尖 (x=50, z=50, y约为 6.996)
    const ptCav = bottomObs?.evidence?.lines?.[0]?.[0]
    expect(ptCav).toBeDefined()
    expect(ptCav![0]).toBeCloseTo(50, 1)
    expect(ptCav![1]).toBeCloseTo(50, 1)
    expect(ptCav![2]).toBeCloseTo(6.996, 2)
  })
})
