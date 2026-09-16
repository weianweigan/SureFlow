import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { GizmoVisualLayer } from './GizmoVisualLayer'
import { t as _t, msg as _msg } from '@shared/i18n'
import { useGeometrySnap } from '../../interaction/snapping/useGeometrySnap'
import { cavityAxis, profileBands, type Vec3 } from '@shared/design/cavityGeometry'
import { useMemo, useRef, useState, useEffect, type FC } from 'react'
import * as THREE from 'three'
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useDesignStore } from '../../model/designStore'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { getCavitySteps, buildCavityThreeGeometry } from '../../geometry/cavityProfileBuilder'
import { getBoxFaceBasis, localToWorldPoint } from '@shared/design/faceMath'
import { computeScreenPixelScale } from './gizmoMath'
import type { CavityInstance } from '@shared/design/types'
import type { Step } from '@shared/cavity/types'

interface CavityDepthGizmoProps {
  projectId: string
  dimensions: [number, number, number]
  onOpenInclinedPopover?: () => void
  isInclinedPopoverOpen?: boolean
}

// ─────────────────────────────────────────────────────────────
// 圆形操作手柄几何体（精密 CAD 规格）
// ─────────────────────────────────────────────────────────────
const KNOB_HIT_GEOM = new THREE.CircleGeometry(14, 24)
const KNOB_CORE_GEOM = new THREE.CircleGeometry(4.8, 32)
const KNOB_RING_GEOM = new THREE.RingGeometry(4.2, 5.6, 32)
const KNOB_HALO_GEOM = new THREE.RingGeometry(5.2, 9.2, 32)
const KNOB_CONTRAST_GEOM = new THREE.CircleGeometry(7, 32)
const MOUTH_ORIGIN_BACK_GEOM = new THREE.CircleGeometry(8, 32)
const MOUTH_ORIGIN_RING_GEOM = new THREE.RingGeometry(4.6, 6.6, 32)
const MOUTH_ORIGIN_CORE_GEOM = new THREE.CircleGeometry(3, 32)

/**
 * G-13 · 孔深操纵手柄与斜孔实时预览 (CavityDepthGizmo)
 * 严格对齐 PRD 规范与用户最新要求：
 * 1. 修改的底孔严格锁定倒数第一个非锥孔台阶的高度/长度（保护成型上阶与钻尖 118° 收尖段）；
 * 2. 3D 视口极简纯净设计：
 *    - 3D 视口中仅保留一个核心底孔深度推拉手柄，彻底移除 3D 视口内拥挤重叠的角度 Gizmo；
 *    - 操作手柄圆点强制启用 Billboard 与 useFrame 双重驱动，确保在任意相机旋转视角下 100% 正向面向用户；
 *    - 穿透渲染贯穿全长的孔腔中心轴线，并在推拉或微调角度时以 60 FPS 实时呈现 3D 实体幽灵与轮廓线框；
 * 3. 斜孔精细化定位：在底孔标牌上点击「⤹ 斜孔」，在视口右上角单独弹出 Popover 卡片面板进行精细化调节。
 */
