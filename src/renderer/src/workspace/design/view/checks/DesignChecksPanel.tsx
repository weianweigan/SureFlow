/**
 * 设计检查可伸缩底栏面板 (DesignChecksPanel)
 * 严格对齐 PRD-FR-04-15 §4
 *
 * 特性：
 * 1. 点击错误行选中对应 3D 孔腔/表面特征
 * 2. 灰色辅助信息归入 Tooltip，大幅压缩表格行高
 * 3. 移除实测值 Tab，专注展示设计检查问题
 * 4. 错误/警告支持一键筛选，默认仅显示错误 (隐藏警告)
 * 5. 消除多余的双层灰色分割线
 */

import React, { useMemo } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Settings2,
  X,
  Search
} from 'lucide-react'
import { useDesignStore } from '../../model/designStore'
import { useAnalysisStore } from '../../model/analysisStore'
import {
  RULE_DEFINITIONS,
  RULE_CATEGORY_LABELS
} from '@shared/design/analysis/ruleRegistry'
import {
  DEFAULT_CHECK_CONFIG,
  type CheckConfig,
  type CheckIssue
} from '@shared/design/analysis/contracts'
import { RuleSettingsModal } from './RuleSettingsModal'

interface DesignChecksPanelProps {
  projectId: string
  onRecheck?: () => void
}

