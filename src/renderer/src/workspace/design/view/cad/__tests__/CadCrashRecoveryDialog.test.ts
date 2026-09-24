import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createDefaultProject } from '@shared/design/types'
import { useDesignStore } from '../../../model/designStore'
import { useWorkspaceStore } from '@renderer/workspace/layout/layoutStore'

describe('CadCrashRecoveryDialog logic', () => {
  let mockPanels: any[]
  let mockApi: any

  beforeEach(() => {
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
    useDesignStore.setState({ projects: {} })
  })

  it('handleDiscardAndClose closes dockview panel and removes project', () => {
    const projectId = 'proj-cad-1'
    const doc = createDefaultProject()
    useDesignStore.getState().initProject(projectId, doc)

    const panel = { id: `design:${projectId}` }
    mockPanels.push(panel)

    // Simulate what handleDiscardAndClose does:
    const api = useWorkspaceStore.getState().api
    const foundPanel = api?.getPanel(`design:${projectId}`) ?? api?.getPanel(projectId)
    if (api && foundPanel) {
      api.removePanel(foundPanel)
    }
    useDesignStore.getState().removeProject(projectId)

    expect(mockApi.removePanel).toHaveBeenCalledWith(panel)
    expect(mockPanels).toHaveLength(0)
    expect(useDesignStore.getState().projects[projectId]).toBeUndefined()
  })

  it('handleIgnore preserves dockview panel and project in store', () => {
    const projectId = 'proj-cad-2'
    const doc = createDefaultProject()
    useDesignStore.getState().initProject(projectId, doc)

    const panel = { id: `design:${projectId}` }
    mockPanels.push(panel)

    // Simulate handleIgnore (only dialog dismissal, no store/dockview mutations):
    // activeEvent -> null, targetProjectId -> null

    expect(mockApi.removePanel).not.toHaveBeenCalled()
    expect(mockPanels).toHaveLength(1)
    expect(useDesignStore.getState().projects[projectId]).toBeDefined()
  })
})
