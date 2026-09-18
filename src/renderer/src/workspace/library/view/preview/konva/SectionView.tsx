import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { msg as _msg, t as _t } from '@shared/i18n'
/**
 * 剖面图视图（konva，非组合孔）
 *
 * buildSection→半剖面镜像成整对称内孔剖面：
 *  - 内孔两半整形（轮廓线描画 + 极淡填充）；
 *  - 安装面基线与轴线十字恒显；螺纹墙段仅保留壁侧双线增强（可选于后）；
 *  - R2：点击某一台阶 → 该段以两条 CAD 引线尺寸标出「φ 口径」与「自安装面深度」；
 *    点空白 / 未选中不呈现任何标注。
 *
 * 本组件绘制在本预览统一的《mm × scale=k》世界组中：几何用真实 mm；
 * 装饰属性线宽/字号/箭头都按 toMm() 折算，故屏幕恒定（R6）。
 */

import { useState } from 'react'
import { Group, Line, Path } from 'react-konva'
import type { SectionModel } from '../sectionProfile'
import { alpha } from './palette'
import type { CanvasPalette } from './palette'
import { DECOR, toMm, type Viewport } from './viewport'
import { DimStub, TextBubble } from './Dimension'

/** 半剖面右半 svg path（自 y=0 安装面向下，保持导出兼容） */
export function profilePathD(sec: SectionModel): string {
  let d = 'M 0 0'
  for (const b of sec.bands) d += ` L ${b.r0} ${b.z0} L ${b.r1} ${b.z1}`
  d += ` L 0 ${sec.totalDepth} Z`
  return d
}

/** 完整内腔闭合填充路径（左壁下行 → 底端 → 右壁上行 → 顶口闭合） */
export function cavityFillPathD(sec: SectionModel): string {
  const bands = sec.bands
  if (!bands || bands.length === 0) return ''
  const first = bands[0]
  let d = `M ${-first.r0} ${first.z0}`
  // 左壁
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]
    if (i > 0 && b.r0 !== bands[i - 1].r1) {
      d += ` L ${-b.r0} ${b.z0}`
    }
    d += ` L ${-b.r1} ${b.z1}`
  }
  const last = bands[bands.length - 1]
  if (last.r1 > 0) {
    d += ` L ${last.r1} ${last.z1}`
  }
  // 右壁
  for (let i = bands.length - 1; i >= 0; i--) {
    const b = bands[i]
    d += ` L ${b.r1} ${b.z1}`
    d += ` L ${b.r0} ${b.z0}`
    if (i > 0 && b.r0 !== bands[i - 1].r1) {
      d += ` L ${bands[i - 1].r1} ${b.z0}`
    }
  }
  d += ' Z'
  return d
}

/** 完整内腔孔壁轮廓路径（左口沿 → 左壁及斜线 → 孔底 → 右壁及斜线 → 右口沿，顶口开口不闭合） */
export function cavityWallPathD(sec: SectionModel): string {
  const bands = sec.bands
  if (!bands || bands.length === 0) return ''
  const first = bands[0]
  let d = `M ${-first.r0} ${first.z0}`
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]
    if (i > 0 && b.r0 !== bands[i - 1].r1) {
      d += ` L ${-b.r0} ${b.z0}`
    }
    d += ` L ${-b.r1} ${b.z1}`
  }
  const last = bands[bands.length - 1]
  if (last.r1 > 0) {
    d += ` L ${last.r1} ${last.z1}`
  }
  for (let i = bands.length - 1; i >= 0; i--) {
    const b = bands[i]
    d += ` L ${b.r1} ${b.z1}`
    d += ` L ${b.r0} ${b.z0}`
    if (i > 0 && b.r0 !== bands[i - 1].r1) {
      d += ` L ${bands[i - 1].r1} ${b.z0}`
    }
  }
  return d
}

