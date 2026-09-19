import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { useDesignStore } from '../../model/designStore'
import { useSnapStore } from '../../model/snapStore'
import { useChannelTopology } from '../../interaction/channels/useChannelTopology'
import { channelSurfaceRegions, cosmeticThreadRegions, makeCavitySurfaceMaterial, regroupCavityMaterials } from '../../geometry/channelSurfaceMaterials'
import type { TriangleTag } from '../../geometry/meshClassifier'
import { useMemo, useState, useEffect, type FC } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { hasGizmoIntersection, raycastSelection } from './selectionRaycast'
import type { MaterialConfig } from '@shared/design/types'

export interface MeshRayHit {
  cavityId?: string
  faceIndex?: number
  normal?: THREE.Vector3
  point: THREE.Vector3
  distance: number
}

interface CsgValveBlockMeshProps {
  projectId: string
  triangleTags: TriangleTag[] | null
  selectedCavityIds?: string[]
  solidGeometry: THREE.BufferGeometry | null
  edgeGeometry: THREE.BufferGeometry | null
  isSelected: boolean
  selectedCavityId?: string | null
  selectedFaceId?: string | null
  materialConfig: MaterialConfig
  clippingPlanes?: THREE.Plane[]
  isDarkBackground?: boolean
  dimensions?: [number, number, number]
  onClick: (hits: MeshRayHit[], rawEvent?: ThreeEvent<MouseEvent>) => void
  onDoubleClick?: (hits: MeshRayHit[]) => void
}

/**
 * SolidWorks 风格边线着色实体（Shaded with Edges）
 * 严格对齐 PRD-FR-04-06 规范：
 * 1. 剖切功能 (Sectioning)：WebGL Stencil 多通道渲染 100% 实体封口截面 (#475569)；
 * 2. 剖切状态下射线拾取精确捕获内部相交面元。
 */
