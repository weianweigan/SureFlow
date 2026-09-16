import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { useMemo, useRef, useState, useCallback, useEffect, type FC } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { getBoxFaceBasis } from '@shared/design/faceMath'
import { computeScreenPixelScale } from './gizmoMath'

interface FaceBasisGizmoProps {
  faceId: string
  dimensions: [number, number, number]
  clickPoint?: THREE.Vector3 | [number, number, number] | null
  onNormalTo?: (faceId: string) => void
}

// ─────────────────────────────────────────────────────────────
// 黄色三角形「正视于」操纵手柄几何体
// ─────────────────────────────────────────────────────────────
const TRIANGLE_SHAPE = new THREE.Shape()
const TRI_R = 7.5
TRIANGLE_SHAPE.moveTo(0, TRI_R)
TRIANGLE_SHAPE.lineTo(-TRI_R * 0.866, -TRI_R * 0.5)
TRIANGLE_SHAPE.lineTo(TRI_R * 0.866, -TRI_R * 0.5)
TRIANGLE_SHAPE.closePath()
const TRIANGLE_GEOM = new THREE.ShapeGeometry(TRIANGLE_SHAPE)
const TRIANGLE_HIT_GEOM = new THREE.CircleGeometry(14, 16)
const TRIANGLE_BORDER_GEOM = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, TRI_R, 0),
  new THREE.Vector3(-TRI_R * 0.866, -TRI_R * 0.5, 0),
  new THREE.Vector3(TRI_R * 0.866, -TRI_R * 0.5, 0),
  new THREE.Vector3(0, TRI_R, 0)
])

/**
 * G-03 · 面基准坐标系与选中高亮外框 (FaceBasisGizmo)
 * 严格对齐用户最新要求与 PRD 规范：
 * - 面内主轴严格采用 X 轴（红）与 Y 轴（绿），省略 W 轴保持表面纯净；
 * - 在用户点击表面的位置附近创建黄色三角形手柄，点击触发视口平滑正视该面；
 * - 恒定屏幕像素缩放，黄色三角形始终 Billboard 正对用户屏幕；
 * - SolidWorks 风格蓝色高亮轮廓线与 8% 半透明天蓝选中面填充。
 */
