import * as THREE from 'three'
import { getBoxFaceBasis, localToWorldPoint } from '@shared/design/faceMath'
import type { CavityInstance } from '@shared/design/types'

export type TriangleTag =
  | { type: 'face'; id: string }
  | { type: 'cavity'; id: string }
  | { type: 'base'; id: 'base' }

export interface ClassifiedMeshResult {
  solidGeometry: THREE.BufferGeometry
  edgeGeometry: THREE.BufferGeometry
  triangleTags: TriangleTag[]
}

/**
 * CSG reuses boundary vertices between an outer plane and a hole wall. Averaging
 * those normals makes every triangulation edge catch the specular light. Duplicate
 * only axis-aligned outer-plane vertices and assign their exact geometric normal;
 * curved cavity walls keep their original smooth normals.
 */
export function stabilizeAxisAlignedPlanarNormals(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  tags: TriangleTag[]
) {
  const outputPositions = Array.from(positions)
  const outputNormals = Array.from(normals)
  const outputIndices = new Uint32Array(indices)
  const duplicates = new Map<string, number>()

  for (let triangle = 0; triangle < tags.length; triangle++) {
    if (tags[triangle].type === 'cavity') continue
    const a = indices[triangle * 3]
    const b = indices[triangle * 3 + 1]
    const c = indices[triangle * 3 + 2]
    const ax=positions[a*3], ay=positions[a*3+1], az=positions[a*3+2]
    const abx=positions[b*3]-ax, aby=positions[b*3+1]-ay, abz=positions[b*3+2]-az
    const acx=positions[c*3]-ax, acy=positions[c*3+1]-ay, acz=positions[c*3+2]-az
    let nx=aby*acz-abz*acy, ny=abz*acx-abx*acz, nz=abx*acy-aby*acx
    const length=Math.hypot(nx,ny,nz)
    if(length<1e-9) continue
    nx/=length;ny/=length;nz/=length
    const axis=Math.abs(nx)>0.9999?'x':Math.abs(ny)>0.9999?'y':Math.abs(nz)>0.9999?'z':null
    if(!axis) continue
    nx=axis==='x'?Math.sign(nx):0
    ny=axis==='y'?Math.sign(ny):0
    nz=axis==='z'?Math.sign(nz):0
    const normalKey=`${nx},${ny},${nz}`
    for(let corner=0;corner<3;corner++) {
      const original=indices[triangle*3+corner]
      const key=`${original}/${normalKey}`
      let replacement=duplicates.get(key)
      if(replacement===undefined) {
        replacement=outputPositions.length/3
        outputPositions.push(positions[original*3],positions[original*3+1],positions[original*3+2])
        outputNormals.push(nx,ny,nz)
        duplicates.set(key,replacement)
      }
      outputIndices[triangle*3+corner]=replacement
    }
  }
  return {
    positions:new Float32Array(outputPositions),
    normals:new Float32Array(outputNormals),
    indices:outputIndices
  }
}

/**
 * 对 CSG 布尔差集计算后的几何体进行高精三角面元分类与多材质分组：
 * 基体几何空间范围定义：从 (0,0,0) 向 +x, +y, +z 方向拉伸 [0, sx] × [0, sy] × [0, sz]
 * 1. 识别基体 6 个外主面（Top: Z=sz, Bottom: Z=0, Front: Y=0, Back: Y=sy, Left: X=0, Right: X=sx）
 * 2. 识别孔腔内壁与底面，归属到具体 CavityInstance
 * 3. 支持 SolidWorks 风格四态材质分组：
 *    - Group 0: 基体未选中表面（45# 钢半透明渲染）
 *    - Group 1: 选中基准面（SolidWorks 亮透天蓝高亮）
 *    - Group 2: 常规孔腔内表面（严格 100% 不透明机械加工灰）
 *    - Group 3: 选中孔腔内表面（严格 100% 不透明 SolidWorks 湛蓝高亮）
 */
function normalizeSelectedCavityIds(input?: string | string[] | null): Set<string> {
  if (!input) return new Set()
  if (Array.isArray(input)) return new Set(input)
  return new Set([input])
}

