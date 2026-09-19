import { describe, it, expect } from 'vitest'
import { mapFaceIdToViewPreset, determineObservedFacePreset } from '../faceMath'

describe('faceViewMath', () => {
  describe('mapFaceIdToViewPreset', () => {
    it('correctly maps various top face identifiers', () => {
      expect(mapFaceIdToViewPreset('top')).toBe('top')
      expect(mapFaceIdToViewPreset('TOP')).toBe('top')
      expect(mapFaceIdToViewPreset('+z')).toBe('top')
      expect(mapFaceIdToViewPreset('+Z')).toBe('top')
    })

    it('correctly maps bottom face identifiers', () => {
      expect(mapFaceIdToViewPreset('bottom')).toBe('bottom')
      expect(mapFaceIdToViewPreset('bot')).toBe('bottom')
      expect(mapFaceIdToViewPreset('-z')).toBe('bottom')
    })

    it('correctly maps front face identifiers', () => {
      expect(mapFaceIdToViewPreset('front')).toBe('front')
      expect(mapFaceIdToViewPreset('-y')).toBe('front')
      expect(mapFaceIdToViewPreset('wall')).toBe('front')
    })

    it('correctly maps back face identifiers', () => {
      expect(mapFaceIdToViewPreset('back')).toBe('back')
      expect(mapFaceIdToViewPreset('+y')).toBe('back')
    })

    it('correctly maps left face identifiers', () => {
      expect(mapFaceIdToViewPreset('left')).toBe('left')
      expect(mapFaceIdToViewPreset('-x')).toBe('left')
    })

    it('correctly maps right face identifiers', () => {
      expect(mapFaceIdToViewPreset('right')).toBe('right')
      expect(mapFaceIdToViewPreset('+x')).toBe('right')
    })

    it('returns null for empty or invalid inputs', () => {
      expect(mapFaceIdToViewPreset(null)).toBeNull()
      expect(mapFaceIdToViewPreset(undefined)).toBeNull()
      expect(mapFaceIdToViewPreset('')).toBeNull()
      expect(mapFaceIdToViewPreset('invalid_face')).toBeNull()
    })
  })

  describe('determineObservedFacePreset', () => {
    const defaultDims: [number, number, number] = [100, 100, 100]

    it('identifies top face when looking straight down', () => {
      // 相机在 +Z，看向 -Z（即物体中心）
      expect(determineObservedFacePreset({ x: 0, y: 0, z: -1 }, defaultDims)).toBe('top')
    })

    it('identifies bottom face when looking straight up', () => {
      // 相机在 -Z，看向 +Z
      expect(determineObservedFacePreset({ x: 0, y: 0, z: 1 }, defaultDims)).toBe('bottom')
    })

    it('identifies front face when looking from front (-Y to +Y)', () => {
      // 相机在 -Y，看向 +Y
      expect(determineObservedFacePreset({ x: 0, y: 1, z: 0 }, defaultDims)).toBe('front')
    })

    it('identifies back face when looking from back (+Y to -Y)', () => {
      // 相机在 +Y，看向 -Y
      expect(determineObservedFacePreset({ x: 0, y: -1, z: 0 }, defaultDims)).toBe('back')
    })

    it('identifies left face when looking from left (-X to +X)', () => {
      // 相机在 -X，看向 +X
      expect(determineObservedFacePreset({ x: 1, y: 0, z: 0 }, defaultDims)).toBe('left')
    })

    it('identifies right face when looking from right (+X to -X)', () => {
      // 相机在 +X，看向 -X
      expect(determineObservedFacePreset({ x: -1, y: 0, z: 0 }, defaultDims)).toBe('right')
    })

    it('prioritizes directly observed face when angle is small even if another face has larger area', () => {
      // 假设长方体为扁平薄板：sx=200, sy=200, sz=30（top 面极大 40000，front 面较小 6000）
      const flatDims: [number, number, number] = [200, 200, 30]
      // 用户视角明显偏向前视：从前方轻微斜看 (如 y=0.92, z=-0.2, x=0.1)
      const dirTowardsFront = { x: 0.1, y: 0.92, z: -0.2 }
      expect(determineObservedFacePreset(dirTowardsFront, flatDims)).toBe('front')
    })

    it('selects the face with largest projected area when observing from isometric angle', () => {
      // 等轴侧俯视观察：相机位于 (+X, -Y, +Z)，看向 (-X, +Y, -Z)
      const isoDir = { x: -1, y: 1, z: -1 }

      // 1. 顶面面积最大 (150*150=22500, 其余 150*60=9000)
      expect(determineObservedFacePreset(isoDir, [150, 150, 60])).toBe('top')

      // 2. 前表面面积最大 (sx=150, sy=60, sz=150 -> front: 150*150=22500, top: 150*60=9000, right: 60*150=9000)
      expect(determineObservedFacePreset(isoDir, [150, 60, 150])).toBe('front')

      // 3. 右侧面面积最大 (sx=60, sy=150, sz=150 -> right: 150*150=22500, top: 60*150=9000, front: 60*150=9000)
      expect(determineObservedFacePreset(isoDir, [60, 150, 150])).toBe('right')
    })
  })
})
