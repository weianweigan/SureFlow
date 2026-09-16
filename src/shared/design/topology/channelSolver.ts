/**
 * 液压通道几何相交拓扑求解引擎 (Hydraulic Flow Channel Topology Solver)
 *
 * 严格对齐 PRD-FR-04-12 规范：
 * 1. 空间线段段间最短距离高精度解析算法（$O(1)$ 复杂度）；
 * 2. 轴对齐包围盒（AABB）粗筛与多台阶截锥/圆柱近似相交检测（不代替 B-Rep 流通面积校核）；
 * 3. 并查集（Union-Find）连通分支求解，实时合并相通油口与钻孔；
 * 4. 孤立孔与结构孔（紧固螺栓/销孔）分类识别；
 * 5. 结合用户个性化配置（改名、调色、显隐）与液压标准色谱智能赋色。
 */

import {
  type CavityInstance,
  type FlowChannel,
  type ChannelTopologyState,
  type ChannelUserConfig
} from '../types'
import { profileBands, portRegions, cavityAxis, add, mul, dot, sub, norm, type ProfileBand, type Vec3 } from '../cavityGeometry'
import type { Step } from '../../cavity/types'

/** 空间线段解析表示 */
interface Segment3D {
  p0: Vec3
  p1: Vec3
  r0: number
  r1: number
}

/** 孔腔在世界坐标系下的拓扑几何表达 */
interface CavitySpatialGeometry {
  cavity: CavityInstance
  mouth: Vec3
  axisDir: Vec3
  totalDepth: number
  maxRadius: number
  aabbMin: Vec3
  aabbMax: Vec3
  segments: Segment3D[]
  isStructural: boolean
}

/** 默认工业液压通道调色板（纯工艺沟通回路轮换使用） */
export const HYDRAULIC_CHANNEL_PALETTE = [
  '#06b6d4', // 亮青
  '#8b5cf6', // 丁香紫
  '#ec4899', // 玫红
  '#10b981', // 薄荷绿
  '#f59e0b', // 琥珀黄
  '#6366f1', // 靛蓝
  '#14b8a6', // 蓝绿
  '#f43f5e'  // 珊瑚粉
]

/** 标准液压油口语义色谱映射 */
export const PORT_SEMANTIC_COLORS: Record<string, string> = {
  P: '#ef4444', // P 压力油路：工业亮红
  T: '#3b82f6', // T 回油油路：液压纯蓝
  A: '#eab308', // A 工作口：琥珀金黄
  B: '#22c55e', // B 工作口：翡翠绿
  X: '#f97316', // X 先导口：深橙色
  Y: '#a855f7', // Y 泄油口：紫罗兰
  L: '#06b6d4', // L 泄漏/回油口：青色
  M: '#64748b'  // M 测压口：中性灰
}

/** 根据油口标签解析推荐液压色彩 */
export function resolvePortSemanticColor(label?: string): string | null {
  if (!label) return null
  const cleaned = label.trim().toUpperCase()
  for (const [key, color] of Object.entries(PORT_SEMANTIC_COLORS)) {
    if (cleaned === key || cleaned.startsWith(key)) {
      return color
    }
  }
  return null
}

/**
 * 判断是否为非流道结构孔（紧固螺栓孔、定位销孔等）
 */
export function isStructuralCavity(cavity: CavityInstance): boolean {
  if (cavity.cavityType === 'bolt-hole' || cavity.cavityType === 'locating-pin-hole') {
    return true
  }
  const name = `${cavity.subHoleName || ''} ${cavity.name}`.toLowerCase()
  if (
    name.includes('bolt') ||
    name.includes('screw') ||
    name.includes('pin') ||
    name.includes('螺栓') ||
    name.includes('螺钉') ||
    name.includes('定位销') ||
    name.includes('螺孔')
  ) {
    return true
  }
  return false
}

