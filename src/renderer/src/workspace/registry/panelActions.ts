/**
 * 面板打开/创建动作（FR-03-103 单开常驻 / FR-03-104 新建设计）
 *
 * - openPanelByType：单开类型（home/library）已存在 → 定位并激活，不重复创建
 * - openDesignTab：新建设计 Tab（多开），id 按注册表前缀 + projectId 稳定生成
 * - openProjectDialog：弹出系统选择文件对话框并打开对应设计 Tab
 */
import { TAB_REGISTRY, panelIdFor, type TabParams } from './tabTypeRegistry'
import { useWorkspaceStore } from '@renderer/workspace/layout/layoutStore'
import { useRecentFilesStore } from './recentFilesStore'
import { useDesignStore } from '@renderer/workspace/design/model/designStore'
import type { SfbProject } from '@shared/design/types'
import posthog from '@renderer/lib/posthog'

/** 打开单开常驻面板（home / library / settings / connectors）；不存在则创建并追加到顶层 group */
export function openPanelByType(type: 'home' | 'library' | 'settings' | 'connectors'): void {
  const api = useWorkspaceStore.getState().api
  if (!api) return

  const id = panelIdFor(type)
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    api.focus()
    return
  }

  const def = TAB_REGISTRY[type]
  api.addPanel({
    id,
    component: def.component,
    params: def.defaultParams() as TabParams,
    title: def.title(def.defaultParams()),
    tabComponent: def.tabComponent,
    position: { referencePanel: 'home', direction: 'within' }
  })
}

export interface OpenDesignTabOptions {
  name?: string
  projectId?: string
  filePath?: string
  initialDoc?: SfbProject
  initialCacheBuffer?: ArrayBuffer | null
  initialGlbBuffer?: ArrayBuffer | null
}

/** 新建或打开设计 Tab（多开），title 由注册表生成 */
export function openDesignTab(options?: OpenDesignTabOptions | string): void {
  const api = useWorkspaceStore.getState().api
  if (!api) return

  const opts: OpenDesignTabOptions =
    typeof options === 'string' ? { name: options } : options || {}

  const def = TAB_REGISTRY.design
  const defaultP = def.defaultParams() as Extract<TabParams, { kind: 'design' }>

  const params: Extract<TabParams, { kind: 'design' }> = {
    kind: 'design',
    projectId: opts.projectId || defaultP.projectId,
    name: opts.name || opts.initialDoc?.meta.projectName || defaultP.name,
    filePath: opts.filePath,
    initialDoc: opts.initialDoc,
    initialCacheBuffer: opts.initialCacheBuffer,
    initialGlbBuffer: opts.initialGlbBuffer
  }

  const id = panelIdFor('design', params)
  // 同一工程重复打开时定位已有 Tab
  let existing = api.getPanel(id)
  if (!existing && opts.filePath) {
    const openProjects = useDesignStore.getState().projects
    const matchedEntry = Object.entries(openProjects).find(
      ([_, session]) => session.filePath === opts.filePath
    )
    if (matchedEntry) {
      existing = api.getPanel(`design:${matchedEntry[0]}`)
    }
  }
  if (existing) {
    existing.api.setActive()
    api.focus()
    return
  }

  // 尝试放入 home panel 所在的 group 的最后，如果找不到则放入 activeGroup 最后
  let index: number | undefined
  const homePanel = api.getPanel('home')
  if (homePanel) {
    index = homePanel.group.panels.length
  } else if (api.activeGroup) {
    index = api.activeGroup.panels.length
  }

  api.addPanel({
    id,
    component: def.component,
    params,
    title: def.title(params),
    tabComponent: def.tabComponent,
    position: { referencePanel: 'home', direction: 'within', index }
  })

  // 记录最近打开文件（仅有 filePath 时）
  if (opts.filePath) {
    useRecentFilesStore.getState().addRecent(opts.filePath, params.name)
  }
}

/** 智能推断浏览子类型 */
export function inferViewerSubType(target: string): 'pdf' | 'url' | 'image' | 'cad' {
  const clean = target.trim().toLowerCase()
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    return 'url'
  }
  if (clean.endsWith('.pdf')) {
    return 'pdf'
  }
  if (
    clean.endsWith('.png') ||
    clean.endsWith('.jpg') ||
    clean.endsWith('.jpeg') ||
    clean.endsWith('.webp') ||
    clean.endsWith('.svg')
  ) {
    return 'image'
  }
  if (
    clean.endsWith('.step') ||
    clean.endsWith('.stp') ||
    clean.endsWith('.glb') ||
    clean.endsWith('.gltf')
  ) {
    return 'cad'
  }
  return 'url'
}

