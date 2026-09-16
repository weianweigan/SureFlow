import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import * as THREE from 'three'
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useDesignStore } from '../../model/designStore'
import { computeScreenPixelScale, snapValue } from './gizmoMath'

interface SectionPlaneGizmoProps {
  projectId: string
  dimensions: [number, number, number]
}

/**
 * G-14 · 3D 剖切平面推拉与翻转操纵器 (SectionPlaneGizmo)
 * 严格对齐 PRD 规范：
 * 1. 剖切截面高亮轮廓框线（#38bdf8）；
 * 2. 截面中心法向推拉长箭头（恒定屏幕 ~70px 视觉大小，#eab308 / #00EBFF）；
 * 3. 默认 1.0mm 网格吸附推拉，按住 Shift 解除吸附，支持键盘方向键 1.0mm 微调；
 * 4. 箭头基座微型翻转环（Flip Normal Handle），一键 180° 反向对调截面；
 * 5. 实时偏移徽标（如「偏移: +15.0 mm」），与顶部剖切工具栏完全双向实时联动。
 */
export const SectionPlaneGizmo: FC<SectionPlaneGizmoProps> = ({ projectId, dimensions }) => {
  _useLocale()
  const [sx, sy, sz] = dimensions
  const { camera } = useThree()
  const session = useDesignStore((s) => s.projects[projectId])
  const setSectionConfig = useDesignStore((s) => s.setSectionConfig)

  const sectionConfig = session?.sectionConfig
  const isEnabled = sectionConfig?.enabled ?? false
  const axis = sectionConfig?.axis ?? 'x'
  const offset = sectionConfig?.offset ?? 0
  const flipped = sectionConfig?.flipped ?? false

  const [isDragging, setIsDragging] = useState(false)
  const [isArrowHovered, setIsArrowHovered] = useState(false)
  const [isFlipHovered, setIsFlipHovered] = useState(false)
  const [tempOffset, setTempOffset] = useState<number | null>(null)

  const dragStartRef = useRef<{
    startPoint: THREE.Vector3
    startOffset: number
    normal: THREE.Vector3
  }>({
    startPoint: new THREE.Vector3(),
    startOffset: 0,
    normal: new THREE.Vector3()
  })

  const arrowGroupRef = useRef<THREE.Group>(null)

  // 计算当前剖切面法向、截面中心坐标与闭合边界轮廓点
  const planeData = useMemo(() => {
    if (!isEnabled) return null

    const normal = new THREE.Vector3()
    const center = new THREE.Vector3(sx / 2, sy / 2, sz / 2)
    const currentOff = tempOffset !== null ? tempOffset : offset
    const borderPoints: THREE.Vector3[] = []

    if (axis === 'x') {
      const planeX = Math.max(0, Math.min(sx, sx / 2 + currentOff))
      center.x = planeX
      normal.set(flipped ? 1 : -1, 0, 0)
      borderPoints.push(
        new THREE.Vector3(planeX, 0, 0),
        new THREE.Vector3(planeX, sy, 0),
        new THREE.Vector3(planeX, sy, sz),
        new THREE.Vector3(planeX, 0, sz),
        new THREE.Vector3(planeX, 0, 0)
      )
    } else if (axis === 'y') {
      const planeY = Math.max(0, Math.min(sy, sy / 2 + currentOff))
      center.y = planeY
      normal.set(0, flipped ? 1 : -1, 0)
      borderPoints.push(
        new THREE.Vector3(0, planeY, 0),
        new THREE.Vector3(sx, planeY, 0),
        new THREE.Vector3(sx, planeY, sz),
        new THREE.Vector3(0, planeY, sz),
        new THREE.Vector3(0, planeY, 0)
      )
    } else if (axis === 'z') {
      const planeZ = Math.max(0, Math.min(sz, sz / 2 + currentOff))
      center.z = planeZ
      normal.set(0, 0, flipped ? 1 : -1)
      borderPoints.push(
        new THREE.Vector3(0, 0, planeZ),
        new THREE.Vector3(sx, 0, planeZ),
        new THREE.Vector3(sx, sy, planeZ),
        new THREE.Vector3(0, sy, planeZ),
        new THREE.Vector3(0, 0, planeZ)
      )
    }

    const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPoints)
    return { normal, center, borderGeom }
  }, [isEnabled, axis, offset, tempOffset, flipped, sx, sy, sz])

  // 恒定屏幕像素缩放箭头 (~70px)
  useFrame(() => {
    if (arrowGroupRef.current && planeData) {
      const s = computeScreenPixelScale(camera, planeData.center, 1.0, 1.0)
      arrowGroupRef.current.scale.set(s, s, s)
      arrowGroupRef.current.position.copy(planeData.center)
    }
  })

  // 键盘方向键微调（聚焦剖切手柄时，左/下减 1mm，右/上加 1mm）
  useEffect(() => {
    if (!isEnabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault()
        const step = e.altKey ? 0.1 : 1.0
        const newOff = Math.round((offset - step) * 10) / 10
        setSectionConfig(projectId, { offset: newOff })
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.altKey ? 0.1 : 1.0
        const newOff = Math.round((offset + step) * 10) / 10
        setSectionConfig(projectId, { offset: newOff })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEnabled, offset, projectId, setSectionConfig])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!planeData) return
    e.stopPropagation()
    ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)

    dragStartRef.current = {
      startPoint: e.point.clone(),
      startOffset: offset,
      normal: planeData.normal.clone()
    }
    setIsDragging(true)
    setTempOffset(offset)
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging || !planeData) return
    e.stopPropagation()

    const { startPoint, startOffset, normal } = dragStartRef.current
    const deltaVec = e.point.clone().sub(startPoint)
    const proj = deltaVec.dot(normal)

    // 默认 1.0mm 吸附，按住 Shift 解除
    const delta = snapValue(proj, 1.0, e.shiftKey)
    const rawNewOffset = startOffset + (flipped ? delta : -delta)

    const maxSpan = (axis === 'x' ? sx : axis === 'y' ? sy : sz) / 2
    const clampedOffset = Math.max(-maxSpan + 1, Math.min(maxSpan - 1, rawNewOffset))

    setTempOffset(clampedOffset)
    // 实时同步触发剖切切面更新
    setSectionConfig(projectId, { offset: clampedOffset })
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging) return
    e.stopPropagation()
    ;(e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId)
    setIsDragging(false)
    setTempOffset(null)
  }

  // 点击翻转截面法向
  const handleFlipClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    setSectionConfig(projectId, { flipped: !flipped })
  }

  if (!isEnabled || !planeData) return null

  const arrowQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    planeData.normal
  )

  const displayOffset = tempOffset !== null ? tempOffset : offset
  const arrowColor = isArrowHovered || isDragging ? '#00EBFF' : '#eab308'

  return (
    <group renderOrder={350}>
      {/* 截面轮廓边界框线 */}
      <lineSegments geometry={planeData.borderGeom} renderOrder={210}>
        <lineBasicMaterial
          color="#38bdf8"
          linewidth={2}
          transparent
          opacity={0.9}
          depthTest={false}
        />
      </lineSegments>

      {/* 中心法向推拉手柄群（恒定屏幕比例） */}
      <group
        ref={arrowGroupRef}
        position={planeData.center}
        quaternion={arrowQuat}
      >
        {/* 基座双向翻转按钮圆环 */}
        <mesh
          position={[0, 2, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          onClick={handleFlipClick}
          onPointerOver={() => setIsFlipHovered(true)}
          onPointerOut={() => setIsFlipHovered(false)}
        >
          <torusGeometry args={[8, 1.6, 16, 32]} />
          <meshBasicMaterial
            color={isFlipHovered ? '#00EBFF' : '#94a3b8'}
            depthTest={false}
          />
        </mesh>

        {/* 法向箭头杆体 */}
        <mesh
          position={[0, 19, 0]}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerOver={() => setIsArrowHovered(true)}
          onPointerOut={() => setIsArrowHovered(false)}
        >
          <cylinderGeometry args={[2.0, 2.0, 30, 16]} />
          <meshBasicMaterial color={arrowColor} depthTest={false} />
        </mesh>

        {/* 法向箭头端部圆锥 */}
        <mesh
          position={[0, 41.5, 0]}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerOver={() => setIsArrowHovered(true)}
          onPointerOut={() => setIsArrowHovered(false)}
        >
          <coneGeometry args={[6.0, 15, 20]} />
          <meshBasicMaterial color={arrowColor} depthTest={false} />
        </mesh>
      </group>

      {/* 实时偏移徽标胶囊与翻转提示 */}
      <Html position={planeData.center} center>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '2px 8px',
            borderRadius: '12px',
            background: 'rgba(15, 23, 42, 0.9)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            userSelect: 'none',
            whiteSpace: 'nowrap'
          }}
        >
          <span
            style={{
              color: '#38bdf8',
              fontFamily: 'monospace',
              fontSize: '11px',
              fontWeight: 600
            }}
          >
            {_t("偏移:")}{displayOffset >= 0 ? `+${displayOffset.toFixed(1)}` : displayOffset.toFixed(1)} mm
          </span>
          <button
            onClick={() => setSectionConfig(projectId, { flipped: !flipped })}
            title={_t("一键翻转截面法向")}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '10px',
              padding: '0 2px',
              lineHeight: 1
            }}
          >
            {_t("⇄ 翻转")}</button>
        </div>
      </Html>
    </group>
  )
}
