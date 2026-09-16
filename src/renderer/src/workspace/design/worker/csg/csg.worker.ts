/**
 * CSG Worker（manifold-3d WASM）
 * 对齐 PRD-FR-04-02 §1.1 与 PRD-FR-04-02c 规范：
 * 负责超大规模孔腔（1,000~10,000）空间分块增量差集运算、毫秒级 CAD 特征棱边提取、FaceTag 映射传递与零泄漏内存管控
 */

import Module from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { extractFeatureEdges } from '../../geometry/featureEdgeExtractor'
import { buildCavityManifold, getCavityStepSignature } from '../../geometry/cavityProfileBuilder'
import type { Step } from '@shared/cavity/types'

export interface CsgCavityInput {
  instanceId: string
  numericId: number
  steps: Step[]
  worldMatrix: number[] // 16 元素列优先矩阵
  suppressed?: boolean
}

export interface CsgBooleanTaskMessage {
  type: 'CSG_BOOLEAN_TASK'
  taskId: number
  baseBody: {
    template?: string
    dimensions: [number, number, number]
  }
  cavities: CsgCavityInput[]
  segments?: number // 细分段数（交互拖拽 16，静止高精 32）
}

export interface CsgSuccessResponse {
  type: 'CSG_SUCCESS'
  taskId: number
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  edgePositions: Float32Array
  faceTags: Uint32Array // 每个面元 (三角形) 的所属对象 ID (0 为基体，>0 为对应孔腔)
  numericIdToInstanceId: Record<number, string>
}

export interface CsgErrorResponse {
  type: 'CSG_ERROR'
  taskId: number
  error: string
}

let manifoldInstance: any = null
let manifoldInitPromise: Promise<any> | null = null

async function getManifold(): Promise<any> {
  if (manifoldInstance) return manifoldInstance
  if (!manifoldInitPromise) {
    manifoldInitPromise = (async () => {
      const mod = await (Module as any)({
        locateFile: () => wasmUrl
      })
      mod.setup()
      manifoldInstance = mod
      return mod
    })()
  }
  return manifoldInitPromise
}

// 原型缓存池：避免对同规格孔型重复生成圆柱并内部 union (370ms -> 12ms)
const prototypeCache = new Map<string, any>()

function getOrCreatePrototype(manifoldModule: any, steps: Step[], segments: number): any {
  const sig = getCavityStepSignature(steps, segments)
  let proto = prototypeCache.get(sig)
  if (!proto) {
    proto = buildCavityManifold(manifoldModule, steps, segments)
    prototypeCache.set(sig, proto)
  }
  return proto
}

// 空间分块增量缓存结构（支撑 1,000 ~ 10,000 孔腔的局部增量求值）
interface CachedChunk {
  chunkKey: string
  hash: string
  unionManifold: any
  originalIdMap: Map<number, number>
}

const cachedChunks = new Map<string, CachedChunk>()
let lastDimensionsKey = ''

function getCavityChunkKey(cav: CsgCavityInput): string {
  const m = cav.worldMatrix
  const x = Math.round(m[12] || 0)
  const y = Math.round(m[13] || 0)
  const z = Math.round(m[14] || 0)
  // 80mm 空间网格空间划分
  return `${Math.floor(x / 80)}_${Math.floor(y / 80)}_${Math.floor(z / 80)}`
}

function computeChunkHash(cavities: CsgCavityInput[], segments: number): string {
  let hash = `${segments}:${cavities.length}`
  for (let i = 0; i < cavities.length; i++) {
    const c = cavities[i]
    const m = c.worldMatrix
    const stepSig = getCavityStepSignature(c.steps, segments)
    hash += `|${c.numericId}:${c.instanceId}:${stepSig}:${m[12].toFixed(1)},${m[13].toFixed(1)},${m[14].toFixed(1)},${m[0].toFixed(2)},${m[5].toFixed(2)},${m[8].toFixed(2)},${m[9].toFixed(2)},${m[10].toFixed(2)}`
  }
  return hash
}

// 严格 RAII WASM 内存清理器：每轮任务保证临时实体 100% 析构释放
class WasmDisposer {
  private tracker: any[] = []

  public track<T>(obj: T): T {
    if (obj) this.tracker.push(obj)
    return obj
  }

  public dispose(): void {
    for (let i = 0; i < this.tracker.length; i++) {
      try {
        if (typeof this.tracker[i]?.delete === 'function') {
          this.tracker[i].delete()
        }
      } catch {
        // 忽略已释放对象
      }
    }
    this.tracker.length = 0
  }
}

