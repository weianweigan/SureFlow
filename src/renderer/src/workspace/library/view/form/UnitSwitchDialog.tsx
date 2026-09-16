import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 孔腔单位切换确认对话框（PRD-002 §7.1 R-U6 / Q22）
 *
 * 当用户在基础信息中切换模板单位时呼出：
 * 1. 换算数值（保持物理尺寸不变，推荐默认）：自动按 1 in = 25.4 mm 比例换算全部几何数值；
 * 2. 重新解释数值（数值不变仅更改单位）：几何数值原样保留，附带尺寸突变警示。
 */

import { useState, useEffect } from 'react'
import { AlertTriangle, ArrowRight, Check, Sparkles, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

export type UnitSwitchMode = 'convert' | 'reinterpret'

export interface UnitSwitchDialogProps {
  open: boolean
  fromUnit: 'mm' | 'in'
  targetUnit: 'mm' | 'in'
  onConfirm: (mode: UnitSwitchMode) => void
  onCancel: () => void
}

export function UnitSwitchDialog({
  open,
  fromUnit,
  targetUnit,
  onConfirm,
  onCancel
}: UnitSwitchDialogProps) {
  _useLocale()
  const [mode, setMode] = useState<UnitSwitchMode>('convert')

  // 每次打开弹窗默认重置为更安全的 'convert'
  useEffect(() => {
    if (open) {
      setMode('convert')
    }
  }, [open])

  // 支持 Escape 键关闭
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  if (!open) return null

  const isToInch = targetUnit === 'in'
  const exampleFrom = isToInch ? '10.00 mm' : '1.000 in'
  const exampleConvert = isToInch ? '0.3937 in' : '25.40 mm'
  const exampleReinterpret = isToInch ? '10.00 in' : '1.000 mm'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-[460px] rounded-xl border border-border bg-card p-5 text-card-foreground shadow-2xl animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* 头部 */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-foreground">{_t("切换模板单位")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {_t("正在将模板单位从")}<span className="font-semibold text-foreground font-mono">{fromUnit}</span> {_t("切换至")}{' '}
              <span className="font-semibold text-primary font-mono">{targetUnit}</span>{_t("，请选择数值处理方式：")}</p>
          </div>
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onCancel}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 模式选项卡 */}
        <div className="mt-4 space-y-2.5">
          {/* 模式 1：换算数值（推荐） */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setMode('convert')}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setMode('convert')}
            className={cn(
              'group relative flex cursor-pointer flex-col rounded-lg border p-3.5 transition-all text-left outline-none select-none',
              mode === 'convert'
                ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary/40'
                : 'border-border bg-background/50 hover:border-border/80 hover:bg-accent/40'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-medium text-xs text-foreground">
                <span>{_t("保持物理尺寸不变（换算数值）")}</span>
                <span className="flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  <Sparkles className="size-2.5" /> {_t("推荐")}</span>
              </div>
              <div
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                  mode === 'convert'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/40 bg-transparent'
                )}
              >
                {mode === 'convert' && <Check className="size-2.5 stroke-[3]" />}
              </div>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {_t("按")}<span className="font-mono font-medium text-foreground">1 in = 25.4 mm</span> {_t("换算所有直径、深度、轮廓与子孔坐标，保留实际物理尺寸不变。")}</p>
            <div className="mt-2 flex items-center gap-2 rounded bg-muted/60 px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
              <span>{exampleFrom}</span>
              <ArrowRight className="size-3 text-muted-foreground/60" />
              <span className="font-medium text-primary">{exampleConvert}</span>
            </div>
          </div>

          {/* 模式 2：重新解释数值 */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setMode('reinterpret')}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setMode('reinterpret')}
            className={cn(
              'group relative flex cursor-pointer flex-col rounded-lg border p-3.5 transition-all text-left outline-none select-none',
              mode === 'reinterpret'
                ? 'border-destructive/80 bg-destructive/5 shadow-xs ring-1 ring-destructive/40'
                : 'border-border bg-background/50 hover:border-border/80 hover:bg-accent/40'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-medium text-xs text-foreground">
                <span>{_t("仅更改单位（重新解释数值）")}</span>
              </div>
              <div
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                  mode === 'reinterpret'
                    ? 'border-destructive bg-destructive text-destructive-foreground'
                    : 'border-muted-foreground/40 bg-transparent'
                )}
              >
                {mode === 'reinterpret' && <Check className="size-2.5 stroke-[3]" />}
              </div>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {_t("所有数值保持原样，仅变更单位标签。")}</p>
            <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-500">
              <AlertTriangle className="size-3 shrink-0" />
              <span>{_t("注意：物理尺寸将直接")}{isToInch ? _t("放大 25.4 倍") : _t("缩小为原来的 1/25.4")}！</span>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded bg-muted/60 px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
              <span>{exampleFrom}</span>
              <ArrowRight className="size-3 text-muted-foreground/60" />
              <span className="font-medium text-destructive">{exampleReinterpret}</span>
            </div>
          </div>
        </div>

        {/* 底部按钮栏 */}
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={onCancel}>
            {_t("取消")}</Button>
          <Button
            size="sm"
            variant={mode === 'reinterpret' ? 'destructive' : 'default'}
            className="h-8 px-3 text-xs"
            onClick={() => onConfirm(mode)}
          >
            {_t("确认切换")}</Button>
        </div>
      </div>
    </div>
  )
}
