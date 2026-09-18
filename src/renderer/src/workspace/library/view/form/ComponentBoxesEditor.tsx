import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 元件包围盒编辑器（PRD-002 §8.12 / FR-03-79）
 *
 * 极简参数直接录入设计：
 * - 列表样式与台阶序列、侧油口保持一致（divide-y 卡片）；
 * - 首行：名称 + 形状切换（长方体 / 圆柱体） + 删除；
 * - 次行：直接输入尺寸与基准偏移数值（Label 在上、输入在下）；
 * - 移除过多注释文字，详细说明移入组标题行「?」帮助 Popover。
 */

import { Box, Cylinder, Plus, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { InsertCmd, RemoveCmd, UpdateCmd } from '../../viewmodel/commands'
import { useLibraryStore } from '../../viewmodel/libraryStore'
import { NumInput, useBoundText, type IssueForPath } from './FormRenderer'
import { cn } from '@renderer/lib/utils'
import type { ComponentBox } from '@shared/cavity/types'

export interface ComponentBoxesEditorProps {
  basePath: string
  boxes: ComponentBox[]
  unit?: string
  disabled?: boolean
  showAddBtn?: boolean
  issueFor?: IssueForPath
}

function MetricCell({
  label,
  path,
  placeholder,
  min,
  max,
  disabled,
  issueFor
}: {
  label: string
  path: string
  placeholder?: string
  min?: number
  max?: number
  disabled?: boolean
  issueFor?: IssueForPath
}) {
  _useLocale()
  const issue = issueFor?.(path)
  return (
    <div>
      <Label className="mb-1 block text-[11px] font-medium text-muted-foreground/80">{_t(label)}</Label>
      <NumInput path={path} placeholder={placeholder} min={min} max={max} disabled={disabled} />
      {issue && (
        <p className={cn('mt-1 text-[10px] leading-tight', issue.level === 'error' ? 'text-destructive' : 'text-amber-600')}>
          {issue.message}
        </p>
      )}
    </div>
  )
}

function BoxNameInput({ path, disabled }: { path: string; disabled?: boolean }) {
  _useLocale()
  const bound = useBoundText(path)
  return (
    <input
      type="text"
      value={bound.value}
      placeholder={_t("包围盒名称")}
      disabled={disabled}
      onChange={bound.onChange}
      onBlur={bound.onBlur}
      className="h-7 w-28 rounded-md border border-input bg-background px-2 text-xs font-semibold text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
    />
  )
}

export function ComponentBoxesEditor({
  basePath,
  boxes,
  unit: _unit = 'mm',
  disabled,
  showAddBtn = false,
  issueFor
}: ComponentBoxesEditorProps) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const arrPath = `${basePath}.componentBoxes`

  const handleAddBox = (shape: 'box' | 'cylinder' = 'box') => {
    if (disabled) return
    const count = boxes.length + 1
    const newBox: ComponentBox =
      shape === 'box'
        ? {
            name: count === 1 ? 'body' : `box-${count}`,
            shape: 'box',
            offsetX: 0,
            offsetY: 0,
            rotationZ: 0,
            size: { x: 50, y: 50, z: 40 }
          }
        : {
            name: count === 1 ? 'body' : `cyl-${count}`,
            shape: 'cylinder',
            offsetX: 0,
            offsetY: 0,
            diameter: 40,
            height: 50
          }
    execute(new InsertCmd(arrPath, boxes.length, newBox, _t("添加元件包围盒")))
  }

  const handleSwitchShape = (index: number, cur: ComponentBox, targetShape: 'box' | 'cylinder') => {
    if (disabled || cur.shape === targetShape) return
    const boxPath = `${arrPath}.${index}`
    let next: ComponentBox
    if (targetShape === 'cylinder') {
      const approxDia = cur.shape === 'box' ? Math.max(cur.size.x, cur.size.y) : 40
      const approxHeight = cur.shape === 'box' ? cur.size.z : 50
      next = {
        name: cur.name,
        shape: 'cylinder',
        offsetX: cur.offsetX ?? 0,
        offsetY: cur.offsetY ?? 0,
        diameter: approxDia,
        height: approxHeight
      }
    } else {
      const approxD = cur.shape === 'cylinder' ? cur.diameter : 40
      const approxH = cur.shape === 'cylinder' ? cur.height : 50
      next = {
        name: cur.name,
        shape: 'box',
        offsetX: cur.offsetX ?? 0,
        offsetY: cur.offsetY ?? 0,
        rotationZ: 0,
        size: { x: approxD, y: approxD, z: approxH }
      }
    }
    execute(new UpdateCmd(boxPath, next, cur, _t("切换包围盒形状")))
  }

  return (
    <div className={boxes.length > 0 ? "space-y-2" : ""}>
      <div className={cn("divide-y divide-border/60 border-border/60", boxes.length > 0 && "border-y")}>
        {boxes.map((b, i) => {
          const boxPath = `${arrPath}.${i}`

          return (
            <div key={i} className="relative px-3 py-2.5 transition-colors space-y-2.5 hover:bg-muted/30">
              {/* 行 1：名称 + 形状分段切换 + 删除操作 */}
              <div className="flex items-center gap-2">
                <BoxNameInput path={`${boxPath}.name`} disabled={disabled} />

                {/* 长方体 / 圆柱体 图标分段切换 */}
                <div className="flex items-center rounded-md border border-border/70 bg-muted/40 p-0.5 shadow-2xs">
                  <button
                    type="button"
                    disabled={disabled}
                    title={_t("长方体 (Box)")}
                    onClick={() => handleSwitchShape(i, b, 'box')}
                    className={cn(
                      'flex size-6 items-center justify-center rounded transition-all',
                      b.shape === 'box'
                        ? 'border border-border/60 bg-background shadow-xs ring-1 ring-primary/30 text-primary'
                        : 'text-muted-foreground hover:text-foreground opacity-70 hover:opacity-100',
                      disabled && 'cursor-not-allowed opacity-30'
                    )}
                  >
                    <Box className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    title={_t("圆柱体 (Cylinder)")}
                    onClick={() => handleSwitchShape(i, b, 'cylinder')}
                    className={cn(
                      'flex size-6 items-center justify-center rounded transition-all',
                      b.shape === 'cylinder'
                        ? 'border border-border/60 bg-background shadow-xs ring-1 ring-primary/30 text-primary'
                        : 'text-muted-foreground hover:text-foreground opacity-70 hover:opacity-100',
                      disabled && 'cursor-not-allowed opacity-30'
                    )}
                  >
                    <Cylinder className="size-3.5" />
                  </button>
                </div>

                <div className="flex-1" />

                <button
                  type="button"
                  title={_t("删除该包围盒")}
                  disabled={disabled}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                  onClick={() => execute(new RemoveCmd(arrPath, i, b, _t("删除元件包围盒")))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              {/* 行 2：直接录入尺寸与偏移参数 */}
              {b.shape === 'box' ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <MetricCell label={_t("长 X")} path={`${boxPath}.size.x`} min={0.1} disabled={disabled} issueFor={issueFor} />
                    <MetricCell label={_t("宽 Y")} path={`${boxPath}.size.y`} min={0.1} disabled={disabled} issueFor={issueFor} />
                    <MetricCell label={_t("悬伸高 Z")} path={`${boxPath}.size.z`} min={0.1} disabled={disabled} issueFor={issueFor} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <MetricCell label={_t("偏移 X")} path={`${boxPath}.offsetX`} placeholder="0" disabled={disabled} issueFor={issueFor} />
                    <MetricCell label={_t("偏移 Y")} path={`${boxPath}.offsetY`} placeholder="0" disabled={disabled} issueFor={issueFor} />
                    <MetricCell label={_t("旋转 ∠ (°)")} path={`${boxPath}.rotationZ`} placeholder="0" disabled={disabled} issueFor={issueFor} />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCell label={_t("直径 φ")} path={`${boxPath}.diameter`} min={0.1} disabled={disabled} issueFor={issueFor} />
                    <MetricCell label={_t("悬伸高 H")} path={`${boxPath}.height`} min={0.1} disabled={disabled} issueFor={issueFor} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCell label={_t("偏移 X")} path={`${boxPath}.offsetX`} placeholder="0" disabled={disabled} issueFor={issueFor} />
                    <MetricCell label={_t("偏移 Y")} path={`${boxPath}.offsetY`} placeholder="0" disabled={disabled} issueFor={issueFor} />
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {showAddBtn && (
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" className="h-8 flex-1 text-xs" disabled={disabled} onClick={() => handleAddBox('box')}>
            <Plus className="size-3.5" /> {_t("添加长方体")}</Button>
          <Button size="sm" variant="outline" className="h-8 flex-1 text-xs" disabled={disabled} onClick={() => handleAddBox('cylinder')}>
            <Plus className="size-3.5" /> {_t("添加圆柱体")}</Button>
        </div>
      )}
    </div>
  )
}
