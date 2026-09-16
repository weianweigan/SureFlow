import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * CAD 风格尺寸标注图元（react-konva）
 *
 * 世界单位 mm。Konva 在祖先 <Group scale={k}> 下会把节点自身的字号/线宽按 k
 * 放大；为使“装饰”保持屏幕像素恒定（R6），所有恒定 px 的量都要换算成 mm
 * （= px/k）再交给 Konva——本文件借此统一封装。被测几何端点用真实 mm，
 * 天然随 k 缩放，故标注贴附所注图元。
 *
 * 导出：TextBubble / LeaderLine / DimStub / DimLeader
 */

import { Circle, Group, Line, Rect, Text } from 'react-konva'
import type { CanvasPalette } from './palette'
import { rgb } from './palette'
import { DECOR, toMm, type Viewport } from './viewport'

export type Pt = { x: number; y: number }

const FONT = "'Inter Variable','Inter',system-ui,-apple-system,'Segoe UI','PingFang SC',sans-serif"

/** 由点 a→b 取单位切向与逆时针垂直向 */
function aligned(a: Pt, b: Pt): { ux: number; uy: number; px: number; py: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = Math.hypot(dx, dy) || 1e-6
  const ux = dx / l
  const uy = dy / l
  return { ux, uy, px: -uy, py: ux }
}

/* ================= TextBubble ================= */

/** 白纸底衬 + 边线的居中值标签（中心 x,y 处；纸衬把底下覆盖画布擦出间隙） */
export function TextBubble({
  x,
  y,
  value,
  fontPx,
  vp,
  colors,
  fill,
  padX = 3
}: {
  x: number
  y: number
  value: string
  fontPx: number
  vp: Viewport
  colors: CanvasPalette
  fill?: string
  /** 左右边衬(px) */
  padX?: number
}) {
  _useLocale()
  const { k } = vp
  const hMM = (fontPx * 1.5) / k
  const wMM = (fontPx * 0.64 * value.length + padX * 2) / k
  return (
    <Group listening={false}>
      <Rect
        x={x - wMM / 2}
        y={y - hMM / 2}
        width={wMM}
        height={hMM}
        cornerRadius={Math.min(hMM / 2, 2 / k)}
        fill={colors.paper}
        listening={false}
      />
      <Text
        x={x - wMM / 2}
        y={y - hMM / 2}
        width={wMM}
        height={hMM}
        align="center"
        verticalAlign="middle"
        text={value}
        fontSize={fontPx / k}
        fontFamily={FONT}
        fill={fill ?? colors.ink}
        perfectDrawEnabled={false}
        listening={false}
      />
    </Group>
  )
}

/* ================= LeaderLine ================= */

/**
 * 细引线（可选两折，避免穿过图形/文字）＋可选目标端点圆点。
 * 端点 `to` 指向被标注的 mm 位置。
 */
export function LeaderLine({
  from,
  to,
  vp,
  colors,
  color,
  weight = 1
}: {
  from: Pt
  to: Pt
  vp: Viewport
  colors: CanvasPalette
  color?: string
  weight?: number
}) {
  _useLocale()
  const { k } = vp
  const lw = toMm(DECOR.weakW * weight, k)
  const col = color ?? rgb(colors.ink)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const arc = toMm(9, k)

  // 简单 L 折（朝向目标一侧弯腰，避免直穿贴旁的图元）
  let corner: Pt
  if (Math.abs(dx) >= Math.abs(dy)) {
    corner = { x: to.x - Math.sign(dx) * arc, y: from.y }
  } else {
    corner = { x: from.x, y: to.y - Math.sign(dy) * arc }
  }

  return (
    <Group listening={false}>
      <Line
        points={[from.x, from.y, corner.x, corner.y, to.x, to.y]}
        stroke={col}
        strokeWidth={lw}
        lineJoin="round"
        lineCap="round"
        listening={false}
        perfectDrawEnabled={false}
      />
    </Group>
  )
}

/** 小圆点：把目标端点标实，便于粘连引线所指。圆点在 mm 世界内（半径恒定 px） */
export function Dot({ at, rPx, col, vp }: { at: Pt; rPx: number; col: string; vp: Viewport }) {
  _useLocale()
  return <Circle x={at.x} y={at.y} radius={rPx / vp.k} fill={col} listening={false} perfectDrawEnabled={false} />
}

/* ================= DimStub ================= */

/** 线性范围尺寸：witness 夹持 + 实心端头箭头 + 断空基线 + 白底范围值。
 *  dimension 线沿 a→b 方向、位于距被测特征「gapPx」之外；箭头指向外侧端点。 */
