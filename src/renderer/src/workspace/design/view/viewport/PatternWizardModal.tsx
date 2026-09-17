import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useState, useMemo, type FC } from 'react'
import {
  Sparkles,
  Grid3X3,
  RotateCw,
  X,
  Check
} from 'lucide-react'
import { useDesignStore, getSelectedCavityIds } from '../../model/designStore'
import posthog from '@renderer/lib/posthog'

interface PatternWizardModalProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
}

/**
 * 阵列特征向导弹窗 (Pattern Wizard Modal)
 * 严格对齐 PRD-FR-05-03 规范：
 * - 纯生成器模式（Pure Generator Mode）：生成独立且离散的 CavityInstance，每个实例具备唯一 instanceId
 * - 线性网格阵列：支持单向 (1D) 与双向 (2D) 笛卡尔阵列（步长、间距、方向）
 * - 圆周环状阵列：支持指定旋转中心 (Cu, Cv)、总孔数及 360° 整周/自定义角度均布
 */
export const PatternWizardModal: FC<PatternWizardModalProps> = ({
  projectId,
  isOpen,
  onClose
}) => {
  _useLocale()
  const session = useDesignStore((s) => s.projects[projectId])
  const applyLinearPattern = useDesignStore((s) => s.applyLinearPattern)
  const applyCircularPattern = useDesignStore((s) => s.applyCircularPattern)

  const [activeTab, setActiveTab] = useState<'linear' | 'circular'>('linear')

  // 线性阵列参数
  const [axis1, setAxis1] = useState<'+u' | '-u' | '+v' | '-v'>('+u')
  const [count1, setCount1] = useState<number>(3)
  const [spacing1, setSpacing1] = useState<number>(25)

  const [enableDir2, setEnableDir2] = useState<boolean>(false)
  const [axis2, setAxis2] = useState<'+u' | '-u' | '+v' | '-v'>('+v')
  const [count2, setCount2] = useState<number>(2)
  const [spacing2, setSpacing2] = useState<number>(25)

  // 圆周阵列参数
  const [centerU, setCenterU] = useState<number>(0)
  const [centerV, setCenterV] = useState<number>(0)
  const [circCount, setCircCount] = useState<number>(6)
  const [circMode, setCircMode] = useState<'full' | 'custom-angle'>('full')
  const [totalAngle, setTotalAngle] = useState<number>(360)

  const selected = session?.selected
  const activeScheme = session?.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) || session?.doc.schemes[0]

  const selectedCavityIds = useMemo(() => {
    if (!selected) return []
    if (selected.type === 'cavity') return getSelectedCavityIds(selected)
    if (selected.type === 'group') {
      const grp = activeScheme?.groups?.find((g) => g.id === selected.id)
      return grp ? grp.cavityIds : []
    }
    return []
  }, [selected, activeScheme])

  const selectedCavities = useMemo(() => {
    if (!activeScheme || selectedCavityIds.length === 0) return []
    return activeScheme.cavities.filter((c) => selectedCavityIds.includes(c.instanceId))
  }, [activeScheme, selectedCavityIds])

  if (!isOpen) return null

  // 计算将生成的新实例数量
  const generatedCount = useMemo(() => {
    const srcLen = selectedCavities.length
    if (srcLen === 0) return 0
    if (activeTab === 'linear') {
      const totalPerSource = count1 * (enableDir2 ? count2 : 1)
      return (totalPerSource - 1) * srcLen
    } else {
      return (circCount - 1) * srcLen
    }
  }, [activeTab, count1, count2, enableDir2, circCount, selectedCavities.length])

  const handleConfirm = () => {
    if (selectedCavityIds.length === 0) return

    if (activeTab === 'linear') {
      applyLinearPattern(projectId, selectedCavityIds, {
        direction1: {
          axis: axis1,
          count: Math.max(1, count1),
          spacing: spacing1
        },
        direction2: {
          enabled: enableDir2,
          axis: axis2,
          count: Math.max(1, count2),
          spacing: spacing2
        }
      })
    } else {
      applyCircularPattern(projectId, selectedCavityIds, {
        centerU,
        centerV,
        count: Math.max(2, circCount),
        mode: circMode,
        totalAngle: circMode === 'custom-angle' ? totalAngle : 360
      })
    }

    posthog.capture('pattern_generated', {
      pattern_type: activeTab,
      source_cavity_count: selectedCavityIds.length,
      generated_cavity_count: generatedCount
    })
    onClose()
  }

  // 快速将圆心重置为选中孔腔的均值中心或原点
  const handleSetCenterToSelectedMean = () => {
    if (selectedCavities.length === 0) return
    const meanU = selectedCavities.reduce((acc, c) => acc + c.u, 0) / selectedCavities.length
    const meanV = selectedCavities.reduce((acc, c) => acc + c.v, 0) / selectedCavities.length
    setCenterU(Math.round(meanU * 10) / 10)
    setCenterV(Math.round(meanV * 10) / 10)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-[460px] rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden flex flex-col text-slate-100">
        {/* Header */}
        <div className="flex h-12 items-center justify-between px-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Sparkles className="size-4 text-purple-400" />
            <span>{_t("阵列特征向导 (Pattern Generator)")}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-slate-800 px-4 pt-2 gap-2 bg-slate-900/30">
          <button
            type="button"
            onClick={() => setActiveTab('linear')}
            className={`flex items-center gap-1.5 pb-2.5 px-3 text-xs font-medium border-b-2 transition-all cursor-pointer ${
              activeTab === 'linear'
                ? 'border-purple-500 text-purple-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Grid3X3 className="size-3.5" />
            <span>{_t("线性网格阵列 (Linear)")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('circular')}
            className={`flex items-center gap-1.5 pb-2.5 px-3 text-xs font-medium border-b-2 transition-all cursor-pointer ${
              activeTab === 'circular'
                ? 'border-purple-500 text-purple-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <RotateCw className="size-3.5" />
            <span>{_t("圆周环状阵列 (Circular)")}</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 flex flex-col gap-4 text-xs">
          {/* 线性阵列面板 */}
          {activeTab === 'linear' && (
            <div className="flex flex-col gap-4">
              {/* 方向 1 */}
              <div className="rounded-xl bg-slate-800/50 p-3.5 border border-slate-700/50 flex flex-col gap-3">
                <div className="font-semibold text-slate-200 flex items-center justify-between">
                  <span>{_t("主阵列方向 (Direction 1)")}</span>
                  <span className="text-[11px] text-purple-400 font-normal">{_t("基础轴向")}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-slate-400 text-[11px]">{_t("延伸轴向")}</label>
                    <select
                      value={axis1}
                      onChange={(e) => setAxis1(e.target.value as any)}
                      className="h-8 rounded-lg bg-slate-900 border border-slate-700 px-2 text-slate-200 focus:outline-none focus:border-purple-500"
                    >
                      <option value="+u">{_t("+U (向右)")}</option>
                      <option value="-u">{_t("-U (向左)")}</option>
                      <option value="+v">{_t("+V (向上)")}</option>
                      <option value="-v">{_t("-V (向下)")}</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-slate-400 text-[11px]">{_t("实例数量 (含原孔)")}</label>
                    <input
                      type="number"
                      min={2}
                      max={50}
                      value={count1}
                      onChange={(e) => setCount1(Math.max(2, parseInt(e.target.value) || 2))}
                      className="h-8 rounded-lg bg-slate-900 border border-slate-700 px-2 text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-slate-400 text-[11px]">{_t("间距 (mm)")}</label>
                    <input
                      type="number"
                      step={1}
                      value={spacing1}
                      onChange={(e) => setSpacing1(parseFloat(e.target.value) || 0)}
                      className="h-8 rounded-lg bg-slate-900 border border-slate-700 px-2 text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* 方向 2（可选 2D 网格） */}
              <div className="rounded-xl bg-slate-800/50 p-3.5 border border-slate-700/50 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={enableDir2}
                      onChange={(e) => setEnableDir2(e.target.checked)}
                      className="rounded border-slate-700 text-purple-600 focus:ring-purple-500 size-3.5 cursor-pointer"
                    />
                    <span className="font-semibold text-slate-200">{_t("启用第二方向 (2D 笛卡尔网格)")}</span>
                  </label>
                  <span className="text-[11px] text-slate-400">{_t("平面阵列")}</span>
                </div>

                {enableDir2 && (
                  <div className="grid grid-cols-3 gap-2 animate-in fade-in duration-100">
                    <div className="flex flex-col gap-1">
                      <label className="text-slate-400 text-[11px]">{_t("延伸轴向")}</label>
                      <select
                        value={axis2}
                        onChange={(e) => setAxis2(e.target.value as any)}
                        className="h-8 rounded-lg bg-slate-900 border border-slate-700 px-2 text-slate-200 focus:outline-none focus:border-purple-500"
                      >
                        <option value="+v">{_t("+V (向上)")}</option>
                        <option value="-v">{_t("-V (向下)")}</option>
                        <option value="+u">{_t("+U (向右)")}</option>
                        <option value="-u">{_t("-U (向左)")}</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-slate-400 text-[11px]">{_t("实例数量")}</label>
                      <input
                        type="number"
                        min={2}
                        max={50}
                        value={count2}
                        onChange={(e) => setCount2(Math.max(2, parseInt(e.target.value) || 2))}
                        className="h-8 rounded-lg bg-slate-900 border border-slate-700 px-2 text-slate-200 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-slate-400 text-[11px]">{_t("间距 (mm)")}</label>
                      <input
                        type="number"
                        step={1}
                        value={spacing2}
                        onChange={(e) => setSpacing2(parseFloat(e.target.value) || 0)}
                        className="h-8 rounded-lg bg-slate-900 border border-slate-700 px-2 text-slate-200 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 圆周阵列面板 */}
          {activeTab === 'circular' && (
            <div className="flex flex-col gap-4">
              {/* 旋转中心 */}
              <div className="rounded-xl bg-slate-800/50 p-3.5 border border-slate-700/50 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">{_t("旋转中心坐标 (Center Point)")}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCenterU(0)
                        setCenterV(0)
                      }}
                      className="text-[10px] text-purple-400 hover:text-purple-300 underline cursor-pointer"
                    >
                      {_t("设为原点(0,0)")}</button>
                    <button
                      type="button"
                      onClick={handleSetCenterToSelectedMean}
                      className="text-[10px] text-purple-400 hover:text-purple-300 underline cursor-pointer"
                    >
                      {_t("设为几何均值中心")}</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-slate-400 text-[11px]">{_t("中心 U (mm)")}</label>
                    <input
                      type="number"
                      step={1}
                      value={centerU}
                      onChange={(e) => setCenterU(parseFloat(e.target.value) || 0)}
                      className="h-8 rounded-lg bg-slate-900 border border-slate-700 px-2 text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-slate-400 text-[11px]">{_t("中心 V (mm)")}</label>
                    <input
                      type="number"
                      step={1}
                      value={centerV}
                      onChange={(e) => setCenterV(parseFloat(e.target.value) || 0)}
                      className="h-8 rounded-lg bg-slate-900 border border-slate-700 px-2 text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* 数量与角度模式 */}
              <div className="rounded-xl bg-slate-800/50 p-3.5 border border-slate-700/50 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-slate-400 text-[11px]">{_t("总孔数 (含原孔)")}</label>
                    <input
                      type="number"
                      min={2}
                      max={72}
                      value={circCount}
                      onChange={(e) => setCircCount(Math.max(2, parseInt(e.target.value) || 2))}
                      className="h-8 rounded-lg bg-slate-900 border border-slate-700 px-2 text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-slate-400 text-[11px]">{_t("角度分布模式")}</label>
                    <select
                      value={circMode}
                      onChange={(e) => setCircMode(e.target.value as any)}
                      className="h-8 rounded-lg bg-slate-900 border border-slate-700 px-2 text-slate-200 focus:outline-none focus:border-purple-500"
                    >
                      <option value="full">{_t("360° 整周均匀分布")}</option>
                      <option value="custom-angle">{_t("指定跨度总角度")}</option>
                    </select>
                  </div>
                </div>

                {circMode === 'custom-angle' && (
                  <div className="flex flex-col gap-1 animate-in fade-in duration-100">
                    <label className="text-slate-400 text-[11px]">{_t("跨度总角度 (°)")}</label>
                    <input
                      type="number"
                      min={1}
                      max={360}
                      value={totalAngle}
                      onChange={(e) => setTotalAngle(parseFloat(e.target.value) || 360)}
                      className="h-8 rounded-lg bg-slate-900 border border-slate-700 px-2 text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 生成总结说明 */}
          <div className="rounded-lg bg-slate-950/60 p-2.5 border border-slate-800/80 text-[11px] text-slate-400 flex flex-col gap-0.5">
            <div className="flex justify-between items-center text-slate-300 font-medium">
              <span>{_t("生成方式：")}</span>
              <span className="text-purple-300 font-mono">{_t("纯生成器模式 (Discrete Generator)")}</span>
            </div>
            <div className="text-slate-500">
              {_t("预计将新增")}<b className="text-emerald-400 font-mono">{generatedCount}</b> {_t("个新孔腔独立实例，并在特征树自动进行序号重命名。")}</div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex h-12 items-center justify-end gap-2 px-4 border-t border-slate-800 bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg px-3 text-xs font-medium hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            {_t("取消")}</button>
          <button
            type="button"
            disabled={selectedCavities.length === 0}
            onClick={handleConfirm}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white px-4 text-xs font-medium transition-colors shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Check className="size-3.5" />
            <span>{_t("生成离散阵列")}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