/** 剖面静态图形（整形轮廓 + 锥段交线 + 内腔着色）——被主视图与子孔尺寸面板共用 */
export function SectionFigure({
  sec,
  vp,
  colors,
  lwPx = 1.6
}: {
  sec: SectionModel
  vp: Viewport
  colors: CanvasPalette
  lwPx?: number
}) {
  _useLocale()
  const { k } = vp
  const fillPath = cavityFillPathD(sec)
  const wallPath = cavityWallPathD(sec)
  const lw = toMm(lwPx, k)
  const fill = alpha(colors.ink, 0.08)

  // 直孔与锥孔衔接处的横向过渡线（机械制图规范：钻尖过渡界线）
  const transitionLines: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (let i = 1; i < sec.bands.length; i++) {
    const prev = sec.bands[i - 1]
    const curr = sec.bands[i]
    if (
      (prev.type === 'straight' && curr.type === 'tapered') ||
      (prev.type === 'tapered' && curr.type === 'straight')
    ) {
      transitionLines.push({
        x1: -curr.r0,
        y1: curr.z0,
        x2: curr.r0,
        y2: curr.z0
      })
    }
  }

  return (
    <Group listening={false}>
      {/* 内腔实体白底/纸面衬底（遮挡底层图元，避免底层侧油口穿透孔腔内部） */}
      {fillPath && <Path data={fillPath} fill={colors.paper} strokeEnabled={false} />}

      {/* 内腔淡抹底色 */}
      {fillPath && <Path data={fillPath} fill={fill} strokeEnabled={false} />}

      {/* 螺纹牙型与大径示意 */}
      <ThreadFigure sec={sec} vp={vp} colors={colors} lw={lw} />

      {/* 孔壁轮廓（含锥段斜线与台阶台面） */}
      {wallPath && <Path data={wallPath} stroke={colors.ink} strokeWidth={lw} strokeEnabled lineJoin="round" lineCap="round" />}

      {/* 锥段过渡交线 */}
      {transitionLines.map((l, i) => (
        <Line
          key={`trans-${i}`}
          points={[l.x1, l.y1, l.x2, l.y2]}
          stroke={colors.ink}
          strokeWidth={lw}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ))}
    </Group>
  )
}

/** 螺纹示意图元（大径牙底细实线 + 螺纹终止粗实线 + 45° 螺纹牙型剖面细斜线） */
function ThreadFigure({
  sec,
  vp,
  colors,
  lw
}: {
  sec: SectionModel
  vp: Viewport
  colors: CanvasPalette
  lw: number
}) {
  _useLocale()
  const { k } = vp
  const thinLw = toMm(DECOR.weakW, k)

  return (
    <Group listening={false}>
      {sec.bands.map((b) => {
        if (!b.hasThread || !b.thread) return null

        const threadOffset = Math.min(Math.max(b.diameter * 0.08, 0.8), 2.2)
        const effDepth = b.thread.depth != null ? Math.min(b.thread.depth, b.effLength) : b.effLength
        const z0 = b.z0
        const z1 = b.z0 + effDepth

        // 牙底线（大径）
        const leftRootLine = [-b.r0 - threadOffset, z0, -b.r0 - threadOffset, z1]
        const rightRootLine = [b.r0 + threadOffset, z0, b.r0 + threadOffset, z1]

        // 螺纹终止线（横向粗实线）
        const leftTermLine = [-b.r0, z1, -b.r0 - threadOffset, z1]
        const rightTermLine = [b.r0, z1, b.r0 + threadOffset, z1]

        // 牙型 45° 细斜线（按近似螺距均匀生成）
        const pitch = Math.min(Math.max(b.diameter * 0.09, 1.2), 2.8)
        const hatchLines: number[][] = []
        for (let z = z0 + pitch * 0.5; z < z1; z += pitch) {
          const dz = Math.min(threadOffset * 0.8, z1 - z)
          hatchLines.push([-b.r0, z, -b.r0 - threadOffset, z + dz])
          hatchLines.push([b.r0, z, b.r0 + threadOffset, z + dz])
        }

        // 螺纹牙底区域浅色半透明衬底
        const leftZonePoly = [
          -b.r0, z0,
          -b.r0 - threadOffset, z0,
          -b.r0 - threadOffset, z1,
          -b.r0, z1
        ]
        const rightZonePoly = [
          b.r0, z0,
          b.r0 + threadOffset, z0,
          b.r0 + threadOffset, z1,
          b.r0, z1
        ]

        return (
          <Group key={`thread-${b.index}`}>
            {/* 牙底衬底 */}
            <Line points={leftZonePoly} closed fill={alpha(colors.ink, 0.05)} strokeEnabled={false} />
            <Line points={rightZonePoly} closed fill={alpha(colors.ink, 0.05)} strokeEnabled={false} />

            {/* 牙底线（细实线） */}
            <Line points={leftRootLine} stroke={colors.ink} strokeWidth={thinLw} lineCap="round" />
            <Line points={rightRootLine} stroke={colors.ink} strokeWidth={thinLw} lineCap="round" />

            {/* 螺纹终止线（粗实线） */}
            <Line points={leftTermLine} stroke={colors.ink} strokeWidth={lw} lineCap="square" />
            <Line points={rightTermLine} stroke={colors.ink} strokeWidth={lw} lineCap="square" />

            {/* 45° 斜牙线 */}
            {hatchLines.map((pts, hi) => (
              <Line key={`hatch-${hi}`} points={pts} stroke={colors.ink} strokeWidth={thinLw} lineCap="round" />
            ))}
          </Group>
        )
      })}
    </Group>
  )
}