export function DimStub({
  a,
  b,
  value,
  side = 1,
  gapPx = DECOR.dimGap,
  overPx = 8,
  fontPx = DECOR.dimFont,
  vp,
  colors
}: {
  a: Pt
  b: Pt
  value: string
  side?: 1 | -1
  gapPx?: number
  overPx?: number
  fontPx?: number
  vp: Viewport
  colors: CanvasPalette
}) {
  _useLocale()
  const { k } = vp
  const { ux, uy, px, py } = aligned(a, b)
  const s = side
  const gapMM = toMm(gapPx, k)
  const overMM = toMm(overPx, k)
  const off = (p: Pt, d: number): Pt => ({ x: p.x + px * s * d, y: p.y + py * s * d })
  const dA = off(a, gapMM)
  const dB = off(b, gapMM)
  const wA = off(a, gapMM + overMM)
  const wB = off(b, gapMM + overMM)
  // 值居中，基线按文本占宽断开
  const halfMM = ((fontPx * 0.64 * value.length + 10) / 2) / k
  const cX = (dA.x + dB.x) / 2
  const cY = (dA.y + dB.y) / 2

  // 两端实心箭头：尖端落在尺寸线端点（贴合 witness），底边朝中线（制图规范：箭头指向尺寸界线）
  const arrowLen = DECOR.arrowLen / k
  const arrowHalf = DECOR.arrowWid / 2 / k
  const perp = { x: px * s, y: py * s }
  const mkHead = (pole: Pt, dirSign: number): number[] => {
    // dirSign: +1 → 底边在 pole 朝 +u（内侧），尖端在 pole（用于 a 端）
    //          -1 → 底边在 pole 朝 -u（内侧），尖端在 pole（用于 b 端）
    const back = { x: pole.x + ux * dirSign * arrowLen, y: pole.y + uy * dirSign * arrowLen }
    const e1 = { x: back.x + perp.x * arrowHalf, y: back.y + perp.y * arrowHalf }
    const e2 = { x: back.x - perp.x * arrowHalf, y: back.y - perp.y * arrowHalf }
    return [pole.x, pole.y, e1.x, e1.y, e2.x, e2.y]
  }
  const inkLine = toMm(DECOR.lineW, k)
  const fill = colors.ink

  return (
    <Group listening={false}>
      <Line points={[a.x, a.y, wA.x, wA.y]} stroke={colors.muted} strokeWidth={toMm(DECOR.weakW, k)} lineCap="round" lineJoin="round" />
      <Line points={[b.x, b.y, wB.x, wB.y]} stroke={colors.muted} strokeWidth={toMm(DECOR.weakW, k)} lineCap="round" lineJoin="round" />
      {/* 断空基线（值留位） */}
      <Line points={[dA.x, dA.y, cX - ux * halfMM, cY - uy * halfMM]} stroke={fill} strokeWidth={inkLine} lineCap="round" lineJoin="round" />
      <Line points={[cX + ux * halfMM, cY + uy * halfMM, dB.x, dB.y]} stroke={fill} strokeWidth={inkLine} lineCap="round" lineJoin="round" />
      {/* 实心箭头：a 端底边朝 +u（向内）、b 端底边朝 -u（向内），尖端贴 witness */}
      <Line points={mkHead(dA, 1)} stroke={fill} strokeWidth={Math.max(inkLine, toMm(1, k))} closed fill={fill} lineCap="round" lineJoin="round" />
      <Line points={mkHead(dB, -1)} stroke={fill} strokeWidth={Math.max(inkLine, toMm(1, k))} closed fill={fill} lineCap="round" lineJoin="round" />
      <TextBubble value={value} x={cX} y={cY} fontPx={fontPx} vp={vp} colors={colors} />
    </Group>
  )
}

/* ================= DimLeader ================= */

/** 白底值 + 引线 + 目标端点的交附尺寸。 */
export function DimLeader({
  value,
  tip,
  label,
  vp,
  colors,
  fill,
  fontPx = DECOR.dimFont
}: {
  value: string
  tip: Pt
  label: Pt
  vp: Viewport
  colors: CanvasPalette
  fill?: string
  fontPx?: number
}) {
  _useLocale()
  return (
    <Group listening={false}>
      <LeaderLine from={_t(label)} to={tip} vp={vp} colors={colors} />
      <TextBubble value={value} x={label.x} y={label.y} fontPx={fontPx} vp={vp} colors={colors} fill={fill} />
      <Dot at={tip} rPx={2.4} col={rgb(colors.ink)} vp={vp} />
    </Group>
  )
}
