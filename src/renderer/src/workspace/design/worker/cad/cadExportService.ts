/**
 * CAD B-Rep 建模与 STEP 导出核心流水线
 * 对齐 PRD-FR-04-07 §3 规范：
 * 1. 构建基体长方体实体 (MakeBoxFromPntAndDims)；
 * 2. 构造孔腔旋转体 (Cylinder / Cone frustum) 并应用 4x4 世界空间变换矩阵；
 * 3. 循环执行 B-Rep 差集切削 (BRepAlgoAPI_Cut) 并做容错兜底；
 * 4. 实时计算阶段进度；
 * 5. 使用 STEPControl_Writer 序列化生成 AP214 / AP203 / AP242 标准 STEP 文本。
 */

import { stepEffectiveLength, taperedEndRadius } from '@shared/cavity/geometry'
import type { Step } from '@shared/cavity/types'

export interface CavityBand {
  z0: number
  z1: number
  r0: number
  r1: number
  length: number
}

export interface CadExportParams {
  taskId?: number
  exportConfig: {
    protocol: 'AP214' | 'AP203' | 'AP242'
    tolerance: number
    colorPorts: boolean
  }
  baseBody: {
    type?: 'template' | 'step'
    template?: 'box' | 'l-shape' | 't-shape'
    dimensions: [number, number, number]
    extraParams?: Record<string, number>
    stepContent?: Uint8Array | string
  }
  cavities: Array<{
    instanceId: string
    numericId: number
    worldMatrix: number[]
    steps: Step[]
    name?: string
    color?: string
  }>
}

/**
 * 构建初始基体实体 (支持标准长方体、L型基体、T型基体以及外部导入的复杂 STEP 实体)
 */
export function buildBaseSolid(baseBody: CadExportParams['baseBody'], occ: any): any {
  // 1. 若为外部导入的任意复杂 STEP 基体
  if (baseBody.type === 'step' || baseBody.stepContent) {
    if (!baseBody.stepContent) {
      throw new Error('导入基体模式下未提供有效的 stepContent 数据')
    }
    const bytes =
      typeof baseBody.stepContent === 'string'
        ? new TextEncoder().encode(baseBody.stepContent)
        : baseBody.stepContent
    const importedShape = occ.ReadSTEPFromBinary(bytes)
    if (!importedShape || importedShape.IsNull()) {
      throw new Error('解析导入的基体 STEP 实体失败，几何体无效')
    }
    return importedShape
  }

  // 2. 参数化模板基体 (Box / L-Shape / T-Shape)
  const [sx, sy, sz] = baseBody.dimensions
  if (sx <= 0 || sy <= 0 || sz <= 0) {
    throw new Error(`基体尺寸必须均为正数，当前为: [${sx}, ${sy}, ${sz}]`)
  }

  const pnt0 = new occ.gp_Pnt(0, 0, 0)
  const mainBox = occ.MakeBoxFromPntAndDims(pnt0, sx, sy, sz)
  pnt0.delete()

  if (baseBody.template === 'l-shape') {
    // 构造 L 型基体 (自原点长方体挖去右上角台阶，生成严格的 8 面 L 型 B-Rep 实体)
    const cutX = baseBody.extraParams?.cutX ?? sx * 0.4
    const cutZ = baseBody.extraParams?.cutZ ?? sz * 0.5
    const cutPnt = new occ.gp_Pnt(sx - cutX, 0, sz - cutZ)
    const cutBox = occ.MakeBoxFromPntAndDims(cutPnt, cutX, sy, cutZ)
    cutPnt.delete()

    const cut = new occ.BRepAlgoAPI_Cut(mainBox, cutBox)
    cut.Build()
    if (cut.IsDone() && !cut.Shape().IsNull()) {
      const lShape = cut.Shape()
      cut.delete()
      mainBox.delete()
      cutBox.delete()
      return lShape
    }
    cut.delete()
    cutBox.delete()
    return mainBox
  }

  if (baseBody.template === 't-shape') {
    // 构造 T 型基体 (底部左右挖去两侧翼缘下凹槽，生成标准的 10 面 T 型凸台实体)
    const cutX = baseBody.extraParams?.cutX ?? sx * 0.25
    const cutZ = baseBody.extraParams?.cutZ ?? sz * 0.5

    // 左侧凹槽
    const pntLeft = new occ.gp_Pnt(0, 0, 0)
    const cutLeft = occ.MakeBoxFromPntAndDims(pntLeft, cutX, sy, cutZ)
    pntLeft.delete()

    // 右侧凹槽
    const pntRight = new occ.gp_Pnt(sx - cutX, 0, 0)
    const cutRight = occ.MakeBoxFromPntAndDims(pntRight, cutX, sy, cutZ)
    pntRight.delete()

    const fuseCuts = new occ.BRepAlgoAPI_Fuse(cutLeft, cutRight)
    fuseCuts.Build()
    let cutsTool = cutLeft
    if (fuseCuts.IsDone() && !fuseCuts.Shape().IsNull()) {
      cutsTool = fuseCuts.Shape()
      fuseCuts.delete()
      cutLeft.delete()
      cutRight.delete()
    } else {
      fuseCuts.delete()
    }

    const cut = new occ.BRepAlgoAPI_Cut(mainBox, cutsTool)
    cut.Build()
    if (cut.IsDone() && !cut.Shape().IsNull()) {
      const tShape = cut.Shape()
      cut.delete()
      mainBox.delete()
      cutsTool.delete()
      return tShape
    }
    cut.delete()
    cutsTool.delete()
    return mainBox
  }

  return mainBox
}

