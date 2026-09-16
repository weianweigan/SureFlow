/**
 * 孔腔剖面实体生成器
 * 对齐 PRD-002 §8 与 PRD-FR-04-02 规范：
 * 将孔腔台阶定义 (Step[]) 转化为：
 * 1. Manifold 3D 水密实体（用于 CSG 布尔差集）
 * 2. Three.js BufferGeometry（用于视口幽灵预览与 X-Ray 彩色流道管线）
 */

import * as THREE from 'three'
import { resolveAllTemplateHoles } from './templateHoleResolver'
import { profileBands } from '@shared/design/cavityGeometry'
import type { Step } from '@shared/cavity/types'

export interface CavityStepBand {
  index: number
  z0: number
  z1: number
  r0: number
  r1: number
  length: number
}

/**
 * 将台阶数组解析为连续的圆台/圆柱分段
 */
export function parseCavityBands(steps: Step[]): CavityStepBand[] {
  if (!steps || steps.length === 0) {
    // 默认回退：标准 M10 沉孔台阶
    return [
      { index: 0, z0: 0, z1: 8, r0: 9, r1: 9, length: 8 },
      { index: 1, z0: 8, z1: 25, r0: 5, r1: 5, length: 17 },
      { index: 2, z0: 25, z1: 28, r0: 5, r1: 0, length: 3 }
    ]
  }

  return profileBands(steps)
}

/**
 * 在 Manifold 模块中构建该孔腔的 3D 水密旋转实体
 * @param manifoldModule 已初始化的 manifold 实例
 * @param steps 台阶列表
 * @param segments 圆周细分段数 (默认 32)
 */
export function buildCavityManifold(
  manifoldModule: any,
  steps: Step[],
  segments: number = 32
): any {
  const { Manifold } = manifoldModule
  const bands = parseCavityBands(steps)

  const parts: any[] = []
  for (const b of bands) {
    if (b.length <= 1e-4) continue
    // cylinder(height, radiusLow, radiusHigh, circularSegments, center)
    // radiusLow 位于 Z=0, radiusHigh 位于 Z=height
    const cyl = Manifold.cylinder(b.length, b.r0, b.r1, segments, false)
    // 平移到其在孔深轴中的起止位置
    const translated = cyl.translate([0, 0, b.z0])
    parts.push(translated)
  }

  if (parts.length === 0) {
    return Manifold.cylinder(10, 5, 5, segments, false)
  }

  if (parts.length === 1) {
    return parts[0]
  }

  return Manifold.union(parts)
}

/**
 * 获取孔腔台阶几何特征的签名（用于原型缓存池 Hash 键）
 */
export function getCavityStepSignature(steps: Step[], segments: number = 32): string {
  const bands = parseCavityBands(steps)
  return `${segments}:` + bands.map((b) => `${b.z0.toFixed(2)}_${b.z1.toFixed(2)}_${b.r0.toFixed(2)}_${b.r1.toFixed(2)}`).join(';')
}

/**
 * 构建孔腔在 Three.js 中的 3D 旋转网格几何体 (BufferGeometry)
 * 孔口位于 Z=0，沉入方向沿 +Z
 */
export function buildCavityThreeGeometry(
  steps: Step[],
  segments: number = 32
): THREE.BufferGeometry {
  const bands = parseCavityBands(steps)
  const points: THREE.Vector2[] = []

  // 沿旋转轮廓构建 (r, z) 点序列
  // 起始在孔口表面 (r0, 0)
  if (bands.length > 0) {
    points.push(new THREE.Vector2(0, 0))
    for (const b of bands) {
      points.push(new THREE.Vector2(b.r0, b.z0))
      points.push(new THREE.Vector2(b.r1, b.z1))
    }
    const last = bands[bands.length - 1]
    points.push(new THREE.Vector2(0, last.z1))
  }

  // 使用 LatheGeometry 绕 Y 轴旋转，然后旋转到沿 Z 轴
  const lathe = new THREE.LatheGeometry(points, segments)
  // Lathe 默认绕 Y 轴旋转（X 为半径，Y 为高度），将其对齐为沿 Z 轴
  lathe.rotateX(Math.PI / 2)
  lathe.computeVertexNormals()

  return lathe
}

/**
 * 获取孔腔实例对应的几何台阶定义（优先使用实例自身保存的台阶或子孔台阶，然后从库模板查找，最后回退标准沉孔台阶）
 */
export function getCavitySteps(
  cavity: { templateId?: string; steps?: Step[]; subHoleName?: string },
  libraryDoc?: any
): Step[] {
  // 1. 优先使用实例自带的显式台阶定义（用于多孔类型展开的子孔）
  if (cavity.steps && cavity.steps.length > 0) {
    return cavity.steps
  }

  // 2. 从库模板查找
  if (libraryDoc?.templates && cavity.templateId) {
    const tmpl = libraryDoc.templates.find((t: any) => t.id === cavity.templateId)
    if (tmpl) {
      if (tmpl.geometry?.steps && tmpl.geometry.steps.length > 0) {
        return tmpl.geometry.steps
      }
      // 如果模板是组合孔，且指定了 subHoleName
      if (cavity.subHoleName && tmpl.holes) {
        const h = tmpl.holes.find((item: any) => item.name === cavity.subHoleName)
        if (h?.geometry?.steps && h.geometry.steps.length > 0) {
          return h.geometry.steps
        }
        const resolved = resolveAllTemplateHoles(tmpl, libraryDoc).find(item => item.name === cavity.subHoleName)
        if (resolved) return resolved.steps
      }
    }
  }

  // 3. 默认回退沉孔台阶 (Ø18×8mm 沉头 + Ø10×20mm 导向 + 118° 钻尖)
  return [
    { type: 'straight', diameter: 18, length: 8 },
    { type: 'straight', diameter: 10, length: 20 },
    { type: 'tapered', diameter: 10, length: null, angle: 118 }
  ]
}