export function classifyAndGroupCsgGeometry(
  rawPositions: Float32Array,
  rawNormals: Float32Array,
  rawIndices: Uint32Array,
  rawEdgePositions: Float32Array,
  dimensions: [number, number, number],
  cavities: CavityInstance[],
  selectedCavityIdOrIds?: string | string[] | null,
  selectedFaceId?: string | null,
  faceTags?: Uint32Array,
  numericIdToInstanceId?: Record<number, string>
): ClassifiedMeshResult {
  const selectedCavityIdSet = normalizeSelectedCavityIds(selectedCavityIdOrIds)

  const [sx, sy, sz] = dimensions
  const numTri = rawIndices.length / 3

  // 预先计算各孔腔的世界中心轴线参数（孔口与打孔方向）
  const cavityRayData = cavities.map((cav) => {
    const basis = getBoxFaceBasis(cav.faceId, dimensions)
    const mouth = localToWorldPoint(basis, cav.u, cav.v, cav.depthOffset)
    const drillDir = [-basis.w[0], -basis.w[1], -basis.w[2]]
    return {
      instanceId: cav.instanceId,
      mouth,
      drillDir
    }
  })

  interface TriMeta {
    i0: number
    i1: number
    i2: number
    tag: TriangleTag
    group: 'base' | 'selectedFace' | 'cavity' | 'selectedCavity'
  }

  const triMetas: TriMeta[] = []
  const tol = 0.4 // 坐标贴面容差 (mm)
  const useFaceTags = faceTags != null && faceTags.length === numTri

  for (let t = 0; t < numTri; t++) {
    const i0 = rawIndices[t * 3]
    const i1 = rawIndices[t * 3 + 1]
    const i2 = rawIndices[t * 3 + 2]

    // 三角面元质心
    const cx = (rawPositions[i0 * 3] + rawPositions[i1 * 3] + rawPositions[i2 * 3]) / 3
    const cy = (rawPositions[i0 * 3 + 1] + rawPositions[i1 * 3 + 1] + rawPositions[i2 * 3 + 1]) / 3
    const cz = (rawPositions[i0 * 3 + 2] + rawPositions[i1 * 3 + 2] + rawPositions[i2 * 3 + 2]) / 3

    // 三角面元法向量
    let nx = (rawNormals[i0 * 3] + rawNormals[i1 * 3] + rawNormals[i2 * 3]) / 3
    let ny = (rawNormals[i0 * 3 + 1] + rawNormals[i1 * 3 + 1] + rawNormals[i2 * 3 + 1]) / 3
    let nz = (rawNormals[i0 * 3 + 2] + rawNormals[i1 * 3 + 2] + rawNormals[i2 * 3 + 2]) / 3
    const len = Math.hypot(nx, ny, nz)
    if (len > 1e-6) {
      nx /= len
      ny /= len
      nz /= len
    }

    if (useFaceTags) {
      const tagVal = faceTags[t]
      if (tagVal > 0) {
        // 来自某个孔腔的内表面面元 (CSG 原生标记，100% 精确，无锯齿无遗漏)
        let cavityId = numericIdToInstanceId?.[tagVal]
        if (!cavityId) {
          // 若映射表中未找到，按最短轴线距离查找孔腔
          let minDistSq = Infinity
          for (const cr of cavityRayData) {
            const vx = cx - cr.mouth[0]
            const vy = cy - cr.mouth[1]
            const vz = cz - cr.mouth[2]
            const proj = vx * cr.drillDir[0] + vy * cr.drillDir[1] + vz * cr.drillDir[2]
            const px = vx - proj * cr.drillDir[0]
            const py = vy - proj * cr.drillDir[1]
            const pz = vz - proj * cr.drillDir[2]
            const distSq = px * px + py * py + pz * pz
            if (distSq < minDistSq) {
              minDistSq = distSq
              cavityId = cr.instanceId
            }
          }
          cavityId = cavityId || cavities[0]?.instanceId || 'cavity'
        }

        const isSelectedCavity = selectedCavityIdSet.has(cavityId)
        triMetas.push({
          i0,
          i1,
          i2,
          tag: { type: 'cavity', id: cavityId },
          group: isSelectedCavity ? 'selectedCavity' : 'cavity'
        })
      } else {
        // tagVal === 0: 严格属于基体外表面
        let faceId: string | null = null
        if (Math.abs(cz - sz) < tol && nz > 0.4) {
          faceId = 'top'
        } else if (Math.abs(cz) < tol && nz < -0.4) {
          faceId = 'bottom'
        } else if (Math.abs(cy) < tol && ny < -0.4) {
          faceId = 'front'
        } else if (Math.abs(cy - sy) < tol && ny > 0.4) {
          faceId = 'back'
        } else if (Math.abs(cx) < tol && nx < -0.4) {
          faceId = 'left'
        } else if (Math.abs(cx - sx) < tol && nx > 0.4) {
          faceId = 'right'
        }

        const isSelectedFace = selectedFaceId != null && faceId != null && faceId === selectedFaceId
        triMetas.push({
          i0,
          i1,
          i2,
          tag: { type: 'face', id: faceId || 'base' },
          group: isSelectedFace ? 'selectedFace' : 'base'
        })
      }
    } else {
      // 回退几何启发式判断 (当缺少 faceTags 时)
      let faceId: string | null = null
      if (Math.abs(cz - sz) < tol && nz > 0.4) {
        faceId = 'top'
      } else if (Math.abs(cz) < tol && nz < -0.4) {
        faceId = 'bottom'
      } else if (Math.abs(cy) < tol && ny < -0.4) {
        faceId = 'front'
      } else if (Math.abs(cy - sy) < tol && ny > 0.4) {
        faceId = 'back'
      } else if (Math.abs(cx) < tol && nx < -0.4) {
        faceId = 'left'
      } else if (Math.abs(cx - sx) < tol && nx > 0.4) {
        faceId = 'right'
      }

      // 检查该三角面元是否落在某个孔腔孔口内（防止入口倒角/阶梯台阶被误判为外表面）
      let insideMouth = false
      if (faceId) {
        for (const cr of cavityRayData) {
          const vx = cx - cr.mouth[0]
          const vy = cy - cr.mouth[1]
          const vz = cz - cr.mouth[2]
          const proj = vx * cr.drillDir[0] + vy * cr.drillDir[1] + vz * cr.drillDir[2]
          if (proj >= -0.5 && proj <= 1.0) {
            const px = vx - proj * cr.drillDir[0]
            const py = vy - proj * cr.drillDir[1]
            const pz = vz - proj * cr.drillDir[2]
            const distSq = px * px + py * py + pz * pz
            if (distSq < 144) {
              insideMouth = true
              break
            }
          }
        }
      }

      if (faceId && !insideMouth) {
        const isSelectedFace = selectedFaceId != null && faceId === selectedFaceId
        triMetas.push({
          i0,
          i1,
          i2,
          tag: { type: 'face', id: faceId },
          group: isSelectedFace ? 'selectedFace' : 'base'
        })
      } else {
        // 归属为孔腔内表面
        let matchedCavityId: string | null = null
        let minDistSq = Infinity

        for (const cr of cavityRayData) {
          const vx = cx - cr.mouth[0]
          const vy = cy - cr.mouth[1]
          const vz = cz - cr.mouth[2]

          const proj = vx * cr.drillDir[0] + vy * cr.drillDir[1] + vz * cr.drillDir[2]
          if (proj >= -0.5) {
            const px = vx - proj * cr.drillDir[0]
            const py = vy - proj * cr.drillDir[1]
            const pz = vz - proj * cr.drillDir[2]
            const distSq = px * px + py * py + pz * pz

            if (distSq < minDistSq) {
              minDistSq = distSq
              matchedCavityId = cr.instanceId
            }
          }
        }

        const cavityId = matchedCavityId || (cavities[0] ? cavities[0].instanceId : 'base')
        const isSelectedCavity = selectedCavityIdSet.has(cavityId)

        triMetas.push({
          i0,
          i1,
          i2,
          tag: { type: 'cavity', id: cavityId },
          group: isSelectedCavity ? 'selectedCavity' : 'cavity'
        })
      }
    }
  }

  // 3. 严格分 4 组排序：Base -> SelectedFace -> Cavity -> SelectedCavity
  const baseTris = triMetas.filter((t) => t.group === 'base')
  const selectedFaceTris = triMetas.filter((t) => t.group === 'selectedFace')
  const unselectedCavityTris = triMetas.filter((t) => t.group === 'cavity')
  const selectedCavityTris = triMetas.filter((t) => t.group === 'selectedCavity')

  const sortedTris = [
    ...baseTris,
    ...selectedFaceTris,
    ...unselectedCavityTris,
    ...selectedCavityTris
  ]

  const newIndices = new Uint32Array(sortedTris.length * 3)
  const triangleTags: TriangleTag[] = new Array(sortedTris.length)

  for (let i = 0; i < sortedTris.length; i++) {
    const meta = sortedTris[i]
    newIndices[i * 3] = meta.i0
    newIndices[i * 3 + 1] = meta.i1
    newIndices[i * 3 + 2] = meta.i2
    triangleTags[i] = meta.tag
  }

  // 4. 构建 BufferGeometry 并设置 groups 材质映射
  const stabilized = stabilizeAxisAlignedPlanarNormals(rawPositions, rawNormals, newIndices, triangleTags)
  const solidGeom = new THREE.BufferGeometry()
  solidGeom.setAttribute('position', new THREE.BufferAttribute(stabilized.positions, 3))
  solidGeom.setAttribute('normal', new THREE.BufferAttribute(stabilized.normals, 3))
  solidGeom.setIndex(new THREE.BufferAttribute(stabilized.indices, 1))

  const baseCount = baseTris.length * 3
  const selectedFaceCount = selectedFaceTris.length * 3
  const cavityCount = unselectedCavityTris.length * 3
  const selectedCavityCount = selectedCavityTris.length * 3

  solidGeom.clearGroups()
  let currentOffset = 0

  if (baseCount > 0) {
    solidGeom.addGroup(currentOffset, baseCount, 0) // Material 0: 基体未选面
    currentOffset += baseCount
  }
  if (selectedFaceCount > 0) {
    solidGeom.addGroup(currentOffset, selectedFaceCount, 1) // Material 1: 选中面 (SolidWorks 亮天蓝半透)
    currentOffset += selectedFaceCount
  }
  if (cavityCount > 0) {
    solidGeom.addGroup(currentOffset, cavityCount, 2) // Material 2: 常规孔腔面 (严格不透明灰)
    currentOffset += cavityCount
  }
  if (selectedCavityCount > 0) {
    solidGeom.addGroup(currentOffset, selectedCavityCount, 3) // Material 3: 选中孔腔面 (严格不透明 SolidWorks 蓝)
    currentOffset += selectedCavityCount
  }

  const edgeGeom = new THREE.BufferGeometry()
  edgeGeom.setAttribute('position', new THREE.BufferAttribute(rawEdgePositions, 3))

  return {
    solidGeometry: solidGeom,
    edgeGeometry: edgeGeom,
    triangleTags
  }
}
