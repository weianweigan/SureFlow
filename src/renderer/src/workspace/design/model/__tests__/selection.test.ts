import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createDefaultProject, type CavityInstance, type CavityGroup } from '@shared/design/types'
import { promoteFeatures, matchesMarquee } from '../selectionMath'
vi.mock('@renderer/workspace/layout/layoutStore', () => ({ useWorkspaceStore: { getState: () => ({}) } }))
import { useDesignStore } from '../designStore'

const cavity = (id: string, u: number, groupId?: string): CavityInstance => ({
  instanceId: id, u, v: 20.123, faceId: 'top', groupId,
  depthOffset: 0, rotation: 0
} as CavityInstance)
const groups: CavityGroup[] = [
  { id: 'a', name: 'A', cavityIds: ['a1', 'a2'], u: 15, v: 20, faceId: 'top' },
  { id: 'b', name: 'B', cavityIds: ['b1', 'b2'], u: 45, v: 20, faceId: 'top' }
]
const scheme = () => ({ cavities: [cavity('a1', 10.123, 'a'), cavity('a2', 20.456, 'a'), cavity('b1', 40.123, 'b'), cavity('b2', 50.456, 'b'), cavity('solo', 70)], groups: structuredClone(groups) })

describe('viewport rigid selection', () => {
  beforeEach(() => useDesignStore.setState({ projects: {} }))
  it('promotes and deduplicates children and already selected parents', () => {
    expect(promoteFeatures([{ type: 'cavity', id: 'a1' }, { type: 'group', id: 'a' }, { type: 'cavity', id: 'a2' }, { type: 'cavity', id: 'solo' }], scheme()))
      .toEqual([{ type: 'group', id: 'a' }, { type: 'cavity', id: 'solo' }])
  })
  it('moves two assemblies and a standalone cavity once, preserving spacing and undo/redo', () => {
    const doc = createDefaultProject()
    Object.assign(doc.schemes[0], scheme())
    const store = useDesignStore.getState()
    store.initProject('test', doc)
    store.moveRigidCavities('test', ['a1', 'a2', 'b1', 'solo'], 2.345, -1.234)
    const current = () => useDesignStore.getState().projects.test
    const moved = current().doc.schemes[0]
    expect(moved.groups?.map(g => g.u)).toEqual([17.345, 47.345])
    expect(moved.cavities[1].u - moved.cavities[0].u).toBeCloseTo(10.333, 10)
    expect(moved.cavities[3].u).toBeCloseTo(52.801, 10)
    expect(moved.cavities[4].u).toBeCloseTo(72.345, 10)
    expect(current().undoStack).toHaveLength(1)
    store.undo('test')
    expect(current().doc.schemes[0].groups?.[0].u).toBe(15)
    expect(current().doc.schemes[0].cavities[1].u).toBe(20.456)
    store.redo('test')
    expect(current().doc.schemes[0].groups?.[0].u).toBe(17.345)
  })
  it('single-group moves retain submillimeter offsets', () => {
    const doc = createDefaultProject()
    Object.assign(doc.schemes[0], scheme())
    const store = useDesignStore.getState()
    store.initProject('test', doc)
    store.moveGroup('test', 'a', 0.0123, 0.0456)
    const moved = useDesignStore.getState().projects.test.doc.schemes[0]
    expect(moved.cavities[0].u).toBeCloseTo(10.1353, 10)
    expect(moved.cavities[1].u).toBeCloseTo(20.4683, 10)
    expect(moved.groups?.[0].u).toBeCloseTo(15.0123, 10)
  })
})

describe('directional marquee', () => {
  const rect = { minX: 10, minY: 10, maxX: 50, maxY: 50 }
  it('window excludes partial overlaps while crossing includes them', () => {
    const partial = { minX: 40, minY: 30, maxX: 60, maxY: 40 }
    expect(matchesMarquee(partial, rect, false)).toBe(false)
    expect(matchesMarquee(partial, rect, true)).toBe(true)
  })
  it('includes exact boundaries and rejects disjoint boxes', () => {
    expect(matchesMarquee(rect, rect, false)).toBe(true)
    expect(matchesMarquee({ minX: 51, minY: 10, maxX: 60, maxY: 20 }, rect, true)).toBe(false)
  })
})
