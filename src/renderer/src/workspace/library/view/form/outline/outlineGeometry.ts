/**
 * 安装轮廓（Outline）几何计算与 SVG Path 生成/推断工具
 */

import type { CircleParams, InferredOutlineState, RectParams, SaeFlangeParams } from './outlineTypes'
import { createDefaultSaeFlangeParams, DEFAULT_SAE_FLANGE_STANDARD, SAE_FLANGE_STANDARDS } from './saeFlangeStandards'

function fmt(n: number): string {
  const s = n.toFixed(3)
  return s.replace(/\.?0+$/, '')
}

/**
 * 生成矩形/圆角矩形 SVG Path
 */
export function generateRectPath(params: RectParams): string {
  const { width, height, cornerRadius, offsetX, offsetY } = params
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const r = Math.max(0, Math.min(cornerRadius, w / 2, h / 2))
  const x = offsetX
  const y = offsetY

  if (r <= 0.001) {
    const left = fmt(x - w / 2)
    const right = fmt(x + w / 2)
    const top = fmt(y - h / 2)
    const bottom = fmt(y + h / 2)
    return `M${left},${top}H${right}V${bottom}H${left}Z`
  }

  const left = x - w / 2
  const right = x + w / 2
  const top = y - h / 2
  const bottom = y + h / 2

  return [
    `M${fmt(left + r)},${fmt(top)}`,
    `H${fmt(right - r)}`,
    `A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(right)},${fmt(top + r)}`,
    `V${fmt(bottom - r)}`,
    `A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(right - r)},${fmt(bottom)}`,
    `H${fmt(left + r)}`,
    `A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(left)},${fmt(bottom - r)}`,
    `V${fmt(top + r)}`,
    `A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(left + r)},${fmt(top)}`,
    'Z'
  ].join('')
}

/**
 * 生成圆形 SVG Path
 */
export function generateCirclePath(params: CircleParams): string {
  const { diameter, offsetX, offsetY } = params
  const r = Math.max(0.5, diameter / 2)
  const x = offsetX
  const y = offsetY

  // 两段半圆弧构造闭合圆
  const p1 = `${fmt(x - r)},${fmt(y)}`
  const p2 = `${fmt(x + r)},${fmt(y)}`
  const arcR = `${fmt(r)},${fmt(r)}`

  return `M${p1}A${arcR} 0 1 0 ${p2}A${arcR} 0 1 0 ${p1}Z`
}

/**
 * 生成 SAE J518 四螺栓法兰轮廓 SVG Path
 *
 * 几何特征：
 *  - 4 个螺栓孔位于 (±dx, ±dy)
 *  - 4 个外凸螺栓凸耳圆弧（半径 earRadius = R，总高 c1 = a1 + 2*R）
 *  - 上下水平切向平边连接线
 *  - 左右平滑外凸侧翼圆弧（最大外宽 waistWidth = c2）
 *  - 全凸圆弧过渡，无内凹特征
 */
export function generateSaeFlangePath(params: SaeFlangeParams): string {
  const { a, b, earRadius, waistWidth, rotation, offsetX, offsetY } = params

  // a = 垂直孔距 a1，b = 水平孔距 a2
  // earRadius = R（总高 c1 = a1 + 2*R）
  // waistWidth = c2（外凸最大总宽度）
  const dx = b / 2
  const dy = a / 2
  const r = Math.max(1, earRadius)
  const wHalf = Math.max(dx + r + 0.5, waistWidth / 2)

  const yTopEar = -dy - r
  const yBottomEar = dy + r

  // 左右两侧外凸侧翼圆弧（通过 (wHalf, 0) 且与上/下凸耳平滑外切）
  const delta = wHalf - r
  const denom = 2 * (delta - dx)
  let xc = 0
  let Rflank = wHalf
  let txSide = dx + r
  let tySide = -dy

  if (denom > 0.01) {
    xc = (dx * dx + dy * dy - delta * delta) / denom
    Rflank = xc + wHalf
    const dist = Math.hypot(dx + xc, -dy)
    const ux = (dx + xc) / dist
    const uy = -dy / dist
    txSide = dx + r * ux
    tySide = -dy + r * uy
  }

  // 辅助坐标旋转与平移映射
  const isHoriz = rotation === 90
  const tr = (x: number, y: number): [number, number] => {
    if (isHoriz) {
      // 旋转 90°：长轴转为水平，(x, y) -> (-y, x)
      return [offsetX - y, offsetY + x]
    }
    return [offsetX + x, offsetY + y]
  }

  const f = fmt
  const p = (x: number, y: number) => {
    const [rx, ry] = tr(x, y)
    return `${f(rx)},${f(ry)}`
  }

  return [
    // 1. 起点：左上凸耳顶点 (-dx, yTopEar)
    `M${p(-dx, yTopEar)}`,
    // 2. 顶部平边：连接至右上凸耳顶点 (dx, yTopEar)
    `L${p(dx, yTopEar)}`,
    // 3. 右上凸耳圆弧（外凸）
    `A${f(r)},${f(r)} 0 0 1 ${p(txSide, tySide)}`,
    // 4. 右侧侧翼圆弧（外凸，平滑穿过最大外宽 wHalf）
    `A${f(Rflank)},${f(Rflank)} 0 0 1 ${p(txSide, -tySide)}`,
    // 5. 右下凸耳圆弧（外凸）
    `A${f(r)},${f(r)} 0 0 1 ${p(dx, yBottomEar)}`,
    // 6. 底部平边：连接至左下凸耳底端 (-dx, yBottomEar)
    `L${p(-dx, yBottomEar)}`,
    // 7. 左下凸耳圆弧（外凸）
    `A${f(r)},${f(r)} 0 0 1 ${p(-txSide, -tySide)}`,
    // 8. 左侧侧翼圆弧（外凸，平滑穿过最大外宽 -wHalf）
    `A${f(Rflank)},${f(Rflank)} 0 0 1 ${p(-txSide, tySide)}`,
    // 9. 左上凸耳圆弧（外凸，闭合回到起点）
    `A${f(r)},${f(r)} 0 0 1 ${p(-dx, yTopEar)}`,
    'Z'
  ].join('')
}

