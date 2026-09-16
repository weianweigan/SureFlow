import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { FC } from 'react'

/** 单个油口/孔道的参数定义 */
export interface PortHole {
  id: string
  /** 口代号：P(压力) T(回油) A/B(工作) 等 */
  label: string
  /** 端面标记颜色（遵循液压行业惯例） */
  color: string
  /** 孔半径 (mm) */
  radius: number
  /** 孔深 (mm) */
  depth: number
  /** 轴向 */
  axis: 'x' | 'y' | 'z'
  /** 孔口中心（阀块表面处，mm） */
  center: [number, number, number]
}

export interface ValveBlockProps {
  /** 阀块外形尺寸 [x, y, z] (mm) */
  size?: [number, number, number]
  /** 油口/孔道列表 */
  holes?: PortHole[]
}

/** 默认孔道布局：P/T/A/B 四个油口 + 两个阀安装孔（示意数据） */
const DEFAULT_HOLES: PortHole[] = [
  // 压力油口 P —— 前面
  { id: 'p', label: 'P', color: '#dc2626', radius: 7, depth: 45, axis: 'z', center: [-25, 0, 30] },
  // 回油口 T —— 后面
  { id: 't', label: 'T', color: '#2563eb', radius: 7, depth: 45, axis: 'z', center: [25, 0, -30] },
  // 工作口 A —— 左面
  { id: 'a', label: 'A', color: '#eab308', radius: 6, depth: 40, axis: 'x', center: [-50, 0, 10] },
  // 工作口 B —— 右面
  { id: 'b', label: 'B', color: '#16a34a', radius: 6, depth: 40, axis: 'x', center: [50, 0, 10] },
  // 阀安装孔 M10 —— 顶面（简化示意）
  { id: 'm1', label: 'M10', color: '#6b6b6b', radius: 5, depth: 28, axis: 'y', center: [0, 40, -12] },
  { id: 'm2', label: 'M10', color: '#6b6b6b', radius: 5, depth: 28, axis: 'y', center: [0, 40, 18] }
]

/** 圆柱体（默认沿 Y 轴）旋转到指定轴向的旋转量 */
function axisRotation(axis: PortHole['axis']): THREE.Euler {
  switch (axis) {
    case 'x':
      return new THREE.Euler(0, 0, Math.PI / 2)
    case 'z':
      return new THREE.Euler(Math.PI / 2, 0, 0)
    default:
      return new THREE.Euler(0, 0, 0)
  }
}

/** 端面标记环（Ring 默认在 XY 平面、法线 +Z）旋转到朝外 */
function ringRotation(axis: PortHole['axis'], sign: 1 | -1): THREE.Euler {
  switch (axis) {
    case 'y':
      return new THREE.Euler(-Math.PI / 2, 0, sign === -1 ? Math.PI : 0)
    case 'x':
      return new THREE.Euler(0, sign === 1 ? Math.PI / 2 : -Math.PI / 2, 0)
    default:
      return new THREE.Euler(0, sign === -1 ? Math.PI : 0, 0)
  }
}

/** 孔口法线朝向（正负轴） */
function axisSign(axis: PortHole['axis']): 1 | -1 {
  switch (axis) {
    case 'x':
      return 1
    case 'y':
      return 1
    default:
      return -1
  }
}

/**
 * 阀块本体模型：六面体基座 + 各油口孔道 + 端面标记。
 * 目前为参数化示意模型，后续 PRD 定稿后按真实几何（流道、沉孔、
 * 螺纹、剖切显示等）扩展。
 */
export const ValveBlock: FC<ValveBlockProps> = ({ size = [100, 80, 60], holes = DEFAULT_HOLES }) => {
  _useLocale()
  const [sx, sy, sz] = size

  // 孔道圆柱中心 = 孔口中心沿轴向向内偏移 depth/2
  const holeGeoms = useMemo(
    () =>
      holes.map((h) => {
        const offset = new THREE.Vector3(
          h.axis === 'x' ? -h.depth / 2 : 0,
          h.axis === 'y' ? -h.depth / 2 : 0,
          h.axis === 'z' ? h.depth / 2 : 0
        )
        const center = new THREE.Vector3(...h.center).add(offset)
        return { hole: h, center }
      }),
    [holes]
  )

  return (
    <group>
      {/* 阀块本体 */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[sx, sy, sz]} />
        <meshStandardMaterial
          color="#8c8c8a"
          metalness={0.55}
          roughness={0.38}
        />
      </mesh>

      {/* 孔道：半透明管道从表面伸入内部 */}
      {holeGeoms.map(({ hole, center }) => (
        <mesh key={hole.id} position={center} rotation={axisRotation(hole.axis)}>
          <cylinderGeometry args={[hole.radius, hole.radius, hole.depth, 32, 1, false]} />
          <meshStandardMaterial
            color={hole.color}
            transparent
            opacity={0.72}
            roughness={0.42}
            metalness={0.3}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* 端面标记环：标注油口位置与代号颜色 */}
      {holes.map((h) => {
        const sign = axisSign(h.axis)
        const ringPos = new THREE.Vector3(...h.center)
        return (
          <mesh key={`${h.id}-ring`} position={ringPos} rotation={ringRotation(h.axis, sign)}>
            <ringGeometry args={[h.radius - 1.5, h.radius + 2.5, 32]} />
            <meshStandardMaterial color={h.color} roughness={0.4} metalness={0.2} />
          </mesh>
        )
      })}
    </group>
  )
}
