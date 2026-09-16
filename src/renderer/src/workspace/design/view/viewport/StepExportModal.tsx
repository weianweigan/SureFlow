import { translateMessage } from '@shared/i18n'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
/**
 * 高精度 STEP 实体导出向导模态对话框 (PRD-FR-04-07 §3)
 * 1. 方案选择：当前方案或多方案导出；
 * 2. 协议版本：AP214 (默认) / AP203 / AP242；
 * 3. 公差精度：默认 0.01mm；
 * 4. 油口孔壁着色开关（与 3D 模型保持一致）；
 * 5. 非阻塞式多阶段进度指示 (0% -> 100%) 与落盘触发。
 */

import { useState, useId, type FC } from 'react'
import {
  X,
  FileDown,
  Layers,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Palette
} from 'lucide-react'
import { useDesignStore } from '../../model/designStore'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { cadBridge } from '../../worker/cad/cadWorkerBridge'
import { getBoxFaceBasis, getCavityWorldMatrix } from '@shared/design/faceMath'
import { getCavitySteps } from '../../geometry/cavityProfileBuilder'
import { cn } from '@renderer/lib/utils'

interface StepExportModalProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
}

export const StepExportModal: FC<StepExportModalProps> = ({ projectId, isOpen, onClose }) => {
  _useLocale()
  const session = useDesignStore((s) => s.projects[projectId])
  const libraryDoc = useLibraryStore((s) => s.doc)

  const doc = session?.doc
  const activeSchemeId = doc?.activeSchemeId || doc?.schemes[0]?.id || ''

  const [selectedSchemeIds, setSelectedSchemeIds] = useState<string[]>(() => [activeSchemeId])
  const [protocol, setProtocol] = useState<'AP214' | 'AP203' | 'AP242'>('AP214')
  const [tolerance, setTolerance] = useState<number>(0.01)
  const [colorPorts, setColorPorts] = useState<boolean>(true)

  const [isExporting, setIsExporting] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  const [stage, setStage] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [successInfo, setSuccessInfo] = useState<string | null>(null)

  const toleranceId = useId()
  const colorPortsId = useId()

  if (!isOpen || !doc) return null

  const handleToggleScheme = (id: string) => {
    if (isExporting) return
    setSelectedSchemeIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev // 至少保留一个
        return prev.filter((x) => x !== id)
      } else {
        return [...prev, id]
      }
    })
  }

  const handleStartExport = async () => {
    if (isExporting) return
    setError(null)
    setSuccessInfo(null)
    setIsExporting(true)
    setProgress(0)
    setStage('准备导出数据...')

    try {
      const schemesToExport = doc.schemes.filter((s) => selectedSchemeIds.includes(s.id))
      if (schemesToExport.length === 0) {
        throw new Error(_t("请至少选择一个待导出的方案"))
      }

      for (let sIdx = 0; sIdx < schemesToExport.length; sIdx++) {
        const scheme = schemesToExport[sIdx]

        // 构建孔腔几何与 4x4 世界变换矩阵
        const cavitiesInput = scheme.cavities
          .filter((c) => !c.suppressed)
          .map((cav, idx) => {
            const basis = getBoxFaceBasis(cav.faceId, doc.baseBody.dimensions)
            const worldMatrix = Array.from(
              getCavityWorldMatrix(
                basis,
                cav.u,
                cav.v,
                cav.depthOffset,
                cav.rotation,
                cav.tiltAngle || 0,
                cav.azimuth ?? cav.rotation ?? 0
              )
            )
            const steps = cav.steps && cav.steps.length > 0 ? cav.steps : getCavitySteps(cav, libraryDoc)
            return {
              instanceId: cav.instanceId,
              numericId: idx + 1,
              steps,
              worldMatrix,
              name: cav.subHoleName || cav.name,
              color: cav.portSemantic?.color
            }
          })

        setStage(_msg`正在构建方案拓扑: 「${scheme.name}」...`)

        const stepContent = await cadBridge.exportStep(
          {
            exportConfig: {
              protocol,
              tolerance,
              colorPorts
            },
            baseBody: {
              dimensions: doc.baseBody.dimensions
            },
            cavities: cavitiesInput
          },
          (p, currentStage) => {
            // 将单方案进度映射到总进度
            const overallProgress = Math.round(
              ((sIdx + p / 100) / schemesToExport.length) * 100
            )
            setProgress(overallProgress)
            setStage(`[${scheme.name}] ${currentStage}`)
          }
        )

        // 弹出系统保存对话框落盘
        const defaultName = `${doc.meta.projectName || _t("阀块设计")}_${scheme.name}.step`
        const savedPath = await window.projectApi.saveStepDialog({
          defaultName,
          stepContent
        })

        if (!savedPath) {
          setStage('用户取消了文件保存')
          setIsExporting(false)
          return
        }
      }

      setProgress(100)
      setStage('全部 STEP 实体文件导出并保存成功！')
      setSuccessInfo('STEP 实体文件已成功落盘，可在制造与 CAD 软件中直接使用。')
    } catch (err: any) {
      console.error('[StepExportModal] 导出失败:', err)
      setError(err?.message || _t("导出 STEP 实体模型过程中发生错误"))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none">
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl text-card-foreground">
        {/* 顶部标题 */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
              <FileDown className="size-4.5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">{_t("导出 STEP 实体模型")}</h2>
              <p className="text-[11px] text-muted-foreground">
                {_t("基于 OpenCASCADE 高精度 B-Rep 解析内核生成工业标准实体")}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={isExporting}
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 主配置表单 */}
        <div className="space-y-4 py-4 text-xs">
          {/* 1. 导出方案选择 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-medium text-foreground flex items-center gap-1.5">
                <Layers className="size-3.5 text-blue-500" />
                <span>{_t("选择导出方案")}</span>
              </label>
              <span className="text-[11px] text-muted-foreground">
                {_t("已选")}{selectedSchemeIds.length} / {doc.schemes.length} {_t("个方案")}</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 max-h-32 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2">
              {doc.schemes.map((scheme) => {
                const isSelected = selectedSchemeIds.includes(scheme.id)
                const isCurrent = scheme.id === activeSchemeId
                return (
                  <label
                    key={scheme.id}
                    onClick={() => handleToggleScheme(scheme.id)}
                    className={cn(
                      'flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors',
                      isSelected
                        ? 'bg-blue-600/15 border border-blue-500/40 text-foreground font-medium'
                        : 'hover:bg-accent/60 text-muted-foreground'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isExporting}
                        onChange={() => {}}
                        className="rounded border-border text-blue-600 focus:ring-blue-500 size-3.5 cursor-pointer"
                      />
                      <span>{scheme.name}</span>
                      {isCurrent && (
                        <span className="rounded bg-blue-500/20 px-1 py-0.2 text-[10px] text-blue-400">
                          {_t("当前激活")}</span>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {scheme.cavities.filter((c) => !c.suppressed).length} {_t("孔")}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* 2. STEP 协议版本选择 */}
          <div>
            <label className="font-medium text-foreground flex items-center gap-1.5 mb-1.5">
              <Cpu className="size-3.5 text-blue-500" />
              <span>{_t("STEP 协议版本")}</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'AP214', name: 'AP214 (推荐)', desc: _t("支持颜色与装配拓扑") },
                { id: 'AP203', name: 'AP203', desc: _t("经典通用 CAD 几何") },
                { id: 'AP242', name: 'AP242', desc: _t("新一代航空制造标准") }
              ].map((p) => {
                const active = protocol === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={isExporting}
                    onClick={() => setProtocol(p.id as any)}
                    className={cn(
                      'flex flex-col items-start p-2.5 rounded-lg border text-left transition-all cursor-pointer disabled:opacity-50',
                      active
                        ? 'border-blue-500 bg-blue-500/10 text-foreground shadow-xs'
                        : 'border-border bg-card/60 hover:bg-accent text-muted-foreground'
                    )}
                  >
                    <span className={cn('text-xs font-semibold', active ? 'text-blue-500' : 'text-foreground')}>
                      {p.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                      {p.desc}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 3. 公差精度与油口着色配置 */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <label htmlFor={toleranceId} className="block text-xs font-medium text-foreground mb-1">
                {_t("公差精度 (Tolerance)")}</label>
              <div className="flex items-center gap-2">
                <input
                  id={toleranceId}
                  type="number"
                  disabled={isExporting}
                  min={0.001}
                  max={0.1}
                  step={0.005}
                  value={tolerance}
                  onChange={(e) => setTolerance(parseFloat(e.target.value) || 0.01)}
                  className="w-24 rounded border border-input bg-background px-2 py-1 text-xs font-mono text-foreground focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-[11px] text-muted-foreground font-mono">mm</span>
              </div>
              <span className="text-[10px] text-muted-foreground mt-1 block">
                {_t("默认 0.01mm，保障制造级贴合")}</span>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3 flex flex-col justify-between">
              <div>
                <label htmlFor={colorPortsId} className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1 cursor-pointer">
                  <Palette className="size-3 text-emerald-500" />
                  <span>{_t("油口孔壁着色")}</span>
                </label>
                <span className="text-[10px] text-muted-foreground block leading-tight">
                  {_t("导出与 3D 视图保持一致的油口水力语义色彩")}</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input
                  id={colorPortsId}
                  type="checkbox"
                  disabled={isExporting}
                  checked={colorPorts}
                  onChange={(e) => setColorPorts(e.target.checked)}
                  className="rounded border-border text-blue-600 focus:ring-blue-500 size-4 cursor-pointer"
                />
                <label htmlFor={colorPortsId} className="text-xs text-foreground cursor-pointer">
                  {colorPorts ? _t("开启语义着色") : _t("单色中性金属")}
                </label>
              </div>
            </div>
          </div>

          {/* 进度条与阶段状态指示 */}
          {isExporting && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 animate-in fade-in space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-blue-400 truncate max-w-[320px]">
                  {translateMessage(stage)}
                </span>
                <span className="font-mono font-bold text-blue-500">{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-blue-600 transition-all duration-200 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* 错误警示 */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{translateMessage(error)}</span>
            </div>
          )}

          {/* 成功提示 */}
          {successInfo && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
              <span>{successInfo}</span>
            </div>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
          <button
            type="button"
            disabled={isExporting}
            onClick={onClose}
            className="rounded-md border border-border px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors cursor-pointer disabled:opacity-40"
          >
            {successInfo ? _t("完成") : _t("取消")}
          </button>
          {!successInfo && (
            <button
              type="button"
              disabled={isExporting || selectedSchemeIds.length === 0}
              onClick={handleStartExport}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-40"
            >
              {isExporting ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span>{_t("正在导出...")}</span>
                </>
              ) : (
                <>
                  <FileDown className="size-3.5" />
                  <span>{_t("开始导出 STEP")}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
