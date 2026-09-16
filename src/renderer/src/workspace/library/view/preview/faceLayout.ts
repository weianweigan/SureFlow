/**
 * 安装面布局图元算法（组合孔预览）
 *
 * outline（SVG path，安装面局部笛卡尔坐标，Y 向上）+ 子孔位置圆点
 * （按 layout.polar 解释，引用子孔实时解析半径）。
 */

import { holePlacement, resolveHole, type HolePlacement } from '../../model/documentOps'
import type { RefResolveContext } from '../../model/documentOps'
import type { CavityTemplate, Geometry, Hole } from '@shared/cavity/types'

export interface FaceHole extends HolePlacement {
  /** 预览圆半径（取解析几何最大台阶半径；失效引用回退固定小圆） */
  radius: number
  /** 引用失效提示 */
  unresolved?: string
  /** 已解析的子孔几何模型 */
  geometry?: Geometry | null
  /** 原始子孔定义 */
  rawHole?: Hole
}

export interface FaceBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface FaceModel {
  outlinePath: string
  holes: FaceHole[]
  /** 布局包围半径（自动 fit 用） */
  extent: number
  /** 安装面坐标范围包围盒 */
  bounds: FaceBounds
}

export function getFaceBounds(model: FaceModel): FaceBounds {
  return model.bounds
}

export function buildFaceLayout(
  template: CavityTemplate,
  ctx: RefResolveContext
): FaceModel {
  const polar = template.geometry.layout?.polar ?? false
  const outlinePath = template.geometry.outline?.data ?? ''

  let extent = 10
  const holes: FaceHole[] = []

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  const resolveCtx: RefResolveContext = {
    ...ctx,
    parentUnit: ctx.parentUnit ?? template.unit ?? 'mm'
  }

  for (const h of template.holes ?? []) {
    const p = holePlacement(h, polar)
    let radius = 2
    let unresolved: string | undefined
    let geometry: Geometry | null = null
    const r = resolveHole(h, resolveCtx)
    if (r.ok) {
      geometry = r.geometry
      const maxD = Math.max(0, ...(r.geometry.steps ?? []).map((s) => s.diameter))
      radius = maxD / 2
    } else {
      unresolved = r.reason
    }
    extent = Math.max(extent, Math.abs(p.cx) + radius, Math.abs(p.cy) + radius)
    minX = Math.min(minX, p.cx - radius)
    maxX = Math.max(maxX, p.cx + radius)
    minY = Math.min(minY, p.cy - radius)
    maxY = Math.max(maxY, p.cy + radius)
    holes.push({ ...p, radius, unresolved, geometry, rawHole: h })
  }

  // outline 的 extent 与包围盒用粗略数值扫描（提取 path 中的坐标极值）
  const nums = outlinePath.match(/-?\d+(?:\.\d+)?/g)
  if (nums) {
    const vals = nums.map(Number)
    for (let i = 0; i + 1 < vals.length; i += 2) {
      const vx = vals[i]
      const vy = vals[i + 1]
      extent = Math.max(extent, Math.abs(vx), Math.abs(vy))
      minX = Math.min(minX, vx)
      maxX = Math.max(maxX, vx)
      minY = Math.min(minY, vy)
      maxY = Math.max(maxY, vy)
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    minX = -extent
    maxX = extent
    minY = -extent
    maxY = extent
  } else {
    // 保底包含原点与微小安全边距
    minX = Math.min(minX, -2)
    maxX = Math.max(maxX, 2)
    minY = Math.min(minY, -2)
    maxY = Math.max(maxY, 2)
  }

  return {
    outlinePath,
    holes,
    extent: extent * 1.15,
    bounds: { minX, maxX, minY, maxY }
  }
}
