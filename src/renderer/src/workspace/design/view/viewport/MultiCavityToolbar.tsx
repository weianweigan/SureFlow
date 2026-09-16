import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useMemo, type FC } from 'react'
import {
  AlignLeft,
  AlignCenterHorizontal,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignCenterVertical,
  AlignVerticalJustifyEnd,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Layers,
  FolderMinus,
  Sparkles,
  FlipHorizontal,
  X
} from 'lucide-react'
import { useDesignStore, getSelectedFeatures, getSelectedCavityIds } from '../../model/designStore'

interface MultiCavityToolbarProps {
  projectId: string
  onOpenPattern: () => void
  onOpenMirror: () => void
}

/**
 * 视口多选辅助排布浮动工具栏 (Multi-Cavity Layout Toolbar)
 * 严格对齐 PRD-FR-05-02 & PRD-FR-05-04 规范：
 * - 针对孔腔特征级（单孔或多孔组合孔作为一个完整特征单元）
 * - 选中 ≥ 2 个孔特征时自动激活
 * - 悬浮于 3D 视口顶部居中，半透明玻璃拟态
 * - 提供：六向对齐、等距均布、成组/解散、镜像与阵列向导快捷入口
 */
export const MultiCavityToolbar: FC<MultiCavityToolbarProps> = ({
  projectId,
  onOpenPattern,
  onOpenMirror
}) => {
  _useLocale()
  const session = useDesignStore((s) => s.projects[projectId])
  const selectFeature = useDesignStore((s) => s.selectFeature)
  const applyAlignment = useDesignStore((s) => s.applyAlignment)
  const applyDistribution = useDesignStore((s) => s.applyDistribution)
  const createGroupFromSelection = useDesignStore((s) => s.createGroupFromSelection)
  const disbandGroup = useDesignStore((s) => s.disbandGroup)

  const selected = session?.selected
  const activeScheme = session?.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) || session?.doc.schemes[0]

  // 计算选中的特征列表（单孔或组合孔组）
  const selectedFeatures = useMemo(() => {
    return getSelectedFeatures(selected)
  }, [selected])

  // 计算选中的所有底层孔腔 ID
  const selectedCavityIds = useMemo(() => {
    return getSelectedCavityIds(selected, activeScheme)
  }, [selected, activeScheme])

  const featureCount = selectedFeatures.length
  const isSingleGroupSelected = selected?.type === 'group' && (!selected.extraIds || selected.extraIds.length === 0)

  // 只有在多选 ≥ 2 个孔特征时才激活工具栏
  if (featureCount < 2) return null

  const handleAlign = (type: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom') => {
    applyAlignment(projectId, selectedCavityIds, type)
  }

  const handleDistribute = (axis: 'horizontal' | 'vertical') => {
    applyDistribution(projectId, selectedCavityIds, axis)
  }

  const handleToggleGroup = () => {
    if (isSingleGroupSelected && selected) {
      disbandGroup(projectId, selected.id)
    } else {
      createGroupFromSelection(projectId)
    }
  }

  const handleDeselect = () => {
    selectFeature(projectId, { type: 'base', id: 'base' })
  }

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-xl bg-slate-900/85 backdrop-blur-md px-3 py-1.5 shadow-2xl border border-slate-700/60 text-white select-none animate-in fade-in slide-in-from-top-2 duration-150">
      {/* 选中特征数量指示 */}
      <div className="flex items-center gap-1.5 pr-2 border-r border-slate-700/60 text-xs text-slate-300 font-medium">
        <Layers className="size-3.5 text-blue-400" />
        <span>{_t("已选")}{featureCount} {_t("个特征")}</span>
      </div>

      {/* 六向对齐按钮组 */}
      <div className="flex items-center gap-0.5 px-1 border-r border-slate-700/60">
        <button
          type="button"
          title={_t("左对齐 (最小 U 坐标)")}
          onClick={() => handleAlign('left')}
          className="flex size-7 items-center justify-center rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <AlignLeft className="size-4" />
        </button>
        <button
          type="button"
          title={_t("水平居中对齐 (平均 U 坐标)")}
          onClick={() => handleAlign('center-x')}
          className="flex size-7 items-center justify-center rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <AlignCenterHorizontal className="size-4" />
        </button>
        <button
          type="button"
          title={_t("右对齐 (最大 U 坐标)")}
          onClick={() => handleAlign('right')}
          className="flex size-7 items-center justify-center rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <AlignRight className="size-4" />
        </button>
        <button
          type="button"
          title={_t("顶端对齐 (最大 V 坐标)")}
          onClick={() => handleAlign('top')}
          className="flex size-7 items-center justify-center rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <AlignVerticalJustifyStart className="size-4" />
        </button>
        <button
          type="button"
          title={_t("垂直居中对齐 (平均 V 坐标)")}
          onClick={() => handleAlign('center-y')}
          className="flex size-7 items-center justify-center rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <AlignCenterVertical className="size-4" />
        </button>
        <button
          type="button"
          title={_t("底端对齐 (最小 V 坐标)")}
          onClick={() => handleAlign('bottom')}
          className="flex size-7 items-center justify-center rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <AlignVerticalJustifyEnd className="size-4" />
        </button>
      </div>

      {/* 等距均布按钮组 (≥ 3 个特征可用) */}
      <div className="flex items-center gap-0.5 px-1 border-r border-slate-700/60">
        <button
          type="button"
          disabled={featureCount < 3}
          title={featureCount < 3 ? _t("至少需要 3 个特征方可水平均布") : _t("水平均等间距分布")}
          onClick={() => handleDistribute('horizontal')}
          className="flex size-7 items-center justify-center rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <AlignHorizontalDistributeCenter className="size-4" />
        </button>
        <button
          type="button"
          disabled={featureCount < 3}
          title={featureCount < 3 ? _t("至少需要 3 个特征方可垂直均布") : _t("垂直均等间距分布")}
          onClick={() => handleDistribute('vertical')}
          className="flex size-7 items-center justify-center rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <AlignVerticalDistributeCenter className="size-4" />
        </button>
      </div>

      {/* 成组 / 解散组 */}
      <div className="flex items-center gap-0.5 px-1 border-r border-slate-700/60">
        <button
          type="button"
          title={isSingleGroupSelected ? _t("解散分组 (Ctrl+Shift+G)") : _t("成组 (Ctrl+G)")}
          onClick={handleToggleGroup}
          className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/30 transition-colors cursor-pointer"
        >
          {isSingleGroupSelected ? (
            <>
              <FolderMinus className="size-3.5" />
              <span>{_t("解散组")}</span>
            </>
          ) : (
            <>
              <Layers className="size-3.5" />
              <span>{_t("成组")}</span>
            </>
          )}
        </button>
      </div>

      {/* 高级向导：镜像与阵列 */}
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          title={_t("镜像向导...")}
          onClick={onOpenMirror}
          className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-slate-800 text-slate-200 hover:text-white transition-colors cursor-pointer"
        >
          <FlipHorizontal className="size-3.5 text-amber-400" />
          <span>{_t("镜像")}</span>
        </button>
        <button
          type="button"
          title={_t("阵列向导 (线性 / 圆周)...")}
          onClick={onOpenPattern}
          className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-slate-800 text-slate-200 hover:text-white transition-colors cursor-pointer"
        >
          <Sparkles className="size-3.5 text-purple-400" />
          <span>{_t("阵列")}</span>
        </button>
      </div>

      {/* 取消多选 / 关闭 */}
      <button
        type="button"
        title={_t("取消多选 (Esc)")}
        onClick={handleDeselect}
        className="ml-1 flex size-6 items-center justify-center rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
