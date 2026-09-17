import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useState, useMemo, type FC } from 'react'
import {
  FlipHorizontal,
  Copy,
  Move,
  X,
  Check
} from 'lucide-react'
import { useDesignStore, getSelectedCavityIds } from '../../model/designStore'
import posthog from '@renderer/lib/posthog'

interface MirrorWizardModalProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
}

/**
 * 镜像特征向导弹窗 (Mirror Wizard Modal)
 * 严格对齐 PRD-FR-05-04 §2 规范：
 * - 支持以 U=0 轴或 V=0 轴为基准对称面
 * - 支持复制副本模式（生成独立孔腔实例）与原地对称移动模式
 * - 纯生成器离散实例架构，生成后各实例可独立编辑
 */
export const MirrorWizardModal: FC<MirrorWizardModalProps> = ({
  projectId,
  isOpen,
  onClose
}) => {
  _useLocale()
  const session = useDesignStore((s) => s.projects[projectId])
  const applyMirror = useDesignStore((s) => s.applyMirror)

  const [axis, setAxis] = useState<'u-axis' | 'v-axis'>('u-axis')
  const [isCopy, setIsCopy] = useState<boolean>(true)

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

  const handleConfirm = () => {
    if (selectedCavityIds.length === 0) return
    applyMirror(projectId, selectedCavityIds, axis, isCopy)
    posthog.capture('mirror_applied', {
      axis,
      copied: isCopy,
      source_cavity_count: selectedCavityIds.length
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-[420px] rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden flex flex-col text-slate-100">
        {/* Header */}
        <div className="flex h-12 items-center justify-between px-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <FlipHorizontal className="size-4 text-amber-400" />
            <span>{_t("镜像特征向导 (Mirror Wizard)")}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 flex flex-col gap-4 text-xs">
          {/* 选中的孔腔简要信息 */}
          <div className="rounded-lg bg-slate-800/60 p-3 border border-slate-700/50 flex flex-col gap-1">
            <div className="flex justify-between text-slate-400">
              <span>{_t("已选孔腔源对象：")}</span>
              <span className="font-medium text-slate-200">{selectedCavities.length} {_t("个实例")}</span>
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {selectedCavities.map((c) => c.name).join(', ')}
            </div>
          </div>

          {/* 对称轴选择 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-300 font-medium">{_t("对称参考轴：")}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAxis('u-axis')}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all cursor-pointer ${
                  axis === 'u-axis'
                    ? 'border-amber-500/80 bg-amber-500/10 text-amber-300 font-medium shadow-sm'
                    : 'border-slate-800 bg-slate-800/40 hover:bg-slate-800 text-slate-400'
                }`}
              >
                <span className="text-sm font-semibold">{_t("U = 0 轴 (沿 V 轴)")}</span>
                <span className="text-[11px] opacity-80">{_t("水平镜像翻转 (U' = -U)")}</span>
              </button>

              <button
                type="button"
                onClick={() => setAxis('v-axis')}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all cursor-pointer ${
                  axis === 'v-axis'
                    ? 'border-amber-500/80 bg-amber-500/10 text-amber-300 font-medium shadow-sm'
                    : 'border-slate-800 bg-slate-800/40 hover:bg-slate-800 text-slate-400'
                }`}
              >
                <span className="text-sm font-semibold">{_t("V = 0 轴 (沿 U 轴)")}</span>
                <span className="text-[11px] opacity-80">{_t("垂直镜像翻转 (V' = -V)")}</span>
              </button>
            </div>
          </div>

          {/* 模式选择：复制副本 vs 移动原孔 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-300 font-medium">{_t("生成模式：")}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsCopy(true)}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all cursor-pointer ${
                  isCopy
                    ? 'border-blue-500/80 bg-blue-500/10 text-blue-300 font-medium'
                    : 'border-slate-800 bg-slate-800/40 hover:bg-slate-800 text-slate-400'
                }`}
              >
                <Copy className="size-3.5" />
                <span>{_t("复制生成新副本")}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsCopy(false)}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all cursor-pointer ${
                  !isCopy
                    ? 'border-blue-500/80 bg-blue-500/10 text-blue-300 font-medium'
                    : 'border-slate-800 bg-slate-800/40 hover:bg-slate-800 text-slate-400'
                }`}
              >
                <Move className="size-3.5" />
                <span>{_t("对称移动原对象")}</span>
              </button>
            </div>
          </div>

          {/* 预览坐标提示 */}
          <div className="rounded-lg bg-slate-950/60 p-2.5 border border-slate-800/80 text-[11px] text-slate-400 flex flex-col gap-1 font-mono">
            <span className="text-slate-500">{_t("坐标映射示例：")}</span>
            {selectedCavities.slice(0, 2).map((c) => {
              const nu = axis === 'u-axis' ? -c.u : c.u
              const nv = axis === 'v-axis' ? -c.v : c.v
              return (
                <div key={c.instanceId} className="flex justify-between">
                  <span>{c.name}: ({c.u}, {c.v})</span>
                  <span className="text-emerald-400">→ ({nu}, {nv})</span>
                </div>
              )
            })}
            {selectedCavities.length > 2 && (
              <span className="text-slate-600">{_t("... 其余")}{selectedCavities.length - 2} {_t("个孔腔将按同规则映射")}</span>
            )}
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
            className="flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white px-4 text-xs font-medium transition-colors shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Check className="size-3.5" />
            <span>{_t("生成镜像")}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
