import { describe, it, expect, beforeAll } from 'vitest'
import manifoldModuleFactory from 'manifold-3d'
import { getOccInstance } from '../occtLoader'
import { getBoxFaceBasis, getCavityWorldMatrix } from '@shared/design/faceMath'
import { buildCavityManifold } from '@renderer/workspace/design/geometry/cavityProfileBuilder'
import { generateStepContent, type CadExportParams } from '../cadExportService'
import type { Step } from '@shared/cavity/types'

describe('Manifold-3D vs OCCT STEP Volume and Position Comparison', () => {
  let occ: any
  let Manifold: any

  beforeAll(async () => {
    occ = await getOccInstance()
    const mod = await (manifoldModuleFactory as any)()
    mod.setup()
    Manifold = mod.Manifold
  }, 60000)

  it('compares volume of Manifold CSG vs OCCT STEP for all 6 faces with face-centered cavities', async () => {
    const dims: [number, number, number] = [120, 100, 80]
    const [sx, sy, sz] = dims
    const steps: Step[] = [
      { type: 'straight', diameter: 18, length: 8, thread: null },
      { type: 'straight', diameter: 10, length: 20, thread: null },
      { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
    ]

    const baseManifold = Manifold.cube(dims, false)

    // 各个面的几何中心对应的 (u, v)
    const faceCenterUV: Record<string, [number, number]> = {
      top: [sx / 2, sy / 2],
      bottom: [sx / 2, -sy / 2],
      front: [sx / 2, sz / 2],
      back: [-sx / 2, sz / 2],
      left: [-sy / 2, sz / 2],
      right: [sy / 2, sz / 2]
    }

    for (const [face, [u, v]] of Object.entries(faceCenterUV)) {
      const basis = getBoxFaceBasis(face, dims)
      const worldMatrix = Array.from(getCavityWorldMatrix(basis, u, v, 0, 0))

      // 1. Manifold CSG
      const mod = { Manifold }
      const cavM = buildCavityManifold(mod, steps, 64).transform(worldMatrix)
      const cutM = Manifold.difference(baseManifold, cavM)
      const volM = cutM.volume()
      const areaM = cutM.surfaceArea()
      const bbM = cavM.boundingBox()

      // 2. OCCT STEP
      const params: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: { dimensions: dims },
        cavities: [
          {
            instanceId: `cav-${face}`,
            numericId: 1,
            name: `${face}_hole`,
            worldMatrix,
            steps
          }
        ]
      }

      const stepText = await generateStepContent(params, occ)
      const parsedShape = occ.ReadSTEPFromBinary(new TextEncoder().encode(stepText))
      const vProps = new occ.GProp_GProps()
      occ.BRepGProp_VolumeProperties(parsedShape, vProps, false, false)
      const volOcc = vProps.Mass()
      const sProps = new occ.GProp_GProps()
      occ.BRepGProp_SurfaceProperties(parsedShape, sProps, false)
      const areaOcc = sProps.Mass()

      console.log(`[Face: ${face}] (u=${u}, v=${v})`)
      console.log(`  Manifold Cav BBox: min [${bbM.min.map((n: number) => n.toFixed(1))}], max [${bbM.max.map((n: number) => n.toFixed(1))}]`)
      console.log(`  Volume: Manifold = ${volM.toFixed(2)}, OCCT = ${volOcc.toFixed(2)}, diff = ${(volM - volOcc).toFixed(2)}`)
      console.log(`  Area:   Manifold = ${areaM.toFixed(2)}, OCCT = ${areaOcc.toFixed(2)}, diff = ${(areaM - areaOcc).toFixed(2)}`)

      // 断言体积差异不超过 0.01% (考虑到 Manifold 64 段多边形拟合误差)
      const volRelDiff = Math.abs(volM - volOcc) / volOcc
      expect(volRelDiff).toBeLessThan(0.0001)

      // 断言面积差异不超过 0.01%
      const areaRelDiff = Math.abs(areaM - areaOcc) / areaOcc
      expect(areaRelDiff).toBeLessThan(0.0001)

      parsedShape.delete()
    }
  })

  it('compares volume and surface area of complex multi-cavity valve block with rotations and depth offsets', async () => {
    const dims: [number, number, number] = [140, 120, 90]
    const baseManifold = Manifold.cube(dims, false)

    const complexSteps: Step[] = [
      { type: 'straight', diameter: 22, length: 6, thread: null },
      { type: 'straight', diameter: 16, length: 15, thread: null },
      { type: 'straight', diameter: 12, length: 20, thread: null },
      { type: 'tapered', diameter: 12, length: null, angle: 118, thread: null }
    ]

    const cavitiesDef = [
      { face: 'top', u: 40, v: 50, rot: 45, depth: 2 },
      { face: 'top', u: 90, v: 70, rot: 0, depth: 0 },
      { face: 'front', u: 50, v: 45, rot: 30, depth: 1 },
      { face: 'right', u: 60, v: 50, rot: 60, depth: 0 },
      { face: 'bottom', u: 70, v: -60, rot: 15, depth: 1.5 },
      { face: 'back', u: -60, v: 40, rot: 90, depth: 0 }
    ]

    const mod = { Manifold }
    const manifoldCavities = []
    const cavitiesInput = []

    for (let i = 0; i < cavitiesDef.length; i++) {
      const def = cavitiesDef[i]
      const basis = getBoxFaceBasis(def.face, dims)
      const worldMatrix = Array.from(getCavityWorldMatrix(basis, def.u, def.v, def.depth, def.rot))

      // Manifold
      const cavM = buildCavityManifold(mod, complexSteps, 64).transform(worldMatrix)
      manifoldCavities.push(cavM)

      // OCCT
      cavitiesInput.push({
        instanceId: `cavity-${i + 1}`,
        numericId: i + 1,
        name: `Port_${def.face}_${i + 1}`,
        worldMatrix,
        steps: complexSteps
      })
    }

    // 1. Manifold difference
    const toolUnion = Manifold.union(manifoldCavities)
    const resultM = Manifold.difference(baseManifold, toolUnion)
    const volM = resultM.volume()
    const areaM = resultM.surfaceArea()

    // 2. OCCT difference & STEP generation
    const stepText = await generateStepContent(
      {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: { dimensions: dims },
        cavities: cavitiesInput
      },
      occ
    )

    const parsedShape = occ.ReadSTEPFromBinary(new TextEncoder().encode(stepText))
    const vProps = new occ.GProp_GProps()
    occ.BRepGProp_VolumeProperties(parsedShape, vProps, false, false)
    const volOcc = vProps.Mass()

    const sProps = new occ.GProp_GProps()
    occ.BRepGProp_SurfaceProperties(parsedShape, sProps, false)
    const areaOcc = sProps.Mass()

    console.log('[Multi-Cavity Complex Valve Block]')
    console.log(`  Volume: Manifold = ${volM.toFixed(2)}, OCCT = ${volOcc.toFixed(2)}, diff = ${(volM - volOcc).toFixed(2)}`)
    console.log(`  Area:   Manifold = ${areaM.toFixed(2)}, OCCT = ${areaOcc.toFixed(2)}, diff = ${(areaM - areaOcc).toFixed(2)}`)

    // 相对误差小于 0.05%
    const volRelDiff = Math.abs(volM - volOcc) / volOcc
    expect(volRelDiff).toBeLessThan(0.0005)

    const areaRelDiff = Math.abs(areaM - areaOcc) / areaOcc
    expect(areaRelDiff).toBeLessThan(0.0001)

    parsedShape.delete()
  })

  it('verifies Manifold minGap API behavior between two cylinders', () => {
    const c1 = Manifold.cylinder(30, 5, 5, 32, false)
    // 平移 20mm (中心距 20mm，各自半径 5mm，间隙应为 20 - 10 = 10mm)
    const c2 = Manifold.cylinder(30, 5, 5, 32, false).translate([20, 0, 0])
    const gap = c1.minGap(c2, 50)
    console.log('[Manifold minGap Test] Expected ~10mm, got:', gap)
    expect(gap).toBeCloseTo(10, 1)

    // 相交圆柱：中心距 8mm (小于 5+5=10mm)
    const c3 = Manifold.cylinder(30, 5, 5, 32, false).translate([8, 0, 0])
    const overlapGap = c1.minGap(c3, 50)
    console.log('[Manifold minGap Overlap Test] Expected 0, got:', overlapGap)
    expect(overlapGap).toBe(0)
  })
})
