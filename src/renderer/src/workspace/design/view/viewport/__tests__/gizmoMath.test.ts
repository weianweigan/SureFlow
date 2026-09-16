import { describe, it, expect } from 'vitest'
import {
  snapValue,
  buildNearestNeighborChain,
  detectSmartAlignment,
  distSegmentToSegment,
  computeScreenPixelScale
} from '../gizmoMath'

describe('gizmoMath unit test suite', () => {
  describe('snapValue', () => {
    it('should snap to default 1.0mm grid when bypass is false', () => {
      expect(snapValue(12.34, 1.0, false)).toBe(12.0)
      expect(snapValue(12.78, 1.0, false)).toBe(13.0)
      expect(snapValue(0.001, 1.0, false)).toBe(0)
    })

    it('should allow continuous precision when bypass (Shift) is true', () => {
      expect(snapValue(12.3456, 1.0, true)).toBe(12.35)
      expect(snapValue(12.7812, 1.0, true)).toBe(12.78)
    })

    it('should snap to 90.0 degree angle steps correctly', () => {
      expect(snapValue(44.0, 90.0, false)).toBe(0)
      expect(snapValue(46.0, 90.0, false)).toBe(90.0)
      expect(snapValue(178.0, 90.0, false)).toBe(180.0)
      expect(snapValue(269.0, 90.0, false)).toBe(270.0)
    })

    it('should snap to 5.0 degree tilt angle steps correctly', () => {
      expect(snapValue(12.2, 5.0, false)).toBe(10.0)
      expect(snapValue(13.1, 5.0, false)).toBe(15.0)
    })
  })

  describe('buildNearestNeighborChain', () => {
    it('should return single edge for 2 points', () => {
      const pts = [
        { id: 'c1', x: 10, y: 20, radius: 5 },
        { id: 'c2', x: 40, y: 20, radius: 5 }
      ]
      const chain = buildNearestNeighborChain(pts)
      expect(chain).toHaveLength(1)
      expect(chain[0].distance).toBe(30)
      expect(chain[0].clearance).toBe(20)
    })

    it('should return N-1 chain edges for N collinear points', () => {
      const pts = [
        { id: 'c3', x: 60, y: 10, radius: 4 },
        { id: 'c1', x: 10, y: 10, radius: 4 },
        { id: 'c2', x: 35, y: 10, radius: 4 }
      ]
      const chain = buildNearestNeighborChain(pts)
      expect(chain).toHaveLength(2)
      expect(chain[0].fromId).toBe('c1')
      expect(chain[0].toId).toBe('c2')
      expect(chain[0].distance).toBe(25)
      expect(chain[1].fromId).toBe('c2')
      expect(chain[1].toId).toBe('c3')
      expect(chain[1].distance).toBe(25)
    })
  })

  describe('detectSmartAlignment', () => {
    it('should snap to target within tolerance', () => {
      const targets = [
        { id: 't1', x: 50, y: 80 },
        { id: 't2', x: 120, y: 150 }
      ]
      const res = detectSmartAlignment({ x: 50.4, y: 20 }, targets, 1.0)
      expect(res.snapX).toBeDefined()
      expect(res.snapX?.targetId).toBe('t1')
      expect(res.snapX?.x).toBe(50)
      expect(res.snapY).toBeUndefined()
    })
  })

  describe('distSegmentToSegment', () => {
    it('should compute distance between two perpendicular lines', () => {
      // line1: (0, 0, 0) to (10, 0, 0)
      // line2: (5, -5, 5) to (5, 5, 5)
      const d = distSegmentToSegment([0, 0, 0], [10, 0, 0], [5, -5, 5], [5, 5, 5])
      expect(d).toBeCloseTo(5.0, 4)
    })

    it('should compute distance between intersecting lines', () => {
      const d = distSegmentToSegment([0, 0, 0], [10, 0, 0], [5, -5, 0], [5, 5, 0])
      expect(d).toBeCloseTo(0.0, 4)
    })
  })

  describe('computeScreenPixelScale', () => {
    it('should accurately calculate scale under OrthographicCamera', () => {
      const fakeOrthoCam = {
        isOrthographicCamera: true,
        zoom: 2.5
      } as any

      // 1. 归一化模型（内部尺寸 1.0，目标屏幕像素 60px）
      const sNormalized = computeScreenPixelScale(fakeOrthoCam, [0, 0, 0], 60, 1.0)
      expect(sNormalized).toBeCloseTo(60 / 2.5, 4)
      // 验证世界尺寸 * zoom = 屏幕像素
      expect(1.0 * sNormalized * fakeOrthoCam.zoom).toBeCloseTo(60, 4)

      // 2. 像素级模型（内部尺寸 60px，目标保持 60px，即 targetPixels: 1.0, canonical: 1.0）
      const sPixel = computeScreenPixelScale(fakeOrthoCam, [10, 20, 30], 1.0, 1.0)
      expect(sPixel).toBeCloseTo(1.0 / 2.5, 4)
      expect(60 * sPixel * fakeOrthoCam.zoom).toBeCloseTo(60, 4)
    })

    it('should accurately calculate scale under PerspectiveCamera', () => {
      const fakePerspCam = {
        isOrthographicCamera: false,
        fov: 45,
        position: {
          distanceTo: () => 100
        }
      } as any

      const s = computeScreenPixelScale(fakePerspCam, [0, 0, 0], 60, 1.0, 800)
      expect(s).toBeGreaterThan(0)
    })
  })

  describe('CadDimensionLines face outward offset logic', () => {
    const getFaceExtSigns = (faceId: string, uVec: [number, number, number], vVec: [number, number, number]) => {
      const isNegUFace = faceId === 'back' || faceId === 'left' || (uVec[0] + uVec[1] + uVec[2] < -0.5)
      const isNegVFace = faceId === 'bottom' || (vVec[0] + vVec[1] + vVec[2] < -0.5)
      return {
        uExtSign: isNegUFace ? 1 : -1,
        vExtSign: isNegVFace ? 1 : -1
      }
    }

    it('should correctly determine outward offset signs for all 6 orthogonal box faces', () => {
      // top: u=[1,0,0], v=[0,1,0] -> both positive, outward is negative (-1, -1)
      expect(getFaceExtSigns('top', [1, 0, 0], [0, 1, 0])).toEqual({ uExtSign: -1, vExtSign: -1 })

      // bottom: u=[1,0,0], v=[0,-1,0] -> v is negative on face, outward is positive (-1, +1)
      expect(getFaceExtSigns('bottom', [1, 0, 0], [0, -1, 0])).toEqual({ uExtSign: -1, vExtSign: 1 })

      // front: u=[1,0,0], v=[0,0,1] -> both positive, outward is negative (-1, -1)
      expect(getFaceExtSigns('front', [1, 0, 0], [0, 0, 1])).toEqual({ uExtSign: -1, vExtSign: -1 })

      // back: u=[-1,0,0], v=[0,0,1] -> u is negative on face, outward is positive (+1, -1)
      expect(getFaceExtSigns('back', [-1, 0, 0], [0, 0, 1])).toEqual({ uExtSign: 1, vExtSign: -1 })

      // left: u=[0,-1,0], v=[0,0,1] -> u is negative on face, outward is positive (+1, -1)
      expect(getFaceExtSigns('left', [0, -1, 0], [0, 0, 1])).toEqual({ uExtSign: 1, vExtSign: -1 })

      // right: u=[0,1,0], v=[0,0,1] -> both positive, outward is negative (-1, -1)
      expect(getFaceExtSigns('right', [0, 1, 0], [0, 0, 1])).toEqual({ uExtSign: -1, vExtSign: -1 })
    })
  })
})

