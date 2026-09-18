/**
 * Tab 类型注册表（FR-03-109 / FR-03-110）
 *
 * 注册表驱动 Tab 框架：新增 Tab 类型只需注册条目 + 新增面板组件，
 * 不改动 WorkspaceRoot 与 dockview 集成层。
 *
 * 与 PRD-FR-03-01 §7.3 schema 保持一致。
 */

import type { SfbProject } from '@shared/design/types'

/** 面板 params 类型汇总 */
export type TabParams =
  | { kind: 'settings' }
  | { kind: 'home' }
  | { kind: 'library' }
  | {
      kind: 'design'
      projectId: string
      name: string
      filePath?: string
      initialDoc?: SfbProject
      dirty?: boolean
      initialCacheBuffer?: ArrayBuffer | null
      initialGlbBuffer?: ArrayBuffer | null
    }
  | {
      kind: 'viewer'
      viewerId: string
      title: string
      subType: 'pdf' | 'url' | 'image' | 'cad'
      target: string
      libraryDirPath?: string
      pageStart?: number | null
      pageEnd?: number | null
      referenceIndex?: number
      referenceBasePath?: string
    }

export type TabType = 'settings' | 'home' | 'library' | 'design' | 'viewer'

export interface TabTypeDef<P = TabParams> {
  /** Tab 类型标识，同时作为 dockview components key */
  type: TabType
  /** dockview components 注册 key（= type） */
  component: TabType
  /** 单开常驻：重复打开时定位已有面板，不新建 */
  singleton?: boolean
  /** 是否可关闭；false 时 dockview 关闭事件将被拦截（FR-03-107） */
  closable?: boolean
  /** dockview tabComponents key（自定义 Tab header）；缺省用默认 Tab（含关闭按钮） */
  tabComponent?: string
  /** 生成面板 id 前缀，保证 id 稳定可寻址 */
  panelIdPrefix: string
  /** Tab 标题生成 */
  title: (params: P) => string
  /** 新建时注入的默认 params */
  defaultParams: () => P
}

export const TAB_REGISTRY: Record<TabType, TabTypeDef> = {
  settings: {
    type: 'settings', component: 'settings', singleton: true, closable: true,
    panelIdPrefix: 'settings', title: () => '设置', defaultParams: () => ({ kind: 'settings' })
  },
  home: {
    type: 'home',
    component: 'home',
    singleton: true,
    closable: false,
    tabComponent: 'icon-home',
    panelIdPrefix: 'home',
    title: () => '主页',
    defaultParams: () => ({ kind: 'home' })
  },
  library: {
    type: 'library',
    component: 'library',
    singleton: true,
    closable: false,
    tabComponent: 'locked',
    panelIdPrefix: 'library',
    title: () => '库管理',
    defaultParams: () => ({ kind: 'library' })
  },
  design: {
    type: 'design',
    component: 'design',
    singleton: false,
    closable: true,
    tabComponent: 'design-tab',
    panelIdPrefix: 'design',
    title: (p) => (p.kind === 'design' ? p.name : '设计'),
    defaultParams: () => ({
      kind: 'design',
      projectId: `project-${Date.now()}`,
      name: '未命名工程'
    })
  },
  viewer: {
    type: 'viewer',
    component: 'viewer',
    singleton: false,
    closable: true,
    tabComponent: 'viewer-tab',
    panelIdPrefix: 'viewer',
    title: (p) => (p.kind === 'viewer' ? p.title : '文档浏览'),
    defaultParams: () => ({
      kind: 'viewer',
      viewerId: `viewer-${Date.now()}`,
      title: '浏览',
      subType: 'url',
      target: 'https://'
    })
  }
}

/** 依据注册表生成稳定面板 id（单开类型 = 固定 id；设计/浏览类型 = 前缀 + 标识 id） */
export function panelIdFor(type: TabType, params?: TabParams): string {
  const def = TAB_REGISTRY[type]
  if (params && params.kind === 'design') {
    return `${def.panelIdPrefix}:${params.projectId}`
  }
  if (params && params.kind === 'viewer') {
    return `${def.panelIdPrefix}:${params.viewerId}`
  }
  return def.panelIdPrefix
}
