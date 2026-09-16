import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
/**
 * 子孔编辑器（PRD-002 §8.6，组合孔专用）
 *
 * 紧凑列表式布局：行与行之间无缝贴合，仅用水平实线分割；
 * 首行 = 名称（核心标识） + 模式分段切换（内联/引用） + 类型图标/引用提示 + 行操作（配置/上移/下移/删除）；
 * 次行 = 坐标 1（r/x） / 坐标 2（θ/y） / 旋转 ∠（3 列网格，Label 在上、输入在下）；
 * 选中态：左侧 4px 黑色实线条，背景浅绿 #E9F3E9，与 2D 安装面画布（FaceView）双向联动。
 */

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Settings2, Trash2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Label } from '@renderer/components/ui/label'
import { NumInput, useFieldBinding, type IssueForPath } from './FormRenderer'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { FloatingPopover } from '@renderer/components/ui/floating-popover'
import { MoveCmd, RemoveCmd, UpdateCmd } from '../../viewmodel/commands'
import { ensureLibLoaded, getLoadedLibs, useLibraryStore } from '../../viewmodel/libraryStore'
import { StepsEditor } from './StepsEditor'
import { PortsEditor } from './PortsEditor'
import { PortsHelpPopover } from './PortsHelpPopover'
import { TYPE_ICONS, assetUrl } from '../typeIcons'
import { TYPE_REGISTRY, typeLabel } from '@shared/cavity/cavityTypeRegistry'
import type { CavityLibrary, CavityType, Hole } from '@shared/cavity/types'

export interface HolesEditorProps {
  basePath: string
  holes: Hole[]
  polar: boolean
  unit?: 'mm' | 'in'
  disabled?: boolean
  issueFor?: IssueForPath
  /** 当前选中的子孔索引（未传时默认使用 libraryStore） */
  selectedHoleIndex?: number | null
  /** 选中子孔变更回调（未传时默认使用 libraryStore） */
  onSelectHole?: (idx: number | null) => void
}

const SEL_CLS =
  'h-7 w-full appearance-none rounded-md border border-input bg-background pl-2 pr-6 text-[13px] text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
const CHEV_CLS = 'pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60'

/* ---------- 数值格（Label 在上、输入在下） ---------- */

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

/* ---------- 引用选择器 ---------- */