/**
 * 求解三维空间中两条线段间的最近点与最短距离平方
 * Segment 1: P(s) = P0 + s * (P1 - P0), s in [0, 1]
 * Segment 2: Q(t) = Q0 + t * (Q1 - Q0), t in [0, 1]
 */
export function segmentSegmentDistSq(
  p0: Vec3,
  p1: Vec3,
  q0: Vec3,
  q1: Vec3
): { distSq: number; s: number; t: number } {
  const ux = p1[0] - p0[0]
  const uy = p1[1] - p0[1]
  const uz = p1[2] - p0[2]

  const vx = q1[0] - q0[0]
  const vy = q1[1] - q0[1]
  const vz = q1[2] - q0[2]

  const wx = p0[0] - q0[0]
  const wy = p0[1] - q0[1]
  const wz = p0[2] - q0[2]

  const a = ux * ux + uy * uy + uz * uz
  const b = ux * vx + uy * vy + uz * vz
  const c = vx * vx + vy * vy + vz * vz
  const d = ux * wx + uy * wy + uz * wz
  const e = vx * wx + vy * wy + vz * wz

  const D = a * c - b * b
  let sN = 0
  let sD = D
  let tN = 0
  let tD = D

  // 两线段平行或退化
  if (D < 1e-7) {
    sN = 0
    sD = 1
    tN = e
    tD = c
  } else {
    sN = b * e - c * d
    tN = a * e - b * d
    if (sN < 0) {
      sN = 0
      tN = e
      tD = c
    } else if (sN > sD) {
      sN = sD
      tN = e + b
      tD = c
    }
  }

  if (tN < 0) {
    tN = 0
    if (-d < 0) {
      sN = 0
    } else if (-d > a) {
      sN = sD
    } else {
      sN = -d
      sD = a
    }
  } else if (tN > tD) {
    tN = tD
    if (-d + b < 0) {
      sN = 0
    } else if (-d + b > a) {
      sN = sD
    } else {
      sN = -d + b
      sD = a
    }
  }

  const s = Math.abs(sN) < 1e-7 ? 0 : sN / sD
  const t = Math.abs(tN) < 1e-7 ? 0 : tN / tD

  const dPx = wx + s * ux - t * vx
  const dPy = wy + s * uy - t * vy
  const dPz = wz + s * uz - t * vz

  return {
    distSq: dPx * dPx + dPy * dPy + dPz * dPz,
    s,
    t
  }
}

/** 默认 M10 孔台阶回退定义 */
const DEFAULT_FALLBACK_STEPS: Step[] = [
  { type: 'straight', diameter: 12, length: 15 },
  { type: 'tapered', diameter: 8, length: 25, angle: 118 }
]

/**
 * 构建单个孔腔的三维空间拓扑几何信息
 */
function buildCavitySpatialGeometry(
  cavity: CavityInstance,
  dimensions: [number, number, number],
  resolveSteps?: (templateId: string) => Step[] | undefined
): CavitySpatialGeometry {
  const {mouth,direction:axisDir}=cavityAxis(cavity,dimensions)

  const rawSteps =
    cavity.steps && cavity.steps.length > 0
      ? cavity.steps
      : resolveSteps?.(cavity.templateId) || DEFAULT_FALLBACK_STEPS

  const bands: ProfileBand[] = profileBands(rawSteps)
  let maxRadius = 0
  const segments: Segment3D[] = []

  let currentZ = 0
  for (const b of bands) {
    const r0 = b.r0
    const r1 = b.r1
    maxRadius = Math.max(maxRadius, r0, r1)

    const p0: Vec3 = [
      mouth[0] + currentZ * axisDir[0],
      mouth[1] + currentZ * axisDir[1],
      mouth[2] + currentZ * axisDir[2]
    ]
    const nextZ = currentZ + b.length
    const p1: Vec3 = [
      mouth[0] + nextZ * axisDir[0],
      mouth[1] + nextZ * axisDir[1],
      mouth[2] + nextZ * axisDir[2]
    ]

    segments.push({ p0, p1, r0, r1 })
    currentZ = nextZ
  }

  const totalDepth = currentZ
  const bottomPoint: Vec3 = [
    mouth[0] + totalDepth * axisDir[0],
    mouth[1] + totalDepth * axisDir[1],
    mouth[2] + totalDepth * axisDir[2]
  ]

  // AABB 计算
  const aabbMin: Vec3 = [
    Math.min(mouth[0], bottomPoint[0]) - maxRadius,
    Math.min(mouth[1], bottomPoint[1]) - maxRadius,
    Math.min(mouth[2], bottomPoint[2]) - maxRadius
  ]
  const aabbMax: Vec3 = [
    Math.max(mouth[0], bottomPoint[0]) + maxRadius,
    Math.max(mouth[1], bottomPoint[1]) + maxRadius,
    Math.max(mouth[2], bottomPoint[2]) + maxRadius
  ]

  return {
    cavity,
    mouth,
    axisDir,
    totalDepth,
    maxRadius,
    aabbMin,
    aabbMax,
    segments,
    isStructural: isStructuralCavity(cavity)
  }
}

