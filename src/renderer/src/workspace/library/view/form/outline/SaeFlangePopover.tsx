import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * SAE 法兰参数驱动与 CAD 标注图形预览弹窗组件
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Maximize2, Minus, Plus, RotateCw } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { FloatingPopover } from '@renderer/components/ui/floating-popover'
import type { SaeFlangeParams } from './outlineTypes'
import { generateSaeFlangePath } from './outlineGeometry'
import {
  getSaeStandard,
  SAE_FLANGE_STANDARDS
} from './saeFlangeStandards'

export interface SaeFlangePopoverProps {
  open?: boolean
  triggerRef?: React.RefObject<HTMLElement | null>
  params: SaeFlangeParams
  unit?: 'mm' | 'in'
  disabled?: boolean
  onChange: (next: SaeFlangeParams) => void
  onClose?: () => void
}

/**
 * CAD 风格尺寸标注与图形预览 SVG（支持滚轮缩放、拖拽平移、双击复位）
 */
function FlangeCadPreview({ params }: { params: SaeFlangeParams }) {
  _useLocale()
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)

  const isHoriz = params.rotation === 90
  const dx = (isHoriz ? params.a : params.b) / 2
  const dy = (isHoriz ? params.b : params.a) / 2
  const r = Math.max(2, params.earRadius)
  const boltR = Math.max(1.5, params.boltDia / 2)

  // 新尺寸名称标准映射：短孔距 a，长孔距 b，外凸总宽 A，总高 B
  const aPitchVal = params.b
  const bPitchVal = params.a
  const aWidthVal = Number(params.waistWidth.toFixed(1))
  const bHeightVal = Number((params.a + 2 * params.earRadius).toFixed(1))
  const rVal = Number(params.earRadius.toFixed(1))

  // 计算当前方向下的基准外围包围盒（包含最大外宽与总高）
  const totalW = isHoriz ? bHeightVal : aWidthVal
  const totalH = isHoriz ? aWidthVal : bHeightVal

  // 视口边距（为 CAD 引线及多层标注预留充分空间，杜绝贴边或裁切）
  const padX = Math.max(34, totalW * 0.52)
  const padY = Math.max(32, totalH * 0.48)

  const baseW = totalW + padX * 2
  const baseH = totalH + padY * 2

  // 根据当前 zoom 与 pan 计算响应式动态 viewBox（零惯性 1:1 坐标映射）
  const curW = baseW / zoom
  const curH = baseH / zoom
  const curMinX = -(curW / 2) - pan.x
  const curMinY = -(curH / 2) - pan.y
  const viewBox = `${curMinX} ${curMinY} ${curW} ${curH}`

  const pathData = useMemo(() => generateSaeFlangePath({ ...params, offsetX: 0, offsetY: 0 }), [params])

  // 4 个螺栓孔中心
  const boltCenters = [
    { x: dx, y: -dy },
    { x: -dx, y: -dy },
    { x: -dx, y: dy },
    { x: dx, y: dy }
  ]

  // 尺寸标注双层阶梯偏移线（充足间隙，杜绝与轮廓重叠）
  const xRight1 = totalW / 2 + 8.5
  const xRight2 = totalW / 2 + 19
  const yBot1 = totalH / 2 + 8
  const yBot2 = totalH / 2 + 18.5
  // 中心通孔（使用对应法兰标准的真实通径 DN 或按长短孔距自适应，杜绝与螺孔碰撞）
  const currentStd = getSaeStandard(params.standardKey)
  const nominalBoreDia = currentStd?.portDia ?? Math.min(params.a, params.b) * 0.7
  const boreR = Math.max(3, nominalBoreDia / 2)

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

  // 零惯性精准平移事件（直接 1:1 像素映射，不产生任何滑行或浮动惯性）
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    setIsDragging(true)
    const startClientX = e.clientX
    const startClientY = e.clientY
    const startPanX = pan.x
    const startPanY = pan.y
    const el = previewRef.current
    const elW = el?.clientWidth || 360
    const elH = el?.clientHeight || 220
    const sX = curW / elW
    const sY = curH / elH

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
    <div
      ref={previewRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleReset}
      className={cn(
        'relative flex min-h-56 h-64 flex-1 w-full select-none items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-background text-foreground',
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      )}
    >
      {/* 主 CAD 图形（底色、墨线、字体与标注风格与主区域 CavityPreview 保持一致） */}
      <svg
        viewBox={viewBox}
        className="size-full overflow-visible p-2 text-foreground pointer-events-none"
      >
        <defs>
          <marker
            id="cadArrow"
            viewBox="0 0 6 6"
            refX="3"
            refY="3"
            markerWidth="3.6"
            markerHeight="3.6"
            orient="auto"
          >
            <path d="M 0 1.5 L 6 3 L 0 4.5 z" className="fill-foreground/80" />
          </marker>
          <marker id="cadDot" viewBox="0 0 4 4" refX="2" refY="2" markerWidth="3" markerHeight="3">
            <circle cx="2" cy="2" r="1.4" className="fill-foreground/80" />
          </marker>
        </defs>

        {/* 原点中心十字线（对齐主区域 FaceView: 紧凑清晰，不穿透尺寸文字） */}
        <g className="stroke-muted-foreground/60" strokeWidth="0.5" strokeLinecap="round">
          <line x1="-5" y1="0" x2="5" y2="0" />
          <line x1="0" y1="-5" x2="0" y2="5" />
          <circle cx="0" cy="0" r="0.75" className="fill-muted-foreground/80 stroke-none" />
        </g>

        {/* 法兰外轮廓（对齐主区域 FaceView: 前景墨线 + 3% 淡填充） */}
        <path
          d={pathData}
          className="fill-foreground/[0.03] stroke-foreground"
          strokeWidth="1.0"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* 中心工作油口/通孔 (Central Bore: 对齐主区域 FaceView 子孔实线与浅墨底色) */}
        <circle
          cx="0"
          cy="0"
          r={boreR}
          className="fill-foreground/[0.05] stroke-foreground"
          strokeWidth="0.8"
        />
        <g className="stroke-muted-foreground/50" strokeWidth="0.35" strokeLinecap="round">
          <line x1={-boreR * 0.35} y1="0" x2={boreR * 0.35} y2="0" />
          <line x1="0" y1={-boreR * 0.35} x2="0" y2={boreR * 0.35} />
        </g>

        {/* 4 个螺栓孔与十字中心（对齐主区域 FaceView 子孔风格） */}
        {boltCenters.map((bc, idx) => (
          <g key={idx}>
            <circle
              cx={bc.x}
              cy={bc.y}
              r={boltR}
              className="fill-foreground/[0.05] stroke-foreground"
              strokeWidth="0.8"
            />
            <line
              x1={bc.x - boltR - 0.8}
              y1={bc.y}
              x2={bc.x + boltR + 0.8}
              y2={bc.y}
              className="stroke-muted-foreground/50"
              strokeWidth="0.35"
              strokeLinecap="round"
            />
            <line
              x1={bc.x}
              y1={bc.y - boltR - 0.8}
              x2={bc.x}
              y2={bc.y + boltR + 0.8}
              className="stroke-muted-foreground/50"
              strokeWidth="0.35"
              strokeLinecap="round"
            />
          </g>
        ))}

        {/* 螺栓孔距点划矩形框 */}
        <rect
          x={-dx}
          y={-dy}
          width={dx * 2}
          height={dy * 2}
          fill="none"
          className="stroke-muted-foreground/40"
          strokeWidth="0.35"
          strokeDasharray="2.5,1.5"
        />

        {/* --- CAD 尺寸标注：双层标注与文字底衬气泡（对齐主区域 Dimension.tsx） --- */}
        {!isHoriz ? (
          <>
            {/* --- 垂直标准方向 --- */}
            {/* 1. 右侧内层：长孔距 b (真实值 b=params.a) */}
            <g>
              <line x1={dx + r + 1.2} y1={-dy} x2={xRight1 + 2.5} y2={-dy} className="stroke-muted-foreground/60" strokeWidth="0.45" />
              <line x1={dx + r + 1.2} y1={dy} x2={xRight1 + 2.5} y2={dy} className="stroke-muted-foreground/60" strokeWidth="0.45" />
              <line
                x1={xRight1}
                y1={-dy}
                x2={xRight1}
                y2={dy}
                className="stroke-foreground/80"
                strokeWidth="0.55"
                markerStart="url(#cadArrow)"
                markerEnd="url(#cadArrow)"
              />
              <rect x={xRight1 + 0.8} y="-6" width="3.2" height="12" className="fill-background" />
              <text
                x={xRight1 + 2.4}
                y="0"
                transform={`rotate(-90, ${xRight1 + 2.4}, 0)`}
                className="fill-foreground font-sans text-[2.7px] font-medium"
                textAnchor="middle"
                dominantBaseline="central"
              >
                b={bPitchVal}
              </text>
            </g>

            {/* 2. 右侧最外层：总高 B (真实值 B=a1+2R，标注到最外轮廓) */}
            <g>
              <line x1={dx + 1.2} y1={-bHeightVal / 2} x2={xRight2 + 2.5} y2={-bHeightVal / 2} className="stroke-muted-foreground/60" strokeWidth="0.45" />
              <line x1={dx + 1.2} y1={bHeightVal / 2} x2={xRight2 + 2.5} y2={bHeightVal / 2} className="stroke-muted-foreground/60" strokeWidth="0.45" />
              <line
                x1={xRight2}
                y1={-bHeightVal / 2}
                x2={xRight2}
                y2={bHeightVal / 2}
                className="stroke-foreground/80"
                strokeWidth="0.55"
                markerStart="url(#cadArrow)"
                markerEnd="url(#cadArrow)"
              />
              <rect x={xRight2 + 0.8} y="-6.5" width="3.2" height="13" className="fill-background" />
              <text
                x={xRight2 + 2.4}
                y="0"
                transform={`rotate(-90, ${xRight2 + 2.4}, 0)`}
                className="fill-foreground font-sans text-[2.7px] font-medium"
                textAnchor="middle"
                dominantBaseline="central"
              >
                B={bHeightVal}
              </text>
            </g>

            {/* 3. 底部内层：短孔距 a (真实值 a=params.b) */}
            <g>
              <line x1={-dx} y1={dy + r + 1.2} x2={-dx} y2={yBot1 + 2.5} className="stroke-muted-foreground/60" strokeWidth="0.45" />
              <line x1={dx} y1={dy + r + 1.2} x2={dx} y2={yBot1 + 2.5} className="stroke-muted-foreground/60" strokeWidth="0.45" />
              <line
                x1={-dx}
                y1={yBot1}
                x2={dx}
                y2={yBot1}
                className="stroke-foreground/80"
                strokeWidth="0.55"
                markerStart="url(#cadArrow)"
                markerEnd="url(#cadArrow)"
              />
              <rect x="-7.5" y={yBot1 - 3.2} width="15" height="3.2" className="fill-background" rx="0.5" />
              <text
                x="0"
                y={yBot1 - 1.6}
                className="fill-foreground font-sans text-[2.7px] font-medium"
                textAnchor="middle"
              >
                a={aPitchVal}
              </text>
            </g>

            {/* 4. 底部最外层：外凸总宽 A (真实值 A=waistWidth，标注到侧翼最外轮廓) */}
            <g>
              <line x1={-aWidthVal / 2} y1={0} x2={-aWidthVal / 2} y2={yBot2 + 2.5} className="stroke-muted-foreground/60" strokeWidth="0.45" strokeDasharray="1.5,1.5" />
              <line x1={aWidthVal / 2} y1={0} x2={aWidthVal / 2} y2={yBot2 + 2.5} className="stroke-muted-foreground/60" strokeWidth="0.45" strokeDasharray="1.5,1.5" />
              <line
                x1={-aWidthVal / 2}
                y1={yBot2}
                x2={aWidthVal / 2}
                y2={yBot2}
                className="stroke-foreground/80"
                strokeWidth="0.55"
                markerStart="url(#cadArrow)"
                markerEnd="url(#cadArrow)"
              />
              <rect x="-8" y={yBot2 + 2.0} width="16" height="3.2" className="fill-background" rx="0.5" />
              <text
                x="0"
                y={yBot2 + 3.6}
                className="fill-foreground font-sans text-[2.7px] font-medium"
                textAnchor="middle"
              >
                A={aWidthVal}
              </text>
            </g>
          </>
        ) : (
          <>
            {/* --- 水平旋转 90° 方向 --- */}
            {/* 1. 底部内层：长孔距 b (真实值 b=params.a) */}
            <g>
              <line x1={-dx} y1={dy + r + 1.2} x2={-dx} y2={yBot1 + 2.5} className="stroke-muted-foreground/60" strokeWidth="0.45" />
              <line x1={dx} y1={dy + r + 1.2} x2={dx} y2={yBot1 + 2.5} className="stroke-muted-foreground/60" strokeWidth="0.45" />
              <line
                x1={-dx}
                y1={yBot1}
                x2={dx}
                y2={yBot1}
                className="stroke-foreground/80"
                strokeWidth="0.55"
                markerStart="url(#cadArrow)"
                markerEnd="url(#cadArrow)"
              />
              <rect x="-7.5" y={yBot1 - 3.2} width="15" height="3.2" className="fill-background" rx="0.5" />
              <text
                x="0"
                y={yBot1 - 1.6}
                className="fill-foreground font-sans text-[2.7px] font-medium"
                textAnchor="middle"
              >
                b={bPitchVal}
              </text>
            </g>

            {/* 2. 底部最外层：总高 B (真实值 B=a1+2R，标注到凸耳最外轮廓) */}
            <g>
              <line x1={-bHeightVal / 2} y1={dy + 1.2} x2={-bHeightVal / 2} y2={yBot2 + 2.5} className="stroke-muted-foreground/60" strokeWidth="0.45" strokeDasharray="1.5,1.5" />
              <line x1={bHeightVal / 2} y1={dy + 1.2} x2={bHeightVal / 2} y2={yBot2 + 2.5} className="stroke-muted-foreground/60" strokeWidth="0.45" strokeDasharray="1.5,1.5" />
              <line
                x1={-bHeightVal / 2}
                y1={yBot2}
                x2={bHeightVal / 2}
                y2={yBot2}
                className="stroke-foreground/80"
                strokeWidth="0.55"
                markerStart="url(#cadArrow)"
                markerEnd="url(#cadArrow)"
              />
              <rect x="-8" y={yBot2 + 2.0} width="16" height="3.2" className="fill-background" rx="0.5" />
              <text
                x="0"
                y={yBot2 + 3.6}
                className="fill-foreground font-sans text-[2.7px] font-medium"
                textAnchor="middle"
              >
                B={bHeightVal}
              </text>
            </g>

            {/* 3. 右侧内层：短孔距 a (真实值 a=params.b) */}
            <g>
              <line x1={dx + r + 1.2} y1={-dy} x2={xRight1 + 2.5} y2={-dy} className="stroke-muted-foreground/60" strokeWidth="0.45" />
              <line x1={dx + r + 1.2} y1={dy} x2={xRight1 + 2.5} y2={dy} className="stroke-muted-foreground/60" strokeWidth="0.45" />
              <line
                x1={xRight1}
                y1={-dy}
                x2={xRight1}
                y2={dy}
                className="stroke-foreground/80"
                strokeWidth="0.55"
                markerStart="url(#cadArrow)"
                markerEnd="url(#cadArrow)"
              />
              <rect x={xRight1 + 0.8} y="-6" width="3.2" height="12" className="fill-background" />
              <text
                x={xRight1 + 2.4}
                y="0"
                transform={`rotate(-90, ${xRight1 + 2.4}, 0)`}
                className="fill-foreground font-sans text-[2.7px] font-medium"
                textAnchor="middle"
                dominantBaseline="central"
              >
                a={aPitchVal}
              </text>
            </g>

            {/* 4. 右侧最外层：外凸总宽 A (真实值 A=waistWidth，标注到侧翼最外轮廓) */}
            <g>
              <line x1={0} y1={-aWidthVal / 2} x2={xRight2 + 2.5} y2={-aWidthVal / 2} className="stroke-muted-foreground/60" strokeWidth="0.45" strokeDasharray="1.5,1.5" />
              <line x1={0} y1={aWidthVal / 2} x2={xRight2 + 2.5} y2={aWidthVal / 2} className="stroke-muted-foreground/60" strokeWidth="0.45" strokeDasharray="1.5,1.5" />
              <line
                x1={xRight2}
                y1={-aWidthVal / 2}
                x2={xRight2}
                y2={aWidthVal / 2}
                className="stroke-foreground/80"
                strokeWidth="0.55"
                markerStart="url(#cadArrow)"
                markerEnd="url(#cadArrow)"
              />
              <rect x={xRight2 + 0.8} y="-6.5" width="3.2" height="13" className="fill-background" />
              <text
                x={xRight2 + 2.4}
                y="0"
                transform={`rotate(-90, ${xRight2 + 2.4}, 0)`}
                className="fill-foreground font-sans text-[2.7px] font-medium"
                textAnchor="middle"
                dominantBaseline="central"
              >
                A={aWidthVal}
              </text>
            </g>
          </>
        )}

        {/* --- CAD 尺寸标注 5：凸耳半径 R (引线标注) --- */}
        <g>
          <line
            x1={dx + r * 0.707}
            y1={-dy - r * 0.707}
            x2={dx + r * 0.707 + 4.5}
            y2={-dy - r * 0.707 - 3.5}
            className="stroke-foreground/80"
            strokeWidth="0.55"
            markerStart="url(#cadArrow)"
          />
          <line
            x1={dx + r * 0.707 + 4.5}
            y1={-dy - r * 0.707 - 3.5}
            x2={dx + r * 0.707 + 12}
            y2={-dy - r * 0.707 - 3.5}
            className="stroke-foreground/80"
            strokeWidth="0.55"
          />
          <rect
            x={dx + r * 0.707 + 12}
            y={-dy - r * 0.707 - 5.1}
            width="8"
            height="3.2"
            className="fill-background"
            rx="0.5"
          />
          <text
            x={dx + r * 0.707 + 12.5}
            y={-dy - r * 0.707 - 3.5}
            className="fill-foreground font-sans text-[2.7px] font-medium"
            dominantBaseline="central"
          >
            R={rVal}
          </text>
        </g>

        {/* --- CAD 尺寸标注 6：螺栓孔径 d (引线标注) --- */}
        <g>
          <line
            x1={-dx}
            y1={-dy}
            x2={-dx - boltR - 3.5}
            y2={-dy - 3.5}
            className="stroke-foreground/80"
            strokeWidth="0.55"
            markerStart="url(#cadDot)"
          />
          <line
            x1={-dx - boltR - 3.5}
            y1={-dy - 3.5}
            x2={-dx - boltR - 10}
            y2={-dy - 3.5}
            className="stroke-foreground/80"
            strokeWidth="0.55"
          />
          <rect
            x={-dx - boltR - 22}
            y={-dy - 5.1}
            width="12"
            height="3.2"
            className="fill-background"
            rx="0.5"
          />
          <text
            x={-dx - boltR - 11}
            y={-dy - 3.5}
            className="fill-foreground font-sans text-[2.7px] font-medium"
            textAnchor="end"
            dominantBaseline="central"
          >
            d=Ø{params.boltDia}
          </text>
        </g>
      </svg>

      {/* 左上角提示与单位角标（对齐主区域 CavityPreview 风格） */}
      <div className="pointer-events-none absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-md border border-border/40 bg-background/85 px-2 py-0.5 text-[10px] text-muted-foreground shadow-xs backdrop-blur z-10">
        <span>SAE J518</span>
        <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] font-bold tracking-wider text-foreground/85 uppercase">
          {params.rotation}°
        </span>
      </div>

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

      {/* 缩放交互工具栏（对齐主区域紧凑风格） */}
      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1 rounded-md border border-border/40 bg-background/85 px-1.5 py-0.5 text-xs text-muted-foreground shadow-xs backdrop-blur z-10">
        <button
          type="button"
          title={_t("缩小 (亦可向下滚轮)")}
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
          title={_t("放大 (亦可向上滚轮)")}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          onClick={handleZoomIn}
        >
          <Plus className="size-3" />
        </button>
      </div>

      {/* 底部右侧操作提示 */}
      <div className="pointer-events-none absolute bottom-2.5 right-2.5 text-[10px] text-muted-foreground">
        {_t("滚轮缩放 · 拖拽平移")}</div>
    </div>
  )
}

