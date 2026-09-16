/**
 * CAD 特征棱边提取算法（Dihedral Angle Threshold · Sort-Based Zero-Allocation）
 * 对齐 PRD-FR-04-02 §2.1 与 PRD-FR-04-02c §3.5 规范：
 * 采用连续 BigUint64 排序替代 JS Map 哈希表查找：
 * 1. 打包无向边 (minV << 42) | (maxV << 20) | triIdx
 * 2. BigUint64Array.prototype.sort() 快速排序，零字符串与对象分配
 * 3. 线性扫描：提取二面角 θ_dihedral > 28° 的特征边与单面外边界边
 */

export function extractFeatureEdges(
  positions: Float32Array,
  indices: Uint32Array,
  thresholdDeg: number = 28,
  minSegmentLengthSq: number = 0
): Float32Array {
  const numTri = Math.floor(indices.length / 3)
  if (numTri === 0) return new Float32Array(0)

  const thresholdCos = Math.cos((thresholdDeg * Math.PI) / 180)

  // 1. 计算每个三角形的面法向量
  const triNormals = new Float32Array(numTri * 3)
  for (let t = 0; t < numTri; t++) {
    const idx = t * 3
    const i0 = indices[idx] * 3
    const i1 = indices[idx + 1] * 3
    const i2 = indices[idx + 2] * 3

    const ax = positions[i1] - positions[i0]
    const ay = positions[i1 + 1] - positions[i0 + 1]
    const az = positions[i1 + 2] - positions[i0 + 2]

    const bx = positions[i2] - positions[i0]
    const by = positions[i2 + 1] - positions[i0 + 1]
    const bz = positions[i2 + 2] - positions[i0 + 2]

    let nx = ay * bz - az * by
    let ny = az * bx - ax * bz
    let nz = ax * by - ay * bx
    const len = Math.hypot(nx, ny, nz)
    if (len > 1e-7) {
      nx /= len
      ny /= len
      nz /= len
    }
    triNormals[idx] = nx
    triNormals[idx + 1] = ny
    triNormals[idx + 2] = nz
  }

  // 2. 将全部半边打包进连续 BigUint64Array (总半边数 = 3 * numTri)
  const totalEdges = numTri * 3
  const edgeData = new BigUint64Array(totalEdges)

  for (let t = 0; t < numTri; t++) {
    const tIdx = t * 3
    const v0 = indices[tIdx]
    const v1 = indices[tIdx + 1]
    const v2 = indices[tIdx + 2]

    const p0 = v0 < v1 ? [v0, v1] : [v1, v0]
    const p1 = v1 < v2 ? [v1, v2] : [v2, v1]
    const p2 = v2 < v0 ? [v2, v0] : [v0, v2]

    edgeData[tIdx] = (BigInt(p0[0]) << 42n) | (BigInt(p0[1]) << 20n) | BigInt(t)
    edgeData[tIdx + 1] = (BigInt(p1[0]) << 42n) | (BigInt(p1[1]) << 20n) | BigInt(t)
    edgeData[tIdx + 2] = (BigInt(p2[0]) << 42n) | (BigInt(p2[1]) << 20n) | BigInt(t)
  }

  // 原生快速排序（零 V8 GC 停顿）
  edgeData.sort()

  // 3. 线性扫描并提取特征棱边
  const maxOutputFloats = totalEdges * 6
  const outputEdges = new Float32Array(maxOutputFloats)
  let outPtr = 0

  const MASK_KEY = 0xffffffffff00000n
  const MASK_TRI = 0xfffff

  let i = 0
  while (i < totalEdges) {
    const current = edgeData[i]
    const currentKey = current & MASK_KEY
    const v0 = Number(current >> 42n)
    const v1 = Number((current >> 20n) & 0x3fffffn)

    let j = i + 1
    while (j < totalEdges && (edgeData[j] & MASK_KEY) === currentKey) {
      j++
    }

    const count = j - i
    let isFeature = false

    if (count === 1) {
      // 单面边界边
      isFeature = true
    } else if (count === 2) {
      // 两个相邻三角面共享边，计算二面角
      const tri0 = Number(current & BigInt(MASK_TRI))
      const tri1 = Number(edgeData[i + 1] & BigInt(MASK_TRI))

      const n0 = tri0 * 3
      const n1 = tri1 * 3
      const dot =
        triNormals[n0] * triNormals[n1] +
        triNormals[n0 + 1] * triNormals[n1 + 1] +
        triNormals[n0 + 2] * triNormals[n1 + 2]

      if (dot < thresholdCos) {
        isFeature = true
      }
    } else {
      // 非流形复合多边边 (count >= 3)，一律提取为特征边
      isFeature = true
    }

    if (isFeature) {
      const p0 = v0 * 3
      const p1 = v1 * 3
      const x0 = positions[p0]
      const y0 = positions[p0 + 1]
      const z0 = positions[p0 + 2]
      const x1 = positions[p1]
      const y1 = positions[p1 + 1]
      const z1 = positions[p1 + 2]

      if (minSegmentLengthSq > 0) {
        const dx = x1 - x0
        const dy = y1 - y0
        const dz = z1 - z0
        if (dx * dx + dy * dy + dz * dz < minSegmentLengthSq) {
          i = j
          continue
        }
      }

      outputEdges[outPtr++] = x0
      outputEdges[outPtr++] = y0
      outputEdges[outPtr++] = z0
      outputEdges[outPtr++] = x1
      outputEdges[outPtr++] = y1
      outputEdges[outPtr++] = z1
    }

    i = j
  }

  return outputEdges.slice(0, outPtr)
}
