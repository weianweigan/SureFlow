import { translateMessage } from '@shared/i18n'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
/**
 * 高精度 STEP 实体导出模态对话框 (PRD-FR-04-07 §3)
 */

import { useState, useId, useEffect, type FC } from 'react'
import {
  X,
  FileDown,
  Layers,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Palette,
  Eye,
  FolderOpen
} from 'lucide-react'
import { useDesignStore } from '../../model/designStore'
import { useAnalysisStore } from '../../model/analysisStore'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { cadBridge } from '../../worker/cad/cadWorkerBridge'
import { getBoxFaceBasis, getCavityWorldMatrix } from '@shared/design/faceMath'
import { getCavitySteps } from '../../geometry/cavityProfileBuilder'
import { extractCavityThreadSpec } from '../../worker/cad/cadExportService'
import { solveChannelTopology } from '@shared/design/topology/channelSolver'
import {
  resolveExportPath,
  toPersistedExportPath,
  computeSchemeExportPath
} from '@shared/design/exportPathUtils'
import { cn } from '@renderer/lib/utils'
import posthog from '@renderer/lib/posthog'

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
  const [transparentBase, setTransparentBase] = useState<boolean>(true)

  // 导出路径状态
  const [exportPath, setExportPath] = useState<string>(() => {
    return resolveExportPath(doc?.meta.lastExportPath, session?.filePath, doc?.meta.projectName)
  })

  const [isExporting, setIsExporting] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  const [stage, setStage] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [successInfo, setSuccessInfo] = useState<string | null>(null)

  const toleranceId = useId()
  const colorPortsId = useId()
  const transparentBaseId = useId()
  const exportPathId = useId()

  // 每次打开弹窗时重置状态，确保可以再次导出，并刷新最新路径
  useEffect(() => {
    if (isOpen && doc) {
      setSuccessInfo(null)
      setError(null)
      setProgress(0)
      setStage('')
      setIsExporting(false)
      setSelectedSchemeIds([activeSchemeId])
      setExportPath(resolveExportPath(doc.meta.lastExportPath, session?.filePath, doc.meta.projectName))
    }
  }, [isOpen, activeSchemeId, session?.filePath])

  if (!isOpen || !doc) return null

  const handleSelectPath = async () => {
    if (isExporting) return
    const resolved = resolveExportPath(exportPath.trim(), session?.filePath, doc?.meta.projectName)
    const cleanDefault = resolved.replace(/^\.[\\/]/, '') || 'manifold.step'
    try {
      let chosen: string | null = null
      if (typeof window.projectApi?.selectStepPath === 'function') {
        chosen = await window.projectApi.selectStepPath(cleanDefault)
      } else if (typeof window.projectApi?.saveStepDialog === 'function') {
        chosen = await window.projectApi.saveStepDialog({
          defaultName: cleanDefault,
          stepContent: ''
        })
      }
      if (chosen) {
        setExportPath(chosen)
      }
    } catch (err) {
      console.error('[StepExportModal] 选择路径异常:', err)
    }
  }

  const handleToggleScheme = (id: string) => {
    if (isExporting) return
    setSelectedSchemeIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev
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
      const baseExportPath = exportPath.trim()
      if (!baseExportPath) {
        throw new Error(_t("请先指定有效的 STEP 导出文件路径"))
      }

      const schemesToExport = doc.schemes.filter((s) => selectedSchemeIds.includes(s.id))
      if (schemesToExport.length === 0) {
        throw new Error(_t("请至少选择一个待导出的方案"))
      }

      for (let sIdx = 0; sIdx < schemesToExport.length; sIdx++) {
        const scheme = schemesToExport[sIdx]

        // 求解当前方案的通道拓扑结构与颜色
        const cavitiesWithSteps = scheme.cavities
          .filter((c) => !c.suppressed)
          .map((c) => ({
            ...c,
            steps: c.steps && c.steps.length > 0 ? c.steps : getCavitySteps(c, libraryDoc)
          }))
        const channelTopology = solveChannelTopology(cavitiesWithSteps, doc.baseBody.dimensions, scheme.channelConfigs)
        const channelList = channelTopology.channels.map((ch) => ({
          id: ch.id,
          name: ch.name,
          color: ch.color,
          cavityIds: ch.cavityIds,
          regions: ch.regions
        }))

        // 构建孔腔几何与 4x4 世界变换矩阵
        const cavitiesInput = cavitiesWithSteps.map((cav, idx) => {
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
          const matchedCh = channelList.find((ch) => ch.cavityIds.includes(cav.instanceId))
          const template = libraryDoc?.templates?.find((t) => t.id === cav.templateId)
          const threadSpec = extractCavityThreadSpec(cav.steps)
          return {
            instanceId: cav.instanceId,
            numericId: idx + 1,
            steps: cav.steps,
            ports: cav.ports,
            worldMatrix,
            name: cav.subHoleName || cav.name,
            color: cav.portSemantic?.color,
            channelId: matchedCh?.id,
            channelColor: matchedCh?.color,
            channelName: matchedCh?.name,
            templateId: cav.templateId,
            templateName: template?.name || cav.name,
            libraryId: cav.libraryId,
            cavityType: cav.cavityType || template?.cavityType,
            faceId: cav.faceId,
            u: cav.u,
            v: cav.v,
            threadSpec,
            portSemantic: cav.portSemantic?.label
          }
        })

        setStage(_msg`正在构建方案拓扑: 「${scheme.name}」...`)

        const stepContent = await cadBridge.exportStep(
          {
            exportConfig: {
              protocol,
              tolerance,
              colorPorts,
              transparentBaseBody: transparentBase,
              mountingFacesTransparent: transparentBase,
              transparency: 0.7,
              stableTopology: true
            },
            baseBody: {
              dimensions: doc.baseBody.dimensions
            },
            cavities: cavitiesInput,
            channels: channelList
          },
          (p, currentStage) => {
            const overallProgress = Math.round(
              ((sIdx + p / 100) / schemesToExport.length) * 100
            )
            setProgress(overallProgress)
            setStage(`[${scheme.name}] ${currentStage}`)
          }
        )

        // 直接写入目标文件路径（多方案自动追加方案后缀，避免相互覆盖）
        const isMultiScheme = schemesToExport.length > 1
        const targetPath = computeSchemeExportPath(baseExportPath, scheme.name, isMultiScheme)

        setStage(_msg`正在将实体模型写入磁盘: ${targetPath}...`)

        if (window.projectApi?.saveStepFile) {
          await window.projectApi.saveStepFile({
            filePath: targetPath,
            stepContent
          })
        } else {
          await window.projectApi.saveStepDialog({
            defaultName: targetPath,
            stepContent,
            targetPath
          })
        }
      }

      // 记录本次导出路径到 .sfb 文件中（同目录自动转换为相对路径）
      const persistedPath = toPersistedExportPath(baseExportPath, session?.filePath)
      useDesignStore.getState().setLastExportPath(projectId, persistedPath)
      if (session?.filePath) {
        const currentSession = useDesignStore.getState().projects[projectId]
        if (currentSession) {
          window.projectApi.save({
            filePath: session.filePath,
            doc: currentSession.doc
          }).catch((err) => {
            console.warn('[StepExportModal] 保存 lastExportPath 到 .sfb 失败:', err)
          })
        }
      }

      setProgress(100)
      setStage('全部 STEP 实体文件导出并保存成功！')
      setSuccessInfo(
        schemesToExport.length > 1
          ? _msg`已成功将 ${schemesToExport.length} 个方案的 STEP 实体文件落盘！`
          : _msg`STEP 实体文件已成功落盘至：${baseExportPath}`
      )
      posthog.capture('step_export_completed', {
        scheme_count: schemesToExport.length,
        protocol,
        color_ports: colorPorts
      })
    } catch (err: any) {
      console.error('[StepExportModal] 导出失败:', err)
      setError(err?.message || _t("导出 STEP 实体模型过程中发生错误"))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none">
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl text-card-foreground">
        {/* 顶部标题 */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <FileDown className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{_t("导出 STEP 实体模型")}</h2>
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
        <div className="space-y-3.5 py-3.5 text-xs">
          {/* 1. 导出方案选择 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-medium text-foreground flex items-center gap-1.5">
                <Layers className="size-3.5 text-muted-foreground" />
                <span>{_t("导出方案")}</span>
              </label>
              <span className="text-[11px] text-muted-foreground">
                {selectedSchemeIds.length} / {doc.schemes.length}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1 max-h-28 overflow-y-auto rounded-lg border border-border bg-muted/30 p-1.5">
              {doc.schemes.map((scheme) => {
                const isSelected = selectedSchemeIds.includes(scheme.id)
                const isCurrent = scheme.id === activeSchemeId
                return (
                  <label
                    key={scheme.id}
                    onClick={() => handleToggleScheme(scheme.id)}
                    className={cn(
                      'flex items-center justify-between px-2.5 py-1 rounded-md text-xs cursor-pointer transition-colors',
                      isSelected
                        ? 'bg-accent border border-border text-foreground font-medium'
                        : 'hover:bg-accent/60 text-muted-foreground'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isExporting}
                        onChange={() => {}}
                        className="rounded border-border text-primary focus:ring-primary size-3.5 cursor-pointer"
                      />
                      <span>{scheme.name}</span>
                      {isCurrent && (
                        <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">
                          {_t("当前")}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {scheme.cavities.filter((c) => !c.suppressed).length} {_t("孔")}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* 2. STEP 协议版本选择 */}
          <div>
            <label className="font-medium text-foreground flex items-center gap-1.5 mb-1.5">
              <Cpu className="size-3.5 text-muted-foreground" />
              <span>{_t("协议版本")}</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'AP214', name: 'AP214 (推荐)' },
                { id: 'AP203', name: 'AP203' },
                { id: 'AP242', name: 'AP242' }
              ].map((p) => {
                const active = protocol === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={isExporting}
                    onClick={() => setProtocol(p.id as any)}
                    className={cn(
                      'py-1.5 px-2.5 rounded-lg border text-center transition-all cursor-pointer disabled:opacity-50 text-xs font-medium',
                      active
                        ? 'border-primary bg-primary/10 text-foreground shadow-xs'
                        : 'border-border bg-card hover:bg-accent text-muted-foreground'
                    )}
                  >
                    {p.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 3. 公差精度、通道着色与基体透明配置 */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-lg border border-border bg-muted/20 p-2.5">
              <label htmlFor={toleranceId} className="block text-xs font-medium text-foreground mb-1.5">
                {_t("公差精度")}
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id={toleranceId}
                  type="number"
                  disabled={isExporting}
                  min={0.001}
                  max={0.1}
                  step={0.005}
                  value={tolerance}
                  onChange={(e) => setTolerance(parseFloat(e.target.value) || 0.01)}
                  className="w-full rounded border border-input bg-background px-2 py-1 text-xs font-mono text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
                <span className="text-[11px] text-muted-foreground font-mono">mm</span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-2.5 flex flex-col justify-between">
              <label htmlFor={colorPortsId} className="flex items-center gap-1.5 text-xs font-medium text-foreground cursor-pointer">
                <Palette className="size-3 text-muted-foreground" />
                <span>{_t("流道与油口着色")}</span>
              </label>
              <label htmlFor={colorPortsId} className="flex items-center gap-2 mt-2 text-xs text-foreground cursor-pointer">
                <input
                  id={colorPortsId}
                  type="checkbox"
                  disabled={isExporting}
                  checked={colorPorts}
                  onChange={(e) => setColorPorts(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary size-4 cursor-pointer"
                />
                <span>{colorPorts ? _t("按通道着色") : _t("单色中性")}</span>
              </label>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-2.5 flex flex-col justify-between">
              <label htmlFor={transparentBaseId} className="flex items-center gap-1.5 text-xs font-medium text-foreground cursor-pointer">
                <Eye className="size-3 text-muted-foreground" />
                <span>{_t("基体半透明")}</span>
              </label>
              <label htmlFor={transparentBaseId} className="flex items-center gap-2 mt-2 text-xs text-foreground cursor-pointer">
                <input
                  id={transparentBaseId}
                  type="checkbox"
                  disabled={isExporting}
                  checked={transparentBase}
                  onChange={(e) => setTransparentBase(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary size-4 cursor-pointer"
                />
                <span>{transparentBase ? _t("半透明透视") : _t("不透明")}</span>
              </label>
            </div>
          </div>

          {/* 4. 导出文件路径配置 */}
          <div className="rounded-lg border border-border bg-muted/20 p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor={exportPathId} className="font-medium text-foreground flex items-center gap-1.5">
                <FolderOpen className="size-3.5 text-muted-foreground" />
                <span>{_t("导出路径")}</span>
              </label>
              {session?.filePath && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  {_t("同级目录将保存相对路径")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                id={exportPathId}
                type="text"
                disabled={isExporting}
                value={exportPath}
                onChange={(e) => setExportPath(e.target.value)}
                placeholder={_t("请指定保存路径...")}
                className="flex-1 rounded border border-input bg-background px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
              <button
                type="button"
                disabled={isExporting}
                onClick={handleSelectPath}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-border bg-card hover:bg-accent text-foreground text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 shrink-0 shadow-xs"
                title={_t("浏览并选择保存路径")}
              >
                <FolderOpen className="size-3.5 text-muted-foreground" />
                <span>{_t("选择路径...")}</span>
              </button>
            </div>
          </div>

          {/* 设计检查状态提示 (PRD-FR-04-15 §13.3) */}
          {(() => {
            const schemeAnalysis = useAnalysisStore.getState().resultsByScheme[activeSchemeId]
            const issues = schemeAnalysis?.issues || []
            const errorCount = issues.filter((i) => i.severity === 'error').length
            const warningCount = issues.filter((i) => i.severity === 'warning').length
            const isComputing = schemeAnalysis?.isComputing

            if (isExporting || successInfo) return null

            if (isComputing) {
              return (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
                  <span className="size-2 rounded-full bg-primary animate-ping shrink-0" />
                  <span>{_t("正在后台执行设计检查...")}</span>
                </div>
              )
            }

            if (errorCount > 0 || warningCount > 0) {
              return (
                <div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-500">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="size-3.5 shrink-0 text-amber-500" />
                    <span>
                      {errorCount > 0 ? `${errorCount} 项错误 ` : ''}
                      {warningCount > 0 ? `${warningCount} 项警告` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      useAnalysisStore.getState().togglePanel(true)
                    }}
                    className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-foreground text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    {_t("查看")}
                  </button>
                </div>
              )
            }

            return null
          })()}

          {/* 进度条与阶段状态指示 */}
          {isExporting && (
            <div className="rounded-lg border border-border bg-muted/20 p-2.5 animate-in fade-in space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground truncate max-w-[320px]">
                  {translateMessage(stage)}
                </span>
                <span className="font-mono font-bold text-primary">{progress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-200 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* 错误警示 */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span>{translateMessage(error)}</span>
            </div>
          )}

          {/* 成功提示 */}
          {successInfo && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-500">
              <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
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
          <button
            type="button"
            disabled={isExporting || selectedSchemeIds.length === 0}
            onClick={handleStartExport}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-40"
          >
            {isExporting ? (
              <>
                <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                <span>{_t("正在导出...")}</span>
              </>
            ) : (
              <>
                <FileDown className="size-3.5" />
                <span>{successInfo ? _t("再次导出") : _t("开始导出 STEP")}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
