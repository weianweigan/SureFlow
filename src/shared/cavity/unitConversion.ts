/**
 * 孔腔单位换算工具函数（PRD-002 §7.1 R-U1 ~ R-U6）
 *
 * 负责 mm ↔ in 双向换算、几何子结构与 SVG 路径缩放、以及模板级整体转换。
 * 换算仅在切换或跨单位解析时发生，保证精度可控且无重复换算累积误差。
 */

import { isComboType } from './types'
import type { CavityTemplate, ComponentBox, Geometry, Hole, Plug, LocatingShoulder } from './types'

/** 换算基数：1 in = 25.4 mm */
export const MM_PER_INCH = 25.4

/**
 * 单个长度数值换算
 * @param val 原始长度数值
 * @param from 原始单位
 * @param to 目标单位
 * @param decimals 四舍五入小数位数（默认 4 位）
 */
export function convertLength(val: number, from: 'mm' | 'in', to: 'mm' | 'in', decimals = 4): number {
  if (from === to || !Number.isFinite(val)) return val
  const raw = from === 'mm' ? val / MM_PER_INCH : val * MM_PER_INCH
  const factor = 10 ** decimals
  const rounded = Math.round(raw * factor) / factor

  // 接近整数时（如 9.99998 还原为 10）智能吸收微小浮点误差
  const nearestInt = Math.round(rounded)
  if (nearestInt !== 0 && Math.abs(rounded - nearestInt) < 1e-4) {
    return nearestInt
  }
  return rounded
}

/**
 * 缩放 SVG Path 字符串中的所有坐标与长度
 * 仅对坐标数值进行等比例放大/缩小，保留弧线指令的大弧/顺时针标志与旋转角（R-U3）
 */
export function scaleSvgPath(pathStr: string, factor: number, decimals = 4): string {
  if (!pathStr || factor === 1) return pathStr

  // 匹配 SVG 指令字母或数值标记
  const tokenRegex = /([a-df-zA-DF-Z])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/g
  const tokens: string[] = []
  let match: RegExpExecArray | null
  let currentCmd = ''
  let paramIndex = 0

  while ((match = tokenRegex.exec(pathStr)) !== null) {
    const cmd = match[1]
    const numStr = match[2]

    if (cmd) {
      currentCmd = cmd
      paramIndex = 0
      tokens.push(cmd)
    } else if (numStr !== undefined) {
      const num = parseFloat(numStr)
      let scaled = num

      // 圆弧指令 A / a 参数结构：rx ry x-axis-rotation large-arc-flag sweep-flag x y
      if (currentCmd.toUpperCase() === 'A') {
        const aIdx = paramIndex % 7
        // 0: rx, 1: ry, 5: x, 6: y 需要换算；2(旋转角), 3/4(标志位)保持原样
        if (aIdx === 0 || aIdx === 1 || aIdx === 5 || aIdx === 6) {
          scaled = num * factor
        }
      } else {
        // 其余指令（M, L, H, V, C, S, Q, T）所有数值均为长度/坐标
        scaled = num * factor
      }
      paramIndex++

      const factorDec = 10 ** decimals
      const rounded = Math.round(scaled * factorDec) / factorDec
      tokens.push(String(rounded))
    }
  }

  // 规范化拼接，指令与参数、参数与参数之间以空格分隔
  return tokens.join(' ')
}

/**
 * 转换几何子结构（Geometry）中所有长度参数
 */
