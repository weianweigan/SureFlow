import { describe, it, expect } from 'vitest'
import type { CavityInstance } from '../../types'
import { createTestCavity } from './testUtils'
import {
  computeActiveClearance,
  computeMultipleActiveClearances,
  computeHoleToHoleClearance,
  computeHoleToFaceClearance,
  computeFaceToFaceClearance
} from '../geometry/activeClearance'
import { buildAnalyzedCavityGeometry } from '../geometry/wallThickness'
import { STANDARD_BOX_FACES } from '../../types'

describe('Active Clearance Analysis (FR-04-15-063)', () => {
  it('hole-to-hole: accurately determines separated clearance and contact', () => {
    const cav1: CavityInstance = createTestCavity({
      instanceId: 'c1',
      templateId: 'cavity-1',
      name: '孔 1',
      faceId: 'top',
      u: 30,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 40 }] // r=5
    })
    const cav2: CavityInstance = createTestCavity({
      instanceId: 'c2',
      templateId: 'cavity-2',
      name: '孔 2',
      faceId: 'top',
      u: 50,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 40 }] // r=5
    })

    const g1 = buildAnalyzedCavityGeometry(cav1, [100, 100, 100])
    const g2 = buildAnalyzedCavityGeometry(cav2, [100, 100, 100])

    // 轴线距离 = 20, 实体净距 = 20 - (5 + 5) = 10 mm
    const res1 = computeHoleToHoleClearance(g1, g2)
    expect(res1.relation).toBe('separated')
    expect(res1.dist).toBeCloseTo(10, 1)

    // 相切接触 (轴线距离 = 10, 净距 = 0)
    const cavContact: CavityInstance = {
      ...cav2,
      u: 40
    }
    const gContact = buildAnalyzedCavityGeometry(cavContact, [100, 100, 100])
    const resContact = computeHoleToHoleClearance(g1, gContact)
    expect(resContact.relation).toBe('contacting')
    expect(resContact.dist).toBe(0)

    // 相交 (轴线距离 = 8 < 10)
    const cavInter: CavityInstance = {
      ...cav2,
      u: 38
    }
    const gInter = buildAnalyzedCavityGeometry(cavInter, [100, 100, 100])
    const resInter = computeHoleToHoleClearance(g1, gInter)
    expect(resInter.relation).toBe('intersecting')
    expect(resInter.dist).toBe(0)
  })

  it('hole-to-face: accurately determines distance and mouth contact', () => {
    const cav: CavityInstance = createTestCavity({
      instanceId: 'c1',
      templateId: 'cavity-1',
      name: '孔 1',
      faceId: 'top',
      u: 20,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 40 }]
    })
    const geom = buildAnalyzedCavityGeometry(cav, [100, 100, 100])

    // 孔安装在 top 面，孔口在 top 面上，应判定为接触 (contacting, 0mm)
    const topFace = STANDARD_BOX_FACES.find((f) => f.id === 'top')!
    const resTop = computeHoleToFaceClearance(geom, topFace, [100, 100, 100])
    expect(resTop.relation).toBe('contacting')
    expect(resTop.dist).toBe(0)

    // 孔到 left 面 (x=0)：中心在 x=20，半径 5，距离 = 15 mm
    const leftFace = STANDARD_BOX_FACES.find((f) => f.id === 'left')!
    const resLeft = computeHoleToFaceClearance(geom, leftFace, [100, 100, 100])
    expect(resLeft.relation).toBe('separated')
    expect(resLeft.dist).toBeCloseTo(15, 1)
  })

  it('face-to-face: computes parallel distance and adjacent orthogonal faces', () => {
    const topFace = STANDARD_BOX_FACES.find((f) => f.id === 'top')!
    const bottomFace = STANDARD_BOX_FACES.find((f) => f.id === 'bottom')!
    const leftFace = STANDARD_BOX_FACES.find((f) => f.id === 'left')!

    // top 到 bottom (高度 100mm)
    const resOpposite = computeFaceToFaceClearance(topFace, bottomFace, [100, 100, 100])
    expect(resOpposite.relation).toBe('separated')
    expect(resOpposite.dist).toBe(100)

    // top 到 left（正交相交接触棱边）
    const resAdj = computeFaceToFaceClearance(topFace, leftFace, [100, 100, 100])
    expect(resAdj.relation).toBe('contacting')
    expect(resAdj.dist).toBe(0)
  })

  it('computeActiveClearance: end-to-end interface returns correct structure', () => {
    const cav: CavityInstance = createTestCavity({
      instanceId: 'cav-test',
      templateId: 'cavity-1',
      name: '测试孔',
      faceId: 'top',
      u: 50,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 30 }]
    })
    const geom = buildAnalyzedCavityGeometry(cav, [100, 100, 100])

    const res = computeActiveClearance(
      { kind: 'cavity', instanceId: 'cav-test' },
      { kind: 'base-face', faceId: 'bottom' },
      [geom],
      [100, 100, 100],
      { template: 'box' }
    )

    expect(res.objectAName).toBe('测试孔')
    expect(res.unit).toBe('mm')
    // 孔深 30，总高 100，到底面净距 = 70 mm
    expect(res.dist).toBeCloseTo(70, 1)
    expect(res.relation).toBe('separated')
  })

  it('computeMultipleActiveClearances: calculates all pairwise combinations for multiple holes and faces', () => {
    const cavA = createTestCavity({
      instanceId: 'cA',
      templateId: 'cav-a',
      name: '孔 A',
      faceId: 'top',
      u: 20,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 30 }] // r=5
    })
    const cavB = createTestCavity({
      instanceId: 'cB',
      templateId: 'cav-b',
      name: '孔 B',
      faceId: 'top',
      u: 40,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 30 }] // r=5
    })
    const cavC = createTestCavity({
      instanceId: 'cC',
      templateId: 'cav-c',
      name: '孔 C',
      faceId: 'top',
      u: 70,
      v: 50,
      steps: [{ type: 'straight', diameter: 10, length: 30 }] // r=5
    })

    const geoms = [
      buildAnalyzedCavityGeometry(cavA, [100, 100, 100]),
      buildAnalyzedCavityGeometry(cavB, [100, 100, 100]),
      buildAnalyzedCavityGeometry(cavC, [100, 100, 100])
    ]

    // 1. 三个孔腔互检 -> 3 组两两间隙 (A-B, A-C, B-C)
    const results3Holes = computeMultipleActiveClearances(
      [
        { kind: 'cavity', instanceId: 'cA' },
        { kind: 'cavity', instanceId: 'cB' },
        { kind: 'cavity', instanceId: 'cC' }
      ],
      geoms,
      [100, 100, 100],
      { template: 'box' }
    )

    expect(results3Holes.length).toBe(3)
    // A-B: 轴线距离 20, 净距 10 mm
    expect(results3Holes[0].dist).toBeCloseTo(10, 1)
    // A-C: 轴线距离 50, 净距 40 mm
    expect(results3Holes[1].dist).toBeCloseTo(40, 1)
    // B-C: 轴线距离 30, 净距 20 mm
    expect(results3Holes[2].dist).toBeCloseTo(20, 1)

    // 2. 混合选择：2个孔腔 + 1个面 -> 3 组 (cA-cB, cA-face, cB-face)
    const resultsMixed = computeMultipleActiveClearances(
      [
        { kind: 'cavity', instanceId: 'cA' },
        { kind: 'cavity', instanceId: 'cB' },
        { kind: 'base-face', faceId: 'bottom' }
      ],
      geoms,
      [100, 100, 100],
      { template: 'box' }
    )

    expect(resultsMixed.length).toBe(3)
    // cA - cB: 10 mm
    expect(resultsMixed[0].dist).toBeCloseTo(10, 1)
    // cA - bottom: 100 - 30 = 70 mm
    expect(resultsMixed[1].dist).toBeCloseTo(70, 1)
    // cB - bottom: 100 - 30 = 70 mm
    expect(resultsMixed[2].dist).toBeCloseTo(70, 1)

    // 3. 少于 2 个对象返回空数组
    expect(computeMultipleActiveClearances([], geoms, [100, 100, 100], {})).toEqual([])
    expect(
      computeMultipleActiveClearances(
        [{ kind: 'cavity', instanceId: 'cA' }],
        geoms,
        [100, 100, 100],
        {}
      )
    ).toEqual([])
  })
})

