/**
 * STEP 模型解析器（基于 @bitbybit-dev/occt WASM 内核）
 * 将 .step / .stp 文件转换为 Three.js 可直接渲染的 BufferGeometry 实体网格与 CAD 边线
 */
import * as THREE from 'three'
import { getOccInstance } from '@renderer/workspace/design/worker/cad/occtLoader'
import type { BaseFaceDefinition } from '@shared/design/types'
import { computeOrthonormalPlaneBasis } from '@shared/design/faceMath'

/** 单例懒加载 OCCT WASM 模块 */
export async function getOccModule(): Promise<any> {
  return getOccInstance()
}

export interface StepParseResult {
  solidGeometry: THREE.BufferGeometry
  edgeGeometry: THREE.BufferGeometry | null
  faces?: BaseFaceDefinition[]
  dimensions: [number, number, number]
  stepMesh: {
    positions: Float32Array
    indices: Uint32Array
    normals: Float32Array
    edgePositions?: Float32Array
  }
}

/** 解析 STEP 文本或 ArrayBuffer 为 Three.js 几何体并提取平面特征 */
export async function parseStepToThreeGeometry(
  stepContent: string | ArrayBuffer
): Promise<StepParseResult> {
  const occ = await getOccModule()

  const uint8 =
    stepContent instanceof ArrayBuffer
      ? new Uint8Array(stepContent)
      : typeof stepContent === 'string'
        ? new TextEncoder().encode(stepContent)
        : stepContent

  const shape = occ.ReadSTEPFromBinary(uint8)
  if (!shape || shape.IsNull()) {
    throw new Error('无法解析 STEP 实体，请确认文件格式有效。')
  }

  // 1. 实体容差与拓扑缝合修复 (确保外壳封闭缝合为严格的水密体)
  let solidShape = shape
  try {
    const fixer = new occ.ShapeFix_Shape()
    fixer.Init(shape)
    fixer.Perform()
    const fixed = fixer.Shape()
    if (fixed && !fixed.IsNull()) {
      solidShape = fixed
    }
    fixer.delete()
  } catch (fixErr) {
    console.warn('[stepLoader] ShapeFix_Shape 容差修复跳过:', fixErr)
  }

  // 2. 使用 OCCT 原生 B-Rep 离散化引擎进行全局水密网格剖分
  try {
    const mesher = new occ.BRepMesh_IncrementalMesh(solidShape, 0.05, false, 0.5, true)
    mesher.delete()
  } catch (meshErr) {
    console.warn('[stepLoader] BRepMesh_IncrementalMesh 剖分提示:', meshErr)
  }

  // 3. 直接通过 OCCT 原生 STL 导出器获取严格共享顶点的连续闭合水密三角形网格（避免 JS 手工空间缝合产生微缝隙）
  const stlWriter = new occ.StlAPI_Writer()
  stlWriter.SetASCIIMode(false) // 二进制紧凑格式
  const tempFileName = `sureflow_step_stl_${Date.now()}_${Math.floor(Math.random() * 100000)}.stl`
  const writeOk = stlWriter.Write(solidShape, tempFileName)
  stlWriter.delete()

  if (!writeOk) {
    shape.delete()
    if (solidShape !== shape) solidShape.delete()
    throw new Error('STEP 水密网格导出失败，几何体可能存在严重非流形破损。')
  }

  const stlBuffer = occ.FS.readFile('/' + tempFileName) as Uint8Array
  occ.FS.unlink('/' + tempFileName)

  // 4. 解析二进制 STL 数据
  const dv = new DataView(stlBuffer.buffer, stlBuffer.byteOffset, stlBuffer.byteLength)
  if (dv.byteLength < 84) {
    shape.delete()
    if (solidShape !== shape) solidShape.delete()
    throw new Error('导出的 STL 数据损坏或为空。')
  }

  const numTris = dv.getUint32(80, true)
  if (numTris === 0) {
    shape.delete()
    if (solidShape !== shape) solidShape.delete()
    throw new Error('STEP 实体中未提取到有效的三维网格三角形。')
  }

  // 先统计包围盒
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  let offset = 84
  const rawTriangles: number[] = new Array(numTris * 9)
  let rawIdx = 0

  for (let i = 0; i < numTris; i++) {
    offset += 12 // 跳过面法向 (STL 面法向精度低，后续由 Three.js 顶点计算平滑法向)
    for (let j = 0; j < 3; j++) {
      const vx = dv.getFloat32(offset, true)
      const vy = dv.getFloat32(offset + 4, true)
      const vz = dv.getFloat32(offset + 8, true)
      offset += 12

      rawTriangles[rawIdx++] = vx
      rawTriangles[rawIdx++] = vy
      rawTriangles[rawIdx++] = vz

      if (vx < minX) minX = vx
      if (vx > maxX) maxX = vx
      if (vy < minY) minY = vy
      if (vy > maxY) maxY = vy
      if (vz < minZ) minZ = vz
      if (vz > maxZ) maxZ = vz
    }
    offset += 2 // 属性字节
  }

  if (!Number.isFinite(minX)) {
    minX = 0
    minY = 0
    minZ = 0
    maxX = 100
    maxY = 100
    maxZ = 100
  }

  const sx = Math.max(5, Math.round((maxX - minX) * 10) / 10)
  const sy = Math.max(5, Math.round((maxY - minY) * 10) / 10)
  const sz = Math.max(5, Math.round((maxZ - minZ) * 10) / 10)

  // 对齐到 SureFlow 的基准原点 (0, 0, 0)
  const dx = -minX
  const dy = -minY
  const dz = -minZ

  // 顶点去重索引化：由于 OCCT 导出的二进制 STL 共享边顶点具有完全相同的 Float32 二进制表示
  // 直接以浮点数值为 key 进行去重映射，保留严格的 2-Manifold 闭合拓扑
  const coordMap = new Map<string, number>()
  const uniquePositions: number[] = []
  const indices: number[] = []

  for (let i = 0; i < rawTriangles.length; i += 3) {
    const vx = rawTriangles[i] + dx
    const vy = rawTriangles[i + 1] + dy
    const vz = rawTriangles[i + 2] + dz
    const key = `${vx}_${vy}_${vz}`
    let idx = coordMap.get(key)
    if (idx === undefined) {
      idx = uniquePositions.length / 3
      coordMap.set(key, idx)
      uniquePositions.push(vx, vy, vz)
    }
    indices.push(idx)
  }

  const solidGeom = new THREE.BufferGeometry()
  const posFloat32 = new Float32Array(uniquePositions)
  const indUint32 = new Uint32Array(indices)

  solidGeom.setAttribute('position', new THREE.Float32BufferAttribute(posFloat32, 3))
  solidGeom.setIndex(new THREE.Uint32BufferAttribute(indUint32, 1))
  solidGeom.computeVertexNormals()
  solidGeom.computeBoundingBox()
  solidGeom.computeBoundingSphere()

  const normFloat32 = new Float32Array(solidGeom.attributes.normal.array)

  // 5. 提取 CAD 特征面 (用于视口选面与孔腔放置) 与 CAD 边线
  const extractedFaces: BaseFaceDefinition[] = []
  const edgePositions: number[] = []

  try {
    const jsonStr = occ.ShapeToMeshJson(solidShape, 0.05, false, false, false, true, false)
    const meshData = JSON.parse(jsonStr)

    if (meshData && meshData.faceList) {
      let faceCounter = 0
      for (const face of meshData.faceList) {
        const rawCoords = face.vertexCoord || face.vertex_coord
        const triIndexes = face.triIndexes || face.tri_indexes
        if (!rawCoords || !triIndexes || triIndexes.length < 3) continue

        const rawNorms = face.normalCoord || face.normal_coord || []

        let isPlanar = true
        let fnx = 0
        let fny = 0
        let fnz = 0

        if (rawNorms.length >= 3) {
          fnx = rawNorms[0]
          fny = rawNorms[1]
          fnz = rawNorms[2]
          const nlen = Math.hypot(fnx, fny, fnz)
          if (nlen > 1e-6) {
            fnx /= nlen
            fny /= nlen
            fnz /= nlen
            for (let i = 3; i < rawNorms.length; i += 3) {
              const dot = fnx * rawNorms[i] + fny * rawNorms[i + 1] + fnz * rawNorms[i + 2]
              if (dot < 0.95) {
                isPlanar = false
                break
              }
            }
          } else {
            isPlanar = false
          }
        } else {
          const i0 = triIndexes[0] * 3
          const i1 = triIndexes[1] * 3
          const i2 = triIndexes[2] * 3
          const ax = rawCoords[i1] - rawCoords[i0]
          const ay = rawCoords[i1 + 1] - rawCoords[i0 + 1]
          const az = rawCoords[i1 + 2] - rawCoords[i0 + 2]
          const bx = rawCoords[i2] - rawCoords[i0]
          const by = rawCoords[i2 + 1] - rawCoords[i0 + 1]
          const bz = rawCoords[i2 + 2] - rawCoords[i0 + 2]
          fnx = ay * bz - az * by
          fny = az * bx - ax * bz
          fnz = ax * by - ay * bx
          const nlen = Math.hypot(fnx, fny, fnz)
          if (nlen > 1e-6) {
            fnx /= nlen
            fny /= nlen
            fnz /= nlen
          } else {
            isPlanar = false
          }
        }

        if (isPlanar) {
          faceCounter++
          let sumX = 0
          let sumY = 0
          let sumZ = 0
          const count = rawCoords.length / 3
          for (let i = 0; i < rawCoords.length; i += 3) {
            sumX += rawCoords[i] + dx
            sumY += rawCoords[i + 1] + dy
            sumZ += rawCoords[i + 2] + dz
          }
          const cx = sumX / count
          const cy = sumY / count
          const cz = sumZ / count
          // 严格计算面的正交右手基底 (u, v, w)
          const { u, v, w } = computeOrthonormalPlaneBasis([fnx, fny, fnz])

          // 原点按全局原点 (0, 0, 0) 在面内的正交投影点即可 (w * planeOffset)
          const planeOffset = cx * w[0] + cy * w[1] + cz * w[2]
          const origin: [number, number, number] = [
            Math.round(w[0] * planeOffset * 100) / 100,
            Math.round(w[1] * planeOffset * 100) / 100,
            Math.round(w[2] * planeOffset * 100) / 100
          ]

          let dirDesc = ''
          if (Math.abs(w[2]) > 0.8) dirDesc = w[2] > 0 ? '+Z' : '-Z'
          else if (Math.abs(w[1]) > 0.8) dirDesc = w[1] > 0 ? '+Y' : '-Y'
          else if (Math.abs(w[0]) > 0.8) dirDesc = w[0] > 0 ? '+X' : '-X'
          else dirDesc = '斜面'

          extractedFaces.push({
            id: `step-face-${faceCounter}`,
            name: `平面 ${faceCounter} (${dirDesc})`,
            type: 'plane',
            normal: [
              Math.round(w[0] * 100000) / 100000,
              Math.round(w[1] * 100000) / 100000,
              Math.round(w[2] * 100000) / 100000
            ],
            origin,
            centerPoint: [
              Math.round(cx * 100) / 100,
              Math.round(cy * 100) / 100,
              Math.round(cz * 100) / 100
            ],
            u,
            v
          })
        }
      }
    }

    if (meshData && meshData.edgeList && meshData.edgeList.length > 0) {
      for (const edge of meshData.edgeList) {
        const c = edge.vertexCoord || edge.vertex_coord
        if (!c) continue
        for (let i = 0; i < c.length - 3; i += 3) {
          edgePositions.push(c[i] + dx, c[i + 1] + dy, c[i + 2] + dz)
          edgePositions.push(c[i + 3] + dx, c[i + 4] + dy, c[i + 5] + dz)
        }
      }
    }
  } catch (faceExtractErr) {
    console.warn('[stepLoader] 提取 CAD 平面特征失败:', faceExtractErr)
  }

  let edgeGeom: THREE.BufferGeometry | null = null
  if (edgePositions.length > 0) {
    edgeGeom = new THREE.BufferGeometry()
    edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3))
  } else {
    edgeGeom = new THREE.EdgesGeometry(solidGeom, 24)
  }

  // 释放 WASM 内存
  shape.delete()
  if (solidShape !== shape) solidShape.delete()

  const edgePosFloat32 =
    edgePositions.length > 0
      ? new Float32Array(edgePositions)
      : edgeGeom && edgeGeom.attributes.position
        ? new Float32Array(edgeGeom.attributes.position.array)
        : new Float32Array(0)

  return {
    solidGeometry: solidGeom,
    edgeGeometry: edgeGeom,
    faces: extractedFaces,
    dimensions: [sx, sy, sz],
    stepMesh: {
      positions: posFloat32,
      normals: normFloat32,
      indices: indUint32,
      edgePositions: edgePosFloat32
    }
  }
}
