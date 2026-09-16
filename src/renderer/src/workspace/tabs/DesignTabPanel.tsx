import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import type { IDockviewPanelProps } from 'dockview-react'
import type { TabParams } from '@renderer/workspace/registry/tabTypeRegistry'
import { DesignPanel } from '../design/view/DesignPanel'

/**
 * 设计 Tab 面板（FR-03-101 多开）。
 *
 * M1 完整三栏工程工作区：
 * - 左栏：方案组与时间线特征树
 * - 中栏：3D 视口与顶栏保存/撤销/视角控制
 * - 右栏：孔腔库与属性面板
 */
export default function DesignTabPanel({ params }: IDockviewPanelProps<TabParams>) {
  _useLocale()
  if (params.kind !== 'design') {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-destructive">
        {_t("非法的设计 Tab 参数")}</div>
    )
  }

  return (
    <DesignPanel
      projectId={params.projectId}
      name={params.name}
      filePath={params.filePath}
      initialDoc={params.initialDoc}
    />
  )
}