export const CavityDepthGizmo: FC<CavityDepthGizmoProps> = ({
  projectId,
  dimensions,
  onOpenInclinedPopover,
  isInclinedPopoverOpen
}) => {
  _useLocale()
  const { camera, gl } = useThree()
  const controls = useThree((s) => (s as any).controls)
  const session = useDesignStore((s) => s.projects[projectId])
  const updateCavity = useDesignStore((s) => s.updateCavity)
  const libraryDoc = useLibraryStore((s) => s.doc)

  const snapping=useGeometrySnap(projectId,dimensions)
  const snapApi=useRef(snapping)
  snapApi.current=snapping
  const lastSnapPointer=useRef<PointerEvent|null>(null)
  const selected = session?.selected
  const activeScheme = useMemo(() => {
    if (!session?.doc) return null
    return (
      session.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) ||
      session.doc.schemes[0]
    )
  }, [session?.doc])

  const cavities: CavityInstance[] = activeScheme?.cavities || []

  // 判定当前选中的单个孔腔（螺栓孔/定位销孔锁定不渲染手柄）
  const activeCavity = useMemo<CavityInstance | null>(() => {
    if (!selected || selected.type !== 'cavity') return null
    const cav = cavities.find((c: CavityInstance) => c.instanceId === selected.id)
    if (!cav || cav.suppressed) return null
    if (cav.cavityType === 'bolt-hole' || cav.cavityType === 'locating-pin-hole') {
      return null
    }
    return cav
  }, [selected, cavities])

  // 获取完整孔腔台阶（优先实例自身显式台阶，若为空从模板库自动解析）
  const cavitySteps = useMemo<Step[]>(() => {
    if (!activeCavity) return []
    return activeCavity.steps && activeCavity.steps.length > 0
      ? activeCavity.steps
      : getCavitySteps(activeCavity, libraryDoc)
  }, [activeCavity, libraryDoc])

  // 1. 严格锁定底孔台阶序号：倒数第一个非锥孔台阶 (type !== 'tapered')
  const bottomStepIndex = useMemo(() => {
    if (!cavitySteps || cavitySteps.length === 0) return -1
    for (let i = cavitySteps.length - 1; i >= 0; i--) {
      if (cavitySteps[i].type !== 'tapered') {
        return i
      }
    }
    return 0
  }, [cavitySteps])

  // 操纵状态
  const [isDraggingDepth, setIsDraggingDepth] = useState<boolean>(false)
  const [isHovered, setIsHovered] = useState<boolean>(false)
  const [previewDepth, setPreviewDepthState] = useState<number | null>(null)
  const previewDepthRef=useRef<number|null>(null)
  const setPreviewDepth=(value:number|null)=>{
    previewDepthRef.current=value;setPreviewDepthState(value)
    if (value===null) snapApi.current.clear()
  }
  const [isSnapped, setIsSnapped] = useState<boolean>(false)

  // 深度手柄 Group Ref（用于保证 100% Billboard 始终正对用户与屏幕物理尺寸恒定）
  const depthKnobGroupRef = useRef<THREE.Group>(null)
  const mouthOriginGroupRef = useRef<THREE.Group>(null)

  // 当前实时有效深度与两个角度
  const initialBottomDepth =
    bottomStepIndex >= 0 && bottomStepIndex < cavitySteps.length
      ? cavitySteps[bottomStepIndex]?.length ?? 20
      : 20
  const currentBottomDepth = previewDepth !== null ? previewDepth : initialBottomDepth

  const currentAzimuth = activeCavity?.azimuth ?? activeCavity?.rotation ?? 0
  const normAzimuth = ((Math.round(currentAzimuth) % 360) + 360) % 360
  const azRad = (normAzimuth * Math.PI) / 180

  const currentTilt = activeCavity?.tiltAngle ?? 0
  const normTilt = Math.max(0, Math.min(60, Math.round(currentTilt * 10) / 10))
  const tiltRad = (normTilt * Math.PI) / 180

  // 计算当前孔的世界空间基准向量与几何轴向信息
  const geometryInfo = useMemo(() => {
    if (!activeCavity || bottomStepIndex === -1) return null
    const basis = getBoxFaceBasis(activeCavity.faceId, dimensions)
    const mouthPos = localToWorldPoint(
      basis,
      activeCavity.u,
      activeCavity.v,
      activeCavity.depthOffset || 0
    )
    const mouthVec = new THREE.Vector3(...mouthPos)

    const U = new THREE.Vector3(...basis.u)
    const V = new THREE.Vector3(...basis.v)
    const W = new THREE.Vector3(...basis.w)
    const normalIn = W.clone().negate() // 深入基体方向 -W

    // 上层成型台阶总深度（底孔段之前的所有台阶总长）
    const upperDepth = profileBands(cavitySteps)[bottomStepIndex]?.z0 ?? 0

    // 面内方位角单位向量 eAz 与正交向量 ePerp
    const cosAz = Math.cos(azRad)
    const sinAz = Math.sin(azRad)
    const eAz = U.clone().multiplyScalar(cosAz).addScaledVector(V, sinAz).normalize()
    const ePerp = U.clone().multiplyScalar(-sinAz).addScaledVector(V, cosAz).normalize()

    // 深入孔轴单位方向向量 dir: 沿 normalIn (-W) 向 eAz 倾斜 tiltRad
    const dir = new THREE.Vector3(...cavityAxis(activeCavity, dimensions).direction)

    // 当前底孔终点世界坐标
    const curTotal = upperDepth + currentBottomDepth
    const tipPos = mouthVec.clone().addScaledVector(dir, curTotal)

    // 正交空间姿态四元数（严格确保 local +Z(0,0,1) 对齐深入基体的 dir，行列式恒为 +1.000，杜绝横卧失真）
    const Z_axis = dir.clone().normalize()
    const Y_axis = ePerp.clone().normalize()
    const X_axis = new THREE.Vector3().crossVectors(Y_axis, Z_axis).normalize()
    Y_axis.crossVectors(Z_axis, X_axis).normalize()

    const spinRad = (((activeCavity.rotation || 0) - (activeCavity.azimuth || 0)) * Math.PI) / 180
    const cosS = Math.cos(spinRad)
    const sinS = Math.sin(spinRad)
    const finalX = X_axis.clone().multiplyScalar(cosS).addScaledVector(Y_axis, sinS)
    const finalY = Y_axis.clone().multiplyScalar(cosS).addScaledVector(X_axis, -sinS)
    const holeMatrix4 = new THREE.Matrix4().makeBasis(finalX, finalY, Z_axis)
    const holeQuat = new THREE.Quaternion().setFromRotationMatrix(holeMatrix4)

    return {
      basis,
      mouthPos: mouthVec,
      U,
      V,
      W,
      normalIn,
      eAz,
      ePerp,
      dir,
      upperDepth,
      tipPos,
      holeQuat
    }
  }, [
    activeCavity,
    bottomStepIndex,
    cavitySteps,
    dimensions,
    azRad,
    tiltRad,
    currentBottomDepth,
    normTilt,
    normAzimuth
  ])

  // 实时孔腔动态拉伸预览几何体
  const { previewMeshGeom, previewEdgesGeom } = useMemo(() => {
    if (!isDraggingDepth || !cavitySteps || cavitySteps.length === 0 || bottomStepIndex === -1) {
      return { previewMeshGeom: null, previewEdgesGeom: null }
    }
    const dynamicSteps: Step[] = cavitySteps.map((s, idx) => {
      if (idx === bottomStepIndex) {
        return { ...s, length: currentBottomDepth }
      }
      return s
    })
    const geom = buildCavityThreeGeometry(dynamicSteps, 28)
    const edges = new THREE.EdgesGeometry(geom, 25)
    return { previewMeshGeom: geom, previewEdgesGeom: edges }
  }, [isDraggingDepth, cavitySteps, bottomStepIndex, currentBottomDepth])
  useEffect(() => () => {
    previewMeshGeom?.dispose()
    previewEdgesGeom?.dispose()
  }, [previewMeshGeom, previewEdgesGeom])

  // 动态屏幕像素比例与 100% 恒定 Billboard 朝向相机（每帧更新，无论如何旋转视角绝无侧切）
  useFrame(() => {
    if (!geometryInfo) return
    if (depthKnobGroupRef.current) {
      const s = computeScreenPixelScale(camera, geometryInfo.tipPos, 1.0, 1.0)
      depthKnobGroupRef.current.position.copy(geometryInfo.tipPos)
      depthKnobGroupRef.current.scale.set(s, s, s)
      // 强制在渲染循环中跟随相机的实时姿态，彻底解决 React 静态渲染不响应相机轨道旋转的问题
      depthKnobGroupRef.current.quaternion.copy(camera.quaternion)
    }
    if (mouthOriginGroupRef.current) {
      const s = computeScreenPixelScale(camera, geometryInfo.mouthPos, 1.0, 1.0)
      mouthOriginGroupRef.current.position.copy(geometryInfo.mouthPos)
      mouthOriginGroupRef.current.scale.set(s, s, s)
      mouthOriginGroupRef.current.quaternion.copy(camera.quaternion)
    }
  })

  // 拖拽起始记录
  const dragStartRef = useRef<{
    initialBottomDepth: number
    upperDepth: number
    mouthPos: THREE.Vector3
    tipPos: THREE.Vector3
    dir: THREE.Vector3
    dragPlane: THREE.Plane
  } | null>(null)

  useEffect(()=>{
    setIsDraggingDepth(false);setPreviewDepth(null);setIsSnapped(false)
    dragStartRef.current=null
    if(controls) controls.enabled=true
  },[activeScheme?.cavities,dimensions[0],dimensions[1],dimensions[2],activeCavity?.instanceId])

  // 启动深度手柄拖拽
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!geometryInfo || !activeCavity || e.button !== 0) return
    e.stopPropagation()

    if (controls) {
      controls.enabled = false
    }

    // 虚拟拖拽视平面：过孔轴且最正对相机的平面
    const camDir = camera.getWorldDirection(new THREE.Vector3())
    let planeNormal = new THREE.Vector3().crossVectors(geometryInfo.dir, camDir).cross(geometryInfo.dir).normalize()
    if (planeNormal.lengthSq() < 1e-3) {
      planeNormal = new THREE.Vector3(0, 1, 0).cross(geometryInfo.dir).normalize()
      if (planeNormal.lengthSq() < 1e-3) {
        planeNormal = new THREE.Vector3(1, 0, 0).cross(geometryInfo.dir).normalize()
      }
    }
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, geometryInfo.tipPos)

    dragStartRef.current = {
      initialBottomDepth,
      upperDepth: geometryInfo.upperDepth,
      mouthPos: geometryInfo.mouthPos.clone(),
      tipPos: geometryInfo.tipPos.clone(),
      dir: geometryInfo.dir.clone(),
      dragPlane
    }

    setIsDraggingDepth(true)
    setPreviewDepth(initialBottomDepth)
    setIsSnapped(false)
  }

  // 全局 Window 拖拽事件监听与生命周期安全守护
  useEffect(() => {
    if (!isDraggingDepth || !dragStartRef.current || !geometryInfo || !activeCavity) return

    const raycaster = new THREE.Raycaster()

    const onPointerMove = (e: PointerEvent) => {
      lastSnapPointer.current=e
      const startState = dragStartRef.current
      if (!startState) return

      const rect = gl.domElement.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(mouse, camera)

      const intersectPoint = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(startState.dragPlane, intersectPoint)) return

      const projDist = intersectPoint.clone().sub(startState.mouthPos).dot(startState.dir)
      const result=snapApi.current.depth(startState.mouthPos.toArray() as Vec3,startState.dir.toArray() as Vec3,Math.max(startState.upperDepth+2,projDist),startState.upperDepth,[activeCavity.instanceId],e.shiftKey)
      setPreviewDepth(result.depth-startState.upperDepth)
      setIsSnapped(result.matches.length>0)
    }

    const onPointerUp = (e: PointerEvent) => {
      onPointerMove(e)
      const startState = dragStartRef.current
      if (startState && previewDepthRef.current !== null) {
        if (Math.abs(previewDepthRef.current - startState.initialBottomDepth) > 0.05) {
          const newSteps: Step[] = cavitySteps.map((s) => ({ ...s }))
          if (bottomStepIndex >= 0 && bottomStepIndex < newSteps.length) {
            newSteps[bottomStepIndex] = {
              ...newSteps[bottomStepIndex],
              length: previewDepthRef.current
            }
            updateCavity(projectId, activeCavity.instanceId, { steps: newSteps })
          }
        }
      }

      setIsDraggingDepth(false)
      setPreviewDepth(null)
      setIsSnapped(false)
      dragStartRef.current = null
      if (controls) controls.enabled = true
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if(e.key==='Tab'&&lastSnapPointer.current&&!((e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable="true"]'))){e.preventDefault();snapApi.current.next();onPointerMove(lastSnapPointer.current)}
      if (e.key === 'Escape') {
        setIsDraggingDepth(false)
        setPreviewDepth(null)
        setIsSnapped(false)
        dragStartRef.current = null
        if (controls) controls.enabled = true
      }
    }

    const onBlur = () => {
      setIsDraggingDepth(false)
      setPreviewDepth(null)
      setIsSnapped(false)
      dragStartRef.current = null
      if (controls) controls.enabled = true
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pointercancel', onBlur)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointercancel', onBlur)
      if (controls) controls.enabled = true
    }
  }, [
    isDraggingDepth,
    previewDepth,
    geometryInfo,
    activeCavity,
    cavitySteps,
    bottomStepIndex,
    libraryDoc,
    controls,
    dimensions,
    gl,
    camera,
    projectId,
    updateCavity
  ])

  // 组件卸载时恢复控制器
  useEffect(() => {
    return () => {
      if (controls) controls.enabled = true
    }
  }, [controls])

  // 孔腔中轴线几何体（自孔口贯穿至底孔终点）
  const { axisLineGeom, axisExtGeom } = useMemo(() => {
    if (!geometryInfo) return { axisLineGeom: null, axisExtGeom: null }
    const line = new THREE.BufferGeometry().setFromPoints([
      geometryInfo.mouthPos,
      geometryInfo.tipPos
    ])
    const ext = new THREE.BufferGeometry().setFromPoints([
      geometryInfo.tipPos,
      geometryInfo.tipPos.clone().addScaledVector(geometryInfo.dir, 16)
    ])
    return { axisLineGeom: line, axisExtGeom: ext }
  }, [geometryInfo])

  // 统一安全守卫：当无选中有效孔腔时返回 null
  if (!activeCavity || !geometryInfo || !axisLineGeom || !axisExtGeom) {
    return null
  }

  const isDepthActive = isDraggingDepth || isHovered
  const hasTilt = Boolean(activeCavity.tiltAngle && activeCavity.tiltAngle > 0)

  return (
    <group renderOrder={350} userData={{ interactionPriority: 'gizmo' }}>
      {/* ────────────────────────────────────────────────────────
          0. 实时孔腔实体与线框动态拉伸/倾斜幽灵预览 (Live 3D Ghost)
          严格沿真实深入轴向 dir 沉入基体内部，行列式 +1.000，杜绝横卧失真
          ──────────────────────────────────────────────────────── */}
      {isDraggingDepth && previewMeshGeom && (
        <group position={geometryInfo.mouthPos} quaternion={geometryInfo.holeQuat}>
          <mesh geometry={previewMeshGeom} renderOrder={340}>
            <meshBasicMaterial
              color="#f59e0b"
              transparent
              opacity={isDraggingDepth ? 0.35 : 0.15}
              depthTest={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          {previewEdgesGeom && (
            <lineSegments geometry={previewEdgesGeom} renderOrder={341}>
              <lineBasicMaterial
                color="#fde047"
                transparent
                opacity={isDraggingDepth ? 0.8 : 0.4}
                depthTest={false}
              />
            </lineSegments>
          )}
        </group>
      )}

      {/* ────────────────────────────────────────────────────────
          1. 实时孔腔中心轴线（从孔口贯穿至底孔终点及延伸导引线）
          ──────────────────────────────────────────────────────── */}
      {/* 孔深轴原点采用恒定屏幕尺寸，避免缩放后消失在孔口边线中。 */}
      <GizmoVisualLayer priority={11000}>
      <group ref={mouthOriginGroupRef} renderOrder={362}>
        <mesh geometry={MOUTH_ORIGIN_BACK_GEOM} raycast={() => null}>
          <meshBasicMaterial color="#0f172a" depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh geometry={MOUTH_ORIGIN_RING_GEOM} position={[0, 0, 0.002]} raycast={() => null}>
          <meshBasicMaterial color="#f8fafc" depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh geometry={MOUTH_ORIGIN_CORE_GEOM} position={[0, 0, 0.004]} raycast={() => null}>
          <meshBasicMaterial color="#fbbf24" depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* 贯穿孔腔全长中心轴线（统一工程黄色） */}
      <lineSegments geometry={axisLineGeom} renderOrder={360}>
        <lineBasicMaterial
          color={isSnapped ? '#10b981' : isDepthActive ? '#fde047' : '#f59e0b'}
          linewidth={2.5}
          depthTest={false}
          transparent
          opacity={0.95}
        />
      </lineSegments>

      {/* 孔底引出虚导引线 */}
      <lineSegments geometry={axisExtGeom} renderOrder={360}>
        <lineBasicMaterial
          color="#94a3b8"
          depthTest={false}
          transparent
          opacity={0.5}
        />
      </lineSegments>

      {/* ────────────────────────────────────────────────────────
          2. 孔底单一深度推拉手柄（强制 useFrame 恒定 100% 正对用户屏幕）
          ──────────────────────────────────────────────────────── */}
      <group ref={depthKnobGroupRef} renderOrder={355}>
        <group
          onPointerOver={(e) => {
            e.stopPropagation()
            setIsHovered(true)
          }}
          onPointerOut={() => setIsHovered(false)}
          onPointerDown={handlePointerDown}
        >
          {/* 拾取层 */}
          <mesh geometry={KNOB_HIT_GEOM}>
            <meshBasicMaterial transparent opacity={0} depthTest={false} side={THREE.DoubleSide} />
          </mesh>

          {/* 激活/悬停光晕 */}
          {isDepthActive && (
            <mesh geometry={KNOB_HALO_GEOM} position={[0, 0, -0.005]}>
              <meshBasicMaterial
                color={isSnapped ? '#10b981' : '#fbbf24'}
                side={THREE.DoubleSide}
                depthTest={false}
                transparent
                opacity={0.5}
              />
            </mesh>
          )}

          {/* 圆形手柄实体内核（统一工程黄色） */}
          <mesh geometry={KNOB_CONTRAST_GEOM} position={[0, 0, -0.003]}>
            <meshBasicMaterial color="#0f172a" side={THREE.DoubleSide} depthTest={false} />
          </mesh>
          <mesh geometry={KNOB_CORE_GEOM}>
            <meshBasicMaterial
              color={isSnapped ? '#10b981' : isDepthActive ? '#fde047' : '#f59e0b'}
              side={THREE.DoubleSide}
              depthTest={false}
            />
          </mesh>

          {/* 白金外框 */}
          <mesh geometry={KNOB_RING_GEOM}>
            <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} depthTest={false} />
          </mesh>

          {/* 深度读数徽标与右上角斜孔面板唤醒按钮 */}
          <Html position={[18, 0, 0]} style={{ pointerEvents: isDraggingDepth ? 'none' : 'auto' }}>
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              data-html-gizmo="true"
              className={isDraggingDepth ? 'pointer-events-none font-mono text-[11px] text-amber-300 whitespace-nowrap select-none ml-6 -translate-y-1/2' : `flex items-center gap-1.5 px-2 py-0.5 rounded-[2px] font-mono text-[10px] tracking-tight border shadow-md whitespace-nowrap select-none -translate-y-1/2 ml-1.5 ${
                isSnapped
                  ? 'bg-emerald-950/95 text-emerald-300 border-emerald-400'
                  : 'bg-slate-900/95 text-slate-100 border-slate-700'
              }`}
            >
              {!isDraggingDepth && <span className={`font-bold ${isSnapped ? 'text-emerald-400' : 'text-amber-400'}`}>
                {_t("底孔深")}
              </span>}
              {!isDraggingDepth && <span className="w-[1px] h-2.5 bg-slate-700" />}
              <span className="font-semibold">
                {`${currentBottomDepth.toFixed(2)} mm`}
              </span>

              {/* 唤起右上角斜孔精细化调节 Popover 按钮 */}
              {!isDraggingDepth && <button
                type="button"
                data-html-gizmo="true"
                title={_t("在右上角展开斜孔精细化调整面板 (倾角与方位角)")}
                className={`ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold transition-all border cursor-pointer active:scale-95 ${
                  isInclinedPopoverOpen
                    ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-xs'
                    : hasTilt
                      ? 'bg-amber-500/30 text-amber-300 hover:bg-amber-500 hover:text-slate-950 border-amber-500/50'
                      : 'bg-slate-800/90 text-slate-300 hover:bg-amber-500 hover:text-slate-950 hover:border-amber-400 border-slate-700'
                }`}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenInclinedPopover?.()
                }}
              >
                {hasTilt ? _msg`⤹ 斜孔 ${normTilt.toFixed(1)}°` : _t("⤹ 斜孔")}
              </button>}
            </div>
          </Html>
        </group>
      </group>
      </GizmoVisualLayer>
    </group>
  )
}
