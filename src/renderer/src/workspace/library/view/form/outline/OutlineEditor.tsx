import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
/**
 * 安装轮廓专用编辑器（OutlineEditor）
 *
 * 1. 提供 Header 紧跟“安装轮廓”标题的 4 种类型图标按钮选择器（矩形、圆形、SAE 法兰、自定义）
 * 2. 矩形与圆形在 Body 区域进行参数驱动
 * 3. SAE 法兰与自定义图形通过 Popover 进行深入参数修改与 CAD 图形预览
 */

import { useMemo, useRef, useState } from 'react'
import { Ban, Edit3, SlidersHorizontal } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { UpdateCmd } from '@renderer/workspace/library/viewmodel/commands'
import { useLibraryStore } from '@renderer/workspace/library/viewmodel/libraryStore'
import type { CavityTemplate, Outline } from '@shared/cavity/types'
import type {
  CircleParams,
  CustomParams,
  OutlineShapeType,
  RectParams,
  SaeFlangeParams
} from './outlineTypes'
import {
  generateCirclePath,
  generateRectPath,
  generateSaeFlangePath,
  inferOutlineShape
} from './outlineGeometry'
import { createDefaultSaeFlangeParams, getSaeStandard } from './saeFlangeStandards'
import { SaeFlangePopover } from './SaeFlangePopover'
import { CustomOutlinePopover } from './CustomOutlinePopover'

export interface OutlineEditorProps {
  basePath: string
  template: CavityTemplate
  disabled?: boolean
}

export interface OutlineHeaderButtonsProps {
  basePath: string
  template: CavityTemplate
  disabled?: boolean
}

/**
 * 获取或推断当前轮廓的类型与状态
 */
function resolveCurrentOutline(outline: Outline | undefined, cavityType?: string) {
  const data = outline?.data ?? ''
  const savedType = (outline?.type ??
    outline?.shapeType ??
    (outline?.format && outline.format !== 'svg-path' ? outline.format : undefined)) as
    | OutlineShapeType
    | undefined
  const savedParams = outline?.params as any

  if (savedType) {
    return {
      type: savedType,
      rect: savedType === 'rect' ? (savedParams as RectParams) : undefined,
      circle: savedType === 'circle' ? (savedParams as CircleParams) : undefined,
      flange: savedType === 'flange' ? (savedParams as SaeFlangeParams) : undefined,
      custom: savedType === 'custom' ? (savedParams as CustomParams) : undefined
    }
  }

  if (!data.trim()) {
    return { type: 'none' as const }
  }

  // 从已有的 SVG Path 自动推断
  return inferOutlineShape(data, cavityType)
}


/* ========================================================================= */
/*                       1. Header 图标按钮选择器                            */
/* ========================================================================= */

