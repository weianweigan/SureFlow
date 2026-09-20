import { describe, it, expect } from 'vitest'
import type { CavityInstance } from '../../types'
import { createTestCavity } from './testUtils'
import { buildAnalyzedCavityGeometry } from '../geometry/wallThickness'
import {
  evaluateHydraulicFlowRules,
  computeCylinderIntersectionArea,
  findWidestPath,
  type FlowChannelGraph
} from '../flowGraph/flowGraphBuilder'
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

describe('Flow Network and Hydraulic Area Rules (FLOW-001 ~ FLOW-004)', () => {
  it('FLOW-001: flags isolated flow cavity, but exempts structural bolt/pin holes', () => {
    const isolatedFlowCav: CavityInstance = createTestCavity({
      instanceId: 'flow-isolated',
      templateId: 'c1',
      name: '油口 P',
      faceId: 'top',
      u: 20,
      v: 20,
      steps: [{ type: 'straight', diameter: 10, length: 20 }]
    })
    const boltHole: CavityInstance = createTestCavity({
      instanceId: 'bolt-hole',
      templateId: 'bolt',
      name: '紧固螺栓孔 M8',
      cavityType: 'bolt-hole',
      faceId: 'top',
      u: 80,
      v: 80,
      steps: [{ type: 'straight', diameter: 8.5, length: 25 }]
    })

    const geomFlow = buildAnalyzedCavityGeometry(isolatedFlowCav, [100, 100, 100])
    const geomBolt = buildAnalyzedCavityGeometry(boltHole, [100, 100, 100])

    const res = evaluateHydraulicFlowRules([geomFlow, geomBolt], DEFAULT_CHECK_CONFIG, dummyStamp)
    const isolatedIssues = res.issues.filter((i) => i.ruleId === 'FLOW-001')

    // 只有流道孔报孤立警告，结构孔不报
    expect(isolatedIssues.length).toBe(1)
    expect(isolatedIssues[0].messageArgs.name).toContain('油口 P')
  })

  it('FLOW-002: opening area calculation is symmetric under hole order and computes accurate area and ratio', () => {
    // 两个垂直相交圆柱，r1=5 (D=10), r2=4 (D=8)，中心距 2
    const resA = computeCylinderIntersectionArea(5, 4, 2, Math.PI / 2)
    const resB = computeCylinderIntersectionArea(4, 5, 2, Math.PI / 2)

    // 交换次序结果必须严格一致 (PRD §8.2 技术验证项 T1)
    expect(resA.areaOpen).toBe(resB.areaOpen)
    expect(resA.areaRef).toBe(resB.areaRef)
    expect(resA.ratio).toBe(resB.ratio)
    expect(resA.areaOpen).toBeGreaterThan(0)
  })

  it('widest-path algorithm: correctly computes max-min bottleneck capacity and reconstructs edges', () => {
    // 构造测试图：
    // A -> B (capacity 10) -> C (capacity 8) => path 1 bottleneck = 8
    // A -> D (capacity 20) -> C (capacity 15) => path 2 bottleneck = 15
    // 最宽路径应选择路径 2，瓶颈容量为 15
    const graph: FlowChannelGraph = {
      nodes: new Map([
        ['A', { id: 'A', cavityId: 'c1', name: 'A', area: 50, pos: [0, 0, 0] }],
        ['B', { id: 'B', cavityId: 'c2', name: 'B', area: 50, pos: [1, 0, 0] }],
        ['C', { id: 'C', cavityId: 'c3', name: 'C', area: 50, pos: [2, 0, 0] }],
        ['D', { id: 'D', cavityId: 'c4', name: 'D', area: 50, pos: [1, 1, 0] }]
      ]),
      edges: [
        { id: 'e1', u: 'A', v: 'B', capacity: 10, kind: 'internal_passage' },
        { id: 'e2', u: 'B', v: 'C', capacity: 8, kind: 'internal_passage' },
        { id: 'e3', u: 'A', v: 'D', capacity: 20, kind: 'internal_passage' },
        { id: 'e4', u: 'D', v: 'C', capacity: 15, kind: 'internal_passage' }
      ],
      adj: new Map([
        ['A', [{ to: 'B', edge: { id: 'e1', u: 'A', v: 'B', capacity: 10, kind: 'internal_passage' } }, { to: 'D', edge: { id: 'e3', u: 'A', v: 'D', capacity: 20, kind: 'internal_passage' } }]],
        ['B', [{ to: 'C', edge: { id: 'e2', u: 'B', v: 'C', capacity: 8, kind: 'internal_passage' } }]],
        ['D', [{ to: 'C', edge: { id: 'e4', u: 'D', v: 'C', capacity: 15, kind: 'internal_passage' } }]],
        ['C', []]
      ])
    }

    const { maxBottleneck, pathEdges } = findWidestPath(graph, 'A', 'C')
    expect(maxBottleneck).toBe(15)
    expect(pathEdges.map((e) => e.id)).toEqual(['e3', 'e4'])
  })

  it('FLOW-004: when at least one parallel route meets requirement, no pair error is reported', () => {
    // 两个相交孔构成通道：
    // cav1 (D=10) 与 cav2 (D=10) 正交相交 (交汇开口约 78mm²)
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'c1',
      templateId: 'cavity-1',
      name: '进油孔',
      faceId: 'top',
      u: 50,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 60 }]
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'c2',
      templateId: 'cavity-2',
      name: '出油孔',
      faceId: 'front',
      u: 50,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 60 }]
    })
    const geom1 = buildAnalyzedCavityGeometry(cav1, [100, 100, 100])
    const geom2 = buildAnalyzedCavityGeometry(cav2, [100, 100, 100])

    // 配置绝对瓶颈下限 50 mm²：实测约 78mm² >= 50mm²，不应报 FLOW-004 错误
    const configOk = {
      ...DEFAULT_CHECK_CONFIG,
      pathBottleneckLimits: {
        absolute: { value: 50, unit: 'mm2' as const },
        ratio: null
      }
    }
    const resOk = evaluateHydraulicFlowRules([geom1, geom2], configOk, dummyStamp)
    expect(resOk.issues.filter((i) => i.ruleId === 'FLOW-004').length).toBe(0)

    // 配置过严下限 200 mm²：实测 78mm² < 200mm²，应报 FLOW-004 错误
    const configStrict = {
      ...DEFAULT_CHECK_CONFIG,
      pathBottleneckLimits: {
        absolute: { value: 200, unit: 'mm2' as const },
        ratio: null
      }
    }
    const resStrict = evaluateHydraulicFlowRules([geom1, geom2], configStrict, dummyStamp)
    const flow4 = resStrict.issues.filter((i) => i.ruleId === 'FLOW-004')
    expect(flow4.length).toBe(1)
    expect(flow4[0].severity).toBe('error')
  })
})
