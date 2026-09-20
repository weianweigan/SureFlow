import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useMemo, useRef, useState, useEffect, type FC } from 'react'
import * as THREE from 'three'
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useDesignStore } from '../../model/designStore'
import { getBoxFaceBasis } from '@shared/design/faceMath'
import { computeScreenPixelScale, snapValue } from './gizmoMath'

interface BlockDimensionGizmoProps {
  projectId: string
  dimensions: [number, number, number]
  selectedFaceId?: string | null
}

// ─────────────────────────────────────────────────────────────
// 工程黄色推拉手柄几何体（线与圆点规范）
// ─────────────────────────────────────────────────────────────
const KNOB_HIT_GEOM = new THREE.CircleGeometry(14, 24)
const KNOB_CORE_GEOM = new THREE.CircleGeometry(4.8, 32)
const KNOB_RING_GEOM = new THREE.RingGeometry(4.2, 5.6, 32)
const KNOB_HALO_GEOM = new THREE.RingGeometry(5.2, 9.2, 32)

/**
 * G-04 · 基体尺寸推拉手柄与三向驱动尺寸 (BlockDimensionGizmo)
 * 严格对齐用户最新要求与 PRD 规范：
 * 1. 使用线和圆点的推拉手柄调整基体大小（工程黄直线 + 黄白双环圆点，100% 正对用户）；
 * 2. 在线上直接显示当前尺寸矩形徽标，推拉时 60 FPS 实时更新，支持双击就地内联修改；
 * 3. 彻底去掉硬性物理阻尼锁死特性，去掉内部孔腔干涉硬阻尼保护，允许自由向内向外扩展缩减；
 * 4. 默认 1.0mm 网格吸附，按住 Shift 临时解除吸附。
 */
