import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
import { useState, useEffect, type FC, type ReactNode } from 'react'
import { Check, X, RotateCcw } from 'lucide-react'
import {
  PORT_SEMANTIC_COLORS,
  HYDRAULIC_CHANNEL_PALETTE
} from '@shared/design/topology/channelSolver'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

interface ChannelColorPickerPopoverProps {
  currentColor: string
  defaultColor?: string
  trigger: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelectColor: (color: string) => void
}

const PRESET_OPTIONS: Array<{ label: string; color: string; desc: string }> = [
  { label: 'P', color: PORT_SEMANTIC_COLORS.P, desc: '压力油路' },
  { label: 'T', color: PORT_SEMANTIC_COLORS.T, desc: '回油油路' },
  { label: 'A', color: PORT_SEMANTIC_COLORS.A, desc: '工作口 A' },
  { label: 'B', color: PORT_SEMANTIC_COLORS.B, desc: '工作口 B' },
  { label: 'X', color: PORT_SEMANTIC_COLORS.X, desc: '先导控制' },
  { label: 'Y', color: PORT_SEMANTIC_COLORS.Y, desc: '泄油油路' },
  { label: 'L', color: PORT_SEMANTIC_COLORS.L, desc: '冷却回路' },
  { label: 'M', color: PORT_SEMANTIC_COLORS.M, desc: '中性工艺' }
]

export const ChannelColorPickerPopover: FC<ChannelColorPickerPopoverProps> = ({
  currentColor,
  defaultColor,
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  onSelectColor
}) => {
  _useLocale()
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? setControlledOpen! : setInternalOpen

  const [hexValue, setHexValue] = useState(currentColor)

  useEffect(() => {
    setHexValue(currentColor)
  }, [currentColor])

  const handleApplyColor = (val: string) => {
    setHexValue(val)
    onSelectColor(val)
  }

  const handleHexInput = (val: string) => {
    setHexValue(val)
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      onSelectColor(val)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-64 p-3 shadow-xl backdrop-blur-md select-none z-50 bg-popover"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
          <span className="text-xs font-semibold text-foreground">{_t("通道颜色设置")}</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* 标准液压油口预设色谱 */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-muted-foreground">{_t("液压标准油口色谱")}</span>
          <div className="grid grid-cols-4 gap-1.5">
            {PRESET_OPTIONS.map((opt) => {
              const isSelected = currentColor.toLowerCase() === opt.color.toLowerCase()
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => handleApplyColor(opt.color)}
                  className="group relative flex flex-col items-center justify-center rounded-md border border-border/40 p-1 hover:border-foreground/40 hover:bg-accent/50 transition-colors cursor-pointer"
                  title={_msg`${opt.label} 口 (${opt.desc})`}
                >
                  <div
                    className="size-4 rounded-full border border-black/20 flex items-center justify-center shadow-inner"
                    style={{ backgroundColor: opt.color }}
                  >
                    {isSelected && <Check className="size-2.5 text-white stroke-[3]" />}
                  </div>
                  <span className="text-[9px] font-mono mt-0.5 text-foreground/80 font-medium">
                    {_t(opt.label)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 工艺回路轮换预设 */}
        <div className="mt-2.5 space-y-1.5">
          <span className="text-[10px] font-medium text-muted-foreground">{_t("工艺回路配色")}</span>
          <div className="flex flex-wrap gap-1.5">
            {HYDRAULIC_CHANNEL_PALETTE.map((col) => {
              const isSelected = currentColor.toLowerCase() === col.toLowerCase()
              return (
                <button
                  key={col}
                  type="button"
                  onClick={() => handleApplyColor(col)}
                  className="size-5 rounded-full border border-black/20 flex items-center justify-center hover:scale-110 transition-transform shadow-inner cursor-pointer"
                  style={{ backgroundColor: col }}
                >
                  {isSelected && <Check className="size-3 text-white stroke-[3]" />}
                </button>
              )
            })}
          </div>
        </div>

        {/* 自定义颜色输入与恢复默认 */}
        <div className="mt-3 pt-2 border-t border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={hexValue.startsWith('#') ? hexValue : '#3b82f6'}
              onChange={(e) => handleApplyColor(e.target.value)}
              className="size-6 cursor-pointer rounded border border-border bg-transparent p-0"
            />
            <input
              type="text"
              value={hexValue}
              onChange={(e) => handleHexInput(e.target.value)}
              className="h-6 w-18 rounded border border-border bg-background px-1.5 text-[11px] font-mono text-foreground uppercase focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {defaultColor && (
            <button
              type="button"
              onClick={() => handleApplyColor(defaultColor)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground py-0.5 px-1.5 rounded hover:bg-muted cursor-pointer"
              title={_t("恢复默认推荐颜色")}
            >
              <RotateCcw className="size-2.5" />
              <span>{_t("默认")}</span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
