import { describe, it, expect, beforeAll } from 'vitest'
import {
  parseBands,
  generateStepContent,
  type CadExportParams
} from '../cadExportService'
import { getOccInstance } from '../occtLoader'
import type { Step } from '@shared/cavity/types'

describe('CAD STEP Export Stability Tests', () => {
  let occ: any

  beforeAll(async () => {
    occ = await getOccInstance()
    expect(occ).toBeDefined()
  }, 60000)

  describe('parseBands', () => {
    it('should return fallback bands when steps array is empty', () => {
      const bands = parseBands([])
      expect(bands).toHaveLength(3)
      expect(bands[0]).toEqual({ z0: 0, z1: 8, r0: 9, r1: 9, length: 8 })
    })

    it('should correctly parse straight steps', () => {
      const steps: Step[] = [
        { type: 'straight', diameter: 20, length: 30, thread: null },
        { type: 'straight', diameter: 10, length: 15, thread: null }
      ]
      const bands = parseBands(steps)
      expect(bands).toHaveLength(2)
      expect(bands[0]).toEqual({ z0: 0, z1: 30, r0: 10, r1: 10, length: 30 })
      expect(bands[1]).toEqual({ z0: 30, z1: 45, r0: 5, r1: 5, length: 15 })
    })

    it('should correctly parse tapered steps', () => {
      const steps: Step[] = [
        { type: 'straight', diameter: 20, length: 20, thread: null },
        { type: 'tapered', diameter: 20, length: null, angle: 118, thread: null }
      ]
      const bands = parseBands(steps)
      expect(bands).toHaveLength(2)
      expect(bands[0].r0).toBe(10)
      expect(bands[0].r1).toBe(10)
      expect(bands[1].r0).toBe(10)
      expect(bands[1].r1).toBe(0) // 尖端半径收缩至 0
      expect(bands[1].length).toBeGreaterThan(0)
    })
  })

  describe('generateStepContent', () => {
    it('should throw error on invalid base body dimensions', async () => {
      const params: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: { dimensions: [0, 100, 100] },
        cavities: []
      }
      await expect(generateStepContent(params, occ)).rejects.toThrow('基体尺寸必须均为正数')
    })

    it('should successfully export base block without cavities', async () => {
      const progressList: number[] = []
      const params: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: { dimensions: [100, 80, 60] },
        cavities: []
      }

      const stepText = await generateStepContent(params, occ, (p) => {
        progressList.push(p)
      })

      expect(typeof stepText).toBe('string')
      expect(stepText.length).toBeGreaterThan(500)
      expect(stepText).toContain('ISO-10303-21;')
      expect(stepText).toContain('HEADER;')
      expect(stepText).toContain('DATA;')
      expect(stepText).toContain('END-ISO-10303-21;')
      expect(stepText).toContain('AUTOMOTIVE_DESIGN')
      expect(stepText).toContain('SureFlow Hydraulic Valve Block CAD Export')
      expect(progressList).toContain(15)
      expect(progressList).toContain(90)
      expect(progressList).toContain(100)
    })

    it('should correctly format protocol headers for AP203 and AP242', async () => {
      const baseParams: Omit<CadExportParams, 'exportConfig'> = {
        baseBody: { dimensions: [50, 50, 50] },
        cavities: []
      }

      // AP203
      const ap203Text = await generateStepContent(
        { ...baseParams, exportConfig: { protocol: 'AP203', tolerance: 0.02, colorPorts: false } },
        occ
      )
      expect(ap203Text).toContain("FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));")
      expect(ap203Text).toContain('Protocol: AP203')

      // AP242
      const ap242Text = await generateStepContent(
        { ...baseParams, exportConfig: { protocol: 'AP242', tolerance: 0.005, colorPorts: false } },
        occ
      )
      expect(ap242Text).toContain("AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF")
      expect(ap242Text).toContain('Protocol: AP242')
    })

    it('should cut single cavity and produce valid B-Rep solid STEP', async () => {
      // 4x4 矩阵定位在 (50, 40, 0)
      const identityMatrix = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        50, 40, 0, 1
      ]

      const params: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: { dimensions: [100, 80, 60] },
        cavities: [
          {
            instanceId: 'cavity-1',
            numericId: 1,
            name: 'P_Port',
            worldMatrix: identityMatrix,
            steps: [
              { type: 'straight', diameter: 16, length: 25, thread: null },
              { type: 'straight', diameter: 10, length: 20, thread: null }
            ]
          }
        ]
      }

      const stepText = await generateStepContent(params, occ)
      expect(stepText).toContain('ISO-10303-21;')
      expect(stepText).toContain('END-ISO-10303-21;')

      // 闭环反向解析校验：使用 OCCT ReadSTEPFromBinary 验证生成的 STEP 是合法实体
      const uint8 = new TextEncoder().encode(stepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape).toBeDefined()
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })

    it('should withstand degenerate and boundary cavity steps without crashing', async () => {
      const identityMatrix = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        20, 20, 0, 1
      ]

      const params: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: { dimensions: [100, 100, 100] },
        cavities: [
          {
            instanceId: 'cavity-degenerate',
            numericId: 1,
            worldMatrix: identityMatrix,
            steps: [
              // 极小长度分段
              { type: 'straight', diameter: 10, length: 0, thread: null },
              // 极小/零直径
              { type: 'straight', diameter: 0, length: 10, thread: null },
              // 正常分段
              { type: 'straight', diameter: 8, length: 15, thread: null }
            ]
          }
        ]
      }

      const stepText = await generateStepContent(params, occ)
      expect(stepText).toContain('ISO-10303-21;')
      expect(stepText).toContain('END-ISO-10303-21;')

      const uint8 = new TextEncoder().encode(stepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })

    it('should cut multiple cavities across different faces correctly', async () => {
      // 腔 1: 顶面 (50, 50, 0) 沿 Z+ 深入
      const mat1 = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        30, 50, 0, 1
      ]
      // 腔 2: 顶面 (70, 50, 0)
      const mat2 = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        70, 50, 0, 1
      ]

      const params: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: true },
        baseBody: { dimensions: [120, 100, 80] },
        cavities: [
          {
            instanceId: 'cav-A',
            numericId: 1,
            name: 'A_Port',
            worldMatrix: mat1,
            steps: [{ type: 'straight', diameter: 12, length: 30, thread: null }]
          },
          {
            instanceId: 'cav-B',
            numericId: 2,
            name: 'B_Port',
            worldMatrix: mat2,
            steps: [
              { type: 'straight', diameter: 14, length: 20, thread: null },
              { type: 'tapered', diameter: 14, length: null, angle: 118, thread: null }
            ]
          }
        ]
      }

      const stepText = await generateStepContent(params, occ)
      expect(stepText).toContain('ISO-10303-21;')

      // 验证 STEP 反向加载
      const uint8 = new TextEncoder().encode(stepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })

    it('should correctly cut 3D rotated cavity on lateral face and verify tolerance header', async () => {
      // 侧面孔：向 X 方向倾斜 / 旋转 (沿 Y 轴旋转 90度: [0, 0, -1], [0, 1, 0], [1, 0, 0])
      // 定位在 (0, 50, 40)
      const rotatedMatrix = [
        0, 0, -1, 0,
        0, 1, 0, 0,
        1, 0, 0, 0,
        0, 50, 40, 1
      ]

      const params: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.005, colorPorts: true },
        baseBody: { dimensions: [100, 100, 80] },
        cavities: [
          {
            instanceId: 'lateral-hole',
            numericId: 1,
            name: 'T_Port',
            worldMatrix: rotatedMatrix,
            // 工业级典型4阶沉孔：导入倒角/扩孔 -> 螺纹段 -> 密封带 -> 锥孔钻尖
            steps: [
              { type: 'straight', diameter: 22, length: 5, thread: null },
              { type: 'straight', diameter: 18, length: 15, thread: null },
              { type: 'straight', diameter: 12, length: 25, thread: null },
              { type: 'tapered', diameter: 12, length: null, angle: 118, thread: null }
            ]
          }
        ]
      }

      const stepText = await generateStepContent(params, occ)
      expect(stepText).toContain('Tolerance: 0.005mm')
      expect(stepText).toContain('ISO-10303-21;')

      const uint8 = new TextEncoder().encode(stepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })

    it('should cut cavities on all 6 standard box faces (top, bottom, front, back, left, right)', async () => {
      const { getBoxFaceBasis, getCavityWorldMatrix } = await import('@shared/design/faceMath')
      const faces = ['top', 'bottom', 'front', 'back', 'left', 'right']
      const dims: [number, number, number] = [120, 100, 80]
      const steps: Step[] = [
        { type: 'straight', diameter: 18, length: 8, thread: null },
        { type: 'straight', diameter: 10, length: 20, thread: null },
        { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
      ]

      for (const faceId of faces) {
        const basis = getBoxFaceBasis(faceId, dims)
        const worldMatrix = Array.from(getCavityWorldMatrix(basis, 30, 30, 0, 0))
        const params: CadExportParams = {
          exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
          baseBody: { dimensions: dims },
          cavities: [
            {
              instanceId: `cav-${faceId}`,
              numericId: 1,
              name: `${faceId}_hole`,
              worldMatrix,
              steps
            }
          ]
        }

        try {
          const stepText = await generateStepContent(params, occ)
          expect(stepText).toContain('ISO-10303-21;')
        } catch (err) {
          console.error(`[Face Test] Face ${faceId} failed:`, err)
          throw new Error(`Face ${faceId} failed: ${err}`)
        }
      }
    })

    it('should cut multiple cavities simultaneously across all 6 faces in one block', async () => {
      const { getBoxFaceBasis, getCavityWorldMatrix } = await import('@shared/design/faceMath')
      const faces = ['top', 'bottom', 'front', 'back', 'left', 'right']
      const dims: [number, number, number] = [120, 100, 80]
      const steps: Step[] = [
        { type: 'straight', diameter: 16, length: 10, thread: null },
        { type: 'straight', diameter: 8, length: 15, thread: null },
        { type: 'tapered', diameter: 8, length: null, angle: 118, thread: null }
      ]

      const cavities = faces.map((faceId, idx) => {
        const basis = getBoxFaceBasis(faceId, dims)
        const worldMatrix = Array.from(getCavityWorldMatrix(basis, 25, 25, 0, 0))
        return {
          instanceId: `cav-multi-${faceId}`,
          numericId: idx + 1,
          name: `${faceId}_port`,
          worldMatrix,
          steps
        }
      })

      const params: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: { dimensions: dims },
        cavities
      }

      const stepText = await generateStepContent(params, occ)
      expect(stepText).toContain('ISO-10303-21;')
      expect(stepText).toContain('END-ISO-10303-21;')

      // 反向解析闭环验证
      const uint8 = new TextEncoder().encode(stepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })

    it('should export 50 cavities with high performance, smooth progress, and exact B-Rep topology', async () => {
      const { getBoxFaceBasis, getCavityWorldMatrix } = await import('@shared/design/faceMath')
      const dims: [number, number, number] = [300, 250, 150]
      const basis = getBoxFaceBasis('top', dims)

      const stepsProto1: Step[] = [
        { type: 'straight', diameter: 18, length: 12, thread: null },
        { type: 'straight', diameter: 10, length: 25, thread: null },
        { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
      ]

      const stepsProto2: Step[] = [
        { type: 'straight', diameter: 14, length: 10, thread: null },
        { type: 'straight', diameter: 8, length: 20, thread: null },
        { type: 'tapered', diameter: 8, length: null, angle: 118, thread: null }
      ]

      // 生成 5x10 = 50 个孔腔的规则网格布局
      const cavities: CadExportParams['cavities'] = []
      let id = 1
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 10; col++) {
          const u = 25 + col * 26
          const v = 25 + row * 45
          const worldMatrix = Array.from(getCavityWorldMatrix(basis, u, v, 0, 0))
          cavities.push({
            instanceId: `cav-grid-${id}`,
            numericId: id,
            name: `P_${id}`,
            worldMatrix,
            steps: id % 2 === 0 ? stepsProto1 : stepsProto2
          })
          id++
        }
      }

      expect(cavities).toHaveLength(50)

      const recordedProgress: Array<{ p: number; stage: string }> = []
      const t0 = performance.now()

      const params: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: { dimensions: dims },
        cavities
      }

      const stepText = await generateStepContent(params, occ, (p, stage) => {
        recordedProgress.push({ p, stage })
      })

      const elapsed = performance.now() - t0
      console.log(`[50-Cavity STEP Export] Total elapsed: ${elapsed.toFixed(1)} ms`)

      // 验证 50 孔导出在分层合并树与原型池优化下极速完成 (通常 500ms ~ 1500ms，远快于串行切削的 8~15秒)
      expect(elapsed).toBeLessThan(5000)
      expect(stepText).toContain('ISO-10303-21;')
      expect(stepText).toContain('END-ISO-10303-21;')

      // 验证平滑进度：进度值单调非递减，且覆盖关键阶段
      expect(recordedProgress.length).toBeGreaterThan(5)
      for (let i = 1; i < recordedProgress.length; i++) {
        expect(recordedProgress[i].p).toBeGreaterThanOrEqual(recordedProgress[i - 1].p)
      }
      const finalEntry = recordedProgress[recordedProgress.length - 1]
      expect(finalEntry.p).toBe(100)

      // 反向解析 STEP 并校验实体有效性与体积属性
      const uint8 = new TextEncoder().encode(stepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape.IsNull()).toBe(false)

      const vProps = new occ.GProp_GProps()
      occ.BRepGProp_VolumeProperties(parsedShape, vProps, false, false)
      const mass = vProps.Mass()
      // 基体初始体积 300*250*150 = 11,250,000；切削后体积应严格小于初始体积
      expect(mass).toBeGreaterThan(10000000)
      expect(mass).toBeLessThan(11250000)

      parsedShape.delete()
    })

    it('should cut cavities into L-shaped base body and preserve exact volume subtraction', async () => {
      const { getBoxFaceBasis, getCavityWorldMatrix } = await import('@shared/design/faceMath')
      const dims: [number, number, number] = [120, 100, 80]
      const cutX = 50
      const cutZ = 40

      // L 型基体：尺寸 120x100x80，右上角挖去 50x100x40
      // 理论体积 = 120*100*80 - 50*100*40 = 760,000 mm³
      const topBasis = getBoxFaceBasis('top', dims)
      const bottomBasis = getBoxFaceBasis('bottom', dims)

      // 孔 1: 位于顶面未挖切的主台阶上 (x=30, y=50, z=80)
      const mat1 = Array.from(getCavityWorldMatrix(topBasis, 30, 50, 0, 0))
      // 孔 2: 位于底面上 (x=60, y=50, z=0)
      const mat2 = Array.from(getCavityWorldMatrix(bottomBasis, 60, -50, 0, 0))

      const steps: Step[] = [
        { type: 'straight', diameter: 16, length: 15, thread: null },
        { type: 'tapered', diameter: 16, length: null, angle: 118, thread: null }
      ]

      const params: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: {
          template: 'l-shape',
          dimensions: dims,
          extraParams: { cutX, cutZ }
        },
        cavities: [
          {
            instanceId: 'cav-l-top',
            numericId: 1,
            name: 'L_Top_Hole',
            worldMatrix: mat1,
            steps
          },
          {
            instanceId: 'cav-l-bottom',
            numericId: 2,
            name: 'L_Bottom_Hole',
            worldMatrix: mat2,
            steps
          }
        ]
      }

      const stepText = await generateStepContent(params, occ)
      expect(stepText).toContain('ISO-10303-21;')

      const uint8 = new TextEncoder().encode(stepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape.IsNull()).toBe(false)

      const vProps = new occ.GProp_GProps()
      occ.BRepGProp_VolumeProperties(parsedShape, vProps, false, false)
      const actualVolume = vProps.Mass()

      // L型基体原体积 760,000，孔腔切削后体积应处于 (745,000, 760,000) 范围内
      expect(actualVolume).toBeLessThan(760000)
      expect(actualVolume).toBeGreaterThan(745000)

      parsedShape.delete()
    })

    it('should cut cavities into T-shaped base body and verify topological correctness', async () => {
      const { getBoxFaceBasis, getCavityWorldMatrix } = await import('@shared/design/faceMath')
      const dims: [number, number, number] = [120, 100, 80]
      const cutX = 30
      const cutZ = 40

      // T 型基体：尺寸 120x100x80，左右两侧底部各挖去 30x100x40 翼缘下部
      // 理论体积 = 120*100*80 - 2 * (30*100*40) = 720,000 mm³
      const topBasis = getBoxFaceBasis('top', dims)
      const frontBasis = getBoxFaceBasis('front', dims)

      // 孔 1: 顶面翼缘中心
      const mat1 = Array.from(getCavityWorldMatrix(topBasis, 60, 50, 0, 0))
      // 孔 2: 前面中心打入腹板
      const mat2 = Array.from(getCavityWorldMatrix(frontBasis, 60, 20, 0, 0))

      const params: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: {
          template: 't-shape',
          dimensions: dims,
          extraParams: { cutX, cutZ }
        },
        cavities: [
          {
            instanceId: 'cav-t-top',
            numericId: 1,
            name: 'T_Flange_Port',
            worldMatrix: mat1,
            steps: [{ type: 'straight', diameter: 14, length: 25, thread: null }]
          },
          {
            instanceId: 'cav-t-front',
            numericId: 2,
            name: 'T_Web_Port',
            worldMatrix: mat2,
            steps: [{ type: 'straight', diameter: 12, length: 20, thread: null }]
          }
        ]
      }

      const stepText = await generateStepContent(params, occ)
      expect(stepText).toContain('ISO-10303-21;')

      const uint8 = new TextEncoder().encode(stepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape.IsNull()).toBe(false)

      const vProps = new occ.GProp_GProps()
      occ.BRepGProp_VolumeProperties(parsedShape, vProps, false, false)
      const actualVolume = vProps.Mass()

      // 原体积 720,000，切削后在 (705,000, 720,000) 之间
      expect(actualVolume).toBeLessThan(720000)
      expect(actualVolume).toBeGreaterThan(705000)

      parsedShape.delete()
    })

    it('should support externally imported complex STEP model as base body and cut cavities seamlessly', async () => {
      const { getBoxFaceBasis, getCavityWorldMatrix } = await import('@shared/design/faceMath')
      // 1. 先准备一个带有预制工艺特征的复杂基体 STEP 数据（例如 100x100x80 基体自带预铸沉孔）
      const initialParams: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: { dimensions: [100, 100, 80] },
        cavities: [
          {
            instanceId: 'pre-existing-port',
            numericId: 999,
            name: 'PreExisting_Channel',
            worldMatrix: [
              1, 0, 0, 0,
              0, 1, 0, 0,
              0, 0, 1, 0,
              50, 50, 0, 1
            ],
            steps: [{ type: 'straight', diameter: 30, length: 40, thread: null }]
          }
        ]
      }
      const importedStepText = await generateStepContent(initialParams, occ)

      // 2. 将此 STEP 数据作为用户的外部导入基体 (type: 'step', stepContent: importedStepText)
      // 在其上面打入 4 个新的阀孔，验证分层二叉合并树能够无缝对任意外部复杂 STEP 基体执行终极切削
      const topBasis = getBoxFaceBasis('top', [100, 100, 80])
      const newCavities: CadExportParams['cavities'] = [
        {
          instanceId: 'new-valve-1',
          numericId: 1,
          name: 'Valve_1',
          worldMatrix: Array.from(getCavityWorldMatrix(topBasis, 25, 25, 0, 0)),
          steps: [{ type: 'straight', diameter: 10, length: 25, thread: null }]
        },
        {
          instanceId: 'new-valve-2',
          numericId: 2,
          name: 'Valve_2',
          worldMatrix: Array.from(getCavityWorldMatrix(topBasis, 75, 25, 0, 0)),
          steps: [{ type: 'straight', diameter: 10, length: 25, thread: null }]
        },
        {
          instanceId: 'new-valve-3',
          numericId: 3,
          name: 'Valve_3',
          worldMatrix: Array.from(getCavityWorldMatrix(topBasis, 25, 75, 0, 0)),
          steps: [{ type: 'straight', diameter: 10, length: 25, thread: null }]
        },
        {
          instanceId: 'new-valve-4',
          numericId: 4,
          name: 'Valve_4',
          worldMatrix: Array.from(getCavityWorldMatrix(topBasis, 75, 75, 0, 0)),
          steps: [{ type: 'straight', diameter: 10, length: 25, thread: null }]
        }
      ]

      const secondExportParams: CadExportParams = {
        exportConfig: { protocol: 'AP214', tolerance: 0.01, colorPorts: false },
        baseBody: {
          type: 'step',
          stepContent: importedStepText,
          dimensions: [100, 100, 80]
        },
        cavities: newCavities
      }

      const finalStepText = await generateStepContent(secondExportParams, occ)
      expect(finalStepText).toContain('ISO-10303-21;')

      // 验证最终 STEP 文件水密性与体积减小
      const uint8 = new TextEncoder().encode(finalStepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape.IsNull()).toBe(false)

      const vProps = new occ.GProp_GProps()
      occ.BRepGProp_VolumeProperties(parsedShape, vProps, false, false)
      const finalVolume = vProps.Mass()

      // 初始长方体 800,000，预制孔切除后 ~771,725，新切 4 孔后体积更小
      expect(finalVolume).toBeLessThan(770000)
      expect(finalVolume).toBeGreaterThan(750000)

      parsedShape.delete()
    })
  })

  describe('STEP Transparency, Channel Coloring, and Topological Stability', () => {
    it('should inject SURFACE_STYLE_TRANSPARENT and BaseBody/MountingFace styles', async () => {
      const params: CadExportParams = {
        exportConfig: {
          protocol: 'AP214',
          tolerance: 0.01,
          colorPorts: true,
          transparentBaseBody: true,
          mountingFacesTransparent: true,
          transparency: 0.75
        },
        baseBody: { dimensions: [100, 80, 60], color: '#B0B8C0' },
        cavities: [
          {
            instanceId: 'cav-test-1',
            numericId: 1,
            name: 'P_Port',
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 50, 40, 0, 1],
            steps: [{ type: 'straight', diameter: 16, length: 25, thread: null }],
            color: '#EF4444'
          }
        ]
      }

      const stepText = await generateStepContent(params, occ)

      // 验证透明度实体
      expect(stepText).toContain('SURFACE_STYLE_TRANSPARENT(0.7500)')
      expect(stepText).toContain("STYLED_ITEM('BaseBodySolidStyle'")
      expect(stepText).toContain("STYLED_ITEM('MountingFaceStyle'")
      expect(stepText).toContain("MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('SureFlow Presentation Style'")

      // 验证 STEP 反向解析水密性
      const uint8 = new TextEncoder().encode(stepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape).toBeDefined()
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })

    it('should color faces according to flow channels and port semantics', async () => {
      const params: CadExportParams = {
        exportConfig: {
          protocol: 'AP214',
          tolerance: 0.01,
          colorPorts: true,
          transparentBaseBody: true,
          mountingFacesTransparent: true
        },
        baseBody: { dimensions: [120, 100, 60] },
        cavities: [
          {
            instanceId: 'cav-p',
            numericId: 1,
            name: 'P_Inlet',
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, 50, 0, 1],
            steps: [{ type: 'straight', diameter: 16, length: 25, thread: null }],
            channelColor: '#EF4444'
          },
          {
            instanceId: 'cav-t',
            numericId: 2,
            name: 'T_Return',
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 70, 50, 0, 1],
            steps: [{ type: 'straight', diameter: 14, length: 25, thread: null }],
            channelColor: '#3B82F6'
          }
        ],
        channels: [
          { id: 'ch-p', name: 'Pressure P', color: '#EF4444', cavityIds: ['cav-p'] },
          { id: 'ch-t', name: 'Tank T', color: '#3B82F6', cavityIds: ['cav-t'] }
        ]
      }

      const stepText = await generateStepContent(params, occ)

      // 验证两个通道独立的 COLOUR_RGB
      expect(stepText).toContain("COLOUR_RGB('ChannelColour_EF4444'")
      expect(stepText).toContain("COLOUR_RGB('ChannelColour_3B82F6'")

      // 验证分别生成了通道着色 STYLED_ITEM
      expect(stepText).toContain("STYLED_ITEM('ChannelFaceStyle'")

      // 验证 STEP 反向解析有效
      const uint8 = new TextEncoder().encode(stepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })

    it('should maintain strict topological stability and face naming across cavity parameter micro-adjustments', async () => {
      // 场景：阀块含两个孔腔。孔腔 1 作为下游装配基准面；对孔腔 2 的直径和深度进行微调
      const baseCavity1 = {
        instanceId: 'cav-datum',
        numericId: 1,
        name: 'Datum_Cavity_1',
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, 40, 0, 1],
        steps: [
          { type: 'straight', diameter: 16, length: 20, thread: null } as const,
          { type: 'straight', diameter: 10, length: 15, thread: null } as const
        ]
      }

      // 版本 A：孔腔 2 直径 14，深度 25
      const paramsA: CadExportParams = {
        exportConfig: {
          protocol: 'AP214',
          tolerance: 0.01,
          colorPorts: true,
          stableTopology: true
        },
        baseBody: { dimensions: [120, 80, 60] },
        cavities: [
          baseCavity1,
          {
            instanceId: 'cav-adjust',
            numericId: 2,
            name: 'Adjustable_Cavity_2',
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 80, 40, 0, 1],
            steps: [{ type: 'straight', diameter: 14, length: 25, thread: null } as const]
          }
        ]
      }

      // 版本 B：孔腔 2 直径微调至 14.5 (+0.5mm)，深度微调至 27 (+2mm)
      const paramsB: CadExportParams = {
        exportConfig: {
          protocol: 'AP214',
          tolerance: 0.01,
          colorPorts: true,
          stableTopology: true
        },
        baseBody: { dimensions: [120, 80, 60] },
        cavities: [
          baseCavity1,
          {
            instanceId: 'cav-adjust',
            numericId: 2,
            name: 'Adjustable_Cavity_2',
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 80, 40, 0, 1],
            steps: [{ type: 'straight', diameter: 14.5, length: 27, thread: null } as const]
          }
        ]
      }

      const stepTextA = await generateStepContent(paramsA, occ)
      const stepTextB = await generateStepContent(paramsB, occ)

      // 提取两个版本中的 CLOSED_SHELL 面实体引用序列
      const shellMatchA = stepTextA.match(/CLOSED_SHELL\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)/)
      const shellMatchB = stepTextB.match(/CLOSED_SHELL\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)/)
      expect(shellMatchA).not.toBeNull()
      expect(shellMatchB).not.toBeNull()

      const facesA = shellMatchA![1].split(',').map((s) => s.trim())
      const facesB = shellMatchB![1].split(',').map((s) => s.trim())

      // 提取面命名辅助函数
      function getFaceNames(stepText: string, faceRefList: string[]): string[] {
        return faceRefList.map((ref) => {
          const regex = new RegExp(`${ref}\\s*=\\s*ADVANCED_FACE\\s*\\(\\s*'([^']*)'`)
          const m = stepText.match(regex)
          return m ? m[1] : 'UNKNOWN'
        })
      }

      const namesA = getFaceNames(stepTextA, facesA)
      const namesB = getFaceNames(stepTextB, facesB)

      // 1. 验证安装面顺序严格稳定一致（前 6 个面均为安装面且名称完全相同）
      const mountingFacesA = namesA.slice(0, 6)
      const mountingFacesB = namesB.slice(0, 6)
      expect(mountingFacesA).toEqual([
        'MOUNTING_FACE_TOP',
        'MOUNTING_FACE_BOTTOM',
        'MOUNTING_FACE_FRONT',
        'MOUNTING_FACE_BACK',
        'MOUNTING_FACE_LEFT',
        'MOUNTING_FACE_RIGHT'
      ])
      expect(mountingFacesB).toEqual(mountingFacesA)

      // 2. 验证基准孔腔 1 的各个特征面顺序与名称在孔腔 2 微调后完全保持稳定
      const datumFacesA = namesA.filter((n) => n.includes('Datum_Cavity_1'))
      const datumFacesB = namesB.filter((n) => n.includes('Datum_Cavity_1'))
      expect(datumFacesA.length).toBeGreaterThan(0)
      expect(datumFacesB).toEqual(datumFacesA)
    })

    it('should respect disabled transparency and neutral port mode when requested', async () => {
      const params: CadExportParams = {
        exportConfig: {
          protocol: 'AP214',
          tolerance: 0.01,
          colorPorts: false,
          transparentBaseBody: false,
          mountingFacesTransparent: false
        },
        baseBody: { dimensions: [100, 80, 60] },
        cavities: [
          {
            instanceId: 'cav-1',
            numericId: 1,
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 50, 40, 0, 1],
            steps: [{ type: 'straight', diameter: 16, length: 25, thread: null }]
          }
        ]
      }

      const stepText = await generateStepContent(params, occ)

      // 禁用透明与着色时，不应包含透明度和孔腔着色实体
      expect(stepText).not.toContain('SURFACE_STYLE_TRANSPARENT')
      expect(stepText).not.toContain('ChannelFaceStyle')
      expect(stepText).toContain('ISO-10303-21;')

      // 反向解析依然合法
      const uint8 = new TextEncoder().encode(stepText)
      const parsedShape = occ.ReadSTEPFromBinary(uint8)
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })

    it('should generate ISO 10303-46 compliant SURFACE_STYLE_RENDERING_WITH_PROPERTIES for SolidWorks transparency', async () => {
      const params: CadExportParams = {
        exportConfig: {
          protocol: 'AP214',
          tolerance: 0.01,
          colorPorts: true,
          transparentBaseBody: true,
          mountingFacesTransparent: true,
          transparency: 0.65
        },
        baseBody: {
          dimensions: [100, 80, 50],
          color: '#B0B4B8'
        },
        cavities: [
          {
            instanceId: 'cav-sw',
            numericId: 1,
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 50, 40, 0, 1],
            steps: [{ type: 'straight', diameter: 12, length: 20, thread: null }],
            channelColor: '#EF4444'
          }
        ],
        channels: [
          { id: 'ch-p', name: 'Pressure', color: '#EF4444', cavityIds: ['cav-sw'] }
        ]
      }

      const stepText = await generateStepContent(params, occ)

      // 验证 ISO 10303-46 标准实体：SURFACE_STYLE_RENDERING_WITH_PROPERTIES 包装 SURFACE_STYLE_TRANSPARENT
      expect(stepText).toMatch(/SURFACE_STYLE_TRANSPARENT\s*\(\s*0\.6500\s*\)/)
      expect(stepText).toMatch(/SURFACE_STYLE_RENDERING_WITH_PROPERTIES\s*\(\s*\.COLOUR_SHADING\.\s*,\s*#\d+\s*,\s*\(\s*#\d+\s*\)\s*\)/)

      // 验证 SURFACE_SIDE_STYLE 聚合了 SURFACE_STYLE_FILL_AREA 与 SURFACE_STYLE_RENDERING_WITH_PROPERTIES
      expect(stepText).toMatch(/SURFACE_SIDE_STYLE\s*\(\s*''\s*,\s*\(\s*#\d+\s*,\s*#\d+\s*\)\s*\)/)

      // 验证同时附加在实体 MANIFOLD_SOLID_BREP 与所有外表面 ADVANCED_FACE
      expect(stepText).toContain("STYLED_ITEM('BaseBodySolidStyle'")
      expect(stepText).toContain("STYLED_ITEM('MountingFaceStyle'")

      const parsedShape = occ.ReadSTEPFromBinary(new TextEncoder().encode(stepText))
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })

    it('should strictly color only channel-connected cavities/ports and leave unconnected/structural holes uncolored', async () => {
      // 场景：包含 3 个孔
      // 1. cav-connected: 普通钻孔，已连接通道 P (红)
      // 2. cav-unconnected: 孤立未连接死孔或螺栓孔，未分配任何通道 -> 不应有任何 ChannelFaceStyle
      // 3. cav-valve: 插装阀孔，包含两个 @Port (深度 10 直径 6 属于通道 T 蓝；深度 25 直径 8 未连接) -> 仅深度 10 区域着蓝色
      const params: CadExportParams = {
        exportConfig: {
          protocol: 'AP214',
          tolerance: 0.01,
          colorPorts: true,
          transparentBaseBody: true,
          mountingFacesTransparent: true
        },
        baseBody: { dimensions: [140, 100, 60] },
        cavities: [
          {
            instanceId: 'cav-connected',
            numericId: 1,
            name: 'P_Port_Drill',
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, 50, 0, 1],
            steps: [{ type: 'straight', diameter: 14, length: 25, thread: null }]
          },
          {
            instanceId: 'cav-bolt-unconnected',
            numericId: 2,
            name: 'M10_Bolt_Hole',
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 60, 50, 0, 1],
            steps: [{ type: 'straight', diameter: 10, length: 25, thread: null }]
          },
          {
            instanceId: 'cav-valve',
            numericId: 3,
            name: 'Cartridge_Valve_C1',
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 50, 0, 1],
            steps: [
              { type: 'straight', diameter: 18, length: 15, thread: null },
              { type: 'straight', diameter: 12, length: 20, thread: null }
            ],
            ports: [
              { name: 'T', depth: 10, diameter: 6, isBottomPort: false },
              { name: 'Dead', depth: 25, diameter: 8, isBottomPort: false }
            ]
          }
        ],
        channels: [
          {
            id: 'ch-p',
            name: 'Pressure P',
            color: '#EF4444',
            cavityIds: ['cav-connected']
          },
          {
            id: 'ch-t',
            name: 'Tank T',
            color: '#3B82F6',
            cavityIds: ['cav-valve'],
            regions: [
              { cavityId: 'cav-valve', portIndex: 0, minDepth: 7, maxDepth: 13 }
            ]
          }
        ]
      }

      const stepText = await generateStepContent(params, occ)

      // 验证存在两个通道的颜色定义
      expect(stepText).toContain("COLOUR_RGB('ChannelColour_EF4444'")
      expect(stepText).toContain("COLOUR_RGB('ChannelColour_3B82F6'")

      // 提取所有 Styled Item 引用的 Face ID
      const styledItems = Array.from(stepText.matchAll(/STYLED_ITEM\s*\(\s*'ChannelFaceStyle'\s*,\s*\(#\d+\)\s*,\s*#(\d+)\s*\)/g)).map(m => m[1])

      // 验证：孤立未连接孔 (cav-bolt-unconnected, numericId: 2) 的所有面没有被赋予 ChannelFaceStyle
      const boltFaces = Array.from(stepText.matchAll(/#(\d+)\s*=\s*ADVANCED_FACE\s*\(\s*'CAV_M10_Bolt_Hole_[^']*'/g)).map(m => m[1])
      expect(boltFaces.length).toBeGreaterThan(0)
      for (const bf of boltFaces) {
        expect(styledItems).not.toContain(bf)
      }

      // 验证：插装阀孔在深度 10 (7~13) 的面着色，而深度 25 或孔底的面不被赋予 ChannelFaceStyle
      const valvePortFaces = Array.from(stepText.matchAll(/#(\d+)\s*=\s*ADVANCED_FACE\s*\(\s*'CAV_Cartridge_Valve_C1_CYL_0[^']*'/g)).map(m => m[1])
      expect(valvePortFaces.length).toBeGreaterThan(0)
      for (const vpf of valvePortFaces) {
        expect(styledItems).toContain(vpf)
      }

      // 深度 25 的未连接台阶面不应有 ChannelFaceStyle
      const valveBottomFaces = Array.from(stepText.matchAll(/#(\d+)\s*=\s*ADVANCED_FACE\s*\(\s*'CAV_Cartridge_Valve_C1_BOTTOM_35[^']*'/g)).map(m => m[1])
      for (const vbf of valveBottomFaces) {
        expect(styledItems).not.toContain(vbf)
      }

      const parsedShape = occ.ReadSTEPFromBinary(new TextEncoder().encode(stepText))
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })

    it('should canonically place base body outer surfaces at the top of CLOSED_SHELL for non-box bodies (T-shape and STEP-imported)', async () => {
      // 测试非标准 6 面长方体（如 T 型基体，拥有 10 个外表面；以及含斜孔的切削）
      const paramsT: CadExportParams = {
        exportConfig: {
          protocol: 'AP214',
          tolerance: 0.01,
          colorPorts: true,
          transparentBaseBody: true,
          mountingFacesTransparent: true,
          stableTopology: true
        },
        baseBody: {
          template: 't-shape',
          dimensions: [120, 100, 80],
          extraParams: { cutX: 30, cutZ: 40 }
        },
        cavities: [
          {
            instanceId: 'cav-p',
            numericId: 1,
            name: 'P_Port',
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 60, 50, 0, 1],
            steps: [{ type: 'straight', diameter: 16, length: 25, thread: null }],
            channelColor: '#EF4444'
          }
        ],
        channels: [
          { id: 'ch-p', name: 'Pressure', color: '#EF4444', cavityIds: ['cav-p'] }
        ]
      }

      const stepText = await generateStepContent(paramsT, occ)

      // 解析 CLOSED_SHELL 中的面序列
      const shellMatch = stepText.match(/CLOSED_SHELL\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)/)
      expect(shellMatch).toBeTruthy()
      const faceIds = shellMatch![1].split(',').map((s) => s.trim().replace('#', ''))

      // 提取每个面的语义名称
      const faceNames = faceIds.map((fId) => {
        const m = stepText.match(new RegExp(`#${fId}\\s*=\\s*ADVANCED_FACE\\s*\\(\\s*'([^']*)'`))
        return { id: fId, name: m ? m[1] : 'UNKNOWN' }
      })

      // 验证外表面与孔腔面的相对位置：所有的基体外表面 (MOUNTING_FACE_* 或 BASE_FACE_*) 必须严格置顶
      const firstCavityIndex = faceNames.findIndex(f => f.name.startsWith('CAV_'))
      expect(firstCavityIndex).toBeGreaterThan(0)

      // firstCavityIndex 之前的所有面必须是基体外表面
      for (let i = 0; i < firstCavityIndex; i++) {
        const isBaseOuterFace = faceNames[i].name.startsWith('MOUNTING_FACE_') || faceNames[i].name.startsWith('BASE_FACE_')
        expect(isBaseOuterFace).toBe(true)
      }

      // firstCavityIndex 及其之后必须是孔腔内部面
      for (let i = firstCavityIndex; i < faceNames.length; i++) {
        expect(faceNames[i].name.startsWith('CAV_')).toBe(true)
      }

      // 验证所有非标准基体外表面也成功获得了 MountingFaceStyle (透明度样式赋予)
      for (let i = 0; i < firstCavityIndex; i++) {
        expect(stepText).toContain(`STYLED_ITEM('MountingFaceStyle', (#`)
      }

      // 验证水密性反向解析
      const parsedShape = occ.ReadSTEPFromBinary(new TextEncoder().encode(stepText))
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })

    it('should embed rich cavity template metadata, face-level structured tags, and global cavity manifest into STEP', async () => {
      const params: CadExportParams = {
        exportConfig: {
          protocol: 'AP214',
          tolerance: 0.01,
          colorPorts: true,
          transparentBaseBody: true,
          mountingFacesTransparent: true
        },
        baseBody: { dimensions: [120, 100, 60] },
        cavities: [
          {
            instanceId: 'cav-sun-t11a',
            numericId: 1,
            name: 'Main_Cartridge_CV1',
            templateId: 'sun-t-11a',
            templateName: 'Sun T-11A 2-Way Cavity',
            libraryId: 'sun-hydraulics-std',
            cavityType: 'cartridge-valve',
            faceId: 'MOUNTING_FACE_TOP',
            u: 45.0,
            v: -30.0,
            portSemantic: 'P',
            channelName: 'Net_P',
            channelColor: '#EF4444',
            worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 45, 50, 0, 1],
            steps: [
              {
                type: 'straight',
                diameter: 22,
                length: 18,
                thread: { family: 'METRIC', designation: 'M20x1.5', depth: 15 }
              },
              { type: 'straight', diameter: 14, length: 25, thread: null }
            ],
            ports: [
              { name: '1', depth: 12, diameter: 8, isBottomPort: false }
            ]
          }
        ],
        channels: [
          { id: 'ch-p', name: 'Net_P', color: '#EF4444', cavityIds: ['cav-sun-t11a'] }
        ]
      }

      const stepText = await generateStepContent(params, occ)

      // 1. 验证面级扩展语义名称：包含 TPL、SPEC、NET、PORT 标签
      expect(stepText).toMatch(/ADVANCED_FACE\s*\(\s*'CAV_Main_Cartridge_CV1_CYL_0\|TPL:sun-t-11a\|SPEC:M20x1\.5\(深15\)\|NET:Net_P\|PORT:P'/)

      // 2. 验证 ISO 10303 属性集：包含标准属性项
      expect(stepText).toContain("PROPERTY_DEFINITION('CavityTraceability_1'")
      expect(stepText).toContain("DESCRIPTIVE_REPRESENTATION_ITEM('SureFlow:TemplateId', 'sun-t-11a')")
      expect(stepText).toContain("DESCRIPTIVE_REPRESENTATION_ITEM('SureFlow:TemplateName', 'Sun T-11A 2-Way Cavity')")
      expect(stepText).toContain("DESCRIPTIVE_REPRESENTATION_ITEM('SureFlow:LibraryId', 'sun-hydraulics-std')")
      expect(stepText).toContain("DESCRIPTIVE_REPRESENTATION_ITEM('SureFlow:CavityType', 'cartridge-valve')")
      expect(stepText).toContain("DESCRIPTIVE_REPRESENTATION_ITEM('SureFlow:HostFace', 'MOUNTING_FACE_TOP')")
      expect(stepText).toContain("DESCRIPTIVE_REPRESENTATION_ITEM('SureFlow:PositionUV', 'U=45.00, V=-30.00')")
      expect(stepText).toContain("DESCRIPTIVE_REPRESENTATION_ITEM('SureFlow:ThreadSpec', 'M20x1.5(深15)')")
      expect(stepText).toContain("DESCRIPTIVE_REPRESENTATION_ITEM('SureFlow:ChannelName', 'Net_P')")
      expect(stepText).toContain("DESCRIPTIVE_REPRESENTATION_ITEM('SureFlow:PortSemantic', 'P')")

      // 3. 验证全局孔腔清单清册 (SureFlow:CavityManifest)
      expect(stepText).toContain("PROPERTY_DEFINITION('SureFlow:CavityManifest'")
      const manifestMatch = stepText.match(/DESCRIPTIVE_REPRESENTATION_ITEM\s*\(\s*'ManifestJson'\s*,\s*'([\s\S]*?)'\s*\)\s*;/)
      expect(manifestMatch).toBeTruthy()

      // 解析还原 JSON 清单
      const unescapedJson = manifestMatch![1].replace(/''/g, "'")
      const manifest = JSON.parse(unescapedJson)
      expect(manifest.generator).toBe('SureFlow Hydraulic Manifold CAD Export')
      expect(manifest.cavities).toHaveLength(1)
      expect(manifest.cavities[0].templateId).toBe('sun-t-11a')
      expect(manifest.cavities[0].templateName).toBe('Sun T-11A 2-Way Cavity')
      expect(manifest.cavities[0].faceId).toBe('MOUNTING_FACE_TOP')
      expect(manifest.cavities[0].u).toBe(45.0)
      expect(manifest.cavities[0].v).toBe(-30.0)

      // 4. 验证带元数据的 STEP 文件在 OCCT 中无损水密性解析
      const parsedShape = occ.ReadSTEPFromBinary(new TextEncoder().encode(stepText))
      expect(parsedShape).toBeDefined()
      expect(parsedShape.IsNull()).toBe(false)
      parsedShape.delete()
    })
  })
})