/**
 * 判定两个孔腔在三维空间中是否物理相交相通
 * 容差 tolerance: 默认 0.05mm 保证有效过流截面
 */
export function cavitiesIntersect(
  geomA: CavitySpatialGeometry,
  geomB: CavitySpatialGeometry,
  tolerance: number = 0.05
): boolean {
  // 1. Broadphase: AABB 快速相交测试
  if (
    geomA.aabbMax[0] < geomB.aabbMin[0] ||
    geomA.aabbMin[0] > geomB.aabbMax[0] ||
    geomA.aabbMax[1] < geomB.aabbMin[1] ||
    geomA.aabbMin[1] > geomB.aabbMax[1] ||
    geomA.aabbMax[2] < geomB.aabbMin[2] ||
    geomA.aabbMin[2] > geomB.aabbMax[2]
  ) {
    return false
  }

  // 2. Narrowphase: 台阶段两两干涉测试
  for (const segA of geomA.segments) {
    for (const segB of geomB.segments) {
      const separatedByCaps=(a:Segment3D,b:Segment3D)=>{
        const av=sub(a.p1,a.p0), length=norm(av)
        if(length<1e-9) return true
        const axis=mul(av,1/length), bv=sub(b.p1,b.p0), bl=norm(bv)
        const cosine=bl>1e-9?dot(axis,mul(bv,1/bl)):1
        const radialFactor=Math.sqrt(Math.max(0,1-cosine*cosine))
        const q0=dot(sub(b.p0,a.p0),axis),q1=dot(sub(b.p1,a.p0),axis)
        const low=Math.min(q0-b.r0*radialFactor,q1-b.r1*radialFactor)
        const high=Math.max(q0+b.r0*radialFactor,q1+b.r1*radialFactor)
        return high<=tolerance||low>=length-tolerance
      }
      if(separatedByCaps(segA,segB)||separatedByCaps(segB,segA)) continue
      const { distSq, s, t } = segmentSegmentDistSq(segA.p0, segA.p1, segB.p0, segB.p1)
      const rA = segA.r0 + s * (segA.r1 - segA.r0)
      const rB = segB.r0 + t * (segB.r1 - segB.r0)
      const threshold = rA + rB - tolerance

      if (threshold > 0 && distSq < threshold * threshold) {
        return true
      }
    }
  }

  return false
}

/** 并查集实现 */
class UnionFind {
  parent: Record<string, string> = {}
  rank: Record<string, number> = {}

  constructor(elements: string[]) {
    for (const el of elements) {
      this.parent[el] = el
      this.rank[el] = 0
    }
  }

  find(i: string): string {
    if (this.parent[i] === undefined) {
      this.parent[i] = i
      this.rank[i] = 0
      return i
    }
    if (this.parent[i] !== i) {
      this.parent[i] = this.find(this.parent[i])
    }
    return this.parent[i]
  }

