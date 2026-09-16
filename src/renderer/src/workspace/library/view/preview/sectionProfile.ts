/**
 * 台阶剖面几何算法（PRD-002 §8.1 段长语义）
 *
 * 生成半剖面折线：安装面 z=0，沿孔轴向内（+z）为深度方向，
 * 半径 r 自轴线量起。tapered 段 length=null 时按锥角收尖求解。
 */

import { solveTaperTipLength, stepEffectiveLength, taperedEndRadius } from '@shared/cavity/geometry'
import type { Geometry, Port, Step, ThreadSpec } from '@shared/cavity/types'

export interface StepBand {
  index: number
  type: 'straight' | 'tapered'
  /** 起点半径（= diameter/2） */
  r0: number
  /** 终点半径（straight 同 r0；tapered 收敛） */
  r1: number
  /** 起点累计深度 */
  z0: number
  /** 终点累计深度 */
  z1: number
  /** 有效段长（null 段代入求解值） */
  effLength: number
  /** 原始段长（null 表示收尖） */
  length: number | null
  diameter: number
  angle?: number
  hasThread: boolean
  thread?: ThreadSpec | null
}

export interface SectionModel {
  bands: StepBand[]
  /** 总孔深 */
  totalDepth: number
  /** 最大半径（含安全边距前） */
  maxRadius: number
  ports: Port[]
}

export function buildSection(geometry: Geometry): SectionModel | null {
  const steps: Step[] | undefined = geometry.steps
  if (!steps || steps.length === 0) return null

  const bands: StepBand[] = []
  let z = 0
  let maxR = 0
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const dia = Number(s.diameter)
    const r0 = dia / 2
    const eff = stepEffectiveLength(s)
    let r1 = r0
    if (s.type === 'tapered') {
      r1 = s.length == null ? 0 : taperedEndRadius(dia, s.length, s.angle ?? 118)
    }
    bands.push({
      index: i,
      type: s.type,
      r0,
      r1,
      z0: z,
      z1: z + eff,
      effLength: eff,
      length: s.length != null ? Number(s.length) : null,
      diameter: dia,
      angle: s.angle != null ? Number(s.angle) : undefined,
      hasThread: s.thread != null,
      thread: s.thread ?? null
    })
    z += eff
    maxR = Math.max(maxR, r0)
  }
  return { bands, totalDepth: z, maxRadius: maxR, ports: geometry.ports ?? [] }
}

/** 锥段收尖求解值（标注用） */
export function tipSolveLength(step: Step): number {
  return solveTaperTipLength(step.diameter, step.angle ?? 118)
}
