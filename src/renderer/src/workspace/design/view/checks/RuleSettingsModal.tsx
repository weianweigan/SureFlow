/**
 * 设计检查规则设置模态弹窗 (RuleSettingsModal)
 * 严格对齐 PRD-FR-04-15 §4 与 §5
 */

import React, { useState } from 'react'
import { X, Settings2, Sliders, ShieldCheck } from 'lucide-react'
import { useDesignStore } from '../../model/designStore'
import {
  RULE_DEFINITIONS,
  RULE_CATEGORY_LABELS
} from '@shared/design/analysis/ruleRegistry'
import {
  DEFAULT_CHECK_CONFIG,
  type CheckConfig
} from '@shared/design/analysis/contracts'

interface RuleSettingsModalProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
}

export const RuleSettingsModal: React.FC<RuleSettingsModalProps> = ({
  projectId,
  isOpen,
  onClose
}) => {
  const session = useDesignStore((s) => s.projects[projectId])
  const doc = session?.doc
  const activeScheme = doc?.schemes.find((s) => s.id === doc.activeSchemeId) || doc?.schemes[0]

  const currentConfig: CheckConfig = activeScheme?.checkConfig || DEFAULT_CHECK_CONFIG

  const [ruleEnabled, setRuleEnabled] = useState<Record<string, boolean>>({
    ...currentConfig.ruleEnabled
  })
  const [minHoleWall, setMinHoleWall] = useState<number>(currentConfig.minHoleWall.value)
  const [minOuterWall, setMinOuterWall] = useState<number>(currentConfig.minOuterWall.value)
  const [minOutlineClearance, setMinOutlineClearance] = useState<number>(
    currentConfig.minOutlineClearance.value
  )
  const [minComponentClearance, setMinComponentClearance] = useState<number>(
    currentConfig.minComponentClearance.value
  )
  const [maxDepthDiameterRatio, setMaxDepthDiameterRatio] = useState<string>(
    currentConfig.maxDepthDiameterRatio != null ? String(currentConfig.maxDepthDiameterRatio) : ''
  )
  const [localAbsArea, setLocalAbsArea] = useState<string>(
    currentConfig.localOpeningLimits.absolute?.value != null
      ? String(currentConfig.localOpeningLimits.absolute.value)
      : ''
  )
  const [localRatio, setLocalRatio] = useState<string>(
    currentConfig.localOpeningLimits.ratio != null
      ? String(currentConfig.localOpeningLimits.ratio * 100)
      : ''
  )
  const [pathAbsArea, setPathAbsArea] = useState<string>(
    currentConfig.pathBottleneckLimits.absolute?.value != null
      ? String(currentConfig.pathBottleneckLimits.absolute.value)
      : ''
  )
  const [pathRatio, setPathRatio] = useState<string>(
    currentConfig.pathBottleneckLimits.ratio != null
      ? String(currentConfig.pathBottleneckLimits.ratio * 100)
      : ''
  )

  if (!isOpen || !doc || !activeScheme) return null

  const handleToggleRule = (ruleId: string) => {
    setRuleEnabled((prev) => ({
      ...prev,
      [ruleId]: prev[ruleId] === false ? true : false
    }))
  }

  const handleSave = () => {
    const updatedConfig: CheckConfig = {
      ...currentConfig,
      ruleEnabled,
      minHoleWall: { value: Math.max(0, minHoleWall), unit: 'mm' },
      minOuterWall: { value: Math.max(0, minOuterWall), unit: 'mm' },
      minOutlineClearance: { value: Math.max(0, minOutlineClearance), unit: 'mm' },
      minComponentClearance: { value: Math.max(0, minComponentClearance), unit: 'mm' },
      maxDepthDiameterRatio:
        maxDepthDiameterRatio.trim() !== '' && Number(maxDepthDiameterRatio) > 0
          ? Number(maxDepthDiameterRatio)
          : null,
      localOpeningLimits: {
        absolute:
          localAbsArea.trim() !== '' && Number(localAbsArea) > 0
            ? { value: Number(localAbsArea), unit: 'mm2' }
            : null,
        ratio:
          localRatio.trim() !== '' && Number(localRatio) > 0
            ? Number(localRatio) / 100
            : null
      },
      pathBottleneckLimits: {
        absolute:
          pathAbsArea.trim() !== '' && Number(pathAbsArea) > 0
            ? { value: Number(pathAbsArea), unit: 'mm2' }
            : null,
        ratio:
          pathRatio.trim() !== '' && Number(pathRatio) > 0
            ? Number(pathRatio) / 100
            : null
      }
    }

    // 更新到方案数据中
    useDesignStore.setState((state) => {
      const proj = state.projects[projectId]
      if (!proj) return state
      const nextSchemes = proj.doc.schemes.map((s) => {
        if (s.id === activeScheme.id) {
          return { ...s, checkConfig: updatedConfig }
        }
        return s
      })
      return {
        projects: {
          ...state.projects,
          [projectId]: {
            ...proj,
            dirty: true,
            doc: { ...proj.doc, schemes: nextSchemes }
          }
        }
      }
    })

    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="flex flex-col w-full max-w-2xl max-h-[85vh] bg-background border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">设计检查规则与参数设置</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
          {/* 全局阈值设置 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-medium text-foreground text-xs">
              <Sliders className="size-3.5 text-primary" />
              <span>方案默认检查阈值</span>
            </div>
            <div className="grid grid-cols-2 gap-3 bg-muted/20 p-3 rounded-lg border border-border/60">
              <div>
                <label className="text-muted-foreground block mb-1">孔间残余壁厚 (mm)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={minHoleWall}
                  onChange={(e) => setMinHoleWall(parseFloat(e.target.value) || 0)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">孔到外表面壁厚 (mm)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={minOuterWall}
                  onChange={(e) => setMinOuterWall(parseFloat(e.target.value) || 0)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">二维安装轮廓最小净距 (mm)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={minOutlineClearance}
                  onChange={(e) => setMinOutlineClearance(parseFloat(e.target.value) || 0)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">三维元件最小净距 (mm)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={minComponentClearance}
                  onChange={(e) => setMinComponentClearance(parseFloat(e.target.value) || 0)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">深径比上限 L/D (留空为不限制)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="未设置"
                  value={maxDepthDiameterRatio}
                  onChange={(e) => setMaxDepthDiameterRatio(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">局部交汇绝对面积下限 (mm²)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="未设置"
                  value={localAbsArea}
                  onChange={(e) => setLocalAbsArea(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">局部交汇截面比例下限 (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="5"
                  placeholder="未设置"
                  value={localRatio}
                  onChange={(e) => setLocalRatio(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">通路瓶颈绝对面积下限 (mm²)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="未设置"
                  value={pathAbsArea}
                  onChange={(e) => setPathAbsArea(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">通路瓶颈截面比例下限 (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="5"
                  placeholder="未设置"
                  value={pathRatio}
                  onChange={(e) => setPathRatio(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* 规则启停开关列表 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-medium text-foreground text-xs">
              <ShieldCheck className="size-3.5 text-primary" />
              <span>规则启停控制 (共 18 项)</span>
            </div>
            <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
              {Object.values(RULE_DEFINITIONS).map((rule) => {
                const enabled = ruleEnabled[rule.id] !== false
                return (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between p-3 bg-card hover:bg-accent/30 transition-colors"
                  >
                    <div className="space-y-0.5 max-w-[80%]">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-primary">
                          {rule.id}
                        </span>
                        <span className="font-medium text-foreground">{rule.title}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            rule.severity === 'error'
                              ? 'bg-destructive/15 text-destructive font-semibold'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {rule.severity === 'error' ? '错误' : '警告'}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          [{RULE_CATEGORY_LABELS[rule.category]}]
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{rule.purpose}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => handleToggleRule(rule.id)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3.5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
          >
            保存并应用
          </button>
        </div>
      </div>
    </div>
  )
}