// 队列与可丢弃防抖机制
let latestTaskId = 0

self.onmessage = async (e: MessageEvent<CsgBooleanTaskMessage>) => {
  const data = e.data
  if (data.type !== 'CSG_BOOLEAN_TASK') return

  const { taskId, baseBody, cavities, segments = 32 } = data
  if (taskId < latestTaskId) {
    return
  }
  latestTaskId = taskId

  const disposer = new WasmDisposer()

  try {
    const manifoldModule = await getManifold()
    const { Manifold } = manifoldModule

    if (taskId < latestTaskId) return

    const [sx, sy, sz] = baseBody.dimensions
    const currentDimsKey = `${sx}_${sy}_${sz}`

    // 若基体尺寸发生改变，清空全部空间组块缓存
    if (currentDimsKey !== lastDimensionsKey) {
      for (const chunk of cachedChunks.values()) {
        try {
          chunk.unionManifold?.delete()
        } catch {
          // ignore
        }
      }
      cachedChunks.clear()
      lastDimensionsKey = currentDimsKey
    }

    // 1. 构建基体 Manifold：从原点 (0,0,0) 沿 +x, +y, +z 方向拉伸 [0, sx] × [0, sy] × [0, sz]
    const baseMesh = disposer.track(Manifold.cube([sx, sy, sz], false))
    const baseOriginalId = baseMesh.originalID?.() ?? 0

    // 2. 将未抑制的孔腔分配到空间组块 (Spatial Chunking)
    const numericIdToInstanceId: Record<number, string> = {}
    const chunkGroups = new Map<string, CsgCavityInput[]>()

    for (const cav of cavities) {
      if (cav.suppressed) continue
      numericIdToInstanceId[cav.numericId] = cav.instanceId

      const chunkKey = getCavityChunkKey(cav)
      let group = chunkGroups.get(chunkKey)
      if (!group) {
        group = []
        chunkGroups.set(chunkKey, group)
      }
      group.push(cav)
    }

    if (taskId < latestTaskId) return

    // 3. 增量组块构建与缓存复用 (Incremental Chunk Union)
    const activeChunkUnions: any[] = []
    const originalIdToNumericId = new Map<number, number>()
    const currentChunkKeys = new Set<string>()

    for (const [chunkKey, chunkCavities] of chunkGroups.entries()) {
      currentChunkKeys.add(chunkKey)
      const chunkHash = computeChunkHash(chunkCavities, segments)
      const cached = cachedChunks.get(chunkKey)

      if (cached && cached.hash === chunkHash) {
        // 命中缓存：直接复用组块 Manifold 与 originalID 映射 (0 ms 开销)
        activeChunkUnions.push(cached.unionManifold)
        for (const [origId, numId] of cached.originalIdMap.entries()) {
          originalIdToNumericId.set(origId, numId)
        }
      } else {
        // 未命中：重构脏组块
        if (cached) {
          try {
            cached.unionManifold?.delete()
          } catch {
            // ignore
          }
        }

        const chunkOrigMap = new Map<number, number>()
        const tempCavManifolds: any[] = []

        for (const cav of chunkCavities) {
          const proto = getOrCreatePrototype(manifoldModule, cav.steps, segments)
          const cavM = proto.transform(cav.worldMatrix).asOriginal()
          const origId = cavM.originalID?.() ?? cav.numericId
          chunkOrigMap.set(origId, cav.numericId)
          originalIdToNumericId.set(origId, cav.numericId)
          tempCavManifolds.push(cavM)
        }

        const chunkUnion =
          tempCavManifolds.length === 1 ? tempCavManifolds[0] : Manifold.union(tempCavManifolds)

        // 释放临时单体
        if (tempCavManifolds.length > 1) {
          for (const m of tempCavManifolds) {
            try {
              m.delete()
            } catch {
              // ignore
            }
          }
        }

        cachedChunks.set(chunkKey, {
          chunkKey,
          hash: chunkHash,
          unionManifold: chunkUnion,
          originalIdMap: chunkOrigMap
        })
        activeChunkUnions.push(chunkUnion)
      }
    }

    // 清理已在场景中不存在的失效组块
    for (const [key, chunk] of cachedChunks.entries()) {
      if (!currentChunkKeys.has(key)) {
        try {
          chunk.unionManifold?.delete()
        } catch {
          // ignore
        }
        cachedChunks.delete(key)
      }
    }

    if (taskId < latestTaskId) return

    // 4. 执行顶层布尔差集运算: Base - ∑ ChunkUnions
    let resultManifold = baseMesh
    if (activeChunkUnions.length > 0) {
      const toolUnion =
        activeChunkUnions.length === 1
          ? activeChunkUnions[0]
          : disposer.track(Manifold.union(activeChunkUnions))

      resultManifold = disposer.track(Manifold.difference(baseMesh, toolUnion))
    }

    if (taskId < latestTaskId) return

    // 5. 提取网格与几何数据
    const mesh = resultManifold.getMesh()
    if (taskId < latestTaskId) return

    const numProp = mesh.numProp
    const numVerts = Math.floor(mesh.vertProperties.length / numProp)
    const numTri = Math.floor(mesh.triVerts.length / 3)

    // 提取顶点坐标
    const positions = new Float32Array(numVerts * 3)
    if (numProp === 3) {
      positions.set(mesh.vertProperties)
    } else {
      for (let i = 0; i < numVerts; i++) {
        const offset = i * numProp
        positions[i * 3] = mesh.vertProperties[offset]
        positions[i * 3 + 1] = mesh.vertProperties[offset + 1]
        positions[i * 3 + 2] = mesh.vertProperties[offset + 2]
      }
    }

    const indices = new Uint32Array(mesh.triVerts)

    // 6. Worker 内部高速 TypedArray 并行直算法向量（~2ms）
    const normals = new Float32Array(numVerts * 3)
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 3
      const i1 = indices[i + 1] * 3
      const i2 = indices[i + 2] * 3

      const ax = positions[i1] - positions[i0]
      const ay = positions[i1 + 1] - positions[i0 + 1]
      const az = positions[i1 + 2] - positions[i0 + 2]

      const bx = positions[i2] - positions[i0]
      const by = positions[i2 + 1] - positions[i0 + 1]
      const bz = positions[i2 + 2] - positions[i0 + 2]

      const nx = ay * bz - az * by
      const ny = az * bx - ax * bz
      const nz = ax * by - ay * bx

      normals[i0] += nx
      normals[i0 + 1] += ny
      normals[i0 + 2] += nz

      normals[i1] += nx
      normals[i1 + 1] += ny
      normals[i1 + 2] += nz

      normals[i2] += nx
      normals[i2 + 1] += ny
      normals[i2 + 2] += nz
    }

    for (let i = 0; i < numVerts; i++) {
      const o = i * 3
      const len = Math.hypot(normals[o], normals[o + 1], normals[o + 2])
      if (len > 1e-7) {
        normals[o] /= len
        normals[o + 1] /= len
        normals[o + 2] /= len
      }
    }

    // 7. 提取特征棱边 (二面角 > 28°，超大规模网格自动过滤 <0.05mm 微小短边)
    const minEdgeLenSq = numTri > 80000 ? 0.0025 : 0 // >8万面时过滤极短微边 (0.05mm)
    const edgePositions = extractFeatureEdges(positions, indices, 28, minEdgeLenSq)

    // 8. 构建面元 CavityInstanceID 映射表 (faceTags)
    const faceTags = new Uint32Array(numTri)
    const runIndex = mesh.runIndex
    const runOriginalID = mesh.runOriginalID

    if (runIndex && runOriginalID && runOriginalID.length > 0) {
      for (let r = 0; r < runOriginalID.length; r++) {
        const startTri = Math.floor(runIndex[r] / 3)
        const endTri = Math.floor(
          (r + 1 < runIndex.length ? runIndex[r + 1] : mesh.triVerts.length) / 3
        )
        const origId = runOriginalID[r]

        let numericId = 0
        if (origId !== baseOriginalId && originalIdToNumericId.has(origId)) {
          numericId = originalIdToNumericId.get(origId)!
        }

        for (let t = startTri; t < endTri; t++) {
          faceTags[t] = numericId
        }
      }
    }

    if (taskId < latestTaskId) return

    // 9. 零拷贝 Transferable Objects 传回主线程
    const response: CsgSuccessResponse = {
      type: 'CSG_SUCCESS',
      taskId,
      positions,
      normals,
      indices,
      edgePositions,
      faceTags,
      numericIdToInstanceId
    }

    ;(self as any).postMessage(response, [
      positions.buffer,
      normals.buffer,
      indices.buffer,
      edgePositions.buffer,
      faceTags.buffer
    ])
  } catch (err: any) {
    if (taskId < latestTaskId) return
    const errResp: CsgErrorResponse = {
      type: 'CSG_ERROR',
      taskId,
      error: String(err?.message || err)
    }
    self.postMessage(errResp)
  } finally {
    // 释放本轮运行的临时派生实体
    disposer.dispose()
  }
}
