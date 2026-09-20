import { describe, it, expect, beforeEach } from 'vitest'
import { useAnalysisStore } from '../analysisStore'
import type { EntityRef, ActiveClearanceResult } from '@shared/design/analysis/contracts'

describe('Analysis Store (Active Clearance & Badge Offsets)', () => {
  beforeEach(() => {
    useAnalysisStore.getState().resetActiveClearance()
    useAnalysisStore.getState().resetBadgeOffsets()
  })

  it('supports picking multiple clearance entities with toggling', () => {
    const cavA: EntityRef = { kind: 'cavity', instanceId: 'cav-1' }
    const cavB: EntityRef = { kind: 'cavity', instanceId: 'cav-2' }
    const face1: EntityRef = { kind: 'base-face', faceId: 'top' }

    // 1. 拾取第一个对象
    useAnalysisStore.getState().pickClearanceObject(cavA)
    let state = useAnalysisStore.getState()
    expect(state.clearanceObjects).toHaveLength(1)
    expect(state.objectA).toEqual(cavA)
    expect(state.objectB).toBeNull()

    // 2. 拾取第二个对象 -> 满足两个对象，开始测量
    useAnalysisStore.getState().pickClearanceObject(cavB)
    state = useAnalysisStore.getState()
    expect(state.clearanceObjects).toHaveLength(2)
    expect(state.objectA).toEqual(cavA)
    expect(state.objectB).toEqual(cavB)
    expect(state.isMeasuring).toBe(true)

    // 3. 拾取第三个对象（基体面） -> 支持 3 个或更多实体多选
    useAnalysisStore.getState().pickClearanceObject(face1)
    state = useAnalysisStore.getState()
    expect(state.clearanceObjects).toHaveLength(3)

    // 4. 重复点击已选中的对象 -> 触发 Toggle 取消选择
    useAnalysisStore.getState().pickClearanceObject(cavB)
    state = useAnalysisStore.getState()
    expect(state.clearanceObjects).toHaveLength(2)
    expect(state.clearanceObjects).toEqual([cavA, face1])

    // 5. 单独移除对象
    useAnalysisStore.getState().removeClearanceObject(cavA)
    state = useAnalysisStore.getState()
    expect(state.clearanceObjects).toHaveLength(1)
    expect(state.clearanceObjects[0]).toEqual(face1)
  })

  it('updates pairwise clearance results properly', () => {
    const mockResults: ActiveClearanceResult[] = [
      {
        dist: 12.5,
        relation: 'separated',
        pointA: [10, 20, 30],
        pointB: [10, 32.5, 30],
        objectA: { kind: 'cavity', instanceId: 'c1' },
        objectB: { kind: 'cavity', instanceId: 'c2' },
        unit: 'mm'
      },
      {
        dist: 0,
        relation: 'contacting',
        pointA: [10, 20, 30],
        pointB: [10, 20, 30],
        objectA: { kind: 'cavity', instanceId: 'c1' },
        objectB: { kind: 'base-face', faceId: 'top' },
        unit: 'mm'
      }
    ]

    useAnalysisStore.getState().setClearanceResults(mockResults)
    const state = useAnalysisStore.getState()
    expect(state.activeClearanceResults).toHaveLength(2)
    expect(state.activeClearanceResult).toEqual(mockResults[0])
    expect(state.isMeasuring).toBe(false)
  })

  it('manages badge dragging offsets and reset', () => {
    const badgeId = 'clearance-cav-1-cav-2'

    // 初始没有偏移量
    expect(useAnalysisStore.getState().badgeOffsets[badgeId]).toBeUndefined()

    // 拖动标签后设置偏移量
    useAnalysisStore.getState().setBadgeOffset(badgeId, [15, -20, 5])
    expect(useAnalysisStore.getState().badgeOffsets[badgeId]).toEqual([15, -20, 5])

    // 为另一个问题标签设置偏移量
    useAnalysisStore.getState().setBadgeOffset('issue-CLR-001-1', [-8, 12, 0])
    expect(Object.keys(useAnalysisStore.getState().badgeOffsets)).toHaveLength(2)

    // 重置所有偏移量
    useAnalysisStore.getState().resetBadgeOffsets()
    expect(useAnalysisStore.getState().badgeOffsets).toEqual({})
  })
})
