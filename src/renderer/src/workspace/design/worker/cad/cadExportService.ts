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
import type { Step, Port } from '@shared/cavity/types'

export interface CavityBand {
  z0: number
  z1: number
  r0: number
  r1: number
  length: number
}

/**
 * 从孔腔台阶中解析首个内嵌螺纹规格字符串 (例如 "G1/2-14(深15)" 或 "M14x1.5(深12)")
 */
export function extractCavityThreadSpec(steps?: Step[]): string | undefined {
  if (!steps || steps.length === 0) return undefined
  for (const s of steps) {
    if (s.thread) {
      const th = s.thread
      const des = th.designation || (s.diameter ? `M${s.diameter}` : '')
      const depthStr = th.depth != null ? `(深${th.depth})` : ''
      return `${des}${depthStr}`.trim()
    }
  }
  return undefined
}

/**
 * STEP 物理文件字符串转义 (单引号转双单引号)
 */
export function escapeStepString(str?: string): string {
  if (!str) return ''
  return str.replace(/'/g, "''")
}

export interface CadExportParams {
  taskId?: number
  exportConfig: {
    protocol: 'AP214' | 'AP203' | 'AP242'
    tolerance: number
    colorPorts: boolean
    /** 是否将基体设置为半透明 (默认 true) */
    transparentBaseBody?: boolean
    /** 是否将安装面设置为半透明 (默认 true) */
    mountingFacesTransparent?: boolean
    /** 透明度数值 (0.0 完全不透明 ~ 1.0 完全透明，默认 0.7) */
    transparency?: number
    /** 是否开启规范化拓扑重排与语义命名 (默认 true) */
    stableTopology?: boolean
  }
  baseBody: {
    type?: 'template' | 'step'
    template?: 'box' | 'l-shape' | 't-shape'
    dimensions: [number, number, number]
    extraParams?: Record<string, number>
    stepContent?: Uint8Array | string
    color?: string
  }
  cavities: Array<{
    instanceId: string
    numericId: number
    worldMatrix: number[]
    steps: Step[]
    ports?: Port[]
    name?: string
    color?: string
    channelId?: string
    channelColor?: string
    channelName?: string
    /** 模板标识 (如 "sun-t-11a", "sae-j1926-1-g12") */
    templateId?: string
    /** 模板名称 (如 "Sun T-11A 2通阀孔") */
    templateName?: string
    /** 库 ID */
    libraryId?: string
    /** 孔腔类型 (如 "cartridge-valve", "bolt-hole") */
    cavityType?: string
    /** 所在安装面代码 (如 "MOUNTING_FACE_TOP") */
    faceId?: string
    /** 面局部坐标 U (mm) */
    u?: number
    /** 面局部坐标 V (mm) */
    v?: number
    /** 螺纹规格描述 */
    threadSpec?: string
    /** 油口语义标识 (如 "P", "T", "A", "B") */
    portSemantic?: string
  }>
  channels?: Array<{
    id: string
    name: string
    color: string
    cavityIds: string[]
    regions?: Array<{ cavityId: string; portIndex?: number; minDepth: number; maxDepth: number }>
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

  // 4. 阶段四：拓扑规范化重排、语义命名与 AP214/AP242 透明度与通道着色表现层注入
  onProgress?.(95, '正在规范化拓扑顺序并注入透明度与通道着色样式...')
  stepText = stabilizeStepTopologyAndStyle(stepText, params)

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

/**
 * 十六进制颜色转归一化 RGB 浮点数 [0, 1]
 */
function hexToNormalizedRgb(hex: string): [number, number, number] {
  let clean = (hex || '').replace('#', '').trim()
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('')
  }
  if (clean.length !== 6) {
    return [0.65, 0.68, 0.72]
  }
  const r = parseInt(clean.substring(0, 2), 16) / 255
  const g = parseInt(clean.substring(2, 4), 16) / 255
  const b = parseInt(clean.substring(4, 6), 16) / 255
  return [
    Math.round(r * 10000) / 10000,
    Math.round(g * 10000) / 10000,
    Math.round(b * 10000) / 10000
  ]
}

/**
 * 确保浮点数在 STEP 中带有小数点
 */
function formatStepReal(num: number): string {
  const str = num.toFixed(4)
  return str.includes('.') ? str : str + '.'
}

/**
 * 核心后处理流水线：
 * 1. 规范化重排 CLOSED_SHELL 中的面拓扑（安装面 Top/Bottom/Front/Back/Left/Right 严格置顶且顺序固定，孔腔面按深度单调递增排列）；
 * 2. 为 ADVANCED_FACE 注入持久化语义名称（消除微调导致的下游 CAD 配合丢失）；
 * 3. 构造 ISO 10303 标准表现层（基体及安装面半透明 SURFACE_STYLE_TRANSPARENT，通道面按通道鲜明着色 COLOUR_RGB）。
 */
export function stabilizeStepTopologyAndStyle(rawStep: string, params: CadExportParams): string {
  const { exportConfig, baseBody, cavities, channels } = params
  const transparentBase = exportConfig.transparentBaseBody ?? true
  const mountingTransparent = exportConfig.mountingFacesTransparent ?? true
  const transparency = exportConfig.transparency ?? 0.7
  const colorPorts = exportConfig.colorPorts ?? true
  const stableTopology = exportConfig.stableTopology ?? true

  const dataStartIdx = rawStep.indexOf('DATA;')
  const dataEndIdx = rawStep.indexOf('ENDSEC;', dataStartIdx)
  if (dataStartIdx === -1 || dataEndIdx === -1) return rawStep

  const dataSection = rawStep.substring(dataStartIdx + 5, dataEndIdx)

  // 1. 提取所有实体
  const entityRegex = /#(\d+)\s*=\s*([\s\S]*?);/g
  let match: RegExpExecArray | null
  const entityMap = new Map<number, string>()
  let maxId = 0

  while ((match = entityRegex.exec(dataSection)) !== null) {
    const id = parseInt(match[1], 10)
    entityMap.set(id, match[2].trim())
    if (id > maxId) maxId = id
  }

  // 2. 辅助解析工具函数
  function getPoint(id: number): [number, number, number] | null {
    const text = entityMap.get(id)
    if (!text) return null
    const m = text.match(
      /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)\s*\)/
    )
    if (m) return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]
    return null
  }

  function getDirection(id: number): [number, number, number] | null {
    const text = entityMap.get(id)
    if (!text) return null
    const m = text.match(
      /DIRECTION\s*\(\s*'[^']*'\s*,\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)\s*\)/
    )
    if (m) return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]
    return null
  }

  function getAxis2(id: number): { point: [number, number, number]; axis: [number, number, number] } | null {
    const text = entityMap.get(id)
    if (!text) return null
    const m = text.match(/AXIS2_PLACEMENT_3D\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*,\s*#(\d+)/)
    if (m) {
      const p = getPoint(parseInt(m[1], 10))
      const a = getDirection(parseInt(m[2], 10))
      if (p && a) return { point: p, axis: a }
    }
    return null
  }

  let manifoldSolidBrepId: number | null = null
  let closedShellId: number | null = null
  let contextId: number | null = null
  let prodDefShapeId: number | null = null
  let shellFaceIds: number[] = []

  for (const [id, text] of entityMap.entries()) {
    if (!manifoldSolidBrepId && text.startsWith('MANIFOLD_SOLID_BREP')) {
      manifoldSolidBrepId = id
      const m = text.match(/MANIFOLD_SOLID_BREP\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*\)/)
      if (m) closedShellId = parseInt(m[1], 10)
    }
    if (!closedShellId && text.startsWith('CLOSED_SHELL')) {
      closedShellId = id
    }
    if (!prodDefShapeId && text.startsWith('PRODUCT_DEFINITION_SHAPE')) {
      prodDefShapeId = id
    }
    if (!contextId && (text.includes('GEOMETRIC_REPRESENTATION_CONTEXT') || text.includes('GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT'))) {
      contextId = id
    }
  }

  if (closedShellId) {
    const shellText = entityMap.get(closedShellId) || ''
    const m = shellText.match(/CLOSED_SHELL\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)/)
    if (m) {
      shellFaceIds = m[1].split(',').map((s) => parseInt(s.trim().replace('#', ''), 10))
    }
  }

  if (shellFaceIds.length === 0) {
    return rawStep
  }

  // 4. 解析孔腔空间几何与归属通道
  const [sx, sy, sz] = baseBody.dimensions
  interface CavityGeo {
    instanceId: string
    numericId: number
    name: string
    mouth: [number, number, number]
    axis: [number, number, number]
    totalDepth: number
    maxRadius: number
    bands: CavityBand[]
    coloredRanges: Array<{ minDepth: number; maxDepth: number; color: string }>
    templateId?: string
    templateName?: string
    libraryId?: string
    cavityType?: string
    faceId?: string
    u?: number
    v?: number
    threadSpec?: string
    channelName?: string
    portSemantic?: string
    steps: Step[]
    ports?: Port[]
  }

  const cavityGeos: CavityGeo[] = cavities.map((c) => {
    const wm = c.worldMatrix
    const mouth: [number, number, number] = [wm[12], wm[13], wm[14]]
    let ax: [number, number, number] = [wm[8], wm[9], wm[10]]
    const axLen = Math.hypot(ax[0], ax[1], ax[2])
    if (axLen > 1e-6) {
      ax = [ax[0] / axLen, ax[1] / axLen, ax[2] / axLen]
    } else {
      ax = [0, 0, 1]
    }

    const bands = parseBands(c.steps)
    const totalDepth = bands.length > 0 ? bands[bands.length - 1].z1 : 30
    const maxRadius = Math.max(...bands.map((b) => Math.max(b.r0, b.r1)), 5)

    // 计算 @Port 端口有效轴向范围 (按 PRD-12 §5.1 & §8)
    const ports = c.ports || []
    const computedPortRegions = ports.flatMap((p, pIdx) => {
      const isBottom = Boolean(p.isBottomPort ?? p.through)
      if (!Number.isFinite(p.depth) || p.depth < 0 || p.depth > totalDepth || (!isBottom && !(Number(p.diameter) > 0))) {
        return []
      }
      const min = Math.max(0, isBottom ? p.depth : p.depth - Number(p.diameter) / 2)
      const max = Math.min(totalDepth, isBottom ? totalDepth : p.depth + Number(p.diameter) / 2)
      return [{ portIndex: pIdx, minDepth: min, maxDepth: max }]
    })

    // 匹配包含该孔腔的回路通道
    const matchedChannels = channels?.filter((ch) => ch.cavityIds.includes(c.instanceId)) || []

    const coloredRanges: Array<{ minDepth: number; maxDepth: number; color: string }> = []
    for (const ch of matchedChannels) {
      const explicitRegions = ch.regions?.filter((r) => r.cavityId === c.instanceId)
      if (explicitRegions && explicitRegions.length > 0) {
        for (const r of explicitRegions) {
          coloredRanges.push({ minDepth: r.minDepth, maxDepth: r.maxDepth, color: ch.color })
        }
      } else if (computedPortRegions.length > 0) {
        // 多端口阀腔且未显式指定子区间：对连通通道所属端口区间赋予通道颜色
        for (const pr of computedPortRegions) {
          coloredRanges.push({ minDepth: pr.minDepth, maxDepth: pr.maxDepth, color: ch.color })
        }
      } else {
        // 普通钻孔无额外 @Port：整孔全长按通道着色
        coloredRanges.push({ minDepth: 0, maxDepth: totalDepth + 5, color: ch.color })
      }
    }

    // 若未匹配到通道但显式提供了 channelColor (如手动指定)，且非结构孔
    if (coloredRanges.length === 0 && c.channelColor) {
      if (computedPortRegions.length > 0) {
        for (const pr of computedPortRegions) {
          coloredRanges.push({ minDepth: pr.minDepth, maxDepth: pr.maxDepth, color: c.channelColor })
        }
      } else {
        coloredRanges.push({ minDepth: 0, maxDepth: totalDepth + 5, color: c.channelColor })
      }
    }

    const threadSpec = c.threadSpec || extractCavityThreadSpec(c.steps)

    return {
      instanceId: c.instanceId,
      numericId: c.numericId,
      name: c.name || c.instanceId,
      mouth,
      axis: ax,
      totalDepth,
      maxRadius,
      bands,
      coloredRanges,
      templateId: c.templateId,
      templateName: c.templateName,
      libraryId: c.libraryId,
      cavityType: c.cavityType,
      faceId: c.faceId,
      u: c.u,
      v: c.v,
      threadSpec,
      channelName: c.channelName,
      portSemantic: c.portSemantic,
      steps: c.steps,
      ports: c.ports
    }
  })

  // 5. 分类每个面
  interface ClassifiedFace {
    id: number
    origText: string
    boundsStr: string
    surfId: number
    sameSense: string
    category: 'mounting' | 'cavity' | 'other'
    mountingRank: number
    name: string
    cavityIdx: number
    depth: number
    color: string | null
    surfType: string
    normal: [number, number, number]
    offset: number
    refPoint: [number, number, number]
    cavityGeo?: CavityGeo
  }

  const classifiedFaces: ClassifiedFace[] = []

  for (const fId of shellFaceIds) {
    const fText = entityMap.get(fId) || ''
    const m = fText.match(
      /ADVANCED_FACE\s*\(\s*'[^']*'\s*,\s*(\([^)]*\))\s*,\s*#(\d+)\s*,\s*\.([TF])\.\s*\)/
    )
    if (!m) continue

    const boundsStr = m[1]
    const surfId = parseInt(m[2], 10)
    const sameSense = m[3]
    const surfText = entityMap.get(surfId) || ''

    let category: 'mounting' | 'cavity' | 'other' = 'other'
    let mountingRank = 99
    let name = `FACE_${fId}`
    let cavityIdx = 9999
    let depth = 0
    let color: string | null = null
    let surfType = surfText.split('(')[0].trim()

    const axis2Match = surfText.match(/#(\d+)/)
    const axis2 = axis2Match ? getAxis2(parseInt(axis2Match[1], 10)) : null

    const refPoint: [number, number, number] = axis2?.point || [0, 0, 0]
    const normal: [number, number, number] = axis2?.axis || [0, 0, 1]
    const offset = normal[0] * refPoint[0] + normal[1] * refPoint[1] + normal[2] * refPoint[2]

    // 优先判定内部孔腔面（圆柱孔壁、台阶台面、圆锥倒角或孔底）
    let matchedCav: CavityGeo | null = null
    let matchedT = 0
    let matchedType = 'STEP'
    let bestDist = Infinity

    if (axis2) {
      const { point: p, axis: a } = axis2

      for (let i = 0; i < cavityGeos.length; i++) {
        const cav = cavityGeos[i]
        const dot = Math.abs(a[0] * cav.axis[0] + a[1] * cav.axis[1] + a[2] * cav.axis[2])
        if (dot < 0.95) continue

        const vx = p[0] - cav.mouth[0]
        const vy = p[1] - cav.mouth[1]
        const vz = p[2] - cav.mouth[2]
        const t = vx * cav.axis[0] + vy * cav.axis[1] + vz * cav.axis[2]
        const perpDist = Math.hypot(
          vx - t * cav.axis[0],
          vy - t * cav.axis[1],
          vz - t * cav.axis[2]
        )

        if (surfText.startsWith('CYLINDRICAL_SURFACE') || surfText.startsWith('CONICAL_SURFACE')) {
          if (perpDist < 0.5 && t >= -0.5 && t <= cav.totalDepth + 5) {
            if (perpDist < bestDist) {
              bestDist = perpDist
              matchedCav = cav
              matchedT = t
              matchedType = surfText.startsWith('CONICAL') ? 'CONE' : 'CYL'
            }
          }
        } else if (surfText.startsWith('PLANE')) {
          // 孔底或孔内台阶肩面 (需排除孔口基体外表面，仅匹配孔深 t > 0.1 的孔底/台阶面)
          if (perpDist <= cav.maxRadius + 1.0 && t >= 0.1 && t <= cav.totalDepth + 5) {
            if (perpDist < bestDist) {
              bestDist = perpDist
              matchedCav = cav
              matchedT = t
              matchedType = Math.abs(t - cav.totalDepth) < 1.0 ? 'BOTTOM' : 'SHOULDER'
            }
          }
        }
      }
    }

    if (matchedCav) {
      category = 'cavity'
      cavityIdx = matchedCav.numericId
      depth = matchedT

      let faceZ0 = matchedT
      let faceZ1 = matchedT
      if (surfText.startsWith('CYLINDRICAL_SURFACE') || surfText.startsWith('CONICAL_SURFACE')) {
        const radMatch = surfText.match(/CYLINDRICAL_SURFACE\s*\(\s*'[^']*'\s*,\s*#\d+\s*,\s*([-\d.eE+]+)\s*\)/)
        const faceRad = radMatch ? parseFloat(radMatch[1]) : 0
        const matchedBand =
          matchedCav.bands.find((b) => Math.abs(b.z0 - matchedT) < 1.0) ||
          matchedCav.bands.find((b) => Math.abs(b.r0 - faceRad) < 0.5 || Math.abs(b.r1 - faceRad) < 0.5)
        if (matchedBand) {
          faceZ0 = matchedBand.z0
          faceZ1 = matchedBand.z1
        } else {
          faceZ1 = matchedT + 5
        }
      }

      // 按照 @Port 与通道深度区间判断是否染色 (区间相交重叠判定)
      const hitRange = matchedCav.coloredRanges.find(
        (r) => Math.max(faceZ0, r.minDepth) <= Math.min(faceZ1, r.maxDepth) + 0.1
      )
      color = hitRange ? hitRange.color : null
      const cleanCavName = matchedCav.name.replace(/[^\w-]/g, '_')

      // 构造结构化语义名称，包含模板与制造信息标记 (方便下游 CAD 直接查看与宏引线提取)
      const nameParts = [`CAV_${cleanCavName}_${matchedType}_${Math.round(depth)}`]
      if (matchedCav.templateId) {
        nameParts.push(`TPL:${matchedCav.templateId.replace(/['\\|]/g, '_')}`)
      }
      if (matchedCav.threadSpec) {
        nameParts.push(`SPEC:${matchedCav.threadSpec.replace(/['\\|]/g, '_')}`)
      } else if (matchedCav.steps && matchedCav.steps.length > 0) {
        const dia = matchedCav.steps[0].diameter
        nameParts.push(`DIA:${dia}`)
      }
      if (matchedCav.channelName) {
        nameParts.push(`NET:${matchedCav.channelName.replace(/['\\|]/g, '_')}`)
      }
      if (matchedCav.portSemantic) {
        nameParts.push(`PORT:${matchedCav.portSemantic.replace(/['\\|]/g, '_')}`)
      }
      name = nameParts.join('|')
    } else {
      // 任何不属于孔腔切削刃具的面，严格归属为基体外表面（支持任意复杂形状及导入 STEP 基体）
      category = 'mounting'
      color = null // 基体外表面使用透明 BaseBodyStyle，不染通道色

      if (surfText.startsWith('PLANE') && axis2) {
        const { point: p, axis: a } = axis2
        const [nx, ny, nz] = a

        // 判定是否属于标准长方体 6 面 (Top, Bottom, Front, Back, Left, Right)
        if (Math.abs(nz) > 0.95) {
          if (Math.abs(p[2] - sz) < 0.05) {
            mountingRank = 1
            name = 'MOUNTING_FACE_TOP'
          } else if (Math.abs(p[2]) < 0.05) {
            mountingRank = 2
            name = 'MOUNTING_FACE_BOTTOM'
          }
        } else if (Math.abs(ny) > 0.95) {
          if (Math.abs(p[1]) < 0.05) {
            mountingRank = 3
            name = 'MOUNTING_FACE_FRONT'
          } else if (Math.abs(p[1] - sy) < 0.05) {
            mountingRank = 4
            name = 'MOUNTING_FACE_BACK'
          }
        } else if (Math.abs(nx) > 0.95) {
          if (Math.abs(p[0]) < 0.05) {
            mountingRank = 5
            name = 'MOUNTING_FACE_LEFT'
          } else if (Math.abs(p[0] - sx) < 0.05) {
            mountingRank = 6
            name = 'MOUNTING_FACE_RIGHT'
          }
        }
      }

      // 非标准 6 面的任意基体外表面 (T型凹槽、L型台阶、十字型凸耳、外部导入复杂 STEP 等)
      if (mountingRank === 99) {
        mountingRank = 10
        name = `BASE_FACE_${fId}`
      }
    }

    classifiedFaces.push({
      id: fId,
      origText: fText,
      boundsStr,
      surfId,
      sameSense,
      category,
      mountingRank,
      name,
      cavityIdx,
      depth,
      color,
      surfType,
      normal,
      offset,
      refPoint,
      cavityGeo: matchedCav || undefined
    })
  }

  // 6. 拓扑规范化重排 (Canonical Shell Reordering)
  let orderedFaces = classifiedFaces
  if (stableTopology) {
    orderedFaces = [...classifiedFaces].sort((fa, fb) => {
      // 类别优先级：基体外表面 (0) -> 孔腔内部面 (1) -> 其他交汇面 (2)
      const catRank = { mounting: 0, cavity: 1, other: 2 }
      if (catRank[fa.category] !== catRank[fb.category]) {
        return catRank[fa.category] - catRank[fb.category]
      }

      // 基体外表面拓扑规范化排序
      if (fa.category === 'mounting') {
        const aStd = fa.mountingRank <= 6
        const bStd = fb.mountingRank <= 6
        if (aStd || bStd) {
          if (fa.mountingRank !== fb.mountingRank) {
            return fa.mountingRank - fb.mountingRank
          }
        }

        // 任意多面体基体外表面几何确定性排序：
        // 1. 法向 nz, ny, nx 降序 (保留 3 位精度抗浮点扰动)
        const q = (v: number) => Math.round(v * 1000)
        const nza = q(fa.normal[2]), nzb = q(fb.normal[2])
        if (nza !== nzb) return nzb - nza

        const nya = q(fa.normal[1]), nyb = q(fb.normal[1])
        if (nya !== nyb) return nyb - nya

        const nxa = q(fa.normal[0]), nxb = q(fb.normal[0])
        if (nxa !== nxb) return nxb - nxa

        // 2. 平面偏移量 d = n · p 降序
        const da = q(fa.offset), db = q(fb.offset)
        if (da !== db) return db - da

        // 3. 参考点坐标 (pz, py, px) 降序
        const pza = q(fa.refPoint[2]), pzb = q(fb.refPoint[2])
        if (pza !== pzb) return pzb - pza

        const pya = q(fa.refPoint[1]), pyb = q(fb.refPoint[1])
        if (pya !== pyb) return pyb - pya

        const pxa = q(fa.refPoint[0]), pxb = q(fb.refPoint[0])
        if (pxa !== pxb) return pxb - pxa

        return fa.id - fb.id
      }

      // 孔腔内部面按照孔腔 ID 升序，孔内深度深度单调递增
      if (fa.category === 'cavity') {
        if (fa.cavityIdx !== fb.cavityIdx) {
          return fa.cavityIdx - fb.cavityIdx
        }
        if (Math.abs(fa.depth - fb.depth) > 0.05) {
          return fa.depth - fb.depth
        }
        return fa.surfType === 'CYLINDRICAL_SURFACE' ? -1 : 1
      }

      return fa.id - fb.id
    })

    // 对排好序的非标准外表面按顺序规范化语义命名
    let extBaseCount = 1
    for (const f of orderedFaces) {
      if (f.category === 'mounting' && f.mountingRank > 6) {
        f.name = `BASE_FACE_${extBaseCount++}`
      }
    }
  }

  // 7. 构造表现层样式与 STYLED_ITEM (AP214 / AP242 Presentation)
  const newEntities: string[] = []
  let nextId = maxId + 1
  const allocId = () => nextId++

  const styledItemIds: number[] = []

  // (A) 基体及安装面半透明样式 (符合 ISO 10303-46 规范并兼容 SolidWorks)
  if (transparentBase) {
    const baseRgb = hexToNormalizedRgb(baseBody.color || '#A0A4A8')
    const colId = allocId()
    newEntities.push(`#${colId} = COLOUR_RGB('BaseBodyColour', ${formatStepReal(baseRgb[0])}, ${formatStepReal(baseRgb[1])}, ${formatStepReal(baseRgb[2])});`)

    const fillColId = allocId()
    newEntities.push(`#${fillColId} = FILL_AREA_STYLE_COLOUR('', #${colId});`)

    const fillStyleId = allocId()
    newEntities.push(`#${fillStyleId} = FILL_AREA_STYLE('', (#${fillColId}));`)

    const surfFillId = allocId()
    newEntities.push(`#${surfFillId} = SURFACE_STYLE_FILL_AREA(#${fillStyleId});`)

    const surfTransId = allocId()
    const transClamped = Math.max(0, Math.min(1, transparency))
    newEntities.push(`#${surfTransId} = SURFACE_STYLE_TRANSPARENT(${formatStepReal(transClamped)});`)

    // ISO 10303-46: surface_side_style 要求 styles 包含 surface_style_rendering (用 SURFACE_STYLE_RENDERING_WITH_PROPERTIES 包装透明度)
    const renderingId = allocId()
    newEntities.push(`#${renderingId} = SURFACE_STYLE_RENDERING_WITH_PROPERTIES(.COLOUR_SHADING., #${colId}, (#${surfTransId}));`)

    const sideStyleId = allocId()
    newEntities.push(`#${sideStyleId} = SURFACE_SIDE_STYLE('', (#${surfFillId}, #${renderingId}));`)

    const styleUsageId = allocId()
    newEntities.push(`#${styleUsageId} = SURFACE_STYLE_USAGE(.BOTH., #${sideStyleId});`)

    const presStyleId = allocId()
    newEntities.push(`#${presStyleId} = PRESENTATION_STYLE_ASSIGNMENT((#${styleUsageId}));`)

    // 绑定至实体级 MANIFOLD_SOLID_BREP
    if (manifoldSolidBrepId) {
      const solidItemId = allocId()
      newEntities.push(`#${solidItemId} = STYLED_ITEM('BaseBodySolidStyle', (#${presStyleId}), #${manifoldSolidBrepId});`)
      styledItemIds.push(solidItemId)
    }

    // 绑定至各个安装面 ADVANCED_FACE（面级透明双重保障，确保 SolidWorks 正确渲染）
    if (mountingTransparent) {
      for (const f of orderedFaces) {
        if (f.category === 'mounting') {
          const mountItemId = allocId()
          newEntities.push(`#${mountItemId} = STYLED_ITEM('MountingFaceStyle', (#${presStyleId}), #${f.id});`)
          styledItemIds.push(mountItemId)
        }
      }
    }
  }

  // (B) 各通道及油口特征面鲜明着色样式 (仅对具有有效通道颜色的孔面着色)
  if (colorPorts) {
    // 按颜色归类孔腔面 (过滤掉 color 为空的孤立孔、结构孔及非端口区间)
    const colorFaceMap = new Map<string, number[]>()
    for (const f of orderedFaces) {
      if (f.category === 'cavity' && f.color) {
        const c = f.color.toUpperCase()
        if (!colorFaceMap.has(c)) colorFaceMap.set(c, [])
        colorFaceMap.get(c)!.push(f.id)
      }
    }

    for (const [hexColor, faceIds] of colorFaceMap.entries()) {
      const [cr, cg, cb] = hexToNormalizedRgb(hexColor)
      const colId = allocId()
      newEntities.push(`#${colId} = COLOUR_RGB('ChannelColour_${hexColor.replace('#', '')}', ${formatStepReal(cr)}, ${formatStepReal(cg)}, ${formatStepReal(cb)});`)

      const fillColId = allocId()
      newEntities.push(`#${fillColId} = FILL_AREA_STYLE_COLOUR('', #${colId});`)

      const fillStyleId = allocId()
      newEntities.push(`#${fillStyleId} = FILL_AREA_STYLE('', (#${fillColId}));`)

      const surfFillId = allocId()
      newEntities.push(`#${surfFillId} = SURFACE_STYLE_FILL_AREA(#${fillStyleId});`)

      const sideStyleId = allocId()
      newEntities.push(`#${sideStyleId} = SURFACE_SIDE_STYLE('', (#${surfFillId}));`)

      const styleUsageId = allocId()
      newEntities.push(`#${styleUsageId} = SURFACE_STYLE_USAGE(.BOTH., #${sideStyleId});`)

      const presStyleId = allocId()
      newEntities.push(`#${presStyleId} = PRESENTATION_STYLE_ASSIGNMENT((#${styleUsageId}));`)

      for (const faceId of faceIds) {
        const itemFaceId = allocId()
        newEntities.push(`#${itemFaceId} = STYLED_ITEM('ChannelFaceStyle', (#${presStyleId}), #${faceId});`)
        styledItemIds.push(itemFaceId)
      }
    }
  }

  // (C) 聚合至装配表现容器 MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION
  if (styledItemIds.length > 0 && contextId) {
    const repId = allocId()
    const styledList = styledItemIds.map((id) => `#${id}`).join(',')
    newEntities.push(
      `#${repId} = MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('SureFlow Presentation Style', (${styledList}), #${contextId});`
    )
  }

  // (D) 孔腔面特征元数据属性组与制造规格标注 (ISO 10303-41 Property Definitions)
  const targetDefId = prodDefShapeId || manifoldSolidBrepId
  if (contextId && targetDefId) {
    const cavityFacesMap = new Map<number, { geo: CavityGeo; faceIds: number[] }>()
    for (const f of orderedFaces) {
      if (f.category === 'cavity' && f.cavityGeo) {
        const cavId = f.cavityGeo.numericId
        if (!cavityFacesMap.has(cavId)) {
          cavityFacesMap.set(cavId, { geo: f.cavityGeo, faceIds: [] })
        }
        cavityFacesMap.get(cavId)!.faceIds.push(f.id)
      }
    }

    for (const [cavNumericId, { geo, faceIds }] of cavityFacesMap.entries()) {
      const propDefId = allocId()
      const cleanName = escapeStepString(geo.name)
      newEntities.push(
        `#${propDefId} = PROPERTY_DEFINITION('CavityTraceability_${cavNumericId}', 'SureFlow Cavity Specification for ${cleanName}', #${targetDefId});`
      )

      const itemIds: number[] = []

      // 关联的实体面
      for (const fId of faceIds) {
        itemIds.push(fId)
      }

      // 键值属性集
      const addProp = (key: string, value?: string | number) => {
        if (value === undefined || value === null || value === '') return
        const itemId = allocId()
        newEntities.push(
          `#${itemId} = DESCRIPTIVE_REPRESENTATION_ITEM('${escapeStepString(key)}', '${escapeStepString(String(value))}');`
        )
        itemIds.push(itemId)
      }

      addProp('SureFlow:InstanceId', geo.instanceId)
      addProp('SureFlow:HoleName', geo.name)
      addProp('SureFlow:TemplateId', geo.templateId)
      addProp('SureFlow:TemplateName', geo.templateName)
      addProp('SureFlow:LibraryId', geo.libraryId)
      addProp('SureFlow:CavityType', geo.cavityType)
      addProp('SureFlow:HostFace', geo.faceId)
      if (geo.u !== undefined && geo.v !== undefined) {
        addProp('SureFlow:PositionUV', `U=${geo.u.toFixed(2)}, V=${geo.v.toFixed(2)}`)
      }
      addProp('SureFlow:ThreadSpec', geo.threadSpec)
      addProp('SureFlow:TotalDepth', `${geo.totalDepth.toFixed(2)}mm`)
      addProp('SureFlow:ChannelName', geo.channelName)
      addProp('SureFlow:PortSemantic', geo.portSemantic)

      const repId = allocId()
      const itemsList = itemIds.map((id) => `#${id}`).join(',')
      newEntities.push(
        `#${repId} = REPRESENTATION('Cavity Aspect Representation', (${itemsList}), #${contextId});`
      )

      const defRepId = allocId()
      newEntities.push(
        `#${defRepId} = PROPERTY_DEFINITION_REPRESENTATION(#${propDefId}, #${repId});`
      )
    }

    // (E) 全局孔腔清册与反查元数据 (Global Cavity Manifest)
    if (cavityGeos.length > 0) {
      const manifestData = {
        generator: 'SureFlow Hydraulic Manifold CAD Export',
        exportedAt: new Date().toISOString(),
        baseBodyDimensions: baseBody.dimensions,
        cavities: cavityGeos.map((cg) => ({
          instanceId: cg.instanceId,
          numericId: cg.numericId,
          name: cg.name,
          templateId: cg.templateId,
          templateName: cg.templateName,
          libraryId: cg.libraryId,
          cavityType: cg.cavityType,
          faceId: cg.faceId,
          u: cg.u,
          v: cg.v,
          threadSpec: cg.threadSpec,
          totalDepth: cg.totalDepth,
          channelName: cg.channelName,
          portSemantic: cg.portSemantic,
          steps: cg.steps,
          ports: cg.ports
        }))
      }

      const manifestJson = JSON.stringify(manifestData)
      const globalPropDefId = allocId()
      newEntities.push(
        `#${globalPropDefId} = PROPERTY_DEFINITION('SureFlow:CavityManifest', 'Complete Cavity and Template Manifest', #${targetDefId});`
      )

      const manifestItemId = allocId()
      newEntities.push(
        `#${manifestItemId} = DESCRIPTIVE_REPRESENTATION_ITEM('ManifestJson', '${escapeStepString(manifestJson)}');`
      )

      const manifestRepId = allocId()
      newEntities.push(
        `#${manifestRepId} = REPRESENTATION('Cavity Manifest Representation', (#${manifestItemId}), #${contextId});`
      )

      const manifestDefRepId = allocId()
      newEntities.push(
        `#${manifestDefRepId} = PROPERTY_DEFINITION_REPRESENTATION(#${globalPropDefId}, #${manifestRepId});`
      )
    }
  }

  // 8. 重写 DATA 区段中的 CLOSED_SHELL、ADVANCED_FACE 与追加样式实体
  let updatedData = dataSection

  // (1) 更新 CLOSED_SHELL 面引用顺序
  if (closedShellId && stableTopology) {
    const sortedListStr = orderedFaces.map((f) => `#${f.id}`).join(',')
    const shellRegex = new RegExp(`(#${closedShellId}\\s*=\\s*CLOSED_SHELL\\s*\\(\\s*'[^']*'\\s*,\\s*\\()[^)]*(\\)\\s*\\)\\s*;)`)
    updatedData = updatedData.replace(shellRegex, `$1${sortedListStr}$2`)
  }

  // (2) 更新每个 ADVANCED_FACE 的持久化语义命名
  for (const f of orderedFaces) {
    const faceRegex = new RegExp(`(#${f.id}\\s*=\\s*ADVANCED_FACE\\s*\\(\\s*')([^']*)('\\s*,)`)
    updatedData = updatedData.replace(faceRegex, `$1${f.name}$3`)
  }

  // (3) 追加新生成的样式实体
  if (newEntities.length > 0) {
    updatedData = updatedData.trimEnd() + '\n' + newEntities.join('\n') + '\n'
  }

  return rawStep.substring(0, dataStartIdx + 5) + updatedData + rawStep.substring(dataEndIdx)
}

