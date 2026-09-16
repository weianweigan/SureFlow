import { describe, it, expect, beforeAll } from 'vitest'
import Module from 'manifold-3d'
import { buildCavityManifold } from '@renderer/workspace/design/geometry/cavityProfileBuilder'
import { getBoxFaceBasis, getCavityWorldMatrix } from '@shared/design/faceMath'
import type { Step } from '@shared/cavity/types'

describe('Cross-Chunk Cavity Migration Test Suite', () => {
  let mod: any
  let Manifold: any

  beforeAll(async () => {
    mod = await (Module as any)()
    mod.setup()
    Manifold = mod.Manifold
  }, 60000)

  const standardSteps: Step[] = [
    { type: 'straight', diameter: 12, length: 15, thread: null },
    { type: 'tapered', diameter: 12, length: null, angle: 118, thread: null }
  ]

  // 模拟 csg.worker.ts 中的分块管理器
  interface CavityInput {
    instanceId: string
    numericId: number
    worldMatrix: number[]
    steps: Step[]
  }

  interface CachedChunk {
    chunkKey: string
    hash: string
    unionManifold: any
    originalIdMap: Map<number, number>
  }

  function getCavityChunkKey(cav: CavityInput): string {
    const m = cav.worldMatrix
    const x = Math.round(m[12] || 0)
    const y = Math.round(m[13] || 0)
    const z = Math.round(m[14] || 0)
    return `${Math.floor(x / 80)}_${Math.floor(y / 80)}_${Math.floor(z / 80)}`
  }

  function computeChunkHash(cavities: CavityInput[], segments: number): string {
    let hash = `${segments}:${cavities.length}`
    for (let i = 0; i < cavities.length; i++) {
      const c = cavities[i]
      const m = c.worldMatrix
      hash += `|${c.numericId}:${c.instanceId}:${m[12].toFixed(1)},${m[13].toFixed(1)},${m[14].toFixed(1)}`
    }
    return hash
  }

  class ChunkedCsgEngine {
    private cachedChunks = new Map<string, CachedChunk>()

    public compute(
      baseDims: [number, number, number],
      cavities: CavityInput[],
      segments: number = 16
    ) {
      const proto = buildCavityManifold(mod, standardSteps, segments)
      const baseMesh = Manifold.cube(baseDims, false)

      // 1. 按 chunkKey 分组
      const chunkGroups = new Map<string, CavityInput[]>()
      for (const cav of cavities) {
        const key = getCavityChunkKey(cav)
        let g = chunkGroups.get(key)
        if (!g) {
          g = []
          chunkGroups.set(key, g)
        }
        g.push(cav)
      }

      const activeChunkUnions: any[] = []
      const originalIdToNumericId = new Map<number, number>()
      const currentChunkKeys = new Set<string>()

      for (const [chunkKey, chunkCavities] of chunkGroups.entries()) {
        currentChunkKeys.add(chunkKey)
        const chunkHash = computeChunkHash(chunkCavities, segments)
        const cached = this.cachedChunks.get(chunkKey)

        if (cached && cached.hash === chunkHash) {
          // 命中
          activeChunkUnions.push(cached.unionManifold)
          for (const [origId, numId] of cached.originalIdMap.entries()) {
            originalIdToNumericId.set(origId, numId)
          }
        } else {
          // 脏或新
          if (cached) {
            cached.unionManifold.delete()
          }
          const chunkOrigMap = new Map<number, number>()
          const tempCavs: any[] = []
          for (const cav of chunkCavities) {
            const cavM = proto.transform(cav.worldMatrix).asOriginal()
            const origId = cavM.originalID()
            chunkOrigMap.set(origId, cav.numericId)
            originalIdToNumericId.set(origId, cav.numericId)
            tempCavs.push(cavM)
          }

          const chunkUnion = tempCavs.length === 1 ? tempCavs[0] : Manifold.union(tempCavs)
          if (tempCavs.length > 1) {
            for (const m of tempCavs) m.delete()
          }

          this.cachedChunks.set(chunkKey, {
            chunkKey,
            hash: chunkHash,
            unionManifold: chunkUnion,
            originalIdMap: chunkOrigMap
          })
          activeChunkUnions.push(chunkUnion)
        }
      }

      // 清理过期失效组块（例如某组块内的全部孔都被移走）
      for (const [key, chunk] of this.cachedChunks.entries()) {
        if (!currentChunkKeys.has(key)) {
          chunk.unionManifold.delete()
          this.cachedChunks.delete(key)
        }
      }

      const toolUnion =
        activeChunkUnions.length === 0
          ? null
          : activeChunkUnions.length === 1
            ? activeChunkUnions[0]
            : Manifold.union(activeChunkUnions)

      const resultManifold = toolUnion ? Manifold.difference(baseMesh, toolUnion) : baseMesh

      const mesh = resultManifold.getMesh()
      const volume = resultManifold.volume()

      // 解析 faceTags
      const numTri = mesh.triVerts.length / 3
      const faceTags = new Uint32Array(numTri)
      if (mesh.runIndex && mesh.runOriginalID) {
        for (let r = 0; r < mesh.runOriginalID.length; r++) {
          const startTri = Math.floor(mesh.runIndex[r] / 3)
          const endTri = Math.floor(
            (r + 1 < mesh.runIndex.length ? mesh.runIndex[r + 1] : mesh.triVerts.length) / 3
          )
          const origId = mesh.runOriginalID[r]
          const numericId = originalIdToNumericId.get(origId) || 0
          for (let t = startTri; t < endTri; t++) {
            faceTags[t] = numericId
          }
        }
      }

      // 清理本轮临时派生
      baseMesh.delete()
      if (toolUnion && activeChunkUnions.length > 1) {
        toolUnion.delete()
      }
      resultManifold.delete()
      proto.delete()

      return {
        volume,
        triCount: numTri,
        faceTags,
        activeChunkCount: this.cachedChunks.size,
        chunkKeys: Array.from(this.cachedChunks.keys())
      }
    }

    public destroy() {
      for (const chunk of this.cachedChunks.values()) {
        chunk.unionManifold.delete()
      }
      this.cachedChunks.clear()
    }
  }

  it('1. Test Cavity Moving from Chunk A (0_0_1) to Chunk B (1_0_1)', () => {
    const engine = new ChunkedCsgEngine()
    const dims: [number, number, number] = [300, 200, 100]

    // 初始状态：
    // 孔 1: (40, 40, 100) -> 归属 chunk "0_0_1"
    // 孔 2: (60, 40, 100) -> 归属 chunk "0_0_1"
    // 孔 3: (120, 40, 100) -> 归属 chunk "1_0_1"
    const cavitiesStep1: CavityInput[] = [
      {
        instanceId: 'cav-1',
        numericId: 1,
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 40, 40, 100, 1],
        steps: standardSteps
      },
      {
        instanceId: 'cav-2',
        numericId: 2,
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 60, 40, 100, 1],
        steps: standardSteps
      },
      {
        instanceId: 'cav-3',
        numericId: 3,
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 120, 40, 100, 1],
        steps: standardSteps
      }
    ]

    const res1 = engine.compute(dims, cavitiesStep1)
    console.log(`Step 1 (Initial): Chunks=${res1.chunkKeys.join(',')}, Vol=${res1.volume.toFixed(2)}`)
    expect(res1.chunkKeys).toEqual(expect.arrayContaining(['0_0_1', '1_0_1']))

    // 验证 faceTags 中存在 1, 2, 3
    const tags1 = new Set(Array.from(res1.faceTags))
    expect(tags1.has(1)).toBe(true)
    expect(tags1.has(2)).toBe(true)
    expect(tags1.has(3)).toBe(true)

    // 步骤 2：将 孔 2 从 x=60 移动到 x=140（从 chunk "0_0_1" 跨越边界移入 "1_0_1"）
    const cavitiesStep2: CavityInput[] = [
      {
        instanceId: 'cav-1',
        numericId: 1,
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 40, 40, 100, 1],
        steps: standardSteps
      },
      {
        instanceId: 'cav-2',
        numericId: 2,
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 140, 40, 100, 1], // 跨块移动
        steps: standardSteps
      },
      {
        instanceId: 'cav-3',
        numericId: 3,
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 120, 40, 100, 1],
        steps: standardSteps
      }
    ]

    const res2 = engine.compute(dims, cavitiesStep2)
    console.log(`Step 2 (Cross-Chunk Move): Chunks=${res2.chunkKeys.join(',')}, Vol=${res2.volume.toFixed(2)}`)

    // 验证体积守恒（孔 2 只是平移，未与其它孔交叠，总体积应相同）
    expect(Math.abs(res1.volume - res2.volume)).toBeLessThan(0.01)

    // 验证 faceTags 仍然完整且正确标记孔 1, 2, 3
    const tags2 = new Set(Array.from(res2.faceTags))
    expect(tags2.has(1)).toBe(true)
    expect(tags2.has(2)).toBe(true)
    expect(tags2.has(3)).toBe(true)

    // 步骤 3：与无缓存从头全量构建进行严格基准比对 (Ground Truth)
    const freshEngine = new ChunkedCsgEngine()
    const freshRes = freshEngine.compute(dims, cavitiesStep2)

    console.log(`Step 3 (Ground Truth Check): Fresh Vol=${freshRes.volume.toFixed(2)}`)
    expect(Math.abs(res2.volume - freshRes.volume)).toBeLessThan(1e-4)
    expect(res2.triCount).toBe(freshRes.triCount)

    engine.destroy()
    freshEngine.destroy()
  })

  it('2. Test Lone Cavity Moving to Another Chunk (Empty Chunk Auto Cleanup)', () => {
    const engine = new ChunkedCsgEngine()
    const dims: [number, number, number] = [300, 200, 100]

    // 初始状态：
    // 孔 1 是 chunk "0_0_1" 中的唯一孔腔
    // 孔 2 在 chunk "1_0_1"
    const cavitiesStep1: CavityInput[] = [
      {
        instanceId: 'cav-1',
        numericId: 1,
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 40, 40, 100, 1],
        steps: standardSteps
      },
      {
        instanceId: 'cav-2',
        numericId: 2,
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 140, 40, 100, 1],
        steps: standardSteps
      }
    ]

    const res1 = engine.compute(dims, cavitiesStep1)
    expect(res1.activeChunkCount).toBe(2)
    expect(res1.chunkKeys).toContain('0_0_1')

    // 移动孔 1 到 chunk "1_0_1" (x=160)
    // 此时 chunk "0_0_1" 变为空，应当被自动清理，存活组块变为 1 个
    const cavitiesStep2: CavityInput[] = [
      {
        instanceId: 'cav-1',
        numericId: 1,
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 120, 40, 100, 1], // 120 / 80 = 1 -> chunk 1_0_1
        steps: standardSteps
      },
      {
        instanceId: 'cav-2',
        numericId: 2,
        worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 140, 40, 100, 1],
        steps: standardSteps
      }
    ]

    const res2 = engine.compute(dims, cavitiesStep2)
    console.log(`Step 2 (Lone Cavity Migration): Active Chunks=${res2.activeChunkCount}, Keys=${res2.chunkKeys.join(',')}`)

    // 验证空 chunk "0_0_1" 被彻底清理
    expect(res2.activeChunkCount).toBe(1)
    expect(res2.chunkKeys).toEqual(['1_0_1'])

    // 验证几何与 faceTags 依然正确
    const tags2 = new Set(Array.from(res2.faceTags))
    expect(tags2.has(1)).toBe(true)
    expect(tags2.has(2)).toBe(true)

    engine.destroy()
  })

  it('3. Test Cavity Moving Across Faces (Top face to Front face)', () => {
    const engine = new ChunkedCsgEngine()
    const dims: [number, number, number] = [300, 200, 100]

    // 初始状态：孔 1 位于 Top 面 (z=100)，打孔向下沿 -Z
    // Matrix for Top face: (x=50, y=50, z=100), dir = -Z
    const topMat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 50, 50, 100, 1]

    const cavities1: CavityInput[] = [
      { instanceId: 'cav-1', numericId: 1, worldMatrix: topMat, steps: standardSteps }
    ]

    const res1 = engine.compute(dims, cavities1)
    expect(res1.chunkKeys).toEqual(['0_0_1'])
    expect(res1.faceTags.some((t) => t === 1)).toBe(true)

    // 移动至 Front 面，使用标准 faceMath 获得矩阵
    const basisFront = getBoxFaceBasis('front', dims)
    const frontMat = Array.from(getCavityWorldMatrix(basisFront, 50, 50, 0, 0))

    const cavities2: CavityInput[] = [
      { instanceId: 'cav-1', numericId: 1, worldMatrix: frontMat, steps: standardSteps }
    ]

    const res2 = engine.compute(dims, cavities2)
    console.log(`Step 3 (Cross Face Move): Chunks=${res2.chunkKeys.join(',')}`)
    expect(res2.chunkKeys.length).toBe(1)
    expect(res2.faceTags.some((t) => t === 1)).toBe(true)

    // 与全新非缓存引擎求值对比
    const freshEngine = new ChunkedCsgEngine()
    const freshRes = freshEngine.compute(dims, cavities2)
    expect(Math.abs(res2.volume - freshRes.volume)).toBeLessThan(1e-4)

    engine.destroy()
    freshEngine.destroy()
  })
})
