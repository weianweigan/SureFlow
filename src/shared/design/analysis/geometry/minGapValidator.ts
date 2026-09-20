/**
 * 双轨校验与防退化监控模块 (Dual-Track Validation & Anti-Degradation Monitor)
 * 严格对齐 PRD-FR-04-15 规范与 Manifold-3D 工业级 CSG 拓扑基准：
 * 
 * 1. 轨道一 (Track 1 - 解析几何轨)：毫秒级求解端点 (pointA, pointB)、方向、法向与装配实体拓扑
 * 2. 轨道二 (Track 2 - Manifold minGap 轨)：高鲁棒性 CSG 流形实体真值净距计算，消灭轴向假想球包络/锥尖退化
 * 3. 双轨融合与对齐：
 *    - 穿透/相交校验：若 minGap == 0，强制矫正 relation 为 intersecting/contacting，消除漏报
 *    - 假相交/假连通校验：若解析几何因端点重叠误判连通，minGap > 0 时强制矫正为 separated 并更新真值净距
 *    - 精度防退化监控：记录 gapDiscrepancy，对超出弦高/离散容差 (>0.05mm) 的偏差记录告警并对齐
 */

import { profileBands } from '../../cavityGeometry'
import { getBoxFaceBasis, getCavityWorldMatrix } from '../../faceMath'
import { getFacesForTemplate } from '../../types'
import type { CavityInstance, BaseFaceDefinition } from '../../types'
import type { Step } from '../../../cavity/types'
import type { ActiveClearanceResult, CheckIssue, CheckObservation } from '../contracts'

/**
 * 将孔腔台阶转换为连续圆台/圆柱分段并在 Manifold 中构建 3D 水密旋转实体
 */
export function buildCavitySolid(
  manifoldModule: any,
  cavity: CavityInstance,
  dimensions: [number, number, number],
  baseBody?: any,
  segments: number = 32
): any {
  const { Manifold } = manifoldModule
  const steps: Step[] = cavity.steps && cavity.steps.length > 0
    ? cavity.steps
    : [{ type: 'straight', diameter: 10, length: 20 }]

  const bands = profileBands(steps)
  const parts: any[] = []

  for (const b of bands) {
    if (b.length <= 1e-4) continue
    // cylinder(height, radiusLow, radiusHigh, circularSegments, center)
    const cyl = Manifold.cylinder(b.length, b.r0, b.r1, segments, false)
    const translated = cyl.translate([0, 0, b.z0])
    parts.push(translated)
  }

  const localSolid = parts.length === 0
    ? Manifold.cylinder(10, 5, 5, segments, false)
    : parts.length === 1
      ? parts[0]
      : Manifold.union(parts)

  // 释放多余分段
  if (parts.length > 1) {
    for (const p of parts) {
      try { p.delete() } catch { /* ignore */ }
    }
  }

  const basis = getBoxFaceBasis(cavity.faceId, dimensions, baseBody)
  const mat = Array.from(
    getCavityWorldMatrix(
      basis,
      cavity.u,
      cavity.v,
      cavity.depthOffset,
      cavity.rotation,
      cavity.tiltAngle,
      cavity.azimuth
    )
  )

  const worldSolid = localSolid.transform(mat)
  try { localSolid.delete() } catch { /* ignore */ }

  return worldSolid
}

/**
 * 构建用于测试外表面间隙的外向无限厚度/标准厚度 (20mm) 平面实体平板 (Slab)
 */
