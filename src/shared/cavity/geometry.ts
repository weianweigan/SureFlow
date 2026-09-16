/**
 * 几何计算纯函数（PRD-002 §8.1 段长语义 / §8.4 极坐标约定）
 *
 * 计算空间统一 mm（§7.1）；本文件不做单位换算，只做几何求解。
 */

import type { Step } from './types'

/**
 * 锥段收尖长度求解（R-S5）：L = (d/2) / tan(angle/2)
 * 用于 length === null 的 tapered 段。
 */
export function solveTaperTipLength(diameter: number, angleDeg: number): number {
  const d = Number(diameter)
  const ang = Number(angleDeg)
  const halfAngleRad = ((ang / 2) * Math.PI) / 180
  return d / 2 / Math.tan(halfAngleRad)
}

/** 锥段指定段长的末端半径：r = d/2 - length·tan(angle/2)（R-S7，不收尖） */
export function taperedEndRadius(diameter: number, length: number, angleDeg: number): number {
  const d = Number(diameter)
  const len = Number(length)
  const ang = Number(angleDeg)
  const halfAngleRad = ((ang / 2) * Math.PI) / 180
  return Math.max(0, d / 2 - len * Math.tan(halfAngleRad))
}

/** 单段有效长度（null 段用锥角求解值代入） */
export function stepEffectiveLength(step: Step): number {
  if (step.length != null) return Number(step.length)
  return solveTaperTipLength(Number(step.diameter), step.angle != null ? Number(step.angle) : 118)
}

/** 台阶起点深度（自安装面累计）：start(i) = Σ length[0..i-1] */
export function stepStartDepth(steps: Step[], index: number): number {
  let z = 0
  for (let i = 0; i < index && i < steps.length; i++) z += stepEffectiveLength(steps[i])
  return z
}

/** 总孔深 = Σ 有效段长 */
export function totalDepth(steps: Step[]): number {
  return steps.reduce((z, s) => z + stepEffectiveLength(s), 0)
}

/** 极坐标 → 笛卡尔（§8.4：0° = +X，逆时针为正；x=半径 mm，y=角度 度） */
export function polarToCartesian(x: number, y: number): { cx: number; cy: number } {
  const rad = (y * Math.PI) / 180
  return { cx: x * Math.cos(rad), cy: x * Math.sin(rad) }
}