/** 解析孔腔台阶分段参数 */
export function parseBands(steps: Step[]): CavityBand[] {
  if (!steps || steps.length === 0) {
    return [
      { z0: 0, z1: 8, r0: 9, r1: 9, length: 8 },
      { z0: 8, z1: 25, r0: 5, r1: 5, length: 17 },
      { z0: 25, z1: 28, r0: 5, r1: 0, length: 3 }
    ]
  }

  const bands: CavityBand[] = []
  let curZ = 0
  for (const s of steps) {
    const dia = Number(s.diameter)
    const r0 = Math.max(0, dia / 2)
    const effLen = Math.max(0, stepEffectiveLength(s))
    let r1 = r0
    if (s.type === 'tapered') {
      r1 = s.length == null ? 0 : Math.max(0, taperedEndRadius(dia, s.length, s.angle ?? 118))
    }
    bands.push({
      z0: curZ,
      z1: curZ + effLen,
      r0,
      r1,
      length: effLen
    })
    curZ += effLen
  }
  return bands
}

/** 解析孔腔特征签名，用于 B-Rep 原型池复用 */
export function getCavityStepSignature(steps: Step[]): string {
  if (!steps || steps.length === 0) return 'empty'
  return steps
    .map(
      (s) =>
        `${s.type}:${s.diameter}:${s.length ?? 'null'}:${s.angle ?? 'null'}:${s.thread ?? 'null'}`
    )
    .join('|')
}

/** 构造局部坐标系原点处的孔腔旋转实体 (未经空间变换) */
export function buildLocalCavitySolid(bands: CavityBand[], occ: any): any {
  const bandShapes: any[] = []
  for (const b of bands) {
    if (b.length <= 1e-4) continue
    if (b.r0 <= 1e-4 && b.r1 <= 1e-4) continue

    const pnt = new occ.gp_Pnt(0, 0, b.z0)
    const dir = new occ.gp_Dir(0, 0, 1)
    const ax = new occ.gp_Ax2(pnt, dir)

    let segmentShape: any
    if (Math.abs(b.r0 - b.r1) < 1e-4) {
      // 圆柱体
      const cylMaker = new occ.BRepPrimAPI_MakeCylinder(ax, b.r0, b.length)
      segmentShape = cylMaker.Shape()
      cylMaker.delete()
    } else {
      // 圆台 / 圆锥体
      const coneMaker = occ.MakeConeFromAx2
        ? occ.MakeConeFromAx2(ax, b.r0, b.r1, b.length)
        : new occ.BRepPrimAPI_MakeCone(ax, b.r0, b.r1, b.length, 2 * Math.PI)
      segmentShape = coneMaker?.Shape()
      coneMaker?.delete()
    }

    pnt.delete()
    dir.delete()
    ax.delete()

    if (segmentShape && !segmentShape.IsNull()) {
      bandShapes.push(segmentShape)
    }
  }

  if (bandShapes.length === 0) return null

  // 在局部坐标系下合并所有台阶分段
  let localCavSolid = bandShapes[0]
  for (let k = 1; k < bandShapes.length; k++) {
    const fuse = new occ.BRepAlgoAPI_Fuse(localCavSolid, bandShapes[k])
    fuse.Build()
    if (fuse.IsDone() && !fuse.Shape().IsNull()) {
      const fusedShape = fuse.Shape()
      fuse.delete()
      localCavSolid.delete()
      bandShapes[k].delete()
      localCavSolid = fusedShape
    } else {
      fuse.delete()
      bandShapes[k].delete()
    }
  }

  return localCavSolid
}

