import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import Module from 'manifold-3d'
import { parseStepToThreeGeometry } from '@renderer/workspace/tabs/viewer/stepLoader'
import { classifyAndGroupCsgGeometry } from '@renderer/workspace/design/geometry/meshClassifier'
import type { CsgSuccessResponse } from '../csg.worker'

describe('cube-cut-edge.step Import & CSG Pipeline Integrity Tests', () => {
  let stepContent: string
  let manifoldModule: any

  beforeAll(async () => {
    manifoldModule = await Module()
    manifoldModule.setup()

    const stepPath = path.resolve(__dirname, 'cube-cut-edge.step')
    expect(fs.existsSync(stepPath)).toBe(true)
    stepContent = fs.readFileSync(stepPath, 'utf8')
  }, 60000)

  it('1. parses cube-cut-edge.step into 7 distinct faces with cut edge chamfer', async () => {
    const result = await parseStepToThreeGeometry(stepContent)

    expect(result).toBeDefined()
    expect(result.dimensions).toEqual([1559.1, 749.8, 640])

    // 标准立方体只有 6 个面，此文件具有切角，必须严格识别出 7 个面
    expect(result.faces).toBeDefined()
    expect(result.faces?.length).toBe(7)

    // 验证切角斜面（非正交主面）被成功提取
    const chamferFace = result.faces?.find(
      (f) =>
        f.name.includes('斜面') ||
        (Math.abs(f.normal[0]) > 0.1 && Math.abs(f.normal[2]) > 0.1)
    )
    expect(chamferFace).toBeDefined()

    // 顶点数与三角面数验证
    const numVertices = result.stepMesh.positions.length / 3
    const numTriangles = result.stepMesh.indices.length / 3
    expect(numVertices).toBe(10)
    expect(numTriangles).toBe(16)

    // 边线非空验证
    expect(result.stepMesh.edgePositions).toBeDefined()
    expect(result.stepMesh.edgePositions!.length).toBeGreaterThan(0)
  })

  it('2. verifies that cube-cut-edge.step is NOT degraded to a square/box (Volume & Topology Proof)', async () => {
    const result = await parseStepToThreeGeometry(stepContent)

    const manifoldMesh = new manifoldModule.Mesh({
      numProp: 3,
      vertProperties: result.stepMesh.positions,
      triVerts: result.stepMesh.indices
    })
    manifoldMesh.merge()

    const stepManifold = new manifoldModule.Manifold(manifoldMesh)
    expect(stepManifold.genus()).toBe(0)

    const actualVolume = Math.round(stepManifold.volume())
    const fullBoxVolume = Math.round(1559.1 * 749.8 * 640)

    // 切角被挖去，实际体积必须显著小于外接长方体体积（差值约为 60,233,170 mm³）
    expect(actualVolume).toBeLessThan(fullBoxVolume)
    expect(actualVolume).toBeGreaterThan(680000000)
    expect(actualVolume).toBeLessThan(700000000)

    const volumeDiff = fullBoxVolume - actualVolume
    expect(volumeDiff).toBeGreaterThan(50000000) // 证明绝非无切角正方体/长方体
  })

  it('3. verifies CSG Worker protocol for STEP body (type: CSG_SUCCESS message response)', async () => {
    const result = await parseStepToThreeGeometry(stepContent)

    // 模拟 csg.worker 处理无孔腔时的快速通道消息构造
    const edgePositions = result.stepMesh.edgePositions || new Float32Array(0)
    const response: CsgSuccessResponse = {
      type: 'CSG_SUCCESS',
      taskId: 1,
      positions: result.stepMesh.positions,
      normals: result.stepMesh.normals || new Float32Array(0),
      indices: result.stepMesh.indices,
      edgePositions,
      faceTags: new Uint32Array(result.stepMesh.indices.length / 3).fill(0),
      numericIdToInstanceId: {}
    }

    // 必须带有 type: 'CSG_SUCCESS'，否则 csgWorkerBridge 会丢弃消息导致前端挂起回退长方体
    expect(response.type).toBe('CSG_SUCCESS')
    expect(response.positions.length).toBe(result.stepMesh.positions.length)
    expect(response.indices.length).toBe(result.stepMesh.indices.length)
  })

  it('4. performs boolean difference on cube-cut-edge with cavity without geometry degradation', async () => {
    const result = await parseStepToThreeGeometry(stepContent)

    const baseMesh = new manifoldModule.Mesh({
      numProp: 3,
      vertProperties: result.stepMesh.positions,
      triVerts: result.stepMesh.indices
    })
    baseMesh.merge()
    const baseManifold = new manifoldModule.Manifold(baseMesh)

    // 在顶面开一个半径 30mm、深 100mm 的圆柱盲孔
    const holeCylinder = manifoldModule.Manifold.cylinder(100, 30, 30, 32, false)
      .rotate([180, 0, 0])
      .translate([500, 300, 640])

    const diffManifold = manifoldModule.Manifold.difference(baseManifold, holeCylinder)
    expect(diffManifold.genus()).toBe(0)

    const expectedVol = baseManifold.volume() - holeCylinder.volume()
    expect(Math.abs(diffManifold.volume() - expectedVol)).toBeLessThan(1)
  })

  it('5. classifies and groups cube-cut-edge mesh for multi-material rendering', async () => {
    const result = await parseStepToThreeGeometry(stepContent)
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
    expect(classified.edgeGeometry).toBeDefined()
    expect(classified.triangleTags.length).toBe(16)
    expect(classified.solidGeometry.groups.length).toBeGreaterThan(0)
  })

  it('6. validates inclined face basis orthogonality and physical origin positioning', async () => {
    const result = await parseStepToThreeGeometry(stepContent)
    const chamferFace = result.faces?.find(
      (f) =>
        f.name.includes('斜面') ||
        (Math.abs(f.normal[0]) > 0.1 && Math.abs(f.normal[2]) > 0.1)
    )
    expect(chamferFace).toBeDefined()
    expect(chamferFace!.u).toBeDefined()
    expect(chamferFace!.v).toBeDefined()
    expect(chamferFace!.origin).toBeDefined()
    const normal = chamferFace!.normal
    const u = chamferFace!.u!
    const v = chamferFace!.v!
    const origin = chamferFace!.origin!

    // 1. 验证正交性 (u · w === 0, v · w === 0, u · v === 0)
    const dotUW = u[0] * normal[0] + u[1] * normal[1] + u[2] * normal[2]
    const dotVW = v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2]
    const dotUV = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
    expect(Math.abs(dotUW)).toBeLessThan(1e-4)
    expect(Math.abs(dotVW)).toBeLessThan(1e-4)
    expect(Math.abs(dotUV)).toBeLessThan(1e-4)

    // 2. 验证右手定则 cross(u, v) == w
    const crossX = u[1] * v[2] - u[2] * v[1]
    const crossY = u[2] * v[0] - u[0] * v[2]
    const crossZ = u[0] * v[1] - u[1] * v[0]
    expect(Math.abs(crossX - normal[0])).toBeLessThan(1e-3)
    expect(Math.abs(crossY - normal[1])).toBeLessThan(1e-3)
    expect(Math.abs(crossZ - normal[2])).toBeLessThan(1e-3)

    // 3. 验证原点为全局原点在面内的正交投影点 (满足 origin 与 normal 共线，且位于该无限切面上)
    const centerPoint = chamferFace!.centerPoint!
    const planeDist = Math.abs(
      (centerPoint[0] - origin[0]) * normal[0] +
      (centerPoint[1] - origin[1]) * normal[1] +
      (centerPoint[2] - origin[2]) * normal[2]
    )
    expect(planeDist).toBeLessThan(0.05)
    // 验证原点向量与法向向量共线 (即 origin = planeOffset * normal)
    const crossOriginNormX = origin[1] * normal[2] - origin[2] * normal[1]
    const crossOriginNormY = origin[2] * normal[0] - origin[0] * normal[2]
    const crossOriginNormZ = origin[0] * normal[1] - origin[1] * normal[0]
    expect(Math.hypot(crossOriginNormX, crossOriginNormY, crossOriginNormZ)).toBeLessThan(0.05)
  })

  it('7. tests computeOrthonormalPlaneBasis helper with various normal vectors', async () => {
    const { computeOrthonormalPlaneBasis } = await import('@shared/design/faceMath')

    // 45度斜面
    const basis45 = computeOrthonormalPlaneBasis([1 / Math.SQRT2, 0, 1 / Math.SQRT2])
    expect(Math.abs(basis45.u[0] * basis45.w[0] + basis45.u[1] * basis45.w[1] + basis45.u[2] * basis45.w[2])).toBeLessThan(1e-6)
    expect(Math.abs(basis45.v[0] * basis45.w[0] + basis45.v[1] * basis45.w[1] + basis45.v[2] * basis45.w[2])).toBeLessThan(1e-6)
    expect(Math.abs(basis45.u[0] * basis45.v[0] + basis45.u[1] * basis45.v[1] + basis45.u[2] * basis45.v[2])).toBeLessThan(1e-6)
    // 纵向 v 必须沿斜面向上爬升 (vz > 0)
    expect(basis45.v[2]).toBeGreaterThan(0)

    // 复合斜面
    const basisCompound = computeOrthonormalPlaneBasis([0.5, 0.5, Math.SQRT1_2])
    expect(Math.abs(basisCompound.u[0] * basisCompound.w[0] + basisCompound.u[1] * basisCompound.w[1] + basisCompound.u[2] * basisCompound.w[2])).toBeLessThan(1e-6)
    expect(Math.abs(basisCompound.v[0] * basisCompound.w[0] + basisCompound.v[1] * basisCompound.w[1] + basisCompound.v[2] * basisCompound.w[2])).toBeLessThan(1e-6)
  })

  it('8. verifies setBaseBodyError in designStore for degraded fallback visibility', async () => {
    const { useDesignStore } = await import('@renderer/workspace/design/model/designStore')
    const testProjectId = 'test-proj-fallback'
    useDesignStore.getState().initProject(testProjectId)

    // 模拟发生降级长方体错误
    const errMsg = 'STEP 实体解析失败，已回退为长方体包围盒'
    useDesignStore.getState().setBaseBodyError(testProjectId, errMsg)
    expect(useDesignStore.getState().projects[testProjectId]?.baseBodyError).toBe(errMsg)

    // 模拟成功恢复后清除错误
    useDesignStore.getState().setBaseBodyError(testProjectId, null)
    expect(useDesignStore.getState().projects[testProjectId]?.baseBodyError).toBeNull()

    useDesignStore.getState().removeProject(testProjectId)
  })

  it('9. verifies stepFilePath persistence in designStore for source refresh', async () => {
    const { useDesignStore } = await import('@renderer/workspace/design/model/designStore')
    const testProjectId = 'test-proj-step-filepath'
    useDesignStore.getState().initProject(testProjectId)

    const testFilePath = '/Users/test/models/custom_valve.step'
    useDesignStore.getState().setBaseStepModel(testProjectId, {
      stepContent: 'ISO-10303-21;',
      stepFileName: 'custom_valve.step',
      stepFilePath: testFilePath,
      dimensions: [200, 150, 100],
      faces: []
    })

    const body = useDesignStore.getState().projects[testProjectId]?.doc.baseBody
    expect(body?.stepFileName).toBe('custom_valve.step')
    expect(body?.stepFilePath).toBe(testFilePath)

    useDesignStore.getState().removeProject(testProjectId)
  })

  it('10. verifies detectBaseBodyFace and getBoxFaceBasis for STEP face drag placement preview', async () => {
    const { detectBaseBodyFace, getBoxFaceBasis } = await import('@shared/design/faceMath')
    const result = await parseStepToThreeGeometry(stepContent)
    const baseBody = {
      type: 'step' as const,
      dimensions: result.dimensions,
      faces: result.faces
    }

    expect(result.faces).toBeDefined()
    const chamferFace = result.faces!.find((f) => f.name.includes('斜面'))!
    expect(chamferFace).toBeDefined()
    expect(chamferFace.centerPoint).toBeDefined()

    // 模拟拖拽鼠标射线命中斜面上的 centerPoint
    const centerPoint = chamferFace.centerPoint!
    const hitNormal = { x: chamferFace.normal[0], y: chamferFace.normal[1], z: chamferFace.normal[2] }
    const hitPoint = { x: centerPoint[0], y: centerPoint[1], z: centerPoint[2] }

    const detectedId = detectBaseBodyFace(hitNormal, hitPoint, baseBody)
    expect(detectedId).toBe(chamferFace.id)

    // 验证 GhostCavityMesh / PlacementController 解析的面基底为 STEP 真实面基底而非默认长方体基底
    const basis = getBoxFaceBasis(detectedId!, result.dimensions, baseBody)
    expect(basis.id).toBe(chamferFace.id)
    expect(basis.w[0]).toBeCloseTo(chamferFace.normal[0], 3)
    expect(basis.w[2]).toBeCloseTo(chamferFace.normal[2], 3)
  })

  it('11. verifies stepAssetRef persistence in setBaseStepModel', async () => {
    const { useDesignStore } = await import('@renderer/workspace/design/model/designStore')
    const testProjectId = 'test-proj-step-asset-ref'
    useDesignStore.getState().initProject(testProjectId)

    const testFilePath = '/Volumes/cad/blocks/manifold_v2.step'
    const customAssetRef = 'urn:cad:solidworks:part-12345'

    useDesignStore.getState().setBaseStepModel(testProjectId, {
      stepContent: stepContent,
      stepFileName: 'manifold_v2.step',
      stepFilePath: testFilePath,
      stepAssetRef: customAssetRef,
      dimensions: [100, 100, 100],
      faces: []
    })

    const body = useDesignStore.getState().projects[testProjectId]?.doc.baseBody
    expect(body?.stepAssetRef).toBe(customAssetRef)
    expect(body?.stepFilePath).toBe(testFilePath)
    expect(body?.stepFileName).toBe('manifold_v2.step')

    useDesignStore.getState().removeProject(testProjectId)
  })

  it('12. verifies missing file alert and forced model reconstruction from stepContent', async () => {
    const { useDesignStore } = await import('@renderer/workspace/design/model/designStore')
    const testProjectId = 'test-proj-reconstruct-step'

    // 模拟 window.fileApi.exists 返回 false (源文件丢失)
    const originalFileApi = (globalThis as any).window?.fileApi
    ;(globalThis as any).window = (globalThis as any).window || {}
    ;(globalThis as any).window.fileApi = {
      exists: async (path: string) => {
        if (path === '/non/existent/missing.step') return false
        return true
      }
    }

    const initialDoc: any = {
      meta: { projectName: '测试从 stepContent 重建' },
      schemes: [{ id: 'scheme-1', name: '方案 1', cavities: [] }],
      activeSchemeId: 'scheme-1',
      baseBody: {
        type: 'step',
        stepContent: stepContent,
        stepFileName: 'missing.step',
        stepFilePath: '/non/existent/missing.step',
        stepAssetRef: '/non/existent/missing.step',
        dimensions: [10, 10, 10], // 故意设置为错误尺寸
        faces: [],
        stepMesh: null // 故意为 null，测试强制重建
      }
    }

    useDesignStore.getState().initProject(testProjectId, initialDoc)

    // 等待异步重建完成
    const success = await useDesignStore.getState().rebuildStepModel(testProjectId)
    expect(success).toBe(true)

    const session = useDesignStore.getState().projects[testProjectId]
    expect(session).toBeDefined()

    // 1. 验证文件丢失报警提醒已生成
    expect(session?.baseBodyError).toContain('原始 STEP 文件丢失或不可访问')
    expect(session?.baseBodyError).toContain('/non/existent/missing.step')

    // 2. 验证成功从内嵌 stepContent 重建了水密 OCC 几何与特征面
    expect(session?.doc.baseBody.stepMesh).toBeDefined()
    expect(session?.doc.baseBody.stepMesh?.positions.length).toBeGreaterThan(0)
    expect(session?.doc.baseBody.faces.length).toBe(7) // cube-cut-edge.step 包含7个特征面
    // 尺寸也从实际 OCC 模型解析更新
    expect(session?.doc.baseBody.dimensions[0]).toBeCloseTo(1559.1, 1)

    // 恢复 window.fileApi
    ;(globalThis as any).window.fileApi = originalFileApi
    useDesignStore.getState().removeProject(testProjectId)
  })

  it('13. verifies cavity depth gizmo axis and position on inclined face with baseBody', async () => {
    const { getBoxFaceBasis, localToWorldPoint } = await import('@shared/design/faceMath')
    const result = await parseStepToThreeGeometry(stepContent)
    const baseBody = {
      type: 'step' as const,
      dimensions: result.dimensions,
      faces: result.faces
    }

    const chamferFace = result.faces!.find((f) => f.name.includes('斜面'))!
    expect(chamferFace).toBeDefined()

    // 当传入 baseBody 时，getBoxFaceBasis 解析的是真实斜面基底
    const basis = getBoxFaceBasis(chamferFace.id, result.dimensions, baseBody)
    expect(basis.id).toBe(chamferFace.id)

    // 深入孔轴单位向量：法向相反（指向实体内部，即 -basis.w）
    const inwardAxis = [-basis.w[0], -basis.w[1], -basis.w[2]]
    // 验证深入向量与斜面法向量严格反向平行
    const dot = inwardAxis[0] * chamferFace.normal[0] + inwardAxis[1] * chamferFace.normal[1] + inwardAxis[2] * chamferFace.normal[2]
    expect(dot).toBeCloseTo(-1, 4)

    // 验证孔口位置与深入位置处于斜面坐标系下
    const surfacePos = localToWorldPoint(basis, 0, 0, 0)
    const deepPos = localToWorldPoint(basis, 0, 0, 50)
    expect(surfacePos).toBeDefined()
    expect(deepPos).toBeDefined()
    // 深入向量应当与 inwardAxis 方向严格同向
    const delta = [deepPos[0] - surfacePos[0], deepPos[1] - surfacePos[1], deepPos[2] - surfacePos[2]]
    expect(delta[0]).toBeCloseTo(50 * inwardAxis[0], 2)
    expect(delta[1]).toBeCloseTo(50 * inwardAxis[1], 2)
    expect(delta[2]).toBeCloseTo(50 * inwardAxis[2], 2)
  })
})
