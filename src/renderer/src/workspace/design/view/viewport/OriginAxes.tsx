import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { useMemo, useRef, type FC } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { computeScreenPixelScale } from './gizmoMath'

interface OriginAxesProps {
  dimensions: [number, number, number]
  visible?: boolean
}

/**
 * G-02 · SolidWorks 风格世界原点基准坐标系 (World Coordinate System - WCS)
 * 严格对齐 PRD-FR-04-10 规范：
 * - 位于绝对基准原点 (0, 0, 0)，为纯只读空间几何参照，不可直接拖拽；
 * - 恒定屏幕像素缩放：采用 useFrame 动态计算锁定在屏幕约 60px 视觉范围，大零件拉远后原点依然清晰可辨；
 * - 原点中心 SolidWorks 经典蓝环白心球标；
 * - X 轴鲜红 (#dc2626)，Y 轴翠绿 (#16a34a)，Z 轴湛蓝 (#0284c7)；
 * - 轴端配备极简 X, Y, Z 字体标牌；
 * - depthTest: false 确保在零件角隅与实体内部透彻可见。
 */
export const OriginAxes: FC<OriginAxesProps> = ({ visible = true }) => {
  _useLocale()
  if (!visible) return null

  const groupRef = useRef<THREE.Group>(null)
  const { camera } = useThree()

  // 基础标准比例单元（归一化为 1.0 单位，通过 useFrame 统一进行屏幕像素级恒定缩放）
  const axisLen = 1.0
  const shaftRadius = 0.022
  const coneRadius = 0.065
  const coneHeight = 0.2
  const originRadius = 0.065
  const negLen = 0.25

  // 负向辅助线几何点
  const negXGeom = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-negLen, 0, 0),
      new THREE.Vector3(0, 0, 0)
    ])
  }, [negLen])

  const negYGeom = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -negLen, 0),
      new THREE.Vector3(0, 0, 0)
    ])
  }, [negLen])

  const negZGeom = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -negLen),
      new THREE.Vector3(0, 0, 0)
    ])
  }, [negLen])

  // 恒定屏幕像素大小（约 60px）
  const originPos = useMemo(() => new THREE.Vector3(0, 0, 0), [])
  useFrame(() => {
    if (!groupRef.current) return
    const s = computeScreenPixelScale(camera, originPos, 60)
    groupRef.current.scale.set(s, s, s)
  })

  return (
    <group ref={groupRef} name="OriginAxes" userData={{ isOriginAxes: true }} position={[0, 0, 0]} renderOrder={240}>
      {/* ── SolidWorks 原点特征中心标记（蓝环白心） ── */}
      <mesh position={[0, 0, 0]} renderOrder={252}>
        <sphereGeometry args={[originRadius, 16, 16]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} />
      </mesh>
      <mesh position={[0, 0, 0]} renderOrder={250}>
        <sphereGeometry args={[originRadius * 1.35, 16, 16]} />
        <meshBasicMaterial color="#0284c7" depthTest={false} />
      </mesh>

      {/* ── 负方向细引线 ── */}
      <lineSegments geometry={negXGeom} renderOrder={235}>
        <lineBasicMaterial color="#dc2626" opacity={0.35} transparent depthTest={false} />
      </lineSegments>
      <lineSegments geometry={negYGeom} renderOrder={235}>
        <lineBasicMaterial color="#16a34a" opacity={0.35} transparent depthTest={false} />
      </lineSegments>
      <lineSegments geometry={negZGeom} renderOrder={235}>
        <lineBasicMaterial color="#0284c7" opacity={0.35} transparent depthTest={false} />
      </lineSegments>

      {/* ── X 轴 (红色) ── */}
      <group>
        <mesh
          position={[axisLen / 2, 0, 0]}
          rotation={[0, 0, -Math.PI / 2]}
          renderOrder={245}
        >
          <cylinderGeometry args={[shaftRadius, shaftRadius, axisLen, 12]} />
          <meshBasicMaterial color="#dc2626" depthTest={false} />
        </mesh>
        <mesh
          position={[axisLen + coneHeight / 2, 0, 0]}
          rotation={[0, 0, -Math.PI / 2]}
          renderOrder={246}
        >
          <coneGeometry args={[coneRadius, coneHeight, 16]} />
          <meshBasicMaterial color="#dc2626" depthTest={false} />
        </mesh>
        <Html
          position={[axisLen + coneHeight + 0.18, 0, 0]}
          center
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          <span className="font-bold text-[12px] font-mono text-red-600 drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)] select-none">
            X
          </span>
        </Html>
      </group>

      {/* ── Y 轴 (绿色) ── */}
      <group>
        <mesh
          position={[0, axisLen / 2, 0]}
          renderOrder={245}
        >
          <cylinderGeometry args={[shaftRadius, shaftRadius, axisLen, 12]} />
          <meshBasicMaterial color="#16a34a" depthTest={false} />
        </mesh>
        <mesh
          position={[0, axisLen + coneHeight / 2, 0]}
          renderOrder={246}
        >
          <coneGeometry args={[coneRadius, coneHeight, 16]} />
          <meshBasicMaterial color="#16a34a" depthTest={false} />
        </mesh>
        <Html
          position={[0, axisLen + coneHeight + 0.18, 0]}
          center
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          <span className="font-bold text-[12px] font-mono text-emerald-600 drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)] select-none">
            Y
          </span>
        </Html>
      </group>

      {/* ── Z 轴 (蓝色) ── */}
      <group>
        <mesh
          position={[0, 0, axisLen / 2]}
          rotation={[Math.PI / 2, 0, 0]}
          renderOrder={245}
        >
          <cylinderGeometry args={[shaftRadius, shaftRadius, axisLen, 12]} />
          <meshBasicMaterial color="#0284c7" depthTest={false} />
        </mesh>
        <mesh
          position={[0, 0, axisLen + coneHeight / 2]}
          rotation={[Math.PI / 2, 0, 0]}
          renderOrder={246}
        >
          <coneGeometry args={[coneRadius, coneHeight, 16]} />
          <meshBasicMaterial color="#0284c7" depthTest={false} />
        </mesh>
        <Html
          position={[0, 0, axisLen + coneHeight + 0.18]}
          center
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          <span className="font-bold text-[12px] font-mono text-sky-600 drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)] select-none">
            Z
          </span>
        </Html>
      </group>
    </group>
  )
}