interface PortGeom {
  isBottom: boolean
  isThrough: boolean
  yTop: number
  yBottom: number
  yCenter: number
  xLeft: number
  xRight: number
  portLabel: string
}

function computePortGeom(p: import('@shared/cavity/types').Port, i: number, sec: SectionModel, vp: Viewport): PortGeom {
  const { k } = vp
  const isBottom = Boolean(p.isBottomPort)
  const isThrough = Boolean(p.through)

  let yTop: number
  let yBottom: number
  let yCenter: number
  let portLabel: string

  const portName = p.name?.trim() || `P${i + 1}`

  if (isBottom) {
    yTop = p.depth ?? 0
    // 通底：自起始深直达孔底最深处
    yBottom = Math.max(sec.totalDepth, yTop >= sec.totalDepth ? yTop + 8 : sec.totalDepth)
    yCenter = (yTop + yBottom) / 2
    portLabel = `${portName} ${_t("通底")}`
  } else {
    const dia = p.diameter && p.diameter > 0 ? p.diameter : 8
    const r = dia / 2
    yCenter = p.depth ?? 0
    yTop = yCenter - r
    yBottom = yCenter + r
    portLabel = `${portName} φ${dia}`
  }

  // 侧油口向右侧延伸的矩形长度
  const lateralLen = toMm(20, k)
  const xRight = Math.max((sec.maxRadius || 10) * 1.35, (sec.maxRadius || 10) + lateralLen)
  const xLeft = isThrough ? -xRight : 0

  return {
    isBottom,
    isThrough,
    yTop,
    yBottom,
    yCenter,
    xLeft,
    xRight,
    portLabel
  }
}

