import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useMemo, useRef, useState, type FC } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { getBoxFaceBasis } from '@shared/design/faceMath'
import { computeScreenPixelScale } from './gizmoMath'

const TRI_R = 6
const TRIANGLE_GEOM = (() => {
  const shape = new THREE.Shape()
  const r = TRI_R
  const p0 = [0, r]
  const p1 = [r * Math.cos(Math.PI / 6), -r * Math.sin(Math.PI / 6)]
  const p2 = [-r * Math.cos(Math.PI / 6), -r * Math.sin(Math.PI / 6)]
  shape.moveTo(p0[0], p0[1])
  shape.lineTo(p1[0], p1[1])
  shape.lineTo(p2[0], p2[1])
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
})()

const TRIANGLE_BORDER_GEOM = (() => {
  const r = TRI_R
  const pts = [
    new THREE.Vector3(0, r, 0),
    new THREE.Vector3(r * Math.cos(Math.PI / 6), -r * Math.sin(Math.PI / 6), 0),
    new THREE.Vector3(-r * Math.cos(Math.PI / 6), -r * Math.sin(Math.PI / 6), 0),
    new THREE.Vector3(0, r, 0)
  ]
  return new THREE.BufferGeometry().setFromPoints(pts)
})()

const TRIANGLE_HIT_GEOM = new THREE.CircleGeometry(TRI_R * 1.4, 20)

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
 * - 面内主轴呈现 X 轴（红）与 Y 轴（绿），以原点为根；
 * - 选中高亮由 CsgValveBlockMesh 基于 B-Rep 面元多材质原生渲染；
 * - 提供「正视于（Normal To）」工程黄色三角形手柄与操作标牌，始终正对用户屏幕；
 * - 原生支持 Box、L型、T型 及 STEP 任意复杂几何面。
 */
export const FaceBasisGizmo: FC<FaceBasisGizmoProps> = ({
  faceId,
  dimensions,
  baseBody,
  clickPoint,
  onNormalTo
}) => {
  _useLocale()
  const [sx, sy, sz] = dimensions
  const { camera, gl } = useThree()
  const [triangleHovered, setTriangleHovered] = useState(false)

  const basis = useMemo(() => getBoxFaceBasis(faceId, dimensions, baseBody), [faceId, dimensions, baseBody])

  const minFaceEdge = useMemo(() => {
    return Math.min(sx, sy, sz)
  }, [sx, sy, sz])

  const origin = useMemo(() => new THREE.Vector3(...basis.origin), [basis.origin])
  const xDir = useMemo(() => new THREE.Vector3(...basis.u), [basis.u])
  const yDir = useMemo(() => new THREE.Vector3(...basis.v), [basis.v])
  const wDir = useMemo(() => new THREE.Vector3(...basis.w), [basis.w])

  // 计算正视手柄所在的世界基准坐标（优先吸附至点击位置，否则置于面几何中心）
  const targetBasePoint = useMemo(() => {
    if (clickPoint) {
      return clickPoint instanceof THREE.Vector3 ? clickPoint.clone() : new THREE.Vector3(...clickPoint)
    }
    const faceDef = baseBody?.faces?.find((f: any) => f.id.toLowerCase() === faceId.toLowerCase())
    if (faceDef?.centerPoint) {
      return new THREE.Vector3(...faceDef.centerPoint)
    }
    return origin.clone().addScaledVector(xDir, Math.min(sx, sy, sz) * 0.25).addScaledVector(yDir, Math.min(sx, sy, sz) * 0.25)
  }, [clickPoint, faceId, baseBody, origin, xDir, yDir, sx, sy, sz])

  const axesGroupRef = useRef<THREE.Group>(null)
  const normalHandleRef = useRef<THREE.Group>(null)

  useFrame(() => {
    if (axesGroupRef.current) {
      const s = computeScreenPixelScale(camera, origin, 60, 1.0)
      const maxAllowed = minFaceEdge * 0.45
      const clampedScale = Math.min(s, maxAllowed)
      axesGroupRef.current.scale.set(clampedScale, clampedScale, clampedScale)
    }

    if (normalHandleRef.current) {
      const s = computeScreenPixelScale(camera, targetBasePoint, 1.0, 1.0)
      // 沿表面外法向安全浮出，防止破面与 z-fighting
      const finalPos = targetBasePoint.clone().addScaledVector(wDir, 0.8 * s)
      normalHandleRef.current.position.copy(finalPos)
      normalHandleRef.current.scale.set(s, s, s)
      normalHandleRef.current.quaternion.copy(camera.quaternion)
    }
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
      {/* 1. 局部坐标轴与面原点手柄群 */}
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

        {/* X 轴 (红色) */}
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
              X
            </span>
          </Html>
        </group>

        {/* Y 轴 (绿色) */}
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
              Y
            </span>
          </Html>
        </group>
      </group>

      {/* 2. 在点击位置附近的「正视于（Normal To）」工程黄色三角形手柄与标牌 */}
      <group ref={normalHandleRef} renderOrder={380}>
        <group
          onPointerOver={(e) => {
            e.stopPropagation()
            setTriangleHovered(true)
            gl.domElement.style.cursor = 'pointer'
          }}
          onPointerOut={() => {
            setTriangleHovered(false)
            gl.domElement.style.cursor = 'auto'
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
            onNormalTo?.(faceId)
          }}
          onClick={(e) => {
            e.stopPropagation()
            onNormalTo?.(faceId)
          }}
        >
          {/* 透明交互响应圆面 */}
          <mesh geometry={TRIANGLE_HIT_GEOM} renderOrder={385}>
            <meshBasicMaterial transparent opacity={0} depthTest={false} side={THREE.DoubleSide} />
          </mesh>

          {/* 悬停金色光晕 */}
          {triangleHovered && (
            <mesh scale={[1.25, 1.25, 1]} position={[0, 0, -0.005]}>
              <ringGeometry args={[TRI_R * 0.7, TRI_R * 1.5, 24]} />
              <meshBasicMaterial
                color="#fbbf24"
                side={THREE.DoubleSide}
                depthTest={false}
                transparent
                opacity={0.45}
              />
            </mesh>
          )}

          {/* 黄色等边三角形实体内核 */}
          <mesh geometry={TRIANGLE_GEOM}>
            <meshBasicMaterial
              color={triangleHovered ? '#fde047' : '#f59e0b'}
              side={THREE.DoubleSide}
              depthTest={false}
            />
          </mesh>

          {/* 深色高对比边框描边 */}
          <lineSegments geometry={TRIANGLE_BORDER_GEOM}>
            <lineBasicMaterial color="#78350f" linewidth={3} depthTest={false} />
          </lineSegments>

          {/* 右侧微型实体徽标 [▲ 正视] */}
          {/* <Html position={[20, 0, 0]} style={{ pointerEvents: 'auto' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onNormalTo?.(faceId)
              }}
              title={_t('正视于此面 (Normal To)')}
              className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-bold text-[11px] px-1.5 py-0.5 rounded shadow-lg transition-transform hover:scale-105 select-none whitespace-nowrap -translate-y-1/2 cursor-pointer border border-amber-600"
            >
              <span>▲</span>
              <span>{_t('正视')}</span>
            </button>
          </Html> */}
        </group>
      </group>
    </group>
  )
}
