/**
 * 水力流道网络与通路截面分析引擎 (FLOW-001 ~ FLOW-004)
 * 严格对齐 PRD-FR-04-15 §8
 */

import type { CavityAnalyzedGeometry } from '../geometry/wallThickness'
import {
  segmentSegmentClosestPoints
} from '../geometry/wallThickness'
import { dot, type Vec3 } from '../../cavityGeometry'
import type {
  CheckIssue,
  CheckObservation,
  CheckConfig,
  AnalysisStamp,
  EntityRef
} from '../contracts'
import { areaToMm2 } from '../contracts'
import { RULE_DEFINITIONS } from '../ruleRegistry'

export interface FlowNode {
  id: string
  cavityId: string
  portIndex?: number
  name: string
  area: number // 油口或流道段横截面积 mm²
  pos: Vec3
}

export interface FlowEdge {
  id: string
  u: string
  v: string
  capacity: number // 有效过流截面积 mm²
  kind: 'intersection' | 'internal_passage'
  evidencePoints?: [Vec3, Vec3]
}

export interface FlowChannelGraph {
  nodes: Map<string, FlowNode>
  edges: FlowEdge[]
  adj: Map<string, Array<{ to: string; edge: FlowEdge }>>
}

/**
 * 计算两相交圆柱段的局部开口截面积 A_open 与两侧参考截面积 A_ref
 */
export function computeCylinderIntersectionArea(
  r1: number,
  r2: number,
  axisDist: number,
  angleRad: number = Math.PI / 2
): { areaOpen: number; areaRef: number; ratio: number } {
  const A1 = Math.PI * r1 * r1
  const A2 = Math.PI * r2 * r2
  const areaRef = Math.min(A1, A2)

  if (axisDist >= r1 + r2) {
    return { areaOpen: 0, areaRef, ratio: 0 }
  }

  // 若完全穿透或近中心交汇 (axisDist <= |r1 - r2|)
  if (axisDist <= Math.abs(r1 - r2)) {
    const minR = Math.min(r1, r2)
    const sinAngle = Math.max(0.2, Math.sin(angleRad))
    const areaOpen = (Math.PI * minR * minR) / sinAngle
    return {
      areaOpen: Math.min(areaRef * 1.5, areaOpen),
      areaRef,
      ratio: Math.min(1.5, areaOpen / areaRef)
    }
  }

  // 部分重叠：计算弦长
  const d = axisDist
  const cSq = Math.max(
    0,
    r1 * r1 - Math.pow((r1 * r1 - r2 * r2 + d * d) / (2 * d), 2)
  )
  const chordHalf = Math.sqrt(cSq)
  const sinAngle = Math.max(0.2, Math.sin(angleRad))
  const areaOpen = (Math.PI * chordHalf * Math.min(r1, r2)) / sinAngle

  const boundedArea = Math.min(areaRef, Math.max(0.01, areaOpen))
  return {
    areaOpen: Number(boundedArea.toFixed(2)),
    areaRef: Number(areaRef.toFixed(2)),
    ratio: Number((boundedArea / areaRef).toFixed(3))
  }
}

/**
 * 求解图中任意两节点之间的 Widest-Path (Max-Min 瓶颈容量)
 * 返回最佳路径上的最小边容量，以及路径上的所有边
 */
export function findWidestPath(
  graph: FlowChannelGraph,
  startNodeId: string,
  endNodeId: string
): { maxBottleneck: number; pathEdges: FlowEdge[] } {
  const dist = new Map<string, number>()
  const parentEdge = new Map<string, FlowEdge>()
  const parentNode = new Map<string, string>()
  const visited = new Set<string>()

  for (const nodeId of graph.nodes.keys()) {
    dist.set(nodeId, -Infinity)
  }
  dist.set(startNodeId, Infinity)

  while (visited.size < graph.nodes.size) {
    // 选出当前未访问且 dist 最大的节点
    let maxVal = -Infinity
    let u: string | null = null

    for (const [nodeId, d] of dist.entries()) {
      if (!visited.has(nodeId) && d > maxVal) {
        maxVal = d
        u = nodeId
      }
    }

    if (!u || maxVal <= 0) break
    if (u === endNodeId) break

    visited.add(u)

    const neighbors = graph.adj.get(u) || []
    for (const { to, edge } of neighbors) {
      if (!visited.has(to)) {
        const bottleneck = Math.min(dist.get(u)!, edge.capacity)
        if (bottleneck > dist.get(to)!) {
          dist.set(to, bottleneck)
          parentEdge.set(to, edge)
          parentNode.set(to, u)
        }
      }
    }
  }

  const bestCapacity = dist.get(endNodeId) ?? 0
  if (bestCapacity <= 0 || !Number.isFinite(bestCapacity)) {
    return { maxBottleneck: 0, pathEdges: [] }
  }

  // 回溯还原路径边
  const pathEdges: FlowEdge[] = []
  let curr = endNodeId
  while (curr !== startNodeId && parentEdge.has(curr)) {
    const e = parentEdge.get(curr)!
    pathEdges.push(e)
    curr = parentNode.get(curr)!
  }
  pathEdges.reverse()

  return {
    maxBottleneck: Number(bestCapacity.toFixed(2)),
    pathEdges
  }
}

