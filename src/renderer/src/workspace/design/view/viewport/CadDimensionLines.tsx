import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useMemo, useState, useRef, useEffect } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { localToWorldPoint, type FaceBasis } from '@shared/design/faceMath'

export interface CadDimensionLinesProps {
  basis: FaceBasis
  u: number // 局部 X 坐标
  v: number // 局部 Y 坐标
  dimensions: [number, number, number]
  isDragging: boolean
  isValid?: boolean
  onUpdateX?: (newX: number) => void
  onUpdateY?: (newY: number) => void
  referenceCavity?: { id: string; x: number; y: number; name?: string } | null
  onClearReference?: () => void
}

/**
 * G-11 · CAD 工程标注尺寸线与坐标徽标 (CadDimensionLines)
 * 严格对齐 PRD-FR-04-10 规范：
 * - 面向用户严格采用 X 与 Y 坐标，全面废除 U/V；
 * - 尺寸界线、尺寸线与 45° 机械倒角刻度线；
 * - 支持双击尺寸胶囊原地内联修改数值（Inline Drive Edit），按 Enter 直接驱动孔位；
 * - 标签严格启用 Billboarding 始终正向面对屏幕相机，绝无倒置或镜像；
 * - 支持相对参考孔尺寸（ΔX, ΔY）。
 */