/** 侧油口最底层纯矩形流道（置于 SectionFigure 之下，绝不遮挡台阶轮廓线） */
function PortsUnderlay({
  sec,
  vp,
  colors,
  lw,
  selectedPortIndex,
  hoveredPort
}: {
  sec: SectionModel
  vp: Viewport
  colors: CanvasPalette
  lw: number
  selectedPortIndex?: number | null
  hoveredPort?: number | null
}) {
  _useLocale()
  const { k } = vp
  const thinLw = toMm(DECOR.weakW, k)
  const ports = sec.ports ?? []
  if (ports.length === 0) return null

  const PORT_FILL = 'rgba(14, 165, 233, 0.22)'
  const PORT_FILL_HOVER = 'rgba(14, 165, 233, 0.38)'
  const PORT_FILL_SEL = alpha(colors.mint, 0.45)
  const PORT_STROKE = '#0284c7'
  const PORT_BORDER_LW = Math.max(lw, toMm(1.1, k))

  return (
    <Group listening={false}>
      {ports.map((p, i) => {
        const isSel = selectedPortIndex === i
        const isHov = hoveredPort === i && !isSel
        const { isBottom, isThrough, yTop, yBottom, yCenter, xLeft, xRight } = computePortGeom(p, i, sec, vp)

        const currentFill = isSel ? PORT_FILL_SEL : isHov ? PORT_FILL_HOVER : PORT_FILL
        const currentStrokeWidth = isSel ? toMm(2.2, k) : PORT_BORDER_LW
        const rectPoly = [xLeft, yTop, xRight, yTop, xRight, yBottom, xLeft, yBottom]

        return (
          <Group key={`port-underlay-${i}`}>
            {/* 纯矩形填充 */}
            <Line points={rectPoly} closed fill={currentFill} strokeEnabled={false} listening={false} />

            {/* 顶边界线 */}
            <Line points={[xLeft, yTop, xRight, yTop]} stroke={PORT_STROKE} strokeWidth={currentStrokeWidth} lineCap="round" listening={false} />
            {/* 底边界线 */}
            <Line points={[xLeft, yBottom, xRight, yBottom]} stroke={PORT_STROKE} strokeWidth={currentStrokeWidth} lineCap="round" listening={false} />
            {/* 右外侧封口线 */}
            <Line points={[xRight, yTop, xRight, yBottom]} stroke={PORT_STROKE} strokeWidth={thinLw} listening={false} />
            {/* 若贯通，左外侧封口线 */}
            {isThrough && (
              <Line points={[-xRight, yTop, -xRight, yBottom]} stroke={PORT_STROKE} strokeWidth={thinLw} listening={false} />
            )}
            {/* 中心轴线（非通底时绘制标准点划线） */}
            {!isBottom && (
              <Line
                points={[isThrough ? -xRight - toMm(5, k) : xLeft, yCenter, xRight + toMm(5, k), yCenter]}
                stroke={PORT_STROKE}
                strokeWidth={thinLw}
                dash={[toMm(6, k), toMm(2, k), toMm(1.2, k), toMm(2, k)]}
                listening={false}
              />
            )}
          </Group>
        )
      })}
    </Group>
  )
}

/** 侧油口交互层与标注标签（位于台阶交互层之上，负责外侧点击选中与文字呈现） */
function PortsOverlay({
  sec,
  vp,
  colors,
  selectedPortIndex,
  onSelectPort,
  setHoveredPort
}: {
  sec: SectionModel
  vp: Viewport
  colors: CanvasPalette
  selectedPortIndex?: number | null
  onSelectPort?: (idx: number | null) => void
  setHoveredPort: (idx: number | null) => void
}) {
  _useLocale()
  const { k } = vp
  const ports = sec.ports ?? []
  if (ports.length === 0) return null

  const PORT_STROKE = '#0284c7'

  return (
    <Group>
      {ports.map((p, i) => {
        const isSel = selectedPortIndex === i
        const { yTop, yBottom, yCenter, xRight, portLabel } = computePortGeom(p, i, sec, vp)
        // 交互热区：位于孔壁外侧至右侧标注区域，避免遮挡孔内台阶点击
        const xStart = Math.min(xRight - toMm(5, k), Math.max((sec.maxRadius || 10) * 0.8, 5))
        const hitPoly = [xStart, yTop, xRight + toMm(28, k), yTop, xRight + toMm(28, k), yBottom, xStart, yBottom]

        return (
          <Group key={`port-overlay-${i}`}>
            {/* 交互点击与悬停热区 */}
            <Line
              points={hitPoly}
              closed
              fill="rgba(0,0,0,0)"
              strokeEnabled={false}
              listening
              onClick={() => onSelectPort?.(isSel ? null : i)}
              onMouseEnter={(e) => {
                const stage = e.target.getStage()
                if (stage) stage.container().style.cursor = 'pointer'
                setHoveredPort(i)
              }}
              onMouseLeave={(e) => {
                const stage = e.target.getStage()
                if (stage) stage.container().style.cursor = 'default'
                setHoveredPort(null)
              }}
            />

            {/* 右侧标注气泡 */}
            <TextBubble
              x={xRight + toMm(14, k)}
              y={yCenter}
              value={portLabel}
              fontPx={9.5}
              padX={3}
              vp={vp}
              colors={colors}
              fill={isSel ? colors.ink : PORT_STROKE}
            />
          </Group>
        )
      })}
    </Group>
  )
}

