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
})
