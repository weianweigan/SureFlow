import { describe, it, expect, beforeAll } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import manifoldModuleFactory from 'manifold-3d'
import { packMeshCache, unpackMeshCache, exportToGlb } from '../meshCache'
import { classifyAndGroupCsgGeometry } from '../meshClassifier'
import { extractFeatureEdges } from '../featureEdgeExtractor'
import type { CavityInstance } from '@shared/design/types'

// Node.js 环境下补全 FileReader 供 Three.js GLTFExporter 二进制导出使用
if (typeof globalThis.FileReader === 'undefined') {
  class NodeFileReader {
    result: any = null
    onloadend: any = null
    async readAsArrayBuffer(blob: Blob) {
      this.result = await blob.arrayBuffer()
      if (this.onloadend) this.onloadend()
    }
  }
  globalThis.FileReader = NodeFileReader as any
}

describe('meshCache: pack, unpack and exportToGlb', () => {
  let Manifold: any

  beforeAll(async () => {
    const mod = await (manifoldModuleFactory as any)()
    mod.setup()
    Manifold = mod.Manifold
  }, 60000)

  it('repairs hard-edge normals in the GLB itself, without changing source geometry', async () => {
    // Two perpendicular planes share vertices with corrupted averaged normals.
    // Neither plane is axis-aligned after rotation; no viewport classification is used.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 2,0,0, 0,2,0, 0,0,2], 3))
    geometry.setIndex([0,1,2, 0,3,1])
    geometry.computeVertexNormals()
    geometry.rotateX(0.37)
    geometry.rotateZ(0.61)
    geometry.addGroup(0,3,0)
    geometry.addGroup(3,3,2)
    const originalNormals = geometry.getAttribute('normal').array.slice()
    const buffer = await exportToGlb(geometry)
    const gltf = await new GLTFLoader().parseAsync(buffer, '')
    let triangles = 0
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      const exported = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry
      const positions = exported.getAttribute('position')
      const normals = exported.getAttribute('normal')
      for (let i = 0; i < positions.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(positions, i)
        const b = new THREE.Vector3().fromBufferAttribute(positions, i+1)
        const c = new THREE.Vector3().fromBufferAttribute(positions, i+2)
        const faceNormal = b.sub(a).cross(c.sub(a)).normalize()
        for (let j = 0; j < 3; j++) {
          expect(new THREE.Vector3().fromBufferAttribute(normals,i+j).dot(faceNormal)).toBeCloseTo(1, 5)
        }
        triangles++
      }
      if (exported !== object.geometry) exported.dispose()
      object.geometry.dispose()
    })
    expect(triangles).toBe(2)
    expect(geometry.getAttribute('normal').array).toEqual(originalNormals)
    expect(Array.from(geometry.index!.array)).toEqual([0,1,2,0,3,1])
    geometry.dispose()
  })

  it('correctly packs and unpacks raw CSG mesh binary cache', () => {
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0])
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
    const indices = new Uint32Array([0, 1, 2])
    const edgePositions = new Float32Array([0, 0, 0, 10, 0, 0])
    const triangleTags = [{ type: 'face' as const, id: 'top' }]

    const packed = packMeshCache({
      positions,
      normals,
      indices,
      edgePositions,
      triangleTags
    })

    expect(packed.byteLength).toBeGreaterThan(32)

    const unpacked = unpackMeshCache(packed)
    expect(unpacked).not.toBeNull()
    expect(Array.from(unpacked!.positions)).toEqual(Array.from(positions))
    expect(Array.from(unpacked!.normals)).toEqual(Array.from(normals))
    expect(Array.from(unpacked!.indices)).toEqual(Array.from(indices))
    expect(Array.from(unpacked!.edgePositions)).toEqual(Array.from(edgePositions))
    expect(unpacked!.triangleTags).toEqual(triangleTags)
  })

  it('exports CSG solid geometry and edges to a standard compliant GLB binary buffer', async () => {
    // 构造实际 Manifold 实体差集：100x100x80 基体中间切削阶梯圆柱孔
    const sx = 100, sy = 100, sz = 80
    const baseBox = Manifold.cube([sx, sy, sz], false)
    const holeCyl = Manifold.cylinder(60, 16, 16, 32).translate([50, 50, 20])
    const diff = Manifold.difference(baseBox, holeCyl)

    const mesh = diff.getMesh()
    const numProp = mesh.numProp
    const numVerts = Math.floor(mesh.vertProperties.length / numProp)
    const positions = new Float32Array(numVerts * 3)
    for (let i = 0; i < numVerts; i++) {
      positions[i * 3] = mesh.vertProperties[i * numProp]
      positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1]
      positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2]
    }
    const indices = new Uint32Array(mesh.triVerts)
    const normals = new Float32Array(numVerts * 3)
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3
      const ax = positions[i1] - positions[i0], ay = positions[i1 + 1] - positions[i0 + 1], az = positions[i1 + 2] - positions[i0 + 2]
      const bx = positions[i2] - positions[i0], by = positions[i2 + 1] - positions[i0 + 1], bz = positions[i2 + 2] - positions[i0 + 2]
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
      normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz
      normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz
      normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz
    }
    for (let i = 0; i < numVerts; i++) {
      const o = i * 3
      const len = Math.hypot(normals[o], normals[o + 1], normals[o + 2])
      if (len > 1e-7) {
        normals[o] /= len; normals[o + 1] /= len; normals[o + 2] /= len
      }
    }
    const edgePositions = extractFeatureEdges(positions, indices, 28, 0)

    const cavities: CavityInstance[] = [
      {
        instanceId: 'cavity-center',
        name: 'Center Hole',
        libraryId: 'lib',
        templateId: 'temp',
        faceId: 'top',
        u: 50,
        v: 50,
        rotation: 0,
        depthOffset: 0
      }
    ]

    const classified = classifyAndGroupCsgGeometry(
      positions,
      normals,
      indices,
      edgePositions,
      [sx, sy, sz],
      cavities,
      'cavity-center', // 处于选中状态（测试是否能自动洗去临时高亮）
      'top'            // 顶面处于选中状态
    )

    expect(classified.solidGeometry.groups.length).toBeGreaterThan(0)

    // 导出 GLB
    const glbBuffer = await exportToGlb(
      classified.solidGeometry,
      classified.edgeGeometry,
      '#94a3b8'
    )

    expect(glbBuffer).toBeInstanceOf(ArrayBuffer)
    expect(glbBuffer.byteLength).toBeGreaterThan(0)

    // 验证 GLB 头部魔数 'glTF' (0x46546C67 in little endian: 0x67 0x6C 0x54 0x46)
    const headerView = new DataView(glbBuffer)
    expect(headerView.getUint32(0, true)).toBe(0x46546c67)
    expect(headerView.getUint32(4, true)).toBe(2) // GLTF version 2

    // 使用标准 GLTFLoader 重新解析验证模型
    const loader = new GLTFLoader()
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(glbBuffer, '', resolve, reject)
    })

    expect(gltf.scene).toBeDefined()
    const solidObject = gltf.scene.getObjectByName('ValveBlockSolid')
    expect(solidObject).toBeDefined()

    // 提取所有导出的实体三角形数量，断言孔腔完全切削保留，总面元数完全一致
    let totalExportedIndices = 0
    solidObject.traverse((child: any) => {
      if (child.isMesh && child.geometry?.index) {
        totalExportedIndices += child.geometry.index.count
      }
    })
    expect(totalExportedIndices).toBe(indices.length)

    // Verify real CSG top/bottom and hole floor remain flat after GLB round-trip.
    let horizontalTriangles = 0
    solidObject.traverse((child: any) => {
      if (!child.isMesh) return
      const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry
      const p = geometry.getAttribute('position')
      const n = geometry.getAttribute('normal')
      for (let i = 0; i < p.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(p, i)
        const b = new THREE.Vector3().fromBufferAttribute(p, i + 1)
        const c = new THREE.Vector3().fromBufferAttribute(p, i + 2)
        const faceNormal = b.sub(a).cross(c.sub(a)).normalize()
        if (Math.abs(faceNormal.z) < 0.99999) continue
        horizontalTriangles++
        for (let j = 0; j < 3; j++) {
          expect(new THREE.Vector3().fromBufferAttribute(n, i + j).dot(faceNormal)).toBeCloseTo(1, 5)
        }
      }
      if (geometry !== child.geometry) geometry.dispose()
    })
    expect(horizontalTriangles).toBeGreaterThan(0)

    // 验证包含特征边线对象
    const edgesObject = gltf.scene.getObjectByName('FeatureEdges')
    expect(edgesObject).toBeDefined()
  })
})