/**
 * 智能推断已有 SVG Path 的图形类型并反向提取初始参数
 */
export function inferOutlineShape(pathStr: string, cavityType?: string): InferredOutlineState {
  const trimmed = (pathStr ?? '').trim()

  if (!trimmed) {
    if (cavityType === 'flange') {
      const fl = createDefaultSaeFlangeParams()
      return { type: 'flange', flange: fl }
    }
    return {
      type: 'none'
    }
  }

  // 1. 检测无圆角简单矩形 M-x,-yHxVyH-xZ
  const rectMatch = /^M\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*H\s*(-?[\d.]+)\s*V\s*(-?[\d.]+)\s*H\s*(-?[\d.]+)\s*Z$/i.exec(
    trimmed
  )
  if (rectMatch) {
    const x1 = parseFloat(rectMatch[1])
    const y1 = parseFloat(rectMatch[2])
    const x2 = parseFloat(rectMatch[3])
    const y2 = parseFloat(rectMatch[4])
    const width = Math.abs(x2 - x1)
    const height = Math.abs(y2 - y1)
    const offsetX = (x1 + x2) / 2
    const offsetY = (y1 + y2) / 2
    return {
      type: 'rect',
      rect: { width, height, cornerRadius: 0, offsetX, offsetY }
    }
  }

  // 2. 检测带圆角矩形
  if (trimmed.startsWith('M') && trimmed.includes('H') && trimmed.includes('V') && trimmed.includes('A')) {
    const nums = trimmed.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    if (nums.length >= 8) {
      const minX = Math.min(...nums.filter((_, i) => i % 2 === 0))
      const maxX = Math.max(...nums.filter((_, i) => i % 2 === 0))
      const minY = Math.min(...nums.filter((_, i) => i % 2 === 1))
      const maxY = Math.max(...nums.filter((_, i) => i % 2 === 1))
      const width = maxX - minX
      const height = maxY - minY
      return {
        type: 'rect',
        rect: {
          width: Math.round(width * 10) / 10,
          height: Math.round(height * 10) / 10,
          cornerRadius: 4,
          offsetX: Math.round(((minX + maxX) / 2) * 10) / 10,
          offsetY: Math.round(((minY + maxY) / 2) * 10) / 10
        }
      }
    }
  }

  // 3. 检测圆形 M-r,0 A r,r 0 1 0 r,0 A r,r 0 1 0 -r,0 Z
  if (trimmed.includes('A') && trimmed.split('A').length === 3 && !trimmed.includes('H') && !trimmed.includes('V')) {
    const nums = trimmed.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    if (nums.length >= 4) {
      const r = nums[2] ?? 25
      return {
        type: 'circle',
        circle: {
          diameter: Math.round(r * 2 * 10) / 10,
          offsetX: 0,
          offsetY: 0
        }
      }
    }
  }

  // 4. 若为法兰模板类型且有曲线特征
  if (cavityType === 'flange' || (trimmed.includes('C') && trimmed.includes('A'))) {
    // 尝试匹配已有标准尺寸
    const nums = trimmed.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    let bestStd = DEFAULT_SAE_FLANGE_STANDARD
    if (nums.length >= 6) {
      const maxExt = Math.max(...nums.map(Math.abs))
      const found = SAE_FLANGE_STANDARDS.find((s) => Math.abs(s.a / 2 + s.earRadius - maxExt) < 8)
      if (found) bestStd = found
    }
    return {
      type: 'flange',
      flange: {
        standardKey: bestStd.key,
        a: bestStd.a,
        b: bestStd.b,
        earRadius: bestStd.earRadius,
        waistWidth: bestStd.waistWidth,
        boltDia: bestStd.boltDia,
        rotation: 0,
        offsetX: 0,
        offsetY: 0
      }
    }
  }

  // 5. 其余默认归为自定义
  return {
    type: 'custom',
    custom: { pathData: trimmed }
  }
}