export const CsgValveBlockMesh: FC<CsgValveBlockMeshProps> = ({
  projectId, triangleTags, selectedCavityIds = [],
  solidGeometry,
  edgeGeometry,
  isSelected,
  selectedCavityId: _selectedCavityId,
  selectedFaceId: _selectedFaceId,
  materialConfig,
  clippingPlanes,
  isDarkBackground = false,
  dimensions = [100, 100, 100],
  onClick,
  onDoubleClick
}) => {
  _useLocale()
  const [hovered, setHovered] = useState(false)

  const activePlanes = useMemo(() => clippingPlanes || [], [clippingPlanes])

  const displayColor = useMemo(() => {
    if (isSelected) return '#93c5fd'
    if (hovered) return '#bfdbfe'
    return materialConfig.color
  }, [isSelected, hovered, materialConfig.color])

  const effectiveOpacity = materialConfig.opacity
  const effectiveRoughness = materialConfig.roughness
  const isTransparent = effectiveOpacity < 1

  // Material 0: 基体未选主表面（单例池化）
  const baseMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: displayColor,
      roughness: effectiveRoughness,
      metalness: materialConfig.metalness,
      transparent: isTransparent,
      opacity: effectiveOpacity,
      polygonOffset: true,
      polygonOffsetFactor: 0.5,
      polygonOffsetUnits: 0.5,
      depthWrite: !isTransparent,
      side: isTransparent ? THREE.DoubleSide : THREE.FrontSide,
      clippingPlanes: activePlanes,
      clipShadows: true
    })
  }, [])

  // 原地更新基体材质属性
  useEffect(() => {
    baseMaterial.color.set(displayColor)
  }, [baseMaterial, displayColor])

  useEffect(() => {
    baseMaterial.roughness = effectiveRoughness
    baseMaterial.metalness = materialConfig.metalness
    baseMaterial.opacity = effectiveOpacity
    baseMaterial.clippingPlanes = activePlanes
    const targetSide = isTransparent ? THREE.DoubleSide : THREE.FrontSide
    const sideChanged = baseMaterial.side !== targetSide
    const transChanged = baseMaterial.transparent !== isTransparent
    baseMaterial.transparent = isTransparent
    baseMaterial.depthWrite = !isTransparent
    baseMaterial.side = targetSide
    if (sideChanged || transChanged) {
      baseMaterial.needsUpdate = true
    }
  }, [baseMaterial, effectiveRoughness, materialConfig.metalness, effectiveOpacity, isTransparent, activePlanes])

  // Material 1: SolidWorks 风格选中面（亮天蓝半透高亮）
  const selectedFaceMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#0284c7',
      roughness: 0.2,
      metalness: 0.3,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 0.3,
      polygonOffsetUnits: 0.3,
      clippingPlanes: activePlanes,
      clipShadows: true
    })
  }, [])

  // Material 2: 普通孔腔内壁（明亮机械加工铝质感，彻底消除金属灰过深导致的深孔与台阶死黑）
  const cavityMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.38,
      metalness: 0.20,
      emissive: '#1e293b',
      emissiveIntensity: 0.08,
      transparent: false,
      opacity: 1.0,
      depthWrite: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 0.5,
      polygonOffsetUnits: 0.5,
      clippingPlanes: activePlanes,
      clipShadows: true
    })
  }, [])

  // Material 3: 选中孔腔内表面（严格不透明 #00EBFF 工业青蓝高亮，带微发光金属质感）
  const selectedCavityMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#00EBFF',
      emissive: '#004d54',
      emissiveIntensity: 0.35,
      roughness: 0.15,
      metalness: 0.4,
      transparent: false,
      opacity: 1.0,
      depthWrite: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 0.5,
      polygonOffsetUnits: 0.5,
      clippingPlanes: activePlanes,
      clipShadows: true
    })
  }, [])

  // 动态更新孔腔/选中面材质的剖切截面
  useEffect(() => {
    selectedFaceMaterial.clippingPlanes = activePlanes
    cavityMaterial.clippingPlanes = activePlanes
    selectedCavityMaterial.clippingPlanes = activePlanes
  }, [activePlanes, selectedFaceMaterial, cavityMaterial, selectedCavityMaterial])

  // 组件卸载时释放显存材质
  useEffect(() => {
    return () => {
      baseMaterial.dispose()
      selectedFaceMaterial.dispose()
      cavityMaterial.dispose()
      selectedCavityMaterial.dispose()
    }
  }, [baseMaterial, selectedFaceMaterial, cavityMaterial, selectedCavityMaterial])

  const materials = useMemo(() => {
    const list = [baseMaterial, selectedFaceMaterial, cavityMaterial, selectedCavityMaterial]
    return new Proxy(list, {
      get(target, prop) {
        if (typeof prop === 'string') {
          const idx = Number(prop)
          if (!isNaN(idx) && idx >= 0) {
            return target[idx] ?? target[0]
          }
        }
        return (target as any)[prop]
      }
    })
  }, [baseMaterial, selectedFaceMaterial, cavityMaterial, selectedCavityMaterial])

  // 剖切封口平面几何与姿态数据 (WebGL Stencil Cap Plane)
  const capPlanesData = useMemo(() => {
    if (!activePlanes || activePlanes.length === 0) return []
    const maxDim = Math.max(...dimensions) * 3

    return activePlanes.map((plane) => {
      // 计算封口平面的空间中心点与旋转四元数
      const normal = plane.normal.clone().normalize()
      const planePos = normal.clone().multiplyScalar(-plane.constant)
      const planeQuat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        normal
      )
      return {
        plane,
        planePos,
        planeQuat,
        size: maxDim
      }
    })
  }, [activePlanes, dimensions])

  const { scene } = useThree()
  const extractHits = (e: ThreeEvent<MouseEvent>): MeshRayHit[] =>
    raycastSelection(e.ray, scene, activePlanes).map(hit => ({
      cavityId: hit.object.userData.cavityId,
      faceIndex: hit.object.userData.cavityId ? undefined : hit.faceIndex ?? undefined,
      normal: hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : undefined,
      point: hit.point,
      distance: hit.distance
    }))

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 3) return
    // Gizmos can be visually behind a transparent/full-depth cavity hit. Let their
    // event handler run first whenever their hit geometry is anywhere on this ray.
    if (hasGizmoIntersection(e.intersections)) return
    e.stopPropagation()
    onClick(extractHits(e), e)
  }

  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    if (hasGizmoIntersection(e.intersections)) return
    e.stopPropagation()
    onDoubleClick?.(extractHits(e))
  }

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = () => {
    setHovered(false)
    document.body.style.cursor = 'auto'
  }

  const showPorts = useSnapStore(s=>s.settings.showPorts)
  const isolatedChannelId = useDesignStore(s=>s.projects[projectId]?.isolatedChannelId)
  const {topology,cavities}=useChannelTopology(projectId)
  const surfaces=useMemo(()=>{
    if(!solidGeometry||!triangleTags) return null
    const extra:THREE.MeshStandardMaterial[]=[]
    const mapping=new Map<string,number>()
    for(const cavity of cavities){
      const regions=channelSurfaceRegions(cavity,topology.channels.map(ch=>({...ch,hidden:ch.hidden||Boolean(isolatedChannelId&&ch.id!==isolatedChannelId)})),showPorts)
      if(!regions.length && !cosmeticThreadRegions(cavity.steps ?? []).length) continue
      mapping.set(cavity.instanceId,4+extra.length)
      extra.push(makeCavitySurfaceMaterial(cavity,dimensions,regions,selectedCavityIds.includes(cavity.instanceId),activePlanes))
    }
    return {geometry:regroupCavityMaterials(solidGeometry,triangleTags,mapping),extra}
  },[solidGeometry,triangleTags,cavities,topology,showPorts,isolatedChannelId,dimensions[0],dimensions[1],dimensions[2],selectedCavityIds,activePlanes])
  useEffect(()=>()=>{surfaces?.geometry.dispose();surfaces?.extra.forEach(m=>m.dispose())},[surfaces])
  if (!solidGeometry) return null

  const hasGroups = solidGeometry.groups && solidGeometry.groups.length > 0
  const activeMaterial = hasGroups ? [...materials,...(surfaces?.extra??[])] : baseMaterial

  return (
    <group>
      {/* 1. 实体切削网格（开启 clippingPlanes 正常写入深度与颜色） */}
      <mesh
        userData={{ selectionMesh: true }}
        geometry={surfaces?.geometry??solidGeometry}
        material={activeMaterial}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      />

      {/* 2. CAD 特征轮廓边线（剖切状态同步裁剪） */}
      {edgeGeometry && (
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial
            color={isSelected ? '#0284c7' : isDarkBackground ? '#94a3b8' : '#1e293b'}
            linewidth={1.5}
            polygonOffset={true}
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
            depthTest={true}
            clippingPlanes={activePlanes}
          />
        </lineSegments>
      )}

      {/* 3. 实体封口截面渲染（WebGL Stencil Buffer 多通道封口算法，PRD 1.2） */}
      {capPlanesData.map(({ plane, planePos, planeQuat, size }, idx) => (
        <group key={`cap-${idx}`}>
          {/* 通道 1 (Back Faces)：写入背面自增模板 */}
          <mesh geometry={solidGeometry} renderOrder={6 + idx * 3} raycast={() => null}>
            <meshBasicMaterial
              depthWrite={false}
              depthTest={true}
              colorWrite={false}
              side={THREE.BackSide}
              clippingPlanes={[plane]}
              stencilWrite={true}
              stencilRef={0}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.KeepStencilOp}
              stencilZFail={THREE.KeepStencilOp}
              stencilZPass={THREE.IncrementWrapStencilOp}
            />
          </mesh>

          {/* 通道 2 (Front Faces)：写入正面自减模板 */}
          <mesh geometry={solidGeometry} renderOrder={7 + idx * 3} raycast={() => null}>
            <meshBasicMaterial
              depthWrite={false}
              depthTest={true}
              colorWrite={false}
              side={THREE.FrontSide}
              clippingPlanes={[plane]}
              stencilWrite={true}
              stencilRef={0}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.KeepStencilOp}
              stencilZFail={THREE.KeepStencilOp}
              stencilZPass={THREE.DecrementWrapStencilOp}
            />
          </mesh>

          {/* 通道 3 (Cap Plane)：在模板值非 0 处渲染实心深暗灰金属封口片元 (#475569) */}
          <mesh
            position={planePos}
            quaternion={planeQuat}
            renderOrder={8 + idx * 3}
            raycast={() => null}
          >
            <planeGeometry args={[size, size]} />
            <meshStandardMaterial
              color="#475569"
              roughness={0.45}
              metalness={0.5}
              side={THREE.DoubleSide}
              stencilWrite={true}
              stencilRef={0}
              stencilFunc={THREE.NotEqualStencilFunc}
              stencilFail={THREE.ReplaceStencilOp}
              stencilZFail={THREE.KeepStencilOp}
              stencilZPass={THREE.ReplaceStencilOp}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}
