import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
/**
 * 子孔圆内居中的名称标签（R4）
 *
 * 尽量把子孔名称大而居中地放进其安装面圆，且不溢出：用 canvas 2d 测量文本宽度，
 * 需要时逐档缩小字号直到放入安全圆；必要时截尾显示。文字以恒定屏幕 px 定位，
 * 位于本视图统一 <Group scale={k}> 中时其 fontSize/偏移均以 mm（÷k）布置，
 * 故缩放时字保持清晰同尺寸。未解析引用放不下名称时应由调用方换用简标。
 */

import { Group, Text } from 'react-konva'
import type { CanvasPalette } from './palette'
import { DECOR, measureTextPx, toMm, type Viewport } from './viewport'

const FONT = "'Inter Variable','Inter',system-ui,-apple-system,'Segoe UI','PingFang SC',sans-serif"

/** 计算放入圆内最好的屏幕字高与最终字符串 */
export function fitName(
  name: string,
  radiusPx: number,
  fontFamily = FONT,
  ellipsis = true
): { fontPx: number; shown: string } {
  const maxW = Math.max(14, radiusPx * 2 * 0.82) // 安全圆内可用宽度
  let font = Math.max(7, Math.min(DECOR.nameFont + 4, maxW * 0.55))
  let shown = name
  let w = measureTextPx(shown, font, fontFamily)
  let guard = 0
  while ((w < 0 || w > maxW) && guard++ < 24) {
    font = Math.max(4, font * 0.9)
    if (font <= 5 && ellipsis && shown.length > 1) shown = `${shown.slice(0, 1)}…`
    w = measureTextPx(shown, font, fontFamily)
  }
  return { fontPx: Math.round(font <= 5 ? Math.max(5, font) : font), shown }
}

export function HoleName({
  cx,
  cy,
  radiusPx,
  name,
  vp,
  colors,
  fill,
  ellipsis = true
}: {
  /** 孔心（mm 世界） */
  cx: number
  cy: number
  /** 孔径对应的屏幕 px（radius*k，由调用方给看放不变） */
  radiusPx: number
  name: string
  vp: Viewport
  colors: CanvasPalette
  fill?: string
  ellipsis?: boolean
}) {
  _useLocale()
  const { k } = vp
  const { fontPx, shown } = fitName(name, radiusPx, FONT, ellipsis)
  if (!shown) return null
  const fontMM = toMm(fontPx, k)
  const wMM = Math.max(1, measureTextPx(shown, fontPx, FONT)) / k
  return (
    <Group listening={false}>
      <Text
        text={shown}
        x={cx}
        y={cy}
        fontSize={fontMM}
        fontFamily={FONT}
        fill={fill ?? colors.ink}
        align="center"
        offsetX={wMM / 2}
        offsetY={fontMM * 0.36}
        perfectDrawEnabled={false}
        listening={false}
      />
    </Group>
  )
}

export { FONT as KV_FONT }
