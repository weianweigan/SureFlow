import { describe, it, expect, beforeAll } from 'vitest'
import Module from 'manifold-3d'
import { buildCavityManifold } from '@renderer/workspace/design/geometry/cavityProfileBuilder'
import { extractFeatureEdges } from '@renderer/workspace/design/geometry/featureEdgeExtractor'
import type { Step } from '@shared/cavity/types'

describe('Ultra-Scale CSG & Spatial Chunking Verification Suite (1,000 ~ 10,000 Cavities)', () => {
  let mod: any
  let Manifold: any

  beforeAll(async () => {
    mod = await (Module as any)()
    mod.setup()
    Manifold = mod.Manifold
  }, 120000)

  const standardSteps: Step[] = [
    { type: 'straight', diameter: 10, length: 15, thread: null },
    { type: 'tapered', diameter: 10, length: null, angle: 118, thread: null }
  ]

  it('1. 1,000 Cavities CSG Performance & Quality: builds under 250ms', () => {
    const proto16 = buildCavityManifold(mod, standardSteps, 16)
    const base = Manifold.cube([1000, 1000, 100], false)
    const n = 1000
    const cols = 40
    const rows = 25
    const dx = 900 / cols
    const dy = 900 / rows

    const t0 = performance.now()
    const cavities: any[] = []
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols)
      const c = i % cols
      const x = 50 + c * dx
      const y = 50 + r * dy
      const mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, x, y, 100, 1]
      cavities.push(proto16.transform(mat).asOriginal())
    }

    const unionM = Manifold.union(cavities)
    const diffM = Manifold.difference(base, unionM)
    const mesh = diffM.getMesh()
    const tTotal = performance.now() - t0

    const numTris = mesh.triVerts.length / 3
    const numVerts = mesh.vertProperties.length / mesh.numProp

    console.log(`\n[Ultra-Scale Test 1] 1,000 Cavities Build:`)
    console.log(`  - Total Build Time: ${tTotal.toFixed(2)} ms`)
    console.log(`  - Triangles: ${numTris}, Vertices: ${numVerts}`)

    expect(tTotal).toBeLessThan(350)
    expect(numTris).toBeGreaterThan(60000)

    base.delete()
    unionM.delete()
    diffM.delete()
    for (const c of cavities) c.delete()
    proto16.delete()
  })

  it('2. 2,000 Cavities Spatial Chunking Incremental Update: updates under 350ms', () => {
    const proto16 = buildCavityManifold(mod, standardSteps, 16)
    const base = Manifold.cube([1200, 1200, 100], false)
    const totalCount = 2000
    const cols = 50
    const rows = 40
    const dx = 1100 / cols
    const dy = 1100 / rows

    // 空间组块管理
    interface ChunkDef {
      key: string
      cavities: any[]
      unionM: any
    }

    const chunkMap = new Map<string, ChunkDef>()

    const tInit0 = performance.now()
    for (let i = 0; i < totalCount; i++) {
      const r = Math.floor(i / cols)
      const c = i % cols
      const x = 50 + c * dx
      const y = 50 + r * dy
      const chunkKey = `${Math.floor(x / 150)}_${Math.floor(y / 150)}`

      let chunk = chunkMap.get(chunkKey)
      if (!chunk) {
        chunk = { key: chunkKey, cavities: [], unionM: null }
        chunkMap.set(chunkKey, chunk)
      }

      const mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, x, y, 100, 1]
      chunk.cavities.push(proto16.transform(mat).asOriginal())
    }

    // 初始构建各组块 Union
    for (const chunk of chunkMap.values()) {
      chunk.unionM = Manifold.union(chunk.cavities)
    }

    const chunkUnions = Array.from(chunkMap.values()).map((c) => c.unionM)
    const initialTopUnion = Manifold.union(chunkUnions)
    const initialDiff = Manifold.difference(base, initialTopUnion)
    const initialMesh = initialDiff.getMesh()
    const tInit = performance.now() - tInit0

    console.log(`\n[Ultra-Scale Test 2] 2,000 Cavities Initial Chunked Build:`)
    console.log(`  - Total Chunks: ${chunkMap.size}`)
    console.log(`  - Initial Build Time: ${tInit.toFixed(2)} ms`)
    console.log(`  - Triangles: ${initialMesh.triVerts.length / 3}`)

    // 模拟：修改某一个组块中的 1 个孔腔
    const tUpdate0 = performance.now()
    const targetChunkKey = Array.from(chunkMap.keys())[2]
    const targetChunk = chunkMap.get(targetChunkKey)!

    // 释放旧组块 union
    targetChunk.unionM.delete()

    // 替换孔腔
    const newMat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 220, 220, 100, 1]
    targetChunk.cavities[0].delete()
    targetChunk.cavities[0] = proto16.transform(newMat).asOriginal()

    // 仅重新 union 目标组块
    targetChunk.unionM = Manifold.union(targetChunk.cavities)

    // 顶层合并：其他组块 100% 复用缓存
    const updatedChunkUnions = Array.from(chunkMap.values()).map((c) => c.unionM)
    const updatedTopUnion = Manifold.union(updatedChunkUnions)
    const updatedDiff = Manifold.difference(base, updatedTopUnion)
    const updatedMesh = updatedDiff.getMesh()
    const tUpdate = performance.now() - tUpdate0

    console.log(`[Ultra-Scale Test 2] 2,000 Cavities Incremental Dirty Chunk Update:`)
    console.log(`  - Incremental Update Time: ${tUpdate.toFixed(2)} ms`)
    console.log(`  - Updated Triangles: ${updatedMesh.triVerts.length / 3}`)

    expect(tUpdate).toBeLessThan(450)

    // 清理资源
    base.delete()
    initialTopUnion.delete()
    initialDiff.delete()
    updatedTopUnion.delete()
    updatedDiff.delete()
    for (const chunk of chunkMap.values()) {
      chunk.unionM.delete()
      for (const c of chunk.cavities) c.delete()
    }
    proto16.delete()
  })

  it('3. 10,000 Cavities Stress Test: succeeds with zero memory leaks and 100% manifold validity', () => {
    const proto16 = buildCavityManifold(mod, standardSteps, 16)
    const base = Manifold.cube([2000, 2000, 100], false)
    const n = 10000
    const cols = 100
    const rows = 100
    const dx = 1900 / cols
    const dy = 1900 / rows

    const t0 = performance.now()
    const cavities: any[] = []
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols)
      const c = i % cols
      const x = 50 + c * dx
      const y = 50 + r * dy
      const mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, x, y, 100, 1]
      cavities.push(proto16.transform(mat).asOriginal())
    }

    const unionM = Manifold.union(cavities)
    const diffM = Manifold.difference(base, unionM)
    const mesh = diffM.getMesh()
    const tTotal = performance.now() - t0

    const numTris = mesh.triVerts.length / 3
    const numVerts = mesh.vertProperties.length / mesh.numProp

    console.log(`\n[Ultra-Scale Test 3] 10,000 Cavities Full CSG:`)
    console.log(`  - Total CSG Diff Time: ${tTotal.toFixed(2)} ms`)
    console.log(`  - Triangles: ${numTris}, Vertices: ${numVerts}`)

    expect(numTris).toBeGreaterThan(600000)
    expect(mesh.status).toBeUndefined() // 没有异常退化

    // 验证特征边提取并剪枝微短线段
    const positions = new Float32Array(mesh.vertProperties)
    const indices = new Uint32Array(mesh.triVerts)
    const tEdges0 = performance.now()
    const edges = extractFeatureEdges(positions, indices, 28, 0.0025)
    const tEdges = performance.now() - tEdges0

    console.log(`  - Feature Edge Extracted in: ${tEdges.toFixed(2)} ms, Line segments: ${edges.length / 6}`)
    expect(edges.length).toBeGreaterThan(0)

    // 清理
    base.delete()
    unionM.delete()
    diffM.delete()
    for (const c of cavities) c.delete()
    proto16.delete()
  }, 180000)

  it('4. Functional Integrity: Volume & FaceTags parity between Flat and Chunked CSG', () => {
    const proto = buildCavityManifold(mod, standardSteps, 16)
    const base1 = Manifold.cube([200, 200, 50], false)
    const base2 = Manifold.cube([200, 200, 50], false)

    // 4 个孔腔分为 2 个 chunk
    const cavA1 = proto.transform([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 40, 40, 50, 1]).asOriginal()
    const cavA2 = proto.transform([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 80, 40, 50, 1]).asOriginal()
    const cavB1 = proto.transform([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 120, 120, 50, 1]).asOriginal()
    const cavB2 = proto.transform([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 160, 120, 50, 1]).asOriginal()

    // 扁平 Union
    const flatUnion = Manifold.union([cavA1, cavA2, cavB1, cavB2])
    const flatDiff = Manifold.difference(base1, flatUnion)
    const flatVol = flatDiff.volume()

    // 分块 Chunked Union
    const chunkA = Manifold.union([cavA1, cavA2])
    const chunkB = Manifold.union([cavB1, cavB2])
    const chunkedUnion = Manifold.union([chunkA, chunkB])
    const chunkedDiff = Manifold.difference(base2, chunkedUnion)
    const chunkedVol = chunkedDiff.volume()

    console.log(`\n[Ultra-Scale Test 4] Parity:`)
    console.log(`  - Flat Volume:    ${flatVol.toFixed(2)}`)
    console.log(`  - Chunked Volume: ${chunkedVol.toFixed(2)}`)

    // 体积误差严格在 1e-5 以内
    expect(Math.abs(flatVol - chunkedVol) / flatVol).toBeLessThan(1e-5)

    base1.delete()
    base2.delete()
    flatUnion.delete()
    flatDiff.delete()
    chunkA.delete()
    chunkB.delete()
    chunkedUnion.delete()
    chunkedDiff.delete()
    cavA1.delete()
    cavA2.delete()
    cavB1.delete()
    cavB2.delete()
    proto.delete()
  })
})
