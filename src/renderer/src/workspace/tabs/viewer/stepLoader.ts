/**
 * STEP 模型解析器（基于 @bitbybit-dev/occt WASM 内核）
 * 将 .step / .stp 文件转换为 Three.js 可直接渲染的 BufferGeometry 实体网格与 CAD 边线
 */
import * as THREE from 'three'
import { getOccInstance } from '@renderer/workspace/design/worker/cad/occtLoader'
import type { BaseFaceDefinition } from '@shared/design/types'

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
      : new TextEncoder().encode(stepContent)

  const shape = occ.ReadSTEPFromBinary(uint8)
  if (!shape || shape.IsNull()) {
    throw new Error('无法解析 STEP 实体，请确认文件格式有效。')
  }

  const jsonStr = occ.ShapeToMeshJson(shape, 0.05, false, false, false, true, false)
  const meshData = JSON.parse(jsonStr)

  if (!meshData || !meshData.faceList || meshData.faceList.length === 0) {
    throw new Error('STEP 实体中未提取到有效的三维几何表面。')
  }

  // 1. 先全局统计 STEP 模型的空间包围盒，并计算平移至 SureFlow 原点坐标系的偏移向量
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (const face of meshData.faceList) {
    const coords = face.vertexCoord || face.vertex_coord
    if (!coords) continue
    for (let i = 0; i < coords.length; i += 3) {
      const x = coords[i]
      const y = coords[i + 1]
      const z = coords[i + 2]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
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

  // 平移向量：将包围盒最小角对齐至 (0, 0, 0)
  const dx = -minX
  const dy = -minY
  const dz = -minZ

  // 2. 顶点焊接（Vertex Welding，空间量化容差 0.001mm）以构建闭合 2-Manifold 流形网格
  const vertexMap = new Map<string, number>()
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const extractedFaces: BaseFaceDefinition[] = []
  let nextVertexIndex = 0
  let faceCounter = 0

  function getOrAddWeldedVertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const kx = Math.round(x * 1000)
    const ky = Math.round(y * 1000)
    const kz = Math.round(z * 1000)
    const key = `${kx}_${ky}_${kz}`
    const existing = vertexMap.get(key)
    if (existing !== undefined) {
      return existing
    }
    const idx = nextVertexIndex++
    vertexMap.set(key, idx)
    positions.push(x, y, z)
    normals.push(nx, ny, nz)
    return idx
  }

  for (const face of meshData.faceList) {
    const rawCoords = face.vertexCoord || face.vertex_coord
    const triIndexes = face.triIndexes || face.tri_indexes
    if (!rawCoords || !triIndexes || triIndexes.length < 3) continue

    const rawNorms = face.normalCoord || face.normal_coord || []

    // 检查是否为平面
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
      const planeOffset = fnx * cx + fny * cy + fnz * cz
      const origin: [number, number, number] = [
        Math.round(fnx * planeOffset * 100) / 100,
        Math.round(fny * planeOffset * 100) / 100,
        Math.round(fnz * planeOffset * 100) / 100
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

      let dirDesc = ''
      if (Math.abs(fnz) > 0.8) dirDesc = fnz > 0 ? '+Z' : '-Z'
      else if (Math.abs(fny) > 0.8) dirDesc = fny > 0 ? '+Y' : '-Y'
      else if (Math.abs(fnx) > 0.8) dirDesc = fnx > 0 ? '+X' : '-X'
      else dirDesc = '斜面'

      extractedFaces.push({
        id: `step-face-${faceCounter}`,
        name: `平面 ${faceCounter} (${dirDesc})`,
        type: 'plane',
        normal: [
          Math.round(fnx * 1000) / 1000,
          Math.round(fny * 1000) / 1000,
          Math.round(fnz * 1000) / 1000
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

    // 局部顶点索引映射至焊接后的全局顶点索引
    const localToWelded = new Map<number, number>()
    for (let i = 0; i < rawCoords.length; i += 3) {
      const vx = rawCoords[i] + dx
      const vy = rawCoords[i + 1] + dy
      const vz = rawCoords[i + 2] + dz
      const vnx = rawNorms.length === rawCoords.length ? rawNorms[i] : fnx
      const vny = rawNorms.length === rawCoords.length ? rawNorms[i + 1] : fny
      const vnz = rawNorms.length === rawCoords.length ? rawNorms[i + 2] : fnz
      const weldedIdx = getOrAddWeldedVertex(vx, vy, vz, vnx, vny, vnz)
      localToWelded.set(i / 3, weldedIdx)
    }

    for (let i = 0; i < triIndexes.length; i += 3) {
      const i0 = localToWelded.get(triIndexes[i])!
      const i1 = localToWelded.get(triIndexes[i + 1])!
      const i2 = localToWelded.get(triIndexes[i + 2])!
      // 避免退化三角形
      if (i0 !== i1 && i1 !== i2 && i0 !== i2) {
        indices.push(i0, i1, i2)
      }
    }
  }

  const solidGeom = new THREE.BufferGeometry()
  solidGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  solidGeom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  solidGeom.setIndex(indices)
  solidGeom.computeVertexNormals()
  solidGeom.computeBoundingBox()
  solidGeom.computeBoundingSphere()

  // 3. 组装 CAD 边线（同样平移 dx, dy, dz）
  let edgeGeom: THREE.BufferGeometry | null = null
  const edgePositions: number[] = []

  if (meshData.edgeList && meshData.edgeList.length > 0) {
    for (const edge of meshData.edgeList) {
      const c = edge.vertexCoord || edge.vertex_coord
      if (!c) continue
      for (let i = 0; i < c.length - 3; i += 3) {
        edgePositions.push(c[i] + dx, c[i + 1] + dy, c[i + 2] + dz)
        edgePositions.push(c[i + 3] + dx, c[i + 4] + dy, c[i + 5] + dz)
      }
    }
  }

  if (edgePositions.length > 0) {
    edgeGeom = new THREE.BufferGeometry()
    edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3))
  } else {
    edgeGeom = new THREE.EdgesGeometry(solidGeom, 24)
  }

  // 释放 WASM shape 内存
  shape.delete()

  const posFloat32 = new Float32Array(positions)
  const normFloat32 = new Float32Array(normals)
  const indUint32 = new Uint32Array(indices)
  const edgePosFloat32 = edgePositions.length > 0 ? new Float32Array(edgePositions) : undefined

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
