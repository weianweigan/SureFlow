import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 侧油口编辑器（PRD-002 §8.3 / FR-03-60）
 *
 * 列表与选中样式与台阶序列（StepsEditor）保持严格一致：
 * 1. 外层容器采用 divide-y 分割线；
 * 2. 选中态：左侧 4px 黑色高亮指示条，背景浅绿 #E9F3E9/25；
 * 3. 卡片行 1：侧油口标题 P{i+1} + 通底开关 + 删除按钮；
 * 4. 卡片行 2：数值网格（深度 Y / 孔径 φ）；通底时孔径禁用并提示无需配置；
 * 5. 2D 预览双向联动选中与平滑滚动。
 */

import { useEffect, useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { cn } from '@renderer/lib/utils'
import { InsertCmd, RemoveCmd, UpdateCmd } from '../../viewmodel/commands'
import { useLibraryStore } from '../../viewmodel/libraryStore'
import { NumInput, ToggleSwitch, useBoundText, type IssueForPath } from './FormRenderer'
import { PortsHelpPopover } from './PortsHelpPopover'
import type { Port } from '@shared/cavity/types'

export interface PortsEditorProps {
  /** 模板命令路径前缀 */
  basePath: string
  ports: Port[]
  unit?: string
  disabled?: boolean
  /** 是否显示底部「添加侧油口」整宽按钮（默认 true） */
  showAddBtn?: boolean
  issueFor?: IssueForPath
  /** 当前选中的侧油口索引（未传时默认使用 libraryStore） */
  selectedPortIndex?: number | null
  /** 选中侧油口变更回调（未传时默认使用 libraryStore） */
  onSelectPort?: (idx: number | null) => void
}

/* ---------- 数值格（Label 在上、输入在下，与 StepsEditor 保持一致） ---------- */

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

function PortNameInput({ path, index, disabled }: { path: string; index: number; disabled?: boolean }) {
  const bound = useBoundText(path)
  return (
    <input
      type="text"
      value={bound.value ?? ''}
      onChange={bound.onChange}
      onBlur={bound.onBlur}
      placeholder={`${_t("侧油口 P")}${index + 1}`}
      disabled={disabled}
      className="w-20 bg-transparent text-xs font-medium text-foreground/85 border-b border-transparent hover:border-border focus:border-primary focus:outline-none transition-colors"
      onClick={(e) => e.stopPropagation()}
    />
  )
}

export function PortsEditor({
  basePath,
  ports,
  unit: _unit = 'mm',
  disabled,
  showAddBtn = true,
  issueFor,
  selectedPortIndex,
  onSelectPort
}: PortsEditorProps) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const storePortIndex = useLibraryStore((s) => s.selectedPortIndex)
  const storeSetPortIndex = useLibraryStore((s) => s.setSelectedPortIndex)

  const activeIndex = selectedPortIndex !== undefined ? selectedPortIndex : storePortIndex
  const setActiveIndex = onSelectPort !== undefined ? onSelectPort : storeSetPortIndex

  const arrPath = `${basePath}.geometry.ports`
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
    if (activeIndex != null && (activeIndex < 0 || activeIndex >= ports.length)) {
      setActiveIndex(null)
    }
  }, [ports.length, activeIndex, setActiveIndex])

  const handleAddPort = (): void => {
    if (disabled) return
    const initialDepth = ports.length > 0 ? (ports[ports.length - 1].depth || 0) + 10 : 10
    const newPort: Port = {
      depth: initialDepth,
      diameter: 8,
      isBottomPort: false
    }
    execute(new InsertCmd(arrPath, ports.length, newPort, _t("添加侧油口")))
    setActiveIndex(ports.length)
  }

  return (
    <div className={ports.length > 0 ? "space-y-2" : ""}>
      <div className={cn("divide-y divide-border/60 border-border/60", ports.length > 0 && "border-y")}>
        {ports.map((p, i) => {
          const portPath = `${arrPath}.${i}`
          const isBottom = Boolean(p.isBottomPort)
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
              {/* 行 1：标题 + 帮助 + 通底开关 + 删除操作 */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <PortNameInput path={`${portPath}.name`} index={i} disabled={disabled} />
                  <PortsHelpPopover />
                </div>

                <div className="flex-1" />

                <div className="flex shrink-0 items-center gap-2">
                  <label
                    className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>{_t("通底")}</span>
                    <ToggleSwitch
                      checked={isBottom}
                      disabled={disabled}
                      onChange={() => {
                        setActiveIndex(i)
                        execute(new UpdateCmd(`${portPath}.isBottomPort`, !isBottom, p.isBottomPort, _t("切换通底状态")))
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    disabled={disabled}
                    title={_t("删除侧油口")}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (activeIndex === i) {
                        setActiveIndex(null)
                      } else if (activeIndex != null && activeIndex > i) {
                        setActiveIndex(activeIndex - 1)
                      }
                      execute(new RemoveCmd(arrPath, i, p, _t("删除侧油口")))
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              {/* 行 2：数值网格（深度 Y / 孔径 φ） */}
              <div className="grid grid-cols-2 gap-2">
                <MetricCell
                  label={isBottom ? _t("起始深 Y") : _t("深度 Y")}
                  path={`${portPath}.depth`}
                  placeholder={isBottom ? _t("起始深度") : _t("中心深度")}
                  min={0}
                  disabled={disabled}
                  issueFor={issueFor}
                />
                {isBottom ? (
                  <div>
                    <Label className="mb-1 block text-[11px] font-medium text-muted-foreground/80">{_t("孔径 φ")}</Label>
                    <input
                      type="text"
                      disabled
                      value="— (通底)"
                      title={_t("通底模式下孔径直通孔底最深处，无需单独配置孔径")}
                      className="h-7 w-full rounded-md border border-input/40 bg-muted/40 text-center text-xs text-muted-foreground cursor-not-allowed select-none"
                    />
                  </div>
                ) : (
                  <MetricCell
                    label={_t("孔径 φ")}
                    path={`${portPath}.diameter`}
                    placeholder={_t("孔径")}
                    min={0.1}
                    disabled={disabled}
                    issueFor={issueFor}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {showAddBtn && (
        <Button size="sm" variant="outline" className="h-8 w-full text-xs" disabled={disabled} onClick={handleAddPort}>
          <Plus className="size-3.5" /> {_t("添加侧油口")}</Button>
      )}
    </div>
  )
}