/** 选中侧油口后呈现的 CAD 尺寸标注 */
function PortDimensions({
  sec,
  idx,
  vp,
  colors
}: {
  sec: SectionModel
  idx: number
  vp: Viewport
  colors: CanvasPalette
}) {
  _useLocale()
  const p = sec.ports?.[idx]
  if (!p) return null
  const { k } = vp
  const isBottom = Boolean(p.isBottomPort)
  const dia = p.diameter && p.diameter > 0 ? p.diameter : 8
  const yTop = isBottom ? p.depth : p.depth - dia / 2
  const yBottom = isBottom ? Math.max(sec.totalDepth, p.depth) : p.depth + dia / 2
  const yTarget = isBottom ? yTop : p.depth
  const xDim = Math.max(sec.maxRadius || 1, 10) + toMm(26, k)

  return (
    <Group listening={false}>
      {/* 深度标注（从安装面 y=0 至目标深度位置） */}
      <DimStub
        a={{ x: xDim, y: 0 }}
        b={{ x: xDim, y: yTarget }}
        value={isBottom ? _msg`起始深 ${fmt(p.depth)}` : _msg`深 ${fmt(p.depth)}`}
        side={1}
        gapPx={DECOR.dimGap}
        vp={vp}
        colors={colors}
      />

      {/* 非通底时，标注开孔直径 */}
      {!isBottom && (
        <DimStub
          a={{ x: xDim + toMm(14, k), y: yTop }}
          b={{ x: xDim + toMm(14, k), y: yBottom }}
          value={`φ${fmt(dia)}`}
          side={1}
          gapPx={DECOR.dimGap}
          vp={vp}
          colors={colors}
        />
      )}
    </Group>
  )
}

