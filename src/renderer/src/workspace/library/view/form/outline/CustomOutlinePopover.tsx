import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 自定义 SVG Path 轮廓编辑 Popover 组件
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Code2, Maximize2, Minus, Plus, Sparkles, Trash2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { FloatingPopover } from '@renderer/components/ui/floating-popover'

export interface CustomOutlinePopoverProps {
  open?: boolean
  triggerRef?: React.RefObject<HTMLElement | null>
  pathData: string
  disabled?: boolean
  onChange: (nextPath: string) => void
  onClose?: () => void
}

const TEMPLATES: { label: string; path: string }[] = [
  {
    label: '正六边形',
    path: 'M0,-35 L30.31,-17.5 L30.31,17.5 L0,35 L-30.31,17.5 L-30.31,-17.5 Z'
  },
  {
    label: '菱形',
    path: 'M0,-40 L40,0 L0,40 L-40,0 Z'
  },
  {
    label: '长圆跑道',
    path: 'M-25,-18 H25 A18,18 0 0 1 25,18 H-25 A18,18 0 0 1 -25,-18 Z'
  },
  {
    label: '倒角矩形',
    path: 'M-30,-35 H30 L35,-30 V30 L30,35 H-30 L-35,30 V-30 Z'
  }
]

export function CustomOutlinePopover({
  open = true,
  triggerRef,
  pathData,
  disabled,
  onChange,
  onClose
}: CustomOutlinePopoverProps) {
  _useLocale()
  const [localVal, setLocalVal] = useState(pathData)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    setLocalVal(pathData)
  }, [pathData])

  const handleCommit = (val: string) => {
    setLocalVal(val)
    onChange(val)
  }

  // 简易包围盒与预览
  const previewData = useMemo(() => {
    const nums = localVal.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    if (nums.length < 2) {
      return { baseSpan: 100, extent: 50 }
    }
    const maxVal = Math.max(10, ...nums.map(Math.abs)) * 1.3
    return {
      baseSpan: maxVal * 2,
      extent: maxVal
    }
  }, [localVal])

  const curSpan = previewData.baseSpan / zoom
  const curMinX = -(curSpan / 2) - pan.x
  const curMinY = -(curSpan / 2) - pan.y
  const viewBox = `${curMinX} ${curMinY} ${curSpan} ${curSpan}`

  const previewRef = useRef<HTMLDivElement>(null)

  // 滚轮缩放事件（非被动监听，确保 preventDefault 生效并阻止外层滚动）
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const factor = e.deltaY < 0 ? 1.15 : 0.87
      setZoom((z) => Math.max(0.3, Math.min(6, Number((z * factor).toFixed(2)))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 零惯性精准平移事件（1:1 像素映射）
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    setIsDragging(true)
    const startClientX = e.clientX
    const startClientY = e.clientY
    const startPanX = pan.x
    const startPanY = pan.y
    const el = previewRef.current
    const elW = el?.clientWidth || 360
    const elH = el?.clientHeight || 144
    const sX = curSpan / elW
    const sY = curSpan / elH

    const onMouseMove = (ev: MouseEvent) => {
      const dX = (ev.clientX - startClientX) * sX
      const dY = (ev.clientY - startClientY) * sY
      setPan({
        x: startPanX + dX,
        y: startPanY + dY
      })
    }

    const onMouseUp = () => {
      setIsDragging(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const handleReset = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation()
    setZoom((z) => Math.min(6, Number((z * 1.25).toFixed(2))))
  }

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation()
    setZoom((z) => Math.max(0.3, Number((z / 1.25).toFixed(2))))
  }

  return (
    <FloatingPopover
      open={open}
      triggerRef={triggerRef}
      onClose={onClose}
      title={_t("自定义 SVG Path 轮廓")}
      icon={<Code2 className="size-4 text-primary" />}
      headerExtra={<span className="text-[10px] text-muted-foreground font-mono">{_t("原点=(0,0)")}</span>}
      defaultWidth={390}
      minWidth={320}
      minHeight={300}
      footer={
        onClose && (
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
            onClick={onClose}
          >
            <Check className="size-3.5" />
            <span>{_t("完成")}</span>
          </button>
        )
      }
    >
      {/* SVG Path 简易实时预览（底色、线条风格与主区域保持一致） */}
      <div
        ref={previewRef}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleReset}
        className={cn(
          'relative flex min-h-36 h-40 flex-1 w-full select-none items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-background text-foreground',
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
      >
        <svg
          viewBox={viewBox}
          className="size-full overflow-visible p-2 text-foreground pointer-events-none"
        >
          {/* 原点中心十字（对齐主区域 FaceView: 紧凑清晰） */}
          <g className="stroke-muted-foreground/60" strokeWidth="0.5" strokeLinecap="round">
            <line x1="-5" y1="0" x2="5" y2="0" />
            <line x1="0" y1="-5" x2="0" y2="5" />
            <circle cx="0" cy="0" r="0.75" className="fill-muted-foreground/80 stroke-none" />
          </g>

          {/* 路径轮廓（对齐主区域 FaceView: 前景墨线 + 3% 淡填充） */}
          {localVal.trim() && (
            <path
              d={localVal}
              className="fill-foreground/[0.03] stroke-foreground"
              strokeWidth="1.0"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </svg>

        {!localVal.trim() && (
          <span className="text-xs text-muted-foreground font-mono pointer-events-none">{_t("暂无有效 Path 路径")}</span>
        )}

        {/* 右上角适应视图按钮（对齐主区域 CavityPreview 风格） */}
        <div className="absolute right-2.5 top-2.5 z-10">
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded border border-border/60 bg-background/85 text-muted-foreground hover:bg-accent hover:text-foreground shadow-xs transition-colors cursor-pointer"
            title={_t("适应视图 (双击画布亦可复位)")}
            onClick={handleReset}
          >
            <Maximize2 className="size-3" />
          </button>
        </div>

        {/* 交互工具栏（对齐主区域紧凑风格） */}
        <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1 rounded-md border border-border/40 bg-background/85 px-1.5 py-0.5 text-xs text-muted-foreground shadow-xs backdrop-blur z-10">
          <button
            type="button"
            title={_t("缩小")}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            onClick={handleZoomOut}
          >
            <Minus className="size-3" />
          </button>
          <button
            type="button"
            title={_t("复位 100% (双击画布复位)")}
            className="px-1 font-mono text-[10px] text-foreground hover:text-primary transition-colors cursor-pointer"
            onClick={handleReset}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            title={_t("放大")}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            onClick={handleZoomIn}
          >
            <Plus className="size-3" />
          </button>
        </div>

        <div className="pointer-events-none absolute bottom-2.5 right-2.5 text-[10px] text-muted-foreground">
          {_t("滚轮缩放 · 拖拽平移")}</div>
      </div>

      {/* 快捷模板 */}
      <div className="flex items-center gap-1 overflow-x-auto py-0.5">
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          <Sparkles className="size-3 text-amber-500" /> {_t("模板:")}</span>
        {TEMPLATES.map((tmpl) => (
          <button
            key={tmpl.label}
            type="button"
            disabled={disabled}
            className="shrink-0 rounded border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] text-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => handleCommit(tmpl.path)}
          >
            {_t(tmpl.label)}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          title={_t("清空路径")}
          className="ml-auto shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          onClick={() => handleCommit('')}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Path 文本输入框 */}
      <div className="space-y-1">
        <textarea
          rows={3}
          value={localVal}
          disabled={disabled}
          placeholder="M-35,-35H35V35H-35V-35Z"
          className="w-full resize-none rounded-md border border-input bg-background p-2 text-xs font-mono leading-relaxed text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={(e) => handleCommit(e.target.value)}
        />
        <p className="text-[10px] leading-tight text-muted-foreground/80">
          {_t("支持 SVG path 语法指令：M/m、L/l、H/h、V/v、C/c、A/a、Z/z；坐标原点为组合孔几何中心。")}</p>
      </div>
    </FloatingPopover>
  )
}