export function convertGeometry(geo: Geometry, from: 'mm' | 'in', to: 'mm' | 'in'): Geometry {
  if (from === to) return geo
  const scaleFactor = to === 'mm' ? MM_PER_INCH : 1 / MM_PER_INCH

  const next: Geometry = { ...geo }

  if (geo.steps && geo.steps.length > 0) {
    next.steps = geo.steps.map((s) => ({
      ...s,
      diameter: convertLength(s.diameter, from, to),
      length: s.length != null ? convertLength(s.length, from, to) : null,
      thread: s.thread
        ? {
            ...s.thread,
            depth: s.thread.depth != null ? convertLength(s.thread.depth, from, to) : null
          }
        : null
    }))
  }

  if (geo.ports && geo.ports.length > 0) {
    next.ports = geo.ports.map((p) => ({
      ...p,
      depth: convertLength(p.depth, from, to),
      diameter: p.diameter != null ? convertLength(p.diameter, from, to) : null
    }))
  }

  if (geo.plug) {
    const plug: Plug = {
      headHeight: convertLength(geo.plug.headHeight, from, to),
      insertionDepth: convertLength(geo.plug.insertionDepth, from, to)
    }
    next.plug = plug
  }

  if (geo.locatingShoulder) {
    const shoulder: LocatingShoulder = {
      ...geo.locatingShoulder,
      minDepth: convertLength(geo.locatingShoulder.minDepth, from, to)
    }
    next.locatingShoulder = shoulder
  }

  if (geo.outline) {
    let nextParams = geo.outline.params
    if (nextParams) {
      const p: Record<string, unknown> = { ...nextParams }
      const dimKeys = [
        'width',
        'height',
        'cornerRadius',
        'diameter',
        'a',
        'b',
        'earRadius',
        'waistWidth',
        'boltDia',
        'offsetX',
        'offsetY'
      ]
      for (const k of dimKeys) {
        if (typeof p[k] === 'number') {
          p[k] = convertLength(p[k] as number, from, to)
        }
      }
      nextParams = p
    }

    next.outline = {
      ...geo.outline,
      data:
        (geo.outline.format === 'svg-path' || geo.outline.format === 'rect') && geo.outline.data
          ? scaleSvgPath(geo.outline.data, scaleFactor)
          : geo.outline.data,
      params: nextParams
    }
  }

  return next
}

/**
 * 转换元件包围盒参数
 */
export function convertComponentBoxes(
  boxes: ComponentBox[] | undefined,
  from: 'mm' | 'in',
  to: 'mm' | 'in'
): ComponentBox[] | undefined {
  if (!boxes || from === to) return boxes

  return boxes.map((b): ComponentBox => {
    const offsetX = b.offsetX != null ? convertLength(b.offsetX, from, to) : undefined
    const offsetY = b.offsetY != null ? convertLength(b.offsetY, from, to) : undefined

    if (b.shape === 'box') {
      return {
        ...b,
        offsetX,
        offsetY,
        size: {
          x: convertLength(b.size.x, from, to),
          y: convertLength(b.size.y, from, to),
          z: convertLength(b.size.z, from, to)
        }
      }
    }

    return {
      ...b,
      offsetX,
      offsetY,
      diameter: convertLength(b.diameter, from, to),
      height: convertLength(b.height, from, to)
    }
  })
}

/**
 * 转换组合孔子孔列表（Hole[]）
 * - 笛卡尔坐标：x、y 均参与长度换算；
 * - 极坐标：x（极径 r）换算，y（极角 θ）不换算；
 * - 内联子孔：内联几何（geometry）随父模板换算；
 * - 子孔空间姿态角（tiltAngle 倾斜角、azimuth 方位角）不换算。
 */
export function convertHoles(
  holes: Hole[] | undefined,
  polar: boolean,
  from: 'mm' | 'in',
  to: 'mm' | 'in'
): Hole[] | undefined {
  if (!holes || from === to) return holes

  return holes.map((h) => {
    const newX = convertLength(h.x, from, to)
    const newY = polar ? h.y : convertLength(h.y, from, to)
    const newGeometry = h.geometry ? convertGeometry(h.geometry, from, to) : h.geometry

    return {
      ...h,
      x: newX,
      y: newY,
      geometry: newGeometry
    }
  })
}

/**
 * 转换孔腔模板整体（CavityTemplate）
 * @param template 目标模板
 * @param targetUnit 目标单位 ('mm' | 'in')
 * @param mode 'convert' 换算数值保持物理尺寸 | 'reinterpret' 重新解释数值（数值不变仅更改单位）
 */
export function convertTemplate(
  template: CavityTemplate,
  targetUnit: 'mm' | 'in',
  mode: 'convert' | 'reinterpret'
): CavityTemplate {
  if (template.unit === targetUnit) return template

  if (mode === 'reinterpret') {
    return {
      ...template,
      unit: targetUnit
    }
  }

  const from = template.unit
  const polar = template.geometry.layout?.polar ?? false
  const combo = isComboType(template.cavityType)

  const next: CavityTemplate = {
    ...template,
    unit: targetUnit,
    geometry: convertGeometry(template.geometry, from, targetUnit),
    componentBoxes: convertComponentBoxes(template.componentBoxes, from, targetUnit)
  }

  if (combo) {
    next.holes = convertHoles(template.holes, polar, from, targetUnit) ?? []
  } else {
    delete next.holes
  }

  return next
}