/**
 * 分层平衡二叉合并树 (Hierarchical Balanced Fuse Tree)
 * 将 O(N^2) 的串行累积切削复杂度彻底降维为 O(N log N)
 */
export function fuseShapesHierarchically(
  shapes: any[],
  occ: any,
  onProgress?: (ratio: number, level: number, totalLevels: number) => void
): any[] {
  let currentLevel = shapes
  const totalLevels = Math.ceil(Math.log2(Math.max(1, shapes.length)))
  let levelIdx = 0

  while (currentLevel.length > 1) {
    const nextLevel: any[] = []
    let mergedCountInLevel = 0

    for (let k = 0; k < currentLevel.length; k += 2) {
      if (k + 1 < currentLevel.length) {
        const s1 = currentLevel[k]
        const s2 = currentLevel[k + 1]

        let fused: any = null
        try {
          const fuse = new occ.BRepAlgoAPI_Fuse(s1, s2)
          fuse.Build()
          if (fuse.IsDone() && !fuse.Shape().IsNull()) {
            fused = fuse.Shape()
            fuse.delete()
            s1.delete()
            s2.delete()
            mergedCountInLevel++
          } else {
            fuse.delete()
          }
        } catch {
          // 容错降级
        }

        if (fused) {
          nextLevel.push(fused)
        } else {
          // 若个别实体无法两两归并，安全保留到下一层或作为独立工具体切除
          nextLevel.push(s1)
          nextLevel.push(s2)
        }
      } else {
        nextLevel.push(currentLevel[k])
      }
    }

    levelIdx++
    if (onProgress) {
      const ratio = Math.min(1, levelIdx / Math.max(1, totalLevels))
      onProgress(ratio, levelIdx, totalLevels)
    }

    // 若本层没有任何两个实体可归并，跳出避免死循环
    if (mergedCountInLevel === 0) {
      currentLevel = nextLevel
      break
    }

    currentLevel = nextLevel
  }

  return currentLevel
}

/**
 * 核心 STEP 导出管线纯函数 (高性能二叉归并与原型池化架构)
 */