function RefPicker({
  holePath,
  ref,
  currentLib
}: {
  holePath: string
  ref: NonNullable<Hole['ref']>
  currentLib: CavityLibrary | null
}) {
  _useLocale()
  const libraries = useLibraryStore((s) => s.libraries)
  const execute = useLibraryStore((s) => s.execute)
  const [targetLib, setTargetLib] = useState<CavityLibrary | null>(null)

  const selectedLibId = ref.libraryId ?? currentLib?.id ?? ''
  const summary = libraries.find((l) => l.id === selectedLibId)

  useEffect(() => {
    let cancelled = false
    if (!summary) {
      setTargetLib(currentLib)
      return
    }
    const cached = getLoadedLibs().get(selectedLibId)
    if (cached) {
      setTargetLib(cached)
      return
    }
    ensureLibLoaded(summary).then(() => {
      if (!cancelled) setTargetLib(getLoadedLibs().get(selectedLibId) ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [selectedLibId, summary, currentLib])

  const templates = targetLib?.templates.filter((t) => !t.meta.archived) ?? []

  return (
    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5">
      <div className="grid grid-cols-[36px_1fr] items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{_t("库")}</span>
        <div className="relative min-w-0">
          <select
            className={SEL_CLS}
            value={selectedLibId}
            onChange={(e) => {
              const v = e.target.value
              const isCurrent = v === currentLib?.id
              execute(
                new UpdateCmd(
                  `${holePath}.ref`,
                  { templateId: '', ...(isCurrent ? {} : { libraryId: v }) },
                  ref,
                  _t("切换引用库")
                )
              )
            }}
          >
            {currentLib && <option value={currentLib.id}>{currentLib.name}{_t("（当前库）")}</option>}
            {libraries
              .filter((l) => l.id !== currentLib?.id)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
          <ChevronDown className={CHEV_CLS} />
        </div>
      </div>
      <div className="grid grid-cols-[36px_1fr] items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{_t("模板")}</span>
        <div className="relative min-w-0">
          <select
            className={SEL_CLS}
            value={ref.templateId}
            onChange={(e) =>
              execute(new UpdateCmd(`${holePath}.ref`, { ...ref, templateId: e.target.value }, ref, _t("切换引用模板")))
            }
          >
            <option value="">{_t("（选择模板…）")}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {typeLabel(t.cavityType)} · {t.name}
              </option>
            ))}
          </select>
          <ChevronDown className={CHEV_CLS} />
        </div>
      </div>
      {!ref.templateId && (
        <p className="col-span-2 text-[11px] text-destructive">{_t("引用未选择模板（V8：引用失效）")}</p>
      )}
      {ref.templateId && !templates.some((t) => t.id === ref.templateId) && (
        <p className="col-span-2 text-[11px] text-destructive">{_t("引用的模板不存在（引用失效，V8）")}</p>
      )}
    </div>
  )
}

/* ---------- 子孔深层编辑（弹层内容：引用选择 / 内联几何与侧油口） ---------- */

function HoleDetailBody({
  hole,
  holePath,
  currentLib,
  unit,
  disabled,
  issueFor
}: {
  hole: Hole
  holePath: string
  currentLib: CavityLibrary | null
  unit?: 'mm' | 'in'
  disabled?: boolean
  issueFor?: IssueForPath
}) {
  _useLocale()
  const storeStepIndex = useLibraryStore((s) => s.selectedStepIndex)
  const storeSetStepIndex = useLibraryStore((s) => s.setSelectedStepIndex)
  const storePortIndex = useLibraryStore((s) => s.selectedPortIndex)
  const storeSetPortIndex = useLibraryStore((s) => s.setSelectedPortIndex)

  // 引用模式：点选库 / 模板
  if (hole.ref) {
    return (
      <div className="space-y-2">
        <RefPicker holePath={holePath} ref={hole.ref} currentLib={currentLib} />
      </div>
    )
  }
  // 内联模式：按类型渲染可编辑的深层几何
  if (!hole.cavityType) {
    return <p className="py-4 text-center text-xs text-muted-foreground">{_t("内联子孔缺少类型，无法编辑几何。")}</p>
  }
  const t = TYPE_REGISTRY[hole.cavityType]
  const allowSteps = Boolean(t.allowed.steps)
  const allowPorts = Boolean(t.allowed.ports)

  const [activeTab, setActiveTab] = useState<'steps' | 'ports'>(allowSteps ? 'steps' : 'ports')

  // 若外部或 2D 画布选中了台阶或侧油口，自动切换对应 tab
  useEffect(() => {
    if (storePortIndex != null && allowPorts) {
      setActiveTab('ports')
    }
  }, [storePortIndex, allowPorts])

  useEffect(() => {
    if (storeStepIndex != null && allowSteps) {
      setActiveTab('steps')
    }
  }, [storeStepIndex, allowSteps])

  if (!allowSteps && !allowPorts) {
    return <p className="py-3 text-center text-xs text-muted-foreground">{_t("该子孔类型无更深层的台阶/油口结构可编辑。")}</p>
  }

  const stepsCount = hole.geometry?.steps?.length ?? 0
  const portsCount = hole.geometry?.ports?.length ?? 0

  return (
    <div className="space-y-3">
      {/* 当同时允许台阶与侧油口时，提供紧凑的分段切换控制 */}
      {allowSteps && allowPorts && (
        <div className="flex items-center justify-between border-b border-border/70 pb-2">
          <div className="inline-flex rounded-lg bg-muted/60 p-0.5 text-xs">
            <button
              type="button"
              className={cn(
                'relative rounded-md px-3 py-1 font-medium transition-all cursor-pointer',
                activeTab === 'steps'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => {
                setActiveTab('steps')
                storeSetPortIndex(null)
              }}
            >
              {_t("台阶序列 (")}{stepsCount})
            </button>
            <button
              type="button"
              className={cn(
                'relative rounded-md px-3 py-1 font-medium transition-all cursor-pointer',
                activeTab === 'ports'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => {
                setActiveTab('ports')
                storeSetStepIndex(null)
              }}
            >
              {_t("侧油口 (")}{portsCount})
            </button>
          </div>
          {activeTab === 'ports' && <PortsHelpPopover />}
        </div>
      )}

      {/* 仅允许侧油口时的单组标题 */}
      {allowPorts && !allowSteps && (
        <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-foreground">{_t("侧油口")}</span>
            <PortsHelpPopover />
          </div>
          <span className="text-[11px] text-muted-foreground">{portsCount} {_t("个")}</span>
        </div>
      )}

      {/* 台阶序列内容区 */}
      {allowSteps && activeTab === 'steps' && (
        <StepsEditor
          basePath={holePath}
          stepsRelPath="geometry.steps"
          steps={hole.geometry?.steps ?? []}
          allowThread={t.allowed.thread}
          disabled={disabled}
          showAddBtn={true}
          issueFor={issueFor}
          selectedStepIndex={storeStepIndex}
          onSelectStep={(idx) => {
            storeSetStepIndex(idx)
            if (idx != null) storeSetPortIndex(null)
          }}
        />
      )}

      {/* 侧油口内容区 */}
      {allowPorts && activeTab === 'ports' && (
        <PortsEditor
          basePath={holePath}
          ports={hole.geometry?.ports ?? []}
          unit={unit}
          disabled={disabled}
          showAddBtn={true}
          issueFor={issueFor}
          selectedPortIndex={storePortIndex}
          onSelectPort={(idx) => {
            storeSetPortIndex(idx)
            if (idx != null) storeSetStepIndex(null)
          }}
        />
      )}
    </div>
  )
}

/* ---------- 子孔名称输入框（紧凑文本框） ---------- */

function HoleNameInput({
  path,
  disabled,
  issueFor
}: {
  path: string
  disabled?: boolean
  issueFor?: IssueForPath
}) {
  _useLocale()
  const b = useFieldBinding(path)
  const issue = issueFor?.(path)
  return (
    <div className="relative shrink-0">
      <input
        type="text"
        className={cn(
          'h-7 w-14 rounded-md border border-input bg-background px-1.5 text-xs font-semibold text-foreground text-center select-text',
          'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          b.dirtyLocal && 'border-primary/60',
          issue?.level === 'error' && 'border-destructive'
        )}
        value={b.local}
        placeholder={_t("如 P")}
        disabled={disabled}
        onChange={(e) => b.setLocal(e.target.value)}
        onBlur={(e) => b.commit(e.target.value)}
      />
      {issue && (
        <p className={cn('absolute left-0 top-full mt-0.5 whitespace-nowrap text-[10px] leading-tight', issue.level === 'error' ? 'text-destructive' : 'text-amber-600')}>
          {issue.message}
        </p>
      )}
    </div>
  )
}

/* ---------- 子孔模式切换下拉（默认仅展示图标，下拉展示文字） ---------- */

function ModeDropdown({
  isRef,
  disabled,
  onSelectMode
}: {
  isRef: boolean
  disabled?: boolean
  onSelectMode: (mode: 'inline' | 'ref') => void
}) {
  _useLocale()
  const [open, setOpen] = useState(false)
  const currentIcon = isRef ? 'ReferenceHole.svg' : 'BuiltinHole.svg'
  const currentTitle = isRef ? _t("引用模式（跨库/同库模板）") : _t("内联模式（本地几何）")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={currentTitle}
          className={cn(
            'group relative flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background transition-all',
            'hover:border-border hover:bg-accent hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            disabled && 'cursor-not-allowed opacity-40'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={assetUrl(currentIcon)}
            alt=""
            draggable={false}
            className="size-4 object-contain select-none transition-transform group-hover:scale-105"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-32 p-1 text-xs shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
            !isRef && 'font-semibold text-foreground bg-accent/60'
          )}
          onClick={() => {
            onSelectMode('inline')
            setOpen(false)
          }}
        >
          <div className="flex items-center gap-2">
            <img src={assetUrl('BuiltinHole.svg')} alt="" className="size-4 object-contain select-none" />
            <span>{_t("内联")}</span>
          </div>
          {!isRef && <Check className="size-3.5 text-primary" />}
        </button>
        <button
          type="button"
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
            isRef && 'font-semibold text-foreground bg-accent/60'
          )}
          onClick={() => {
            onSelectMode('ref')
            setOpen(false)
          }}
        >
          <div className="flex items-center gap-2">
            <img src={assetUrl('ReferenceHole.svg')} alt="" className="size-4 object-contain select-none" />
            <span>{_t("引用")}</span>
          </div>
          {isRef && <Check className="size-3.5 text-primary" />}
        </button>
      </PopoverContent>
    </Popover>
  )
}

