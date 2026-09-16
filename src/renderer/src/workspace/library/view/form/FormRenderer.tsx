import { translateMessage } from '@shared/i18n'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { UpdateCmd } from '../../viewmodel/commands'
import { getIn } from '../../model/documentOps'
import { useLibraryStore } from '../../viewmodel/libraryStore'

const DEBOUNCE_MS = 300

/**
 * 受控字段绑定（MVVM 数据绑定落点）。
 * 控件本地态承接输入，停顿 300ms 或失焦时提交 UpdateCmd；
 * 外部值变化（undo/redo/切换选中）自动回同步。
 */
export function useFieldBinding<T>(
  fieldPath: string,
  options?: { isNumber?: boolean; isBoolean?: boolean }
): {
  value: T | undefined
  local: string
  setLocal: (v: string) => void
  commit: (v: string) => void
  dirtyLocal: boolean
} {
  const docValue = useLibraryStore((s) => getIn(s, fieldPath)) as T | undefined
  const execute = useLibraryStore((s) => s.execute)
  const [local, setLocal] = useState(() => String(docValue ?? ''))
  const [dirtyLocal, setDirtyLocal] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!dirtyLocal) setLocal(docValue == null ? '' : String(docValue))
  }, [docValue, dirtyLocal])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const commit = (v: string): void => {
    const prev = docValue
    let next: unknown
    if (options?.isBoolean || typeof prev === 'boolean') {
      next = v === 'true' || v === '1'
    } else if (v === '') {
      next = null
    } else if (options?.isNumber) {
      const n = Number(v)
      next = Number.isFinite(n) ? n : v
    } else if (typeof prev === 'number' || typeof prev === 'undefined' || prev === null) {
      const n = Number(v)
      next = Number.isFinite(n) ? n : v
    } else {
      next = v
    }
    if (String(prev ?? '') === String(next ?? '') && (prev != null || next != null)) {
      setDirtyLocal(false)
      return
    }
    execute(new UpdateCmd(fieldPath, next, prev ?? null, _t("修改属性")))
    setDirtyLocal(false)
  }

  const setLocalDebounced = (v: string): void => {
    setLocal(v)
    setDirtyLocal(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => commit(v), DEBOUNCE_MS)
  }

  const flushAndSet = (v: string): void => {
    window.clearTimeout(timer.current)
    setLocal(v)
    setDirtyLocal(false)
    commit(v)
  }

  return { value: docValue, local, setLocal: setLocalDebounced, commit: flushAndSet, dirtyLocal }
}

/** 字段级校验回调类型（由父表单注入） */
export type IssueForPath = (path: string) => { level: 'error' | 'warning'; message: string } | undefined

