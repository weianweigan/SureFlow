import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { useMemo, type FC } from 'react'
import * as THREE from 'three'
import type { CavityGroup, CavityInstance } from '@shared/design/types'
import { getBoxFaceBasis, getCavityWorldMatrix } from '@shared/design/faceMath'
import { buildOutlineGeometry } from '../../geometry/outlineBuilder'

interface GroupOutlineGizmoProps {
  groups?: CavityGroup[]
  cavities?: CavityInstance[]
  dimensions: [number, number, number]
  selectedCavityId?: string | null
  selectedGroupId?: string | null
  selectedCavityIds?: string[]
}

/**
 * 简单的 2D AABB 包围盒相交测试，用于探测两个组在同表面上的外壳干涉碰撞
 */
function doBoxesIntersect(
  b1: { minX: number; maxX: number; minY: number; maxY: number },
  b2: { minX: number; maxX: number; minY: number; maxY: number }
): boolean {
  return b1.minX < b2.maxX && b1.maxX > b2.minX && b1.minY < b2.maxY && b1.maxY > b2.minY
}

/** 单个组合安装轮廓渲染 */
function SingleGroupOutline({
  group,
  cavities = [],
  dimensions,
  isSelected,
  isColliding
}: {
  group: CavityGroup
  cavities?: CavityInstance[]
  dimensions: [number, number, number]
  isSelected: boolean
  isColliding: boolean
}) {
  _useLocale()
  // 获取该组内的所有成员孔腔
  const memberCavities = useMemo(() => {
    return cavities.filter((c) => c.groupId === group.id || group.cavityIds.includes(c.instanceId))
  }, [cavities, group.id, group.cavityIds])

  // 计算该组的有效中心位置 (U, V) 与宿主面
  const { effectiveFaceId, effectiveU, effectiveV } = useMemo(() => {
    const fId = group.faceId || memberCavities[0]?.faceId || 'top'
    const cu =
      group.u != null
        ? group.u
        : memberCavities.length > 0
        ? memberCavities.reduce((acc, c) => acc + c.u, 0) / memberCavities.length
        : 0
    const cv =
      group.v != null
        ? group.v
        : memberCavities.length > 0
        ? memberCavities.reduce((acc, c) => acc + c.v, 0) / memberCavities.length
        : 0
    return { effectiveFaceId: fId, effectiveU: cu, effectiveV: cv }
  }, [group.faceId, group.u, group.v, memberCavities])

  const { basis, worldMatrix4 } = useMemo(() => {
    if (!effectiveFaceId) return { basis: null, worldMatrix4: new THREE.Matrix4() }
    const b = getBoxFaceBasis(effectiveFaceId, dimensions)
    const rawMatrix = getCavityWorldMatrix(b, effectiveU, effectiveV, 0, group.rotation || 0)
    const m = new THREE.Matrix4()
    m.fromArray(rawMatrix)
    return { basis: b, worldMatrix4: m }
  }, [effectiveFaceId, effectiveU, effectiveV, group.rotation, dimensions])

  // 轮廓几何体生成
  const outlineGeoms = useMemo(() => {
    if (group.outline) {
      const built = buildOutlineGeometry(group.outline)
      if (built) return built
    }

    // 普通成组无预设 outline 时，严格根据组内所有孔腔在表面上的几何极值生成自适应最小外接包围矩形框
    if (memberCavities.length > 0) {
      let minRelU = Infinity
      let maxRelU = -Infinity
      let minRelV = Infinity
      let maxRelV = -Infinity

      for (const c of memberCavities) {
        const relU = c.u - effectiveU
        const relV = c.v - effectiveV
        const r = 5.0 // 估算孔口半径
        minRelU = Math.min(minRelU, relU - r)
        maxRelU = Math.max(maxRelU, relU + r)
        minRelV = Math.min(minRelV, relV - r)
        maxRelV = Math.max(maxRelV, relV + r)
      }

      // 边框向外留出 6.0mm 工程安装余量
      const pad = 6.0
      minRelU -= pad
      maxRelU += pad
      minRelV -= pad
      maxRelV += pad

      const pts = [
        new THREE.Vector3(minRelU, minRelV, 0.05),
        new THREE.Vector3(maxRelU, minRelV, 0.05),
        new THREE.Vector3(maxRelU, minRelV, 0.05),
        new THREE.Vector3(maxRelU, maxRelV, 0.05),
        new THREE.Vector3(maxRelU, maxRelV, 0.05),
        new THREE.Vector3(minRelU, maxRelV, 0.05),
        new THREE.Vector3(minRelU, maxRelV, 0.05),
        new THREE.Vector3(minRelU, minRelV, 0.05)
      ]

      const shape = new THREE.Shape()
      shape.moveTo(minRelU, minRelV)
      shape.lineTo(maxRelU, minRelV)
      shape.lineTo(maxRelU, maxRelV)
      shape.lineTo(minRelU, maxRelV)
      shape.closePath()

      return {
        lineGeometry: new THREE.BufferGeometry().setFromPoints(pts),
        fillGeometry: new THREE.ShapeGeometry(shape)
      }
    }

    // 保底：若组内无孔腔，生成 30x30 紧凑框
    const half = 15
    const pts = [
      new THREE.Vector3(-half, -half, 0.05),
      new THREE.Vector3(half, -half, 0.05),
      new THREE.Vector3(half, -half, 0.05),
      new THREE.Vector3(half, half, 0.05),
      new THREE.Vector3(half, half, 0.05),
      new THREE.Vector3(-half, half, 0.05),
      new THREE.Vector3(-half, half, 0.05),
      new THREE.Vector3(-half, -half, 0.05)
    ]
    return {
      lineGeometry: new THREE.BufferGeometry().setFromPoints(pts),
      fillGeometry: null
    }
  }, [group.outline, memberCavities, effectiveU, effectiveV])

  if (!basis || !outlineGeoms) return null

  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3()
  worldMatrix4.decompose(pos, quat, scl)

  // 颜色逻辑：干涉碰撞变红 > 选中专业蓝 > 常态中性灰
  const lineColor = isColliding ? '#ef4444' : isSelected ? '#00a2ff' : '#64748b'
  const lineWidth = isColliding ? 2.5 : isSelected ? 2 : 1

  return (
    <group position={pos} quaternion={quat} scale={scl} renderOrder={150}>
      {/* 轮廓边框线（严格作为只读参考，不抢夺鼠标事件） */}
      <lineSegments raycast={() => null} geometry={outlineGeoms.lineGeometry} renderOrder={152}>
        <lineBasicMaterial
          color={lineColor}
          linewidth={lineWidth}
          transparent
          opacity={isColliding ? 0.95 : isSelected ? 0.9 : 0.45}
          depthTest={false}
        />
      </lineSegments>

      {/* 选中或碰撞时轻微高亮填充 */}
      {(isSelected || isColliding) && outlineGeoms.fillGeometry && (
        <mesh raycast={() => null} geometry={outlineGeoms.fillGeometry} renderOrder={151}>
          <meshBasicMaterial
            color={isColliding ? '#ef4444' : '#00a2ff'}
            transparent
            opacity={isColliding ? 0.12 : 0.08}
            depthTest={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  )
}

/**
 * G-09 · 组合孔/多孔安装面 Outline 轮廓渲染组件
 * 严格对齐 PRD-FR-04-10 规范：
 * - 库组合孔投影真实几何 Outline，普通多孔成组生成包围矩形框；
 * - 当两个阀组在同表面上发生外形相交重叠时，轮廓线即刻变红告警；
 * - 严格作为只读视觉参考框，不抢夺鼠标点击与拖拽事件。
 */
export const GroupOutlineGizmo: FC<GroupOutlineGizmoProps> = ({
  groups,
  cavities = [],
  dimensions,
  selectedCavityId,
  selectedGroupId,
  selectedCavityIds = []
}) => {
  _useLocale()
  // 探测同一表面上的组之间是否发生 Outline 干涉碰撞
  const collidingGroupIds = useMemo(() => {
    if (!groups || groups.length < 2) return new Set<string>()

    const set = new Set<string>()
    const boxes = groups.map((g) => {
      const u = g.u ?? 0
      const v = g.v ?? 0
      const r = 25
      return {
        id: g.id,
        faceId: g.faceId,
        minX: u - r,
        maxX: u + r,
        minY: v - r,
        maxY: v + r
      }
    })

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const b1 = boxes[i]
        const b2 = boxes[j]
        if (b1.faceId === b2.faceId && doBoxesIntersect(b1, b2)) {
          set.add(b1.id)
          set.add(b2.id)
        }
      }
    }

    return set
  }, [groups])

  if (!groups || groups.length === 0) return null

  return (
    <group>
      {groups.map((grp) => {
        const isSelected = Boolean(
          cavities.some(c => selectedCavityIds.includes(c.instanceId) && (c.groupId === grp.id || grp.cavityIds.includes(c.instanceId))) ||
          (selectedGroupId && grp.id === selectedGroupId) ||
            (selectedCavityId &&
              (grp.id === selectedCavityId ||
                grp.cavityIds.includes(selectedCavityId) ||
                cavities.some((c) => c.instanceId === selectedCavityId && c.groupId === grp.id)))
        )
        const isColliding = collidingGroupIds.has(grp.id)
        return (
          <SingleGroupOutline
            key={grp.id}
            group={grp}
            cavities={cavities}
            dimensions={dimensions}
            isSelected={isSelected}
            isColliding={isColliding}
          />
        )
      })}
    </group>
  )
}
