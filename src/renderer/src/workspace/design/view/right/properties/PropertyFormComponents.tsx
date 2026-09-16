import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useState, type KeyboardEvent, type ChangeEvent, type FocusEvent } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/**
 * 扁平段落容器（支持折叠）
 */
export function FormSectionWrapper({
  title,
  action,
  children,
  isFirst = false,
  collapsible = false,
  defaultCollapsed = false
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  isFirst?: boolean
  collapsible?: boolean
  defaultCollapsed?: boolean
}) {
  _useLocale()
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <section className={cn('relative', !isFirst && 'border-t border-border/70')}>
      <div
        className={cn(
          'relative flex h-8 shrink-0 items-center gap-1.5 px-3 select-none',
          collapsible && 'cursor-pointer hover:bg-accent/40'
        )}
        onClick={() => {
          if (collapsible) setCollapsed(!collapsed)
        }}
      >
        {collapsible && (
          <span className="text-muted-foreground/70 -ml-0.5">
            {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </span>
        )}
        <h4 className="truncate text-xs font-semibold tracking-wide text-foreground">
          {_t(title)}
        </h4>
        {action && (
          <div
            className="ml-auto flex shrink-0 items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {action}
          </div>
        )}
      </div>
      {!collapsed && <div className="px-3 pb-3 pt-1 space-y-2">{children}</div>}
    </section>
  )
}

/**
 * 属性行：固定 76px 标签 + 右侧控件（两列网格）
 */
export function PropertyRow({
  label,
  children,
  title,
  unit
}: {
  label: string
  children: React.ReactNode
  title?: string
  unit?: string
}) {
  _useLocale()
  return (
    <div className="grid grid-cols-[76px_1fr] items-center gap-2.5 min-h-[26px]">
      <span className="truncate text-xs font-medium text-muted-foreground" title={title || label}>
        {_t(label)}
        {unit && <span className="text-[10px] text-muted-foreground/60 ml-0.5 font-normal">({unit})</span>}
      </span>
      <div className="relative flex items-center min-w-0">{children}</div>
    </div>
  )
}

/**
 * 带单位及键盘步进的数字输入
 */
export function NumberInput({
  value,
  onChange,
  unit,
  step = 1,
  min,
  max,
  precision = 2,
  disabled,
  className
}: {
  value: number
  onChange: (val: number) => void
  unit?: string
  step?: number
  min?: number
  max?: number
  precision?: number
  disabled?: boolean
  className?: string
}) {
  _useLocale()
  const clamp = (n: number): number => {
    let v = n
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    return Math.round(v * Math.pow(10, precision)) / Math.pow(10, precision)
  }

  const stepBy = (delta: number) => {
    onChange(clamp((Number(value) || 0) + delta * step))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      stepBy(1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      stepBy(-1)
    }
  }

  const [localStr, setLocalStr] = useState<string | null>(null)

  const displayVal = localStr !== null ? localStr : Number.isFinite(value) ? String(value) : '0'

  return (
    <div className={cn('relative flex w-full items-center', className)}>
      <input
        type="text"
        inputMode="decimal"
        value={displayVal}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          setLocalStr(e.target.value)
        }}
        onBlur={(e: FocusEvent<HTMLInputElement>) => {
          const parsed = parseFloat(e.target.value)
          if (!isNaN(parsed)) {
            onChange(clamp(parsed))
          } else {
            onChange(value)
          }
          setLocalStr(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            ;(e.target as HTMLInputElement).blur()
          } else {
            handleKeyDown(e)
          }
        }}
        className={cn(
          'h-7 w-full rounded border border-border bg-background px-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
          unit ? 'pr-8' : 'pr-2'
        )}
      />
      {unit && (
        <span className="pointer-events-none absolute right-2 text-[10px] font-mono text-muted-foreground/70 select-none">
          {unit}
        </span>
      )}
    </div>
  )
}

/**
 * 文本输入框
 */
export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  className
}: {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-7 w-full rounded border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    />
  )
}

/**
 * 下拉选择菜单
 */
export function CustomSelect({
  value,
  onChange,
  options,
  disabled,
  className
}: {
  value: string
  onChange: (val: string) => void
  options: { label: string; value: string; hint?: string }[]
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={cn('relative w-full', className)}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-full appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label} {opt.hint ? `(${opt.hint})` : ''}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

/**
 * 现代化滑动开关 (Toggle Switch)
 */
export function ToggleSwitch({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted-foreground/30'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block size-3 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out',
          checked ? 'translate-x-3' : 'translate-x-0'
        )}
      />
    </button>
  )
}

/**
 * 范围滑块（用于金属度/粗糙度/透明度等 0~1 属性）
 */
export function RangeSlider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  disabled
}: {
  value: number
  onChange: (val: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2 w-full">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 flex-1 appearance-none rounded-full bg-border accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="w-10 text-right font-mono text-[11px] text-muted-foreground">
        {label || (value * 100).toFixed(0) + '%'}
      </span>
    </div>
  )
}