export function buildFaceSlabSolid(
  manifoldModule: any,
  face: BaseFaceDefinition,
  dimensions: [number, number, number]
): any {
  const { Manifold } = manifoldModule
  const [sx, sy, sz] = dimensions
  const fid = (face.id || '').toLowerCase()
  const slabThick = 20

  if (fid.includes('top') || fid === '+z') {
    return Manifold.cube([sx, sy, slabThick], false).translate([0, 0, sz])
  }
  if (fid.includes('bot') || fid === '-z') {
    return Manifold.cube([sx, sy, slabThick], false).translate([0, 0, -slabThick])
  }
  if (fid.includes('front') || fid === '-y') {
    return Manifold.cube([sx, slabThick, sz], false).translate([0, -slabThick, 0])
  }
  if (fid.includes('back') || fid === '+y') {
    return Manifold.cube([sx, slabThick, sz], false).translate([0, sy, 0])
  }
  if (fid.includes('left') || fid === '-x') {
    return Manifold.cube([slabThick, sy, sz], false).translate([-slabThick, 0, 0])
  }
  if (fid.includes('right') || fid === '+x') {
    return Manifold.cube([slabThick, sy, sz], false).translate([sx, 0, 0])
  }

  // 通用凸外法向平板回退
  const ox = face.origin ? face.origin[0] : 0
  const oy = face.origin ? face.origin[1] : 0
  const oz = face.origin ? face.origin[2] : 0
  return Manifold.cube([sx, sy, slabThick], false).translate([ox, oy, oz])
}

/**
 * 单个主动间隙结果的 Manifold minGap 双轨校验与修正
 */
export function validateActiveClearanceWithMinGap(
  manifoldModule: any,
  result: ActiveClearanceResult,
  cavityMap: Map<string, CavityInstance>,
  dimensions: [number, number, number],
  baseBody?: any,
  solidCache?: Map<string, any>
): ActiveClearanceResult {
  if (!manifoldModule?.Manifold) return result

  const getOrBuildSolid = (ref: any): any => {
    const key = ref.kind === 'cavity' ? `cav_${ref.instanceId}` : `face_${ref.faceId}`
    if (solidCache?.has(key)) return solidCache.get(key)

    let solid: any = null
    if (ref.kind === 'cavity') {
      const cav = cavityMap.get(ref.instanceId)
      if (cav) {
        solid = buildCavitySolid(manifoldModule, cav, dimensions, baseBody, 48)
      }
    } else if (ref.kind === 'base-face') {
      const faces = getFacesForTemplate(baseBody?.template || 'box', dimensions, baseBody?.extraParams)
      const f = faces.find((face: BaseFaceDefinition) => face.id === ref.faceId)
      if (f) {
        solid = buildFaceSlabSolid(manifoldModule, f, dimensions)
      }
    }

    if (solidCache && solid) {
      solidCache.set(key, solid)
    }
    return solid
  }

  const solidA = getOrBuildSolid(result.objectA)
  const solidB = getOrBuildSolid(result.objectB)

  if (!solidA || !solidB) return result

  try {
    const searchLimit = Math.max(100, (result.dist || 0) + 30)
    const gap = solidA.minGap(solidB, searchLimit)
    const gapRounded = Number(gap.toFixed(2))

    const validated: ActiveClearanceResult = {
      ...result,
      minGap: gapRounded,
      verifiedByMinGap: true,
      gapDiscrepancy: Number(Math.abs(result.dist - gap).toFixed(3))
    }

    // 1. 穿透/相交校验
    if (gap <= 1e-4) {
      validated.dist = 0
      if (validated.relation === 'separated') {
        validated.relation = 'intersecting'
      }
      return validated
    }

    // 2. 假连通/假接触修正
    if (result.relation === 'contacting' || result.relation === 'intersecting') {
      if (gap > 0.05) {
        validated.dist = gapRounded
        validated.relation = 'separated'
      }
    } else {
      // 3. 正常分离状态：当与 minGap 偏差显著 (>0.05mm) 时，以 CSG 实体真值为准进行对齐
      if (Math.abs(result.dist - gap) > 0.05) {
        validated.dist = gapRounded
      }
    }

    return validated
  } catch (err) {
    console.warn('[minGapValidator] minGap 校验执行异常:', err)
    return result
  }
}

/**
 * 批量主动间隙结果的双轨校验与防退化处理 (带 Solid 缓存管控)
 */
export function validateMultipleActiveClearancesWithMinGap(
  manifoldModule: any,
  results: ActiveClearanceResult[],
  cavities: CavityInstance[],
  dimensions: [number, number, number],
  baseBody?: any
): ActiveClearanceResult[] {
  if (!manifoldModule?.Manifold || !results || results.length === 0) {
    return results
  }

  const solidCache = new Map<string, any>()
  const cavityMap = new Map<string, CavityInstance>()
  for (const c of cavities) {
    cavityMap.set(c.instanceId, c)
  }

  try {
    return results.map((r) =>
      validateActiveClearanceWithMinGap(manifoldModule, r, cavityMap, dimensions, baseBody, solidCache)
    )
  } finally {
    // 零泄漏释放全部缓存的 Manifold 实体
    for (const solid of solidCache.values()) {
      try {
        solid.delete()
      } catch {
        // ignore
      }
    }
    solidCache.clear()
  }
}