export async function generateStepContent(
  params: CadExportParams,
  occ: any,
  onProgress?: (progress: number, stage: string) => void
): Promise<string> {
  const { exportConfig, baseBody, cavities } = params

  onProgress?.(15, '正在构建基体实体 (Base Solid)...')

  // 1. 构建基体实体 (支持 Box, L-Shape, T-Shape 与导入 STEP)
  let solidShape = buildBaseSolid(baseBody, occ)

  const totalCavities = cavities.length

  if (totalCavities > 0) {
    // 2. 阶段一：基于 B-Rep 原型池批量生成各个孔腔实例实体 (已变换至世界坐标系)
    onProgress?.(20, `正在准备 ${totalCavities} 个孔腔 B-Rep 原型与变换实体...`)
    const protoMap = new Map<string, any>()
    const worldCavitySolids: any[] = []

    try {
      for (let i = 0; i < totalCavities; i++) {
        const cav = cavities[i]
        const sig = getCavityStepSignature(cav.steps)

        // 获取或构建原型
        let proto = protoMap.get(sig)
        if (!proto) {
          const bands = parseBands(cav.steps)
          proto = buildLocalCavitySolid(bands, occ)
          if (proto) {
            protoMap.set(sig, proto)
          }
        }

        if (!proto) continue

        // 应用 4x4 世界空间变换矩阵 (Three.js 列优先矩阵)
        let [m0, m1, m2, _m3, m4, m5, m6, _m7, m8, m9, m10, _m11, m12, m13, m14] = cav.worldMatrix

        // 检查 3x3 旋转子矩阵行列式，校正为 SO(3) 刚体正交旋转
        const det =
          m0 * (m5 * m10 - m6 * m9) -
          m4 * (m1 * m10 - m2 * m9) +
          m8 * (m1 * m6 - m2 * m5)

        if (det < 0) {
          m4 = -m4
          m5 = -m5
          m6 = -m6
        }

        const trsf = new occ.gp_Trsf()
        trsf.SetValues(
          m0, m4, m8, m12,
          m1, m5, m9, m13,
          m2, m6, m10, m14
        )

        // 复制变换实例 (Copy = true 保持原型完好)
        const transformMaker = new occ.BRepBuilderAPI_Transform(proto, trsf, true)
        const worldCavSolid = transformMaker.Shape()
        transformMaker.delete()
        trsf.delete()

        if (worldCavSolid && !worldCavSolid.IsNull()) {
          worldCavitySolids.push(worldCavSolid)
        }
      }
    } finally {
      // 释放所有原型局部实体占用的内存
      for (const proto of protoMap.values()) {
        proto.delete()
      }
      protoMap.clear()
    }

    // 3. 阶段二：分层平衡二叉合并树 (Hierarchical Balanced Fuse Tree)
    // 将全部孔腔工具实体自底向上归并，避免 N 次高面数累积求交
    if (worldCavitySolids.length > 0) {
      onProgress?.(25, `正在执行孔腔分层平衡归并 (1/${worldCavitySolids.length})...`)

      const mergedTools = fuseShapesHierarchically(
        worldCavitySolids,
        occ,
        (ratio, level, totalLevels) => {
          const p = 25 + Math.round(ratio * 45) // 25% -> 70%
          onProgress?.(p, `正在执行孔腔分层平衡归并 (第 ${level}/${totalLevels} 层)...`)
        }
      )

      // 4. 阶段三：对基体执行集中切除 (仅需极少数甚至 1 次布尔差)
      onProgress?.(72, `正在执行基体集中布尔差集切削...`)
      for (let t = 0; t < mergedTools.length; t++) {
        const tool = mergedTools[t]
        const cut = new occ.BRepAlgoAPI_Cut(solidShape, tool)
        cut.Build()
        if (cut.IsDone() && !cut.Shape().IsNull()) {
          const newSolid = cut.Shape()
          cut.delete()
          solidShape.delete()
          tool.delete()
          solidShape = newSolid
        } else {
          cut.delete()
          tool.delete()
          console.warn(`[CadExportService] 组合孔腔工具体切削未生效或几何退化 (tool ${t + 1})`)
        }
      }
    }
  }

  // 3. 序列化导出 STEP 文件
  onProgress?.(90, `正在序列化 STEP 实体模型 (${exportConfig.protocol})...`)

  const writer = new occ.STEPControl_Writer()
  const transferRes = writer.Transfer(solidShape, occ.STEPControl_StepModelType.AsIs)

  if (transferRes !== occ.IFSelect_ReturnStatus.RetDone) {
    writer.delete()
    solidShape.delete()
    throw new Error('STEPControl_Writer.Transfer 实体转换失败')
  }

  const tempFileName = `sureflow_export_${Date.now()}_${Math.floor(Math.random() * 100000)}.step`
  const writeRes = writer.Write(tempFileName)

  if (writeRes !== occ.IFSelect_ReturnStatus.RetDone) {
    writer.delete()
    solidShape.delete()
    throw new Error('STEPControl_Writer.Write 文件写入失败')
  }

  let stepText = occ.FS.readFile('/' + tempFileName, { encoding: 'utf8' })
  occ.FS.unlink('/' + tempFileName)
  writer.delete()
  solidShape.delete()

  // 协议头定制与元数据注入
  if (exportConfig.protocol === 'AP203') {
    stepText = stepText.replace(
      /FILE_SCHEMA\s*\(\s*\(\s*'AUTOMOTIVE_DESIGN[^']*'\s*\)\s*\);/g,
      "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));"
    )
  } else if (exportConfig.protocol === 'AP242') {
    stepText = stepText.replace(
      /FILE_SCHEMA\s*\(\s*\(\s*'AUTOMOTIVE_DESIGN[^']*'\s*\)\s*\);/g,
      "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 242 1 1 1 1 }'));"
    )
  }

  // 补充 SureFlow 工业级描述头
  stepText = stepText.replace(
    /FILE_DESCRIPTION\s*\(\s*\([^)]*\)\s*,\s*'[^']*'\s*\);/,
    `FILE_DESCRIPTION(('SureFlow Hydraulic Valve Block CAD Export', 'Protocol: ${exportConfig.protocol}', 'Tolerance: ${exportConfig.tolerance}mm'), '2;1');`
  )

  onProgress?.(100, 'STEP 实体模型生成完毕！')
  return stepText
}
