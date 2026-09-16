import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useMemo } from 'react'
import type { CavityTemplate } from '@shared/cavity/types'
import { buildSection, type SectionModel } from '../../../library/view/preview/sectionProfile'
import { cavityFillPathD, cavityWallPathD } from '../../../library/view/preview/konva/SectionView'
import { TYPE_REGISTRY } from '@shared/cavity/cavityTypeRegistry'
import { polarToCartesian } from '@shared/cavity/geometry'
import { cn } from '@renderer/lib/utils'

interface Cavity2DPreviewProps {
  template: CavityTemplate
  className?: string
  /** 紧凑缩略图模式（用于卡片列表），隐藏复杂标注 */
  compact?: boolean
  /** 当前选中的台阶索引 */
  activeStepIndex?: number | null
  /** 选中台阶回调 */
  onSelectStep?: (index: number) => void
  /** 当前选中的侧油口索引 */
  activePortIndex?: number | null
  /** 选中侧油口回调 */
  onSelectPort?: (index: number) => void
}

export const Cavity2DPreview: React.FC<Cavity2DPreviewProps> = ({
  template,
  className,
  compact = false,
  activeStepIndex,
  onSelectStep,
  activePortIndex,
  onSelectPort
}) => {
  _useLocale()
  const isCombo = TYPE_REGISTRY[template.cavityType]?.isCombo ?? false

  // 单孔剖面模型
  const section: SectionModel | null = useMemo(() => {
    if (isCombo || !template.geometry) return null
    return buildSection(template.geometry)
  }, [template, isCombo])

  // 计算单孔 SVG 包围盒与坐标系
  const sectionBounds = useMemo(() => {
    if (!section || section.bands.length === 0) return null

    const maxR = Math.max(section.maxRadius || 5, 5)
    const totalD = Math.max(section.totalDepth || 10, 10)
    const hasPorts = (section.ports ?? []).length > 0
    const baseDim = Math.max(totalD, maxR * 2)

    // 预留左侧尺寸线与右侧侧油口引出标注边距（根据特征尺寸自适应）
    const padLeft = compact ? maxR * 0.35 : Math.max(maxR * 0.8 + 10, baseDim * 0.22)
    const padRight = compact
      ? maxR * 0.35
      : hasPorts
        ? Math.max(maxR * 1.2 + 16, baseDim * 0.32)
        : Math.max(maxR * 0.6 + 8, baseDim * 0.18)
    const padTop = compact ? Math.max(3, maxR * 0.2) : Math.max(8, baseDim * 0.12)
    const padBottom = compact ? Math.max(3, maxR * 0.2) : Math.max(8, baseDim * 0.12)

    const minX = -maxR - padLeft
    const maxX = maxR + padRight
    const minY = -padTop
    const maxY = totalD + padBottom

    const width = maxX - minX
    const height = maxY - minY
    const dashScale = Math.max(Math.max(width, height) / 75, 0.4)
    const dimScale = Math.max(baseDim / 50, 0.5)

    return { minX, minY, width, height, maxR, totalD, padLeft, padTop, dashScale, dimScale }
  }, [section, compact])

  // 组合孔包围盒计算与极坐标解析
  const comboBounds = useMemo(() => {
    if (!isCombo || !template.holes) return null
    const holes = template.holes
    const isPolar = Boolean(template.geometry?.layout?.polar)
    const outlinePath = template.geometry?.outline?.data?.trim() || ''

    if (holes.length === 0 && !outlinePath) {
      return {
        minX: -25,
        minY: -25,
        width: 50,
        height: 50,
        holes: [],
        outlinePath: '',
        isPolar: false,
        pitchRadii: [],
        dashScale: 1,
        crossSize: 6
      }
    }

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    // 收集所有唯一的极半径（用于绘制 PCD 分度圆）
    const pitchRadiiSet = new Set<number>()

    const holeItems = holes.map((h, idx) => {
      // 提取子孔最大直径
      const rawDia = h.geometry?.steps?.length
        ? Math.max(0, ...h.geometry.steps.map((s) => Number(s.diameter) || 0))
        : 8
      const maxDia = rawDia > 0 ? rawDia : 8
      const r = maxDia / 2

      let cx = 0
      let cy = 0
      const rawX = Number(h.x) || 0
      const rawY = Number(h.y) || 0

      if (isPolar) {
        // 极坐标：x = 极径 r(mm)，y = 极角 θ(°，0° = +X，逆时针 CCW)
        const c = polarToCartesian(rawX, rawY)
        cx = c.cx
        cy = -c.cy // CAD Y 向上转 SVG Y 向下
        if (rawX > 0.5) {
          pitchRadiiSet.add(Math.round(rawX * 100) / 100)
        }
      } else {
        // 笛卡尔坐标：x/y
        cx = rawX
        cy = -rawY // CAD Y 向上转 SVG Y 向下
      }

      minX = Math.min(minX, cx - r)
      maxX = Math.max(maxX, cx + r)
      minY = Math.min(minY, cy - r)
      maxY = Math.max(maxY, cy + r)

      return {
        id: idx,
        name: h.name || `H${idx + 1}`,
        cx,
        cy,
        r,
        type: h.cavityType,
        rawX,
        rawY
      }
    })

    // 纳入 outline 包围盒极值
    if (outlinePath) {
      const nums = outlinePath.match(/-?\d+(?:\.\d+)?/g)
      if (nums) {
        const vals = nums.map(Number)
        for (let i = 0; i + 1 < vals.length; i += 2) {
          const vx = vals[i]
          const vy = vals[i + 1]
          if (Number.isFinite(vx) && Number.isFinite(vy)) {
            minX = Math.min(minX, vx)
            maxX = Math.max(maxX, vx)
            minY = Math.min(minY, vy)
            maxY = Math.max(maxY, vy)
          }
        }
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      minX = -20
      maxX = 20
      minY = -20
      maxY = 20
    }

    // 确保原点始终包含在视口中
    minX = Math.min(minX, -2)
    maxX = Math.max(maxX, 2)
    minY = Math.min(minY, -2)
    maxY = Math.max(maxY, 2)

    const rawW = maxX - minX
    const rawH = maxY - minY
    const baseDim = Math.max(rawW, rawH, 15)

    const pad = compact ? Math.max(baseDim * 0.1, 4) : Math.max(baseDim * 0.18, 10)
    const width = rawW + pad * 2
    const height = rawH + pad * 2
    const midX = (minX + maxX) / 2
    const midY = (minY + maxY) / 2

    const finalMinX = midX - width / 2
    const finalMinY = midY - height / 2

    const dashScale = Math.max(Math.max(width, height) / 80, 0.4)
    const crossSize = Math.max(Math.min(width, height) * 0.08, 3)

    return {
      minX: finalMinX,
      minY: finalMinY,
      width,
      height,
      holes: holeItems,
      outlinePath,
      isPolar,
      pitchRadii: Array.from(pitchRadiiSet).sort((a, b) => a - b),
      dashScale,
      crossSize
    }
  }, [isCombo, template, compact])

  // ═════════════════════════════════════════════════════════════════════════
  // 渲染单孔剖面 (Section View)
  // ═════════════════════════════════════════════════════════════════════════
  if (!isCombo && section && sectionBounds) {
    const { minX, minY, width, height, maxR, totalD, padLeft, padTop, dashScale, dimScale } =
      sectionBounds
    const fillPath = cavityFillPathD(section)
    const wallPath = cavityWallPathD(section)
    const topStep = section.bands[0]
    const topDia = topStep?.diameter || maxR * 2
    const dimFontSize = Math.max(dimScale * 4, 2.5)

    return (
      <div className={cn('relative flex h-full w-full items-center justify-center select-none', className)}>
        <svg
          viewBox={`${minX} ${minY} ${width} ${height}`}
          className="h-full w-full overflow-visible [&_line]:[vector-effect:non-scaling-stroke] [&_path]:[vector-effect:non-scaling-stroke] [&_circle]:[vector-effect:non-scaling-stroke] [&_rect]:[vector-effect:non-scaling-stroke]"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* 背景微网格（非紧凑模式） */}
          {!compact && (
            <defs>
              <pattern id="grid-pattern" width="10" height="10" patternUnits="userSpaceOnUse">
                <path
                  d="M 10 0 L 0 0 0 10"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.04"
                  strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                />
              </pattern>
            </defs>
          )}

          {/* 1. 内孔半透明浅灰色剖面填充 */}
          {fillPath && (
            <path
              d={fillPath}
              className="fill-foreground/[0.08]"
              stroke="none"
            />
          )}

          {/* 1.1 台阶高亮与点击热区 */}
          {section.bands.map((b) => {
            const isSelected = activeStepIndex === b.index
            const bLen = b.length ?? 0
            const pts = `${-b.r0},${b.z0} ${b.r0},${b.z0} ${b.r1},${b.z0 + bLen} ${-b.r1},${b.z0 + bLen}`
            return (
              <polygon
                key={`band-hit-${b.index}`}
                points={pts}
                onClick={() => onSelectStep?.(b.index)}
                className={cn(
                  "transition-colors",
                  onSelectStep && "cursor-pointer",
                  isSelected
                    ? "fill-primary/25 stroke-primary stroke-[1.5]"
                    : "fill-transparent hover:fill-primary/10"
                )}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}

          {/* 2. 螺纹段双线与牙底示意 */}
          {section.bands.map((b) => {
            if (!b.hasThread) return null
            const threadOffset = Math.min(Math.max(b.diameter * 0.08, 0.6), 1.8)
            const effDepth = b.effLength
            return (
              <g key={`th-${b.index}`} className="opacity-75 pointer-events-none">
                {/* 螺纹大径细实线 */}
                <line
                  x1={-b.r0 - threadOffset}
                  y1={b.z0}
                  x2={-b.r0 - threadOffset}
                  y2={b.z0 + effDepth}
                  stroke="currentColor"
                  strokeWidth="0.8"
                  strokeOpacity="0.6"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={b.r0 + threadOffset}
                  y1={b.z0}
                  x2={b.r0 + threadOffset}
                  y2={b.z0 + effDepth}
                  stroke="currentColor"
                  strokeWidth="0.8"
                  strokeOpacity="0.6"
                  vectorEffect="non-scaling-stroke"
                />
                {/* 螺纹终止线 */}
                <line
                  x1={-b.r0}
                  y1={b.z0 + effDepth}
                  x2={-b.r0 - threadOffset}
                  y2={b.z0 + effDepth}
                  stroke="currentColor"
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={b.r0}
                  y1={b.z0 + effDepth}
                  x2={b.r0 + threadOffset}
                  y2={b.z0 + effDepth}
                  stroke="currentColor"
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })}

          {/* 3. 完整孔壁实线轮廓 */}
          {wallPath && (
            <path
              d={wallPath}
              fill="none"
              stroke="currentColor"
              strokeWidth={compact ? '1.2' : '1.5'}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="text-foreground pointer-events-none"
            />
          )}

          {/* 4. 台阶间水平过渡交线（直段与锥段衔接） */}
          {section.bands.map((b, i) => {
            if (i === 0) return null
            const prev = section.bands[i - 1]
            if (prev.r1 !== b.r0 || b.type === 'tapered' || prev.type === 'tapered') {
              return (
                <line
                  key={`step-line-${i}`}
                  x1={-Math.max(b.r0, prev.r1)}
                  y1={b.z0}
                  x2={Math.max(b.r0, prev.r1)}
                  y2={b.z0}
                  stroke="currentColor"
                  strokeWidth="0.8"
                  strokeOpacity="0.5"
                  vectorEffect="non-scaling-stroke"
                  className="pointer-events-none"
                />
              )
            }
            return null
          })}

          {/* 5. 侧油口流道（Ports） */}
          {(section.ports ?? []).map((port, pIdx) => {
            const pDia = port.diameter || 6
            const pR = pDia / 2
            const isBottom = Boolean(port.isBottomPort)
            const yCenter = port.depth
            const yTop = yCenter - pR
            const xOut = maxR * 1.4 + (compact ? 3 : 10)
            const isPortSelected = activePortIndex === pIdx

            return (
              <g
                key={`port-${pIdx}`}
                onClick={() => onSelectPort?.(pIdx)}
                className={cn(onSelectPort && "cursor-pointer group")}
              >
                {/* 流道水力天蓝填充 */}
                <rect
                  x={isBottom ? -maxR * 0.8 : 0}
                  y={yTop}
                  width={isBottom ? maxR * 0.8 + xOut : xOut}
                  height={pDia}
                  fill={isPortSelected ? "rgb(14 165 233 / 0.45)" : "rgb(14 165 233 / 0.2)"}
                  stroke={isPortSelected ? "#0369a1" : "#0284c7"}
                  strokeWidth={isPortSelected ? "2" : "1"}
                  vectorEffect="non-scaling-stroke"
                  className="transition-colors group-hover:fill-sky-400/30"
                />
                {/* 侧油口中心点划线 */}
                <line
                  x1={-2}
                  y1={yCenter}
                  x2={xOut + 4}
                  y2={yCenter}
                  stroke="#0284c7"
                  strokeWidth="0.8"
                  strokeDasharray={`${3 * dashScale} ${1 * dashScale} ${0.8 * dashScale} ${1 * dashScale}`}
                  vectorEffect="non-scaling-stroke"
                />
                {/* 侧油口文字标签 */}
                {!compact && (
                  <text
                    x={xOut + dimScale * 3}
                    y={yCenter}
                    fontSize={dimFontSize}
                    dominantBaseline="central"
                    fill={isPortSelected ? "#0369a1" : "#0284c7"}
                    fontWeight="bold"
                    className="font-mono select-none"
                  >
                    P{pIdx + 1} Ø{pDia}
                  </text>
                )}
              </g>
            )
          })}

          {/* 6. 安装面基准虚线 (Z = 0) */}
          <line
            x1={-maxR * 1.3 - dimScale * 4}
            y1={0}
            x2={maxR * 1.3 + dimScale * 4}
            y2={0}
            stroke="currentColor"
            strokeWidth="0.8"
            strokeDasharray={`${4 * dashScale} ${2 * dashScale}`}
            strokeOpacity="0.4"
            vectorEffect="non-scaling-stroke"
          />

          {/* 7. 孔中心轴线（点划线） */}
          <line
            x1={0}
            y1={-dimScale * 4}
            x2={0}
            y2={totalD + dimScale * 5}
            stroke="currentColor"
            strokeWidth="0.8"
            strokeDasharray={`${5 * dashScale} ${1.5 * dashScale} ${1 * dashScale} ${1.5 * dashScale}`}
            strokeOpacity="0.4"
            vectorEffect="non-scaling-stroke"
          />

          {/* 8. 关键 CAD 尺寸标注（仅非紧凑模式呈现） */}
          {!compact && (
            <g className="text-muted-foreground select-none" fontSize={dimFontSize}>
              {/* 入口口径 Ø */}
              {(() => {
                const topY = -padTop * 0.45
                const tickH = Math.max(dimScale * 2.5, 1.5)
                return (
                  <g transform={`translate(0, ${topY})`}>
                    <line
                      x1={-topStep.r0}
                      y1={0}
                      x2={topStep.r0}
                      y2={0}
                      stroke="currentColor"
                      strokeWidth="0.8"
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={-topStep.r0}
                      y1={-tickH}
                      x2={-topStep.r0}
                      y2={tickH}
                      stroke="currentColor"
                      strokeWidth="0.8"
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={topStep.r0}
                      y1={-tickH}
                      x2={topStep.r0}
                      y2={tickH}
                      stroke="currentColor"
                      strokeWidth="0.8"
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={0}
                      y={-tickH - dimScale * 0.6}
                      textAnchor="middle"
                      fill="currentColor"
                      className="font-mono"
                    >
                      Ø{topDia.toFixed(1).replace(/\.0$/, '')}
                    </text>
                  </g>
                )
              })()}

              {/* 总深度 L */}
              {(() => {
                const leftX = -maxR - padLeft * 0.45
                const tickW = Math.max(dimScale * 2.5, 1.5)
                return (
                  <g transform={`translate(${leftX}, 0)`}>
                    <line
                      x1={0}
                      y1={0}
                      x2={0}
                      y2={totalD}
                      stroke="currentColor"
                      strokeWidth="0.8"
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={-tickW}
                      y1={0}
                      x2={tickW}
                      y2={0}
                      stroke="currentColor"
                      strokeWidth="0.8"
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={-tickW}
                      y1={totalD}
                      x2={tickW}
                      y2={totalD}
                      stroke="currentColor"
                      strokeWidth="0.8"
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={-tickW - dimScale * 0.8}
                      y={totalD / 2}
                      textAnchor="end"
                      dominantBaseline="central"
                      fill="currentColor"
                      className="font-mono"
                    >
                      L{totalD.toFixed(1).replace(/\.0$/, '')}
                    </text>
                  </g>
                )
              })()}
            </g>
          )}
        </svg>
      </div>
    )
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 渲染组合孔安装面 (Face View)
  // ═════════════════════════════════════════════════════════════════════════
  if (isCombo && comboBounds) {
    const {
      minX,
      minY,
      width,
      height,
      holes,
      outlinePath,
      isPolar,
      pitchRadii,
      dashScale,
      crossSize
    } = comboBounds

    return (
      <div className={cn('relative flex h-full w-full items-center justify-center select-none', className)}>
        <svg
          viewBox={`${minX} ${minY} ${width} ${height}`}
          className="h-full w-full overflow-visible [&_line]:[vector-effect:non-scaling-stroke] [&_path]:[vector-effect:non-scaling-stroke] [&_circle]:[vector-effect:non-scaling-stroke] [&_rect]:[vector-effect:non-scaling-stroke]"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* 安装面底板轮廓（如有） */}
          {outlinePath && (
            <path
              d={outlinePath}
              fill="currentColor"
              fillOpacity="0.04"
              stroke="currentColor"
              strokeWidth={compact ? '1.2' : '1.5'}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="text-foreground"
            />
          )}

          {/* 原点十字基准 */}
          <line
            x1={-crossSize}
            y1={0}
            x2={crossSize}
            y2={0}
            stroke="currentColor"
            strokeWidth="0.8"
            strokeOpacity="0.4"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            y1={-crossSize}
            x2={0}
            y2={crossSize}
            stroke="currentColor"
            strokeWidth="0.8"
            strokeOpacity="0.4"
            vectorEffect="non-scaling-stroke"
          />

          {/* 极坐标特有：分度圆（PCD）参考虚线 */}
          {isPolar &&
            pitchRadii.map((pr) => (
              <g key={`pcd-${pr}`}>
                <circle
                  cx={0}
                  cy={0}
                  r={pr}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.8"
                  strokeDasharray={`${3 * dashScale} ${2 * dashScale}`}
                  strokeOpacity="0.35"
                  vectorEffect="non-scaling-stroke"
                />
                {!compact && (
                  <text
                    x={0}
                    y={-pr - dashScale * 1.5}
                    textAnchor="middle"
                    fontSize={Math.max(dashScale * 3.5, 2.5)}
                    fill="currentColor"
                    className="font-mono text-muted-foreground select-none pointer-events-none"
                    opacity="0.65"
                  >
                    PCD Ø{(pr * 2).toFixed(1).replace(/\.0$/, '')}
                  </text>
                )}
              </g>
            ))}

          {/* 极坐标特有：从原点指向各子孔中心的极轴中心射线 */}
          {isPolar &&
            holes.map((h) => {
              const dist = Math.hypot(h.cx, h.cy)
              if (dist < 1) return null
              return (
                <line
                  key={`ray-${h.id}`}
                  x1={0}
                  y1={0}
                  x2={h.cx}
                  y2={h.cy}
                  stroke="currentColor"
                  strokeWidth="0.75"
                  strokeDasharray={`${3 * dashScale} ${1.5 * dashScale} ${0.8 * dashScale} ${1.5 * dashScale}`}
                  strokeOpacity="0.25"
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}

          {/* 各子孔安装圆与中心十字 */}
          {holes.map((h) => {
            const fontPx = Math.min(Math.max(h.r * 0.85, 2.5), 10)
            return (
              <g key={h.id}>
                {/* 子孔孔壁圆 */}
                <circle
                  cx={h.cx}
                  cy={h.cy}
                  r={h.r}
                  className="fill-foreground/[0.08]"
                  stroke="currentColor"
                  strokeWidth={compact ? '1.2' : '1.5'}
                  vectorEffect="non-scaling-stroke"
                />
                {/* 子孔中心十字 */}
                <line
                  x1={h.cx - h.r * 0.65}
                  y1={h.cy}
                  x2={h.cx + h.r * 0.65}
                  y2={h.cy}
                  stroke="currentColor"
                  strokeWidth="0.75"
                  strokeOpacity="0.5"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={h.cx}
                  y1={h.cy - h.r * 0.65}
                  x2={h.cx}
                  y2={h.cy + h.r * 0.65}
                  stroke="currentColor"
                  strokeWidth="0.75"
                  strokeOpacity="0.5"
                  vectorEffect="non-scaling-stroke"
                />
                {/* 子孔名称 */}
                {!compact && (
                  <text
                    x={h.cx}
                    y={h.cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fontPx}
                    fill="currentColor"
                    fontWeight="600"
                    className="font-mono select-none pointer-events-none"
                  >
                    {h.name}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    )
  }

  // 兜底：无几何数据
  return (
    <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground/60 italic">
      {_t("暂无 2D 图形数据")}</div>
  )
}