export const FaceBasisGizmo: FC<FaceBasisGizmoProps> = ({
  faceId,
  dimensions,
  clickPoint,
  onNormalTo
}) => {
  _useLocale()
  const [sx, sy, sz] = dimensions
  const { camera, gl } = useThree()
  const basis = useMemo(() => getBoxFaceBasis(faceId, dimensions), [faceId, dimensions])

  const [triangleHovered, setTriangleHovered] = useState(false)

  // 计算面的最小边长
  const minFaceEdge = useMemo(() => {
    switch (faceId) {
      case 'top':
      case 'bottom':
        return Math.min(sx, sy)
      case 'front':
      case 'back':
        return Math.min(sx, sz)
      case 'left':
      case 'right':
        return Math.min(sy, sz)
      default:
        return Math.min(sx, sy)
    }
  }, [faceId, sx, sy, sz])

  const origin = useMemo(() => new THREE.Vector3(...basis.origin), [basis.origin])
  const xDir = useMemo(() => new THREE.Vector3(...basis.u), [basis.u]) // X 轴即 u 方向
  const yDir = useMemo(() => new THREE.Vector3(...basis.v), [basis.v]) // Y 轴即 v 方向
  const wDir = useMemo(() => new THREE.Vector3(...basis.w), [basis.w])

  const axesGroupRef = useRef<THREE.Group>(null)

  // 动态恒定像素缩放（标准约 60px），且限制不超过表面最小边长的 40%
  useFrame(() => {
    if (!axesGroupRef.current) return
    const s = computeScreenPixelScale(camera, origin, 60, 1.0)
    const maxAllowed = minFaceEdge * 0.4
    const clampedScale = Math.min(s, maxAllowed)
    axesGroupRef.current.scale.set(clampedScale, clampedScale, clampedScale)
  })

  // 基础归一化长度（总长 baseLen + coneHeight = 1.0）
  const baseLen = 0.82
  const coneRadius = 0.06
  const coneHeight = 0.18
  const shaftRadius = 0.02

  // 计算面在 [0, sx] × [0, sy] × [0, sz] 中的精确 4 个角点
  const faceCorners = useMemo(() => {
    const n = wDir
    const offset = 0.12 // 贴面微小外偏，彻底杜绝 Z-fighting
    const p = (x: number, y: number, z: number) =>
      new THREE.Vector3(x, y, z).addScaledVector(n, offset)

    switch (faceId) {
      case 'top':
        return [p(0, 0, sz), p(sx, 0, sz), p(sx, sy, sz), p(0, sy, sz)]
      case 'bottom':
        return [p(0, 0, 0), p(sx, 0, 0), p(sx, sy, 0), p(0, sy, 0)]
      case 'front':
        return [p(0, 0, 0), p(sx, 0, 0), p(sx, 0, sz), p(0, 0, sz)]
      case 'back':
        return [p(0, sy, 0), p(sx, sy, 0), p(sx, sy, sz), p(0, sy, sz)]
      case 'left':
        return [p(0, 0, 0), p(0, sy, 0), p(0, sy, sz), p(0, 0, sz)]
      case 'right':
        return [p(sx, 0, 0), p(sx, sy, 0), p(sx, sy, sz), p(sx, 0, sz)]
      default:
        return [p(0, 0, sz), p(sx, 0, sz), p(sx, sy, sz), p(0, sy, sz)]
    }
  }, [faceId, sx, sy, sz, wDir])

  // SolidWorks 风格选中高亮框线段
  const outlineSegmentsGeom = useMemo(() => {
    const [p0, p1, p2, p3] = faceCorners
    const points = [p0, p1, p1, p2, p2, p3, p3, p0]
    return new THREE.BufferGeometry().setFromPoints(points)
  }, [faceCorners])

  // SolidWorks 风格 8% 半透明填充平面
  const facePlaneGeom = useMemo(() => {
    const [p0, p1, p2, p3] = faceCorners
    const geom = new THREE.BufferGeometry()
    const positions = new Float32Array([
      p0.x, p0.y, p0.z,
      p1.x, p1.y, p1.z,
      p2.x, p2.y, p2.z,

      p0.x, p0.y, p0.z,
      p2.x, p2.y, p2.z,
      p3.x, p3.y, p3.z
    ])
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.computeVertexNormals()
    return geom
  }, [faceCorners])

  // X 轴与 Y 轴几何体
  const xLineGeom = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(baseLen, 0, 0)]),
    [baseLen]
  )
  const yLineGeom = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, baseLen, 0)]),
    [baseLen]
  )

  // 坐标系整体旋转四元数（使局部 X 沿 xDir, Y 沿 yDir, Z 沿 wDir）
  const basisQuat = useMemo(() => {
    const m = new THREE.Matrix4()
    m.makeBasis(xDir, yDir, wDir)
    return new THREE.Quaternion().setFromRotationMatrix(m)
  }, [xDir, yDir, wDir])

  // 计算面的几何中心
  const faceCenter = useMemo(() => {
    const c = new THREE.Vector3()
    for (const p of faceCorners) {
      c.add(p)
    }
    return c.multiplyScalar(0.25)
  }, [faceCorners])

  // 计算给定世界点在当前面上的归一化比例 (ratioU, ratioV)
  const computePointRatio = useCallback(
    (pt: THREE.Vector3 | [number, number, number]): [number, number] => {
      const p = pt instanceof THREE.Vector3 ? pt : new THREE.Vector3(...pt)
      const fid = faceId.toLowerCase()
      let ru = 0.5
      let rv = 0.5
      if (fid.includes('top') || fid === '+z') {
        ru = sx > 0 ? p.x / sx : 0.5
        rv = sy > 0 ? p.y / sy : 0.5
      } else if (fid.includes('bot') || fid === '-z') {
        ru = sx > 0 ? p.x / sx : 0.5
        rv = sy > 0 ? p.y / sy : 0.5
      } else if (fid.includes('back') || fid === '+y') {
        ru = sx > 0 ? p.x / sx : 0.5
        rv = sz > 0 ? p.z / sz : 0.5
      } else if (fid.includes('front') || fid.includes('wall') || fid === '-y') {
        ru = sx > 0 ? p.x / sx : 0.5
        rv = sz > 0 ? p.z / sz : 0.5
      } else if (fid.includes('left') || fid === '-x') {
        ru = sy > 0 ? p.y / sy : 0.5
        rv = sz > 0 ? p.z / sz : 0.5
      } else if (fid.includes('right') || fid === '+x') {
        ru = sy > 0 ? p.y / sy : 0.5
        rv = sz > 0 ? p.z / sz : 0.5
      }
      return [
        Math.max(0.08, Math.min(0.92, ru)),
        Math.max(0.08, Math.min(0.92, rv))
      ]
    },
    [faceId, sx, sy, sz]
  )

  const [clickRatio, setClickRatio] = useState<[number, number] | null>(null)

  // 当外部传入的 clickPoint 变动或首次进入时，初始化比例
  useEffect(() => {
    if (clickPoint) {
      setClickRatio(computePointRatio(clickPoint))
    }
  }, [clickPoint, computePointRatio])

  // 计算黄色三角形手柄的目标基准点（面上严格接触点，无多余法向侵入）
  const targetBasePoint = useMemo(() => {
    const [ru, rv] = clickRatio || [0.5, 0.5]
    const fid = faceId.toLowerCase()
    const pt = new THREE.Vector3()

    if (fid.includes('top') || fid === '+z') {
      pt.set(ru * sx, rv * sy, sz)
    } else if (fid.includes('bot') || fid === '-z') {
      pt.set(ru * sx, rv * sy, 0)
    } else if (fid.includes('back') || fid === '+y') {
      pt.set(ru * sx, sy, rv * sz)
    } else if (fid.includes('front') || fid.includes('wall') || fid === '-y') {
      pt.set(ru * sx, 0, rv * sz)
    } else if (fid.includes('left') || fid === '-x') {
      pt.set(0, ru * sy, rv * sz)
    } else if (fid.includes('right') || fid === '+x') {
      pt.set(sx, ru * sy, rv * sz)
    } else {
      pt.copy(faceCenter)
    }

    return pt
  }, [clickRatio, faceId, sx, sy, sz, faceCenter])

  const normalHandleRef = useRef<THREE.Group>(null)

  // 动态恒定像素缩放与 Billboard 正对用户驱动黄色三角形手柄
  // 核心保障：避让偏移必须严格限定在当前平面的面内切向量 (xDir, yDir) 上，绝对不改变法向位置；
  // 同时沿着外法向 wDir 严格向外侧浮出 0.8*s，确保在 XZ/YZ/XY 各平面均 100% 处于基体外侧，杜绝任何穿入基体内部！
  useFrame(() => {
    if (normalHandleRef.current) {
      const s = computeScreenPixelScale(camera, targetBasePoint, 1.0, 1.0)

      // 智能切向避让：根据点击比例决定向哪个象限避让，避免越出表面边界
      const [ru, rv] = clickRatio || [0.5, 0.5]
      const dirU = ru > 0.6 ? -1 : 1
      const dirV = rv > 0.6 ? -1 : 1
      const inPlaneOffset = xDir
        .clone()
        .multiplyScalar(dirU * 22 * s)
        .addScaledVector(yDir, dirV * 18 * s)

      // 外法向安全浮出：在外法向 wDir 方向浮出 0.8*s，确保在三维空间中绝对处于基体外表面之上
      const normalElevation = wDir.clone().multiplyScalar(0.8 * s)

      const finalPos = targetBasePoint.clone().add(inPlaneOffset).add(normalElevation)
      normalHandleRef.current.position.copy(finalPos)
      normalHandleRef.current.scale.set(s, s, s)
      normalHandleRef.current.quaternion.copy(camera.quaternion)
    }
  })

  return (
    <group renderOrder={160}>
      {/* ── 1. 局部坐标轴与角隅控制手柄群（恒定屏幕缩放） ── */}
      <group
        ref={axesGroupRef}
        position={origin.clone().addScaledVector(wDir, 0.15)}
        quaternion={basisQuat}
        renderOrder={260}
      >
        {/* 面原点微型球标 */}
        <mesh position={[0, 0, 0]} renderOrder={270}>
          <sphereGeometry args={[0.04, 16, 16]} />
          <meshBasicMaterial color="#ffffff" depthTest={false} />
        </mesh>
        <mesh position={[0, 0, 0]} renderOrder={269}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshBasicMaterial color="#0284c7" depthTest={false} />
        </mesh>

        {/* ── X 轴 (红色，面内横向) ── */}
        <group>
          <lineSegments geometry={xLineGeom} renderOrder={265}>
            <lineBasicMaterial color="#ef4444" linewidth={2} depthTest={false} />
          </lineSegments>
          {/* 轴杆 */}
          <mesh position={[baseLen / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]} renderOrder={265}>
            <cylinderGeometry args={[shaftRadius, shaftRadius, baseLen, 12]} />
            <meshBasicMaterial color="#ef4444" depthTest={false} />
          </mesh>
          {/* 箭头锥体 */}
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

        {/* ── Y 轴 (绿色，面内纵向) ── */}
        <group>
          <lineSegments geometry={yLineGeom} renderOrder={265}>
            <lineBasicMaterial color="#16a34a" linewidth={2} depthTest={false} />
          </lineSegments>
          {/* 轴杆 */}
          <mesh position={[0, baseLen / 2, 0]} renderOrder={265}>
            <cylinderGeometry args={[shaftRadius, shaftRadius, baseLen, 12]} />
            <meshBasicMaterial color="#16a34a" depthTest={false} />
          </mesh>
          {/* 箭头锥体 */}
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

      {/* ── 2. 在点击位置附近的黄色三角形「正视于」操纵手柄（提升优先级与防穿透） ── */}
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
          onPointerUp={(e) => {
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.stopPropagation()
            onNormalTo?.(faceId)
          }}
        >
          {/* 拾取圆层 */}
          <mesh
            geometry={TRIANGLE_HIT_GEOM}
            renderOrder={385}
            onPointerDown={(e) => {
              e.stopPropagation()
              onNormalTo?.(faceId)
            }}
            onClick={(e) => {
              e.stopPropagation()
              onNormalTo?.(faceId)
            }}
          >
            <meshBasicMaterial transparent opacity={0} depthTest={false} side={THREE.DoubleSide} />
          </mesh>

          {/* 悬停光晕 */}
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

          {/* 黄色三角形实体内核 */}
          <mesh
            geometry={TRIANGLE_GEOM}
            onPointerDown={(e) => {
              e.stopPropagation()
              onNormalTo?.(faceId)
            }}
            onClick={(e) => {
              e.stopPropagation()
              onNormalTo?.(faceId)
            }}
          >
            <meshBasicMaterial
              color={triangleHovered ? '#fde047' : '#f59e0b'}
              side={THREE.DoubleSide}
              depthTest={false}
            />
          </mesh>

          {/* 边框高对比线 */}
          <lineSegments geometry={TRIANGLE_BORDER_GEOM}>
            <lineBasicMaterial color="#78350f" linewidth={1.5} depthTest={false} />
          </lineSegments>
        </group>
      </group>

      {/* ── 3. SolidWorks 风格选中面 8% 半透明天蓝着色（点击表面更新手柄位置） ── */}
      <mesh
        geometry={facePlaneGeom}
        renderOrder={150}
        onPointerDown={(e) => {
          e.stopPropagation()
          setClickRatio(computePointRatio(e.point))
        }}
      >
        <meshBasicMaterial
          color="#0284c7"
          transparent
          opacity={0.08}
          side={THREE.DoubleSide}
          depthTest={false}
        />
      </mesh>

      {/* ── 4. SolidWorks 风格标志性亮蓝边框外轮廓线 ── */}
      <lineSegments geometry={outlineSegmentsGeom} renderOrder={155}>
        <lineBasicMaterial
          color="#0ea5e9"
          linewidth={2}
          depthTest={false}
          transparent
          opacity={0.95}
        />
      </lineSegments>
    </group>
  )
}