export function SectionView({
  sec,
  selectedBand,
  onSelectBand,
  selectedPortIndex,
  onSelectPort,
  vp,
  colors,
  axisY0,
  title,
  showOverviewDims = false
}: {
  sec: SectionModel
  selectedBand: number | null
  onSelectBand: (idx: number) => void
  selectedPortIndex?: number | null
  onSelectPort?: (idx: number | null) => void
  vp: Viewport
  colors: CanvasPalette
  /** 垂直中轴线顶端 Y 坐标（世界 mm，默认 -toMm(16, k)） */
  axisY0?: number
  /** 截面图标题（如 "P 剖面"），置于基线上方 */
  title?: string
  /** 当未选中具体台阶时是否显示顶口径与总深概览标注 */
  showOverviewDims?: boolean
}) {
  _useLocale()
  const { k } = vp
  const torso = (sec.maxRadius || 1) * 1.55 + toMm(18, k)
  const [hoveredPort, setHoveredPort] = useState<number | null>(null)
  const [hoveredBand, setHoveredBand] = useState<number | null>(null)

  return (
    <Group>
      {/* 1. 最底层：侧油口纯矩形流道（填充与管壁线条置于最底层，绝不遮挡台阶轮廓） */}
      <PortsUnderlay
        sec={sec}
        vp={vp}
        colors={colors}
        lw={toMm(DECOR.lineW, k)}
        selectedPortIndex={selectedPortIndex}
        hoveredPort={hoveredPort}
      />

      {/* 2. 剖面主体（白底纸衬遮蔽 + 内腔淡抹底色 + 螺纹牙型 + 孔壁轮廓线与锥孔过渡线） */}
      <SectionFigure sec={sec} vp={vp} colors={colors} />

      {/* 3. 各台阶高亮层与命中交互区 */}
      {sec.bands.map((b) => {
        const isSel = selectedBand === b.index
        const isHov = hoveredBand === b.index && !isSel
        const poly = [-b.r0, b.z0, b.r0, b.z0, b.r1, b.z1, -b.r1, b.z1]

        return (
          <Group key={`band-${b.index}`}>
            {/* 选中高亮底色：薄荷绿朦胧块，醒目且柔和 */}
            {isSel && (
              <Line
                points={poly}
                closed
                fill={alpha(colors.mint, 0.45)}
                stroke={colors.ink}
                strokeWidth={toMm(2.2, k)}
                lineJoin="round"
                lineCap="round"
                listening={false}
              />
            )}
            {/* 悬停浅灰底色 */}
            {isHov && (
              <Line
                points={poly}
                closed
                fill={alpha(colors.ink, 0.04)}
                lineJoin="round"
                lineCap="round"
                listening={false}
              />
            )}
            {/* 命中区：透明多边形，不遮挡任何底部线条与斜线 */}
            <Line
              points={poly}
              closed
              fill="rgba(0,0,0,0)"
              strokeEnabled={false}
              listening
              onClick={() => onSelectBand(b.index)}
              onMouseEnter={(e) => {
                const stage = e.target.getStage()
                if (stage) stage.container().style.cursor = 'pointer'
                setHoveredBand(b.index)
              }}
              onMouseLeave={(e) => {
                const stage = e.target.getStage()
                if (stage) stage.container().style.cursor = 'default'
                setHoveredBand(null)
              }}
            />
          </Group>
        )
      })}

      {/* 4. 侧油口交互层与标注标签（位于孔外侧，负责点击选中与文字呈现） */}
      <PortsOverlay
        sec={sec}
        vp={vp}
        colors={colors}
        selectedPortIndex={selectedPortIndex}
        onSelectPort={onSelectPort}
        setHoveredPort={setHoveredPort}
      />

      {/* 安装面基线 */}
      <Line
        points={[-torso, 0, torso, 0]}
        stroke={colors.muted}
        strokeWidth={toMm(DECOR.weakW, k)}
        dash={[toMm(7, k), toMm(3, k)]}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />

      {/* 尺寸标注 */}
      {selectedBand != null ? (
        <SectionDimensions sec={sec} idx={selectedBand} vp={vp} colors={colors} />
      ) : selectedPortIndex != null && sec.ports?.[selectedPortIndex] ? (
        <PortDimensions sec={sec} idx={selectedPortIndex} vp={vp} colors={colors} />
      ) : showOverviewDims ? (
        <SectionOverviewDimensions sec={sec} vp={vp} colors={colors} />
      ) : null}

      {/* 中轴竖线：点划线，位于图层最上方，始终显示 */}
      <Line
        points={[0, axisY0 ?? -toMm(16, k), 0, sec.totalDepth + toMm(12, k)]}
        stroke={colors.muted}
        strokeWidth={toMm(DECOR.weakW, k)}
        dash={[toMm(8, k), toMm(2.5, k), toMm(1.2, k), toMm(2.5, k)]}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />

      {/* 截面标题：如 "P 剖面"，绘制在中轴线之上（白底纸衬遮蔽中轴线段，文字清晰） */}
      {title && (
        <TextBubble
          x={0}
          y={-toMm(10, k)}
          value={title}
          fontPx={11}
          padX={6}
          vp={vp}
          colors={colors}
        />
      )}
    </Group>
  )
}