export function OutlineHeaderButtons({
  basePath,
  template,
  disabled
}: OutlineHeaderButtonsProps) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const outline = template.geometry.outline
  const unit = template.unit ?? 'mm'

  const resolved = useMemo(() => resolveCurrentOutline(outline, template.cavityType), [outline, template.cavityType])
  const activeType = resolved.type

  const [flangePopoverOpen, setFlangePopoverOpen] = useState(false)
  const [customPopoverOpen, setCustomPopoverOpen] = useState(false)
  const flangeButtonRef = useRef<HTMLButtonElement>(null)
  const customButtonRef = useRef<HTMLButtonElement>(null)

  // 状态参数提取与保底
  const currentFlangeParams: SaeFlangeParams = useMemo(() => {
    return resolved.flange ?? createDefaultSaeFlangeParams()
  }, [resolved.flange])

  const currentCustomPath: string = outline?.data ?? ''

  // 切换类型
  const handleSelectType = (type: OutlineShapeType) => {
    if (disabled) return

    if (type === activeType) {
      // 已经选中时，再次点击切换开启/收起弹窗
      if (type === 'flange') setFlangePopoverOpen((prev) => !prev)
      if (type === 'custom') setCustomPopoverOpen((prev) => !prev)
      return
    }

    if (type !== 'flange') setFlangePopoverOpen(false)
    if (type !== 'custom') setCustomPopoverOpen(false)

    let nextData = ''
    let nextParams: any = undefined

    if (type === 'none') {
      nextData = ''
      nextParams = undefined
    } else if (type === 'rect') {
      const rectParams: RectParams = resolved.rect ?? {
        width: 70,
        height: 70,
        cornerRadius: 0,
        offsetX: 0,
        offsetY: 0
      }
      nextData = generateRectPath(rectParams)
      nextParams = rectParams
    } else if (type === 'circle') {
      const circleParams: CircleParams = resolved.circle ?? {
        diameter: 70,
        offsetX: 0,
        offsetY: 0
      }
      nextData = generateCirclePath(circleParams)
      nextParams = circleParams
    } else if (type === 'flange') {
      const flangeParams: SaeFlangeParams = resolved.flange ?? createDefaultSaeFlangeParams()
      nextData = generateSaeFlangePath(flangeParams)
      nextParams = flangeParams
      setFlangePopoverOpen(true)
    } else if (type === 'custom') {
      nextData = outline?.data || 'M-35,-35H35V35H-35V-35Z'
      nextParams = { pathData: nextData }
      setCustomPopoverOpen(true)
    }

    const nextOutline: Outline = {
      type,
      format: type === 'rect' ? 'rect' : 'svg-path',
      data: nextData,
      shapeType: type,
      params: nextParams
    }

    execute(new UpdateCmd(`${basePath}.geometry.outline`, nextOutline, outline ?? null, _msg`切换安装轮廓类型为${type}`))
  }

  // 法兰 Popover 修改
  const handleFlangeChange = (next: SaeFlangeParams) => {
    const nextPath = generateSaeFlangePath(next)
    const nextOutline: Outline = {
      type: 'flange',
      format: 'svg-path',
      data: nextPath,
      shapeType: 'flange',
      params: next
    }
    execute(new UpdateCmd(`${basePath}.geometry.outline`, nextOutline, outline ?? null, _t("修改法兰驱动尺寸")))
  }

  // 自定义 Popover 修改
  const handleCustomChange = (nextPath: string) => {
    const nextOutline: Outline = {
      type: 'custom',
      format: 'svg-path',
      data: nextPath,
      shapeType: 'custom',
      params: { pathData: nextPath }
    }
    execute(new UpdateCmd(`${basePath}.geometry.outline`, nextOutline, outline ?? null, _t("修改自定义轮廓路径")))
  }

  return (
    <div className="flex items-center gap-1 ml-1 select-none">
      {/* 无安装轮廓按钮 */}
      <button
        type="button"
        disabled={disabled}
        title={_t("无安装轮廓（仅内部子孔）")}
        onClick={() => handleSelectType('none')}
        className={cn(
          'flex size-6.5 items-center justify-center rounded-md border p-1 transition-all',
          activeType === 'none'
            ? 'border-primary bg-primary/15 shadow-xs ring-1 ring-primary/40 text-primary'
            : 'border-border/60 bg-background text-muted-foreground opacity-70 hover:border-border hover:bg-accent hover:opacity-100 hover:text-foreground',
          disabled && 'cursor-not-allowed opacity-30'
        )}
      >
        <Ban className="size-3.5" />
      </button>

      {/* 矩形按钮 */}
      <button
        type="button"
        disabled={disabled}
        title={_t("矩形轮廓（参数驱动）")}
        onClick={() => handleSelectType('rect')}
        className={cn(
          'flex size-6.5 items-center justify-center rounded-md border p-1 transition-all',
          activeType === 'rect'
            ? 'border-primary bg-primary/15 shadow-xs ring-1 ring-primary/40'
            : 'border-border/60 bg-background opacity-70 hover:border-border hover:bg-accent hover:opacity-100',
          disabled && 'cursor-not-allowed opacity-30'
        )}
      >
        <img
          src={`${import.meta.env.BASE_URL}RectOutline.svg`}
          alt={_t("矩形")}
          className="size-4 pointer-events-none"
        />
      </button>

      {/* 圆形按钮 */}
      <button
        type="button"
        disabled={disabled}
        title={_t("圆形轮廓（参数驱动）")}
        onClick={() => handleSelectType('circle')}
        className={cn(
          'flex size-6.5 items-center justify-center rounded-md border p-1 transition-all',
          activeType === 'circle'
            ? 'border-primary bg-primary/15 shadow-xs ring-1 ring-primary/40'
            : 'border-border/60 bg-background opacity-70 hover:border-border hover:bg-accent hover:opacity-100',
          disabled && 'cursor-not-allowed opacity-30'
        )}
      >
        <img
          src={`${import.meta.env.BASE_URL}CircleOutline.svg`}
          alt={_t("圆形")}
          className="size-4 pointer-events-none"
        />
      </button>

      {/* 法兰按钮（点击弹窗深入修改与查看 CAD 预览） */}
      <button
        ref={flangeButtonRef}
        type="button"
        data-popover-trigger="true"
        disabled={disabled}
        title={_t("SAE 法兰轮廓（点击深入修改尺寸与预览）")}
        onClick={() => handleSelectType('flange')}
        className={cn(
          'flex size-6.5 items-center justify-center rounded-md border p-1 transition-all',
          activeType === 'flange'
            ? 'border-primary bg-primary/15 shadow-xs ring-1 ring-primary/40'
            : 'border-border/60 bg-background opacity-70 hover:border-border hover:bg-accent hover:opacity-100',
          disabled && 'cursor-not-allowed opacity-30'
        )}
      >
        <img
          src={`${import.meta.env.BASE_URL}FlangeOutline.svg`}
          alt={_t("法兰")}
          className="size-4 pointer-events-none"
        />
      </button>

      {/* 自定义按钮（点击编辑 SVG Path） */}
      <button
        ref={customButtonRef}
        type="button"
        data-popover-trigger="true"
        disabled={disabled}
        title={_t("自定义图形（点击编辑 SVG Path）")}
        onClick={() => handleSelectType('custom')}
        className={cn(
          'flex size-6.5 items-center justify-center rounded-md border p-1 transition-all',
          activeType === 'custom'
            ? 'border-primary bg-primary/15 shadow-xs ring-1 ring-primary/40'
            : 'border-border/60 bg-background opacity-70 hover:border-border hover:bg-accent hover:opacity-100',
          disabled && 'cursor-not-allowed opacity-30'
        )}
      >
        <img
          src={`${import.meta.env.BASE_URL}CustomOutline.svg`}
          alt={_t("自定义")}
          className="size-4 pointer-events-none"
        />
      </button>

      {/* 法兰浮动弹窗 */}
      <SaeFlangePopover
        open={flangePopoverOpen}
        triggerRef={flangeButtonRef}
        params={currentFlangeParams}
        unit={unit}
        disabled={disabled}
        onChange={handleFlangeChange}
        onClose={() => setFlangePopoverOpen(false)}
      />

      {/* 自定义浮动弹窗 */}
      <CustomOutlinePopover
        open={customPopoverOpen}
        triggerRef={customButtonRef}
        pathData={currentCustomPath}
        disabled={disabled}
        onChange={handleCustomChange}
        onClose={() => setCustomPopoverOpen(false)}
      />
    </div>
  )
}