/* ---------- 内联子孔类型选择器（带图标） ---------- */

const HOLE_TYPE_OPTIONS = (Object.keys(TYPE_REGISTRY) as CavityType[])
  .filter((t) => !TYPE_REGISTRY[t].isCombo)
  .map((t) => ({ value: t, label: typeLabel(t) }))

function InlineTypeSelect({
  path,
  value,
  disabled
}: {
  path: string
  value?: CavityType
  disabled?: boolean
}) {
  _useLocale()
  const b = useFieldBinding(path)
  const curVal = (b.local || value || 'bolt-hole') as CavityType
  const iconFile = TYPE_ICONS[curVal]
  return (
    <div className="relative flex min-w-0 flex-1 max-w-[96px] items-center">
      <div className="pointer-events-none absolute left-1.5 z-10 flex items-center">
        {iconFile && (
          <img src={assetUrl(iconFile)} alt="" className="size-3.5 object-contain select-none opacity-80" />
        )}
      </div>
      <select
        className={cn(
          'h-7 w-full appearance-none rounded-md border border-input bg-background pl-6 pr-5 text-xs text-foreground truncate',
          'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
        value={b.local || value || 'bolt-hole'}
        disabled={disabled}
        onChange={(e) => b.commit(e.target.value)}
      >
        {HOLE_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {_t(opt.label)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
    </div>
  )
}

/* ---------- 主编辑器 ---------- */

export function HolesEditor({
  basePath,
  holes,
  polar,
  unit = 'mm',
  disabled,
  issueFor,
  selectedHoleIndex,
  onSelectHole
}: HolesEditorProps) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const doc = useLibraryStore((s) => s.doc)
  const storeHoleIndex = useLibraryStore((s) => s.selectedHoleIndex)
  const storeSetHoleIndex = useLibraryStore((s) => s.setSelectedHoleIndex)

  const activeIndex = selectedHoleIndex !== undefined ? selectedHoleIndex : storeHoleIndex
  const setActiveIndex = onSelectHole !== undefined ? onSelectHole : storeSetHoleIndex

  const arrPath = `${basePath}.holes`
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [detailHoleIndex, setDetailHoleIndex] = useState<number | null>(null)

  // 详情弹窗越界安全防护
  useEffect(() => {
    if (detailHoleIndex != null && (detailHoleIndex < 0 || detailHoleIndex >= holes.length)) {
      setDetailHoleIndex(null)
    }
  }, [holes.length, detailHoleIndex])

  // 选中项变化时平滑滚动到当前子孔行
  useEffect(() => {
    if (activeIndex != null && itemRefs.current[activeIndex]) {
      itemRefs.current[activeIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }, [activeIndex])

  // 越界安全防护
  useEffect(() => {
    if (activeIndex != null && (activeIndex < 0 || activeIndex >= holes.length)) {
      setActiveIndex(null)
    }
  }, [holes.length, activeIndex, setActiveIndex])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 pb-0.5 text-[11px] leading-relaxed text-muted-foreground">
        <span>{_t("坐标语义：")}</span>
        <span className="font-mono text-foreground/80">
          {polar
            ? _msg`极坐标（r 半径 ${unit}，θ 角度°）`
            : _msg`笛卡尔（x/y ${unit}，原点 = 组合孔中心）`}
        </span>
      </div>

      <div className="divide-y divide-border/60 border-y border-border/60">
        {holes.map((h, i) => {
          const holePath = `${arrPath}.${i}`
          const isRef = h.ref != null
          const isLast = i === holes.length - 1
          const isSelected = activeIndex === i

          return (
            <div
              key={i}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              className={cn(
                'relative px-2.5 py-2.5 transition-colors space-y-2',
                isSelected ? 'bg-[#E9F3E9]/25' : 'hover:bg-muted/30'
              )}
              style={{
                borderLeft: isSelected ? '4px solid #000000' : '4px solid transparent'
              }}
              onClick={() => setActiveIndex(i)}
              onFocusCapture={() => setActiveIndex(i)}
            >
              {/* 行 1：名称 + 模式图标下拉 + 类型/引用摘要 + 行操作 */}
              <div className="flex items-center gap-1.5 min-w-0">
                <HoleNameInput path={`${holePath}.name`} disabled={disabled} issueFor={issueFor} />

                {/* 模式图标下拉：默认只展示图标，下拉展示文字 */}
                <ModeDropdown
                  isRef={isRef}
                  disabled={disabled}
                  onSelectMode={(mode) => {
                    setActiveIndex(i)
                    if (mode === 'inline' && isRef) {
                      execute(
                        new UpdateCmd(
                          holePath,
                          {
                            ...h,
                            cavityType: 'bolt-hole' as CavityType,
                            geometry: { steps: [{ type: 'straight', diameter: 9, length: 15, thread: null }] },
                            ref: null
                          },
                          h,
                          _t("子孔转为内联模式")
                        )
                      )
                    } else if (mode === 'ref' && !isRef) {
                      execute(
                        new UpdateCmd(
                          holePath,
                          { ...h, cavityType: undefined, geometry: null, ref: { templateId: '' } },
                          h,
                          _t("子孔转为引用模式")
                        )
                      )
                    }
                  }}
                />

                {/* 类型展示（内联为下拉图标选择，引用为提示） */}
                {!isRef ? (
                  <InlineTypeSelect path={`${holePath}.cavityType`} value={h.cavityType} disabled={disabled} />
                ) : (
                  <div className="flex min-w-0 flex-1 max-w-[96px] items-center rounded-md border border-border/50 bg-muted/30 px-1.5 py-1 text-[11px] text-muted-foreground truncate">
                    <span className="truncate">{h.ref?.templateId ? _t("已选模板") : _t("未选模板")}</span>
                  </div>
                )}

                {/* 行末操作：ml-auto 和 shrink-0 保证即使在极窄宽度下绝不被压缩、绝不被挤出 */}
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                  <button
                    ref={(el) => {
                      triggerRefs.current[i] = el
                    }}
                    data-popover-trigger="true"
                    type="button"
                    disabled={disabled}
                    title={isRef ? _t("配置引用细节") : _t("配置几何细节")}
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
                      detailHoleIndex === i
                        ? 'bg-accent text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      disabled && 'pointer-events-none opacity-30'
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveIndex(i)
                      setDetailHoleIndex(detailHoleIndex === i ? null : i)
                    }}
                  >
                    <Settings2 className="size-3.5" />
                  </button>

                  <button
                    type="button"
                    disabled={disabled || i === 0}
                    title={_t("上移")}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (detailHoleIndex === i) {
                        setDetailHoleIndex(i - 1)
                      } else if (detailHoleIndex === i - 1) {
                        setDetailHoleIndex(i)
                      }
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
                      if (detailHoleIndex === i) {
                        setDetailHoleIndex(i + 1)
                      } else if (detailHoleIndex === i + 1) {
                        setDetailHoleIndex(i)
                      }
                      execute(new MoveCmd(arrPath, i, i + 1))
                      setActiveIndex(i + 1)
                    }}
                  >
                    <ChevronDown className="size-3.5" />
                  </button>

                  <button
                    type="button"
                    title={_t("删除子孔")}
                    disabled={disabled}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (detailHoleIndex === i) {
                        setDetailHoleIndex(null)
                      } else if (detailHoleIndex != null && detailHoleIndex > i) {
                        setDetailHoleIndex(detailHoleIndex - 1)
                      }
                      if (activeIndex === i) {
                        setActiveIndex(null)
                      } else if (activeIndex != null && activeIndex > i) {
                        setActiveIndex(activeIndex - 1)
                      }
                      execute(new RemoveCmd(arrPath, i, h, _t("删除子孔")))
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              {/* 行 2：数值网格（坐标 1 / 坐标 2，2 列网格，无单位） */}
              <div className="grid grid-cols-2 gap-2">
                <MetricCell
                  label={polar ? _t("半径 r") : _t("坐标 x")}
                  path={`${holePath}.x`}
                  disabled={disabled}
                  issueFor={issueFor}
                />
                <MetricCell
                  label={polar ? _t("角度 θ") : _t("坐标 y")}
                  path={`${holePath}.y`}
                  disabled={disabled}
                  issueFor={issueFor}
                />
              </div>
            </div>
          )
        })}

        {holes.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground/60">
            {_t("暂无子孔 · 点右上「＋」添加")}</p>
        )}
      </div>

      {/* 侧边浮动可拖拽调整大小的子孔台阶/引用配置 Popover（吸附在属性栏左侧） */}
      {detailHoleIndex != null && holes[detailHoleIndex] && (
        <FloatingPopover
          open={true}
          onClose={() => setDetailHoleIndex(null)}
          triggerRef={{ current: triggerRefs.current[detailHoleIndex] }}
          anchorSelector="#cavity-properties-aside"
          sideOffset={14}
          resizable={true}
          defaultWidth={440}
          defaultHeight={460}
          minWidth={360}
          minHeight={280}
          title={holes[detailHoleIndex].ref ? _t("配置子孔引用模板") : _t("配置子孔几何结构")}
          headerBadge={
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium',
                holes[detailHoleIndex].ref
                  ? 'bg-amber-500/10 text-amber-600'
                  : 'bg-primary/10 text-primary'
              )}
            >
              {holes[detailHoleIndex].name || `BH${detailHoleIndex + 1}`} · {holes[detailHoleIndex].ref ? _t("引用") : typeLabel(holes[detailHoleIndex].cavityType || 'bolt-hole')}
            </span>
          }
          footer={
            <div className="flex w-full items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                {(() => {
                  const h = holes[detailHoleIndex]
                  if (h.ref) return _t("引用已有模板几何")
                  const t = h.cavityType ? TYPE_REGISTRY[h.cavityType] : null
                  const parts: string[] = []
                  if (t?.allowed.steps) parts.push(_msg`${h.geometry?.steps?.length ?? 0} 个台阶`)
                  if (t?.allowed.ports) parts.push(_msg`${h.geometry?.ports?.length ?? 0} 个侧油口`)
                  const suffix = parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
                  return `${typeLabel(h.cavityType || 'bolt-hole')}${suffix}`
                })()}
              </span>
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 cursor-pointer"
                onClick={() => setDetailHoleIndex(null)}
              >
                <Check className="size-3.5" />
                <span>{_t("完成")}</span>
              </button>
            </div>
          }
        >
          <div className="p-3 select-text">
            <HoleDetailBody
              hole={holes[detailHoleIndex]}
              holePath={`${arrPath}.${detailHoleIndex}`}
              currentLib={doc}
              unit={unit}
              disabled={disabled}
              issueFor={issueFor}
            />
          </div>
        </FloatingPopover>
      )}
    </div>
  )
}