export interface OpenViewerTabOptions {
  title?: string
  subType?: 'pdf' | 'url' | 'image' | 'cad'
  target: string
  libraryDirPath?: string
  pageStart?: number | null
  pageEnd?: number | null
  referenceIndex?: number
  referenceBasePath?: string
  viewerId?: string
}

/** 打开通用浏览 Tab（Viewer Tab） */
export function openViewerTab(options: OpenViewerTabOptions): void {
  const api = useWorkspaceStore.getState().api
  if (!api) return

  const subType = options.subType || inferViewerSubType(options.target)
  const targetName = options.target.split(/[\\/]/).pop() || options.target
  const title = options.title || targetName
  const viewerId = options.viewerId || `viewer-${encodeURIComponent(options.target)}`

  const def = TAB_REGISTRY.viewer
  const params: Extract<TabParams, { kind: 'viewer' }> = {
    kind: 'viewer',
    viewerId,
    title,
    subType,
    target: options.target,
    libraryDirPath: options.libraryDirPath,
    pageStart: options.pageStart,
    pageEnd: options.pageEnd,
    referenceIndex: options.referenceIndex,
    referenceBasePath: options.referenceBasePath
  }

  const id = panelIdFor('viewer', params)
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.updateParameters(params)
    existing.api.setActive()
    api.focus()
    return
  }

  let index: number | undefined
  if (api.activeGroup) {
    index = api.activeGroup.panels.length
  }

  api.addPanel({
    id,
    component: def.component,
    params,
    title,
    tabComponent: def.tabComponent,
    position: { direction: 'within', index }
  })
}

/** 弹出系统对话框打开 .sfb 工程并创建 Tab */
export async function openProjectDialog(): Promise<void> {
  const res = await window.projectApi.openDialog()
  if (!res) return

  const { filePath, doc, cacheBuffer, glbBuffer } = res
  const fileName = filePath.split(/[\\/]/).pop()?.replace(/\.sfb$/i, '') || doc.meta.projectName
  const projectId = `project-${encodeURIComponent(filePath)}`

  openDesignTab({
    projectId,
    name: fileName,
    filePath,
    initialDoc: doc,
    initialCacheBuffer: cacheBuffer,
    initialGlbBuffer: glbBuffer
  })
  posthog.capture('project_opened', { entry_point: 'file_dialog' })
}

/**
 * 请求关闭指定面板（FR-03-106 / FR-03-107）。
 * 若为设计工程面板且存在未保存改动（dirty），弹出保存确认对话框。
 * 返回 boolean：true 表示面板已成功关闭；false 表示用户取消关闭。
 */
export async function requestClosePanel(panelId: string): Promise<boolean> {
  const api = useWorkspaceStore.getState().api
  if (!api) return false
  const panel = api.getPanel(panelId)
  if (!panel) return true

  // 常驻系统 Tab 不允许关闭
  if (panelId === 'home' || panelId === 'library') {
    return false
  }

  // 检查设计工程未保存改动
  if (panelId.startsWith('design:')) {
    const projectId = panelId.replace(/^design:/, '')
    const session = useDesignStore.getState().projects[projectId]
    if (session && session.dirty) {
      const cadDocName = session.cadIntegration?.docPath
        ? session.cadIntegration.docPath.split(/[\\/]/).pop()
        : session.cadIntegration?.baseBodyName
      const projectName =
        (session.doc.meta.projectName && session.doc.meta.projectName !== '未命名工程' ? session.doc.meta.projectName : null) ||
        cadDocName ||
        session.filePath?.split(/[\\/]/).pop()?.replace(/\.sfb$/i, '') ||
        '未命名工程'
      const choice = await window.projectApi.confirmClose(projectName)
      if (choice === 'cancel') {
        return false
      }
      if (choice === 'save') {
        const saved = await useDesignStore.getState().saveProject(projectId)
        if (!saved) {
          return false
        }
      }
      // choice === 'dontsave' 或成功保存，继续关闭
    }
  }

  api.removePanel(panel)
  return true
}

/**
 * 批量关闭除 targetPanelId 以外的所有可关闭面板（FR-03-119 / FR-03-120）。
 * 保护系统常驻面板（home、library）；遇脏工程弹窗确认，若用户取消则中止后续关闭。
 */
export async function closeOtherPanels(targetPanelId: string): Promise<boolean> {
  const api = useWorkspaceStore.getState().api
  if (!api) return false

  const candidates = api.panels.filter(
    (p) => p.id !== targetPanelId && p.id !== 'home' && p.id !== 'library'
  )

  for (const p of candidates) {
    const closed = await requestClosePanel(p.id)
    if (!closed) {
      return false
    }
  }
  return true
}