export function CadDimensionLines({
  basis,
  u,
  v,
  dimensions: _dimensions,
  isDragging,
  isValid = true,
  onUpdateX,
  onUpdateY,
  referenceCavity,
  onClearReference
}: CadDimensionLinesProps) {
  _useLocale()
  // 基准点坐标（默认是面原点 0, 0；若指定了参考孔则以参考孔为基准）
  const datumX = referenceCavity ? referenceCavity.x : 0
  const datumY = referenceCavity ? referenceCavity.y : 0
  const isRelative = Boolean(referenceCavity)

  // 内联编辑状态
  const [editingAxis, setEditingAxis] = useState<'x' | 'y' | null>(null)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingAxis && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingAxis])

  // 智能推导当前面的外侧偏置方向符号（极轴方向检测）
  // 对于 back 与 left 表面，其局部坐标 u 沿负向延伸（u ∈ [-dim, 0]），因此外侧为正方向（+uExtSign = +1）
  // 对于 bottom 表面，其局部坐标 v 沿负向延伸（v ∈ [-dim, 0]），因此外侧为正方向（+vExtSign = +1）
  const isNegUFace = basis.id === 'back' || basis.id === 'left' || (basis.u[0] + basis.u[1] + basis.u[2] < -0.5)
  const isNegVFace = basis.id === 'bottom' || (basis.v[0] + basis.v[1] + basis.v[2] < -0.5)

  const uExtSign = isNegUFace ? 1 : -1
  const vExtSign = isNegVFace ? 1 : -1

  // 基体外尺寸线偏移距离（mm）
  const extOffset = 14
  const overshoot = 18

  const uOffset = uExtSign * extOffset
  const uOvershoot = uExtSign * overshoot

  const vOffset = vExtSign * extOffset
  const vOvershoot = vExtSign * overshoot

  // X 坐标尺寸线几何点 (位于 Y 轴外侧)
  const xGeom = useMemo(() => {
    const pWitness1Start = localToWorldPoint(basis, datumX, datumY, 0.08)
    const pWitness1End = localToWorldPoint(basis, datumX, vOvershoot, 0.08)

    const pWitness2Start = localToWorldPoint(basis, u, v, 0.08)
    const pWitness2End = localToWorldPoint(basis, u, vOvershoot, 0.08)

    const pDimStart = localToWorldPoint(basis, datumX, vOffset, 0.08)
    const pDimEnd = localToWorldPoint(basis, u, vOffset, 0.08)

    // 端部 CAD 45° 倒角刻度线
    const tickLen = 2.0
    const t1A = localToWorldPoint(basis, datumX - tickLen * 0.7, vOffset - tickLen * 0.7 * vExtSign, 0.08)
    const t1B = localToWorldPoint(basis, datumX + tickLen * 0.7, vOffset + tickLen * 0.7 * vExtSign, 0.08)

    const t2A = localToWorldPoint(basis, u - tickLen * 0.7, vOffset - tickLen * 0.7 * vExtSign, 0.08)
    const t2B = localToWorldPoint(basis, u + tickLen * 0.7, vOffset + tickLen * 0.7 * vExtSign, 0.08)

    const pts = [
      new THREE.Vector3(...pWitness1Start),
      new THREE.Vector3(...pWitness1End),
      new THREE.Vector3(...pWitness2Start),
      new THREE.Vector3(...pWitness2End),
      new THREE.Vector3(...pDimStart),
      new THREE.Vector3(...pDimEnd),
      new THREE.Vector3(...t1A),
      new THREE.Vector3(...t1B),
      new THREE.Vector3(...t2A),
      new THREE.Vector3(...t2B)
    ]
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [basis, datumX, datumY, u, v, vOffset, vOvershoot, vExtSign])

  // Y 坐标尺寸线几何点 (位于 X 轴外侧)
  const yGeom = useMemo(() => {
    const pWitness1Start = localToWorldPoint(basis, datumX, datumY, 0.08)
    const pWitness1End = localToWorldPoint(basis, uOvershoot, datumY, 0.08)

    const pWitness2Start = localToWorldPoint(basis, u, v, 0.08)
    const pWitness2End = localToWorldPoint(basis, uOvershoot, v, 0.08)

    const pDimStart = localToWorldPoint(basis, uOffset, datumY, 0.08)
    const pDimEnd = localToWorldPoint(basis, uOffset, v, 0.08)

    // 端部 CAD 45° 倒角刻度线
    const tickLen = 2.0
    const t1A = localToWorldPoint(basis, uOffset - tickLen * 0.7 * uExtSign, datumY - tickLen * 0.7, 0.08)
    const t1B = localToWorldPoint(basis, uOffset + tickLen * 0.7 * uExtSign, datumY + tickLen * 0.7, 0.08)

    const t2A = localToWorldPoint(basis, uOffset - tickLen * 0.7 * uExtSign, v - tickLen * 0.7, 0.08)
    const t2B = localToWorldPoint(basis, uOffset + tickLen * 0.7 * uExtSign, v + tickLen * 0.7, 0.08)

    const pts = [
      new THREE.Vector3(...pWitness1Start),
      new THREE.Vector3(...pWitness1End),
      new THREE.Vector3(...pWitness2Start),
      new THREE.Vector3(...pWitness2End),
      new THREE.Vector3(...pDimStart),
      new THREE.Vector3(...pDimEnd),
      new THREE.Vector3(...t1A),
      new THREE.Vector3(...t1B),
      new THREE.Vector3(...t2A),
      new THREE.Vector3(...t2B)
    ]
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [basis, datumX, datumY, u, v, uOffset, uOvershoot, uExtSign])

  // 尺寸值标签世界坐标
  const badgeWorldPosX = useMemo<[number, number, number]>(() => {
    return localToWorldPoint(basis, (datumX + u) / 2, vOffset, 0.15)
  }, [basis, datumX, u, vOffset])

  const badgeWorldPosY = useMemo<[number, number, number]>(() => {
    return localToWorldPoint(basis, uOffset, (datumY + v) / 2, 0.15)
  }, [basis, datumY, v, uOffset])

  const lineColor = !isValid ? '#ef4444' : isDragging ? '#00EBFF' : '#475569'

  // 工业直边矩形徽标规范（深色高对比度背景防穿透，名称与数值垂直分割线，与角度度数标牌统一风格）
  const badgeContainerClass = !isValid
    ? 'bg-red-950/95 text-red-200 border-red-500 shadow-md'
    : isDragging
      ? 'bg-slate-900/95 text-cyan-300 border-cyan-400 shadow-[0_0_10px_rgba(0,235,255,0.35)]'
      : 'bg-slate-900/95 text-slate-100 border-slate-700 hover:border-sky-400 shadow-md hover:bg-slate-850'

  const handleStartEdit = (axis: 'x' | 'y') => {
    setEditingAxis(axis)
    const currentVal = axis === 'x' ? (isRelative ? u - datumX : u) : (isRelative ? v - datumY : v)
    setInputValue(String(Math.round(currentVal * 10) / 10))
  }

  const handleCommitEdit = () => {
    const val = parseFloat(inputValue)
    if (Number.isFinite(val)) {
      const snapped = val
      if (editingAxis === 'x') {
        let targetVal = snapped
        if (!isRelative && isNegUFace && targetVal > 0 && u < 0) {
          targetVal = -Math.abs(targetVal)
        }
        const finalX = isRelative ? datumX + snapped : targetVal
        onUpdateX?.(finalX)
      } else if (editingAxis === 'y') {
        let targetVal = snapped
        if (!isRelative && isNegVFace && targetVal > 0 && v < 0) {
          targetVal = -Math.abs(targetVal)
        }
        const finalY = isRelative ? datumY + snapped : targetVal
        onUpdateY?.(finalY)
      }
    }
    setEditingAxis(null)
  }

  const dispX = Math.round((isRelative ? u - datumX : u) * 10) / 10
  const dispY = Math.round((isRelative ? v - datumY : v) * 10) / 10

  return (
    <group renderOrder={250}>
      <lineSegments geometry={xGeom}>
        <lineBasicMaterial
          color={lineColor}
          depthTest={false}
          transparent
          opacity={isDragging ? 0.95 : 0.75}
        />
      </lineSegments>
      <lineSegments geometry={yGeom}>
        <lineBasicMaterial
          color={lineColor}
          depthTest={false}
          transparent
          opacity={isDragging ? 0.95 : 0.75}
        />
      </lineSegments>

      {/* ── X 坐标标注矩形徽标（深色高对比度背景、名称数值分割线、双击就地内联修改驱动孔位） ── */}
      <Html position={badgeWorldPosX} center style={{ pointerEvents: 'auto' }}>
        {editingAxis === 'x' ? (
          <div className="flex items-center gap-1.5 bg-slate-900 border border-sky-400 rounded-[2px] px-1.5 py-0.5 shadow-xl">
            <span className="font-mono text-[10px] font-bold text-sky-400">{isRelative ? 'ΔX' : 'X'}</span>
            <span className="w-[1px] h-2.5 bg-slate-700" />
            <input
              ref={inputRef}
              type="text"
              className="w-12 bg-slate-800 text-white font-mono text-[10px] px-1 py-0.5 rounded-[2px] border-0 outline-none text-center font-bold"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommitEdit()
                if (e.key === 'Escape') setEditingAxis(null)
              }}
              onBlur={handleCommitEdit}
            />
            <span className="font-mono text-[10px] text-slate-400">mm</span>
          </div>
        ) : (
          <div
            title={_t("双击就地修改坐标并驱动孔位")}
            onDoubleClick={(e) => {
              e.stopPropagation()
              handleStartEdit('x')
            }}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-[2px] font-mono text-[10px] tracking-tight border select-none transition-all whitespace-nowrap cursor-pointer hover:scale-105 ${badgeContainerClass}`}
          >
            <span className="font-bold text-sky-400">{isRelative ? 'ΔX' : 'X'}</span>
            <span className="w-[1px] h-2.5 bg-slate-700" />
            <span className="font-semibold text-slate-100">{dispX} mm</span>
          </div>
        )}
      </Html>

      {/* ── Y 坐标标注矩形徽标（深色高对比度背景、名称数值分割线、双击就地内联修改驱动孔位） ── */}
      <Html position={badgeWorldPosY} center style={{ pointerEvents: 'auto' }}>
        {editingAxis === 'y' ? (
          <div className="flex items-center gap-1.5 bg-slate-900 border border-emerald-400 rounded-[2px] px-1.5 py-0.5 shadow-xl">
            <span className="font-mono text-[10px] font-bold text-emerald-400">{isRelative ? 'ΔY' : 'Y'}</span>
            <span className="w-[1px] h-2.5 bg-slate-700" />
            <input
              ref={inputRef}
              type="text"
              className="w-12 bg-slate-800 text-white font-mono text-[10px] px-1 py-0.5 rounded-[2px] border-0 outline-none text-center font-bold"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommitEdit()
                if (e.key === 'Escape') setEditingAxis(null)
              }}
              onBlur={handleCommitEdit}
            />
            <span className="font-mono text-[10px] text-slate-400">mm</span>
          </div>
        ) : (
          <div
            title={_t("双击就地修改坐标并驱动孔位")}
            onDoubleClick={(e) => {
              e.stopPropagation()
              handleStartEdit('y')
            }}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-[2px] font-mono text-[10px] tracking-tight border select-none transition-all whitespace-nowrap cursor-pointer hover:scale-105 ${badgeContainerClass}`}
          >
            <span className="font-bold text-emerald-400">{isRelative ? 'ΔY' : 'Y'}</span>
            <span className="w-[1px] h-2.5 bg-slate-700" />
            <span className="font-semibold text-slate-100">{dispY} mm</span>
          </div>
        )}
      </Html>

      {/* 相对基准清除按钮（若处于相对基准模式） */}
      {isRelative && onClearReference && (
        <Html position={localToWorldPoint(basis, datumX, datumY, 0.2)} center style={{ pointerEvents: 'auto' }}>
          <button
            type="button"
            title={_t("重置为绝对面基准")}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-600/90 hover:bg-amber-500 text-white rounded-[2px] text-[9px] font-mono shadow-md border border-amber-300"
            onClick={(e) => {
              e.stopPropagation()
              onClearReference()
            }}
          >
            {_t("⚓ 参考孔 ✕")}</button>
        </Html>
      )}
    </group>
  )
}
