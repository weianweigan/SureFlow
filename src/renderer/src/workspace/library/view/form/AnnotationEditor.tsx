import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 标注信息编辑器（PRD-002 §8.9）
 *
 * 极简参数直接录入设计：
 * - 移除多余的插入标签按钮与说明卡片，直接录入模板；
 * - 语法变量说明移入组标题行「?」帮助 Popover 中；
 * - 实时显示当前几何参数代入解析后的效果。
 */

import { useMemo } from 'react'
import { Label } from '@renderer/components/ui/label'
import { UpdateCmd } from '../../viewmodel/commands'
import { useLibraryStore } from '../../viewmodel/libraryStore'
import { stepEffectiveLength } from '@shared/cavity/geometry'
import { cn } from '@renderer/lib/utils'
import type { CavityTemplate } from '@shared/cavity/types'

export interface AnnotationEditorProps {
  basePath: string
  template: CavityTemplate
  disabled?: boolean
}

const DEFAULT_TEMPLATE = '<MOD-DIAM><D_end> <HOLE-DEPTH><H_end>'

export function AnnotationEditor({
  basePath,
  template,
  disabled
}: AnnotationEditorProps) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const tmplPath = `${basePath}.annotation.template`
  const currentTemplate = template.annotation?.template ?? DEFAULT_TEMPLATE

  // 实时解析计算当前几何参数代入后的效果
  const resolvedPreview = useMemo(() => {
    const steps = template.geometry.steps ?? []
    if (steps.length === 0) return _t("（暂无台阶几何）")

    const dStart = steps[0]?.diameter ?? 0
    const lastStep = steps[steps.length - 1]
    const dEnd = lastStep ? (lastStep.type === 'tapered' && lastStep.length == null ? 0 : lastStep.diameter) : 0

    let totalDepth = 0
    for (const s of steps) {
      totalDepth += stepEffectiveLength(s)
    }

    const fmtNum = (n: number) => {
      const r = Math.round(n * 100) / 100
      return Number.isInteger(r) ? `${r}` : r.toFixed(2)
    }

    let res = currentTemplate
    res = res.replace(/<MOD-DIAM>/g, 'φ')
    res = res.replace(/<D_end>/g, fmtNum(dEnd))
    res = res.replace(/<D_start>/g, fmtNum(dStart))
    res = res.replace(/<HOLE-DEPTH>/g, '深')
    res = res.replace(/<H_end>/g, fmtNum(totalDepth))
    res = res.replace(/<H_start>/g, '0')
    res = res.replace(/<HOLE-SPOT>/g, '⌴')
    return res
  }, [template.geometry.steps, currentTemplate])

  const handleCommitTemplate = (val: string) => {
    if (disabled || val === currentTemplate) return
    const prev = template.annotation?.template ?? null
    execute(new UpdateCmd(tmplPath, val, prev, _t("修改标注模板")))
  }

  const handleResetDefault = () => {
    if (disabled) return
    handleCommitTemplate(DEFAULT_TEMPLATE)
  }

  return (
    <div className="space-y-2">
      {/* 模板输入框 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground/80">
          <Label className="text-[11px]">{_t("标注模板字符串")}</Label>
          <button
            type="button"
            disabled={disabled || currentTemplate === DEFAULT_TEMPLATE}
            onClick={handleResetDefault}
            className="text-[10px] text-muted-foreground/70 hover:text-primary disabled:opacity-40"
          >
            {_t("恢复默认")}</button>
        </div>

        <input
          type="text"
          value={currentTemplate}
          disabled={disabled}
          onChange={(e) => handleCommitTemplate(e.target.value)}
          placeholder={DEFAULT_TEMPLATE}
          className={cn(
            'h-7 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground',
            'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        />
      </div>

      {/* 实时解析结果预览 */}
      <div className="space-y-1">
        <Label className="text-[11px] font-medium text-muted-foreground/80">{_t("解析预览结果")}</Label>
        <input
          type="text"
          readOnly
          value={resolvedPreview}
          className="h-7 w-full rounded-md border border-input/40 bg-muted/40 px-2 text-xs font-mono text-muted-foreground select-all"
        />
      </div>
    </div>
  )
}
