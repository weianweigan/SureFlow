import { describe, it, expect } from 'vitest'
import {
  getBaseFaceBasis,
  detectBaseBodyFace,
  localToWorldPoint,
  worldToLocalPoint
} from '../faceMath'
import type { BaseBodyConfig } from '../types'

describe('BaseBody Face Math & Unified Selection', () => {
  const lShapeBody: BaseBodyConfig = {
    type: 'template',
    template: 'l-shape',
    dimensions: [120, 100, 80],
    faces: [],
    extraParams: {
      cutX: 48, // 120 * 0.4
      cutZ: 40  // 80 * 0.5
    }
  }

  const tShapeBody: BaseBodyConfig = {
    type: 'template',
    template: 't-shape',
    dimensions: [120, 100, 80],
    faces: [],
    extraParams: {
      cutX: 30, // 120 * 0.25
      cutZ: 40  // 80 * 0.5
    }
  }

  describe('L-Shape Face Detection and Basis', () => {
    it('accurately identifies step floor vs main top face', () => {
      // 台阶顶面: X >= 72 (120 - 48), Z = 40 (80 - 40)
      const hitStep = detectBaseBodyFace(
        { x: 0, y: 0, z: 1 },
        { x: 90, y: 50, z: 40 },
        lShapeBody
      )
      expect(hitStep).toBe('top-step')

      // 主顶面: X < 72, Z = 80
      const hitMain = detectBaseBodyFace(
        { x: 0, y: 0, z: 1 },
        { x: 30, y: 50, z: 80 },
        lShapeBody
      )
      expect(hitMain).toBe('top-main')
    })

    it('accurately identifies step wall vs outer right face', () => {
      // 阶梯竖面: X = 72, Z in [40, 80], normal +X
      const hitWall = detectBaseBodyFace(
        { x: 1, y: 0, z: 0 },
        { x: 72, y: 50, z: 60 },
        lShapeBody
      )
      expect(hitWall).toBe('step-wall')

      // 右外侧面: X = 120, Z in [0, 40], normal +X
      const hitRight = detectBaseBodyFace(
        { x: 1, y: 0, z: 0 },
        { x: 120, y: 50, z: 20 },
        lShapeBody
      )
      expect(hitRight).toBe('right')
    })

    it('computes correct basis and local/world roundtrip for top-step and step-wall', () => {
      const stepBasis = getBaseFaceBasis('top-step', lShapeBody.dimensions, lShapeBody)
      expect(stepBasis.origin).toEqual([0, 0, 40])
      expect(stepBasis.w).toEqual([0, 0, 1])

      // 验证局部到世界坐标映射
      const worldP = localToWorldPoint(stepBasis, 80, 50, 0)
      expect(worldP).toEqual([80, 50, 40])
      const localP = worldToLocalPoint(stepBasis, worldP)
      expect(localP.u).toBeCloseTo(80)
      expect(localP.v).toBeCloseTo(50)

      const wallBasis = getBaseFaceBasis('step-wall', lShapeBody.dimensions, lShapeBody)
      expect(wallBasis.origin).toEqual([72, 0, 0])
      expect(wallBasis.w).toEqual([1, 0, 0])
      expect(wallBasis.u).toEqual([0, 1, 0])
      expect(wallBasis.v).toEqual([0, 0, 1])
    })
  })

  describe('T-Shape Face Detection and Basis', () => {
    it('accurately distinguishes flange bottom faces from web bottom', () => {
      // 左翼缘底面: X in [0, 30], Z = 40, normal -Z
      const hitLeftFlangeBot = detectBaseBodyFace(
        { x: 0, y: 0, z: -1 },
        { x: 15, y: 50, z: 40 },
        tShapeBody
      )
      expect(hitLeftFlangeBot).toBe('flange-bottom-left')

      // 右翼缘底面: X in [90, 120], Z = 40, normal -Z
      const hitRightFlangeBot = detectBaseBodyFace(
        { x: 0, y: 0, z: -1 },
        { x: 105, y: 50, z: 40 },
        tShapeBody
      )
      expect(hitRightFlangeBot).toBe('flange-bottom-right')

      // 腹板底面: X in [30, 90], Z = 0, normal -Z
      const hitWebBot = detectBaseBodyFace(
        { x: 0, y: 0, z: -1 },
        { x: 60, y: 50, z: 0 },
        tShapeBody
      )
      expect(hitWebBot).toBe('bottom-web')
    })

    it('distinguishes web side walls from flange outer faces', () => {
      // 腹板左侧面: X = 30, Z in [0, 40], normal -X
      const hitLeftWeb = detectBaseBodyFace(
        { x: -1, y: 0, z: 0 },
        { x: 30, y: 50, z: 20 },
        tShapeBody
      )
      expect(hitLeftWeb).toBe('left-web')

      // 腹板右侧面: X = 90, Z in [0, 40], normal +X
      const hitRightWeb = detectBaseBodyFace(
        { x: 1, y: 0, z: 0 },
        { x: 90, y: 50, z: 20 },
        tShapeBody
      )
      expect(hitRightWeb).toBe('right-web')
    })

    it('computes correct basis for T-shape faces', () => {
      const leftWebBasis = getBaseFaceBasis('left-web', tShapeBody.dimensions, tShapeBody)
      expect(leftWebBasis.origin).toEqual([30, 0, 0])
      expect(leftWebBasis.w).toEqual([-1, 0, 0])

      const rightWebBasis = getBaseFaceBasis('right-web', tShapeBody.dimensions, tShapeBody)
      expect(rightWebBasis.origin).toEqual([90, 0, 0])
      expect(rightWebBasis.w).toEqual([1, 0, 0])
    })
  })

  describe('STEP Face Detection and Custom Basis', () => {
    const stepBody: BaseBodyConfig = {
      type: 'step',
      dimensions: [150, 120, 90],
      faces: [
        {
          id: 'step-face-top',
          name: '主顶面 (+Z)',
          type: 'plane',
          normal: [0, 0, 1],
          origin: [0, 0, 90],
          u: [1, 0, 0],
          v: [0, 1, 0]
        },
        {
          id: 'step-face-notch',
          name: '凹槽底面 (+Z)',
          type: 'plane',
          normal: [0, 0, 1],
          origin: [0, 0, 50],
          u: [1, 0, 0],
          v: [0, 1, 0]
        }
      ]
    }

    it('matches custom planar faces by normal and plane distance', () => {
      const hitNotch = detectBaseBodyFace(
        { x: 0, y: 0, z: 1 },
        { x: 60, y: 60, z: 50 },
        stepBody
      )
      expect(hitNotch).toBe('step-face-notch')

      const hitTop = detectBaseBodyFace(
        { x: 0, y: 0, z: 1 },
        { x: 60, y: 60, z: 90 },
        stepBody
      )
      expect(hitTop).toBe('step-face-top')
    })
  })

  describe('Cross-Shape Face Detection and Cross-Face Translation', () => {
    const crossBody: BaseBodyConfig = {
      type: 'template',
      template: 'cross-shape',
      dimensions: [120, 100, 80],
      faces: [],
      extraParams: {
        cutX: 30, // 30mm on left and right
        cutZ: 20  // 20mm on top and bottom
      }
    }

    it('accurately identifies cross horizontal wing faces vs vertical column faces', () => {
      // 竖柱顶面: X in [30, 90], Z = 80, normal +Z
      const hitTop = detectBaseBodyFace(
        { x: 0, y: 0, z: 1 },
        { x: 60, y: 50, z: 80 },
        crossBody
      )
      expect(hitTop).toBe('top-center')

      // 左下凹槽顶面: X in [0, 30], Z = 20, normal +Z
      const hitLeftBotUp = detectBaseBodyFace(
        { x: 0, y: 0, z: 1 },
        { x: 15, y: 50, z: 20 },
        crossBody
      )
      expect(hitLeftBotUp).toBe('bot-left-up')

      // 右下凹槽顶面: X in [90, 120], Z = 20, normal +Z
      const hitRightBotUp = detectBaseBodyFace(
        { x: 0, y: 0, z: 1 },
        { x: 105, y: 50, z: 20 },
        crossBody
      )
      expect(hitRightBotUp).toBe('bot-right-up')

      // 左上凹槽底面: X in [0, 30], Z = 60, normal -Z
      const hitLeftTopDown = detectBaseBodyFace(
        { x: 0, y: 0, z: -1 },
        { x: 15, y: 50, z: 60 },
        crossBody
      )
      expect(hitLeftTopDown).toBe('top-left-down')
    })

    it('computes correct basis origins and paramBindings for cross-shape', () => {
      const basisTop = getBaseFaceBasis('top-center', crossBody.dimensions, crossBody)
      expect(basisTop.origin).toEqual([0, 0, 80])
      expect(basisTop.w).toEqual([0, 0, 1])

      const basisBotLeftUp = getBaseFaceBasis('bot-left-up', crossBody.dimensions, crossBody)
      expect(basisBotLeftUp.origin).toEqual([0, 0, 20])
      expect(basisBotLeftUp.w).toEqual([0, 0, 1])
    })

    it('translates cavity coordinates between different faces accurately', () => {
      // Cavity starts on 'top' at (u=60, v=50) -> world position is (60, 50, 80)
      const topBasis = getBaseFaceBasis('top', crossBody.dimensions, crossBody)
      const worldP = localToWorldPoint(topBasis, 60, 50, 0)
      expect(worldP).toEqual([60, 50, 80])

      // Dragged onto 'front' face (Z=80 for front, normal +Y or +Z depending on axis convention)
      const frontBasis = getBaseFaceBasis('front', crossBody.dimensions, crossBody)
      // Front face: origin is (0, 0, 0) or projected, normal is +Y (0, 1, 0), u is +X (1, 0, 0), v is +Z (0, 0, 1)
      const localFront = worldToLocalPoint(frontBasis, worldP)
      expect(localFront.u).toBeCloseTo(60)
      expect(localFront.v).toBeCloseTo(80)
    })
  })
})

