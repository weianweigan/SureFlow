import { describe, it, expect, beforeAll } from 'vitest'
import manifoldModuleFactory from 'manifold-3d'
import { getBoxFaceBasis, getCavityWorldMatrix } from '../../faceMath'
import { buildCavityManifold } from '../../../../renderer/src/workspace/design/geometry/cavityProfileBuilder'
import { buildAnalyzedCavityGeometry, evaluateHoleToHoleWallThickness, evaluateHoleToOuterWallThickness } from '../geometry/wallThickness'
import { computeHoleToHoleClearance, computeHoleToFaceClearance, computeMultipleActiveClearances } from '../geometry/activeClearance'
import { validateMultipleActiveClearancesWithMinGap, validateIssuesWithMinGap } from '../geometry/minGapValidator'
import { DEFAULT_CHECK_CONFIG } from '../contracts'
import type { CavityInstance } from '../../types'
import type { Step } from '../../../cavity/types'

describe('Manifold minGap Ground Truth Validation Suite', () => {
  let mod: any
  let Manifold: any

  const dummyStamp: any = {
    runId: 'r1',
    timestamp: 0,
    schemeId: 's1',
    projectId: 'p1',
    sessionId: 'sess',
    requestId: 'req',
    modelRevision: 1,
    configRevision: 1,
    ruleRevisions: {}
  }

  beforeAll(async () => {
    mod = await (manifoldModuleFactory as any)()
    mod.setup()
    Manifold = mod.Manifold
  }, 60000)

  it('validates hole-to-face clearance against Manifold minGap', () => {
    const dims: [number, number, number] = [100, 100, 100]
    const steps: Step[] = [
      { type: 'straight', diameter: 10, length: 80, thread: null },
      { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
    ]

    // 位于 top 面中心向下钻
    const cav: CavityInstance = {
      instanceId: 'c1',
      name: 'Hole_Top',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'top',
      u: 50,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps
    }

    const basis = getBoxFaceBasis('top', dims)
    const mat = Array.from(getCavityWorldMatrix(basis, 50, 50, 0, 0))
    const cavM = buildCavityManifold({ Manifold }, steps, 64).transform(mat)

    // 底面外部 slab (z <= 0)
    const bottomFaceSlab = Manifold.cube([dims[0], dims[1], 10], false).translate([0, 0, -10])
    const minGapBottom = cavM.minGap(bottomFaceSlab, 50)

    // 解析几何结果
    const geom = buildAnalyzedCavityGeometry(cav, dims)
    const faceBottom = { id: 'bottom', normal: [0, 0, -1], origin: [0, 0, 0] } as any
    const clrBottom = computeHoleToFaceClearance(geom, faceBottom, dims)

    console.log('[Hole to Bottom Face] Manifold minGap:', minGapBottom, 'Analytical:', clrBottom.dist)
    console.log('[Hole to Bottom Face PtA]:', clrBottom.ptA, '[PtB]:', clrBottom.ptB)

    // 锥顶深度: 80 + (5 / tan(59°)) = 80 + 3.004 = 83.004mm
    // 距底面 (z=0): 100 - 83.004 = 16.996mm
    expect(minGapBottom).toBeCloseTo(17.0, 1)
    expect(clrBottom.dist).toBeCloseTo(minGapBottom, 1)
    expect(clrBottom.ptA[2]).toBeCloseTo(100 - (80 + 3.004), 1)
  })

  it('validates hole-to-hole clearance when a cone tip approaches another hole', () => {
    const dims: [number, number, number] = [100, 100, 100]
    // 孔 1: 横向通孔 (从 front 向 back 钻，深度 80，直径 14)
    const steps1: Step[] = [
      { type: 'straight', diameter: 14, length: 80, thread: null }
    ]
    const cav1: CavityInstance = {
      instanceId: 'c1',
      name: 'Front_Hole',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'front',
      u: 50,
      v: 50, // z = 50
      rotation: 0,
      depthOffset: 0,
      steps: steps1
    }

    // 孔 2: 垂直打入的孔，带 118° 钻尖，锥尖正对着孔 1
    // 孔 1 中心在 y=50, z=50, 半径 7 -> 孔 1 上壁位于 z = 57
    // 孔 2 从 top (z=100) 向下钻，深 35mm 直孔 + 10mm 直径 118° 钻尖 (tip 约 3mm) -> 锥尖达到 z = 100 - 38 = 62
    // 净距应为 62 - 57 = 5mm!
    const steps2: Step[] = [
      { type: 'straight', diameter: 10, length: 35, thread: null },
      { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
    ]
    const cav2: CavityInstance = {
      instanceId: 'c2',
      name: 'Top_Hole_To_Front',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'top',
      u: 50,
      v: 50, // y = 50
      rotation: 0,
      depthOffset: 0,
      steps: steps2
    }

    const basis1 = getBoxFaceBasis('front', dims)
    const mat1 = Array.from(getCavityWorldMatrix(basis1, 50, 50, 0, 0))
    const cav1M = buildCavityManifold({ Manifold }, steps1, 64).transform(mat1)

    const basis2 = getBoxFaceBasis('top', dims)
    const mat2 = Array.from(getCavityWorldMatrix(basis2, 50, 50, 0, 0))
    const cav2M = buildCavityManifold({ Manifold }, steps2, 64).transform(mat2)

    const minGap = cav1M.minGap(cav2M, 50)

    const geom1 = buildAnalyzedCavityGeometry(cav1, dims)
    const geom2 = buildAnalyzedCavityGeometry(cav2, dims)

    const clr = computeHoleToHoleClearance(geom1, geom2)
    console.log('[Cone Tip to Cylinder Hole] Manifold minGap:', minGap, 'Analytical:', clr.dist)
    console.log('[PtA]:', clr.ptA, '[PtB]:', clr.ptB)

    expect(clr.dist).toBeCloseTo(minGap, 1)

    // 验证 CLR-001 规则计算的壁厚与端点
    const wallRes = evaluateHoleToHoleWallThickness(geom1, geom2, DEFAULT_CHECK_CONFIG, dummyStamp)
    expect(wallRes.observations[0]).toBeDefined()
    expect(wallRes.observations[0].measurements[0].value).toBeCloseTo(minGap, 1)
    // 验证端点 PtB 正确落在锥顶 z=61.996
    const ptB = wallRes.observations[0].evidence?.lines?.[0]?.[1]
    expect(ptB![2]).toBeCloseTo(61.996, 1)
  })

  it('validates CLR-002 hole-to-face wall thickness against Manifold minGap for side wall', () => {
    const dims: [number, number, number] = [100, 100, 100]
    // 距 right 面 (x=100) 净距为 100 - (u + r) = 100 - (90 + 5) = 5mm
    const steps: Step[] = [
      { type: 'straight', diameter: 10, length: 50, thread: null },
      { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
    ]
    const cav: CavityInstance = {
      instanceId: 'c_near_right',
      name: 'Near_Right_Hole',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'top',
      u: 90,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps
    }

    const basis = getBoxFaceBasis('top', dims)
    const mat = Array.from(getCavityWorldMatrix(basis, 90, 50, 0, 0))
    const cavM = buildCavityManifold({ Manifold }, steps, 64).transform(mat)

    // right 面外部 slab (x >= 100)
    const rightFaceSlab = Manifold.cube([10, dims[1], dims[2]], false).translate([100, 0, 0])
    const minGapRight = cavM.minGap(rightFaceSlab, 50)

    const geom = buildAnalyzedCavityGeometry(cav, dims)
    const res = evaluateHoleToOuterWallThickness(geom, dims, { template: 'box' }, DEFAULT_CHECK_CONFIG, dummyStamp)

    const rightObs = res.observations.find(o => o.refs.some(r => r.kind === 'base-face' && r.faceId === 'right'))
    expect(rightObs).toBeDefined()
    console.log('[Side Wall] Manifold minGap:', minGapRight, 'Analytical:', rightObs?.measurements[0].value)
    expect(rightObs?.measurements[0].value).toBeCloseTo(minGapRight, 1)
  })

  it('validates CLR-001 when cone tip is very close (e.g. 2mm gap) to another hole without false connection', () => {
    const dims: [number, number, number] = [100, 100, 100]
    // 孔 1: 横向孔，中心在 y=50, z=50, 直径 14 (半径 7, 顶部在 z=57)
    const steps1: Step[] = [
      { type: 'straight', diameter: 14, length: 80, thread: null }
    ]
    const cav1: CavityInstance = {
      instanceId: 'c1',
      name: 'Front_Hole',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'front',
      u: 50,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps: steps1
    }

    // 孔 2: 垂直孔，从 top (z=100) 向下钻，直孔深 38mm，加 118° 钻尖 (3.004mm)
    // 锥顶在 z = 100 - (38 + 3.004) = 58.996
    // 距孔 1 上壁 (z=57) 净距应为 58.996 - 57 = 1.996mm (~2.0mm)
    const steps2: Step[] = [
      { type: 'straight', diameter: 10, length: 38, thread: null },
      { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
    ]
    const cav2: CavityInstance = {
      instanceId: 'c2',
      name: 'Top_Hole_Near',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'top',
      u: 50,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps: steps2
    }

    const basis1 = getBoxFaceBasis('front', dims)
    const mat1 = Array.from(getCavityWorldMatrix(basis1, 50, 50, 0, 0))
    const cav1M = buildCavityManifold({ Manifold }, steps1, 64).transform(mat1)

    const basis2 = getBoxFaceBasis('top', dims)
    const mat2 = Array.from(getCavityWorldMatrix(basis2, 50, 50, 0, 0))
    const cav2M = buildCavityManifold({ Manifold }, steps2, 64).transform(mat2)

    const minGap = cav1M.minGap(cav2M, 50)

    const geom1 = buildAnalyzedCavityGeometry(cav1, dims)
    const geom2 = buildAnalyzedCavityGeometry(cav2, dims)

    const clr = computeHoleToHoleClearance(geom1, geom2)
    console.log('[Close Cone Tip minGap]:', minGap, 'Analytical clr.dist:', clr.dist, 'relation:', clr.relation)

    const wallRes = evaluateHoleToHoleWallThickness(geom1, geom2, DEFAULT_CHECK_CONFIG, dummyStamp)
    console.log('[Close Cone Tip CLR-001 issues count]:', wallRes.issues.length, 'observations:', wallRes.observations.length)

    expect(minGap).toBeCloseTo(2.0, 1)
    expect(clr.dist).toBeCloseTo(minGap, 1)
    expect(clr.relation).toBe('separated')
    // 由于 2.0mm < 5mm (阈值)，必须报告 CLR-001 壁厚不足 Issue！
    expect(wallRes.issues.length).toBe(1)
    expect(wallRes.issues[0].ruleId).toBe('CLR-001')
  })

  it('validates tip-to-tip clearance when two drill tips face each other coaxially', () => {
    const dims: [number, number, number] = [100, 100, 100]
    // 孔 1: 从 top (z=100) 向下钻，直孔 43.996mm，118° 钻尖 (3.004mm) -> 锥顶达到 z = 100 - 47 = 53
    const steps1: Step[] = [
      { type: 'straight', diameter: 10, length: 43.996, thread: null },
      { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
    ]
    const cav1: CavityInstance = {
      instanceId: 'c1',
      name: 'Top_Hole',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'top',
      u: 50,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps: steps1
    }

    // 孔 2: 从 bottom (z=0) 向上钻，直孔 44.996mm，118° 钻尖 (3.004mm) -> 锥顶达到 z = 48
    // 两锥顶同轴正对，净距应严格为 53 - 48 = 5.0mm
    const steps2: Step[] = [
      { type: 'straight', diameter: 10, length: 44.996, thread: null },
      { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
    ]
    const cav2: CavityInstance = {
      instanceId: 'c2',
      name: 'Bottom_Hole',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'bottom',
      u: 50,
      v: -50,
      rotation: 0,
      depthOffset: 0,
      steps: steps2
    }

    const basis1 = getBoxFaceBasis('top', dims)
    const mat1 = Array.from(getCavityWorldMatrix(basis1, 50, 50, 0, 0))
    const cav1M = buildCavityManifold({ Manifold }, steps1, 64).transform(mat1)

    const basis2 = getBoxFaceBasis('bottom', dims)
    const mat2 = Array.from(getCavityWorldMatrix(basis2, 50, -50, 0, 0))
    const cav2M = buildCavityManifold({ Manifold }, steps2, 64).transform(mat2)

    const minGap = cav1M.minGap(cav2M, 50)

    const geom1 = buildAnalyzedCavityGeometry(cav1, dims)
    const geom2 = buildAnalyzedCavityGeometry(cav2, dims)

    const clr = computeHoleToHoleClearance(geom1, geom2)
    console.log('[Tip-to-Tip minGap]:', minGap, 'Analytical clr.dist:', clr.dist, 'ptA:', clr.ptA, 'ptB:', clr.ptB)

    expect(minGap).toBeCloseTo(5.0, 1)
    expect(clr.dist).toBeCloseTo(minGap, 1)
    expect(clr.ptA[2]).toBeCloseTo(53.0, 1)
    expect(clr.ptB[2]).toBeCloseTo(48.0, 1)
  })

  it('validates penetrating cone tip where Manifold minGap is 0 and analytical reports intersecting', () => {
    const dims: [number, number, number] = [100, 100, 100]
    // 孔 1: 横向孔，中心在 y=50, z=50, 直径 14 (顶部在 z=57)
    const steps1: Step[] = [
      { type: 'straight', diameter: 14, length: 80, thread: null }
    ]
    const cav1: CavityInstance = {
      instanceId: 'c1',
      name: 'Front_Hole',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'front',
      u: 50,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps: steps1
    }

    // 孔 2: 垂直打入深 50mm + 钻尖，直接穿入孔 1
    const steps2: Step[] = [
      { type: 'straight', diameter: 10, length: 50, thread: null },
      { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
    ]
    const cav2: CavityInstance = {
      instanceId: 'c2',
      name: 'Top_Hole_Penetrating',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'top',
      u: 50,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps: steps2
    }

    const basis1 = getBoxFaceBasis('front', dims)
    const mat1 = Array.from(getCavityWorldMatrix(basis1, 50, 50, 0, 0))
    const cav1M = buildCavityManifold({ Manifold }, steps1, 64).transform(mat1)

    const basis2 = getBoxFaceBasis('top', dims)
    const mat2 = Array.from(getCavityWorldMatrix(basis2, 50, 50, 0, 0))
    const cav2M = buildCavityManifold({ Manifold }, steps2, 64).transform(mat2)

    const minGap = cav1M.minGap(cav2M, 50)

    const geom1 = buildAnalyzedCavityGeometry(cav1, dims)
    const geom2 = buildAnalyzedCavityGeometry(cav2, dims)

    const clr = computeHoleToHoleClearance(geom1, geom2)
    console.log('[Penetrating Cone Tip minGap]:', minGap, 'Analytical clr.dist:', clr.dist, 'relation:', clr.relation)

    expect(minGap).toBe(0)
    expect(clr.dist).toBe(0)
    expect(clr.relation).toBe('intersecting')
  })

  it('validates dual-track reconciliation via validateMultipleActiveClearancesWithMinGap', () => {
    const dims: [number, number, number] = [100, 100, 100]
    const steps1: Step[] = [{ type: 'straight', diameter: 14, length: 80, thread: null }]
    const cav1: CavityInstance = {
      instanceId: 'c1',
      name: 'Front_Hole',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'front',
      u: 50,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps: steps1
    }

    const steps2: Step[] = [
      { type: 'straight', diameter: 10, length: 35, thread: null },
      { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
    ]
    const cav2: CavityInstance = {
      instanceId: 'c2',
      name: 'Top_Hole',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'top',
      u: 50,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps: steps2
    }

    const geom1 = buildAnalyzedCavityGeometry(cav1, dims)
    const geom2 = buildAnalyzedCavityGeometry(cav2, dims)

    const rawResults = computeMultipleActiveClearances(
      [{ kind: 'cavity', instanceId: 'c1' }, { kind: 'cavity', instanceId: 'c2' }],
      [geom1, geom2],
      dims,
      { template: 'box' }
    )

    expect(rawResults.length).toBe(1)
    const validatedResults = validateMultipleActiveClearancesWithMinGap(
      mod,
      rawResults,
      [cav1, cav2],
      dims
    )

    expect(validatedResults.length).toBe(1)
    const v = validatedResults[0]
    console.log('[Dual-Track Validated Result]:', v)
    expect(v.verifiedByMinGap).toBe(true)
    expect(v.minGap).toBeCloseTo(5.0, 1)
    expect(v.dist).toBeCloseTo(5.0, 1)
    expect(v.gapDiscrepancy).toBeLessThan(0.01)
  })

  it('validates rule issues dual-track verification via validateIssuesWithMinGap', () => {
    const dims: [number, number, number] = [100, 100, 100]
    const steps1: Step[] = [{ type: 'straight', diameter: 14, length: 80, thread: null }]
    const cav1: CavityInstance = {
      instanceId: 'c1',
      name: 'Front_Hole',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'front',
      u: 50,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps: steps1
    }

    // 2mm 间隙的锥尖孔，应产生 CLR-001 issue
    const steps2: Step[] = [
      { type: 'straight', diameter: 10, length: 38, thread: null },
      { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
    ]
    const cav2: CavityInstance = {
      instanceId: 'c2',
      name: 'Top_Hole_Near',
      libraryId: 'lib',
      templateId: 'tpl',
      faceId: 'top',
      u: 50,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps: steps2
    }

    const geom1 = buildAnalyzedCavityGeometry(cav1, dims)
    const geom2 = buildAnalyzedCavityGeometry(cav2, dims)

    const wallRes = evaluateHoleToHoleWallThickness(geom1, geom2, DEFAULT_CHECK_CONFIG, dummyStamp)
    expect(wallRes.issues.length).toBe(1)

    const validated = validateIssuesWithMinGap(
      mod,
      wallRes.issues,
      wallRes.observations,
      [cav1, cav2],
      dims
    )

    expect(validated.issues.length).toBe(1)
    console.log('[Dual-Track Validated Issue Measurement]:', validated.issues[0].measurements?.[0]?.value)
    expect(validated.issues[0].measurements?.[0]?.value).toBeCloseTo(2.0, 1)
  })
})
