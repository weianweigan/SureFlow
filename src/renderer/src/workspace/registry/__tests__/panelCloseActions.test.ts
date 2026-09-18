import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createDefaultProject } from '@shared/design/types'
import { requestClosePanel, closeOtherPanels } from '../panelActions'
import { useWorkspaceStore } from '@renderer/workspace/layout/layoutStore'
import { useDesignStore } from '@renderer/workspace/design/model/designStore'

describe('面板关闭与批量关闭保护逻辑 (FR-03-106 / FR-03-119 / FR-03-120)', () => {
  let mockPanels: any[]
  let mockApi: any

  beforeEach(() => {
    vi.resetModules()

    // 构造 dockview mock 状态
    mockPanels = []
    mockApi = {
      get panels() {
        return mockPanels
      },
      getPanel: vi.fn((id: string) => mockPanels.find((p) => p.id === id)),
      removePanel: vi.fn((panel: any) => {
        const idx = mockPanels.findIndex((p) => p.id === panel.id)
        if (idx !== -1) {
          mockPanels.splice(idx, 1)
        }
      })
    }

    useWorkspaceStore.setState({ api: mockApi } as any)

    vi.stubGlobal('window', {
      projectApi: {
        confirmClose: vi.fn(),
        save: vi.fn().mockResolvedValue('2026-09-18T12:00:00.000Z'),
        saveDialog: vi.fn().mockResolvedValue('/path/to/saved.sfb'),
        read: vi.fn()
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('常驻面板 home 与 library 永远不可被单个关闭', async () => {
    mockPanels.push(
      { id: 'home', group: { panels: mockPanels } },
      { id: 'library', group: { panels: mockPanels } }
    )

    const closedHome = await requestClosePanel('home')
    expect(closedHome).toBe(false)
    expect(mockApi.removePanel).not.toHaveBeenCalled()

    const closedLibrary = await requestClosePanel('library')
    expect(closedLibrary).toBe(false)
    expect(mockApi.removePanel).not.toHaveBeenCalled()
  })

  it('普通 viewer Tab 可直接关闭，无需弹窗', async () => {
    const viewerPanel = { id: 'viewer-1', group: { panels: mockPanels } }
    mockPanels.push(viewerPanel)

    const closed = await requestClosePanel('viewer-1')
    expect(closed).toBe(true)
    expect(mockApi.removePanel).toHaveBeenCalledWith(viewerPanel)
    expect(window.projectApi.confirmClose).not.toHaveBeenCalled()
  })

  it('未修改的 clean 设计工程 Tab 可直接关闭', async () => {
    const doc = createDefaultProject()
    useDesignStore.getState().initProject('proj-clean', doc, '/test/clean.sfb')
    const designPanel = { id: 'design:proj-clean', group: { panels: mockPanels } }
    mockPanels.push(designPanel)

    const closed = await requestClosePanel('design:proj-clean')
    expect(closed).toBe(true)
    expect(mockApi.removePanel).toHaveBeenCalledWith(designPanel)
    expect(window.projectApi.confirmClose).not.toHaveBeenCalled()
  })

  it('有未保存改动的 dirty 设计工程 Tab 弹窗选择「取消」时中止关闭', async () => {
    const doc = createDefaultProject()
    useDesignStore.getState().initProject('proj-dirty', doc, '/test/dirty.sfb')
    // 标记为 dirty
    useDesignStore.setState((s) => ({
      projects: {
        ...s.projects,
        'proj-dirty': { ...s.projects['proj-dirty'], dirty: true }
      }
    }))

    const designPanel = { id: 'design:proj-dirty', group: { panels: mockPanels } }
    mockPanels.push(designPanel)

    vi.mocked(window.projectApi.confirmClose).mockResolvedValueOnce('cancel')

    const closed = await requestClosePanel('design:proj-dirty')
    expect(closed).toBe(false)
    expect(mockApi.removePanel).not.toHaveBeenCalled()
  })

  it('有未保存改动的 dirty 设计工程 Tab 弹窗选择「不保存」时直接关闭', async () => {
    const doc = createDefaultProject()
    useDesignStore.getState().initProject('proj-dirty2', doc, '/test/dirty2.sfb')
    useDesignStore.setState((s) => ({
      projects: {
        ...s.projects,
        'proj-dirty2': { ...s.projects['proj-dirty2'], dirty: true }
      }
    }))

    const designPanel = { id: 'design:proj-dirty2', group: { panels: mockPanels } }
    mockPanels.push(designPanel)

    vi.mocked(window.projectApi.confirmClose).mockResolvedValueOnce('dontsave')

    const closed = await requestClosePanel('design:proj-dirty2')
    expect(closed).toBe(true)
    expect(mockApi.removePanel).toHaveBeenCalledWith(designPanel)
  })

  it('closeOtherPanels 批量关闭应保留 home、library 与目标 Tab', async () => {
    const pHome = { id: 'home', group: { panels: mockPanels } }
    const pLib = { id: 'library', group: { panels: mockPanels } }
    const pTarget = { id: 'viewer-target', group: { panels: mockPanels } }
    const pOther1 = { id: 'viewer-1', group: { panels: mockPanels } }
    const pOther2 = { id: 'viewer-2', group: { panels: mockPanels } }

    mockPanels.push(pHome, pLib, pTarget, pOther1, pOther2)

    const success = await closeOtherPanels('viewer-target')
    expect(success).toBe(true)

    // 应仅移除 pOther1 和 pOther2
    expect(mockPanels.map((p) => p.id)).toEqual(['home', 'library', 'viewer-target'])
  })

  it('批量关闭时如果任一脏工程被用户点击「取消」，应立即中断后续关闭', async () => {
    const pTarget = { id: 'viewer-target', group: { panels: mockPanels } }
    const doc = createDefaultProject()
    useDesignStore.getState().initProject('proj-dirty-batch', doc, '/test/dirty_batch.sfb')
    useDesignStore.setState((s) => ({
      projects: {
        ...s.projects,
        'proj-dirty-batch': { ...s.projects['proj-dirty-batch'], dirty: true }
      }
    }))
    const pDirty = { id: 'design:proj-dirty-batch', group: { panels: mockPanels } }
    const pOther = { id: 'viewer-after', group: { panels: mockPanels } }

    mockPanels.push(pTarget, pDirty, pOther)

    vi.mocked(window.projectApi.confirmClose).mockResolvedValueOnce('cancel')

    const success = await closeOtherPanels('viewer-target')
    expect(success).toBe(false)

    // pDirty 应该保留，pOther 尚未被关闭
    expect(mockPanels.find((p) => p.id === 'design:proj-dirty-batch')).toBeDefined()
    expect(mockPanels.find((p) => p.id === 'viewer-after')).toBeDefined()
  })
})
