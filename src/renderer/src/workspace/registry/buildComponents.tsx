import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 注册表 → dockview components 映射（FR-03-109）
 *
 * 面板组件全部懒加载（NFR-03-10）。
 *
 * 关键：每个面板必须自带 Suspense 边界。若把裸 lazy 组件直接交给 dockview，
 * 挂起会上抛到 WorkspaceRoot 的外层边界，导致整个 DockviewReact 实例被
 * fallback 替换再重新挂载 —— onReady 在新 api 上重跑，而刚 addPanel 的
 * design 面板注册在已销毁的旧 api 上直接丢失。表现为：
 * 第一次点「+」只闪一下骨架屏，第二次点击才真正创建出 Tab。
 */
import { lazy, Suspense, type ComponentType } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { TabParams } from './tabTypeRegistry'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { ErrorBoundary } from '../ErrorBoundary'

/** dockview-react 要求的面板组件类型（params 为 any） */
export type DockviewPanelComponent = React.FunctionComponent<IDockviewPanelProps>

export type PanelComponent = ComponentType<IDockviewPanelProps<TabParams>>

/** 面板懒加载期间的局部占位（仅覆盖面板体，不影响 Tab 条与其他面板） */
export function PanelFallback(): React.ReactElement {
  _useLocale()
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <Skeleton className="h-6 w-44" />
    </div>
  )
}

/**
 * lazy 包装：为面板挂接面板级 Suspense 边界，
 * 并把带 TabParams 泛型的面板组件收敛为 dockview 接受的类型。
 */
function lazyPanel(factory: () => Promise<{ default: PanelComponent }>): DockviewPanelComponent {
  const LazyPanel = lazy(factory)
  function PanelWithBoundary(props: IDockviewPanelProps): React.ReactElement {
  _useLocale()
    return (
      <ErrorBoundary label={_t("工作区面板")}>
        <Suspense fallback={<PanelFallback />}>
          <LazyPanel {...(props as IDockviewPanelProps<TabParams>)} />
        </Suspense>
      </ErrorBoundary>
    )
  }
  return PanelWithBoundary as DockviewPanelComponent
}

export const PANEL_COMPONENTS: Record<string, DockviewPanelComponent> = {
  settings: lazyPanel(() => import('@renderer/workspace/tabs/SettingsTabPanel')),
  home: lazyPanel(() => import('@renderer/workspace/tabs/HomeTabPanel')),
  library: lazyPanel(() => import('@renderer/workspace/tabs/LibraryTabPanel')),
  design: lazyPanel(() => import('@renderer/workspace/tabs/DesignTabPanel')),
  viewer: lazyPanel(() => import('@renderer/workspace/tabs/ViewerTabPanel')),
  connectors: lazyPanel(() => import('@renderer/workspace/tabs/ConnectorsTabPanel'))
}
