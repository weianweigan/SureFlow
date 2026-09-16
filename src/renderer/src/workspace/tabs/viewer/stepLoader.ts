/**
 * STEP 模型解析器（基于 @bitbybit-dev/occt WASM 内核）
 * 将 .step / .stp 文件转换为 Three.js 可直接渲染的 BufferGeometry 实体网格与 CAD 边线
 */
import * as THREE from 'three'
import { getOccInstance } from '@renderer/workspace/design/worker/cad/occtLoader'

/** 单例懒加载 OCCT WASM 模块 */
export async function getOccModule(): Promise<any> {
  return getOccInstance()
}

export interface StepParseResult {
  solidGeometry: THREE.BufferGeometry
  edgeGeometry: THREE.BufferGeometry | null
}

/** 解析 STEP 文本或 ArrayBuffer 为 Three.js 几何体 */
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

  // 1. 组装实体三角形 Mesh
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  let vertexOffset = 0

  for (const face of meshData.faceList) {
    const coords = face.vertexCoord || face.vertex_coord
    const triIndexes = face.triIndexes || face.tri_indexes
    if (!coords || !triIndexes) continue

    const norms = face.normalCoord || face.normal_coord || []

    for (let i = 0; i < coords.length; i += 3) {
      positions.push(coords[i], coords[i + 1], coords[i + 2])
    }

    if (norms.length === coords.length) {
      for (let i = 0; i < norms.length; i += 3) {
        normals.push(norms[i], norms[i + 1], norms[i + 2])
      }
    }

    for (let i = 0; i < triIndexes.length; i++) {
      indices.push(triIndexes[i] + vertexOffset)
    }

    vertexOffset += coords.length / 3
  }

  const solidGeom = new THREE.BufferGeometry()
  solidGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (normals.length === positions.length) {
    solidGeom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  } else {
    solidGeom.computeVertexNormals()
  }
  solidGeom.setIndex(indices)
  solidGeom.computeBoundingBox()
  solidGeom.computeBoundingSphere()

  // 2. 组装 CAD 边线
  let edgeGeom: THREE.BufferGeometry | null = null
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

  if (edgePositions.length > 0) {
    edgeGeom = new THREE.BufferGeometry()
    edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3))
  } else {
    edgeGeom = new THREE.EdgesGeometry(solidGeom, 24)
  }

  // 释放 WASM shape 内存
  shape.delete()

  return {
    solidGeometry: solidGeom,
    edgeGeometry: edgeGeom
  }
}