/* ========================================================================= */
/*                       2. OutlineEditor Body 主体区域                      */
/* ========================================================================= */

export function OutlineEditor({ basePath, template, disabled }: OutlineEditorProps) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const outline = template.geometry.outline
  const unit = template.unit ?? 'mm'

  const resolved = useMemo(() => resolveCurrentOutline(outline, template.cavityType), [outline, template.cavityType])
  const activeType = resolved.type

  // Popover 状态（供 Body 内的按钮触发）
  const [bodyFlangeOpen, setBodyFlangeOpen] = useState(false)
  const [bodyCustomOpen, setBodyCustomOpen] = useState(false)
  const bodyFlangeButtonRef = useRef<HTMLButtonElement>(null)
  const bodyCustomButtonRef = useRef<HTMLButtonElement>(null)

  // 1. 矩形参数修改
  const handleRectChange = (field: keyof RectParams, valStr: string) => {
    if (disabled) return
    const num = parseFloat(valStr)
    if (!Number.isFinite(num)) return

    const current: RectParams = resolved.rect ?? {
      width: 70,
      height: 70,
      cornerRadius: 0,
      offsetX: 0,
      offsetY: 0
    }
    const next: RectParams = { ...current, [field]: num }
    const nextData = generateRectPath(next)

    const nextOutline: Outline = {
      type: 'rect',
      format: 'rect',
      data: nextData,
      shapeType: 'rect',
      params: next
    }
    execute(new UpdateCmd(`${basePath}.geometry.outline`, nextOutline, outline ?? null, _t("修改矩形轮廓参数")))
  }

  // 2. 圆形参数修改
  const handleCircleChange = (field: keyof CircleParams, valStr: string) => {
    if (disabled) return
    const num = parseFloat(valStr)
    if (!Number.isFinite(num)) return

    const current: CircleParams = resolved.circle ?? {
      diameter: 70,
      offsetX: 0,
      offsetY: 0
    }
    const next: CircleParams = { ...current, [field]: num }
    const nextData = generateCirclePath(next)

    const nextOutline: Outline = {
      type: 'circle',
      format: 'svg-path',
      data: nextData,
      shapeType: 'circle',
      params: next
    }
    execute(new UpdateCmd(`${basePath}.geometry.outline`, nextOutline, outline ?? null, _t("修改圆形轮廓参数")))
  }

  // 3. 法兰修改
  const handleFlangeChange = (next: SaeFlangeParams) => {
    const nextPath = generateSaeFlangePath(next)
    const nextOutline: Outline = {
      type: 'flange',
      format: 'svg-path',
      data: nextPath,
      shapeType: 'flange',
      params: next
    }
    execute(new UpdateCmd(`${basePath}.geometry.outline`, nextOutline, outline ?? null, _t("修改法兰驱动尺寸")))
  }

  // 4. 自定义修改
  const handleCustomChange = (nextPath: string) => {
    const nextOutline: Outline = {
      type: 'custom',
      format: 'svg-path',
      data: nextPath,
      shapeType: 'custom',
      params: { pathData: nextPath }
    }
    execute(new UpdateCmd(`${basePath}.geometry.outline`, nextOutline, outline ?? null, _t("修改自定义轮廓路径")))
  }

  // ----------------------- 无轮廓 -----------------------
  if (activeType === 'none') {
    return (
      <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-3.5 text-center select-none">
        <Ban className="mx-auto size-5 text-muted-foreground/60 mb-1.5" />
        <div className="text-xs font-medium text-foreground">{_t("无安装轮廓")}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
          {_t("当前组合孔未配置外边框轮廓，仅由内部子孔构成。如需配置，可点击上方图标选择轮廓形状。")}</div>
      </div>
    )
  }

  // ----------------------- 矩形编辑器 -----------------------
  if (activeType === 'rect') {
    const r = resolved.rect ?? { width: 70, height: 70, cornerRadius: 0, offsetX: 0, offsetY: 0 }
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {/* 宽度 */}
          <div className="grid grid-cols-[68px_1fr] items-center gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">{_t("宽度 (W)")}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="1"
                min="1"
                value={r.width}
                disabled={disabled}
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onChange={(e) => handleRectChange('width', e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">{unit}</span>
            </div>
          </div>

          {/* 高度 */}
          <div className="grid grid-cols-[68px_1fr] items-center gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">{_t("高度 (H)")}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="1"
                min="1"
                value={r.height}
                disabled={disabled}
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onChange={(e) => handleRectChange('height', e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">{unit}</span>
            </div>
          </div>

          {/* 圆角 */}
          <div className="grid grid-cols-[68px_1fr] items-center gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">{_t("圆角 (R)")}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                min="0"
                value={r.cornerRadius}
                disabled={disabled}
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onChange={(e) => handleRectChange('cornerRadius', e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">{unit}</span>
            </div>
          </div>

          {/* 尺寸摘要 */}
          <div className="flex items-center justify-end px-2 text-[11px] text-muted-foreground">
            <span>{_t("尺寸：")}{r.width} × {r.height} {unit}</span>
          </div>

          {/* 偏移 X */}
          <div className="grid grid-cols-[68px_1fr] items-center gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">{_t("偏移 X")}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                value={r.offsetX}
                disabled={disabled}
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onChange={(e) => handleRectChange('offsetX', e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">{unit}</span>
            </div>
          </div>

          {/* 偏移 Y */}
          <div className="grid grid-cols-[68px_1fr] items-center gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">{_t("偏移 Y")}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                value={r.offsetY}
                disabled={disabled}
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onChange={(e) => handleRectChange('offsetY', e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">{unit}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ----------------------- 圆形编辑器 -----------------------
  if (activeType === 'circle') {
    const c = resolved.circle ?? { diameter: 70, offsetX: 0, offsetY: 0 }
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {/* 直径 */}
          <div className="grid grid-cols-[68px_1fr] items-center gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">{_t("直径 (Ø)")}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="1"
                min="1"
                value={c.diameter}
                disabled={disabled}
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onChange={(e) => handleCircleChange('diameter', e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">{unit}</span>
            </div>
          </div>

          {/* 尺寸摘要 */}
          <div className="flex items-center justify-end px-2 text-[11px] text-muted-foreground">
            <span>{_t("外径：Ø")}{c.diameter} {unit}</span>
          </div>

          {/* 偏移 X */}
          <div className="grid grid-cols-[68px_1fr] items-center gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">{_t("偏移 X")}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                value={c.offsetX}
                disabled={disabled}
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onChange={(e) => handleCircleChange('offsetX', e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">{unit}</span>
            </div>
          </div>

          {/* 偏移 Y */}
          <div className="grid grid-cols-[68px_1fr] items-center gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">{_t("偏移 Y")}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                value={c.offsetY}
                disabled={disabled}
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onChange={(e) => handleCircleChange('offsetY', e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">{unit}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ----------------------- 法兰编辑器卡片 -----------------------
  if (activeType === 'flange') {
    const f: SaeFlangeParams = resolved.flange ?? createDefaultSaeFlangeParams()
    const std = getSaeStandard(f.standardKey)

    return (
      <div className="rounded-lg border border-border/70 bg-card/60 p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">
              {std ? std.label : _t("SAE J518 自定义法兰")}
            </span>
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {f.rotation}{_t("° 旋转")}</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">
            {std?.pressure ?? _t("定制压力")}
          </span>
        </div>

        {/* 关键参数数值清单 */}
        <div className="grid grid-cols-4 gap-1.5 rounded-md bg-muted/30 p-2 text-center text-xs">
          <div>
            <div className="text-[10px] text-muted-foreground">{_t("短孔距 a")}</div>
            <div className="font-mono font-medium">{f.b} {unit}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">{_t("长孔距 b")}</div>
            <div className="font-mono font-medium">{f.a} {unit}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">{_t("外凸总宽 A")}</div>
            <div className="font-mono font-medium">{f.waistWidth} {unit}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">{_t("总高 B")}</div>
            <div className="font-mono font-medium">{(f.a + 2 * f.earRadius).toFixed(1)} {unit}</div>
          </div>
        </div>

        {/* Popover 修改触发按钮 */}
        <div>
          <button
            ref={bodyFlangeButtonRef}
            type="button"
            data-popover-trigger="true"
            disabled={disabled}
            onClick={() => setBodyFlangeOpen((prev) => !prev)}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <SlidersHorizontal className="size-3.5" />
            <span>{_t("修改法兰尺寸与查看 CAD 预览")}</span>
          </button>

          <SaeFlangePopover
            open={bodyFlangeOpen}
            triggerRef={bodyFlangeButtonRef}
            params={f}
            unit={unit}
            disabled={disabled}
            onChange={handleFlangeChange}
            onClose={() => setBodyFlangeOpen(false)}
          />
        </div>
      </div>
    )
  }

  // ----------------------- 自定义编辑器卡片 -----------------------
  const customPath = outline?.data ?? ''
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">{_t("自定义 SVG Path 轮廓")}</span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {customPath.length} {_t("字符")}</span>
      </div>

      <div className="max-h-16 overflow-y-auto rounded bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground break-all">
        {customPath || _t("暂无路径数据")}
      </div>

      <div>
        <button
          ref={bodyCustomButtonRef}
          type="button"
          data-popover-trigger="true"
          disabled={disabled}
          onClick={() => setBodyCustomOpen((prev) => !prev)}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Edit3 className="size-3.5" />
          <span>{_t("打开 SVG Path 编辑弹窗")}</span>
        </button>

        <CustomOutlinePopover
          open={bodyCustomOpen}
          triggerRef={bodyCustomButtonRef}
          pathData={customPath}
          disabled={disabled}
          onChange={handleCustomChange}
          onClose={() => setBodyCustomOpen(false)}
        />
      </div>
    </div>
  )
}
