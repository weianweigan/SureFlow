/**
 * 基于 @bitbybit-dev/occt 的统一 CAD B-Rep 基体构造器与拓扑表面抽取服务
 *
 * 核心设计原则（对齐 PRD-FR-04-03）：
 * 1. 所有基体（长方体、L型、T型、STEP 导入等）均由 OpenCASCADE 构建为实体 (TopoDS_Solid)；
 * 2. 拓扑面完全由 OCCT B-Rep 细分 (ShapeToMeshJson) 析出，杜绝几何区间硬编码猜测；
 * 3. 提取所有拓扑面的单位外法向、几何中心、世界原点投影面坐标系 (O_face, U, V, W)；
 * 4. 为每个拓扑面分配参数化推拉绑定关系 (paramBinding)，使面推拉（Push/Pull）与基体几何严格联动。
 */

import type { BaseBodyConfig, BaseFaceDefinition } from '@shared/design/types'

export interface OcctBRepMeshResult {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  edgePositions?: Float32Array
  /** 每个三角形所属的面索引 (与 faces 数组下标 1-1 对应) */
  faceTags: Uint32Array
  faces: BaseFaceDefinition[]
}

function cleanZero(n: number): number {
  const rounded = Math.round(n * 1000) / 1000
  return Object.is(rounded, -0) || Math.abs(rounded) < 1e-9 ? 0 : rounded
}

/**
 * 构建初始基体 CAD 实体 (TopoDS_Solid)
 */
export function buildOcctBaseSolid(baseBody: Partial<BaseBodyConfig>, occ: any): any {
  // 1. 若为外部导入的任意复杂 STEP 基体
  if (baseBody.type === 'step' || baseBody.stepContent) {
    if (!baseBody.stepContent) {
      throw new Error('导入基体模式下未提供有效的 stepContent 数据')
    }
    const bytes =
      typeof baseBody.stepContent === 'string'
        ? new TextEncoder().encode(baseBody.stepContent)
        : (baseBody.stepContent as any)
    const importedShape = occ.ReadSTEPFromBinary(bytes)
    if (!importedShape || importedShape.IsNull()) {
      throw new Error('解析导入的基体 STEP 实体失败，几何体无效')
    }
    return importedShape
  }

  // 2. 参数化模板基体 (Box / L-Shape / T-Shape)
  const dims = baseBody.dimensions || [120, 100, 80]
  const [sx, sy, sz] = dims
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

    const pntLeft = new occ.gp_Pnt(0, 0, 0)
    const cutLeft = occ.MakeBoxFromPntAndDims(pntLeft, cutX, sy, cutZ)
    pntLeft.delete()

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

  if (baseBody.template === 'cross-shape') {
    // 构造十字型基体 (切除 4 个角部区域)
    const cutX = baseBody.extraParams?.cutX ?? sx * 0.25
    const cutZ = baseBody.extraParams?.cutZ ?? sz * 0.25

    const pntBotLeft = new occ.gp_Pnt(0, 0, 0)
    const cutBotLeft = occ.MakeBoxFromPntAndDims(pntBotLeft, cutX, sy, cutZ)
    pntBotLeft.delete()

    const pntBotRight = new occ.gp_Pnt(sx - cutX, 0, 0)
    const cutBotRight = occ.MakeBoxFromPntAndDims(pntBotRight, cutX, sy, cutZ)
    pntBotRight.delete()

    const pntTopLeft = new occ.gp_Pnt(0, 0, sz - cutZ)
    const cutTopLeft = occ.MakeBoxFromPntAndDims(pntTopLeft, cutX, sy, cutZ)
    pntTopLeft.delete()

    const pntTopRight = new occ.gp_Pnt(sx - cutX, 0, sz - cutZ)
    const cutTopRight = occ.MakeBoxFromPntAndDims(pntTopRight, cutX, sy, cutZ)
    pntTopRight.delete()

    const fuse1 = new occ.BRepAlgoAPI_Fuse(cutBotLeft, cutBotRight)
    fuse1.Build()
    const f1 = fuse1.Shape()

    const fuse2 = new occ.BRepAlgoAPI_Fuse(cutTopLeft, cutTopRight)
    fuse2.Build()
    const f2 = fuse2.Shape()

    const fuseAll = new occ.BRepAlgoAPI_Fuse(f1, f2)
    fuseAll.Build()
    const allCuts = fuseAll.Shape()

    const cut = new occ.BRepAlgoAPI_Cut(mainBox, allCuts)
    cut.Build()
    if (cut.IsDone() && !cut.Shape().IsNull()) {
      const crossShape = cut.Shape()
      cut.delete()
      fuse1.delete()
      fuse2.delete()
      fuseAll.delete()
      cutBotLeft.delete()
      cutBotRight.delete()
      cutTopLeft.delete()
      cutTopRight.delete()
      mainBox.delete()
      return crossShape
    }
    cut.delete()
    fuse1.delete()
    fuse2.delete()
    fuseAll.delete()
    cutBotLeft.delete()
    cutBotRight.delete()
    cutTopLeft.delete()
    cutTopRight.delete()
    return mainBox
  }

  return mainBox
}

