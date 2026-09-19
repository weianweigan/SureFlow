import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { useMemo, useRef, type FC } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { getBoxFaceBasis } from '@shared/design/faceMath'
import { computeScreenPixelScale } from './gizmoMath'

interface FaceBasisGizmoProps {
  faceId: string
  dimensions: [number, number, number]
  baseBody?: any
  clickPoint?: THREE.Vector3 | [number, number, number] | null
  onNormalTo?: (faceId: string) => void
}

/**
 * G-03 · 面基准坐标系手柄 (FaceBasisGizmo)
 * 严格对齐 PRD-FR-04-10 规范：
 * - 面内主轴呈现 X/U 轴（红）与 Y/V 轴（绿），以原点为根；
 * - 选中高亮由 CsgValveBlockMesh 基于 B-Rep 面元多材质原生渲染，此处不再绘制冲突的长方体包围面；
 * - 原生支持 Box、L型、T型 及 STEP 任意复杂几何面。
 */
export const FaceBasisGizmo: FC<FaceBasisGizmoProps> = ({
  faceId,
  dimensions,
  baseBody,
  onNormalTo
}) => {
  _useLocale()
  const [sx, sy, sz] = dimensions
  const { camera } = useThree()
  const basis = useMemo(() => getBoxFaceBasis(faceId, dimensions, baseBody), [faceId, dimensions, baseBody])

  const minFaceEdge = useMemo(() => {
    return Math.min(sx, sy, sz)
  }, [sx, sy, sz])

  const origin = useMemo(() => new THREE.Vector3(...basis.origin), [basis.origin])
  const xDir = useMemo(() => new THREE.Vector3(...basis.u), [basis.u])
  const yDir = useMemo(() => new THREE.Vector3(...basis.v), [basis.v])
  const wDir = useMemo(() => new THREE.Vector3(...basis.w), [basis.w])

  const axesGroupRef = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!axesGroupRef.current) return
    const s = computeScreenPixelScale(camera, origin, 60, 1.0)
    const maxAllowed = minFaceEdge * 0.45
    const clampedScale = Math.min(s, maxAllowed)
    axesGroupRef.current.scale.set(clampedScale, clampedScale, clampedScale)
  })

  const baseLen = 0.82
  const coneRadius = 0.06
  const coneHeight = 0.18
  const shaftRadius = 0.02

  const xLineGeom = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(baseLen, 0, 0)]),
    [baseLen]
  )
  const yLineGeom = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, baseLen, 0)]),
    [baseLen]
  )

  const basisQuat = useMemo(() => {
    const m = new THREE.Matrix4()
    m.makeBasis(xDir, yDir, wDir)
    return new THREE.Quaternion().setFromRotationMatrix(m)
  }, [xDir, yDir, wDir])

  return (
    <group renderOrder={160}>
      {/* 局部坐标轴与手柄群 */}
      <group
        ref={axesGroupRef}
        position={origin.clone().addScaledVector(wDir, 0.15)}
        quaternion={basisQuat}
        renderOrder={260}
      >
        {/* 面原点微型球标（点击可正视此面） */}
        <group
          onClick={(e) => {
            e.stopPropagation()
            onNormalTo?.(faceId)
          }}
        >
          <mesh position={[0, 0, 0]} renderOrder={270}>
            <sphereGeometry args={[0.04, 16, 16]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} />
          </mesh>
          <mesh position={[0, 0, 0]} renderOrder={269}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshBasicMaterial color="#0284c7" depthTest={false} />
          </mesh>
        </group>

        {/* X / U 轴 (红色) */}
        <group>
          <lineSegments geometry={xLineGeom} renderOrder={265}>
            <lineBasicMaterial color="#ef4444" linewidth={2} depthTest={false} />
          </lineSegments>
          <mesh position={[baseLen / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]} renderOrder={265}>
            <cylinderGeometry args={[shaftRadius, shaftRadius, baseLen, 12]} />
            <meshBasicMaterial color="#ef4444" depthTest={false} />
          </mesh>
          <mesh position={[baseLen + coneHeight / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]} renderOrder={266}>
            <coneGeometry args={[coneRadius, coneHeight, 16]} />
            <meshBasicMaterial color="#ef4444" depthTest={false} />
          </mesh>
          <Html position={[baseLen + coneHeight + 0.15, 0, 0]} center style={{ pointerEvents: 'none' }}>
            <span className="font-bold text-[12px] font-mono text-red-600 drop-shadow-[0_1px_2px_rgba(255,255,255,0.9)] select-none">
              U
            </span>
          </Html>
        </group>

        {/* Y / V 轴 (绿色) */}
        <group>
          <lineSegments geometry={yLineGeom} renderOrder={265}>
            <lineBasicMaterial color="#16a34a" linewidth={2} depthTest={false} />
          </lineSegments>
          <mesh position={[0, baseLen / 2, 0]} renderOrder={265}>
            <cylinderGeometry args={[shaftRadius, shaftRadius, baseLen, 12]} />
            <meshBasicMaterial color="#16a34a" depthTest={false} />
          </mesh>
          <mesh position={[0, baseLen + coneHeight / 2, 0]} renderOrder={266}>
            <coneGeometry args={[coneRadius, coneHeight, 16]} />
            <meshBasicMaterial color="#16a34a" depthTest={false} />
          </mesh>
          <Html position={[0, baseLen + coneHeight + 0.15, 0]} center style={{ pointerEvents: 'none' }}>
            <span className="font-bold text-[12px] font-mono text-emerald-600 drop-shadow-[0_1px_2px_rgba(255,255,255,0.9)] select-none">
              V
            </span>
          </Html>
        </group>
      </group>
    </group>
  )
}
