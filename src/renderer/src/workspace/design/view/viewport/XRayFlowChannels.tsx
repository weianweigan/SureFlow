import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useMemo, useState, type FC } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { getBoxFaceBasis, getCavityWorldMatrix } from '@shared/design/faceMath'
import { buildCavityThreeGeometry } from '../../geometry/cavityProfileBuilder'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import type { CavityInstance } from '@shared/design/types'

interface XRayFlowChannelsProps {
  cavities: CavityInstance[]
  dimensions: [number, number, number]
  selectedCavityIds: string[]
  clippingPlanes?: THREE.Plane[]
  onSelectCavity: (cavityId: string, isMulti: boolean) => void
}

/**
 * 根据液压语义及孔类型解析标准流道色彩 (PRD-FR-04-06 §2.1.3)
 */
function resolveHydraulicColor(cavity: CavityInstance): string {
  if (cavity.portSemantic?.color) {
    return cavity.portSemantic.color
  }
  const label = (cavity.portSemantic?.label || '').toUpperCase()
  if (label.startsWith('P')) return '#dc2626' // P 压力油路：中国红
  if (label.startsWith('T')) return '#2563eb' // T 回油油路：工程纯蓝
  if (label.startsWith('A')) return '#ca8a04' // A 工作口：琥珀金黄
  if (label.startsWith('B')) return '#16a34a' // B 工作口：翡翠绿
  if (label.startsWith('X') || label.startsWith('Y')) return '#ea580c' // X/Y 先导与泄油口：深橙色

  // 孔型推断
  const cType = cavity.cavityType
  if (cType === 'bolt-hole' || cType === 'locating-pin-hole') {
    return '#475569' // 紧固螺孔 / 定位销孔：中性深灰
  }
  if (cType === 'cartridge-valve') {
    return '#0284c7' // 插装阀腔：工业蓝
  }

  return '#64748b' // 默认中性钢灰
}

/**
 * X-Ray 内部孔道流道彩色管道实体 (PRD-FR-04-06 §2)
 * 1. 所有未被抑制的孔腔转化为不透明实心彩色管道实体；
 * 2. 叠加锐利 CAD 特征棱边线条（圆柱母线、孔底锥尖棱）；
 * 3. 穿透射线拾取 (§2.2 Penetrating Raycasting)：射线直接穿透基体外皮精准捕获内部流道；
 * 4. 完美支持与剖切截面 (clippingPlanes) 联动切削排查内部相交与死油区。
 */
export const XRayFlowChannels: FC<XRayFlowChannelsProps> = ({
  cavities,
  dimensions,
  selectedCavityIds,
  clippingPlanes,
  onSelectCavity
}) => {
  _useLocale()
  const libraryDoc = useLibraryStore((s) => s.doc)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // 1. 构建所有未抑制孔腔的三维几何体与变换矩阵
  const channelData = useMemo(() => {
    return cavities
      .filter((c) => !c.suppressed)
      .map((cavity) => {
        // 查找孔腔模板定义的步骤
        const tmpl = libraryDoc?.templates.find((t) => t.id === cavity.templateId)
        const steps = tmpl?.geometry.steps || [
          { type: 'stepped', diameter: 12, length: 15 },
          { type: 'tapered', diameter: 8, length: 25, angle: 118 }
        ]

        const geom = buildCavityThreeGeometry(steps as any)
        const edgesGeom = new THREE.EdgesGeometry(geom, 25)

        const basis = getBoxFaceBasis(cavity.faceId, dimensions)
        const rawMatrix = getCavityWorldMatrix(
          basis,
          cavity.u,
          cavity.v,
          cavity.depthOffset || 0,
          cavity.rotation || 0,
          cavity.tiltAngle || 0,
          cavity.azimuth ?? cavity.rotation ?? 0
        )

        const m4 = new THREE.Matrix4().fromArray(rawMatrix)
        const pos = new THREE.Vector3()
        const quat = new THREE.Quaternion()
        const scl = new THREE.Vector3()
        m4.decompose(pos, quat, scl)

        const color = resolveHydraulicColor(cavity)

        return {
          cavity,
          geom,
          edgesGeom,
          pos,
          quat,
          scl,
          color
        }
      })
  }, [cavities, dimensions, libraryDoc])

  return (
    <group renderOrder={280}>
      {channelData.map(({ cavity, geom, edgesGeom, pos, quat, scl, color }) => {
        const isSelected = selectedCavityIds.includes(cavity.instanceId)
        const isHovered = hoveredId === cavity.instanceId

        const displayColor = isSelected ? '#00EBFF' : isHovered ? '#67e8f9' : color

        return (
          <group
            key={cavity.instanceId}
            position={pos}
            quaternion={quat}
            scale={scl}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              // 穿透射线拾取核心机制：阻止冒泡穿透外壳
              e.stopPropagation()
              onSelectCavity(cavity.instanceId, Boolean(e.shiftKey || e.ctrlKey || e.metaKey))
            }}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation()
              setHoveredId(cavity.instanceId)
              document.body.style.cursor = 'pointer'
            }}
            onPointerOut={() => {
              setHoveredId(null)
              document.body.style.cursor = 'auto'
            }}
          >
            {/* 实体实心流道管道 */}
            <mesh geometry={geom}>
              <meshStandardMaterial
                color={displayColor}
                roughness={0.25}
                metalness={0.4}
                transparent={false}
                opacity={1.0}
                depthWrite={true}
                depthTest={true}
                clippingPlanes={clippingPlanes || []}
                clipShadows={true}
                emissive={isSelected ? '#004d54' : isHovered ? '#0ea5e9' : '#000000'}
                emissiveIntensity={isSelected ? 0.35 : isHovered ? 0.2 : 0}
              />
            </mesh>

            {/* 锐利 CAD 特征棱边线条 */}
            <lineSegments geometry={edgesGeom}>
              <lineBasicMaterial
                color={isSelected ? '#0369a1' : '#0f172a'}
                linewidth={1.2}
                depthTest={true}
                clippingPlanes={clippingPlanes || []}
              />
            </lineSegments>

            {/* 悬停与选中时的微型水力语义指示牌 */}
            {(isHovered || isSelected) && (
              <Html position={[0, 0, 1]} center pointerEvents="none">
                <div className="rounded border border-slate-700/80 bg-slate-900/90 px-1.5 py-0.5 text-[10px] font-mono text-white shadow-lg whitespace-nowrap select-none backdrop-blur-xs flex items-center gap-1">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span>{cavity.subHoleName || cavity.name}</span>
                  {cavity.portSemantic?.label && (
                    <span className="font-bold text-cyan-300">[{_t(cavity.portSemantic.label)}]</span>
                  )}
                </div>
              </Html>
            )}
          </group>
        )
      })}
    </group>
  )
}