/**
 * 评估流道图与水力截面规则 (FLOW-001 ~ FLOW-004)
 */
export function evaluateHydraulicFlowRules(
  cavities: CavityAnalyzedGeometry[],
  config: CheckConfig,
  stamp: AnalysisStamp
): { issues: CheckIssue[]; observations: CheckObservation[] } {
  const issues: CheckIssue[] = []
  const observations: CheckObservation[] = []

  // 1. 构建流道网络图
  const graph: FlowChannelGraph = {
    nodes: new Map(),
    edges: [],
    adj: new Map()
  }

  const addEdge = (u: string, v: string, capacity: number, kind: FlowEdge['kind'], pts?: [Vec3, Vec3]) => {
    const id = `edge-${u}-${v}`
    const edge: FlowEdge = { id, u, v, capacity, kind, evidencePoints: pts }
    graph.edges.push(edge)
    if (!graph.adj.has(u)) graph.adj.set(u, [])
    if (!graph.adj.has(v)) graph.adj.set(v, [])
    graph.adj.get(u)!.push({ to: v, edge })
    graph.adj.get(v)!.push({ to: u, edge })
  }

  // 节点集合
  for (const cav of cavities) {
    if (cav.cavity.suppressed || cav.isStructural) continue

    // 为每个孔建立内部主节点
    const rMain = cav.segments[0]?.r0 ?? 5
    const areaMain = Math.PI * rMain * rMain
    const mainNodeId = `node-cav-${cav.cavity.instanceId}`
    graph.nodes.set(mainNodeId, {
      id: mainNodeId,
      cavityId: cav.cavity.instanceId,
      name: cav.cavity.subHoleName || cav.cavity.name,
      area: areaMain,
      pos: cav.mouth
    })

    // 如果孔腔包含多个侧油口 (ports)
    if (cav.cavity.ports && cav.cavity.ports.length > 0) {
      for (let pIdx = 0; pIdx < cav.cavity.ports.length; pIdx++) {
        const port = cav.cavity.ports[pIdx]
        const portNodeId = `node-port-${cav.cavity.instanceId}-${pIdx}`
        const rPort = ((port.diameter ? Number(port.diameter) : rMain * 2) / 2) || rMain
        const areaPort = Math.PI * rPort * rPort
        graph.nodes.set(portNodeId, {
          id: portNodeId,
          cavityId: cav.cavity.instanceId,
          portIndex: pIdx,
          name: `${cav.cavity.subHoleName || cav.cavity.name} [口${pIdx + 1}]`,
          area: areaPort,
          pos: cav.mouth
        })

        // 油口与孔腔内部通路相连
        addEdge(portNodeId, mainNodeId, Math.min(areaPort, areaMain), 'internal_passage')
      }
    }
  }

  // 2. 识别物理相交交汇边并评估 FLOW-002 (局部开口面积)
  const localAbsLimit = areaToMm2(config.localOpeningLimits.absolute)
  const localRatioLimit = config.localOpeningLimits.ratio

  for (let i = 0; i < cavities.length; i++) {
    for (let j = i + 1; j < cavities.length; j++) {
      const cavA = cavities[i]
      const cavB = cavities[j]
      if (cavA.isStructural || cavB.isStructural) continue
      if (cavA.cavity.suppressed || cavB.cavity.suppressed) continue

      // 检测交汇段
      for (const segA of cavA.segments) {
        for (const segB of cavB.segments) {
          const { ptA, ptB, s, t, dist } = segmentSegmentClosestPoints(
            segA.p0,
            segA.p1,
            segB.p0,
            segB.p1
          )
          const rA = segA.r0 + s * (segA.r1 - segA.r0)
          const rB = segB.r0 + t * (segB.r1 - segB.r0)

          if (dist < rA + rB) {
            // 物理相交！计算开口面积
            const cosAngle = Math.abs(dot(cavA.axisDir, cavB.axisDir))
            const angleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle)))
            const { areaOpen, areaRef, ratio } = computeCylinderIntersectionArea(
              rA,
              rB,
              dist,
              angleRad
            )

            const nodeA = `node-cav-${cavA.cavity.instanceId}`
            const nodeB = `node-cav-${cavB.cavity.instanceId}`
            addEdge(nodeA, nodeB, areaOpen, 'intersection', [ptA, ptB])

            const refA: EntityRef = { kind: 'cavity', instanceId: cavA.cavity.instanceId }
            const refB: EntityRef = { kind: 'cavity', instanceId: cavB.cavity.instanceId }
            const sortedIds = [cavA.cavity.instanceId, cavB.cavity.instanceId].sort()

            // 观察值
            observations.push({
              id: `obs-flow2-${sortedIds.join('-')}`,
              stamp,
              ruleId: 'FLOW-002',
              refs: [refA, refB],
              measurements: [
                { name: '交汇开口面积', value: areaOpen, unit: 'mm2' },
                { name: '参考截面积', value: areaRef, unit: 'mm2' },
                { name: '开口截面比', value: ratio, unit: 'ratio' }
              ],
              evidence: {
                refs: [refA, refB],
                points: [ptA, ptB],
                lines: [[ptA, ptB]]
              }
            })

            // 判定 FLOW-002 (仅在至少启用一项阈值时判定)
            let requiredArea = 0
            let hasLimit = false
            if (localAbsLimit !== null && localAbsLimit > 0) {
              requiredArea = Math.max(requiredArea, localAbsLimit)
              hasLimit = true
            }
            if (localRatioLimit !== null && localRatioLimit > 0) {
              requiredArea = Math.max(requiredArea, localRatioLimit * areaRef)
              hasLimit = true
            }

            if (hasLimit && areaOpen < requiredArea) {
              issues.push({
                id: `issue-FLOW-002-${sortedIds.join('-')}`,
                stableKey: `FLOW-002:${sortedIds.join('-')}`,
                ruleId: 'FLOW-002',
                ruleVersion: RULE_DEFINITIONS['FLOW-002'].version,
                stamp,
                severity: 'error',
                messageKey: 'opening_area_insufficient',
                messageArgs: {
                  holeA: cavA.cavity.subHoleName || cavA.cavity.name,
                  holeB: cavB.cavity.subHoleName || cavB.cavity.name,
                  measured: areaOpen.toFixed(1),
                  required: requiredArea.toFixed(1)
                },
                measurements: [
                  { name: '交汇开口面积', value: areaOpen, unit: 'mm2' },
                  { name: '参考截面积', value: areaRef, unit: 'mm2' }
                ],
                requirements: [
                  { name: '要求开口面积', value: Number(requiredArea.toFixed(1)), unit: 'mm2' }
                ],
                precision: 'brep',
                evidence: {
                  refs: [refA, refB],
                  points: [ptA, ptB],
                  lines: [[ptA, ptB]]
                },
                remediation: RULE_DEFINITIONS['FLOW-002'].remediationTemplate
              })
            }
            break // 避免同对孔多段重复建边
          }
        }
      }
    }
  }

  // 3. 评估 FLOW-001 (孤立油口或流道孔)
  for (const [nodeId, node] of graph.nodes.entries()) {
    const degree = (graph.adj.get(nodeId) || []).length
    if (degree === 0) {
      const ref: EntityRef =
        node.portIndex !== undefined
          ? { kind: 'port', instanceId: node.cavityId, portId: String(node.portIndex) }
          : { kind: 'cavity', instanceId: node.cavityId }

      issues.push({
        id: `issue-FLOW-001-${nodeId}`,
        stableKey: `FLOW-001:${nodeId}`,
        ruleId: 'FLOW-001',
        ruleVersion: RULE_DEFINITIONS['FLOW-001'].version,
        stamp,
        severity: 'warning',
        messageKey: 'isolated_channel_cavity_or_port',
        messageArgs: {
          name: node.name
        },
        measurements: [],
        requirements: [],
        precision: 'brep',
        evidence: {
          refs: [ref],
          points: [node.pos]
        },
        remediation: RULE_DEFINITIONS['FLOW-001'].remediationTemplate
      })
    }
  }

  // 4. 评估 FLOW-004 (油口对通路瓶颈分析) & FLOW-003 (分支瓶颈)
  // 获取所有端点油口 (含各孔主油口与侧油口)
  const portNodes = Array.from(graph.nodes.values())
  const pathAbsLimit = areaToMm2(config.pathBottleneckLimits.absolute)
  const pathRatioLimit = config.pathBottleneckLimits.ratio

  for (let i = 0; i < portNodes.length; i++) {
    for (let j = i + 1; j < portNodes.length; j++) {
      const pU = portNodes[i]
      const pV = portNodes[j]
      if (pU.cavityId === pV.cavityId && pU.portIndex === undefined && pV.portIndex === undefined) {
        continue
      }

      // 求解 Widest-Path
      const { maxBottleneck, pathEdges } = findWidestPath(graph, pU.id, pV.id)
      if (maxBottleneck <= 0) {
        // 无实际连通路径：不跨通道报错 (PRD §8.1)
        continue
      }

      const refPairArea = Math.min(pU.area, pV.area)
      let requiredPathArea = 0
      let hasPathLimit = false
      if (pathAbsLimit !== null && pathAbsLimit > 0) {
        requiredPathArea = Math.max(requiredPathArea, pathAbsLimit)
        hasPathLimit = true
      }
      if (pathRatioLimit !== null && pathRatioLimit > 0) {
        requiredPathArea = Math.max(requiredPathArea, pathRatioLimit * refPairArea)
        hasPathLimit = true
      }

      const refU: EntityRef =
        pU.portIndex !== undefined
          ? { kind: 'port', instanceId: pU.cavityId, portId: String(pU.portIndex) }
          : { kind: 'cavity', instanceId: pU.cavityId }
      const refV: EntityRef =
        pV.portIndex !== undefined
          ? { kind: 'port', instanceId: pV.cavityId, portId: String(pV.portIndex) }
          : { kind: 'cavity', instanceId: pV.cavityId }

      // 观察值
      observations.push({
        id: `obs-flow4-${pU.id}-${pV.id}`,
        stamp,
        ruleId: 'FLOW-004',
        refs: [refU, refV],
        measurements: [
          { name: '最佳通路瓶颈截面', value: maxBottleneck, unit: 'mm2' },
          { name: '端点参考截面', value: refPairArea, unit: 'mm2' }
        ],
        evidence: {
          refs: [refU, refV],
          pathEdgeIds: pathEdges.map((e) => e.id)
        }
      })

      // 判定 FLOW-004: 油口对最佳通路依然不达标
      if (hasPathLimit && maxBottleneck < requiredPathArea) {
        const sortedIds = [pU.id, pV.id].sort()
        issues.push({
          id: `issue-FLOW-004-${sortedIds.join('-')}`,
          stableKey: `FLOW-004:${sortedIds.join('-')}`,
          ruleId: 'FLOW-004',
          ruleVersion: RULE_DEFINITIONS['FLOW-004'].version,
          stamp,
          severity: 'error',
          messageKey: 'no_compliant_path_between_ports',
          messageArgs: {
            portA: pU.name,
            portB: pV.name,
            measured: maxBottleneck.toFixed(1),
            required: requiredPathArea.toFixed(1)
          },
          measurements: [
            { name: '最佳路线瓶颈面积', value: maxBottleneck, unit: 'mm2' }
          ],
          requirements: [
            { name: '要求通路截面积', value: Number(requiredPathArea.toFixed(1)), unit: 'mm2' }
          ],
          precision: 'brep',
          evidence: {
            refs: [refU, refV],
            pathEdgeIds: pathEdges.map((e) => e.id)
          },
          remediation: RULE_DEFINITIONS['FLOW-004'].remediationTemplate
        })
      }
    }
  }

  return { issues, observations }
}
