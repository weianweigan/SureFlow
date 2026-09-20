import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { useMemo, type FC } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { hasGizmoIntersection, raycastSelection } from './selectionRaycast'
import type { MeshRayHit } from './CsgValveBlockMesh'
import type { CavityInstance } from '@shared/design/types'
import { getBoxFaceBasis } from '@shared/design/faceMath'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { getCavitySteps, parseCavityBands } from '../../geometry/cavityProfileBuilder'

export interface CavityProxyRingProps {
  cavity: CavityInstance
  dimensions: [number, number, number]
  baseBody?: any
  onClick: (hits: MeshRayHit[], e: ThreeEvent<MouseEvent>) => void
  clippingPlanes?: THREE.Plane[]
  onDoubleClick?: (hits: MeshRayHit[]) => void
}

/** 不可见孔口拾取代理；孔壁材质和 outline 负责可视反馈。 */
export const CavityProxyRing: FC<CavityProxyRingProps> = ({
  cavity,
  dimensions,
  baseBody,
  onClick,
  onDoubleClick,
  clippingPlanes = []
}) => {
  _useLocale()
  const { scene } = useThree()
  const hitsFor = (e: ThreeEvent<MouseEvent>): MeshRayHit[] =>
    raycastSelection(e.ray, scene, clippingPlanes).map(hit => ({
      cavityId: hit.object.userData.cavityId,
      faceIndex: hit.object.userData.cavityId ? undefined : hit.faceIndex ?? undefined,
      normal: hit.face?.normal, point: hit.point, distance: hit.distance
    }))

  const libraryDoc = useLibraryStore((s) => s.doc)
  const mouthRadius = useMemo(() => {
    const steps = cavity.steps && cavity.steps.length > 0 ? cavity.steps : getCavitySteps(cavity, libraryDoc)
    const bands = parseCavityBands(steps)
    return bands[0]?.r0 ?? 5
  }, [cavity, libraryDoc])

  const basis = useMemo(() => getBoxFaceBasis(cavity.faceId, dimensions, baseBody), [cavity.faceId, dimensions, baseBody])
  const pos = useMemo<[number, number, number]>(() => {
    const { origin, u: U, v: V, w: W } = basis
    // 孔口位置微偏置 0.02mm 贴合基体外表面，杜绝 Z-fighting
    return [
      origin[0] + cavity.u * U[0] + cavity.v * V[0] + 0.02 * W[0],
      origin[1] + cavity.u * U[1] + cavity.v * V[1] + 0.02 * W[1],
      origin[2] + cavity.u * U[2] + cavity.v * V[2] + 0.02 * W[2]
    ]
  }, [basis, cavity.u, cavity.v])

  const quat = useMemo(() => {
    const q = new THREE.Quaternion()
    const normal = new THREE.Vector3(...basis.w)
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    return q
  }, [basis.w])

  return (
    <group
      position={pos}
      quaternion={quat}
      onClick={(e) => {
        if (hasGizmoIntersection(e.intersections)) return
        e.stopPropagation()
        if (e.delta < 3) onClick(hitsFor(e), e)
      }}
      onDoubleClick={(e) => {
        if (hasGizmoIntersection(e.intersections)) return
        e.stopPropagation()
        onDoubleClick?.(hitsFor(e))
      }}
    >
      {/* 始终保留一个极薄的透明拾取碰撞圆面 */}
      <mesh visible={false} userData={{ selectionMesh: true, cavityId: cavity.instanceId }}>
        <circleGeometry args={[mouthRadius + 1.5, 24]} />
        <meshBasicMaterial side={THREE.DoubleSide} />
      </mesh>

    </group>
  )
}
