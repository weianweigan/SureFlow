import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useMemo, type FC } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { getBoxFaceBasis, getCavityWorldMatrix, localToWorldPoint } from '@shared/design/faceMath'
import { resolveAllTemplateHoles } from '../../geometry/templateHoleResolver'
import { buildOutlineGeometry } from '../../geometry/outlineBuilder'
import { usePlacementStore } from '../../model/placementStore'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { useDesignStore } from '../../model/designStore'
import { CadDimensionLines } from './CadDimensionLines'
import { distSegmentToSegment } from './gizmoMath'

interface GhostCavityMeshProps {
  dimensions: [number, number, number]
  projectId?: string
}

/**
 * 拖拽布孔幽灵定位指示（Ghost Cavity Placement Indicator）
 * 精简 CAD 定位模式：
 * 1. 移除遮挡阀块视线的厚重 3D 孔腔实体模型与浮动文字框
 * 2. 仅在放置表面呈现轻量孔位中心十字标（Crosshair）、孔口边界圈与安装轮廓线
 * 3. 在阀块基体面外侧投影 CAD 工程标注尺寸线，清晰实时显示 U 和 V 坐标数值
 */
export const GhostCavityMesh: FC<GhostCavityMeshProps> = ({ dimensions, projectId }) => {
  _useLocale()
  const isPlacing = usePlacementStore((s) => s.isPlacing)
  const template = usePlacementStore((s) => s.template)
  const currentFaceId = usePlacementStore((s) => s.currentFaceId)
  const u = usePlacementStore((s) => s.u)
  const v = usePlacementStore((s) => s.v)
  const isValid = usePlacementStore((s) => s.isValid)
  const libraryDoc = useLibraryStore((s) => s.doc)
  const session = useDesignStore((s) => (projectId ? s.projects[projectId] : undefined))
  const activeScheme = useMemo(() => {
    if (!session?.doc) return null
    return (
      session.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) ||
      session.doc.schemes[0]
    )
  }, [session?.doc])
  const cavities: any[] = activeScheme?.cavities || []

  // 1. 解析模板中所有孔位与孔口尺寸
  const resolvedHoles = useMemo(() => {
    if (!template) return []
    return resolveAllTemplateHoles(template, libraryDoc)
  }, [template, libraryDoc])

  const holePositions = useMemo(() => {
    return resolvedHoles.map((h) => {
      const maxDia = Math.max(0, ...h.steps.map((s) => s.diameter))
      const mouthRadius = Math.max(maxDia / 2, 2.5)
      return {
        ...h,
        mouthRadius
      }
    })
  }, [resolvedHoles])

  // 计算多孔/组合孔整体外包络半径，用于绘制合适的中心十字标长度
  const maxRadius = useMemo(() => {
    if (holePositions.length === 0) return 8
    let r = 8
    for (const h of holePositions) {
      const dist = Math.hypot(h.uOffset, h.vOffset) + h.mouthRadius
      if (dist > r) r = dist
    }
    return r
  }, [holePositions])

  // 2. 解析安装轮廓线（Outline）
  const outlineGeoms = useMemo(() => {
    if (!template?.geometry?.outline) return null
    return buildOutlineGeometry(template.geometry.outline, template.unit)
  }, [template?.geometry?.outline, template?.unit])

  // 3. 面基准及世界空间变换矩阵（以落点 (u, v) 为中心原点）
  const { basis, worldMatrix4 } = useMemo(() => {
    if (!currentFaceId) {
      return { basis: null, worldMatrix4: new THREE.Matrix4() }
    }
    const b = getBoxFaceBasis(currentFaceId, dimensions)
    const rawMatrix = getCavityWorldMatrix(b, u, v, 0, 0)
    const m = new THREE.Matrix4()
    m.fromArray(rawMatrix)
    return { basis: b, worldMatrix4: m }
  }, [currentFaceId, dimensions, u, v])

  // 4. 内部孔腔干涉检测（深入内部遇到其他已有孔相交或净距 < 3.0mm 即刻判定干涉）
  const hasInterference = useMemo(() => {
    if (!currentFaceId || !basis || cavities.length === 0 || holePositions.length === 0) {
      return false
    }
    for (const h of holePositions) {
      const hDepth = h.steps.reduce((acc: number, s: any) => acc + (s.length || s.depth || 0), 0) || 20
      const p0 = localToWorldPoint(basis, u + h.uOffset, v + h.vOffset, 0)
      const p1: [number, number, number] = [
        p0[0] - basis.w[0] * hDepth,
        p0[1] - basis.w[1] * hDepth,
        p0[2] - basis.w[2] * hDepth
      ]
      const hRadius = h.mouthRadius

      for (const cav of cavities) {
        if (cav.suppressed) continue
        const cavBasis = getBoxFaceBasis(cav.faceId, dimensions)
        const cavSteps = cav.steps || []
        const cavDepth = cavSteps.reduce((acc: number, s: any) => acc + (s.length || s.depth || 0), 0) || 20
        const cavMaxDia = Math.max(0, ...cavSteps.map((s: any) => s.diameter))
        const cavRadius = Math.max(cavMaxDia / 2, 2.5)

        const q0 = localToWorldPoint(cavBasis, cav.u, cav.v, cav.depthOffset || 0)
        const q1: [number, number, number] = [
          q0[0] - cavBasis.w[0] * cavDepth,
          q0[1] - cavBasis.w[1] * cavDepth,
          q0[2] - cavBasis.w[2] * cavDepth
        ]

        const dist = distSegmentToSegment(p0, p1, q0, q1)
        if (dist < hRadius + cavRadius + 3.0) {
          return true
        }
      }
    }
    return false
  }, [currentFaceId, basis, cavities, holePositions, u, v, dimensions])

  // 十字中心定位标线几何体
  const crossGeom = useMemo(() => {
    const arm = Math.max(10, maxRadius + 3)
    const pts = [
      new THREE.Vector3(-arm, 0, 0.05),
      new THREE.Vector3(arm, 0, 0.05),
      new THREE.Vector3(0, -arm, 0.05),
      new THREE.Vector3(0, arm, 0.05)
    ]
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [maxRadius])

  if (!isPlacing || !currentFaceId || !basis || holePositions.length === 0) {
    return null
  }

  const effectiveValid = isValid && !hasInterference
  const accentColor = effectiveValid ? '#0ea5e9' : '#ef4444'

  // 将 matrix4 拆解为 position / quaternion / scale 供 group 绑定
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3()
  worldMatrix4.decompose(pos, quat, scl)

  return (
    <>
      {/* ── 1. 面外 CAD 工程尺寸线（清晰标注 U 与 V 坐标数值） ── */}
      <CadDimensionLines
        basis={basis}
        u={u}
        v={v}
        dimensions={dimensions}
        isDragging={true}
        isValid={isValid}
      />

      {/* ── 2. 孔位表面定位标记（中心十字标、孔口圆环、外轮廓框线） ── */}
      <group position={pos} quaternion={quat} scale={scl} renderOrder={300}>
        {/* 安装面外轮廓描边框线（不渲染实体铺底，保证透光通视） */}
        {outlineGeoms && (
          <lineSegments geometry={outlineGeoms.lineGeometry} renderOrder={325}>
            <lineBasicMaterial
              color={accentColor}
              linewidth={1.5}
              transparent
              opacity={0.85}
              depthTest={false}
            />
          </lineSegments>
        )}

        {/* 中心十字定位线 */}
        <lineSegments geometry={crossGeom} renderOrder={330}>
          <lineBasicMaterial
            color={accentColor}
            linewidth={1.5}
            transparent
            opacity={0.9}
            depthTest={false}
          />
        </lineSegments>

        {/* 中心精准定位圆点 */}
        <mesh position={[0, 0, 0.06]} renderOrder={335}>
          <circleGeometry args={[0.7, 16]} />
          <meshBasicMaterial
            color={accentColor}
            side={THREE.DoubleSide}
            depthTest={false}
          />
        </mesh>

        {/* 各个子孔孔口定位线圈 */}
        {holePositions.map((hole, index) => (
          <group
            key={`${hole.name}-${index}`}
            position={[hole.uOffset, hole.vOffset, 0.05]}
            rotation={[0, 0, (hole.rotation * Math.PI) / 180]}
          >
            {/* 孔口圆环线（壁厚 0.8mm，高亮不遮挡） */}
            <mesh renderOrder={320}>
              <ringGeometry
                args={[
                  Math.max(0.1, hole.mouthRadius - 0.4),
                  hole.mouthRadius + 0.4,
                  48
                ]}
              />
              <meshBasicMaterial
                color={hole.portSemantic?.color || accentColor}
                side={THREE.DoubleSide}
                transparent
                opacity={0.85}
                depthTest={false}
              />
            </mesh>

            {/* 若为多孔组合，各子孔中心点标记 */}
            {holePositions.length > 1 && (
              <mesh position={[0, 0, 0.01]} renderOrder={322}>
                <circleGeometry args={[0.4, 12]} />
                <meshBasicMaterial
                  color={hole.portSemantic?.color || accentColor}
                  side={THREE.DoubleSide}
                  depthTest={false}
                />
              </mesh>
            )}
          </group>
        ))}

        {/* 内部孔道干涉警戒气泡 */}
        {hasInterference && (
          <Html position={[0, maxRadius + 6, 0.5]} center>
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.95)',
                color: '#ffffff',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                pointerEvents: 'none',
                border: '1px solid #fca5a5'
              }}
            >
              {_t("⚠️ 内部干涉")}</div>
          </Html>
        )}
      </group>
    </>
  )
}