/**
 * 对 CLR-001 (孔间壁厚) 与 CLR-002 (孔到外表面壁厚) 的问题和观察结果进行 minGap 双轨校验与防退化监控
 */
export function validateIssuesWithMinGap(
  manifoldModule: any,
  issues: CheckIssue[],
  observations: CheckObservation[],
  cavities: CavityInstance[],
  dimensions: [number, number, number],
  baseBody?: any
): { issues: CheckIssue[]; observations: CheckObservation[] } {
  if (!manifoldModule?.Manifold) {
    return { issues, observations }
  }

  const solidCache = new Map<string, any>()
  const cavityMap = new Map<string, CavityInstance>()
  for (const c of cavities) {
    cavityMap.set(c.instanceId, c)
  }

  const getOrBuildSolid = (ref: any): any => {
    const key = ref.kind === 'cavity' ? `cav_${ref.instanceId}` : `face_${ref.faceId}`
    if (solidCache.has(key)) return solidCache.get(key)

    let solid: any = null
    if (ref.kind === 'cavity') {
      const cav = cavityMap.get(ref.instanceId)
      if (cav) {
        solid = buildCavitySolid(manifoldModule, cav, dimensions, baseBody, 48)
      }
    } else if (ref.kind === 'base-face') {
      const faces = getFacesForTemplate(baseBody?.template || 'box', dimensions, baseBody?.extraParams)
      const f = faces.find((face: BaseFaceDefinition) => face.id === ref.faceId)
      if (f) {
        solid = buildFaceSlabSolid(manifoldModule, f, dimensions)
      }
    }

    if (solid) {
      solidCache.set(key, solid)
    }
    return solid
  }

  try {
    // 校验与对齐 issues
    const validatedIssues: CheckIssue[] = []
    for (const issue of issues) {
      if (issue.ruleId === 'CLR-001' || issue.ruleId === 'CLR-002') {
        const refs = issue.evidence?.refs || []
        const refA = refs[0]
        const refB = refs[1]
        if (refA && refB) {
          const solidA = getOrBuildSolid(refA)
          const solidB = getOrBuildSolid(refB)
          if (solidA && solidB) {
            const gap = solidA.minGap(solidB, 50)
            const gapRounded = Number(gap.toFixed(2))
            const threshold = issue.requirements?.[0]?.value ?? 5.0
            // 若实测 minGap 大于等于阈值，说明解析几何计算存在假阳性，排除该 issue
            if (gap >= threshold - 0.05) {
              continue
            }
            // 对齐实测测量值
            if (issue.measurements && issue.measurements.length > 0) {
              issue.measurements[0].value = gapRounded
            }
          }
        }
      }
      validatedIssues.push(issue)
    }

    // 校验与对齐 observations
    for (const obs of observations) {
      if (obs.ruleId === 'CLR-001' || obs.ruleId === 'CLR-002') {
        const refs = obs.refs || obs.evidence?.refs || []
        const refA = refs[0]
        const refB = refs[1]
        if (refA && refB) {
          const solidA = getOrBuildSolid(refA)
          const solidB = getOrBuildSolid(refB)
          if (solidA && solidB) {
            const gap = solidA.minGap(solidB, 50)
            const gapRounded = Number(gap.toFixed(2))
            if (obs.measurements && obs.measurements.length > 0) {
              obs.measurements[0].value = gapRounded
            }
          }
        }
      }
    }

    return { issues: validatedIssues, observations }
  } catch (err) {
    console.warn('[minGapValidator] issues minGap 校验异常:', err)
    return { issues, observations }
  } finally {
    for (const solid of solidCache.values()) {
      try {
        solid.delete()
      } catch {
        // ignore
      }
    }
    solidCache.clear()
  }
}
