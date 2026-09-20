import { describe, it, expect, beforeAll } from 'vitest'
import { parseStepToThreeGeometry } from '../stepLoader'
import { getOccInstance } from '@renderer/workspace/design/worker/cad/occtLoader'
import Module from 'manifold-3d'

describe('STEP Watertight Mesh Loader & Manifold Compatibility', () => {
  let occ: any
  let sampleStepContent: string

  beforeAll(async () => {
    occ = await getOccInstance()
    expect(occ).toBeDefined()

    // 构造一个 120 x 100 x 80 的实体并导出为 AP214 STEP 文本
    const pnt0 = new occ.gp_Pnt(0, 0, 0)
    const box = occ.MakeBoxFromPntAndDims(pnt0, 120, 100, 80)
    pnt0.delete()

    const writer = new occ.STEPControl_Writer()
    writer.Transfer(box, occ.STEPControl_StepModelType.AsIs)
    const tempFile = `test_box_${Date.now()}.step`
    writer.Write(tempFile)
    sampleStepContent = occ.FS.readFile('/' + tempFile, { encoding: 'utf8' })
    occ.FS.unlink('/' + tempFile)
    writer.delete()
    box.delete()
  }, 60000)

  it('parses STEP content into watertight Three.js geometry and BaseFaceDefinition faces', async () => {
    const result = await parseStepToThreeGeometry(sampleStepContent)

    expect(result).toBeDefined()
    expect(result.solidGeometry).toBeDefined()
    expect(result.solidGeometry.attributes.position.count).toBeGreaterThan(0)
    expect(result.solidGeometry.index?.count).toBeGreaterThan(0)
    expect(result.dimensions).toEqual([120, 100, 80])

    // 6 个正交平面
    expect(result.faces).toBeDefined()
    expect(result.faces?.length).toBe(6)

    // stepMesh 数据有效性
    expect(result.stepMesh.positions.length).toBeGreaterThan(0)
    expect(result.stepMesh.indices.length).toBeGreaterThan(0)
    expect(result.stepMesh.normals.length).toBeGreaterThan(0)
  })

  it('produces a 100% closed 2-manifold mesh acceptable by Manifold-3D kernel without throwing', async () => {
    const result = await parseStepToThreeGeometry(sampleStepContent)

    const manifoldModule = await Module()
    manifoldModule.setup()

    const manifoldMesh = new manifoldModule.Mesh({
      numProp: 3,
      vertProperties: result.stepMesh.positions,
      triVerts: result.stepMesh.indices
    })
    manifoldMesh.merge()

    // 验证 Manifold 构造不报错，并且体积准确等于 120 * 100 * 80 = 960000
    const m = new manifoldModule.Manifold(manifoldMesh)
    expect(m.genus()).toBe(0)
    expect(Math.round(m.volume())).toBe(960000)
  })

  it('correctly loads and preserves cube-cut-edge.step without degrading to a square or cube', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const stepPath = path.resolve('src/renderer/src/workspace/design/worker/csg/__tests__/cube-cut-edge.step')
    const content = fs.readFileSync(stepPath, 'utf8')

    const result = await parseStepToThreeGeometry(content)
    console.log('cube-cut-edge dimensions:', result.dimensions)
    console.log('cube-cut-edge faces count:', result.faces?.length)
    console.log('cube-cut-edge vertices:', result.stepMesh.positions.length / 3)
    console.log('cube-cut-edge triangles:', result.stepMesh.indices.length / 3)

    const manifoldModule = await Module()
    manifoldModule.setup()

    const manifoldMesh = new manifoldModule.Mesh({
      numProp: 3,
      vertProperties: result.stepMesh.positions,
      triVerts: result.stepMesh.indices
    })
    manifoldMesh.merge()

    const m = new manifoldModule.Manifold(manifoldMesh)
    console.log('Manifold volume:', m.volume(), 'genus:', m.genus())
    expect(m.genus()).toBe(0)
    expect(result.faces?.length).toBe(7)

    // 验证分类器 classifyAndGroupCsgGeometry 正常处理 STEP 几何体与特征面
    const { classifyAndGroupCsgGeometry } = await import('@renderer/workspace/design/geometry/meshClassifier')
    const edgePositions = result.stepMesh.edgePositions || new Float32Array(0)
    const faceTags = new Uint32Array(result.stepMesh.indices.length / 3).fill(0)
    const classified = classifyAndGroupCsgGeometry(
      result.stepMesh.positions,
      result.stepMesh.normals,
      result.stepMesh.indices,
      edgePositions,
      result.dimensions,
      [],
      null,
      null,
      faceTags,
      {},
      {
        type: 'step',
        dimensions: result.dimensions,
        faces: result.faces
      }
    )

    expect(classified.solidGeometry).toBeDefined()
    expect(classified.solidGeometry.attributes.position.count).toBeGreaterThan(0)
    expect(classified.triangleTags.length).toBe(result.stepMesh.indices.length / 3)
  })
})