export const BlockDimensionGizmo: FC<BlockDimensionGizmoProps> = ({
  projectId,
  dimensions,
  selectedFaceId
}) => {
  _useLocale()
  const [sx, sy, sz] = dimensions
  const { camera, gl } = useThree()
  const controls = useThree((s) => (s as any).controls)
  const setBaseDimensions = useDesignStore((s) => s.setBaseDimensions)
  const setBaseExtraParams = useDesignStore((s) => s.setBaseExtraParams)
  const extrudeFace = useDesignStore((s) => s.extrudeFace)
  const session = useDesignStore((s) => s.projects[projectId])
  const baseBody = session?.doc?.baseBody
  const selected = session?.selected

  // ─── 1. 三向驱动尺寸内联编辑状态 ───
  const [editingAxis, setEditingAxis] = useState<'x' | 'y' | 'z' | null>(null)
  const [inputValue, setInputValue] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingAxis && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingAxis])

  // 计算当前选中面的真实几何中心与法向（精准适配长方体、L型、T型、十字型所有表面）
  const faceInfo = useMemo(() => {
    if (!selectedFaceId) return null
    const foundFace = baseBody?.faces?.find((f) => f.id === selectedFaceId)
    const basis = getBoxFaceBasis(selectedFaceId, dimensions, baseBody)
    const center = foundFace?.centerPoint
      ? new THREE.Vector3(...foundFace.centerPoint)
      : new THREE.Vector3(...basis.origin)
    const normal = foundFace?.normal
      ? new THREE.Vector3(...foundFace.normal)
      : new THREE.Vector3(...basis.w)
    const binding = foundFace?.paramBinding

    let axis: 'x' | 'y' | 'z' = 'x'
    if (Math.abs(normal.z) > 0.8) axis = 'z'
    else if (Math.abs(normal.y) > 0.8) axis = 'y'
    else axis = 'x'

    let sign = 1
    if (binding) {
      sign = binding.sign
    } else {
      if (axis === 'z') sign = normal.z >= 0 ? 1 : -1
      else if (axis === 'y') sign = normal.y >= 0 ? 1 : -1
      else sign = normal.x >= 0 ? 1 : -1
    }

    return { center, normal, axis, sign, basis, binding, foundFace }
  }, [selectedFaceId, dimensions, baseBody])

  const initialDim = useMemo(() => {
    if (!faceInfo) return 0
    if (faceInfo.binding) {
      if (faceInfo.binding.param === 'extraParams') {
        const extra = baseBody?.extraParams || {}
        return extra[faceInfo.binding.key] ?? (faceInfo.binding.key === 'cutX' ? Math.round(sx * 0.25) : Math.round(sz * 0.25))
      }
      if (faceInfo.binding.param === 'dimensions') {
        if (faceInfo.binding.key === 'sx') return sx
        if (faceInfo.binding.key === 'sy') return sy
        if (faceInfo.binding.key === 'sz') return sz
      }
    }
    return faceInfo.axis === 'x' ? sx : faceInfo.axis === 'y' ? sy : sz
  }, [faceInfo, baseBody?.extraParams, sx, sy, sz])

  const axisLabel = useMemo(() => {
    if (!faceInfo) return ''
    if (faceInfo.binding) {
      if (faceInfo.binding.key === 'cutX') return _t('凹槽宽 (cutX)')
      if (faceInfo.binding.key === 'cutZ') return _t('凹槽高 (cutZ)')
      if (faceInfo.binding.key === 'sx') return _t('长 X')
      if (faceInfo.binding.key === 'sy') return _t('宽 Y')
      if (faceInfo.binding.key === 'sz') return _t('高 Z')
    }
    return faceInfo.axis === 'x' ? _t('长 X') : faceInfo.axis === 'y' ? _t('宽 Y') : _t('高 Z')
  }, [faceInfo])

  const handleStartEdit = (axis: 'x' | 'y' | 'z', currentVal: number) => {
    setEditingAxis(axis)
    setInputValue(String(Math.round(currentVal * 10) / 10))
  }

  const handleCommitEdit = (axis: 'x' | 'y' | 'z') => {
    const num = parseFloat(inputValue)
    if (!isNaN(num) && num > 0) {
      const clamped = Math.max(5, num)
      if (faceInfo?.binding) {
        if (faceInfo.binding.param === 'extraParams') {
          setBaseExtraParams(projectId, { [faceInfo.binding.key]: clamped })
        } else if (faceInfo.binding.param === 'dimensions') {
          if (faceInfo.binding.key === 'sx') setBaseDimensions(projectId, [clamped, sy, sz])
          else if (faceInfo.binding.key === 'sy') setBaseDimensions(projectId, [sx, clamped, sz])
          else if (faceInfo.binding.key === 'sz') setBaseDimensions(projectId, [sx, sy, clamped])
        }
      } else {
        if (axis === 'x') {
          setBaseDimensions(projectId, [clamped, sy, sz])
        } else if (axis === 'y') {
          setBaseDimensions(projectId, [sx, clamped, sz])
        } else if (axis === 'z') {
          setBaseDimensions(projectId, [sx, sy, clamped])
        }
      }
    }
    setEditingAxis(null)
  }

  // ─── 2. 推拉手柄交互状态 ───
  const [isDragging, setIsDragging] = useState(false)
  const [dragHovered, setDragHovered] = useState(false)
  const [isHandleClicked, setIsHandleClicked] = useState(false)
  const [previewDim, setPreviewDim] = useState<number | null>(null)
  const lastDeltaRef = useRef<number>(0)

  // 默认不显示文字，切换选中面时重置为不显示
  useEffect(() => {
    setIsHandleClicked(false)
  }, [selectedFaceId])

  const dragStartRef = useRef<{
    startPoint: THREE.Vector3
    startDim: number
    axis: 'x' | 'y' | 'z'
    sign: number
  }>({
    startPoint: new THREE.Vector3(),
    startDim: 0,
    axis: 'x',
    sign: 1
  })

  const knobGroupRef = useRef<THREE.Group>(null)
  const lineMeshRef = useRef<THREE.LineSegments>(null)
  const dimensionBadgeRef = useRef<THREE.Group>(null)

  // 推拉拖拽事件处理：使用 window 指针捕获并锁定相机，杜绝移动脱焦
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!faceInfo) return
    e.stopPropagation()

    if (controls) {
      controls.enabled = false
    }

    dragStartRef.current = {
      startPoint: e.point.clone(),
      startDim: initialDim,
      axis: faceInfo.axis,
      sign: faceInfo.sign
    }
    lastDeltaRef.current = 0

    setIsDragging(true)
    setIsHandleClicked(true)
    setPreviewDim(initialDim)

    const raycaster = new THREE.Raycaster()
    // 构建垂直于视线方向且经过当前面中心的虚拟投影平面
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()).negate(),
      faceInfo.center
    )

    const onWinPointerMove = (winEvt: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const ndcX = ((winEvt.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -(((winEvt.clientY - rect.top) / rect.height) * 2 - 1)
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)

      const intersectPt = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(dragPlane, intersectPt)) return

      const { startPoint, startDim, sign } = dragStartRef.current
      const deltaVec = intersectPt.sub(startPoint)
      // 沿外法向投影：外拉为正，内推为负
      const projDelta = deltaVec.dot(faceInfo.normal)

      // 默认 1.0mm 步进吸附，按住 Shift 解除
      const rawDelta = snapValue(projDelta, 1.0, winEvt.shiftKey)
      lastDeltaRef.current = rawDelta
      const newDim = Math.max(5, startDim + rawDelta * sign)
      setPreviewDim(newDim)
    }

    const onWinPointerUp = () => {
      window.removeEventListener('pointermove', onWinPointerMove)
      window.removeEventListener('pointerup', onWinPointerUp)
      if (controls) {
        controls.enabled = true
      }
      setIsDragging(false)
      gl.domElement.style.cursor = 'auto'

      if (selectedFaceId && lastDeltaRef.current !== 0) {
        extrudeFace(projectId, selectedFaceId, lastDeltaRef.current, true)
      }
      setPreviewDim(null)
      lastDeltaRef.current = 0
    }

    window.addEventListener('pointermove', onWinPointerMove)
    window.addEventListener('pointerup', onWinPointerUp)
  }

  // 组件卸载时恢复相机
  useEffect(() => {
    return () => {
      if (controls) controls.enabled = true
    }
  }, [controls])

  // 动态恒定像素缩放与跟随推拉手柄变动位置
  useFrame(() => {
    if (!faceInfo || baseBody?.type === 'step') return

    const delta = previewDim !== null ? (previewDim - initialDim) * faceInfo.sign : 0
    const curCenter = faceInfo.center.clone().addScaledVector(faceInfo.normal, delta)

    const s = computeScreenPixelScale(camera, curCenter, 1.0, 1.0)
    const lineLen = 50 * s
    const knobPos = curCenter.clone().addScaledVector(faceInfo.normal, lineLen)

    // 1. 圆点手柄跟随基体大小变动位置，始终 100% 正对相机
    if (knobGroupRef.current) {
      knobGroupRef.current.position.copy(knobPos)
      knobGroupRef.current.scale.set(s, s, s)
      knobGroupRef.current.quaternion.copy(camera.quaternion)
    }

    // 2. 尺寸徽标在线的中间偏侧边呈现，跟随手柄与尺寸动态变动位置
    if (dimensionBadgeRef.current) {
      const midPos = curCenter.clone().addScaledVector(faceInfo.normal, lineLen * 0.5)
      dimensionBadgeRef.current.position.copy(midPos)
    }

    // 3. 法向直线跟随基体表面实时重绘
    if (lineMeshRef.current) {
      const posAttr = lineMeshRef.current.geometry.attributes.position as THREE.BufferAttribute
      if (posAttr) {
        posAttr.setXYZ(0, curCenter.x, curCenter.y, curCenter.z)
        posAttr.setXYZ(1, knobPos.x, knobPos.y, knobPos.z)
        posAttr.needsUpdate = true
      }
    }
  })

  const isBaseSelected = selected?.type === 'base'
  const currentDim = previewDim !== null ? previewDim : initialDim


  // 默认不显示文字，只有在点击或拖拉手柄后才显示尺寸文字
  const shouldShowBadge = isHandleClicked || isDragging || editingAxis !== null

  // ─── 基体外尺寸线参数与几何点（与 CadDimensionLines 严格对齐） ───
  const extOffset = 14
  const overshoot = 18
  const tickLen = 2.0
  const tick = tickLen * 0.7

  // X 尺寸线 (长: sx，位于 -Y 侧，端部 45° CAD 机械倒角刻度线与尺寸界线)
  const xGeom = useMemo(() => {
    const pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -overshoot, 0),
      new THREE.Vector3(sx, 0, 0),
      new THREE.Vector3(sx, -overshoot, 0),
      new THREE.Vector3(0, -extOffset, 0),
      new THREE.Vector3(sx, -extOffset, 0),
      new THREE.Vector3(-tick, -extOffset - tick, 0),
      new THREE.Vector3(tick, -extOffset + tick, 0),
      new THREE.Vector3(sx - tick, -extOffset - tick, 0),
      new THREE.Vector3(sx + tick, -extOffset + tick, 0)
    ]
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [sx, extOffset, overshoot, tick])

  // Y 尺寸线 (宽: sy，位于 -X 侧，端部 45° CAD 机械倒角刻度线与尺寸界线)
  const yGeom = useMemo(() => {
    const pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-overshoot, 0, 0),
      new THREE.Vector3(0, sy, 0),
      new THREE.Vector3(-overshoot, sy, 0),
      new THREE.Vector3(-extOffset, 0, 0),
      new THREE.Vector3(-extOffset, sy, 0),
      new THREE.Vector3(-extOffset - tick, -tick, 0),
      new THREE.Vector3(-extOffset + tick, tick, 0),
      new THREE.Vector3(-extOffset - tick, sy - tick, 0),
      new THREE.Vector3(-extOffset + tick, sy + tick, 0)
    ]
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [sy, extOffset, overshoot, tick])

  // Z 尺寸线 (高: sz，位于 +X 侧，端部 45° CAD 机械倒角刻度线与尺寸界线)
  const zGeom = useMemo(() => {
    const pts = [
      new THREE.Vector3(sx, 0, 0),
      new THREE.Vector3(sx + overshoot, 0, 0),
      new THREE.Vector3(sx, 0, sz),
      new THREE.Vector3(sx + overshoot, 0, sz),
      new THREE.Vector3(sx + extOffset, 0, 0),
      new THREE.Vector3(sx + extOffset, 0, sz),
      new THREE.Vector3(sx + extOffset - tick, 0, -tick),
      new THREE.Vector3(sx + extOffset + tick, 0, tick),
      new THREE.Vector3(sx + extOffset - tick, 0, sz - tick),
      new THREE.Vector3(sx + extOffset + tick, 0, sz + tick)
    ]
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [sx, sz, extOffset, overshoot, tick])

  const dispX = Math.round(sx * 10) / 10
  const dispY = Math.round(sy * 10) / 10
  const dispZ = Math.round(sz * 10) / 10

  const baseLineColor = isDragging ? '#00EBFF' : '#475569'

  const getBadgeContainerClass = (axis: 'x' | 'y' | 'z') => {
    if (isDragging) {
      return 'bg-slate-900/95 text-cyan-300 border-cyan-400 shadow-[0_0_10px_rgba(0,235,255,0.35)]'
    }
    const hoverBorder =
      axis === 'x'
        ? 'hover:border-sky-400'
        : axis === 'y'
          ? 'hover:border-emerald-400'
          : 'hover:border-amber-400'
    return `bg-slate-900/95 text-slate-100 border-slate-700 ${hoverBorder} shadow-md hover:bg-slate-850`
  }

  if (!session || baseBody?.type === 'step') {
    return null
  }

  return (
    <group renderOrder={310}>
      {/* ── 1. 选中基体时的三向 3D 驱动尺寸线与数值徽标（严格对齐 CadDimensionLines 规范） ── */}
      {isBaseSelected && (
        <group renderOrder={250}>
          {/* X 轴驱动尺寸线与 45° 倒角刻度 */}
          <lineSegments geometry={xGeom}>
            <lineBasicMaterial
              color={baseLineColor}
              depthTest={false}
              transparent
              opacity={isDragging ? 0.95 : 0.75}
            />
          </lineSegments>

          {/* Y 轴驱动尺寸线与 45° 倒角刻度 */}
          <lineSegments geometry={yGeom}>
            <lineBasicMaterial
              color={baseLineColor}
              depthTest={false}
              transparent
              opacity={isDragging ? 0.95 : 0.75}
            />
          </lineSegments>

          {/* Z 轴驱动尺寸线与 45° 倒角刻度 */}
          <lineSegments geometry={zGeom}>
            <lineBasicMaterial
              color={baseLineColor}
              depthTest={false}
              transparent
              opacity={isDragging ? 0.95 : 0.75}
            />
          </lineSegments>

          {/* X 尺寸徽标（深色高对比度背景、名称数值分割线、双击就地内联修改驱动基体长） */}
          <Html position={[sx / 2, -extOffset, 0.05]} center style={{ pointerEvents: 'auto' }}>
            {editingAxis === 'x' ? (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1.5 bg-slate-900 border border-sky-400 rounded-[2px] px-1.5 py-0.5 shadow-xl select-none"
              >
                <span className="font-mono text-[10px] font-bold text-sky-400">X</span>
                <span className="w-[1px] h-2.5 bg-slate-700" />
                <input
                  ref={inputRef}
                  type="text"
                  className="w-12 bg-slate-800 text-white font-mono text-[10px] px-1 py-0.5 rounded-[2px] border-0 outline-none text-center font-bold"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCommitEdit('x')
                    if (e.key === 'Escape') setEditingAxis(null)
                  }}
                  onBlur={() => handleCommitEdit('x')}
                />
                <span className="font-mono text-[10px] text-slate-400">mm</span>
              </div>
            ) : (
              <div
                title={_t("双击就地修改长度 (X)")}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  handleStartEdit('x', sx)
                }}
                className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-[2px] font-mono text-[10px] tracking-tight border select-none transition-all whitespace-nowrap cursor-pointer hover:scale-105 ${getBadgeContainerClass('x')}`}
              >
                <span className="font-bold text-sky-400">X</span>
                <span className="w-[1px] h-2.5 bg-slate-700" />
                <span className="font-semibold text-slate-100">{dispX} mm</span>
              </div>
            )}
          </Html>

          {/* Y 尺寸徽标（深色高对比度背景、名称数值分割线、双击就地内联修改驱动基体宽） */}
          <Html position={[-extOffset, sy / 2, 0.05]} center style={{ pointerEvents: 'auto' }}>
            {editingAxis === 'y' ? (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1.5 bg-slate-900 border border-emerald-400 rounded-[2px] px-1.5 py-0.5 shadow-xl select-none"
              >
                <span className="font-mono text-[10px] font-bold text-emerald-400">Y</span>
                <span className="w-[1px] h-2.5 bg-slate-700" />
                <input
                  ref={inputRef}
                  type="text"
                  className="w-12 bg-slate-800 text-white font-mono text-[10px] px-1 py-0.5 rounded-[2px] border-0 outline-none text-center font-bold"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCommitEdit('y')
                    if (e.key === 'Escape') setEditingAxis(null)
                  }}
                  onBlur={() => handleCommitEdit('y')}
                />
                <span className="font-mono text-[10px] text-slate-400">mm</span>
              </div>
            ) : (
              <div
                title={_t("双击就地修改宽度 (Y)")}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  handleStartEdit('y', sy)
                }}
                className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-[2px] font-mono text-[10px] tracking-tight border select-none transition-all whitespace-nowrap cursor-pointer hover:scale-105 ${getBadgeContainerClass('y')}`}
              >
                <span className="font-bold text-emerald-400">Y</span>
                <span className="w-[1px] h-2.5 bg-slate-700" />
                <span className="font-semibold text-slate-100">{dispY} mm</span>
              </div>
            )}
          </Html>

          {/* Z 尺寸徽标（深色高对比度背景、名称数值分割线、双击就地内联修改驱动基体高） */}
          <Html position={[sx + extOffset, 0, sz / 2]} center style={{ pointerEvents: 'auto' }}>
            {editingAxis === 'z' ? (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1.5 bg-slate-900 border border-amber-400 rounded-[2px] px-1.5 py-0.5 shadow-xl select-none"
              >
                <span className="font-mono text-[10px] font-bold text-amber-400">Z</span>
                <span className="w-[1px] h-2.5 bg-slate-700" />
                <input
                  ref={inputRef}
                  type="text"
                  className="w-12 bg-slate-800 text-white font-mono text-[10px] px-1 py-0.5 rounded-[2px] border-0 outline-none text-center font-bold"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCommitEdit('z')
                    if (e.key === 'Escape') setEditingAxis(null)
                  }}
                  onBlur={() => handleCommitEdit('z')}
                />
                <span className="font-mono text-[10px] text-slate-400">mm</span>
              </div>
            ) : (
              <div
                title={_t("双击就地修改高度 (Z)")}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  handleStartEdit('z', sz)
                }}
                className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-[2px] font-mono text-[10px] tracking-tight border select-none transition-all whitespace-nowrap cursor-pointer hover:scale-105 ${getBadgeContainerClass('z')}`}
              >
                <span className="font-bold text-amber-400">Z</span>
                <span className="w-[1px] h-2.5 bg-slate-700" />
                <span className="font-semibold text-slate-100">{dispZ} mm</span>
              </div>
            )}
          </Html>
        </group>
      )}


      {/* ── 2. 选中面时的工程黄色线与圆点推拉手柄与线上尺寸显示 (G-04) ── */}
      {faceInfo && (
        <group renderOrder={350}>
          {/* 法向推拉高对比黄色直线 */}
          <lineSegments ref={lineMeshRef} renderOrder={351}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array(6), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial
              color={isDragging ? '#fde047' : '#fbbf24'}
              linewidth={2.5}
              depthTest={false}
            />
          </lineSegments>

          {/* 直线末端黄色圆形推拉手柄（Billboard 100% 正对相机） */}
          <group ref={knobGroupRef} renderOrder={355}>
            <group
              onPointerOver={(e) => {
                e.stopPropagation()
                setDragHovered(true)
                gl.domElement.style.cursor = 'grab'
              }}
              onPointerOut={() => {
                setDragHovered(false)
                gl.domElement.style.cursor = 'auto'
              }}
              onPointerDown={handlePointerDown}
              onClick={(e) => {
                e.stopPropagation()
                setIsHandleClicked(true)
              }}
            >
              {/* 拾取层 */}
              <mesh geometry={KNOB_HIT_GEOM}>
                <meshBasicMaterial transparent opacity={0} depthTest={false} side={THREE.DoubleSide} />
              </mesh>

              {/* 激活/悬停光晕 */}
              {(dragHovered || isDragging) && (
                <mesh geometry={KNOB_HALO_GEOM} position={[0, 0, -0.005]}>
                  <meshBasicMaterial
                    color="#fbbf24"
                    side={THREE.DoubleSide}
                    depthTest={false}
                    transparent
                    opacity={0.5}
                  />
                </mesh>
              )}

              {/* 圆形手柄实体内核（统一工程黄色） */}
              <mesh geometry={KNOB_CORE_GEOM}>
                <meshBasicMaterial
                  color={isDragging ? '#fde047' : '#f59e0b'}
                  side={THREE.DoubleSide}
                  depthTest={false}
                />
              </mesh>

              {/* 白金外框 */}
              <mesh geometry={KNOB_RING_GEOM}>
                <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} depthTest={false} />
              </mesh>
            </group>
          </group>

          {/* 直线上浮动显示的当前尺寸徽标（默认不显示，仅在点击/拖拉手柄后显示，支持双击就地编辑） */}
          {shouldShowBadge && (
            <group ref={dimensionBadgeRef} renderOrder={360}>
              <Html position={[14, 0, 0]} style={{ pointerEvents: 'auto' }}>
                {editingAxis === faceInfo.axis ? (
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 bg-slate-900 border border-amber-400 rounded-[2px] px-1.5 py-0.5 shadow-xl -translate-y-1/2 select-none"
                  >
                    <span className="font-mono text-[10px] font-bold text-amber-400">{axisLabel}</span>
                    <span className="w-[1px] h-2.5 bg-slate-700" />
                    <input
                      ref={inputRef}
                      type="text"
                      className="w-12 bg-slate-800 text-white font-mono text-[10px] px-1 py-0.5 rounded-[2px] border-0 outline-none text-center font-bold"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCommitEdit(faceInfo.axis)
                        if (e.key === 'Escape') setEditingAxis(null)
                      }}
                      onBlur={() => handleCommitEdit(faceInfo.axis)}
                    />
                    <span className="font-mono text-[10px] text-slate-400">mm</span>
                  </div>
                ) : (
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      handleStartEdit(faceInfo.axis, currentDim)
                    }}
                    title={_t("双击直接键入数值修改尺寸")}
                    data-html-gizmo="true"
                    className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-[2px] font-mono text-[10px] tracking-tight border select-none transition-all whitespace-nowrap cursor-pointer hover:scale-105 -translate-y-1/2 ${
                      isDragging
                        ? 'bg-slate-900/95 text-cyan-300 border-cyan-400 shadow-[0_0_10px_rgba(0,235,255,0.35)]'
                        : 'bg-slate-900/95 text-slate-100 border-slate-700 hover:border-amber-400 shadow-md hover:bg-slate-850'
                    }`}
                  >
                    <span className="text-amber-400 font-bold">{axisLabel}</span>
                    <span className="w-[1px] h-2.5 bg-slate-700" />
                    <span className="font-semibold text-slate-100">{currentDim.toFixed(1)} mm</span>
                  </div>
                )}
              </Html>
            </group>
          )}
        </group>
      )}
    </group>
  )
}
