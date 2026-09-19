import { describe, it, expect } from 'vitest'
import { getOccInstance } from '../occtLoader'
import { buildOcctBaseSolid, extractBRepFacesAndMesh } from '../occtBaseSolidBuilder'

describe('occtBaseSolidBuilder', () => {
  it('builds Box and extracts 6 topological B-Rep faces with paramBindings', async () => {
    const occ = await getOccInstance()
    const boxBody = {
      template: 'box' as const,
      dimensions: [120, 100, 80] as [number, number, number]
    }
    const solid = buildOcctBaseSolid(boxBody, occ)
    expect(solid).toBeDefined()
    expect(solid.IsNull()).toBe(false)

    const result = extractBRepFacesAndMesh(occ, solid, boxBody)
    solid.delete()

    expect(result.faces.length).toBe(6)
    const faceIds = result.faces.map(f => f.id)
    expect(faceIds).toContain('top')
    expect(faceIds).toContain('bottom')
    expect(faceIds).toContain('left')
    expect(faceIds).toContain('right')
    expect(faceIds).toContain('front')
    expect(faceIds).toContain('back')

    const topFace = result.faces.find(f => f.id === 'top')!
    expect(topFace.normal).toEqual([0, 0, 1])
    expect(topFace.origin).toEqual([0, 0, 80])
    expect(topFace.paramBinding?.key).toBe('sz')
    expect(topFace.paramBinding?.sign).toBe(1)
  })

  it('builds L-Shape and extracts 8 topological B-Rep faces including step-top and step-wall', async () => {
    const occ = await getOccInstance()
    const lBody = {
      template: 'l-shape' as const,
      dimensions: [120, 100, 80] as [number, number, number],
      extraParams: { cutX: 48, cutZ: 40 }
    }
    const solid = buildOcctBaseSolid(lBody, occ)
    expect(solid.IsNull()).toBe(false)

    const result = extractBRepFacesAndMesh(occ, solid, lBody)
    solid.delete()

    expect(result.faces.length).toBe(8)
    const faceIds = result.faces.map(f => f.id)
    expect(faceIds).toContain('top-main')
    expect(faceIds).toContain('top-step')
    expect(faceIds).toContain('step-wall')

    const stepTop = result.faces.find(f => f.id === 'top-step')!
    expect(stepTop.normal).toEqual([0, 0, 1])
    expect(stepTop.origin).toEqual([0, 0, 40])
    expect(stepTop.paramBinding?.key).toBe('cutZ')
    expect(stepTop.paramBinding?.sign).toBe(-1)

    const stepWall = result.faces.find(f => f.id === 'step-wall')!
    expect(stepWall.normal).toEqual([1, 0, 0])
    expect(stepWall.origin).toEqual([72, 0, 0])
    expect(stepWall.paramBinding?.key).toBe('cutX')
    expect(stepWall.paramBinding?.sign).toBe(-1)
  })

  it('builds T-Shape and extracts 10 topological B-Rep faces', async () => {
    const occ = await getOccInstance()
    const tBody = {
      template: 't-shape' as const,
      dimensions: [120, 100, 80] as [number, number, number],
      extraParams: { cutX: 30, cutZ: 40 }
    }
    const solid = buildOcctBaseSolid(tBody, occ)
    expect(solid.IsNull()).toBe(false)

    const result = extractBRepFacesAndMesh(occ, solid, tBody)
    solid.delete()

    expect(result.faces.length).toBe(10)
    const faceIds = result.faces.map(f => f.id)
    expect(faceIds).toContain('top-flange')
    expect(faceIds).toContain('flange-bottom-left')
    expect(faceIds).toContain('flange-bottom-right')
    expect(faceIds).toContain('left-web')
    expect(faceIds).toContain('right-web')
  })
})
