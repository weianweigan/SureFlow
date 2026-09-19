import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  createDefaultProject,
  MATERIAL_PRESETS,
  resolveMaterialConfig,
  L_SHAPE_FACES,
  T_SHAPE_FACES,
  STANDARD_BOX_FACES
} from '@shared/design/types'

vi.mock('@renderer/workspace/layout/layoutStore', () => ({
  useWorkspaceStore: { getState: () => ({}) }
}))

import { produce } from 'immer'
import { useDesignStore } from '../designStore'

describe('Base Body Features and Inspector Refactoring', () => {
  const projectId = 'proj-base-test'

  beforeEach(() => {
    const doc = createDefaultProject('测试基体工程')
    useDesignStore.setState({ projects: {} })
    useDesignStore.getState().initProject(projectId, doc)
  })

  it('initializes default project with 45# steel density 7.85 and box template', () => {
    const project = useDesignStore.getState().projects[projectId]
    expect(project.doc.baseBody.type).toBe('template')
    expect(project.doc.baseBody.template).toBe('box')
    expect(project.doc.baseBody.dimensions).toEqual([120, 100, 80])

    const mat = resolveMaterialConfig(project.doc.baseBody.material, project.doc.baseBody.materialConfig)
    expect(mat.density).toBe(7.85)
    expect(mat.presetId).toBe('45-steel')
  })

  it('switches base template to L-shape and T-shape, updating faces correctly', () => {
    const store = useDesignStore.getState()

    // 切换到 L 型基体
    store.setBaseTemplate(projectId, 'l-shape')
    let p = useDesignStore.getState().projects[projectId]
    expect(p.doc.baseBody.type).toBe('template')
    expect(p.doc.baseBody.template).toBe('l-shape')
    expect(p.doc.baseBody.faces.length).toBe(8)
    expect(p.doc.baseBody.faces.map(f => f.id)).toEqual(L_SHAPE_FACES.map(f => f.id))
    expect(p.doc.baseBody.faces.find(f => f.id === 'top-step')?.origin).toBeDefined()

    // 切换到 T 型基体
    store.setBaseTemplate(projectId, 't-shape')
    p = useDesignStore.getState().projects[projectId]
    expect(p.doc.baseBody.template).toBe('t-shape')
    expect(p.doc.baseBody.faces.length).toBe(10)
    expect(p.doc.baseBody.faces.map(f => f.id)).toEqual(T_SHAPE_FACES.map(f => f.id))
    expect(p.doc.baseBody.faces.find(f => f.id === 'flange-bottom-left')?.origin).toBeDefined()

    // 切换回长方体
    store.setBaseTemplate(projectId, 'box')
    p = useDesignStore.getState().projects[projectId]
    expect(p.doc.baseBody.template).toBe('box')
    expect(p.doc.baseBody.faces.length).toBe(6)
    expect(p.doc.baseBody.faces.map(f => f.id)).toEqual(STANDARD_BOX_FACES.map(f => f.id))
    expect(p.doc.baseBody.faces.find(f => f.id === 'top')?.origin).toBeDefined()
  })

  it('sets base extra parameters for L-shape and T-shape', () => {
    const store = useDesignStore.getState()
    store.setBaseTemplate(projectId, 'l-shape')
    store.setBaseExtraParams(projectId, { cutX: 45, cutZ: 35 })

    const p = useDesignStore.getState().projects[projectId]
    expect(p.doc.baseBody.extraParams).toEqual({ cutX: 45, cutZ: 35 })
  })

  it('imports external STEP model as base body and switches type to step', () => {
    const store = useDesignStore.getState()
    const mockStepText = 'ISO-10303-21;\nHEADER;\nDATA;\n#1=MANIFOLD_SOLID_BREP();\nENDSEC;\nEND-ISO-10303-21;'

    store.setBaseStepModel(projectId, {
      stepContent: mockStepText,
      stepFileName: 'custom_manifold.step',
      dimensions: [150, 120, 90]
    })

    let p = useDesignStore.getState().projects[projectId]
    expect(p.doc.baseBody.type).toBe('step')
    expect(p.doc.baseBody.stepContent).toBe(mockStepText)
    expect(p.doc.baseBody.stepFileName).toBe('custom_manifold.step')
    expect(p.doc.baseBody.dimensions).toEqual([150, 120, 90])

    // 切换回普通模板后，再切回 step 保留数据
    store.setBaseTemplate(projectId, 'box')
    p = useDesignStore.getState().projects[projectId]
    expect(p.doc.baseBody.type).toBe('template')

    store.setBaseType(projectId, 'step')
    p = useDesignStore.getState().projects[projectId]
    expect(p.doc.baseBody.type).toBe('step')
    expect(p.doc.baseBody.stepFileName).toBe('custom_manifold.step')
  })

  it('supports density preset auto-fill and user manual override', () => {
    const store = useDesignStore.getState()

    // 切换为 6061 铝合金预设
    const alPreset = MATERIAL_PRESETS['6061-t6']
    expect(alPreset.density).toBe(2.70)
    store.setBaseMaterial(projectId, {
      presetId: alPreset.presetId,
      color: alPreset.color,
      metalness: alPreset.metalness,
      roughness: alPreset.roughness,
      opacity: alPreset.opacity,
      density: alPreset.density
    })

    let p = useDesignStore.getState().projects[projectId]
    expect(p.doc.baseBody.materialConfig?.presetId).toBe('6061-t6')
    expect(p.doc.baseBody.materialConfig?.density).toBe(2.70)

    // 用户手动修改密度
    store.setBaseMaterialProperty(projectId, 'density', 2.85)
    p = useDesignStore.getState().projects[projectId]
    expect(p.doc.baseBody.materialConfig?.density).toBe(2.85)
    expect(p.doc.baseBody.materialConfig?.presetId).toBe('custom') // 更改属性后自动标记为自定义预设

    // 切换为 304 不锈钢预设
    const ssPreset = MATERIAL_PRESETS['304-ss']
    expect(ssPreset.density).toBe(7.93)
    store.setBaseMaterial(projectId, {
      presetId: ssPreset.presetId,
      color: ssPreset.color,
      metalness: ssPreset.metalness,
      roughness: ssPreset.roughness,
      opacity: ssPreset.opacity,
      density: ssPreset.density
    })

    p = useDesignStore.getState().projects[projectId]
    expect(p.doc.baseBody.materialConfig?.density).toBe(7.93)
  })

  describe('Face Push/Pull (extrudeFace) and Cavity Follow Behavior', () => {
    it('pushes box top face (+Z) and tests cavitiesFollow toggle', () => {
      // 在 top 面添加一个孔腔
      useDesignStore.setState(
        produce((state: any) => {
          state.projects[projectId].doc.schemes[0].cavities.push({
            instanceId: 'cav-top-1',
            faceId: 'top',
            typeId: 'M10',
            name: 'M10 螺纹孔',
            u: 50,
            v: 40,
            depthOffset: 0
          })
        })
      )

      const store = useDesignStore.getState()

      // 1. cavitiesFollow = true: 顶面增高 10mm (80 -> 90)
      store.extrudeFace(projectId, 'top', 10, true)
      let updatedP = useDesignStore.getState().projects[projectId]
      expect(updatedP.doc.baseBody.dimensions[2]).toBe(90)
      let cav = updatedP.doc.schemes[0].cavities.find((c) => c.instanceId === 'cav-top-1')!
      // 孔腔局部深度偏移保持不变，孔随面移动
      expect(cav.depthOffset).toBe(0)

      // 2. cavitiesFollow = false: 顶面再增高 10mm (90 -> 100)
      store.extrudeFace(projectId, 'top', 10, false)
      updatedP = useDesignStore.getState().projects[projectId]
      expect(updatedP.doc.baseBody.dimensions[2]).toBe(100)
      cav = updatedP.doc.schemes[0].cavities.find((c) => c.instanceId === 'cav-top-1')!
      // 孔腔 depthOffset 补偿增加 10，保持世界绝对坐标不变
      expect(cav.depthOffset).toBe(10)
    })

    it('pushes L-shape top-step and step-wall via paramBinding', () => {
      const store = useDesignStore.getState()
      store.setBaseTemplate(projectId, 'l-shape')
      store.setBaseExtraParams(projectId, { cutX: 48, cutZ: 40 })

      // 推拉 top-step (+Z, 5mm): 台阶抬高 5mm，切口 cutZ 应减少 5mm (40 -> 35)
      store.extrudeFace(projectId, 'top-step', 5)
      let p = useDesignStore.getState().projects[projectId]
      expect(p.doc.baseBody.extraParams?.cutZ).toBe(35)

      // 推拉 step-wall (+X, 8mm): 竖面向外推 8mm，台阶宽度 cutX 应减少 8mm (48 -> 40)
      store.extrudeFace(projectId, 'step-wall', 8)
      p = useDesignStore.getState().projects[projectId]
      expect(p.doc.baseBody.extraParams?.cutX).toBe(40)
    })

    it('pushes T-shape flange-bottom via paramBinding', () => {
      const store = useDesignStore.getState()
      store.setBaseTemplate(projectId, 't-shape')
      store.setBaseExtraParams(projectId, { cutX: 30, cutZ: 40 })

      // 推拉 flange-bottom-left (法向 -Z, 向外推拉 5mm 即翼缘向下延展 5mm，cutZ 应增加 5mm: 40 -> 45)
      store.extrudeFace(projectId, 'flange-bottom-left', 5)
      const p = useDesignStore.getState().projects[projectId]
      expect(p.doc.baseBody.extraParams?.cutZ).toBe(45)
    })
  })
})
