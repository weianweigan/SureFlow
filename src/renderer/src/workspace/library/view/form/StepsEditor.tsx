import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 台阶序列编辑器（PRD-002 §8.1）
 *
 * 卡片两行式：首行 = 类型图标切换 + 行操作（螺纹图标/上移/下移/删除）；
 * 数值行 = φ 直径 / 段长 / 锥角（无单位标注）。
 * 与 2D 剖面图形产生双向联动（点击图形高亮台阶，编辑台阶联动图形选中）。
 * 每一个台阶具有独立的 List 卡片视觉分割。
 */

import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { cn } from '@renderer/lib/utils'
import { CompositeCmd, InsertCmd, MoveCmd, RemoveCmd, UpdateCmd } from '../../viewmodel/commands'
import { useLibraryStore } from '../../viewmodel/libraryStore'
import { THREAD_FAMILIES } from '@shared/cavity/cavityTypeRegistry'
import { NumInput, SelectInput, useFieldBinding, type IssueForPath } from './FormRenderer'
import { assetUrl } from '../typeIcons'
import type { Step, ThreadSpec } from '@shared/cavity/types'

export interface StepsEditorProps {
  /** 模板命令路径前缀 */
  basePath: string
  /** steps 数组相对路径（如 'geometry.steps' 或 'holes.0.geometry.steps'） */
  stepsRelPath: string
  steps: Step[]
  allowThread: boolean
  disabled?: boolean
  /** 是否显示底部「添加台阶」整宽按钮（模板级由 Group header 提供时可隐藏） */
  showAddBtn?: boolean
  issueFor?: IssueForPath
  /** 当前选中的台阶索引（未传时默认使用 libraryStore） */
  selectedStepIndex?: number | null
  /** 选中台阶变更回调（未传时默认使用 libraryStore） */
  onSelectStep?: (idx: number | null) => void
}

/* ---------- 数值格（label 在上、输入在下） ---------- */

function MetricCell({
  label,
  path,
  placeholder,
  min,
  max,
  integer,
  disabled,
  issueFor
}: {
  label: string
  path: string
  placeholder?: string
  min?: number
  max?: number
  integer?: boolean
  disabled?: boolean
  issueFor?: IssueForPath
}) {
  _useLocale()
  const issue = issueFor?.(path)
  return (
    <div>
      <Label className="mb-1 block text-[11px] font-medium text-muted-foreground/80">{_t(label)}</Label>
      <NumInput path={path} placeholder={placeholder} min={min} max={max} integer={integer} disabled={disabled} />
      {issue && (
        <p className={cn('mt-1 text-[10px] leading-tight', issue.level === 'error' ? 'text-destructive' : 'text-amber-600')}>
          {issue.message}
        </p>
      )}
    </div>
  )
}

/* ---------- 螺纹子表单 ---------- */

function ThreadSubform({
  stepPath,
  disabled,
  issueFor
}: {
  stepPath: string
  thread: ThreadSpec
  disabled?: boolean
  issueFor?: IssueForPath
}) {
  _useLocale()
  return (
    <div className="mt-2.5 rounded-md border border-border/60 bg-muted/30 p-2.5 space-y-2">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div className="grid grid-cols-[56px_1fr] items-center gap-1.5">
          <Label className="text-[11px] text-muted-foreground">{_t("系列")}</Label>
          <BoundSelectInput path={`${stepPath}.thread.family`} options={THREAD_FAMILIES.map((f) => ({ value: f.value, label: f.value }))} />
        </div>
        <div className="grid grid-cols-[56px_1fr] items-center gap-1.5">
          <Label className="text-[11px] text-muted-foreground">{_t("标记")}</Label>
          <TextInput path={`${stepPath}.thread.designation`} placeholder="M10x1.5-6H" disabled={disabled} issueFor={issueFor} />
        </div>
        <div className="grid grid-cols-[56px_1fr] items-center gap-1.5">
          <Label className="text-[11px] text-muted-foreground">{_t("深度")}</Label>
          <NumInput path={`${stepPath}.thread.depth`} placeholder={_t("空=贯通")} disabled={disabled} />
        </div>
        <div className="grid grid-cols-[56px_1fr] items-center gap-1.5">
          <Label className="text-[11px] text-muted-foreground">{_t("旋向")}</Label>
          <BoundSelectInput
            path={`${stepPath}.thread.hand`}
            options={[
              { value: 'right', label: _t("右旋") },
              { value: 'left', label: _t("左旋") }
            ]}
          />
        </div>
      </div>
    </div>
  )
}

