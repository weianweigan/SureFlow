import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createDefaultProject } from '@shared/design/types'

let storage: Map<string, string>

describe('新建与保存文档的最近打开记录', () => {
  beforeEach(() => {
    vi.resetModules()
    storage = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    })
    vi.stubGlobal('window', {
      projectApi: {
        save: vi.fn().mockResolvedValue('2026-09-16T12:00:00.000Z'),
        saveDialog: vi.fn().mockResolvedValue('/workspace/projects/new_manifold.sfb'),
        read: vi.fn().mockResolvedValue({
          filePath: '/workspace/projects/new_manifold.sfb',
          doc: createDefaultProject()
        })
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('新建文档保存（另存为）后，应成功记录至最近打开列表', async () => {
    const { useDesignStore } = await import('@renderer/workspace/design/model/designStore')
    const { useRecentFilesStore } = await import('../recentFilesStore')

    // 初始化一个无 filePath 的新建工程
    const doc = createDefaultProject()
    useDesignStore.getState().initProject('proj-1', doc)

    // 执行保存（无 filePath 自动走 saveAsProject）
    const success = await useDesignStore.getState().saveProject('proj-1')
    expect(success).toBe(true)

    const recent = useRecentFilesStore.getState().recentFiles
    expect(recent.length).toBe(1)
    expect(recent[0].filePath).toBe('/workspace/projects/new_manifold.sfb')
    expect(recent[0].name).toBe('new_manifold')
  })

  it('已有文档修改后保存，应更新最近打开列表中的时间戳与记录', async () => {
    const { useDesignStore } = await import('@renderer/workspace/design/model/designStore')
    const { useRecentFilesStore } = await import('../recentFilesStore')

    const doc = createDefaultProject()
    doc.meta.projectName = 'my_existing_manifold'
    useDesignStore.getState().initProject('proj-2', doc, '/workspace/projects/existing.sfb')

    const success = await useDesignStore.getState().saveProject('proj-2')
    expect(success).toBe(true)

    const recent = useRecentFilesStore.getState().recentFiles
    expect(recent.length).toBe(1)
    expect(recent[0].filePath).toBe('/workspace/projects/existing.sfb')
    expect(recent[0].name).toBe('my_existing_manifold')
  })

  it('openDesignTab 当同一 filePath 工程已打开时，应激活已有 Tab 而不创建新 Tab', async () => {
    const { useDesignStore } = await import('@renderer/workspace/design/model/designStore')
    const { useWorkspaceStore } = await import('@renderer/workspace/layout/layoutStore')
    const { openDesignTab } = await import('../panelActions')

    // 假设此前新建了一个 Tab (id: design:custom-pid)，随后保存为 /saved/test.sfb
    const doc = createDefaultProject()
    useDesignStore.getState().initProject('custom-pid', doc, '/saved/test.sfb')

    const setActive = vi.fn()
    const api = {
      getPanel: vi.fn((id: string) => {
        if (id === 'design:custom-pid') {
          return { api: { setActive } }
        }
        return undefined
      }),
      focus: vi.fn(),
      addPanel: vi.fn()
    }
    useWorkspaceStore.getState().setApi(api as never)

    // 用户从最近打开列表中点击 /saved/test.sfb（带有自动生成的 projectId）
    openDesignTab({
      projectId: `project-${encodeURIComponent('/saved/test.sfb')}`,
      name: 'test',
      filePath: '/saved/test.sfb'
    })

    expect(api.addPanel).not.toHaveBeenCalled()
    expect(setActive).toHaveBeenCalledOnce()
    expect(api.focus).toHaveBeenCalledOnce()
  })
})