  union(i: string, j: string) {
    const rootI = this.find(i)
    const rootJ = this.find(j)
    if (rootI === rootJ) return

    if (this.rank[rootI] < this.rank[rootJ]) {
      this.parent[rootI] = rootJ
    } else if (this.rank[rootI] > this.rank[rootJ]) {
      this.parent[rootJ] = rootI
    } else {
      this.parent[rootJ] = rootI
      this.rank[rootI] += 1
    }
  }
}

/**
 * 通道求解主入口函数
 * 将所有相连的油口与钻孔归入通道，输出拓扑快照
 */
export function solveChannelTopology(
  cavities: CavityInstance[],
  dimensions: [number, number, number],
  userConfigs?: Record<string, ChannelUserConfig>,
  resolveSteps?: (templateId: string) => Step[] | undefined
): ChannelTopologyState {
  const activeCavities = cavities.filter((c) => !c.suppressed)

  if (activeCavities.length === 0) {
    return {
      channels: [],
      unconnectedCavityIds: [],
      structuralCavityIds: cavities.filter(isStructuralCavity).map((c) => c.instanceId),
      computedAt: Date.now()
    }
  }

  // Valve ports are separate hydraulic nodes even though they share a machined cavity.
  const geometries = activeCavities.filter(c=>!isStructuralCavity(c)&&!c.dangling).map(c=>buildCavitySpatialGeometry(c,dimensions,resolveSteps))
  type Node = { key:string; geom:CavitySpatialGeometry; minDepth:number; maxDepth:number; portIndex?:number }
  const nodes:Node[]=[]
  for(const geom of geometries){
    const steps=geom.cavity.steps?.length?geom.cavity.steps:resolveSteps?.(geom.cavity.templateId)??DEFAULT_FALLBACK_STEPS
    const bands=profileBands(steps)
    const ports=portRegions(geom.cavity.ports??[],bands)
    const ranges=geom.cavity.ports?.length?ports.map(p=>({minDepth:p.min,maxDepth:p.max,portIndex:p.index})):[{minDepth:0,maxDepth:geom.totalDepth,portIndex:undefined}]
    for(const range of ranges){
      const segments:Segment3D[]=bands.flatMap(b=>{
        const min=Math.max(range.minDepth,b.z0),max=Math.min(range.maxDepth,b.z1)
        if(max-min<1e-9||b.length<=0) return []
        return [{p0:add(geom.mouth,mul(geom.axisDir,min)),p1:add(geom.mouth,mul(geom.axisDir,max)),r0:b.r0+(b.r1-b.r0)*(min-b.z0)/b.length,r1:b.r0+(b.r1-b.r0)*(max-b.z0)/b.length}]
      })
      nodes.push({key:range.portIndex===undefined?geom.cavity.instanceId:`${geom.cavity.instanceId}/port/${range.portIndex}`,geom:{...geom,segments},...range})
    }
  }
  const uf=new UnionFind(nodes.map(n=>n.key))
  for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++){
    if(nodes[i].geom.cavity.instanceId===nodes[j].geom.cavity.instanceId) continue
    if(cavitiesIntersect(nodes[i].geom,nodes[j].geom)) uf.union(nodes[i].key,nodes[j].key)
  }
  const componentMap=new Map<string,Node[]>()
  for(const node of nodes){const root=uf.find(node.key);const list=componentMap.get(root)??[];list.push(node);componentMap.set(root,list)}

  const channels: FlowChannel[] = []
  const unconnectedCavityIds: string[] = []
  const structuralCavityIds: string[] = cavities.filter(isStructuralCavity).map(c=>c.instanceId)
  const unconnectedPorts: {cavityId:string;portIndex:number}[]=[]

  let channelIdx = 0

  for (const component of componentMap.values()) {
    const memberIds=[...new Set(component.map(n=>n.geom.cavity.instanceId))]
    if (memberIds.length >= 2) {
      // 提取连通子图中所有孔腔实例
      const members = memberIds.map(id=>component.find(n=>n.geom.cavity.instanceId===id)!.geom.cavity)

      // 提取主油口语义（优先取 portSemantic，其次精确正则匹配油口 P/T/A/B/X/Y，避免 Pattern 等词首误判）
      let primarySemantic: string | undefined
      for (const m of members) {
        if (m.portSemantic?.label) {
          primarySemantic = m.portSemantic.label
          break
        }
      }
      if (!primarySemantic) {
        for (const m of members) {
          const upper = m.name.toUpperCase()
          const match = upper.match(/\b([PTABXY])\b|\b([PTABXY])\d+\b|油口\s*([PTABXY])|口\s*([PTABXY])/i)
          if (match) {
            primarySemantic = (match[1] || match[2] || match[3] || match[4]).toUpperCase()
            break
          }
        }
      }

      // 生成稳定持久化绑定 key
      const sortedIds = [...memberIds].sort()
      const nodeIds=component.map(n=>n.key).sort()
      const bindingKey=`net:${nodeIds.map(encodeURIComponent).join('|')}`
      const inherited=Object.entries(userConfigs??{}).filter(([key])=>key.startsWith('net:')).map(([key,value])=>{
        let old:string[]=[]
        try{old=key.slice(4).split('|').map(decodeURIComponent)}catch{/* invalid legacy key */}
        return {key,value,overlap:old.filter(id=>nodeIds.includes(id)).length}
      }).filter(x=>x.overlap>0).sort((a,b)=>b.overlap-a.overlap||a.key.localeCompare(b.key))[0]?.value
      const userConfig=userConfigs?.[bindingKey]??inherited??
        userConfigs?.[`channel:${sortedIds.join('_')}`]??userConfigs?.[`channel:${sortedIds.slice(0,3).join('_')}`]??
        (primarySemantic?userConfigs?.[`port:${primarySemantic.toUpperCase()}`]:undefined)

      // 确定通道名称
      let name = `通道 ${channelIdx + 1}`
      let isCustomName = false
      if (userConfig?.customName) {
        name = userConfig.customName
        isCustomName = true
      } else if (primarySemantic) {
        name = `主油路 ${primarySemantic.toUpperCase()}`
      }

      // 确定通道颜色
      let color = userConfig?.customColor
      if (!color) {
        if (primarySemantic) {
          color = resolvePortSemanticColor(primarySemantic) || HYDRAULIC_CHANNEL_PALETTE[channelIdx % HYDRAULIC_CHANNEL_PALETTE.length]
        } else {
          color = HYDRAULIC_CHANNEL_PALETTE[channelIdx % HYDRAULIC_CHANNEL_PALETTE.length]
        }
      }

      channels.push({
        id: `channel-${bindingKey}`,
        bindingKey,
        name,
        isCustomName,
        color,
        cavityIds: memberIds,
        regions: component.map(n=>({cavityId:n.geom.cavity.instanceId,portIndex:n.portIndex,minDepth:n.minDepth,maxDepth:n.maxDepth})),
        primarySemantic,
        hidden: Boolean(userConfig?.hidden)
      })

      channelIdx++
    } else {
      // 孤立孔
      const singleId = memberIds[0]
      if(!unconnectedCavityIds.includes(singleId)) unconnectedCavityIds.push(singleId)
      for(const node of component) if(node.portIndex!==undefined) unconnectedPorts.push({cavityId:singleId,portIndex:node.portIndex})
    }
  }

  // 被抑制但属于结构孔的也归纳到 structuralCavityIds
  for (const c of cavities) {
    if (c.suppressed && isStructuralCavity(c) && !structuralCavityIds.includes(c.instanceId)) {
      structuralCavityIds.push(c.instanceId)
    }
  }

  return {
    channels,
    unconnectedPorts,
    unconnectedCavityIds,
    structuralCavityIds,
    computedAt: Date.now()
  }
}
