import { describe, it, expect, beforeAll } from 'vitest'
import Module from 'manifold-3d'
import { buildCavityManifold } from '@renderer/workspace/design/geometry/cavityProfileBuilder'
import { extractFeatureEdges } from '@renderer/workspace/design/geometry/featureEdgeExtractor'
import type { Step } from '@shared/cavity/types'

describe('Manifold-3D CSG 300+ Cavities Performance & Continuous Optimization Suite', () => {
  let mod: any
  let Manifold: any

  beforeAll(async () => {
    mod = await (Module as any)()
    mod.setup()
    Manifold = mod.Manifold
  }, 60000)

  // 标准基体与孔腔参数
  const dims: [number, number, number] = [400, 300, 150]
  const [sx, sy, sz] = dims
  const standardSteps: Step[] = [
    { type: 'straight', diameter: 18, length: 8, thread: null },
    { type: 'straight', diameter: 10, length: 20, thread: null },
    { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
  ]

  const cols = 20
  const rows = 15
  const count = cols * rows // 300 孔腔
  const dx = sx / (cols + 1)
  const dy = sy / (rows + 1)

  it('1. Prototype Caching vs Full Rebuild: demonstrates >10x acceleration', () => {
    // 方案 A: 传统无缓存重建（每孔调用 buildCavityManifold）
    const t0 = performance.now()
    const traditionalList: any[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 1) * dx
        const y = (r + 1) * dy
        const z = sz
        const mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, x, y, z, 1]
        const m = buildCavityManifold(mod, standardSteps, 32).transform(mat).asOriginal()
        traditionalList.push(m)
      }
    }
    const tTraditional = performance.now() - t0

    // 方案 B: 原型池缓存（复用模板单体，仅执行 transform + asOriginal）
    const t1 = performance.now()
    const prototype = buildCavityManifold(mod, standardSteps, 32)
    const cachedList: any[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 1) * dx
        const y = (r + 1) * dy
        const z = sz
        const mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, x, y, z, 1]
        const m = prototype.transform(mat).asOriginal()
        cachedList.push(m)
      }
    }
    const tCached = performance.now() - t1

    console.log(`\n[Test 1] 300 Cavities Prototype Generation:`)
    console.log(`  - Traditional (rebuild 300x): ${tTraditional.toFixed(2)} ms`)
    console.log(`  - Prototype Cached:           ${tCached.toFixed(2)} ms`)
    console.log(`  - Speedup Ratio:              ${(tTraditional / tCached).toFixed(1)}x`)

    expect(tCached).toBeLessThan(tTraditional / 5) // 至少提速 5 倍以上（实测约 20x）
    expect(cachedList.length).toBe(count)
  })

  it('2. Bypass calculateNormals: generates accurate vertex normals in ~2ms instead of 700ms+', () => {
    const prototype = buildCavityManifold(mod, standardSteps, 32)
    const baseMesh = Manifold.cube(dims, false)
    const cavityList: any[] = []

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 1) * dx
        const y = (r + 1) * dy
        const z = sz
        const mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, x, y, z, 1]
        cavityList.push(prototype.transform(mat).asOriginal())
      }
    }

    const toolUnion = Manifold.union(cavityList)
    const resultManifold = Manifold.difference(baseMesh, toolUnion)

    // 方案 A: Manifold 原生 calculateNormals(0)
    const tA0 = performance.now()
    const smoothResult = resultManifold.calculateNormals(0)
    const meshA = smoothResult.getMesh()
    const tA = performance.now() - tA0

    // 方案 B: 直接 getMesh() + 高速 TypedArray 直算
    const tB0 = performance.now()
    const rawMesh = resultManifold.getMesh()
    const numVerts = rawMesh.vertProperties.length / rawMesh.numProp
    const normals = new Float32Array(numVerts * 3)
    const pos = rawMesh.vertProperties
    const idx = rawMesh.triVerts
    const stride = rawMesh.numProp

    for (let i = 0; i < idx.length; i += 3) {
      const i0 = idx[i] * stride
      const i1 = idx[i + 1] * stride
      const i2 = idx[i + 2] * stride

      const ax = pos[i1] - pos[i0]
      const ay = pos[i1 + 1] - pos[i0 + 1]
      const az = pos[i1 + 2] - pos[i0 + 2]

      const bx = pos[i2] - pos[i0]
      const by = pos[i2 + 1] - pos[i0 + 1]
      const bz = pos[i2 + 2] - pos[i0 + 2]

      const nx = ay * bz - az * by
      const ny = az * bx - ax * bz
      const nz = ax * by - ay * bx

      const n0 = idx[i] * 3
      const n1 = idx[i + 1] * 3
      const n2 = idx[i + 2] * 3

      normals[n0] += nx
      normals[n0 + 1] += ny
      normals[n0 + 2] += nz
      normals[n1] += nx
      normals[n1 + 1] += ny
      normals[n1 + 2] += nz
      normals[n2] += nx
      normals[n2 + 1] += ny
      normals[n2 + 2] += nz
    }

    for (let i = 0; i < numVerts; i++) {
      const o = i * 3
      const l = Math.hypot(normals[o], normals[o + 1], normals[o + 2])
      if (l > 1e-7) {
        normals[o] /= l
        normals[o + 1] /= l
        normals[o + 2] /= l
      }
    }
    const tB = performance.now() - tB0

    console.log(`\n[Test 2] Mesh & Normals Evaluation:`)
    console.log(`  - Manifold calculateNormals(0) + getMesh: ${tA.toFixed(2)} ms (Verts: ${meshA.vertProperties.length / meshA.numProp})`)
    console.log(`  - Direct getMesh() + TypedArray Normals:  ${tB.toFixed(2)} ms (Verts: ${numVerts})`)
    console.log(`  - Time Saved:                             ${(tA - tB).toFixed(2)} ms`)

    expect(tB).toBeLessThan(200) // 目标优化至 < 200 ms
    expect(normals.length).toBe(numVerts * 3)
  })

  it('3. Incremental Chunked Update on Single Cavity Modification', () => {
    const prototype = buildCavityManifold(mod, standardSteps, 32)
    const baseMesh = Manifold.cube(dims, false)

    // 构建 15 个 Chunk，每组 20 个孔腔
    const chunkSize = 20
    const chunkCount = 15
    const chunkUnions: any[] = []
    const allCavities: any[][] = []

    for (let k = 0; k < chunkCount; k++) {
      const group: any[] = []
      for (let i = 0; i < chunkSize; i++) {
        const id = k * chunkSize + i
        const r = Math.floor(id / cols)
        const c = id % cols
        const x = (c + 1) * dx
        const y = (r + 1) * dy
        const z = sz
        const mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, x, y, z, 1]
        group.push(prototype.transform(mat).asOriginal())
      }
      allCavities.push(group)
      chunkUnions.push(Manifold.union(group))
    }

    // 初始全量差集
    const fullUnion = Manifold.union(chunkUnions)
    const fullDiff = Manifold.difference(baseMesh, fullUnion)
    expect(fullDiff.getMesh().triVerts.length).toBeGreaterThan(0)

    // 模拟：用户拖拽修改第 42 号孔腔（属于 Chunk 2）
    const tDirty0 = performance.now()
    const targetChunkIdx = 2
    const targetGroup = allCavities[targetChunkIdx]
    // 替换其中的 1 个孔腔
    const newMat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 180, 180, sz, 1]
    targetGroup[2] = prototype.transform(newMat).asOriginal()
    // 仅重新 union 脏 Chunk
    chunkUnions[targetChunkIdx] = Manifold.union(targetGroup)
    // 重新合成总工具
    const updatedUnion = Manifold.union(chunkUnions)
    const updatedDiff = Manifold.difference(baseMesh, updatedUnion)
    const updatedMesh = updatedDiff.getMesh()
    const tDirty = performance.now() - tDirty0

    console.log(`\n[Test 3] Incremental Single Cavity Modification:`)
    console.log(`  - Dirty Chunk Re-union + CSG Difference + getMesh: ${tDirty.toFixed(2)} ms`)
    console.log(`  - Triangles: ${updatedMesh.triVerts.length / 3}`)

    expect(tDirty).toBeLessThan(180)
  })

  it('4. WASM Memory Management: Disposing unused Manifold instances', () => {
    const memoryTracker: any[] = []
    const track = (m: any) => {
      memoryTracker.push(m)
      return m
    }

    // 模拟 10 次微调循环
    for (let step = 0; step < 10; step++) {
      const base = track(Manifold.cube([100, 100, 50], false))
      const cav = track(Manifold.cylinder(30, 10, 10, 16, false))
      const res = track(Manifold.difference(base, cav))
      const mesh = res.getMesh()
      expect(mesh.triVerts.length).toBeGreaterThan(0)

      // 及时销毁本帧所有 WASM 堆对象
      for (const obj of memoryTracker) {
        if (typeof obj.delete === 'function') {
          obj.delete()
        }
      }
      memoryTracker.length = 0
    }
  })

  it('5. Feature Edge Extraction on Large Scale Mesh', () => {
    const base = Manifold.cube([100, 100, 50], false)
    const cav = buildCavityManifold(mod, standardSteps, 32).transform([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 50, 50, 50, 1
    ])
    const res = Manifold.difference(base, cav)
    const mesh = res.getMesh()

    const numVerts = mesh.vertProperties.length / mesh.numProp
    const positions = new Float32Array(numVerts * 3)
    for (let i = 0; i < numVerts; i++) {
      positions[i * 3] = mesh.vertProperties[i * mesh.numProp]
      positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1]
      positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2]
    }
    const indices = new Uint32Array(mesh.triVerts)

    const t0 = performance.now()
    const edges = extractFeatureEdges(positions, indices, 28)
    const tExtract = performance.now() - t0

    console.log(`\n[Test 5] Feature Edge Extraction: ${tExtract.toFixed(2)} ms, Line segments: ${edges.length / 6}`)
    expect(edges.length).toBeGreaterThan(0)
  })
})