export function SaeFlangePopover({
  open = true,
  triggerRef,
  params,
  unit = 'mm',
  disabled,
  onChange,
  onClose
}: SaeFlangePopoverProps) {
  _useLocale()
  const currentStd = getSaeStandard(params.standardKey)

  const handleStandardSelect = (key: string) => {
    if (disabled) return
    if (key === 'custom') {
      onChange({ ...params, standardKey: 'custom' })
      return
    }
    const std = getSaeStandard(key)
    if (!std) return
    onChange({
      ...params,
      standardKey: std.key,
      a: std.a,
      b: std.b,
      earRadius: std.earRadius,
      waistWidth: std.waistWidth,
      boltDia: std.boltDia
    })
  }

  const handleNumChange = (field: keyof SaeFlangeParams, valStr: string) => {
    if (disabled) return
    const num = parseFloat(valStr)
    if (!Number.isFinite(num)) return
    if (field !== 'offsetX' && field !== 'offsetY' && num < 0) return
    onChange({
      ...params,
      [field]: num,
      standardKey: 'custom' // 动了参数后自动标记为自定义
    })
  }

  const toggleRotation = () => {
    if (disabled) return
    onChange({
      ...params,
      rotation: params.rotation === 0 ? 90 : 0
    })
  }

  return (
    <FloatingPopover
      open={open}
      triggerRef={triggerRef}
      onClose={onClose}
      title={_t("SAE 法兰轮廓驱动配置")}
      headerBadge={
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          ISO 6162
        </span>
      }
      headerExtra={
        <button
          type="button"
          disabled={disabled}
          title={_t("切换法兰安装旋转角 (0°/90°)")}
          className="flex h-6 items-center gap-1 rounded border border-border/80 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
          onClick={toggleRotation}
        >
          <RotateCw className="size-3" />
          <span>{params.rotation}{_t("° 旋转")}</span>
        </button>
      }
      defaultWidth={430}
      minWidth={360}
      minHeight={320}
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {currentStd ? `${currentStd.label} · ${currentStd.pressure}` : _t("自定义法兰尺寸")}
          </span>
          {onClose && (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
              onClick={onClose}
            >
              <Check className="size-3.5" />
              <span>{_t("完成")}</span>
            </button>
          )}
        </div>
      }
    >

      {/* CAD 图形预览 */}
      <FlangeCadPreview params={params} />

      {/* 标准规格选择器 */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted-foreground">{_t("标准法兰预设")}</label>
        <select
          value={params.standardKey}
          disabled={disabled}
          className="h-7 w-full appearance-none rounded-md border border-input bg-background px-2 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(e) => handleStandardSelect(e.target.value)}
        >
          <optgroup label="SAE J518 Code 61 (3000 PSI / ISO 6162-1)">
            {SAE_FLANGE_STANDARDS.filter((s) => s.code === 'Code 61').map((s) => (
              <option key={s.key} value={s.key}>
                {_t(s.label)}
              </option>
            ))}
          </optgroup>
          <optgroup label="SAE J518 Code 62 (6000 PSI / ISO 6162-2)">
            {SAE_FLANGE_STANDARDS.filter((s) => s.code === 'Code 62').map((s) => (
              <option key={s.key} value={s.key}>
                {_t(s.label)}
              </option>
            ))}
          </optgroup>
          <option value="custom">{_t("-- 自定义规格 (Custom) --")}</option>
        </select>
      </div>

      {/* 驱动尺寸数值表单（网格） */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {/* 短向孔距 a */}
        <div className="grid grid-cols-[75px_1fr] items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1">
          <span className="text-[11px] font-medium text-muted-foreground">{_t("短孔距 a")}</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.1"
              value={params.b}
              disabled={disabled}
              className="h-6 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground font-mono transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(e) => handleNumChange('b', e.target.value)}
            />
            <span className="text-[10px] text-muted-foreground">{unit}</span>
          </div>
        </div>

        {/* 长向孔距 b */}
        <div className="grid grid-cols-[75px_1fr] items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1">
          <span className="text-[11px] font-medium text-muted-foreground">{_t("长孔距 b")}</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.1"
              value={params.a}
              disabled={disabled}
              className="h-6 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground font-mono transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(e) => handleNumChange('a', e.target.value)}
            />
            <span className="text-[10px] text-muted-foreground">{unit}</span>
          </div>
        </div>

        {/* 外凸总宽 A */}
        <div className="grid grid-cols-[75px_1fr] items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1">
          <span className="text-[11px] font-medium text-muted-foreground">{_t("外凸总宽 A")}</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.1"
              value={params.waistWidth}
              disabled={disabled}
              className="h-6 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground font-mono transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(e) => handleNumChange('waistWidth', e.target.value)}
            />
            <span className="text-[10px] text-muted-foreground">{unit}</span>
          </div>
        </div>

        {/* 总高 B (计算展示) */}
        <div className="grid grid-cols-[75px_1fr] items-center gap-1.5 rounded-md border border-border/60 bg-muted/10 px-2 py-1">
          <span className="text-[11px] font-medium text-muted-foreground">{_t("总高 B")}</span>
          <div className="flex items-center justify-between px-1.5">
            <span className="font-mono text-xs text-foreground font-semibold">
              {(params.a + 2 * params.earRadius).toFixed(1)}
            </span>
            <span className="text-[10px] text-muted-foreground">{unit}</span>
          </div>
        </div>

        {/* 凸耳半径 R */}
        <div className="grid grid-cols-[75px_1fr] items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1">
          <span className="text-[11px] font-medium text-muted-foreground">{_t("凸耳半径 R")}</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.1"
              value={params.earRadius}
              disabled={disabled}
              className="h-6 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground font-mono transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(e) => handleNumChange('earRadius', e.target.value)}
            />
            <span className="text-[10px] text-muted-foreground">{unit}</span>
          </div>
        </div>

        {/* 螺栓孔径 d */}
        <div className="grid grid-cols-[75px_1fr] items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1">
          <span className="text-[11px] font-medium text-muted-foreground">{_t("螺栓孔径 d")}</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.5"
              value={params.boltDia}
              disabled={disabled}
              className="h-6 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground font-mono transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(e) => handleNumChange('boltDia', e.target.value)}
            />
            <span className="text-[10px] text-muted-foreground">{unit}</span>
          </div>
        </div>

        {/* 偏移 X */}
        <div className="grid grid-cols-[75px_1fr] items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1">
          <span className="text-[11px] font-medium text-muted-foreground">{_t("中心偏移 X")}</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.5"
              value={params.offsetX}
              disabled={disabled}
              className="h-6 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground font-mono transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(e) => handleNumChange('offsetX', e.target.value)}
            />
            <span className="text-[10px] text-muted-foreground">{unit}</span>
          </div>
        </div>

        {/* 偏移 Y */}
        <div className="grid grid-cols-[75px_1fr] items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1">
          <span className="text-[11px] font-medium text-muted-foreground">{_t("中心偏移 Y")}</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.5"
              value={params.offsetY}
              disabled={disabled}
              className="h-6 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground font-mono transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(e) => handleNumChange('offsetY', e.target.value)}
            />
            <span className="text-[10px] text-muted-foreground">{unit}</span>
          </div>
        </div>
      </div>
    </FloatingPopover>
  )
}