export const DesignChecksPanel: React.FC<DesignChecksPanelProps> = ({ projectId, onRecheck }) => {
  const session = useDesignStore((s) => s.projects[projectId])
  const selectFeature = useDesignStore((s) => s.selectFeature)
  const doc = session?.doc
  const activeScheme = doc?.schemes.find((s) => s.id === doc.activeSchemeId) || doc?.schemes[0]
  const schemeId = activeScheme?.id || 'default'

  // Store 状态
  const isOpen = useAnalysisStore((s) => s.isOpen)
  const panelHeight = useAnalysisStore((s) => s.panelHeight)
  const togglePanel = useAnalysisStore((s) => s.togglePanel)
  const severityFilter = useAnalysisStore((s) => s.severityFilter)
  const setSeverityFilter = useAnalysisStore((s) => s.setSeverityFilter)
  const categoryFilter = useAnalysisStore((s) => s.categoryFilter)
  const setCategoryFilter = useAnalysisStore((s) => s.setCategoryFilter)
  const searchText = useAnalysisStore((s) => s.searchText)
  const setSearchText = useAnalysisStore((s) => s.setSearchText)
  const selectedIssueId = useAnalysisStore((s) => s.selectedIssueId)
  const selectIssue = useAnalysisStore((s) => s.selectIssue)
  const isRuleSettingsOpen = useAnalysisStore((s) => s.isRuleSettingsOpen)
  const setRuleSettingsOpen = useAnalysisStore((s) => s.setRuleSettingsOpen)

  const schemeData = useAnalysisStore((s) => s.resultsByScheme[schemeId])
  const issues = schemeData?.issues || []
  const isComputing = schemeData?.isComputing || false

  const config: CheckConfig = activeScheme?.checkConfig || DEFAULT_CHECK_CONFIG



  // 统计数据
  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length

  // 过滤后的问题列表（默认仅显示错误，可筛选警告或全部）
  const filteredIssues = useMemo(() => {
    return issues.filter((item) => {
      if (severityFilter !== 'all' && item.severity !== severityFilter) {
        return false
      }
      if (categoryFilter !== 'all') {
        const ruleDef = RULE_DEFINITIONS[item.ruleId]
        if (ruleDef?.category !== categoryFilter) return false
      }
      if (searchText.trim() !== '') {
        const q = searchText.toLowerCase()
        const ruleTitle = RULE_DEFINITIONS[item.ruleId]?.title.toLowerCase() || ''
        const args = Object.values(item.messageArgs).join(' ').toLowerCase()
        if (!ruleTitle.includes(q) && !item.ruleId.toLowerCase().includes(q) && !args.includes(q)) {
          return false
        }
      }
      return true
    })
  }, [issues, severityFilter, categoryFilter, searchText])

  if (!isOpen) return null

  // 点击错误行：选中相关特征对象，并高亮视口引线
  const handleIssueClick = (issue: CheckIssue) => {
    selectIssue(issue.id)

    if (!issue.evidence?.refs || issue.evidence.refs.length === 0) return

    const cavityRefs = issue.evidence.refs.filter((r) => r.kind === 'cavity') as Array<{
      kind: 'cavity'
      instanceId: string
    }>
    const faceRefs = issue.evidence.refs.filter((r) => r.kind === 'base-face') as Array<{
      kind: 'base-face'
      faceId: string
    }>

    if (cavityRefs.length === 1) {
      selectFeature(projectId, { type: 'cavity', id: cavityRefs[0].instanceId })
    } else if (cavityRefs.length > 1) {
      selectFeature(projectId, {
        type: 'cavity',
        id: cavityRefs[0].instanceId,
        extraIds: cavityRefs.slice(1).map((c) => c.instanceId)
      })
    } else if (faceRefs.length > 0) {
      selectFeature(projectId, { type: 'face', id: faceRefs[0].faceId })
    }
  }

  const handleToggleAuto = (enabled: boolean) => {
    const updated: CheckConfig = { ...config, autoEnabled: enabled }
    useDesignStore.setState((state) => {
      const proj = state.projects[projectId]
      if (!proj) return state
      const nextSchemes = proj.doc.schemes.map((s) => {
        if (s.id === schemeId) return { ...s, checkConfig: updated }
        return s
      })
      return {
        projects: {
          ...state.projects,
          [projectId]: { ...proj, dirty: true, doc: { ...proj.doc, schemes: nextSchemes } }
        }
      }
    })
  }

  const handleUpdateQuickWall = (key: 'minHoleWall' | 'minOuterWall', val: number) => {
    const updated: CheckConfig = {
      ...config,
      [key]: { value: Math.max(0, val), unit: 'mm' }
    }
    useDesignStore.setState((state) => {
      const proj = state.projects[projectId]
      if (!proj) return state
      const nextSchemes = proj.doc.schemes.map((s) => {
        if (s.id === schemeId) return { ...s, checkConfig: updated }
        return s
      })
      return {
        projects: {
          ...state.projects,
          [projectId]: { ...proj, dirty: true, doc: { ...proj.doc, schemes: nextSchemes } }
        }
      }
    })
  }

  const getIssueDescription = (issue: CheckIssue): string => {
    if (issue.messageKey === 'hole_to_hole_wall_too_thin') {
      return `孔间壁厚仅 ${issue.messageArgs.measured} mm，小于要求的 ${issue.messageArgs.required} mm`
    }
    if (issue.messageKey === 'hole_to_outer_wall_too_thin') {
      return `孔到 ${issue.messageArgs.face} 壁厚仅 ${issue.messageArgs.measured} mm`
    }
    if (issue.messageKey === 'abnormal_breakthrough_without_receiver') {
      return `孔异常穿出 ${issue.messageArgs.face}，未覆盖面积 ${issue.messageArgs.uncoveredArea} mm²`
    }
    if (issue.messageKey === 'opening_area_insufficient') {
      return `交汇截面 ${issue.messageArgs.measured} mm² 不足要求值 ${issue.messageArgs.required} mm²`
    }
    if (issue.messageKey === 'outline_overlap') {
      return `二维安装轮廓重叠量达 ${issue.messageArgs.overlap} mm`
    }
    return String(issue.messageArgs.message || issue.remediation || '请调整相关孔位或工艺参数')
  }

  return (
    <div
      className="flex flex-col w-full bg-background select-none overflow-hidden"
      style={{ height: panelHeight }}
    >
      {/* 顶部主操作栏 (单层分割线，不加额外顶边框) */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/80 bg-muted/20 text-xs shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <CheckCircle2 className="size-3.5 text-primary" />
            <span>设计检查</span>
            {isComputing && (
              <span className="flex items-center gap-1 text-[10px] text-primary font-mono ml-1.5 animate-pulse">
                <RefreshCw className="size-2.5 animate-spin" />
                <span>更新中...</span>
              </span>
            )}
          </div>

          <label className="flex items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer text-[11px]">
            <input
              type="checkbox"
              checked={config.autoEnabled !== false}
              onChange={(e) => handleToggleAuto(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary size-3"
            />
            <span>自动检查</span>
          </label>

          <button
            type="button"
            onClick={onRecheck}
            disabled={isComputing}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-background hover:bg-accent text-foreground text-[11px] transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`size-2.5 ${isComputing ? 'animate-spin' : ''}`} />
            <span>重新检查</span>
          </button>

          <button
            type="button"
            onClick={() => setRuleSettingsOpen(true)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-background hover:bg-accent text-foreground text-[11px] transition-colors cursor-pointer"
          >
            <Settings2 className="size-2.5 text-muted-foreground" />
            <span>规则设置</span>
          </button>

          <div className="h-3 w-px bg-border" />

          {/* 快捷壁厚调节 */}
          <div className="flex items-center gap-2.5 text-muted-foreground text-[11px]">
            <div className="flex items-center gap-1">
              <span>孔间壁厚:</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={config.minHoleWall.value}
                onChange={(e) => handleUpdateQuickWall('minHoleWall', parseFloat(e.target.value) || 0)}
                className="w-11 bg-background border border-border rounded px-1 py-0.2 text-center font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span>mm</span>
            </div>

            <div className="flex items-center gap-1">
              <span>孔-外壁厚:</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={config.minOuterWall.value}
                onChange={(e) => handleUpdateQuickWall('minOuterWall', parseFloat(e.target.value) || 0)}
                className="w-11 bg-background border border-border rounded px-1 py-0.2 text-center font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span>mm</span>
            </div>
          </div>
        </div>

        {/* 右侧关闭按钮 */}
        <button
          type="button"
          onClick={() => togglePanel(false)}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title="关闭面板"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* 过滤工具栏：级别筛选、类别筛选与搜索 */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border/60 bg-muted/10 text-xs shrink-0">
        {/* 级别筛选切换按钮：默认仅显示错误 */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSeverityFilter('error')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer border ${
              severityFilter === 'error'
                ? 'bg-destructive/20 border-destructive/50 text-destructive'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
            title="仅显示错误问题（默认）"
          >
            <AlertCircle className="size-3" />
            <span>错误 ({errorCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setSeverityFilter('warning')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer border ${
              severityFilter === 'warning'
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-600 dark:text-amber-400'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
            title="仅显示警告"
          >
            <AlertTriangle className="size-3" />
            <span>警告 ({warningCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setSeverityFilter('all')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer border ${
              severityFilter === 'all'
                ? 'bg-accent border-border text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
            title="显示全部错误与警告"
          >
            <span>全部 ({issues.length})</span>
          </button>
        </div>

        {/* 右侧类别筛选与搜索 */}
        <div className="flex items-center gap-2">
          {/* 类别过滤 */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as any)}
            className="bg-background border border-border rounded px-2 py-0.5 text-[11px] text-foreground focus:outline-none cursor-pointer"
          >
            <option value="all">全部类别</option>
            {Object.entries(RULE_CATEGORY_LABELS).map(([cat, label]) => (
              <option key={cat} value={cat}>
                {label}
              </option>
            ))}
          </select>

          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索对象或规则..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-32 pl-6 pr-2 py-0.5 bg-background border border-border rounded text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* 问题表格：紧凑压缩行高，次要灰色信息放入 Tooltip */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredIssues.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-xs text-muted-foreground py-4">
            <CheckCircle2 className="size-5 text-emerald-500 mb-1" />
            <span>
              {severityFilter === 'error'
                ? '未发现错误级别问题'
                : severityFilter === 'warning'
                  ? '未发现警告级别问题'
                  : '暂无设计检查问题'}
            </span>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-[11px]">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-xs border-b border-border z-10 text-[11px] text-muted-foreground font-medium">
              <tr>
                <th className="py-1 px-2.5 w-14">级别</th>
                <th className="py-1 px-2.5 w-48">规则</th>
                <th className="py-1 px-2.5 w-40">关联对象</th>
                <th className="py-1 px-2.5 w-32">实测 / 要求</th>
                <th className="py-1 px-2.5">说明与建议</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredIssues.map((issue) => {
                const ruleDef = RULE_DEFINITIONS[issue.ruleId]
                const isSelected = selectedIssueId === issue.id
                const isError = issue.severity === 'error'

                const mVal = issue.measurements[0]
                const rVal = issue.requirements[0]

                const relatedObjects =
                  issue.messageArgs.holeA && issue.messageArgs.holeB
                    ? `${issue.messageArgs.holeA} ↔ ${issue.messageArgs.holeB}`
                    : String(
                        issue.messageArgs.hole ||
                          issue.messageArgs.name ||
                          issue.messageArgs.portA ||
                          issue.evidence?.refs?.map((r) => (r as any).instanceId || (r as any).faceId).join(', ') ||
                          '-'
                      )

                const desc = getIssueDescription(issue)

                return (
                  <tr
                    key={issue.id}
                    onClick={() => handleIssueClick(issue)}
                    className={`group hover:bg-accent/50 transition-colors cursor-pointer ${
                      isSelected ? 'bg-primary/10 hover:bg-primary/15 font-medium' : ''
                    }`}
                  >
                    {/* 级别 */}
                    <td className="py-1 px-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded font-medium ${
                          isError
                            ? 'bg-destructive/15 text-destructive'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {isError ? (
                          <AlertCircle className="size-2.5 shrink-0" />
                        ) : (
                          <AlertTriangle className="size-2.5 shrink-0" />
                        )}
                        <span>{isError ? '错误' : '警告'}</span>
                      </span>
                    </td>

                    {/* 规则：规则编码 Badge + 规则名称（单行紧凑呈现） */}
                    <td className="py-1 px-2.5 max-w-[200px]">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-mono text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/60 shrink-0">
                          {issue.ruleId}
                        </span>
                        <span className="font-medium text-foreground truncate">
                          {ruleDef?.title || issue.ruleId}
                        </span>
                      </div>
                    </td>

                    {/* 关联对象 */}
                    <td className="py-1 px-2.5 max-w-[150px]">
                      <span
                        className="text-foreground font-mono text-[11px] truncate block"
                        title={relatedObjects}
                      >
                        {relatedObjects}
                      </span>
                    </td>

                    {/* 实测 / 要求 */}
                    <td className="py-1 px-2.5 font-mono text-[11px] whitespace-nowrap">
                      {mVal ? (
                        <span className="inline-flex items-center gap-1">
                          <span
                            className={
                              isError
                                ? 'text-destructive font-semibold'
                                : 'text-amber-600 dark:text-amber-400'
                            }
                          >
                            {mVal.value} {mVal.unit}
                          </span>
                          {rVal && (
                            <span className="text-muted-foreground text-[10px]">
                              /{' '}
                              {rVal.upperBound != null ||
                              rVal.name.includes('上限') ||
                              rVal.name.includes('偏角')
                                ? `≤${rVal.upperBound ?? rVal.value}`
                                : `≥${rVal.lowerBound ?? rVal.value}`}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>

                    {/* 说明与建议 */}
                    <td className="py-1 px-2.5 max-w-[280px]">
                      <span className="text-foreground truncate block text-[11px]">
                        {desc}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>



      {/* 设置弹窗 */}
      <RuleSettingsModal
        projectId={projectId}
        isOpen={isRuleSettingsOpen}
        onClose={() => setRuleSettingsOpen(false)}
      />
    </div>
  )
}