/** Figma 风格属性行：label 列 + 控件列，错误信息行内显示 */
export function FieldRow({
  label,
  path,
  widget = 'text',
  options,
  min,
  max,
  step,
  unitSuffix,
  placeholder,
  integer,
  disabled,
  issueFor
}: {
  label: string
  path: string
  widget?: 'number' | 'text' | 'select' | 'toggle'
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
  unitSuffix?: string
  placeholder?: string
  integer?: boolean
  disabled?: boolean
  issueFor?: IssueForPath
}) {
  _useLocale()
  const isNumber = widget === 'number'
  const b = useFieldBinding(path, { isNumber })
  const issue = issueFor?.(path)

  const clamp = (n: number): number => {
    let v = n
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    if (integer) v = Math.round(v)
    return v
  }

  const stepBy = (delta: number): void => {
    const base = typeof b.value === 'number' ? b.value : Number(b.local) || 0
    const inc = step ?? 1
    b.commit(String(clamp(base + delta * inc)))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!isNumber) return
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      stepBy(1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      stepBy(-1)
    }
  }

  const inputCls = cn(
    'h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[13px] text-foreground select-text',
    'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    'disabled:cursor-not-allowed disabled:opacity-50',
    b.dirtyLocal && 'border-primary/60',
    issue?.level === 'error' && 'border-destructive',
    issue?.level === 'warning' && 'border-amber-500'
  )

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[76px_1fr] items-center gap-3">
        <span className="truncate text-xs font-medium text-muted-foreground" title={_t(label)}>
          {_t(label)}
        </span>
        <div className="relative flex items-center">
          {widget === 'select' ? (
            <SelectInput value={b.local} disabled={disabled} options={options ?? []} onChange={(v) => b.commit(v)} />
          ) : widget === 'toggle' ? (
            <ToggleSwitch
              checked={b.local === 'true'}
              disabled={disabled}
              onChange={() => b.commit(b.local === 'true' ? 'false' : 'true')}
            />
          ) : (
            <>
              <input
                type={isNumber ? 'number' : 'text'}
                className={cn(inputCls, unitSuffix && 'pr-8')}
                value={b.local}
                disabled={disabled}
                placeholder={_t(placeholder) ?? (min != null ? `≥ ${min}` : undefined)}
                min={min}
                max={max}
                step={step ?? 'any'}
                onChange={(e: ChangeEvent<HTMLInputElement>) => b.setLocal(e.target.value)}
                onBlur={(e: FocusEvent<HTMLInputElement>) => {
                  let v = e.target.value
                  if (isNumber && v !== '') {
                    const n = Number(v)
                    if (Number.isFinite(n)) v = String(clamp(n))
                  }
                  b.commit(v)
                }}
                onKeyDown={onKeyDown}
              />
              {unitSuffix && (
                <span className="pointer-events-none absolute right-2.5 text-[11px] text-muted-foreground/70">
                  {unitSuffix}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {issue && (
        <div className={cn('col-span-2 pl-[76px] text-[11px] leading-snug', issue.level === 'error' ? 'text-destructive' : 'text-amber-600')}>
          {translateMessage(issue.message)}
        </div>
      )}
    </div>
  )
}

/** 通用下拉（Figma 风格，含 chevron 定位） */
export function SelectInput({
  value,
  options,
  disabled,
  onChange,
  className
}: {
  value: string
  options: { value: string; label: string }[]
  disabled?: boolean
  onChange?: (v: string) => void
  className?: string
}) {
  _useLocale()
  return (
    <div className={cn('relative w-full', className)}>
      <select
        className={cn(
          'h-7 w-full appearance-none rounded-md border border-input bg-background pl-2 pr-7 text-[13px] text-foreground',
          'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          disabled && 'cursor-not-allowed opacity-50'
        )}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {_t(o.label)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
    </div>
  )
}

/** 通用开关（胶囊轨道 + 圆形滑块） */
export function ToggleSwitch({
  checked,
  disabled,
  onChange,
  className
}: {
  checked: boolean
  disabled?: boolean
  onChange: () => void
  className?: string
}) {
  _useLocale()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        'relative h-5 w-9 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-border',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
      onClick={onChange}
    >
      <span
        className={cn(
          'absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-all',
          checked ? 'left-[18px]' : 'left-0.5'
        )}
      />
    </button>
  )
}

/* ---------- 轻量绑定辅助 ---------- */

export function useBoundText(path: string) {
  const b = useFieldBinding(path)
  return {
    value: b.local,
    onChange: (e: ChangeEvent<HTMLInputElement>) => b.setLocal(e.target.value),
    onBlur: (e: FocusEvent<HTMLInputElement>) => b.commit(e.target.value)
  }
}

export function BoundSelect({ path, options, className }: { path: string; options: { value: string; label: string }[]; className?: string }) {
  _useLocale()
  const b = useFieldBinding(path)
  return <SelectInput value={b.local} options={options} onChange={(v) => b.commit(v)} className={className} />
}

/* ---------- 数字输入（带键盘步进） ---------- */

export function NumInput({
  path,
  placeholder,
  className,
  min,
  max,
  step,
  integer,
  disabled
}: {
  path: string
  placeholder?: string
  className?: string
  min?: number
  max?: number
  step?: number
  integer?: boolean
  disabled?: boolean
}) {
  _useLocale()
  const b = useFieldBinding(path, { isNumber: true })
  const clamp = (n: number): number => {
    let v = n
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    if (integer) v = Math.round(v)
    return v
  }
  const stepBy = (delta: number): void => {
    const base = typeof b.value === 'number' ? b.value : Number(b.local) || 0
    const inc = step ?? 1
    b.commit(String(clamp(base + delta * inc)))
  }
  return (
    <input
      type="number"
      step={step ?? 'any'}
      min={min}
      max={max}
      className={cn(
        'h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[13px] text-foreground select-text',
        'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        b.dirtyLocal && 'border-primary/60',
        className
      )}
      value={b.local}
      placeholder={_t(placeholder)}
      disabled={disabled}
      onChange={(e: ChangeEvent<HTMLInputElement>) => b.setLocal(e.target.value)}
      onBlur={(e: FocusEvent<HTMLInputElement>) => {
        let v = e.target.value
        if (v !== '') {
          const n = Number(v)
          if (Number.isFinite(n)) v = String(clamp(n))
        }
        b.commit(v)
      }}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          stepBy(1)
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          stepBy(-1)
        }
      }}
    />
  )
}