function BoundSelectInput({ path, options }: { path: string; options: { value: string; label: string }[] }) {
  _useLocale()
  const b = useFieldBinding(path)
  return <SelectInput value={b.local} options={options} onChange={(v) => b.commit(v)} />
}

function TextInput({
  path,
  placeholder,
  disabled,
  issueFor
}: {
  path: string
  placeholder?: string
  disabled?: boolean
  issueFor?: IssueForPath
}) {
  _useLocale()
  const b = useFieldBinding(path)
  const issue = issueFor?.(path)
  return (
    <div>
      <input
        type="text"
        className={cn(
          'h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[13px] text-foreground select-text',
          'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          b.dirtyLocal && 'border-primary/60',
          issue?.level === 'error' && 'border-destructive'
        )}
        value={b.local}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => b.setLocal(e.target.value)}
        onBlur={(e) => b.commit(e.target.value)}
      />
      {issue && (
        <p className={cn('mt-1 text-[10px] leading-tight', issue.level === 'error' ? 'text-destructive' : 'text-amber-600')}>
          {issue.message}
        </p>
      )}
    </div>
  )
}

/* ---------- 主编辑器 ---------- */

export function StepsEditor({
  basePath,
  stepsRelPath,
  steps,
  allowThread,
  disabled,
  showAddBtn = true,
  issueFor,
  selectedStepIndex,
  onSelectStep
}: StepsEditorProps) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const storeStepIndex = useLibraryStore((s) => s.selectedStepIndex)
  const storeSetStepIndex = useLibraryStore((s) => s.setSelectedStepIndex)

  const activeIndex = selectedStepIndex !== undefined ? selectedStepIndex : storeStepIndex
  const setActiveIndex = onSelectStep !== undefined ? onSelectStep : storeSetStepIndex

  const arrPath = `${basePath}.${stepsRelPath}`
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // 选中项变化时平滑滚动到当前卡片（若焦点已在卡片内部输入框则跳过，避免打断输入状态与光标展示）
  useEffect(() => {
    if (activeIndex != null && itemRefs.current[activeIndex]) {
      if (itemRefs.current[activeIndex]?.contains(document.activeElement)) {
        return
      }
      itemRefs.current[activeIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }, [activeIndex])

  // 越界安全防护
  useEffect(() => {
    if (activeIndex != null && (activeIndex < 0 || activeIndex >= steps.length)) {
      setActiveIndex(null)
    }
  }, [steps.length, activeIndex, setActiveIndex])

  const addStep = (): void => {
    const last = steps[steps.length - 1]
    const item: Step = { type: 'straight', diameter: last?.diameter ?? 10, length: 10, thread: null }
    execute(new InsertCmd(arrPath, steps.length, item, _t("添加台阶")))
    setActiveIndex(steps.length)
  }

  /** 切换台阶类型：straight↔tapered 联动补默认锥角与合理段长 */
  const changeType = (i: number, v: string, step: Step): void => {
    if (v === step.type) return
    const stepPath = `${arrPath}.${i}`
    const cmds = [new UpdateCmd(`${stepPath}.type`, v, step.type, _t("切换台阶类型"))]
    if (v === 'tapered') {
      if (step.angle == null) {
        cmds.push(new UpdateCmd(`${stepPath}.angle`, 118, null, _t("补默认锥角")))
      }
      if (i === steps.length - 1 && step.length != null) {
        cmds.push(new UpdateCmd(`${stepPath}.length`, null, step.length, _t("末段锥孔默认收尖")))
      }
    } else if (v === 'straight') {
      if (step.length == null) {
        cmds.push(new UpdateCmd(`${stepPath}.length`, 10, null, _t("直孔补默认段长")))
      }
    }
    execute(new CompositeCmd(_t("切换台阶类型"), cmds))
  }

  return (
    <div className={steps.length > 0 ? "space-y-2" : ""}>
      <div className={cn("divide-y divide-border/60 border-border/60", steps.length > 0 && "border-y")}>
        {steps.map((s, i) => {
        const stepPath = `${arrPath}.${i}`
        const isLast = i === steps.length - 1
        const canShrink = s.type === 'tapered' && isLast
        const isSelected = activeIndex === i

        return (
          <div
            key={i}
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            className={cn(
              'relative px-3 py-2.5 transition-colors space-y-2',
              isSelected ? 'bg-[#E9F3E9]/25' : 'hover:bg-muted/30'
            )}
            style={{
              borderLeft: isSelected ? '4px solid #000000' : '4px solid transparent'
            }}
            onClick={() => activeIndex !== i && setActiveIndex(i)}
            onFocusCapture={() => activeIndex !== i && setActiveIndex(i)}
          >
            {/* 行 1：类型图标选择 + 螺纹图标 + 行操作 */}
            <div className="flex items-center gap-2">
              {/* 类型选择：直孔 / 锥孔 图标分段控制 */}
              <div className="flex items-center rounded-md border border-border/70 bg-muted/40 p-0.5 shadow-2xs">
                <button
                  type="button"
                  disabled={disabled}
                  title={_t("直孔")}
                  onClick={(e) => {
                    e.stopPropagation()
                    changeType(i, 'straight', s)
                    setActiveIndex(i)
                  }}
                  className={cn(
                    'group relative flex size-7 items-center justify-center rounded transition-all',
                    s.type === 'straight'
                      ? 'border border-border/60 bg-background shadow-xs ring-1 ring-primary/30 font-semibold'
                      : 'border border-transparent text-muted-foreground opacity-60 hover:opacity-100 hover:bg-background/40',
                    disabled && 'cursor-not-allowed opacity-30'
                  )}
                >
                  <img
                    src={assetUrl('Straight.svg')}
                    alt={_t("直孔")}
                    draggable={false}
                    className={cn(
                      'size-4.5 object-contain select-none transition-transform',
                      s.type === 'straight' ? 'scale-105 opacity-100' : 'opacity-70 group-hover:scale-105 group-hover:opacity-100'
                    )}
                  />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  title={_t("锥孔")}
                  onClick={(e) => {
                    e.stopPropagation()
                    changeType(i, 'tapered', s)
                    setActiveIndex(i)
                  }}
                  className={cn(
                    'group relative flex size-7 items-center justify-center rounded transition-all',
                    s.type === 'tapered'
                      ? 'border border-border/60 bg-background shadow-xs ring-1 ring-primary/30 font-semibold'
                      : 'border border-transparent text-muted-foreground opacity-60 hover:opacity-100 hover:bg-background/40',
                    disabled && 'cursor-not-allowed opacity-30'
                  )}
                >
                  <img
                    src={assetUrl('Tapered.svg')}
                    alt={_t("锥孔")}
                    draggable={false}
                    className={cn(
                      'size-4.5 object-contain select-none transition-transform',
                      s.type === 'tapered' ? 'scale-105 opacity-100' : 'opacity-70 group-hover:scale-105 group-hover:opacity-100'
                    )}
                  />
                </button>
              </div>

              <span className="text-xs font-medium text-foreground/85">
                {s.type === 'straight' ? _t("直孔") : _t("锥孔")}
              </span>

              <div className="flex-1" />

              {/* 螺纹与行操作 */}
              <div className="flex shrink-0 items-center gap-0.5">
                {allowThread && (
                  <button
                    type="button"
                    disabled={disabled}
                    title={s.thread ? _t("移除螺纹") : _t("添加螺纹")}
                    className={cn(
                      'group relative flex size-7 items-center justify-center rounded-md border transition-all',
                      s.thread
                        ? 'border-primary/60 bg-primary/15 text-primary shadow-xs ring-1 ring-primary/40'
                        : 'border-border/60 bg-background text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground',
                      disabled && 'cursor-not-allowed opacity-40'
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveIndex(i)
                      execute(
                        s.thread
                          ? new UpdateCmd(`${stepPath}.thread`, null, s.thread, _t("移除螺纹"))
                          : new UpdateCmd(
                              `${stepPath}.thread`,
                              { family: 'METRIC', designation: '', depth: null, hand: 'right' } satisfies ThreadSpec,
                              null,
                              _t("添加螺纹")
                            )
                      )
                    }}
                  >
                    <img
                      src={assetUrl('Thread.svg')}
                      alt={_t("螺纹")}
                      draggable={false}
                      className={cn(
                        'size-4 object-contain select-none transition-transform',
                        s.thread ? 'scale-105 opacity-100' : 'opacity-70 group-hover:scale-105 group-hover:opacity-100'
                      )}
                    />
                    {s.thread && (
                      <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-1 ring-background" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  disabled={disabled || i === 0}
                  title={_t("上移")}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  onClick={(e) => {
                    e.stopPropagation()
                    execute(new MoveCmd(arrPath, i, i - 1))
                    setActiveIndex(i - 1)
                  }}
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  disabled={disabled || isLast}
                  title={_t("下移")}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  onClick={(e) => {
                    e.stopPropagation()
                    execute(new MoveCmd(arrPath, i, i + 1))
                    setActiveIndex(i + 1)
                  }}
                >
                  <ChevronDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  disabled={disabled || steps.length <= 1}
                  title={_t("删除台阶")}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (activeIndex === i) {
                      setActiveIndex(null)
                    } else if (activeIndex != null && activeIndex > i) {
                      setActiveIndex(activeIndex - 1)
                    }
                    execute(new RemoveCmd(arrPath, i, s, _t("删除台阶")))
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>

            {/* 行 2：数值网格（直径 φ / 段长 L / 锥角 ∠，无单位） */}
            <div className={cn('grid gap-2', s.type === 'tapered' ? 'grid-cols-3' : 'grid-cols-2')}>
              <MetricCell label={_t("直径 φ")} path={`${stepPath}.diameter`} min={0} disabled={disabled} issueFor={issueFor} />
              <MetricCell
                label={canShrink ? _t("段长 L（空=收尖）") : _t("段长 L")}
                path={`${stepPath}.length`}
                placeholder={canShrink ? _t("收尖") : ''}
                min={0}
                disabled={disabled}
                issueFor={issueFor}
              />
              {s.type === 'tapered' && (
                <MetricCell label={_t("锥角 ∠")} path={`${stepPath}.angle`} placeholder={_t("如 118")} min={0} max={180} disabled={disabled} issueFor={issueFor} />
              )}
            </div>

            {allowThread && s.thread && <ThreadSubform stepPath={stepPath} thread={s.thread} disabled={disabled} issueFor={issueFor} />}
          </div>
        )
      })}
        {steps.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground/60">
            {_t("暂无台阶，请添加第一段")}</p>
        )}
      </div>
      {showAddBtn && (
        <Button size="sm" variant="outline" className="h-8 w-full text-xs" disabled={disabled} onClick={addStep}>
          <Plus className="size-3.5" /> {_t("添加台阶")}</Button>
      )}
    </div>
  )
}