/** 未选中具体台阶时展示的概览尺寸：顶口入口径与总深 */
export function SectionOverviewDimensions({
  sec,
  vp,
  colors
}: {
  sec: SectionModel
  vp: Viewport
  colors: CanvasPalette
}) {
  _useLocale()
  if (!sec.bands || sec.bands.length === 0) return null
  const { k } = vp
  const topBand = sec.bands[0]
  const topR = topBand.r0 || topBand.r1 || sec.maxRadius || 1
  const xDeep = -(sec.maxRadius + toMm(14, k))

  return (
    <Group listening={false}>
      {/* φ 顶口入口径：跨左右口沿的横向线性尺寸 */}
      <DimStub
        a={{ x: -topR, y: 0 }}
        b={{ x: topR, y: 0 }}
        value={`φ${fmt(topBand.diameter || topR * 2)}`}
        side={1}
        gapPx={DECOR.dimGap + 12}
        vp={vp}
        colors={colors}
      />

      {/* 累计总深 0 → sec.totalDepth：竖向 */}
      {sec.totalDepth > 0 && (
        <DimStub
          a={{ x: xDeep, y: 0 }}
          b={{ x: xDeep, y: sec.totalDepth }}
          value={_msg`深 ${fmt(sec.totalDepth)}`}
          side={1}
          gapPx={DECOR.dimGap}
          vp={vp}
          colors={colors}
        />
      )}
    </Group>
  )
}

/** 选中一段后给出 CAD 尺寸：横向 φ 线性；左外侧叠放「累计深」与「本段长度」 */
function SectionDimensions({
  sec,
  idx,
  vp,
  colors
}: {
  sec: SectionModel
  idx: number
  vp: Viewport
  colors: CanvasPalette
}) {
  _useLocale()
  const b = sec.bands[idx]
  if (!b) return null
  const { k } = vp
  const yTop = b.z0
  const yBot = b.z1
  const topR = b.r0
  const segLen = b.z1 - b.z0

  // 距轮廓更大气隙；两条竖向尺寸错层排布
  const gapOut = DECOR.dimGap + 12
  const xDeep = -(sec.maxRadius + toMm(14, k))
  const xSeg = xDeep - toMm(30, k)

  const threadInfo = b.hasThread && b.thread?.designation
    ? ` [${b.thread.designation}${b.thread.depth ? _msg` 深${fmt(b.thread.depth)}` : ''}]`
    : ''

  const diaText =
    b.type === 'tapered' && b.angle
      ? `φ${fmt(b.diameter)} (∠${fmt(b.angle)}°)${threadInfo}`
      : `φ${fmt(b.diameter)}${threadInfo}`

  const threadDepth = b.thread?.depth != null ? Math.min(b.thread.depth, segLen) : null

  return (
    <Group listening={false}>
      {/* φ 口径：跨左右口沿的横向线性尺寸 */}
      <DimStub
        a={{ x: -topR, y: yTop }}
        b={{ x: topR, y: yTop }}
        value={diaText}
        side={1}
        gapPx={gapOut}
        vp={vp}
        colors={colors}
      />

      {/* 累计深 0 → 本台阶顶端：竖向，更外侧 */}
      <DimStub
        a={{ x: xDeep, y: 0 }}
        b={{ x: xDeep, y: yTop }}
        value={_msg`深 ${fmt(yTop)}`}
        side={1}
        gapPx={DECOR.dimGap}
        vp={vp}
        colors={colors}
      />

      {/* 本段长度 yTop → yBot：竖向，稍内侧 */}
      <DimStub
        a={{ x: xSeg, y: yTop }}
        b={{ x: xSeg, y: yBot }}
        value={_msg`段 ${fmt(segLen)}`}
        side={1}
        gapPx={DECOR.dimGap}
        vp={vp}
        colors={colors}
      />

      {/* 若有指定有效螺纹深度且小于本段总长，在右侧标注螺纹有效深度 */}
      {threadDepth != null && threadDepth < segLen && (
        <DimStub
          a={{ x: topR + toMm(10, k), y: yTop }}
          b={{ x: topR + toMm(10, k), y: yTop + threadDepth }}
          value={_msg`螺纹深 ${fmt(threadDepth)}`}
          side={-1}
          gapPx={DECOR.dimGap}
          vp={vp}
          colors={colors}
        />
      )}
    </Group>
  )
}

function fmt(v: number): string {
  const r = Math.round(v * 100) / 100
  return Number.isInteger(r) ? `${r}` : r.toFixed(2)
}