/**
 * 抽取 OCCT 实体拓扑表面及对应离散三角网格
 */
export function extractBRepFacesAndMesh(
  occ: any,
  solidShape: any,
  baseBody: Partial<BaseBodyConfig>
): OcctBRepMeshResult {
  const jsonStr = occ.ShapeToMeshJson(solidShape, 0.05, false, false, false, true, false)
  const meshData = JSON.parse(jsonStr)

  if (!meshData || !meshData.faceList || meshData.faceList.length === 0) {
    throw new Error('未从 OCCT 几何实体中提取到有效的 B-Rep 拓扑表面')
  }

  const dims = baseBody.dimensions || [120, 100, 80]
  const [sx, , sz] = dims
  const template = baseBody.template || 'box'

  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const faceTags: number[] = []
  const extractedFaces: BaseFaceDefinition[] = []

  let vertexOffset = 0

  for (let faceIdx = 0; faceIdx < meshData.faceList.length; faceIdx++) {
    const rawFace = meshData.faceList[faceIdx]
    const coords = rawFace.vertexCoord || rawFace.vertex_coord
    const triIndexes = rawFace.triIndexes || rawFace.tri_indexes
    if (!coords || !triIndexes || triIndexes.length === 0) continue

    const rawNorms = rawFace.normalCoord || rawFace.normal_coord || []

    // 1. 获取该面的中心与法向
    const centerPoint: [number, number, number] = rawFace.centerPoint
      ? [rawFace.centerPoint[0], rawFace.centerPoint[1], rawFace.centerPoint[2]]
      : [0, 0, 0]

    let fnx = rawFace.centerNormal ? rawFace.centerNormal[0] : 0
    let fny = rawFace.centerNormal ? rawFace.centerNormal[1] : 0
    let fnz = rawFace.centerNormal ? rawFace.centerNormal[2] : 1
    const nlen = Math.hypot(fnx, fny, fnz)
    if (nlen > 1e-6) {
      fnx /= nlen
      fny /= nlen
      fnz /= nlen
    }

    // 2. 统计包围盒
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < coords.length; i += 3) {
      const x = coords[i], y = coords[i + 1], z = coords[i + 2]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const planeOffset = fnx * centerPoint[0] + fny * centerPoint[1] + fnz * centerPoint[2]
    const origin: [number, number, number] = [
      cleanZero(fnx * planeOffset),
      cleanZero(fny * planeOffset),
      cleanZero(fnz * planeOffset)
    ]

    let u: [number, number, number]
    let v: [number, number, number]
    if (Math.abs(fnz) > 0.8) {
      u = [1, 0, 0]
      v = fnz > 0 ? [0, 1, 0] : [0, -1, 0]
    } else if (Math.abs(fny) > 0.8) {
      u = [1, 0, 0]
      v = [0, 0, 1]
    } else {
      u = [0, 1, 0]
      v = [0, 0, 1]
    }

    // 4. 识别并赋予拓扑面的语义 ID 与参数推拉绑定
    let faceId = `face_${faceIdx}`
    let faceName = `平面 ${faceIdx + 1}`
    let paramBinding: BaseFaceDefinition['paramBinding'] = undefined

    const roundedNormal: [number, number, number] = [
      cleanZero(fnx),
      cleanZero(fny),
      cleanZero(fnz)
    ]

    if (baseBody.type === 'step') {
      let dirDesc = ''
      if (Math.abs(fnz) > 0.8) dirDesc = fnz > 0 ? '+Z' : '-Z'
      else if (Math.abs(fny) > 0.8) dirDesc = fny > 0 ? '+Y' : '-Y'
      else if (Math.abs(fnx) > 0.8) dirDesc = fnx > 0 ? '+X' : '-X'
      else dirDesc = '斜面'

      faceId = `step-face-${faceIdx + 1}`
      faceName = `平面 ${faceIdx + 1} (${dirDesc})`
    } else if (template === 'box') {
      if (roundedNormal[2] > 0.8) {
        faceId = 'top'
        faceName = '顶面 (Top)'
        paramBinding = { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' }
      } else if (roundedNormal[2] < -0.8) {
        faceId = 'bottom'
        faceName = '底面 (Bottom)'
        paramBinding = { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' }
      } else if (roundedNormal[1] < -0.8) {
        faceId = 'front'
        faceName = '前面 (Front)'
        paramBinding = { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' }
      } else if (roundedNormal[1] > 0.8) {
        faceId = 'back'
        faceName = '后面 (Back)'
        paramBinding = { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' }
      } else if (roundedNormal[0] < -0.8) {
        faceId = 'left'
        faceName = '左面 (Left)'
        paramBinding = { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' }
      } else if (roundedNormal[0] > 0.8) {
        faceId = 'right'
        faceName = '右面 (Right)'
        paramBinding = { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' }
      }
    } else if (template === 'l-shape') {
      if (roundedNormal[2] > 0.8) {
        if (centerPoint[2] > sz * 0.7) {
          faceId = 'top-main'
          faceName = '顶主面 (Top Main)'
          paramBinding = { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' }
        } else {
          faceId = 'top-step'
          faceName = '台阶顶面 (Top Step)'
          paramBinding = { param: 'extraParams', key: 'cutZ', sign: -1, description: '调整台阶深度 cutZ' }
        }
      } else if (roundedNormal[2] < -0.8) {
        faceId = 'bottom'
        faceName = '底面 (Bottom)'
        paramBinding = { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' }
      } else if (roundedNormal[1] < -0.8) {
        faceId = 'front-main'
        faceName = '前主面 (Front Main)'
        paramBinding = { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' }
      } else if (roundedNormal[1] > 0.8) {
        faceId = 'back'
        faceName = '后面 (Back)'
        paramBinding = { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' }
      } else if (roundedNormal[0] < -0.8) {
        faceId = 'left'
        faceName = '左面 (Left)'
        paramBinding = { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' }
      } else if (roundedNormal[0] > 0.8) {
        if (centerPoint[0] < sx * 0.85) {
          faceId = 'step-wall'
          faceName = '阶梯竖面 (Step Wall)'
          paramBinding = { param: 'extraParams', key: 'cutX', sign: -1, description: '调整台阶切除 cutX' }
        } else {
          faceId = 'right'
          faceName = '右面 (Right)'
          paramBinding = { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' }
        }
      }
    } else if (template === 't-shape') {
      if (roundedNormal[2] > 0.8) {
        faceId = 'top-flange'
        faceName = '翼缘顶面 (Top Flange)'
        paramBinding = { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' }
      } else if (roundedNormal[2] < -0.8) {
        if (centerPoint[2] > 1) {
          if (centerPoint[0] < sx * 0.5) {
            faceId = 'flange-bottom-left'
            faceName = '翼缘左底面 (Flange Bot Left)'
            paramBinding = { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整翼缘凹槽深度 cutZ' }
          } else {
            faceId = 'flange-bottom-right'
            faceName = '翼缘右底面 (Flange Bot Right)'
            paramBinding = { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整翼缘凹槽深度 cutZ' }
          }
        } else {
          faceId = 'bottom-web'
          faceName = '腹板底面 (Bottom Web)'
          paramBinding = { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' }
        }
      } else if (roundedNormal[1] < -0.8) {
        faceId = 'front'
        faceName = '前面 (Front)'
        paramBinding = { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' }
      } else if (roundedNormal[1] > 0.8) {
        faceId = 'back'
        faceName = '后面 (Back)'
        paramBinding = { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' }
      } else if (roundedNormal[0] < -0.8) {
        if (centerPoint[0] > 1) {
          faceId = 'left-web'
          faceName = '腹板左面 (Left Web)'
          paramBinding = { param: 'extraParams', key: 'cutX', sign: -1, description: '调整腹板宽度 cutX' }
        } else {
          faceId = 'left-flange'
          faceName = '翼缘左面 (Left Flange)'
          paramBinding = { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' }
        }
      } else if (roundedNormal[0] > 0.8) {
        if (centerPoint[0] < sx - 1) {
          faceId = 'right-web'
          faceName = '腹板右面 (Right Web)'
          paramBinding = { param: 'extraParams', key: 'cutX', sign: -1, description: '调整腹板宽度 cutX' }
        } else {
          faceId = 'right-flange'
          faceName = '翼缘右面 (Right Flange)'
          paramBinding = { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' }
        }
      }
    } else if (template === 'cross-shape') {
      const cutX = baseBody.extraParams?.cutX ?? sx * 0.25
      const cutZ = baseBody.extraParams?.cutZ ?? sz * 0.25
      if (roundedNormal[2] > 0.8) {
        if (centerPoint[2] <= cutZ + 1.0) {
          if (centerPoint[0] <= cutX + 1.0) {
            faceId = 'bot-left-up'
            faceName = '左下凹槽顶面 (Bot Left Up)'
            paramBinding = { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' }
          } else {
            faceId = 'bot-right-up'
            faceName = '右下凹槽顶面 (Bot Right Up)'
            paramBinding = { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' }
          }
        } else {
          faceId = 'top-center'
          faceName = '顶部中心面 (Top Center)'
          paramBinding = { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' }
        }
      } else if (roundedNormal[2] < -0.8) {
        if (centerPoint[2] >= sz - cutZ - 1.0) {
          if (centerPoint[0] <= cutX + 1.0) {
            faceId = 'top-left-down'
            faceName = '左上凹槽底面 (Top Left Down)'
            paramBinding = { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' }
          } else {
            faceId = 'top-right-down'
            faceName = '右上凹槽底面 (Top Right Down)'
            paramBinding = { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' }
          }
        } else {
          faceId = 'bottom-center'
          faceName = '底部中心面 (Bottom Center)'
          paramBinding = { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' }
        }
      } else if (roundedNormal[1] < -0.8) {
        faceId = 'front'
        faceName = '前面 (Front)'
        paramBinding = { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' }
      } else if (roundedNormal[1] > 0.8) {
        faceId = 'back'
        faceName = '后面 (Back)'
        paramBinding = { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' }
      } else if (roundedNormal[0] < -0.8) {
        if (centerPoint[0] >= sx - cutX - 1.0) {
          if (centerPoint[2] >= sz - cutZ - 1.0) {
            faceId = 'top-right-wall'
            faceName = '右上凹槽竖面 (Top Right Wall)'
            paramBinding = { param: 'extraParams', key: 'cutX', sign: 1, description: '调整切口宽度 cutX' }
          } else {
            faceId = 'bot-right-wall'
            faceName = '右下凹槽竖面 (Bot Right Wall)'
            paramBinding = { param: 'extraParams', key: 'cutX', sign: 1, description: '调整切口宽度 cutX' }
          }
        } else {
          faceId = 'left-center'
          faceName = '左侧中心面 (Left Center)'
          paramBinding = { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' }
        }
      } else if (roundedNormal[0] > 0.8) {
        if (centerPoint[0] <= cutX + 1.0) {
          if (centerPoint[2] >= sz - cutZ - 1.0) {
            faceId = 'top-left-wall'
            faceName = '左上凹槽竖面 (Top Left Wall)'
            paramBinding = { param: 'extraParams', key: 'cutX', sign: -1, description: '调整切口宽度 cutX' }
          } else {
            faceId = 'bot-left-wall'
            faceName = '左下凹槽竖面 (Bot Left Wall)'
            paramBinding = { param: 'extraParams', key: 'cutX', sign: -1, description: '调整切口宽度 cutX' }
          }
        } else {
          faceId = 'right-center'
          faceName = '右侧中心面 (Right Center)'
          paramBinding = { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' }
        }
      }
    }

    extractedFaces.push({
      id: faceId,
      name: faceName,
      type: 'plane',
      normal: roundedNormal,
      origin,
      u,
      v,
      bounds: { minX, maxX, minY, maxY, minZ, maxZ },
      paramBinding
    })

    // 5. 将该面包含的所有三角形与顶点压入整体网格，并为每个三角形记录 faceIdx
    for (let i = 0; i < coords.length; i += 3) {
      positions.push(coords[i], coords[i + 1], coords[i + 2])
    }

    if (rawNorms.length === coords.length) {
      for (let i = 0; i < rawNorms.length; i += 3) {
        normals.push(rawNorms[i], rawNorms[i + 1], rawNorms[i + 2])
      }
    } else {
      for (let i = 0; i < coords.length; i += 3) {
        normals.push(fnx, fny, fnz)
      }
    }

    const numTrianglesInFace = triIndexes.length / 3
    for (let i = 0; i < numTrianglesInFace; i++) {
      indices.push(
        triIndexes[i * 3] + vertexOffset,
        triIndexes[i * 3 + 1] + vertexOffset,
        triIndexes[i * 3 + 2] + vertexOffset
      )
      // 记录该三角形所属的拓扑面索引
      faceTags.push(faceIdx)
    }

    vertexOffset += coords.length / 3
  }

  // 6. 提取 CAD 边线
  const edgePositions: number[] = []
  if (meshData.edgeList && meshData.edgeList.length > 0) {
    for (const edge of meshData.edgeList) {
      const c = edge.vertexCoord || edge.vertex_coord
      if (!c) continue
      for (let i = 0; i < c.length - 3; i += 3) {
        edgePositions.push(c[i], c[i + 1], c[i + 2])
        edgePositions.push(c[i + 3], c[i + 4], c[i + 5])
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    edgePositions: edgePositions.length > 0 ? new Float32Array(edgePositions) : undefined,
    faceTags: new Uint32Array(faceTags),
    faces: extractedFaces
  }
}
